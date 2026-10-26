import { BadRequestException, Body, Controller, Get, HttpCode, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

/**
 * Grupos e eventos:
 * - grupo (caravana, romaria, time, empresa): pessoas, ônibus, motoristas e guias, refeições por dia, quartos separados
 *   (vira uma reserva por quarto, com a lista de quem dorme em cada um) e cobrança no faturamento;
 * - evento (salão, festa, reunião, day use): orçamento com itens, agenda do espaço sem conflito, sinal e faturamento.
 */

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const r2 = (v: number) => Math.round(v * 100) / 100;
const dia = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);
const noites = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
const somaDias = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const linhas = <T,>(r: unknown): T[] => (Array.isArray(r) && Array.isArray(r[0]) ? r[0] : (r as T[]));
const STATUS = ['orcamento', 'confirmado', 'realizado', 'cancelado'] as const;

class QuartoGrupoDto {
  @IsUUID() unidadeId!: string;
  /** quem dorme no quarto (rooming list) */
  @IsOptional() @IsString() @MaxLength(400) nomes?: string;
}
class GrupoDto {
  @IsString() @MinLength(2) @MaxLength(120) nome!: string;
  @IsIn(['caravana', 'romaria', 'empresa', 'esporte', 'escola', 'outro']) tipo!: string;
  @IsOptional() @IsUUID() ambienteId?: string;
  @IsOptional() @IsString() @MaxLength(120) responsavel?: string;
  @IsOptional() @IsString() @MaxLength(30) telefone?: string;
  @IsOptional() @IsUUID() clienteFaturadoId?: string | null;
  @Matches(DATA) chegada!: string;
  @Matches(DATA) saida!: string;
  @IsInt() @Min(1) @Max(2000) pessoas!: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) onibus?: number;
  @IsOptional() @IsInt() @Min(0) @Max(200) motoristas?: number;
  @IsOptional() @IsInt() @Min(0) @Max(200) guias?: number;
  @IsOptional() @IsBoolean() cafe?: boolean;
  @IsOptional() @IsBoolean() almoco?: boolean;
  @IsOptional() @IsBoolean() jantar?: boolean;
  /** valor por pessoa por noite (com as refeições combinadas) */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100000) valorPessoaNoite?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(10_000_000) desconto?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(300) @ValidateNested({ each: true }) @Type(() => QuartoGrupoDto) quartos?: QuartoGrupoDto[];
  @IsOptional() @IsString() @MaxLength(800) observacao?: string;
}
class ItemEventoDto {
  @IsString() @MinLength(1) @MaxLength(120) descricao!: string;
  @IsNumber() @Min(0) @Max(100000) quantidade!: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1_000_000) valor!: number;
}
class EventoDto {
  @IsString() @MinLength(2) @MaxLength(120) nome!: string;
  @IsIn(['festa', 'casamento', 'reuniao', 'curso', 'day_use', 'confraternizacao', 'outro']) tipo!: string;
  @IsString() @MinLength(1) @MaxLength(80) espaco!: string;
  @Matches(DATA) data!: string;
  @IsOptional() @Matches(HORA) inicio?: string;
  @IsOptional() @Matches(HORA) fim?: string;
  @IsInt() @Min(1) @Max(5000) pessoas!: number;
  @IsString() @MinLength(2) @MaxLength(120) cliente!: string;
  @IsOptional() @IsString() @MaxLength(30) telefone?: string;
  @IsOptional() @IsUUID() clienteFaturadoId?: string | null;
  @IsArray() @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => ItemEventoDto) itens!: ItemEventoDto[];
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(10_000_000) desconto?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(10_000_000) sinal?: number;
  @IsOptional() @IsString() @MaxLength(800) observacao?: string;
}
class StatusDto {
  @IsIn(STATUS as unknown as string[]) status!: (typeof STATUS)[number];
}
class FaturarDto {
  @Matches(DATA) vencimento!: string;
}

@Injectable()
export class EventosService {
  constructor(private readonly ds: DataSource) {}

