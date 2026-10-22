import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsISO8601, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';

export class AbrirEstadiaDto {
  @IsUUID() unidadeId!: string;
  @IsOptional() @IsString() @MaxLength(10) placa?: string;
  @IsOptional() @IsInt() @Min(1) @Max(20) pessoas?: number;
  @IsOptional() @IsIn(['periodo', 'pernoite']) modalidade?: 'periodo' | 'pernoite';
  /** portaria: cliente que paga na entrada (moto, a pé) */
  @IsOptional() @IsArray() @ArrayMaxSize(5) @ValidateNested({ each: true }) @Type(() => PagamentoDto) adiantamento?: PagamentoDto[];
  /** pacote: cobra no mínimo este período */
  @IsOptional() @IsUUID() periodoMinimoId?: string;
  @IsOptional() @IsString() @MaxLength(500) observacao?: string;
  /** hotel/pousada sem reserva: quantas noites (cobra a diária da categoria em Tarifas › Diárias) */
  @IsOptional() @IsInt() @Min(1) @Max(90) noites?: number;
}

export class AutorizacaoDto {
  /** senha de liberação do gerente (só números). Com ela não precisa de login. */
  @ValidateIf((o) => !!o.pin) @Matches(/^\d{4,8}$/, { message: 'A senha de liberação tem de 4 a 8 números.' }) pin?: string;
  @ValidateIf((o) => !o.pin) @IsString() @MinLength(3) @MaxLength(120) login?: string;
  @ValidateIf((o) => !o.pin) @IsString() @MinLength(1) @MaxLength(72) senha?: string;
}

export const FORMAS_RECEBIMENTO = ['dinheiro', 'pix', 'debito', 'credito', 'faturado', 'penhora'] as const;

export class PagamentoDto {
  @IsIn(FORMAS_RECEBIMENTO as unknown as string[]) forma!: (typeof FORMAS_RECEBIMENTO)[number];
  /** quanto abate da conta */
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) valor!: number;
  /** dinheiro: quanto o cliente entregou (troco = recebido - valor) */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) valorRecebido?: number;
  @IsOptional() @IsIn(['cliente', 'gorjeta']) trocoDestino?: 'cliente' | 'gorjeta';
  @IsOptional() @IsString() @MaxLength(120) gorjetaPara?: string;
  /** quem recebe a gorjeta (usuário marcado como recebe gorjeta) */
  @IsOptional() @IsUUID() gorjetaUsuarioId?: string;
  /** gorjeta a mais no cartão/pix (o cliente passa o valor da conta + este) */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100_000) gorjetaAdicional?: number;
  /** penhora: o objeto que o cliente deixou (ex.: celular, relógio, documento) */
  @IsOptional() @IsString() @MaxLength(200) penhoraItem?: string;
  /** penhora: nome ou telefone para contato (opcional) */
  @IsOptional() @IsString() @MaxLength(120) penhoraContato?: string;
  /** faturado: cliente (empresa/convênio) que vai pagar depois */
  @IsOptional() @IsUUID() clienteFaturadoId?: string;
  /** pix / débito / crédito: código do comprovante (NSU, autorização ou ID do Pix) */
  @IsOptional() @IsString() @MaxLength(60) comprovante?: string;
  @IsOptional() @IsString() @MaxLength(40) maquininha?: string;
  @IsOptional() @IsInt() @Min(1) @Max(24) parcelas?: number;
}

export class NotaFiscalDto {
  /** o cliente quer nota? (a recepção sempre pergunta) */
  @IsBoolean() emitir!: boolean;
  /** CPF (11) ou CNPJ (14), só números; vazio = consumidor não identificado */
  @IsOptional() @IsString() @MaxLength(18) documento?: string;
  @IsOptional() @IsString() @MaxLength(120) nome?: string;
  @IsOptional() @IsEmail() @MaxLength(160) email?: string;
}

/** quem paga cada parte da conta (para as notas saírem separadas) */
export class PagadorDto {
  @IsIn(['empresa', 'hospede']) tipo!: 'empresa' | 'hospede';
  /** empresa: hospedagem, consumo ou tudo; o hóspede fica com o resto */
  @IsIn(['hospedagem', 'consumo', 'tudo', 'resto']) parte!: 'hospedagem' | 'consumo' | 'tudo' | 'resto';
  @IsOptional() @IsString() @MaxLength(120) nome?: string;
  /** CPF ou CNPJ (só números) */
  @IsOptional() @IsString() @MaxLength(18) documento?: string;
}

