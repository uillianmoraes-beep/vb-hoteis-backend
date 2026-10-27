import { Controller, Get, Injectable, Query } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

/**
 * Painéis de gestão:
 * - Insights do dia: frases curtas tiradas dos números (ontem x média, horário de pico de hoje, suítes paradas, descontos, contas do dia).
 * - Auditoria da noite: tudo o que aconteceu de noite num lugar só (caixa, pagamentos sem comprovante, descontos, estornos,
 *   cancelamentos, perdas do estoque, contas abertas há muito tempo), cada item com "ok" ou "atenção".
 */

type Nivel = 'bom' | 'atencao' | 'info';
const tz = `AT TIME ZONE 'America/Sao_Paulo'`;
const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const somaDias = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const DIAS = ['domingos', 'segundas', 'terças', 'quartas', 'quintas', 'sextas', 'sábados'];
const r2 = (n: number) => Math.round(n * 100) / 100;

@Injectable()
export class GestaoService {
  constructor(private readonly ds: DataSource) {}

  private async ambientes(u: UsuarioToken, ambienteId?: string): Promise<string[]> {
    if (ambienteId) return [ambienteId];
    if (u.ambientesIds?.length) return u.ambientesIds;
    return (await this.ds.query(`SELECT id FROM ambientes WHERE empresa_id = $1`, [u.empresaId])).map((a: { id: string }) => a.id);
  }

