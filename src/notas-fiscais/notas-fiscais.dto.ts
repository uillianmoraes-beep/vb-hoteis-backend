import { Type } from 'class-transformer';
import { AutorizacaoDto } from '../estadias/estadias.dto';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';

class DadosEmissorDto {
  @IsOptional() @IsString() @MaxLength(30) inscricaoMunicipal?: string;
  @IsOptional() @IsString() @MaxLength(10) codigoMunicipio?: string;
  @IsOptional() @IsString() @Length(2, 2) uf?: string;
  @IsOptional() @IsIn(['simples', 'mei', 'normal']) regime?: 'simples' | 'mei' | 'normal';
  @IsOptional() @IsInt() @Min(0) @Max(9) regimeEspecial?: number;
  @IsOptional() @IsString() @MaxLength(60) naturezaNfe?: string;
  @IsOptional() @IsString() @MaxLength(500) infoAdicional?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(100) aliquotaIss?: number;
}

/** emissor de um CNPJ na Focus (os tokens só são trocados quando vierem preenchidos) */
export class EmissorDto {
  @IsIn(['homologacao', 'producao']) ambiente!: 'homologacao' | 'producao';
  @IsOptional() @IsString() @MaxLength(200) tokenHomologacao?: string;
  @IsOptional() @IsString() @MaxLength(200) tokenProducao?: string;
  /** quem leva a nota: Focus NFe ou Spedy */
  @IsOptional() @IsIn(['focus', 'spedy']) provedor?: 'focus' | 'spedy';
  @IsOptional() @IsString() @MaxLength(300) spedyHomologacao?: string;
  @IsOptional() @IsString() @MaxLength(300) spedyProducao?: string;
  /** NFS-e nacional pelo emissor próprio (precisa do certificado A1 guardado) */
  @IsOptional() @IsBoolean() nfseProprio?: boolean;
  @IsOptional() @IsIn(['nacional', 'municipal']) nfsePadrao?: 'nacional' | 'municipal';
  @IsOptional() @ValidateNested() @Type(() => DadosEmissorDto) dados?: DadosEmissorDto;
  @IsOptional() @IsInt() @Min(1) @Max(49999) dpsSerie?: number;
  @IsOptional() @IsInt() @Min(1) @Max(999_999_999) dpsProximoProducao?: number;
}

/** certificado A1 para o emissor próprio: arquivo .pfx em base64 e a senha (guardados cifrados) */
export class CertificadoA1Dto {
  @IsString() @MinLength(100) @MaxLength(60_000) pfx!: string;
  @IsString() @MinLength(1) @MaxLength(100) senha!: string;
}

export class EmitirContaDto {
  /** tudo (consumo na NFC-e e hospedagem na NFS-e), só a NFC-e ou só a NFS-e */
  @IsOptional() @IsIn(['tudo', 'nfce', 'nfse']) quais?: 'tudo' | 'nfce' | 'nfse';
  /** conta com pagador separado: a parte (empresa ou hóspede) */
  @IsOptional() @IsUUID() parteId?: string;
}

export class DestinatarioDto {
  @IsString() @MinLength(2) @MaxLength(60) nome!: string;
  @IsString() @MaxLength(18) documento!: string;
  @IsOptional() @IsString() @MaxLength(20) inscricaoEstadual?: string;
  @IsOptional() @IsIn(['1', '2', '9']) indicadorIe?: '1' | '2' | '9';
  @IsString() @MinLength(2) @MaxLength(60) logradouro!: string;
  @IsString() @MaxLength(10) numero!: string;
  @IsString() @MinLength(2) @MaxLength(60) bairro!: string;
  @IsString() @MinLength(2) @MaxLength(60) municipio!: string;
  @IsString() @Length(2, 2) uf!: string;
  @IsString() @MaxLength(9) cep!: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(20) telefone?: string;
}

export class ItemNotaDto {
  @IsUUID() produtoId!: string;
  @IsNumber({ maxDecimalPlaces: 4 }) @Min(0.0001) @Max(1_000_000) quantidade!: number;
  @IsNumber({ maxDecimalPlaces: 4 }) @Min(0.01) @Max(10_000_000) valorUnitario!: number;
}

export class EmitirNfeDto {
  @IsOptional() @IsString() @MaxLength(18) cnpj?: string;
  @IsOptional() @IsUUID() ambienteId?: string;
  @IsOptional() @IsString() @MaxLength(60) natureza?: string;
  @ValidateNested() @Type(() => DestinatarioDto) destinatario!: DestinatarioDto;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(300) @ValidateNested({ each: true }) @Type(() => ItemNotaDto) itens!: ItemNotaDto[];
  @IsOptional() @IsIn(['dinheiro', 'pix', 'debito', 'credito', 'faturado', 'sem']) formaPagamento?: string;
  @IsOptional() @IsIn(['0', '1', '2', '3', '4', '9']) presenca?: string;
  @IsOptional() @IsBoolean() consumidorFinal?: boolean;
  @IsOptional() @IsString() @MaxLength(500) observacao?: string;
}

export class EmitirDevolucaoDto {
  /** saída: devolver ao fornecedor; entrada: o cliente devolveu */
  @IsIn(['saida', 'entrada']) tipo!: 'saida' | 'entrada';
  /** nota emitida pelo sistema que está sendo devolvida, ou a chave de 44 números da nota original */
  @IsOptional() @IsUUID() notaId?: string;
  @IsOptional() @IsString() @MaxLength(60) chaveReferenciada?: string;
  @IsOptional() @IsString() @MaxLength(18) cnpj?: string;
  @IsOptional() @IsUUID() ambienteId?: string;
  @IsOptional() @IsString() @MaxLength(60) natureza?: string;
  @IsOptional() @IsString() @MaxLength(300) motivo?: string;
  @ValidateNested() @Type(() => DestinatarioDto) destinatario!: DestinatarioDto;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(300) @ValidateNested({ each: true }) @Type(() => ItemNotaDto) itens!: ItemNotaDto[];
}

export class CancelarNotaDto {
  @IsString() @MinLength(15, { message: 'A justificativa precisa ter pelo menos 15 letras.' }) @MaxLength(255) justificativa!: string;
  /** liberação do gerente (quem não tem a permissão de cancelar) */
  @IsOptional() @ValidateNested() @Type(() => AutorizacaoDto) autorizacao?: AutorizacaoDto;
}

export class CartaCorrecaoDto {
  @IsString() @MinLength(15, { message: 'A correção precisa ter pelo menos 15 letras.' }) @MaxLength(1000) correcao!: string;
}
