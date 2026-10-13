import { IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CortesiaDto {
  @IsString() @MinLength(2) @MaxLength(80) nome!: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(100) percentual!: number;
  @IsOptional() @IsIn(['total', 'hospedagem']) aplicaEm?: 'total' | 'hospedagem';
  @IsOptional() @IsArray() @IsUUID('4', { each: true }) categoriaIds?: string[];
  @IsOptional() @IsArray() @IsUUID('4', { each: true }) unidadeIds?: string[];
  @IsOptional() @Matches(/^(\d{4}-\d{2}-\d{2})?$/) validadeAte?: string;
  @IsOptional() @IsBoolean() exigeSenha?: boolean;
  @IsOptional() @IsString() @MaxLength(9) cor?: string;
  @IsOptional() @IsString() @MaxLength(300) descricao?: string;
  @IsOptional() @IsBoolean() ativo?: boolean;
}
