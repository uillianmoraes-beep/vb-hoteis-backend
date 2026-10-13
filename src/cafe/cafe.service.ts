import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CafeItemDto, CriarListaDto, FecharListaDto } from './cafe.dto';
import { UsuarioToken } from '../common/permissoes';

const FUSO = 'America/Sao_Paulo';
const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: FUSO });
const dia = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const somaDias = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const r3 = (v: number) => Math.round(v * 1000) / 1000;
/** arredonda para cima no passo (com folga para erro de ponto flutuante) */
const acima = (v: number, passo: number) => (v <= 0 ? 0 : r3(Math.ceil(v / passo - 1e-9) * passo));

export interface ItemLista {
  itemId: string; nome: string; grupo: string | null; unidade: string; porPessoa: number; necessario: number; sobraUsada: number; produzir: number;
  reaproveita: boolean; sobrou?: number;
}

const fmtItem = (i: Record<string, unknown>) => ({
  id: i.id, nome: i.nome, grupo: i.grupo, unidade: i.unidade, porPessoa: Number(i.por_pessoa), passo: Number(i.passo),
  reaproveita: i.reaproveita, sobra: Number(i.sobra), ordem: i.ordem, ativo: i.ativo,
});
const fmtLista = (l: Record<string, unknown>) => ({
  id: l.id, data: dia(l.data), hospedados: l.hospedados, chegando: l.chegando, ajuste: l.ajuste, total: l.total, itens: l.itens as ItemLista[],
  status: l.status, observacao: l.observacao, criadoPor: l.criado_por, criadoEm: l.criado_em, fechadoPor: l.fechado_por, fechadoEm: l.fechado_em,
});

@Injectable()
export class CafeService {
  constructor(private readonly ds: DataSource) {}

  /* ---------- composição ---------- */

  async itens(u: UsuarioToken, todos = false) {
    const l = await this.ds.query(`SELECT * FROM cafe_itens WHERE empresa_id = $1 ${todos ? '' : 'AND ativo = true'} ORDER BY ordem, grupo NULLS LAST, nome`, [u.empresaId]);
    return l.map(fmtItem);
  }

  private vals(dto: CafeItemDto) {
    return [dto.nome.trim(), dto.grupo?.trim() || null, dto.unidade.trim(), dto.porPessoa, dto.passo ?? 1, dto.reaproveita ?? true, dto.ordem ?? 0, dto.ativo ?? true];
  }

  async criarItem(u: UsuarioToken, dto: CafeItemDto) {
    await this.ds.query(
      `INSERT INTO cafe_itens (empresa_id, nome, grupo, unidade, por_pessoa, passo, reaproveita, ordem, ativo, sobra) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [u.empresaId, ...this.vals(dto), dto.sobra ?? 0]);
    return { ok: true };
  }

  async atualizarItem(u: UsuarioToken, id: string, dto: CafeItemDto) {
    const [i] = await this.ds.query(`SELECT id FROM cafe_itens WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!i) throw new NotFoundException('Item não encontrado.');
    await this.ds.query(
      `UPDATE cafe_itens SET nome=$3, grupo=$4, unidade=$5, por_pessoa=$6, passo=$7, reaproveita=$8, ordem=$9, ativo=$10, sobra=COALESCE($11, sobra) WHERE id=$1 AND empresa_id=$2`,
      [id, u.empresaId, ...this.vals(dto), dto.sobra ?? null]);
    return { ok: true };
  }

  /* ---------- quantas pessoas tomam café na manhã do dia D ---------- */

  /**
   * Toma café na manhã de D quem dorme a noite de D-1 para D:
   *  - quem já está hospedado (conta aberta em hotel/pousada) e não sai antes de D;
   *  - reservas que ainda vão chegar (chegada até D-1, saída a partir de D).
   */
  async pessoas(u: UsuarioToken, data: string) {
    const hoje = hojeSP();
    const vespera = somaDias(data, -1);
    const [h] = await this.ds.query(
      `SELECT COALESCE(SUM(e.pessoas),0)::int AS n, count(*)::int AS quartos
         FROM estadias e JOIN ambientes a ON a.id = e.ambiente_id
        WHERE e.empresa_id = $1 AND e.status IN ('aberta','conta_entregue') AND a.tipo IN ('hotel','pousada')
          AND (e.entrada_em AT TIME ZONE '${FUSO}')::date <= $3::date
          AND COALESCE(e.saida_prevista, ($4::date + 1)) >= $2::date`,
      [u.empresaId, data, vespera, hoje]);
    const res = await this.ds.query(
      `SELECT chegada, (adultos + criancas)::int AS n FROM reservas
        WHERE empresa_id = $1 AND status IN ('pendente','confirmada') AND chegada <= $3::date AND saida >= $2::date`, [u.empresaId, data, vespera]);
    let chegamHoje = 0;
    let chegamDepois = 0;
    let atrasados = 0;
    for (const r of res) {
      const c = dia(r.chegada);
      if (c === hoje) chegamHoje += r.n;
      else if (c > hoje) chegamDepois += r.n;
      else atrasados += r.n; // reserva com chegada passada e sem check-in (talvez no-show)
    }
    const hospedados = Number(h?.n ?? 0);
    return { data, hospedados, quartosOcupados: Number(h?.quartos ?? 0), chegamHoje, chegamDepois, atrasados, total: hospedados + chegamHoje + chegamDepois + atrasados };
  }

