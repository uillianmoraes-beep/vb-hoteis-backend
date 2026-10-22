import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

export class LoginDto {
  @IsString() @MinLength(3) @MaxLength(120) login!: string;
  @IsString() @MinLength(1) @MaxLength(72) senha!: string;
}

export class TrocarMinhaSenhaDto {
  @IsString() @MinLength(1) @MaxLength(72) senhaAtual!: string;
  @IsString() @MinLength(6) @MaxLength(72) novaSenha!: string;
}

export class EntrarAmbienteDto {
  @IsUUID() ambienteId!: string;
  @IsOptional() @IsUUID() deAmbienteId?: string;
  @IsIn(['login', 'troca']) tipo!: 'login' | 'troca';
  /** obrigatória na troca */
  @IsOptional() @IsString() @MaxLength(72) senha?: string;
}

export class MeuPinDto {
  @IsString() @MinLength(1) @MaxLength(72) senhaAtual!: string;
  /** só números, 4 a 8. Vazio/nulo remove a senha de liberação. */
  @IsOptional() @IsString() @MaxLength(8) pin?: string | null;
}

export class ConfirmarSenhaDto {
  @IsString() @MinLength(1) @MaxLength(72) senha!: string;
}

export class SegurancaDto {
  /** senhas erradas seguidas até bloquear (0 = não bloqueia) */
  @IsInt() @Min(0) @Max(20) tentativas!: number;
  @IsInt() @Min(1) @Max(1440) bloqueioMin!: number;
  /** minutos parado até a tela travar (0 = não trava) */
  @IsInt() @Min(0) @Max(720) inatividadeMin!: number;
}
