import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { dirname, join, normalize, sep } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { UsuarioToken, temPermissao } from '../common/permissoes';
import { MODULOS } from '../common/modulos';
import { decifrar } from '../common/cripto';
import { Asaas, ErroAsaas } from '../cobranca/asaas';
import { criarEmpresa } from '../seed/nova-empresa';

/**
 * Revenda do sistema (SaaS): teste grátis, planos, mensalidades (boleto/Pix pelo Asaas da Virtual Barra),
 * bloqueio por atraso, área do cliente, suporte com IA, erros do sistema, downloads, implantação e traduções.
 * Quem administra é a empresa "plataforma" (Virtual Barra).
 */

export type Situacao = 'teste' | 'demo' | 'ativa' | 'atrasada' | 'bloqueada' | 'suspensa' | 'cancelada';
export const SITUACOES_BLOQUEIO: Situacao[] = ['bloqueada', 'suspensa', 'cancelada'];
export const CATEGORIAS_DOWNLOAD: Record<string, string> = {
  instalador: 'Instaladores do sistema', impressoras: 'Drivers de impressoras', reparo: 'Reparo e manutenção',
  programas: 'Programas do dia a dia', manuais: 'Manuais e vídeos', app: 'Aplicativos',
};
export const IDIOMAS: Record<string, string> = { 'pt-BR': 'Português', es: 'Español', en: 'English' };
export const SEGMENTOS: Record<string, string> = { hospedagem: 'Hotéis, pousadas e motéis', restaurante: 'Restaurantes, bares e lanchonetes' };
export const PORTES: Record<string, string> = { pequeno: 'Pequena empresa', medio: 'Média empresa', grande: 'Grande empresa', rede: 'Rede / várias unidades' };
export const TIPOS_PARCEIRO: Record<string, { nome: string; explica: string }> = {
  indicacao: { nome: 'VB Indica', explica: 'Indica clientes pelo seu link e ganha comissão todo mês enquanto o cliente pagar.' },
  revenda: { nome: 'VB Revenda', explica: 'Vende o sistema, faz o primeiro atendimento e pode dar desconto ao cliente; comissão maior.' },
  marca: { nome: 'VB Sua Marca', explica: 'Vende com o nome e as cores da sua empresa (white-label), com condições em contrato.' },
};

const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const somaDias = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const diasEntre = (a: string, b: string) => Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86400000);
const dia = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10));
const soDigitos = (s: unknown) => String(s ?? '').replace(/\D/g, '');
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** passos da implantação conferidos sozinhos pelo sistema */
const PASSOS_AUTO: [string, string, string, number][] = [
  ['empresa', 'Dados da empresa (CNPJ e nome)', `SELECT (CASE WHEN cnpj IS NOT NULL AND cnpj <> '' THEN 1 ELSE 0 END) AS n FROM empresas WHERE id = $1`, 1],
  ['categorias', 'Ambientes e categorias de suíte', `SELECT count(*)::int AS n FROM categorias WHERE empresa_id = $1`, 1],
  ['unidades', 'Suítes e quartos cadastrados', `SELECT count(*)::int AS n FROM unidades WHERE empresa_id = $1`, 1],
  ['tarifas', 'Preços nas tarifas', `SELECT count(*)::int AS n FROM precos p JOIN tabelas_preco t ON t.id = p.tabela_id WHERE t.empresa_id = $1 AND p.valor > 0`, 1],
  ['usuarios', 'Usuários da equipe criados', `SELECT count(*)::int AS n FROM usuarios WHERE empresa_id = $1`, 2],
  ['produtos', 'Produtos e frigobar', `SELECT count(*)::int AS n FROM produtos WHERE empresa_id = $1`, 5],
  ['impressora', 'Impressora configurada', `SELECT count(*)::int AS n FROM impressoras WHERE empresa_id = $1`, 1],
  ['funcionarios', 'Funcionários cadastrados', `SELECT count(*)::int AS n FROM funcionarios WHERE empresa_id = $1`, 1],
  ['caixa', 'Primeiro caixa aberto', `SELECT count(*)::int AS n FROM caixa_turnos WHERE empresa_id = $1`, 1],
  ['locacao', 'Primeira locação lançada', `SELECT count(*)::int AS n FROM estadias WHERE empresa_id = $1`, 1],
];
/** passos marcados pela Virtual Barra */
const PASSOS_MANUAIS: [string, string][] = [
  ['treino_recepcao', 'Treinamento da recepção'], ['treino_gerencia', 'Treinamento da gerência'],
  ['migracao', 'Dados do sistema antigo importados'], ['fiscal', 'Notas fiscais testadas'], ['virada', 'Início do uso de verdade (virada)'],
];

interface Cfg { teste_dias: number; dias_aviso: number; dias_bloqueio: number; whatsapp: string | null; email: string | null; textos: Record<string, string> }

