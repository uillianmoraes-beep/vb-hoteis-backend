import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { TIPOS_UNIDADE, TipoUnidade } from '../common/permissoes';

export class CriarCategoriaDto {
  @IsString() @MaxLength(80) nome!: string;
  @IsOptional() @IsString() descricao?: string;
  @IsOptional() @IsIn(TIPOS_UNIDADE as unknown as string[]) tipoUnidade?: TipoUnidade;
  @IsOptional() @IsInt() ordem?: number;
}

export class AtualizarCategoriaDto {
  @IsOptional() @IsString() @MaxLength(80) nome?: string;
  @IsOptional() @IsString() descricao?: string;
  @IsOptional() @IsIn(TIPOS_UNIDADE as unknown as string[]) tipoUnidade?: TipoUnidade;
  @IsOptional() @IsInt() ordem?: number;
  @IsOptional() @IsBoolean() ativo?: boolean;
}
