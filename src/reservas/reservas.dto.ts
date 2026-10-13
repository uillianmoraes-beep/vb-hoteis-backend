import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

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

export class ConfigCategoriaOnlineDto {
  @IsUUID() categoriaId!: string;
  @IsBoolean() ativo!: boolean;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1_000_000) diaria!: number;
  /** valor por pessoa acima de 2 (0 = não cobra) */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100_000) pessoaExtra?: number;
  @IsOptional() @IsString() @MaxLength(300) descricao?: string;
}

export class ConfigQuartoOnlineDto {
  @IsUUID() unidadeId!: string;
  /** ex.: "Vista para o mar", "Varanda" */
  @IsOptional() @IsString() @MaxLength(60) destaque?: string;
  /** acréscimo por diária para escolher este quarto */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100_000) acrescimo?: number;
  @IsOptional() @IsBoolean() oculto?: boolean;
}

export class ConfigReservaOnlineDto {
  @IsBoolean() ativo!: boolean;
  @IsIn(['automatica', 'recepcao']) confirmacao!: 'automatica' | 'recepcao';
  @IsBoolean() escolherQuarto!: boolean;
  @IsOptional() @IsString() @MaxLength(600) mensagem?: string;
  @IsOptional() @IsInt() @Min(1) @Max(60) minNoites?: number;
  @IsOptional() @IsInt() @Min(1) @Max(365) maxNoites?: number;
  /** até quantos dias à frente aceita reserva */
  @IsOptional() @IsInt() @Min(7) @Max(730) janelaDias?: number;
  @IsOptional() @IsString() @MaxLength(30) whatsapp?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100) sinalPct?: number;
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => ConfigCategoriaOnlineDto) categorias!: ConfigCategoriaOnlineDto[];
  @IsArray() @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => ConfigQuartoOnlineDto) quartos!: ConfigQuartoOnlineDto[];
}

export class ReservaPublicaDto {
  @Matches(DATA) chegada!: string;
  @Matches(DATA) saida!: string;
  @IsInt() @Min(1) @Max(20) adultos!: number;
  @IsOptional() @IsInt() @Min(0) @Max(20) criancas?: number;
  @IsUUID() categoriaId!: string;
  /** quarto escolhido pelo hóspede (quando o hotel permite) */
  @IsOptional() @IsUUID() unidadeId?: string;
  @IsString() @MinLength(3) @MaxLength(120) nome!: string;
  @IsString() @MinLength(8) @MaxLength(30) telefone!: string;
  @IsOptional() @IsEmail() @MaxLength(120) email?: string;
  @IsOptional() @IsString() @MaxLength(30) documento?: string;
  @IsOptional() @IsString() @MaxLength(500) observacao?: string;
}
