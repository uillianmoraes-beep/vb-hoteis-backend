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
