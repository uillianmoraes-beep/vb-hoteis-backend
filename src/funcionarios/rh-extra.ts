import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Injectable, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';
import { FUNCOES } from './funcionario.entity';

/**
 * Três ajudas do RH:
 * - Escala sugerida: quantas pessoas de cada função cada turno precisa, pela ocupação prevista (média do mesmo dia da semana
 *   nas últimas 8 semanas + reservas), comparando com quem já está na escala.
 * - Comissões: camareira por quarto acima da meta do dia, recepção por troca para suíte melhor e % do consumo lançado.
 * - Treinamentos: a lista de integração (tarefas, vídeos e textos) e o checklist de cada funcionário.
 */

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const somaDias = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const minutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
const r2 = (n: number) => Math.round(n * 100) / 100;
const PADRAO_TURNOS = [
  { id: 'manha', nome: 'Manhã', inicio: '06:00', fim: '14:00' },
  { id: 'tarde', nome: 'Tarde', inicio: '14:00', fim: '22:00' },
  { id: 'noite', nome: 'Noite', inicio: '22:00', fim: '06:00' },
];
/** pessoas por função: fixo por turno + 1 a cada N usos (entradas) previstos no turno */
export interface RegraFuncao { fixo?: number; porUsos?: number }
const REGRAS_PADRAO: Record<string, RegraFuncao> = {
  camareira: { fixo: 1, porUsos: 8 },
  recepcionista: { fixo: 1, porUsos: 25 },
  portaria: { fixo: 1 },
  garcom: { fixo: 0, porUsos: 12 },
};
const NOME_FUNCAO: Record<string, string> = {
  camareira: 'Camareiras', governanta: 'Governança', recepcionista: 'Recepção', portaria: 'Portaria', garcom: 'Garçons',
  cozinha: 'Cozinha', manutencao: 'Manutenção', gerente: 'Gerência', outro: 'Outros',
};

class RegraDto {
  @IsOptional() @IsInt() @Min(0) @Max(50) fixo?: number;
  @IsOptional() @IsInt() @Min(1) @Max(500) porUsos?: number;
}
class ConfigEscalaDto {
  /** { funcao: { fixo, porUsos } } — conferido no serviço */
  @IsObject() regras!: Record<string, RegraDto>;
}
class ConfigComissoesDto {
  @IsBoolean() camareiraAtivo!: boolean;
  @IsInt() @Min(1) @Max(100) camareiraMeta!: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1000) camareiraValor!: number;
  @IsBoolean() upgradeAtivo!: boolean;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1000) upgradeValor!: number;
  @IsBoolean() consumoAtivo!: boolean;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(50) consumoPct!: number;
  @IsBoolean() consumoSoFrigobar!: boolean;
}
class LancarComissaoDto {
  @Matches(DATA) de!: string;
  @Matches(DATA) ate!: string;
  @IsArray() @IsUUID('4', { each: true }) funcionarios!: string[];
}
class TreinamentoDto {
  @IsString() @MinLength(3) @MaxLength(120) titulo!: string;
  @IsOptional() @IsString() @MaxLength(1000) descricao?: string;
  @IsOptional() @IsIn([...FUNCOES, '']) funcao?: string;
  @IsIn(['tarefa', 'video', 'texto', 'link']) tipo!: 'tarefa' | 'video' | 'texto' | 'link';
  @IsOptional() @IsString() @MaxLength(500) url?: string;
  @IsOptional() @IsInt() @Min(0) @Max(365) prazoDias?: number;
  @IsOptional() @IsInt() @Min(0) @Max(999) ordem?: number;
  @IsOptional() @IsBoolean() ativo?: boolean;
}
class FeitoDto {
  @IsBoolean() feito!: boolean;
  @IsOptional() @IsString() @MaxLength(300) observacao?: string;
}

