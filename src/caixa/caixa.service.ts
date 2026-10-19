import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { CaixaMovimento, CaixaTurno, Valores } from './caixa.entity';
import { AbrirTurnoDto, BaixarPenhoraDto, ConfigCaixaDto, FecharTurnoDto, LancamentoAdmDto, MovimentoDto, ResgatarPenhoraDto } from './caixa.dto';
import { EstadiaPagamento } from '../estadias/estadia-pagamento.entity';
import { Estadia } from '../estadias/estadia.entity';
import { Unidade } from '../unidades/unidade.entity';
import { Ambiente } from '../ambientes/ambiente.entity';
import { Empresa } from '../empresas/empresa.entity';
import { UsuarioEntity } from '../usuarios/usuario.entity';
import { Gorjeta } from '../gorjetas/gorjeta.entity';
import { Penhora } from './penhora.entity';
import { moduloAtivo } from '../common/modulos';
import { cnpjDoAmbiente, cnpjDoForm } from '../common/cnpj';
import { UsuarioToken, temPermissao } from '../common/permissoes';
import { AutorizacaoEntrada, liberarPermissao } from '../common/liberacao';

const FORMAS = ['dinheiro', 'pix', 'debito', 'credito', 'faturado', 'penhora'] as const;
/** formas que são dinheiro de verdade (penhora é objeto; faturado é a receber) */
const NAO_DINHEIRO = ['penhora', 'faturado'];
const brl = (cent: number) => `R$ ${(cent / 100).toFixed(2).replace('.', ',')}`;
const DIA = 86_400_000;
const c = (v: number | string | null | undefined) => Math.round(Number(v ?? 0) * 100);
const r = (cent: number) => Math.round(cent) / 100;

@Injectable()
export class CaixaService {
  constructor(
    @InjectRepository(CaixaTurno) private readonly turnos: Repository<CaixaTurno>,
    @InjectRepository(CaixaMovimento) private readonly movimentos: Repository<CaixaMovimento>,
    @InjectRepository(EstadiaPagamento) private readonly pagamentos: Repository<EstadiaPagamento>,
    @InjectRepository(Estadia) private readonly estadias: Repository<Estadia>,
    @InjectRepository(Unidade) private readonly unidades: Repository<Unidade>,
    @InjectRepository(Ambiente) private readonly ambientes: Repository<Ambiente>,
    @InjectRepository(Empresa) private readonly empresas: Repository<Empresa>,
    @InjectRepository(UsuarioEntity) private readonly usuarios: Repository<UsuarioEntity>,
    @InjectRepository(Gorjeta) private readonly gorjetasRepo: Repository<Gorjeta>,
    @InjectRepository(Penhora) private readonly penhoras: Repository<Penhora>,
    private readonly ds: DataSource,
  ) {}

  private async moduloLigado(empresaId: string) {
    const e = await this.empresas.findOne({ where: { id: empresaId } });
    return moduloAtivo(e?.modulos, 'caixa');
  }

  private async exigirModulo(u: UsuarioToken) {
    if (!(await this.moduloLigado(u.empresaId))) throw new ForbiddenException('Módulo de caixa não contratado.');
  }

  private podeVerAmbiente(u: UsuarioToken, ambienteId: string) {
    return !u.ambientesIds?.length || u.ambientesIds.includes(ambienteId);
  }

  /**
   * Usado pelas contas: em qual turno cai o recebimento. Sem o módulo, null.
   * Com o módulo e sem caixa aberto, bloqueia (o dinheiro precisa entrar em algum caixa).
   */
  async turnoParaRecebimento(empresaId: string, ambienteId: string): Promise<string | null> {
    if (!(await this.moduloLigado(empresaId))) return null;
    const t = await this.turnos.findOne({ where: { empresaId, ambienteId, status: 'aberto' } });
    if (!t) throw new BadRequestException('O caixa está fechado. Abra o caixa (menu Caixa) antes de receber.');
    return t.id;
  }

  /** Liberação por senha de quem tem a permissão (ex.: sangria). */
  private async liberar(u: UsuarioToken, permissao: string, acao: string, aut?: AutorizacaoEntrada, ctx: { ambienteId?: string; detalhe?: string; valor?: number } = {}) {
    return liberarPermissao(this.ds, u, permissao, acao, aut, ctx);
  }

