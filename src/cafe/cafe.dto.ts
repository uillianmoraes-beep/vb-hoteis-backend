import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CafeItemDto {
  @IsString() @MinLength(2) @MaxLength(80) nome!: string;
  @IsOptional() @IsString() @MaxLength(40) grupo?: string;
  @IsString() @MinLength(1) @MaxLength(12) unidade!: string;
  /** quanto cada pessoa consome (ex.: 0,25 L de café; 1,5 pão; 0,125 bolo) */
  @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(1000) porPessoa!: number;
  /** arredonda a quantidade para cima neste passo (ex.: 1 = inteiro, 0,5 = meio litro) */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) @Max(1000) passo?: number;
  /** a sobra pode voltar para o próximo café? (frutas cortadas, ovo mexido: não) */
  @IsOptional() @IsBoolean() reaproveita?: boolean;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) @Max(100000) sobra?: number;
  @IsOptional() @IsInt() @Min(0) @Max(9999) ordem?: number;
  @IsOptional() @IsBoolean() ativo?: boolean;
}

export class CriarListaDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) data!: string;
  /** pessoas a mais ou a menos (visitantes, day use, funcionários) */
  @IsOptional() @IsInt() @Min(-500) @Max(500) ajuste?: number;
  @IsOptional() @IsString() @MaxLength(300) observacao?: string;
}

export class RetornoItemDto {
  @IsUUID() itemId!: string;
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) @Max(100000) sobrou!: number;
}

export class FecharListaDto {
  @IsArray() @ArrayMaxSize(300) @ValidateNested({ each: true }) @Type(() => RetornoItemDto) retorno!: RetornoItemDto[];
  @IsOptional() @IsString() @MaxLength(300) observacao?: string;
}
