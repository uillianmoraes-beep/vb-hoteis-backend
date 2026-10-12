import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class AtualizarEmpresaDto {
  @IsOptional() @IsString() @MaxLength(150) nome?: string;
  @IsOptional() @IsString() @MaxLength(18) cnpj?: string | null;
  @IsOptional() @IsObject() vocabulario?: Record<string, string>;
}