  private calcular(itens: ReturnType<typeof fmtItem>[], pessoas: number): ItemLista[] {
    return itens.map((i) => {
      const necessario = acima(i.porPessoa * pessoas, i.passo);
      const sobraUsada = i.reaproveita ? r3(Math.min(i.sobra, necessario)) : 0;
      return {
        itemId: i.id as string, nome: i.nome as string, grupo: (i.grupo as string) ?? null, unidade: i.unidade as string, porPessoa: i.porPessoa,
        necessario, sobraUsada, produzir: acima(Math.max(0, necessario - sobraUsada), i.passo), reaproveita: !!i.reaproveita,
      };
    });
  }

  async previsao(u: UsuarioToken, data?: string, ajuste = 0) {
    const d = data && /^\d{4}-\d{2}-\d{2}$/.test(data) ? data : somaDias(hojeSP(), 1);
    const p = await this.pessoas(u, d);
    const total = Math.max(0, p.total + ajuste);
    const [lista] = await this.ds.query(`SELECT * FROM cafe_listas WHERE empresa_id = $1 AND data = $2`, [u.empresaId, d]);
    return { ...p, ajuste, totalComAjuste: total, itens: this.calcular(await this.itens(u), total), lista: lista ? fmtLista(lista) : null };
  }

  /* ---------- listas ---------- */

  async criarLista(u: UsuarioToken, dto: CriarListaDto) {
    const [existe] = await this.ds.query(`SELECT id, status FROM cafe_listas WHERE empresa_id = $1 AND data = $2`, [u.empresaId, dto.data]);
    if (existe?.status === 'fechada') throw new BadRequestException('A lista deste dia já foi fechada.');
    const p = await this.pessoas(u, dto.data);
    const ajuste = dto.ajuste ?? 0;
    const total = Math.max(0, p.total + ajuste);
    const itens = this.calcular(await this.itens(u), total);
    if (!itens.length) throw new BadRequestException('Cadastre primeiro o que é servido no café (composição).');
    const vals = [p.hospedados, p.chegamHoje + p.chegamDepois + p.atrasados, ajuste, total, JSON.stringify(itens), dto.observacao?.trim() || null, u.nome];
    if (existe) {
      // refaz a lista (mudou o número de hóspedes)
      await this.ds.query(`UPDATE cafe_listas SET hospedados=$2, chegando=$3, ajuste=$4, total=$5, itens=$6::jsonb, observacao=$7, criado_por=$8, criado_em=now() WHERE id=$1`, [existe.id, ...vals]);
      return { ok: true, id: existe.id };
    }
    const [l] = await this.ds.query(
      `INSERT INTO cafe_listas (empresa_id, data, hospedados, chegando, ajuste, total, itens, observacao, criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9) RETURNING id`,
      [u.empresaId, dto.data, ...vals]);
    return { ok: true, id: l.id };
  }

  async listas(u: UsuarioToken, de?: string, ate?: string) {
    const fim = ate && /^\d{4}-\d{2}-\d{2}$/.test(ate) ? ate : somaDias(hojeSP(), 7);
    const ini = de && /^\d{4}-\d{2}-\d{2}$/.test(de) ? de : somaDias(fim, -45);
    const l = await this.ds.query(`SELECT * FROM cafe_listas WHERE empresa_id = $1 AND data BETWEEN $2 AND $3 ORDER BY data DESC`, [u.empresaId, ini, fim]);
    return l.map(fmtLista);
  }