  async insights(u: UsuarioToken, ambienteId?: string) {
    const ambs = await this.ambientes(u, ambienteId);
    const hoje = hojeSP();
    const ontem = somaDias(hoje, -1);
    const dowOntem = new Date(`${ontem}T12:00:00Z`).getUTCDay();
    const dowHoje = new Date(`${hoje}T12:00:00Z`).getUTCDay();
    const out: { nivel: Nivel; titulo: string; texto: string; link?: string }[] = [];
    const p = [u.empresaId, ambs];

    // ontem x média dos mesmos dias da semana nas 4 semanas antes
    const dias: { dia: string; usos: number; receita: string; descontos: string }[] = await this.ds.query(
      `SELECT to_char(saida_em ${tz}, 'YYYY-MM-DD') AS dia, count(*)::int AS usos, COALESCE(sum(valor_total),0) AS receita, COALESCE(sum(desconto),0) AS descontos
         FROM estadias WHERE empresa_id = $1 AND ambiente_id = ANY($2::uuid[]) AND status = 'fechada'
          AND saida_em >= ($3::date - 28)::timestamp ${tz} AND saida_em < ($3::date + 1)::timestamp ${tz} GROUP BY 1`, [...p, ontem]);
    const doDia = (d: string) => dias.find((x) => x.dia === d);
    const o = doDia(ontem);
    const ant = [7, 14, 21, 28].map((n) => doDia(somaDias(ontem, -n)));
    const mediaRec = ant.reduce((s, x) => s + Number(x?.receita ?? 0), 0) / 4;
    const mediaUsos = ant.reduce((s, x) => s + Number(x?.usos ?? 0), 0) / 4;
    const recOntem = Number(o?.receita ?? 0);
    if (recOntem || mediaRec) {
      const dif = mediaRec ? Math.round(((recOntem - mediaRec) / mediaRec) * 100) : null;
      out.push({
        nivel: dif === null ? 'info' : dif >= 5 ? 'bom' : dif <= -10 ? 'atencao' : 'info',
        titulo: 'Ontem',
        texto: `Faturou ${brl(recOntem)} em ${o?.usos ?? 0} uso(s)${dif !== null ? `, ${Math.abs(dif)}% ${dif >= 0 ? 'acima' : 'abaixo'} da média das últimas 4 ${DIAS[dowOntem]} (${brl(r2(mediaRec))}, ${Math.round(mediaUsos)} usos)` : ''}.`,
        link: '/relatorios/vendas',
      });
    }
    const descOntem = Number(o?.descontos ?? 0);
    if (descOntem > 0 && recOntem > 0) {
      const pct = Math.round((descOntem / (recOntem + descOntem)) * 100);
      out.push({ nivel: pct >= 10 ? 'atencao' : 'info', titulo: 'Descontos', texto: `Ontem saíram ${brl(descOntem)} em descontos e cortesias (${pct}% do que seria vendido).`, link: '/relatorios/liberacoes' });
    }

    // horário de pico de hoje: o que costuma acontecer neste dia da semana (8 semanas)
    const picos: { hora: number; n: number }[] = await this.ds.query(
      `SELECT EXTRACT(HOUR FROM entrada_em ${tz})::int AS hora, count(*)::int AS n FROM estadias
        WHERE empresa_id = $1 AND ambiente_id = ANY($2::uuid[]) AND status <> 'cancelada'
          AND entrada_em >= now() - interval '56 days' AND EXTRACT(DOW FROM entrada_em ${tz}) = $3 GROUP BY 1 ORDER BY 2 DESC LIMIT 2`, [...p, dowHoje]);
    if (picos.length && picos[0].n >= 3) {
      const hs = picos.map((x) => x.hora).sort((a, b) => a - b);
      out.push({ nivel: 'info', titulo: 'Movimento de hoje', texto: `Nas ${DIAS[dowHoje]} o pico de entradas costuma ser ${hs.length > 1 && hs[1] - hs[0] === 1 ? `entre ${hs[0]}h e ${hs[1] + 1}h` : `por volta das ${hs[0]}h`}. Deixe as suítes e a equipe prontas.`, link: '/relatorios/desempenho' });
    }

    // suítes sem uso há 7 dias ou mais
    const paradas: { codigo: string; dias: number | null }[] = await this.ds.query(
      `SELECT un.codigo, (current_date - max(e.entrada_em ${tz})::date)::int AS dias FROM unidades un
         LEFT JOIN estadias e ON e.unidade_id = un.id AND e.status <> 'cancelada'
        WHERE un.empresa_id = $1 AND un.ambiente_id = ANY($2::uuid[]) AND un.ativo AND un.status <> 'bloqueada'
        GROUP BY un.id, un.codigo HAVING max(e.entrada_em) IS NULL OR max(e.entrada_em) < now() - interval '7 days' ORDER BY 2 DESC NULLS FIRST LIMIT 5`, p);
    const [nUsosTotal] = await this.ds.query(`SELECT count(*)::int AS n FROM estadias WHERE empresa_id = $1 AND ambiente_id = ANY($2::uuid[])`, p);
    if (paradas.length && Number(nUsosTotal?.n) > 20) {
      out.push({ nivel: 'atencao', titulo: 'Suítes paradas', texto: `${paradas.map((x) => `${x.codigo}${x.dias !== null ? ` (${x.dias} dias)` : ''}`).join(', ')} sem uso há uma semana ou mais. Confira se estão em ordem.`, link: '/relatorios/desempenho' });
    }

    // ticket médio: últimos 7 dias x 7 anteriores
    const [tk] = await this.ds.query(
      `SELECT COALESCE(avg(valor_total) FILTER (WHERE saida_em >= now() - interval '7 days'), 0) AS a, COALESCE(avg(valor_total) FILTER (WHERE saida_em < now() - interval '7 days'), 0) AS b
         FROM estadias WHERE empresa_id = $1 AND ambiente_id = ANY($2::uuid[]) AND status = 'fechada' AND saida_em >= now() - interval '14 days'`, p);
    const ta = Number(tk?.a ?? 0), tb = Number(tk?.b ?? 0);
    if (ta && tb) {
      const d = Math.round(((ta - tb) / tb) * 100);
      if (Math.abs(d) >= 5) out.push({ nivel: d > 0 ? 'bom' : 'atencao', titulo: 'Ticket médio', texto: `Nos últimos 7 dias o ticket médio foi ${brl(r2(ta))}, ${Math.abs(d)}% ${d > 0 ? 'maior' : 'menor'} que na semana anterior.`, link: '/dashboard' });
    }

    // o que mais vendeu ontem
    const [top] = await this.ds.query(
      `SELECT p.nome, sum(i.quantidade)::numeric AS q FROM estadia_itens i JOIN estadias e ON e.id = i.estadia_id JOIN produtos p ON p.id = i.produto_id
        WHERE i.empresa_id = $1 AND e.ambiente_id = ANY($2::uuid[]) AND i.status = 'ativo' AND (i.criado_em ${tz})::date = $3 GROUP BY p.nome ORDER BY 2 DESC LIMIT 1`, [...p, ontem]);
    if (top) out.push({ nivel: 'info', titulo: 'Mais vendido ontem', texto: `${top.nome}: ${Number(top.q).toLocaleString('pt-BR')} unidade(s).`, link: '/relatorios/desempenho' });

    // estoque abaixo do mínimo e contas do dia
    const [est] = await this.ds.query(
      `SELECT count(DISTINCT s.produto_id)::int AS n FROM estoque_saldos s JOIN estoque_locais l ON l.id = s.local_id WHERE l.empresa_id = $1 AND l.ativo AND s.minimo > 0 AND s.quantidade < s.minimo`, [u.empresaId]).catch(() => [{ n: 0 }]);
    if (Number(est?.n)) out.push({ nivel: 'atencao', titulo: 'Estoque', texto: `${est.n} produto(s) abaixo do estoque mínimo. Monte a cotação antes que falte.`, link: '/compras' });
    const [pagar] = await this.ds.query(
      `SELECT count(*)::int AS n, COALESCE(sum(valor),0) AS v FROM contas_pagar WHERE empresa_id = $1 AND status = 'aberta' AND vencimento <= $2::date`, [u.empresaId, hoje]).catch(() => [{ n: 0, v: 0 }]);
    if (Number(pagar?.n)) out.push({ nivel: 'atencao', titulo: 'Contas a pagar', texto: `${pagar.n} conta(s) vencendo hoje ou atrasada(s): ${brl(Number(pagar.v))}.`, link: '/despesas' });

    // cancelamentos e estornos de ontem
    const [canc] = await this.ds.query(
      `SELECT (SELECT count(*)::int FROM estadias WHERE empresa_id = $1 AND ambiente_id = ANY($2::uuid[]) AND status = 'cancelada' AND (saida_em ${tz})::date = $3) AS entradas,
              (SELECT count(*)::int FROM estadia_itens i JOIN estadias e ON e.id = i.estadia_id WHERE i.empresa_id = $1 AND e.ambiente_id = ANY($2::uuid[]) AND i.status = 'estornado' AND (i.estornado_em ${tz})::date = $3) AS itens`, [...p, ontem]);
    if (Number(canc?.entradas) + Number(canc?.itens) > 0) {
      out.push({ nivel: Number(canc.entradas) >= 3 || Number(canc.itens) >= 5 ? 'atencao' : 'info', titulo: 'Cancelamentos', texto: `Ontem: ${canc.entradas} entrada(s) cancelada(s) e ${canc.itens} item(ns) estornado(s).`, link: '/relatorios/estornos' });
    }
    if (!out.length) out.push({ nivel: 'info', titulo: 'Sem novidades', texto: 'Ainda não há movimento suficiente para tirar conclusões. Os insights aparecem conforme o sistema for usado.' });
    const ordem: Record<Nivel, number> = { atencao: 0, bom: 1, info: 2 };
    return { data: hoje, insights: out.sort((a, b) => ordem[a.nivel] - ordem[b.nivel]) };
  }

