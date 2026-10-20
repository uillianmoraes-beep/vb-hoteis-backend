import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class EmprestarDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(300) @IsUUID('all', { each: true }) ids!: string[];
  /** ambiente para onde vai (ex.: o motel) */
  @IsUUID() ambienteId!: string;
  /** categoria do destino pela qual a unidade vai cobrar */
  @IsUUID() categoriaId!: string;
}

export class DevolverDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(300) @IsUUID('all', { each: true }) ids!: string[];
}

/** Empréstimo automático toda semana (dia: 0 = domingo … 6 = sábado). */
export class EmprestimoAutoDto {
  @IsBoolean() ativo!: boolean;
  @IsOptional() @IsUUID() destinoId?: string | null;
  @IsOptional() @IsUUID() categoriaId?: string | null;
  @IsArray() @ArrayMaxSize(300) @IsUUID('all', { each: true }) unidadeIds!: string[];
  @IsInt() @Min(0) @Max(6) inicioDia!: number;
  @Matches(HHMM) inicioHora!: string;
  @IsInt() @Min(0) @Max(6) fimDia!: number;
  @Matches(HHMM) fimHora!: string;
}