  /** Totais do turno: recebido por forma, gorjetas, movimentos e o esperado na gaveta. */
  async resumo(t: CaixaTurno) {
    const pags = await this.pagamentos.find({ where: { turnoId: t.id } });
    const movs = await this.movimentos.find({ where: { turnoId: t.id, caixa: 'principal' }, order: { criadoEm: 'ASC' } });
    const gorjs = await this.gorjetasRepo.find({ where: { turnoId: t.id } });
    const penhs = await this.penhoras.find({ where: { turnoId: t.id }, order: { criadoEm: 'ASC' } });
    const recebido: Record<string, number> = Object.fromEntries(FORMAS.map((f) => [f, 0]));
    for (const p of pags) recebido[p.forma] = (recebido[p.forma] ?? 0) + c(p.valor);
    // vendas avulsas (fora da conta) do turno entram no recebido
    const avulsas: { forma: string; total: string }[] = await this.ds.query(`SELECT forma, total FROM vendas_avulsas WHERE turno_id = $1 AND NOT cancelada`, [t.id]);
    let totalAvulsas = 0;
    for (const v of avulsas) { recebido[v.forma] = (recebido[v.forma] ?? 0) + c(v.total); totalAvulsas += c(v.total); }
    const somaMov = (tipo: string, forma?: string) => movs.filter((m) => m.tipo === tipo && (!forma || m.forma === forma)).reduce((s, m) => s + c(m.valor), 0);
    const esperado: Valores = {};
    for (const f of FORMAS) esperado[f] = recebido[f] ?? 0;
    // penhora paga neste turno: o dinheiro entra na forma em que o cliente pagou
    const resgates: Record<string, number> = {};
    for (const m of movs.filter((x) => x.tipo === 'resgate')) {
      resgates[m.forma] = (resgates[m.forma] ?? 0) + c(m.valor);
      if (m.forma !== 'dinheiro') esperado[m.forma] = (esperado[m.forma] ?? 0) + c(m.valor);
    }
    // devolução em cartão/pix (ex.: entrada cancelada com pagamento antecipado) sai da forma dela
    for (const mv of movs.filter((x) => x.tipo === 'despesa' && x.forma !== 'dinheiro')) esperado[mv.forma] = (esperado[mv.forma] ?? 0) - c(mv.valor);
    // gorjeta a mais no cartão/pix entra na maquininha daquela forma
    for (const g of gorjs) if (g.origem === 'adicional') esperado[g.forma] = (esperado[g.forma] ?? 0) + c(g.valor);
    const gorjDinheiro = gorjs.filter((g) => g.forma === 'dinheiro');
    const pagasNaHora = gorjDinheiro.filter((g) => g.status === 'paga_na_hora').reduce((s, g) => s + c(g.valor), 0);
    // na gaveta: troco inicial + dinheiro das contas + gorjetas em dinheiro − as já pagas na hora + reforços − sangrias − despesas
    esperado.dinheiro = c(t.trocoInicial) + (recebido.dinheiro ?? 0) + gorjDinheiro.reduce((s, g) => s + c(g.valor), 0) - pagasNaHora
      + somaMov('reforco') - somaMov('sangria') - somaMov('despesa', 'dinheiro') + (resgates.dinheiro ?? 0);
    const porPessoa = new Map<string, { para: string; valor: number; naHora: number; aRepassar: number; casa: number }>();
    for (const g of gorjs) {
      const a = porPessoa.get(g.beneficiarioNome) ?? { para: g.beneficiarioNome, valor: 0, naHora: 0, aRepassar: 0, casa: 0 };
      a.valor += c(g.valor);
      if (g.status === 'paga_na_hora') a.naHora += c(g.valor);
      else if (g.status === 'casa') a.casa += c(g.valor);
      else a.aRepassar += c(g.valorLiquido);
      porPessoa.set(g.beneficiarioNome, a);
    }
    const totalGorjetas = gorjs.reduce((s, g) => s + c(g.valor), 0);
    const totalResgates = Object.values(resgates).reduce((s, v) => s + v, 0);
    const totalDinheiroReal = Object.entries(recebido).filter(([k]) => !NAO_DINHEIRO.includes(k)).reduce((s, [, v]) => s + v, 0);
    return {
      recebido: Object.fromEntries(Object.entries(recebido).map(([k, v]) => [k, r(v)])),
      /** só o que entrou de fato (sem penhora e faturado) */
      totalRecebido: r(totalDinheiroReal),
      /** tudo o que passou pelo caixa: todas as formas + penhoras pagas */
      totalMovimentado: r(Object.values(recebido).reduce((s, v) => s + v, 0) + totalResgates),
      resgates: Object.fromEntries(Object.entries(resgates).map(([k, v]) => [k, r(v)])),
      totalResgates: r(totalResgates),
      vendasAvulsas: r(totalAvulsas),
      qtdVendasAvulsas: avulsas.length,
      penhoras: penhs.map((x) => ({ id: x.id, item: x.item, valor: Number(x.valor), status: x.status, contato: x.contato, criadoEm: x.criadoEm })),
      contas: new Set(pags.map((p) => p.estadiaId)).size,
      gorjetas: [...porPessoa.values()].map((a) => ({ para: a.para, valor: r(a.valor), naHora: r(a.naHora), aRepassar: r(a.aRepassar), casa: r(a.casa) })).sort((x, y) => y.valor - x.valor),
      totalGorjetas: r(totalGorjetas),
      gorjetasPagasNaHora: r(pagasNaHora),
      sangrias: r(somaMov('sangria')),
      reforcos: r(somaMov('reforco')),
      despesas: r(somaMov('despesa')),
      esperado: Object.fromEntries(Object.entries(esperado).map(([k, v]) => [k, r(v)])),
      movimentos: movs.map((m) => ({ ...m, valor: Number(m.valor) })),
    };
  }

