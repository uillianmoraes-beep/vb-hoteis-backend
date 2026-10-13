import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export class ItemVendaDto {
  @IsUUID() produtoId!: string;
  @IsInt() @Min(1) @Max(999) quantidade!: number;
}

export class VendaAvulsaDto {
  @IsUUID() ambienteId!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => ItemVendaDto) itens!: ItemVendaDto[];
  /** ficha = desconta na ficha financeira do funcionário */
  @IsIn(['dinheiro', 'pix', 'debito', 'credito', 'ficha']) forma!: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) valorRecebido?: number;
  @IsOptional() @IsIn(['cliente', 'funcionario']) para?: 'cliente' | 'funcionario';
  @IsOptional() @IsUUID() funcionarioId?: string;
}

export class DespertadorDto {
  @IsUUID() unidadeId!: string;
  /** "HH:MM" (hoje ou amanhã, o que vier primeiro) ou data-hora ISO */
  @IsString() @Matches(/^(\d{2}:\d{2}|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?)$/) horario!: string;
  @IsOptional() @IsString() @MaxLength(200) observacao?: string;
}
