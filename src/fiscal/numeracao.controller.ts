import { Body, Controller, Get, Put } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsString, Matches, Max, Min, ValidateNested } from 'class-validator';
import { DataSource } from 'typeorm';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

class SerieDto {
  @IsInt() @Min(0) @Max(999) serie!: number;
  @IsInt() @Min(1) @Max(999_999_999) proximo!: number;
}

class NumeracaoDto {
  /** "principal" ou o CNPJ (só números) */
  @IsString() @Matches(/^(principal|\d{14})$/) cnpj!: string;
  @IsIn(['nfce', 'nfe']) documento!: 'nfce' | 'nfe';
  @ValidateNested() @Type(() => SerieDto) dados!: SerieDto;
}

/** Série e próximo número das notas (NF-e e NFC-e), por CNPJ. */
@Controller('fiscal/numeracao')
export class NumeracaoController {
  constructor(private readonly ds: DataSource) {}

  @Get()
  @Requer('notas.gerenciar', 'produtos.gerenciar')
  async ler(@Usuario() u: UsuarioToken) {
    const [e] = await this.ds.query(`SELECT numeracao_fiscal FROM empresas WHERE id = $1`, [u.empresaId]);
    return (e?.numeracao_fiscal ?? {}) as Record<string, Record<string, { serie: number; proximo: number }>>;
  }

  @Put()
  @Requer('notas.gerenciar')
  async salvar(@Usuario() u: UsuarioToken, @Body() dto: NumeracaoDto) {
    await this.ds.query(
      `UPDATE empresas SET numeracao_fiscal = jsonb_set(
         CASE WHEN numeracao_fiscal ? $2 THEN numeracao_fiscal ELSE numeracao_fiscal || jsonb_build_object($2::text, '{}'::jsonb) END,
         ARRAY[$2::text, $3::text], $4::jsonb) WHERE id = $1`,
      [u.empresaId, dto.cnpj, dto.documento, JSON.stringify({ serie: dto.dados.serie, proximo: dto.dados.proximo })]);
    return this.ler(u);
  }
}
