import { BadRequestException, Body, Controller, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

/**
 * Reserva do caixa ADM (fundo para as despesas do mês).
 * Compromissos: fixos (contador, contratos), variáveis pela média dos últimos 3 meses (luz, água, gás),
 * folha (pelos salários da ficha) e imposto (% do faturamento; o regime vem da Configuração fiscal).
 * Todo dia o sistema mostra o movimento de ontem e quanto separar para chegar em cada vencimento com o dinheiro;
 * o administrativo confirma quanto separou (na gaveta do ADM ou em qual banco). Pagamentos saem da reserva.
 */

export const TIPOS_COMPROMISSO = { fixo: 'Fixo (mesmo valor todo mês)', variavel: 'Variável (média dos últimos 3 meses)', folha: 'Folha (pelos salários)', imposto: 'Imposto (% do faturamento)' } as const;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const DIA = 86_400_000;
const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const somaDias = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * DIA).toISOString().slice(0, 10);
const difDias = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DIA);
const r2 = (v: number) => Math.round(v * 100) / 100;
const inicioDia = (d: string) => new Date(`${d}T03:00:00Z`);
const dia = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

/** próximo dia D do mês a partir de hoje (dia 31 em mês de 30 vira o último dia) */
function proximoVencimento(hoje: string, d: number, depoisDe?: string) {
  let [a, m] = hoje.split('-').map(Number);
  for (let i = 0; i < 3; i++) {
    const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
    const data = `${a}-${String(m).padStart(2, '0')}-${String(Math.min(d, ultimo)).padStart(2, '0')}`;
    if (data >= hoje && (!depoisDe || data > depoisDe)) return data;
    m++; if (m > 12) { m = 1; a++; }
  }
  return hoje;
}

class CompromissoDto {
  @IsString() @MinLength(2) @MaxLength(80) nome!: string;
  @IsIn(Object.keys(TIPOS_COMPROMISSO)) tipo!: keyof typeof TIPOS_COMPROMISSO;
  /** fixo: o valor; variável: valor usado quando ainda não há histórico */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(10_000_000) valor?: number | null;
  /** variável: categoria das contas a pagar para tirar a média (ex.: Energia elétrica) */
  @IsOptional() @IsString() @MaxLength(60) categoria?: string | null;
  /** folha: % dos salários (ex.: 40 no adiantamento); imposto: % do faturamento */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) percentual?: number | null;
  @IsInt() @Min(1) @Max(31) dia!: number;
  @IsOptional() @IsBoolean() ativo?: boolean;
}
class MovimentoReservaDto {
  @Matches(DATA) data!: string;
  @IsIn(['separar', 'pagar', 'devolver', 'pular']) tipo!: 'separar' | 'pagar' | 'devolver' | 'pular';
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(10_000_000) valor!: number;
  /** onde o dinheiro fica: gaveta do caixa ADM ou uma conta bancária */
  @IsIn(['dinheiro', 'banco']) origem!: 'dinheiro' | 'banco';
  @IsOptional() @IsUUID() contaBancariaId?: string;
  @IsOptional() @IsUUID() compromissoId?: string;
  @IsOptional() @IsString() @MaxLength(300) descricao?: string;
}

interface Compromisso { id: string; nome: string; tipo: string; valor: number | null; categoria: string | null; percentual: number | null; dia: number; ativo: boolean }

@Injectable()
export class ReservaService {
  constructor(private readonly ds: DataSource) {}

  private async compromissos(empresaId: string, todos = false): Promise<Compromisso[]> {
    const l = await this.ds.query(`SELECT * FROM reserva_compromissos WHERE empresa_id = $1 ${todos ? '' : 'AND ativo'} ORDER BY dia, nome`, [empresaId]);
    return l.map((c: Record<string, unknown>) => ({
      id: c.id as string, nome: c.nome as string, tipo: c.tipo as string, valor: c.valor === null ? null : Number(c.valor), categoria: (c.categoria as string) ?? null,
      percentual: c.percentual === null ? null : Number(c.percentual), dia: Number(c.dia), ativo: !!c.ativo,
    }));
  }

