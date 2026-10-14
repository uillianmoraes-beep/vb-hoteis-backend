import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createHash } from 'crypto';
import { gzipSync, gunzipSync } from 'zlib';
import { decifrar } from '../common/cripto';
import { BackupService } from '../backup/backup.service';
import { CobrancaService } from '../cobranca/cobranca.service';
import { ServidorLocalService, modoLocal } from './servidor-local.service';

/** o que a internet precisa ver do servidor local (reserva online, comanda pelo 4G, Asaas) */
const TABELAS_ESPELHO = ['ambientes', 'categorias', 'unidades', 'reservas', 'estadias', 'produtos', 'pedidos', 'frigobar_categoria'];

@Injectable()
export class PonteService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Ponte');
  private timer: ReturnType<typeof setInterval> | null = null;
  private rodando = false;
  private ultimoEspelho = 0;

  constructor(
    private readonly ds: DataSource,
    private readonly backup: BackupService,
    private readonly cobranca: CobrancaService,
    private readonly servidor: ServidorLocalService,
  ) {}

  onModuleInit() {
    if (!modoLocal()) return;
    this.timer = setInterval(() => { this.sincronizar().catch(() => undefined); }, 30_000);
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  // =============== NUVEM ===============

  async eventos(empresaId: string, token?: string) {
    if (modoLocal()) throw new NotFoundException();
    await this.servidor.empresaPorToken(empresaId, token);
    const l = await this.ds.query(`SELECT id, tipo, dados FROM ponte_eventos WHERE empresa_id = $1 AND entregue_em IS NULL ORDER BY criado_em LIMIT 100`, [empresaId]);
    return l;
  }

  async confirmar(empresaId: string, token: string | undefined, ids: string[]) {
    if (modoLocal()) throw new NotFoundException();
    await this.servidor.empresaPorToken(empresaId, token);
    if (ids.length) await this.ds.query(`UPDATE ponte_eventos SET entregue_em = now() WHERE empresa_id = $1 AND id = ANY($2::uuid[])`, [empresaId, ids]);
    await this.ds.query(`DELETE FROM ponte_eventos WHERE empresa_id = $1 AND entregue_em < now() - interval '30 days'`, [empresaId]);
    return { ok: true };
  }

  /** espelho enviado pelo servidor local: substitui as tabelas que a internet usa */
  async receberEspelho(empresaId: string, token: string | undefined, arquivo: Buffer) {
    if (modoLocal()) throw new NotFoundException();
    await this.servidor.empresaPorToken(empresaId, token);
    if (!Buffer.isBuffer(arquivo) || !arquivo.length) throw new BadRequestException('Espelho vazio.');
    const dados = JSON.parse(gunzipSync(arquivo).toString('utf8')) as { tabelas: Record<string, Record<string, unknown>[]>; empresa?: { nome?: string; cobranca?: unknown } };
    const n = await this.backup.aplicarParcial(empresaId, dados.tabelas ?? {}, TABELAS_ESPELHO);
    if (dados.empresa) {
      await this.ds.query(`UPDATE empresas SET nome = COALESCE($2, nome), cobranca = COALESCE($3::jsonb, cobranca) WHERE id = $1`,
        [empresaId, dados.empresa.nome ?? null, dados.empresa.cobranca ? JSON.stringify(dados.empresa.cobranca) : null]);
    }
    // o que chegou pela internet e o servidor local ainda não buscou continua visível
    const pend = await this.ds.query(`SELECT tipo, dados FROM ponte_eventos WHERE empresa_id = $1 AND entregue_em IS NULL AND tipo IN ('reserva','pedido')`, [empresaId]);
    for (const p of pend) {
      const linha = p.tipo === 'reserva' ? p.dados?.reserva : p.dados?.pedido;
      if (linha) await this.backup.inserir(this.ds, p.tipo === 'reserva' ? 'reservas' : 'pedidos', [linha], undefined, true);
    }
    await this.ds.query(`UPDATE empresas SET servidor_local = servidor_local || jsonb_build_object('ultimoEspelho', now()) WHERE id = $1`, [empresaId]);
    return { ok: true, registros: n };
  }

  async receberBackup(empresaId: string, token: string | undefined, arquivo: Buffer) {
    if (modoLocal()) throw new NotFoundException();
    await this.servidor.empresaPorToken(empresaId, token);
    if (!Buffer.isBuffer(arquivo) || arquivo.length < 10) throw new BadRequestException('Backup vazio.');
    await this.backup.guardarRecebido(empresaId, arquivo);
    await this.ds.query(`UPDATE empresas SET servidor_local = servidor_local || jsonb_build_object('ultimoBackup', now()) WHERE id = $1`, [empresaId]);
    return { ok: true };
  }

  // =============== SERVIDOR LOCAL ===============

  private async nuvem(l: { nuvem_url: string; empresa_id: string; token_cripto: string }, metodo: string, caminho: string, corpo?: Buffer | string, tipo = 'application/json') {
    const r = await fetch(`${l.nuvem_url.replace(/\/+$/, '')}/api/publico/ponte/${l.empresa_id}${caminho}`, {
      method: metodo,
      headers: { 'Content-Type': tipo, 'x-servidor-token': decifrar(l.token_cripto, 'vb-servidor') },
      body: corpo as string | undefined,
    });
    const t = await r.text();
    if (!r.ok) {
      let msg = `Erro ${r.status}`;
      try { msg = JSON.parse(t).message ?? msg; } catch { /* sem json */ }
      throw new Error(msg);
    }
    return t ? JSON.parse(t) : null;
  }

  /** busca os eventos da nuvem, manda o espelho e a cópia do backup */
  async sincronizar(forcarEspelho = false) {
    if (!modoLocal() || this.rodando) return;
    this.rodando = true;
    const [l] = await this.ds.query(`SELECT * FROM licenca_local WHERE id = 1`);
    if (!l) { this.rodando = false; return; }
    try {
      // 1) eventos que chegaram pela internet
      const eventos: { id: string; tipo: string; dados: any }[] = await this.nuvem(l, 'GET', '/eventos');
      const feitos: string[] = [];
      for (const ev of eventos) {
        try { await this.aplicarEvento(l.empresa_id, ev); feitos.push(ev.id); }
        catch (e) { this.log.error(`Evento ${ev.tipo} não aplicado: ${e instanceof Error ? e.message : e}`); feitos.push(ev.id); }
      }
      if (feitos.length) await this.nuvem(l, 'POST', '/eventos/confirmar', JSON.stringify({ ids: feitos }));

      // 2) espelho (a cada 2 minutos, ou logo depois de receber eventos)
      if (forcarEspelho || feitos.length || Date.now() - this.ultimoEspelho > 120_000) {
        const espelho = await this.montarEspelho(l.empresa_id);
        const json = JSON.stringify(espelho);
        const hash = createHash('sha256').update(json).digest('hex');
        const velho = Date.now() - this.ultimoEspelho > 30 * 60_000;
        if (hash !== l.espelho_hash || velho || forcarEspelho) {
          await this.nuvem(l, 'POST', '/espelho', gzipSync(Buffer.from(json, 'utf8')) as unknown as string, 'application/octet-stream');
          await this.ds.query(`UPDATE licenca_local SET espelho_hash = $1 WHERE id = 1`, [hash]);
        }
        this.ultimoEspelho = Date.now();
      }

      // 3) cópia externa: o último backup automático vai para a nuvem
      const b = await this.backup.ultimoAutomatico(l.empresa_id);
      if (b && (!l.backup_enviado_em || new Date(b.criadoEm).getTime() > new Date(l.backup_enviado_em).getTime())) {
        await this.nuvem(l, 'POST', '/backup', b.conteudo as unknown as string, 'application/octet-stream');
        await this.ds.query(`UPDATE licenca_local SET backup_enviado_em = $1 WHERE id = 1`, [b.criadoEm]);
      }
      await this.ds.query(`UPDATE licenca_local SET ultima_sincronizacao = now(), erro_ponte = NULL WHERE id = 1`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.ds.query(`UPDATE licenca_local SET erro_ponte = $1 WHERE id = 1`, [msg.slice(0, 300)]).catch(() => undefined);
    } finally {
      this.rodando = false;
    }
  }

  private async montarEspelho(empresaId: string) {
    const q = (sql: string) => this.ds.query(sql, [empresaId]);
    const [emp] = await q(`SELECT nome, cobranca FROM empresas WHERE id = $1`);
    return {
      empresa: { nome: emp?.nome, cobranca: emp?.cobranca },
      tabelas: {
        ambientes: await q(`SELECT * FROM ambientes WHERE empresa_id = $1`),
        categorias: await q(`SELECT * FROM categorias WHERE empresa_id = $1`),
        unidades: await q(`SELECT * FROM unidades WHERE empresa_id = $1`),
        produtos: await q(`SELECT * FROM produtos WHERE empresa_id = $1 AND ativo`),
        reservas: await q(`SELECT * FROM reservas WHERE empresa_id = $1 AND status IN ('pendente','confirmada','hospedada') AND saida >= CURRENT_DATE - 1`),
        estadias: await q(`SELECT * FROM estadias WHERE empresa_id = $1 AND status IN ('aberta','conta_entregue')`),
        pedidos: await q(`SELECT * FROM pedidos WHERE empresa_id = $1 AND criado_em > now() - interval '2 days'`),
        frigobar_categoria: await this.ds.query(`SELECT f.* FROM frigobar_categoria f JOIN categorias c ON c.id = f.categoria_id WHERE c.empresa_id = $1`, [empresaId]),
      },
    };
  }

  private async aplicarEvento(empresaId: string, ev: { tipo: string; dados: any }) {
    if (ev.tipo === 'asaas') {
      await this.cobranca.processarPagamento(empresaId, ev.dados);
      return;
    }
    if (ev.tipo === 'reserva') {
      const r = ev.dados?.reserva;
      if (!r?.id) return;
      const [ja] = await this.ds.query(`SELECT 1 FROM reservas WHERE id = $1`, [r.id]);
      if (!ja) {
        const c = await this.ds.query('UPDATE empresas SET ultima_reserva = ultima_reserva + 1 WHERE id = $1 RETURNING ultima_reserva', [empresaId]);
        const linha = Array.isArray(c?.[0]) ? c[0][0] : c?.[0];
        // quarto pode ter sido ocupado aqui enquanto a internet estava fora: avisa a recepção
        const [choque] = await this.ds.query(
          `SELECT 1 FROM reservas WHERE unidade_id = $1 AND status IN ('pendente','confirmada','hospedada') AND chegada < $3::date AND saida > $2::date
           UNION SELECT 1 FROM estadias WHERE unidade_id = $1 AND status IN ('aberta','conta_entregue') AND COALESCE(saida_prevista, CURRENT_DATE + 1) > $2::date LIMIT 1`,
          [r.unidade_id, String(r.chegada).slice(0, 10), String(r.saida).slice(0, 10)]);
        const obs = choque ? `⚠ CONFERIR: o quarto já estava ocupado/reservado nessas datas quando a reserva chegou da internet. ${r.observacao ?? ''}`.trim() : r.observacao;
        await this.backup.inserir(this.ds, 'reservas', [{ ...r, numero: linha ? Number(linha.ultima_reserva) : r.numero, observacao: obs, vista_em: null }], undefined, true);
      }
      for (const cob of ev.dados?.cobrancas ?? []) await this.backup.inserir(this.ds, 'cobrancas', [cob], undefined, true);
      return;
    }
    if (ev.tipo === 'pedido') {
      const p = ev.dados?.pedido;
      if (!p?.id) return;
      const [ja] = await this.ds.query(`SELECT 1 FROM pedidos WHERE id = $1`, [p.id]);
      if (ja) return;
      const [est] = await this.ds.query(`SELECT id FROM estadias WHERE unidade_id = $1 AND status = 'aberta' ORDER BY entrada_em DESC LIMIT 1`, [p.unidade_id]);
      if (!est) { this.log.warn(`Pedido ${p.id} ignorado: a unidade não tem conta aberta aqui.`); return; }
      await this.backup.inserir(this.ds, 'pedidos', [{ ...p, estadia_id: est.id }], undefined, true);
    }
  }

  async statusPonte() {
    if (!modoLocal()) return null;
    const [l] = await this.ds.query(`SELECT ultima_sincronizacao, erro_ponte, backup_enviado_em FROM licenca_local WHERE id = 1`);
    return l ? { ultimaSincronizacao: l.ultima_sincronizacao, erro: l.erro_ponte, backupEnviadoEm: l.backup_enviado_em } : null;
  }
}