const LISTA_PADRAO: { titulo: string; descricao: string; funcao: string | null; tipo: 'tarefa' | 'texto'; prazo: number }[] = [
  { titulo: 'Assinar o contrato e os termos', descricao: 'Contrato de trabalho, vale-transporte, LGPD e regulamento interno (RH › Documentos obrigatórios).', funcao: null, tipo: 'tarefa', prazo: 1 },
  { titulo: 'Entregar uniforme, EPI e crachá', descricao: 'Lançar em RH › Uniformes e EPI para ficar na ficha de EPI.', funcao: null, tipo: 'tarefa', prazo: 1 },
  { titulo: 'Conhecer o estabelecimento e a equipe', descricao: 'Mostrar as suítes, rouparia, cozinha, saídas de emergência e apresentar os colegas e o gerente de cada turno.', funcao: null, tipo: 'tarefa', prazo: 1 },
  { titulo: 'Sigilo e atendimento ao cliente', descricao: 'Nunca comentar quem frequenta a casa, não citar nomes nem placas, tratar todos com discrição e cordialidade.', funcao: null, tipo: 'texto', prazo: 2 },
  { titulo: 'Segurança e prevenção de incêndio', descricao: 'Onde ficam os extintores e as saídas, o que fazer em caso de fogo, falta de energia ou cliente passando mal.', funcao: null, tipo: 'texto', prazo: 7 },
  { titulo: 'Padrão de arrumação da suíte', descricao: 'Ordem da limpeza, enxoval, amenities, conferência do frigobar e o que avisar à manutenção. Acompanhar uma camareira experiente no primeiro turno.', funcao: 'camareira', tipo: 'tarefa', prazo: 3 },
  { titulo: 'Usar o sistema na recepção', descricao: 'Dar entrada, lançar consumo, entregar a conta, receber, fechar o caixa e emitir a nota.', funcao: 'recepcionista', tipo: 'tarefa', prazo: 3 },
  { titulo: 'Conferência da geladeira e entregas', descricao: 'Como entregar os pedidos nas suítes, a conferência do garçom por turno e a reposição.', funcao: 'garcom', tipo: 'tarefa', prazo: 3 },
  { titulo: 'Portaria: entrada e saída', descricao: 'Registro de placas, conferência do ticket de saída e o que fazer quando o cliente sai sem pagar.', funcao: 'portaria', tipo: 'tarefa', prazo: 2 },
];

@Injectable()
export class RhExtraService {
  constructor(private readonly ds: DataSource) {}

  /* ------------------------------------------------------- escala sugerida */

  private async turnos(empresaId: string) {
    const t = (await this.ds.query(`SELECT id, nome, inicio, fim FROM escala_turnos WHERE empresa_id = $1 AND ativo ORDER BY inicio, nome`, [empresaId]))
      .map((x: Record<string, string>) => ({ id: x.id, nome: x.nome, inicio: String(x.inicio).slice(0, 5), fim: String(x.fim).slice(0, 5) }));
    return (t.length ? t : PADRAO_TURNOS) as { id: string; nome: string; inicio: string; fim: string }[];
  }

  async configEscala(u: UsuarioToken) {
    const [e] = await this.ds.query(`SELECT config_escala_sugerida AS c FROM empresas WHERE id = $1`, [u.empresaId]);
    const salvo = (e?.c ?? {}) as Record<string, RegraFuncao>;
    return { regras: Object.keys(salvo).length ? salvo : REGRAS_PADRAO, padrao: REGRAS_PADRAO, funcoes: NOME_FUNCAO };
  }

  async salvarConfigEscala(u: UsuarioToken, dto: ConfigEscalaDto) {
    const regras: Record<string, RegraFuncao> = {};
    for (const [f, r] of Object.entries(dto.regras ?? {})) {
      if (!(FUNCOES as readonly string[]).includes(f) || !r || typeof r !== 'object') continue;
      const fixo = Number(r.fixo ?? 0), por = Number(r.porUsos ?? 0);
      if (!Number.isInteger(fixo) || fixo < 0 || fixo > 50 || !Number.isInteger(por) || por < 0 || por > 500) throw new BadRequestException('Use números inteiros: fixo de 0 a 50 e "a cada" de 1 a 500.');
      if (!fixo && !por) continue;
      regras[f] = { fixo, ...(por ? { porUsos: por } : {}) };
    }
    await this.ds.query(`UPDATE empresas SET config_escala_sugerida = $2::jsonb WHERE id = $1`, [u.empresaId, JSON.stringify(regras)]);
    return this.configEscala(u);
  }

