import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class ResponderAvaliacaoDto {
  @IsOptional() @IsInt() @Min(1) @Max(5) limpeza?: number;
  @IsOptional() @IsInt() @Min(1) @Max(5) atendimento?: number;
  @IsOptional() @IsInt() @Min(1) @Max(5) conforto?: number;
  @IsOptional() @IsInt() @Min(1) @Max(5) consumo?: number;
  @IsOptional() @IsBoolean() voltaria?: boolean;
  @IsOptional() @IsString() @MaxLength(1000) comentario?: string;
}