  /* ---------------- grupos ---------------- */

  private totalGrupo(g: { chegada: string; saida: string; pessoas: number; valorPessoaNoite: number; desconto: number }) {
    return r2(Math.max(0, g.pessoas * noites(g.chegada, g.saida) * g.valorPessoaNoite - g.desconto));
  }

  async grupos(u: UsuarioToken, de?: string) {
    const desde = de && DATA.test(de) ? de : somaDias(hojeSP(), -30);
    const l = await this.ds.query(
      `SELECT g.*, c.nome AS cliente_nome, (SELECT count(*) FROM reservas r WHERE r.grupo_hosp_id = g.id AND r.status <> 'cancelada')::int AS reservas
         FROM grupos_hospedagem g LEFT JOIN clientes_faturados c ON c.id = g.cliente_faturado_id
        WHERE g.empresa_id = $1 AND g.saida >= $2 ORDER BY g.chegada, g.nome`, [u.empresaId, desde]);
    return l.map((g: Record<string, unknown>) => this.fmtGrupo(g));
  }

  private fmtGrupo(g: Record<string, unknown>) {
    const chegada = dia(g.chegada)!, saida = dia(g.saida)!;
    const base = { chegada, saida, pessoas: Number(g.pessoas), valorPessoaNoite: Number(g.valor_pessoa_noite ?? 0), desconto: Number(g.desconto ?? 0) };
    return {
      id: g.id, nome: g.nome, tipo: g.tipo, ambienteId: g.ambiente_id, responsavel: g.responsavel, telefone: g.telefone, clienteFaturadoId: g.cliente_faturado_id ?? null,
      cliente: g.cliente_nome ?? null, ...base, noites: noites(chegada, saida), onibus: Number(g.onibus ?? 0), motoristas: Number(g.motoristas ?? 0), guias: Number(g.guias ?? 0),
      cafe: !!g.cafe, almoco: !!g.almoco, jantar: !!g.jantar, quartos: (g.quartos ?? []) as { unidadeId: string; nomes?: string }[], observacao: g.observacao, status: g.status,
      total: this.totalGrupo(base), faturado: !!g.faturado_em, reservas: Number(g.reservas ?? 0),
    };
  }

  async salvarGrupo(u: UsuarioToken, dto: GrupoDto, id?: string) {
    if (dto.saida <= dto.chegada) throw new BadRequestException('A saída tem que ser depois da chegada.');
    const quartos = [...new Map((dto.quartos ?? []).map((q) => [q.unidadeId, { unidadeId: q.unidadeId, nomes: q.nomes?.trim() || undefined }])).values()];
    if (quartos.length) {
      const ok = await this.ds.query(`SELECT count(*)::int AS n FROM unidades WHERE empresa_id = $1 AND id = ANY($2::uuid[])`, [u.empresaId, quartos.map((q) => q.unidadeId)]);
      if (Number(ok[0]?.n) !== quartos.length) throw new BadRequestException('Algum quarto não foi encontrado.');
    }
    const v = [dto.nome.trim(), dto.tipo, dto.ambienteId ?? null, dto.responsavel?.trim() || null, dto.telefone?.trim() || null, dto.clienteFaturadoId || null, dto.chegada, dto.saida,
      dto.pessoas, dto.onibus ?? 0, dto.motoristas ?? 0, dto.guias ?? 0, !!dto.cafe, !!dto.almoco, !!dto.jantar, dto.valorPessoaNoite ?? 0, dto.desconto ?? 0, JSON.stringify(quartos), dto.observacao?.trim() || null];
    if (id) {
      const r = linhas(await this.ds.query(
        `UPDATE grupos_hospedagem SET nome=$3, tipo=$4, ambiente_id=$5, responsavel=$6, telefone=$7, cliente_faturado_id=$8, chegada=$9, saida=$10, pessoas=$11, onibus=$12, motoristas=$13, guias=$14,
           cafe=$15, almoco=$16, jantar=$17, valor_pessoa_noite=$18, desconto=$19, quartos=$20::jsonb, observacao=$21, atualizado_em=now() WHERE id=$1 AND empresa_id=$2 RETURNING status`, [id, u.empresaId, ...v]));
      if (!r.length) throw new NotFoundException('Grupo não encontrado.');
      // grupo já confirmado: as reservas acompanham as mudanças
      if ((r[0] as { status: string }).status === 'confirmado') await this.reservasDoGrupo(u, id);
      return { ok: true, id };
    }
    const [g] = await this.ds.query(
      `INSERT INTO grupos_hospedagem (empresa_id, nome, tipo, ambiente_id, responsavel, telefone, cliente_faturado_id, chegada, saida, pessoas, onibus, motoristas, guias, cafe, almoco, jantar,
         valor_pessoa_noite, desconto, quartos, observacao, criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20,$21) RETURNING id`,
      [u.empresaId, ...v, u.nome]);
    return { ok: true, id: g.id };
  }

