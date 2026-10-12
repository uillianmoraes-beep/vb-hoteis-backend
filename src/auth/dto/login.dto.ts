import { IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsString() @MinLength(3) @MaxLength(120) login!: string;
  @IsString() @MinLength(1) @MaxLength(72) senha!: string;
}

export class TrocarMinhaSenhaDto {
  @IsString() @MinLength(1) @MaxLength(72) senhaAtual!: string;
  @IsString() @MinLength(6) @MaxLength(72) novaSenha!: string;
}
