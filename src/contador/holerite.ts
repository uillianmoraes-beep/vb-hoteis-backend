import { BadRequestException, Body, Controller, Delete, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { dirname, join, normalize, sep } from 'path';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';
import { custoBeneficios } from '../funcionarios/contrato';
import { LeitorContadorService } from './leitor';

/**
 * Conferência do holerite do contador: o sistema não faz a folha, mas confere a que o contador fez,
 * linha por linha, contra a ficha do funcionário (salário, benefícios, VT, dependentes), a escala do mês
 * (horas extras, faltas, adicional noturno) e as tabelas do INSS/IRRF (editáveis: o contador confirma as do ano).
 */

const COMPETENCIA = /^\d{4}-(0[1-9]|1[0-2])$/;
const r2 = (v: number) => Math.round(v * 100) / 100;
const n = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
const sem = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const ultimoDia = (c: string) => { const [a, m] = c.split('-').map(Number); return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10); };

/** tabelas padrão: INSS 2026 (progressiva) e IRRF com a redução de 2026 (isenção até R$ 5.000). Confirme com o contador. */
export const TABELAS_PADRAO = {
  ano: 2026,
  inss: [{ ate: 1621.0, aliquota: 7.5 }, { ate: 2902.84, aliquota: 9 }, { ate: 4354.27, aliquota: 12 }, { ate: 8475.55, aliquota: 14 }],
  irrf: [
    { ate: 2428.8, aliquota: 0, deduzir: 0 }, { ate: 2826.65, aliquota: 7.5, deduzir: 182.16 }, { ate: 3751.05, aliquota: 15, deduzir: 394.16 },
    { ate: 4664.68, aliquota: 22.5, deduzir: 675.49 }, { ate: null, aliquota: 27.5, deduzir: 908.73 },
  ],
  dependente: 189.59,
  simplificado: 607.2,
  /** redução do IR (Lei 15.270/2025): até `isencao` zera o imposto; até `limite` reduz `a − b × rendimento` */
  reducao: { isencao: 5000, limite: 7350, maximo: 312.89, a: 978.62, b: 0.133145 },
  adiantamentoPct: 40,
};
export type Tabelas = typeof TABELAS_PADRAO;

export function calcInss(base: number, t: Tabelas) {
  let ant = 0, total = 0;
  for (const f of t.inss) {
    if (base <= ant) break;
    total += (Math.min(base, f.ate) - ant) * (f.aliquota / 100);
    ant = f.ate;
  }
  return r2(total);
}

export function calcIrrf(rendimento: number, inss: number, dependentes: number, t: Tabelas) {
  const legais = inss + dependentes * t.dependente;
  const deducao = Math.max(legais, t.simplificado);
  const base = r2(Math.max(0, rendimento - deducao));
  const faixa = t.irrf.find((f) => f.ate === null || base <= f.ate) ?? t.irrf[t.irrf.length - 1];
  const bruto = Math.max(0, base * (faixa.aliquota / 100) - faixa.deduzir);
  const red = rendimento <= t.reducao.isencao ? Math.min(bruto, t.reducao.maximo) : rendimento <= t.reducao.limite ? Math.max(0, t.reducao.a - t.reducao.b * rendimento) : 0;
  return { base: r2(rendimento - legais), baseUsada: base, simplificado: deducao > legais, aliquota: faixa.aliquota, imposto: r2(Math.max(0, bruto - red)), reducao: r2(Math.min(bruto, red)) };
}

