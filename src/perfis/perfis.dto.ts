import { Type } from 'class-transformer';
import {
  ArrayUnique, IsArray, IsBoolean, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';

export class LimitesDto {
  @IsOptional() @IsNumber() @Min(0) @Max(100) descontoPercentual?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) acrescimoPercentual?: number;
  @IsOptional() @IsBoolean() cortesia?: boolean;
  @IsOptional() @IsBoolean() ajusteDiaria?: boolean;
}

export class CriarPerfilDto {
  @IsString() @MaxLength(60) nome!: string;
  @IsOptional() @IsString() descricao?: string;
  @IsArray() @ArrayUnique() @IsString({ each: true }) permissoes!: string[];
  @IsOptional() @ValidateNested() @Type(() => LimitesDto) limites?: LimitesDto;
}

export class AtualizarPerfilDto {
  @IsOptional() @IsString() @MaxLength(60) nome?: string;
  @IsOptional() @IsString() descricao?: string;
  @IsOptional() @IsArray() @ArrayUnique() @IsString({ each: true }) permissoes?: string[];
  @IsOptional() @ValidateNested() @Type(() => LimitesDto) limites?: LimitesDto;
}
