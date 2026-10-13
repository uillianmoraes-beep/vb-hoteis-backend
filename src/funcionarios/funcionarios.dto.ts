import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { FUNCOES } from './funcionario.entity';

export class FuncionarioDto {
  @IsString() @MinLength(2) @MaxLength(120) nome!: string;
  @IsIn(FUNCOES as unknown as string[]) funcao!: string;
  @IsOptional() @IsArray() @IsUUID('4', { each: true }) ambienteIds?: string[];
  @IsOptional() @IsString() @MaxLength(30) telefone?: string;
  @IsOptional() @IsString() @MaxLength(30) documento?: string;
  @IsOptional() @IsString() @MaxLength(120) chavePix?: string;
  @IsOptional() @Matches(/^(\d{4}-\d{2}-\d{2})?$/) admissao?: string;
  @IsOptional() @IsString() @MaxLength(400_000) foto?: string;
  @IsOptional() @IsString() @MaxLength(40) usuarioId?: string;
  @IsOptional() @IsBoolean() recebeGorjeta?: boolean;
  @IsOptional() @IsString() @MaxLength(300) observacao?: string;
  @IsOptional() @IsBoolean() ativo?: boolean;
}

export class LancamentoFuncDto {
  @IsIn(['vale', 'desconto', 'bonus', 'pagamento']) tipo!: 'vale' | 'desconto' | 'bonus' | 'pagamento';
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(1_000_000) valor!: number;
  @IsOptional() @IsString() @MaxLength(300) descricao?: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) data!: string;
  /** pagamento/vale em dinheiro saindo do caixa ADM */
  @IsOptional() @IsIn(['dinheiro', 'pix', 'transferencia', 'nenhum']) saidaCaixa?: string;
}

export class ItemRevisaoDto {
  @IsString() @MaxLength(80) item!: string;
  @IsBoolean() ok!: boolean;
}

export class RevisaoDto {
  @IsUUID() unidadeId!: string;
  @IsOptional() @IsString() @MaxLength(40) camareiraId?: string;
  @IsOptional() @IsString() @MaxLength(120) camareiraNome?: string;
  @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => ItemRevisaoDto) itens!: ItemRevisaoDto[];
  @IsOptional() @IsInt() @Min(1) @Max(5) nota?: number;
  @IsOptional() @IsString() @MaxLength(500) observacao?: string;
}

export class ConfigRevisaoDto {
  @IsArray() @ArrayMaxSize(40) @IsString({ each: true }) @MaxLength(80, { each: true }) itens!: string[];
}
