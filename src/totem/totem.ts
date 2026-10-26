import { BadRequestException, Body, Controller, Get, HttpCode, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';
import { fichaDaReserva } from '../reservas/reservas.service';

/**
 * Totem de autoatendimento (tablet ou tela na entrada, logado com um usuário de recepção):
 * - motel: o cliente vê as suítes livres (foto, categoria e preço dos períodos) e escolhe; a recepção recebe o chamado
 *   no painel e abre a conta com um toque, sem conversa (mais privacidade);
 * - hotel: o hóspede acha a reserva (código, CPF ou telefone), confere, preenche a ficha com documento e assinatura
 *   e chama a recepção para entregar a chave.
 * O totem não abre conta nem recebe pagamento sozinho: quem confirma é sempre a recepção.
 */

const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const dia = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10));
const linhas = <T,>(r: unknown): T[] => (Array.isArray(r) && Array.isArray(r[0]) ? r[0] : (r as T[]));

class ChamadoDto {
  @IsIn(['entrada', 'checkin', 'ajuda']) tipo!: 'entrada' | 'checkin' | 'ajuda';
  @IsOptional() @IsUUID() unidadeId?: string;
  @IsOptional() @IsUUID() reservaId?: string;
  @IsOptional() @IsString() @MaxLength(200) observacao?: string;
}

@Injectable()
export class TotemService {
  constructor(private readonly ds: DataSource) {}

  /** suítes/quartos livres agora, por categoria, com o preço dos períodos */
  async livres(u: UsuarioToken, ambienteId?: string) {
    const params: unknown[] = [u.empresaId];
    let f = '';
    if (ambienteId && /^[0-9a-f-]{36}$/i.test(ambienteId)) { params.push(ambienteId); f = ` AND un.ambiente_id = $2`; }
    const uns = await this.ds.query(
      `SELECT un.id, un.codigo, un.nome, un.capacidade, un.categoria_id, c.nome AS categoria, c.descricao, c.foto, a.nome AS ambiente, a.tipo AS ambiente_tipo
         FROM unidades un JOIN ambientes a ON a.id = un.ambiente_id LEFT JOIN categorias c ON c.id = un.categoria_id
        WHERE un.empresa_id = $1 AND un.ativo AND un.status = 'livre' AND un.coletivo IS NULL${f} ORDER BY c.ordem NULLS LAST, c.nome, un.ordem, un.codigo`, params);
    const precos = await this.ds.query(
      `SELECT p.categoria_id, per.nome AS periodo, min(p.valor) AS valor, min(per.ordem) AS ordem FROM precos p
         JOIN tabelas_preco t ON t.id = p.tabela_id AND t.ativo JOIN periodos per ON per.id = p.periodo_id AND per.ativo
        WHERE t.empresa_id = $1 AND p.tipo = 'periodo' AND p.valor > 0 GROUP BY p.categoria_id, per.nome ORDER BY 4, 2`, [u.empresaId]).catch(() => []);
    const cats = new Map<string, { id: string; nome: string; descricao: string | null; foto: string | null; precos: { periodo: string; valor: number }[]; unidades: { id: string; codigo: string; nome: string | null; capacidade: number }[] }>();
    for (const x of uns as Record<string, unknown>[]) {
      const k = (x.categoria_id as string) ?? 'sem';
      const c = cats.get(k) ?? {
        id: k, nome: (x.categoria as string) ?? 'Outras', descricao: (x.descricao as string) ?? null, foto: (x.foto as string) ?? null,
        precos: (precos as Record<string, unknown>[]).filter((p) => p.categoria_id === x.categoria_id).slice(0, 4).map((p) => ({ periodo: p.periodo as string, valor: Number(p.valor) })), unidades: [],
      };
      c.unidades.push({ id: x.id as string, codigo: x.codigo as string, nome: (x.nome as string) ?? null, capacidade: Number(x.capacidade ?? 2) });
      cats.set(k, c);
    }
    const [emp] = await this.ds.query(`SELECT nome FROM empresas WHERE id = $1`, [u.empresaId]);
    return { empresa: emp?.nome ?? '', categorias: [...cats.values()] };
  }

  /** hóspede procura a reserva de hoje (código da reserva, CPF ou telefone) */
  async reserva(u: UsuarioToken, busca: string) {
    const t = busca.trim();
    const num = t.replace(/\D/g, '');
    if (t.length < 4) throw new BadRequestException('Digite o código da reserva, o CPF ou o telefone.');
    const hoje = hojeSP();
    const l = await this.ds.query(
      `SELECT r.*, un.codigo AS quarto FROM reservas r JOIN unidades un ON un.id = r.unidade_id
        WHERE r.empresa_id = $1 AND r.status IN ('pendente','confirmada') AND r.chegada BETWEEN $2::date - 1 AND $2::date + 1
          AND (upper(COALESCE(r.codigo_publico,'')) = upper($3) OR (length($4) >= 8 AND (regexp_replace(COALESCE(r.documento,''), '\\D', '', 'g') = $4
               OR right(regexp_replace(COALESCE(r.telefone,''), '\\D', '', 'g'), 9) = right($4, 9))))
        ORDER BY r.chegada LIMIT 3`, [u.empresaId, hoje, t, num]);
    if (!l.length) throw new NotFoundException('Não encontramos reserva para hoje com esses dados. Chame a recepção.');
    const out = [];
    for (const r of l as Record<string, unknown>[]) {
      const ficha = await fichaDaReserva(this.ds, r).catch(() => null);
      out.push({
        id: r.id, numero: r.numero, hospede: String(r.hospede).split(' ')[0], chegada: dia(r.chegada), saida: dia(r.saida), quarto: r.quarto, adultos: r.adultos, criancas: r.criancas,
        total: Number(r.valor_total), sinal: Number(r.sinal), fichaToken: ficha?.token ?? null, fichaPreenchida: ficha?.status === 'preenchida',
      });
    }
    return out;
  }

