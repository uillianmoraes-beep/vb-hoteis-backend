import { BadRequestException, Body, Controller, Delete, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

/**
 * Escala de trabalho: quem trabalha, em que horário, e quem folga em cada dia.
 * Gera a escala por padrão (6x1, 5x2, 12x36 ou ciclo de N dias) e confere as regras da CLT de hoje:
 * folga semanal (art. 67), 11h entre jornadas (art. 66), jornada máxima, intervalo (art. 71) e domingo de folga.
 * As regras ficam em rh_config para mudar quando a lei da 6x1 mudar. As horas extras, noturnas (22h às 5h, hora de
 * 52min30s) e de feriado alimentam a conferência do holerite do contador.
 */

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const DIA = 86_400_000;
const TIPOS = ['trabalho', 'folga', 'falta', 'atestado'] as const;
type Tipo = (typeof TIPOS)[number] | 'ferias';
const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const dia = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);
const somaDias = (d: string, k: number) => new Date(Date.parse(`${d}T12:00:00Z`) + k * DIA).toISOString().slice(0, 10);
const difDias = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DIA);
const diaSemana = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
const hm = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
const br = (d: string) => d.split('-').reverse().join('/');
const horas = (m: number) => `${Math.floor(m / 60)}h${m % 60 ? String(Math.round(m % 60)).padStart(2, '0') : ''}`;
const sobrepoe = (a: number, b: number, c: number, d: number) => Math.max(0, Math.min(b, d) - Math.max(a, c));

/** feriados nacionais do ano (Sexta-feira Santa pela Páscoa) */
function feriadosNacionais(ano: number) {
  // Páscoa (algoritmo de Meeus)
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), diaP = ((h + l - 7 * m + 114) % 31) + 1;
  const pascoa = `${ano}-${String(mes).padStart(2, '0')}-${String(diaP).padStart(2, '0')}`;
  return [
    [`${ano}-01-01`, 'Confraternização Universal'], [somaDias(pascoa, -2), 'Sexta-feira Santa'], [`${ano}-04-21`, 'Tiradentes'], [`${ano}-05-01`, 'Dia do Trabalho'],
    [`${ano}-09-07`, 'Independência'], [`${ano}-10-12`, 'Nossa Senhora Aparecida'], [`${ano}-11-02`, 'Finados'], [`${ano}-11-15`, 'Proclamação da República'],
    [`${ano}-11-20`, 'Consciência Negra'], [`${ano}-12-25`, 'Natal'],
  ] as [string, string][];
}

/** minutos trabalhados, noturnos (22h às 5h) e o acréscimo da hora noturna reduzida */
function calcular(inicio: string, fim: string, intervalo: number) {
  const ini = hm(inicio);
  let f = hm(fim);
  if (f <= ini) f += 1440;
  const bruto = f - ini;
  const trabalhado = Math.max(0, bruto - intervalo);
  const noturno = sobrepoe(ini, f, -120, 300) + sobrepoe(ini, f, 1320, 1740) + sobrepoe(ini, f, 2760, 3180);
  // hora noturna tem 52min30s: 7h reais contam como 8h
  const reducao = Math.round(noturno * (60 / 52.5 - 1));
  return { bruto, trabalhado, noturno, reducao, fimAbs: f, iniAbs: ini };
}

