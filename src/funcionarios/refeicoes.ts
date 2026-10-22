import { BadRequestException, Body, Controller, Get, HttpCode, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsNumber, IsOptional, IsUUID, Matches, Max, Min, ValidateNested } from 'class-validator';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';
import { baixarConsumo, devolverConsumo } from '../estoque/estoque.core';

/**
 * Refeição dos funcionários: a comida sai do estoque (pela ficha técnica) e fica o custo por funcionário,
 * sem venda e sem mexer no caixa. O relatório mostra quanto cada um custou de alimentação no mês.
 */

export const REFEICOES = { cafe: 'Café da manhã', almoco: 'Almoço', lanche: 'Lanche', jantar: 'Jantar', ceia: 'Ceia (madrugada)' } as const;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const dia = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const r2 = (v: number) => Math.round(v * 100) / 100;

class ItemRefeicaoDto {
  @IsUUID() produtoId!: string;
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) @Max(1000) quantidade!: number;
}
class RefeicaoDto {
  @IsOptional() @IsUUID() ambienteId?: string;
  @IsOptional() @Matches(DATA) data?: string;
  @IsIn(Object.keys(REFEICOES)) refeicao!: keyof typeof REFEICOES;
  /** vários funcionários comem o mesmo prato de uma vez */
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsUUID('4', { each: true }) funcionarioIds!: string[];
  /** o que cada um comeu */
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => ItemRefeicaoDto) itens!: ItemRefeicaoDto[];
}

@Injectable()
export class RefeicoesService {
  constructor(private readonly ds: DataSource) {}

  async funcionarios(u: UsuarioToken) {
    return this.ds.query(`SELECT id, nome, funcao FROM funcionarios WHERE empresa_id = $1 AND ativo ORDER BY nome`, [u.empresaId]);
  }

  /** pratos e produtos para escolher (os do cardápio primeiro) */
  async produtos(u: UsuarioToken) {
    return this.ds.query(
      `SELECT p.id, p.nome, p.grupo, p.unidade, p.custo, (SELECT count(*) FROM produto_insumos pi WHERE pi.produto_id = p.id)::int AS ficha
         FROM produtos p WHERE p.empresa_id = $1 AND p.ativo AND p.tipo = 'produto' AND NOT p.ressarcimento ORDER BY (p.uso = 'venda') DESC, p.grupo NULLS LAST, p.nome`, [u.empresaId]);
  }

