import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

export class TipoEnxovalDto {
  @IsString() @MinLength(2) @MaxLength(80) nome!: string;
  @IsOptional() @IsInt() @Min(1) @Max(2000) limiteLavagens?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) custo?: number;
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
}

export class KitDto {
  @IsUUID() categoriaId!: string;
  @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => ItemMovDto) itens!: ItemMovDto[];
}
