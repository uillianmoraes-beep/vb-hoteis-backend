import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Estadia } from '../estadias/estadia.entity';
import { EstadiaPagamento } from '../estadias/estadia-pagamento.entity';
import { Unidade } from '../unidades/unidade.entity';
import { Ambiente } from '../ambientes/ambiente.entity';
import { Categoria } from '../categorias/categoria.entity';
import { UsuarioToken } from '../common/permissoes';

const DIA = 86_400_000;
const c = (v: number | string | null | undefined) => Math.round(Number(v ?? 0) * 100);
const r = (cent: number) => Math.round(cent) / 100;

@Injectable()
export class RelatoriosService {
  constructor(
    @InjectRepository(Estadia) private readonly estadias: Repository<Estadia>,
    @InjectRepository(EstadiaPagamento) private readonly pagamentos: Repository<EstadiaPagamento>,
    @InjectRepository(Unidade) private readonly unidades: Repository<Unidade>,
    @InjectRepository(Ambiente) private readonly ambientes: Repository<Ambiente>,
    @InjectRepository(Categoria) private readonly categorias: Repository<Categoria>,
  ) {}

  /**
   * Dashboard: indicadores do período (motel e hotel).
   * Ocupação/giro/RevPAR usam as suítes ativas do ambiente e as contas fechadas no período.
   */
  async dashboard(u: UsuarioToken, filtro: { dias?: number; ambienteId?: string }) {
    const dias = Math.min(365, Math.max(1, filtro.dias ?? 30));
    const ambs: string[] = filtro.ambienteId ? [filtro.ambienteId]
      : u.ambientesIds?.length ? u.ambientesIds
      : (await this.ambientes.find({ where: { empresaId: u.empresaId, ativo: true } })).map((a) => a.id);
    if (!ambs.length) return null;
    const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    const ini = new Date(new Date(`${hoje}T00:00:00-03:00`).getTime() - (dias - 1) * DIA);
    const q = (sql: string, p: unknown[] = []) => this.estadias.query(sql, [u.empresaId, ambs, ini, ...p]);
    const base = `FROM estadias e WHERE e.empresa_id = $1 AND e.ambiente_id = ANY($2::uuid[]) AND e.status = 'fechada' AND e.saida_em >= $3`;
    const [tot] = await q(`SELECT count(*)::int AS usos, COALESCE(sum(valor_total),0) AS receita, COALESCE(sum(valor_hospedagem + COALESCE(valor_pessoas,0)),0) AS hosp,
      COALESCE(sum(valor_consumo),0) AS consumo, COALESCE(sum(desconto),0) AS descontos,
      COALESCE(sum(EXTRACT(EPOCH FROM (saida_em - entrada_em)) / 60),0) AS minutos ${base}`);
    const porDia = await q(`SELECT to_char(e.saida_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS dia, count(*)::int AS usos, COALESCE(sum(valor_total),0) AS receita ${base} GROUP BY 1 ORDER BY 1`);
    const porHora = await this.estadias.query(
      `SELECT EXTRACT(HOUR FROM e.entrada_em AT TIME ZONE 'America/Sao_Paulo')::int AS hora, count(*)::int AS n FROM estadias e
       WHERE e.empresa_id = $1 AND e.ambiente_id = ANY($2::uuid[]) AND e.status <> 'cancelada' AND e.entrada_em >= $3 GROUP BY 1 ORDER BY 1`, [u.empresaId, ambs, ini]);
    const porCat = await q(`SELECT COALESCE(c.nome, 'Sem categoria') AS nome, count(*)::int AS usos, COALESCE(sum(e.valor_total),0) AS receita
      FROM estadias e LEFT JOIN unidades un ON un.id = e.unidade_id LEFT JOIN categorias c ON c.id = COALESCE(e.categoria_id, un.categoria_id)
      WHERE e.empresa_id = $1 AND e.ambiente_id = ANY($2::uuid[]) AND e.status = 'fechada' AND e.saida_em >= $3 GROUP BY 1 ORDER BY 3 DESC`);
    const [nSuites] = await this.estadias.query(`SELECT count(*)::int AS n FROM unidades WHERE empresa_id = $1 AND ambiente_id = ANY($2::uuid[]) AND ativo`, [u.empresaId, ambs]);
    const [hojeTot] = await this.estadias.query(`SELECT count(*)::int AS usos, COALESCE(sum(valor_total),0) AS receita FROM estadias e
      WHERE e.empresa_id = $1 AND e.ambiente_id = ANY($2::uuid[]) AND e.status = 'fechada' AND e.saida_em >= $3`, [u.empresaId, ambs, new Date(`${hoje}T00:00:00-03:00`)]);
    const [agora] = await this.estadias.query(`SELECT count(*) FILTER (WHERE status IN ('ocupada','conta_entregue','paga'))::int AS uso, count(*)::int AS total FROM unidades WHERE empresa_id = $1 AND ambiente_id = ANY($2::uuid[]) AND ativo`, [u.empresaId, ambs]);
    const suites = Number(nSuites?.n ?? 0);
    const usos = Number(tot.usos);
    const receita = Number(tot.receita);
    const hosp = Number(tot.hosp);
    const capacidade = suites * dias;
    // série completa (dias sem movimento = 0)
    const mapa = new Map(porDia.map((d: { dia: string; usos: number; receita: string }) => [d.dia, d]));
    const serie = Array.from({ length: dias }, (_, i) => {
      const dia = new Date(ini.getTime() + i * DIA + 12 * 3600_000).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
      const d = mapa.get(dia) as { usos: number; receita: string } | undefined;
      return { dia, usos: d ? Number(d.usos) : 0, receita: d ? Number(d.receita) : 0 };
    });
    const horas = Array.from({ length: 24 }, (_, h) => ({ hora: h, entradas: Number(porHora.find((x: { hora: number }) => Number(x.hora) === h)?.n ?? 0) }));
    return {
      dias, suites,
      hoje: { usos: Number(hojeTot.usos), receita: Number(hojeTot.receita) },
      agora: { emUso: Number(agora.uso), total: Number(agora.total), ocupacaoPct: Number(agora.total) ? Math.round((Number(agora.uso) / Number(agora.total)) * 100) : 0 },
      periodo: {
        usos, receita, hospedagem: hosp, consumo: Number(tot.consumo), descontos: Number(tot.descontos),
        ticketMedio: usos ? Math.round((receita / usos) * 100) / 100 : 0,
        permanenciaMediaMin: usos ? Math.round(Number(tot.minutos) / usos) : 0,
        /** giro: usos por suíte por dia */
        giro: capacidade ? Math.round((usos / capacidade) * 100) / 100 : 0,
        /** ocupação média: tempo ocupado / tempo disponível */
        ocupacaoPct: capacidade ? Math.min(100, Math.round((Number(tot.minutos) / (capacidade * 1440)) * 100)) : 0,
        adr: usos ? Math.round((hosp / usos) * 100) / 100 : 0,
        revpar: capacidade ? Math.round((hosp / capacidade) * 100) / 100 : 0,
        trevpar: capacidade ? Math.round((receita / capacidade) * 100) / 100 : 0,
      },
      serie, horas,
      categorias: porCat.map((c: { nome: string; usos: number; receita: string }) => ({ nome: c.nome, usos: Number(c.usos), receita: Number(c.receita) })),
    };
  }

