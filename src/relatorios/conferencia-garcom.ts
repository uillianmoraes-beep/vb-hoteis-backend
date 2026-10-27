import { BadRequestException, Body, Controller, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

/**
 * Conferência com o garçom por turno: quantos de cada item da geladeira saíram no turno
 * (contas das suítes, pedidos ao quarto e vendas de balcão), para ele repor para o próximo turno.
 * Quais itens entram: grupos de produto escolhidos pelo gestor, mais itens avulsos, menos os tirados.
 */

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const somaDias = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const momento = (d: string, h: string) => new Date(`${d}T${h}:00-03:00`);
const minutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
/** quando o gestor ainda não escolheu: os grupos com cara de bebida */
const PARECE_GELADEIRA = /bebid|refri|cervej|[áa]gua|suco|drink|geladeira|energ|chopp/i;
/** turnos usados quando a escala ainda não tem turnos cadastrados */
const PADRAO = [
  { id: 'manha', nome: 'Manhã', inicio: '06:00', fim: '14:00' },
  { id: 'tarde', nome: 'Tarde', inicio: '14:00', fim: '22:00' },
  { id: 'noite', nome: 'Noite', inicio: '22:00', fim: '06:00' },
];

interface Config { grupos?: string[]; extras?: string[]; fora?: string[] }

class ConfigConferenciaDto {
  @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) @MaxLength(60, { each: true }) grupos!: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(1000) @IsUUID('4', { each: true }) extras?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(1000) @IsUUID('4', { each: true }) fora?: string[];
}

class ConferidoDto {
  @Matches(DATA) data!: string;
  @IsOptional() @IsString() @MaxLength(60) turnoId?: string;
  @IsOptional() @Matches(HORA) inicio?: string;
  @IsOptional() @Matches(HORA) fim?: string;
  @IsOptional() @IsUUID() ambienteId?: string;
  @IsOptional() @IsString() @MaxLength(120) garcom?: string;
  @IsIn(['gerente', 'garcom', 'estoquista']) papel!: 'gerente' | 'garcom' | 'estoquista';
  @IsOptional() @IsString() @MaxLength(300) observacao?: string;
}

class EntregadorDto {
  @IsOptional() @IsUUID() funcionarioId?: string | null;
}

type Filtro = { data?: string; turnoId?: string; inicio?: string; fim?: string; ambienteId?: string; garcom?: string };
const SEM_GARCOM = 'Sem garçom marcado';

@Injectable()
export class ConferenciaGarcomService {
  constructor(private readonly ds: DataSource) {}

  private async config(empresaId: string): Promise<Config> {
    const [e] = await this.ds.query(`SELECT config_conferencia AS c FROM empresas WHERE id = $1`, [empresaId]);
    return (e?.c ?? {}) as Config;
  }

  /** garçons ativos: os da escala de hoje primeiro, depois os outros do cadastro */
  async garcons(u: UsuarioToken) {
    const data = hojeSP();
    const todos: { id: string; nome: string; inicio: string | null; fim: string | null; escala: boolean }[] = await this.ds.query(
      `SELECT f.id, f.nome, e.inicio::text AS inicio, e.fim::text AS fim, (e.funcionario_id IS NOT NULL) AS escala
         FROM funcionarios f
         LEFT JOIN escala_dias e ON e.funcionario_id = f.id AND e.data = $2 AND e.tipo = 'trabalho'
        WHERE f.empresa_id = $1 AND f.ativo AND f.funcao = 'garcom' ORDER BY (e.funcionario_id IS NULL), f.nome`, [u.empresaId, data]);
    const vistos = new Set<string>();
    return todos.filter((g) => !vistos.has(g.id) && !!vistos.add(g.id))
      .map((g) => ({ id: g.id, nome: g.nome, hoje: !!g.escala, horario: g.inicio && g.fim ? `${g.inicio.slice(0, 5)} às ${g.fim.slice(0, 5)}` : null }));
  }

