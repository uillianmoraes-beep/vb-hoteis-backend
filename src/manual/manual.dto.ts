import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsNumber, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';

/** bolinha numerada do print: posição em % da imagem */
export class MarcaPrintDto {
  @IsNumber() @Min(0) @Max(100) x!: number;
  @IsNumber() @Min(0) @Max(100) y!: number;
  @IsString() @MaxLength(200) texto!: string;
}

export class PrintManualDto {
  @IsString() @MaxLength(80) legenda!: string;
  /** data:image/jpeg;base64,... (print da tela tirado pelo navegador) */
  @IsString() @MaxLength(3_000_000) @Matches(/^data:image\/jpeg;base64,/) imagem!: string;
  @IsArray() @ArrayMaxSize(15) @ValidateNested({ each: true }) @Type(() => MarcaPrintDto) marcas!: MarcaPrintDto[];
}
