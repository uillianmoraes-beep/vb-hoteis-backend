import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UsuarioToken } from '../common/permissoes';
import { cifrar, decifrar } from '../common/cripto';
import { ChamadoManutencaoDto } from './manutencao.dto';

/** guardado em empresas.integracao_manutencao */
interface ConfigManutencao { ativo?: boolean; url?: string; chaveCripto?: string; chaveFinal?: string; cliente?: string }

const URL_PADRAO = 'https://virtual-barra-app-manutencao-production.up.railway.app/api';
const USO = 'vb-manutencao';
const FINAIS = ['concluida', 'cancelada', 'removida'];
const ROTULO_AREA: Record<string, string> = {
  'ar-condicionado': 'Ar-condicionado', eletrica: 'Elétrica', 'informatica-redes': 'Internet/Rede', cftv: 'CFTV', telefonia: 'Telefonia',
};

class ErroApp extends Error {}

/**
 * Integração com o app de manutenção da Virtual Barra: o hotel abre chamados (viram OS lá)
 * e acompanha agendamento e conclusão. O andamento é consultado no app (sem precisar de
 * endereço público do hotel).
 */
@Injectable()
export class ManutencaoService {
  private readonly log = new Logger('ManutencaoVB');
  /** última sincronização por empresa (para não consultar o app a cada atualização do Painel) */
  private readonly ultimaSync = new Map<string, number>();
  constructor(private readonly ds: DataSource) {}

  private async cfg(empresaId: string): Promise<ConfigManutencao> {
    const [e] = await this.ds.query(`SELECT integracao_manutencao FROM empresas WHERE id = $1`, [empresaId]);
    return (e?.integracao_manutencao ?? {}) as ConfigManutencao;
  }

  private async chamar<T>(c: { url?: string; chave: string }, metodo: 'GET' | 'POST', caminho: string, corpo?: unknown): Promise<T> {
    let resp: { ok: boolean; status: number; text: () => Promise<string> };
    try {
      resp = await fetch(`${(c.url || URL_PADRAO).replace(/\/$/, '')}${caminho}`, {
        method: metodo,
        headers: { Authorization: `Bearer ${c.chave}`, 'Content-Type': 'application/json' },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
      });
    } catch {
      throw new ErroApp('Não consegui falar com o app de manutenção agora. Confira a internet e tente de novo.');
    }
    const texto = await resp.text();
    let json: any = null;
    try { json = texto ? JSON.parse(texto) : null; } catch { /* sem json */ }
    if (resp.status === 401) throw new ErroApp('O app de manutenção recusou a chave. Peça uma chave nova à Virtual Barra.');
    if (!resp.ok) {
      const m = Array.isArray(json?.message) ? json.message.join(' ') : json?.message;
      throw new ErroApp(`App de manutenção: ${m || `erro ${resp.status}`}`);
    }
    return json as T;
  }

  private async conexao(empresaId: string) {
    const c = await this.cfg(empresaId);
    if (!c.ativo || !c.chaveCripto) throw new BadRequestException('A integração com a manutenção (Virtual Barra) não está ligada.');
    return { url: c.url, chave: decifrar(c.chaveCripto, USO) };
  }

  async ativa(empresaId: string) {
    const c = await this.cfg(empresaId);
    return !!(c.ativo && c.chaveCripto);
  }

  // ---------- configuração ----------

  async config(u: UsuarioToken) {
    const c = await this.cfg(u.empresaId);
    return { ativo: !!c.ativo, url: c.url ?? URL_PADRAO, temChave: !!c.chaveCripto, chaveFinal: c.chaveFinal ?? null, cliente: c.cliente ?? null };
  }

  async salvarConfig(u: UsuarioToken, dto: { ativo: boolean; url?: string; chave?: string }) {
    const atual = await this.cfg(u.empresaId);
    const nova: ConfigManutencao = { ...atual, ativo: dto.ativo, url: dto.url?.trim() || atual.url || URL_PADRAO };
    const chave = dto.chave?.trim() || (atual.chaveCripto ? decifrar(atual.chaveCripto, USO) : '');
    if (dto.ativo && !chave) throw new BadRequestException('Cole a chave de integração gerada no app da Virtual Barra.');
    if (dto.ativo) {
      try {
        const info = await this.chamar<{ cliente: string }>({ url: nova.url, chave }, 'GET', '/integracao/v1/info');
        nova.cliente = info.cliente;
      } catch (e) {
        throw new BadRequestException(e instanceof ErroApp ? e.message : 'Não consegui testar a chave.');
      }
    }
    if (dto.chave?.trim()) { nova.chaveCripto = cifrar(chave, USO); nova.chaveFinal = chave.slice(-4); }
    await this.ds.query(`UPDATE empresas SET integracao_manutencao = $2::jsonb WHERE id = $1`, [u.empresaId, JSON.stringify(nova)]);
    return this.config(u);
  }