  /**
   * Desempenho do período: movimento por dia da semana e hora (entradas), suítes da mais à menos
   * alugada (inclusive as sem nenhum uso), produtos vendidos (conta + venda avulsa) e produtos ativos sem venda.
   */
  async desempenho(u: UsuarioToken, filtro: { de?: string; ate?: string; ambienteId?: string }) {
    const ate = filtro.ate ? new Date(`${filtro.ate}T23:59:59.999-03:00`) : new Date();
    const de = filtro.de ? new Date(`${filtro.de}T00:00:00-03:00`) : new Date(ate.getTime() - 30 * DIA);
    const ambs: string[] = filtro.ambienteId ? [filtro.ambienteId]
      : u.ambientesIds?.length ? u.ambientesIds
      : (await this.ambientes.find({ where: { empresaId: u.empresaId } })).map((a) => a.id);
    const vazio = { de, ate, diasSemana: [], calor: [], suites: [], produtos: [], semVenda: [] };
    if (!ambs.length) return vazio;
    const p = [u.empresaId, ambs, de, ate];
    const tz = `AT TIME ZONE 'America/Sao_Paulo'`;

    const mov: { dow: number; hora: number; n: number; receita: string }[] = await this.estadias.query(
      `SELECT EXTRACT(DOW FROM e.entrada_em ${tz})::int AS dow, EXTRACT(HOUR FROM e.entrada_em ${tz})::int AS hora,
              count(*)::int AS n, COALESCE(sum(e.valor_total) FILTER (WHERE e.status = 'fechada'), 0) AS receita
         FROM estadias e WHERE e.empresa_id = $1 AND e.ambiente_id = ANY($2::uuid[]) AND e.status <> 'cancelada'
          AND e.entrada_em BETWEEN $3 AND $4 GROUP BY 1, 2`, p);
    const NOMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    const calor = NOMES.map((_, d) => Array.from({ length: 24 }, (_, h) => Number(mov.find((m) => m.dow === d && m.hora === h)?.n ?? 0)));
    // quantas vezes cada dia da semana aparece no período (para a média por dia)
    const vezes = Array(7).fill(0);
    for (let t = de.getTime() + 12 * 3600_000; t <= ate.getTime(); t += DIA) {
      vezes[new Date(new Date(t).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }) + 'T12:00:00').getDay()] += 1;
    }
    const diasSemana = NOMES.map((nome, d) => {
      const doDia = mov.filter((m) => m.dow === d);
      const entradas = doDia.reduce((s, m) => s + Number(m.n), 0);
      const receita = doDia.reduce((s, m) => s + c(m.receita), 0);
      return { dia: d, nome, entradas, receita: r(receita), mediaEntradas: vezes[d] ? Math.round((entradas / vezes[d]) * 10) / 10 : 0, mediaReceita: vezes[d] ? r(receita / vezes[d]) : 0 };
    });

    const suites = await this.estadias.query(
      `SELECT un.id, un.codigo, COALESCE(c.nome, 'Sem categoria') AS categoria, a.nome AS ambiente,
              count(e.id)::int AS usos, COALESCE(sum(e.valor_total), 0) AS receita,
              COALESCE(sum(EXTRACT(EPOCH FROM (e.saida_em - e.entrada_em)) / 60), 0) AS minutos
         FROM unidades un LEFT JOIN categorias c ON c.id = un.categoria_id LEFT JOIN ambientes a ON a.id = un.ambiente_id
         LEFT JOIN estadias e ON e.unidade_id = un.id AND e.status = 'fechada' AND e.saida_em BETWEEN $3 AND $4
        WHERE un.empresa_id = $1 AND un.ambiente_id = ANY($2::uuid[]) AND un.ativo
        GROUP BY un.id, un.codigo, c.nome, a.nome ORDER BY 5 DESC, 6 DESC, un.codigo`, p);

    // produtos vendidos: itens das contas (não estornados, conta não cancelada) + vendas avulsas não canceladas
    const produtos = await this.estadias.query(
      `WITH v AS (
         SELECT i.produto_id, i.quantidade::numeric AS qtd, i.total::numeric AS total
           FROM estadia_itens i JOIN estadias e ON e.id = i.estadia_id
          WHERE i.empresa_id = $1 AND e.ambiente_id = ANY($2::uuid[]) AND i.status = 'ativo' AND e.status <> 'cancelada'
            AND i.produto_id IS NOT NULL AND i.criado_em BETWEEN $3 AND $4
         UNION ALL
         SELECT (x->>'produtoId')::uuid, (x->>'quantidade')::numeric, (x->>'total')::numeric
           FROM vendas_avulsas va, jsonb_array_elements(va.itens) x
          WHERE va.empresa_id = $1 AND va.ambiente_id = ANY($2::uuid[]) AND NOT va.cancelada AND va.criado_em BETWEEN $3 AND $4)
       SELECT pr.id, pr.nome, pr.grupo, pr.unidade, sum(v.qtd) AS qtd, sum(v.total) AS total, pr.custo
         FROM v JOIN produtos pr ON pr.id = v.produto_id AND pr.empresa_id = $1
        GROUP BY pr.id, pr.nome, pr.grupo, pr.unidade, pr.custo ORDER BY 5 DESC, 6 DESC`, p);
    const vendidos = new Set(produtos.map((x: { id: string }) => x.id));
    const semVenda = (await this.estadias.query(
      `SELECT id, nome, grupo, unidade, preco, frigobar FROM produtos WHERE empresa_id = $1 AND ativo AND tipo = 'produto' ORDER BY grupo NULLS LAST, nome`, [u.empresaId]))
      .filter((x: { id: string }) => !vendidos.has(x.id));

    return {
      de, ate, diasSemana, calor,
      suites: suites.map((s: Record<string, string>) => ({
        id: s.id, codigo: s.codigo, categoria: s.categoria, ambiente: s.ambiente, usos: Number(s.usos), receita: Number(s.receita),
        horas: Math.round(Number(s.minutos) / 6) / 10,
      })),
      produtos: produtos.map((x: Record<string, string>) => ({
        id: x.id, nome: x.nome, grupo: x.grupo, unidade: x.unidade, quantidade: Math.round(Number(x.qtd) * 1000) / 1000, total: Number(x.total),
        custo: x.custo === null ? null : Number(x.custo),
      })),
      semVenda: semVenda.map((x: Record<string, unknown>) => ({ id: x.id, nome: x.nome, grupo: x.grupo, unidade: x.unidade, preco: Number(x.preco), frigobar: x.frigobar })),
    };
  }

  async vendas(u: UsuarioToken, filtro: { de?: string; ate?: string; ambienteId?: string; forma?: string }) {
    const ate = filtro.ate ? new Date(`${filtro.ate}T23:59:59.999-03:00`) : new Date();
    const de = filtro.de ? new Date(`${filtro.de}T00:00:00-03:00`) : new Date(ate.getTime() - 7 * DIA);
    const qb = this.estadias.createQueryBuilder('e').where('e.empresaId = :emp', { emp: u.empresaId })
      .andWhere(`e.status = 'fechada'`).andWhere('e.saidaEm BETWEEN :de AND :ate', { de, ate });
    if (u.ambientesIds?.length) qb.andWhere('e.ambienteId IN (:...amb)', { amb: u.ambientesIds });
    if (filtro.ambienteId) qb.andWhere('e.ambienteId = :a', { a: filtro.ambienteId });
    let ests: Estadia[] = await qb.orderBy('e.saidaEm', 'DESC').limit(5000).getMany();
    let pags = ests.length ? await this.pagamentos.find({ where: { estadiaId: In(ests.map((e) => e.id)) } }) : [];
    // filtro por forma: só as contas que tiveram pagamento nessa forma
    if (filtro.forma) {
      const com = new Set(pags.filter((p) => p.forma === filtro.forma).map((p) => p.estadiaId));
      ests = ests.filter((e) => com.has(e.id));
      pags = pags.filter((p) => com.has(p.estadiaId));
    }
    const pagsDe = new Map<string, { forma: string; valor: number }[]>();
    for (const p of pags) pagsDe.set(p.estadiaId, [...(pagsDe.get(p.estadiaId) ?? []), { forma: p.forma, valor: Number(p.valor) }]);
    const unis = ests.length ? await this.unidades.find({ where: { id: In([...new Set(ests.map((e) => e.unidadeId))]) } }) : [];
    const cats = await this.categorias.find({ where: { empresaId: u.empresaId } });
    const ambs = await this.ambientes.find({ where: { empresaId: u.empresaId } });
    const mapU = new Map(unis.map((x) => [x.id, x]));
    const mapC = new Map(cats.map((x) => [x.id, x.nome]));
    const mapA = new Map(ambs.map((x) => [x.id, x.nome]));

    const porForma: Record<string, number> = {};
    const formasDe = new Map<string, string[]>();
    for (const p of pags) {
      porForma[p.forma] = (porForma[p.forma] ?? 0) + c(p.valor);
      formasDe.set(p.estadiaId, [...(formasDe.get(p.estadiaId) ?? []), p.forma]);
    }
    const porCategoria = new Map<string, { nome: string; usos: number; total: number }>();
    const porCortesia = new Map<string, { nome: string; usos: number; desconto: number }>();
    let hosp = 0, cons = 0, desc = 0, acr = 0, total = 0, minutos = 0;
    for (const e of ests) {
      hosp += c(e.valorHospedagem) + c(e.valorPessoas);
      cons += c(e.valorConsumo);
      desc += c(e.desconto);
      if (e.cortesiaNome) {
        const k = porCortesia.get(e.cortesiaNome) ?? { nome: e.cortesiaNome, usos: 0, desconto: 0 };
        k.usos += 1; k.desconto += c(e.desconto);
        porCortesia.set(e.cortesiaNome, k);
      }
      acr += c(e.acrescimo);
      total += c(e.valorTotal);
      if (e.saidaEm) minutos += Math.max(0, (e.saidaEm.getTime() - e.entradaEm.getTime()) / 60000);
      const catId = e.categoriaId ?? mapU.get(e.unidadeId)?.categoriaId ?? null;
      const nome = (catId && mapC.get(catId)) || 'Sem categoria';
      const a = porCategoria.get(nome) ?? { nome, usos: 0, total: 0 };
      a.usos += 1; a.total += c(e.valorTotal);
      porCategoria.set(nome, a);
    }
    return {
      totais: {
        contas: ests.length, total: r(total), hospedagem: r(hosp), consumo: r(cons), descontos: r(desc), acrescimos: r(acr),
        ticketMedio: ests.length ? r(total / ests.length) : 0, permanenciaMediaMin: ests.length ? Math.round(minutos / ests.length) : 0,
      },
      porForma: Object.fromEntries(Object.entries(porForma).map(([k, v]) => [k, r(v)])),
      porCortesia: [...porCortesia.values()].map((x) => ({ ...x, desconto: r(x.desconto) })).sort((a, b) => b.usos - a.usos),
      porCategoria: [...porCategoria.values()].map((x) => ({ ...x, total: r(x.total) })).sort((a, b) => b.total - a.total),
      lista: ests.map((e) => ({
        id: e.id, uso: e.numero, unidade: mapU.get(e.unidadeId)?.codigo ?? '—', ambiente: mapA.get(e.ambienteId) ?? '',
        entradaEm: e.entradaEm, saidaEm: e.saidaEm, periodo: e.periodoNome, placa: e.placa,
        hospedagem: r(c(e.valorHospedagem) + c(e.valorPessoas)), consumo: r(c(e.valorConsumo)), desconto: Number(e.desconto), total: Number(e.valorTotal ?? 0),
        formas: [...new Set(formasDe.get(e.id) ?? [])], pagamentos: pagsDe.get(e.id) ?? [], fechadoPor: e.usuarioSaidaNome, cortesia: e.cortesiaNome,
      })),
    };
  }
}
