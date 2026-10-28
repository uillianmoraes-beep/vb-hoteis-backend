import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Estadia } from './estadia.entity';
import { EstadiaEvento } from './estadia-evento.entity';
import { Unidade } from '../unidades/unidade.entity';
import { UsuarioToken } from '../common/permissoes';
import { DesfazerNotaDto, MarcarNotasDto } from './estadias.dto';
import { Empresa } from '../empresas/empresa.entity';
import { limparFiscal } from '../common/fiscal';
import { moduloAtivo } from '../common/modulos';

const DIA = 86_400_000;
const NOME_MODELO: Record<string, string> = { nfce: 'NFC-e', nfse: 'NFS-e', nfe: 'NF-e' };
const SO_FORMA = ['dinheiro', 'pix', 'debito', 'credito', 'faturado', 'penhora', 'cortesia', 'misto'];

/** última nota de cada modelo de uma conta (ou parte), emitida pelo sistema */
interface NotaConta { id: string; tipo: string; nome: string; status: string; numero: string | null; mensagem: string | null; urlPdf: string | null; valor: number; criadoEm: Date }

/** Relatórios de notas: para emitir / emitidas, e marcação de emissão. */
@Injectable()
export class NotasService {
  constructor(
    @InjectRepository(Estadia) private readonly repo: Repository<Estadia>,
    @InjectRepository(EstadiaEvento) private readonly eventos: Repository<EstadiaEvento>,
    @InjectRepository(Unidade) private readonly unidades: Repository<Unidade>,
    @InjectRepository(Empresa) private readonly empresas: Repository<Empresa>,
  ) {}

  /** Tributação do serviço de hospedagem (vale para todas as contas). */
  async config(u: UsuarioToken) {
    const e = await this.empresas.findOne({ where: { id: u.empresaId } });
    return { ativo: moduloAtivo(e?.modulos, 'notas'), hospedagem: e?.fiscal?.hospedagem ?? {} };
  }

  /** O módulo precisa estar contratado. */
  private async exigirModulo(u: UsuarioToken) {
    const e = await this.empresas.findOne({ where: { id: u.empresaId } });
    if (!moduloAtivo(e?.modulos, 'notas')) throw new ForbiddenException('Módulo de notas fiscais não contratado.');
  }

  async salvarConfig(u: UsuarioToken, corpo: { hospedagem?: unknown }) {
    await this.exigirModulo(u);
    const fiscal = { hospedagem: limparFiscal(corpo?.hospedagem) };
    await this.empresas.update({ id: u.empresaId }, { fiscal });
    return fiscal;
  }

