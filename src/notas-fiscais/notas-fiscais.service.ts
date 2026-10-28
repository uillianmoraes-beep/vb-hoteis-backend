import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { cifrar, decifrar } from '../common/cripto';
import { DadosFiscais, tributacaoEfetiva } from '../common/fiscal';
import { moduloAtivo } from '../common/modulos';
import { UsuarioToken } from '../common/permissoes';
import { conferirItem } from '../fiscal/conferencia';
import { liberarPermissao } from '../common/liberacao';
import { AmbienteFocus, CaminhoFocus, ErroFocus, Focus, RespostaFocus, mensagemFocus } from './focus';
import { Spedy, assinarArquivo } from './spedy';

/** empresa que leva a nota à SEFAZ/prefeitura (as duas falam o mesmo "idioma" para o resto do sistema) */
type Provedor = Focus | Spedy;
const NOME_PROVEDOR = { focus: 'Focus NFe', spedy: 'Spedy' } as const;
import type { CancelarNotaDto, CartaCorrecaoDto, DestinatarioDto, EmissorDto, EmitirContaDto, EmitirDevolucaoDto, EmitirNfeDto, ItemNotaDto } from './notas-fiscais.dto';

/**
 * Notas fiscais emitidas pelo sistema através da Focus NFe:
 * NFC-e (consumo), NF-e (venda com nota completa), NFS-e (hospedagem: padrão nacional ou da prefeitura)
 * e NF-e de devolução. Cada CNPJ tem o seu emissor (ambiente de testes ou produção e o token da Focus).
 */

type TipoNota = 'nfce' | 'nfe' | 'nfse' | 'nfsen' | 'devolucao';
type StatusNota = 'processando' | 'autorizado' | 'erro' | 'cancelado';

interface Emissor {
  cnpj: string;
  ambiente: AmbienteFocus;
  provedor: 'focus' | 'spedy';
  spedy_chave_homologacao: string | null;
  spedy_chave_producao: string | null;
  token_homologacao: string | null;
  token_producao: string | null;
  nfse_padrao: 'nacional' | 'municipal';
  dados: DadosEmissor;
  dps_serie: number;
}
/** o que a prefeitura e a nota pedem do estabelecimento (o resto a Focus já tem no cadastro da empresa) */
export interface DadosEmissor {
  inscricaoMunicipal?: string;
  codigoMunicipio?: string; // IBGE, 7 números
  uf?: string;
  regime?: 'simples' | 'mei' | 'normal';
  regimeEspecial?: number; // NFS-e: 0 nenhum, 3 microempresa municipal…
  naturezaNfe?: string;
  infoAdicional?: string;
  aliquotaIss?: number; // ISS da hospedagem, quando o Padrão NFS-e não tiver
}

interface LinhaItem { descricao: string; quantidade: number; valorUnitario: number; total: number; produto: ProdutoFiscal | null; ressarcimento: boolean; servico: boolean }
interface ProdutoFiscal { id: string; nome: string; codigo: string | null; codigo_barras: string | null; fiscal: DadosFiscais; unidade: string }

const TIPO_CAMINHO: Record<TipoNota, CaminhoFocus> = { nfce: 'nfce', nfe: 'nfe', devolucao: 'nfe', nfse: 'nfse', nfsen: 'nfsen' };
const NOME_TIPO: Record<TipoNota, string> = { nfce: 'NFC-e', nfe: 'NF-e', devolucao: 'NF-e de devolução', nfse: 'NFS-e', nfsen: 'NFS-e' };
/** forma de pagamento da nota (tPag): 01 dinheiro, 03 crédito, 04 débito, 17 Pix, 99 outros */
const TPAG: Record<string, [string, string?]> = { dinheiro: ['01'], credito: ['03'], debito: ['04'], pix: ['17'], faturado: ['99', 'Faturado'], penhora: ['99', 'Penhora'] };
const CARTAO = ['03', '04', '17'];
const PRAZO_CANCELAR: Partial<Record<TipoNota, { ms: number; texto: string; saida: string }>> = {
  nfce: { ms: 30 * 60_000, texto: 'até 30 minutos depois de emitida', saida: 'Agora o caminho é a nota de devolução (o cliente devolveu).' },
  nfe: { ms: 24 * 3600_000, texto: 'até 24 horas depois de emitida', saida: 'Agora o caminho é a nota de devolução ou uma carta de correção.' },
  devolucao: { ms: 24 * 3600_000, texto: 'até 24 horas depois de emitida', saida: 'Fale com o contador.' },
};
const CFOP_ST = ['5405', '5403', '5401', '6403', '6404'];
const so = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const r2 = (n: number) => Math.round(n * 100) / 100;
const agoraSP = () => {
  // data/hora de Brasília com o fuso (a Focus aceita até 5 minutos de diferença)
  const d = new Date(Date.now() - 3 * 3600_000);
  return `${d.toISOString().slice(0, 19)}-03:00`;
};
const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const regimeDe = (r: string | null | undefined): 'simples' | 'mei' | 'normal' => (r === 'mei' ? 'mei' : r === 'simples' ? 'simples' : r ? 'normal' : 'simples');

/** reparte um valor pelos pesos, sem perder centavo (o último fica com a sobra) */
function ratear(total: number, pesos: number[]): number[] {
  const soma = pesos.reduce((s, p) => s + p, 0);
  if (!soma) return pesos.map((_, i) => (i === pesos.length - 1 ? r2(total) : 0));
  const out = pesos.map((p) => r2((total * p) / soma));
  const dif = r2(total - out.reduce((s, v) => s + v, 0));
  if (out.length) out[out.length - 1] = r2(out[out.length - 1] + dif);
  return out;
}

