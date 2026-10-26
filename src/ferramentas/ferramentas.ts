import { BadRequestException, Body, Controller, Delete, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Res, StreamableFile } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { dirname, join, normalize, sep } from 'path';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken, temPermissao } from '../common/permissoes';
import { ComprasModule } from '../compras/compras.module';
import { ComprasService } from '../compras/compras.service';

/**
 * Estoque de ferramentas da manutenção (sem tributação, fora do estoque de produtos):
 * cadastro com foto, quantas tem e quantas estão com alguém, entrega e devolução por responsável (avaria e perda ficam registradas),
 * e pedido de compra: a manutenção pede, compras ou o administrativo pré-aprova e o sistema já abre a cotação.
 */

const TIPOS = { ferramenta: 'Ferramenta', equipamento: 'Equipamento / máquina', medicao: 'Instrumento de medição', consumivel: 'Acessório / consumível (broca, disco, lâmina)' } as const;
const FOTO_MAX = 5_000_000;
const r2 = (v: number) => Math.round(v * 100) / 100;
const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const dia = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);
const linhas = <T,>(r: unknown): T[] => (Array.isArray(r) && Array.isArray(r[0]) ? r[0] : (r as T[]));

class FerramentaDto {
  @IsString() @MinLength(2) @MaxLength(120) nome!: string;
  @IsIn(Object.keys(TIPOS)) tipo!: keyof typeof TIPOS;
  @IsOptional() @IsString() @MaxLength(60) marca?: string;
  @IsOptional() @IsString() @MaxLength(60) modelo?: string;
  @IsOptional() @IsString() @MaxLength(60) numeroSerie?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100000) quantidade?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100000) estoqueMinimo?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(10_000_000) valor?: number | null;
  @IsOptional() @IsString() @MaxLength(80) local?: string;
  @IsOptional() @IsString() @MaxLength(300) observacao?: string;
  /** data:image/jpeg;base64,… (vazio = mantém; "remover" = tira) */
  @IsOptional() @IsString() @MaxLength(7_000_000) foto?: string;
}
class EntregaDto {
  @IsUUID() ferramentaId!: string;
  @IsOptional() @IsUUID() funcionarioId?: string;
  /** quem pegou, se não for funcionário (ex.: terceirizado) */
  @IsOptional() @IsString() @MaxLength(120) responsavel?: string;
  @IsInt() @Min(1) @Max(1000) quantidade!: number;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) previsao?: string;
  @IsOptional() @IsString() @MaxLength(200) paraQue?: string;
}
class DevolucaoDto {
  @IsIn(['ok', 'avariada', 'perdida']) estado!: 'ok' | 'avariada' | 'perdida';
  @IsOptional() @IsString() @MaxLength(300) observacao?: string;
}
class MovimentoDto {
  /** compra = entrou mais · baixa = saiu do estoque (quebrou de vez, descarte) · manutencao = foi consertar · voltou = voltou do conserto */
  @IsIn(['compra', 'baixa', 'manutencao', 'voltou', 'ajuste']) tipo!: string;
  @IsInt() @Min(-100000) @Max(100000) quantidade!: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) valor?: number;
  @IsOptional() @IsString() @MaxLength(300) motivo?: string;
}
class PedidoDto {
  @IsOptional() @IsUUID() ferramentaId?: string;
  @IsString() @MinLength(2) @MaxLength(200) descricao!: string;
  @IsInt() @Min(1) @Max(10000) quantidade!: number;
  @IsOptional() @IsString() @MaxLength(300) motivo?: string;
  @IsOptional() @IsBoolean() urgente?: boolean;
}
class DecisaoDto {
  @IsIn(['aprovar', 'recusar']) decisao!: 'aprovar' | 'recusar';
  @IsOptional() @IsString() @MaxLength(300) motivo?: string;
}

@Injectable()
export class FerramentasService {
  constructor(private readonly ds: DataSource, private readonly compras: ComprasService) {}