  async listar(u: UsuarioToken, filtro: { status?: string; de?: string; ate?: string; ambienteId?: string; forma?: string }) {
    await this.exigirModulo(u);
    const status = filtro.status === 'emitida' ? 'emitida' : 'pendente';
    const ate = filtro.ate ? new Date(`${filtro.ate}T23:59:59.999-03:00`) : new Date();
    const de = filtro.de ? new Date(`${filtro.de}T00:00:00-03:00`) : new Date(ate.getTime() - 30 * DIA);
    if (Number.isNaN(de.getTime()) || Number.isNaN(ate.getTime())) throw new BadRequestException('Período inválido.');
    if (ate.getTime() - de.getTime() > 400 * DIA) throw new BadRequestException('Escolha um período de até 1 ano.');

    // conta com pagador separado tem uma nota por parte (tabela estadia_notas); as duas abas olham as partes
    const qb = this.repo
      .createQueryBuilder('e')
      .where('e.empresaId = :emp', { emp: u.empresaId })
      .andWhere('e.status = :st', { st: 'fechada' })
      .andWhere(`(e.notaStatus = :ns OR (e.notaStatus IN ('pendente','emitida') AND EXISTS (SELECT 1 FROM estadia_notas en WHERE en.estadia_id = e.id AND en.status = :ns)))`, { ns: status })
      .andWhere('e.saidaEm BETWEEN :de AND :ate', { de, ate });
    if (u.ambientesIds?.length) qb.andWhere('e.ambienteId IN (:...amb)', { amb: u.ambientesIds });
    if (filtro.ambienteId) qb.andWhere('e.ambienteId = :a', { a: filtro.ambienteId });
    // forma de pagamento: a conta tem algum pagamento nessa forma (conta dividida entra em cada forma usada)
    if (filtro.forma && SO_FORMA.includes(filtro.forma)) {
      if (filtro.forma === 'misto') qb.andWhere(`e.formaPagamento = 'misto'`);
      else qb.andWhere(`(e.formaPagamento = :fp OR EXISTS (SELECT 1 FROM estadia_pagamentos p WHERE p.estadia_id = e.id AND p.forma = :fp))`, { fp: filtro.forma });
    }
    const lista: Estadia[] = await qb.orderBy('e.saidaEm', 'DESC').limit(2000).getMany();

    const unidades = lista.length ? await this.unidades.find({ where: { id: In([...new Set(lista.map((e) => e.unidadeId))]) } }) : [];
    const cod = new Map<string, string>(unidades.map((x) => [x.id, x.codigo] as [string, string]));
    const n = (v: string | null | undefined) => Number(v ?? 0);
    const partes: { id: string; estadia_id: string; pagador: string; nome: string | null; documento: string | null; parte: string; valor: string; status: string; numero: string | null; emitida_em: Date | null; emitida_por: string | null }[] =
      lista.length ? await this.repo.query(`SELECT * FROM estadia_notas WHERE estadia_id = ANY($1::uuid[]) ORDER BY pagador`, [lista.map((e) => e.id)]) : [];
    const porEstadia = new Map<string, typeof partes>();
    for (const p of partes) porEstadia.set(p.estadia_id, [...(porEstadia.get(p.estadia_id) ?? []), p]);
    const NOME_PARTE: Record<string, string> = { hospedagem: 'hospedagem', consumo: 'consumo', tudo: 'conta toda', resto: 'restante' };
    // avarias/ressarcimento (roupão, copo) ficam fora da nota: indenização, não venda
    const ress: { estadia_id: string; v: string }[] = lista.length ? await this.repo.query(
      `SELECT i.estadia_id, SUM(i.total) AS v FROM estadia_itens i JOIN produtos p ON p.id = i.produto_id
        WHERE i.estadia_id = ANY($1::uuid[]) AND i.status = 'ativo' AND p.ressarcimento GROUP BY i.estadia_id`, [lista.map((e) => e.id)]) : [];
    const ressDe = new Map(ress.map((r) => [r.estadia_id, n(r.v)]));
    const itens = lista.flatMap((e) => {
      const ps = porEstadia.get(e.id);
      if (!ps?.length) {
        const l = this.linha(e, cod, n);
        const r = ressDe.get(e.id) ?? 0;
        return [r ? { ...l, consumo: Math.round((l.consumo - r) * 100) / 100, total: Math.round((l.total - r) * 100) / 100, ressarcimento: r } : l];
      }
      // uma linha por parte (empresa / hóspede), com o documento de quem pagou
      return ps.filter((p) => p.status === status).map((p) => ({
        ...this.linha(e, cod, n),
        id: p.id, estadiaId: e.id, parteId: p.id,
        pagador: p.pagador === 'empresa' ? `Empresa${p.nome ? ` · ${p.nome}` : ''}` : `Hóspede${p.nome ? ` · ${p.nome}` : ''}`,
        parte: NOME_PARTE[p.parte] ?? p.parte,
        hospedagem: p.parte === 'hospedagem' || p.parte === 'tudo' ? n(p.valor) : 0,
        consumo: p.parte === 'consumo' ? n(p.valor) : 0,
        total: n(p.valor),
        documento: p.documento,
        notaNumero: p.numero, notaEmitidaEm: p.emitida_em, notaEmitidaPor: p.emitida_por,
      }));
    });
    // notas do sistema de cada linha: situação certa (processando, recusada) e os modelos emitidos
    const notas = await this.notasDasContas(lista.map((e) => e.id));
    const comNotas = itens.map((i) => {
      const ns = notas.filter((n) => n.estadiaId === (i.estadiaId ?? i.id) && n.parteId === (i.parteId ?? null)).map(({ estadiaId: _e, parteId: _p, ...n }) => n);
      const situacao = status === 'emitida' ? 'emitida' : ns.some((n) => n.status === 'processando') ? 'processando' : ns.some((n) => n.status === 'erro') ? 'recusada' : 'pendente';
      return { ...i, notas: ns, situacao };
    });
    // totais por modelo de nota (só as autorizadas contam como emitidas)
    const modelos: Record<string, { nome: string; quantidade: number; valor: number; processando: number; recusadas: number }> = {};
    for (const n of comNotas.flatMap((i) => i.notas)) {
      const m = (modelos[n.tipo] ??= { nome: n.nome, quantidade: 0, valor: 0, processando: 0, recusadas: 0 });
      if (n.status === 'autorizado') { m.quantidade++; m.valor = Math.round((m.valor + n.valor) * 100) / 100; }
      if (n.status === 'processando') m.processando++;
      if (n.status === 'erro') m.recusadas++;
    }
    return { status, de, ate, itens: comNotas, totais: this.totais(itens), modelos: Object.entries(modelos).map(([tipo, m]) => ({ tipo, ...m })) };
  }

