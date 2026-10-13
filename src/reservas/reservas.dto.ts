import { IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

const DATA = /^\d{4}-\d{2}-\d{2}$/;

export class ReservaDto {
  @IsUUID() unidadeId!: string;
  @IsString() @MinLength(2) @MaxLength(120) hospede!: string;
  @IsOptional() @IsString() @MaxLength(30) telefone?: string;
  @IsOptional() @IsEmail() @MaxLength(120) email?: string;
  @IsOptional() @IsString() @MaxLength(30) documento?: string;
  @Matches(DATA) chegada!: string;
  @Matches(DATA) saida!: string;
  @IsOptional() @IsInt() @Min(1) @Max(20) adultos?: number;
  @IsOptional() @IsInt() @Min(0) @Max(20) criancas?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1_000_000) valorDiaria?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(10_000_000) valorTotal?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(10_000_000) sinal?: number;
  @IsOptional() @IsIn(['dinheiro', 'pix', 'debito', 'credito']) sinalForma?: string;
  @IsOptional() @IsString() @MaxLength(30) origem?: string;
  @IsOptional() @IsString() @MaxLength(500) observacao?: string;
  @IsOptional() @IsIn(['pendente', 'confirmada']) status?: 'pendente' | 'confirmada';
}

export class CancelarReservaDto {
  @IsOptional() @IsIn(['cancelada', 'no_show']) tipo?: 'cancelada' | 'no_show';
  @IsOptional() @IsString() @MaxLength(300) motivo?: string;
}

export class CheckinReservaDto {
  /** lança o sinal já recebido como adiantamento na conta (abate do total) */
  @IsOptional() @IsIn(['sim', 'nao']) lancarSinal?: 'sim' | 'nao';
}
