import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsNumber, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';

export class AutorizacaoCaixaDto {
  /** senha de liberação do gerente (só números). Com ela não precisa de login. */
  @ValidateIf((o) => !!o.pin) @Matches(/^\d{4,8}$/, { message: 'A senha de liberação tem de 4 a 8 números.' }) pin?: string;
  @ValidateIf((o) => !o.pin) @IsString() @MinLength(3) @MaxLength(120) login?: string;
  @ValidateIf((o) => !o.pin) @IsString() @MinLength(1) @MaxLength(72) senha?: string;
}

export class AbrirTurnoDto {
  @IsUUID() ambienteId!: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100_000) trocoInicial!: number;
}

export class MovimentoDto {
  @IsIn(['sangria', 'reforco', 'despesa']) tipo!: 'sangria' | 'reforco' | 'despesa';
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(1_000_000) valor!: number;
  @IsOptional() @IsString() @MaxLength(300) descricao?: string;
  @IsOptional() @IsString() @MaxLength(60) categoria?: string;
  @IsOptional() @ValidateNested() @Type(() => AutorizacaoCaixaDto) autorizacao?: AutorizacaoCaixaDto;
}

export class ConfigCaixaDto {
  @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(60, { each: true }) saidas!: string[];
  @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(60, { each: true }) entradas!: string[];
}

export class FecharTurnoDto {
  /** valores contados por forma: { dinheiro, pix, debito, credito, faturado } */
  @IsObject() contado!: Record<string, number>;
  @IsOptional() @IsString() @MaxLength(500) observacao?: string;
  /** dinheiro que fica na gaveta para o próximo turno (o resto é entregue à gerência) */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1_000_000) fundoProximo?: number;
}

export class ResgatarPenhoraDto {
  @IsIn(['dinheiro', 'pix', 'debito', 'credito']) forma!: 'dinheiro' | 'pix' | 'debito' | 'credito';
}

export class BaixarPenhoraDto {
  @IsString() @MinLength(3) @MaxLength(300) motivo!: string;
}

export class LancamentoAdmDto {
  @IsIn(['entrada', 'saida']) tipo!: 'entrada' | 'saida';
  @IsIn(['dinheiro', 'pix', 'debito', 'credito', 'transferencia', 'boleto']) forma!: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(10_000_000) valor!: number;
  @IsString() @MinLength(2) @MaxLength(300) descricao!: string;
  /** 'principal' ou o CNPJ do ambiente */
  @IsOptional() @IsString() @MaxLength(18) cnpj?: string;
}