  private async ambienteNome(id: string) {
    return (await this.ambientes.findOne({ where: { id } }))?.nome ?? '';
  }

  /** Turno aberto do ambiente (o que a recepção vê). Fechamento cego: sem o esperado para quem não tem relatórios. */
  async atual(u: UsuarioToken, ambienteId: string) {
    await this.exigirModulo(u);
    if (!this.podeVerAmbiente(u, ambienteId)) throw new ForbiddenException('Ambiente não liberado para você.');
    const t = await this.turnos.findOne({ where: { empresaId: u.empresaId, ambienteId, status: 'aberto' } });
    if (!t) {
      const ultimo = await this.turnos.findOne({ where: { empresaId: u.empresaId, ambienteId, status: 'fechado' }, order: { fechadoEm: 'DESC' } });
      return { turno: null, ambiente: await this.ambienteNome(ambienteId), sugestaoTroco: ultimo?.fundoProximo !== null && ultimo?.fundoProximo !== undefined ? Number(ultimo.fundoProximo) : null };
    }
    const res = await this.resumo(t);
    const verTudo = temPermissao(u, 'caixa.relatorios');
    return {
      ambiente: await this.ambienteNome(ambienteId),
      turno: { ...t, trocoInicial: Number(t.trocoInicial) },
      resumo: verTudo ? res : { ...res, esperado: null, recebido: null, totalRecebido: null, totalMovimentado: null, resgates: null, totalResgates: null },
      cego: !verTudo,
    };
  }

  async abrir(u: UsuarioToken, dto: AbrirTurnoDto) {
    await this.exigirModulo(u);
    if (!this.podeVerAmbiente(u, dto.ambienteId)) throw new ForbiddenException('Ambiente não liberado para você.');
    const amb = await this.ambientes.findOne({ where: { id: dto.ambienteId, empresaId: u.empresaId } });
    if (!amb) throw new NotFoundException('Ambiente não encontrado.');
    const ja = await this.turnos.findOne({ where: { empresaId: u.empresaId, ambienteId: dto.ambienteId, status: 'aberto' } });
    if (ja) throw new BadRequestException(`Já existe um caixa aberto no ${amb.nome} (turno ${ja.numero}, por ${ja.abertoPor ?? '—'}).`);
    const salvo = await this.ds.transaction(async (m) => {
      const res = await m.query('UPDATE empresas SET ultimo_turno = ultimo_turno + 1 WHERE id = $1 RETURNING ultimo_turno', [u.empresaId]);
      const linha = Array.isArray(res?.[0]) ? res[0][0] : res?.[0];
      return m.save(m.create(CaixaTurno, {
        empresaId: u.empresaId, ambienteId: dto.ambienteId, numero: Number(linha?.ultimo_turno ?? 1), status: 'aberto',
        trocoInicial: dto.trocoInicial.toFixed(2), abertoPorId: u.sub, abertoPor: u.nome, abertoEm: new Date(),
      }));
    });
    return this.atual(u, salvo.ambienteId);
  }

