import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

export class TipoEnxovalDto {
  @IsString() @MinLength(2) @MaxLength(80) nome!: string;
  @IsOptional() @IsInt() @Min(1) @Max(2000) limiteLavagens?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) custo?: number;
  /** quanto a lavanderia cobra por peça (se cobra por quilo, use o peso) */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(10_000) custoLavagem?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) @Max(100) pesoKg?: number;
}

export class PrecoKgDto {
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(10_000) precoKg!: number;
}

export class ItemMovDto {
  @IsUUID() tipoId!: string;
  @IsInt() @Min(1) @Max(100_000) quantidade!: number;
}

export class MovimentoEnxovalDto {
  /** compra = entrou peça nova · envio = foi para a lavanderia · retorno = voltou lavada · danificada · extraviada · contagem = inventário da rouparia */
  @IsIn(['compra', 'envio', 'retorno', 'danificada', 'extraviada', 'contagem']) movimento!: string;
  @IsArray() @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => ItemMovDto) itens!: ItemMovDto[];
  /** perdas: onde estava (suite, lavanderia, rouparia) */
  @IsOptional() @IsIn(['suite', 'lavanderia', 'rouparia']) origem?: string;
  @IsOptional() @IsString() @MaxLength(20) unidade?: string;
  @IsOptional() @IsString() @MaxLength(120) responsavel?: string;
  @IsOptional() @IsString() @MaxLength(300) observacao?: string;
  /** peça ruim/sumida de um lote (lido pelo QR) */
  @IsOptional() @IsUUID() loteId?: string;
  /** fotos que mostram o estado da peça (até 3, já reduzidas no navegador) */
  @IsOptional() @IsArray() @ArrayMaxSize(3) @IsString({ each: true }) @MaxLength(400_000, { each: true }) fotos?: string[];
  /* ---- compra: vira um lote com QR code ---- */
  @IsOptional() @IsBoolean() usadas?: boolean;
  /** peças já usadas: lavagens estimadas de cada peça */
  @IsOptional() @IsInt() @Min(0) @Max(2000) lavagensIniciais?: number;
  @IsOptional() @IsInt() @Min(0) @Max(240) mesesUso?: number;
  @IsOptional() @IsString() @MaxLength(120) fornecedor?: string;
  @IsOptional() @IsString() @MaxLength(40) notaFiscal?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) dataCompra?: string;
}

export class ResponsavelEnxovalDto {
  @IsOptional() @IsUUID() usuarioId?: string | null;
}

export class NovoRelatorioDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) de!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) ate!: string;
}

export class AssinarRelatorioDto {
  @IsIn(['responsavel', 'gerente']) papel!: 'responsavel' | 'gerente';
  /** assinatura desenhada (PNG) */
  @IsString() @MaxLength(300_000) assinatura!: string;
  /** a própria senha de quem assina, para confirmar que é ele */
  @IsString() @MinLength(1) @MaxLength(72) senha!: string;
}

export class KitDto {
  @IsUUID() categoriaId!: string;
  @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => ItemMovDto) itens!: ItemMovDto[];
}
