import { BadRequestException, Body, Controller, Delete, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

/**
 * Uniformes e EPI (botas, aventais, toucas, luvas…): estoque por peça e tamanho, entrega ao funcionário
 * (grátis, descontada no salário ou vendida na hora), devolução com o estado (bom, gasto, avariado, perdido; avaria pode ser cobrada),
 * tempo de uso e troca prevista, e a ficha de EPI para assinar (NR-6: data, peça, CA e assinatura).
 */

const TIPOS = { uniforme: 'Uniforme', epi: 'EPI (proteção)', calcado: 'Calçado / bota', acessorio: 'Acessório (touca, avental, crachá)' } as const;
const MODOS = { gratis: 'Grátis (da casa)', desconto: 'Descontar no salário', venda: 'Venda paga na hora' } as const;
const ESTADOS = { bom: 'Devolvido bom', gasto: 'Gasto pelo uso (troca)', avariado: 'Avariado', perdido: 'Perdido' } as const;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const r2 = (v: number) => Math.round(v * 100) / 100;
const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const dia = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);
const somaDias = (d: string, k: number) => new Date(Date.parse(`${d}T12:00:00Z`) + k * 86_400_000).toISOString().slice(0, 10);
const difDias = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
const linhas = <T,>(r: unknown): T[] => (Array.isArray(r) && Array.isArray(r[0]) ? r[0] : (r as T[]));

class ItemDto {
  @IsString() @MinLength(2) @MaxLength(100) nome!: string;
  @IsIn(Object.keys(TIPOS)) tipo!: keyof typeof TIPOS;
  @IsOptional() @IsString() @MaxLength(20) tamanho?: string;
  /** Certificado de Aprovação do EPI (obrigatório na ficha de EPI) */
  @IsOptional() @IsString() @MaxLength(20) ca?: string;
  @IsOptional() @Matches(/^(\d{4}-\d{2}-\d{2})?$/) caValidade?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100000) custo?: number | null;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100000) precoVenda?: number | null;
  /** quanto tempo dura (dias) até a troca */
  @IsOptional() @IsInt() @Min(0) @Max(3650) vidaUtilDias?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100000) quantidade?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100000) estoqueMinimo?: number;
  @IsOptional() @IsString() @MaxLength(200) observacao?: string;
}
class EntregaDto {
  @IsUUID() itemId!: string;
  @IsUUID() funcionarioId!: string;
  @IsInt() @Min(1) @Max(100) quantidade!: number;
  @Matches(DATA) data!: string;
  @IsIn(Object.keys(MODOS)) modo!: keyof typeof MODOS;
  /** valor cobrado (desconto ou venda); vazio = preço de venda (ou custo) × quantidade */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100000) valor?: number;
  /** venda paga na hora: como pagou (entra no caixa ADM) */
  @IsOptional() @IsIn(['dinheiro', 'pix', 'debito', 'credito']) forma?: string;
  @IsOptional() @IsString() @MaxLength(200) observacao?: string;
}
class DevolucaoDto {
  @IsIn(Object.keys(ESTADOS)) estado!: keyof typeof ESTADOS;
  @IsOptional() @IsString() @MaxLength(300) motivo?: string;
  /** avariado/perdido por descuido: cobra do funcionário (desconto no salário) */
  @IsOptional() @IsBoolean() cobrar?: boolean;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100000) valorCobrado?: number;
  /** a peça devolvida em bom estado volta para o estoque */
  @IsOptional() @IsBoolean() voltaEstoque?: boolean;
}
class MovDto {
  @IsIn(['compra', 'baixa', 'ajuste']) tipo!: 'compra' | 'baixa' | 'ajuste';
  @IsInt() @Min(-100000) @Max(100000) quantidade!: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) custo?: number;
  @IsOptional() @IsString() @MaxLength(300) motivo?: string;
}

@Injectable()
export class UniformesService {
  constructor(private readonly ds: DataSource) {}

