import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

export class ConfigCobrancaDto {
  @IsBoolean() ativo!: boolean;
  @IsIn(['producao', 'sandbox']) ambiente!: 'producao' | 'sandbox';
  /** só quando trocar a chave (fica guardada criptografada e nunca volta para a tela) */
  @IsOptional() @IsString() @MaxLength(300) chave?: string;
  @IsOptional() @IsEmail() @MaxLength(120) email?: string;
}

export class FaturarClienteDto {
  /** vazio = tudo o que está em aberto e fora de fatura */
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsUUID('4', { each: true }) contas?: string[];
  /** vazio = hoje + prazo do cliente */
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) vencimento?: string;
  /** como cobrar: boleto/Pix pelo Asaas ou só a fatura (o cliente paga por transferência) */
  @IsIn(['BOLETO', 'PIX', 'nao']) cobrar!: 'BOLETO' | 'PIX' | 'nao';
  /** a fatura precisa de nota (fica pendente até marcar o número) */
  @IsOptional() @IsBoolean() nota?: boolean;
  @IsOptional() @IsString() @MaxLength(300) observacao?: string;
}

export class GerarCobrancaDto {
  @IsIn(['BOLETO', 'PIX']) forma!: 'BOLETO' | 'PIX';
}