  /**
   * Troca de turno: quando a recepcionista entra com o login dela e o caixa do ambiente
   * está fechado, o turno dela abre sozinho com o fundo que o anterior deixou.
   * Só para perfis com o caixa principal marcado (o administrador geral não abre caixa ao entrar).
   * Ambiente que nunca teve caixa continua sendo aberto à mão na primeira vez.
   */
  async abrirNoLogin(u: UsuarioToken) {
    if (!u.permissoes.includes('caixa.principal') || !(await this.moduloLigado(u.empresaId))) return [];
    const ambs = await this.ambientes.find({ where: { empresaId: u.empresaId } });
    const abertos: { ambiente: string; numero: number; trocoInicial: number }[] = [];
    for (const a of ambs.filter((x) => this.podeVerAmbiente(u, x.id))) {
      const aberto = await this.turnos.findOne({ where: { empresaId: u.empresaId, ambienteId: a.id, status: 'aberto' } });
      if (aberto) continue;
      const ultimo = await this.turnos.findOne({ where: { empresaId: u.empresaId, ambienteId: a.id, status: 'fechado' }, order: { fechadoEm: 'DESC' } });
      if (!ultimo) continue;
      const troco = Number(ultimo.fundoProximo ?? 0);
      try {
        const r = await this.abrir(u, { ambienteId: a.id, trocoInicial: troco });
        if (r.turno) abertos.push({ ambiente: a.nome, numero: r.turno.numero, trocoInicial: troco });
      } catch {
        /* outro computador abriu ao mesmo tempo: segue */
      }
    }
    return abertos;
  }

  private async turnoAberto(u: UsuarioToken, id: string) {
    const t = await this.turnos.findOne({ where: { id, empresaId: u.empresaId } });
    if (!t) throw new NotFoundException('Turno não encontrado.');
    if (!this.podeVerAmbiente(u, t.ambienteId)) throw new ForbiddenException('Ambiente não liberado para você.');
    if (t.status !== 'aberto') throw new BadRequestException('Este caixa já foi fechado.');
    return t;
  }

  async movimento(u: UsuarioToken, id: string, dto: MovimentoDto) {
    await this.exigirModulo(u);
    const t = await this.turnoAberto(u, id);
    let autorizadoPor: string | null = null;
    if (dto.tipo === 'sangria') autorizadoPor = await this.liberar(u, 'caixa.sangria', 'fazer sangria', dto.autorizacao, { ambienteId: t.ambienteId, detalhe: dto.descricao?.trim() || undefined, valor: dto.valor });
    const categoria = dto.categoria?.trim() || null;
    if (dto.tipo === 'despesa' && !dto.descricao?.trim() && !categoria) throw new BadRequestException('Diga do que foi a saída.');
    if (dto.tipo !== 'reforco') {
      const res = await this.resumo(t);
      if (c(dto.valor) > c(res.esperado.dinheiro)) throw new BadRequestException(`Não tem esse valor em dinheiro no caixa (saldo do sistema: R$ ${res.esperado.dinheiro.toFixed(2).replace('.', ',')}).`);
    }
    let movimentoId = '';
    await this.ds.transaction(async (m) => {
      const ins = await m.insert(CaixaMovimento, {
        empresaId: u.empresaId, turnoId: t.id, caixa: 'principal', tipo: dto.tipo, forma: 'dinheiro', valor: dto.valor.toFixed(2),
        descricao: dto.descricao?.trim() || null, categoria, usuarioId: u.sub, usuarioNome: u.nome, autorizadoPor,
      });
      movimentoId = ins.identifiers?.[0]?.id ?? '';
      // sangria vai para o caixa ADM
      if (dto.tipo === 'sangria') {
        await m.insert(CaixaMovimento, {
          empresaId: u.empresaId, turnoId: null, caixa: 'adm', tipo: 'sangria', forma: 'dinheiro', valor: dto.valor.toFixed(2), cnpj: await cnpjDoAmbiente(this.ds, t.ambienteId),
          descricao: `Sangria do turno ${t.numero} (${await this.ambienteNome(t.ambienteId)})${dto.descricao?.trim() ? ` · ${dto.descricao.trim()}` : ''}`,
          usuarioId: u.sub, usuarioNome: u.nome, autorizadoPor,
        });
      }
    });
    return { ...(await this.atual(u, t.ambienteId)), movimentoId };
  }

  /** Um lançamento do caixa principal, para imprimir o comprovante (sangria, entrada, saída). */
  async movimentoDetalhe(u: UsuarioToken, id: string) {
    await this.exigirModulo(u);
    const mv = await this.movimentos.findOne({ where: { id, empresaId: u.empresaId } });
    if (!mv) throw new NotFoundException('Lançamento não encontrado.');
    const t = mv.turnoId ? await this.turnos.findOne({ where: { id: mv.turnoId } }) : null;
    if (t && !this.podeVerAmbiente(u, t.ambienteId)) throw new ForbiddenException('Ambiente não liberado para você.');
    return { ...mv, valor: Number(mv.valor), turno: t ? { numero: t.numero } : null, ambiente: t ? await this.ambienteNome(t.ambienteId) : '' };
  }

