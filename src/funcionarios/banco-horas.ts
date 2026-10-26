import { BadRequestException, Body, Controller, Delete, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';
import { EscalaService } from './escala';

/**
 * Banco de horas e fechamento do mês da escala.
 * No fim do mês o RH decide, por funcionário: as horas extras vão para o PAGAMENTO (holerite) ou para o BANCO;
 * as faltas são DESCONTADAS no salário ou tiradas do banco. A folga de compensação marcada na escala tira horas do banco.
 * O banco gasta primeiro as horas mais antigas; hora que passa do prazo (6 meses pela CLT art. 59 §5º, ou o do acordo) tem que ser paga.
 */

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const COMPETENCIA = /^\d{4}-(0[1-9]|1[0-2])$/;
const DIA = 86_400_000;
const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const dia = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);
const somaDias = (d: string, k: number) => new Date(Date.parse(`${d}T12:00:00Z`) + k * DIA).toISOString().slice(0, 10);
function somaMeses(d: string, k: number) {
  const [a, m, dd] = d.split('-').map(Number);
  const t = a * 12 + (m - 1) + k;
  const ano = Math.floor(t / 12), mes = (t % 12) + 1;
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${ano}-${String(mes).padStart(2, '0')}-${String(Math.min(dd, ultimo)).padStart(2, '0')}`;
}
const ultimoDia = (c: string) => somaDias(somaMeses(`${c}-01`, 1), -1);

class AjusteDto {
  @IsUUID() funcionarioId!: string;
  @Matches(DATA) data!: string;
  /** ajuste = soma ou tira horas (minutos com sinal) · pagamento = horas do banco pagas no holerite (minutos positivos) */
  @IsIn(['ajuste', 'pagamento']) tipo!: 'ajuste' | 'pagamento';
  @IsInt() @Min(-20000) @Max(20000) minutos!: number;
  @IsOptional() @IsString() @MaxLength(300) observacao?: string;
}
class FechamentoItemDto {
  @IsUUID() funcionarioId!: string;
  @IsIn(['pagar', 'banco']) destinoExtras!: 'pagar' | 'banco';
  @IsIn(['descontar', 'banco']) destinoFaltas!: 'descontar' | 'banco';
}
class FechamentoDto {
  @Matches(COMPETENCIA) competencia!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(300) @ValidateNested({ each: true }) @Type(() => FechamentoItemDto) itens!: FechamentoItemDto[];
}
class ConfigBancoDto {
  @IsInt() @Min(1) @Max(12) meses!: number;
}

interface LinhaMes {
  id: string; nome: string; cargo: string; minutosDia: number;
  resumo: { extras: number; faltas: number; atestados: number; noturno: number; feriado: number; semEscala: number; compensa: number; bancoUsado: number; licencas: number };
}
interface Mov { id: string; funcionarioId: string; data: string; minutos: number; tipo: string; referencia: string | null; venceEm: string | null; observacao: string | null; usuario: string | null }

@Injectable()
export class BancoHorasService {
  constructor(private readonly ds: DataSource, private readonly escala: EscalaService) {}

  async meses(empresaId: string) {
    const [c] = await this.ds.query(`SELECT banco_meses FROM rh_config WHERE empresa_id = $1`, [empresaId]);
    return c ? Number(c.banco_meses) : 6;
  }

  async salvarConfig(u: UsuarioToken, dto: ConfigBancoDto) {
    await this.ds.query(`INSERT INTO rh_config (empresa_id, banco_meses) VALUES ($1,$2) ON CONFLICT (empresa_id) DO UPDATE SET banco_meses = $2, atualizado_em = now()`, [u.empresaId, dto.meses]);
    return { ok: true, meses: dto.meses };
  }

  /** jornada normal do dia de cada funcionário (o que uma folga de compensação tira do banco) */
  private async minutosDia(empresaId: string) {
    const regras = await this.escala.regras(empresaId);
    const l = await this.ds.query(
      `SELECT f.id, f.nome, f.ativo, c.jornada, c.horas_semana FROM funcionarios f LEFT JOIN funcionario_contratos c ON c.funcionario_id = f.id WHERE f.empresa_id = $1 ORDER BY f.nome`, [empresaId]);
    return l.map((x: Record<string, unknown>) => {
      const hs = x.horas_semana !== null && x.horas_semana !== undefined ? Number(x.horas_semana) : regras.horasSemana;
      return { id: x.id as string, nome: x.nome as string, ativo: !!x.ativo, minutosDia: x.jornada === '12x36' ? 720 : Math.round((hs * 60) / (x.jornada === '5x2' ? 5 : 6)) };
    }) as { id: string; nome: string; ativo: boolean; minutosDia: number }[];
  }

  private async movimentos(empresaId: string, funcionarioId?: string): Promise<Mov[]> {
    const l = await this.ds.query(
      `SELECT * FROM banco_horas WHERE empresa_id = $1 ${funcionarioId ? 'AND funcionario_id = $2' : ''} ORDER BY data, criado_em`, funcionarioId ? [empresaId, funcionarioId] : [empresaId]);
    return l.map((x: Record<string, unknown>) => ({
      id: x.id as string, funcionarioId: x.funcionario_id as string, data: dia(x.data)!, minutos: Number(x.minutos), tipo: x.tipo as string,
      referencia: (x.referencia as string) ?? null, venceEm: dia(x.vence_em), observacao: (x.observacao as string) ?? null, usuario: (x.usuario_nome as string) ?? null,
    }));
  }

  private async compensacoes(empresaId: string, funcionarioId?: string): Promise<{ funcionarioId: string; data: string; minutos: number | null; observacao: string | null }[]> {
    const l = await this.ds.query(
      `SELECT funcionario_id, data, minutos_banco, observacao FROM escala_dias WHERE empresa_id = $1 AND tipo = 'compensa' ${funcionarioId ? 'AND funcionario_id = $2' : ''} ORDER BY data`,
      funcionarioId ? [empresaId, funcionarioId] : [empresaId]);
    return l.map((x: Record<string, unknown>) => ({ funcionarioId: x.funcionario_id as string, data: dia(x.data)!, minutos: x.minutos_banco === null || x.minutos_banco === undefined ? null : Number(x.minutos_banco), observacao: (x.observacao as string) ?? null }));
  }

  /** saldo com as horas mais antigas gastas primeiro: quanto vence, quando, e quanto já venceu (tem que pagar) */
  private calcular(movs: Mov[], comps: { data: string; minutos: number }[], hoje: string) {
    const creditos = movs.filter((m) => m.minutos > 0).map((m) => ({ data: m.data, venceEm: m.venceEm, resta: m.minutos }));
    const usados = [...movs.filter((m) => m.minutos < 0).map((m) => ({ data: m.data, minutos: -m.minutos })), ...comps.filter((c) => c.data <= hoje)].sort((a, b) => a.data.localeCompare(b.data));
    const programado = comps.filter((c) => c.data > hoje).reduce((s, c) => s + c.minutos, 0);
    let devendo = 0;
    for (const u of usados) {
      let falta = u.minutos;
      for (const c of creditos) {
        if (!falta) break;
        const t = Math.min(c.resta, falta);
        c.resta -= t; falta -= t;
      }
      devendo += falta;
    }
    const sobra = creditos.filter((c) => c.resta > 0);
    const vencidas = sobra.filter((c) => c.venceEm && c.venceEm < hoje).reduce((s, c) => s + c.resta, 0);
    const vencendo = sobra.filter((c) => c.venceEm && c.venceEm >= hoje && c.venceEm <= somaDias(hoje, 30));
    const saldo = sobra.reduce((s, c) => s + c.resta, 0) - devendo;
    return {
      saldo, vencidas, devendo, programado, saldoPrevisto: saldo - programado,
      vencendo: vencendo.reduce((s, c) => s + c.resta, 0), vencendoEm: vencendo[0]?.venceEm ?? null,
      proximoVencimento: sobra.find((c) => c.venceEm && c.venceEm >= hoje)?.venceEm ?? null,
    };
  }

  async resumo(u: UsuarioToken) {
    const hoje = hojeSP();
    const [fs, movs, comps, meses] = await Promise.all([this.minutosDia(u.empresaId), this.movimentos(u.empresaId), this.compensacoes(u.empresaId), this.meses(u.empresaId)]);
    const lista = fs.filter((f) => f.ativo).map((f) => {
      const c = comps.filter((x) => x.funcionarioId === f.id).map((x) => ({ data: x.data, minutos: x.minutos ?? f.minutosDia }));
      return { id: f.id, nome: f.nome, minutosDia: f.minutosDia, ...this.calcular(movs.filter((m) => m.funcionarioId === f.id), c, hoje) };
    });
    return { hoje, meses, lista };
  }

  async detalhe(u: UsuarioToken, funcionarioId: string) {
    const hoje = hojeSP();
    const fs = await this.minutosDia(u.empresaId);
    const f = fs.find((x: { id: string }) => x.id === funcionarioId);
    if (!f) throw new NotFoundException('Funcionário não encontrado.');
    const [movs, compsBrutas] = await Promise.all([this.movimentos(u.empresaId, f.id), this.compensacoes(u.empresaId, f.id)]);
    const comps = compsBrutas.map((x) => ({ ...x, minutos: x.minutos ?? f.minutosDia }));
    const meses: { competencia: string; extras_min: number; destino_extras: string; faltas: number; destino_faltas: string; noturno_min: number; feriado_min: number; fechado_por: string | null; fechado_em: unknown }[] =
      await this.ds.query(`SELECT * FROM rh_horas_mes WHERE funcionario_id = $1 AND empresa_id = $2 ORDER BY competencia DESC LIMIT 24`, [f.id, u.empresaId]);
    return {
      hoje, id: f.id, nome: f.nome, minutosDia: f.minutosDia, ...this.calcular(movs, comps, hoje),
      movimentos: [...movs.map((m) => ({ ...m, origem: 'banco' as const })), ...comps.map((c) => ({ id: null, data: c.data, minutos: -c.minutos, tipo: 'compensa', referencia: null, venceEm: null, observacao: c.observacao, usuario: null, origem: 'escala' as const }))]
        .sort((a, b) => b.data.localeCompare(a.data)),
      meses: meses.map((m) => ({
        competencia: m.competencia, extras: Number(m.extras_min), destinoExtras: m.destino_extras, faltas: Number(m.faltas), destinoFaltas: m.destino_faltas,
        noturno: Number(m.noturno_min), feriado: Number(m.feriado_min), fechadoPor: m.fechado_por, fechadoEm: m.fechado_em,
      })),
    };
  }

  /** o mês da escala de cada funcionário: extras, faltas, noturnas, feriado e se já foi fechado */
  async mes(u: UsuarioToken, competencia?: string) {
    const hoje = hojeSP();
    const c = competencia && COMPETENCIA.test(competencia) ? competencia : somaMeses(`${hoje.slice(0, 7)}-01`, -1).slice(0, 7);
    const esc = await this.escala.ver(u, `${c}-01`, ultimoDia(c));
    const fechados: Record<string, unknown>[] = await this.ds.query(`SELECT * FROM rh_horas_mes WHERE empresa_id = $1 AND competencia = $2`, [u.empresaId, c]);
    return {
      competencia: c, hoje, fechadoAte: ultimoDia(c) < hoje,
      lista: (esc.lista as LinhaMes[]).map((f) => {
        const x = fechados.find((y) => y.funcionario_id === f.id);
        return {
          id: f.id, nome: f.nome, cargo: f.cargo, minutosDia: f.minutosDia, extras: f.resumo.extras, faltas: f.resumo.faltas, atestados: f.resumo.atestados,
          noturno: f.resumo.noturno, feriado: f.resumo.feriado, semEscala: f.resumo.semEscala, compensa: f.resumo.compensa, bancoUsado: f.resumo.bancoUsado, licencas: f.resumo.licencas,
          fechado: x ? {
            extras: Number(x.extras_min), destinoExtras: x.destino_extras as string, faltas: Number(x.faltas), destinoFaltas: x.destino_faltas as string, por: x.fechado_por as string, em: x.fechado_em,
            mudou: Number(x.extras_min) !== f.resumo.extras || Number(x.faltas) !== f.resumo.faltas,
          } : null,
        };
      }),
    };
  }

  async fecharMes(u: UsuarioToken, dto: FechamentoDto) {
    const atual = await this.mes(u, dto.competencia);
    const meses = await this.meses(u.empresaId);
    const fim = ultimoDia(dto.competencia);
    await this.ds.transaction(async (m) => {
      for (const i of dto.itens) {
        const f = atual.lista.find((x) => x.id === i.funcionarioId);
        if (!f) throw new NotFoundException('Funcionário não encontrado.');
        await m.query(
          `INSERT INTO rh_horas_mes (funcionario_id, competencia, empresa_id, extras_min, destino_extras, faltas, destino_faltas, noturno_min, feriado_min, fechado_por, fechado_em)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
           ON CONFLICT (funcionario_id, competencia) DO UPDATE SET extras_min=$4, destino_extras=$5, faltas=$6, destino_faltas=$7, noturno_min=$8, feriado_min=$9, fechado_por=$10, fechado_em=now()`,
          [f.id, dto.competencia, u.empresaId, f.extras, i.destinoExtras, f.faltas, i.destinoFaltas, f.noturno, f.feriado, u.nome]);
        // refazer o mês: tira o que esse fechamento tinha mandado para o banco e manda de novo
        await m.query(`DELETE FROM banco_horas WHERE empresa_id = $1 AND funcionario_id = $2 AND referencia = $3 AND tipo IN ('extra','falta')`, [u.empresaId, f.id, dto.competencia]);
        if (i.destinoExtras === 'banco' && f.extras > 0) {
          await m.query(`INSERT INTO banco_horas (empresa_id, funcionario_id, data, minutos, tipo, referencia, vence_em, observacao, usuario_nome) VALUES ($1,$2,$3,$4,'extra',$5,$6,$7,$8)`,
            [u.empresaId, f.id, fim, f.extras, dto.competencia, somaMeses(fim, meses), `Horas extras de ${dto.competencia.split('-').reverse().join('/')}`, u.nome]);
        }
        if (i.destinoFaltas === 'banco' && f.faltas > 0) {
          await m.query(`INSERT INTO banco_horas (empresa_id, funcionario_id, data, minutos, tipo, referencia, observacao, usuario_nome) VALUES ($1,$2,$3,$4,'falta',$5,$6,$7)`,
            [u.empresaId, f.id, fim, -f.faltas * f.minutosDia, dto.competencia, `${f.faltas} falta(s) de ${dto.competencia.split('-').reverse().join('/')} tirada(s) do banco`, u.nome]);
        }
      }
    });
    return { ok: true, total: dto.itens.length };
  }

  async ajuste(u: UsuarioToken, dto: AjusteDto) {
    const [f] = await this.ds.query(`SELECT id FROM funcionarios WHERE id = $1 AND empresa_id = $2`, [dto.funcionarioId, u.empresaId]);
    if (!f) throw new NotFoundException('Funcionário não encontrado.');
    if (!dto.minutos) throw new BadRequestException('Coloque as horas.');
    if (dto.tipo === 'pagamento' && dto.minutos < 0) throw new BadRequestException('Coloque as horas pagas (sem sinal de menos).');
    const minutos = dto.tipo === 'pagamento' ? -dto.minutos : dto.minutos;
    const vence = minutos > 0 ? somaMeses(dto.data, await this.meses(u.empresaId)) : null;
    await this.ds.query(`INSERT INTO banco_horas (empresa_id, funcionario_id, data, minutos, tipo, vence_em, observacao, usuario_nome) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [u.empresaId, dto.funcionarioId, dto.data, minutos, dto.tipo, vence, dto.observacao?.trim() || null, u.nome]);
    return { ok: true };
  }

  async apagar(u: UsuarioToken, id: string) {
    const r = await this.ds.query(`DELETE FROM banco_horas WHERE id = $1 AND empresa_id = $2 AND tipo IN ('ajuste','pagamento') RETURNING id`, [id, u.empresaId]);
    if (!(Array.isArray(r?.[0]) ? r[0].length : r?.length)) throw new NotFoundException('Só dá para apagar ajuste ou pagamento (as horas do mês saem refazendo o fechamento).');
    return { ok: true };
  }

  /** para o sino: horas do banco vencidas (pagar) ou vencendo em 30 dias */
  async avisos(empresaId: string) {
    const r = await this.resumo({ empresaId } as UsuarioToken);
    return r.lista.filter((f) => f.vencidas > 0 || f.vencendo > 0).map((f) => f.nome);
  }
}