@Injectable()
export class RevendaService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Revenda');
  private timer: NodeJS.Timeout | null = null;
  private readonly cache = new Map<string, { situacao: Situacao; ate: number }>();
  private readonly tentativas = new Map<string, number[]>();

  constructor(private readonly ds: DataSource) {}

  onApplicationBootstrap() {
    if ((process.env.VB_MODO || '').toLowerCase() === 'local') return;
    // rotina da revenda: mensalidades, atrasos e fim do teste (1ª vez depois de 1 min, depois de hora em hora)
    setTimeout(() => this.rotina().catch((e) => this.log.warn(`Rotina: ${e instanceof Error ? e.message : e}`)), 60_000).unref();
    this.timer = setInterval(() => this.rotina().catch((e) => this.log.warn(`Rotina: ${e instanceof Error ? e.message : e}`)), 3_600_000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private async cfg(): Promise<Cfg> {
    const [c] = await this.ds.query(`SELECT * FROM revenda_config WHERE id = 1`);
    return c ?? { teste_dias: 14, dias_aviso: 3, dias_bloqueio: 15, whatsapp: null, email: null, textos: {} };
  }
  private async plataformaId(): Promise<string | null> {
    const [p] = await this.ds.query(`SELECT id FROM empresas WHERE plataforma ORDER BY criado_em LIMIT 1`);
    return p?.id ?? null;
  }

  /* ============================================================ situação (bloqueio) */

  /** situação da empresa para a guarda (guardada 60 s) */
  async situacao(empresaId: string): Promise<Situacao> {
    const c = this.cache.get(empresaId);
    if (c && c.ate > Date.now()) return c.situacao;
    const [e] = await this.ds.query(`SELECT situacao, plataforma FROM empresas WHERE id = $1`, [empresaId]);
    const s: Situacao = e?.plataforma ? 'ativa' : (e?.situacao ?? 'ativa');
    this.cache.set(empresaId, { situacao: s, ate: Date.now() + 60_000 });
    return s;
  }
  private esquecer(empresaId: string) { this.cache.delete(empresaId); }

  /** informação para a sessão (faixa de aviso e redirecionamento no site) */
  async infoSessao(empresaId: string) {
    const [e] = await this.ds.query(
      `SELECT e.situacao, e.teste_ate, e.plataforma, e.idioma, p.nome AS plano,
              (SELECT min(vencimento) FROM mensalidades m WHERE m.empresa_id = e.id AND m.situacao = 'pendente') AS venc_aberto
         FROM empresas e LEFT JOIN planos p ON p.id = e.plano_id WHERE e.id = $1`, [empresaId]);
    if (!e) return null;
    const hoje = hojeSP();
    return {
      situacao: (e.plataforma ? 'ativa' : e.situacao) as Situacao,
      plataforma: !!e.plataforma, plano: e.plano ?? null, idioma: e.idioma ?? 'pt-BR',
      testeAte: e.teste_ate ? dia(e.teste_ate) : null,
      diasTeste: e.teste_ate ? diasEntre(hoje, dia(e.teste_ate)) : null,
      vencimentoAberto: e.venc_aberto ? dia(e.venc_aberto) : null,
    };
  }

  /* ============================================================ público (site de vendas) */

  async planosPublicos() {
    const cfg = await this.cfg();
    const planos = await this.ds.query(`SELECT id, nome, descricao, preco, itens, limite_unidades, destaque, modulos, segmento, porte, sob_consulta, publico FROM planos WHERE ativo ORDER BY segmento, ordem, preco`);
    return {
      planos: planos.map((p: Record<string, unknown>) => ({
        id: p.id, nome: p.nome, descricao: p.descricao, preco: Number(p.preco), itens: p.itens, limiteUnidades: p.limite_unidades, destaque: p.destaque, modulos: p.modulos,
        segmento: p.segmento, porte: p.porte, sobConsulta: p.sob_consulta, publico: p.publico,
      })),
      testeDias: cfg.teste_dias, whatsapp: cfg.whatsapp, email: cfg.email, textos: cfg.textos ?? {}, modulos: MODULOS,
    };
  }

  /** teste grátis pelo site: cria a empresa com suítes, preços e produtos de exemplo */
  async criarTeste(dto: { empresa: string; nome: string; email: string; telefone: string; senha: string; tipo: string; cidade?: string; idioma?: string; parceiro?: string }, ip: string) {
    const agora = Date.now();
    const lista = (this.tentativas.get(ip) ?? []).filter((t) => agora - t < 3_600_000);
    const total = [...this.tentativas.values()].flat().filter((t) => agora - t < 3_600_000).length;
    if (lista.length >= 3 || total >= 40) throw new BadRequestException('Muitos cadastros em pouco tempo. Tente de novo mais tarde ou fale com a gente pelo WhatsApp.');
    const email = dto.email.trim().toLowerCase();
    const [ja] = await this.ds.query(`SELECT 1 FROM usuarios WHERE lower(login) = $1`, [email]);
    if (ja) throw new BadRequestException('Este e-mail já tem cadastro. Entre pelo login com ele.');
    this.tentativas.set(ip, [...lista, agora]);
    const cfg = await this.cfg();
    const fim = somaDias(hojeSP(), cfg.teste_dias);
    const todos = Object.fromEntries(Object.keys(MODULOS).map((k) => [k, true]));
    const { empresaId } = await this.ds.transaction((m) => criarEmpresa(m, {
      nome: dto.empresa.trim(), adminNome: dto.nome.trim(), login: email, senha: dto.senha, exemplos: true, precosExemplo: true, restaurante: dto.tipo === 'restaurante', extra: { modulos: todos },
    }));
    await this.ds.query(
      `UPDATE empresas SET situacao = 'teste', teste_ate = $2, origem = 'site', idioma = $3, responsavel = $4::jsonb WHERE id = $1`,
      [empresaId, fim, IDIOMAS[dto.idioma ?? ''] ? dto.idioma : 'pt-BR', JSON.stringify({ nome: dto.nome.trim(), email, telefone: soDigitos(dto.telefone), cidade: dto.cidade?.trim() || null, tipo: dto.tipo })]);
    if (dto.parceiro) {
      // veio pelo link de um parceiro: o cliente fica ligado a ele (comissão)
      await this.ds.query(`UPDATE empresas SET parceiro_id = (SELECT id FROM parceiros WHERE upper(codigo) = upper($2) AND situacao = 'ativo') WHERE id = $1`, [empresaId, dto.parceiro.trim().slice(0, 20)]);
    }
    this.log.log(`Teste grátis criado: ${dto.empresa} (${email}) até ${fim}`);
    return { ok: true, login: email, testeAte: fim };
  }

  async downloadsPublicos() {
    return this.listaDownloads(true);
  }

  /* ============================================================ área do cliente */

  private exigirAdmin(u: UsuarioToken) {
    if (!temPermissao(u, 'empresa.editar') && !temPermissao(u, 'caixa.adm')) throw new ForbiddenException('Só o administrador da empresa vê o plano e as mensalidades.');
  }

  async implantacao(empresaId: string) {
    const [e] = await this.ds.query(`SELECT implantacao FROM empresas WHERE id = $1`, [empresaId]);
    const marcas = (e?.implantacao ?? {}) as Record<string, { feito: boolean; obs?: string; em?: string; por?: string }>;
    const auto = [];
    for (const [id, nome, sql, minimo] of PASSOS_AUTO) {
      const [r] = await this.ds.query(sql, [empresaId]).catch(() => [{ n: 0 }]);
      auto.push({ id, nome, feito: Number(r?.n ?? 0) >= minimo, automatico: true, quantidade: Number(r?.n ?? 0), obs: marcas[id]?.obs ?? null });
    }
    const manuais = PASSOS_MANUAIS.map(([id, nome]) => ({ id, nome, feito: !!marcas[id]?.feito, automatico: false, quantidade: null, obs: marcas[id]?.obs ?? null, em: marcas[id]?.em ?? null, por: marcas[id]?.por ?? null }));
    const passos = [...auto, ...manuais];
    return { passos, feitos: passos.filter((p) => p.feito).length, total: passos.length };
  }

  async area(u: UsuarioToken) {
    const [e] = await this.ds.query(
      `SELECT e.id, e.nome, e.cnpj, e.situacao, e.teste_ate, e.plano_id, e.dia_vencimento, e.mensalidade_valor, e.responsavel, e.plataforma, e.idioma,
              p.nome AS plano_nome, p.preco AS plano_preco
         FROM empresas e LEFT JOIN planos p ON p.id = e.plano_id WHERE e.id = $1`, [u.empresaId]);
    if (!e) throw new NotFoundException();
    const cfg = await this.cfg();
    const admin = temPermissao(u, 'empresa.editar') || temPermissao(u, 'caixa.adm');
    const mensalidades = admin ? (await this.ds.query(
      `SELECT id, competencia, descricao, valor, vencimento, situacao, link, linha, pix_copia_cola, pago_em FROM mensalidades WHERE empresa_id = $1 ORDER BY competencia DESC LIMIT 24`, [u.empresaId]))
      .map((m: Record<string, unknown>) => ({ id: m.id, competencia: m.competencia, descricao: m.descricao, valor: Number(m.valor), vencimento: dia(m.vencimento), situacao: m.situacao, link: m.link, linha: m.linha, pix: m.pix_copia_cola, pagoEm: m.pago_em })) : [];
    const hoje = hojeSP();
    return {
      empresa: {
        nome: e.nome, cnpj: e.cnpj, situacao: e.plataforma ? 'ativa' : e.situacao, testeAte: e.teste_ate ? dia(e.teste_ate) : null,
        diasTeste: e.teste_ate ? diasEntre(hoje, dia(e.teste_ate)) : null, plataforma: e.plataforma, idioma: e.idioma,
        plano: e.plano_id ? { id: e.plano_id, nome: e.plano_nome, valor: Number(e.mensalidade_valor ?? e.plano_preco) } : null,
        diaVencimento: e.dia_vencimento, responsavel: e.responsavel ?? {},
      },
      admin,
      planos: (await this.planosPublicos()).planos,
      mensalidades,
      implantacao: await this.implantacao(u.empresaId),
      downloads: await this.listaDownloads(false),
      contato: { whatsapp: cfg.whatsapp, email: cfg.email },
      cobrancaOnline: await this.asaasPlataforma().then(() => true).catch(() => false),
    };
  }

  /** contratar (ou trocar) o plano: libera os módulos do plano e gera a primeira mensalidade */
  async contratar(u: UsuarioToken, dto: { planoId: string; documento: string; email: string; diaVencimento?: number }) {
    this.exigirAdmin(u);
    const [p] = await this.ds.query(`SELECT * FROM planos WHERE id = $1 AND ativo`, [dto.planoId]);
    if (!p) throw new NotFoundException('Plano não encontrado.');
    if (p.sob_consulta) throw new BadRequestException(`O plano ${p.nome} é sob consulta: fale com a Virtual Barra pelo WhatsApp que montamos a proposta.`);
    const doc = soDigitos(dto.documento);
    if (doc.length !== 11 && doc.length !== 14) throw new BadRequestException('Informe o CPF ou o CNPJ de quem vai pagar.');
    const [e] = await this.ds.query(
      `SELECT e.situacao, e.teste_ate, e.plano_id, e.responsavel, e.plataforma, e.mensalidade_valor, pa.desconto_pct
         FROM empresas e LEFT JOIN parceiros pa ON pa.id = e.parceiro_id AND pa.situacao = 'ativo' WHERE e.id = $1`, [u.empresaId]);
    if (e?.plataforma) throw new BadRequestException('A empresa da plataforma não contrata plano.');
    if (p.limite_unidades) {
      const [n] = await this.ds.query(`SELECT count(*)::int AS n FROM unidades WHERE empresa_id = $1 AND ativo`, [u.empresaId]).catch(() => [{ n: 0 }]);
      if (Number(n?.n) > Number(p.limite_unidades)) throw new BadRequestException(`O plano ${p.nome} vai até ${p.limite_unidades} suítes/quartos e vocês têm ${n.n}. Escolha um plano maior.`);
    }
    const resp = { ...(e?.responsavel ?? {}), documento: doc, email: dto.email.trim().toLowerCase() };
    const diaV = Math.min(28, Math.max(1, Number(dto.diaVencimento) || 10));
    const situacao = e?.situacao === 'teste' && e.teste_ate && dia(e.teste_ate) >= hojeSP() ? 'teste' : 'ativa';
    await this.ds.query(
      `UPDATE empresas SET plano_id = $2, modulos = $3::jsonb, responsavel = $4::jsonb, dia_vencimento = $5, situacao = $6,
              cnpj = COALESCE(NULLIF(cnpj, ''), $7) WHERE id = $1`,
      [u.empresaId, p.id, JSON.stringify(p.modulos ?? {}), JSON.stringify(resp), diaV, situacao, doc.length === 14 ? doc : null]);
    this.esquecer(u.empresaId);
    // a primeira mensalidade: vence no fim do teste (ou em 3 dias)
    const venc = e?.teste_ate && dia(e.teste_ate) > somaDias(hojeSP(), 3) ? dia(e.teste_ate) : somaDias(hojeSP(), 3);
    const [jaTem] = await this.ds.query(`SELECT 1 FROM mensalidades WHERE empresa_id = $1 AND situacao IN ('pendente','paga') LIMIT 1`, [u.empresaId]);
    // cliente de revendedor com desconto combinado: a mensalidade já sai com o desconto
    const desconto = Number(e?.desconto_pct ?? 0);
    const proprio = e?.mensalidade_valor !== null && e?.mensalidade_valor !== undefined;
    const valor = proprio ? Number(e.mensalidade_valor) : Math.round(Number(p.preco) * (1 - desconto / 100) * 100) / 100;
    if (desconto > 0 && !proprio) await this.ds.query(`UPDATE empresas SET mensalidade_valor = $2 WHERE id = $1`, [u.empresaId, valor.toFixed(2)]);
    if (!jaTem) await this.criarMensalidade(u.empresaId, venc.slice(0, 7), venc, valor, `Plano ${p.nome}`);
    return this.area(u);
  }

  /** gera (ou mostra) o boleto/Pix da mensalidade */
  async pagar(u: UsuarioToken, id: string) {
    this.exigirAdmin(u);
    const [m] = await this.ds.query(`SELECT * FROM mensalidades WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!m) throw new NotFoundException('Mensalidade não encontrada.');
    if (m.situacao !== 'pendente') throw new BadRequestException('Esta mensalidade não está em aberto.');
    if (!m.link) await this.cobrarNoAsaas(m.id);
    const [n] = await this.ds.query(`SELECT link, linha, pix_copia_cola FROM mensalidades WHERE id = $1`, [id]);
    return { link: n.link, linha: n.linha, pix: n.pix_copia_cola };
  }

  private async asaasPlataforma(): Promise<{ api: Asaas; plataforma: string }> {
    const plataforma = await this.plataformaId();
    if (!plataforma) throw new ServiceUnavailableException('Plataforma não configurada.');
    const [e] = await this.ds.query(`SELECT cobranca FROM empresas WHERE id = $1`, [plataforma]);
    const c = e?.cobranca ?? {};
    if (!c.ativo || !c.chaveCripto) throw new ServiceUnavailableException('O pagamento online ainda não está ligado. Fale com a Virtual Barra pelo WhatsApp para receber o boleto.');
    return { api: new Asaas(decifrar(c.chaveCripto), c.ambiente ?? 'sandbox'), plataforma };
  }

  private async criarMensalidade(empresaId: string, competencia: string, vencimento: string, valor: number, descricao: string) {
    const linhas: { id: string }[] = await this.ds.query(
      `INSERT INTO mensalidades (empresa_id, competencia, descricao, valor, vencimento) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (empresa_id, competencia) DO NOTHING RETURNING id`,
      [empresaId, competencia, descricao, valor.toFixed(2), vencimento]);
    const id = linhas?.[0]?.id;
    if (id) await this.cobrarNoAsaas(id).catch((e) => this.log.warn(`Boleto da mensalidade não gerado: ${e instanceof Error ? e.message : e}`));
    return id ?? null;
  }

  /** boleto (com Pix) no Asaas da plataforma; o aviso de pagamento chega pelo webhook da cobrança */
  private async cobrarNoAsaas(mensalidadeId: string) {
    const { api, plataforma } = await this.asaasPlataforma();
    const [m] = await this.ds.query(
      `SELECT m.*, e.nome, e.cnpj, e.responsavel, e.asaas_cliente_revenda FROM mensalidades m JOIN empresas e ON e.id = m.empresa_id WHERE m.id = $1`, [mensalidadeId]);
    if (!m) throw new NotFoundException();
    const doc = soDigitos(m.responsavel?.documento || m.cnpj);
    if (doc.length !== 11 && doc.length !== 14) throw new BadRequestException('Falta o CPF ou CNPJ de quem paga. Escolha o plano de novo na Área do cliente informando o documento.');
    try {
      let cliente = m.asaas_cliente_revenda as string | null;
      if (!cliente) {
        const c = await api.criarCliente({ name: m.nome, cpfCnpj: doc, email: m.responsavel?.email || null, mobilePhone: soDigitos(m.responsavel?.telefone) || null, externalReference: `empresa:${m.empresa_id}` });
        cliente = c.id;
        await this.ds.query(`UPDATE empresas SET asaas_cliente_revenda = $2 WHERE id = $1`, [m.empresa_id, cliente]);
      }
      const venc = dia(m.vencimento) < hojeSP() ? somaDias(hojeSP(), 1) : dia(m.vencimento);
      const p = await api.criarCobranca({ customer: cliente, billingType: 'BOLETO', value: Number(m.valor), dueDate: venc, description: `VB Hotéis — ${m.descricao ?? 'mensalidade'} ${m.competencia}`, externalReference: `mensalidade:${m.id}` });
      const l = await api.linhaDigitavel(p.id).catch(() => null);
      const pix = await api.pix(p.id).catch(() => null);
      const link = p.bankSlipUrl || p.invoiceUrl || null;
      await this.ds.query(
        `INSERT INTO cobrancas (empresa_id, externo_id, tipo, referencia_id, forma, valor, vencimento, linha, link, pix_copia_cola, pix_imagem, criado_por)
         VALUES ($1,$2,'mensalidade',$3,'BOLETO',$4,$5,$6,$7,$8,$9,'Revenda')`,
        [plataforma, p.id, m.id, Number(m.valor).toFixed(2), venc, l?.identificationField ?? null, link, pix?.payload ?? null, pix?.encodedImage ?? null]);
      await this.ds.query(`UPDATE mensalidades SET link = $2, linha = $3, pix_copia_cola = $4, vencimento = $5 WHERE id = $1`, [m.id, link, l?.identificationField ?? null, pix?.payload ?? null, venc]);
    } catch (e) {
      if (e instanceof ErroAsaas) throw new BadRequestException(e.message);
      throw e;
    }
  }

  /* ============================================================ suporte */

  async chamados(u: UsuarioToken) {
    return this.ds.query(
      `SELECT c.id, c.numero, c.assunto, c.categoria, c.situacao, c.criado_por, c.criado_em, c.atualizado_em, NOT c.lido_cliente AS novo
         FROM suporte_chamados c WHERE c.empresa_id = $1 ORDER BY c.atualizado_em DESC LIMIT 100`, [u.empresaId]);
  }

  private async chamado(id: string, empresaId: string | null) {
    const [c] = await this.ds.query(
      `SELECT c.*, e.nome AS empresa FROM suporte_chamados c JOIN empresas e ON e.id = c.empresa_id WHERE c.id = $1 ${empresaId ? 'AND c.empresa_id = $2' : ''}`,
      empresaId ? [id, empresaId] : [id]);
    if (!c) throw new NotFoundException('Chamado não encontrado.');
    const msgs = await this.ds.query(`SELECT autor, nome, texto, criado_em FROM suporte_mensagens WHERE chamado_id = $1 ORDER BY criado_em`, [id]);
    return { ...c, mensagens: msgs };
  }

  async verChamado(u: UsuarioToken, id: string) {
    const c = await this.chamado(id, u.empresaId);
    await this.ds.query(`UPDATE suporte_chamados SET lido_cliente = true WHERE id = $1`, [id]);
    return c;
  }

  async abrirChamado(u: UsuarioToken, dto: { assunto: string; categoria?: string; texto: string; tela?: string; respostaIa?: string }) {
    const [c] = await this.ds.query(
      `INSERT INTO suporte_chamados (empresa_id, assunto, categoria, tela, criado_por) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [u.empresaId, dto.assunto.trim(), ['duvida', 'erro', 'pedido', 'financeiro'].includes(dto.categoria ?? '') ? dto.categoria : 'duvida', dto.tela?.slice(0, 150) ?? null, u.nome]);
    await this.ds.query(`INSERT INTO suporte_mensagens (chamado_id, autor, nome, texto) VALUES ($1,'cliente',$2,$3)`, [c.id, u.nome, dto.texto.trim()]);
    if (dto.respostaIa) await this.ds.query(`INSERT INTO suporte_mensagens (chamado_id, autor, nome, texto) VALUES ($1,'ia','Assistente',$2)`, [c.id, dto.respostaIa.slice(0, 4000)]);
    return this.verChamado(u, c.id);
  }

  async responderCliente(u: UsuarioToken, id: string, texto: string) {
    await this.chamado(id, u.empresaId);
    await this.ds.query(`INSERT INTO suporte_mensagens (chamado_id, autor, nome, texto) VALUES ($1,'cliente',$2,$3)`, [id, u.nome, texto.trim()]);
    await this.ds.query(`UPDATE suporte_chamados SET situacao = 'aberto', lido_suporte = false, atualizado_em = now() WHERE id = $1`, [id]);
    return this.verChamado(u, id);
  }

  async naoLidosCliente(empresaId: string) {
    const [r] = await this.ds.query(`SELECT count(*)::int AS n FROM suporte_chamados WHERE empresa_id = $1 AND NOT lido_cliente`, [empresaId]);
    return Number(r?.n ?? 0);
  }

  /** "Como resolver?": a IA responde com o manual e as soluções já conhecidas; se não souber, sugere abrir chamado */
  async sugerir(u: UsuarioToken, dto: { pergunta: string; trechos?: string; tela?: string }) {
    const chave = process.env.ANTHROPIC_API_KEY;
    if (!chave) throw new ServiceUnavailableException('O assistente não está ligado neste servidor. Abra um chamado que a equipe responde.');
    const solucoes: { mensagem: string; solucao: string }[] = await this.ds.query(
      `SELECT mensagem, solucao FROM erros_sistema WHERE resolvido AND solucao IS NOT NULL ORDER BY ultimo_em DESC LIMIT 25`);
    const sistema = `Você é o suporte do VB Hotéis, sistema de gestão de motel, hotel e pousada.
Responda em português do Brasil simples, para quem não é da área de tecnologia, em passos curtos e numerados.
Use só o que está no manual e nas soluções conhecidas abaixo. Não invente telas nem botões.
Se não tiver certeza ou se for problema que só a equipe resolve (cobrança, erro do servidor, dado sumido), diga que é melhor abrir um chamado e termine com a linha [ABRIR_CHAMADO].
Trechos do manual:
${(dto.trechos ?? '').slice(0, 9000) || '(nenhum)'}
Soluções conhecidas de erros:
${solucoes.map((s) => `- ${s.mensagem}: ${s.solucao}`).join('\n').slice(0, 4000) || '(nenhuma)'}`;
    try {
      const ia = new Anthropic({ apiKey: chave, ...(process.env.ANTHROPIC_BASE_URL ? { baseURL: process.env.ANTHROPIC_BASE_URL } : {}) });
      const r = await ia.messages.create({
        model: 'claude-sonnet-5-5', max_tokens: 1200, system: sistema,
        messages: [{ role: 'user', content: `${dto.tela ? `Tela: ${dto.tela}\n` : ''}${dto.pergunta}` }],
      });
      let texto = r.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
      const chamado = texto.includes('[ABRIR_CHAMADO]');
      texto = texto.replace('[ABRIR_CHAMADO]', '').trim();
      return { texto, sugereChamado: chamado };
    } catch (e) {
      this.log.warn(`Sugestão do suporte: ${e instanceof Error ? e.message : e}`);
      throw new ServiceUnavailableException('O assistente não respondeu agora. Abra um chamado que a equipe responde.');
    }
  }

  /* ============================================================ erros do sistema */

  /** guarda um erro (agrupado: o mesmo erro vira uma linha com a contagem); devolve a solução, se já houver */
  async registrarErro(e: { origem: 'site' | 'servidor'; mensagem: string; detalhe?: string | null; tela?: string | null; empresaId?: string | null; usuario?: string | null }) {
    const msg = e.mensagem.replace(/\s+/g, ' ').trim().slice(0, 500);
    const tela = (e.tela ?? '').replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ':id').replace(/\?.*$/, '').slice(0, 200) || null;
    const assinatura = sha(`${e.origem}|${msg.replace(/\d+/g, '#')}|${tela ?? ''}`);
    const [r] = await this.ds.query(
      `INSERT INTO erros_sistema (assinatura, origem, mensagem, detalhe, tela, empresas, ultima_empresa_id, ultimo_usuario)
       VALUES ($1,$2,$3,$4,$5, CASE WHEN $6::uuid IS NULL THEN '{}'::uuid[] ELSE ARRAY[$6::uuid] END, $6::uuid, $7)
       ON CONFLICT (assinatura) DO UPDATE SET vezes = erros_sistema.vezes + 1, ultimo_em = now(), detalhe = COALESCE(EXCLUDED.detalhe, erros_sistema.detalhe),
         ultima_empresa_id = EXCLUDED.ultima_empresa_id, ultimo_usuario = EXCLUDED.ultimo_usuario,
         empresas = CASE WHEN EXCLUDED.ultima_empresa_id IS NULL OR EXCLUDED.ultima_empresa_id = ANY(erros_sistema.empresas) THEN erros_sistema.empresas
                         ELSE array_append(erros_sistema.empresas, EXCLUDED.ultima_empresa_id) END
       RETURNING resolvido, solucao`,
      [assinatura, e.origem, msg, e.detalhe?.slice(0, 4000) ?? null, tela, e.empresaId ?? null, e.usuario?.slice(0, 120) ?? null]);
    return { solucao: r?.resolvido && r?.solucao ? r.solucao : null };
  }

  /* ============================================================ traduções (idiomas) */

  async traduzir(u: UsuarioToken, dto: { idioma: string; textos: string[] }) {
    if (!IDIOMAS[dto.idioma] || dto.idioma === 'pt-BR') throw new BadRequestException('Idioma inválido.');
    const textos = [...new Set(dto.textos.map((t) => t.trim()).filter((t) => t && t.length <= 300))].slice(0, 80);
    const mapa: Record<string, string> = {};
    if (!textos.length) return mapa;
    const hashes = textos.map((t) => sha(t));
    const prontos: { hash: string; traducao: string }[] = await this.ds.query(`SELECT hash, traducao FROM traducoes WHERE idioma = $1 AND hash = ANY($2::varchar[])`, [dto.idioma, hashes]);
    const porHash = new Map(prontos.map((p) => [p.hash, p.traducao]));
    const faltam = textos.filter((t) => !porHash.has(sha(t)));
    for (const t of textos) if (porHash.has(sha(t))) mapa[t] = porHash.get(sha(t))!;
    if (!faltam.length) return mapa;
    const chave = process.env.ANTHROPIC_API_KEY;
    if (!chave) return mapa;
    const [hoje] = await this.ds.query(`SELECT count(*)::int AS n FROM traducoes WHERE empresa_id = $1 AND criado_em > now() - interval '1 day'`, [u.empresaId]);
    if (Number(hoje?.n) > 4000) return mapa;
    try {
      const ia = new Anthropic({ apiKey: chave, ...(process.env.ANTHROPIC_BASE_URL ? { baseURL: process.env.ANTHROPIC_BASE_URL } : {}) });
      const r = await ia.messages.create({
        model: 'claude-haiku-5-5', max_tokens: 8000,
        system: `You translate user-interface strings of a hotel/motel management system from Brazilian Portuguese to ${IDIOMAS[dto.idioma]} (${dto.idioma}).
Keep it short like a software UI. Keep numbers, currency values, dates, codes, emojis and symbols. Do not translate personal names, product brand names or room codes.
Answer ONLY with a JSON array of strings, same order and same length as the input array.`,
        messages: [{ role: 'user', content: JSON.stringify(faltam) }],
      });
      const bruto = r.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
      const json = JSON.parse(bruto.slice(bruto.indexOf('['), bruto.lastIndexOf(']') + 1)) as unknown[];
      if (!Array.isArray(json) || json.length !== faltam.length) return mapa;
      for (let i = 0; i < faltam.length; i++) {
        const tr = String(json[i] ?? '').slice(0, 600);
        if (!tr) continue;
        mapa[faltam[i]] = tr;
        await this.ds.query(`INSERT INTO traducoes (hash, idioma, texto, traducao, empresa_id) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [sha(faltam[i]), dto.idioma, faltam[i], tr, u.empresaId]);
      }
    } catch (e) {
      this.log.warn(`Tradução: ${e instanceof Error ? e.message : e}`);
    }
    return mapa;
  }

  async idioma(u: UsuarioToken, idioma: string) {
    if (!IDIOMAS[idioma]) throw new BadRequestException('Idioma inválido.');
    if (!temPermissao(u, 'empresa.editar')) throw new ForbiddenException('Só o administrador troca o idioma padrão da empresa.');
    await this.ds.query(`UPDATE empresas SET idioma = $2 WHERE id = $1`, [u.empresaId, idioma]);
    return { ok: true };
  }

  /* ============================================================ downloads */

  private pasta() {
    const p = (process.env.VB_FOTOS_DIR || '').trim();
    if (!p) throw new BadRequestException('A pasta de arquivos não está configurada neste servidor (VB_FOTOS_DIR).');
    return p;
  }
  private caminho(rel: string) {
    const base = normalize(this.pasta());
    const abs = normalize(join(base, rel));
    if (!abs.startsWith(base.endsWith(sep) ? base : base + sep)) throw new NotFoundException('Arquivo não encontrado.');
    return abs;
  }

  private async listaDownloads(soPublicos: boolean) {
    const l = await this.ds.query(`SELECT * FROM downloads WHERE ativo ${soPublicos ? 'AND publico' : ''} ORDER BY categoria, ordem, nome`);
    return l.map((d: Record<string, unknown>) => ({
      id: d.id, categoria: d.categoria, categoriaNome: CATEGORIAS_DOWNLOAD[String(d.categoria)] ?? d.categoria, nome: d.nome, descricao: d.descricao,
      url: d.url, temArquivo: !!d.arquivo, arquivoNome: d.arquivo_nome, tamanho: d.tamanho === null ? null : Number(d.tamanho), versao: d.versao, publico: d.publico, ativo: d.ativo, ordem: d.ordem,
    }));
  }

  async arquivoDownload(id: string, soPublico: boolean) {
    const [d] = await this.ds.query(`SELECT arquivo, arquivo_nome, publico, ativo FROM downloads WHERE id = $1`, [id]);
    if (!d?.arquivo || !d.ativo || (soPublico && !d.publico)) throw new NotFoundException('Arquivo não encontrado.');
    const abs = this.caminho(d.arquivo);
    await fs.access(abs).catch(() => { throw new NotFoundException('O arquivo não está mais no servidor.'); });
    return { abs, nome: String(d.arquivo_nome || 'arquivo') };
  }

  /* ============================================================ painel da plataforma (Virtual Barra) */

  async exigirPlataforma(u: UsuarioToken) {
    const [e] = await this.ds.query(`SELECT plataforma FROM empresas WHERE id = $1`, [u.empresaId]);
    if (!e?.plataforma || !temPermissao(u, 'empresa.editar')) throw new ForbiddenException('Só a Virtual Barra acessa o painel da revenda.');
  }

  async clientes(u: UsuarioToken) {
    await this.exigirPlataforma(u);
    const l = await this.ds.query(
      `SELECT e.id, e.nome, e.cnpj, e.situacao, e.teste_ate, e.plano_id, p.nome AS plano, COALESCE(e.mensalidade_valor, p.preco) AS valor, e.mensalidade_valor,
              e.dia_vencimento, e.responsavel, e.origem, e.criado_em, e.ativo, e.plataforma, e.modulos, e.observacao_revenda, e.idioma,
              (SELECT count(*)::int FROM unidades x WHERE x.empresa_id = e.id) AS unidades,
              (SELECT count(*)::int FROM usuarios x WHERE x.empresa_id = e.id) AS usuarios,
              (SELECT max(ultimo_acesso) FROM usuarios x WHERE x.empresa_id = e.id) AS ultimo_acesso,
              (SELECT count(*)::int FROM mensalidades m WHERE m.empresa_id = e.id AND m.situacao = 'pendente') AS em_aberto,
              (SELECT min(vencimento) FROM mensalidades m WHERE m.empresa_id = e.id AND m.situacao = 'pendente') AS venc_aberto,
              (SELECT count(*)::int FROM suporte_chamados c WHERE c.empresa_id = e.id AND c.situacao <> 'fechado') AS chamados,
              e.parceiro_id, pa.nome AS parceiro, p.segmento
         FROM empresas e LEFT JOIN planos p ON p.id = e.plano_id LEFT JOIN parceiros pa ON pa.id = e.parceiro_id ORDER BY e.plataforma DESC, e.criado_em DESC`);
    const hoje = hojeSP();
    const lista = l.map((e: Record<string, unknown>) => ({
      id: e.id, nome: e.nome, cnpj: e.cnpj, situacao: e.plataforma ? 'plataforma' : e.situacao, testeAte: e.teste_ate ? dia(e.teste_ate) : null,
      diasTeste: e.teste_ate ? diasEntre(hoje, dia(e.teste_ate)) : null, planoId: e.plano_id, plano: e.plano, valor: e.valor === null ? null : Number(e.valor),
      valorProprio: e.mensalidade_valor === null ? null : Number(e.mensalidade_valor), diaVencimento: e.dia_vencimento, responsavel: e.responsavel ?? {},
      origem: e.origem, criadoEm: e.criado_em, ativo: e.ativo, plataforma: e.plataforma, modulos: e.modulos ?? {}, observacao: e.observacao_revenda, idioma: e.idioma,
      unidades: e.unidades, usuarios: e.usuarios, ultimoAcesso: e.ultimo_acesso, emAberto: e.em_aberto, vencAberto: e.venc_aberto ? dia(e.venc_aberto) : null, chamados: e.chamados,
      parceiroId: e.parceiro_id, parceiro: e.parceiro, segmento: e.segmento,
    }));
    const pagantes = lista.filter((c: { situacao: unknown; planoId: unknown }) => ['ativa', 'atrasada'].includes(String(c.situacao)) && c.planoId);
    return {
      clientes: lista, modulos: MODULOS,
      resumo: {
        total: lista.filter((c: { plataforma: unknown }) => !c.plataforma).length,
        teste: lista.filter((c: { situacao: unknown }) => c.situacao === 'teste').length,
        ativos: pagantes.length,
        atrasados: lista.filter((c: { situacao: unknown }) => c.situacao === 'atrasada').length,
        bloqueados: lista.filter((c: { situacao: unknown }) => SITUACOES_BLOQUEIO.includes(c.situacao as Situacao)).length,
        mrr: Math.round(pagantes.reduce((s: number, c: { valor: number | null }) => s + (c.valor ?? 0), 0) * 100) / 100,
      },
    };
  }

  async atualizarCliente(u: UsuarioToken, id: string, dto: { planoId?: string | null; situacao?: Situacao; testeAte?: string | null; diaVencimento?: number; valor?: number | null; observacao?: string | null; modulos?: Record<string, boolean>; aplicarModulosDoPlano?: boolean; parceiroId?: string | null }) {
    await this.exigirPlataforma(u);
    const [e] = await this.ds.query(`SELECT plataforma FROM empresas WHERE id = $1`, [id]);
    if (!e) throw new NotFoundException('Cliente não encontrado.');
    const sets: string[] = []; const p: unknown[] = [id];
    const set = (col: string, v: unknown, cast = '') => { p.push(v); sets.push(`${col} = $${p.length}${cast}`); };
    if (dto.planoId !== undefined) {
      set('plano_id', dto.planoId, '::uuid');
      if (dto.planoId && dto.aplicarModulosDoPlano) {
        const [pl] = await this.ds.query(`SELECT modulos FROM planos WHERE id = $1`, [dto.planoId]);
        if (pl) set('modulos', JSON.stringify(pl.modulos ?? {}), '::jsonb');
      }
    }
    if (dto.situacao !== undefined && !e.plataforma) set('situacao', dto.situacao);
    if (dto.testeAte !== undefined) set('teste_ate', dto.testeAte, '::date');
    if (dto.diaVencimento !== undefined) set('dia_vencimento', Math.min(28, Math.max(1, dto.diaVencimento)));
    if (dto.valor !== undefined) set('mensalidade_valor', dto.valor === null ? null : dto.valor.toFixed(2), '::numeric');
    if (dto.observacao !== undefined) set('observacao_revenda', dto.observacao);
    if (dto.parceiroId !== undefined) set('parceiro_id', dto.parceiroId, '::uuid');
    if (dto.modulos) {
      const m: Record<string, boolean> = {};
      for (const k of Object.keys(MODULOS)) m[k] = !!dto.modulos[k];
      set('modulos', JSON.stringify(m), '::jsonb');
    }
    if (sets.length) await this.ds.query(`UPDATE empresas SET ${sets.join(', ')} WHERE id = $1`, p);
    this.esquecer(id);
    return this.clientes(u);
  }

  /** cliente novo criado pela Virtual Barra (implantação ou demonstração) */
  async criarCliente(u: UsuarioToken, dto: { empresa: string; nome: string; login: string; senha: string; telefone?: string; email?: string; exemplos: boolean; demonstracao: boolean; planoId?: string; testeDias?: number }) {
    await this.exigirPlataforma(u);
    const [ja] = await this.ds.query(`SELECT 1 FROM usuarios WHERE lower(login) = lower($1)`, [dto.login.trim()]);
    if (ja) throw new BadRequestException('Este login já existe. Escolha outro.');
    let modulos: Record<string, boolean> = Object.fromEntries(Object.keys(MODULOS).map((k) => [k, true]));
    if (dto.planoId) {
      const [pl] = await this.ds.query(`SELECT modulos FROM planos WHERE id = $1`, [dto.planoId]);
      if (!pl) throw new NotFoundException('Plano não encontrado.');
      modulos = pl.modulos ?? {};
    }
    const { empresaId } = await this.ds.transaction((m) => criarEmpresa(m, {
      nome: dto.empresa.trim(), adminNome: dto.nome.trim(), login: dto.login.trim(), senha: dto.senha, exemplos: dto.exemplos, precosExemplo: dto.exemplos, extra: { modulos },
    }));
    const situacao = dto.demonstracao ? 'demo' : dto.planoId ? 'ativa' : 'teste';
    const teste = situacao === 'teste' ? somaDias(hojeSP(), dto.testeDias ?? (await this.cfg()).teste_dias) : null;
    await this.ds.query(`UPDATE empresas SET situacao = $2, teste_ate = $3, plano_id = $4, origem = 'revenda', responsavel = $5::jsonb WHERE id = $1`,
      [empresaId, situacao, teste, dto.planoId ?? null, JSON.stringify({ nome: dto.nome.trim(), email: dto.email?.trim().toLowerCase() || null, telefone: soDigitos(dto.telefone) || null })]);
    return this.clientes(u);
  }

  async implantacaoCliente(u: UsuarioToken, id: string) {
    await this.exigirPlataforma(u);
    return this.implantacao(id);
  }

  async marcarImplantacao(u: UsuarioToken, id: string, dto: { passo: string; feito?: boolean; obs?: string | null }) {
    await this.exigirPlataforma(u);
    const valido = PASSOS_MANUAIS.some(([p]) => p === dto.passo) || PASSOS_AUTO.some(([p]) => p === dto.passo);
    if (!valido) throw new BadRequestException('Passo inválido.');
    const [e] = await this.ds.query(`SELECT implantacao FROM empresas WHERE id = $1`, [id]);
    if (!e) throw new NotFoundException('Cliente não encontrado.');
    const marcas = { ...(e.implantacao ?? {}) };
    marcas[dto.passo] = { ...(marcas[dto.passo] ?? {}), ...(dto.feito !== undefined ? { feito: dto.feito, em: new Date().toISOString(), por: u.nome } : {}), ...(dto.obs !== undefined ? { obs: dto.obs } : {}) };
    await this.ds.query(`UPDATE empresas SET implantacao = $2::jsonb WHERE id = $1`, [id, JSON.stringify(marcas)]);
    return this.implantacao(id);
  }

  // ---- planos
  async planos(u: UsuarioToken) {
    await this.exigirPlataforma(u);
    const l = await this.ds.query(`SELECT p.*, (SELECT count(*)::int FROM empresas e WHERE e.plano_id = p.id) AS clientes FROM planos p ORDER BY segmento, ordem, preco`);
    return { planos: l.map((p: Record<string, unknown>) => ({ ...p, preco: Number(p.preco) })), modulos: MODULOS, segmentos: SEGMENTOS, portes: PORTES };
  }
  async salvarPlano(u: UsuarioToken, id: string | null, dto: { nome: string; descricao?: string | null; preco: number; modulos: Record<string, boolean>; limiteUnidades?: number | null; itens: string[]; destaque: boolean; ativo: boolean; ordem?: number; segmento?: string; porte?: string; sobConsulta?: boolean; publico?: string | null }) {
    await this.exigirPlataforma(u);
    const m: Record<string, boolean> = {};
    for (const k of Object.keys(MODULOS)) if (dto.modulos?.[k]) m[k] = true;
    const v = [dto.nome.trim(), dto.descricao?.trim() || null, dto.preco.toFixed(2), JSON.stringify(m), dto.limiteUnidades ?? null, JSON.stringify(dto.itens.map((i) => i.trim()).filter(Boolean)), dto.destaque, dto.ativo, dto.ordem ?? 0,
      SEGMENTOS[dto.segmento ?? ''] ? dto.segmento : 'hospedagem', PORTES[dto.porte ?? ''] ? dto.porte : 'pequeno', !!dto.sobConsulta, dto.publico?.trim() || null];
    if (id) {
      const [linhas] = await this.ds.query(`UPDATE planos SET nome=$2, descricao=$3, preco=$4, modulos=$5::jsonb, limite_unidades=$6, itens=$7::jsonb, destaque=$8, ativo=$9, ordem=$10, segmento=$11, porte=$12, sob_consulta=$13, publico=$14 WHERE id = $1 RETURNING id`, [id, ...v]);
      if (!linhas?.length) throw new NotFoundException('Plano não encontrado.');
    } else {
      await this.ds.query(`INSERT INTO planos (nome, descricao, preco, modulos, limite_unidades, itens, destaque, ativo, ordem, segmento, porte, sob_consulta, publico) VALUES ($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13)`, v);
    }
    return this.planos(u);
  }

  // ---- mensalidades
  async mensalidades(u: UsuarioToken, mes?: string) {
    await this.exigirPlataforma(u);
    const competencia = mes && /^\d{4}-\d{2}$/.test(mes) ? mes : null;
    const l = await this.ds.query(
      `SELECT m.*, e.nome AS empresa FROM mensalidades m JOIN empresas e ON e.id = m.empresa_id
        WHERE ($1::varchar IS NULL OR m.competencia = $1::varchar) ORDER BY m.vencimento DESC, e.nome LIMIT 500`, [competencia]);
    const lista = l.map((m: Record<string, unknown>) => ({ id: m.id, empresaId: m.empresa_id, empresa: m.empresa, competencia: m.competencia, descricao: m.descricao, valor: Number(m.valor), vencimento: dia(m.vencimento), situacao: m.situacao, link: m.link, pagoEm: m.pago_em, forma: m.forma_pagamento, observacao: m.observacao }));
    const soma = (s: string) => Math.round(lista.filter((m: { situacao: unknown }) => m.situacao === s).reduce((a: number, m: { valor: number }) => a + m.valor, 0) * 100) / 100;
    return { mensalidades: lista, totais: { pendente: soma('pendente'), paga: soma('paga') } };
  }
  async gerarMensalidadeManual(u: UsuarioToken, dto: { empresaId: string; competencia: string; vencimento: string; valor: number; descricao?: string }) {
    await this.exigirPlataforma(u);
    const id = await this.criarMensalidade(dto.empresaId, dto.competencia, dto.vencimento, dto.valor, dto.descricao?.trim() || 'Mensalidade');
    if (!id) throw new BadRequestException('Já existe mensalidade deste cliente neste mês.');
    return this.mensalidades(u, dto.competencia);
  }
  async baixarMensalidade(u: UsuarioToken, id: string, dto: { acao: 'pagar' | 'cancelar' | 'reabrir'; forma?: string; observacao?: string }) {
    await this.exigirPlataforma(u);
    const [m] = await this.ds.query(`SELECT empresa_id, situacao FROM mensalidades WHERE id = $1`, [id]);
    if (!m) throw new NotFoundException('Mensalidade não encontrada.');
    if (dto.acao === 'pagar') await this.ds.query(`UPDATE mensalidades SET situacao = 'paga', pago_em = now(), forma_pagamento = $2, observacao = $3 WHERE id = $1`, [id, dto.forma ?? 'manual', dto.observacao ?? `Baixa por ${u.nome}`]);
    else if (dto.acao === 'cancelar') await this.ds.query(`UPDATE mensalidades SET situacao = 'cancelada', observacao = $2 WHERE id = $1`, [id, dto.observacao ?? `Cancelada por ${u.nome}`]);
    else await this.ds.query(`UPDATE mensalidades SET situacao = 'pendente', pago_em = NULL WHERE id = $1`, [id]);
    await this.atualizarSituacao(m.empresa_id);
    return { ok: true };
  }

  // ---- suporte (lado da Virtual Barra)
  async chamadosPlataforma(u: UsuarioToken, situacao?: string) {
    await this.exigirPlataforma(u);
    return this.ds.query(
      `SELECT c.id, c.numero, c.assunto, c.categoria, c.situacao, c.criado_por, c.criado_em, c.atualizado_em, NOT c.lido_suporte AS novo, e.nome AS empresa, e.id AS empresa_id
         FROM suporte_chamados c JOIN empresas e ON e.id = c.empresa_id
        WHERE ($1::varchar IS NULL OR ($1::varchar = 'abertos' AND c.situacao <> 'fechado') OR c.situacao = $1::varchar)
        ORDER BY (c.situacao = 'fechado'), c.atualizado_em DESC LIMIT 300`, [situacao || null]);
  }
  async verChamadoPlataforma(u: UsuarioToken, id: string) {
    await this.exigirPlataforma(u);
    const c = await this.chamado(id, null);
    await this.ds.query(`UPDATE suporte_chamados SET lido_suporte = true WHERE id = $1`, [id]);
    return c;
  }
  async responderSuporte(u: UsuarioToken, id: string, dto: { texto?: string; situacao?: string }) {
    await this.exigirPlataforma(u);
    await this.chamado(id, null);
    if (dto.texto?.trim()) {
      await this.ds.query(`INSERT INTO suporte_mensagens (chamado_id, autor, nome, texto) VALUES ($1,'suporte',$2,$3)`, [id, u.nome, dto.texto.trim()]);
      await this.ds.query(`UPDATE suporte_chamados SET situacao = $2, lido_cliente = false, lido_suporte = true, atualizado_em = now() WHERE id = $1`, [id, dto.situacao ?? 'respondido']);
    } else if (dto.situacao) {
      await this.ds.query(`UPDATE suporte_chamados SET situacao = $2, atualizado_em = now() WHERE id = $1`, [id, dto.situacao]);
    }
    return this.verChamadoPlataforma(u, id);
  }

  // ---- erros
  async erros(u: UsuarioToken, todos: boolean) {
    await this.exigirPlataforma(u);
    const l = await this.ds.query(
      `SELECT x.*, array_length(x.empresas, 1) AS n_empresas, e.nome AS ultima_empresa FROM erros_sistema x LEFT JOIN empresas e ON e.id = x.ultima_empresa_id
        WHERE $1::boolean OR NOT x.resolvido ORDER BY x.resolvido, x.ultimo_em DESC LIMIT 300`, [todos]);
    return l.map((x: Record<string, unknown>) => ({ id: x.id, origem: x.origem, mensagem: x.mensagem, detalhe: x.detalhe, tela: x.tela, vezes: x.vezes, empresas: Number(x.n_empresas ?? 0), ultimaEmpresa: x.ultima_empresa, ultimoUsuario: x.ultimo_usuario, primeiroEm: x.primeiro_em, ultimoEm: x.ultimo_em, resolvido: x.resolvido, solucao: x.solucao }));
  }
  async resolverErro(u: UsuarioToken, id: string, dto: { resolvido: boolean; solucao?: string | null }) {
    await this.exigirPlataforma(u);
    await this.ds.query(`UPDATE erros_sistema SET resolvido = $2, solucao = $3 WHERE id = $1`, [id, dto.resolvido, dto.solucao?.trim() || null]);
    return this.erros(u, true);
  }

  // ---- downloads
  async downloadsPlataforma(u: UsuarioToken) {
    await this.exigirPlataforma(u);
    return { downloads: await this.listaTodos(), categorias: CATEGORIAS_DOWNLOAD };
  }
  private async listaTodos() {
    const l = await this.ds.query(`SELECT * FROM downloads ORDER BY categoria, ordem, nome`);
    return l.map((d: Record<string, unknown>) => ({ id: d.id, categoria: d.categoria, nome: d.nome, descricao: d.descricao, url: d.url, temArquivo: !!d.arquivo, arquivoNome: d.arquivo_nome, tamanho: d.tamanho === null ? null : Number(d.tamanho), versao: d.versao, publico: d.publico, ativo: d.ativo, ordem: d.ordem }));
  }
  async salvarDownload(u: UsuarioToken, id: string | null, dto: { categoria: string; nome: string; descricao?: string | null; url?: string | null; versao?: string | null; publico: boolean; ativo: boolean; ordem?: number }) {
    await this.exigirPlataforma(u);
    if (!CATEGORIAS_DOWNLOAD[dto.categoria]) throw new BadRequestException('Categoria inválida.');
    if (dto.url && !/^(https?:\/\/|\/)/.test(dto.url)) throw new BadRequestException('O link precisa começar com https://');
    const v = [dto.categoria, dto.nome.trim(), dto.descricao?.trim() || null, dto.url?.trim() || null, dto.versao?.trim() || null, dto.publico, dto.ativo, dto.ordem ?? 0];
    if (id) await this.ds.query(`UPDATE downloads SET categoria=$2, nome=$3, descricao=$4, url=$5, versao=$6, publico=$7, ativo=$8, ordem=$9 WHERE id = $1`, [id, ...v]);
    else await this.ds.query(`INSERT INTO downloads (categoria, nome, descricao, url, versao, publico, ativo, ordem) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, v);
    return this.downloadsPlataforma(u);
  }
  async enviarArquivo(u: UsuarioToken, id: string, nome: string, corpo: Buffer) {
    await this.exigirPlataforma(u);
    if (!Buffer.isBuffer(corpo) || !corpo.length) throw new BadRequestException('Arquivo vazio.');
    const [d] = await this.ds.query(`SELECT arquivo FROM downloads WHERE id = $1`, [id]);
    if (!d) throw new NotFoundException('Download não encontrado.');
    const seguro = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_').slice(-120) || 'arquivo';
    const rel = join('downloads', `${id}-${seguro}`);
    await fs.mkdir(dirname(this.caminho(rel)), { recursive: true });
    await fs.writeFile(this.caminho(rel), corpo);
    if (d.arquivo && d.arquivo !== rel) await fs.unlink(this.caminho(d.arquivo)).catch(() => undefined);
    await this.ds.query(`UPDATE downloads SET arquivo = $2, arquivo_nome = $3, tamanho = $4 WHERE id = $1`, [id, rel, seguro, corpo.length]);
    return this.downloadsPlataforma(u);
  }

  // ---- configuração
  async config(u: UsuarioToken) {
    await this.exigirPlataforma(u);
    const c = await this.cfg();
    const plataforma = await this.plataformaId();
    const [e] = await this.ds.query(`SELECT cobranca->>'ativo' AS ativo FROM empresas WHERE id = $1`, [plataforma]);
    return { ...c, asaasLigado: e?.ativo === 'true' };
  }
  async salvarConfig(u: UsuarioToken, dto: { testeDias: number; diasAviso: number; diasBloqueio: number; whatsapp?: string | null; email?: string | null; textos?: Record<string, string> }) {
    await this.exigirPlataforma(u);
    await this.ds.query(`UPDATE revenda_config SET teste_dias = $1, dias_aviso = $2, dias_bloqueio = $3, whatsapp = $4, email = $5, textos = $6::jsonb WHERE id = 1`,
      [dto.testeDias, dto.diasAviso, dto.diasBloqueio, soDigitos(dto.whatsapp) || null, dto.email?.trim() || null, JSON.stringify(dto.textos ?? {})]);
    return this.config(u);
  }

  /* ============================================================ parceiros (VB Indica, VB Revenda, VB Sua Marca) */

  /** página do parceiro no site (link com ?p=CODIGO): nome e marca, para o "Sua Marca" */
  async parceiroPublico(codigo: string) {
    const [p] = await this.ds.query(`SELECT nome, tipo, marca, desconto_pct FROM parceiros WHERE upper(codigo) = upper($1) AND situacao = 'ativo'`, [codigo.trim().slice(0, 20)]);
    if (!p) throw new NotFoundException('Parceiro não encontrado.');
    return { nome: p.nome, tipo: p.tipo, marca: p.marca ?? {}, desconto: Number(p.desconto_pct) };
  }

  /** "Seja parceiro" no site: entra como pendente para a Virtual Barra aprovar */
  async cadastrarParceiro(dto: { tipo: string; nome: string; responsavel: string; email: string; telefone: string; cidade?: string; documento?: string; mensagem?: string }, ip: string) {
    const agora = Date.now();
    const lista = (this.tentativas.get(`p:${ip}`) ?? []).filter((t) => agora - t < 3_600_000);
    if (lista.length >= 3) throw new BadRequestException('Muitos cadastros em pouco tempo. Tente mais tarde ou fale com a gente pelo WhatsApp.');
    this.tentativas.set(`p:${ip}`, [...lista, agora]);
    if (!TIPOS_PARCEIRO[dto.tipo]) throw new BadRequestException('Escolha o tipo de parceria.');
    const codigo = await this.novoCodigo(dto.nome);
    const comissao = dto.tipo === 'indicacao' ? 20 : dto.tipo === 'revenda' ? 30 : 35;
    await this.ds.query(
      `INSERT INTO parceiros (tipo, nome, responsavel, email, telefone, cidade, documento, mensagem, codigo, comissao_pct) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [dto.tipo, dto.nome.trim(), dto.responsavel.trim(), dto.email.trim().toLowerCase(), soDigitos(dto.telefone), dto.cidade?.trim() || null, soDigitos(dto.documento) || null, dto.mensagem?.trim() || null, codigo, comissao]);
    return { ok: true };
  }

  private async novoCodigo(nome: string) {
    const base = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'VB';
    for (let i = 0; i < 20; i++) {
      const c = i === 0 ? base : `${base.slice(0, 6)}${Math.floor(10 + Math.random() * 89)}`;
      const [ja] = await this.ds.query(`SELECT 1 FROM parceiros WHERE upper(codigo) = $1`, [c]);
      if (!ja) return c;
    }
    return `VB${Date.now().toString(36).toUpperCase()}`;
  }

  /** comissão de cada parceiro no mês: % sobre as mensalidades pagas dos clientes dele */
  async parceiros(u: UsuarioToken, mesQ?: string) {
    await this.exigirPlataforma(u);
    const mes = mesQ && /^\d{4}-\d{2}$/.test(mesQ) ? mesQ : hojeSP().slice(0, 7);
    const l = await this.ds.query(
      `SELECT p.*,
              (SELECT count(*)::int FROM empresas e WHERE e.parceiro_id = p.id) AS clientes,
              (SELECT count(*)::int FROM empresas e WHERE e.parceiro_id = p.id AND e.situacao IN ('ativa','atrasada')) AS pagantes,
              (SELECT COALESCE(sum(m.valor), 0) FROM mensalidades m JOIN empresas e ON e.id = m.empresa_id
                WHERE e.parceiro_id = p.id AND m.situacao = 'paga' AND to_char(m.pago_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') = $1) AS recebido_mes,
              (SELECT r.valor FROM parceiro_repasses r WHERE r.parceiro_id = p.id AND r.competencia = $1) AS repassado
         FROM parceiros p ORDER BY (p.situacao = 'pendente') DESC, p.nome`, [mes]);
    const lista = l.map((p: Record<string, unknown>) => {
      const recebido = Number(p.recebido_mes ?? 0);
      return {
        id: p.id, tipo: p.tipo, tipoNome: TIPOS_PARCEIRO[String(p.tipo)]?.nome ?? p.tipo, nome: p.nome, responsavel: p.responsavel, documento: p.documento, email: p.email,
        telefone: p.telefone, cidade: p.cidade, codigo: p.codigo, comissao: Number(p.comissao_pct), desconto: Number(p.desconto_pct), situacao: p.situacao,
        marca: p.marca ?? {}, pix: p.pix, observacao: p.observacao, mensagem: p.mensagem, criadoEm: p.criado_em,
        clientes: p.clientes, pagantes: p.pagantes, recebidoMes: recebido, comissaoMes: Math.round(recebido * Number(p.comissao_pct)) / 100,
        repassado: p.repassado === null ? null : Number(p.repassado),
      };
    });
    return { mes, parceiros: lista, tipos: TIPOS_PARCEIRO };
  }

  async salvarParceiro(u: UsuarioToken, id: string | null, dto: { tipo: string; nome: string; responsavel?: string | null; documento?: string | null; email?: string | null; telefone?: string | null; cidade?: string | null; codigo?: string | null; comissao: number; desconto: number; situacao: string; marca?: Record<string, string>; pix?: string | null; observacao?: string | null }) {
    await this.exigirPlataforma(u);
    if (!TIPOS_PARCEIRO[dto.tipo]) throw new BadRequestException('Tipo de parceria inválido.');
    let codigo = (dto.codigo ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
    if (!codigo) codigo = await this.novoCodigo(dto.nome);
    const [dono] = await this.ds.query(`SELECT id FROM parceiros WHERE upper(codigo) = $1`, [codigo]);
    if (dono && dono.id !== id) throw new BadRequestException(`O código ${codigo} já é de outro parceiro.`);
    const marca = { nome: dto.marca?.nome?.trim() || '', cor: /^#[0-9a-f]{6}$/i.test(dto.marca?.cor ?? '') ? dto.marca!.cor : '', logo: /^https:\/\//.test(dto.marca?.logo ?? '') ? dto.marca!.logo : '' };
    const v = [dto.tipo, dto.nome.trim(), dto.responsavel?.trim() || null, soDigitos(dto.documento) || null, dto.email?.trim().toLowerCase() || null, soDigitos(dto.telefone) || null,
      dto.cidade?.trim() || null, codigo, Math.min(100, Math.max(0, dto.comissao)).toFixed(2), Math.min(100, Math.max(0, dto.desconto)).toFixed(2),
      ['pendente', 'ativo', 'inativo'].includes(dto.situacao) ? dto.situacao : 'pendente', JSON.stringify(marca), dto.pix?.trim() || null, dto.observacao?.trim() || null];
    if (id) {
      const [linhas] = await this.ds.query(
        `UPDATE parceiros SET tipo=$2, nome=$3, responsavel=$4, documento=$5, email=$6, telefone=$7, cidade=$8, codigo=$9, comissao_pct=$10, desconto_pct=$11, situacao=$12, marca=$13::jsonb, pix=$14, observacao=$15
          WHERE id = $1 RETURNING id`, [id, ...v]);
      if (!linhas?.length) throw new NotFoundException('Parceiro não encontrado.');
    } else {
      await this.ds.query(
        `INSERT INTO parceiros (tipo, nome, responsavel, documento, email, telefone, cidade, codigo, comissao_pct, desconto_pct, situacao, marca, pix, observacao)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14)`, v);
    }
    return this.parceiros(u);
  }

  /** extrato do parceiro no mês: clientes, mensalidades pagas e a comissão de cada uma */
  async extratoParceiro(u: UsuarioToken, id: string, mesQ?: string) {
    await this.exigirPlataforma(u);
    const mes = mesQ && /^\d{4}-\d{2}$/.test(mesQ) ? mesQ : hojeSP().slice(0, 7);
    const [p] = await this.ds.query(`SELECT nome, comissao_pct FROM parceiros WHERE id = $1`, [id]);
    if (!p) throw new NotFoundException('Parceiro não encontrado.');
    const clientes = await this.ds.query(
      `SELECT e.id, e.nome, e.situacao, pl.nome AS plano, e.criado_em FROM empresas e LEFT JOIN planos pl ON pl.id = e.plano_id WHERE e.parceiro_id = $1 ORDER BY e.nome`, [id]);
    const pagas = await this.ds.query(
      `SELECT e.nome AS empresa, m.competencia, m.valor, m.pago_em FROM mensalidades m JOIN empresas e ON e.id = m.empresa_id
        WHERE e.parceiro_id = $1 AND m.situacao = 'paga' AND to_char(m.pago_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') = $2 ORDER BY m.pago_em`, [id, mes]);
    const pct = Number(p.comissao_pct);
    const linhas = pagas.map((m: Record<string, unknown>) => ({ empresa: m.empresa, competencia: m.competencia, valor: Number(m.valor), pagoEm: m.pago_em, comissao: Math.round(Number(m.valor) * pct) / 100 }));
    const [rep] = await this.ds.query(`SELECT valor, pago_em, pago_por FROM parceiro_repasses WHERE parceiro_id = $1 AND competencia = $2`, [id, mes]);
    return {
      mes, parceiro: p.nome, comissaoPct: pct, clientes, pagas: linhas,
      total: Math.round(linhas.reduce((s: number, x: { comissao: number }) => s + x.comissao * 100, 0)) / 100,
      repasse: rep ? { valor: Number(rep.valor), pagoEm: rep.pago_em, pagoPor: rep.pago_por } : null,
    };
  }

  async registrarRepasse(u: UsuarioToken, id: string, dto: { competencia: string; valor: number; observacao?: string }) {
    await this.exigirPlataforma(u);
    await this.ds.query(
      `INSERT INTO parceiro_repasses (parceiro_id, competencia, valor, pago_por, observacao) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (parceiro_id, competencia) DO UPDATE SET valor = EXCLUDED.valor, pago_em = now(), pago_por = EXCLUDED.pago_por, observacao = EXCLUDED.observacao`,
      [id, dto.competencia, dto.valor.toFixed(2), u.nome, dto.observacao?.trim() || null]);
    return this.extratoParceiro(u, id, dto.competencia);
  }

  /* ============================================================ rotina */

  /** situação pela mensalidade mais antiga em aberto (ou pelo fim do teste) */
  async atualizarSituacao(empresaId: string, cfgIn?: Cfg) {
    const cfg = cfgIn ?? await this.cfg();
    const [e] = await this.ds.query(`SELECT situacao, teste_ate, plano_id, plataforma FROM empresas WHERE id = $1`, [empresaId]);
    if (!e || e.plataforma || ['demo', 'suspensa', 'cancelada'].includes(e.situacao)) return;
    const hoje = hojeSP();
    let nova: Situacao = e.situacao;
    if (e.situacao === 'teste' || (e.situacao === 'bloqueada' && !e.plano_id)) {
      nova = e.teste_ate && dia(e.teste_ate) < hoje ? 'bloqueada' : 'teste';
    }
    if (e.plano_id && !(e.situacao === 'teste' && e.teste_ate && dia(e.teste_ate) >= hoje)) {
      const [m] = await this.ds.query(`SELECT min(vencimento) AS v FROM mensalidades WHERE empresa_id = $1 AND situacao = 'pendente'`, [empresaId]);
      const atraso = m?.v ? diasEntre(dia(m.v), hoje) : 0;
      nova = atraso > cfg.dias_bloqueio ? 'bloqueada' : atraso > cfg.dias_aviso ? 'atrasada' : 'ativa';
    }
    if (nova !== e.situacao) {
      await this.ds.query(`UPDATE empresas SET situacao = $2 WHERE id = $1`, [empresaId, nova]);
      this.esquecer(empresaId);
      this.log.log(`Empresa ${empresaId}: ${e.situacao} → ${nova}`);
    }
  }

  async rotina() {
    const cfg = await this.cfg();
    const hoje = hojeSP();
    const clientes: { id: string; dia_vencimento: number; valor: string | null; plano: string | null; situacao: string; teste_ate: unknown }[] = await this.ds.query(
      `SELECT e.id, e.dia_vencimento, COALESCE(e.mensalidade_valor, p.preco) AS valor, p.nome AS plano, e.situacao, e.teste_ate
         FROM empresas e LEFT JOIN planos p ON p.id = e.plano_id WHERE NOT e.plataforma AND e.situacao NOT IN ('demo','suspensa','cancelada')`);
    for (const c of clientes) {
      // próxima mensalidade: gerada 10 dias antes do vencimento (depois do fim do teste)
      if (c.plano && c.valor !== null && Number(c.valor) > 0) {
        const [ano, mes] = hoje.split('-').map(Number);
        for (const delta of [0, 1]) {
          const d = new Date(Date.UTC(ano, mes - 1 + delta, Math.min(28, c.dia_vencimento || 10), 12));
          const venc = d.toISOString().slice(0, 10);
          const fimTeste = c.teste_ate ? dia(c.teste_ate) : null;
          if (fimTeste && venc <= fimTeste) continue;
          if (diasEntre(hoje, venc) > 10 || venc < hoje) continue;
          await this.criarMensalidade(c.id, venc.slice(0, 7), venc, Number(c.valor), `Plano ${c.plano}`).catch(() => undefined);
        }
      }
      await this.atualizarSituacao(c.id, cfg).catch(() => undefined);
    }
  }
}