class TurnoDto {
  @IsString() @MaxLength(40) nome!: string;
  @Matches(HORA) inicio!: string;
  @Matches(HORA) fim!: string;
  @IsInt() @Min(0) @Max(240) intervaloMin!: number;
  @IsOptional() @Matches(/^#[0-9A-Fa-f]{6}$/) cor?: string;
}
class DiaDto {
  @IsUUID() funcionarioId!: string;
  @Matches(DATA) data!: string;
  @IsIn([...TIPOS, 'limpar']) tipo!: (typeof TIPOS)[number] | 'limpar';
  @IsOptional() @IsUUID() turnoId?: string;
  @IsOptional() @Matches(HORA) inicio?: string;
  @IsOptional() @Matches(HORA) fim?: string;
  @IsOptional() @IsInt() @Min(0) @Max(240) intervaloMin?: number;
  @IsOptional() @IsString() @MaxLength(200) observacao?: string;
  /** atestado anexado (documento do funcionário); vale para falta e atestado */
  @IsOptional() @IsUUID() documentoId?: string;
}
class DiasDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => DiaDto) itens!: DiaDto[];
}
class GerarDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @IsUUID('all', { each: true }) funcionarioIds!: string[];
  @Matches(DATA) de!: string;
  @Matches(DATA) ate!: string;
  /** semanal = folga em dias fixos da semana (6x1 ou 5x2 fixo); ciclo = N dias de trabalho e M de folga (12x36 = 1 e 1, 6x1 corrido = 6 e 1) */
  @IsIn(['semanal', 'ciclo']) modo!: 'semanal' | 'ciclo';
  /** 0 = domingo … 6 = sábado */
  @IsOptional() @IsArray() @ArrayMaxSize(6) @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true }) folgasSemana?: number[];
  @IsOptional() @IsInt() @Min(1) @Max(14) trabalhaDias?: number;
  @IsOptional() @IsInt() @Min(1) @Max(7) folgaDias?: number;
  /** primeiro dia de trabalho do ciclo (padrão: a data de início) */
  @IsOptional() @Matches(DATA) inicioCiclo?: string;
  @IsOptional() @IsUUID() turnoId?: string;
  @IsOptional() @Matches(HORA) inicio?: string;
  @IsOptional() @Matches(HORA) fim?: string;
  @IsOptional() @IsInt() @Min(0) @Max(240) intervaloMin?: number;
  /** troca o que já estava na escala (senão só preenche os dias vazios) */
  @IsOptional() @IsBoolean() sobrescrever?: boolean;
}
class CopiarDto {
  @Matches(DATA) origem!: string;
  @Matches(DATA) destino!: string;
  /** tamanho do bloco copiado (7 = uma semana) */
  @IsInt() @Min(1) @Max(31) dias!: number;
  @IsInt() @Min(1) @Max(12) vezes!: number;
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsUUID('all', { each: true }) funcionarioIds?: string[];
  @IsOptional() @IsBoolean() sobrescrever?: boolean;
}
class FeriadoDto {
  @Matches(DATA) data!: string;
  @IsString() @MaxLength(80) nome!: string;
}
class RegrasDto {
  @IsInt() @Min(1) @Max(13) maxDiasSeguidos!: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(24) interjornadaH!: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(4) @Max(24) jornadaMaxH!: number;
  @IsInt() @Min(1) @Max(52) domingoSemanas!: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(60) horasSemana!: number;
}

interface DiaEscala { tipo: Tipo; turnoId: string | null; inicio: string | null; fim: string | null; intervaloMin: number; observacao: string | null; documentoId: string | null }

@Injectable()
export class EscalaService {
  constructor(private readonly ds: DataSource) {}

  async regras(empresaId: string) {
    const [c] = await this.ds.query(
      `SELECT escala_max_dias_seguidos AS m, escala_interjornada_h AS i, escala_jornada_max_h AS j, escala_domingo_semanas AS d, escala_horas_semana AS h FROM rh_config WHERE empresa_id = $1`, [empresaId]);
    return { maxDiasSeguidos: c ? Number(c.m) : 6, interjornadaH: c ? Number(c.i) : 11, jornadaMaxH: c ? Number(c.j) : 10, domingoSemanas: c ? Number(c.d) : 7, horasSemana: c ? Number(c.h) : 44 };
  }

  async salvarRegras(u: UsuarioToken, dto: RegrasDto) {
    await this.ds.query(
      `INSERT INTO rh_config (empresa_id, escala_max_dias_seguidos, escala_interjornada_h, escala_jornada_max_h, escala_domingo_semanas, escala_horas_semana) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (empresa_id) DO UPDATE SET escala_max_dias_seguidos=$2, escala_interjornada_h=$3, escala_jornada_max_h=$4, escala_domingo_semanas=$5, escala_horas_semana=$6, atualizado_em=now()`,
      [u.empresaId, dto.maxDiasSeguidos, dto.interjornadaH, dto.jornadaMaxH, dto.domingoSemanas, dto.horasSemana]);
    return this.regras(u.empresaId);
  }

