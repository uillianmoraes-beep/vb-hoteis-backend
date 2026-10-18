import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export class FornecedorDto {
  @IsString() @MaxLength(120) nome!: string;
  @IsOptional() @IsString() @MaxLength(18) cnpj?: string | null;
  @IsOptional() @IsString() @MaxLength(80) contato?: string | null;
  @IsOptional() @IsString() @MaxLength(20) telefone?: string | null;
  @IsOptional() @IsString() @MaxLength(120) email?: string | null;
  @IsOptional() @IsString() @MaxLength(200) categorias?: string | null;
  @IsOptional() @IsString() @MaxLength(300) observacao?: string | null;
  @IsOptional() @IsBoolean() ativo?: boolean;
}

export class ItemCotacaoDto {
  @IsOptional() @IsUUID() produtoId?: string | null;
  @IsString() @MaxLength(200) descricao!: string;
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) @Max(1_000_000) quantidade!: number;
  @IsOptional() @IsString() @MaxLength(10) unidade?: string;
}

export class CotacaoDto {
  @IsString() @MaxLength(120) titulo!: string;
  @IsOptional() @IsUUID() localId?: string | null;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) prazo?: string | null;
  @IsOptional() @IsString() @MaxLength(500) observacao?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(300) @ValidateNested({ each: true }) @Type(() => ItemCotacaoDto) itens!: ItemCotacaoDto[];
  @IsArray() @ArrayMaxSize(30) @IsUUID('all', { each: true }) fornecedores!: string[];
}

export class AdicionarFornecedoresDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @IsUUID('all', { each: true }) fornecedores!: string[];
}

export class PrecoDto {
  @IsUUID() itemId!: string;
  /** vazio/null = não tem o item */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(1_000_000) preco?: number | null;
  @IsOptional() @IsString() @MaxLength(60) marca?: string | null;
}

export class RespostaDto {
  @IsArray() @ArrayMaxSize(300) @ValidateNested({ each: true }) @Type(() => PrecoDto) precos!: PrecoDto[];
  @IsOptional() @IsString() @MaxLength(60) prazoEntrega?: string;
  @IsOptional() @IsString() @MaxLength(80) condicaoPagamento?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100000) frete?: number;
  @IsOptional() @IsString() @MaxLength(500) observacao?: string;
  /** o fornecedor avisa que não vai cotar */
  @IsOptional() @IsBoolean() recusar?: boolean;
}

export class EscolhaDto {
  @IsUUID() itemId!: string;
  @IsOptional() @IsUUID() cotacaoFornecedorId?: string | null;
}

export class EscolhasDto {
  @IsArray() @ArrayMaxSize(300) @ValidateNested({ each: true }) @Type(() => EscolhaDto) escolhas!: EscolhaDto[];
}

export class ItemModeloDto {
  @IsOptional() @IsUUID() produtoId?: string | null;
  @IsString() @MaxLength(200) descricao!: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) @Max(1_000_000) quantidade?: number | null;
  @IsOptional() @IsString() @MaxLength(10) unidade?: string;
}

/** lista padrão de itens para montar cotações rápido */
export class ModeloDto {
  @IsString() @MaxLength(80) nome!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(300) @ValidateNested({ each: true }) @Type(() => ItemModeloDto) itens!: ItemModeloDto[];
}

export class RecebidoDto {
  @IsUUID() itemId!: string;
  /** quantidade que entra no estoque, na unidade do produto */
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) @Max(1_000_000) quantidade!: number;
  /** custo por unidade do produto (quando a unidade da compra é outra, ex.: caixa com 12) */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(1_000_000) custo?: number | null;
}

/** entrada no estoque do que foi comprado de um fornecedor */
export class ReceberDto {
  @IsOptional() @IsUUID() localId?: string | null;
  @IsOptional() @IsString() @MaxLength(60) documento?: string;
  /** quantidades realmente recebidas (itemId → quantidade); ausente = a da cotação */
  @IsOptional() @IsArray() @ArrayMaxSize(300) @ValidateNested({ each: true }) @Type(() => RecebidoDto) itens?: RecebidoDto[];
}
