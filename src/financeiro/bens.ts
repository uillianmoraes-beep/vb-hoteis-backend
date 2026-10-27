import { BadRequestException, Body, Controller, Delete, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

/**
 * Bens com depreciação: colchões, TVs, ar-condicionado, móveis, equipamentos e reformas.
 * A depreciação é linear: (valor − valor residual) ÷ vida útil, mês a mês, do mês da compra até acabar a vida útil ou a baixa.
 * A DRE usa isto para separar o EBITDA (antes da depreciação) do resultado operacional.
 */

/** [nome, vida útil comum em meses] */
export const CATEGORIAS_BEM: Record<string, [string, number]> = {
  colchao: ['Colchões e camas', 60],
  tv: ['TVs e som', 60],
  ar: ['Ar-condicionado', 120],
  frigobar: ['Frigobar e eletrodomésticos', 120],
  movel: ['Móveis e decoração', 120],
  hidro: ['Hidromassagem, banheira e sauna', 120],
  informatica: ['Computadores e sistema', 60],
  reforma: ['Reformas e benfeitorias', 120],
  veiculo: ['Veículos', 60],
  outro: ['Outros', 60],
};
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const r2 = (n: number) => Math.round(n * 100) / 100;

class BemDto {
  @IsString() @MinLength(2) @MaxLength(120) nome!: string;
  @IsIn(Object.keys(CATEGORIAS_BEM)) categoria!: string;
  @IsOptional() @IsUUID() ambienteId?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(100_000) quantidade?: number;
  /** valor total pago (todas as unidades) */
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(100_000_000) valor!: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) valorResidual?: number;
  @Matches(DATA) dataCompra!: string;
  @IsInt() @Min(1) @Max(600) vidaUtilMeses!: number;
  @IsOptional() @IsString() @MaxLength(300) observacao?: string;
}

class BaixaDto {
  @Matches(DATA) data!: string;
  @IsString() @MinLength(3) @MaxLength(200) motivo!: string;
}

/** mês "AAAA-MM" de uma data */
const mesDe = (d: string) => d.slice(0, 7);
const mesesEntreNum = (a: string, b: string) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));

export interface BemLinha { id: string; nome: string; categoria: string; valor: number; residual: number; compra: string; vida: number; baixa: string | null }

/** quanto o bem deprecia em cada mês pedido (linear, do mês da compra até o fim da vida útil ou a baixa) */
export function depreciacaoDoMes(b: BemLinha, mes: string): number {
  const desde = mesesEntreNum(mesDe(b.compra), mes);
  if (desde < 0 || desde >= b.vida) return 0;
  if (b.baixa && mes > mesDe(b.baixa)) return 0;
  return r2((b.valor - b.residual) / b.vida);
}

@Injectable()
export class BensService {
  constructor(private readonly ds: DataSource) {}

  async linhas(empresaId: string): Promise<BemLinha[]> {
    try {
      const l: Record<string, unknown>[] = await this.ds.query(
        `SELECT id, nome, categoria, valor, valor_residual, to_char(data_compra, 'YYYY-MM-DD') AS compra, vida_util_meses, to_char(baixado_em, 'YYYY-MM-DD') AS baixa
           FROM bens_depreciaveis WHERE empresa_id = $1`, [empresaId]);
      return l.map((b) => ({ id: b.id as string, nome: b.nome as string, categoria: b.categoria as string, valor: Number(b.valor), residual: Number(b.valor_residual),
        compra: b.compra as string, vida: Number(b.vida_util_meses), baixa: (b.baixa as string | null) ?? null }));
    } catch { return []; }
  }

  /** depreciação de cada mês pedido, por categoria (para a DRE) */
  async porMes(empresaId: string, meses: string[]) {
    const bens = await this.linhas(empresaId);
    const porCat = new Map<string, number[]>();
    for (const b of bens) {
      const v = meses.map((m) => depreciacaoDoMes(b, m));
      if (!v.some((x) => x)) continue;
      const a = porCat.get(b.categoria) ?? meses.map(() => 0);
      porCat.set(b.categoria, a.map((x, i) => r2(x + v[i])));
    }
    return [...porCat.entries()].map(([cat, valores]) => ({ categoria: cat, nome: CATEGORIAS_BEM[cat]?.[0] ?? cat, valores }));
  }

