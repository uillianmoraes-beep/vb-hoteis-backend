import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class ImpressoraDto {
  @IsString() @MaxLength(60) nome!: string;
  /** IP ou nome da impressora na rede (ex.: 192.168.0.50) */
  @IsString() @MaxLength(100) endereco!: string;
  @IsOptional() @IsInt() @Min(1) @Max(65535) porta?: number;
  @IsOptional() @IsIn([32, 42, 48, 56, 64]) colunas?: number;
  @IsOptional() @IsUUID() ambienteId?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(60, { each: true }) grupos?: string[];
  @IsOptional() @IsInt() @Min(1) @Max(5) copias?: number;
  @IsOptional() @IsBoolean() ativo?: boolean;
}

export class ResultadoAgenteDto {
  @IsBoolean() ok!: boolean;
  @IsOptional() @IsString() @MaxLength(300) erro?: string;
}