  private async turnos(empresaId: string) {
    const l = await this.ds.query(`SELECT id, nome, inicio, fim, intervalo_min, cor, ativo FROM escala_turnos WHERE empresa_id = $1 ORDER BY ativo DESC, inicio, nome`, [empresaId]);
    return l.map((t: Record<string, unknown>) => {
      const c = calcular(t.inicio as string, t.fim as string, Number(t.intervalo_min));
      return { id: t.id as string, nome: t.nome as string, inicio: t.inicio as string, fim: t.fim as string, intervaloMin: Number(t.intervalo_min), cor: (t.cor as string) ?? null, ativo: !!t.ativo, minutos: c.trabalhado, noturno: c.noturno > 0 };
    });
  }

  private async feriados(empresaId: string, de: string, ate: string) {
    const locais = await this.ds.query(`SELECT id, data, nome FROM feriados WHERE empresa_id = $1 AND data BETWEEN $2 AND $3`, [empresaId, de, ate]);
    const m = new Map<string, { data: string; nome: string; nacional: boolean; id: string | null }>();
    for (let a = Number(de.slice(0, 4)); a <= Number(ate.slice(0, 4)); a++) {
      for (const [d, nome] of feriadosNacionais(a)) if (d >= de && d <= ate) m.set(d, { data: d, nome, nacional: true, id: null });
    }
    for (const f of locais) m.set(dia(f.data)!, { data: dia(f.data)!, nome: f.nome, nacional: false, id: f.id });
    return [...m.values()].sort((a, b) => a.data.localeCompare(b.data));
  }