  /** os próximos 7 dias a partir de `inicio`: previsão de entradas por turno, quantas pessoas precisa e quantas estão na escala */
  async escalaSugerida(u: UsuarioToken, inicioQ?: string) {
    const inicio = inicioQ && DATA.test(inicioQ) ? inicioQ : hojeSP();
    const { regras } = await this.configEscala(u);
    const turnos = await this.turnos(u.empresaId);
    // entradas por dia da semana e hora nas últimas 8 semanas
    const hist: { dow: number; hora: number; n: number }[] = await this.ds.query(
      `SELECT EXTRACT(DOW FROM entrada_em AT TIME ZONE 'America/Sao_Paulo')::int AS dow, EXTRACT(HOUR FROM entrada_em AT TIME ZONE 'America/Sao_Paulo')::int AS hora, count(*)::int AS n
         FROM estadias WHERE empresa_id = $1 AND status <> 'cancelada' AND entrada_em >= now() - interval '56 days' GROUP BY 1, 2`, [u.empresaId]);
    const semanas = 8;
    const reservas: { dia: string; n: number }[] = await this.ds.query(
      `SELECT to_char(chegada, 'YYYY-MM-DD') AS dia, count(*)::int AS n FROM reservas WHERE empresa_id = $1 AND status IN ('pendente','confirmada') AND chegada BETWEEN $2 AND $3 GROUP BY 1`,
      [u.empresaId, inicio, somaDias(inicio, 6)]).catch(() => []);
    const escala: { data: string; funcao: string; inicio: string | null; fim: string | null; turno_id: string | null; nome: string }[] = await this.ds.query(
      `SELECT to_char(e.data, 'YYYY-MM-DD') AS data, f.funcao, e.inicio, e.fim, e.turno_id, f.nome FROM escala_dias e JOIN funcionarios f ON f.id = e.funcionario_id
        WHERE e.empresa_id = $1 AND e.tipo = 'trabalho' AND f.ativo AND e.data BETWEEN $2 AND $3`, [u.empresaId, inicio, somaDias(inicio, 6)]);
    const funcoes = Object.keys(regras);
    const cobre = (t: { id: string; inicio: string; fim: string }, x: { inicio: string | null; fim: string | null; turno_id: string | null }) => {
      if (x.turno_id && x.turno_id === t.id) return true;
      if (!x.inicio || !x.fim) return false;
      const ti = minutos(t.inicio), tf = ti + ((minutos(t.fim) - ti + 1440) % 1440 || 1440);
      const xi = minutos(x.inicio), xf = xi + ((minutos(x.fim) - xi + 1440) % 1440 || 1440);
      // cobre o turno se fica pelo menos metade dele
      const sobre = Math.max(0, Math.min(tf, xf) - Math.max(ti, xi)) + Math.max(0, Math.min(tf, xf + 1440) - Math.max(ti, xi + 1440));
      return sobre >= (tf - ti) / 2;
    };
    const dias = Array.from({ length: 7 }, (_, i) => {
      const data = somaDias(inicio, i);
      const dow = new Date(`${data}T12:00:00Z`).getUTCDay();
      const res = reservas.find((r) => r.dia === data)?.n ?? 0;
      const linhas = turnos.map((t, k) => {
        const ti = minutos(t.inicio), dur = ((minutos(t.fim) - ti + 1440) % 1440) || 1440;
        let previsto = 0;
        for (let m = 0; m < dur; m += 60) {
          const h = Math.floor(((ti + m) % 1440) / 60);
          // horas depois da meia-noite são do dia seguinte
          const d = ti + m >= 1440 ? (dow + 1) % 7 : dow;
          previsto += (hist.find((x) => x.dow === d && x.hora === h)?.n ?? 0) / semanas;
        }
        if (k === 0) previsto += res; // reservas chegando no dia contam no primeiro turno
        const prev = Math.round(previsto * 10) / 10;
        const porFuncao = funcoes.map((f) => {
          const r = regras[f];
          const precisa = Math.max(r.fixo ?? 0, r.porUsos ? Math.ceil(prev / r.porUsos) : 0);
          const escalados = escala.filter((x) => x.data === data && x.funcao === f && cobre(t, x));
          return { funcao: f, nome: NOME_FUNCAO[f] ?? f, precisa, escalados: escalados.length, pessoas: escalados.map((x) => x.nome), diferenca: escalados.length - precisa };
        });
        return { turno: t.nome, inicio: t.inicio, fim: t.fim, previsto: prev, funcoes: porFuncao };
      });
      return { data, dow, reservas: res, turnos: linhas, faltam: linhas.reduce((s, l) => s + l.funcoes.reduce((a, f) => a + Math.max(0, -f.diferenca), 0), 0) };
    });
    return { inicio, regras, dias, faltamNaSemana: dias.reduce((s, d) => s + d.faltam, 0) };
  }

