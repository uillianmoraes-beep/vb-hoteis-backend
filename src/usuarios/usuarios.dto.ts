import {
  ArrayUnique, IsArray, IsBoolean, IsOptional, IsString, IsUUID, MaxLength, MinLength,
} from 'class-validator';

export class CriarUsuarioDto {
  @IsString() @MaxLength(120) nome!: string;
  /** E-mail ou nome de usuário. */
  @IsString() @MinLength(3) @MaxLength(120) login!: string;
  @IsString() @MinLength(6) @MaxLength(72) senha!: string;
  @IsUUID() perfilId!: string;
  @IsOptional() @IsArray() @ArrayUnique() @IsUUID('all', { each: true }) ambientesIds?: string[];
  @IsOptional() @IsBoolean() acessoCelular?: boolean;
  @IsOptional() @IsBoolean() recebeGorjeta?: boolean;
}

export class AtualizarUsuarioDto {
  @IsOptional() @IsString() @MaxLength(120) nome?: string;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(120) login?: string;
  @IsOptional() @IsUUID() perfilId?: string;
  @IsOptional() @IsArray() @ArrayUnique() @IsUUID('all', { each: true }) ambientesIds?: string[] | null;
  @IsOptional() @IsBoolean() ativo?: boolean;
  @IsOptional() @IsBoolean() acessoCelular?: boolean;
  @IsOptional() @IsBoolean() recebeGorjeta?: boolean;
}

export class TrocarSenhaDto {
  @IsString() @MinLength(6) @MaxLength(72) senha!: string;
}