  /** valor de cada compromisso neste mês e de onde veio */
  private async valores(empresaId: string, lista: Compromisso[], hoje: string) {
    const [sal] = await this.ds.query(
      `SELECT COALESCE(sum(c.salario), 0) AS total, count(*) FILTER (WHERE c.salario IS NULL)::int AS sem FROM funcionarios f LEFT JOIN funcionario_contratos c ON c.funcionario_id = f.id
        WHERE f.empresa_id = $1 AND f.ativo`, [empresaId]).catch(() => [{ total: 0, sem: 0 }]);
    // faturamento do mês anterior (contas fechadas + balcão), base do imposto
    const iniMes = `${hoje.slice(0, 7)}-01`;
    const iniAnt = somaDias(iniMes, -1).slice(0, 7) + '-01';
    const [fat] = await this.ds.query(
      `SELECT (SELECT COALESCE(sum(valor_total), 0) FROM estadias WHERE empresa_id = $1 AND status = 'fechada' AND saida_em >= $2 AND saida_em < $3)
            + (SELECT COALESCE(sum(total), 0) FROM vendas_avulsas WHERE empresa_id = $1 AND NOT cancelada AND criado_em >= $2 AND criado_em < $3) AS total`,
      [empresaId, inicioDia(iniAnt), inicioDia(iniMes)]);
    const out = new Map<string, { valor: number; origem: string }>();
    for (const c of lista) {
      if (c.tipo === 'fixo') out.set(c.id, { valor: c.valor ?? 0, origem: 'valor fixo' });
      else if (c.tipo === 'folha') {
        const pct = c.percentual ?? 100;
        const base = Number(sal?.total ?? 0);
        out.set(c.id, base > 0 ? { valor: r2((base * pct) / 100), origem: `${pct}% dos salários da ficha (${base.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })})` } : { valor: c.valor ?? 0, origem: 'valor informado (sem salários na ficha)' });
      } else if (c.tipo === 'imposto') {
        const pct = c.percentual ?? 0;
        out.set(c.id, { valor: r2((Number(fat?.total ?? 0) * pct) / 100), origem: `${pct}% do faturamento do mês passado` });
      } else {
        // variável: média dos últimos 3 meses fechados das contas a pagar com essa categoria
        const [m] = c.categoria ? await this.ds.query(
          `SELECT COALESCE(sum(COALESCE(valor_pago, valor)), 0) / 3 AS media, count(*)::int AS n FROM contas_pagar
            WHERE empresa_id = $1 AND status <> 'cancelada' AND lower(categoria) = lower($2) AND vencimento >= ($3::date - interval '3 months') AND vencimento < $3::date`,
          [empresaId, c.categoria, iniMes]) : [{ media: 0, n: 0 }];
        out.set(c.id, m?.n ? { valor: r2(Number(m.media)), origem: `média de 3 meses (${m.n} conta(s) de ${c.categoria})` } : { valor: c.valor ?? 0, origem: 'valor informado (sem histórico ainda)' });
      }
    }
    return out;
  }