  async ver(u: UsuarioToken, deQ?: string, ateQ?: string) {
    const hoje = hojeSP();
    let de = deQ && DATA.test(deQ) ? deQ : somaDias(hoje, -((diaSemana(hoje) + 6) % 7));
    let ate = ateQ && DATA.test(ateQ) ? ateQ : somaDias(de, 6);
    if (ate < de) [de, ate] = [ate, de];
    if (difDias(de, ate) > 62) throw new BadRequestException('Escolha no máximo 2 meses.');
    const regras = await this.regras(u.empresaId);
    // busca para trás para os alertas (dias seguidos, domingos) e para fechar a semana que termina no período
    const busca = somaDias(de, -Math.max(14, regras.domingoSemanas * 7 + 7));
    const [funcs, turnos, feriados, linhas, ferias] = await Promise.all([
      this.ds.query(
        `SELECT f.id, f.nome, f.funcao, c.cargo, c.jornada, c.horas_semana, c.adicional_noturno, c.tipo_contrato
           FROM funcionarios f LEFT JOIN funcionario_contratos c ON c.funcionario_id = f.id
          WHERE f.empresa_id = $1 AND f.ativo AND (c.demissao IS NULL OR c.demissao >= $2) ORDER BY f.nome`, [u.empresaId, de]),
      this.turnos(u.empresaId),
      this.feriados(u.empresaId, busca, ate),
      this.ds.query(`SELECT * FROM escala_dias WHERE empresa_id = $1 AND data BETWEEN $2 AND $3`, [u.empresaId, busca, ate]),
      this.ds.query(`SELECT funcionario_id, inicio, dias FROM funcionario_ferias WHERE empresa_id = $1 AND status <> 'cancelada' AND inicio <= $3 AND inicio + dias > $2`, [u.empresaId, busca, ate]),
    ]);
    const feriadoDe = new Map(feriados.map((f) => [f.data, f]));
    const porFunc = new Map<string, Map<string, DiaEscala>>();
    for (const x of linhas) {
      if (!porFunc.has(x.funcionario_id)) porFunc.set(x.funcionario_id, new Map());
      porFunc.get(x.funcionario_id)!.set(dia(x.data)!, { tipo: x.tipo, turnoId: x.turno_id ?? null, inicio: x.inicio ?? null, fim: x.fim ?? null, intervaloMin: Number(x.intervalo_min) || 0, observacao: x.observacao ?? null, documentoId: x.documento_id ?? null });
    }
    // férias programadas aparecem sozinhas na escala
    for (const f of ferias) {
      if (!porFunc.has(f.funcionario_id)) porFunc.set(f.funcionario_id, new Map());
      const ini = dia(f.inicio)!;
      for (let k = 0; k < Number(f.dias); k++) porFunc.get(f.funcionario_id)!.set(somaDias(ini, k), { tipo: 'ferias', turnoId: null, inicio: null, fim: null, intervaloMin: 0, observacao: null, documentoId: null });
    }
    const datas: string[] = [];
    for (let d = de; d <= ate; d = somaDias(d, 1)) datas.push(d);

    const lista = funcs.map((f: Record<string, unknown>) => {
      const jornada = (f.jornada as string) ?? null;
      const doze = jornada === '12x36';
      const horasSemana = f.horas_semana !== null && f.horas_semana !== undefined ? Number(f.horas_semana) : regras.horasSemana;
      const limiteDia = doze ? 720 : Math.max(480, Math.round((horasSemana * 60) / (jornada === '5x2' ? 5 : 6)));
      const maxDia = doze ? 720 : Math.round(regras.jornadaMaxH * 60);
      const mapa = porFunc.get(f.id as string) ?? new Map<string, DiaEscala>();
      const alertas: { data: string; texto: string }[] = [];
      const calc = new Map<string, ReturnType<typeof calcular>>();
      for (const [d, x] of mapa) if (x.tipo === 'trabalho' && x.inicio && x.fim) calc.set(d, calcular(x.inicio, x.fim, x.intervaloMin));

      // regras dia a dia (desde a busca, alerta só dentro do período)
      let seguidos = 0;
      for (let d = busca; d <= ate; d = somaDias(d, 1)) {
        const x = mapa.get(d);
        const dentro = d >= de;
        seguidos = x?.tipo === 'trabalho' ? seguidos + 1 : 0;
        if (dentro && seguidos === regras.maxDiasSeguidos + 1) alertas.push({ data: d, texto: `${seguidos}º dia seguido sem folga (a regra é folgar depois de no máximo ${regras.maxDiasSeguidos})` });
        const c = calc.get(d);
        if (!dentro || !c) continue;
        if (c.trabalhado > maxDia) alertas.push({ data: d, texto: `jornada de ${horas(c.trabalhado)} (máximo ${horas(maxDia)})` });
        if (c.bruto > 360 && x!.intervaloMin < 60) alertas.push({ data: d, texto: `mais de 6h com intervalo de ${x!.intervaloMin} min (mínimo 1h${doze ? ', ou pago à parte' : ''})` });
        else if (c.bruto > 240 && c.bruto <= 360 && x!.intervaloMin < 15) alertas.push({ data: d, texto: 'de 4h a 6h precisa de 15 min de intervalo' });
        const ant = calc.get(somaDias(d, -1));
        if (ant) {
          const descanso = 1440 + c.iniAbs - ant.fimAbs;
          if (descanso < regras.interjornadaH * 60) alertas.push({ data: d, texto: `só ${horas(Math.max(0, descanso))} de descanso desde o turno anterior (mínimo ${horas(Math.round(regras.interjornadaH * 60))})` });
        }
        // domingo: pelo menos um de folga a cada N semanas (não vale para 12x36)
        if (!doze && diaSemana(d) === 0) {
          let todos = true;
          for (let k = 0; k < regras.domingoSemanas; k++) if (mapa.get(somaDias(d, -7 * k))?.tipo !== 'trabalho') { todos = false; break; }
          if (todos) alertas.push({ data: d, texto: `${regras.domingoSemanas}º domingo seguido trabalhando (folga no domingo pelo menos 1 vez a cada ${regras.domingoSemanas} semanas)` });
        }
      }

      // resumo do período; horas extras pela semana (segunda a domingo) que termina dentro do período
      const r = { diasTrabalho: 0, folgas: 0, faltas: 0, atestados: 0, ferias: 0, semEscala: 0, minutos: 0, noturno: 0, reducao: 0, feriado: 0, domingos: 0, extras: 0 };
      for (const d of datas) {
        const x = mapa.get(d);
        if (!x) { r.semEscala++; continue; }
        if (x.tipo === 'trabalho') r.diasTrabalho++;
        else if (x.tipo === 'folga') r.folgas++;
        else if (x.tipo === 'falta') r.faltas++;
        else if (x.tipo === 'atestado') r.atestados++;
        else if (x.tipo === 'ferias') r.ferias++;
        const c = calc.get(d);
        if (!c) continue;
        r.minutos += c.trabalhado + c.reducao;
        r.noturno += c.noturno;
        r.reducao += c.reducao;
        if (feriadoDe.has(d) && !doze) r.feriado += c.trabalhado + c.reducao;
        if (diaSemana(d) === 0) r.domingos++;
      }
      const semanas: { inicio: string; fim: string; minutos: number; extras: number }[] = [];
      for (const d of datas) {
        if (diaSemana(d) !== 0) continue;
        let soma = 0, diario = 0;
        for (let k = 6; k >= 0; k--) {
          const dd = somaDias(d, -k);
          const c = calc.get(dd);
          if (!c) continue;
          const m = c.trabalhado + c.reducao;
          // feriado trabalhado é pago à parte (100%), não entra nas extras da semana
          if (feriadoDe.has(dd) && !doze) continue;
          soma += m;
          diario += Math.max(0, m - limiteDia);
        }
        const extras = doze ? diario : Math.max(diario, soma - Math.round(horasSemana * 60));
        semanas.push({ inicio: somaDias(d, -6), fim: d, minutos: soma, extras });
        r.extras += extras;
      }
      const dias: Record<string, DiaEscala & { minutos: number; noturno: number }> = {};
      for (const d of datas) {
        const x = mapa.get(d);
        if (x) dias[d] = { ...x, minutos: calc.get(d) ? calc.get(d)!.trabalhado : 0, noturno: calc.get(d)?.noturno ?? 0 };
      }
      return {
        id: f.id as string, nome: f.nome as string, cargo: (f.cargo as string) ?? (f.funcao as string), jornada, horasSemana, adicionalNoturno: !!f.adicional_noturno,
        tipoContrato: (f.tipo_contrato as string) ?? null, dias, resumo: r, semanas, alertas,
      };
    });
    return {
      de, ate, hoje, regras, turnos, datas,
      feriados: feriados.filter((f) => f.data >= de),
      lista,
      totais: {
        alertas: lista.reduce((s: number, f: { alertas: unknown[] }) => s + f.alertas.length, 0),
        semEscala: lista.reduce((s: number, f: { resumo: { semEscala: number } }) => s + f.resumo.semEscala, 0),
        extras: lista.reduce((s: number, f: { resumo: { extras: number } }) => s + f.resumo.extras, 0),
        faltas: lista.reduce((s: number, f: { resumo: { faltas: number } }) => s + f.resumo.faltas, 0),
      },
    };
  }

