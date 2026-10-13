import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

export const AREAS_MANUTENCAO = ['ar-condicionado', 'eletrica', 'informatica-redes', 'cftv', 'telefonia'] as const;

export class ConfigManutencaoDto {
  @IsBoolean() ativo!: boolean;
  @IsOptional() @Matches(/^https:\/\/[^\s]+$/) url?: string;
  /** só ao trocar (fica criptografada) */
  @IsOptional() @IsString() @MaxLength(100) chave?: string;
}

export class ChamadoManutencaoDto {
  @IsIn(AREAS_MANUTENCAO as unknown as string[]) area!: string;
  @IsString() @MinLength(5) @MaxLength(2000) descricao!: string;
  @IsOptional() @IsUUID() unidadeId?: string;
  @IsOptional() @IsString() @MaxLength(120) local?: string;
  @IsOptional() @IsUUID() equipamentoId?: string;
  @IsOptional() @IsString() @MaxLength(150) equipamento?: string;
}