  async painel(u: UsuarioToken, dataMov?: string) {
    const hoje = hojeSP();
    const ontem = dataMov && DATA.test(dataMov) ? dataMov : somaDias(hoje, -1);
    const lista = await this.compromissos(u.empresaId);
    const vals = await this.valores(u.empresaId, lista, hoje);
    const [{ regime }] = await this.ds.query(`SELECT regime_tributario AS regime FROM empresas WHERE id = $1`, [u.empresaId]);

    // saldo da reserva: separado − pago − devolvido; por onde está (gaveta ou banco)
    const saldos: { origem: string; conta_bancaria_id: string | null; conta: string | null; saldo: string }[] = await this.ds.query(
      `SELECT m.origem, m.conta_bancaria_id, cb.nome AS conta,
              sum(CASE WHEN m.tipo = 'separar' THEN m.valor WHEN m.tipo IN ('pagar','devolver') THEN -m.valor ELSE 0 END) AS saldo
         FROM reserva_movimentos m LEFT JOIN contas_bancarias cb ON cb.id = m.conta_bancaria_id
        WHERE m.empresa_id = $1 GROUP BY 1, 2, 3`, [u.empresaId]);
    const saldo = r2(saldos.reduce((s, x) => s + Number(x.saldo), 0));

    // pagamentos já feitos com a reserva neste ciclo: o compromisso passa para o próximo mês
    const pagos: { compromisso_id: string; ultimo: string }[] = await this.ds.query(
      `SELECT compromisso_id, max(data)::text AS ultimo FROM reserva_movimentos WHERE empresa_id = $1 AND tipo = 'pagar' AND compromisso_id IS NOT NULL GROUP BY 1`, [u.empresaId]);
    const pagoEm = new Map(pagos.map((p) => [p.compromisso_id, dia(p.ultimo)]));

    const proximos = lista.map((c) => {
      const pago = pagoEm.get(c.id);
      // pago nos últimos 25 dias: este mês já está quitado
      const venc = proximoVencimento(hoje, c.dia, pago && difDias(pago, hoje) < 25 ? somaDias(pago, 5) : undefined);
      const v = vals.get(c.id) ?? { valor: 0, origem: '' };
      return { ...c, vencimento: venc, dias: Math.max(1, difDias(hoje, venc)), valorMes: v.valor, origem: v.origem, pagoEm: pago ?? null };
    }).sort((a, b) => a.vencimento.localeCompare(b.vencimento));

    // quanto separar hoje para chegar em cada vencimento com o dinheiro (o mais apertado manda)
    let acumulado = 0;
    let sugestao = 0;
    const situacao = proximos.map((c) => {
      acumulado = r2(acumulado + c.valorMes);
      const falta = r2(acumulado - saldo);
      const porDia = falta > 0 ? r2(falta / c.dias) : 0;
      if (porDia > sugestao) sugestao = porDia;
      return { ...c, precisaAte: acumulado, falta: Math.max(0, falta), porDia, atrasado: falta > 0 && c.dias <= 3 };
    });

    // movimento do dia escolhido (normalmente ontem), por forma e por ambiente
    const formas: { forma: string; valor: string }[] = await this.ds.query(
      `SELECT forma, sum(valor) AS valor FROM (
         SELECT p.forma, p.valor FROM estadia_pagamentos p WHERE p.empresa_id = $1 AND p.criado_em >= $2 AND p.criado_em < $3 AND p.forma NOT IN ('faturado','penhora','cortesia')
         UNION ALL SELECT v.forma, v.total FROM vendas_avulsas v WHERE v.empresa_id = $1 AND NOT v.cancelada AND v.criado_em >= $2 AND v.criado_em < $3 AND v.forma <> 'ficha') x GROUP BY 1`,
      [u.empresaId, inicioDia(ontem), inicioDia(somaDias(ontem, 1))]);
    const ambientes: { ambiente: string; valor: string }[] = await this.ds.query(
      `SELECT a.nome AS ambiente, sum(p.valor) AS valor FROM estadia_pagamentos p JOIN estadias e ON e.id = p.estadia_id JOIN ambientes a ON a.id = e.ambiente_id
        WHERE p.empresa_id = $1 AND p.criado_em >= $2 AND p.criado_em < $3 AND p.forma NOT IN ('faturado','penhora','cortesia') GROUP BY 1 ORDER BY 2 DESC`,
      [u.empresaId, inicioDia(ontem), inicioDia(somaDias(ontem, 1))]);
    const porForma = Object.fromEntries(formas.map((f) => [f.forma, Number(f.valor)]));
    const movimento = r2(formas.reduce((s, f) => s + Number(f.valor), 0));
    // o que a conciliação já conferiu no banco nesse dia
    const [conc] = await this.ds.query(
      `SELECT COALESCE(sum(valor_bruto), 0) AS valor, count(*)::int AS n FROM conciliacao_linhas
        WHERE empresa_id = $1 AND origem = 'banco' AND status = 'conciliada' AND valor_bruto > 0 AND momento >= $2 AND momento < $3`,
      [u.empresaId, inicioDia(ontem), inicioDia(somaDias(ontem, 1))]).catch(() => [{ valor: 0, n: 0 }]);
    const [feito] = await this.ds.query(
      `SELECT COALESCE(sum(valor) FILTER (WHERE tipo = 'separar'), 0) AS separado, bool_or(tipo = 'pular') AS pulou FROM reserva_movimentos WHERE empresa_id = $1 AND data = $2`,
      [u.empresaId, ontem]);

    // últimos dias: movimento × separado (para não esquecer nenhum)
    const dias: { data: string; movimento: string; separado: string; pulou: boolean; conciliado: string }[] = await this.ds.query(
      `WITH d AS (SELECT generate_series($2::date, $3::date, interval '1 day')::date AS data)
       SELECT d.data::text,
              (SELECT COALESCE(sum(p.valor), 0) FROM estadia_pagamentos p WHERE p.empresa_id = $1 AND p.forma NOT IN ('faturado','penhora','cortesia')
                 AND p.criado_em >= (d.data::timestamp AT TIME ZONE 'America/Sao_Paulo') AND p.criado_em < ((d.data + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')) AS movimento,
              (SELECT COALESCE(sum(valor), 0) FROM reserva_movimentos r WHERE r.empresa_id = $1 AND r.data = d.data AND r.tipo = 'separar') AS separado,
              COALESCE((SELECT bool_or(tipo = 'pular') FROM reserva_movimentos r WHERE r.empresa_id = $1 AND r.data = d.data), false) AS pulou,
              (SELECT COALESCE(sum(valor_bruto), 0) FROM conciliacao_linhas c WHERE c.empresa_id = $1 AND c.origem = 'banco' AND c.status = 'conciliada' AND c.valor_bruto > 0
                 AND c.momento >= (d.data::timestamp AT TIME ZONE 'America/Sao_Paulo') AND c.momento < ((d.data + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')) AS conciliado
         FROM d ORDER BY d.data DESC`, [u.empresaId, somaDias(hoje, -14), somaDias(hoje, -1)]);

    return {
      hoje, data: ontem, regime: regime ?? null, tipos: TIPOS_COMPROMISSO,
      saldo, saldos: saldos.filter((x) => Math.abs(Number(x.saldo)) >= 0.01).map((x) => ({ onde: x.origem === 'banco' ? x.conta ?? 'Banco' : 'Gaveta do caixa ADM', contaBancariaId: x.conta_bancaria_id, saldo: Number(x.saldo) })),
      compromissos: situacao, totalMes: r2(situacao.reduce((s, c) => s + c.valorMes, 0)),
      sugestaoHoje: r2(sugestao),
      movimento: { total: movimento, porForma, porAmbiente: ambientes.map((a) => ({ ambiente: a.ambiente, valor: Number(a.valor) })), conciliado: Number(conc?.valor ?? 0), linhasConciliadas: conc?.n ?? 0 },
      jaSeparado: Number(feito?.separado ?? 0), pulou: !!feito?.pulou,
      dias: dias.map((x) => ({ data: dia(x.data), movimento: Number(x.movimento), separado: Number(x.separado), pulou: x.pulou, conciliado: Number(x.conciliado) })),
      atrasados: situacao.filter((c) => c.atrasado).map((c) => ({ nome: c.nome, vencimento: c.vencimento, falta: c.falta })),
    };
  }

