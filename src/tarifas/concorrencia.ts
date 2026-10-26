import { Body, Controller, Delete, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

/**
 * Preço da concorrência: os hotéis/motéis da região, o preço que cada um cobra (anotado de olho no site, no Booking ou no telefone)
 * e a comparação com o seu preço, por categoria, nos últimos 30 dias.
 * (Robô que lê o Booking sozinho não entra: os sites proíbem.)
 */

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const r2 = (v: number) => Math.round(v * 100) / 100;
const dia = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10));

class ConcorrenteDto {
  @IsString() @MinLength(2) @MaxLength(100) nome!: string;
  @IsOptional() @IsString() @MaxLength(400) link?: string;
  @IsOptional() @IsString() @MaxLength(300) observacao?: string;
}
class PrecoDto {
  @IsUUID() concorrenteId!: string;
  @Matches(DATA) data!: string;
  /** a categoria parecida com a sua (ex.: Standard, Luxo, Suíte com hidro) */
  @IsString() @MinLength(1) @MaxLength(60) categoria!: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(100000) valor!: number;
  /** diária, período de 2h, pernoite… */
  @IsOptional() @IsString() @MaxLength(40) periodo?: string;
  @IsOptional() @IsString() @MaxLength(40) fonte?: string;
}

@Injectable()
export class ConcorrenciaService {
  constructor(private readonly ds: DataSource) {}

  async ver(u: UsuarioToken) {
    const conc = await this.ds.query(`SELECT * FROM concorrentes WHERE empresa_id = $1 AND ativo ORDER BY nome`, [u.empresaId]);
    const precos = await this.ds.query(
      `SELECT p.*, c.nome AS concorrente FROM concorrencia_precos p JOIN concorrentes c ON c.id = p.concorrente_id
        WHERE p.empresa_id = $1 AND p.data >= $2::date - 60 ORDER BY p.data DESC, c.nome LIMIT 500`, [u.empresaId, hojeSP()]);
    // o seu preço: diárias da reserva online por categoria
    const ambs = await this.ds.query(`SELECT reserva_online FROM ambientes WHERE empresa_id = $1 AND ativo`, [u.empresaId]);
    const cats = await this.ds.query(`SELECT id, nome FROM categorias WHERE empresa_id = $1`, [u.empresaId]);
    const nossos: { categoria: string; valor: number }[] = [];
    for (const a of ambs) {
      for (const [id, c] of Object.entries(((a.reserva_online ?? {}).categorias ?? {}) as Record<string, { ativo: boolean; diaria: number }>)) {
        const nome = cats.find((x: { id: string }) => x.id === id)?.nome;
        if (nome && c.ativo && c.diaria > 0) nossos.push({ categoria: nome, valor: c.diaria });
      }
    }
    const recentes = (precos as Record<string, unknown>[]).filter((p) => dia(p.data) >= new Date(Date.parse(`${hojeSP()}T12:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10));
    const porCat = new Map<string, number[]>();
    for (const p of recentes) {
      const k = String(p.categoria).trim().toLowerCase();
      porCat.set(k, [...(porCat.get(k) ?? []), Number(p.valor)]);
    }
    const resumo = [...porCat.entries()].map(([k, v]) => {
      const nosso = nossos.find((n) => n.categoria.trim().toLowerCase() === k);
      const media = r2(v.reduce((s, x) => s + x, 0) / v.length);
      return { categoria: String(recentes.find((p) => String(p.categoria).trim().toLowerCase() === k)?.categoria ?? k), media, minimo: Math.min(...v), maximo: Math.max(...v), anotacoes: v.length,
        nosso: nosso?.valor ?? null, diferencaPct: nosso ? r2(((nosso.valor - media) / media) * 100) : null };
    }).sort((a, b) => a.categoria.localeCompare(b.categoria));
    return {
      concorrentes: conc.map((c: Record<string, unknown>) => ({ id: c.id, nome: c.nome, link: c.link, observacao: c.observacao })),
      precos: precos.map((p: Record<string, unknown>) => ({ id: p.id, concorrenteId: p.concorrente_id, concorrente: p.concorrente, data: dia(p.data), categoria: p.categoria, valor: Number(p.valor), periodo: p.periodo, fonte: p.fonte, por: p.criado_por })),
      nossos, resumo,
    };
  }

  async concorrente(u: UsuarioToken, dto: ConcorrenteDto) {
    const link = dto.link?.trim() || null;
    const [c] = await this.ds.query(`INSERT INTO concorrentes (empresa_id, nome, link, observacao) VALUES ($1,$2,$3,$4) RETURNING id`,
      [u.empresaId, dto.nome.trim(), link && /^https?:\/\//.test(link) ? link : link ? `https://${link}` : null, dto.observacao?.trim() || null]);
    return { ok: true, id: c.id };
  }

  async tirar(u: UsuarioToken, id: string) {
    await this.ds.query(`UPDATE concorrentes SET ativo = false WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    return { ok: true };
  }

  async preco(u: UsuarioToken, dto: PrecoDto) {
    const [c] = await this.ds.query(`SELECT id FROM concorrentes WHERE id = $1 AND empresa_id = $2`, [dto.concorrenteId, u.empresaId]);
    if (!c) throw new NotFoundException('Concorrente não encontrado.');
    await this.ds.query(`INSERT INTO concorrencia_precos (empresa_id, concorrente_id, data, categoria, valor, periodo, fonte, criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [u.empresaId, dto.concorrenteId, dto.data, dto.categoria.trim(), dto.valor.toFixed(2), dto.periodo?.trim() || null, dto.fonte?.trim() || null, u.nome]);
    return { ok: true };
  }

  async apagarPreco(u: UsuarioToken, id: string) {
    await this.ds.query(`DELETE FROM concorrencia_precos WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    return { ok: true };
  }
}

@Controller('concorrencia')
export class ConcorrenciaController {
  constructor(private readonly service: ConcorrenciaService) {}

  @Get() @Requer('tarifas.gerenciar', 'relatorios.ver', 'reservas.gerenciar')
  ver(@Usuario() u: UsuarioToken) { return this.service.ver(u); }

  @Post('concorrentes') @Requer('tarifas.gerenciar', 'reservas.gerenciar')
  concorrente(@Usuario() u: UsuarioToken, @Body() dto: ConcorrenteDto) { return this.service.concorrente(u, dto); }

  @Delete('concorrentes/:id') @Requer('tarifas.gerenciar', 'reservas.gerenciar')
  tirar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.tirar(u, id); }

  @Post('precos') @Requer('tarifas.gerenciar', 'reservas.gerenciar', 'estadias.operar')
  preco(@Usuario() u: UsuarioToken, @Body() dto: PrecoDto) { return this.service.preco(u, dto); }

  @Delete('precos/:id') @Requer('tarifas.gerenciar', 'reservas.gerenciar')
  apagar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.apagarPreco(u, id); }
}

@Module({ providers: [ConcorrenciaService], controllers: [ConcorrenciaController] })
export class ConcorrenciaModule {}
