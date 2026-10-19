import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { promises as fs } from 'fs';
import { dirname, join, normalize, sep } from 'path';
import { randomUUID } from 'crypto';
import { UsuarioToken } from '../common/permissoes';

export const ORIGENS_FOTO = ['vistoria', 'avaria', 'agua'] as const;
export type OrigemFoto = (typeof ORIGENS_FOTO)[number];

const JPEG = /^data:image\/jpeg;base64,/;

/**
 * Fotos da vistoria, das avarias e das piscinas: ficam em arquivo na pasta do servidor da empresa
 * (VB_FOTOS_DIR, criada na instalação) e o banco guarda só o caminho. Uma miniatura vai junto
 * para a planilha. Depois do prazo da empresa (fotos_dias) as fotos são apagadas sozinhas.
 */
@Injectable()
export class FotosService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Fotos');
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly ds: DataSource) {}

  get pasta() { return (process.env.VB_FOTOS_DIR || '').trim() || null; }

  private exigirPasta() {
    const p = this.pasta;
    if (!p) throw new BadRequestException('A pasta das fotos não está configurada neste servidor (VB_FOTOS_DIR). Fale com a Virtual Barra.');
    return p;
  }

  /** caminho absoluto de um arquivo salvo (nunca sai da pasta das fotos) */
  private caminho(relativo: string) {
    const base = normalize(this.exigirPasta());
    const abs = normalize(join(base, relativo));
    if (!abs.startsWith(base.endsWith(sep) ? base : base + sep)) throw new NotFoundException('Foto não encontrada.');
    return abs;
  }

  /** grava a foto (e a miniatura) ainda sem dono; a vistoria liga depois */
  async salvar(u: UsuarioToken, dto: { origem: OrigemFoto; local?: string; imagem: string; miniatura?: string }) {
    this.exigirPasta();
    if (!JPEG.test(dto.imagem)) throw new BadRequestException('A foto tem que ser JPEG.');
    const bin = Buffer.from(dto.imagem.replace(JPEG, ''), 'base64');
    if (bin.length > 2_500_000) throw new BadRequestException('Foto grande demais.');
    const mini = dto.miniatura && JPEG.test(dto.miniatura) ? Buffer.from(dto.miniatura.replace(JPEG, ''), 'base64') : null;
    const id = randomUUID();
    const mes = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 7);
    const rel = join(u.empresaId, mes, `${id}.jpg`);
    const relMini = mini ? join(u.empresaId, mes, `${id}-p.jpg`) : null;
    await fs.mkdir(dirname(this.caminho(rel)), { recursive: true });
    await fs.writeFile(this.caminho(rel), bin);
    if (mini && relMini) await fs.writeFile(this.caminho(relMini), mini);
    await this.ds.query(
      `INSERT INTO fotos (id, empresa_id, origem, local, arquivo, miniatura, bytes, criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, u.empresaId, dto.origem, dto.local?.trim().slice(0, 60) || null, rel, relMini, bin.length + (mini?.length ?? 0), u.nome]);
    return { id };
  }

  /** liga as fotos enviadas a um registro (só as da empresa, ainda sem dono) */
  async vincular(m: { query: (s: string, p?: unknown[]) => Promise<unknown> }, empresaId: string, ids: string[], referenciaId: string) {
    if (!ids.length) return;
    await m.query(`UPDATE fotos SET referencia_id = $3 WHERE empresa_id = $1 AND id = ANY($2::uuid[]) AND referencia_id IS NULL`, [empresaId, ids, referenciaId]);
  }

  /** confere se as fotos existem, são da empresa e ainda não foram usadas */
  async conferir(empresaId: string, ids: string[]) {
    if (!ids.length) return;
    const [r] = await this.ds.query(`SELECT count(*)::int AS n FROM fotos WHERE empresa_id = $1 AND id = ANY($2::uuid[]) AND referencia_id IS NULL`, [empresaId, ids]);
    if (Number(r?.n) !== new Set(ids).size) throw new BadRequestException('Alguma foto não chegou ao servidor. Tire a foto de novo.');
  }

  async ler(u: UsuarioToken, id: string, mini = false) {
    const [f] = await this.ds.query(`SELECT arquivo, miniatura FROM fotos WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!f) throw new NotFoundException('Foto não encontrada (pode ter passado do prazo de guarda).');
    const rel = mini && f.miniatura ? f.miniatura : f.arquivo;
    try {
      return await fs.readFile(this.caminho(rel));
    } catch {
      throw new NotFoundException('O arquivo da foto não está mais na pasta do servidor.');
    }
  }

  /** miniatura em disco (planilha); null se não houver */
  async miniatura(empresaId: string, id: string): Promise<Buffer | null> {
    if (!this.pasta) return null;
    const [f] = await this.ds.query(`SELECT arquivo, miniatura FROM fotos WHERE id = $1 AND empresa_id = $2`, [id, empresaId]);
    if (!f) return null;
    try { return await fs.readFile(this.caminho(f.miniatura ?? f.arquivo)); } catch { return null; }
  }

  /* ---------- prazo de guarda ---------- */

  onModuleInit() {
    if (!this.pasta) return;
    // de 6 em 6 horas: apaga as fotos vencidas e as que nunca foram usadas (vistoria abandonada)
    this.timer = setInterval(() => void this.limpar().catch((e) => this.log.error(e instanceof Error ? e.message : String(e))), 6 * 3_600_000);
    setTimeout(() => void this.limpar().catch(() => undefined), 60_000);
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async limpar() {
    if (!this.pasta) return;
    const velhas: { id: string; arquivo: string; miniatura: string | null }[] = await this.ds.query(
      `SELECT f.id, f.arquivo, f.miniatura FROM fotos f JOIN empresas e ON e.id = f.empresa_id
        WHERE f.criado_em < now() - make_interval(days => GREATEST(e.fotos_dias, 7))
           OR (f.referencia_id IS NULL AND f.criado_em < now() - interval '2 days')
        LIMIT 5000`);
    for (const f of velhas) {
      for (const rel of [f.arquivo, f.miniatura]) if (rel) await fs.rm(this.caminho(rel), { force: true }).catch(() => undefined);
    }
    if (velhas.length) {
      await this.ds.query(`DELETE FROM fotos WHERE id = ANY($1::uuid[])`, [velhas.map((f) => f.id)]);
      this.log.log(`${velhas.length} foto(s) apagadas (prazo de guarda).`);
    }
  }
}
