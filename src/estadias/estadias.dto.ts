import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsISO8601, IsNumber, IsOptional, IsString, IsUUID,
  Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';

export class AbrirEstadiaDto {
  @IsUUID() unidadeId!: string;
  @IsOptional() @IsString() @MaxLength(10) placa?: string;
  @IsOptional() @IsInt() @Min(1) @Max(20) pessoas?: number;
  @IsOptional() @IsIn(['periodo', 'pernoite']) modalidade?: 'periodo' | 'pernoite';
  /** pacote: cobra no mínimo este período */
  @IsOptional() @IsUUID() periodoMinimoId?: string;
  @IsOptional() @IsString() @MaxLength(500) observacao?: string;
}

export class AutorizacaoDto {
  @IsString() @MinLength(3) @MaxLength(120) login!: string;
  @IsString() @MinLength(1) @MaxLength(72) senha!: string;
}

export const FORMAS_RECEBIMENTO = ['dinheiro', 'pix', 'debito', 'credito', 'faturado'] as const;

export class PagamentoDto {
  @IsIn(FORMAS_RECEBIMENTO as unknown as string[]) forma!: (typeof FORMAS_RECEBIMENTO)[number];
  /** quanto abate da conta */
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) valor!: number;
  /** dinheiro: quanto o cliente entregou (troco = recebido - valor) */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) valorRecebido?: number;
  @IsOptional() @IsIn(['cliente', 'gorjeta']) trocoDestino?: 'cliente' | 'gorjeta';
  @IsOptional() @IsString() @MaxLength(120) gorjetaPara?: string;
}

export class NotaFiscalDto {
  /** o cliente quer nota? (a recepção sempre pergunta) */
  @IsBoolean() emitir!: boolean;
  /** CPF (11) ou CNPJ (14), só números; vazio = consumidor não identificado */
  @IsOptional() @IsString() @MaxLength(18) documento?: string;
  @IsOptional() @IsString() @MaxLength(120) nome?: string;
  @IsOptional() @IsEmail() @MaxLength(160) email?: string;
}

export class FecharEstadiaDto {
  /** pagamentos que somam o total (pode dividir em várias formas) */
  @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => PagamentoDto) pagamentos!: PagamentoDto[];
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) desconto?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) acrescimo?: number;
  @IsOptional() @IsString() @MaxLength(300) motivo?: string;
  /** login e senha de quem libera quando passa do limite do perfil */
  @IsOptional() @ValidateNested() @Type(() => AutorizacaoDto) autorizacao?: AutorizacaoDto;
  /** escolha do cliente sobre a nota fiscal */
  @ValidateNested() @Type(() => NotaFiscalDto) nota!: NotaFiscalDto;
}

export class CancelarEstadiaDto {
  @IsString() @MinLength(3) @MaxLength(300) motivo!: string;
  @IsOptional() @IsIn(['livre', 'limpeza']) destino?: 'livre' | 'limpeza';
}

export class AtualizarEstadiaDto {
  @IsOptional() @IsString() @MaxLength(10) placa?: string;
  @IsOptional() @IsInt() @Min(1) @Max(20) pessoas?: number;
  @IsOptional() @IsString() @MaxLength(500) observacao?: string;
}

export class LancarItemDto {
  @IsOptional() @IsUUID() produtoId?: string;
  /** item avulso, sem cadastro */
  @IsOptional() @IsString() @MaxLength(120) descricao?: string;
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) @Max(1000) quantidade!: number;
  /** se vazio, usa o preço do cadastro */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1_000_000) precoUnitario?: number;
}

export class EstornarItemDto {
  @IsString() @MinLength(3) @MaxLength(300) motivo!: string;
}

export class TransferirDto {
  @IsUUID() unidadeId!: string;
  /** true = mantém o preço da categoria da entrada; false = passa a cobrar pela categoria nova */
  @IsBoolean() manterPreco!: boolean;
  @IsString() @MinLength(3) @MaxLength(300) motivo!: string;
}

export class TrocarCobrancaDto {
  @IsIn(['periodo', 'pernoite']) modalidade!: 'periodo' | 'pernoite';
  /** pacote: período mínimo (só com modalidade "periodo"); vazio = automático */
  @IsOptional() @IsUUID() periodoMinimoId?: string | null;
}

export class CorrigirEstadiaDto {
  @IsOptional() @IsISO8601() entradaEm?: string;
  @IsOptional() @IsUUID() tabelaId?: string;
  @IsString() @MinLength(3) @MaxLength(300) motivo!: string;
}

