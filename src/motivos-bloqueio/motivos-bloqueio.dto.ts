import { IsBoolean, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

export class CriarMotivoDto {
  @IsString() @MaxLength(80) nome!: string;
  @IsOptional() @IsString() @MaxLength(9) cor?: string;
  @IsOptional() @IsBoolean() abreManutencao?: boolean;
  @IsOptional() @IsInt() ordem?: number;
}

export class AtualizarMotivoDto {
  @IsOptional() @IsString() @MaxLength(80) nome?: string;
  @IsOptional() @IsString() @MaxLength(9) cor?: string;
  @IsOptional() @IsBoolean() abreManutencao?: boolean;
  @IsOptional() @IsInt() ordem?: number;
  @IsOptional() @IsBoolean() ativo?: boolean;
}
