import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { Socket } from 'net';
import { UsuarioToken } from '../common/permissoes';
import { montarTicket, type LinhaTicket } from './escpos';

export interface ItemImpressao { produtoId?: string | null; nome: string; quantidade: number; obs?: string | null }

const hash = (t: string) => createHash('sha256').update(t).digest('hex');
const qtd = (n: number) => (Number.isInteger(n) ? String(n) : n.toLocaleString('pt-BR', { maximumFractionDigits: 3 }));
const horaSP = () => new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** o próprio servidor manda direto para a impressora? (servidor local: sim; nuvem: só com o agente) */
const impressaoDireta = () => (process.env.VB_MODO || '').toLowerCase() === 'local' || process.env.VB_IMPRESSAO_DIRETA === '1';

function enviarParaImpressora(endereco: string, porta: number, dados: Buffer): Promise<void> {
  return new Promise((ok, falha) => {
    const s = new Socket();
    let terminou = false;
    const fim = (e?: Error) => { if (terminou) return; terminou = true; s.destroy(); if (e) falha(e); else ok(); };
    s.setTimeout(6000);
    s.once('timeout', () => fim(new Error('A impressora não respondeu (desligada, sem papel ou IP errado).')));
    s.once('error', (e: Error) => fim(new Error(`Não conectou na impressora: ${e.message}`)));
    s.connect(porta, endereco, () => { s.write(dados, () => { s.end(); setTimeout(() => fim(), 300); }); });
  });
}

