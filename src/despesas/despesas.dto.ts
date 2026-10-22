import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

export class ContaPagarDto {
  @IsString() @MinLength(2) @MaxLength(200) descricao!: string;
  @IsOptional() @IsString() @MaxLength(120) fornecedor?: string;
  @IsOptional() @IsString() @MaxLength(60) categoria?: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(100_000_000) valor!: number;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) vencimento!: string;
  @IsOptional() @IsIn(['nao', 'mensal']) recorrente?: 'nao' | 'mensal';
  @IsOptional() @IsString() @MaxLength(80) codigoBarras?: string;
  @IsOptional() @IsString() @MaxLength(300) observacao?: string;
  /** conta de todo mês com valor que muda (luz, água): a próxima nasce estimada e o sistema pede o valor */
  @IsOptional() @IsBoolean() valorVariavel?: boolean;
  /** de qual CNPJ é a conta ('principal' ou o CNPJ do ambiente) */
  @IsOptional() @IsString() @MaxLength(18) cnpj?: string;
  /** compra em vários boletos: divide o valor e vence de 30 em 30 dias (só ao criar) */
  @IsOptional() @IsInt() @Min(1) @Max(24) boletos?: number;
}

export class AprovarContasDto {
  /** contas do mesmo lote (nota) */
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(60) @IsUUID('4', { each: true }) ids!: string[];
  @IsIn(['aprovar', 'recusar']) decisao!: 'aprovar' | 'recusar';
  @IsOptional() @IsString() @MaxLength(300) motivo?: string;
}

export class ParcelaNfeDto {
  @IsString() @MaxLength(10) numero!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) vencimento!: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(100_000_000) valor!: number;
}

/** nota fiscal de compra (XML da NF-e) lida no navegador: vira contas a pagar, uma por duplicata */
export class ImportarNfeDto {
  @Matches(/^\d{44}$/) chave!: string;
  @IsString() @MinLength(2) @MaxLength(120) fornecedor!: string;
  @IsString() @MaxLength(20) numero!: string;
  @IsOptional() @IsString() @MaxLength(60) categoria?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => ParcelaNfeDto) parcelas!: ParcelaNfeDto[];
  /** já foi paga (à vista): lança como paga */
  @IsOptional() @IsIn(['dinheiro', 'pix', 'debito', 'credito', 'transferencia', 'boleto']) pagaCom?: string;
  @IsOptional() @IsIn(['sim', 'nao']) lancarCaixa?: 'sim' | 'nao';
  @IsOptional() @IsString() @MaxLength(18) cnpj?: string;
  /** total da nota (vNF), para o financeiro conferir com a soma dos boletos */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100_000_000) totalNota?: number;
}

export class PagarContaDto {
  @IsIn(['dinheiro', 'pix', 'debito', 'credito', 'transferencia', 'boleto']) forma!: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) valorPago?: number;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) pagoEm?: string;
  /** lança a saída no caixa ADM (padrão sim) */
  @IsOptional() @IsIn(['sim', 'nao']) lancarCaixa?: 'sim' | 'nao';
}