  async criar(u: UsuarioToken, dto: RefeicaoDto) {
    const data = dto.data ?? hojeSP();
    if (data > hojeSP()) throw new BadRequestException('A data não pode ser no futuro.');
    const funcs: { id: string; nome: string }[] = await this.ds.query(`SELECT id, nome FROM funcionarios WHERE empresa_id = $1 AND id = ANY($2::uuid[])`, [u.empresaId, dto.funcionarioIds]);
    if (funcs.length !== new Set(dto.funcionarioIds).size) throw new BadRequestException('Funcionário não encontrado.');
    const prods: { id: string; nome: string; custo: string | null }[] = await this.ds.query(
      `SELECT id, nome, custo FROM produtos WHERE empresa_id = $1 AND id = ANY($2::uuid[])`, [u.empresaId, dto.itens.map((i) => i.produtoId)]);
    const pm = new Map(prods.map((p) => [p.id, p]));
    if (dto.itens.some((i) => !pm.has(i.produtoId))) throw new BadRequestException('Produto não encontrado.');
    let total = 0;
    await this.ds.transaction(async (m) => {
      for (const f of funcs) {
        const [r] = await m.query(
          `INSERT INTO refeicoes_funcionarios (empresa_id, ambiente_id, data, refeicao, funcionario_id, funcionario_nome, usuario_nome) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [u.empresaId, dto.ambienteId ?? null, data, dto.refeicao, f.id, f.nome, u.nome]);
        const ref = `refeicao:${r.id}`;
        const itens: { produtoId: string; nome: string; quantidade: number }[] = [];
        for (const i of dto.itens) {
          const p = pm.get(i.produtoId)!;
          await baixarConsumo(m, u.empresaId, dto.ambienteId, i.produtoId, i.quantidade, { referencia: ref, observacao: `Refeição: ${f.nome}`, usuario: u.nome, tipo: 'consumo' });
          itens.push({ produtoId: p.id, nome: p.nome, quantidade: i.quantidade });
        }
        // custo: o que saiu do estoque; produto sem estoque nem ficha usa o custo cadastrado
        const [c] = await m.query(`SELECT COALESCE(sum(-quantidade * custo_unitario), 0) AS custo FROM estoque_movimentos WHERE referencia = $1`, [ref]);
        let custo = Number(c?.custo ?? 0);
        if (custo <= 0) custo = dto.itens.reduce((s, i) => s + Number(pm.get(i.produtoId)!.custo ?? 0) * i.quantidade, 0);
        custo = r2(custo);
        total += custo;
        await m.query(`UPDATE refeicoes_funcionarios SET itens = $2::jsonb, custo = $3 WHERE id = $1`, [r.id, JSON.stringify(itens), custo.toFixed(2)]);
      }
    });
    return { ok: true, refeicoes: funcs.length, custo: r2(total) };
  }

  async listar(u: UsuarioToken, de: string, ate: string) {
    const l = await this.ds.query(`SELECT * FROM refeicoes_funcionarios WHERE empresa_id = $1 AND data BETWEEN $2 AND $3 ORDER BY data DESC, criado_em DESC LIMIT 3000`, [u.empresaId, de, ate]);
    type Linha = { id: string; data: string; refeicao: string; funcionarioId: string; funcionario: string; itens: { nome: string; quantidade: number }[]; custo: number; usuario: string | null; cancelada: boolean };
    const lista: Linha[] = l.map((x: Record<string, unknown>) => ({
      id: x.id as string, data: dia(x.data), refeicao: x.refeicao as string, funcionarioId: x.funcionario_id as string, funcionario: x.funcionario_nome as string,
      itens: x.itens as { nome: string; quantidade: number }[], custo: Number(x.custo), usuario: x.usuario_nome as string | null, cancelada: !!x.cancelada,
    }));
    const validas = lista.filter((x: { cancelada: boolean }) => !x.cancelada);
    const porFunc = new Map<string, { funcionario: string; refeicoes: number; custo: number; porMes: Record<string, number> }>();
    const porMes = new Map<string, { mes: string; refeicoes: number; custo: number }>();
    for (const x of validas) {
      const mes = x.data.slice(0, 7);
      const f = porFunc.get(x.funcionarioId) ?? { funcionario: x.funcionario, refeicoes: 0, custo: 0, porMes: {} as Record<string, number> };
      f.refeicoes++; f.custo = r2(f.custo + x.custo); f.porMes[mes] = r2((f.porMes[mes] ?? 0) + x.custo);
      porFunc.set(x.funcionarioId, f);
      const m = porMes.get(mes) ?? { mes, refeicoes: 0, custo: 0 };
      m.refeicoes++; m.custo = r2(m.custo + x.custo); porMes.set(mes, m);
    }
    return {
      de, ate, refeicoesNomes: REFEICOES, lista,
      total: r2(validas.reduce((s: number, x: { custo: number }) => s + x.custo, 0)),
      porFuncionario: [...porFunc.values()].sort((a, b) => b.custo - a.custo),
      porMes: [...porMes.values()].sort((a, b) => a.mes.localeCompare(b.mes)),
    };
  }

  async cancelar(u: UsuarioToken, id: string) {
    const [r] = await this.ds.query(`SELECT id, cancelada FROM refeicoes_funcionarios WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!r) throw new NotFoundException('Refeição não encontrada.');
    if (r.cancelada) throw new BadRequestException('Já foi cancelada.');
    await this.ds.transaction(async (m) => {
      await devolverConsumo(m, u.empresaId, `refeicao:${id}`, u.nome);
      await m.query(`UPDATE refeicoes_funcionarios SET cancelada = true WHERE id = $1`, [id]);
    });
    return { ok: true };
  }
}

@Controller('refeicoes')
export class RefeicoesController {
  constructor(private readonly service: RefeicoesService) {}

  @Get('funcionarios')
  @Requer('estadias.operar', 'cozinha.ver', 'funcionarios.gerenciar', 'funcionarios.financeiro')
  funcionarios(@Usuario() u: UsuarioToken) {
    return this.service.funcionarios(u);
  }

  @Get('produtos')
  @Requer('estadias.operar', 'cozinha.ver', 'funcionarios.gerenciar')
  produtos(@Usuario() u: UsuarioToken) {
    return this.service.produtos(u);
  }

  @Get()
  @Requer('estadias.operar', 'cozinha.ver', 'funcionarios.gerenciar', 'funcionarios.financeiro', 'relatorios.ver')
  listar(@Usuario() u: UsuarioToken, @Query('de') de?: string, @Query('ate') ate?: string) {
    const a = ate && DATA.test(ate) ? ate : hojeSP();
    const d = de && DATA.test(de) ? de : `${a.slice(0, 7)}-01`;
    return this.service.listar(u, d, a);
  }

  @Post()
  @Requer('estadias.operar', 'cozinha.ver', 'funcionarios.gerenciar')
  criar(@Usuario() u: UsuarioToken, @Body() dto: RefeicaoDto) {
    return this.service.criar(u, dto);
  }

  @Post(':id/cancelar')
  @HttpCode(200)
  @Requer('funcionarios.gerenciar', 'estadias.operar')
  cancelar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.cancelar(u, id);
  }
}