  private pasta() {
    const p = (process.env.VB_FOTOS_DIR || '').trim();
    if (!p) throw new BadRequestException('A pasta de arquivos não está configurada neste servidor (VB_FOTOS_DIR). Fale com a Virtual Barra.');
    return normalize(p);
  }
  private caminho(rel: string) {
    const base = this.pasta();
    const abs = normalize(join(base, rel));
    if (!abs.startsWith(base.endsWith(sep) ? base : base + sep)) throw new NotFoundException('Foto não encontrada.');
    return abs;
  }
  private async gravarFoto(empresaId: string, dataUrl: string) {
    const m = /^data:(image\/jpeg|image\/png);base64,/.exec(dataUrl);
    if (!m) throw new BadRequestException('A foto tem que ser JPG ou PNG.');
    const bin = Buffer.from(dataUrl.slice(m[0].length), 'base64');
    if (!bin.length || bin.length > FOTO_MAX) throw new BadRequestException('Foto vazia ou grande demais (máximo 5 MB).');
    const rel = join(empresaId, 'ferramentas', `${randomUUID()}.${m[1] === 'image/png' ? 'png' : 'jpg'}`);
    await fs.mkdir(dirname(this.caminho(rel)), { recursive: true });
    await fs.writeFile(this.caminho(rel), bin);
    return rel;
  }

  async listar(u: UsuarioToken, todas = false) {
    const hoje = hojeSP();
    const fs_: Record<string, unknown>[] = await this.ds.query(`SELECT * FROM ferramentas WHERE empresa_id = $1 ${todas ? '' : 'AND ativo'} ORDER BY nome`, [u.empresaId]);
    const fora: { ferramenta_id: string; qtd: string }[] = await this.ds.query(
      `SELECT ferramenta_id, sum(quantidade) AS qtd FROM ferramenta_entregas WHERE empresa_id = $1 AND devolvida_em IS NULL GROUP BY 1`, [u.empresaId]);
    const conserto: { ferramenta_id: string; qtd: string }[] = await this.ds.query(
      `SELECT ferramenta_id, sum(CASE WHEN tipo = 'manutencao' THEN quantidade WHEN tipo = 'voltou' THEN -quantidade ELSE 0 END) AS qtd FROM ferramenta_movimentos WHERE empresa_id = $1 GROUP BY 1`, [u.empresaId]);
    const abertas: Record<string, unknown>[] = await this.ds.query(
      `SELECT e.*, f.nome AS ferramenta, f.codigo FROM ferramenta_entregas e JOIN ferramentas f ON f.id = e.ferramenta_id WHERE e.empresa_id = $1 AND e.devolvida_em IS NULL ORDER BY e.entregue_em`, [u.empresaId]);
    const mFora = new Map(fora.map((x) => [x.ferramenta_id, Number(x.qtd)]));
    const mConserto = new Map(conserto.map((x) => [x.ferramenta_id, Math.max(0, Number(x.qtd))]));
    const lista = fs_.map((f) => {
      const total = Number(f.quantidade), comAlguem = mFora.get(f.id as string) ?? 0, emConserto = mConserto.get(f.id as string) ?? 0;
      const disponivel = Math.max(0, total - comAlguem - emConserto);
      return {
        id: f.id, codigo: Number(f.codigo), nome: f.nome, tipo: f.tipo, tipoNome: TIPOS[f.tipo as keyof typeof TIPOS] ?? f.tipo, marca: f.marca, modelo: f.modelo, numeroSerie: f.numero_serie,
        quantidade: total, estoqueMinimo: Number(f.estoque_minimo), valor: f.valor === null ? null : Number(f.valor), local: f.local, observacao: f.observacao, temFoto: !!f.foto, ativo: !!f.ativo,
        comAlguem, emConserto, disponivel, abaixoMinimo: Number(f.estoque_minimo) > 0 && total < Number(f.estoque_minimo),
      };
    });
    const entregas = abertas.map((e) => ({
      id: e.id, ferramentaId: e.ferramenta_id, ferramenta: e.ferramenta, codigo: Number(e.codigo), funcionarioId: e.funcionario_id ?? null, responsavel: e.responsavel, quantidade: Number(e.quantidade),
      entregueEm: e.entregue_em, previsao: dia(e.previsao), paraQue: e.para_que, entreguePor: e.entregue_por, atrasada: !!e.previsao && dia(e.previsao)! < hoje,
    }));
    return {
      hoje, tipos: TIPOS, lista, entregas,
      resumo: {
        itens: lista.length, unidades: lista.reduce((s, f) => s + f.quantidade, 0), comAlguem: entregas.reduce((s, e) => s + e.quantidade, 0),
        atrasadas: entregas.filter((e) => e.atrasada).length, abaixoMinimo: lista.filter((f) => f.abaixoMinimo).length,
        valor: r2(lista.reduce((s, f) => s + (f.valor ?? 0) * f.quantidade, 0)),
      },
    };
  }