  /** última tentativa de cada modelo de nota (NFC-e, NFS-e, NF-e) das contas */
  private async notasDasContas(ids: string[]): Promise<(NotaConta & { estadiaId: string; parteId: string | null })[]> {
    if (!ids.length) return [];
    const l: Record<string, unknown>[] = await this.repo.query(
      `SELECT DISTINCT ON (estadia_id, parte_id, CASE WHEN tipo = 'nfsen' THEN 'nfse' ELSE tipo END)
              id, estadia_id, parte_id, CASE WHEN tipo = 'nfsen' THEN 'nfse' ELSE tipo END AS tipo, status, numero, mensagem, url_pdf, valor_total, criado_em
         FROM notas_fiscais WHERE estadia_id = ANY($1::uuid[]) AND tipo <> 'devolucao'
        ORDER BY estadia_id, parte_id, CASE WHEN tipo = 'nfsen' THEN 'nfse' ELSE tipo END, criado_em DESC`, [ids]).catch(() => []);
    return l.map((n) => ({
      id: n.id as string, estadiaId: n.estadia_id as string, parteId: (n.parte_id as string | null) ?? null, tipo: n.tipo as string,
      nome: NOME_MODELO[n.tipo as string] ?? String(n.tipo), status: n.status as string, numero: (n.numero as string | null) ?? null,
      mensagem: (n.mensagem as string | null) ?? null, urlPdf: (n.url_pdf as string | null) ?? null, valor: Number(n.valor_total ?? 0), criadoEm: n.criado_em as Date,
    }));
  }

  /** últimas contas fechadas da suíte/quarto, com as notas (para a recepção emitir ou conferir depois) */
  async daUnidade(u: UsuarioToken, unidadeId: string, limite = 3) {
    const e = await this.empresas.findOne({ where: { id: u.empresaId } });
    if (!moduloAtivo(e?.modulos, 'notas')) return [];
    const contas: Estadia[] = await this.repo.createQueryBuilder('e')
      .where('e.empresaId = :emp AND e.unidadeId = :un AND e.status = :st', { emp: u.empresaId, un: unidadeId, st: 'fechada' })
      .andWhere(u.ambientesIds?.length ? 'e.ambienteId IN (:...amb)' : '1=1', { amb: u.ambientesIds ?? [] })
      .orderBy('e.saidaEm', 'DESC').limit(Math.min(Math.max(limite, 1), 10)).getMany();
    const notas = await this.notasDasContas(contas.map((c) => c.id));
    return contas.map((c) => ({
      id: c.id, numero: c.numero, entradaEm: c.entradaEm, saidaEm: c.saidaEm, total: Number(c.valorTotal ?? 0), formaPagamento: c.formaPagamento,
      notaStatus: c.notaStatus, notaNumero: c.notaNumero,
      notas: notas.filter((n) => n.estadiaId === c.id).map(({ estadiaId: _e, parteId, ...n }) => ({ ...n, parteId })),
    }));
  }

