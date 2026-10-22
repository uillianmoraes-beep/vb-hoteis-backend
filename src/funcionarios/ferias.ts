import { BadRequestException, Body, Controller, Delete, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';
import { custoBeneficios } from './contrato';

/**
 * Férias, 13º e provisões (o sistema não faz a folha: mostra o que vence, quanto custa e quanto guardar).
 * Férias: cada 12 meses de casa dão um período; o funcionário tem os 12 meses seguintes para tirar.
 * Passou do prazo sem tirar, paga em dobro. Faltas no período diminuem os dias (CLT art. 130).
 * 13º: 1/12 do salário por mês com 15 dias ou mais trabalhados; 1ª parcela até 30/11, 2ª até 20/12.
 * Provisões: o que a casa deve ir guardando por mês (férias + 1/3, 13º e os encargos sobre eles).
 */

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const DIA = 86_400_000;
const r2 = (v: number) => Math.round(v * 100) / 100;
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const dia = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);
const somaDias = (d: string, k: number) => new Date(Date.parse(`${d}T12:00:00Z`) + k * DIA).toISOString().slice(0, 10);
const difDias = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DIA);
/** soma meses mantendo o dia (31/01 + 1 mês = 28 ou 29/02) */
function somaMeses(d: string, k: number) {
  const [a, m, dd] = d.split('-').map(Number);
  const t = a * 12 + (m - 1) + k;
  const ano = Math.floor(t / 12), mes = (t % 12) + 1;
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${ano}-${String(mes).padStart(2, '0')}-${String(Math.min(dd, ultimo)).padStart(2, '0')}`;
}
/** meses (avos) com 15 dias ou mais entre duas datas, contando a partir do início */
function avos(inicio: string, ate: string) {
  if (ate < inicio) return 0;
  let k = 0;
  while (somaMeses(inicio, k + 1) <= somaDias(ate, 1)) k++;
  const resto = difDias(somaMeses(inicio, k), somaDias(ate, 1));
  return k + (resto >= 15 ? 1 : 0);
}
/** dias de férias pelo número de faltas sem justificativa no período (CLT art. 130) */
const direitoPorFaltas = (f: number) => (f <= 5 ? 30 : f <= 14 ? 24 : f <= 23 ? 18 : f <= 32 ? 12 : 0);
/** encargos patronais padrão: no Simples/MEI o INSS da empresa já vai no DAS */
const encargosPadrao = (regime: string | null) => (regime === 'presumido' || regime === 'real' || regime === 'normal' ? 27.8 : 0);

class ProgramarDto {
  @IsUUID() funcionarioId!: string;
  @Matches(DATA) aquisitivoInicio!: string;
  @Matches(DATA) inicio!: string;
  @IsInt() @Min(5) @Max(30) dias!: number;
  /** dias vendidos (abono pecuniário, até 1/3) */
  @IsOptional() @IsInt() @Min(0) @Max(10) abonoDias?: number;
  /** paga a 1ª parcela do 13º junto com as férias */
  @IsOptional() @IsBoolean() adiantar13?: boolean;
  @IsOptional() @IsString() @MaxLength(300) observacao?: string;
}
class PeriodoDto {
  @IsUUID() funcionarioId!: string;
  @Matches(DATA) aquisitivoInicio!: string;
  @IsOptional() @IsInt() @Min(0) @Max(366) faltas?: number;
  /** férias desse período já foram tiradas antes do sistema */
  @IsOptional() @IsBoolean() quitado?: boolean;
  @IsOptional() @IsString() @MaxLength(300) observacao?: string;
}
class DecimoDto {
  @IsUUID() funcionarioId!: string;
  @IsInt() @Min(2000) @Max(2100) ano!: number;
  @IsIn([1, 2]) parcela!: 1 | 2;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1_000_000) valor!: number;
  @Matches(DATA) data!: string;
}
class ConfigRhDto {
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(20) fgtsPct!: number;
  /** INSS patronal + RAT + terceiros (0 no Simples, ~27,8% no Lucro Presumido/Real) */
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(60) encargosPct!: number;
}

interface Func { id: string; nome: string; funcao: string; cargo: string | null; admissao: string | null; demissao: string | null; salario: number; beneficios: number; semSalario: boolean }
interface Prog { id: string; funcionarioId: string; aquisitivoInicio: string; inicio: string; fim: string; dias: number; abonoDias: number; adiantar13: boolean; status: string; observacao: string | null; usuario: string | null }

@Injectable()
export class FeriasService {
  constructor(private readonly ds: DataSource) {}

  async config(empresaId: string) {
    const [e] = await this.ds.query(`SELECT regime_tributario AS regime FROM empresas WHERE id = $1`, [empresaId]);
    const [c] = await this.ds.query(`SELECT fgts_pct, encargos_pct FROM rh_config WHERE empresa_id = $1`, [empresaId]);
    const regime = (e?.regime as string) ?? null;
    return { regime, fgtsPct: n(c?.fgts_pct) ?? 8, encargosPct: n(c?.encargos_pct) ?? encargosPadrao(regime), padrao: c?.encargos_pct === undefined || c?.encargos_pct === null };
  }

  async salvarConfig(u: UsuarioToken, dto: ConfigRhDto) {
    await this.ds.query(
      `INSERT INTO rh_config (empresa_id, fgts_pct, encargos_pct) VALUES ($1,$2,$3) ON CONFLICT (empresa_id) DO UPDATE SET fgts_pct=$2, encargos_pct=$3, atualizado_em=now()`,
      [u.empresaId, dto.fgtsPct, dto.encargosPct]);
    return this.config(u.empresaId);
  }

  private async funcionarios(empresaId: string, id?: string): Promise<Func[]> {
    const l = await this.ds.query(
      `SELECT f.id, f.nome, f.funcao, f.admissao, c.cargo, c.salario, c.beneficios, c.demissao
         FROM funcionarios f LEFT JOIN funcionario_contratos c ON c.funcionario_id = f.id
        WHERE f.empresa_id = $1 AND f.ativo ${id ? 'AND f.id = $2' : ''} ORDER BY f.nome`, id ? [empresaId, id] : [empresaId]);
    return l.map((x: Record<string, unknown>) => {
      const salario = n(x.salario) ?? 0;
      return {
        id: x.id as string, nome: x.nome as string, funcao: x.funcao as string, cargo: (x.cargo as string) ?? null, admissao: dia(x.admissao), demissao: dia(x.demissao),
        salario, beneficios: custoBeneficios(salario, (x.beneficios ?? []) as never[]).custo, semSalario: x.salario === null || x.salario === undefined,
      };
    });
  }

  private async programacoes(empresaId: string, funcionarioId?: string): Promise<Prog[]> {
    const l = await this.ds.query(
      `SELECT * FROM funcionario_ferias WHERE empresa_id = $1 AND status <> 'cancelada' ${funcionarioId ? 'AND funcionario_id = $2' : ''} ORDER BY inicio`,
      funcionarioId ? [empresaId, funcionarioId] : [empresaId]);
    return l.map((x: Record<string, unknown>) => {
      const inicio = dia(x.inicio)!;
      return {
        id: x.id as string, funcionarioId: x.funcionario_id as string, aquisitivoInicio: dia(x.aquisitivo_inicio)!, inicio, fim: somaDias(inicio, Number(x.dias) - 1),
        dias: Number(x.dias), abonoDias: Number(x.abono_dias), adiantar13: !!x.adiantar_13, status: x.status as string, observacao: (x.observacao as string) ?? null, usuario: (x.usuario_nome as string) ?? null,
      };
    });
  }

  /** períodos de férias de um funcionário, do mais antigo ao atual, com o saldo e a situação */
  private periodos(f: Func, progs: Prog[], marcas: Map<string, { faltas: number; quitado: boolean; observacao: string | null }>, hoje: string) {
    if (!f.admissao || f.admissao > hoje) return [];
    const out = [];
    for (let k = 0; k < 60; k++) {
      const ini = somaMeses(f.admissao, 12 * k);
      if (ini > hoje) break;
      const fim = somaDias(somaMeses(f.admissao, 12 * (k + 1)), -1);
      const limite = somaDias(somaMeses(f.admissao, 12 * (k + 2)), -1);
      const marca = marcas.get(ini);
      const faltas = marca?.faltas ?? 0;
      const direito = direitoPorFaltas(faltas);
      const daqui = progs.filter((p) => p.aquisitivoInicio === ini);
      const usados = daqui.reduce((s, p) => s + p.dias + p.abonoDias, 0);
      const gozados = daqui.filter((p) => p.inicio <= hoje).reduce((s, p) => s + p.dias + p.abonoDias, 0);
      const saldo = Math.max(0, direito - usados);
      // muito antigo (prazo acabou há mais de 2 anos) e sem nada no sistema: considera tirado
      const antigo = !daqui.length && !marca && difDias(limite, hoje) > 730;
      const emAquisicao = fim >= hoje;
      const comecarAte = saldo > 0 ? somaDias(limite, -(saldo - 1)) : null;
      const situacao = marca?.quitado || antigo ? 'quitado' : emAquisicao ? 'aquisicao' : saldo === 0 ? (gozados >= direito ? 'tirado' : 'programado') : limite < hoje ? 'vencido' : 'a_vencer';
      const valorDia = (f.salario / 30) * (4 / 3);
      out.push({
        aquisitivoInicio: ini, aquisitivoFim: fim, limite, faltas, direito, usados, gozados, saldo, situacao, antigo, quitadoManual: !!marca?.quitado, observacao: marca?.observacao ?? null,
        avos: emAquisicao ? avos(ini, hoje) : 12, comecarAte, diasParaComecar: comecarAte ? difDias(hoje, comecarAte) : null,
        // quanto custa o que falta tirar (vencido paga em dobro)
        valorSaldo: situacao === 'vencido' ? r2(valorDia * saldo * 2) : situacao === 'a_vencer' ? r2(valorDia * saldo) : 0,
        programacoes: daqui.map((p) => this.valorProgramacao(p, f.salario, limite)),
      });
    }
    return out;
  }

  private valorProgramacao(p: Prog, salario: number, limite: string) {
    const dobro = p.fim > limite;
    const ferias = r2((salario / 30) * p.dias * (4 / 3) * (dobro ? 2 : 1));
    const abono = r2((salario / 30) * p.abonoDias * (4 / 3));
    return { ...p, dobro, valorFerias: ferias, valorAbono: abono, valorTotal: r2(ferias + abono), pagarAte: somaDias(p.inicio, -2) };
  }

  private async marcas(empresaId: string) {
    const l = await this.ds.query(`SELECT * FROM funcionario_ferias_periodos WHERE empresa_id = $1`, [empresaId]);
    const m = new Map<string, Map<string, { faltas: number; quitado: boolean; observacao: string | null }>>();
    for (const x of l) {
      if (!m.has(x.funcionario_id)) m.set(x.funcionario_id, new Map());
      m.get(x.funcionario_id)!.set(dia(x.aquisitivo_inicio)!, { faltas: Number(x.faltas), quitado: !!x.quitado, observacao: x.observacao ?? null });
    }
    return m;
  }

  async ferias(u: UsuarioToken) {
    const hoje = hojeSP();
    const [fs, progs, marcas] = await Promise.all([this.funcionarios(u.empresaId), this.programacoes(u.empresaId), this.marcas(u.empresaId)]);
    const lista = fs.map((f) => {
      const ps = this.periodos(f, progs.filter((p) => p.funcionarioId === f.id), marcas.get(f.id) ?? new Map(), hoje);
      const abertos = ps.filter((p) => p.situacao === 'vencido' || p.situacao === 'a_vencer');
      const proxima = progs.filter((p) => p.funcionarioId === f.id && p.fim >= hoje)[0] ?? null;
      return {
        id: f.id, nome: f.nome, cargo: f.cargo ?? f.funcao, admissao: f.admissao, salario: f.salario, semSalario: f.semSalario,
        periodos: ps, vencidos: ps.filter((p) => p.situacao === 'vencido').length,
        alerta: abertos.some((p) => p.situacao === 'vencido' || (p.diasParaComecar !== null && p.diasParaComecar <= 60 && p.usados === 0)),
        emFerias: proxima && proxima.inicio <= hoje ? proxima : null, proxima: proxima && proxima.inicio > hoje ? proxima : null,
      };
    });
    // calendário: o que está programado daqui para frente
    const nomes = new Map(fs.map((f) => [f.id, f.nome]));
    const calendario = progs.filter((p) => p.fim >= somaDias(hoje, -30)).map((p) => ({ ...p, nome: nomes.get(p.funcionarioId) ?? '' }));
    return {
      hoje, lista, calendario,
      semAdmissao: fs.filter((f) => !f.admissao).map((f) => f.nome),
      resumo: {
        vencidos: lista.reduce((s, f) => s + f.vencidos, 0), alertas: lista.filter((f) => f.alerta).length,
        emFerias: lista.filter((f) => f.emFerias).length, valorAberto: r2(lista.reduce((s, f) => s + f.periodos.reduce((a, p) => a + p.valorSaldo, 0), 0)),
      },
    };
  }

  async programar(u: UsuarioToken, dto: ProgramarDto) {
    const [f] = await this.funcionarios(u.empresaId, dto.funcionarioId);
    if (!f) throw new NotFoundException('Funcionário não encontrado.');
    if (!f.admissao) throw new BadRequestException('Coloque a data de admissão no cadastro do funcionário.');
    const hoje = hojeSP();
    const progs = await this.programacoes(u.empresaId, f.id);
    const marcas = (await this.marcas(u.empresaId)).get(f.id) ?? new Map();
    // programar pode ser de período ainda em aquisição, desde que as férias comecem depois que ele fechar
    const todos = this.periodos(f, progs, marcas, dto.inicio > hoje ? dto.inicio : hoje);
    const p = todos.find((x) => x.aquisitivoInicio === dto.aquisitivoInicio);
    if (!p) throw new BadRequestException('Período de férias não encontrado.');
    if (p.situacao === 'quitado') throw new BadRequestException('Este período está marcado como já tirado.');
    if (dto.inicio <= p.aquisitivoFim) throw new BadRequestException(`As férias deste período só podem começar depois de ${p.aquisitivoFim.split('-').reverse().join('/')} (quando ele completa 12 meses).`);
    const abono = dto.abonoDias ?? 0;
    if (abono > Math.floor(p.direito / 3)) throw new BadRequestException(`Pode vender no máximo ${Math.floor(p.direito / 3)} dias.`);
    if (dto.dias + abono > p.saldo) throw new BadRequestException(`Este período tem só ${p.saldo} dia(s) de saldo.`);
    if (p.programacoes.length >= 3) throw new BadRequestException('As férias podem ser divididas em no máximo 3 partes.');
    const restante = p.saldo - dto.dias - abono;
    if (restante > 0 && restante < 5) throw new BadRequestException(`Sobrariam ${restante} dia(s): cada parte tem que ter pelo menos 5 dias.`);
    const algum14 = dto.dias >= 14 || p.programacoes.some((x) => x.dias >= 14);
    if (!algum14 && restante < 14 && p.direito >= 14) throw new BadRequestException('Uma das partes tem que ter pelo menos 14 dias seguidos.');
    const fim = somaDias(dto.inicio, dto.dias - 1);
    const choque = progs.find((x) => x.inicio <= fim && x.fim >= dto.inicio);
    if (choque) throw new BadRequestException('Já existem férias programadas nessas datas para este funcionário.');
    const [r] = await this.ds.query(
      `INSERT INTO funcionario_ferias (empresa_id, funcionario_id, aquisitivo_inicio, inicio, dias, abono_dias, adiantar_13, observacao, usuario_nome)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [u.empresaId, f.id, dto.aquisitivoInicio, dto.inicio, dto.dias, abono, !!dto.adiantar13, dto.observacao?.trim() || null, u.nome]);
    const avisos: string[] = [];
    if (difDias(hoje, dto.inicio) < 30) avisos.push('O aviso de férias tem que ser entregue 30 dias antes.');
    const dw = new Date(`${dto.inicio}T12:00:00Z`).getUTCDay();
    if (dw === 5 || dw === 6) avisos.push('As férias não podem começar nos 2 dias antes da folga ou de feriado (CLT art. 134 §3º).');
    if (fim > p.limite) avisos.push('Termina depois do prazo: os dias depois do prazo são pagos em dobro.');
    return { ok: true, id: r.id, avisos };
  }

  async cancelar(u: UsuarioToken, id: string) {
    const r = await this.ds.query(`UPDATE funcionario_ferias SET status = 'cancelada' WHERE id = $1 AND empresa_id = $2 AND status <> 'cancelada' RETURNING id`, [id, u.empresaId]);
    if (!(Array.isArray(r?.[0]) ? r[0].length : r?.length)) throw new NotFoundException('Férias não encontradas.');
    return { ok: true };
  }

  async periodo(u: UsuarioToken, dto: PeriodoDto) {
    const [f] = await this.ds.query(`SELECT id FROM funcionarios WHERE id = $1 AND empresa_id = $2`, [dto.funcionarioId, u.empresaId]);
    if (!f) throw new NotFoundException('Funcionário não encontrado.');
    await this.ds.query(
      `INSERT INTO funcionario_ferias_periodos (funcionario_id, aquisitivo_inicio, empresa_id, faltas, quitado, observacao) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (funcionario_id, aquisitivo_inicio) DO UPDATE SET faltas = $4, quitado = $5, observacao = $6`,
      [dto.funcionarioId, dto.aquisitivoInicio, u.empresaId, dto.faltas ?? 0, !!dto.quitado, dto.observacao?.trim() || null]);
    return { ok: true };
  }

  /** 13º do ano: avos, valor, parcelas e prazos */
  async decimo(u: UsuarioToken, anoQ?: number) {
    const hoje = hojeSP();
    const ano = anoQ && anoQ >= 2000 && anoQ <= 2100 ? anoQ : Number(hoje.slice(0, 4));
    const fs = await this.funcionarios(u.empresaId);
    const pagos: { funcionario_id: string; parcela: number; valor: string; data: unknown }[] = await this.ds.query(`SELECT * FROM funcionario_decimo WHERE empresa_id = $1 AND ano = $2`, [u.empresaId, ano]);
    const nasFerias: { funcionario_id: string; inicio: unknown }[] = await this.ds.query(
      `SELECT funcionario_id, min(inicio) AS inicio FROM funcionario_ferias WHERE empresa_id = $1 AND status <> 'cancelada' AND adiantar_13 AND extract(year FROM inicio) = $2 GROUP BY 1`, [u.empresaId, ano]);
    const lista = fs.filter((f) => f.admissao && f.admissao <= `${ano}-12-31`).map((f) => {
      const ini = f.admissao! > `${ano}-01-01` ? f.admissao! : `${ano}-01-01`;
      const fimAno = f.demissao && f.demissao < `${ano}-12-31` ? f.demissao : `${ano}-12-31`;
      // avo por mês do calendário: 15 dias ou mais trabalhados naquele mês
      const avoMes = (ate: string) => {
        let k = 0;
        for (let m = 1; m <= 12; m++) {
          const a = `${ano}-${String(m).padStart(2, '0')}-01`;
          const b = somaDias(somaMeses(a, 1), -1);
          const de = a > ini ? a : ini, ateMes = b < ate ? b : ate;
          if (ateMes >= de && difDias(de, ateMes) + 1 >= 15) k++;
        }
        return k;
      };
      const avosAno = avoMes(fimAno);
      const avosHoje = avoMes(hoje < fimAno ? hoje : fimAno);
      const valor = r2((f.salario / 12) * avosAno);
      const p1 = pagos.find((p) => p.funcionario_id === f.id && Number(p.parcela) === 1);
      const p2 = pagos.find((p) => p.funcionario_id === f.id && Number(p.parcela) === 2);
      const ferias = nasFerias.find((x) => x.funcionario_id === f.id);
      return {
        id: f.id, nome: f.nome, cargo: f.cargo ?? f.funcao, salario: f.salario, semSalario: f.semSalario, avos: avosAno, avosHoje, valor,
        parcela1: { valor: r2(valor / 2), prazo: `${ano}-11-30`, paga: p1 ? { valor: Number(p1.valor), data: dia(p1.data) } : null, nasFerias: ferias ? dia(ferias.inicio) : null },
        parcela2: { valor: r2(valor - (p1 ? Number(p1.valor) : valor / 2)), prazo: `${ano}-12-20`, paga: p2 ? { valor: Number(p2.valor), data: dia(p2.data) } : null },
        provisionadoHoje: r2((f.salario / 12) * avosHoje),
      };
    });
    const soma = (fn: (x: (typeof lista)[number]) => number) => r2(lista.reduce((s, x) => s + fn(x), 0));
    return {
      ano, hoje, lista,
      totais: {
        valor: soma((x) => x.valor), parcela1: soma((x) => (x.parcela1.paga ? 0 : x.parcela1.valor)), parcela2: soma((x) => (x.parcela2.paga ? 0 : x.parcela2.valor)),
        pago: soma((x) => (x.parcela1.paga?.valor ?? 0) + (x.parcela2.paga?.valor ?? 0)), provisionadoHoje: soma((x) => x.provisionadoHoje),
      },
    };
  }

  async pagarDecimo(u: UsuarioToken, dto: DecimoDto) {
    const [f] = await this.ds.query(`SELECT id FROM funcionarios WHERE id = $1 AND empresa_id = $2`, [dto.funcionarioId, u.empresaId]);
    if (!f) throw new NotFoundException('Funcionário não encontrado.');
    if (dto.data > hojeSP()) throw new BadRequestException('A data não pode ser no futuro.');
    await this.ds.query(
      `INSERT INTO funcionario_decimo (empresa_id, funcionario_id, ano, parcela, valor, data, usuario_nome) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (funcionario_id, ano, parcela) DO UPDATE SET valor = $5, data = $6, usuario_nome = $7`,
      [u.empresaId, dto.funcionarioId, dto.ano, dto.parcela, dto.valor.toFixed(2), dto.data, u.nome]);
    return { ok: true };
  }

  async desfazerDecimo(u: UsuarioToken, funcionarioId: string, ano: number, parcela: number) {
    await this.ds.query(`DELETE FROM funcionario_decimo WHERE empresa_id = $1 AND funcionario_id = $2 AND ano = $3 AND parcela = $4`, [u.empresaId, funcionarioId, ano, parcela]);
    return { ok: true };
  }

  /** custo real de cada funcionário por mês e quanto já deveria estar guardado para férias e 13º */
  async provisoes(u: UsuarioToken) {
    const hoje = hojeSP();
    const cfg = await this.config(u.empresaId);
    const [fer, dec] = await Promise.all([this.ferias(u), this.decimo(u)]);
    const fs = await this.funcionarios(u.empresaId);
    const enc = (cfg.fgtsPct + cfg.encargosPct) / 100;
    const lista = fs.map((f) => {
      const s = f.salario;
      const fgts = r2((s * cfg.fgtsPct) / 100);
      const encargos = r2((s * cfg.encargosPct) / 100);
      const provFerias = r2((s / 12) * (4 / 3));
      const prov13 = r2(s / 12);
      const encProv = r2((provFerias + prov13) * enc);
      const custo = r2(s + f.beneficios + fgts + encargos + provFerias + prov13 + encProv);
      // guardado que deveria existir hoje: férias em aberto + período em aquisição + 13º do ano ainda não pago
      const fe = fer.lista.find((x) => x.id === f.id);
      const feriasAcum = r2((fe?.periodos ?? []).reduce((a, p) => a + (p.situacao === 'aquisicao' ? (s / 12) * (4 / 3) * p.avos : p.valorSaldo), 0));
      const de = dec.lista.find((x) => x.id === f.id);
      const decimoAcum = de ? Math.max(0, r2(de.provisionadoHoje - (de.parcela1.paga?.valor ?? 0) - (de.parcela2.paga?.valor ?? 0))) : 0;
      return {
        id: f.id, nome: f.nome, cargo: f.cargo ?? f.funcao, salario: s, semSalario: f.semSalario, beneficios: f.beneficios, fgts, encargos, provFerias, prov13, encProv, custo,
        custoPct: s > 0 ? r2((custo / s) * 100) : null, feriasAcum, decimoAcum, encAcum: r2((feriasAcum + decimoAcum) * enc),
      };
    });
    const soma = (k: keyof (typeof lista)[number]) => r2(lista.reduce((a, x) => a + (Number(x[k]) || 0), 0));
    return {
      hoje, config: cfg, lista,
      totais: {
        salario: soma('salario'), beneficios: soma('beneficios'), fgts: soma('fgts'), encargos: soma('encargos'), provFerias: soma('provFerias'), prov13: soma('prov13'),
        encProv: soma('encProv'), custo: soma('custo'), feriasAcum: soma('feriasAcum'), decimoAcum: soma('decimoAcum'), encAcum: soma('encAcum'),
        semSalario: lista.filter((x) => x.semSalario).length,
      },
    };
  }

  /** para o sino: férias vencidas ou que precisam começar em até 60 dias e ainda não foram programadas */
  async alertas(empresaId: string) {
    const r = await this.ferias({ empresaId } as UsuarioToken);
    return r.lista.filter((f) => f.alerta).map((f) => f.nome);
  }
}