  async lista(u: UsuarioToken, id: string) {
    const [l] = await this.ds.query(`SELECT * FROM cafe_listas WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!l) throw new NotFoundException('Lista não encontrada.');
    const [emp] = await this.ds.query(`SELECT nome FROM empresas WHERE id = $1`, [u.empresaId]);
    return { ...fmtLista(l), empresa: emp?.nome ?? '' };
  }

  /** retorno do café: o que sobrou volta como saldo para o próximo (se o item reaproveita) */
  async fechar(u: UsuarioToken, id: string, dto: FecharListaDto) {
    await this.ds.transaction(async (m) => {
      const [l] = await m.query(`SELECT * FROM cafe_listas WHERE id = $1 AND empresa_id = $2 FOR UPDATE`, [id, u.empresaId]);
      if (!l) throw new NotFoundException('Lista não encontrada.');
      if (l.status === 'fechada') throw new BadRequestException('Esta lista já foi fechada.');
      const sobras = new Map(dto.retorno.map((r) => [r.itemId, r3(r.sobrou)]));
      const itens: ItemLista[] = (l.itens as ItemLista[]).map((i) => ({ ...i, sobrou: sobras.get(i.itemId) ?? 0 }));
      for (const i of itens) {
        // o saldo vira exatamente o que sobrou agora (a sobra antiga foi usada neste café)
        if (i.reaproveita) await m.query(`UPDATE cafe_itens SET sobra = $3 WHERE id = $1 AND empresa_id = $2`, [i.itemId, u.empresaId, i.sobrou]);
      }
      await m.query(`UPDATE cafe_listas SET itens = $2::jsonb, status = 'fechada', fechado_por = $3, fechado_em = now(), observacao = COALESCE($4, observacao) WHERE id = $1`,
        [id, JSON.stringify(itens), u.nome, dto.observacao?.trim() || null]);
    });
    return { ok: true };
  }

  async reabrir(u: UsuarioToken, id: string) {
    const [l] = await this.ds.query(`SELECT status FROM cafe_listas WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!l) throw new NotFoundException('Lista não encontrada.');
    if (l.status !== 'fechada') throw new BadRequestException('A lista não está fechada.');
    await this.ds.query(`UPDATE cafe_listas SET status = 'aberta', fechado_por = NULL, fechado_em = NULL WHERE id = $1`, [id]);
    return { ok: true };
  }

  /** relatório: consumo real por pessoa de cada item no período (para acertar a composição) */
  async relatorio(u: UsuarioToken, de?: string, ate?: string) {
    const fim = ate && /^\d{4}-\d{2}-\d{2}$/.test(ate) ? ate : hojeSP();
    const ini = de && /^\d{4}-\d{2}-\d{2}$/.test(de) ? de : somaDias(fim, -30);
    const ls = await this.ds.query(`SELECT * FROM cafe_listas WHERE empresa_id = $1 AND status = 'fechada' AND data BETWEEN $2 AND $3 ORDER BY data`, [u.empresaId, ini, fim]);
    const pessoas = ls.reduce((s: number, l: Record<string, unknown>) => s + Number(l.total), 0);
    const mapa = new Map<string, { nome: string; unidade: string; porPessoa: number; produzido: number; sobraUsada: number; sobrou: number; desperdicio: number }>();
    for (const l of ls) {
      for (const i of l.itens as ItemLista[]) {
        const a = mapa.get(i.itemId) ?? { nome: i.nome, unidade: i.unidade, porPessoa: i.porPessoa, produzido: 0, sobraUsada: 0, sobrou: 0, desperdicio: 0 };
        a.produzido += i.produzir;
        a.sobraUsada += i.sobraUsada;
        a.sobrou += i.sobrou ?? 0;
        if (!i.reaproveita) a.desperdicio += i.sobrou ?? 0;
        a.porPessoa = i.porPessoa;
        mapa.set(i.itemId, a);
      }
    }
    const itens = [...mapa.entries()].map(([itemId, a]) => {
      const consumido = r3(a.produzido + a.sobraUsada - a.sobrou);
      return {
        itemId, nome: a.nome, unidade: a.unidade, porPessoaCadastrado: a.porPessoa, produzido: r3(a.produzido), sobraUsada: r3(a.sobraUsada), sobrou: r3(a.sobrou),
        desperdicio: r3(a.desperdicio), consumido, porPessoaReal: pessoas ? Math.round((consumido / pessoas) * 10000) / 10000 : null,
      };
    });
    return { de: ini, ate: fim, cafes: ls.length, pessoas, mediaPessoas: ls.length ? Math.round(pessoas / ls.length) : 0, itens,
      dias: ls.map((l: Record<string, unknown>) => ({ id: l.id, data: dia(l.data), total: l.total })) };
  }
}
