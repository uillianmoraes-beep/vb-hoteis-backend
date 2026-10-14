import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { gzipSync, gunzipSync } from 'zlib';
import { promises as fs } from 'fs';
import { join } from 'path';
import * as bcrypt from 'bcryptjs';
import { UsuarioToken } from '../common/permissoes';
import { cifrar, decifrar } from '../common/cripto';

/** guardado em empresas.config_backup */
interface ConfigBackup {
  automatico?: boolean;
  /** HH:MM no horário de Brasília */
  horario?: string;
  /** quantas cópias automáticas guardar */
  manter?: number;
  /** senha dos backups automáticos (criptografada com a chave do servidor) */
  senhaCripto?: string | null;
}

interface Rota { tabela: string; where: string }
interface Mapa { rotas: Rota[]; semVinculo: string[]; colunas: Map<string, Set<string>> }

const FORMATO = 'vb-hoteis-backup';
const IGNORAR = new Set(['migrations', 'typeorm_metadata', 'backups_arquivos', 'empresas']);
const MAGIA_ABERTO = Buffer.from('VBBK0');
const MAGIA_SENHA = Buffer.from('VBBK1');
const FUSO = 'America/Sao_Paulo';
const agoraSP = () => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '00';
  return { dia: `${v('year')}-${v('month')}-${v('day')}`, hora: `${v('hour') === '24' ? '00' : v('hour')}:${v('minute')}` };
};
const ident = (t: string) => `"${t.replace(/"/g, '""')}"`;

/** empacota: gzip, e com senha AES-256-GCM (chave derivada por scrypt) */
function empacotar(json: string, senha?: string | null): Buffer {
  const gz = gzipSync(Buffer.from(json, 'utf8'));
  if (!senha) return Buffer.concat([MAGIA_ABERTO, gz]);
  const sal = randomBytes(16);
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', scryptSync(senha, sal, 32), iv);
  const enc = Buffer.concat([c.update(gz), c.final()]);
  return Buffer.concat([MAGIA_SENHA, sal, iv, c.getAuthTag(), enc]);
}

function desempacotar(b: Buffer, senha?: string | null): any {
  const magia = b.subarray(0, 5);
  let gz: Buffer;
  if (magia.equals(MAGIA_ABERTO)) gz = b.subarray(5);
  else if (magia.equals(MAGIA_SENHA)) {
    if (!senha) throw new BadRequestException('Este backup tem senha. Informe a senha do backup.');
    const sal = b.subarray(5, 21); const iv = b.subarray(21, 33); const tag = b.subarray(33, 49);
    try {
      const d = createDecipheriv('aes-256-gcm', scryptSync(senha, sal, 32), iv);
      d.setAuthTag(tag);
      gz = Buffer.concat([d.update(b.subarray(49)), d.final()]);
    } catch {
      throw new BadRequestException('Senha do backup incorreta.');
    }
  } else throw new BadRequestException('Este arquivo não é um backup do VB Soluções Hoteleiras.');
  try { return JSON.parse(gunzipSync(gz).toString('utf8')); } catch { throw new BadRequestException('Arquivo de backup corrompido.'); }
}

