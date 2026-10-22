import { BadRequestException, Controller, Get, Injectable, Query } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';
import { PlanoContasService } from './plano-contas';

/**
 * Relatórios do dono:
 * - DRE (competência): o que foi vendido no mês, menos impostos/taxas, custos e despesas = lucro;
 * - fluxo de caixa: o dinheiro que entrou e saiu de verdade, por tipo (operação, investimento, empréstimos, sócios);
 * - calendário de recebíveis: o que cai na conta e o que vence nos próximos dias.
 *
 * Despesas e caixa gravam a categoria como texto; o plano de contas diz em qual linha cada uma entra.
 * Para não contar duas vezes: "Conta paga: …" no caixa já está em contas a pagar; "Faturamento" já está
 * em contas a receber; sangria, fechamento de turno e repasse de gorjeta só mudam o dinheiro de lugar.
 */

const MES = /^\d{4}-\d{2}$/;
const DIA = 86_400_000;
const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const r2 = (v: number) => Math.round(v * 100) / 100;
const mesesEntre = (de: string, ate: string) => {
  const out: string[] = [];
  let [a, m] = de.split('-').map(Number);
  const [a2, m2] = ate.split('-').map(Number);
  while (a < a2 || (a === a2 && m <= m2)) { out.push(`${a}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; a++; } }
  return out;
};
/** primeiro instante do mês em São Paulo */
const inicioMes = (mes: string) => new Date(`${mes}-01T03:00:00Z`);
const proximoMes = (mes: string) => { let [a, m] = mes.split('-').map(Number); m++; if (m > 12) { m = 1; a++; } return `${a}-${String(m).padStart(2, '0')}`; };
const NOME_MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const rotuloMes = (mes: string) => `${NOME_MES[Number(mes.slice(5)) - 1]}/${mes.slice(2, 4)}`;

/** contas do modelo que são compra de mercadoria: com estoque, a DRE usa o custo do que foi vendido no lugar delas */
const MERCADORIAS = ['fornecedores (mercadorias)', 'reposição de frigobar e bebidas', 'insumos da cozinha'];

interface Linha { chave: string; nome: string; tipo: 'grupo' | 'conta' | 'total' | 'info'; valores: number[]; ajuda?: string }
interface Lanc { mes: string; valor: number; categoria: string | null; descricao: string | null; sinal: 1 | -1 }
interface Maq { nome: string; taxa_debito: string | null; taxa_credito: string | null; taxa_credito_2a6: string | null; taxa_credito_7a12: string | null; taxa_pix: string | null; prazo_debito: number; prazo_credito: number; prazo_pix: number }

@Injectable()
export class RelatoriosFinanceirosService {
  constructor(private readonly ds: DataSource, private readonly plano: PlanoContasService) {}

  /** conta e grupo de cada lançamento de texto (categoria) */
  private async classificador(empresaId: string) {
    await this.plano.garantirModelo(empresaId);
    const contas: { id: string; nome: string; grupo: string }[] = await this.ds.query(`SELECT id, nome, grupo FROM plano_contas WHERE empresa_id = $1 ORDER BY ordem, nome`, [empresaId]);
    const porId = new Map(contas.map((c) => [c.id, c]));
    const mapa = await this.plano.contaDasCategorias(empresaId);
    const salarios = contas.find((c) => c.nome.toLowerCase() === 'salários e encargos');
    return {
      contas,
      de: (l: { categoria: string | null; descricao: string | null }) => {
        if (l.categoria) { const id = mapa.get(l.categoria.toLowerCase()); if (id) return porId.get(id) ?? null; }
        // vale e pagamento de funcionário (Equipe › Funcionários) entram como salário
        if (!l.categoria && /^(vale|pagamento) · /i.test(l.descricao ?? '') && salarios) return salarios;
        return null;
      },
    };
  }

  /** despesas e entradas manuais do mês: contas a pagar (pelo vencimento ou pelo pagamento) e caixa */
  private async lancamentos(empresaId: string, ini: Date, fim: Date, regime: 'competencia' | 'caixa'): Promise<Lanc[]> {
    const tz = `AT TIME ZONE 'America/Sao_Paulo'`;
    const pagar: Lanc[] = (await this.ds.query(
      regime === 'competencia'
        ? `SELECT to_char(vencimento, 'YYYY-MM') AS mes, COALESCE(valor_pago, valor) AS valor, categoria, descricao FROM contas_pagar
            WHERE empresa_id = $1 AND status <> 'cancelada' AND vencimento >= ($2::timestamptz ${tz})::date AND vencimento < ($3::timestamptz ${tz})::date`
        : `SELECT to_char(pago_em, 'YYYY-MM') AS mes, COALESCE(valor_pago, valor) AS valor, categoria, descricao FROM contas_pagar
            WHERE empresa_id = $1 AND status = 'paga' AND pago_em >= ($2::timestamptz ${tz})::date AND pago_em < ($3::timestamptz ${tz})::date`,
      [empresaId, ini, fim])).map((x: Record<string, unknown>) => ({ mes: x.mes as string, valor: Number(x.valor), categoria: (x.categoria as string) ?? null, descricao: (x.descricao as string) ?? null, sinal: -1 as const }));
    const caixa: Lanc[] = (await this.ds.query(
      `SELECT to_char(criado_em ${tz}, 'YYYY-MM') AS mes, valor, categoria, descricao, caixa, tipo FROM caixa_movimentos
        WHERE empresa_id = $1 AND criado_em >= $2 AND criado_em < $3
          AND ((caixa = 'principal' AND tipo IN ('despesa','reforco')) OR (caixa = 'adm' AND turno_id IS NULL AND tipo IN ('entrada','saida')))
          AND COALESCE(categoria, '') <> 'Faturamento'
          AND COALESCE(descricao, '') NOT LIKE 'Conta paga:%' AND COALESCE(descricao, '') NOT LIKE 'Repasse de gorjetas%'`,
      [empresaId, ini, fim])).map((x: Record<string, unknown>) => ({
      mes: x.mes as string, valor: Number(x.valor), categoria: (x.categoria as string) ?? null, descricao: (x.descricao as string) ?? null,
      sinal: (x.tipo === 'despesa' || x.tipo === 'saida' ? -1 : 1) as 1 | -1,
    }));
    return [...pagar, ...caixa];
  }

  /** taxa de cartão/Pix por mês: a real (relatório da maquininha) e, sem relatório, a estimada pelo contrato */
  private async taxas(empresaId: string, ini: Date, fim: Date) {
    const tz = `AT TIME ZONE 'America/Sao_Paulo'`;
    const reais: { mes: string; taxa: string }[] = await this.ds.query(
      `SELECT to_char(momento ${tz}, 'YYYY-MM') AS mes, sum(taxa) AS taxa FROM conciliacao_linhas
        WHERE empresa_id = $1 AND origem = 'maquininha' AND status <> 'ignorada' AND taxa IS NOT NULL AND momento >= $2 AND momento < $3 GROUP BY 1`,
      [empresaId, ini, fim]);
    const maqs: Maq[] = await this.ds.query(`SELECT * FROM maquininhas WHERE empresa_id = $1 AND ativo ORDER BY criado_em`, [empresaId]);
    const pags: { mes: string; forma: string; valor: string; maquininha: string | null; parcelas: number | null }[] = await this.ds.query(
      `SELECT to_char(p.criado_em ${tz}, 'YYYY-MM') AS mes, p.forma, p.valor, p.maquininha, p.parcelas FROM estadia_pagamentos p
        WHERE p.empresa_id = $1 AND p.forma IN ('pix','debito','credito') AND p.criado_em >= $2 AND p.criado_em < $3
          AND NOT EXISTS (SELECT 1 FROM conciliacao_linhas c WHERE c.pagamento_id = p.id AND c.origem = 'maquininha')`,
      [empresaId, ini, fim]);
    const porMes = new Map<string, { real: number; estimada: number }>();
    for (const x of reais) porMes.set(x.mes, { real: Number(x.taxa), estimada: 0 });
    for (const p of pags) {
      const maq = maqs.find((m) => m.nome === p.maquininha) ?? (maqs.length === 1 ? maqs[0] : undefined);
      if (!maq) continue;
      const pct = taxaPct(maq, p.forma, p.parcelas);
      if (!pct) continue;
      const k = porMes.get(p.mes) ?? { real: 0, estimada: 0 };
      k.estimada += (Number(p.valor) * pct) / 100;
      porMes.set(p.mes, k);
    }
    return porMes;
  }

  /* ---------------- DRE ---------------- */

  async dre(u: UsuarioToken, de: string, ate: string) {
    const meses = mesesEntre(de, ate);
    const ini = inicioMes(de);
    const fim = inicioMes(proximoMes(ate));
    const tz = `AT TIME ZONE 'America/Sao_Paulo'`;
    const idx = new Map(meses.map((m, i) => [m, i]));
    const zero = () => meses.map(() => 0);
    const soma = (alvo: number[], mes: string, v: number) => { const i = idx.get(mes); if (i !== undefined) alvo[i] = r2(alvo[i] + v); };

    // vendas: contas fechadas (pelo dia que fechou) e balcão
    const contas: { mes: string; hosp: string; consumo: string; desconto: string; acrescimo: string; qtd: number }[] = await this.ds.query(
      `SELECT to_char(saida_em ${tz}, 'YYYY-MM') AS mes, sum(COALESCE(valor_hospedagem,0) + COALESCE(valor_pessoas,0)) AS hosp, sum(COALESCE(valor_consumo,0)) AS consumo,
              sum(desconto) AS desconto, sum(acrescimo) AS acrescimo, count(*)::int AS qtd
         FROM estadias WHERE empresa_id = $1 AND status = 'fechada' AND saida_em >= $2 AND saida_em < $3 GROUP BY 1`, [u.empresaId, ini, fim]);
    const balcao: { mes: string; total: string }[] = await this.ds.query(
      `SELECT to_char(criado_em ${tz}, 'YYYY-MM') AS mes, sum(total) AS total FROM vendas_avulsas
        WHERE empresa_id = $1 AND NOT cancelada AND criado_em >= $2 AND criado_em < $3 GROUP BY 1`, [u.empresaId, ini, fim]);
    const faturamentoAvulso: { mes: string; total: string }[] = await this.ds.query(
      `SELECT to_char(criado_em ${tz}, 'YYYY-MM') AS mes, sum(valor) AS total FROM contas_receber
        WHERE empresa_id = $1 AND estadia_id IS NULL AND status <> 'cancelada' AND criado_em >= $2 AND criado_em < $3 GROUP BY 1`, [u.empresaId, ini, fim]);
    // custo do que foi vendido: baixa de estoque das contas e do balcão (líquida dos estornos), pelo custo médio do momento
    const cmv: { mes: string; custo: string }[] = await this.ds.query(
      `SELECT to_char(criado_em ${tz}, 'YYYY-MM') AS mes, sum(-quantidade * custo_unitario) AS custo FROM estoque_movimentos
        WHERE empresa_id = $1 AND (referencia LIKE 'item:%' OR referencia LIKE 'venda:%') AND criado_em >= $2 AND criado_em < $3 GROUP BY 1`, [u.empresaId, ini, fim]);
    const perdas: { mes: string; custo: string }[] = await this.ds.query(
      `SELECT to_char(criado_em ${tz}, 'YYYY-MM') AS mes, sum(-quantidade * custo_unitario) AS custo FROM estoque_movimentos
        WHERE empresa_id = $1 AND quantidade < 0 AND (tipo = 'perda' OR referencia LIKE 'agua:%' OR referencia LIKE 'vistoria:%') AND criado_em >= $2 AND criado_em < $3 GROUP BY 1`,
      [u.empresaId, ini, fim]);
    const temEstoque = cmv.some((x) => Number(x.custo) > 0);
    const taxas = await this.taxas(u.empresaId, ini, fim);
    const cls = await this.classificador(u.empresaId);
    const lancs = await this.lancamentos(u.empresaId, ini, fim, 'competencia');

    const hosp = zero(), consumo = zero(), vendasBalcao = zero(), fatAvulso = zero(), descontos = zero(), acrescimos = zero(), taxaCartao = zero(), custoVendido = zero(), perdasUso = zero();
    const usos = zero();
    let taxaEstimada = false;
    for (const c of contas) { soma(hosp, c.mes, Number(c.hosp)); soma(consumo, c.mes, Number(c.consumo)); soma(descontos, c.mes, Number(c.desconto)); soma(acrescimos, c.mes, Number(c.acrescimo)); soma(usos, c.mes, c.qtd); }
    for (const b of balcao) soma(vendasBalcao, b.mes, Number(b.total));
    for (const f of faturamentoAvulso) soma(fatAvulso, f.mes, Number(f.total));
    for (const [mes, t] of taxas) { soma(taxaCartao, mes, t.real + t.estimada); if (t.estimada > 0) taxaEstimada = true; }
    for (const x of cmv) soma(custoVendido, x.mes, Number(x.custo));
    for (const x of perdas) soma(perdasUso, x.mes, Number(x.custo));

    // lançamentos por conta do plano
    const porConta = new Map<string, number[]>();
    const semConta = zero();
    const semContaNomes = new Set<string>();
    const mercadoriaFora = zero();
    for (const l of lancs) {
      const c = cls.de(l);
      if (!c) {
        if (l.sinal < 0) { soma(semConta, l.mes, l.valor); semContaNomes.add(l.categoria ?? l.descricao ?? '—'); }
        continue;
      }
      if (c.grupo === 'transferencia') continue;
      if (temEstoque && c.grupo === 'custo' && MERCADORIAS.includes(c.nome.toLowerCase())) { soma(mercadoriaFora, l.mes, l.valor * -l.sinal); continue; }
      const v = porConta.get(c.id) ?? zero();
      // nas contas de saída o valor vai positivo (é subtraído no grupo); nas de entrada, positivo também
      const ehEntradaGrupo = c.grupo === 'receita';
      soma(v, l.mes, ehEntradaGrupo ? l.valor * l.sinal : l.valor * -l.sinal);
      porConta.set(c.id, v);
    }
    const contasDoGrupo = (grupo: string) => cls.contas.filter((c) => c.grupo === grupo && porConta.has(c.id))
      .map((c) => ({ chave: `conta:${c.id}`, nome: c.nome, tipo: 'conta' as const, valores: porConta.get(c.id)! }));
    const somaLinhas = (ls: { valores: number[] }[]) => meses.map((_, i) => r2(ls.reduce((s, l) => s + l.valores[i], 0)));

    const receitas = [
      { chave: 'hosp', nome: 'Hospedagem e locação', tipo: 'conta' as const, valores: hosp },
      { chave: 'consumo', nome: 'Consumo nas contas (frigobar, bar, cozinha)', tipo: 'conta' as const, valores: consumo },
      { chave: 'balcao', nome: 'Vendas no balcão', tipo: 'conta' as const, valores: vendasBalcao },
      { chave: 'acrescimos', nome: 'Acréscimos cobrados', tipo: 'conta' as const, valores: acrescimos },
      { chave: 'fatAvulso', nome: 'Lançamentos avulsos no faturamento', tipo: 'conta' as const, valores: fatAvulso },
      ...contasDoGrupo('receita'),
    ].filter((l) => l.valores.some((v) => v !== 0));
    const deducoes = [
      { chave: 'descontos', nome: 'Descontos e cortesias', tipo: 'conta' as const, valores: descontos },
      { chave: 'taxas', nome: `Taxas de cartão e Pix${taxaEstimada ? ' (parte estimada pelo contrato)' : ''}`, tipo: 'conta' as const, valores: taxaCartao },
      ...contasDoGrupo('deducao'),
    ].filter((l) => l.valores.some((v) => v !== 0));
    const custos = [
      ...(temEstoque ? [{ chave: 'cmv', nome: 'Custo dos produtos vendidos (estoque)', tipo: 'conta' as const, valores: custoVendido }] : []),
      { chave: 'perdas', nome: 'Perdas, avarias e uso interno (estoque)', tipo: 'conta' as const, valores: perdasUso },
      ...contasDoGrupo('custo'),
    ].filter((l) => l.valores.some((v) => v !== 0));
    const despesas = [...contasDoGrupo('despesa'),
      ...(semConta.some((v) => v) ? [{ chave: 'semconta', nome: 'Sem conta no plano (classifique em Plano de contas)', tipo: 'conta' as const, valores: semConta }] : [])];
    const financeiro = contasDoGrupo('financeiro');

    const tReceita = somaLinhas(receitas);
    const tDeducao = somaLinhas(deducoes);
    const tLiquida = meses.map((_, i) => r2(tReceita[i] - tDeducao[i]));
    const tCusto = somaLinhas(custos);
    const tBruto = meses.map((_, i) => r2(tLiquida[i] - tCusto[i]));
    const tDespesa = somaLinhas(despesas);
    const tOperacional = meses.map((_, i) => r2(tBruto[i] - tDespesa[i]));
    // financeiro: entradas (rendimentos) somam, saídas (juros, tarifas) subtraem; aqui as contas vêm com saída positiva
    const tFinanceiro = somaLinhas(financeiro).map((v) => -v);
    const tLucro = meses.map((_, i) => r2(tOperacional[i] + tFinanceiro[i]));
    const pct = (a: number[], b: number[]) => a.map((v, i) => (b[i] ? Math.round((v / b[i]) * 1000) / 10 : 0));

    const linhas: Linha[] = [
      { chave: 'receita', nome: 'Receita bruta', tipo: 'grupo', valores: tReceita, ajuda: 'Tudo o que foi vendido no mês (contas fechadas no mês e balcão).' }, ...receitas,
      { chave: 'deducao', nome: '(−) Deduções', tipo: 'grupo', valores: tDeducao.map((v) => -v) }, ...deducoes.map((l) => ({ ...l, valores: l.valores.map((v) => -v) })),
      { chave: 'liquida', nome: '= Receita líquida', tipo: 'total', valores: tLiquida },
      { chave: 'custo', nome: '(−) Custos variáveis', tipo: 'grupo', valores: tCusto.map((v) => -v) }, ...custos.map((l) => ({ ...l, valores: l.valores.map((v) => -v) })),
      { chave: 'bruto', nome: '= Lucro bruto', tipo: 'total', valores: tBruto },
      { chave: 'despesa', nome: '(−) Despesas fixas e operacionais', tipo: 'grupo', valores: tDespesa.map((v) => -v) }, ...despesas.map((l) => ({ ...l, valores: l.valores.map((v) => -v) })),
      { chave: 'operacional', nome: '= Resultado operacional (EBITDA)', tipo: 'total', valores: tOperacional },
      ...(financeiro.length ? [{ chave: 'financeiro', nome: '(±) Resultado financeiro', tipo: 'grupo' as const, valores: tFinanceiro }, ...financeiro.map((l) => ({ ...l, valores: l.valores.map((v) => -v) }))] : []),
      { chave: 'lucro', nome: '= Lucro líquido', tipo: 'total', valores: tLucro },
    ];
    // fora do lucro (só para conhecimento): investimentos, empréstimos, sócios, e as compras de mercadoria trocadas pelo custo do estoque
    const fora: Linha[] = [
      ...['investimento', 'financiamento', 'socios'].flatMap((g) => contasDoGrupo(g).map((l) => ({ ...l, tipo: 'info' as const }))),
      ...(mercadoriaFora.some((v) => v) ? [{ chave: 'mercadorias', nome: 'Compras de mercadoria (no lugar delas entra o custo do que foi vendido)', tipo: 'info' as const, valores: mercadoriaFora }] : []),
    ];
    return {
      meses: meses.map((m) => ({ mes: m, nome: rotuloMes(m) })), linhas, fora,
      indicadores: {
        margemBruta: pct(tBruto, tReceita), margemLiquida: pct(tLucro, tReceita), contas: usos,
        ticketMedio: meses.map((_, i) => (usos[i] ? r2(tReceita[i] / usos[i]) : 0)),
      },
      avisos: [
        ...(semContaNomes.size ? [`Lançamentos sem conta no plano: ${[...semContaNomes].slice(0, 8).join(', ')}. Ligue cada um a uma conta em Financeiro › Plano de contas.`] : []),
        ...(taxaEstimada ? ['Parte das taxas de cartão foi estimada pelas taxas do contrato (sem o relatório da maquininha importado na Conciliação).'] : []),
        ...(!temEstoque ? ['Sem baixa de estoque nas vendas: o custo das mercadorias entra pelas compras lançadas em despesas.'] : []),
      ],
    };
  }

  /* ---------------- fluxo de caixa ---------------- */

  async fluxo(u: UsuarioToken, de: string, ate: string) {
    const meses = mesesEntre(de, ate);
    const ini = inicioMes(de);
    const fim = inicioMes(proximoMes(ate));
    const tz = `AT TIME ZONE 'America/Sao_Paulo'`;
    const idx = new Map(meses.map((m, i) => [m, i]));
    const zero = () => meses.map(() => 0);
    const soma = (alvo: number[], mes: string, v: number) => { const i = idx.get(mes); if (i !== undefined) alvo[i] = r2(alvo[i] + v); };

    const recebido: { mes: string; forma: string; valor: string }[] = await this.ds.query(
      `SELECT to_char(criado_em ${tz}, 'YYYY-MM') AS mes, forma, sum(valor) AS valor FROM estadia_pagamentos
        WHERE empresa_id = $1 AND forma NOT IN ('faturado','penhora','cortesia') AND criado_em >= $2 AND criado_em < $3 GROUP BY 1, 2`, [u.empresaId, ini, fim]);
    const balcao: { mes: string; valor: string }[] = await this.ds.query(
      `SELECT to_char(criado_em ${tz}, 'YYYY-MM') AS mes, sum(total) AS valor FROM vendas_avulsas
        WHERE empresa_id = $1 AND NOT cancelada AND forma <> 'ficha' AND criado_em >= $2 AND criado_em < $3 GROUP BY 1`, [u.empresaId, ini, fim]);
    const faturas: { mes: string; valor: string }[] = await this.ds.query(
      `SELECT to_char(pago_em, 'YYYY-MM') AS mes, sum(valor) AS valor FROM contas_receber
        WHERE empresa_id = $1 AND status = 'paga' AND pago_em >= ($2::timestamptz ${tz})::date AND pago_em < ($3::timestamptz ${tz})::date GROUP BY 1`, [u.empresaId, ini, fim]);
    const taxas = await this.taxas(u.empresaId, ini, fim);
    const cls = await this.classificador(u.empresaId);
    const lancs = await this.lancamentos(u.empresaId, ini, fim, 'caixa');

    const NOME_FORMA: Record<string, string> = { dinheiro: 'Dinheiro', pix: 'Pix', debito: 'Débito', credito: 'Crédito' };
    const porForma = new Map<string, number[]>();
    for (const x of recebido) { const v = porForma.get(x.forma) ?? zero(); soma(v, x.mes, Number(x.valor)); porForma.set(x.forma, v); }
    const vBalcao = zero(); for (const x of balcao) soma(vBalcao, x.mes, Number(x.valor));
    const vFaturas = zero(); for (const x of faturas) soma(vFaturas, x.mes, Number(x.valor));
    const vTaxas = zero(); for (const [mes, t] of taxas) soma(vTaxas, mes, t.real + t.estimada);

    const grupos: Record<string, Map<string, { nome: string; valores: number[] }>> = { operacional: new Map(), investimento: new Map(), financiamento: new Map() };
    const semConta = zero();
    for (const l of lancs) {
      const c = cls.de(l);
      if (c?.grupo === 'transferencia') continue;
      const g = !c ? 'operacional' : c.grupo === 'investimento' ? 'investimento' : c.grupo === 'financiamento' || c.grupo === 'socios' ? 'financiamento' : 'operacional';
      if (!c) { soma(semConta, l.mes, l.valor * l.sinal); continue; }
      const k = grupos[g].get(c.id) ?? { nome: c.nome, valores: zero() };
      soma(k.valores, l.mes, l.valor * l.sinal);
      grupos[g].set(c.id, k);
    }
    const linhasDe = (g: string) => [...grupos[g].entries()].map(([id, x]) => ({ chave: `conta:${id}`, nome: x.nome, tipo: 'conta' as const, valores: x.valores }));
    const somaL = (ls: { valores: number[] }[]) => meses.map((_, i) => r2(ls.reduce((s, l) => s + l.valores[i], 0)));

    const entradas = [
      ...['dinheiro', 'pix', 'debito', 'credito'].filter((f) => porForma.has(f)).map((f) => ({ chave: `forma:${f}`, nome: `Contas recebidas em ${NOME_FORMA[f]}`, tipo: 'conta' as const, valores: porForma.get(f)! })),
      { chave: 'balcao', nome: 'Vendas no balcão', tipo: 'conta' as const, valores: vBalcao },
      { chave: 'faturas', nome: 'Faturas recebidas (empresas)', tipo: 'conta' as const, valores: vFaturas },
    ].filter((l) => l.valores.some((v) => v));
    const operacional = [
      ...entradas,
      { chave: 'taxas', nome: 'Taxas de cartão e Pix', tipo: 'conta' as const, valores: vTaxas.map((v) => -v) },
      ...linhasDe('operacional'),
      ...(semConta.some((v) => v) ? [{ chave: 'semconta', nome: 'Sem conta no plano', tipo: 'conta' as const, valores: semConta }] : []),
    ].filter((l) => l.valores.some((v) => v));
    const investimento = linhasDe('investimento');
    const financiamento = linhasDe('financiamento');
    const tOp = somaL(operacional), tInv = somaL(investimento), tFin = somaL(financiamento);
    const saldo = meses.map((_, i) => r2(tOp[i] + tInv[i] + tFin[i]));
    let acc = 0;
    const acumulado = saldo.map((v) => (acc = r2(acc + v)));
    const linhas: Linha[] = [
      { chave: 'op', nome: 'Operação (entradas das vendas menos despesas do dia a dia)', tipo: 'grupo', valores: tOp }, ...operacional,
      { chave: 'inv', nome: 'Investimentos (equipamentos, reformas)', tipo: 'grupo', valores: tInv }, ...investimento,
      { chave: 'fin', nome: 'Empréstimos e sócios', tipo: 'grupo', valores: tFin }, ...financiamento,
      { chave: 'saldo', nome: '= Saldo do mês', tipo: 'total', valores: saldo },
      { chave: 'acumulado', nome: 'Saldo acumulado no período', tipo: 'total', valores: acumulado },
    ];
    return { meses: meses.map((m) => ({ mes: m, nome: rotuloMes(m) })), linhas, avisos: semConta.some((v) => v) ? ['Tem lançamento sem conta no plano: ele entra em Operação. Classifique em Financeiro › Plano de contas.'] : [] };
  }

  /* ---------------- calendário de recebíveis ---------------- */

  async recebiveis(u: UsuarioToken, dias: number) {
    const hoje = hojeSP();
    const ate = new Date(Date.parse(`${hoje}T12:00:00Z`) + dias * DIA).toISOString().slice(0, 10);
    const porDia = new Map<string, { dia: string; cartoesConfirmado: number; cartoesEstimado: number; faturas: number; pagar: number; itens: string[] }>();
    const de = (d: string) => porDia.get(d) ?? porDia.set(d, { dia: d, cartoesConfirmado: 0, cartoesEstimado: 0, faturas: 0, pagar: 0, itens: [] }).get(d)!;

    // cartões do relatório da maquininha que ainda não caíram (o depósito ainda não foi conferido no extrato)
    const conf: { dia: string; maquininha: string; liquido: string; qtd: number }[] = await this.ds.query(
      `SELECT to_char(l.data_pagamento, 'YYYY-MM-DD') AS dia, mq.nome AS maquininha, sum(l.valor_liquido) AS liquido, count(*)::int AS qtd
         FROM conciliacao_linhas l JOIN maquininhas mq ON mq.id = l.maquininha_id
        WHERE l.empresa_id = $1 AND l.origem = 'maquininha' AND l.status <> 'ignorada' AND l.valor_liquido IS NOT NULL
          AND l.data_pagamento >= $2::date AND l.data_pagamento <= $3::date
          AND NOT EXISTS (SELECT 1 FROM conciliacao_linhas b WHERE b.origem = 'banco' AND b.status = 'conciliada'
                            AND b.deposito_de->>'chave' = l.maquininha_id::text || ':' || to_char(l.data_pagamento, 'YYYY-MM-DD'))
        GROUP BY 1, 2`, [u.empresaId, hoje, ate]);
    for (const c of conf) { const x = de(c.dia); x.cartoesConfirmado = r2(x.cartoesConfirmado + Number(c.liquido)); x.itens.push(`${c.maquininha}: ${c.qtd} venda(s)`); }

    // cartões lançados no sistema sem relatório importado: estimados pelo prazo e taxa do contrato
    const maqs: Maq[] = await this.ds.query(`SELECT * FROM maquininhas WHERE empresa_id = $1 AND ativo ORDER BY criado_em`, [u.empresaId]);
    const pags: { forma: string; valor: string; criado_em: Date; maquininha: string | null; parcelas: number | null }[] = await this.ds.query(
      `SELECT p.forma, p.valor, p.criado_em, p.maquininha, p.parcelas FROM estadia_pagamentos p
        WHERE p.empresa_id = $1 AND p.forma IN ('debito','credito') AND p.criado_em >= now() - interval '130 days'
          AND NOT EXISTS (SELECT 1 FROM conciliacao_linhas c WHERE c.pagamento_id = p.id AND c.origem = 'maquininha')`, [u.empresaId]);
    let semMaquininha = 0;
    for (const p of pags) {
      const maq = maqs.find((m) => m.nome === p.maquininha) ?? (maqs.length === 1 ? maqs[0] : undefined);
      if (!maq) { semMaquininha++; continue; }
      const prazo = p.forma === 'debito' ? maq.prazo_debito : maq.prazo_credito;
      const valor = Number(p.valor) * (1 - (taxaPct(maq, p.forma, p.parcelas) ?? 0) / 100);
      // crédito parcelado sem antecipação: uma parcela por mês
      const parcelas = p.forma === 'credito' && p.parcelas && p.parcelas > 1 && prazo >= 20 ? p.parcelas : 1;
      for (let i = 0; i < parcelas; i++) {
        const dia = new Date(new Date(p.criado_em).getTime() - 3 * 3600_000 + (prazo + i * 30) * DIA).toISOString().slice(0, 10);
        if (dia < hoje || dia > ate) continue;
        const x = de(dia);
        x.cartoesEstimado = r2(x.cartoesEstimado + valor / parcelas);
      }
    }
    const faturas: { dia: string; valor: string; qtd: number }[] = await this.ds.query(
      `SELECT to_char(GREATEST(vencimento, $2::date), 'YYYY-MM-DD') AS dia, sum(valor) AS valor, count(*)::int AS qtd FROM contas_receber
        WHERE empresa_id = $1 AND status = 'aberta' AND vencimento <= $3::date GROUP BY 1`, [u.empresaId, hoje, ate]);
    for (const f of faturas) { const x = de(f.dia); x.faturas = r2(x.faturas + Number(f.valor)); }
    const pagar: { dia: string; valor: string; qtd: number }[] = await this.ds.query(
      `SELECT to_char(GREATEST(vencimento, $2::date), 'YYYY-MM-DD') AS dia, sum(valor) AS valor, count(*)::int AS qtd FROM contas_pagar
        WHERE empresa_id = $1 AND status = 'aberta' AND vencimento <= $3::date GROUP BY 1`, [u.empresaId, hoje, ate]);
    for (const p of pagar) { const x = de(p.dia); x.pagar = r2(x.pagar + Number(p.valor)); }
    const [vencidas] = await this.ds.query(
      `SELECT (SELECT COALESCE(sum(valor),0) FROM contas_receber WHERE empresa_id = $1 AND status = 'aberta' AND vencimento < $2::date) AS receber,
              (SELECT COALESCE(sum(valor),0) FROM contas_pagar WHERE empresa_id = $1 AND status = 'aberta' AND vencimento < $2::date) AS pagar`, [u.empresaId, hoje]);

    const lista = [...porDia.values()].sort((a, b) => a.dia.localeCompare(b.dia));
    let saldo = 0;
    const comSaldo = lista.map((x) => {
      const entra = r2(x.cartoesConfirmado + x.cartoesEstimado + x.faturas);
      saldo = r2(saldo + entra - x.pagar);
      return { ...x, entra, saldo };
    });
    const faixa = (n: number) => {
      const lim = new Date(Date.parse(`${hoje}T12:00:00Z`) + n * DIA).toISOString().slice(0, 10);
      const ds = comSaldo.filter((x) => x.dia <= lim);
      return { dias: n, entra: r2(ds.reduce((s, x) => s + x.entra, 0)), pagar: r2(ds.reduce((s, x) => s + x.pagar, 0)) };
    };
    return {
      hoje, ate, dias: comSaldo, faixas: [faixa(7), faixa(30), faixa(60), faixa(90)].filter((f) => f.dias <= dias),
      vencidas: { receber: Number(vencidas?.receber ?? 0), pagar: Number(vencidas?.pagar ?? 0) },
      avisos: [
        ...(semMaquininha ? [`${semMaquininha} venda(s) no cartão sem maquininha identificada ficaram de fora. Cadastre as maquininhas em Contas bancárias e taxas.`] : []),
        ...(!maqs.length ? ['Nenhuma maquininha cadastrada: sem ela o sistema não sabe quando o cartão cai na conta.'] : []),
      ],
    };
  }
}

function taxaPct(m: Maq, forma: string, parcelas: number | null): number | null {
  const n = (v: string | null) => (v === null ? null : Number(v));
  if (forma === 'debito') return n(m.taxa_debito);
  if (forma === 'pix') return n(m.taxa_pix);
  if (forma === 'credito') {
    const p = parcelas ?? 1;
    if (p >= 7) return n(m.taxa_credito_7a12) ?? n(m.taxa_credito_2a6) ?? n(m.taxa_credito);
    if (p >= 2) return n(m.taxa_credito_2a6) ?? n(m.taxa_credito);
    return n(m.taxa_credito);
  }
  return null;
}

@Controller('financeiro')
export class RelatoriosFinanceirosController {
  constructor(private readonly service: RelatoriosFinanceirosService) {}

  private periodo(de?: string, ate?: string) {
    const agora = hojeSP().slice(0, 7);
    const a = ate && MES.test(ate) ? ate : agora;
    // padrão: os últimos 6 meses (o atual e os 5 anteriores)
    let d = de && MES.test(de) ? de : (() => { let [y, m] = a.split('-').map(Number); m -= 5; while (m < 1) { m += 12; y--; } return `${y}-${String(m).padStart(2, '0')}`; })();
    if (d > a) d = a;
    if (mesesEntre(d, a).length > 24) throw new BadRequestException('Escolha até 24 meses.');
    return [d, a] as const;
  }

  @Get('dre')
  @Requer('relatorios.ver', 'caixa.adm', 'despesas.gerenciar')
  dre(@Usuario() u: UsuarioToken, @Query('de') de?: string, @Query('ate') ate?: string) {
    const [d, a] = this.periodo(de, ate);
    return this.service.dre(u, d, a);
  }

  @Get('fluxo')
  @Requer('relatorios.ver', 'caixa.adm', 'despesas.gerenciar')
  fluxo(@Usuario() u: UsuarioToken, @Query('de') de?: string, @Query('ate') ate?: string) {
    const [d, a] = this.periodo(de, ate);
    return this.service.fluxo(u, d, a);
  }

  @Get('recebiveis')
  @Requer('relatorios.ver', 'caixa.adm', 'despesas.gerenciar', 'faturamento.gerenciar')
  recebiveis(@Usuario() u: UsuarioToken, @Query('dias') dias?: string) {
    const n = Math.min(120, Math.max(7, Number(dias) || 90));
    return this.service.recebiveis(u, n);
  }
}