/** grupo de cada rubrica pelo texto (o contador usa códigos diferentes) */
type Grupo = 'salario' | 'extra' | 'noturno' | 'dsr' | 'falta' | 'inss' | 'irrf' | 'adiantamento' | 'vt' | 'ferias' | 'decimo' | 'salfamilia' | 'insalubridade' | 'beneficio' | 'outro';
function grupo(descricao: string, desconto: boolean): Grupo {
  const d = sem(descricao);
  if (/i\.?n\.?s\.?s|previd/.test(d)) return 'inss';
  if (/irrf|i\.r\.r\.f|imposto de renda|\bir\b/.test(d)) return 'irrf';
  if (/adiant/.test(d)) return 'adiantamento';
  if (/vale[- ]?transp|\bv\.?t\b/.test(d)) return 'vt';
  if (/falta|atraso/.test(d)) return 'falta';
  if (/(hora|hr)s?\.? ?ext|extraord|\bh\.?e\b/.test(d)) return 'extra';
  if (/notur/.test(d)) return 'noturno';
  if (/dsr|repouso/.test(d)) return 'dsr';
  if (/ferias|1\/3/.test(d)) return 'ferias';
  if (/13|decimo|gratificacao natalina/.test(d)) return 'decimo';
  if (/salario[- ]?familia/.test(d)) return 'salfamilia';
  if (/insalub|periculos/.test(d)) return 'insalubridade';
  if (!desconto && /horas normais|salario|dias trabalhados|ordenado|pro[- ]?labore/.test(d)) return 'salario';
  return 'outro';
}
/** horas da coluna Referência: "220:00" → 220, "12,5" → 12.5 */
const lerRef = (t: string) => {
  const s = t.trim();
  const m = /^(\d+):(\d{2})$/.exec(s);
  if (m) return Number(m[1]) + Number(m[2]) / 60;
  const v = Number(s.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(v) ? v : null;
};

class RubricaDto {
  @IsOptional() @IsString() @MaxLength(20) codigo?: string;
  @IsString() @MaxLength(120) descricao!: string;
  @IsOptional() @IsString() @MaxLength(20) referencia?: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(10_000_000) vencimento!: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(10_000_000) desconto!: number;
}
class DadosDto {
  @IsArray() @ArrayMaxSize(80) @ValidateNested({ each: true }) @Type(() => RubricaDto) rubricas!: RubricaDto[];
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) salarioBase!: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) baseInss!: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) baseFgts!: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) fgtsMes!: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) baseIrrf!: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) faixaIrrf?: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) totalVencimentos!: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) totalDescontos!: number;
  @IsNumber({ maxDecimalPlaces: 2 }) liquido!: number;
}
class HoleriteDto {
  @IsUUID() funcionarioId!: string;
  @Matches(COMPETENCIA) competencia!: string;
  @IsIn(['mensal', 'adiantamento', 'ferias', 'decimo1', 'decimo2', 'rescisao']) tipo!: string;
  @ValidateNested() @Type(() => DadosDto) dados!: DadosDto;
  /** o PDF/foto do holerite (data:…;base64,…), guardado nos documentos do funcionário */
  @IsOptional() @IsString() @MaxLength(11_000_000) arquivo?: string;
  @IsOptional() @IsString() @MaxLength(160) nomeArquivo?: string;
  @IsOptional() @IsString() @MaxLength(300) observacao?: string;
}
class LerDto {
  @IsString() @MaxLength(11_000_000) arquivo!: string;
}
class FaixaInssDto { @IsNumber() @Min(0) ate!: number; @IsNumber() @Min(0) @Max(100) aliquota!: number }
class FaixaIrrfDto { @IsOptional() @IsNumber() @Min(0) ate!: number | null; @IsNumber() @Min(0) @Max(100) aliquota!: number; @IsNumber() @Min(0) deduzir!: number }
class ReducaoDto { @IsNumber() @Min(0) isencao!: number; @IsNumber() @Min(0) limite!: number; @IsNumber() @Min(0) maximo!: number; @IsNumber() @Min(0) a!: number; @IsNumber() @Min(0) b!: number }
class TabelasDto {
  @IsInt() @Min(2000) @Max(2100) ano!: number;
  @IsArray() @ArrayMaxSize(8) @ValidateNested({ each: true }) @Type(() => FaixaInssDto) inss!: FaixaInssDto[];
  @IsArray() @ArrayMaxSize(8) @ValidateNested({ each: true }) @Type(() => FaixaIrrfDto) irrf!: FaixaIrrfDto[];
  @IsNumber() @Min(0) dependente!: number;
  @IsNumber() @Min(0) simplificado!: number;
  @ValidateNested() @Type(() => ReducaoDto) reducao!: ReducaoDto;
  @IsNumber() @Min(0) @Max(100) adiantamentoPct!: number;
}

export interface Item { chave: string; titulo: string; status: 'ok' | 'divergente' | 'atencao' | 'info'; esperado?: string; informado?: string; diferenca?: number; texto?: string }

@Injectable()
export class HoleriteService {
  constructor(private readonly ds: DataSource, private readonly leitor: LeitorContadorService) {}

  async tabelas(empresaId: string): Promise<Tabelas & { padrao: boolean }> {
    const [c] = await this.ds.query(`SELECT tabelas_folha FROM rh_config WHERE empresa_id = $1`, [empresaId]).catch(() => []);
    return c?.tabelas_folha ? { ...TABELAS_PADRAO, ...c.tabelas_folha, padrao: false } : { ...TABELAS_PADRAO, padrao: true };
  }

  async salvarTabelas(u: UsuarioToken, dto: TabelasDto) {
    if (!dto.irrf.length || !dto.inss.length) throw new BadRequestException('As tabelas não podem ficar vazias.');
    await this.ds.query(`INSERT INTO rh_config (empresa_id, tabelas_folha) VALUES ($1,$2) ON CONFLICT (empresa_id) DO UPDATE SET tabelas_folha = $2, atualizado_em = now()`, [u.empresaId, JSON.stringify(dto)]);
    return this.tabelas(u.empresaId);
  }