  /** hoje: quem está trabalhando, de folga ou faltou (para a recepção/gerência) */
  async hoje(u: UsuarioToken) {
    const hoje = hojeSP();
    const l = await this.ds.query(
      `SELECT f.nome, f.funcao, e.tipo, e.inicio, e.fim FROM escala_dias e JOIN funcionarios f ON f.id = e.funcionario_id
        WHERE e.empresa_id = $1 AND e.data = $2 AND f.ativo ORDER BY e.inicio NULLS LAST, f.nome`, [u.empresaId, hoje]);
    return { data: hoje, lista: l.map((x: Record<string, unknown>) => ({ nome: x.nome, funcao: x.funcao, tipo: x.tipo, inicio: x.inicio ?? null, fim: x.fim ?? null })) };
  }

  private async conferirFuncionarios(empresaId: string, ids: string[]) {
    const unicos = [...new Set(ids)];
    const l = await this.ds.query(`SELECT id FROM funcionarios WHERE empresa_id = $1 AND id = ANY($2::uuid[])`, [empresaId, unicos]);
    if (l.length !== unicos.length) throw new NotFoundException('Funcionário não encontrado.');
  }

  private async horario(empresaId: string, x: { turnoId?: string; inicio?: string; fim?: string; intervaloMin?: number }) {
    if (x.turnoId) {
      const [t] = await this.ds.query(`SELECT id, inicio, fim, intervalo_min FROM escala_turnos WHERE id = $1 AND empresa_id = $2`, [x.turnoId, empresaId]);
      if (!t) throw new NotFoundException('Turno não encontrado.');
      return { turnoId: t.id as string, inicio: t.inicio as string, fim: t.fim as string, intervaloMin: Number(t.intervalo_min) };
    }
    if (!x.inicio || !x.fim) throw new BadRequestException('Escolha o turno ou coloque o horário de entrada e saída.');
    if (x.inicio === x.fim) throw new BadRequestException('Entrada e saída no mesmo horário.');
    return { turnoId: null, inicio: x.inicio, fim: x.fim, intervaloMin: x.intervaloMin ?? 0 };
  }

