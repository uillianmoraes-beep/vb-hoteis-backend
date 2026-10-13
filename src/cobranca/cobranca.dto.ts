import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ConfigCobrancaDto {
  @IsBoolean() ativo!: boolean;
  @IsIn(['producao', 'sandbox']) ambiente!: 'producao' | 'sandbox';
  /** só quando trocar a chave (fica guardada criptografada e nunca volta para a tela) */
  @IsOptional() @IsString() @MaxLength(300) chave?: string;
  @IsOptional() @IsEmail() @MaxLength(120) email?: string;
}

export class GerarCobrancaDto {
  @IsIn(['BOLETO', 'PIX']) forma!: 'BOLETO' | 'PIX';
}