  /** lê o PDF/foto com a IA e tenta achar o funcionário pelo nome */
  async ler(u: UsuarioToken, dto: LerDto) {
    const lido = await this.leitor.lerHolerite(dto.arquivo);
    const fs_: { id: string; nome: string }[] = await this.ds.query(`SELECT id, nome FROM funcionarios WHERE empresa_id = $1 ORDER BY ativo DESC, nome`, [u.empresaId]);
    const alvo = sem(lido.funcionario).replace(/\s+/g, ' ').trim();
    const achado = fs_.find((f) => sem(f.nome).trim() === alvo) ?? fs_.find((f) => alvo && (sem(f.nome).includes(alvo) || alvo.includes(sem(f.nome).trim())))
      ?? fs_.find((f) => { const p = sem(f.nome).split(/\s+/); const q = alvo.split(' '); return p[0] === q[0] && p[p.length - 1] === q[q.length - 1]; });
    return { lido, funcionarioId: achado?.id ?? null, ia: true };
  }

  /** o que o sistema sabe do funcionário naquele mês */
  private async contexto(empresaId: string, funcionarioId: string, competencia: string) {
    const fim = ultimoDia(competencia);
    const [f] = await this.ds.query(
      `SELECT f.id, f.nome, f.admissao, c.cargo, c.salario, c.tipo_contrato, c.jornada, c.horas_semana, c.dependentes, c.adicional_noturno, c.insalubridade_pct, c.beneficios
         FROM funcionarios f LEFT JOIN funcionario_contratos c ON c.funcionario_id = f.id WHERE f.id = $1 AND f.empresa_id = $2`, [funcionarioId, empresaId]);
    if (!f) throw new NotFoundException('Funcionário não encontrado.');
    // salário que valia no mês (o histórico guarda as trocas)
    const [hist] = await this.ds.query(`SELECT salario FROM funcionario_salarios WHERE funcionario_id = $1 AND data <= $2 AND salario IS NOT NULL ORDER BY data DESC, criado_em DESC LIMIT 1`, [funcionarioId, fim]).catch(() => []);
    const [mes] = await this.ds.query(`SELECT * FROM rh_horas_mes WHERE funcionario_id = $1 AND competencia = $2`, [funcionarioId, competencia]).catch(() => []);
    const [cfg] = await this.ds.query(`SELECT fgts_pct FROM rh_config WHERE empresa_id = $1`, [empresaId]).catch(() => []);
    const [vales] = await this.ds.query(
      `SELECT COALESCE(sum(valor),0) AS total FROM funcionario_lancamentos WHERE funcionario_id = $1 AND empresa_id = $2 AND tipo IN ('vale','desconto') AND to_char(data,'YYYY-MM') = $3`,
      [funcionarioId, empresaId, competencia]).catch(() => [{ total: 0 }]);
    const salario = n(hist?.salario) ?? n(f.salario) ?? 0;
    const horasSemana = n(f.horas_semana) ?? 44;
    return {
      nome: f.nome as string, cargo: (f.cargo as string) ?? null, salario, semSalario: n(hist?.salario) === null && n(f.salario) === null,
      tipoContrato: (f.tipo_contrato as string) ?? null, jornada: (f.jornada as string) ?? null, horasSemana, horasMes: Math.round(horasSemana * 5),
      dependentes: Number(f.dependentes ?? 0), adicionalNoturno: !!f.adicional_noturno, insalubridadePct: n(f.insalubridade_pct),
      beneficios: ((f.beneficios ?? []) as { tipo: string; nome?: string; valor: number; por: string; dias?: number; descontoPct?: number }[]),
      mes: mes ? { extras: Number(mes.extras_min), destinoExtras: mes.destino_extras as string, faltas: Number(mes.faltas), destinoFaltas: mes.destino_faltas as string, noturno: Number(mes.noturno_min), feriado: Number(mes.feriado_min) } : null,
      fgtsPct: n(cfg?.fgts_pct) ?? 8, vales: Number(vales?.total ?? 0),
    };
  }