  /** áreas contratadas e equipamentos do hotel cadastrados no app */
  async info(u: UsuarioToken) {
    try {
      return await this.chamar<{ cliente: string; areas: { valor: string; rotulo: string }[]; equipamentos: { id: string; tag: string; nome: string | null; local: string | null; area: string | null; tipo: string | null }[] }>(
        await this.conexao(u.empresaId), 'GET', '/integracao/v1/info');
    } catch (e) {
      if (e instanceof ErroApp) throw new BadRequestException(e.message);
      throw e;
    }
  }

  // ---------- chamados ----------

  async abrir(u: UsuarioToken, dto: ChamadoManutencaoDto) {
    const con = await this.conexao(u.empresaId);
    let local = dto.local?.trim() || null;
    let ambienteId: string | null = null;
    if (dto.unidadeId) {
      const [un] = await this.ds.query(
        `SELECT un.codigo, un.tipo, un.ambiente_id, a.nome AS ambiente FROM unidades un JOIN ambientes a ON a.id = un.ambiente_id WHERE un.id = $1 AND un.empresa_id = $2`,
        [dto.unidadeId, u.empresaId]);
      if (!un) throw new NotFoundException('Unidade não encontrada.');
      ambienteId = un.ambiente_id;
      const tipo = un.tipo === 'quarto' ? 'Quarto' : un.tipo === 'suite' ? 'Suíte' : 'Unidade';
      local = local || `${un.ambiente} · ${tipo} ${un.codigo}`;
    }
    const [ch] = await this.ds.query(
      `INSERT INTO chamados_manutencao (empresa_id, unidade_id, ambiente_id, area, descricao, local, equipamento, criado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [u.empresaId, dto.unidadeId ?? null, ambienteId, dto.area, dto.descricao.trim(), local, dto.equipamento?.trim() || null, u.nome]);
    try {
      const r = await this.chamar<{ id: string; protocolo: string }>(con, 'POST', '/integracao/v1/chamados', {
        areaServico: dto.area, descricao: dto.descricao.trim(), local: local ?? undefined, equipamentoId: dto.equipamentoId,
        solicitante: u.nome.slice(0, 120), referencia: ch.id,
      });
      await this.ds.query(`UPDATE chamados_manutencao SET os_id = $2, protocolo = $3, status = 'aberta', atualizado_em = now() WHERE id = $1`, [ch.id, r.id, r.protocolo]);
      return { ok: true, id: ch.id, protocolo: r.protocolo };
    } catch (e) {
      const msg = e instanceof ErroApp ? e.message : 'Falha ao enviar o chamado.';
      await this.ds.query(`UPDATE chamados_manutencao SET status = 'erro', erro = $2, atualizado_em = now() WHERE id = $1`, [ch.id, msg.slice(0, 300)]);
      throw new BadRequestException(`${msg} O chamado ficou salvo; tente "Reenviar" depois.`);
    }
  }

  async reenviar(u: UsuarioToken, id: string) {
    const [c] = await this.ds.query(`SELECT * FROM chamados_manutencao WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!c) throw new NotFoundException('Chamado não encontrado.');
    if (c.status !== 'erro') throw new BadRequestException('Este chamado já foi enviado.');
    const con = await this.conexao(u.empresaId);
    try {
      const r = await this.chamar<{ id: string; protocolo: string }>(con, 'POST', '/integracao/v1/chamados', {
        areaServico: c.area, descricao: c.descricao, local: c.local ?? undefined, solicitante: u.nome.slice(0, 120), referencia: c.id,
      });
      await this.ds.query(`UPDATE chamados_manutencao SET os_id = $2, protocolo = $3, status = 'aberta', erro = NULL, atualizado_em = now() WHERE id = $1`, [c.id, r.id, r.protocolo]);
      return { ok: true, protocolo: r.protocolo };
    } catch (e) {
      throw new BadRequestException(e instanceof ErroApp ? e.message : 'Falha ao reenviar.');
    }
  }

