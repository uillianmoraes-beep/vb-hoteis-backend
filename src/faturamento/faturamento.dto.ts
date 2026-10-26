import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

const DATA = /^\d{4}-\d{2}-\d{2}$/;
export const FORMAS_RECEBER = ['boleto', 'pix', 'transferencia', 'dinheiro', 'debito', 'credito', 'credito_cliente'] as const;

export class ClienteFaturadoDto {
  @IsString() @MinLength(2) @MaxLength(120) nome!: string;
  @IsOptional() @IsString() @MaxLength(20) documento?: string;
  @IsOptional() @IsString() @MaxLength(120) contato?: string;
  @IsOptional() @IsString() @MaxLength(30) telefone?: string;
  @IsOptional() @IsString() @MaxLength(120) email?: string;
  @IsOptional() @IsString() @MaxLength(250) endereco?: string;
  @IsOptional() @IsInt() @Min(0) @Max(365) prazoDias?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) limite?: number | null;
  @IsOptional() @IsString() @MaxLength(300) observacao?: string;
  @IsOptional() @IsBoolean() ativo?: boolean;
}

export class LancamentoManualDto {
  @IsUUID() clienteId!: string;
  @IsString() @MinLength(2) @MaxLength(250) descricao!: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(10_000_000) valor!: number;
  @IsOptional() @Matches(DATA) vencimento?: string;
  @IsOptional() @IsString() @MaxLength(18) cnpj?: string;
}

export class GerarFaturaDto {
  @IsUUID() clienteId!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @IsUUID('4', { each: true }) contas!: string[];
  @Matches(DATA) vencimento!: string;
  @IsOptional() @IsString() @MaxLength(80) boletoLinha?: string;
  @IsOptional() @IsString() @MaxLength(40) boletoNossoNumero?: string;
  @IsOptional() @IsString() @MaxLength(300) boletoLink?: string;
  @IsOptional() @IsString() @MaxLength(300) observacao?: string;
}

export class BoletoDto {
  @IsOptional() @IsString() @MaxLength(80) boletoLinha?: string;
  @IsOptional() @IsString() @MaxLength(40) boletoNossoNumero?: string;
  @IsOptional() @IsString() @MaxLength(300) boletoLink?: string;
  @IsOptional() @Matches(DATA) vencimento?: string;
}

export class BaixaDto {
  @IsIn(FORMAS_RECEBER as unknown as string[]) forma!: (typeof FORMAS_RECEBER)[number];
  @IsOptional() @Matches(DATA) pagoEm?: string;
}

export class NotaFaturaDto {
  @IsIn(['pendente', 'emitida', 'nao']) status!: 'pendente' | 'emitida' | 'nao';
  @IsOptional() @IsString() @MaxLength(30) numero?: string;
}

export class CreditoDto {
  @IsIn(['entrada', 'devolucao']) tipo!: 'entrada' | 'devolucao';
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(10_000_000) valor!: number;
  @IsIn(['pix', 'transferencia', 'dinheiro', 'boleto', 'debito', 'credito']) forma!: string;
  @IsOptional() @IsString() @MaxLength(250) descricao?: string;
  @IsOptional() @IsString() @MaxLength(18) cnpj?: string;
}