  async listar(u: UsuarioToken) {
    const hoje = hojeSP();
    const itens: Record<string, unknown>[] = await this.ds.query(`SELECT * FROM uniforme_itens WHERE empresa_id = $1 AND ativo ORDER BY tipo, nome, tamanho`, [u.empresaId]);
    const fora: { item_id: string; q: string }[] = await this.ds.query(`SELECT item_id, sum(quantidade) AS q FROM uniforme_entregas WHERE empresa_id = $1 AND devolvido_em IS NULL GROUP BY 1`, [u.empresaId]);
    const mFora = new Map(fora.map((x) => [x.item_id, Number(x.q)]));
    const abertas: Record<string, unknown>[] = await this.ds.query(
      `SELECT e.*, i.nome AS item, i.tamanho, i.tipo, i.ca, f.nome AS funcionario, f.funcao FROM uniforme_entregas e JOIN uniforme_itens i ON i.id = e.item_id JOIN funcionarios f ON f.id = e.funcionario_id
        WHERE e.empresa_id = $1 AND e.devolvido_em IS NULL ORDER BY f.nome, e.data`, [u.empresaId]);
    const lista = itens.map((i) => ({
      id: i.id, nome: i.nome, tipo: i.tipo, tipoNome: TIPOS[i.tipo as keyof typeof TIPOS] ?? i.tipo, tamanho: i.tamanho, ca: i.ca, caValidade: dia(i.ca_validade),
      caVencido: !!i.ca_validade && dia(i.ca_validade)! < hoje, custo: i.custo === null ? null : Number(i.custo), precoVenda: i.preco_venda === null ? null : Number(i.preco_venda),
      vidaUtilDias: Number(i.vida_util_dias), quantidade: Number(i.quantidade), estoqueMinimo: Number(i.estoque_minimo), comFuncionarios: mFora.get(i.id as string) ?? 0,
      abaixoMinimo: Number(i.estoque_minimo) > 0 && Number(i.quantidade) < Number(i.estoque_minimo), observacao: i.observacao,
    }));
    const entregas = abertas.map((e) => {
      const data = dia(e.data)!;
      const troca = dia(e.troca_prevista);
      return {
        id: e.id, itemId: e.item_id, item: e.item, tamanho: e.tamanho, tipo: e.tipo, ca: e.ca, funcionarioId: e.funcionario_id, funcionario: e.funcionario, funcao: e.funcao,
        quantidade: Number(e.quantidade), data, modo: e.modo, valor: Number(e.valor), trocaPrevista: troca, diasDeUso: difDias(data, hoje), trocaVencida: !!troca && troca < hoje,
        entreguePor: e.entregue_por, observacao: e.observacao,
      };
    });
    return {
      hoje, tipos: TIPOS, modos: MODOS, estados: ESTADOS, lista, entregas,
      resumo: {
        pecas: lista.reduce((s, i) => s + i.quantidade, 0), comFuncionarios: entregas.reduce((s, e) => s + e.quantidade, 0), trocasVencidas: entregas.filter((e) => e.trocaVencida).length,
        abaixoMinimo: lista.filter((i) => i.abaixoMinimo).length, caVencido: lista.filter((i) => i.caVencido).length, valorEstoque: r2(lista.reduce((s, i) => s + (i.custo ?? 0) * i.quantidade, 0)),
      },
    };
  }

