import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { TIPOS_AMBIENTE, TipoAmbiente } from '../common/permissoes';

export class CriarAmbienteDto {
  @IsString() @MaxLength(80) nome!: string;
  @IsIn(TIPOS_AMBIENTE as unknown as string[]) tipo!: TipoAmbiente;
  @IsOptional() @IsString() @MaxLength(9) cor?: string;
  @IsOptional() @IsInt() ordem?: number;
}

export class AtualizarAmbienteDto {
  @IsOptional() @IsString() @MaxLength(80) nome?: string;
  @IsOptional() @IsIn(TIPOS_AMBIENTE as unknown as string[]) tipo?: TipoAmbiente;
  @IsOptional() @IsString() @MaxLength(9) cor?: string;
  @IsOptional() @IsInt() ordem?: number;
  @IsOptional() @IsBoolean() ativo?: boolean;
}
