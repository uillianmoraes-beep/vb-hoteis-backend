import { IsBoolean, IsIn, IsObject, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CriarProdutoDto {
  @IsString() @MaxLength(120) nome!: string;
  @IsOptional() @IsString() @MaxLength(30) codigo?: string;
  @IsOptional() @IsString() @MaxLength(20) codigoBarras?: string;
  @IsOptional() @IsString() @MaxLength(60) grupo?: string;
  @IsOptional() @IsIn(['produto', 'servico']) tipo?: 'produto' | 'servico';
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1_000_000) preco!: number;
  @IsOptional() @IsBoolean() frigobar?: boolean;
  @IsOptional() @IsObject() fiscal?: Record<string, unknown>;
  @IsOptional() @IsBoolean() controlaEstoque?: boolean;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) @Max(1_000_000) estoqueMinimo?: number;
  @IsOptional() @IsString() @MaxLength(8) unidade?: string;
}

export class AtualizarProdutoDto {
  @IsOptional() @IsString() @MaxLength(120) nome?: string;
  @IsOptional() @IsString() @MaxLength(30) codigo?: string | null;
  @IsOptional() @IsString() @MaxLength(20) codigoBarras?: string | null;
  @IsOptional() @IsString() @MaxLength(60) grupo?: string | null;
  @IsOptional() @IsIn(['produto', 'servico']) tipo?: 'produto' | 'servico';
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1_000_000) preco?: number;
  @IsOptional() @IsBoolean() ativo?: boolean;
  @IsOptional() @IsBoolean() frigobar?: boolean;
  @IsOptional() @IsObject() fiscal?: Record<string, unknown>;
  @IsOptional() @IsBoolean() controlaEstoque?: boolean;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) @Max(1_000_000) estoqueMinimo?: number;
  @IsOptional() @IsString() @MaxLength(8) unidade?: string;
}