  /** compara o holerite com a ficha, a escala e as tabelas */
  conferir(ctx: Awaited<ReturnType<HoleriteService['contexto']>>, tipo: string, d: DadosDto, t: Tabelas) {
    const itens: Item[] = [];
    const add = (i: Item) => itens.push(i);
    const igual = (a: number, b: number, tol = 0.05) => Math.abs(a - b) <= tol;
    const rub = d.rubricas.map((r) => ({ ...r, grupo: grupo(r.descricao, r.desconto > 0 && !r.vencimento) }));
    const soma = (g: Grupo, campo: 'vencimento' | 'desconto') => r2(rub.filter((r) => r.grupo === g).reduce((s, r) => s + r[campo], 0));
    const valorHora = ctx.horasMes ? ctx.salario / ctx.horasMes : 0;

    // 1. totais e líquido (a conta do próprio holerite)
    const tv = r2(rub.reduce((s, r) => s + r.vencimento, 0)), td = r2(rub.reduce((s, r) => s + r.desconto, 0));
    // rodapé em branco (digitado à mão sem os totais): avisa em vez de dar erro
    const semRodape = !d.totalVencimentos && !d.totalDescontos && !d.liquido;
    if (semRodape) {
      add({ chave: 'totais', titulo: 'Totais do holerite', status: 'atencao', esperado: `${reais(tv)} − ${reais(td)} = ${reais(r2(tv - td))}`, informado: 'em branco',
        texto: 'o rodapé (total de vencimentos, de descontos e líquido) não foi preenchido: o sistema somou as linhas' });
    } else {
      add({ chave: 'totais', titulo: 'Soma das linhas', status: igual(tv, d.totalVencimentos) && igual(td, d.totalDescontos) ? 'ok' : 'divergente',
        esperado: `${reais(tv)} − ${reais(td)}`, informado: `${reais(d.totalVencimentos)} − ${reais(d.totalDescontos)}`, texto: 'vencimentos e descontos somados linha por linha' });
      add({ chave: 'liquido', titulo: 'Valor líquido', status: igual(r2(d.totalVencimentos - d.totalDescontos), d.liquido) ? 'ok' : 'divergente',
        esperado: reais(r2(d.totalVencimentos - d.totalDescontos)), informado: reais(d.liquido), diferenca: r2(d.liquido - (d.totalVencimentos - d.totalDescontos)) });
    }

    if (ctx.semSalario) add({ chave: 'ficha', titulo: 'Ficha do funcionário', status: 'atencao', texto: 'sem salário na ficha (Funcionários → Contrato e salário): não dá para conferir os valores' });

    if (tipo === 'mensal') {
      // 2. salário
      const sal = soma('salario', 'vencimento');
      if (!ctx.semSalario) {
        add({ chave: 'salariobase', titulo: 'Salário base', status: igual(d.salarioBase, ctx.salario) ? 'ok' : 'divergente', esperado: reais(ctx.salario), informado: reais(d.salarioBase), diferenca: r2(d.salarioBase - ctx.salario),
          texto: igual(d.salarioBase, ctx.salario) ? undefined : 'o salário do holerite não bate com a ficha: confira se houve aumento (Contrato e salário → histórico)' });
        if (sal) {
          const ref = rub.find((r) => r.grupo === 'salario')?.referencia;
          add({ chave: 'salario', titulo: 'Salário pago (horas normais)', status: igual(sal, ctx.salario, 0.5) ? 'ok' : sal < ctx.salario && ctx.mes?.faltas ? 'info' : 'atencao',
            esperado: reais(ctx.salario), informado: `${reais(sal)}${ref ? ` (${ref})` : ''}`, diferenca: r2(sal - ctx.salario),
            texto: sal < ctx.salario - 0.5 ? 'pago menos que o salário: pode ser falta, admissão ou afastamento no mês' : undefined });
        }
      }
      // 3. horas extras (da escala, fechamento do mês)
      const ext = rub.filter((r) => r.grupo === 'extra');
      const extValor = r2(ext.reduce((s, r) => s + r.vencimento, 0));
      const extHoras = ext.reduce((s, r) => s + (lerRef(r.referencia ?? '') ?? 0), 0);
      const sisExtras = ctx.mes && ctx.mes.destinoExtras === 'pagar' ? ctx.mes.extras / 60 : 0;
      if (!ctx.mes) add({ chave: 'escala', titulo: 'Escala do mês', status: 'info', texto: 'o mês ainda não foi fechado na escala (Escala → Banco de horas): horas extras e faltas não foram conferidas' });
      if (ctx.mes || extValor) {
        const esperado = r2(valorHora * 1.5 * sisExtras);
        const okHoras = Math.abs(extHoras - sisExtras) < 0.1;
        add({ chave: 'extras', titulo: 'Horas extras', status: !sisExtras && !extValor ? 'ok' : okHoras && (igual(extValor, esperado, Math.max(1, esperado * 0.02)) || extValor > esperado) ? 'ok' : !ctx.mes ? 'atencao' : 'divergente',
          esperado: `${sisExtras.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} h · ${reais(esperado)} (50%)`, informado: `${extHoras.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} h · ${reais(extValor)}`,
          texto: ctx.mes?.destinoExtras === 'banco' ? 'as extras deste mês foram para o banco de horas (não devem ser pagas)' : 'pela escala fechada; a hora extra vale 50% a mais (ou o que a convenção mandar)' });
      }
      // 4. adicional noturno
      const not = soma('noturno', 'vencimento');
      if (not || (ctx.mes?.noturno && ctx.adicionalNoturno)) {
        const horasN = (ctx.mes?.noturno ?? 0) / 52.5; // hora noturna de 52min30s
        const esperado = r2(valorHora * 0.2 * horasN);
        add({ chave: 'noturno', titulo: 'Adicional noturno (20%)', status: igual(not, esperado, Math.max(1, esperado * 0.03)) ? 'ok' : 'atencao', esperado: reais(esperado), informado: reais(not),
          texto: !ctx.adicionalNoturno && not ? 'pagou adicional noturno mas a ficha não marca: atualize a ficha' : ctx.adicionalNoturno && !not ? 'a escala tem horas noturnas e o holerite não paga o adicional' : undefined });
      }
      // 5. faltas
      const falt = soma('falta', 'desconto');
      const sisFaltas = ctx.mes && ctx.mes.destinoFaltas === 'descontar' ? ctx.mes.faltas : 0;
      if (falt || sisFaltas) {
        const esperado = r2((ctx.salario / 30) * sisFaltas);
        add({ chave: 'faltas', titulo: 'Desconto de faltas', status: igual(falt, esperado, 1) || (falt > esperado && sisFaltas) ? 'ok' : 'divergente', esperado: `${sisFaltas} falta(s) · ${reais(esperado)}`, informado: reais(falt),
          texto: 'pela escala; a falta sem justificativa também pode descontar o descanso semanal (DSR) da semana' });
      }
      // 6. adiantamento
      const adi = soma('adiantamento', 'desconto');
      if (ctx.semSalario) {
        if (adi) add({ chave: 'adiantamento', titulo: `Desconto do adiantamento (${t.adiantamentoPct}%)`, status: 'atencao', informado: reais(adi), texto: 'sem salário na ficha: não dá para conferir' });
      } else if (adi || t.adiantamentoPct) {
        const esperado = r2((ctx.salario * t.adiantamentoPct) / 100);
        add({ chave: 'adiantamento', titulo: `Desconto do adiantamento (${t.adiantamentoPct}%)`, status: !adi ? 'atencao' : igual(adi, esperado, 0.5) ? 'ok' : 'divergente', esperado: reais(esperado), informado: reais(adi),
          texto: !adi ? 'não descontou adiantamento: confira se ele recebeu adiantamento no dia 20' : undefined });
      }
      // 7. vale-transporte
      const vt = ctx.beneficios.find((b) => b.tipo === 'vt');
      const vtDesc = soma('vt', 'desconto');
      if (vt || vtDesc) {
        const esperado = vt ? custoBeneficios(ctx.salario, [vt]).desconto : 0;
        add({ chave: 'vt', titulo: 'Desconto do vale-transporte', status: igual(vtDesc, esperado, 0.5) ? 'ok' : 'divergente', esperado: reais(esperado), informado: reais(vtDesc),
          texto: vt ? `até ${vt.descontoPct ?? 0}% do salário, limitado ao valor do vale` : 'desconta VT mas a ficha não tem vale-transporte' });
      }
      // 8. benefícios da ficha que vão no holerite
      for (const b of ctx.beneficios.filter((x) => ['gratificacao', 'abono', 'ppr', 'quebra', 'outro'].includes(x.tipo))) {
        const nome = b.nome || ({ gratificacao: 'Gratificação', abono: 'Abono', ppr: 'PPR', quebra: 'Quebra de caixa', outro: 'Outro' } as Record<string, string>)[b.tipo];
        const chave = sem(nome).split(/\s+/)[0];
        const achou = rub.find((r) => r.vencimento > 0 && sem(r.descricao).includes(chave));
        const valor = b.por === 'dia' ? b.valor * (b.dias ?? 22) : b.valor;
        if (achou) { achou.grupo = 'beneficio'; }
        add({ chave: `ben:${chave}`, titulo: nome, status: achou ? (igual(achou.vencimento, valor, 0.5) ? 'ok' : 'divergente') : b.tipo === 'ppr' ? 'info' : 'atencao', esperado: reais(valor), informado: achou ? reais(achou.vencimento) : 'não veio',
          texto: achou ? undefined : b.tipo === 'ppr' ? 'PPR costuma ser pago em meses certos' : 'está na ficha e não veio no holerite' });
      }
      if (ctx.insalubridadePct) {
        const ins = soma('insalubridade', 'vencimento');
        add({ chave: 'insalubridade', titulo: `Insalubridade (${ctx.insalubridadePct}%)`, status: ins ? 'ok' : 'atencao', informado: reais(ins), texto: ins ? 'a base (salário mínimo ou salário) depende da convenção' : 'está na ficha e não veio no holerite' });
      }
      // 9. o que veio no holerite e não está na ficha
      for (const r of rub.filter((x) => x.grupo === 'outro' && x.vencimento > 0)) {
        add({ chave: `extra:${r.codigo || r.descricao}`, titulo: r.descricao, status: 'atencao', informado: reais(r.vencimento), texto: 'pago no holerite e não está na ficha do funcionário: se for fixo, cadastre em Contrato e salário' });
      }
      for (const r of rub.filter((x) => x.grupo === 'outro' && x.desconto > 0)) {
        add({ chave: `desc:${r.codigo || r.descricao}`, titulo: r.descricao, status: 'info', informado: reais(r.desconto),
          texto: ctx.vales && /vale|emprest|adiant/.test(sem(r.descricao)) ? `vales lançados no sistema no mês: ${reais(ctx.vales)}` : 'desconto que o sistema não controla: confira com o funcionário' });
      }
      if (ctx.vales && !rub.some((r) => r.desconto > 0 && /vale|emprest/.test(sem(r.descricao)) && r.grupo !== 'vt')) {
        add({ chave: 'vales', titulo: 'Vales do funcionário', status: 'atencao', esperado: reais(ctx.vales), informado: 'não veio', texto: 'tem vales/descontos lançados na ficha financeira neste mês e o holerite não desconta' });
      }
    }

    if (tipo === 'adiantamento') {
      const esperado = r2((ctx.salario * t.adiantamentoPct) / 100);
      add({ chave: 'adiantamento', titulo: `Adiantamento (${t.adiantamentoPct}%)`, status: igual(d.liquido, esperado, 0.5) ? 'ok' : 'divergente', esperado: reais(esperado), informado: reais(d.liquido) });
    }

    // 10. INSS, FGTS e IRRF (valem para todos os tipos)
    const naoIncide = new Set<Grupo>(['salfamilia', 'vt']);
    const baseCalc = r2(rub.filter((r) => !naoIncide.has(r.grupo)).reduce((s, r) => s + r.vencimento, 0) - soma('falta', 'desconto'));
    if (tipo !== 'adiantamento') {
      add({ chave: 'baseinss', titulo: 'Base do INSS', status: igual(baseCalc, d.baseInss, 0.5) ? 'ok' : 'divergente', esperado: reais(baseCalc), informado: reais(d.baseInss),
        texto: 'soma do que foi pago (menos faltas, salário-família e vale-transporte)' });
      const inss = soma('inss', 'desconto');
      const inssCalc = calcInss(d.baseInss, t);
      add({ chave: 'inss', titulo: `INSS (tabela ${t.ano})`, status: igual(inss, inssCalc, 0.1) ? 'ok' : 'divergente', esperado: reais(inssCalc), informado: reais(inss), diferenca: r2(inss - inssCalc),
        texto: d.baseInss ? `alíquota efetiva ${((inss / d.baseInss) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%` : undefined });
      const fgtsCalc = r2((d.baseFgts * ctx.fgtsPct) / 100);
      add({ chave: 'fgts', titulo: `FGTS (${ctx.fgtsPct}%)`, status: igual(d.fgtsMes, fgtsCalc, 0.05) ? 'ok' : 'divergente', esperado: reais(fgtsCalc), informado: reais(d.fgtsMes),
        texto: igual(d.baseFgts, d.baseInss, 0.5) ? 'a casa deposita, não sai do salário' : 'a base do FGTS está diferente da base do INSS: confira' });
      const ir = calcIrrf(d.baseInss, inss, ctx.dependentes, t);
      const irDesc = soma('irrf', 'desconto');
      add({ chave: 'baseirrf', titulo: 'Base do IRRF', status: igual(d.baseIrrf, ir.base, 0.5) ? 'ok' : 'atencao', esperado: reais(ir.base), informado: reais(d.baseIrrf),
        texto: `pago − INSS${ctx.dependentes ? ` − ${ctx.dependentes} dependente(s)` : ''}${ctx.dependentes === 0 ? ' (ficha sem dependentes)' : ''}` });
      add({ chave: 'irrf', titulo: 'Imposto de renda (IRRF)', status: igual(irDesc, ir.imposto, 0.5) ? 'ok' : 'divergente', esperado: reais(ir.imposto), informado: reais(irDesc),
        texto: ir.reducao ? `com a redução da lei (${reais(ir.reducao)}): até ${reais(t.reducao.isencao)} não paga` : ir.simplificado ? 'pelo desconto simplificado' : undefined });
    }

    // sem salário na ficha, o que depende do salário não é erro do contador: fica para conferir
    if (ctx.semSalario) {
      for (const i of itens) {
        if (i.status === 'divergente' && (['extras', 'faltas', 'vt', 'noturno', 'adiantamento'].includes(i.chave) || i.chave.startsWith('ben:'))) {
          i.status = 'atencao';
          i.texto = `${i.texto ? `${i.texto} · ` : ''}sem salário na ficha, não dá para conferir`;
        }
      }
    }
    const resumo = { divergencias: itens.filter((i) => i.status === 'divergente').length, atencoes: itens.filter((i) => i.status === 'atencao').length };
    return { itens, resumo, status: resumo.divergencias ? 'divergente' : resumo.atencoes ? 'atencao' : 'ok' };
  }