  async salvar(u: UsuarioToken, dto: FerramentaDto, id?: string) {
    let foto: string | null | undefined;
    if (dto.foto === 'remover') foto = null;
    else if (dto.foto) foto = await this.gravarFoto(u.empresaId, dto.foto);
    const campos = [dto.nome.trim(), dto.tipo, dto.marca?.trim() || null, dto.modelo?.trim() || null, dto.numeroSerie?.trim() || null, dto.estoqueMinimo ?? 0,
      dto.valor ?? null, dto.local?.trim() || null, dto.observacao?.trim() || null];
    if (!id) {
      const [r] = await this.ds.query(
        `INSERT INTO ferramentas (empresa_id, codigo, nome, tipo, marca, modelo, numero_serie, estoque_minimo, valor, local, observacao, quantidade, foto)
         VALUES ($1, (SELECT COALESCE(max(codigo),0)+1 FROM ferramentas WHERE empresa_id = $1), $2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id, codigo`,
        [u.empresaId, ...campos, dto.quantidade ?? 1, foto ?? null]);
      if ((dto.quantidade ?? 1) > 0) {
        await this.ds.query(`INSERT INTO ferramenta_movimentos (empresa_id, ferramenta_id, tipo, quantidade, valor, motivo, usuario_nome) VALUES ($1,$2,'compra',$3,$4,'cadastro',$5)`,
          [u.empresaId, r.id, dto.quantidade ?? 1, dto.valor ?? null, u.nome]);
      }
      return { ok: true, id: r.id, codigo: r.codigo };
    }
    const [atual] = await this.ds.query(`SELECT foto FROM ferramentas WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!atual) throw new NotFoundException('Ferramenta não encontrada.');
    await this.ds.query(
      `UPDATE ferramentas SET nome=$3, tipo=$4, marca=$5, modelo=$6, numero_serie=$7, estoque_minimo=$8, valor=$9, local=$10, observacao=$11 ${foto !== undefined ? ', foto=$12' : ''} WHERE id=$1 AND empresa_id=$2`,
      [id, u.empresaId, ...campos, ...(foto !== undefined ? [foto] : [])]);
    if (foto !== undefined && atual.foto) await fs.rm(this.caminho(atual.foto), { force: true }).catch(() => undefined);
    return { ok: true, id };
  }

  async foto(u: UsuarioToken, id: string) {
    const [f] = await this.ds.query(`SELECT foto FROM ferramentas WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!f?.foto) throw new NotFoundException('Sem foto.');
    try { return { bin: await fs.readFile(this.caminho(f.foto)), mime: String(f.foto).endsWith('.png') ? 'image/png' : 'image/jpeg' }; } catch { throw new NotFoundException('A foto não está mais na pasta do servidor.'); }
  }