  /* -------------------------------------------------------------- comissões */

  async configComissoes(u: UsuarioToken) {
    const [e] = await this.ds.query(`SELECT config_comissoes AS c FROM empresas WHERE id = $1`, [u.empresaId]);
    const c = (e?.c ?? {}) as Partial<ConfigComissoesDto>;
    return {
      camareiraAtivo: c.camareiraAtivo ?? false, camareiraMeta: c.camareiraMeta ?? 12, camareiraValor: c.camareiraValor ?? 2,
      upgradeAtivo: c.upgradeAtivo ?? false, upgradeValor: c.upgradeValor ?? 10,
      consumoAtivo: c.consumoAtivo ?? false, consumoPct: c.consumoPct ?? 3, consumoSoFrigobar: c.consumoSoFrigobar ?? false,
    };
  }

  async salvarComissoes(u: UsuarioToken, dto: ConfigComissoesDto) {
    await this.ds.query(`UPDATE empresas SET config_comissoes = $2::jsonb WHERE id = $1`, [u.empresaId, JSON.stringify(dto)]);
    return this.configComissoes(u);
  }

  /** comissão de cada pessoa no período (as regras desligadas não contam) */
  async comissoes(u: UsuarioToken, deQ?: string, ateQ?: string) {
    const ate = ateQ && DATA.test(ateQ) ? ateQ : hojeSP();
    const de = deQ && DATA.test(deQ) ? deQ : `${ate.slice(0, 7)}-01`;
    const cfg = await this.configComissoes(u);
    const ini = `${de}T00:00:00-03:00`, fim = `${ate}T23:59:59.999-03:00`;
    const pessoas = new Map<string, { chave: string; nome: string; funcionarioId: string | null; quartos: number; dias: { data: string; quartos: number; extras: number }[]; extras: number; valorQuartos: number; upgrades: number; valorUpgrades: number; consumo: number; valorConsumo: number; total: number }>();
    const pessoa = (chave: string, nome: string, fid: string | null) => {
      const p = pessoas.get(chave) ?? { chave, nome, funcionarioId: fid, quartos: 0, dias: [], extras: 0, valorQuartos: 0, upgrades: 0, valorUpgrades: 0, consumo: 0, valorConsumo: 0, total: 0 };
      if (fid && !p.funcionarioId) p.funcionarioId = fid;
      pessoas.set(chave, p);
      return p;
    };
    // funcionários pelo nome (para ligar quem lançou no sistema à ficha)
    const funcs: { id: string; nome: string }[] = await this.ds.query(`SELECT id, nome FROM funcionarios WHERE empresa_id = $1 AND ativo`, [u.empresaId]);
    const porNome = new Map(funcs.map((f) => [f.nome.trim().toLowerCase(), f.id]));

    if (cfg.camareiraAtivo) {
      // quartos arrumados: vistorias aprovadas (ou com ressalva) e revisões aprovadas, por camareira e dia
      const q: { cid: string | null; nome: string; dia: string; n: number }[] = await this.ds.query(
        `SELECT cid, nome, dia, count(*)::int AS n FROM (
           SELECT camareira_id AS cid, camareira_nome AS nome, to_char(criado_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS dia FROM vistorias
            WHERE empresa_id = $1 AND camareira_nome IS NOT NULL AND resultado IN ('aprovado','ressalva') AND criado_em BETWEEN $2 AND $3
           UNION ALL
           SELECT camareira_id, camareira_nome, to_char(criado_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') FROM revisoes
            WHERE empresa_id = $1 AND camareira_nome IS NOT NULL AND aprovada AND criado_em BETWEEN $2 AND $3) x GROUP BY 1, 2, 3 ORDER BY 3`, [u.empresaId, ini, fim]).catch(() => []);
      for (const x of q) {
        const fid = x.cid ?? porNome.get(x.nome.trim().toLowerCase()) ?? null;
        const p = pessoa(fid ?? `nome:${x.nome}`, x.nome, fid);
        const extras = Math.max(0, x.n - cfg.camareiraMeta);
        p.quartos += x.n; p.extras += extras; p.dias.push({ data: x.dia, quartos: x.n, extras });
        p.valorQuartos = r2(p.extras * cfg.camareiraValor);
      }
    }
    if (cfg.upgradeAtivo) {
      // troca para outra suíte cobrando pela categoria nova (venda de upgrade)
      const t: { nome: string; n: number }[] = await this.ds.query(
        `SELECT usuario_nome AS nome, count(*)::int AS n FROM estadia_eventos WHERE empresa_id = $1 AND tipo = 'transferencia'
          AND descricao LIKE '%passou a cobrar pela categoria nova%' AND usuario_nome IS NOT NULL AND criado_em BETWEEN $2 AND $3 GROUP BY 1`, [u.empresaId, ini, fim]);
      for (const x of t) {
        const fid = porNome.get(x.nome.trim().toLowerCase()) ?? null;
        const p = pessoa(fid ?? `nome:${x.nome}`, x.nome, fid);
        p.upgrades += x.n; p.valorUpgrades = r2(p.upgrades * cfg.upgradeValor);
      }
    }
    if (cfg.consumoAtivo) {
      const c: { nome: string; v: string }[] = await this.ds.query(
        `SELECT i.usuario_nome AS nome, sum(i.total) AS v FROM estadia_itens i JOIN estadias e ON e.id = i.estadia_id LEFT JOIN produtos p ON p.id = i.produto_id
          WHERE i.empresa_id = $1 AND i.status = 'ativo' AND e.status = 'fechada' AND i.usuario_nome IS NOT NULL AND i.criado_em BETWEEN $2 AND $3
            AND COALESCE(p.ressarcimento, false) = false ${cfg.consumoSoFrigobar ? 'AND p.frigobar' : ''} GROUP BY 1`, [u.empresaId, ini, fim]);
      for (const x of c) {
        const fid = porNome.get(x.nome.trim().toLowerCase()) ?? null;
        const p = pessoa(fid ?? `nome:${x.nome}`, x.nome, fid);
        p.consumo = r2(p.consumo + Number(x.v)); p.valorConsumo = r2((p.consumo * cfg.consumoPct) / 100);
      }
    }
    // já lançado na ficha neste período?
    const lancadas: { funcionario_id: string }[] = await this.ds.query(
      `SELECT DISTINCT funcionario_id FROM funcionario_lancamentos WHERE empresa_id = $1 AND tipo = 'bonus' AND descricao LIKE $2`, [u.empresaId, `Comissão ${de} a ${ate}%`]);
    const lista = [...pessoas.values()].map((p) => ({ ...p, total: r2(p.valorQuartos + p.valorUpgrades + p.valorConsumo), lancada: !!p.funcionarioId && lancadas.some((l) => l.funcionario_id === p.funcionarioId) }))
      .filter((p) => p.quartos || p.upgrades || p.consumo).sort((a, b) => b.total - a.total);
    return { de, ate, config: cfg, lista, total: r2(lista.reduce((s, p) => s + p.total, 0)) };
  }

