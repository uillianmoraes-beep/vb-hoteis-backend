import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export class LocalDto {
  @IsString() @MaxLength(80) nome!: string;
  @IsOptional() @IsUUID() ambienteId?: string | null;
  @IsOptional() @IsString() @MaxLength(18) cnpj?: string | null;
  @IsOptional() @IsBoolean() padrao?: boolean;
  @IsOptional() @IsBoolean() ativo?: boolean;
}

export class ItemQtdDto {
  @IsUUID() produtoId!: string;
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(-1_000_000) @Max(1_000_000) quantidade!: number;
  /** custo unitário (só na entrada) */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(1_000_000) custo?: number;
}

export class EntradaDto {
  @IsUUID() localId!: string;
  @IsOptional() @IsString() @MaxLength(60) documento?: string;
  @IsOptional() @IsString() @MaxLength(300) observacao?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(300) @ValidateNested({ each: true }) @Type(() => ItemQtdDto) itens!: ItemQtdDto[];
}

export class ItemNotaDto {
  @IsString() @MaxLength(60) codigo!: string;
  @IsString() @MaxLength(200) nome!: string;
  @IsNumber() @Min(0) quantidade!: number;
  @IsOptional() @IsString() @MaxLength(10) unidade?: string;
  /** valor total do item na nota */
  @IsNumber() @Min(0) valor!: number;
  /** produto da casa (vazio = criar um novo com o nome da nota) */
  @IsOptional() @IsUUID() produtoId?: string | null;
  /** quantas unidades da casa vem em 1 unidade da nota (caixa com 12 = 12) */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) @Max(100000) fator?: number;
  /** não dar entrada neste item (ex.: material de escritório) */
  @IsOptional() @IsBoolean() ignorar?: boolean;
}

export class EntradaNotaDto {
  @IsUUID() localId!: string;
  @Matches(/^\d{44}$/) chave!: string;
  @IsOptional() @IsString() @MaxLength(20) numero?: string;
  @IsOptional() @IsString() @MaxLength(18) fornecedorCnpj?: string;
  @IsOptional() @IsString() @MaxLength(120) fornecedor?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => ItemNotaDto) itens!: ItemNotaDto[];
}

export class TransferenciaDto {
  @IsUUID() origemId!: string;
  @IsUUID() destinoId!: string;
  @IsOptional() @IsString() @MaxLength(300) observacao?: string;
  /** confirma que, com CNPJ diferente, a nota de transferência foi/será emitida */
  @IsOptional() @IsBoolean() comNota?: boolean;
  @IsOptional() @IsString() @MaxLength(60) documento?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(300) @ValidateNested({ each: true }) @Type(() => ItemQtdDto) itens!: ItemQtdDto[];
}

export class InventarioDto {
  @IsUUID() localId!: string;
  @IsOptional() @IsString() @MaxLength(300) observacao?: string;
  /** quantidade contada (o sistema lança a diferença) */
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => ItemQtdDto) itens!: ItemQtdDto[];
}

export class PerdaDto {
  @IsUUID() localId!: string;
  @IsIn(['perda', 'consumo']) tipo!: 'perda' | 'consumo';
  @IsString() @MaxLength(300) observacao!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(300) @ValidateNested({ each: true }) @Type(() => ItemQtdDto) itens!: ItemQtdDto[];
}

export class MinimoDto {
  @IsUUID() produtoId!: string;
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) @Max(1_000_000) minimo!: number;
}

export class MinimosDto {
  @IsUUID() localId!: string;
  @IsArray() @ArrayMaxSize(2000) @ValidateNested({ each: true }) @Type(() => MinimoDto) itens!: MinimoDto[];
}