  async listar(u: UsuarioToken) {
    const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    const mes = mesDe(hoje);
    const l: Record<string, unknown>[] = await this.ds.query(
      `SELECT b.*, to_char(b.data_compra, 'YYYY-MM-DD') AS compra, to_char(b.baixado_em, 'YYYY-MM-DD') AS baixa, a.nome AS ambiente
         FROM bens_depreciaveis b LEFT JOIN ambientes a ON a.id = b.ambiente_id WHERE b.empresa_id = $1 ORDER BY b.baixado_em NULLS FIRST, b.data_compra DESC`, [u.empresaId]);
    const bens = l.map((b) => {
      const linha: BemLinha = { id: b.id as string, nome: b.nome as string, categoria: b.categoria as string, valor: Number(b.valor), residual: Number(b.valor_residual),
        compra: b.compra as string, vida: Number(b.vida_util_meses), baixa: (b.baixa as string | null) ?? null };
      const usados = Math.max(0, Math.min(linha.vida, mesesEntreNum(mesDe(linha.compra), linha.baixa ? mesDe(linha.baixa) : mes) + 1));
      const porMes = r2((linha.valor - linha.residual) / linha.vida);
      const acumulada = r2(Math.min(linha.valor - linha.residual, porMes * usados));
      return {
        id: b.id, nome: b.nome, categoria: b.categoria, categoriaNome: CATEGORIAS_BEM[b.categoria as string]?.[0] ?? b.categoria, ambienteId: b.ambiente_id, ambiente: b.ambiente,
        quantidade: Number(b.quantidade), valor: linha.valor, valorResidual: linha.residual, dataCompra: linha.compra, vidaUtilMeses: linha.vida,
        baixadoEm: linha.baixa, motivoBaixa: b.motivo_baixa, observacao: b.observacao,
        depreciacaoMes: depreciacaoDoMes(linha, mes), porMes, acumulada, valorAtual: r2(linha.valor - acumulada), mesesUsados: usados,
        terminou: usados >= linha.vida,
      };
    });
    const ativos = bens.filter((b) => !b.baixadoEm);
    return {
      categorias: Object.fromEntries(Object.entries(CATEGORIAS_BEM).map(([k, [nome, vida]]) => [k, { nome, vida }])),
      bens,
      resumo: {
        quantidade: ativos.length,
        valorCompra: r2(ativos.reduce((s, b) => s + b.valor, 0)),
        valorAtual: r2(ativos.reduce((s, b) => s + b.valorAtual, 0)),
        depreciacaoMes: r2(ativos.reduce((s, b) => s + b.depreciacaoMes, 0)),
        terminando: ativos.filter((b) => !b.terminou && b.vidaUtilMeses - b.mesesUsados <= 6).length,
      },
    };
  }

  async criar(u: UsuarioToken, dto: BemDto) {
    if ((dto.valorResidual ?? 0) >= dto.valor) throw new BadRequestException('O valor residual precisa ser menor que o valor do bem.');
    await this.ds.query(
      `INSERT INTO bens_depreciaveis (empresa_id, ambiente_id, nome, categoria, quantidade, valor, valor_residual, data_compra, vida_util_meses, observacao, criado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [u.empresaId, dto.ambienteId || null, dto.nome.trim(), dto.categoria, dto.quantidade ?? 1, dto.valor, dto.valorResidual ?? 0, dto.dataCompra, dto.vidaUtilMeses, dto.observacao?.trim() || null, u.nome]);
    return this.listar(u);
  }

  async editar(u: UsuarioToken, id: string, dto: BemDto) {
    if ((dto.valorResidual ?? 0) >= dto.valor) throw new BadRequestException('O valor residual precisa ser menor que o valor do bem.');
    const [linhas] = await this.ds.query(
      `UPDATE bens_depreciaveis SET ambiente_id = $3, nome = $4, categoria = $5, quantidade = $6, valor = $7, valor_residual = $8, data_compra = $9, vida_util_meses = $10, observacao = $11
        WHERE id = $1 AND empresa_id = $2 RETURNING id`,
      [id, u.empresaId, dto.ambienteId || null, dto.nome.trim(), dto.categoria, dto.quantidade ?? 1, dto.valor, dto.valorResidual ?? 0, dto.dataCompra, dto.vidaUtilMeses, dto.observacao?.trim() || null]);
    if (!linhas?.length) throw new NotFoundException('Bem não encontrado.');
    return this.listar(u);
  }

  /** baixa: o bem foi vendido, quebrou ou foi descartado (a depreciação para no mês da baixa) */
  async baixar(u: UsuarioToken, id: string, dto: BaixaDto) {
    const [linhas] = await this.ds.query(`UPDATE bens_depreciaveis SET baixado_em = $3, motivo_baixa = $4 WHERE id = $1 AND empresa_id = $2 RETURNING id`, [id, u.empresaId, dto.data, dto.motivo.trim()]);
    if (!linhas?.length) throw new NotFoundException('Bem não encontrado.');
    return this.listar(u);
  }

  async apagar(u: UsuarioToken, id: string) {
    await this.ds.query(`DELETE FROM bens_depreciaveis WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    return this.listar(u);
  }
}

@Controller('bens')
export class BensController {
  constructor(private readonly service: BensService) {}

  @Get()
  @Requer('relatorios.ver', 'caixa.adm', 'despesas.gerenciar')
  listar(@Usuario() u: UsuarioToken) { return this.service.listar(u); }

  @Post()
  @Requer('caixa.adm', 'despesas.gerenciar')
  criar(@Usuario() u: UsuarioToken, @Body() dto: BemDto) { return this.service.criar(u, dto); }

  @Patch(':id')
  @Requer('caixa.adm', 'despesas.gerenciar')
  editar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BemDto) { return this.service.editar(u, id, dto); }

  @Post(':id/baixa')
  @Requer('caixa.adm', 'despesas.gerenciar')
  baixar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BaixaDto) { return this.service.baixar(u, id, dto); }

  @Delete(':id')
  @Requer('caixa.adm', 'despesas.gerenciar')
  apagar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.apagar(u, id); }
}
