import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export class ItemPedidoDto {
  @IsUUID() produtoId!: string;
  @IsInt() @Min(1) @Max(20) quantidade!: number;
}

export class NovoPedidoDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => ItemPedidoDto) itens!: ItemPedidoDto[];
  @IsOptional() @IsString() @MaxLength(300) observacao?: string;
}

export class RecusarPedidoDto {
  @IsOptional() @IsString() @MaxLength(200) motivo?: string;
}

export class ItemFrigobarDto {
  @IsUUID() produtoId!: string;
  @IsInt() @Min(0) @Max(99) quantidade!: number;
}

export class FrigobarCategoriaDto {
  @IsArray() @ArrayMaxSize(80) @ValidateNested({ each: true }) @Type(() => ItemFrigobarDto) itens!: ItemFrigobarDto[];
}

export class CardapioDto {
  @IsBoolean() cardapio!: boolean;
}