  async desativar(u: UsuarioToken, id: string) {
    const [aberta] = await this.ds.query(`SELECT 1 FROM ferramenta_entregas WHERE ferramenta_id = $1 AND devolvida_em IS NULL LIMIT 1`, [id]);
    if (aberta) throw new BadRequestException('Esta ferramenta está com alguém: receba a devolução antes.');
    await this.ds.query(`UPDATE ferramentas SET ativo = false WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    return { ok: true };
  }

  async entregar(u: UsuarioToken, dto: EntregaDto) {
    const est = await this.listar(u);
    const f = est.lista.find((x) => x.id === dto.ferramentaId);
    if (!f) throw new NotFoundException('Ferramenta não encontrada.');
    if (dto.quantidade > f.disponivel) throw new BadRequestException(`Só ${f.disponivel} disponível(is) de ${f.nome}.`);
    let responsavel = dto.responsavel?.trim() || '';
    if (dto.funcionarioId) {
      const [fu] = await this.ds.query(`SELECT nome FROM funcionarios WHERE id = $1 AND empresa_id = $2`, [dto.funcionarioId, u.empresaId]);
      if (!fu) throw new NotFoundException('Funcionário não encontrado.');
      responsavel = fu.nome;
    }
    if (!responsavel) throw new BadRequestException('Escolha o funcionário ou escreva quem pegou.');
    const [r] = await this.ds.query(
      `INSERT INTO ferramenta_entregas (empresa_id, ferramenta_id, funcionario_id, responsavel, quantidade, previsao, para_que, entregue_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [u.empresaId, f.id, dto.funcionarioId ?? null, responsavel, dto.quantidade, dto.previsao || null, dto.paraQue?.trim() || null, u.nome]);
    return { ok: true, id: r.id };
  }

  async devolver(u: UsuarioToken, id: string, dto: DevolucaoDto) {
    const r = linhas<{ ferramenta_id: string; quantidade: number }>(await this.ds.query(
      `UPDATE ferramenta_entregas SET devolvida_em = now(), estado = $3, observacao_devolucao = $4, recebido_por = $5 WHERE id = $1 AND empresa_id = $2 AND devolvida_em IS NULL RETURNING ferramenta_id, quantidade`,
      [id, u.empresaId, dto.estado, dto.observacao?.trim() || null, u.nome]));
    if (!r.length) throw new NotFoundException('Entrega não encontrada (ou já devolvida).');
    // perdida: sai do estoque; avariada: vai para o conserto
    if (dto.estado === 'perdida') {
      await this.ds.query(`UPDATE ferramentas SET quantidade = GREATEST(0, quantidade - $3) WHERE id = $1 AND empresa_id = $2`, [r[0].ferramenta_id, u.empresaId, r[0].quantidade]);
      await this.ds.query(`INSERT INTO ferramenta_movimentos (empresa_id, ferramenta_id, tipo, quantidade, motivo, usuario_nome) VALUES ($1,$2,'perda',$3,$4,$5)`,
        [u.empresaId, r[0].ferramenta_id, r[0].quantidade, dto.observacao?.trim() || 'perdida na devolução', u.nome]);
    } else if (dto.estado === 'avariada') {
      await this.ds.query(`INSERT INTO ferramenta_movimentos (empresa_id, ferramenta_id, tipo, quantidade, motivo, usuario_nome) VALUES ($1,$2,'manutencao',$3,$4,$5)`,
        [u.empresaId, r[0].ferramenta_id, r[0].quantidade, dto.observacao?.trim() || 'voltou avariada', u.nome]);
    }
    return { ok: true };
  }

  async movimentar(u: UsuarioToken, id: string, dto: MovimentoDto) {
    const [f] = await this.ds.query(`SELECT id, quantidade FROM ferramentas WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!f) throw new NotFoundException('Ferramenta não encontrada.');
    const q = Math.abs(dto.quantidade);
    if (!q) throw new BadRequestException('Coloque a quantidade.');
    const delta = dto.tipo === 'compra' ? q : dto.tipo === 'baixa' ? -q : dto.tipo === 'ajuste' ? dto.quantidade : 0;
    if (Number(f.quantidade) + delta < 0) throw new BadRequestException('Ficaria com quantidade negativa.');
    if (delta) await this.ds.query(`UPDATE ferramentas SET quantidade = quantidade + $3 ${dto.tipo === 'compra' && dto.valor ? ', valor = $4' : ''} WHERE id = $1 AND empresa_id = $2`,
      [id, u.empresaId, delta, ...(dto.tipo === 'compra' && dto.valor ? [dto.valor] : [])]);
    await this.ds.query(`INSERT INTO ferramenta_movimentos (empresa_id, ferramenta_id, tipo, quantidade, valor, motivo, usuario_nome) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [u.empresaId, id, dto.tipo, dto.tipo === 'ajuste' ? dto.quantidade : q, dto.valor ?? null, dto.motivo?.trim() || null, u.nome]);
    return { ok: true };
  }

  /** histórico de uma ferramenta: entregas e movimentos */
  async historico(u: UsuarioToken, id: string) {
    const [f] = await this.ds.query(`SELECT id, nome, codigo FROM ferramentas WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!f) throw new NotFoundException('Ferramenta não encontrada.');
    const entregas = await this.ds.query(`SELECT * FROM ferramenta_entregas WHERE ferramenta_id = $1 ORDER BY entregue_em DESC LIMIT 200`, [id]);
    const movs = await this.ds.query(`SELECT * FROM ferramenta_movimentos WHERE ferramenta_id = $1 ORDER BY criado_em DESC LIMIT 200`, [id]);
    return {
      id: f.id, nome: f.nome, codigo: Number(f.codigo),
      entregas: entregas.map((e: Record<string, unknown>) => ({
        id: e.id, responsavel: e.responsavel, quantidade: Number(e.quantidade), entregueEm: e.entregue_em, previsao: dia(e.previsao), paraQue: e.para_que, entreguePor: e.entregue_por,
        devolvidaEm: e.devolvida_em, estado: e.estado, observacao: e.observacao_devolucao, recebidoPor: e.recebido_por,
      })),
      movimentos: movs.map((m: Record<string, unknown>) => ({ tipo: m.tipo, quantidade: Number(m.quantidade), valor: m.valor === null ? null : Number(m.valor), motivo: m.motivo, usuario: m.usuario_nome, em: m.criado_em })),
    };
  }

  /** relatório por responsável: o que está com cada um, atrasos, avarias e perdas */
  async relatorio(u: UsuarioToken, de?: string, ate?: string) {
    const ini = de && /^\d{4}-\d{2}-\d{2}$/.test(de) ? de : `${hojeSP().slice(0, 7)}-01`;
    const fim = ate && /^\d{4}-\d{2}-\d{2}$/.test(ate) ? ate : hojeSP();
    const l: Record<string, unknown>[] = await this.ds.query(
      `SELECT e.responsavel, count(*)::int AS entregas, sum(e.quantidade)::int AS unidades,
              sum(CASE WHEN e.devolvida_em IS NULL THEN e.quantidade ELSE 0 END)::int AS com_ele,
              sum(CASE WHEN e.devolvida_em IS NULL AND e.previsao < $4 THEN 1 ELSE 0 END)::int AS atrasadas,
              sum(CASE WHEN e.estado = 'avariada' THEN e.quantidade ELSE 0 END)::int AS avariadas,
              sum(CASE WHEN e.estado = 'perdida' THEN e.quantidade ELSE 0 END)::int AS perdidas,
              sum(CASE WHEN e.estado IN ('avariada','perdida') THEN e.quantidade * COALESCE(f.valor,0) ELSE 0 END) AS prejuizo
         FROM ferramenta_entregas e JOIN ferramentas f ON f.id = e.ferramenta_id
        WHERE e.empresa_id = $1 AND (e.devolvida_em IS NULL OR (e.entregue_em AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN $2 AND $3)
        GROUP BY 1 ORDER BY 1`, [u.empresaId, ini, fim, hojeSP()]);
    return { de: ini, ate: fim, lista: l.map((x) => ({ ...x, prejuizo: r2(Number(x.prejuizo)) })) };
  }

  async pedidos(u: UsuarioToken) {
    const l: Record<string, unknown>[] = await this.ds.query(
      `SELECT p.*, c.numero AS cotacao_numero FROM ferramenta_pedidos p LEFT JOIN cotacoes c ON c.id = p.cotacao_id WHERE p.empresa_id = $1 ORDER BY (p.status = 'pendente') DESC, p.criado_em DESC LIMIT 200`, [u.empresaId]);
    return {
      podeAprovar: temPermissao(u, 'compras.gerenciar') || temPermissao(u, 'caixa.adm'),
      lista: l.map((p) => ({
        id: p.id, ferramentaId: p.ferramenta_id ?? null, descricao: p.descricao, quantidade: Number(p.quantidade), motivo: p.motivo, urgente: !!p.urgente, status: p.status,
        solicitadoPor: p.solicitado_por, decididoPor: p.decidido_por, decididoEm: p.decidido_em, motivoRecusa: p.motivo_recusa, cotacaoId: p.cotacao_id ?? null,
        cotacaoNumero: p.cotacao_numero === null || p.cotacao_numero === undefined ? null : Number(p.cotacao_numero), criadoEm: p.criado_em,
      })),
    };
  }

  async pedir(u: UsuarioToken, dto: PedidoDto) {
    if (dto.ferramentaId) {
      const [f] = await this.ds.query(`SELECT 1 FROM ferramentas WHERE id = $1 AND empresa_id = $2`, [dto.ferramentaId, u.empresaId]);
      if (!f) throw new NotFoundException('Ferramenta não encontrada.');
    }
    const [r] = await this.ds.query(`INSERT INTO ferramenta_pedidos (empresa_id, ferramenta_id, descricao, quantidade, motivo, urgente, solicitado_por) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [u.empresaId, dto.ferramentaId ?? null, dto.descricao.trim(), dto.quantidade, dto.motivo?.trim() || null, !!dto.urgente, u.nome]);
    return { ok: true, id: r.id };
  }

  /** pré-aprovação de compras/administrativo: aprovado já vira cotação (os aprovados juntos vão na mesma) */
  async decidir(u: UsuarioToken, id: string, dto: DecisaoDto) {
    if (!temPermissao(u, 'compras.gerenciar') && !temPermissao(u, 'caixa.adm')) throw new BadRequestException('Só compras ou o administrativo aprovam pedidos.');
    const [p] = await this.ds.query(`SELECT * FROM ferramenta_pedidos WHERE id = $1 AND empresa_id = $2 AND status = 'pendente'`, [id, u.empresaId]);
    if (!p) throw new NotFoundException('Pedido não encontrado (ou já decidido).');
    if (dto.decisao === 'recusar') {
      if (!dto.motivo?.trim()) throw new BadRequestException('Escreva o motivo da recusa.');
      await this.ds.query(`UPDATE ferramenta_pedidos SET status = 'recusado', decidido_por = $2, decidido_em = now(), motivo_recusa = $3 WHERE id = $1`, [id, u.nome, dto.motivo.trim()]);
      return { ok: true };
    }
    const c = await this.compras.criar(u, {
      titulo: `Ferramentas: ${String(p.descricao).slice(0, 100)}`,
      observacao: [p.urgente ? 'URGENTE' : '', p.motivo ? `Motivo: ${p.motivo}` : '', `Pedido de ${p.solicitado_por ?? '—'}, aprovado por ${u.nome}`].filter(Boolean).join(' · ').slice(0, 500),
      itens: [{ descricao: String(p.descricao), quantidade: Number(p.quantidade), unidade: 'un' }], fornecedores: [],
    });
    await this.ds.query(`UPDATE ferramenta_pedidos SET status = 'cotacao', decidido_por = $2, decidido_em = now(), cotacao_id = $3 WHERE id = $1`, [id, u.nome, c.id]);
    return { ok: true, cotacaoId: c.id, cotacaoNumero: c.numero };
  }

  async cancelarPedido(u: UsuarioToken, id: string) {
    await this.ds.query(`UPDATE ferramenta_pedidos SET status = 'cancelado', decidido_por = $3, decidido_em = now() WHERE id = $1 AND empresa_id = $2 AND status = 'pendente'`, [id, u.empresaId, u.nome]);
    return { ok: true };
  }

  /** para o sino */
  async avisos(empresaId: string) {
    const [a] = await this.ds.query(
      `SELECT (SELECT count(*) FROM ferramenta_entregas WHERE empresa_id = $1 AND devolvida_em IS NULL AND previsao < $2)::int AS atrasadas,
              (SELECT string_agg(DISTINCT responsavel, ', ') FROM ferramenta_entregas WHERE empresa_id = $1 AND devolvida_em IS NULL AND previsao < $2) AS quem,
              (SELECT count(*) FROM ferramenta_pedidos WHERE empresa_id = $1 AND status = 'pendente')::int AS pedidos`, [empresaId, hojeSP()]);
    return { atrasadas: Number(a?.atrasadas ?? 0), quem: (a?.quem as string) ?? '', pedidos: Number(a?.pedidos ?? 0) };
  }
}

const VER = ['ferramentas.gerenciar', 'unidades.bloquear', 'compras.gerenciar', 'caixa.adm'] as const;

@Controller('ferramentas')
export class FerramentasController {
  constructor(private readonly service: FerramentasService) {}

  @Get()
  @Requer(...VER)
  listar(@Usuario() u: UsuarioToken, @Query('todas') todas?: string) {
    return this.service.listar(u, todas === '1');
  }

  @Post()
  @Requer('ferramentas.gerenciar')
  criar(@Usuario() u: UsuarioToken, @Body() dto: FerramentaDto) {
    return this.service.salvar(u, dto);
  }

  @Get('relatorio')
  @Requer(...VER)
  relatorio(@Usuario() u: UsuarioToken, @Query('de') de?: string, @Query('ate') ate?: string) {
    return this.service.relatorio(u, de, ate);
  }

  @Get('pedidos')
  @Requer(...VER)
  pedidos(@Usuario() u: UsuarioToken) {
    return this.service.pedidos(u);
  }

  @Post('pedidos')
  @Requer('ferramentas.gerenciar', 'unidades.bloquear')
  pedir(@Usuario() u: UsuarioToken, @Body() dto: PedidoDto) {
    return this.service.pedir(u, dto);
  }

  @Post('pedidos/:id/decidir')
  @Requer('compras.gerenciar', 'caixa.adm')
  decidir(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisaoDto) {
    return this.service.decidir(u, id, dto);
  }

  @Delete('pedidos/:id')
  @Requer('ferramentas.gerenciar', 'unidades.bloquear')
  cancelarPedido(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.cancelarPedido(u, id);
  }

  @Post('entregas')
  @Requer('ferramentas.gerenciar')
  entregar(@Usuario() u: UsuarioToken, @Body() dto: EntregaDto) {
    return this.service.entregar(u, dto);
  }

  @Post('entregas/:id/devolver')
  @Requer('ferramentas.gerenciar')
  devolver(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DevolucaoDto) {
    return this.service.devolver(u, id, dto);
  }

  @Patch(':id')
  @Requer('ferramentas.gerenciar')
  editar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: FerramentaDto) {
    return this.service.salvar(u, dto, id);
  }

  @Delete(':id')
  @Requer('ferramentas.gerenciar')
  desativar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.desativar(u, id);
  }

  @Post(':id/movimentos')
  @Requer('ferramentas.gerenciar')
  movimentar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MovimentoDto) {
    return this.service.movimentar(u, id, dto);
  }

  @Get(':id/historico')
  @Requer(...VER)
  historico(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.historico(u, id);
  }

  @Get(':id/foto')
  @Requer(...VER)
  async foto(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: { setHeader: (k: string, v: string) => void }) {
    const f = await this.service.foto(u, id);
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Cache-Control', 'private, max-age=300');
    return new StreamableFile(f.bin);
  }
}

@Module({ imports: [ComprasModule], providers: [FerramentasService], controllers: [FerramentasController] })
export class FerramentasModule {}