  async config(u: UsuarioToken) {
    const e = await this.empresas.findOne({ where: { id: u.empresaId } });
    const cfg = e?.configCaixa ?? {};
    return {
      saidas: cfg.saidas?.length ? cfg.saidas : ['Pagamento de fornecedor', 'Passagem', 'Padaria', 'Outras despesas'],
      entradas: cfg.entradas?.length ? cfg.entradas : ['Reforço de troco', 'Outras entradas'],
    };
  }

  async salvarConfig(u: UsuarioToken, dto: ConfigCaixaDto) {
    const limpa = (l: string[]) => [...new Set(l.map((x) => x.trim()).filter(Boolean))];
    await this.empresas.update({ id: u.empresaId }, { configCaixa: { saidas: limpa(dto.saidas), entradas: limpa(dto.entradas) } });
    return this.config(u);
  }

  async fechar(u: UsuarioToken, id: string, dto: FecharTurnoDto) {
    await this.exigirModulo(u);
    const t = await this.turnoAberto(u, id);
    const res = await this.resumo(t);
    const contado: Valores = {};
    for (const f of FORMAS) {
      const v = Number(dto.contado?.[f] ?? 0);
      if (!Number.isFinite(v) || v < 0 || v > 10_000_000) throw new BadRequestException('Valor contado inválido.');
      contado[f] = r(c(v));
    }
    const dif: Valores = {};
    for (const f of FORMAS) dif[f] = r(c(contado[f]) - c(res.esperado[f]));
    const diferenca = r(FORMAS.reduce((s, f) => s + c(dif[f]), 0));
    // o que fica de fundo para o próximo turno e o que é entregue à gerência
    const fundo = dto.fundoProximo === undefined || dto.fundoProximo === null ? c(contado.dinheiro) : c(dto.fundoProximo);
    if (fundo < 0 || fundo > c(contado.dinheiro)) throw new BadRequestException('O fundo que fica no caixa não pode ser maior que o dinheiro contado.');
    const retirado = c(contado.dinheiro) - fundo;
    const amb = await this.ambienteNome(t.ambienteId);
    await this.ds.transaction(async (m) => {
      await m.update(CaixaTurno, { id: t.id }, {
        status: 'fechado', fechadoPorId: u.sub, fechadoPor: u.nome, fechadoEm: new Date(),
        esperado: res.esperado, contado, diferenca: diferenca.toFixed(2), observacao: dto.observacao?.trim() || null,
        fundoProximo: r(fundo).toFixed(2), retirado: r(retirado).toFixed(2),
      });
      // tudo o que foi recebido vai para o caixa ADM, por forma (conciliação bancária):
      // dinheiro = o que foi retirado da gaveta; pix/débito/crédito = o que o sistema registrou
      const cnpj = await cnpjDoAmbiente(m, t.ambienteId);
      const entradas: [string, number][] = [['dinheiro', retirado], ...(['pix', 'debito', 'credito'] as const).map((f) => [f, c(res.esperado[f])] as [string, number])];
      for (const [forma, cent] of entradas) {
        if (cent <= 0) continue;
        await m.insert(CaixaMovimento, {
          empresaId: u.empresaId, turnoId: t.id, caixa: 'adm', tipo: 'entrada', forma, valor: r(cent).toFixed(2), cnpj,
          descricao: `${forma === 'dinheiro' ? 'Dinheiro retirado no' : 'Recebido no'} fechamento · turno ${t.numero} (${amb})`, usuarioId: u.sub, usuarioNome: u.nome, autorizadoPor: null,
        });
      }
    });
    return this.detalhe(u, t.id, true);
  }

