import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Injectable, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

/**
 * Vender mais na reserva online:
 * - cupom de desconto (código digitado pelo hóspede: % ou R$, validade, limite de usos, mínimo de noites);
 * - pacotes (ex.: "Romântico: decoração + espumante", valor a mais no total, ou "Fique 3 pague 2" com % de desconto);
 * - clube de fidelidade (a cada N hospedagens, X% de desconto na próxima, pelo telefone ou CPF);
 * - reservas abandonadas (o hóspede deixou o telefone e não terminou: a recepção chama no WhatsApp).
 */

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const r2 = (v: number) => Math.round(v * 100) / 100;
const dia = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);
const so = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const linhas = <T,>(r: unknown): T[] => (Array.isArray(r) && Array.isArray(r[0]) ? r[0] : (r as T[]));

export interface Fidelidade { ativo?: boolean; aCada?: number; descontoPct?: number }

class PromocaoDto {
  @IsIn(['cupom', 'pacote']) tipo!: 'cupom' | 'pacote';
  @IsString() @MinLength(2) @MaxLength(80) nome!: string;
  /** cupom: o código que o hóspede digita */
  @IsOptional() @IsString() @MaxLength(30) codigo?: string;
  @IsOptional() @IsString() @MaxLength(400) descricao?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(90) descontoPct?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100000) descontoValor?: number;
  /** pacote: valor a mais no total da reserva (o que vai junto: decoração, jantar…) */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100000) acrescimo?: number;
  @IsOptional() @IsInt() @Min(1) @Max(60) minNoites?: number;
  @IsOptional() @Matches(/^(\d{4}-\d{2}-\d{2})?$/) validoDe?: string;
  @IsOptional() @Matches(/^(\d{4}-\d{2}-\d{2})?$/) validoAte?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100000) limiteUsos?: number;
  @IsOptional() @IsUUID() ambienteId?: string | null;
  @IsOptional() @IsBoolean() ativo?: boolean;
}
class FidelidadeDto {
  @IsBoolean() ativo!: boolean;
  @IsInt() @Min(2) @Max(50) aCada!: number;
  @IsNumber() @Min(1) @Max(80) descontoPct!: number;
}

export interface ResultadoPromo {
  total: number; desconto: number; acrescimo: number; detalhes: string[]; cupomId: string | null; cupomCodigo: string | null; pacoteId: string | null; pacoteNome: string | null;
  fidelidade: { hospedagens: number; ganhou: boolean } | null;
}

/** aplica pacote, cupom e fidelidade no total da reserva (o desconto do cupom e da fidelidade vale sobre as diárias + pacote) */
export async function aplicarPromocoes(ds: { query: (sql: string, params?: unknown[]) => Promise<any> }, p: {
  empresaId: string; ambienteId: string; total: number; noites: number; chegada: string; cupom?: string | null; pacoteId?: string | null; telefone?: string | null; documento?: string | null;
}): Promise<ResultadoPromo> {
  const res: ResultadoPromo = { total: p.total, desconto: 0, acrescimo: 0, detalhes: [], cupomId: null, cupomCodigo: null, pacoteId: null, pacoteNome: null, fidelidade: null };
  const valida = (x: Record<string, unknown>) => {
    if (!x.ativo) return 'não está mais valendo';
    if (x.ambiente_id && x.ambiente_id !== p.ambienteId) return 'não vale para este hotel';
    if (dia(x.valido_de) && p.chegada < dia(x.valido_de)!) return `vale para chegadas a partir de ${dia(x.valido_de)!.split('-').reverse().join('/')}`;
    if (dia(x.valido_ate) && p.chegada > dia(x.valido_ate)!) return 'já venceu';
    if (Number(x.min_noites) > p.noites) return `vale a partir de ${x.min_noites} diárias`;
    if (Number(x.limite_usos) > 0 && Number(x.usos) >= Number(x.limite_usos)) return 'já foi usado o máximo de vezes';
    return null;
  };
  let base = p.total;
  if (p.pacoteId) {
    const [pk] = await ds.query(`SELECT * FROM promocoes_reserva WHERE id = $1 AND empresa_id = $2 AND tipo = 'pacote'`, [p.pacoteId, p.empresaId]);
    if (!pk) throw new BadRequestException('Pacote não encontrado.');
    const erro = valida(pk);
    if (erro) throw new BadRequestException(`O pacote ${pk.nome} ${erro}.`);
    res.acrescimo = r2(Number(pk.acrescimo ?? 0));
    base = r2(base + res.acrescimo);
    const dPk = r2(base * Number(pk.desconto_pct ?? 0) / 100 + Number(pk.desconto_valor ?? 0));
    res.desconto += dPk;
    res.pacoteId = pk.id; res.pacoteNome = pk.nome;
    res.detalhes.push(`Pacote ${pk.nome}${res.acrescimo ? ` (+ R$ ${res.acrescimo.toFixed(2).replace('.', ',')})` : ''}${dPk ? ` (− R$ ${dPk.toFixed(2).replace('.', ',')})` : ''}`);
  }
  const codigo = (p.cupom ?? '').trim().toUpperCase();
  if (codigo) {
    const [c] = await ds.query(`SELECT * FROM promocoes_reserva WHERE empresa_id = $1 AND tipo = 'cupom' AND upper(codigo) = $2`, [p.empresaId, codigo]);
    if (!c) throw new BadRequestException('Cupom não encontrado. Confira o código.');
    const erro = valida(c);
    if (erro) throw new BadRequestException(`Este cupom ${erro}.`);
    const d = r2(base * Number(c.desconto_pct ?? 0) / 100 + Number(c.desconto_valor ?? 0));
    res.desconto += d; res.cupomId = c.id; res.cupomCodigo = codigo;
    res.detalhes.push(`Cupom ${codigo} (− R$ ${d.toFixed(2).replace('.', ',')})`);
  }
  // clube de fidelidade: conta as hospedagens anteriores pelo telefone ou CPF
  const [emp] = await ds.query(`SELECT fidelidade FROM empresas WHERE id = $1`, [p.empresaId]);
  const fid = (emp?.fidelidade ?? {}) as Fidelidade;
  const fone = so(p.telefone), doc = so(p.documento);
  if (fid.ativo && (fid.aCada ?? 0) >= 2 && (fone.length >= 10 || doc.length >= 11)) {
    const [h] = await ds.query(
      `SELECT count(*)::int AS n FROM reservas WHERE empresa_id = $1 AND status = 'hospedada'
          AND ((length($2) >= 10 AND right(regexp_replace(COALESCE(telefone,''), '\\D', '', 'g'), 11) = right($2, 11)) OR (length($3) >= 11 AND regexp_replace(COALESCE(documento,''), '\\D', '', 'g') = $3))`,
      [p.empresaId, fone, doc]);
    const n = Number(h?.n ?? 0);
    const ganhou = (n + 1) % fid.aCada! === 0;
    res.fidelidade = { hospedagens: n, ganhou };
    if (ganhou) {
      const d = r2(base * (fid.descontoPct ?? 0) / 100);
      res.desconto += d;
      res.detalhes.push(`Clube de fidelidade: ${n + 1}ª hospedagem (− R$ ${d.toFixed(2).replace('.', ',')})`);
    }
  }
  res.desconto = r2(Math.min(res.desconto, base));
  res.total = r2(base - res.desconto);
  return res;
}

