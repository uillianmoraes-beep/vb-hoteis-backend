import { IsBoolean, IsIn, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { DOCUMENTOS_FISCAIS, type DocumentoFiscal } from '../common/fiscal';

export class SalvarRegraDto {
  @IsIn(DOCUMENTOS_FISCAIS as unknown as string[]) documento!: DocumentoFiscal;
  /** vazio = padrão do documento */
  @IsOptional() @IsString() @MaxLength(4) cfop?: string | null;
  @IsString() @MinLength(2) @MaxLength(120) nome!: string;
  @IsOptional() @IsObject() dados?: Record<string, unknown>;
  @IsOptional() @IsBoolean() ativo?: boolean;
}
