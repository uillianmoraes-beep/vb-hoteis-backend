import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class NovaSugestaoDto {
  @IsIn(['melhoria', 'problema', 'duvida']) tipo!: 'melhoria' | 'problema' | 'duvida';
  @IsOptional() @IsString() @MaxLength(40) area?: string;
  @IsOptional() @IsString() @MaxLength(120) tela?: string;
  @IsString() @MinLength(5) @MaxLength(1000) texto!: string;
}

export class ResponderSugestaoDto {
  @IsIn(['nova', 'avaliando', 'vou_fazer', 'feito', 'ja_existe', 'nao_vale']) status!: string;
  @IsOptional() @IsString() @MaxLength(600) resposta?: string;
}