  private totais(itens: { hospedagem: number; consumo: number; total: number }[]) {
    const soma = (k: 'hospedagem' | 'consumo' | 'total') => Math.round(itens.reduce((s, i) => s + i[k], 0) * 100) / 100;
    return { quantidade: itens.length, hospedagem: soma('hospedagem'), consumo: soma('consumo'), total: soma('total') };
  }

  private linha(e: Estadia, cod: Map<string, string>, n: (v: string | null | undefined) => number) {
    return {
      id: e.id,
      numero: e.numero,
      codigo: cod.get(e.unidadeId) ?? '—',
      entradaEm: e.entradaEm,
      saidaEm: e.saidaEm,
      placa: e.placa,
      hospedagem: n(e.valorHospedagem) + n(e.valorPessoas),
      consumo: n(e.valorConsumo),
      desconto: n(e.desconto),
      acrescimo: n(e.acrescimo),
      total: n(e.valorTotal),
      formaPagamento: e.formaPagamento,
      usuario: e.usuarioSaidaNome,
      notaNumero: e.notaNumero,
      notaEmitidaEm: e.notaEmitidaEm,
      notaEmitidaPor: e.notaEmitidaPor,
      documento: e.notaDocumento,
      estadiaId: e.id,
      parteId: null as string | null,
      pagador: null as string | null,
      parte: null as string | null,
    };
  }

  /** partes (pagador separado) marcadas como emitidas; a conta fica emitida quando todas estiverem */
  private async marcarPartes(u: UsuarioToken, ids: string[], numero: string | null) {
    if (!ids.length) return { feitas: 0, usados: new Set<string>() };
    const partes: { id: string; estadia_id: string; status: string; ambiente_id: string; pagador: string }[] = await this.repo.query(
      `SELECT en.id, en.estadia_id, en.status, en.pagador, e.ambiente_id FROM estadia_notas en JOIN estadias e ON e.id = en.estadia_id
        WHERE en.empresa_id = $1 AND (en.id = ANY($2::uuid[]) OR en.estadia_id = ANY($2::uuid[]))`, [u.empresaId, ids]);
    const validas = partes.filter((p) => p.status === 'pendente' && (!u.ambientesIds?.length || u.ambientesIds.includes(p.ambiente_id)));
    if (numero && validas.length > 1) throw new BadRequestException('Número da nota só para uma nota por vez.');
    const usados = new Set<string>([...partes.map((p) => p.id), ...partes.map((p) => p.estadia_id)]);
    if (!validas.length) return { feitas: 0, usados };
    await this.repo.query(`UPDATE estadia_notas SET status = 'emitida', numero = $2, emitida_em = now(), emitida_por = $3 WHERE id = ANY($1::uuid[])`,
      [validas.map((p) => p.id), numero, u.nome]);
    const contas = [...new Set(validas.map((p) => p.estadia_id))];
    await this.repo.query(
      `UPDATE estadias e SET nota_status = 'emitida', nota_emitida_em = now(), nota_emitida_por = $2
        WHERE e.id = ANY($1::uuid[]) AND NOT EXISTS (SELECT 1 FROM estadia_notas en WHERE en.estadia_id = e.id AND en.status <> 'emitida')`, [contas, u.nome]);
    await this.eventos.insert(validas.map((p) => ({
      empresaId: u.empresaId, estadiaId: p.estadia_id, tipo: 'nota', usuarioId: u.sub, usuarioNome: u.nome,
      descricao: `Nota da parte ${p.pagador === 'empresa' ? 'da empresa' : 'do hóspede'} emitida${numero ? ` nº ${numero}` : ''}`,
    })));
    return { feitas: validas.length, usados };
  }