@Injectable()
export class NotasFiscaisService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('NotasFiscais');
  private timer: NodeJS.Timeout | null = null;
  private rodando = false;
  /** contas com a emissão em andamento (conta|parte) */
  private readonly emitindo = new Set<string>();

  constructor(private readonly ds: DataSource) {}

  /* ------------------------------------------------------------------ apoio */

  /** de tempos em tempos confere as notas que ainda estão "processando" (NF-e e NFS-e são autorizadas depois) */
  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.acompanhar(), 45_000);
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private async acompanhar() {
    if (this.rodando) return;
    this.rodando = true;
    try {
      const l: { id: string; empresa_id: string }[] = await this.ds.query(
        `SELECT id, empresa_id FROM notas_fiscais WHERE status = 'processando' AND criado_em > now() - interval '5 days' ORDER BY atualizado_em LIMIT 15`);
      for (const n of l) {
        try { await this.atualizarNota(n.empresa_id, n.id, 'Sistema'); } catch (e) { this.log.warn(`nota ${n.id}: ${(e as Error).message}`); }
      }
    } catch { /* tabela ainda não criada */ } finally { this.rodando = false; }
  }

  private async empresa(empresaId: string) {
    const [e] = await this.ds.query(`SELECT nome, cnpj, modulos, fiscal, regime_tributario, numeracao_fiscal FROM empresas WHERE id = $1`, [empresaId]);
    if (!e) throw new NotFoundException('Empresa não encontrada.');
    return e as { nome: string; cnpj: string | null; modulos: Record<string, boolean>; fiscal: { hospedagem?: DadosFiscais }; regime_tributario: string | null; numeracao_fiscal: Record<string, Record<string, { serie: number; proximo: number }>> };
  }

  private async exigirModulo(u: UsuarioToken) {
    const e = await this.empresa(u.empresaId);
    if (!moduloAtivo(e.modulos, 'notas')) throw new ForbiddenException('Módulo de notas fiscais não contratado.');
    return e;
  }

  /** CNPJs da conta: a empresa (principal) e os ambientes com CNPJ próprio */
  private async cnpjs(empresaId: string) {
    const e = await this.empresa(empresaId);
    const ambs: { id: string; nome: string; cnpj: string | null; razao_social: string | null }[] =
      await this.ds.query(`SELECT id, nome, cnpj, razao_social FROM ambientes WHERE empresa_id = $1 ORDER BY nome`, [empresaId]);
    const mapa = new Map<string, { cnpj: string; nome: string; chave: string; ambientes: string[] }>();
    if (so(e.cnpj).length === 14) mapa.set(so(e.cnpj), { cnpj: so(e.cnpj), nome: e.nome, chave: 'principal', ambientes: [] });
    for (const a of ambs) {
      const c = so(a.cnpj);
      const alvo = c.length === 14 ? c : so(e.cnpj);
      if (alvo.length !== 14) continue;
      const x = mapa.get(alvo) ?? { cnpj: alvo, nome: a.razao_social || a.nome, chave: c.length === 14 ? c : 'principal', ambientes: [] };
      x.ambientes.push(a.nome);
      mapa.set(alvo, x);
    }
    return [...mapa.values()];
  }

  /** CNPJ que emite pela conta (o do ambiente, ou o da empresa) e a chave da numeração */
  private async cnpjDoAmbiente(empresaId: string, ambienteId: string | null) {
    const e = await this.empresa(empresaId);
    const [a] = ambienteId ? await this.ds.query(`SELECT cnpj FROM ambientes WHERE id = $1 AND empresa_id = $2`, [ambienteId, empresaId]) : [];
    const doAmb = so(a?.cnpj);
    if (doAmb.length === 14) return { cnpj: doAmb, chave: doAmb };
    if (so(e.cnpj).length !== 14) throw new BadRequestException('Cadastre o CNPJ da empresa (Cadastros › Empresa) antes de emitir notas.');
    return { cnpj: so(e.cnpj), chave: 'principal' };
  }

  private async emissor(empresaId: string, cnpj: string): Promise<{ e: Emissor; focus: Provedor }> {
    const [e] = await this.ds.query(`SELECT * FROM focus_emissores WHERE empresa_id = $1 AND cnpj = $2`, [empresaId, cnpj]);
    if (!e) throw new BadRequestException(`O CNPJ ${cnpj} ainda não está ligado a um emissor de notas. Configure em Configuração fiscal › Emissor de notas.`);
    return { e: e as Emissor, focus: this.provedor(empresaId, e as Emissor, e.ambiente, e.provedor) };
  }

  /** cliente da Focus ou da Spedy com a chave do ambiente pedido */
  private provedor(empresaId: string, e: Emissor, ambiente: AmbienteFocus, qual: 'focus' | 'spedy'): Provedor {
    const prod = ambiente === 'producao';
    const nome = NOME_PROVEDOR[qual] ?? 'emissor';
    const cripto = qual === 'spedy' ? (prod ? e.spedy_chave_producao : e.spedy_chave_homologacao) : (prod ? e.token_producao : e.token_homologacao);
    if (!cripto) throw new BadRequestException(`Falta a chave de ${prod ? 'produção' : 'testes'} da ${nome} para o CNPJ ${e.cnpj}.`);
    let chave: string;
    try { chave = decifrar(cripto, qual === 'spedy' ? 'vb-spedy' : 'vb-focus'); } catch { throw new BadRequestException(`Não consegui ler a chave guardada da ${nome}. Salve a chave de novo.`); }
    if (qual !== 'spedy') return new Focus(chave, ambiente);
    return new Spedy(chave, ambiente, (caminho) => {
      const d = `${empresaId}|${e.cnpj}|${ambiente}|${caminho}`;
      return `/publico/notas-arquivo?e=${empresaId}&c=${e.cnpj}&a=${ambiente}&p=${encodeURIComponent(caminho)}&s=${assinarArquivo(d)}`;
    });
  }

  /** PDF/XML de uma nota da Spedy (o endereço vem assinado pelo próprio sistema) */
  async arquivoSpedy(q: { e?: string; c?: string; a?: string; p?: string; s?: string }) {
    const d = `${q.e}|${q.c}|${q.a}|${q.p}`;
    if (!q.e || !q.c || !q.p || !q.s || !['producao', 'homologacao'].includes(q.a ?? '') || assinarArquivo(d) !== q.s) throw new NotFoundException('Arquivo não encontrado.');
    const [e] = await this.ds.query(`SELECT * FROM focus_emissores WHERE empresa_id = $1 AND cnpj = $2`, [q.e, q.c]);
    if (!e) throw new NotFoundException('Arquivo não encontrado.');
    const sp = this.provedor(q.e, e as Emissor, q.a as AmbienteFocus, 'spedy') as Spedy;
    return sp.baixar(q.p);
  }

  /** próximo número da série (só em produção; nos testes a Focus numera sozinha) */
  private async proximoNumero(empresaId: string, chave: string, doc: 'nfce' | 'nfe'): Promise<{ numero: string; serie: string } | null> {
    const [linhas] = await this.ds.query(
      `UPDATE empresas SET numeracao_fiscal = jsonb_set(numeracao_fiscal, ARRAY[$2::text, $3::text, 'proximo'], to_jsonb((numeracao_fiscal->$2->$3->>'proximo')::int + 1))
        WHERE id = $1 AND numeracao_fiscal->$2->$3 ? 'proximo'
        RETURNING (numeracao_fiscal->$2->$3->>'proximo')::int - 1 AS numero, numeracao_fiscal->$2->$3->>'serie' AS serie`, [empresaId, chave, doc]);
    const r = linhas?.[0];
    return r ? { numero: String(r.numero), serie: String(r.serie ?? 1) } : null;
  }

  private async proximoDps(empresaId: string, e: Emissor) {
    const col = e.ambiente === 'producao' ? 'dps_proximo_producao' : 'dps_proximo_homologacao';
    const [linhas] = await this.ds.query(`UPDATE focus_emissores SET ${col} = ${col} + 1 WHERE empresa_id = $1 AND cnpj = $2 RETURNING ${col} - 1 AS numero, dps_serie AS serie`, [empresaId, e.cnpj]);
    const r = linhas?.[0];
    if (!r) throw new BadRequestException('Não consegui reservar o número da NFS-e.');
    return { numero: Number(r.numero), serie: Number(r.serie) };
  }

  /** tributação da hospedagem: o "Padrão NFS-e" da Configuração fiscal, com o que estiver preenchido na empresa por cima */
  private async dadosHospedagem(empresaId: string, daEmpresa?: DadosFiscais): Promise<DadosFiscais> {
    const [r] = await this.ds.query(`SELECT dados FROM regras_fiscais WHERE empresa_id = $1 AND documento = 'nfs' AND cfop IS NULL AND ativo LIMIT 1`, [empresaId]);
    const preenchidos = Object.fromEntries(Object.entries(daEmpresa ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== ''));
    return { ...((r?.dados ?? {}) as DadosFiscais), ...preenchidos } as DadosFiscais;
  }

  private async regras(empresaId: string) {
    return (await this.ds.query(`SELECT documento, cfop, dados, ativo FROM regras_fiscais WHERE empresa_id = $1`, [empresaId])) as
      { documento: string; cfop: string | null; dados: DadosFiscais; ativo: boolean }[];
  }

  /* -------------------------------------------------------------- emissores */

  async emissores(u: UsuarioToken) {
    await this.exigirModulo(u);
    const lista = await this.cnpjs(u.empresaId);
    const salvos: (Emissor & { atualizado_em: Date; atualizado_por: string | null; dps_proximo_homologacao: number; dps_proximo_producao: number })[] =
      await this.ds.query(`SELECT * FROM focus_emissores WHERE empresa_id = $1`, [u.empresaId]);
    const fim = (c: string | null) => { if (!c) return null; try { const t = decifrar(c, 'vb-focus'); return `••••${t.slice(-4)}`; } catch { return '(precisa salvar de novo)'; } };
    const fimSpedy = (c: string | null) => { if (!c) return null; try { const t = decifrar(c, 'vb-spedy'); return `••••${t.slice(-4)}`; } catch { return '(precisa salvar de novo)'; } };
    return lista.map((c) => {
      const s = salvos.find((x) => x.cnpj === c.cnpj);
      return {
        ...c,
        ligado: !!s,
        ambiente: s?.ambiente ?? 'homologacao',
        nfsePadrao: s?.nfse_padrao ?? 'nacional',
        dados: s?.dados ?? {},
        provedor: s?.provedor ?? 'focus',
        tokenHomologacao: fim(s?.token_homologacao ?? null),
        tokenProducao: fim(s?.token_producao ?? null),
        spedyHomologacao: fimSpedy(s?.spedy_chave_homologacao ?? null),
        spedyProducao: fimSpedy(s?.spedy_chave_producao ?? null),
        dps: s ? { serie: s.dps_serie, proximoHomologacao: s.dps_proximo_homologacao, proximoProducao: s.dps_proximo_producao } : null,
        atualizadoEm: s?.atualizado_em ?? null,
        atualizadoPor: s?.atualizado_por ?? null,
      };
    });
  }

  async ligado(u: UsuarioToken) {
    const e = await this.empresa(u.empresaId);
    if (!moduloAtivo(e.modulos, 'notas')) return { ligado: false, ambiente: null };
    const [r] = await this.ds.query(
      `SELECT ambiente FROM focus_emissores WHERE empresa_id = $1 AND (CASE WHEN provedor = 'spedy' THEN (CASE WHEN ambiente = 'producao' THEN spedy_chave_producao ELSE spedy_chave_homologacao END)
         ELSE (CASE WHEN ambiente = 'producao' THEN token_producao ELSE token_homologacao END) END) IS NOT NULL LIMIT 1`, [u.empresaId]);
    return { ligado: !!r, ambiente: r?.ambiente ?? null };
  }

  async salvarEmissor(u: UsuarioToken, cnpj: string, dto: EmissorDto) {
    await this.exigirModulo(u);
    const c = so(cnpj);
    if (!(await this.cnpjs(u.empresaId)).some((x) => x.cnpj === c)) throw new BadRequestException('Este CNPJ não é da empresa nem de um ambiente.');
    const dados: DadosEmissor = {
      inscricaoMunicipal: dto.dados?.inscricaoMunicipal?.trim() || undefined,
      codigoMunicipio: so(dto.dados?.codigoMunicipio) || undefined,
      uf: dto.dados?.uf?.trim().toUpperCase() || undefined,
      regime: dto.dados?.regime,
      regimeEspecial: dto.dados?.regimeEspecial,
      naturezaNfe: dto.dados?.naturezaNfe?.trim() || undefined,
      infoAdicional: dto.dados?.infoAdicional?.trim() || undefined,
    };
    if (dados.codigoMunicipio && dados.codigoMunicipio.length !== 7) throw new BadRequestException('O código IBGE do município tem 7 números (ex.: Barra do Piraí = 3300308).');
    const th = dto.tokenHomologacao?.trim() ? cifrar(dto.tokenHomologacao.trim(), 'vb-focus') : null;
    const tp = dto.tokenProducao?.trim() ? cifrar(dto.tokenProducao.trim(), 'vb-focus') : null;
    const provedor = dto.provedor === 'spedy' ? 'spedy' : 'focus';
    const sh = dto.spedyHomologacao?.trim() ? cifrar(dto.spedyHomologacao.trim(), 'vb-spedy') : null;
    const sp = dto.spedyProducao?.trim() ? cifrar(dto.spedyProducao.trim(), 'vb-spedy') : null;
    if (dto.ambiente === 'producao' && !(provedor === 'spedy' ? sp : tp)) {
      const [s] = await this.ds.query(`SELECT token_producao, spedy_chave_producao FROM focus_emissores WHERE empresa_id = $1 AND cnpj = $2`, [u.empresaId, c]);
      if (!(provedor === 'spedy' ? s?.spedy_chave_producao : s?.token_producao)) throw new BadRequestException(`Para usar produção, informe a chave de produção da ${NOME_PROVEDOR[provedor]}.`);
    }
    await this.ds.query(
      `INSERT INTO focus_emissores (empresa_id, cnpj, ambiente, token_homologacao, token_producao, nfse_padrao, dados, dps_serie, atualizado_por, provedor, spedy_chave_homologacao, spedy_chave_producao)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,COALESCE($8,1),$9,$11,$12,$13)
       ON CONFLICT (empresa_id, cnpj) DO UPDATE SET ambiente = EXCLUDED.ambiente, provedor = $11,
         spedy_chave_homologacao = COALESCE($12, focus_emissores.spedy_chave_homologacao), spedy_chave_producao = COALESCE($13, focus_emissores.spedy_chave_producao),
         token_homologacao = COALESCE($4, focus_emissores.token_homologacao), token_producao = COALESCE($5, focus_emissores.token_producao),
         nfse_padrao = EXCLUDED.nfse_padrao, dados = EXCLUDED.dados, dps_serie = COALESCE($8, focus_emissores.dps_serie),
         dps_proximo_producao = COALESCE($10, focus_emissores.dps_proximo_producao), atualizado_em = now(), atualizado_por = $9`,
      [u.empresaId, c, dto.ambiente, th, tp, dto.nfsePadrao ?? 'nacional', JSON.stringify(dados), dto.dpsSerie ?? null, u.nome, dto.dpsProximoProducao ?? null, provedor, sh, sp]);
    return (await this.emissores(u)).find((x) => x.cnpj === c);
  }

  async testarEmissor(u: UsuarioToken, cnpj: string) {
    await this.exigirModulo(u);
    const { focus, e } = await this.emissor(u.empresaId, so(cnpj));
    await focus.testar();
    const nome = NOME_PROVEDOR[e.provedor ?? 'focus'];
    return { ok: true, ambiente: e.ambiente, mensagem: `Chave aceita pela ${nome} (${e.ambiente === 'producao' ? 'produção' : `${e.provedor === 'spedy' ? 'sandbox' : 'homologação'} — notas de teste, sem valor fiscal`}).` };
  }

  /* ------------------------------------------------------------- consultas */

  async listar(u: UsuarioToken, f: { de?: string; ate?: string; tipo?: string; status?: string; estadiaId?: string }) {
    await this.exigirModulo(u);
    const p: unknown[] = [u.empresaId];
    let w = '';
    if (f.estadiaId) { p.push(f.estadiaId); w += ` AND n.estadia_id = $${p.length}`; }
    else {
      const de = f.de && /^\d{4}-\d{2}-\d{2}$/.test(f.de) ? f.de : new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
      const ate = f.ate && /^\d{4}-\d{2}-\d{2}$/.test(f.ate) ? f.ate : hojeSP();
      p.push(`${de}T00:00:00-03:00`, `${ate}T23:59:59.999-03:00`);
      w += ` AND n.criado_em BETWEEN $${p.length - 1} AND $${p.length}`;
    }
    if (f.tipo && ['nfce', 'nfe', 'nfse', 'devolucao'].includes(f.tipo)) { p.push(f.tipo === 'nfse' ? ['nfse', 'nfsen'] : [f.tipo]); w += ` AND n.tipo = ANY($${p.length})`; }
    if (f.status && ['processando', 'autorizado', 'erro', 'cancelado'].includes(f.status)) { p.push(f.status); w += ` AND n.status = $${p.length}`; }
    const l: Record<string, unknown>[] = await this.ds.query(
      `SELECT n.*, un.codigo AS suite, e.numero AS uso FROM notas_fiscais n
         LEFT JOIN estadias e ON e.id = n.estadia_id LEFT JOIN unidades un ON un.id = e.unidade_id
        WHERE n.empresa_id = $1${w} ORDER BY n.criado_em DESC LIMIT 1000`, p);
    return l.map((n) => this.formatar(n));
  }

  private formatar(n: Record<string, unknown>) {
    return {
      id: n.id, tipo: n.tipo, nome: NOME_TIPO[n.tipo as TipoNota], ambiente: n.ambiente, cnpj: n.cnpj_emitente, status: n.status,
      numero: n.numero, serie: n.serie, chave: n.chave, mensagem: n.mensagem, valor: Number(n.valor_total),
      destinatario: n.destinatario_nome, documento: n.destinatario_documento, origem: n.origem, estadiaId: n.estadia_id, parteId: n.parte_id,
      suite: n.suite ?? null, uso: n.uso ?? null, notaReferenciadaId: n.nota_referenciada_id, chaveReferenciada: n.chave_referenciada,
      urlXml: n.url_xml, urlPdf: n.url_pdf, urlConsulta: n.url_consulta, justificativa: n.justificativa_cancelamento,
      canceladaEm: n.cancelada_em, canceladaPor: n.cancelada_por, criadoPor: n.criado_por, criadoEm: n.criado_em, atualizadoEm: n.atualizado_em,
      itens: ((n.envio as { items?: Record<string, unknown>[] } | null)?.items ?? []).map((i) => ({
        codigo: i.codigo_produto, descricao: i.descricao, quantidade: Number(i.quantidade_comercial), valorUnitario: Number(i.valor_unitario_comercial),
        total: Number(i.valor_bruto), ncm: i.codigo_ncm, cfop: i.cfop,
      })),
    };
  }

  async ver(u: UsuarioToken, id: string) {
    await this.exigirModulo(u);
    const [n] = await this.ds.query(`SELECT * FROM notas_fiscais WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!n) throw new NotFoundException('Nota não encontrada.');
    return this.formatar(n);
  }

  /* --------------------------------------------------------------- emissão */

  /** cria a linha da nota, manda para a Focus e guarda o resultado */
  private async enviar(empresaId: string, quem: string, a: {
    tipo: TipoNota; cnpj: string; emissor: { e: Emissor; focus: Provedor }; corpo: Record<string, unknown>; valor: number;
    destinatario?: { nome?: string | null; documento?: string | null }; origem: string; estadiaId?: string | null; parteId?: string | null;
    notaReferenciadaId?: string | null; chaveReferenciada?: string | null;
  }) {
    const [linha] = await this.ds.query(
      `INSERT INTO notas_fiscais (empresa_id, cnpj_emitente, tipo, ambiente, ref, origem, estadia_id, parte_id, nota_referenciada_id, chave_referenciada,
         valor_total, destinatario_nome, destinatario_documento, envio, criado_por, provedor)
       VALUES ($1,$2,$3,$4,'vb-' || gen_random_uuid()::text,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15) RETURNING id, ref`,
      [empresaId, a.cnpj, a.tipo, a.emissor.e.ambiente, a.origem, a.estadiaId ?? null, a.parteId ?? null, a.notaReferenciadaId ?? null, a.chaveReferenciada ?? null,
        r2(a.valor), a.destinatario?.nome ?? null, so(a.destinatario?.documento) || null, JSON.stringify(a.corpo), quem, a.emissor.e.provedor ?? 'focus']);
    try {
      const r = await a.emissor.focus.emitir(TIPO_CAMINHO[a.tipo], linha.ref, a.corpo);
      await this.guardarResposta(empresaId, linha.id, a.emissor.focus, r.json, quem);
    } catch (err) {
      const msg = err instanceof ErroFocus ? err.message : `Falha ao enviar a nota: ${(err as Error).message}`;
      if (!(err instanceof ErroFocus)) this.log.error(`nota ${linha.id}: ${(err as Error).stack ?? err}`);
      await this.ds.query(`UPDATE notas_fiscais SET status = 'erro', mensagem = $2, resposta = $3::jsonb, atualizado_em = now() WHERE id = $1`,
        [linha.id, msg, JSON.stringify(err instanceof ErroFocus ? err.corpo : null)]);
      if (a.estadiaId) await this.sincronizarConta(empresaId, a.estadiaId, a.parteId ?? null, quem);
    }
    const [n] = await this.ds.query(`SELECT * FROM notas_fiscais WHERE id = $1`, [linha.id]);
    return this.formatar(n);
  }

  /** traduz a resposta da Focus para a linha da nota (e marca a conta quando autorizada) */
  private async guardarResposta(empresaId: string, id: string, focus: Provedor, j: RespostaFocus, quem: string) {
    const st = String(j.status ?? '');
    const status: StatusNota = st === 'autorizado' ? 'autorizado' : st === 'cancelado' ? 'cancelado'
      : st.startsWith('processando') ? 'processando' : st === 'erro_cancelamento' ? 'autorizado' : 'erro';
    const mensagem = status === 'autorizado' && st !== 'erro_cancelamento' ? (j.mensagem_sefaz ?? null) : mensagemFocus(j) || (status === 'processando' ? 'Aguardando a autorização.' : null);
    await this.ds.query(
      `UPDATE notas_fiscais SET status = $2::varchar, numero = COALESCE($3, numero), serie = COALESCE($4, serie), chave = COALESCE($5, chave), mensagem = $6,
         url_xml = COALESCE($7, url_xml), url_pdf = COALESCE($8, url_pdf), url_consulta = COALESCE($9, url_consulta), resposta = $10::jsonb, atualizado_em = now(),
         cancelada_em = CASE WHEN $2::varchar = 'cancelado' AND cancelada_em IS NULL THEN now() ELSE cancelada_em END
       WHERE id = $1`,
      [id, status, j.numero != null ? String(j.numero) : null, j.serie != null ? String(j.serie) : null, (j.chave_nfe ?? '').replace(/^NFe/, '') || j.codigo_verificacao || null,
        mensagem, focus.arquivo(j.caminho_xml_nota_fiscal), focus.arquivo(j.caminho_danfe ?? j.url_danfse ?? null), j.url_consulta_nf ?? j.url ?? null, JSON.stringify(j)]);
    const [n] = await this.ds.query(`SELECT estadia_id, parte_id FROM notas_fiscais WHERE id = $1`, [id]);
    if (n?.estadia_id) await this.sincronizarConta(empresaId, n.estadia_id, n.parte_id, quem);
  }

  /**
   * A conta (ou a parte de um pagador) fica "emitida" quando a última tentativa de cada tipo de nota dela está autorizada;
   * se uma nota for cancelada, volta para "a emitir".
   */
  private async sincronizarConta(empresaId: string, estadiaId: string, parteId: string | null, quem: string) {
    const ult: { tipo: string; status: string; numero: string | null }[] = await this.ds.query(
      `SELECT DISTINCT ON (CASE WHEN tipo = 'nfsen' THEN 'nfse' ELSE tipo END) tipo, status, numero FROM notas_fiscais
        WHERE estadia_id = $1 AND parte_id IS NOT DISTINCT FROM $2::uuid AND tipo <> 'devolucao'
        ORDER BY CASE WHEN tipo = 'nfsen' THEN 'nfse' ELSE tipo END, criado_em DESC`, [estadiaId, parteId]);
    if (!ult.length) return;
    const todas = ult.every((x) => x.status === 'autorizado');
    const numero = ult.filter((x) => x.status === 'autorizado' && x.numero).map((x) => `${NOME_TIPO[x.tipo as TipoNota]} ${x.numero}`).join(' · ').slice(0, 30) || null;
    if (parteId) {
      await this.ds.query(`UPDATE estadia_notas SET status = $2::varchar, numero = $3, emitida_em = CASE WHEN $2::varchar = 'emitida' THEN now() END, emitida_por = CASE WHEN $2::varchar = 'emitida' THEN $4::varchar END WHERE id = $1`,
        [parteId, todas ? 'emitida' : 'pendente', todas ? numero : null, quem]);
      await this.ds.query(
        `UPDATE estadias e SET nota_status = CASE WHEN NOT EXISTS (SELECT 1 FROM estadia_notas en WHERE en.estadia_id = e.id AND en.status <> 'emitida') THEN 'emitida' ELSE 'pendente' END,
           nota_emitida_em = now(), nota_emitida_por = $2 WHERE e.id = $1 AND e.nota_status IN ('pendente','emitida')`, [estadiaId, quem]);
    } else {
      await this.ds.query(
        `UPDATE estadias SET nota_status = $2::varchar, nota_numero = $3, nota_emitida_em = CASE WHEN $2::varchar = 'emitida' THEN now() END, nota_emitida_por = CASE WHEN $2::varchar = 'emitida' THEN $4::varchar END
          WHERE id = $1 AND nota_status IN ('pendente','emitida')`, [estadiaId, todas ? 'emitida' : 'pendente', todas ? numero : null, quem]);
    }
    if (todas) {
      await this.ds.query(`INSERT INTO estadia_eventos (empresa_id, estadia_id, tipo, descricao, usuario_nome) VALUES ($1,$2,'nota',$3,$4)`,
        [empresaId, estadiaId, `Nota fiscal autorizada${numero ? `: ${numero}` : ''}`, quem]);
    }
  }

  /**
   * Emite as notas de uma conta fechada: consumo na NFC-e e hospedagem na NFS-e.
   * Dois cliques (ou dois computadores) ao mesmo tempo na mesma conta: o segundo é recusado
   * enquanto o primeiro fala com a Focus/Spedy, para não sair a mesma nota duas vezes.
   */
  async emitirConta(u: UsuarioToken, estadiaId: string, dto: EmitirContaDto) {
    const chave = `${estadiaId}|${dto.parteId ?? ''}`;
    if (this.emitindo.has(chave)) throw new BadRequestException('As notas desta conta já estão sendo emitidas. Aguarde um instante e atualize a tela.');
    this.emitindo.add(chave);
    try {
      return await this.emitirContaAgora(u, estadiaId, dto);
    } finally {
      this.emitindo.delete(chave);
    }
  }

  private async emitirContaAgora(u: UsuarioToken, estadiaId: string, dto: EmitirContaDto) {
    const emp = await this.exigirModulo(u);
    const [e] = await this.ds.query(`SELECT * FROM estadias WHERE id = $1 AND empresa_id = $2`, [estadiaId, u.empresaId]);
    if (!e) throw new NotFoundException('Conta não encontrada.');
    if (u.ambientesIds?.length && !u.ambientesIds.includes(e.ambiente_id)) throw new ForbiddenException('Conta de outro ambiente.');
    if (e.status !== 'fechada') throw new BadRequestException('Só dá para emitir a nota depois de fechar a conta.');
    const n = (v: unknown) => Number(v ?? 0);

    // o que já foi autorizado não sai de novo
    const feitas: { tipo: string }[] = await this.ds.query(
      `SELECT DISTINCT tipo FROM notas_fiscais WHERE estadia_id = $1 AND parte_id IS NOT DISTINCT FROM $2::uuid AND status IN ('autorizado','processando')`, [estadiaId, dto.parteId ?? null]);
    const jaTem = (t: 'nfce' | 'nfse') => feitas.some((f) => (t === 'nfse' ? f.tipo === 'nfse' || f.tipo === 'nfsen' : f.tipo === t));

    // itens da conta (fora as avarias, que são ressarcimento e não venda)
    const itens: LinhaItem[] = (await this.ds.query(
      `SELECT i.descricao, i.quantidade, i.preco_unitario, i.total, p.id AS pid, p.nome, p.codigo, p.codigo_barras, p.fiscal, p.unidade, p.ressarcimento, p.tipo
         FROM estadia_itens i LEFT JOIN produtos p ON p.id = i.produto_id WHERE i.estadia_id = $1 AND i.status = 'ativo' ORDER BY i.criado_em`, [estadiaId]))
      .map((i: Record<string, unknown>) => ({
        descricao: String(i.descricao), quantidade: n(i.quantidade), valorUnitario: n(i.preco_unitario), total: n(i.total), ressarcimento: !!i.ressarcimento, servico: i.tipo === 'servico',
        produto: i.pid ? { id: i.pid as string, nome: i.nome as string, codigo: i.codigo as string | null, codigo_barras: i.codigo_barras as string | null, fiscal: (i.fiscal ?? {}) as DadosFiscais, unidade: String(i.unidade ?? 'un') } : null,
      }));
    const produtos = itens.filter((i) => i.produto && !i.ressarcimento && !i.servico);
    const semCadastro = itens.filter((i) => !i.produto);
    const servicos = itens.filter((i) => i.produto && !i.ressarcimento && i.servico).reduce((s, i) => s + i.total, 0);
    const consBase = r2(produtos.reduce((s, i) => s + i.total, 0));
    const hospBase = r2(n(e.valor_hospedagem) + n(e.valor_pessoas) + servicos);
    const ajuste = r2(n(e.acrescimo) - n(e.desconto));
    const soma = hospBase + consBase;
    const hospNet = soma ? r2(hospBase + (ajuste * hospBase) / soma) : 0;
    const consNet = r2(soma + ajuste - hospNet);

    // com pagador separado: cada parte tem a sua nota, com o documento de quem pagou
    let alvoHosp = hospNet, alvoCons = consNet;
    let doc = so(e.nota_documento) || null, nome: string | null = null;
    if (dto.parteId) {
      const partes: { id: string; pagador: string; parte: string; valor: string; documento: string | null; nome: string | null }[] =
        await this.ds.query(`SELECT * FROM estadia_notas WHERE estadia_id = $1`, [estadiaId]);
      const pt = partes.find((x) => x.id === dto.parteId);
      if (!pt) throw new NotFoundException('Parte da conta não encontrada.');
      doc = so(pt.documento) || null; nome = pt.nome;
      const v = n(pt.valor);
      if (pt.parte === 'hospedagem') { alvoHosp = v; alvoCons = 0; }
      else if (pt.parte === 'consumo') { alvoHosp = 0; alvoCons = v; }
      else if (pt.parte === 'tudo') { alvoHosp = soma ? r2((v * hospNet) / (hospNet + consNet || 1)) : 0; alvoCons = r2(v - alvoHosp); }
      else {
        const outra = partes.find((x) => x.id !== pt.id)?.parte;
        if (outra === 'hospedagem') { alvoCons = Math.min(v, consNet); alvoHosp = r2(v - alvoCons); }
        else { alvoHosp = Math.min(v, hospNet); alvoCons = r2(v - alvoHosp); }
      }
    }
    // conta faturada para uma empresa: a nota sai no CNPJ dela
    if (!doc && !dto.parteId) {
      const [cli] = await this.ds.query(
        `SELECT c.nome, c.documento FROM contas_receber r JOIN clientes_faturados c ON c.id = r.cliente_id WHERE r.estadia_id = $1 AND r.status <> 'cancelada' LIMIT 1`, [estadiaId]);
      if (cli && [11, 14].includes(so(cli.documento).length)) { doc = so(cli.documento); nome = cli.nome; }
    }
    if (doc && doc.length !== 11 && doc.length !== 14) doc = null;

    const quais = dto.quais ?? 'tudo';
    const querCons = (quais === 'tudo' || quais === 'nfce') && alvoCons > 0.004 && produtos.length > 0 && !jaTem('nfce');
    const querHosp = (quais === 'tudo' || quais === 'nfse') && alvoHosp > 0.004 && !jaTem('nfse');
    if (!querCons && !querHosp) {
      throw new BadRequestException(feitas.length ? 'As notas desta conta já foram emitidas (ou estão em processamento).' : 'Esta conta não tem valor para nota.');
    }

    const { cnpj, chave } = await this.cnpjDoAmbiente(u.empresaId, e.ambiente_id);
    const em = await this.emissor(u.empresaId, cnpj);
    const regime = em.e.dados.regime ?? regimeDe(emp.regime_tributario);
    const pagamentos: { forma: string; valor: string }[] = await this.ds.query(
      `SELECT forma, SUM(valor) AS valor FROM estadia_pagamentos WHERE estadia_id = $1 GROUP BY forma HAVING SUM(valor) > 0`, [estadiaId]);
    const [un] = await this.ds.query(`SELECT codigo FROM unidades WHERE id = $1`, [e.unidade_id]);
    const avisos: string[] = [];
    if (semCadastro.length) avisos.push(`Itens sem cadastro ficaram fora da NFC-e: ${semCadastro.map((i) => i.descricao).join(', ')}.`);
    const notas: unknown[] = [];

    if (querCons) {
      const regras = await this.regras(u.empresaId);
      const corpoItens = this.itensProduto(produtos.map((i) => ({ produto: i.produto!, quantidade: i.quantidade, valorUnitario: i.valorUnitario, total: i.total })), regras, 'nfce', regime, alvoCons);
      const corpo: Record<string, unknown> = {
        cnpj_emitente: cnpj, data_emissao: agoraSP(), natureza_operacao: 'VENDA AO CONSUMIDOR', presenca_comprador: '1', modalidade_frete: '9', local_destino: '1',
        consumidor_final: '1', items: corpoItens,
        formas_pagamento: this.formasPagamento(pagamentos, alvoCons),
        informacoes_adicionais_contribuinte: [`${un?.codigo ? `Suíte ${un.codigo}` : ''}${e.numero ? ` · uso ${e.numero}` : ''}`.replace(/^ · /, ''), em.e.dados.infoAdicional].filter(Boolean).join(' · ') || undefined,
      };
      if (doc?.length === 11) corpo.cpf_destinatario = doc;
      if (doc?.length === 14) corpo.cnpj_destinatario = doc;
      if (nome && doc) corpo.nome_destinatario = nome;
      if (em.e.ambiente === 'producao') Object.assign(corpo, await this.proximoNumero(u.empresaId, chave, 'nfce') ?? {});
      notas.push(await this.enviar(u.empresaId, u.nome, { tipo: 'nfce', cnpj, emissor: em, corpo, valor: alvoCons, destinatario: { nome, documento: doc }, origem: 'conta', estadiaId, parteId: dto.parteId ?? null }));
    }

    if (querHosp) {
      const hosp = await this.dadosHospedagem(u.empresaId, emp.fiscal?.hospedagem);
      const descr = `Hospedagem${un?.codigo ? ` - suíte ${un.codigo}` : ''} - entrada ${new Date(e.entrada_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}${e.saida_em ? `, saída ${new Date(e.saida_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}` : ''}`;
      notas.push(await this.emitirServico(u, em, regime, hosp, { valor: alvoHosp, descricao: descr, doc, nome, estadiaId, parteId: dto.parteId ?? null }));
    }
    return { notas, avisos };
  }

  /** NFS-e da hospedagem (ou de um serviço): padrão nacional (DPS) ou o da prefeitura */
  private async emitirServico(u: UsuarioToken, em: { e: Emissor; focus: Provedor }, regime: 'simples' | 'mei' | 'normal', f: DadosFiscais,
    a: { valor: number; descricao: string; doc: string | null; nome: string | null; estadiaId: string | null; parteId: string | null }) {
    const d = em.e.dados;
    if (!d.codigoMunicipio) throw new BadRequestException('Falta o código IBGE do município no emissor de notas (Configuração fiscal › Emissor de notas).');
    // hospedagem é o item 09.01 da LC 116; a alíquota do ISS pode vir do Padrão NFS-e ou do emissor
    f = { ...f, codigoServico: f.codigoServico || '09.01', ...(f.aliquotaIss === undefined && d.aliquotaIss !== undefined ? { aliquotaIss: d.aliquotaIss } : {}) };
    const tomadorDoc = a.doc;
    if (em.e.nfse_padrao === 'nacional') {
      const item = so(f.codigoServico);
      const cTribNac = item.length >= 6 ? item.slice(0, 6) : item.padStart(4, '0') + '01';
      const dps = await this.proximoDps(u.empresaId, em.e);
      const corpo: Record<string, unknown> = {
        data_emissao: agoraSP(), data_competencia: hojeSP(), serie_dps: dps.serie, numero_dps: dps.numero, emitente_dps: 1,
        codigo_municipio_emissora: Number(d.codigoMunicipio), cnpj_prestador: em.e.cnpj,
        codigo_opcao_simples_nacional: regime === 'mei' ? 2 : regime === 'simples' ? 3 : 1,
        regime_especial_tributacao: d.regimeEspecial ?? 0,
        codigo_municipio_prestacao: Number(d.codigoMunicipio),
        codigo_tributacao_nacional_iss: cTribNac,
        descricao_servico: a.descricao.slice(0, 1000),
        valor_servico: r2(a.valor),
        tributacao_iss: 1,
        tipo_retencao_iss: f.issRetido ? 2 : 1,
      };
      if (regime === 'simples') corpo.regime_tributario_simples_nacional = 1;
      if (f.codigoMunicipal) corpo.codigo_tributacao_municipal_iss = f.codigoMunicipal.slice(0, 3);
      if (f.aliquotaIss !== undefined) corpo.percentual_aliquota_relativa_municipio = f.aliquotaIss;
      if (tomadorDoc?.length === 11) corpo.cpf_tomador = tomadorDoc;
      if (tomadorDoc?.length === 14) corpo.cnpj_tomador = tomadorDoc;
      if (tomadorDoc && a.nome) corpo.razao_social_tomador = a.nome.slice(0, 150);
      if (f.cstIbsCbs && f.cClassTrib) Object.assign(corpo, { finalidade_emissao: 0, consumidor_final: 1, indicador_destinatario: 0, ibs_cbs_situacao_tributaria: f.cstIbsCbs, ibs_cbs_classificacao_tributaria: f.cClassTrib });
      if (d.infoAdicional) corpo.informacoes_complementares = d.infoAdicional.slice(0, 2000);
      return this.enviar(u.empresaId, u.nome, { tipo: 'nfsen', cnpj: em.e.cnpj, emissor: em, corpo, valor: a.valor, destinatario: { nome: a.nome, documento: tomadorDoc }, origem: a.estadiaId ? 'conta' : 'manual', estadiaId: a.estadiaId, parteId: a.parteId });
    }
    if (!d.inscricaoMunicipal) throw new BadRequestException('Falta a inscrição municipal no emissor de notas (a NFS-e da prefeitura pede).');
    const servico: Record<string, unknown> = {
      valor_servicos: r2(a.valor), iss_retido: !!f.issRetido, item_lista_servico: f.codigoServico, discriminacao: a.descricao, codigo_municipio: d.codigoMunicipio,
    };
    if (f.aliquotaIss !== undefined) servico.aliquota = f.aliquotaIss;
    if (f.codigoMunicipal) servico.codigo_tributario_municipio = f.codigoMunicipal;
    if (f.cnae) servico.codigo_cnae = f.cnae;
    const tomador: Record<string, unknown> = {};
    if (tomadorDoc?.length === 11) tomador.cpf = tomadorDoc;
    if (tomadorDoc?.length === 14) tomador.cnpj = tomadorDoc;
    if (a.nome) tomador.razao_social = a.nome;
    const corpo: Record<string, unknown> = {
      data_emissao: agoraSP(), natureza_operacao: '1', optante_simples_nacional: regime !== 'normal', regime_especial_tributacao: d.regimeEspecial || undefined,
      prestador: { cnpj: em.e.cnpj, inscricao_municipal: d.inscricaoMunicipal, codigo_municipio: d.codigoMunicipio },
      servico,
    };
    if (Object.keys(tomador).length) corpo.tomador = tomador;
    return this.enviar(u.empresaId, u.nome, { tipo: 'nfse', cnpj: em.e.cnpj, emissor: em, corpo, valor: a.valor, destinatario: { nome: a.nome, documento: tomadorDoc }, origem: a.estadiaId ? 'conta' : 'manual', estadiaId: a.estadiaId, parteId: a.parteId });
  }

  /** formas de pagamento repartidas no valor da nota (a soma precisa bater com o total) */
  private formasPagamento(pagamentos: { forma: string; valor: string }[], total: number) {
    if (!pagamentos.length) return [{ forma_pagamento: '90', valor_pagamento: 0 }];
    const valores = ratear(total, pagamentos.map((p) => Number(p.valor)));
    return pagamentos.map((p, i) => {
      const [tpag, desc] = TPAG[p.forma] ?? ['99', p.forma];
      return { forma_pagamento: tpag, valor_pagamento: valores[i], ...(desc ? { descricao_pagamento: desc } : {}), ...(CARTAO.includes(tpag) ? { tipo_integracao: '2' } : {}) };
    }).filter((x) => x.valor_pagamento > 0);
  }

  /**
   * Monta os itens com a tributação de cada produto (padrão → regra do CFOP → produto).
   * Se `alvo` vier, o desconto ou acréscimo da conta é repartido nos itens para o total bater.
   */
  private itensProduto(lista: { produto: ProdutoFiscal; quantidade: number; valorUnitario: number; total: number }[],
    regras: { documento: string; cfop: string | null; dados: DadosFiscais; ativo: boolean }[], documento: 'nfce' | 'nfe' | 'devolucao',
    regime: 'simples' | 'mei' | 'normal', alvo?: number, cfopForcado?: (d: DadosFiscais) => string) {
    const faltas: string[] = [];
    const base = r2(lista.reduce((s, i) => s + i.total, 0));
    const dif = alvo === undefined ? 0 : r2(alvo - base);
    const ajustes = ratear(Math.abs(dif), lista.map((i) => i.total));
    const itens = lista.map((i, k) => {
      const docRegra = documento === 'devolucao' ? 'nfe' : documento;
      let d = tributacaoEfetiva(i.produto.fiscal ?? {}, regras, docRegra);
      if (documento === 'devolucao') {
        const dv = tributacaoEfetiva({}, regras, 'devolucao');
        d = { ...d, ...Object.fromEntries(Object.entries(dv).filter(([, v]) => v !== undefined && v !== '')) };
      }
      if (cfopForcado) d = { ...d, cfop: cfopForcado(d) };
      if (regime !== 'normal') d = { ...d, cstPis: d.cstPis || '49', cstCofins: d.cstCofins || '49' };
      const probs = conferirItem(d, regime, () => null).filter((p) => p.nivel === 'erro' && !(documento === 'devolucao' && p.campo === 'cfop'));
      if (probs.length) faltas.push(`${i.produto.nome}: ${probs.map((p) => p.texto).join(', ')}`);
      const desconto = dif < 0 ? ajustes[k] : 0;
      const outras = dif > 0 ? ajustes[k] : 0;
      const liquido = r2(i.total - desconto + outras);
      const gtin = so(i.produto.codigo_barras);
      const item: Record<string, unknown> = {
        numero_item: String(k + 1),
        codigo_produto: (i.produto.codigo || i.produto.id.slice(0, 8)).slice(0, 60),
        descricao: i.produto.nome.slice(0, 120),
        codigo_ncm: d.ncm,
        cfop: d.cfop,
        unidade_comercial: (d.unidade || i.produto.unidade || 'UN').toUpperCase().slice(0, 6),
        unidade_tributavel: (d.unidade || i.produto.unidade || 'UN').toUpperCase().slice(0, 6),
        quantidade_comercial: i.quantidade,
        quantidade_tributavel: i.quantidade,
        valor_unitario_comercial: i.valorUnitario,
        valor_unitario_tributavel: i.valorUnitario,
        valor_bruto: r2(i.total),
        icms_origem: d.origem ?? '0',
        icms_situacao_tributaria: d.cstIcms,
        inclui_no_total: 1,
      };
      if (desconto) item.valor_desconto = desconto;
      if (outras) item.valor_outras_despesas = outras;
      if ([8, 12, 13, 14].includes(gtin.length)) { item.codigo_barras_comercial = gtin; item.codigo_barras_tributavel = gtin; }
      if (d.cest) item.cest = d.cest;
      if (d.codBeneficio) item.codigo_beneficio_fiscal = d.codBeneficio;
      // ICMS próprio no regime normal (00 e 20)
      if (regime === 'normal' && ['00', '20'].includes(d.cstIcms ?? '') && d.aliquotaIcms !== undefined) {
        const bc = r2(liquido * (1 - (d.reducaoBc ?? 0) / 100));
        Object.assign(item, { icms_modalidade_base_calculo: '3', icms_base_calculo: bc, icms_aliquota: d.aliquotaIcms, icms_valor: r2((bc * d.aliquotaIcms) / 100) });
        if (d.reducaoBc) item.icms_reducao_base_calculo = d.reducaoBc;
      }
      // PIS e COFINS (no Simples o padrão é 49 — outras operações)
      const pis = d.cstPis || (regime === 'normal' ? '' : '49');
      const cofins = d.cstCofins || (regime === 'normal' ? '' : '49');
      if (!pis || !cofins) faltas.push(`${i.produto.nome}: sem CST do PIS/COFINS`);
      item.pis_situacao_tributaria = pis;
      item.cofins_situacao_tributaria = cofins;
      if (['01', '02'].includes(pis) && d.aliquotaPis !== undefined) Object.assign(item, { pis_base_calculo: liquido, pis_aliquota_porcentual: d.aliquotaPis, pis_valor: r2((liquido * d.aliquotaPis) / 100) });
      if (['01', '02'].includes(cofins) && d.aliquotaCofins !== undefined) Object.assign(item, { cofins_base_calculo: liquido, cofins_aliquota_porcentual: d.aliquotaCofins, cofins_valor: r2((liquido * d.aliquotaCofins) / 100) });
      // reforma tributária (IBS/CBS), quando configurada
      if (d.cstIbsCbs && d.cClassTrib) {
        Object.assign(item, { ibs_cbs_situacao_tributaria: d.cstIbsCbs, ibs_cbs_classificacao_tributaria: d.cClassTrib, ibs_cbs_base_calculo: liquido });
        if (d.aliquotaIbsUf !== undefined) Object.assign(item, { ibs_uf_aliquota: d.aliquotaIbsUf, ibs_uf_valor: r2((liquido * d.aliquotaIbsUf) / 100) });
        if (d.aliquotaIbsMun !== undefined) Object.assign(item, { ibs_mun_aliquota: d.aliquotaIbsMun, ibs_mun_valor: r2((liquido * d.aliquotaIbsMun) / 100) });
        if (d.aliquotaCbs !== undefined) Object.assign(item, { cbs_aliquota: d.aliquotaCbs, cbs_valor: r2((liquido * d.aliquotaCbs) / 100) });
      }
      return item;
    });
    if (faltas.length) {
      throw new BadRequestException(`Tributação incompleta (a SEFAZ recusaria): ${faltas.slice(0, 6).join(' | ')}${faltas.length > 6 ? ` (+${faltas.length - 6})` : ''}. Corrija em Produtos › tributação ou em Configuração fiscal.`);
    }
    return itens;
  }

  private destinatario(d: DestinatarioDto) {
    const doc = so(d.documento);
    if (doc.length !== 11 && doc.length !== 14) throw new BadRequestException('CPF ou CNPJ do destinatário inválido.');
    const out: Record<string, unknown> = {
      nome_destinatario: d.nome.trim().slice(0, 60),
      [doc.length === 11 ? 'cpf_destinatario' : 'cnpj_destinatario']: doc,
      indicador_inscricao_estadual_destinatario: d.indicadorIe ?? (so(d.inscricaoEstadual) ? '1' : '9'),
      logradouro_destinatario: d.logradouro.trim(), numero_destinatario: d.numero.trim() || 'S/N', bairro_destinatario: d.bairro.trim(),
      municipio_destinatario: d.municipio.trim(), uf_destinatario: d.uf.trim().toUpperCase(), cep_destinatario: so(d.cep), pais_destinatario: 'Brasil',
    };
    if (so(d.inscricaoEstadual)) out.inscricao_estadual_destinatario = so(d.inscricaoEstadual);
    if (d.email?.trim()) out.email_destinatario = d.email.trim();
    if (d.telefone?.trim()) out.telefone_destinatario = so(d.telefone);
    return { corpo: out, doc };
  }

  private async produtosDe(empresaId: string, itens: ItemNotaDto[]) {
    const ids = [...new Set(itens.map((i) => i.produtoId))];
    const ps: ProdutoFiscal[] = await this.ds.query(`SELECT id, nome, codigo, codigo_barras, fiscal, unidade FROM produtos WHERE empresa_id = $1 AND id = ANY($2::uuid[])`, [empresaId, ids]);
    return itens.map((i) => {
      const p = ps.find((x) => x.id === i.produtoId);
      if (!p) throw new BadRequestException('Produto não encontrado.');
      return { produto: { ...p, fiscal: p.fiscal ?? {} }, quantidade: i.quantidade, valorUnitario: i.valorUnitario, total: r2(i.quantidade * i.valorUnitario) };
    });
  }

  /** NF-e de venda (empresa, entrega, outro estado) */
  async emitirNfe(u: UsuarioToken, dto: EmitirNfeDto) {
    const emp = await this.exigirModulo(u);
    const { cnpj, chave } = dto.cnpj ? { cnpj: so(dto.cnpj), chave: so(dto.cnpj) === so(emp.cnpj) ? 'principal' : so(dto.cnpj) } : await this.cnpjDoAmbiente(u.empresaId, dto.ambienteId ?? null);
    const em = await this.emissor(u.empresaId, cnpj);
    const regime = em.e.dados.regime ?? regimeDe(emp.regime_tributario);
    const dest = this.destinatario(dto.destinatario);
    const lista = await this.produtosDe(u.empresaId, dto.itens);
    const interestadual = !!em.e.dados.uf && dto.destinatario.uf.trim().toUpperCase() !== em.e.dados.uf;
    const items = this.itensProduto(lista, await this.regras(u.empresaId), 'nfe', regime, undefined,
      interestadual ? (d) => (d.cfop?.startsWith('5') ? `6${d.cfop.slice(1)}` : d.cfop ?? '6102') : undefined);
    const total = r2(lista.reduce((s, i) => s + i.total, 0));
    const [tpag, desc] = TPAG[dto.formaPagamento ?? ''] ?? ['90'];
    const corpo: Record<string, unknown> = {
      cnpj_emitente: cnpj, natureza_operacao: (dto.natureza || em.e.dados.naturezaNfe || 'Venda de mercadoria').slice(0, 60), data_emissao: agoraSP(), data_entrada_saida: agoraSP(),
      tipo_documento: 1, finalidade_emissao: 1, local_destino: interestadual ? 2 : 1, consumidor_final: dest.doc.length === 11 || dto.consumidorFinal ? 1 : 0,
      presenca_comprador: dto.presenca ?? '1', modalidade_frete: '9', ...dest.corpo, items,
      formas_pagamento: [{ forma_pagamento: tpag, valor_pagamento: tpag === '90' ? 0 : total, ...(desc ? { descricao_pagamento: desc } : {}), ...(CARTAO.includes(tpag) ? { tipo_integracao: '2' } : {}) }],
    };
    const info = [dto.observacao?.trim(), em.e.dados.infoAdicional].filter(Boolean).join(' · ');
    if (info) corpo.informacoes_adicionais_contribuinte = info;
    if (em.e.ambiente === 'producao') Object.assign(corpo, await this.proximoNumero(u.empresaId, chave, 'nfe') ?? {});
    return this.enviar(u.empresaId, u.nome, { tipo: 'nfe', cnpj, emissor: em, corpo, valor: total, destinatario: { nome: dto.destinatario.nome, documento: dest.doc }, origem: 'manual' });
  }

  /** NF-e de devolução: ao fornecedor (saída) ou do cliente (entrada), sempre ligada à nota original pela chave */
  async emitirDevolucao(u: UsuarioToken, dto: EmitirDevolucaoDto) {
    const emp = await this.exigirModulo(u);
    let chaveRef = so(dto.chaveReferenciada);
    let notaRefId: string | null = null;
    let cnpjEmit = dto.cnpj ? so(dto.cnpj) : '';
    if (dto.notaId) {
      const [nr] = await this.ds.query(`SELECT id, chave, cnpj_emitente, status, tipo FROM notas_fiscais WHERE id = $1 AND empresa_id = $2`, [dto.notaId, u.empresaId]);
      if (!nr) throw new NotFoundException('Nota original não encontrada.');
      if (nr.status !== 'autorizado' || !['nfce', 'nfe'].includes(nr.tipo)) throw new BadRequestException('Só dá para devolver uma NFC-e ou NF-e autorizada.');
      chaveRef = so(nr.chave); notaRefId = nr.id; cnpjEmit = nr.cnpj_emitente;
    }
    if (chaveRef.length !== 44) throw new BadRequestException('Informe a chave de acesso da nota original (44 números).');
    if (!cnpjEmit) cnpjEmit = (await this.cnpjDoAmbiente(u.empresaId, dto.ambienteId ?? null)).cnpj;
    const chaveNum = cnpjEmit === so(emp.cnpj) ? 'principal' : cnpjEmit;
    const em = await this.emissor(u.empresaId, cnpjEmit);
    const regime = em.e.dados.regime ?? regimeDe(emp.regime_tributario);
    const dest = this.destinatario(dto.destinatario);
    const lista = await this.produtosDe(u.empresaId, dto.itens);
    const saida = dto.tipo !== 'entrada'; // saída: devolvendo ao fornecedor; entrada: o cliente devolveu
    const interestadual = !!em.e.dados.uf && dto.destinatario.uf.trim().toUpperCase() !== em.e.dados.uf;
    const cfopDev = (d: DadosFiscais) => {
      const st = CFOP_ST.includes(d.cfop ?? '') || d.cstIcms === '500' || d.cstIcms === '60';
      const regraDev = d.cfop && /^[1256]20[12]|^[1256]41[01]/.test(d.cfop) ? d.cfop : null;
      if (regraDev) return regraDev;
      const pre = saida ? (interestadual ? '6' : '5') : (interestadual ? '2' : '1');
      return `${pre}${st ? '411' : '202'}`;
    };
    const items = this.itensProduto(lista, await this.regras(u.empresaId), 'devolucao', regime, undefined, cfopDev)
      .map((i) => ({ ...i, percentual_devolvido: 100 }));
    const total = r2(lista.reduce((s, i) => s + i.total, 0));
    const corpo: Record<string, unknown> = {
      cnpj_emitente: cnpjEmit, natureza_operacao: (dto.natureza || 'Devolução de mercadoria').slice(0, 60), data_emissao: agoraSP(), data_entrada_saida: agoraSP(),
      tipo_documento: saida ? 1 : 0, finalidade_emissao: 4, local_destino: interestadual ? 2 : 1, consumidor_final: dest.doc.length === 11 ? 1 : 0,
      presenca_comprador: '9', modalidade_frete: '9', ...dest.corpo, items,
      notas_referenciadas: [{ chave_nfe: chaveRef }],
      formas_pagamento: [{ forma_pagamento: '90', valor_pagamento: 0 }],
      informacoes_adicionais_contribuinte: [`Devolução referente à nota ${chaveRef}`, dto.motivo?.trim()].filter(Boolean).join(' · '),
    };
    if (em.e.ambiente === 'producao') Object.assign(corpo, await this.proximoNumero(u.empresaId, chaveNum, 'nfe') ?? {});
    return this.enviar(u.empresaId, u.nome, {
      tipo: 'devolucao', cnpj: cnpjEmit, emissor: em, corpo, valor: total, destinatario: { nome: dto.destinatario.nome, documento: dest.doc },
      origem: 'devolucao', notaReferenciadaId: notaRefId, chaveReferenciada: chaveRef,
    });
  }

  /* ------------------------------------------------- acompanhar e cancelar */

  private async linha(empresaId: string, id: string) {
    const [n] = await this.ds.query(`SELECT * FROM notas_fiscais WHERE id = $1 AND empresa_id = $2`, [id, empresaId]);
    if (!n) throw new NotFoundException('Nota não encontrada.');
    return n as { [k: string]: string | null } & { tipo: TipoNota; ambiente: AmbienteFocus; cnpj_emitente: string | null };
  }

  /** usa o token do ambiente em que a nota foi emitida (mesmo que o emissor tenha mudado depois) */
  private async focusDa(empresaId: string, n: { cnpj_emitente: string | null; ambiente: AmbienteFocus; provedor?: string | null }): Promise<Provedor> {
    const [e] = await this.ds.query(`SELECT * FROM focus_emissores WHERE empresa_id = $1 AND cnpj = $2`, [empresaId, n.cnpj_emitente]);
    if (!e) throw new BadRequestException('O emissor deste CNPJ não está mais configurado.');
    return this.provedor(empresaId, e as Emissor, n.ambiente, n.provedor === 'spedy' ? 'spedy' : 'focus');
  }

  private async atualizarNota(empresaId: string, id: string, quem: string) {
    const n = await this.linha(empresaId, id);
    const focus = await this.focusDa(empresaId, n);
    const r = await focus.consultar(TIPO_CAMINHO[n.tipo], n.ref!);
    if (r.status === 404) {
      await this.ds.query(`UPDATE notas_fiscais SET status = 'erro', mensagem = 'O emissor não tem esta nota (não chegou a ser recebida).', atualizado_em = now() WHERE id = $1 AND status = 'processando'`, [id]);
    } else await this.guardarResposta(empresaId, id, focus, r.json, quem);
    const [x] = await this.ds.query(`SELECT * FROM notas_fiscais WHERE id = $1`, [id]);
    return this.formatar(x);
  }

  async atualizar(u: UsuarioToken, id: string) {
    await this.exigirModulo(u);
    return this.atualizarNota(u.empresaId, id, u.nome);
  }

  async cancelar(u: UsuarioToken, id: string, dto: CancelarNotaDto) {
    await this.exigirModulo(u);
    const n = await this.linha(u.empresaId, id);
    if (n.status !== 'autorizado') throw new BadRequestException('Só dá para cancelar uma nota autorizada.');
    // prazo da Fazenda: NFC-e até 30 minutos e NF-e até 24 horas depois da autorização (NFS-e: regra da prefeitura)
    const prazo = PRAZO_CANCELAR[n.tipo];
    const desde = new Date(String(n.criado_em)).getTime();
    if (prazo && Date.now() - desde > prazo.ms) {
      throw new BadRequestException(`Passou o prazo para cancelar a ${NOME_TIPO[n.tipo]} (${prazo.texto}). ${prazo.saida}`);
    }
    const j = dto.justificativa.trim();
    const liberou = await liberarPermissao(this.ds, u, 'notas.cancelar', 'cancelar nota fiscal', dto.autorizacao,
      { estadiaId: n.estadia_id, detalhe: `${NOME_TIPO[n.tipo]} ${n.numero ?? ''} · ${j}`, valor: Number(n.valor_total) });
    const focus = await this.focusDa(u.empresaId, n);
    const r = await focus.cancelar(TIPO_CAMINHO[n.tipo], n.ref!, j);
    const st = String(r.json.status ?? '');
    if (st === 'cancelado') {
      await this.ds.query(`UPDATE notas_fiscais SET status = 'cancelado', justificativa_cancelamento = $2, cancelada_em = now(), cancelada_por = $3, mensagem = $4, atualizado_em = now() WHERE id = $1`,
        [id, j, liberou ? `${u.nome} (liberado por ${liberou})` : u.nome, r.json.mensagem_sefaz ?? 'Cancelada.']);
      if (n.estadia_id) await this.sincronizarConta(u.empresaId, n.estadia_id, n.parte_id, u.nome);
      if (n.estadia_id) await this.ds.query(`INSERT INTO estadia_eventos (empresa_id, estadia_id, tipo, descricao, usuario_nome) VALUES ($1,$2,'nota',$3,$4)`,
        [u.empresaId, n.estadia_id, `${NOME_TIPO[n.tipo]} ${n.numero ?? ''} cancelada · ${j}`, u.nome]);
    } else if (st.startsWith('processando')) {
      await this.ds.query(`UPDATE notas_fiscais SET justificativa_cancelamento = $2, mensagem = 'Cancelamento enviado; aguardando a confirmação.', atualizado_em = now() WHERE id = $1`, [id, j]);
    } else {
      throw new BadRequestException(`Cancelamento recusado: ${mensagemFocus(r.json) || 'sem motivo informado'}`);
    }
    return this.ver(u, id);
  }

  async cartaCorrecao(u: UsuarioToken, id: string, dto: CartaCorrecaoDto) {
    await this.exigirModulo(u);
    const n = await this.linha(u.empresaId, id);
    if (n.status !== 'autorizado' || !['nfe', 'devolucao'].includes(n.tipo)) throw new BadRequestException('Carta de correção só para NF-e autorizada.');
    const focus = await this.focusDa(u.empresaId, n);
    const r = await focus.cartaCorrecao(n.ref!, dto.correcao.trim());
    if (r.json.status !== 'autorizado') throw new BadRequestException(`Carta de correção recusada: ${mensagemFocus(r.json)}`);
    const pdf = focus.arquivo(r.json.caminho_pdf_carta_correcao);
    await this.ds.query(`UPDATE notas_fiscais SET mensagem = $2, atualizado_em = now() WHERE id = $1`, [id, `Carta de correção nº ${r.json.numero_carta_correcao ?? ''} autorizada.`]);
    return { ok: true, numero: r.json.numero_carta_correcao ?? null, urlPdf: pdf };
  }
}