  async detalhe(u: UsuarioToken, id: string, recemFechado = false) {
    await this.exigirModulo(u);
    const t = await this.turnos.findOne({ where: { id, empresaId: u.empresaId } });
    if (!t) throw new NotFoundException('Turno não encontrado.');
    if (!this.podeVerAmbiente(u, t.ambienteId)) throw new ForbiddenException('Ambiente não liberado para você.');
    // quem não tem relatórios só vê o turno que acabou de fechar (o seu)
    if (!temPermissao(u, 'caixa.relatorios') && !(recemFechado || (t.fechadoPorId === u.sub && t.fechadoEm && Date.now() - t.fechadoEm.getTime() < DIA))) {
      throw new ForbiddenException('Seu perfil não vê relatórios de caixa.');
    }
    const res = await this.resumo(t);
    const pags = await this.pagamentos.find({ where: { turnoId: t.id }, order: { criadoEm: 'ASC' } });
    const ests = pags.length ? await this.estadias.find({ where: { id: In([...new Set(pags.map((p) => p.estadiaId))]) } }) : [];
    const unis = ests.length ? await this.unidades.find({ where: { id: In([...new Set(ests.map((e) => e.unidadeId))]) } }) : [];
    const mapE = new Map(ests.map((e) => [e.id, e]));
    const mapU = new Map(unis.map((x) => [x.id, x.codigo]));
    // ocorrências do turno no ambiente: estornos, cancelamentos, devoluções, correções, trocas de suíte e de cobrança
    const fim = t.fechadoEm ?? new Date();
    const ocorrencias: { criado_em: Date; tipo: string; descricao: string; usuario_nome: string | null; codigo: string; numero: number | null }[] = await this.ds.query(
      `SELECT ev.criado_em, ev.tipo, ev.descricao, ev.usuario_nome, un.codigo, es.numero
         FROM estadia_eventos ev JOIN estadias es ON es.id = ev.estadia_id JOIN unidades un ON un.id = es.unidade_id
        WHERE ev.empresa_id = $1 AND es.ambiente_id = $2 AND ev.criado_em BETWEEN $3 AND $4
          AND ev.tipo IN ('estorno','cancelamento','devolucao','correcao','transferencia','cobranca')
        ORDER BY ev.criado_em`, [u.empresaId, t.ambienteId, t.abertoEm, fim]);
    const estornos: { qtd: string; valor: string }[] = await this.ds.query(
      `SELECT COUNT(*) AS qtd, COALESCE(SUM(it.total), 0) AS valor FROM estadia_itens it JOIN estadias es ON es.id = it.estadia_id
        WHERE it.empresa_id = $1 AND es.ambiente_id = $2 AND it.status = 'estornado' AND it.estornado_em BETWEEN $3 AND $4`, [u.empresaId, t.ambienteId, t.abertoEm, fim]);
    // descontos, acréscimos e cortesias das contas recebidas neste turno
    const ajustes = ests.filter((e) => Number(e.desconto) > 0 || Number(e.acrescimo) > 0).map((e) => ({
      unidade: mapU.get(e.unidadeId) ?? '—', uso: e.numero, desconto: Number(e.desconto), acrescimo: Number(e.acrescimo),
      motivo: e.motivoAjuste, autorizadoPor: e.autorizadoPor, cortesia: e.cortesiaNome, usuario: e.usuarioSaidaNome,
    }));
    const NOME_OC: Record<string, string> = { estorno: 'Estorno', cancelamento: 'Cancelamento', devolucao: 'Devolução', correcao: 'Correção', transferencia: 'Troca de suíte', cobranca: 'Troca de cobrança' };
    return {
      ocorrencias: ocorrencias.map((o) => ({ hora: o.criado_em, tipo: NOME_OC[o.tipo] ?? o.tipo, descricao: o.descricao, usuario: o.usuario_nome, unidade: o.codigo, uso: o.numero })),
      ajustes,
      totais: {
        estornos: Number(estornos[0]?.qtd ?? 0), valorEstornado: Number(estornos[0]?.valor ?? 0),
        cancelamentos: ocorrencias.filter((o) => o.tipo === 'cancelamento').length,
        descontos: Math.round(ajustes.reduce((s2, a) => s2 + a.desconto, 0) * 100) / 100,
      },
      turno: {
        ...t, trocoInicial: Number(t.trocoInicial), diferenca: t.diferenca === null ? null : Number(t.diferenca),
        fundoProximo: t.fundoProximo === null ? null : Number(t.fundoProximo), retirado: t.retirado === null ? null : Number(t.retirado),
      },
      ambiente: await this.ambienteNome(t.ambienteId),
      resumo: res,
      recebimentos: pags.map((p) => {
        const e = mapE.get(p.estadiaId);
        return {
          id: p.id, hora: p.criadoEm, forma: p.forma, valor: Number(p.valor), troco: Number(p.troco), trocoDestino: p.trocoDestino, gorjetaPara: p.gorjetaPara,
          momento: p.momento, usuario: p.usuarioNome, uso: e?.numero ?? null, unidade: e ? mapU.get(e.unidadeId) ?? '—' : '—',
        };
      }),
    };
  }