  async salvarDias(u: UsuarioToken, dto: DiasDto) {
    await this.conferirFuncionarios(u.empresaId, dto.itens.map((i) => i.funcionarioId));
    for (const i of dto.itens.filter((x) => x.documentoId)) {
      const [d] = await this.ds.query(`SELECT 1 FROM funcionario_documentos WHERE id = $1 AND funcionario_id = $2 AND empresa_id = $3`, [i.documentoId, i.funcionarioId, u.empresaId]);
      if (!d) throw new NotFoundException('Atestado não encontrado nos documentos do funcionário.');
    }
    const turnos = new Map<string, Awaited<ReturnType<EscalaService['horario']>>>();
    await this.ds.transaction(async (m) => {
      for (const i of dto.itens) {
        if (i.tipo === 'limpar') {
          await m.query(`DELETE FROM escala_dias WHERE funcionario_id = $1 AND data = $2 AND empresa_id = $3`, [i.funcionarioId, i.data, u.empresaId]);
          continue;
        }
        let h: { turnoId: string | null; inicio: string | null; fim: string | null; intervaloMin: number } = { turnoId: null, inicio: null, fim: null, intervaloMin: 0 };
        if (i.tipo === 'trabalho') {
          const chave = i.turnoId ?? `${i.inicio}-${i.fim}-${i.intervaloMin}`;
          if (!turnos.has(chave)) turnos.set(chave, await this.horario(u.empresaId, i));
          h = turnos.get(chave)!;
        }
        await m.query(
          `INSERT INTO escala_dias (funcionario_id, data, empresa_id, tipo, turno_id, inicio, fim, intervalo_min, observacao, usuario_nome, documento_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT (funcionario_id, data) DO UPDATE SET tipo=$4, turno_id=$5, inicio=$6, fim=$7, intervalo_min=$8, observacao=$9, usuario_nome=$10, documento_id=$11, atualizado_em=now()`,
          [i.funcionarioId, i.data, u.empresaId, i.tipo, h.turnoId, h.inicio, h.fim, h.intervaloMin, i.observacao?.trim() || null, u.nome,
            i.tipo === 'falta' || i.tipo === 'atestado' ? i.documentoId ?? null : null]);
      }
    });
    return { ok: true, total: dto.itens.length };
  }

  async gerar(u: UsuarioToken, dto: GerarDto) {
    if (dto.ate < dto.de) throw new BadRequestException('A data final é antes da inicial.');
    if (difDias(dto.de, dto.ate) > 92) throw new BadRequestException('Gere no máximo 3 meses por vez.');
    await this.conferirFuncionarios(u.empresaId, dto.funcionarioIds);
    const h = await this.horario(u.empresaId, dto);
    const folgas = new Set(dto.folgasSemana ?? []);
    const t = dto.trabalhaDias ?? 1, fo = dto.folgaDias ?? 1;
    if (dto.modo === 'semanal' && folgas.size === 0) throw new BadRequestException('Escolha o(s) dia(s) de folga da semana.');
    const inicioCiclo = dto.inicioCiclo ?? dto.de;
    let gravados = 0;
    await this.ds.transaction(async (m) => {
      for (const f of [...new Set(dto.funcionarioIds)]) {
        for (let d = dto.de; d <= dto.ate; d = somaDias(d, 1)) {
          const folga = dto.modo === 'semanal' ? folgas.has(diaSemana(d)) : ((difDias(inicioCiclo, d) % (t + fo)) + (t + fo)) % (t + fo) >= t;
          const r = await m.query(
            `INSERT INTO escala_dias (funcionario_id, data, empresa_id, tipo, turno_id, inicio, fim, intervalo_min, usuario_nome) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT (funcionario_id, data) DO ${dto.sobrescrever ? 'UPDATE SET tipo=$4, turno_id=$5, inicio=$6, fim=$7, intervalo_min=$8, observacao=NULL, usuario_nome=$9, atualizado_em=now()' : 'NOTHING'} RETURNING 1`,
            folga ? [f, d, u.empresaId, 'folga', null, null, null, 0, u.nome] : [f, d, u.empresaId, 'trabalho', h.turnoId, h.inicio, h.fim, h.intervaloMin, u.nome]);
          gravados += r.length;
        }
      }
    });
    return { ok: true, gravados };
  }

