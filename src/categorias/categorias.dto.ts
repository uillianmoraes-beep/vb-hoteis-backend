import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateIf } from 'class-validator';
import { TIPOS_UNIDADE, TipoUnidade } from '../common/permissoes';

export class CriarCategoriaDto {
  /** ambiente da categoria: a do hotel não aparece no motel e vice-versa */
  @IsOptional() @IsUUID() ambienteId?: string;
  @IsString() @MaxLength(80) nome!: string;
  @IsOptional() @IsString() descricao?: string;
  @IsOptional() @IsIn(TIPOS_UNIDADE as unknown as string[]) tipoUnidade?: TipoUnidade;
  @IsOptional() @IsInt() ordem?: number;
  @IsOptional() @ValidateIf((o: { foto?: string | null }) => o.foto !== null) @IsString() @MaxLength(700_000) @Matches(/^data:image\/(jpeg|png|webp);base64,/) foto?: string | null;
}

export class AtualizarCategoriaDto {
  @IsOptional() @IsUUID() ambienteId?: string;
  @IsOptional() @IsString() @MaxLength(80) nome?: string;
  @IsOptional() @IsString() descricao?: string;
  @IsOptional() @IsIn(TIPOS_UNIDADE as unknown as string[]) tipoUnidade?: TipoUnidade;
  @IsOptional() @IsInt() ordem?: number;
  @IsOptional() @IsBoolean() ativo?: boolean;
  @IsOptional() @ValidateIf((o: { foto?: string | null }) => o.foto !== null) @IsString() @MaxLength(700_000) @Matches(/^data:image\/(jpeg|png|webp);base64,/) foto?: string | null;
}