  async listar(u: UsuarioToken, filtro: { de?: string; ate?: string; ambienteId?: string }) {
    await this.exigirModulo(u);
    const ate = filtro.ate ? new Date(`${filtro.ate}T23:59:59.999-03:00`) : new Date();
    const de = filtro.de ? new Date(`${filtro.de}T00:00:00-03:00`) : new Date(ate.getTime() - 7 * DIA);
    const qb = this.turnos.createQueryBuilder('t').where('t.empresaId = :e', { e: u.empresaId }).andWhere('t.abertoEm BETWEEN :de AND :ate', { de, ate });
    if (u.ambientesIds?.length) qb.andWhere('t.ambienteId IN (:...amb)', { amb: u.ambientesIds });
    if (filtro.ambienteId) qb.andWhere('t.ambienteId = :a', { a: filtro.ambienteId });
    const lista: CaixaTurno[] = await qb.orderBy('t.abertoEm', 'DESC').limit(500).getMany();
    const ambs = await this.ambientes.find({ where: { empresaId: u.empresaId } });
    const nome = new Map(ambs.map((a) => [a.id, a.nome]));
    const saida = [];
    for (const t of lista) {
      const res = await this.resumo(t);
      saida.push({
        id: t.id, numero: t.numero, ambiente: nome.get(t.ambienteId) ?? '', status: t.status, abertoPor: t.abertoPor, abertoEm: t.abertoEm,
        fechadoPor: t.fechadoPor, fechadoEm: t.fechadoEm, totalRecebido: res.totalRecebido, recebido: res.recebido, contas: res.contas,
        totalGorjetas: res.totalGorjetas, sangrias: res.sangrias, totalMovimentado: res.totalMovimentado, diferenca: t.diferenca === null ? null : Number(t.diferenca),
      });
    }
    return saida;
  }

  /* ---------------- penhoras ---------------- */

  async listarPenhoras(u: UsuarioToken, filtro: { status?: string; de?: string; ate?: string }) {
    const qb = this.penhoras.createQueryBuilder('p').where('p.empresaId = :e', { e: u.empresaId });
    if (u.ambientesIds?.length) qb.andWhere('p.ambienteId IN (:...amb)', { amb: u.ambientesIds });
    if (filtro.status === 'aberta' || !filtro.status) qb.andWhere(`p.status = 'aberta'`);
    else {
      const ate = filtro.ate ? new Date(`${filtro.ate}T23:59:59.999-03:00`) : new Date();
      const de = filtro.de ? new Date(`${filtro.de}T00:00:00-03:00`) : new Date(ate.getTime() - 90 * DIA);
      qb.andWhere('p.criadoEm BETWEEN :de AND :ate', { de, ate });
    }
    const lista: Penhora[] = await qb.orderBy('p.criadoEm', 'DESC').limit(1000).getMany();
    const ests = lista.some((p) => p.estadiaId) ? await this.estadias.find({ where: { id: In(lista.filter((p) => p.estadiaId).map((p) => p.estadiaId!)) } }) : [];
    const unis = ests.length ? await this.unidades.find({ where: { id: In([...new Set(ests.map((e) => e.unidadeId))]) } }) : [];
    const mapE = new Map(ests.map((e) => [e.id, e]));
    const mapU = new Map(unis.map((x) => [x.id, x.codigo]));
    const ambs = new Map((await this.ambientes.find({ where: { empresaId: u.empresaId } })).map((a) => [a.id, a.nome]));
    return lista.map((p) => {
      const e = p.estadiaId ? mapE.get(p.estadiaId) : undefined;
      return {
        ...p, valor: Number(p.valor), ambiente: ambs.get(p.ambienteId) ?? '', uso: e?.numero ?? null, unidade: e ? mapU.get(e.unidadeId) ?? '—' : '—',
        placa: e?.placa ?? null,
      };
    });
  }

  private async penhoraAberta(u: UsuarioToken, id: string) {
    const p = await this.penhoras.findOne({ where: { id, empresaId: u.empresaId } });
    if (!p) throw new NotFoundException('Penhora não encontrada.');
    if (!this.podeVerAmbiente(u, p.ambienteId)) throw new ForbiddenException('Ambiente não liberado para você.');
    if (p.status !== 'aberta') throw new BadRequestException('Esta penhora já foi resolvida.');
    return p;
  }