export class FecharEstadiaDto {
  /** pagamentos que somam o total (pode dividir em várias formas) */
  @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => PagamentoDto) pagamentos!: PagamentoDto[];
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) desconto?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) acrescimo?: number;
  @IsOptional() @IsString() @MaxLength(300) motivo?: string;
  /** login e senha de quem libera quando passa do limite do perfil */
  @IsOptional() @ValidateNested() @Type(() => AutorizacaoDto) autorizacao?: AutorizacaoDto;
  /** cortesia cadastrada (o desconto sai da regra dela) */
  @IsOptional() @IsUUID() cortesiaId?: string;
  /** hotel (com cadastro do hóspede): dados para a nota. No motel não vai. */
  @IsOptional() @ValidateNested() @Type(() => NotaFiscalDto) nota?: NotaFiscalDto;
  /** conta dividida entre pagadores (empresa × hóspede): uma nota para cada parte */
  @IsOptional() @IsArray() @ArrayMaxSize(2) @ValidateNested({ each: true }) @Type(() => PagadorDto) pagadores?: PagadorDto[];
}

export class CancelarEstadiaDto {
  /** login e senha de quem libera, quando o perfil não tem a permissão */
  @IsOptional() @ValidateNested() @Type(() => AutorizacaoDto) autorizacao?: AutorizacaoDto;
  @IsString() @MinLength(3) @MaxLength(300) motivo!: string;
  @IsOptional() @IsIn(['livre', 'limpeza']) destino?: 'livre' | 'limpeza';
}

export class AtualizarEstadiaDto {
  @IsOptional() @IsString() @MaxLength(10) placa?: string;
  @IsOptional() @IsInt() @Min(1) @Max(20) pessoas?: number;
  @IsOptional() @IsString() @MaxLength(500) observacao?: string;
}

export class LancarItemDto {
  @IsOptional() @IsUUID() produtoId?: string;
  /** item avulso, sem cadastro */
  @IsOptional() @IsString() @MaxLength(120) descricao?: string;
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) @Max(1000) quantidade!: number;
  /** se vazio, usa o preço do cadastro */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1_000_000) precoUnitario?: number;
}

export class EstornarItemDto {
  /** login e senha de quem libera, quando o perfil não tem a permissão */
  @IsOptional() @ValidateNested() @Type(() => AutorizacaoDto) autorizacao?: AutorizacaoDto;
  @IsString() @MinLength(3) @MaxLength(300) motivo!: string;
}

export class TransferirDto {
  @IsUUID() unidadeId!: string;
  /** true = mantém o preço da categoria da entrada; false = passa a cobrar pela categoria nova */
  @IsBoolean() manterPreco!: boolean;
  @IsString() @MinLength(3) @MaxLength(300) motivo!: string;
}

export class TrocarCobrancaDto {
  @IsIn(['periodo', 'pernoite']) modalidade!: 'periodo' | 'pernoite';
  /** pacote: período mínimo (só com modalidade "periodo"); vazio = automático */
  @IsOptional() @IsUUID() periodoMinimoId?: string | null;
}

export class CorrigirEstadiaDto {
  /** login e senha de quem libera, quando o perfil não tem a permissão */
  @IsOptional() @ValidateNested() @Type(() => AutorizacaoDto) autorizacao?: AutorizacaoDto;
  @IsOptional() @IsISO8601() entradaEm?: string;
  @IsOptional() @IsUUID() tabelaId?: string;
  @IsString() @MinLength(3) @MaxLength(300) motivo!: string;
}


export class MarcarNotasDto {
  @IsArray() @ArrayMaxSize(500) @IsUUID('4', { each: true }) ids!: string[];
  /** número da nota (opcional; em lote costuma ficar vazio) */
  @IsOptional() @IsString() @MaxLength(30) numero?: string;
}

export class DesfazerNotaDto {
  @IsString() @MinLength(3) @MaxLength(300) motivo!: string;
}

export class MudarFormaDto {
  @IsIn(['dinheiro', 'pix', 'debito', 'credito']) forma!: 'dinheiro' | 'pix' | 'debito' | 'credito';
  @IsString() @MinLength(3) @MaxLength(300) motivo!: string;
  @IsOptional() @ValidateNested() @Type(() => AutorizacaoDto) autorizacao?: AutorizacaoDto;
}

export class AdiantamentoDto {
  @IsArray() @ArrayMaxSize(5) @ValidateNested({ each: true }) @Type(() => PagamentoDto) pagamentos!: PagamentoDto[];
}

export class RegistrarSaidaDto {
  /** número do uso impresso no ticket de liberação */
  @IsInt() @Min(1) numero!: number;
  /** suíte informada no ticket (conferência opcional) */
  @IsOptional() @IsString() @MaxLength(20) unidade?: string;
  /** portão de qual ambiente (hotel e motel têm saídas separadas) */
  @IsOptional() @IsUUID() ambienteId?: string;
}
