import { BadRequestException, Body, Controller, Get, Module, Put } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { IsIn, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

/**
 * Fundo da tela inicial da empresa (vale para todos os computadores): a foto do estabelecimento (real ou em "desenho"),
 * a cor e o véu. Cada computador ainda pode escolher um fundo só seu em Aparência.
 */

const IMG = /^data:image\/(jpeg|png|webp);base64,/;

class FundoDto {
  @IsOptional() @IsString() @MaxLength(3_000_000) imagem?: string | null;
  /** a foto original (para trocar entre real e desenho sem mandar de novo) */
  @IsOptional() @IsString() @MaxLength(3_000_000) original?: string | null;
  @IsOptional() @Matches(/^#[0-9a-fA-F]{6}$/) cor?: string | null;
  @IsNumber() @Min(0) @Max(0.95) veu!: number;
  @IsIn(['real', 'desenho']) efeito!: 'real' | 'desenho';
}

@Controller('empresa/fundo')
export class FundoController {
  constructor(private readonly ds: DataSource) {}

  @Get()
  async ver(@Usuario() u: UsuarioToken) {
    const [e] = await this.ds.query(`SELECT fundo_painel FROM empresas WHERE id = $1`, [u.empresaId]);
    return { fundo: e?.fundo_painel ?? null };
  }

  @Put() @Requer('empresa.editar')
  async salvar(@Usuario() u: UsuarioToken, @Body() dto: FundoDto | null) {
    if (dto && ((dto.imagem && !IMG.test(dto.imagem)) || (dto.original && !IMG.test(dto.original)))) throw new BadRequestException('Imagem inválida.');
    const valor = dto && (dto.imagem || dto.cor) ? { imagem: dto.imagem ?? null, original: dto.original ?? null, cor: dto.cor ?? null, veu: dto.veu, efeito: dto.efeito } : null;
    await this.ds.query(`UPDATE empresas SET fundo_painel = $2::jsonb WHERE id = $1`, [u.empresaId, valor ? JSON.stringify(valor) : null]);
    return { ok: true };
  }
}

@Module({ controllers: [FundoController] })
export class FundoModule {}
