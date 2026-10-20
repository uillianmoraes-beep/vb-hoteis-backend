import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

export class RegrasDto {
  @IsInt() @Min(0) @Max(180) toleranciaMin!: number;
  @IsIn(['hora_adicional', 'pernoite']) aposUltimo!: 'hora_adicional' | 'pernoite';
  @IsInt() @Min(1) @Max(20) pessoasIncluidas!: number;
  @IsOptional() @IsInt() @Min(0) @Max(120) alertaViradaMin?: number;
}

export class PeriodoDto {
  /** id de um período que já existe, ou uma chave temporária (ex.: "novo-1") para um novo */
  @IsString() @MaxLength(60) chave!: string;
  @IsString() @MaxLength(40) nome!: string;
  @IsIn(['horas', 'pernoite']) tipo!: 'horas' | 'pernoite';
  @IsOptional() @IsInt() @Min(1) @Max(7 * 24 * 60) duracaoMin?: number | null;
  @IsOptional() @Matches(HHMM) pernoiteInicio?: string | null;
  @IsOptional() @Matches(HHMM) pernoiteFim?: string | null;
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) categoriaIds?: string[] | null;
  @IsOptional() @IsInt() ordem?: number;
}

export class PrecoDto {
  @IsUUID() categoriaId!: string;
  @IsIn(['periodo', 'hora_adicional', 'pessoa_adicional']) tipo!: 'periodo' | 'hora_adicional' | 'pessoa_adicional';
  /** chave do período (só para tipo "periodo") */
  @IsOptional() @IsString() periodoChave?: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1_000_000) valor!: number;
  /** duração diferente só nesta tabela (minutos) */
  @IsOptional() @IsInt() @Min(1) @Max(7 * 24 * 60) duracaoMin?: number | null;
}

export class TabelaDto {
  @IsOptional() @IsUUID() id?: string;
  @IsString() @MaxLength(60) nome!: string;
  @IsArray() @ArrayMaxSize(7) @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true }) diasSemana!: number[];
  @IsOptional() @Matches(HHMM) horaInicio?: string | null;
  @IsOptional() @Matches(HHMM) horaFim?: string | null;
  @IsOptional() @Matches(DATA) dataInicio?: string | null;
  @IsOptional() @Matches(DATA) dataFim?: string | null;
  @IsOptional() @IsInt() prioridade?: number;
  @IsArray() @ValidateNested({ each: true }) @Type(() => PrecoDto) precos!: PrecoDto[];
}

export class SalvarTarifasDto {
  @ValidateNested() @Type(() => RegrasDto) regras!: RegrasDto;
  @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => PeriodoDto) periodos!: PeriodoDto[];
  @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => TabelaDto) tabelas!: TabelaDto[];
}

export class DiariaCategoriaDto {
  @IsUUID() categoriaId!: string;
  /** diária de domingo a quinta (0 = categoria sem diária) */
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100000) diaria!: number;
  /** diária de sexta e sábado (vazio = a mesma) */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100000) fimSemana?: number | null;
  /** pessoas que a diária já inclui */
  @IsOptional() @IsInt() @Min(1) @Max(20) pessoasIncluidas?: number;
  /** valor por pessoa a mais, por noite */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100000) pessoaExtra?: number;
  @IsOptional() @IsBoolean() cafeIncluso?: boolean;
}

export class SalvarDiariasDto {
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => DiariaCategoriaDto) itens!: DiariaCategoriaDto[];
}

export class PrecoPromocaoDto {
  @IsUUID() categoriaId!: string;
  /** motel: o período; hotel: vazio (diária) */
  @IsOptional() @IsUUID() periodoId?: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100000) valor!: number;
}

export class AplicarPromocaoDto {
  @IsUUID() ambienteId!: string;
  @IsString() @MaxLength(60) nome!: string;
  @IsArray() @ArrayMaxSize(7) @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true }) diasSemana!: number[];
  @IsOptional() @Matches(/^\d{2}:\d{2}$/) horaInicio?: string;
  @IsOptional() @Matches(/^\d{2}:\d{2}$/) horaFim?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) dataInicio?: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) dataFim!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => PrecoPromocaoDto) precos?: PrecoPromocaoDto[];
  @IsOptional() @IsUUID() brindeProdutoId?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) @Max(100) brindeQuantidade?: number;
}