  private pasta() {
    const p = (process.env.VB_FOTOS_DIR || '').trim();
    if (!p) throw new BadRequestException('A pasta de arquivos não está configurada neste servidor (VB_FOTOS_DIR). Fale com a Virtual Barra.');
    return normalize(p);
  }

  /** guarda o PDF/foto como documento do funcionário (tipo Holerite) */
  private async guardarArquivo(u: UsuarioToken, funcionarioId: string, dataUrl: string, nome: string, descricao: string) {
    const a = this.leitor.arquivo(dataUrl);
    const id = randomUUID();
    const rel = join(u.empresaId, 'funcionarios', funcionarioId, `${id}.${a.ext}`);
    const base = this.pasta();
    const abs = normalize(join(base, rel));
    if (!abs.startsWith(base.endsWith(sep) ? base : base + sep)) throw new BadRequestException('Caminho inválido.');
    await fs.mkdir(dirname(abs), { recursive: true });
    await fs.writeFile(abs, a.bin);
    await this.ds.query(
      `INSERT INTO funcionario_documentos (id, empresa_id, funcionario_id, tipo, descricao, nome_arquivo, mime, arquivo, bytes, enviado_por) VALUES ($1,$2,$3,'holerite',$4,$5,$6,$7,$8,$9)`,
      [id, u.empresaId, funcionarioId, descricao.slice(0, 120), nome.slice(0, 160), a.mime, rel, a.bin.length, u.nome]);
    return id;
  }