  /** lança a comissão como bônus na ficha de cada funcionário escolhido (uma vez por período) */
  async lancarComissoes(u: UsuarioToken, dto: LancarComissaoDto) {
    const r = await this.comissoes(u, dto.de, dto.ate);
    let feitas = 0;
    for (const p of r.lista) {
      if (!p.funcionarioId || !dto.funcionarios.includes(p.funcionarioId) || p.lancada || p.total <= 0) continue;
      const partes = [p.extras ? `${p.extras} quarto(s) acima da meta` : '', p.upgrades ? `${p.upgrades} upgrade(s)` : '', p.consumo ? `${r.config.consumoPct}% de ${p.consumo.toFixed(2)} em consumo` : ''].filter(Boolean).join(', ');
      await this.ds.query(
        `INSERT INTO funcionario_lancamentos (empresa_id, funcionario_id, tipo, valor, descricao, data, usuario_nome) VALUES ($1,$2,'bonus',$3,$4,$5,$6)`,
        [u.empresaId, p.funcionarioId, p.total.toFixed(2), `Comissão ${dto.de} a ${dto.ate}: ${partes}`.slice(0, 300), dto.ate, u.nome]);
      feitas++;
    }
    return { lancadas: feitas };
  }

  /* ------------------------------------------------------------ treinamentos */