  /** o garçom que entregou aquele uso (escolhido ao fechar a conta) */
  async entregador(u: UsuarioToken, estadiaId: string, dto: EntregadorDto) {
    let nome: string | null = null;
    if (dto.funcionarioId) {
      const [f] = await this.ds.query(`SELECT nome FROM funcionarios WHERE id = $1 AND empresa_id = $2`, [dto.funcionarioId, u.empresaId]);
      if (!f) throw new NotFoundException('Garçom não encontrado.');
      nome = f.nome;
    }
    const [linhas] = await this.ds.query(`UPDATE estadias SET entregador_id = $3, entregador_nome = $4 WHERE id = $1 AND empresa_id = $2 RETURNING id`,
      [estadiaId, u.empresaId, dto.funcionarioId ?? null, nome]);
    if (!linhas?.length) throw new NotFoundException('Conta não encontrada.');
    return { entregador: nome };
  }

  /** marca o turno como conferido (guarda a lista daquela hora) */
  async conferir(u: UsuarioToken, dto: ConferidoDto) {
    const v = await this.ver(u, dto);
    const [r] = await this.ds.query(
      `INSERT INTO conferencias_garcom (empresa_id, data, turno, de, ate, ambiente_id, papel, usuario_id, usuario_nome, garcom, total_itens, itens, observacao)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13) RETURNING id, criado_em`,
      [u.empresaId, v.data, `${v.turno.nome} (${v.turno.inicio} às ${v.turno.fim})`, v.de, v.ate, dto.ambienteId ?? null, dto.papel, u.sub, u.nome ?? 'Usuário',
        dto.garcom?.trim() || null, v.totalItens, JSON.stringify(v.itens.map((i) => ({ nome: i.nome, quantidade: i.quantidade, unidade: i.unidade }))), dto.observacao?.trim() || null]);
    return { id: r.id, criadoEm: r.criado_em };
  }

  /** conferências feitas nos últimos dias */
  async historico(u: UsuarioToken, dias = 30) {
    const l: Record<string, unknown>[] = await this.ds.query(
      `SELECT c.id, to_char(c.data, 'YYYY-MM-DD') AS data, c.turno, c.papel, c.usuario_nome, c.garcom, c.total_itens, c.observacao, c.criado_em, a.nome AS ambiente
         FROM conferencias_garcom c LEFT JOIN ambientes a ON a.id = c.ambiente_id
        WHERE c.empresa_id = $1 AND c.data >= (now() AT TIME ZONE 'America/Sao_Paulo')::date - $2::int ORDER BY c.criado_em DESC LIMIT 300`, [u.empresaId, dias]);
    return l.map((c) => ({ id: c.id, data: c.data, turno: c.turno, papel: c.papel, quem: c.usuario_nome, garcom: c.garcom, totalItens: Number(c.total_itens),
      observacao: c.observacao, em: c.criado_em, ambiente: c.ambiente }));
  }