  /** O cliente voltou e pagou: o dinheiro entra no caixa aberto e o objeto é devolvido. */
  async resgatarPenhora(u: UsuarioToken, id: string, dto: ResgatarPenhoraDto) {
    const p = await this.penhoraAberta(u, id);
    const turnoId = await this.turnoParaRecebimento(u.empresaId, p.ambienteId);
    await this.ds.transaction(async (m) => {
      if (turnoId) {
        await m.insert(CaixaMovimento, {
          empresaId: u.empresaId, turnoId, caixa: 'principal', tipo: 'resgate', forma: dto.forma, valor: p.valor,
          descricao: `Penhora paga: ${p.item}`, usuarioId: u.sub, usuarioNome: u.nome, autorizadoPor: null,
        });
      }
      await m.update(Penhora, { id: p.id }, { status: 'resgatada', resolvidaEm: new Date(), resolvidaPor: u.nome, formaResgate: dto.forma, turnoResgateId: turnoId });
      if (p.estadiaId) {
        await m.query(`INSERT INTO estadia_eventos (empresa_id, estadia_id, tipo, descricao, usuario_id, usuario_nome) VALUES ($1, $2, 'penhora', $3, $4, $5)`,
          [u.empresaId, p.estadiaId, `Penhora paga (${dto.forma}) ${brl(c(p.valor))}: ${p.item} devolvido`, u.sub, u.nome]);
      }
    });
    return this.listarPenhoras(u, { status: 'aberta' });
  }

  /** Cliente não voltou: o objeto fica com a casa (ou foi devolvido sem pagar). */
  async baixarPenhora(u: UsuarioToken, id: string, dto: BaixarPenhoraDto) {
    const p = await this.penhoraAberta(u, id);
    await this.penhoras.update({ id: p.id }, { status: 'baixada', resolvidaEm: new Date(), resolvidaPor: u.nome, motivoBaixa: dto.motivo.trim() });
    return this.listarPenhoras(u, { status: 'aberta' });
  }

  /* ---------------- caixa ADM ---------------- */

  async adm(u: UsuarioToken, filtro: { de?: string; ate?: string; cnpj?: string }) {
    await this.exigirModulo(u);
    const ate = filtro.ate ? new Date(`${filtro.ate}T23:59:59.999-03:00`) : new Date();
    const de = filtro.de ? new Date(`${filtro.de}T00:00:00-03:00`) : new Date(ate.getTime() - 30 * DIA);
    const todosEmpresa = await this.movimentos.find({ where: { empresaId: u.empresaId, caixa: 'adm' }, order: { criadoEm: 'DESC' } });
    // vários CNPJs: cada um tem o seu caixa ADM (conciliação com o banco daquele CNPJ)
    const fc = filtro.cnpj;
    const todos = !fc ? todosEmpresa : fc === 'principal' ? todosEmpresa.filter((m) => !m.cnpj) : todosEmpresa.filter((m) => m.cnpj === fc.replace(/\D/g, ''));
    const sinal = (m: CaixaMovimento) => (m.tipo === 'saida' ? -1 : 1) * c(m.valor);
    const saldoPorForma: Record<string, number> = {};
    for (const m of todos) saldoPorForma[m.forma] = (saldoPorForma[m.forma] ?? 0) + sinal(m);
    const periodo = todos.filter((m) => m.criadoEm >= de && m.criadoEm <= ate);
    return {
      saldo: r(todos.reduce((s, m) => s + sinal(m), 0)),
      saldoPorForma: Object.fromEntries(Object.entries(saldoPorForma).map(([k, v]) => [k, r(v)])),
      entradas: r(periodo.filter((m) => m.tipo !== 'saida').reduce((s, m) => s + c(m.valor), 0)),
      /** conciliação: entradas e saídas do período por forma */
      porForma: Object.fromEntries([...new Set(periodo.map((m) => m.forma))].map((f) => {
        const doF = periodo.filter((m) => m.forma === f);
        return [f, { entradas: r(doF.filter((m) => m.tipo !== 'saida').reduce((s, m) => s + c(m.valor), 0)), saidas: r(doF.filter((m) => m.tipo === 'saida').reduce((s, m) => s + c(m.valor), 0)) }];
      })),
      saidas: r(periodo.filter((m) => m.tipo === 'saida').reduce((s, m) => s + c(m.valor), 0)),
      lancamentos: periodo.map((m) => ({ ...m, valor: Number(m.valor) })),
    };
  }

  async lancarAdm(u: UsuarioToken, dto: LancamentoAdmDto) {
    await this.exigirModulo(u);
    await this.movimentos.insert({
      empresaId: u.empresaId, turnoId: null, caixa: 'adm', tipo: dto.tipo, forma: dto.forma, valor: dto.valor.toFixed(2),
      descricao: dto.descricao.trim(), usuarioId: u.sub, usuarioNome: u.nome, autorizadoPor: null, cnpj: cnpjDoForm(dto.cnpj),
    });
    return this.adm(u, { cnpj: dto.cnpj });
  }
}