@Controller('rh')
export class FeriasController {
  constructor(private readonly service: FeriasService) {}

  @Get('ferias')
  @Requer('funcionarios.gerenciar', 'funcionarios.financeiro')
  ferias(@Usuario() u: UsuarioToken) {
    return this.service.ferias(u);
  }

  @Post('ferias')
  @Requer('funcionarios.gerenciar')
  programar(@Usuario() u: UsuarioToken, @Body() dto: ProgramarDto) {
    return this.service.programar(u, dto);
  }

  @Delete('ferias/:id')
  @Requer('funcionarios.gerenciar')
  cancelar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.cancelar(u, id);
  }

  @Put('ferias/periodo')
  @Requer('funcionarios.gerenciar')
  periodo(@Usuario() u: UsuarioToken, @Body() dto: PeriodoDto) {
    return this.service.periodo(u, dto);
  }

  @Get('decimo')
  @Requer('funcionarios.gerenciar', 'funcionarios.financeiro')
  decimo(@Usuario() u: UsuarioToken, @Query('ano') ano?: string) {
    return this.service.decimo(u, ano ? Number(ano) : undefined);
  }

  @Post('decimo')
  @Requer('funcionarios.gerenciar', 'funcionarios.financeiro')
  pagarDecimo(@Usuario() u: UsuarioToken, @Body() dto: DecimoDto) {
    return this.service.pagarDecimo(u, dto);
  }

  @Delete('decimo/:funcionarioId/:ano/:parcela')
  @Requer('funcionarios.gerenciar', 'funcionarios.financeiro')
  desfazerDecimo(@Usuario() u: UsuarioToken, @Param('funcionarioId', ParseUUIDPipe) f: string, @Param('ano') ano: string, @Param('parcela') parcela: string) {
    return this.service.desfazerDecimo(u, f, Number(ano), Number(parcela));
  }

  @Get('provisoes')
  @Requer('funcionarios.gerenciar', 'funcionarios.financeiro')
  provisoes(@Usuario() u: UsuarioToken) {
    return this.service.provisoes(u);
  }

  @Put('config')
  @Requer('funcionarios.gerenciar', 'funcionarios.financeiro')
  config(@Usuario() u: UsuarioToken, @Body() dto: ConfigRhDto) {
    return this.service.salvarConfig(u, dto);
  }
}