@Injectable()
export class PromocoesService {
  constructor(private readonly ds: DataSource) {}

  private fmt(x: Record<string, unknown>) {
    return {
      id: x.id, tipo: x.tipo, nome: x.nome, codigo: x.codigo, descricao: x.descricao, descontoPct: Number(x.desconto_pct ?? 0), descontoValor: Number(x.desconto_valor ?? 0),
      acrescimo: Number(x.acrescimo ?? 0), minNoites: Number(x.min_noites ?? 1), validoDe: dia(x.valido_de), validoAte: dia(x.valido_ate), limiteUsos: Number(x.limite_usos ?? 0),
      usos: Number(x.usos ?? 0), ambienteId: x.ambiente_id ?? null, ativo: !!x.ativo,
    };
  }

  async ver(u: UsuarioToken) {
    const promos = await this.ds.query(`SELECT * FROM promocoes_reserva WHERE empresa_id = $1 ORDER BY ativo DESC, tipo, nome`, [u.empresaId]);
    const abandonadas = await this.ds.query(
      `SELECT r.*, c.nome AS categoria, a.nome AS ambiente FROM reservas_rascunhos r LEFT JOIN categorias c ON c.id = r.categoria_id LEFT JOIN ambientes a ON a.id = r.ambiente_id
        WHERE r.empresa_id = $1 AND r.reserva_id IS NULL AND r.atualizado_em > now() - interval '30 days' ORDER BY r.atualizado_em DESC LIMIT 200`, [u.empresaId]);
    const [emp] = await this.ds.query(`SELECT fidelidade FROM empresas WHERE id = $1`, [u.empresaId]);
    const clientes = await this.ds.query(
      `SELECT max(hospede) AS nome, max(telefone) AS telefone, count(*)::int AS hospedagens, sum(valor_total) AS gasto, max(chegada) AS ultima
         FROM reservas WHERE empresa_id = $1 AND status = 'hospedada' AND COALESCE(telefone, '') <> ''
        GROUP BY right(regexp_replace(telefone, '\\D', '', 'g'), 11) HAVING count(*) >= 2 ORDER BY 3 DESC, 4 DESC LIMIT 50`, [u.empresaId]);
    const [rec] = await this.ds.query(
      `SELECT count(*) FILTER (WHERE reserva_id IS NOT NULL)::int AS recuperadas, count(*)::int AS total FROM reservas_rascunhos WHERE empresa_id = $1 AND criado_em > now() - interval '30 days'`, [u.empresaId]);
    return {
      promocoes: promos.map((x: Record<string, unknown>) => this.fmt(x)),
      fidelidade: { ativo: false, aCada: 5, descontoPct: 10, ...((emp?.fidelidade ?? {}) as Fidelidade) },
      abandonadas: abandonadas.map((x: Record<string, unknown>) => ({
        id: x.id, nome: x.nome, telefone: x.telefone, email: x.email, chegada: dia(x.chegada), saida: dia(x.saida), adultos: x.adultos, criancas: x.criancas,
        categoria: x.categoria, ambiente: x.ambiente, total: Number(x.total ?? 0), quando: x.atualizado_em, contatadoEm: x.contatado_em, contatadoPor: x.contatado_por,
      })),
      clientes: clientes.map((x: Record<string, unknown>) => ({ nome: x.nome, telefone: x.telefone, hospedagens: Number(x.hospedagens), gasto: Number(x.gasto ?? 0), ultima: dia(x.ultima) })),
      resumo: { recuperadas: Number(rec?.recuperadas ?? 0), rascunhos: Number(rec?.total ?? 0) },
    };
  }