  async marcarEmitidas(u: UsuarioToken, dto: MarcarNotasDto) {
    await this.exigirModulo(u);
    if (!dto.ids.length) throw new BadRequestException('Escolha pelo menos uma conta.');
    const numeroParte = dto.numero?.trim() || null;
    const r = await this.marcarPartes(u, dto.ids, numeroParte);
    dto = { ...dto, ids: dto.ids.filter((i) => !r.usados.has(i)) };
    if (!dto.ids.length) {
      if (!r.feitas) throw new BadRequestException('Nenhuma dessas notas está aguardando emissão.');
      return { marcadas: r.feitas };
    }
    const contas = await this.repo.find({ where: { id: In(dto.ids), empresaId: u.empresaId } });
    const validas = contas.filter((e) => e.status === 'fechada' && e.notaStatus === 'pendente' && (!u.ambientesIds?.length || u.ambientesIds.includes(e.ambienteId)));
    if (!validas.length) {
      if (r.feitas) return { marcadas: r.feitas };
      throw new BadRequestException('Nenhuma dessas contas está aguardando nota.');
    }
    const numero = dto.numero?.trim() || null;
    if (numero && validas.length > 1) throw new BadRequestException('Número da nota só para uma conta por vez.');
    const agora = new Date();
    await this.repo.update({ id: In(validas.map((e) => e.id)) }, { notaStatus: 'emitida', notaNumero: numero, notaEmitidaEm: agora, notaEmitidaPor: u.nome });
    await this.eventos.insert(validas.map((e) => ({
      empresaId: u.empresaId, estadiaId: e.id, tipo: 'nota', usuarioId: u.sub, usuarioNome: u.nome,
      descricao: `Nota fiscal emitida${numero ? ` nº ${numero}` : ''}`,
    })));
    return { marcadas: validas.length + r.feitas };
  }

  async desfazer(u: UsuarioToken, id: string, dto: DesfazerNotaDto) {
    // parte de uma conta com pagador separado
    const [parte] = await this.repo.query(`SELECT id, estadia_id, status, numero, pagador FROM estadia_notas WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (parte) {
      if (parte.status !== 'emitida') throw new BadRequestException('Esta nota não está emitida.');
      await this.repo.query(`UPDATE estadia_notas SET status = 'pendente', numero = NULL, emitida_em = NULL, emitida_por = NULL WHERE id = $1`, [id]);
      await this.repo.update({ id: parte.estadia_id }, { notaStatus: 'pendente', notaNumero: null, notaEmitidaEm: null, notaEmitidaPor: null });
      await this.eventos.insert({
        empresaId: u.empresaId, estadiaId: parte.estadia_id, tipo: 'nota', usuarioId: u.sub, usuarioNome: u.nome,
        descricao: `Emissão da nota ${parte.pagador === 'empresa' ? 'da empresa' : 'do hóspede'} desfeita${parte.numero ? ` (era nº ${parte.numero})` : ''} · ${dto.motivo.trim()}`,
      });
      return { ok: true };
    }
    const e = await this.repo.findOne({ where: { id, empresaId: u.empresaId } });
    if (!e) throw new NotFoundException('Conta não encontrada.');
    if (e.notaStatus !== 'emitida') throw new BadRequestException('Esta conta não está com nota emitida.');
    await this.repo.update({ id }, { notaStatus: 'pendente', notaNumero: null, notaEmitidaEm: null, notaEmitidaPor: null });
    await this.eventos.insert({
      empresaId: u.empresaId, estadiaId: id, tipo: 'nota', usuarioId: u.sub, usuarioNome: u.nome,
      descricao: `Emissão da nota desfeita${e.notaNumero ? ` (era nº ${e.notaNumero})` : ''} · ${dto.motivo.trim()}`,
    });
    return { ok: true };
  }
}