@Controller('rh/banco-horas')
export class BancoHorasController {
  constructor(private readonly service: BancoHorasService) {}

  @Get()
  @Requer('funcionarios.gerenciar', 'funcionarios.financeiro')
  resumo(@Usuario() u: UsuarioToken) {
    return this.service.resumo(u);
  }

  @Get('mes')
  @Requer('funcionarios.gerenciar', 'funcionarios.financeiro')
  mes(@Usuario() u: UsuarioToken, @Query('competencia') competencia?: string) {
    return this.service.mes(u, competencia);
  }

  @Post('mes')
  @Requer('funcionarios.gerenciar')
  fecharMes(@Usuario() u: UsuarioToken, @Body() dto: FechamentoDto) {
    return this.service.fecharMes(u, dto);
  }

  @Put('config')
  @Requer('funcionarios.gerenciar')
  config(@Usuario() u: UsuarioToken, @Body() dto: ConfigBancoDto) {
    return this.service.salvarConfig(u, dto);
  }

  @Post('ajuste')
  @Requer('funcionarios.gerenciar')
  ajuste(@Usuario() u: UsuarioToken, @Body() dto: AjusteDto) {
    return this.service.ajuste(u, dto);
  }

  @Delete(':id')
  @Requer('funcionarios.gerenciar')
  apagar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.apagar(u, id);
  }

  @Get(':funcionarioId')
  @Requer('funcionarios.gerenciar', 'funcionarios.financeiro')
  detalhe(@Usuario() u: UsuarioToken, @Param('funcionarioId', ParseUUIDPipe) id: string) {
    return this.service.detalhe(u, id);
  }
}