  async listarCompromissos(u: UsuarioToken) {
    const lista = await this.compromissos(u.empresaId, true);
    const vals = await this.valores(u.empresaId, lista, hojeSP());
    return lista.map((c) => ({ ...c, valorMes: vals.get(c.id)?.valor ?? 0, origem: vals.get(c.id)?.origem ?? '' }));
  }

  private valoresDto(dto: CompromissoDto) {
    return [dto.nome.trim(), dto.tipo, dto.valor ?? null, dto.categoria?.trim() || null, dto.percentual ?? null, dto.dia, dto.ativo ?? true];
  }

  async criarCompromisso(u: UsuarioToken, dto: CompromissoDto) {
    const [c] = await this.ds.query(`INSERT INTO reserva_compromissos (empresa_id, nome, tipo, valor, categoria, percentual, dia, ativo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [u.empresaId, ...this.valoresDto(dto)]);
    return { ok: true, id: c.id };
  }

  async atualizarCompromisso(u: UsuarioToken, id: string, dto: CompromissoDto) {
    const r = await this.ds.query(`UPDATE reserva_compromissos SET nome=$3, tipo=$4, valor=$5, categoria=$6, percentual=$7, dia=$8, ativo=$9 WHERE id=$1 AND empresa_id=$2 RETURNING id`,
      [id, u.empresaId, ...this.valoresDto(dto)]);
    if (!(Array.isArray(r?.[0]) ? r[0].length : r?.length)) throw new NotFoundException('Compromisso não encontrado.');
    return { ok: true };
  }

  /** compromissos comuns de hotel/motel para começar (não duplica os que já existem) */
  async sugeridos(u: UsuarioToken) {
    const [{ regime }] = await this.ds.query(`SELECT regime_tributario AS regime FROM empresas WHERE id = $1`, [u.empresaId]);
    const imposto = regime === 'presumido' || regime === 'real' ? 'Impostos federais e municipais (DARF/ISS)' : regime === 'mei' ? 'DAS do MEI' : 'DAS do Simples Nacional';
    const base: [string, string, number | null, string | null, number | null, number][] = [
      ['Salários (folha)', 'folha', null, null, 60, 5], ['Adiantamento salarial', 'folha', null, null, 40, 20],
      ['FGTS', 'folha', null, null, 8, 20], [imposto, 'imposto', null, null, 6, 20],
      ['Energia elétrica', 'variavel', null, 'Energia elétrica', null, 10], ['Água e esgoto', 'variavel', null, 'Água e esgoto', null, 10],
      ['Gás', 'variavel', null, 'Gás', null, 10], ['Contabilidade', 'fixo', 0, null, null, 10],
    ];
    let criados = 0;
    for (const [nome, tipo, valor, categoria, pct, d] of base) {
      const [ja] = await this.ds.query(`SELECT 1 FROM reserva_compromissos WHERE empresa_id = $1 AND lower(nome) = lower($2)`, [u.empresaId, nome]);
      if (ja) continue;
      await this.ds.query(`INSERT INTO reserva_compromissos (empresa_id, nome, tipo, valor, categoria, percentual, dia) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [u.empresaId, nome, tipo, valor, categoria, pct, d]);
      criados++;
    }
    return { ok: true, criados };
  }

  async movimentar(u: UsuarioToken, dto: MovimentoReservaDto) {
    if (dto.data > hojeSP()) throw new BadRequestException('A data não pode ser no futuro.');
    if (dto.tipo !== 'pular' && !(dto.valor > 0)) throw new BadRequestException('Informe o valor.');
    if (dto.origem === 'banco' && !dto.contaBancariaId) throw new BadRequestException('Escolha em qual conta bancária está o dinheiro.');
    if (dto.contaBancariaId) {
      const [c] = await this.ds.query(`SELECT id FROM contas_bancarias WHERE id = $1 AND empresa_id = $2`, [dto.contaBancariaId, u.empresaId]);
      if (!c) throw new BadRequestException('Conta bancária não encontrada.');
    }
    if (dto.tipo === 'pagar' || dto.tipo === 'devolver') {
      const [s] = await this.ds.query(
        `SELECT COALESCE(sum(CASE WHEN tipo = 'separar' THEN valor WHEN tipo IN ('pagar','devolver') THEN -valor ELSE 0 END), 0) AS saldo
           FROM reserva_movimentos WHERE empresa_id = $1 AND origem = $2 AND conta_bancaria_id IS NOT DISTINCT FROM $3`, [u.empresaId, dto.origem, dto.contaBancariaId ?? null]);
      if (Number(s?.saldo ?? 0) + 0.005 < dto.valor) throw new BadRequestException(`A reserva ${dto.origem === 'banco' ? 'nesta conta' : 'na gaveta'} tem só ${Number(s?.saldo ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.`);
    }
    if (dto.compromissoId) {
      const [c] = await this.ds.query(`SELECT id FROM reserva_compromissos WHERE id = $1 AND empresa_id = $2`, [dto.compromissoId, u.empresaId]);
      if (!c) throw new BadRequestException('Compromisso não encontrado.');
    }
    const [m] = await this.ds.query(
      `INSERT INTO reserva_movimentos (empresa_id, data, tipo, valor, origem, conta_bancaria_id, compromisso_id, descricao, usuario_nome) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [u.empresaId, dto.data, dto.tipo, (dto.tipo === 'pular' ? 0 : dto.valor).toFixed(2), dto.origem, dto.contaBancariaId ?? null, dto.compromissoId ?? null, dto.descricao?.trim() || null, u.nome]);
    return { ok: true, id: m.id };
  }

  async movimentos(u: UsuarioToken, de: string, ate: string) {
    const l = await this.ds.query(
      `SELECT m.*, cb.nome AS conta, c.nome AS compromisso FROM reserva_movimentos m
         LEFT JOIN contas_bancarias cb ON cb.id = m.conta_bancaria_id LEFT JOIN reserva_compromissos c ON c.id = m.compromisso_id
        WHERE m.empresa_id = $1 AND m.data BETWEEN $2 AND $3 ORDER BY m.data DESC, m.criado_em DESC LIMIT 1000`, [u.empresaId, de, ate]);
    return l.map((m: Record<string, unknown>) => ({
      id: m.id, data: dia(m.data), tipo: m.tipo, valor: Number(m.valor), onde: m.origem === 'banco' ? m.conta ?? 'Banco' : 'Gaveta do caixa ADM',
      compromisso: m.compromisso ?? null, descricao: m.descricao, usuario: m.usuario_nome, criadoEm: m.criado_em,
    }));
  }
}

@Controller('reserva')
@Requer('caixa.adm')
export class ReservaController {
  constructor(private readonly service: ReservaService) {}

  @Get()
  painel(@Usuario() u: UsuarioToken, @Query('data') data?: string) {
    return this.service.painel(u, data);
  }

  @Get('compromissos')
  compromissos(@Usuario() u: UsuarioToken) {
    return this.service.listarCompromissos(u);
  }

  @Post('compromissos')
  criar(@Usuario() u: UsuarioToken, @Body() dto: CompromissoDto) {
    return this.service.criarCompromisso(u, dto);
  }

  @Post('compromissos/sugeridos')
  sugeridos(@Usuario() u: UsuarioToken) {
    return this.service.sugeridos(u);
  }

  @Patch('compromissos/:id')
  atualizar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CompromissoDto) {
    return this.service.atualizarCompromisso(u, id, dto);
  }

  @Post('movimentos')
  movimentar(@Usuario() u: UsuarioToken, @Body() dto: MovimentoReservaDto) {
    return this.service.movimentar(u, dto);
  }

  @Get('movimentos')
  movimentos(@Usuario() u: UsuarioToken, @Query('de') de?: string, @Query('ate') ate?: string) {
    const a = ate && DATA.test(ate) ? ate : hojeSP();
    return this.service.movimentos(u, de && DATA.test(de) ? de : somaDias(a, -60), a);
  }
}