  /** cria/acerta uma reserva por quarto do grupo (e cancela a dos quartos que saíram) */
  private async reservasDoGrupo(u: UsuarioToken, id: string) {
    const [g] = await this.ds.query(`SELECT * FROM grupos_hospedagem WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!g) throw new NotFoundException('Grupo não encontrado.');
    const quartos = (g.quartos ?? []) as { unidadeId: string; nomes?: string }[];
    if (!quartos.length) throw new BadRequestException('Escolha os quartos do grupo antes de confirmar.');
    const chegada = dia(g.chegada)!, saida = dia(g.saida)!;
    const conflitos = await this.ds.query(
      `SELECT un.codigo, r.hospede FROM reservas r JOIN unidades un ON un.id = r.unidade_id WHERE r.unidade_id = ANY($1::uuid[]) AND r.status IN ('pendente','confirmada','hospedada')
          AND r.chegada < $3 AND r.saida > $2 AND COALESCE(r.grupo_hosp_id::text, '') <> $4`, [quartos.map((q) => q.unidadeId), chegada, saida, id]);
    if (conflitos.length) throw new BadRequestException(`Quarto(s) já reservado(s) nessas datas: ${conflitos.map((c: { codigo: string; hospede: string }) => `${c.codigo} (${c.hospede})`).join(', ')}.`);
    const existentes: { id: string; unidade_id: string; status: string }[] = await this.ds.query(`SELECT id, unidade_id, status FROM reservas WHERE grupo_hosp_id = $1 AND status <> 'cancelada'`, [id]);
    await this.ds.transaction(async (m) => {
      for (const q of quartos) {
        const ja = existentes.find((x) => x.unidade_id === q.unidadeId);
        const hospede = `${g.nome}${q.nomes ? ` · ${q.nomes}` : ''}`.slice(0, 120);
        const obs = [`Grupo ${g.nome} (${g.pessoas} pessoas)`, q.nomes ? `No quarto: ${q.nomes}` : '', g.cliente_faturado_id ? 'Cobrança pelo faturamento do grupo.' : ''].filter(Boolean).join(' · ').slice(0, 500);
        if (ja) {
          if (ja.status !== 'hospedada') await m.query(`UPDATE reservas SET hospede = $2, chegada = $3, saida = $4, observacao = $5, atualizado_em = now() WHERE id = $1`, [ja.id, hospede, chegada, saida, obs]);
          continue;
        }
        const [un] = await m.query(`SELECT ambiente_id FROM unidades WHERE id = $1`, [q.unidadeId]);
        const n = linhas<{ ultima_reserva: number }>(await m.query('UPDATE empresas SET ultima_reserva = ultima_reserva + 1 WHERE id = $1 RETURNING ultima_reserva', [u.empresaId]))[0];
        await m.query(
          `INSERT INTO reservas (empresa_id, numero, unidade_id, ambiente_id, hospede, telefone, chegada, saida, adultos, criancas, valor_diaria, valor_total, sinal, origem, observacao, status, criado_por, grupo_hosp_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,0,0,0,'Grupo',$10,'confirmada',$11,$12)`,
          [u.empresaId, n?.ultima_reserva ?? null, q.unidadeId, un.ambiente_id, hospede, g.telefone, chegada, saida, Math.max(1, (q.nomes ?? '').split(/[,;\n]/).filter((x) => x.trim()).length || 1), obs, u.nome, id]);
      }
      const ficam = new Set(quartos.map((q) => q.unidadeId));
      for (const x of existentes.filter((e) => !ficam.has(e.unidade_id) && e.status !== 'hospedada')) {
        await m.query(`UPDATE reservas SET status = 'cancelada', motivo_cancelamento = 'Quarto tirado do grupo', atualizado_em = now() WHERE id = $1`, [x.id]);
      }
    });
  }

  async statusGrupo(u: UsuarioToken, id: string, status: (typeof STATUS)[number]) {
    if (status === 'confirmado') await this.reservasDoGrupo(u, id);
    if (status === 'cancelado') {
      await this.ds.query(`UPDATE reservas SET status = 'cancelada', motivo_cancelamento = 'Grupo cancelado', atualizado_em = now() WHERE grupo_hosp_id = $1 AND status IN ('pendente','confirmada')`, [id]);
    }
    await this.ds.query(`UPDATE grupos_hospedagem SET status = $3, atualizado_em = now() WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId, status]);
    return { ok: true };
  }

  /** refeições do dia por grupo (para a cozinha e o café) */
  async refeicoes(u: UsuarioToken, data: string) {
    const d = DATA.test(data) ? data : hojeSP();
    const l = await this.ds.query(
      `SELECT nome, pessoas, motoristas, guias, cafe, almoco, jantar, chegada, saida FROM grupos_hospedagem
        WHERE empresa_id = $1 AND status IN ('confirmado','realizado') AND chegada <= $2 AND saida >= $2 ORDER BY nome`, [u.empresaId, d]);
    return l.map((g: Record<string, unknown>) => {
      const total = Number(g.pessoas) + Number(g.motoristas ?? 0) + Number(g.guias ?? 0);
      const chega = dia(g.chegada) === d, sai = dia(g.saida) === d;
      return { grupo: g.nome, pessoas: total, cafe: g.cafe && !chega ? total : 0, almoco: g.almoco ? total : 0, jantar: g.jantar && !sai ? total : 0 };
    });
  }

  /* ---------------- eventos ---------------- */

  private fmtEvento(e: Record<string, unknown>) {
    const itens = (e.itens ?? []) as { descricao: string; quantidade: number; valor: number }[];
    const bruto = r2(itens.reduce((s, i) => s + i.quantidade * i.valor, 0));
    return {
      id: e.id, nome: e.nome, tipo: e.tipo, espaco: e.espaco, data: dia(e.data), inicio: e.inicio, fim: e.fim, pessoas: Number(e.pessoas), cliente: e.cliente, telefone: e.telefone,
      clienteFaturadoId: e.cliente_faturado_id ?? null, clienteFaturado: e.cliente_nome ?? null, itens, bruto, desconto: Number(e.desconto ?? 0),
      total: r2(Math.max(0, bruto - Number(e.desconto ?? 0))), sinal: Number(e.sinal ?? 0), observacao: e.observacao, status: e.status, faturado: !!e.faturado_em,
    };
  }

  async eventos(u: UsuarioToken, de?: string) {
    const desde = de && DATA.test(de) ? de : somaDias(hojeSP(), -30);
    const l = await this.ds.query(
      `SELECT e.*, c.nome AS cliente_nome FROM eventos e LEFT JOIN clientes_faturados c ON c.id = e.cliente_faturado_id WHERE e.empresa_id = $1 AND e.data >= $2 ORDER BY e.data, e.inicio NULLS FIRST`,
      [u.empresaId, desde]);
    return l.map((e: Record<string, unknown>) => this.fmtEvento(e));
  }

  async salvarEvento(u: UsuarioToken, dto: EventoDto, id?: string) {
    if (dto.inicio && dto.fim && dto.fim <= dto.inicio) throw new BadRequestException('O fim tem que ser depois do início.');
    // o mesmo espaço não pode ter dois eventos confirmados no mesmo horário
    const [choque] = await this.ds.query(
      `SELECT nome FROM eventos WHERE empresa_id = $1 AND lower(espaco) = lower($2) AND data = $3 AND status IN ('orcamento','confirmado') AND id <> COALESCE($6::uuid, '00000000-0000-0000-0000-000000000000')
          AND COALESCE(inicio, '00:00') < COALESCE($5, '23:59') AND COALESCE(fim, '23:59') > COALESCE($4, '00:00') LIMIT 1`,
      [u.empresaId, dto.espaco.trim(), dto.data, dto.inicio ?? null, dto.fim ?? null, id ?? null]);
    if (choque) throw new BadRequestException(`O espaço ${dto.espaco} já tem "${choque.nome}" nesse dia e horário.`);
    const v = [dto.nome.trim(), dto.tipo, dto.espaco.trim(), dto.data, dto.inicio ?? null, dto.fim ?? null, dto.pessoas, dto.cliente.trim(), dto.telefone?.trim() || null,
      dto.clienteFaturadoId || null, JSON.stringify(dto.itens.map((i) => ({ descricao: i.descricao.trim(), quantidade: i.quantidade, valor: i.valor }))), dto.desconto ?? 0, dto.sinal ?? 0, dto.observacao?.trim() || null];
    if (id) {
      const r = linhas(await this.ds.query(
        `UPDATE eventos SET nome=$3, tipo=$4, espaco=$5, data=$6, inicio=$7, fim=$8, pessoas=$9, cliente=$10, telefone=$11, cliente_faturado_id=$12, itens=$13::jsonb, desconto=$14, sinal=$15, observacao=$16, atualizado_em=now()
          WHERE id=$1 AND empresa_id=$2 RETURNING id`, [id, u.empresaId, ...v]));
      if (!r.length) throw new NotFoundException('Evento não encontrado.');
      return { ok: true, id };
    }
    const [e] = await this.ds.query(
      `INSERT INTO eventos (empresa_id, nome, tipo, espaco, data, inicio, fim, pessoas, cliente, telefone, cliente_faturado_id, itens, desconto, sinal, observacao, criado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16) RETURNING id`, [u.empresaId, ...v, u.nome]);
    return { ok: true, id: e.id };
  }

  async statusEvento(u: UsuarioToken, id: string, status: (typeof STATUS)[number]) {
    await this.ds.query(`UPDATE eventos SET status = $3, atualizado_em = now() WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId, status]);
    return { ok: true };
  }

  /** lança o total (menos o sinal já recebido) no faturamento do cliente */
  async faturar(u: UsuarioToken, tipo: 'grupo' | 'evento', id: string, vencimento: string) {
    const tabela = tipo === 'grupo' ? 'grupos_hospedagem' : 'eventos';
    const [x] = await this.ds.query(`SELECT * FROM ${tabela} WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!x) throw new NotFoundException('Não encontrado.');
    if (x.faturado_em) throw new BadRequestException('Já foi lançado no faturamento.');
    if (!x.cliente_faturado_id) throw new BadRequestException('Escolha a empresa/cliente do faturamento (quem paga) antes.');
    const f = tipo === 'grupo' ? this.fmtGrupo(x) : this.fmtEvento(x);
    const valor = r2(f.total - (tipo === 'evento' ? Number(x.sinal ?? 0) : 0));
    if (!(valor > 0)) throw new BadRequestException('Não há valor a faturar.');
    const desc = tipo === 'grupo'
      ? `Grupo ${x.nome}: ${x.pessoas} pessoas, ${noites(dia(x.chegada)!, dia(x.saida)!)} noite(s) (${dia(x.chegada)!.split('-').reverse().join('/')} a ${dia(x.saida)!.split('-').reverse().join('/')})`
      : `Evento ${x.nome} (${x.espaco}, ${dia(x.data)!.split('-').reverse().join('/')})${Number(x.sinal) > 0 ? ' · já descontado o sinal' : ''}`;
    await this.ds.transaction(async (m) => {
      await m.query(`INSERT INTO contas_receber (empresa_id, cliente_id, descricao, valor, vencimento, criado_por) VALUES ($1,$2,$3,$4,$5,$6)`,
        [u.empresaId, x.cliente_faturado_id, desc.slice(0, 250), valor.toFixed(2), vencimento, u.nome]);
      await m.query(`UPDATE ${tabela} SET faturado_em = now() WHERE id = $1`, [id]);
    });
    return { ok: true, valor };
  }

  /** quartos de hotel/pousada (para escolher os do grupo) */
  async quartos(u: UsuarioToken) {
    return this.ds.query(
      `SELECT un.id, un.codigo, un.capacidade, c.nome AS categoria, a.nome AS ambiente FROM unidades un JOIN ambientes a ON a.id = un.ambiente_id LEFT JOIN categorias c ON c.id = un.categoria_id
        WHERE un.empresa_id = $1 AND un.ativo AND a.tipo IN ('hotel','pousada') AND un.coletivo IS NULL ORDER BY a.ordem, a.nome, un.ordem, un.codigo`, [u.empresaId]);
  }
}