  async treinamentos(u: UsuarioToken) {
    const lista: Record<string, unknown>[] = await this.ds.query(`SELECT * FROM treinamentos WHERE empresa_id = $1 ORDER BY ordem, titulo`, [u.empresaId]);
    const funcs: { id: string; nome: string; funcao: string; admissao: string | null }[] = await this.ds.query(
      `SELECT id, nome, funcao, to_char(admissao, 'YYYY-MM-DD') AS admissao FROM funcionarios WHERE empresa_id = $1 AND ativo ORDER BY admissao DESC NULLS LAST, nome`, [u.empresaId]);
    const feitos: { funcionario_id: string; treinamento_id: string }[] = await this.ds.query(`SELECT funcionario_id, treinamento_id FROM treinamento_feitos WHERE empresa_id = $1`, [u.empresaId]);
    const ativos = lista.filter((t) => t.ativo);
    const hoje = hojeSP();
    const progresso = funcs.map((f) => {
      const dele = ativos.filter((t) => !t.funcao || t.funcao === f.funcao);
      const feitosDele = dele.filter((t) => feitos.some((x) => x.funcionario_id === f.id && x.treinamento_id === t.id));
      const atrasados = f.admissao ? dele.filter((t) => !feitosDele.includes(t) && somaDias(f.admissao!, Number(t.prazo_dias)) < hoje).length : 0;
      return { id: f.id, nome: f.nome, funcao: f.funcao, admissao: f.admissao, total: dele.length, feitos: feitosDele.length, atrasados };
    });
    return {
      treinamentos: lista.map((t) => ({ id: t.id, titulo: t.titulo, descricao: t.descricao, funcao: t.funcao, tipo: t.tipo, url: t.url, prazoDias: Number(t.prazo_dias), ordem: Number(t.ordem), ativo: t.ativo })),
      progresso,
      funcoes: NOME_FUNCAO,
    };
  }

