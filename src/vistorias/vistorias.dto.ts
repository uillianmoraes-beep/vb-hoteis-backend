import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import { ORIGENS_FOTO, OrigemFoto } from './fotos.service';
import { AREAS_MANUTENCAO } from '../manutencao/manutencao.dto';

const DATA = /^\d{4}-\d{2}-\d{2}$/;

export class FotoDto {
  @IsIn(ORIGENS_FOTO as unknown as string[]) origem!: OrigemFoto;
  @IsOptional() @IsString() @MaxLength(60) local?: string;
  /** data:image/jpeg;base64,... (já reduzida no celular) */
  @IsString() @MaxLength(3_400_000) @Matches(/^data:image\/jpeg;base64,/) imagem!: string;
  @IsOptional() @IsString() @MaxLength(200_000) @Matches(/^data:image\/jpeg;base64,/) miniatura?: string;
}

/** Cadastros de cada ambiente: o que conferir e de onde tirar as fotos (tudo editável). */
export class ConfigVistoriaDto {
  @IsArray() @ArrayMaxSize(60) @IsString({ each: true }) @MaxLength(120, { each: true }) checklist!: string[];
  @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) @MaxLength(60, { each: true }) fotos!: string[];
  /** avisa quando a unidade livre fica este tanto de dias sem vistoria (0 = não avisa) */
  @IsInt() @Min(0) @Max(365) diasSemVistoria!: number;
  /** avisa quando a validade do frigobar estiver a menos destes dias */
  @IsInt() @Min(0) @Max(180) validadeAvisoDias!: number;
  /** prazo de guarda das fotos (vale para a empresa toda) */
  @IsOptional() @IsInt() @Min(7) @Max(3650) fotosDias?: number;
}

export class ItemChecklistDto {
  @IsString() @MaxLength(120) item!: string;
  @IsBoolean() ok!: boolean;
}

export class FotoLocalDto {
  @IsString() @MaxLength(60) local!: string;
  @IsUUID() fotoId!: string;
}

export class ReposicaoDto {
  @IsUUID() produtoId!: string;
  @IsNumber() @Min(0) @Max(999) quantidade!: number;
}

export class ChamadoDto {
  @IsIn(AREAS_MANUTENCAO as unknown as string[]) area!: string;
  @IsOptional() @IsString() @MaxLength(2000) descricao?: string;
}

export class VistoriaDto {
  @IsUUID() unidadeId!: string;
  @IsOptional() @IsUUID() camareiraId?: string;
  @IsOptional() @IsString() @MaxLength(120) camareiraNome?: string;
  @IsArray() @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => ItemChecklistDto) itens!: ItemChecklistDto[];
  @IsArray() @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => FotoLocalDto) fotos!: FotoLocalDto[];
  @IsArray() @ArrayMaxSize(80) @ValidateNested({ each: true }) @Type(() => ReposicaoDto) reposicao!: ReposicaoDto[];
  @IsOptional() @Matches(DATA) frigobarValidade?: string;
  @IsIn(['aprovado', 'ressalva', 'reprovado']) resultado!: 'aprovado' | 'ressalva' | 'reprovado';
  @IsOptional() @IsString() @MaxLength(2000) avaria?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(4) @IsUUID('4', { each: true }) avariaFotoIds?: string[];
  /** abre chamado no app de manutenção (só se a empresa contratou) */
  @IsOptional() @ValidateNested() @Type(() => ChamadoDto) chamado?: ChamadoDto;
  @IsOptional() @IsString() @MaxLength(1000) observacao?: string;
}

/** Reprovada: o adm decide se a unidade volta para a limpeza ou vai para a manutenção. */
export class DecisaoDto {
  @IsIn(['limpeza', 'manutencao']) destino!: 'limpeza' | 'manutencao';
  @IsOptional() @IsUUID() motivoBloqueioId?: string;
  @IsOptional() @ValidateNested() @Type(() => ChamadoDto) chamado?: ChamadoDto;
  @IsOptional() @IsString() @MaxLength(300) observacao?: string;
}

/* ---------- piscinas e hidros ---------- */

export class AguaLocalDto {
  @IsString() @MinLength(2) @MaxLength(80) nome!: string;
  @IsIn(['piscina', 'hidro', 'ofuro', 'spa', 'outro']) tipo!: string;
  @IsOptional() @IsUUID() ambienteId?: string | null;
  /** hidro de uma suíte */
  @IsOptional() @IsUUID() unidadeId?: string | null;
  @IsNumber() @Min(0) @Max(14) phMin!: number;
  @IsNumber() @Min(0) @Max(14) phMax!: number;
  @IsNumber() @Min(0) @Max(50) cloroMin!: number;
  @IsNumber() @Min(0) @Max(50) cloroMax!: number;
  @IsOptional() @IsBoolean() ativo?: boolean;
}

export class ProdutoUsadoDto {
  @IsUUID() produtoId!: string;
  @IsNumber() @Min(0.001) @Max(10000) quantidade!: number;
}

export class AguaRegistroDto {
  @IsUUID() localId!: string;
  @IsOptional() @IsNumber() @Min(0) @Max(14) ph?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(50) cloro?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(5000) alcalinidade?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(60) temperatura?: number;
  /** ex.: "Aspirou", "Limpou o filtro", "Trocou a água" */
  @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(80, { each: true }) acoes!: string[];
  @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => ProdutoUsadoDto) produtos!: ProdutoUsadoDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(4) @IsUUID('4', { each: true }) fotoIds?: string[];
  @IsOptional() @IsString() @MaxLength(1000) observacao?: string;
}