  async salvar(u: UsuarioToken, dto: HoleriteDto) {
    const ctx = await this.contexto(u.empresaId, dto.funcionarioId, dto.competencia);
    const t = await this.tabelas(u.empresaId);
    const c = this.conferir(ctx, dto.tipo, dto.dados, t);
    const nomeTipo = { mensal: 'Holerite', adiantamento: 'Adiantamento', ferias: 'Férias', decimo1: '13º (1ª parcela)', decimo2: '13º (2ª parcela)', rescisao: 'Rescisão' }[dto.tipo] ?? 'Holerite';
    const doc = dto.arquivo ? await this.guardarArquivo(u, dto.funcionarioId, dto.arquivo, dto.nomeArquivo || 'holerite.pdf', `${nomeTipo} ${dto.competencia.split('-').reverse().join('/')}`) : null;
    const [r] = await this.ds.query(
      `INSERT INTO holerites (empresa_id, funcionario_id, competencia, tipo, dados, documento_id, status, divergencias, atencoes, liquido, observacao, criado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (funcionario_id, competencia, tipo) DO UPDATE SET dados=$5, documento_id=COALESCE($6, holerites.documento_id), status=$7, divergencias=$8, atencoes=$9, liquido=$10, observacao=$11, criado_por=$12, criado_em=now()
       RETURNING id`,
      [u.empresaId, dto.funcionarioId, dto.competencia, dto.tipo, JSON.stringify(dto.dados), doc, c.status, c.resumo.divergencias, c.resumo.atencoes, dto.dados.liquido, dto.observacao?.trim() || null, u.nome]);
    return { ok: true, id: r.id, ...c };
  }