  async copiar(u: UsuarioToken, dto: CopiarDto) {
    if (dto.funcionarioIds?.length) await this.conferirFuncionarios(u.empresaId, dto.funcionarioIds);
    const fim = somaDias(dto.origem, dto.dias - 1);
    if (dto.destino <= fim && somaDias(dto.destino, dto.dias * dto.vezes - 1) >= dto.origem) throw new BadRequestException('O destino não pode cair em cima dos dias copiados.');
    let gravados = 0;
    await this.ds.transaction(async (m) => {
      for (let k = 0; k < dto.vezes; k++) {
        const desloc = difDias(dto.origem, dto.destino) + k * dto.dias;
        const r = await m.query(
          `INSERT INTO escala_dias (funcionario_id, data, empresa_id, tipo, turno_id, inicio, fim, intervalo_min, observacao, usuario_nome)
           SELECT funcionario_id, data + $4::int, empresa_id, tipo, turno_id, inicio, fim, intervalo_min, NULL, $5 FROM escala_dias
            WHERE empresa_id = $1 AND data BETWEEN $2 AND $3 AND tipo IN ('trabalho','folga') ${dto.funcionarioIds?.length ? 'AND funcionario_id = ANY($6::uuid[])' : ''}
           ON CONFLICT (funcionario_id, data) DO ${dto.sobrescrever ? 'UPDATE SET tipo=EXCLUDED.tipo, turno_id=EXCLUDED.turno_id, inicio=EXCLUDED.inicio, fim=EXCLUDED.fim, intervalo_min=EXCLUDED.intervalo_min, observacao=NULL, usuario_nome=EXCLUDED.usuario_nome, atualizado_em=now()' : 'NOTHING'}
           RETURNING 1`,
          [u.empresaId, dto.origem, fim, desloc, u.nome, ...(dto.funcionarioIds?.length ? [dto.funcionarioIds] : [])]);
        gravados += r.length;
      }
    });
    return { ok: true, gravados };
  }

