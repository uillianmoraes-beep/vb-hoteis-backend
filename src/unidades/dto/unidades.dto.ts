import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min,
} from 'class-validator';
import { STATUS_UNIDADE, StatusUnidade, TIPOS_UNIDADE, TipoUnidade } from '../../common/permissoes';

export class CriarUnidadeDto {
  @IsUUID() ambienteId!: string;
  @IsOptional() @IsUUID() categoriaId?: string;
  @IsString() @MaxLength(20) codigo!: string;
  @IsOptional() @IsString() @MaxLength(80) nome?: string;
  @IsOptional() @IsIn(TIPOS_UNIDADE as unknown as string[]) tipo?: TipoUnidade;
  @IsOptional() @IsString() @MaxLength(20) andar?: string;
  @IsOptional() @IsString() @MaxLength(20) garagem?: string;
  @IsOptional() @IsInt() @Min(1) capacidade?: number;
  @IsOptional() @IsInt() ordem?: number;
  @IsOptional() @IsString() @MaxLength(20) coletivo?: string;
}

export class AtualizarUnidadeDto {
  @IsOptional() @IsUUID() ambienteId?: string;
  @IsOptional() @IsUUID() ambientePadraoId?: string;
  @IsOptional() @IsUUID() categoriaId?: string | null;
  @IsOptional() @IsString() @MaxLength(20) codigo?: string;
  @IsOptional() @IsString() @MaxLength(80) nome?: string | null;
  @IsOptional() @IsIn(TIPOS_UNIDADE as unknown as string[]) tipo?: TipoUnidade;
  @IsOptional() @IsString() @MaxLength(20) andar?: string | null;
  @IsOptional() @IsString() @MaxLength(20) garagem?: string | null;
  @IsOptional() @IsInt() @Min(1) capacidade?: number;
  @IsOptional() @IsInt() ordem?: number;
  /** quarto coletivo a que esta cama pertence (vazio = quarto normal) */
  @IsOptional() @IsString() @MaxLength(20) coletivo?: string | null;
  @IsOptional() @IsNumber() plantaX?: number | null;
  @IsOptional() @IsNumber() plantaY?: number | null;
  @IsOptional() @IsBoolean() ativo?: boolean;
}

/** Cria várias unidades de uma vez, ex.: suítes 01 a 20. */
export class CriarUnidadesLoteDto {
  @IsUUID() ambienteId!: string;
  @IsOptional() @IsUUID() categoriaId?: string;
  @IsOptional() @IsIn(TIPOS_UNIDADE as unknown as string[]) tipo?: TipoUnidade;
  @IsOptional() @IsString() @MaxLength(10) prefixo?: string;
  @IsInt() @Min(0) de!: number;
  @IsInt() @Min(0) ate!: number;
  /** Quantos dígitos no número (2 → 01, 02...). */
  @IsOptional() @IsInt() @Min(1) @Max(5) digitos?: number;
  @IsOptional() @IsString() @MaxLength(20) andar?: string;
  /** são as camas de um quarto coletivo (ex.: C01): cada uma com 1 pessoa */
  @IsOptional() @IsString() @MaxLength(20) coletivo?: string;
}

/** Muda várias unidades de uma vez (ex.: quartos cadastrados no motel que são do hotel). */
export class MoverUnidadesDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @IsUUID('4', { each: true }) ids!: string[];
  @IsOptional() @IsUUID() ambienteId?: string;
  @IsOptional() @IsIn(TIPOS_UNIDADE as unknown as string[]) tipo?: TipoUnidade;
  @IsOptional() @IsUUID() categoriaId?: string;
}

export class MudarStatusDto {
  @IsIn(STATUS_UNIDADE as unknown as string[]) status!: StatusUnidade;
  /** Obrigatório quando o status é "bloqueada". */
  @IsOptional() @IsUUID() motivoBloqueioId?: string;
  @IsOptional() @IsString() @MaxLength(500) observacao?: string;
}

export class ResponsavelDto {
  /** vazio = tira o responsável */
  @IsString() @MaxLength(60) nome!: string;
}