  async ver(u: UsuarioToken, q: Filtro) {
    const data = q.data && DATA.test(q.data) ? q.data : hojeSP();
    const daEscala = (await this.ds.query(
      `SELECT id, nome, inicio, fim FROM escala_turnos WHERE empresa_id = $1 AND ativo ORDER BY inicio, nome`, [u.empresaId]))
      .map((t: Record<string, string>) => ({ id: t.id, nome: t.nome, inicio: String(t.inicio).slice(0, 5), fim: String(t.fim).slice(0, 5) }));
    const turnos: { id: string; nome: string; inicio: string; fim: string }[] = daEscala.length ? daEscala : PADRAO;

    // a janela do turno: escolhido, horário livre ou o turno de agora
    let turno = q.turnoId ? turnos.find((t) => t.id === q.turnoId) : undefined;
    if (!turno && q.inicio && q.fim) {
      if (!HORA.test(q.inicio) || !HORA.test(q.fim)) throw new BadRequestException('Horário inválido.');
      turno = { id: '', nome: 'Horário escolhido', inicio: q.inicio, fim: q.fim };
    }
    if (!turno) {
      const agora = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false });
      const m = minutos(agora);
      turno = turnos.find((t) => {
        const i = minutos(t.inicio), f = minutos(t.fim);
        return f > i ? m >= i && m < f : m >= i || m < f;
      }) ?? turnos[0];
    }
    const de = momento(data, turno.inicio);
    const ate = momento(minutos(turno.fim) > minutos(turno.inicio) ? data : somaDias(data, 1), turno.fim);

    const amb = q.ambienteId ? (u.ambientesIds?.length && !u.ambientesIds.includes(q.ambienteId) ? [] : [q.ambienteId]) : u.ambientesIds?.length ? u.ambientesIds : null;
    const filtro = (col: string) => (amb ? ` AND ${col} = ANY($4::uuid[])` : '');
    const p: unknown[] = [u.empresaId, de, ate];
    if (amb) p.push(amb);

    const cfg = await this.config(u.empresaId);
    const catalogo = (await this.ds.query(
      `SELECT id, nome, grupo, unidade FROM produtos WHERE empresa_id = $1 AND ativo AND tipo = 'produto' AND uso = 'venda' ORDER BY grupo NULLS LAST, nome`, [u.empresaId]))
      .map((x: Record<string, string | null>) => ({ id: x.id as string, nome: x.nome as string, grupo: x.grupo ?? 'Sem grupo', unidade: x.unidade ?? 'un' }));
    const escolhido = !!cfg.grupos;
    const todos: string[] = [...new Set<string>(catalogo.map((x: { grupo: string }) => x.grupo))];
    const grupos = new Set(cfg.grupos ?? todos.filter((g) => PARECE_GELADEIRA.test(g)));
    const extras = new Set(cfg.extras ?? []), fora = new Set(cfg.fora ?? []);
    const entra = (x: { id: string; grupo: string; nome: string }) => !fora.has(x.id) && (grupos.has(x.grupo) || extras.has(x.id) || (!escolhido && PARECE_GELADEIRA.test(x.nome)));
    const ids = catalogo.filter(entra).map((x: { id: string }) => x.id);

    const vendas: Record<string, string | null>[] = ids.length ? await this.ds.query(
      `WITH v AS (
         SELECT i.produto_id, i.quantidade::numeric AS qtd, i.total::numeric AS total, 'conta' AS onde, COALESCE(i.usuario_nome, '—') AS quem, e.entregador_nome AS entregador
           FROM estadia_itens i JOIN estadias e ON e.id = i.estadia_id
          WHERE i.empresa_id = $1 AND i.status = 'ativo' AND e.status <> 'cancelada' AND i.produto_id IS NOT NULL
            AND i.criado_em >= $2 AND i.criado_em < $3${filtro('e.ambiente_id')}
         UNION ALL
         SELECT (x->>'produtoId')::uuid, (x->>'quantidade')::numeric, (x->>'total')::numeric, 'balcao', COALESCE(va.usuario_nome, '—'), NULL::varchar
           FROM vendas_avulsas va, jsonb_array_elements(va.itens) x
          WHERE va.empresa_id = $1 AND NOT va.cancelada AND va.criado_em >= $2 AND va.criado_em < $3${filtro('va.ambiente_id')})
       SELECT produto_id, onde, quem, entregador, sum(qtd) AS qtd, sum(total) AS total FROM v
        WHERE produto_id = ANY($${amb ? 5 : 4}::uuid[]) GROUP BY 1, 2, 3, 4`, [...p, ids]) : [];
    // quanto cada garçom entregou nas suítes; com um garçom escolhido, só os usos que ele entregou
    const porGarcom = new Map<string, number>();
    for (const v of vendas) {
      if (v.onde !== 'conta') continue;
      const g = (v.entregador as string | null) || SEM_GARCOM;
      porGarcom.set(g, (porGarcom.get(g) ?? 0) + Number(v.qtd));
    }
    const garcomSel = q.garcom?.trim() || '';
    const vendasFiltradas = garcomSel ? vendas.filter((v) => v.onde === 'conta' && ((v.entregador as string | null) || SEM_GARCOM) === garcomSel) : vendas;

    const mapa = new Map(catalogo.map((x: { id: string }) => [x.id, x]));
    const porItem = new Map<string, { id: string; nome: string; grupo: string; unidade: string; quantidade: number; nasContas: number; noBalcao: number; total: number }>();
    const porPessoa = new Map<string, number>();
    for (const v of vendasFiltradas) {
      const pr = mapa.get(v.produto_id as string) as { id: string; nome: string; grupo: string; unidade: string } | undefined;
      if (!pr) continue;
      const qtd = Number(v.qtd), tot = Number(v.total);
      const a = porItem.get(pr.id) ?? { ...pr, quantidade: 0, nasContas: 0, noBalcao: 0, total: 0 };
      a.quantidade += qtd; a.total += tot;
      if (v.onde === 'conta') a.nasContas += qtd; else a.noBalcao += qtd;
      porItem.set(pr.id, a);
      porPessoa.set(v.quem as string, (porPessoa.get(v.quem as string) ?? 0) + qtd);
    }
    const arred = (n: number) => Math.round(n * 1000) / 1000;
    const itens = [...porItem.values()].map((x) => ({ ...x, quantidade: arred(x.quantidade), nasContas: arred(x.nasContas), noBalcao: arred(x.noBalcao), total: Math.round(x.total * 100) / 100 }))
      .sort((a, b) => a.grupo.localeCompare(b.grupo, 'pt-BR') || b.quantidade - a.quantidade || a.nome.localeCompare(b.nome, 'pt-BR'));

    // garçons que estavam na escala nesse turno
    const ini = minutos(turno.inicio), fimT = ini + ((minutos(turno.fim) - ini + 1440) % 1440 || 1440);
    const naEscala: string[] = (await this.ds.query(
      `SELECT f.nome, e.inicio, e.fim, e.turno_id FROM escala_dias e JOIN funcionarios f ON f.id = e.funcionario_id
        WHERE e.empresa_id = $1 AND e.data = $2 AND e.tipo = 'trabalho' AND f.ativo AND f.funcao = 'garcom' ORDER BY f.nome`, [u.empresaId, data]))
      .filter((g: Record<string, string | null>) => {
        if (turno!.id && g.turno_id === turno!.id) return true;
        if (!g.inicio || !g.fim) return false;
        const gi = minutos(g.inicio), gf = gi + ((minutos(g.fim) - gi + 1440) % 1440 || 1440);
        return gi < fimT && gf > ini;
      })
      .map((g: Record<string, string | null>) => g.nome as string);
    // garçons do dia (todos da escala) e, sem escala, os do cadastro
    const doDia: string[] = (await this.ds.query(
      `SELECT DISTINCT f.nome FROM escala_dias e JOIN funcionarios f ON f.id = e.funcionario_id
        WHERE e.empresa_id = $1 AND e.data = $2 AND e.tipo = 'trabalho' AND f.ativo AND f.funcao = 'garcom' ORDER BY f.nome`, [u.empresaId, data]))
      .map((g: { nome: string }) => g.nome);
    const cadastro: string[] = doDia.length ? [] : (await this.ds.query(
      `SELECT nome FROM funcionarios WHERE empresa_id = $1 AND ativo AND funcao = 'garcom' ORDER BY nome`, [u.empresaId])).map((g: { nome: string }) => g.nome);
    const garcons = [...new Set(naEscala)];
    const conferidos = (await this.ds.query(
      `SELECT papel, usuario_nome, garcom, criado_em, observacao FROM conferencias_garcom
        WHERE empresa_id = $1 AND de = $2 AND ate = $3 AND ambiente_id IS NOT DISTINCT FROM $4::uuid ORDER BY criado_em`,
      [u.empresaId, de, ate, q.ambienteId || null])).map((c: Record<string, unknown>) => ({ papel: c.papel, quem: c.usuario_nome, garcom: c.garcom, em: c.criado_em, observacao: c.observacao }));

    return {
      data, turno, turnos, de, ate, garcons, garconsDoDia: doDia, garconsCadastro: cadastro, garcom: garcomSel || null, conferidos,
      porGarcom: [...porGarcom.entries()].map(([nome, quantidade]) => ({ nome, quantidade: arred(quantidade) })).sort((a, b) => b.quantidade - a.quantidade),
      itens,
      totalItens: arred(itens.reduce((s, x) => s + x.quantidade, 0)),
      porPessoa: [...porPessoa.entries()].map(([nome, quantidade]) => ({ nome, quantidade: arred(quantidade) })).sort((a, b) => b.quantidade - a.quantidade),
      config: { escolhido, grupos: [...grupos], extras: [...extras], fora: [...fora], dentro: ids },
      catalogo,
    };
  }

  async salvarConfig(u: UsuarioToken, dto: ConfigConferenciaDto) {
    const cfg: Config = { grupos: [...new Set(dto.grupos.map((g) => g.trim()).filter(Boolean))], extras: [...new Set(dto.extras ?? [])], fora: [...new Set(dto.fora ?? [])] };
    await this.ds.query(`UPDATE empresas SET config_conferencia = $2::jsonb WHERE id = $1`, [u.empresaId, JSON.stringify(cfg)]);
    return cfg;
  }
}

