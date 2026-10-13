import { IsIn, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class ContaPagarDto {
  @IsString() @MinLength(2) @MaxLength(200) descricao!: string;
  @IsOptional() @IsString() @MaxLength(120) fornecedor?: string;
  @IsOptional() @IsString() @MaxLength(60) categoria?: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(100_000_000) valor!: number;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) vencimento!: string;
  @IsOptional() @IsIn(['nao', 'mensal']) recorrente?: 'nao' | 'mensal';
  @IsOptional() @IsString() @MaxLength(80) codigoBarras?: string;
  @IsOptional() @IsString() @MaxLength(300) observacao?: string;
}

export class PagarContaDto {
  @IsIn(['dinheiro', 'pix', 'debito', 'credito', 'transferencia', 'boleto']) forma!: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) valorPago?: number;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) pagoEm?: string;
  /** lança a saída no caixa ADM (padrão sim) */
  @IsOptional() @IsIn(['sim', 'nao']) lancarCaixa?: 'sim' | 'nao';
}
