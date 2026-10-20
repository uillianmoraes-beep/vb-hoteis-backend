import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsObject, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export class CriarProdutoDto {
  @IsString() @MaxLength(120) nome!: string;
  @IsOptional() @IsString() @MaxLength(30) codigo?: string;
  @IsOptional() @IsString() @MaxLength(20) codigoBarras?: string;
  @IsOptional() @IsIn(['venda', 'interno']) uso?: 'venda' | 'interno';
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('all', { each: true }) ambientesIds?: string[] | null;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1000000) custo?: number;
  @IsOptional() @IsString() @MaxLength(60) grupo?: string;
  @IsOptional() @IsIn(['produto', 'servico']) tipo?: 'produto' | 'servico';
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1_000_000) preco!: number;
  @IsOptional() @IsBoolean() frigobar?: boolean;
  @IsOptional() @IsBoolean() ressarcimento?: boolean;
  @IsOptional() @IsObject() fiscal?: Record<string, unknown>;
  @IsOptional() @IsBoolean() controlaEstoque?: boolean;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) @Max(1_000_000) estoqueMinimo?: number;
  @IsOptional() @IsString() @MaxLength(8) unidade?: string;
}

export class AtualizarProdutoDto {
  @IsOptional() @IsString() @MaxLength(120) nome?: string;
  @IsOptional() @IsString() @MaxLength(30) codigo?: string | null;
  @IsOptional() @IsString() @MaxLength(20) codigoBarras?: string | null;
  @IsOptional() @IsIn(['venda', 'interno']) uso?: 'venda' | 'interno';
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('all', { each: true }) ambientesIds?: string[] | null;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1000000) custo?: number | null;
  @IsOptional() @IsString() @MaxLength(60) grupo?: string | null;
  @IsOptional() @IsIn(['produto', 'servico']) tipo?: 'produto' | 'servico';
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1_000_000) preco?: number;
  @IsOptional() @IsBoolean() ativo?: boolean;
  @IsOptional() @IsBoolean() frigobar?: boolean;
  @IsOptional() @IsBoolean() ressarcimento?: boolean;
  @IsOptional() @IsObject() fiscal?: Record<string, unknown>;
  @IsOptional() @IsBoolean() controlaEstoque?: boolean;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) @Max(1_000_000) estoqueMinimo?: number;
  @IsOptional() @IsString() @MaxLength(8) unidade?: string;
}

export class InsumoFichaDto {
  @IsUUID() insumoId!: string;
  /** quantidade na unidade do insumo (ex.: 0,250 kg), para a receita inteira */
  @IsNumber({ maxDecimalPlaces: 4 }) @Min(0.0001) @Max(100000) quantidade!: number;
}

export class SalvarFichaDto {
  /** quantas porções a receita rende (1 = a ficha é de uma porção) */
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) @Max(10000) rendimento!: number;
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => InsumoFichaDto) itens!: InsumoFichaDto[];
}

export class RenomearGrupoDto {
  @IsString() @MaxLength(60) de!: string;
  /** vazio = tira o grupo dos produtos */
  @IsString() @MaxLength(60) para!: string;
}

export class AmbientesEmLoteDto {
  @IsArray() @ArrayMaxSize(1000) @IsUUID('all', { each: true }) produtoIds!: string[];
  @IsUUID() ambienteId!: string;
  /** usar também neste ambiente (true) ou tirar dele (false) */
  @IsBoolean() usar!: boolean;
}

export class ImportarProdutosDto {
  /** arquivo .xlsx em base64 */
  @IsString() @MaxLength(4_000_000) arquivo!: string;
  @IsOptional() @IsBoolean() simular?: boolean;
  /** para as linhas com "Usado em" em branco (produtos novos): ambientes; vazio = todos */
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('all', { each: true }) usadoEm?: string[];
  /** para as linhas com "Local do saldo" em branco */
  @IsOptional() @IsUUID() localId?: string;
}