  async criarTurno(u: UsuarioToken, dto: TurnoDto) {
    const [r] = await this.ds.query(`INSERT INTO escala_turnos (empresa_id, nome, inicio, fim, intervalo_min, cor) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [u.empresaId, dto.nome.trim(), dto.inicio, dto.fim, dto.intervaloMin, dto.cor ?? null]);
    return { ok: true, id: r.id };
  }

  async editarTurno(u: UsuarioToken, id: string, dto: TurnoDto) {
    const r = await this.ds.query(`UPDATE escala_turnos SET nome=$3, inicio=$4, fim=$5, intervalo_min=$6, cor=$7, ativo=true WHERE id=$1 AND empresa_id=$2 RETURNING id`,
      [id, u.empresaId, dto.nome.trim(), dto.inicio, dto.fim, dto.intervaloMin, dto.cor ?? null]);
    if (!(Array.isArray(r?.[0]) ? r[0].length : r?.length)) throw new NotFoundException('Turno não encontrado.');
    // os dias já marcados com este turno passam a usar o horário novo
    await this.ds.query(`UPDATE escala_dias SET inicio=$3, fim=$4, intervalo_min=$5 WHERE turno_id=$1 AND empresa_id=$2 AND data >= $6`, [id, u.empresaId, dto.inicio, dto.fim, dto.intervaloMin, hojeSP()]);
    return { ok: true };
  }

  async removerTurno(u: UsuarioToken, id: string) {
    await this.ds.query(`UPDATE escala_turnos SET ativo = false WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    return { ok: true };
  }

  async criarFeriado(u: UsuarioToken, dto: FeriadoDto) {
    await this.ds.query(`INSERT INTO feriados (empresa_id, data, nome) VALUES ($1,$2,$3) ON CONFLICT (empresa_id, data) DO UPDATE SET nome = $3`, [u.empresaId, dto.data, dto.nome.trim()]);
    return { ok: true };
  }

  async removerFeriado(u: UsuarioToken, id: string) {
    await this.ds.query(`DELETE FROM feriados WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    return { ok: true };
  }

  /** para o sino: perto do fim da semana, quem usa a escala e ainda não tem a da semana que vem */
  async semEscalaProximaSemana(empresaId: string) {
    const hoje = hojeSP();
    const dw = diaSemana(hoje);
    const seg = somaDias(hoje, dw === 0 ? 1 : 8 - dw);
    if (dw !== 0 && dw < 4) return { segunda: br(seg), nomes: [] as string[] };
    const l = await this.ds.query(
      `SELECT f.nome FROM funcionarios f
        WHERE f.empresa_id = $1 AND f.ativo
          AND EXISTS (SELECT 1 FROM escala_dias e WHERE e.funcionario_id = f.id AND e.data BETWEEN $2::date - 30 AND $2::date - 1)
          AND NOT EXISTS (SELECT 1 FROM escala_dias e WHERE e.funcionario_id = f.id AND e.data BETWEEN $2::date AND $2::date + 6)
        ORDER BY f.nome`, [empresaId, seg]);
    return { segunda: br(seg), nomes: l.map((x: { nome: string }) => x.nome) as string[] };
  }
}

@Controller('rh/escala')
export class EscalaController {
  constructor(private readonly service: EscalaService) {}

  @Get()
  @Requer('funcionarios.gerenciar', 'funcionarios.financeiro')
  ver(@Usuario() u: UsuarioToken, @Query('de') de?: string, @Query('ate') ate?: string) {
    return this.service.ver(u, de, ate);
  }

  @Get('hoje')
  @Requer('funcionarios.gerenciar', 'funcionarios.financeiro', 'estadias.operar', 'governanca.operar')
  hoje(@Usuario() u: UsuarioToken) {
    return this.service.hoje(u);
  }

  @Put('dias')
  @Requer('funcionarios.gerenciar')
  dias(@Usuario() u: UsuarioToken, @Body() dto: DiasDto) {
    return this.service.salvarDias(u, dto);
  }

  @Post('gerar')
  @Requer('funcionarios.gerenciar')
  gerar(@Usuario() u: UsuarioToken, @Body() dto: GerarDto) {
    return this.service.gerar(u, dto);
  }

  @Post('copiar')
  @Requer('funcionarios.gerenciar')
  copiar(@Usuario() u: UsuarioToken, @Body() dto: CopiarDto) {
    return this.service.copiar(u, dto);
  }

  @Post('turnos')
  @Requer('funcionarios.gerenciar')
  criarTurno(@Usuario() u: UsuarioToken, @Body() dto: TurnoDto) {
    return this.service.criarTurno(u, dto);
  }

  @Put('turnos/:id')
  @Requer('funcionarios.gerenciar')
  editarTurno(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TurnoDto) {
    return this.service.editarTurno(u, id, dto);
  }

  @Delete('turnos/:id')
  @Requer('funcionarios.gerenciar')
  removerTurno(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.removerTurno(u, id);
  }

  @Post('feriados')
  @Requer('funcionarios.gerenciar')
  criarFeriado(@Usuario() u: UsuarioToken, @Body() dto: FeriadoDto) {
    return this.service.criarFeriado(u, dto);
  }

  @Delete('feriados/:id')
  @Requer('funcionarios.gerenciar')
  removerFeriado(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.removerFeriado(u, id);
  }

  @Put('regras')
  @Requer('funcionarios.gerenciar')
  regras(@Usuario() u: UsuarioToken, @Body() dto: RegrasDto) {
    return this.service.salvarRegras(u, dto);
  }
}