  /** confere sem salvar (para ver antes) */
  async previa(u: UsuarioToken, dto: HoleriteDto) {
    const ctx = await this.contexto(u.empresaId, dto.funcionarioId, dto.competencia);
    return { ...this.conferir(ctx, dto.tipo, dto.dados, await this.tabelas(u.empresaId)), ficha: { nome: ctx.nome, salario: ctx.salario, dependentes: ctx.dependentes, mesFechado: !!ctx.mes } };
  }

  async listar(u: UsuarioToken, competencia?: string) {
    const c = competencia && COMPETENCIA.test(competencia) ? competencia : null;
    const l = await this.ds.query(
      `SELECT h.id, h.funcionario_id, f.nome, h.competencia, h.tipo, h.dados, h.status, h.divergencias, h.atencoes, h.liquido, h.documento_id, h.criado_por, h.criado_em
         FROM holerites h JOIN funcionarios f ON f.id = h.funcionario_id WHERE h.empresa_id = $1 ${c ? 'AND h.competencia = $2' : ''} ORDER BY h.competencia DESC, f.nome LIMIT 500`,
      c ? [u.empresaId, c] : [u.empresaId]);
    const ativos: { id: string; nome: string }[] = c ? await this.ds.query(`SELECT id, nome FROM funcionarios WHERE empresa_id = $1 AND ativo ORDER BY nome`, [u.empresaId]) : [];
    const com = new Set(l.filter((x: { tipo: string }) => x.tipo === 'mensal').map((x: { funcionario_id: string }) => x.funcionario_id));
    // a conferência é refeita com a ficha e as regras de hoje (a ficha pode ter sido corrigida depois de salvar)
    if (c && l.length <= 200) {
      const t = await this.tabelas(u.empresaId);
      for (const x of l as Record<string, unknown>[]) {
        try {
          const nova = this.conferir(await this.contexto(u.empresaId, x.funcionario_id as string, x.competencia as string), x.tipo as string, x.dados as DadosDto, t);
          if (nova.status !== x.status || nova.resumo.divergencias !== Number(x.divergencias) || nova.resumo.atencoes !== Number(x.atencoes)) {
            await this.ds.query(`UPDATE holerites SET status = $2, divergencias = $3, atencoes = $4 WHERE id = $1`, [x.id, nova.status, nova.resumo.divergencias, nova.resumo.atencoes]);
          }
          Object.assign(x, { status: nova.status, divergencias: nova.resumo.divergencias, atencoes: nova.resumo.atencoes });
        } catch { /* fica o resultado guardado */ }
      }
    }
    return {
      competencia: c, ia: this.leitor.disponivel,
      lista: l.map((x: Record<string, unknown>) => ({
        id: x.id, funcionarioId: x.funcionario_id, nome: x.nome, competencia: x.competencia, tipo: x.tipo, status: x.status, divergencias: Number(x.divergencias), atencoes: Number(x.atencoes),
        liquido: Number(x.liquido), documentoId: x.documento_id ?? null, por: x.criado_por, em: x.criado_em,
      })),
      faltando: ativos.filter((f) => !com.has(f.id)).map((f) => f.nome),
    };
  }

