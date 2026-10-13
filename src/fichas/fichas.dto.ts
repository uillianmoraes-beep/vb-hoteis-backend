import { Type } from 'class-transformer';
import { ValidateNested, IsBoolean, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

/** Campos da FNRH (Ficha Nacional de Registro de Hóspedes). */
export class DadosFichaDto {
  @IsOptional() @IsString() @MaxLength(150) nome?: string;
  @IsOptional() @IsString() @MaxLength(80) profissao?: string;
  @IsOptional() @IsString() @MaxLength(60) nacionalidade?: string;
  @IsOptional() @IsString() @MaxLength(30) telefone?: string;
  @IsOptional() @Matches(/^(\d{4}-\d{2}-\d{2})?$/) nascimento?: string;
  @IsOptional() @IsIn(['M', 'F', 'O', '']) sexo?: string;
  @IsOptional() @IsString() @MaxLength(160) email?: string;
  @IsOptional() @IsString() @MaxLength(40) documento?: string;
  @IsOptional() @IsString() @MaxLength(30) tipoDocumento?: string;
  @IsOptional() @IsString() @MaxLength(60) orgaoExpedidor?: string;
  @IsOptional() @IsString() @MaxLength(14) cpf?: string;
  @IsOptional() @IsBoolean() estrangeiro?: boolean;
  @IsOptional() @IsString() @MaxLength(10) cep?: string;
  @IsOptional() @IsString() @MaxLength(200) residencia?: string;
  @IsOptional() @IsString() @MaxLength(120) procedencia?: string;
  @IsOptional() @IsString() @MaxLength(120) destino?: string;
  @IsOptional() @IsIn(['turismo', 'negocios', 'convencao', 'outro', '']) motivo?: string;
  @IsOptional() @IsString() @MaxLength(40) transporte?: string;
  @IsOptional() @IsString() @MaxLength(10) placa?: string;
  @IsOptional() @IsString() @MaxLength(25) checkin?: string;
  @IsOptional() @IsString() @MaxLength(25) checkout?: string;
  @IsOptional() @IsString() @MaxLength(300) acompanhantes?: string;
  @IsOptional() @IsBoolean() naoFumante?: boolean;
}

export class SalvarFichaDto {
  @IsOptional() @ValidateNested() @Type(() => DadosFichaDto) dados?: DadosFichaDto;
  @IsOptional() @IsString() @MaxLength(600_000) docFoto?: string;
  @IsOptional() @IsString() @MaxLength(200_000) assinatura?: string;
  @IsOptional() @IsBoolean() lgpd?: boolean;
}

export class CriarFichaDto {
  @IsOptional() @IsUUID() estadiaId?: string;
  @IsOptional() @IsUUID() unidadeId?: string;
}