  /** busca no app o andamento dos chamados em aberto */
  async sincronizar(empresaId: string, forcar = false) {
    const agora = Date.now();
    if (!forcar && agora - (this.ultimaSync.get(empresaId) ?? 0) < 120_000) return;
    this.ultimaSync.set(empresaId, agora);
    if (!(await this.ativa(empresaId))) return;
    const abertos = await this.ds.query(
      `SELECT id, os_id FROM chamados_manutencao WHERE empresa_id = $1 AND os_id IS NOT NULL AND status NOT IN ('concluida','cancelada','removida') LIMIT 200`,
      [empresaId]);
    if (!abertos.length) return;
    try {
      const con = await this.conexao(empresaId);
      const l = await this.chamar<{ id: string; status: string; dataAgendada: string | null; dataExecucao: string | null; tecnico: string | null; servico: string | null }[]>(
        con, 'GET', `/integracao/v1/chamados?ids=${abertos.map((a: { os_id: string }) => a.os_id).join(',')}`);
      for (const o of l) {
        await this.ds.query(
          `UPDATE chamados_manutencao SET status = $3::varchar, data_agendada = $4::timestamptz, tecnico = $5, servico = $6,
                  concluida_em = CASE WHEN $3::varchar = 'concluida' THEN COALESCE(concluida_em, $7::timestamptz, now()) ELSE concluida_em END,
                  atualizado_em = now()
            WHERE empresa_id = $1 AND os_id = $2`,
          [empresaId, o.id, o.status, o.dataAgendada, o.tecnico, o.servico, o.dataExecucao]);
      }
    } catch (e) {
      this.log.warn(`Sincronização da manutenção falhou: ${e instanceof Error ? e.message : e}`);
    }
  }

  async listar(u: UsuarioToken, f: { status?: string }) {
    await this.sincronizar(u.empresaId, true);
    const params: unknown[] = [u.empresaId];
    let w = '';
    if (f.status === 'abertos') w = ` AND c.status NOT IN ('concluida','cancelada','removida')`;
    else if (f.status === 'concluidos') w = ` AND c.status IN ('concluida','cancelada','removida')`;
    const l = await this.ds.query(
      `SELECT c.*, un.codigo AS unidade_codigo, un.status AS unidade_status FROM chamados_manutencao c LEFT JOIN unidades un ON un.id = c.unidade_id
        WHERE c.empresa_id = $1${w} ORDER BY c.criado_em DESC LIMIT 300`, params);
    return l.map((c: Record<string, unknown>) => ({
      id: c.id, unidadeId: c.unidade_id, unidade: c.unidade_codigo, unidadeStatus: c.unidade_status, area: c.area, areaNome: ROTULO_AREA[c.area as string] ?? c.area,
      descricao: c.descricao, local: c.local, equipamento: c.equipamento, protocolo: c.protocolo, status: c.status, erro: c.erro, tecnico: c.tecnico,
      dataAgendada: c.data_agendada, concluidaEm: c.concluida_em, servico: c.servico, criadoPor: c.criado_por, criadoEm: c.criado_em,
    }));
  }

  /** Painel: manutenções concluídas ainda não vistas neste ambiente (para liberar a suíte) */
  async avisos(u: UsuarioToken, ambienteId?: string) {
    await this.sincronizar(u.empresaId);
    const params: unknown[] = [u.empresaId];
    let w = '';
    if (ambienteId && /^[0-9a-f-]{36}$/i.test(ambienteId)) { params.push(ambienteId); w = ' AND c.ambiente_id = $2'; }
    const l = await this.ds.query(
      `SELECT c.id, c.unidade_id, c.local, c.area, c.tecnico, c.concluida_em, c.servico, un.codigo, un.status AS unidade_status
         FROM chamados_manutencao c LEFT JOIN unidades un ON un.id = c.unidade_id
        WHERE c.empresa_id = $1 AND c.status = 'concluida' AND NOT c.aviso_visto${w} ORDER BY c.concluida_em DESC LIMIT 20`, params);
    return l.map((c: Record<string, unknown>) => ({
      id: c.id, unidadeId: c.unidade_id, unidade: c.codigo, unidadeStatus: c.unidade_status, local: c.local, areaNome: ROTULO_AREA[c.area as string] ?? c.area,
      tecnico: c.tecnico, concluidaEm: c.concluida_em, servico: c.servico,
    }));
  }

  async marcarVisto(u: UsuarioToken, id: string) {
    await this.ds.query(`UPDATE chamados_manutencao SET aviso_visto = true WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    return { ok: true };
  }
}