  async ver(u: UsuarioToken, id: string) {
    const [h] = await this.ds.query(`SELECT h.*, f.nome FROM holerites h JOIN funcionarios f ON f.id = h.funcionario_id WHERE h.id = $1 AND h.empresa_id = $2`, [id, u.empresaId]);
    if (!h) throw new NotFoundException('Holerite não encontrado.');
    const ctx = await this.contexto(u.empresaId, h.funcionario_id, h.competencia);
    const c = this.conferir(ctx, h.tipo, h.dados, await this.tabelas(u.empresaId));
    return {
      id: h.id, funcionarioId: h.funcionario_id, nome: h.nome, competencia: h.competencia, tipo: h.tipo, dados: h.dados, documentoId: h.documento_id ?? null, observacao: h.observacao,
      por: h.criado_por, em: h.criado_em, ficha: { salario: ctx.salario, cargo: ctx.cargo, dependentes: ctx.dependentes, mesFechado: !!ctx.mes }, ...c,
    };
  }

  async apagar(u: UsuarioToken, id: string) {
    await this.ds.query(`DELETE FROM holerites WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    return { ok: true };
  }
}

@Controller('contador/holerites')
export class HoleriteController {
  constructor(private readonly service: HoleriteService) {}

  @Get()
  @Requer('funcionarios.gerenciar', 'funcionarios.financeiro', 'contador.acessar')
  listar(@Usuario() u: UsuarioToken, @Query('competencia') competencia?: string) {
    return this.service.listar(u, competencia);
  }

  @Get('tabelas')
  @Requer('funcionarios.gerenciar', 'funcionarios.financeiro', 'contador.acessar')
  tabelas(@Usuario() u: UsuarioToken) {
    return this.service.tabelas(u.empresaId);
  }

  @Put('tabelas')
  @Requer('funcionarios.gerenciar', 'funcionarios.financeiro', 'contador.acessar')
  salvarTabelas(@Usuario() u: UsuarioToken, @Body() dto: TabelasDto) {
    return this.service.salvarTabelas(u, dto);
  }

  @Post('ler')
  @Requer('funcionarios.gerenciar', 'funcionarios.financeiro', 'contador.acessar')
  ler(@Usuario() u: UsuarioToken, @Body() dto: LerDto) {
    return this.service.ler(u, dto);
  }

  @Post('previa')
  @Requer('funcionarios.gerenciar', 'funcionarios.financeiro', 'contador.acessar')
  previa(@Usuario() u: UsuarioToken, @Body() dto: HoleriteDto) {
    return this.service.previa(u, dto);
  }

  @Post()
  @Requer('funcionarios.gerenciar', 'funcionarios.financeiro', 'contador.acessar')
  salvar(@Usuario() u: UsuarioToken, @Body() dto: HoleriteDto) {
    return this.service.salvar(u, dto);
  }

  @Get(':id')
  @Requer('funcionarios.gerenciar', 'funcionarios.financeiro', 'contador.acessar')
  ver(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.ver(u, id);
  }

  @Delete(':id')
  @Requer('funcionarios.gerenciar', 'funcionarios.financeiro', 'contador.acessar')
  apagar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.apagar(u, id);
  }
}

