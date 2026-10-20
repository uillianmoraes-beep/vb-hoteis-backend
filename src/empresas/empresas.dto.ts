import { IsObject, IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';

export class AtualizarEmpresaDto {
  @IsOptional() @IsString() @MaxLength(150) nome?: string;
  @IsOptional() @IsString() @MaxLength(18) cnpj?: string | null;
  @IsOptional() @IsObject() vocabulario?: Record<string, string>;
  @IsOptional() @IsObject() aparencia?: { tema?: string; cores?: Record<string, string>; menu?: string; calor?: string[] };
}

export class LogoDto {
  /** data URL da imagem (png, jpg, webp ou svg) ou null para tirar */
  @ValidateIf((o: LogoDto) => o.logo !== null)
  @IsString()
  @MaxLength(700_000)
  @Matches(/^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/, { message: 'Envie uma imagem PNG, JPG, WEBP ou SVG.' })
  logo!: string | null;
}
