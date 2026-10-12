import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ResponderAvaliacaoDto {
  @IsOptional() @IsInt() @Min(1) @Max(5) limpeza?: number;
  @IsOptional() @IsInt() @Min(1) @Max(5) atendimento?: number;
  @IsOptional() @IsInt() @Min(1) @Max(5) conforto?: number;
  @IsOptional() @IsInt() @Min(1) @Max(5) consumo?: number;
  /** { idDaPergunta: nota 1..5 } */
  @IsOptional() @IsObject() respostas?: Record<string, number>;
  @IsOptional() @IsBoolean() voltaria?: boolean;
  @IsOptional() @IsString() @MaxLength(1000) comentario?: string;
}

export class PerguntaDto {
  @IsString() @MinLength(1) @MaxLength(30) id!: string;
  @IsString() @MinLength(2) @MaxLength(80) texto!: string;
  @IsBoolean() ativo!: boolean;
}

export class SalvarPerguntasDto {
  @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => PerguntaDto) perguntas!: PerguntaDto[];
}