@Injectable()
export class BackupService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Backup');
  private mapaCache: { em: number; mapa: Mapa } | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private rodando = false;

  constructor(private readonly ds: DataSource) {}

  /** pasta para gravar os backups automáticos (servidor local: HD externo, NAS…) */
  private get pasta() { return (process.env.VB_BACKUP_DIR || '').trim() || null; }

  onModuleInit() {
    // confere a rotina a cada 5 minutos
    this.timer = setInterval(() => { this.rotina().catch((e) => this.log.error(`Rotina de backup: ${e instanceof Error ? e.message : e}`)); }, 5 * 60_000);
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  // ---------------- quais tabelas são da empresa ----------------

  /** descobre sozinho as tabelas da empresa: com empresa_id ou ligadas por chave estrangeira */
  private async mapa(): Promise<Mapa> {
    if (this.mapaCache && Date.now() - this.mapaCache.em < 10 * 60_000) return this.mapaCache.mapa;
    const tabs: { t: string }[] = await this.ds.query(
      `SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`);
    const cols: { t: string; c: string }[] = await this.ds.query(
      `SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = 'public'`);
    const fks: { t: string; c: string; r: string; rc: string }[] = await this.ds.query(
      `SELECT cl.relname AS t, a.attname AS c, rl.relname AS r, ra.attname AS rc
         FROM pg_constraint k
         JOIN pg_class cl ON cl.oid = k.conrelid JOIN pg_namespace n ON n.oid = cl.relnamespace AND n.nspname = 'public'
         JOIN pg_class rl ON rl.oid = k.confrelid
         JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
         JOIN pg_attribute ra ON ra.attrelid = k.confrelid AND ra.attnum = k.confkey[1]
        WHERE k.contype = 'f' AND array_length(k.conkey, 1) = 1`);
    const colunas = new Map<string, Set<string>>();
    for (const x of cols) { if (!colunas.has(x.t)) colunas.set(x.t, new Set()); colunas.get(x.t)!.add(x.c); }
    const fkDe = new Map<string, { c: string; r: string; rc: string }[]>();
    for (const f of fks) { if (!fkDe.has(f.t)) fkDe.set(f.t, []); fkDe.get(f.t)!.push(f); }

    const memo = new Map<string, string | null>();
    // condição (com $1 = empresa) que seleciona as linhas da empresa nesta tabela
    const condicao = (t: string, prof: number, alias: string): string | null => {
      if (t === 'empresas') return `${alias}.id = $1`;
      if (colunas.get(t)?.has('empresa_id')) return `${alias}.empresa_id = $1`;
      if (prof >= 3) return null;
      for (const f of fkDe.get(t) ?? []) {
        if (f.r === t) continue;
        const sub = `p${prof}`;
        const cond = condicao(f.r, prof + 1, sub);
        if (cond) return `${alias}.${ident(f.c)} IN (SELECT ${sub}.${ident(f.rc)} FROM ${ident(f.r)} ${sub} WHERE ${cond})`;
      }
      return null;
    };
    const rotas: Rota[] = [];
    const semVinculo: string[] = [];
    for (const { t } of tabs) {
      if (IGNORAR.has(t)) continue;
      let w = memo.get(t);
      if (w === undefined) { w = condicao(t, 0, 'x'); memo.set(t, w); }
      if (w) rotas.push({ tabela: t, where: w }); else semVinculo.push(t);
    }
    rotas.sort((a, b) => a.tabela.localeCompare(b.tabela));
    const mapa = { rotas, semVinculo: semVinculo.sort(), colunas };
    this.mapaCache = { em: Date.now(), mapa };
    return mapa;
  }

  // ---------------- gerar ----------------

  async gerar(empresaId: string, senha?: string | null) {
    const m = await this.mapa();
    const [emp] = await this.ds.query(`SELECT * FROM empresas WHERE id = $1`, [empresaId]);
    if (!emp) throw new NotFoundException('Empresa não encontrada.');
    const tabelas: Record<string, unknown[]> = { empresas: [emp] };
    let registros = 1;
    for (const r of m.rotas) {
      const linhas = await this.ds.query(`SELECT x.* FROM ${ident(r.tabela)} x WHERE ${r.where}`, [empresaId]);
      if (linhas.length) { tabelas[r.tabela] = linhas; registros += linhas.length; }
    }
    const json = JSON.stringify({ formato: FORMATO, versao: 1, empresaId, empresa: emp.nome, geradoEm: new Date().toISOString(), tabelas },
      (_k, v) => (v && typeof v === 'object' && v.type === 'Buffer' && Array.isArray(v.data) ? `\\x${Buffer.from(v.data).toString('hex')}` : v));
    const arquivo = empacotar(json, senha);
    return { arquivo, tabelas: Object.keys(tabelas).length, registros, empresa: String(emp.nome ?? 'empresa') };
  }

  private async guardar(empresaId: string, tipo: 'manual' | 'auto', usuario: string, senha?: string | null) {
    const g = await this.gerar(empresaId, senha);
    const [b] = await this.ds.query(
      `INSERT INTO backups_arquivos (empresa_id, tipo, tamanho, tabelas, registros, protegido, conteudo, criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, criado_em`,
      [empresaId, tipo, g.arquivo.length, g.tabelas, g.registros, !!senha, g.arquivo, usuario]);
    // servidor local: grava também na pasta (HD externo, NAS, pasta sincronizada)
    if (this.pasta) {
      try {
        await fs.mkdir(this.pasta, { recursive: true });
        const slug = g.empresa.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase().slice(0, 40) || 'empresa';
        const { dia, hora } = agoraSP();
        await fs.writeFile(join(this.pasta, `${slug}-${dia}-${hora.replace(':', '')}-${tipo}.vbbackup`), g.arquivo);
      } catch (e) {
        this.log.error(`Não gravou o backup na pasta ${this.pasta}: ${e instanceof Error ? e.message : e}`);
      }
    }
    return { id: b.id as string, criadoEm: b.criado_em, tamanho: g.arquivo.length, tabelas: g.tabelas, registros: g.registros };
  }

  private async logar(empresaId: string, acao: string, detalhe: string, usuario: string) {
    await this.ds.query(`INSERT INTO backups_log (empresa_id, acao, detalhe, usuario_nome) VALUES ($1,$2,$3,$4)`, [empresaId, acao, detalhe.slice(0, 300), usuario]).catch(() => undefined);
  }

  // ---------------- tela ----------------

  private async cfg(empresaId: string): Promise<ConfigBackup> {
    const [e] = await this.ds.query(`SELECT config_backup FROM empresas WHERE id = $1`, [empresaId]);
    return (e?.config_backup ?? {}) as ConfigBackup;
  }

  async painel(u: UsuarioToken) {
    const c = await this.cfg(u.empresaId);
    const m = await this.mapa();
    const arquivos = await this.ds.query(
      `SELECT id, tipo, tamanho, tabelas, registros, protegido, criado_por, criado_em FROM backups_arquivos WHERE empresa_id = $1 ORDER BY criado_em DESC LIMIT 100`, [u.empresaId]);
    const log = await this.ds.query(`SELECT acao, detalhe, usuario_nome, criado_em FROM backups_log WHERE empresa_id = $1 ORDER BY criado_em DESC LIMIT 30`, [u.empresaId]);
    return {
      config: { automatico: !!c.automatico, horario: c.horario ?? '03:00', manter: c.manter ?? 7, temSenha: !!c.senhaCripto },
      pasta: this.pasta, tabelasIncluidas: m.rotas.length + 1, semVinculo: m.semVinculo,
      arquivos: arquivos.map((a: Record<string, unknown>) => ({ id: a.id, tipo: a.tipo, tamanho: a.tamanho, tabelas: a.tabelas, registros: a.registros, protegido: a.protegido, criadoPor: a.criado_por, criadoEm: a.criado_em })),
      log: log.map((l: Record<string, unknown>) => ({ acao: l.acao, detalhe: l.detalhe, usuario: l.usuario_nome, criadoEm: l.criado_em })),
    };
  }

  async salvarConfig(u: UsuarioToken, dto: { automatico: boolean; horario: string; manter: number; senha?: string | null; tirarSenha?: boolean }) {
    const c = await this.cfg(u.empresaId);
    const nova: ConfigBackup = { ...c, automatico: dto.automatico, horario: dto.horario, manter: dto.manter };
    if (dto.tirarSenha) nova.senhaCripto = null;
    else if (dto.senha?.trim()) nova.senhaCripto = cifrar(dto.senha.trim(), 'vb-backup');
    await this.ds.query(`UPDATE empresas SET config_backup = $2::jsonb WHERE id = $1`, [u.empresaId, JSON.stringify(nova)]);
    await this.logar(u.empresaId, 'config', `Rotina ${dto.automatico ? `ligada às ${dto.horario}, guardando ${dto.manter}` : 'desligada'}${dto.tirarSenha ? ', sem senha' : dto.senha ? ', com senha' : ''}`, u.nome);
    return { ok: true };
  }

  async agora(u: UsuarioToken, senha?: string | null) {
    const r = await this.guardar(u.empresaId, 'manual', u.nome, senha?.trim() || null);
    await this.logar(u.empresaId, 'backup', `Backup manual: ${r.registros} registros em ${r.tabelas} tabelas${senha ? ' (com senha)' : ''}`, u.nome);
    return r;
  }

  async arquivo(u: UsuarioToken, id: string) {
    const [a] = await this.ds.query(`SELECT conteudo, criado_em, tipo, protegido FROM backups_arquivos WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!a) throw new NotFoundException('Backup não encontrado.');
    const [e] = await this.ds.query(`SELECT nome FROM empresas WHERE id = $1`, [u.empresaId]);
    const slug = String(e?.nome ?? 'empresa').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase().slice(0, 40);
    const d = new Date(a.criado_em).toLocaleString('sv-SE', { timeZone: FUSO }).replace(/[: ]/g, '-').slice(0, 16);
    await this.logar(u.empresaId, 'download', `Baixou o backup de ${d}`, u.nome);
    return { conteudo: a.conteudo as Buffer, nome: `${slug}-${d}${a.protegido ? '-senha' : ''}.vbbackup` };
  }

  async excluir(u: UsuarioToken, id: string) {
    await this.ds.query(`DELETE FROM backups_arquivos WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    return { ok: true };
  }

  // ---------------- restaurar ----------------

  async restaurar(u: UsuarioToken, arquivo: Buffer, senhaBackup: string | undefined, senhaUsuario: string | undefined, confirmacao: string | undefined) {
    if (confirmacao !== 'RESTAURAR') throw new BadRequestException('Digite RESTAURAR para confirmar.');
    if (!Buffer.isBuffer(arquivo) || arquivo.length < 10) throw new BadRequestException('Envie o arquivo do backup.');
    const [usr] = await this.ds.query(`SELECT senha_hash FROM usuarios WHERE id = $1 AND empresa_id = $2`, [u.sub, u.empresaId]);
    if (!usr || !senhaUsuario || !(await bcrypt.compare(senhaUsuario, usr.senha_hash))) throw new ForbiddenException('Sua senha não confere.');
    const dados = desempacotar(arquivo, senhaBackup);
    if (dados?.formato !== FORMATO || !dados.tabelas) throw new BadRequestException('Arquivo de backup inválido.');
    if (dados.empresaId !== u.empresaId) throw new BadRequestException('Este backup é de outra empresa. Só dá para restaurar backup da própria empresa.');

    // cópia de segurança do estado atual antes de restaurar
    await this.guardar(u.empresaId, 'manual', `${u.nome} (antes de restaurar)`, null);
    const registros = await this.aplicarDados(dados);
    await this.logar(u.empresaId, 'restauracao', `Restaurou o backup de ${String(dados.geradoEm).slice(0, 16).replace('T', ' ')} (${registros} registros)`, u.nome);
    return { ok: true, registros, geradoEm: dados.geradoEm };
  }

  /** abre um arquivo de backup (usado também na ativação do servidor local) */
  abrir(arquivo: Buffer, senha?: string | null) {
    const dados = desempacotar(arquivo, senha);
    if (dados?.formato !== FORMATO || !dados.tabelas) throw new BadRequestException('Arquivo de backup inválido.');
    return dados as { empresaId: string; geradoEm: string; tabelas: Record<string, Record<string, unknown>[]> };
  }

  /** troca os dados da empresa do backup pelos do arquivo (numa transação) */
  async aplicarDados(dados: { empresaId: string; tabelas: Record<string, Record<string, unknown>[]> }): Promise<number> {
    this.mapaCache = null;
    const m = await this.mapa();
    const empresaId = dados.empresaId;
    let registros = 0;
    await this.ds.transaction(async (q) => {
      // desliga chaves estrangeiras e gatilhos só nesta transação (restaurar em qualquer ordem)
      await q.query(`SET LOCAL session_replication_role = replica`);
      for (const r of m.rotas) await q.query(`DELETE FROM ${ident(r.tabela)} x WHERE ${r.where}`, [empresaId]);
      await q.query(`DELETE FROM empresas WHERE id = $1`, [empresaId]);
      for (const [tabela, linhas] of Object.entries(dados.tabelas)) {
        const atuais = m.colunas.get(tabela);
        if (!atuais || !Array.isArray(linhas) || !linhas.length) continue;
        const cols = Object.keys(linhas[0]).filter((c) => atuais.has(c));
        if (!cols.length) continue;
        const lista = cols.map(ident).join(', ');
        for (let i = 0; i < linhas.length; i += 500) {
          const lote = linhas.slice(i, i + 500);
          await q.query(`INSERT INTO ${ident(tabela)} (${lista}) SELECT ${lista} FROM json_populate_recordset(NULL::${ident(tabela)}, $1::json)`, [JSON.stringify(lote)]);
          registros += lote.length;
        }
      }
    });
    this.mapaCache = null;
    return registros;
  }

  // ---------------- rotina automática ----------------

  private async rotina() {
    if (this.rodando) return;
    this.rodando = true;
    try {
      const { dia, hora } = agoraSP();
      const emps = await this.ds.query(`SELECT id, config_backup FROM empresas WHERE ativo AND (config_backup->>'automatico')::boolean IS TRUE`);
      for (const e of emps) {
        const c = (e.config_backup ?? {}) as ConfigBackup;
        const horario = /^\d{2}:\d{2}$/.test(c.horario ?? '') ? c.horario! : '03:00';
        if (hora < horario) continue;
        const [ja] = await this.ds.query(
          `SELECT 1 FROM backups_arquivos WHERE empresa_id = $1 AND tipo = 'auto' AND (criado_em AT TIME ZONE '${FUSO}')::date = $2::date LIMIT 1`, [e.id, dia]);
        if (ja) continue;
        try {
          const senha = c.senhaCripto ? decifrar(c.senhaCripto, 'vb-backup') : null;
          const r = await this.guardar(e.id, 'auto', 'Rotina automática', senha);
          const manter = Math.min(60, Math.max(1, c.manter ?? 7));
          await this.ds.query(
            `DELETE FROM backups_arquivos WHERE empresa_id = $1 AND tipo = 'auto' AND id NOT IN (
               SELECT id FROM backups_arquivos WHERE empresa_id = $1 AND tipo = 'auto' ORDER BY criado_em DESC LIMIT $2)`, [e.id, manter]);
          await this.logar(e.id, 'backup', `Backup automático: ${r.registros} registros`, 'Rotina automática');
        } catch (x) {
          await this.logar(e.id, 'erro', `Backup automático falhou: ${x instanceof Error ? x.message : x}`, 'Rotina automática');
        }
      }
      // pasta do servidor local: apaga os arquivos mais antigos além do limite
      if (this.pasta) await this.limparPasta(emps.reduce((mx: number, e: { config_backup: ConfigBackup }) => Math.max(mx, e.config_backup?.manter ?? 7), 7));
    } finally {
      this.rodando = false;
    }
  }

  private async limparPasta(manter: number) {
    try {
      const nomes = (await fs.readdir(this.pasta!)).filter((n) => n.endsWith('-auto.vbbackup'));
      const porEmpresa = new Map<string, string[]>();
      for (const n of nomes) {
        const chave = n.replace(/-\d{4}-\d{2}-\d{2}-\d{4}-auto\.vbbackup$/, '');
        porEmpresa.set(chave, [...(porEmpresa.get(chave) ?? []), n]);
      }
      for (const l of porEmpresa.values()) {
        const velhos = l.sort().reverse().slice(manter);
        for (const n of velhos) await fs.unlink(join(this.pasta!, n)).catch(() => undefined);
      }
    } catch { /* pasta indisponível: tenta na próxima */ }
  }
}
