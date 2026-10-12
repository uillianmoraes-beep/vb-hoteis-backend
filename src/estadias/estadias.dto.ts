import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { FORMAS_PAGAMENTO, FormaPagamento } from './estadia.entity';

export class AbrirEstadiaDto {
  @IsUUID() unidadeId!: string;
  @IsOptional() @IsString() @MaxLength(10) placa?: string;
  @IsOptional() @IsInt() @Min(1) @Max(20) pessoas?: number;
  @IsOptional() @IsIn(['periodo', 'pernoite']) modalidade?: 'periodo' | 'pernoite';
  @IsOptional() @IsString() @MaxLength(500) observacao?: string;
}

export class AutorizacaoDto {
  @IsString() @MinLength(3) @MaxLength(120) login!: string;
  @IsString() @MinLength(1) @MaxLength(72) senha!: string;
}

export class FecharEstadiaDto {
  @IsIn(FORMAS_PAGAMENTO as unknown as string[]) formaPagamento!: FormaPagamento;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) desconto?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) acrescimo?: number;
  @IsOptional() @IsString() @MaxLength(300) motivo?: string;
  /** login e senha de quem libera quando passa do limite do perfil */
  @IsOptional() @ValidateNested() @Type(() => AutorizacaoDto) autorizacao?: AutorizacaoDto;
}

export class CancelarEstadiaDto {
  @IsString() @MinLength(3) @MaxLength(300) motivo!: string;
  @IsOptional() @IsIn(['livre', 'limpeza']) destino?: 'livre' | 'limpeza';
}

export class AtualizarEstadiaDto {
  @IsOptional() @IsString() @MaxLength(10) placa?: string;
  @IsOptional() @IsInt() @Min(1) @Max(20) pessoas?: number;
  @IsOptional() @IsString() @MaxLength(500) observacao?: string;
}
