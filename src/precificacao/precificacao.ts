import { BadRequestException, Body, Controller, Get, HttpCode, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ArrayMaxSize, IsArray, IsNumber, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

/**
 * Precificação (estrutura do preço de venda): custo + tributos + taxa do cartão + despesas fixas + comissão + lucro.
 * Preço sugerido pelo "markup divisor": preço = custo ÷ (1 − soma dos % sobre a venda).
 * Valor líquido do item (NT 2026.008, campos vUnComLiq/vProdLiq da NF-e/NFC-e): o preço sem os tributos que estão dentro dele.
 * Fica guardado no produto (fiscal.precoLiquido / fiscal.tributosPct) para o emissor da nota usar.
 */

interface Config { tributosPct: number; cartaoPct: number; despesasPct: number; comissaoPct: number; margemPct: number }
const PADRAO: Config = { tributosPct: 6, cartaoPct: 2.5, despesasPct: 15, comissaoPct: 0, margemPct: 20 };
const r2 = (v: number) => Math.round(v * 100) / 100;
const num = (v: unknown) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

class ConfigDto {
  @IsNumber() @Min(0) @Max(60) tributosPct!: number;
  @IsNumber() @Min(0) @Max(20) cartaoPct!: number;
  @IsNumber() @Min(0) @Max(80) despesasPct!: number;
  @IsNumber() @Min(0) @Max(50) comissaoPct!: number;
  @IsNumber() @Min(0) @Max(300) margemPct!: number;
}
class ProdutoPrecoDto {
  @IsOptional() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(1_000_000) custo?: number | null;
  /** lucro só deste produto (vazio = o geral) */
  @IsOptional() @IsNumber() @Min(0) @Max(300) margemPct?: number | null;
  /** tributos só deste produto (vazio = calculado pela regra fiscal ou pelo geral) */
  @IsOptional() @IsNumber() @Min(0) @Max(60) tributosPct?: number | null;
  /** novo preço de venda (com os tributos) */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1_000_000) preco?: number;
}
class AplicarDto {
  @IsArray() @ArrayMaxSize(2000) @IsUUID('4', { each: true }) ids!: string[];
}

/** tributos que estão dentro do preço deste produto, em % da venda */
export function tributosDoProduto(regime: string | null, cfg: Config, tipo: string, fiscal: Record<string, unknown>): { pct: number; origem: string } {
  const prec = (fiscal.precificacao ?? {}) as { tributosPct?: number | null };
  if (prec.tributosPct !== undefined && prec.tributosPct !== null) return { pct: Number(prec.tributosPct), origem: 'deste produto' };
  if (regime === 'normal' || regime === 'presumido' || regime === 'real') {
    const s = (k: string) => num(fiscal[k]) ?? 0;
    const pct = (tipo === 'servico' ? s('aliquotaIss') : s('aliquotaIcms') + s('aliquotaFcp')) + s('aliquotaPis') + s('aliquotaCofins');
    if (pct > 0) return { pct: r2(pct), origem: 'regra fiscal do produto' };
  }
  return { pct: cfg.tributosPct, origem: regime === 'mei' ? 'MEI (geral)' : 'alíquota geral' };
}

export function calcular(custo: number | null, preco: number, tribPct: number, cfg: Config, margemPct: number) {
  const outros = cfg.cartaoPct + cfg.despesasPct + cfg.comissaoPct;
  const divisor = 1 - (tribPct + outros + margemPct) / 100;
  const sugerido = custo !== null && custo > 0 && divisor > 0.05 ? r2(custo / divisor) : null;
  const liquido = r2(preco * (1 - tribPct / 100));
  const tributos = r2(preco - liquido);
  const lucro = custo !== null && preco > 0 ? r2(preco - custo - preco * (tribPct + outros) / 100) : null;
  return {
    sugerido, liquido, tributos, lucro, margemReal: lucro !== null && preco > 0 ? r2((lucro / preco) * 100) : null,
    markup: custo && custo > 0 && sugerido ? r2(sugerido / custo) : null, impossivel: divisor <= 0.05,
  };
}