  async salvar(u: UsuarioToken, dto: PromocaoDto, id?: string) {
    const codigo = dto.tipo === 'cupom' ? (dto.codigo ?? '').trim().toUpperCase().replace(/\s+/g, '') : null;
    if (dto.tipo === 'cupom' && (!codigo || codigo.length < 3)) throw new BadRequestException('O cupom precisa de um código (ex.: VERAO10).');
    if (dto.tipo === 'cupom' && !(dto.descontoPct || dto.descontoValor)) throw new BadRequestException('Coloque o desconto do cupom (% ou R$).');
    if (codigo) {
      const [ja] = await this.ds.query(`SELECT id FROM promocoes_reserva WHERE empresa_id = $1 AND tipo = 'cupom' AND upper(codigo) = $2 AND id <> COALESCE($3::uuid, '00000000-0000-0000-0000-000000000000')`, [u.empresaId, codigo, id ?? null]);
      if (ja) throw new BadRequestException(`Já existe o cupom ${codigo}.`);
    }
    const v = [dto.tipo, dto.nome.trim(), codigo, dto.descricao?.trim() || null, dto.descontoPct ?? 0, dto.descontoValor ?? 0, dto.acrescimo ?? 0, dto.minNoites ?? 1,
      dto.validoDe || null, dto.validoAte || null, dto.limiteUsos ?? 0, dto.ambienteId || null, dto.ativo ?? true];
    if (id) {
      const r = linhas(await this.ds.query(
        `UPDATE promocoes_reserva SET tipo=$3, nome=$4, codigo=$5, descricao=$6, desconto_pct=$7, desconto_valor=$8, acrescimo=$9, min_noites=$10, valido_de=$11, valido_ate=$12, limite_usos=$13, ambiente_id=$14, ativo=$15
          WHERE id = $1 AND empresa_id = $2 RETURNING id`, [id, u.empresaId, ...v]));
      if (!r.length) throw new NotFoundException('Promoção não encontrada.');
      return { ok: true, id };
    }
    const [r] = await this.ds.query(
      `INSERT INTO promocoes_reserva (empresa_id, tipo, nome, codigo, descricao, desconto_pct, desconto_valor, acrescimo, min_noites, valido_de, valido_ate, limite_usos, ambiente_id, ativo, criado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`, [u.empresaId, ...v, u.nome]);
    return { ok: true, id: r.id };
  }

  async desativar(u: UsuarioToken, id: string) {
    await this.ds.query(`UPDATE promocoes_reserva SET ativo = false WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    return { ok: true };
  }

  async salvarFidelidade(u: UsuarioToken, dto: FidelidadeDto) {
    await this.ds.query(`UPDATE empresas SET fidelidade = $2::jsonb WHERE id = $1`, [u.empresaId, JSON.stringify(dto)]);
    return { ok: true };
  }

  async contatado(u: UsuarioToken, id: string) {
    await this.ds.query(`UPDATE reservas_rascunhos SET contatado_em = now(), contatado_por = $3 WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId, u.nome]);
    return { ok: true };
  }
}

@Controller('promocoes')
export class PromocoesController {
  constructor(private readonly service: PromocoesService) {}

  @Get() @Requer('reservas.gerenciar')
  ver(@Usuario() u: UsuarioToken) { return this.service.ver(u); }

  @Post() @Requer('reservas.gerenciar')
  criar(@Usuario() u: UsuarioToken, @Body() dto: PromocaoDto) { return this.service.salvar(u, dto); }

  @Patch(':id') @Requer('reservas.gerenciar')
  editar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PromocaoDto) { return this.service.salvar(u, dto, id); }

  @Delete(':id') @Requer('reservas.gerenciar')
  desativar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.desativar(u, id); }

  @Put('fidelidade') @Requer('reservas.gerenciar')
  fidelidade(@Usuario() u: UsuarioToken, @Body() dto: FidelidadeDto) { return this.service.salvarFidelidade(u, dto); }

  @Post('abandonadas/:id/contatado') @HttpCode(200) @Requer('reservas.gerenciar', 'estadias.operar')
  contatado(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.contatado(u, id); }
}