  async chamar(u: UsuarioToken, dto: ChamadoDto) {
    let texto = 'Cliente pediu ajuda no totem';
    let unidadeId = dto.unidadeId ?? null;
    if (dto.tipo === 'entrada') {
      if (!unidadeId) throw new BadRequestException('Escolha a suíte.');
      const [un] = await this.ds.query(`SELECT codigo, status FROM unidades WHERE id = $1 AND empresa_id = $2`, [unidadeId, u.empresaId]);
      if (!un) throw new NotFoundException('Suíte não encontrada.');
      if (un.status !== 'livre') throw new BadRequestException('Essa suíte acabou de ser ocupada. Escolha outra.');
      const [ja] = await this.ds.query(`SELECT id FROM totem_chamados WHERE unidade_id = $1 AND status = 'novo' AND criado_em > now() - interval '15 minutes'`, [unidadeId]);
      if (ja) throw new BadRequestException('Essa suíte já foi escolhida por outro cliente. Escolha outra.');
      texto = `Cliente escolheu a ${un.codigo} no totem`;
    } else if (dto.tipo === 'checkin') {
      const [r] = await this.ds.query(`SELECT r.numero, r.hospede, r.unidade_id, un.codigo FROM reservas r JOIN unidades un ON un.id = r.unidade_id WHERE r.id = $1 AND r.empresa_id = $2`, [dto.reservaId ?? null, u.empresaId]);
      if (!r) throw new NotFoundException('Reserva não encontrada.');
      unidadeId = r.unidade_id;
      texto = `Check-in no totem: ${r.hospede} · reserva nº ${r.numero ?? '—'} · quarto ${r.codigo}`;
    }
    const [c] = await this.ds.query(
      `INSERT INTO totem_chamados (empresa_id, tipo, unidade_id, reserva_id, texto, observacao) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [u.empresaId, dto.tipo, unidadeId, dto.reservaId ?? null, texto.slice(0, 200), dto.observacao?.trim() || null]);
    return { ok: true, id: c.id };
  }

  /** chamados do totem para a recepção (aparecem no painel) */
  async pendentes(u: UsuarioToken) {
    const l = await this.ds.query(
      `SELECT c.*, un.codigo FROM totem_chamados c LEFT JOIN unidades un ON un.id = c.unidade_id
        WHERE c.empresa_id = $1 AND c.status = 'novo' AND c.criado_em > now() - interval '2 hours' ORDER BY c.criado_em`, [u.empresaId]);
    return l.map((c: Record<string, unknown>) => ({ id: c.id, tipo: c.tipo, unidadeId: c.unidade_id, reservaId: c.reserva_id, unidade: c.codigo, texto: c.texto, observacao: c.observacao, criadoEm: c.criado_em }));
  }

  async atender(u: UsuarioToken, id: string) {
    const r = linhas(await this.ds.query(`UPDATE totem_chamados SET status = 'atendido', atendido_por = $3, atendido_em = now() WHERE id = $1 AND empresa_id = $2 RETURNING id`, [id, u.empresaId, u.nome]));
    if (!r.length) throw new NotFoundException('Chamado não encontrado.');
    return { ok: true };
  }
}

@Controller('totem')
export class TotemController {
  constructor(private readonly service: TotemService) {}

  @Get('livres') @Requer('estadias.entrada', 'estadias.operar', 'painel.ver')
  livres(@Usuario() u: UsuarioToken, @Query('ambienteId') ambienteId?: string) { return this.service.livres(u, ambienteId); }

  @Get('reserva') @Requer('estadias.entrada', 'estadias.operar', 'painel.ver')
  reserva(@Usuario() u: UsuarioToken, @Query('busca') busca = '') { return this.service.reserva(u, String(busca).slice(0, 40)); }

  @Post('chamados') @Requer('estadias.entrada', 'estadias.operar', 'painel.ver')
  chamar(@Usuario() u: UsuarioToken, @Body() dto: ChamadoDto) { return this.service.chamar(u, dto); }

  @Get('chamados') @Requer('painel.ver', 'estadias.operar', 'estadias.entrada')
  pendentes(@Usuario() u: UsuarioToken) { return this.service.pendentes(u); }

  @Post('chamados/:id/atender') @HttpCode(200) @Requer('painel.ver', 'estadias.operar', 'estadias.entrada')
  atender(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.atender(u, id); }
}

@Module({ providers: [TotemService], controllers: [TotemController] })
export class TotemModule {}