@Controller('relatorios/conferencia-garcom')
export class ConferenciaGarcomController {
  constructor(private readonly service: ConferenciaGarcomService) {}

  @Get()
  @Requer('relatorios.ver', 'estadias.operar', 'caixa.relatorios', 'estoque.gerenciar')
  ver(@Usuario() u: UsuarioToken, @Query('data') data?: string, @Query('turnoId') turnoId?: string, @Query('inicio') inicio?: string,
      @Query('fim') fim?: string, @Query('ambienteId') ambienteId?: string, @Query('garcom') garcom?: string) {
    return this.service.ver(u, { data, turnoId, inicio, fim, ambienteId, garcom });
  }

  /** "Conferido": o gerente, o próprio garçom ou o estoquista */
  @Post('conferido')
  @Requer('relatorios.ver', 'estadias.operar', 'caixa.relatorios', 'estoque.gerenciar')
  conferir(@Usuario() u: UsuarioToken, @Body() dto: ConferidoDto) {
    return this.service.conferir(u, dto);
  }

  @Get('historico')
  @Requer('relatorios.ver', 'estadias.operar', 'caixa.relatorios', 'estoque.gerenciar')
  historico(@Usuario() u: UsuarioToken) {
    return this.service.historico(u);
  }

  /** garçons para escolher quem entregou o uso */
  @Get('garcons')
  @Requer('estadias.operar', 'painel.ver', 'relatorios.ver', 'caixa.principal')
  garcons(@Usuario() u: UsuarioToken) {
    return this.service.garcons(u);
  }

  @Put('entregador/:estadiaId')
  @Requer('estadias.operar', 'caixa.principal')
  entregador(@Usuario() u: UsuarioToken, @Param('estadiaId', ParseUUIDPipe) estadiaId: string, @Body() dto: EntregadorDto) {
    return this.service.entregador(u, estadiaId, dto);
  }

  /** quais itens entram na conferência (grupos, itens a mais e itens tirados) */
  @Put('config')
  @Requer('produtos.gerenciar', 'empresa.editar')
  salvar(@Usuario() u: UsuarioToken, @Body() dto: ConfigConferenciaDto) {
    return this.service.salvarConfig(u, dto);
  }
}