  async salvarItem(u: UsuarioToken, dto: ItemDto, id?: string) {
    const campos = [dto.nome.trim(), dto.tipo, dto.tamanho?.trim() || null, dto.ca?.trim() || null, dto.caValidade || null, dto.custo ?? null, dto.precoVenda ?? null,
      dto.vidaUtilDias ?? 180, dto.estoqueMinimo ?? 0, dto.observacao?.trim() || null];
    if (id) {
      const r = linhas(await this.ds.query(
        `UPDATE uniforme_itens SET nome=$3, tipo=$4, tamanho=$5, ca=$6, ca_validade=$7, custo=$8, preco_venda=$9, vida_util_dias=$10, estoque_minimo=$11, observacao=$12 WHERE id=$1 AND empresa_id=$2 RETURNING id`,
        [id, u.empresaId, ...campos]));
      if (!r.length) throw new NotFoundException('Peça não encontrada.');
      return { ok: true, id };
    }
    const [r] = await this.ds.query(
      `INSERT INTO uniforme_itens (empresa_id, nome, tipo, tamanho, ca, ca_validade, custo, preco_venda, vida_util_dias, estoque_minimo, observacao, quantidade) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [u.empresaId, ...campos, dto.quantidade ?? 0]);
    if ((dto.quantidade ?? 0) > 0) {
      await this.ds.query(`INSERT INTO uniforme_movimentos (empresa_id, item_id, tipo, quantidade, custo, motivo, usuario_nome) VALUES ($1,$2,'compra',$3,$4,'cadastro',$5)`,
        [u.empresaId, r.id, dto.quantidade, dto.custo ?? null, u.nome]);
    }
    return { ok: true, id: r.id };
  }

  async desativar(u: UsuarioToken, id: string) {
    await this.ds.query(`UPDATE uniforme_itens SET ativo = false WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    return { ok: true };
  }

  async movimentar(u: UsuarioToken, id: string, dto: MovDto) {
    const [i] = await this.ds.query(`SELECT quantidade FROM uniforme_itens WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!i) throw new NotFoundException('Peça não encontrada.');
    const q = Math.abs(dto.quantidade);
    const delta = dto.tipo === 'compra' ? q : dto.tipo === 'baixa' ? -q : dto.quantidade;
    if (!delta) throw new BadRequestException('Coloque a quantidade.');
    if (Number(i.quantidade) + delta < 0) throw new BadRequestException('Ficaria com estoque negativo.');
    await this.ds.query(`UPDATE uniforme_itens SET quantidade = quantidade + $3 ${dto.tipo === 'compra' && dto.custo ? ', custo = $4' : ''} WHERE id = $1 AND empresa_id = $2`,
      [id, u.empresaId, delta, ...(dto.tipo === 'compra' && dto.custo ? [dto.custo] : [])]);
    await this.ds.query(`INSERT INTO uniforme_movimentos (empresa_id, item_id, tipo, quantidade, custo, motivo, usuario_nome) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [u.empresaId, id, dto.tipo, delta, dto.custo ?? null, dto.motivo?.trim() || null, u.nome]);
    return { ok: true };
  }

  async entregar(u: UsuarioToken, dto: EntregaDto) {
    const [i] = await this.ds.query(`SELECT * FROM uniforme_itens WHERE id = $1 AND empresa_id = $2 AND ativo`, [dto.itemId, u.empresaId]);
    if (!i) throw new NotFoundException('Peça não encontrada.');
    if (Number(i.quantidade) < dto.quantidade) throw new BadRequestException(`Só tem ${i.quantidade} no estoque.`);
    const [f] = await this.ds.query(`SELECT id, nome FROM funcionarios WHERE id = $1 AND empresa_id = $2`, [dto.funcionarioId, u.empresaId]);
    if (!f) throw new NotFoundException('Funcionário não encontrado.');
    const unit = Number(i.preco_venda ?? i.custo ?? 0);
    const valor = dto.modo === 'gratis' ? 0 : r2(dto.valor ?? unit * dto.quantidade);
    if (dto.modo === 'venda' && !dto.forma) throw new BadRequestException('Escolha como foi pago.');
    if (dto.modo !== 'gratis' && !(valor > 0)) throw new BadRequestException('Coloque o valor cobrado.');
    const descr = `${i.nome}${i.tamanho ? ` ${i.tamanho}` : ''} × ${dto.quantidade}`;
    const id = await this.ds.transaction(async (m) => {
      const [e] = await m.query(
        `INSERT INTO uniforme_entregas (empresa_id, item_id, funcionario_id, quantidade, data, modo, valor, forma, troca_prevista, observacao, entregue_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [u.empresaId, i.id, f.id, dto.quantidade, dto.data, dto.modo, valor.toFixed(2), dto.forma ?? null, Number(i.vida_util_dias) > 0 ? somaDias(dto.data, Number(i.vida_util_dias)) : null,
          dto.observacao?.trim() || null, u.nome]);
      await m.query(`UPDATE uniforme_itens SET quantidade = quantidade - $2 WHERE id = $1`, [i.id, dto.quantidade]);
      await m.query(`INSERT INTO uniforme_movimentos (empresa_id, item_id, tipo, quantidade, motivo, usuario_nome) VALUES ($1,$2,'entrega',$3,$4,$5)`,
        [u.empresaId, i.id, -dto.quantidade, `para ${f.nome}`, u.nome]);
      // descontar: vai para a ficha financeira (e daí para a conferência do holerite); venda: entra no caixa ADM
      if (dto.modo === 'desconto') {
        await m.query(`INSERT INTO funcionario_lancamentos (empresa_id, funcionario_id, tipo, valor, descricao, data, usuario_nome) VALUES ($1,$2,'desconto',$3,$4,$5,$6)`,
          [u.empresaId, f.id, valor.toFixed(2), `Uniforme/EPI: ${descr}`.slice(0, 300), dto.data, u.nome]);
      } else if (dto.modo === 'venda') {
        await m.query(`INSERT INTO caixa_movimentos (empresa_id, turno_id, caixa, tipo, forma, valor, descricao, usuario_id, usuario_nome) VALUES ($1, NULL, 'adm', 'entrada', $2, $3, $4, $5, $6)`,
          [u.empresaId, dto.forma, valor.toFixed(2), `Venda de uniforme/EPI · ${f.nome} · ${descr}`.slice(0, 200), u.sub, u.nome]);
      }
      return e.id as string;
    });
    return { ok: true, id };
  }

  async devolver(u: UsuarioToken, id: string, dto: DevolucaoDto) {
    const [e] = await this.ds.query(
      `SELECT e.*, i.nome, i.tamanho, i.custo, i.preco_venda FROM uniforme_entregas e JOIN uniforme_itens i ON i.id = e.item_id WHERE e.id = $1 AND e.empresa_id = $2 AND e.devolvido_em IS NULL`, [id, u.empresaId]);
    if (!e) throw new NotFoundException('Entrega não encontrada (ou já devolvida).');
    if ((dto.estado === 'avariado' || dto.estado === 'perdido') && !dto.motivo?.trim()) throw new BadRequestException('Escreva o que aconteceu.');
    const cobrar = !!dto.cobrar && (dto.estado === 'avariado' || dto.estado === 'perdido');
    const valorCobrado = cobrar ? r2(dto.valorCobrado ?? Number(e.custo ?? e.preco_venda ?? 0) * Number(e.quantidade)) : 0;
    if (cobrar && !(valorCobrado > 0)) throw new BadRequestException('Coloque o valor a cobrar.');
    await this.ds.transaction(async (m) => {
      await m.query(`UPDATE uniforme_entregas SET devolvido_em = $3, estado = $4, motivo = $5, valor_cobrado = $6, recebido_por = $7 WHERE id = $1 AND empresa_id = $2`,
        [id, u.empresaId, hojeSP(), dto.estado, dto.motivo?.trim() || null, valorCobrado || null, u.nome]);
      if (dto.estado === 'bom' && dto.voltaEstoque) {
        await m.query(`UPDATE uniforme_itens SET quantidade = quantidade + $2 WHERE id = $1`, [e.item_id, e.quantidade]);
        await m.query(`INSERT INTO uniforme_movimentos (empresa_id, item_id, tipo, quantidade, motivo, usuario_nome) VALUES ($1,$2,'devolucao',$3,'voltou ao estoque',$4)`,
          [u.empresaId, e.item_id, e.quantidade, u.nome]);
      }
      if (cobrar) {
        await m.query(`INSERT INTO funcionario_lancamentos (empresa_id, funcionario_id, tipo, valor, descricao, data, usuario_nome) VALUES ($1,$2,'desconto',$3,$4,$5,$6)`,
          [u.empresaId, e.funcionario_id, valorCobrado.toFixed(2), `${dto.estado === 'perdido' ? 'Perda' : 'Avaria'} de uniforme/EPI: ${e.nome}${e.tamanho ? ` ${e.tamanho}` : ''} · ${dto.motivo?.trim() ?? ''}`.slice(0, 300), hojeSP(), u.nome]);
      }
    });
    return { ok: true, cobrado: valorCobrado };
  }

  /** histórico e ficha de EPI de um funcionário */
  async ficha(u: UsuarioToken, funcionarioId: string) {
    const [f] = await this.ds.query(`SELECT f.id, f.nome, f.funcao, f.documento, f.admissao, c.cargo FROM funcionarios f LEFT JOIN funcionario_contratos c ON c.funcionario_id = f.id WHERE f.id = $1 AND f.empresa_id = $2`,
      [funcionarioId, u.empresaId]);
    if (!f) throw new NotFoundException('Funcionário não encontrado.');
    const [emp] = await this.ds.query(`SELECT nome, cnpj FROM empresas WHERE id = $1`, [u.empresaId]);
    const l: Record<string, unknown>[] = await this.ds.query(
      `SELECT e.*, i.nome AS item, i.tamanho, i.tipo, i.ca FROM uniforme_entregas e JOIN uniforme_itens i ON i.id = e.item_id WHERE e.empresa_id = $1 AND e.funcionario_id = $2 ORDER BY e.data DESC, e.criado_em DESC`,
      [u.empresaId, funcionarioId]);
    const hoje = hojeSP();
    return {
      empresa: emp?.nome ?? '', cnpj: emp?.cnpj ?? null, funcionario: { id: f.id, nome: f.nome, funcao: f.cargo ?? f.funcao, documento: f.documento, admissao: dia(f.admissao) },
      entregas: l.map((e) => {
        const data = dia(e.data)!;
        const fim = dia(e.devolvido_em) ?? hoje;
        return {
          id: e.id, item: e.item, tamanho: e.tamanho, tipo: e.tipo, ca: e.ca, quantidade: Number(e.quantidade), data, modo: e.modo, valor: Number(e.valor), trocaPrevista: dia(e.troca_prevista),
          devolvidoEm: dia(e.devolvido_em), estado: e.estado, motivo: e.motivo, valorCobrado: e.valor_cobrado === null ? null : Number(e.valor_cobrado), diasDeUso: difDias(data, fim), entreguePor: e.entregue_por,
        };
      }),
    };
  }

  /** relatório: tempo de uso por peça, avarias e perdas por funcionário e custo por setor */
  async relatorio(u: UsuarioToken) {
    const porItem: Record<string, unknown>[] = await this.ds.query(
      `SELECT i.nome, i.tamanho, i.vida_util_dias, count(*)::int AS entregas, sum(e.quantidade)::int AS pecas,
              round(avg(COALESCE(e.devolvido_em, CURRENT_DATE) - e.data))::int AS dias_medios,
              sum(CASE WHEN e.estado IN ('avariado','perdido') THEN e.quantidade ELSE 0 END)::int AS avarias
         FROM uniforme_entregas e JOIN uniforme_itens i ON i.id = e.item_id WHERE e.empresa_id = $1 GROUP BY i.id, i.nome, i.tamanho, i.vida_util_dias ORDER BY i.nome`, [u.empresaId]);
    const porFunc: Record<string, unknown>[] = await this.ds.query(
      `SELECT f.nome, f.funcao, count(*)::int AS entregas, sum(CASE WHEN e.devolvido_em IS NULL THEN e.quantidade ELSE 0 END)::int AS com_ele,
              sum(CASE WHEN e.estado = 'avariado' THEN e.quantidade ELSE 0 END)::int AS avariados, sum(CASE WHEN e.estado = 'perdido' THEN e.quantidade ELSE 0 END)::int AS perdidos,
              sum(COALESCE(e.valor_cobrado,0)) AS cobrado, sum(CASE WHEN e.modo = 'gratis' THEN e.quantidade * COALESCE(i.custo,0) ELSE 0 END) AS custo_casa
         FROM uniforme_entregas e JOIN funcionarios f ON f.id = e.funcionario_id JOIN uniforme_itens i ON i.id = e.item_id WHERE e.empresa_id = $1 GROUP BY f.id, f.nome, f.funcao ORDER BY f.nome`, [u.empresaId]);
    const porSetor: Record<string, unknown>[] = await this.ds.query(
      `SELECT f.funcao AS setor, sum(e.quantidade * COALESCE(i.custo,0)) AS custo, sum(e.valor) AS recebido FROM uniforme_entregas e JOIN funcionarios f ON f.id = e.funcionario_id JOIN uniforme_itens i ON i.id = e.item_id
        WHERE e.empresa_id = $1 AND e.data >= CURRENT_DATE - 365 GROUP BY 1 ORDER BY 2 DESC`, [u.empresaId]);
    return {
      porItem: porItem.map((x) => ({ ...x, vida_util_dias: Number(x.vida_util_dias) })),
      porFuncionario: porFunc.map((x) => ({ ...x, cobrado: r2(Number(x.cobrado)), custo_casa: r2(Number(x.custo_casa)) })),
      porSetor: porSetor.map((x) => ({ setor: x.setor, custo: r2(Number(x.custo)), recebido: r2(Number(x.recebido)) })),
    };
  }

  /** para o sino */
  async avisos(empresaId: string) {
    const [a] = await this.ds.query(
      `SELECT (SELECT count(*) FROM uniforme_entregas WHERE empresa_id = $1 AND devolvido_em IS NULL AND troca_prevista < (now() AT TIME ZONE 'America/Sao_Paulo')::date)::int AS trocas,
              (SELECT count(*) FROM uniforme_itens WHERE empresa_id = $1 AND ativo AND estoque_minimo > 0 AND quantidade < estoque_minimo)::int AS minimo,
              (SELECT count(*) FROM uniforme_itens WHERE empresa_id = $1 AND ativo AND ca_validade < (now() AT TIME ZONE 'America/Sao_Paulo')::date)::int AS ca`, [empresaId]);
    return { trocas: Number(a?.trocas ?? 0), minimo: Number(a?.minimo ?? 0), ca: Number(a?.ca ?? 0) };
  }
}

const VER = ['uniformes.gerenciar', 'funcionarios.gerenciar', 'estoque.gerenciar'] as const;

@Controller('uniformes')
export class UniformesController {
  constructor(private readonly service: UniformesService) {}

  @Get() @Requer(...VER) listar(@Usuario() u: UsuarioToken) { return this.service.listar(u); }
  @Get('relatorio') @Requer(...VER) relatorio(@Usuario() u: UsuarioToken) { return this.service.relatorio(u); }
  @Get('ficha/:funcionarioId') @Requer(...VER) ficha(@Usuario() u: UsuarioToken, @Param('funcionarioId', ParseUUIDPipe) id: string) { return this.service.ficha(u, id); }
  @Post() @Requer('uniformes.gerenciar') criar(@Usuario() u: UsuarioToken, @Body() dto: ItemDto) { return this.service.salvarItem(u, dto); }
  @Patch(':id') @Requer('uniformes.gerenciar') editar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ItemDto) { return this.service.salvarItem(u, dto, id); }
  @Delete(':id') @Requer('uniformes.gerenciar') desativar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.desativar(u, id); }
  @Post(':id/movimentos') @Requer('uniformes.gerenciar') mov(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MovDto) { return this.service.movimentar(u, id, dto); }
  @Post('entregas') @Requer('uniformes.gerenciar') entregar(@Usuario() u: UsuarioToken, @Body() dto: EntregaDto) { return this.service.entregar(u, dto); }
  @Post('entregas/:id/devolver') @Requer('uniformes.gerenciar') devolver(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DevolucaoDto) { return this.service.devolver(u, id, dto); }
}

@Module({ providers: [UniformesService], controllers: [UniformesController], exports: [UniformesService] })
export class UniformesModule {}