@Injectable()
export class ImpressaoService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Impressao');
  private timer: ReturnType<typeof setInterval> | null = null;
  private ocupado = false;

  constructor(private readonly ds: DataSource) {}

  onModuleInit() {
    this.timer = setInterval(() => { this.ciclo().catch((e) => this.log.error(`Fila de impressão: ${e instanceof Error ? e.message : e}`)); }, 2000);
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  // ---------------- cadastro ----------------

  async listar(u: UsuarioToken) {
    const l = await this.ds.query(
      `SELECT i.*, a.nome AS ambiente FROM impressoras i LEFT JOIN ambientes a ON a.id = i.ambiente_id WHERE i.empresa_id = $1 ORDER BY i.nome`, [u.empresaId]);
    const fila = await this.ds.query(
      `SELECT f.id, f.origem, f.status, f.tentativas, f.erro, f.criado_em, f.impresso_em, f.texto, i.nome AS impressora FROM impressao_fila f JOIN impressoras i ON i.id = f.impressora_id
        WHERE f.empresa_id = $1 ORDER BY f.criado_em DESC LIMIT 60`, [u.empresaId]);
    const grupos = await this.ds.query(`SELECT DISTINCT grupo FROM produtos WHERE empresa_id = $1 AND grupo IS NOT NULL AND ativo ORDER BY grupo`, [u.empresaId]);
    const [emp] = await this.ds.query(`SELECT impressao_agente_hash IS NOT NULL AS agente FROM empresas WHERE id = $1`, [u.empresaId]);
    return {
      direta: impressaoDireta(), temAgente: !!emp?.agente,
      grupos: grupos.map((g: { grupo: string }) => g.grupo),
      impressoras: l.map((x: Record<string, unknown>) => ({
        id: x.id, nome: x.nome, endereco: x.endereco, porta: x.porta, colunas: x.colunas, ambienteId: x.ambiente_id, ambiente: x.ambiente,
        grupos: x.grupos ?? [], copias: x.copias, ativo: x.ativo,
      })),
      fila: fila.map((f: Record<string, unknown>) => ({ id: f.id, origem: f.origem, status: f.status, tentativas: f.tentativas, erro: f.erro, criadoEm: f.criado_em, impressoEm: f.impresso_em, texto: f.texto, impressora: f.impressora })),
    };
  }

  async salvar(u: UsuarioToken, id: string | null, dto: { nome: string; endereco: string; porta?: number; colunas?: number; ambienteId?: string | null; grupos?: string[]; copias?: number; ativo?: boolean }) {
    const v = [dto.nome.trim(), dto.endereco.trim(), dto.porta ?? 9100, dto.colunas ?? 48, dto.ambienteId || null, (dto.grupos ?? []).map((g) => g.trim()).filter(Boolean), dto.copias ?? 1, dto.ativo ?? true];
    if (id) {
      const r = await this.ds.query(
        `UPDATE impressoras SET nome=$3, endereco=$4, porta=$5, colunas=$6, ambiente_id=$7, grupos=$8, copias=$9, ativo=$10 WHERE id=$1 AND empresa_id=$2 RETURNING id`, [id, u.empresaId, ...v]);
      if (!(Array.isArray(r?.[0]) ? r[0] : r).length) throw new NotFoundException('Impressora não encontrada.');
      return { id };
    }
    const [n] = await this.ds.query(
      `INSERT INTO impressoras (empresa_id, nome, endereco, porta, colunas, ambiente_id, grupos, copias, ativo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [u.empresaId, ...v]);
    return { id: n.id };
  }

  async excluir(u: UsuarioToken, id: string) {
    await this.ds.query(`DELETE FROM impressoras WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    return { ok: true };
  }

  async testar(u: UsuarioToken, id: string) {
    const [i] = await this.ds.query(`SELECT * FROM impressoras WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!i) throw new NotFoundException('Impressora não encontrada.');
    const t = montarTicket([
      { t: 'TESTE DE IMPRESSAO', grande: true, centro: true },
      { t: i.nome, centro: true },
      { t: `${i.endereco}:${i.porta} · ${i.colunas} colunas`, centro: true },
      { t: '-'.repeat(i.colunas) },
      { t: `Ola! Se voce esta lendo isto, a impressora esta pronta. ${horaSP()}` },
    ], i.colunas, 1);
    await this.ds.query(`INSERT INTO impressao_fila (empresa_id, impressora_id, origem, texto, dados) VALUES ($1,$2,'teste',$3,$4)`, [u.empresaId, i.id, t.texto, t.dados]);
    return { ok: true, direta: impressaoDireta() };
  }

  async reenviar(u: UsuarioToken, id: string) {
    await this.ds.query(`UPDATE impressao_fila SET status = 'pendente', tentativas = 0, proxima_tentativa = NULL, erro = NULL WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    return { ok: true };
  }

  // ---------------- comanda de preparo ----------------

  /**
   * Manda os itens para as impressoras certas (pelo grupo do produto e pelo ambiente).
   * Não trava quem lançou: erros só vão para o log.
   */
  async producao(empresaId: string, p: { ambienteId?: string | null; unidadeId?: string | null; local?: string; titulo?: string; origem: string; usuario?: string; obs?: string | null; itens: ItemImpressao[] }) {
    try {
      if (!p.itens.length) return;
      const imps = await this.ds.query(
        `SELECT * FROM impressoras WHERE empresa_id = $1 AND ativo AND (ambiente_id IS NULL OR ambiente_id = $2)`, [empresaId, p.ambienteId ?? null]);
      if (!imps.length) return;
      const ids = p.itens.map((i) => i.produtoId).filter((x): x is string => !!x);
      const grupos = new Map<string, string | null>();
      if (ids.length) {
        const g = await this.ds.query(`SELECT id, grupo FROM produtos WHERE id = ANY($1::uuid[])`, [ids]);
        for (const x of g) grupos.set(x.id, x.grupo);
      }
      let local = p.local;
      if (!local && p.unidadeId) {
        const [un] = await this.ds.query(`SELECT codigo, tipo FROM unidades WHERE id = $1`, [p.unidadeId]);
        if (un) local = `${un.tipo === 'quarto' ? 'Quarto' : un.tipo === 'mesa' ? 'Mesa' : 'Suite'} ${un.codigo}`;
      }
      for (const imp of imps) {
        const daqui = p.itens.filter((i) => {
          if (!(imp.grupos ?? []).length) return true;
          const g = i.produtoId ? grupos.get(i.produtoId) : null;
          return !!g && (imp.grupos as string[]).some((x) => x.toLowerCase() === g.toLowerCase());
        });
        if (!daqui.length) continue;
        const linhas: LinhaTicket[] = [
          { t: p.titulo ?? 'COMANDA', grande: true, centro: true },
          ...(local ? [{ t: local, grande: true, centro: true }] : []),
          { t: horaSP(), centro: true },
          { t: '-'.repeat(imp.colunas) },
          ...daqui.flatMap((i) => [{ t: `${qtd(i.quantidade)}x ${i.nome}`, negrito: true }, ...(i.obs ? [{ t: `   obs: ${i.obs}` }] : [])]),
          { t: '-'.repeat(imp.colunas) },
          ...(p.obs ? [{ t: `Obs.: ${p.obs}` }] : []),
          ...(p.usuario ? [{ t: `Lancado por ${p.usuario}` }] : []),
        ];
        const t = montarTicket(linhas, imp.colunas, imp.copias);
        await this.ds.query(`INSERT INTO impressao_fila (empresa_id, impressora_id, origem, texto, dados) VALUES ($1,$2,$3,$4,$5)`, [empresaId, imp.id, p.origem, t.texto, t.dados]);
      }
    } catch (e) {
      this.log.error(`Comanda não enfileirada: ${e instanceof Error ? e.message : e}`);
    }
  }

  // ---------------- envio ----------------

  private async ciclo() {
    if (this.ocupado) return;
    this.ocupado = true;
    try {
      // trabalho travado há mais de 2 minutos volta para a fila
      await this.ds.query(`UPDATE impressao_fila SET status = 'pendente' WHERE status = 'enviando' AND COALESCE(proxima_tentativa, criado_em) < now() - interval '2 minutes'`);
      if (!impressaoDireta()) return;
      const jobs = await this.pegar(null, 10);
      for (const j of jobs) {
        try {
          await enviarParaImpressora(j.endereco, j.porta, Buffer.from(j.dados, 'base64'));
          await this.resultado(j.id, true);
        } catch (e) {
          await this.resultado(j.id, false, e instanceof Error ? e.message : String(e));
        }
      }
    } finally {
      this.ocupado = false;
    }
  }

  private async pegar(empresaId: string | null, limite: number) {
    const params: unknown[] = [limite];
    let w = '';
    if (empresaId) { params.push(empresaId); w = ' AND f.empresa_id = $2'; }
    const r = await this.ds.query(
      `UPDATE impressao_fila SET status = 'enviando', tentativas = tentativas + 1, proxima_tentativa = now()
        WHERE id IN (SELECT f.id FROM impressao_fila f WHERE f.status = 'pendente' AND (f.proxima_tentativa IS NULL OR f.proxima_tentativa <= now())${w}
                      ORDER BY f.criado_em LIMIT $1 FOR UPDATE SKIP LOCKED)
        RETURNING id, impressora_id, dados`, params);
    const linhas = Array.isArray(r?.[0]) ? r[0] : r;
    if (!linhas.length) return [];
    const imps = await this.ds.query(`SELECT id, endereco, porta FROM impressoras WHERE id = ANY($1::uuid[])`, [linhas.map((x: { impressora_id: string }) => x.impressora_id)]);
    const m = new Map(imps.map((i: { id: string }) => [i.id, i]));
    return linhas.map((x: { id: string; impressora_id: string; dados: string }) => {
      const i = m.get(x.impressora_id) as { endereco: string; porta: number } | undefined;
      return { id: x.id, endereco: i?.endereco ?? '', porta: i?.porta ?? 9100, dados: x.dados };
    });
  }

  private async resultado(id: string, ok: boolean, erro?: string) {
    if (ok) {
      await this.ds.query(`UPDATE impressao_fila SET status = 'impresso', impresso_em = now(), erro = NULL WHERE id = $1`, [id]);
    } else {
      await this.ds.query(
        `UPDATE impressao_fila SET status = CASE WHEN tentativas >= 5 THEN 'erro' ELSE 'pendente' END,
                proxima_tentativa = now() + (tentativas * interval '10 seconds'), erro = $2 WHERE id = $1`, [id, (erro ?? 'Falha').slice(0, 300)]);
    }
  }

  // ---------------- agente de impressão (sistema na nuvem) ----------------

  async gerarTokenAgente(u: UsuarioToken) {
    const token = `vbi_${randomBytes(24).toString('hex')}`;
    await this.ds.query(`UPDATE empresas SET impressao_agente_hash = $2 WHERE id = $1`, [u.empresaId, hash(token)]);
    return { token };
  }

  private async empresaDoAgente(token?: string): Promise<string> {
    if (!/^vbi_[0-9a-f]{48}$/.test(token ?? '')) throw new ForbiddenException('Token do agente inválido.');
    const [e] = await this.ds.query(`SELECT id, impressao_agente_hash FROM empresas WHERE impressao_agente_hash = $1`, [hash(token!)]);
    if (!e) throw new ForbiddenException('Token do agente inválido ou trocado.');
    const a = Buffer.from(hash(token!)); const b = Buffer.from(e.impressao_agente_hash);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ForbiddenException('Token do agente inválido.');
    return e.id;
  }

  async filaAgente(token?: string) {
    const empresaId = await this.empresaDoAgente(token);
    return this.pegar(empresaId, 10);
  }

  async resultadoAgente(token: string | undefined, id: string, ok: boolean, erro?: string) {
    const empresaId = await this.empresaDoAgente(token);
    const [j] = await this.ds.query(`SELECT id FROM impressao_fila WHERE id = $1 AND empresa_id = $2`, [id, empresaId]);
    if (!j) throw new BadRequestException('Trabalho não encontrado.');
    await this.resultado(id, ok, erro);
    return { ok: true };
  }
}