  async salvarTreinamento(u: UsuarioToken, dto: TreinamentoDto, id?: string) {
    if ((dto.tipo === 'video' || dto.tipo === 'link') && !/^https:\/\/\S+$/.test(dto.url ?? '')) throw new BadRequestException('Para vídeo ou link, informe o endereço começando com https://');
    const v = [u.empresaId, dto.titulo.trim(), dto.descricao?.trim() || null, dto.funcao || null, dto.tipo, dto.url?.trim() || null, dto.prazoDias ?? 7, dto.ordem ?? 0, dto.ativo ?? true];
    if (id) {
      const [linhas] = await this.ds.query(`UPDATE treinamentos SET titulo = $2, descricao = $3, funcao = $4, tipo = $5, url = $6, prazo_dias = $7, ordem = $8, ativo = $9 WHERE empresa_id = $1 AND id = $10 RETURNING id`, [...v, id]);
      if (!linhas?.length) throw new NotFoundException('Treinamento não encontrado.');
    } else {
      await this.ds.query(`INSERT INTO treinamentos (empresa_id, titulo, descricao, funcao, tipo, url, prazo_dias, ordem, ativo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, v);
    }
    return this.treinamentos(u);
  }

  async apagarTreinamento(u: UsuarioToken, id: string) {
    await this.ds.query(`DELETE FROM treinamentos WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    return this.treinamentos(u);
  }

  /** cria a lista de integração padrão (só o que ainda não existe com o mesmo título) */
  async listaPadrao(u: UsuarioToken) {
    let ordem = 0;
    for (const t of LISTA_PADRAO) {
      ordem += 10;
      await this.ds.query(
        `INSERT INTO treinamentos (empresa_id, titulo, descricao, funcao, tipo, prazo_dias, ordem)
         SELECT $1::uuid, $2::varchar, $3::varchar, $4::varchar, $5::varchar, $6::int, $7::int
          WHERE NOT EXISTS (SELECT 1 FROM treinamentos WHERE empresa_id = $1::uuid AND lower(titulo) = lower($2::varchar))`,
        [u.empresaId, t.titulo, t.descricao, t.funcao, t.tipo, t.prazo, ordem]);
    }
    return this.treinamentos(u);
  }

  /** checklist de um funcionário: o que vale para a função dele, feito ou não, e o prazo */
  async checklist(u: UsuarioToken, funcionarioId: string) {
    const [f] = await this.ds.query(`SELECT id, nome, funcao, to_char(admissao, 'YYYY-MM-DD') AS admissao FROM funcionarios WHERE id = $1 AND empresa_id = $2`, [funcionarioId, u.empresaId]);
    if (!f) throw new NotFoundException('Funcionário não encontrado.');
    const itens: Record<string, unknown>[] = await this.ds.query(
      `SELECT t.*, tf.concluido_em, tf.confirmado_por, tf.observacao AS obs FROM treinamentos t
         LEFT JOIN treinamento_feitos tf ON tf.treinamento_id = t.id AND tf.funcionario_id = $2
        WHERE t.empresa_id = $1 AND t.ativo AND (t.funcao IS NULL OR t.funcao = $3) ORDER BY t.ordem, t.titulo`, [u.empresaId, funcionarioId, f.funcao]);
    const hoje = hojeSP();
    return {
      funcionario: { id: f.id, nome: f.nome, funcao: f.funcao, admissao: f.admissao },
      itens: itens.map((t) => {
        const prazo = f.admissao ? somaDias(f.admissao, Number(t.prazo_dias)) : null;
        return {
          id: t.id, titulo: t.titulo, descricao: t.descricao, tipo: t.tipo, url: t.url, funcao: t.funcao, prazo,
          feito: !!t.concluido_em, concluidoEm: t.concluido_em ?? null, confirmadoPor: t.confirmado_por ?? null, observacao: t.obs ?? null,
          atrasado: !t.concluido_em && !!prazo && prazo < hoje,
        };
      }),
    };
  }

  async marcar(u: UsuarioToken, funcionarioId: string, treinamentoId: string, dto: FeitoDto) {
    const [t] = await this.ds.query(`SELECT id FROM treinamentos WHERE id = $1 AND empresa_id = $2`, [treinamentoId, u.empresaId]);
    if (!t) throw new NotFoundException('Treinamento não encontrado.');
    if (dto.feito) {
      await this.ds.query(
        `INSERT INTO treinamento_feitos (funcionario_id, treinamento_id, empresa_id, confirmado_por, observacao) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (funcionario_id, treinamento_id) DO UPDATE SET observacao = EXCLUDED.observacao`,
        [funcionarioId, treinamentoId, u.empresaId, u.nome, dto.observacao?.trim() || null]);
    } else {
      await this.ds.query(`DELETE FROM treinamento_feitos WHERE funcionario_id = $1 AND treinamento_id = $2 AND empresa_id = $3`, [funcionarioId, treinamentoId, u.empresaId]);
    }
    return this.checklist(u, funcionarioId);
  }
}

@Controller('rh')
export class RhExtraController {
  constructor(private readonly service: RhExtraService) {}

  @Get('escala-sugerida')
  @Requer('funcionarios.gerenciar')
  sugerida(@Usuario() u: UsuarioToken, @Query('inicio') inicio?: string) { return this.service.escalaSugerida(u, inicio); }

  @Get('escala-sugerida/config')
  @Requer('funcionarios.gerenciar')
  configEscala(@Usuario() u: UsuarioToken) { return this.service.configEscala(u); }

  @Put('escala-sugerida/config')
  @Requer('funcionarios.gerenciar')
  salvarConfigEscala(@Usuario() u: UsuarioToken, @Body() dto: ConfigEscalaDto) { return this.service.salvarConfigEscala(u, dto); }

  @Get('comissoes')
  @Requer('funcionarios.financeiro', 'funcionarios.gerenciar')
  comissoes(@Usuario() u: UsuarioToken, @Query('de') de?: string, @Query('ate') ate?: string) { return this.service.comissoes(u, de, ate); }

  @Put('comissoes/config')
  @Requer('funcionarios.financeiro')
  salvarComissoes(@Usuario() u: UsuarioToken, @Body() dto: ConfigComissoesDto) { return this.service.salvarComissoes(u, dto); }

  @Post('comissoes/lancar')
  @HttpCode(200)
  @Requer('funcionarios.financeiro')
  lancar(@Usuario() u: UsuarioToken, @Body() dto: LancarComissaoDto) { return this.service.lancarComissoes(u, dto); }

  @Get('treinamentos')
  @Requer('funcionarios.gerenciar')
  treinamentos(@Usuario() u: UsuarioToken) { return this.service.treinamentos(u); }

  @Post('treinamentos')
  @Requer('funcionarios.gerenciar')
  criarTreinamento(@Usuario() u: UsuarioToken, @Body() dto: TreinamentoDto) { return this.service.salvarTreinamento(u, dto); }

  @Post('treinamentos/padrao')
  @HttpCode(200)
  @Requer('funcionarios.gerenciar')
  padrao(@Usuario() u: UsuarioToken) { return this.service.listaPadrao(u); }

  @Patch('treinamentos/:id')
  @Requer('funcionarios.gerenciar')
  editarTreinamento(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TreinamentoDto) { return this.service.salvarTreinamento(u, dto, id); }

  @Delete('treinamentos/:id')
  @Requer('funcionarios.gerenciar')
  apagarTreinamento(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.apagarTreinamento(u, id); }

  @Get('treinamentos/funcionario/:id')
  @Requer('funcionarios.gerenciar')
  checklist(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.checklist(u, id); }

  @Put('treinamentos/funcionario/:id/:treinamentoId')
  @Requer('funcionarios.gerenciar')
  marcar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Param('treinamentoId', ParseUUIDPipe) tid: string, @Body() dto: FeitoDto) {
    return this.service.marcar(u, id, tid, dto);
  }
}