@Injectable()
export class PrecificacaoService {
  constructor(private readonly ds: DataSource) {}

  private async config(empresaId: string): Promise<{ cfg: Config; regime: string | null; salva: boolean }> {
    const [e] = await this.ds.query(`SELECT precificacao, regime_tributario FROM empresas WHERE id = $1`, [empresaId]);
    const p = (e?.precificacao ?? {}) as Partial<Config>;
    return { cfg: { ...PADRAO, ...p }, regime: e?.regime_tributario ?? null, salva: Object.keys(p).length > 0 };
  }

  /** alíquota efetiva do Simples do último DAS conferido (sugestão para os tributos) */
  private async aliquotaSimples(empresaId: string) {
    const [a] = await this.ds.query(
      `SELECT competencia, dados FROM simples_apuracoes WHERE empresa_id = $1 ORDER BY competencia DESC, criado_em DESC LIMIT 1`, [empresaId]).catch(() => []);
    const d = (a?.dados ?? {}) as { receitaPa?: number; principal?: number; totalDas?: number };
    const das = num(d.principal) ?? num(d.totalDas);
    if (!a || !d.receitaPa || !das) return null;
    return { competencia: a.competencia as string, pct: r2((das / Number(d.receitaPa)) * 100) };
  }

  async ver(u: UsuarioToken) {
    const { cfg, regime, salva } = await this.config(u.empresaId);
    const simples = await this.aliquotaSimples(u.empresaId);
    const l: Record<string, unknown>[] = await this.ds.query(
      `SELECT id, nome, grupo, tipo, preco, custo, fiscal, unidade FROM produtos WHERE empresa_id = $1 AND ativo AND uso = 'venda' ORDER BY grupo NULLS LAST, nome`, [u.empresaId]);
    const produtos = l.map((p) => {
      const fiscal = (p.fiscal ?? {}) as Record<string, unknown>;
      const prec = (fiscal.precificacao ?? {}) as { margemPct?: number | null };
      const t = tributosDoProduto(regime, cfg, p.tipo as string, fiscal);
      const margem = prec.margemPct ?? cfg.margemPct;
      const custo = num(p.custo);
      const preco = Number(p.preco);
      return {
        id: p.id, nome: p.nome, grupo: p.grupo, tipo: p.tipo, unidade: p.unidade, preco, custo, tributosPct: t.pct, tributosOrigem: t.origem,
        margemPct: margem, margemPropria: prec.margemPct !== undefined && prec.margemPct !== null, tributosProprios: t.origem === 'deste produto',
        liquidoGuardado: num(fiscal.precoLiquido), ...calcular(custo, preco, t.pct, cfg, margem),
      };
    });
    return {
      config: cfg, configSalva: salva, regime, simples, produtos,
      resumo: {
        produtos: produtos.length, semCusto: produtos.filter((p) => p.custo === null || p.custo <= 0).length,
        abaixo: produtos.filter((p) => p.sugerido !== null && p.preco + 0.009 < p.sugerido).length,
        prejuizo: produtos.filter((p) => p.lucro !== null && p.lucro < 0).length,
        semLiquido: produtos.filter((p) => p.liquidoGuardado === null || Math.abs(p.liquidoGuardado - p.liquido) > 0.009).length,
      },
    };
  }

  async salvarConfig(u: UsuarioToken, dto: ConfigDto) {
    if (dto.tributosPct + dto.cartaoPct + dto.despesasPct + dto.comissaoPct + dto.margemPct >= 95) throw new BadRequestException('A soma dos percentuais passou de 95%: não tem preço que feche essa conta.');
    await this.ds.query(`UPDATE empresas SET precificacao = $2::jsonb WHERE id = $1`, [u.empresaId, JSON.stringify(dto)]);
    await this.guardarLiquidos(u.empresaId);
    return { ok: true };
  }