  /** a noite: das 18h do dia escolhido às 8h do dia seguinte (ou o horário pedido) */
  async auditoriaNoite(u: UsuarioToken, q: { data?: string; inicio?: string; fim?: string; ambienteId?: string }) {
    const data = q.data && /^\d{4}-\d{2}-\d{2}$/.test(q.data) ? q.data : somaDias(hojeSP(), -1);
    const hi = q.inicio && /^\d{2}:\d{2}$/.test(q.inicio) ? q.inicio : '18:00';
    const hf = q.fim && /^\d{2}:\d{2}$/.test(q.fim) ? q.fim : '08:00';
    const de = new Date(`${data}T${hi}:00-03:00`);
    const ate = new Date(`${hf > hi ? data : somaDias(data, 1)}T${hf}:00-03:00`);
    const ambs = await this.ambientes(u, q.ambienteId);
    const p = [u.empresaId, ambs, de, ate];
    const itens: { chave: string; titulo: string; nivel: 'ok' | 'atencao' | 'info'; resumo: string; linhas?: string[]; link?: string }[] = [];

    // movimento da noite
    const [mov] = await this.ds.query(
      `SELECT count(*)::int AS usos, COALESCE(sum(valor_total),0) AS receita, COALESCE(sum(desconto),0) AS descontos, count(*) FILTER (WHERE desconto > 0)::int AS com_desconto
         FROM estadias WHERE empresa_id = $1 AND ambiente_id = ANY($2::uuid[]) AND status = 'fechada' AND saida_em BETWEEN $3 AND $4`, p);
    const formas: { forma: string; v: string }[] = await this.ds.query(
      `SELECT pg.forma, sum(pg.valor) AS v FROM estadia_pagamentos pg JOIN estadias e ON e.id = pg.estadia_id
        WHERE pg.empresa_id = $1 AND e.ambiente_id = ANY($2::uuid[]) AND pg.criado_em BETWEEN $3 AND $4 GROUP BY 1 ORDER BY 2 DESC`, p);
    const [entr] = await this.ds.query(`SELECT count(*)::int AS n FROM estadias WHERE empresa_id = $1 AND ambiente_id = ANY($2::uuid[]) AND entrada_em BETWEEN $3 AND $4`, p);
    itens.push({ chave: 'movimento', titulo: 'Movimento', nivel: 'info', resumo: `${entr.n} entrada(s), ${mov.usos} conta(s) fechada(s), ${brl(Number(mov.receita))}`,
      linhas: formas.map((f) => `${{ dinheiro: 'Dinheiro', pix: 'Pix', debito: 'Débito', credito: 'Crédito', faturado: 'Faturado', penhora: 'Penhora' }[f.forma] ?? f.forma}: ${brl(Number(f.v))}`), link: '/relatorios/vendas' });

    // caixa: turnos que abriram ou fecharam na noite
    const turnos: Record<string, unknown>[] = await this.ds.query(
      `SELECT t.numero, t.status, t.aberto_por, t.fechado_por, t.aberto_em, t.fechado_em, t.diferenca, a.nome AS ambiente FROM caixa_turnos t JOIN ambientes a ON a.id = t.ambiente_id
        WHERE t.empresa_id = $1 AND t.ambiente_id = ANY($2::uuid[]) AND (t.aberto_em BETWEEN $3 AND $4 OR t.fechado_em BETWEEN $3 AND $4 OR (t.status = 'aberto' AND t.aberto_em < $4))
        ORDER BY t.aberto_em`, p).catch(() => []);
    const comDif = turnos.filter((t) => t.diferenca !== null && Math.abs(Number(t.diferenca)) >= 1);
    const sangrias: { tipo: string; n: number; v: string }[] = await this.ds.query(
      `SELECT m.tipo, count(*)::int AS n, sum(m.valor) AS v FROM caixa_movimentos m JOIN caixa_turnos t ON t.id = m.turno_id
        WHERE m.empresa_id = $1 AND t.ambiente_id = ANY($2::uuid[]) AND m.caixa = 'principal' AND m.tipo IN ('sangria','despesa') AND m.criado_em BETWEEN $3 AND $4 GROUP BY 1`, p).catch(() => []);
    itens.push({
      chave: 'caixa', titulo: 'Caixa', nivel: comDif.length ? 'atencao' : 'ok',
      resumo: turnos.length ? `${turnos.length} turno(s)${comDif.length ? `, ${comDif.length} com diferença` : ', sem diferença'}` : 'Nenhum turno nesta noite',
      linhas: [
        ...turnos.map((t) => `Turno ${t.numero} (${t.ambiente}): ${t.status === 'aberto' ? `aberto por ${t.aberto_por}, ainda não fechou` : `fechado por ${t.fechado_por}${t.diferenca !== null ? `, diferença ${brl(Number(t.diferenca))}` : ''}`}`),
        ...sangrias.map((s) => `${s.tipo === 'sangria' ? 'Sangrias' : 'Despesas pagas no caixa'}: ${s.n} · ${brl(Number(s.v))}`),
      ],
      link: '/caixa?aba=relatorios',
    });

    // pagamentos em cartão ou Pix sem o código do comprovante (atrapalha a conciliação)
    const [semComp] = await this.ds.query(
      `SELECT count(*)::int AS n, COALESCE(sum(pg.valor),0) AS v FROM estadia_pagamentos pg JOIN estadias e ON e.id = pg.estadia_id
        WHERE pg.empresa_id = $1 AND e.ambiente_id = ANY($2::uuid[]) AND pg.forma IN ('debito','credito','pix') AND (pg.comprovante IS NULL OR pg.comprovante = '')
          AND pg.criado_em BETWEEN $3 AND $4`, p);
    itens.push({ chave: 'comprovantes', titulo: 'Cartão e Pix sem comprovante', nivel: Number(semComp.n) ? 'atencao' : 'ok',
      resumo: Number(semComp.n) ? `${semComp.n} pagamento(s) · ${brl(Number(semComp.v))} sem o código (NSU/Pix): confira com a maquininha` : 'Todos com o código do comprovante', link: '/conciliacao' });

    // descontos, cortesias e liberações do gerente
    const libs: Record<string, unknown>[] = await this.ds.query(
      `SELECT acao, pedido_por, liberado_por, detalhe, valor FROM liberacoes WHERE empresa_id = $1 AND (ambiente_id IS NULL OR ambiente_id = ANY($2::uuid[])) AND criado_em BETWEEN $3 AND $4 ORDER BY criado_em`, p).catch(() => []);
    const desc = Number(mov.descontos);
    itens.push({
      chave: 'descontos', titulo: 'Descontos e liberações', nivel: libs.length || (Number(mov.receita) && desc / (Number(mov.receita) + desc) >= 0.1) ? 'atencao' : 'ok',
      resumo: `${mov.com_desconto} conta(s) com desconto (${brl(desc)}) · ${libs.length} liberação(ões) do gerente`,
      linhas: libs.slice(0, 15).map((l) => `${l.acao}: ${l.pedido_por ?? '—'} → liberado por ${l.liberado_por}${l.valor ? ` · ${brl(Number(l.valor))}` : ''}${l.detalhe ? ` · ${l.detalhe}` : ''}`),
      link: '/relatorios/liberacoes',
    });

    // estornos de itens e entradas canceladas
    const est: Record<string, unknown>[] = await this.ds.query(
      `SELECT un.codigo, i.descricao, i.total, i.estornado_por, i.motivo_estorno FROM estadia_itens i JOIN estadias e ON e.id = i.estadia_id JOIN unidades un ON un.id = e.unidade_id
        WHERE i.empresa_id = $1 AND e.ambiente_id = ANY($2::uuid[]) AND i.status = 'estornado' AND i.estornado_em BETWEEN $3 AND $4 ORDER BY i.estornado_em`, p);
    const canc: Record<string, unknown>[] = await this.ds.query(
      `SELECT un.codigo, e.usuario_saida_nome AS quem, e.motivo_ajuste AS motivo FROM estadias e JOIN unidades un ON un.id = e.unidade_id
        WHERE e.empresa_id = $1 AND e.ambiente_id = ANY($2::uuid[]) AND e.status = 'cancelada' AND e.saida_em BETWEEN $3 AND $4`, p);
    itens.push({
      chave: 'estornos', titulo: 'Estornos e cancelamentos', nivel: est.length >= 3 || canc.length >= 2 ? 'atencao' : est.length || canc.length ? 'info' : 'ok',
      resumo: `${est.length} item(ns) estornado(s) · ${canc.length} entrada(s) cancelada(s)`,
      linhas: [
        ...est.slice(0, 15).map((x) => `Suíte ${x.codigo}: ${x.descricao} (${brl(Number(x.total))}) por ${x.estornado_por ?? '—'}${x.motivo_estorno ? ` · ${x.motivo_estorno}` : ''}`),
        ...canc.slice(0, 10).map((x) => `Entrada cancelada na suíte ${x.codigo} por ${x.quem ?? '—'}${x.motivo ? ` · ${x.motivo}` : ''}`),
      ],
      link: '/relatorios/estornos',
    });

    // perdas e ajustes do estoque
    const perdas: Record<string, unknown>[] = await this.ds.query(
      `SELECT p.nome, sum(-m.quantidade) AS q, sum(-m.quantidade * m.custo_unitario) AS v FROM estoque_movimentos m JOIN produtos p ON p.id = m.produto_id
        WHERE m.empresa_id = $1 AND $2::uuid[] IS NOT NULL AND m.quantidade < 0 AND m.tipo IN ('perda','ajuste') AND m.criado_em BETWEEN $3 AND $4 GROUP BY p.nome ORDER BY 3 DESC NULLS LAST LIMIT 10`, p).catch(() => []);
    itens.push({ chave: 'estoque', titulo: 'Perdas e ajustes do estoque', nivel: perdas.length ? 'atencao' : 'ok',
      resumo: perdas.length ? `${perdas.length} produto(s) com saída por perda/ajuste · ${brl(perdas.reduce((s, x) => s + Number(x.v ?? 0), 0))}` : 'Nenhuma perda lançada',
      linhas: perdas.map((x) => `${x.nome}: ${Number(x.q).toLocaleString('pt-BR')}${x.v ? ` · ${brl(Number(x.v))}` : ''}`), link: '/estoque/posicao' });

    // contas abertas há muito tempo no fim da noite
    const abertas: Record<string, unknown>[] = await this.ds.query(
      `SELECT un.codigo, e.entrada_em FROM estadias e JOIN unidades un ON un.id = e.unidade_id
        WHERE e.empresa_id = $1 AND e.ambiente_id = ANY($2::uuid[]) AND e.status IN ('aberta','conta_entregue') AND e.entrada_em < $4::timestamptz - interval '12 hours'
          AND (e.saida_prevista IS NULL OR e.saida_prevista < ($4::timestamptz ${tz})::date) AND $3::timestamptz IS NOT NULL ORDER BY e.entrada_em`, p).catch(() => []);
    itens.push({ chave: 'abertas', titulo: 'Contas abertas há mais de 12 horas', nivel: abertas.length ? 'atencao' : 'ok',
      resumo: abertas.length ? `${abertas.length} conta(s)` : 'Nenhuma',
      linhas: abertas.map((x) => `Suíte ${x.codigo} desde ${new Date(String(x.entrada_em)).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`), link: '/painel' });

    return { data, inicio: hi, fim: hf, de, ate, itens, atencao: itens.filter((i) => i.nivel === 'atencao').length };
  }
}

@Controller('relatorios')
export class GestaoController {
  constructor(private readonly service: GestaoService) {}

  @Get('insights')
  @Requer('relatorios.ver', 'painel.ver')
  insights(@Usuario() u: UsuarioToken, @Query('ambienteId') ambienteId?: string) {
    return this.service.insights(u, ambienteId);
  }

  /** ?data=AAAA-MM-DD (a noite que começa nesse dia) &inicio=18:00&fim=08:00 */
  @Get('auditoria-noite')
  @Requer('relatorios.ver', 'caixa.adm')
  auditoria(@Usuario() u: UsuarioToken, @Query('data') data?: string, @Query('inicio') inicio?: string, @Query('fim') fim?: string, @Query('ambienteId') ambienteId?: string) {
    return this.service.auditoriaNoite(u, { data, inicio, fim, ambienteId });
  }
}