@Controller('eventos')
export class EventosController {
  constructor(private readonly service: EventosService) {}

  @Get('grupos') @Requer('reservas.gerenciar', 'faturamento.gerenciar')
  grupos(@Usuario() u: UsuarioToken, @Query('de') de?: string) { return this.service.grupos(u, de); }

  @Get('grupos/refeicoes') @Requer('reservas.gerenciar', 'cafe.gerenciar', 'cozinha.ver', 'estadias.operar')
  refeicoes(@Usuario() u: UsuarioToken, @Query('data') data = '') { return this.service.refeicoes(u, data); }

  @Get('quartos') @Requer('reservas.gerenciar')
  quartos(@Usuario() u: UsuarioToken) { return this.service.quartos(u); }

  @Post('grupos') @Requer('reservas.gerenciar')
  criarGrupo(@Usuario() u: UsuarioToken, @Body() dto: GrupoDto) { return this.service.salvarGrupo(u, dto); }

  @Patch('grupos/:id') @Requer('reservas.gerenciar')
  editarGrupo(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: GrupoDto) { return this.service.salvarGrupo(u, dto, id); }

  @Post('grupos/:id/status') @HttpCode(200) @Requer('reservas.gerenciar')
  statusGrupo(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StatusDto) { return this.service.statusGrupo(u, id, dto.status); }

  @Post('grupos/:id/faturar') @HttpCode(200) @Requer('faturamento.gerenciar')
  faturarGrupo(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: FaturarDto) { return this.service.faturar(u, 'grupo', id, dto.vencimento); }

  @Get() @Requer('reservas.gerenciar', 'faturamento.gerenciar')
  eventos(@Usuario() u: UsuarioToken, @Query('de') de?: string) { return this.service.eventos(u, de); }

  @Post() @Requer('reservas.gerenciar')
  criarEvento(@Usuario() u: UsuarioToken, @Body() dto: EventoDto) { return this.service.salvarEvento(u, dto); }

  @Patch(':id') @Requer('reservas.gerenciar')
  editarEvento(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EventoDto) { return this.service.salvarEvento(u, dto, id); }

  @Post(':id/status') @HttpCode(200) @Requer('reservas.gerenciar')
  statusEvento(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StatusDto) { return this.service.statusEvento(u, id, dto.status); }

  @Post(':id/faturar') @HttpCode(200) @Requer('faturamento.gerenciar')
  faturarEvento(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: FaturarDto) { return this.service.faturar(u, 'evento', id, dto.vencimento); }
}

@Module({ providers: [EventosService], controllers: [EventosController] })
export class EventosModule {}