  async salvarProduto(u: UsuarioToken, id: string, dto: ProdutoPrecoDto) {
    const [p] = await this.ds.query(`SELECT id, fiscal FROM produtos WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!p) throw new NotFoundException('Produto não encontrado.');
    const fiscal = { ...((p.fiscal ?? {}) as Record<string, unknown>) };
    const prec = { ...((fiscal.precificacao ?? {}) as Record<string, unknown>) };
    if (dto.margemPct !== undefined) prec.margemPct = dto.margemPct;
    if (dto.tributosPct !== undefined) prec.tributosPct = dto.tributosPct;
    fiscal.precificacao = prec;
    await this.ds.query(
      `UPDATE produtos SET fiscal = $3::jsonb ${dto.custo !== undefined ? ', custo = $4' : ''} ${dto.preco !== undefined ? `, preco = $${dto.custo !== undefined ? 5 : 4}` : ''} WHERE id = $1 AND empresa_id = $2`,
      [id, u.empresaId, JSON.stringify(fiscal), ...(dto.custo !== undefined ? [dto.custo] : []), ...(dto.preco !== undefined ? [dto.preco.toFixed(2)] : [])]);
    await this.guardarLiquidos(u.empresaId, [id]);
    return { ok: true };
  }

  /** passa o preço sugerido para os produtos marcados */
  async aplicar(u: UsuarioToken, dto: AplicarDto) {
    const v = await this.ver(u);
    let n = 0;
    for (const p of v.produtos.filter((x) => dto.ids.includes(x.id as string) && x.sugerido !== null)) {
      await this.ds.query(`UPDATE produtos SET preco = $3 WHERE id = $1 AND empresa_id = $2`, [p.id, u.empresaId, p.sugerido!.toFixed(2)]);
      n++;
    }
    await this.guardarLiquidos(u.empresaId);
    return { ok: true, alterados: n };
  }

  /** grava no produto o valor líquido e o % de tributos (para a nota: vUnComLiq) */
  async guardarLiquidos(empresaId: string, ids?: string[]) {
    const { cfg, regime } = await this.config(empresaId);
    const l: Record<string, unknown>[] = await this.ds.query(
      `SELECT id, tipo, preco, fiscal FROM produtos WHERE empresa_id = $1 AND uso = 'venda' ${ids ? 'AND id = ANY($2::uuid[])' : ''}`, ids ? [empresaId, ids] : [empresaId]);
    for (const p of l) {
      const fiscal = (p.fiscal ?? {}) as Record<string, unknown>;
      const t = tributosDoProduto(regime, cfg, p.tipo as string, fiscal);
      const liquido = r2(Number(p.preco) * (1 - t.pct / 100));
      if (num(fiscal.precoLiquido) === liquido && num(fiscal.tributosPct) === t.pct) continue;
      await this.ds.query(`UPDATE produtos SET fiscal = fiscal || $2::jsonb WHERE id = $1`, [p.id, JSON.stringify({ precoLiquido: liquido, tributosPct: t.pct })]);
    }
  }
}

@Controller('precificacao')
export class PrecificacaoController {
  constructor(private readonly service: PrecificacaoService) {}

  @Get() @Requer('produtos.gerenciar', 'relatorios.ver')
  ver(@Usuario() u: UsuarioToken) { return this.service.ver(u); }

  @Put('config') @Requer('produtos.gerenciar')
  config(@Usuario() u: UsuarioToken, @Body() dto: ConfigDto) { return this.service.salvarConfig(u, dto); }

  @Patch('produtos/:id') @Requer('produtos.gerenciar')
  produto(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ProdutoPrecoDto) { return this.service.salvarProduto(u, id, dto); }

  @Post('aplicar') @HttpCode(200) @Requer('produtos.gerenciar')
  aplicar(@Usuario() u: UsuarioToken, @Body() dto: AplicarDto) { return this.service.aplicar(u, dto); }
}

@Module({ providers: [PrecificacaoService], controllers: [PrecificacaoController], exports: [PrecificacaoService] })
export class PrecificacaoModule {}
