import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createHash, generateKeyPairSync, randomBytes, sign, timingSafeEqual, verify } from 'crypto';
import { cifrar, decifrar } from '../common/cripto';
import { BackupService } from '../backup/backup.service';

/** conteúdo assinado da licença */
interface Licenca { e: string; n: string; m: Record<string, boolean>; v: string; i: string }

const DIAS_LICENCA = 30;
const NUVEM_PADRAO = 'https://vb-hoteis-backend-production.up.railway.app';
const b64u = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const deB64u = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const hash = (t: string) => createHash('sha256').update(t).digest('hex');

/** este backend está rodando num servidor local do cliente? */
export const modoLocal = () => (process.env.VB_MODO || '').toLowerCase() === 'local';

@Injectable()
export class ServidorLocalService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('ServidorLocal');
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly ds: DataSource, private readonly backup: BackupService) {}

  onModuleInit() {
    if (!modoLocal()) return;
    // confere/renova a licença ao subir e a cada 6 horas
    setTimeout(() => { this.renovar().catch(() => undefined); }, 20_000);
    this.timer = setInterval(() => { this.renovar().catch(() => undefined); }, 6 * 3600_000);
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  // =============== NUVEM (Virtual Barra) ===============

  private conferirMestra(chave?: string) {
    const mestra = process.env.VB_CHAVE_MESTRA;
    if (!mestra || mestra.length < 24) throw new NotFoundException();
    const a = Buffer.from(chave ?? ''); const b = Buffer.from(mestra);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ForbiddenException('Chave inválida.');
  }

  /** par de chaves Ed25519 da Virtual Barra (criado na primeira vez, guardado no banco da nuvem) */
  private async chaves(): Promise<{ privada: string; publica: string }> {
    const l = await this.ds.query(`SELECT chave, valor FROM sistema_config WHERE chave IN ('licenca_privada','licenca_publica')`);
    const pr = l.find((x: { chave: string }) => x.chave === 'licenca_privada');
    const pu = l.find((x: { chave: string }) => x.chave === 'licenca_publica');
    if (pr && pu) return { privada: decifrar(pr.valor, 'vb-licenca'), publica: pu.valor };
    const k = generateKeyPairSync('ed25519', { publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
    await this.ds.query(`INSERT INTO sistema_config (chave, valor) VALUES ('licenca_privada', $1), ('licenca_publica', $2) ON CONFLICT (chave) DO NOTHING`,
      [cifrar(k.privateKey as unknown as string, 'vb-licenca'), k.publicKey as unknown as string]);
    return this.chaves();
  }

  async chavePublica() {
    if (modoLocal()) throw new NotFoundException();
    return { chave: (await this.chaves()).publica };
  }

  /** /vb: gera o código de ativação do servidor local da empresa (o anterior deixa de valer) */
  async gerarCodigo(chave: string | undefined, empresaId: string) {
    this.conferirMestra(chave);
    const [e] = await this.ds.query(`SELECT id, nome FROM empresas WHERE id = $1`, [empresaId]);
    if (!e) throw new NotFoundException('Empresa não encontrada.');
    const token = randomBytes(32).toString('hex');
    await this.ds.query(
      `UPDATE empresas SET servidor_token_hash = $2, servidor_local = servidor_local || jsonb_build_object('codigoGeradoEm', now()) WHERE id = $1`, [empresaId, hash(token)]);
    const codigo = b64u(Buffer.from(JSON.stringify({ e: empresaId, t: token })));
    return { empresa: e.nome, codigo: `VB-${codigo}` };
  }

  async situacaoServidores(chave: string | undefined) {
    this.conferirMestra(chave);
    const l = await this.ds.query(`SELECT id, nome, servidor_local, servidor_token_hash IS NOT NULL AS tem FROM empresas ORDER BY nome`);
    return l.map((x: Record<string, any>) => ({ id: x.id, nome: x.nome, temCodigo: x.tem, ...(x.servidor_local ?? {}) }));
  }

  private async empresaPorToken(empresaId: string, token?: string) {
    if (!/^[0-9a-f-]{36}$/i.test(empresaId || '') || !/^[0-9a-f]{64}$/.test(token || '')) throw new ForbiddenException('Código inválido.');
    const [e] = await this.ds.query(`SELECT id, nome, modulos, ativo, servidor_token_hash FROM empresas WHERE id = $1`, [empresaId]);
    if (!e?.servidor_token_hash) throw new ForbiddenException('Código inválido.');
    const a = Buffer.from(hash(token!)); const b = Buffer.from(e.servidor_token_hash);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ForbiddenException('Código inválido ou trocado. Gere um novo código no painel da Virtual Barra.');
    if (!e.ativo) throw new ForbiddenException('Empresa com acesso suspenso. Fale com a Virtual Barra.');
    return e as { id: string; nome: string; modulos: Record<string, boolean> };
  }

  /** nuvem: emite a licença assinada (válida por 30 dias) para o servidor local */
  async emitirLicenca(empresaId: string, token: string | undefined, info: { versao?: string; ip?: string }) {
    if (modoLocal()) throw new NotFoundException();
    const e = await this.empresaPorToken(empresaId, token);
    const agora = new Date();
    const lic: Licenca = { e: e.id, n: e.nome, m: e.modulos ?? {}, v: new Date(agora.getTime() + DIAS_LICENCA * 86400_000).toISOString(), i: agora.toISOString() };
    const corpo = Buffer.from(JSON.stringify(lic));
    const assinatura = sign(null, corpo, (await this.chaves()).privada);
    await this.ds.query(
      `UPDATE empresas SET servidor_local = servidor_local || jsonb_build_object('ultimaRenovacao', now(), 'versao', $2::text, 'ip', $3::text) WHERE id = $1`,
      [e.id, (info.versao ?? '').slice(0, 30), (info.ip ?? '').slice(0, 60)]);
    return { licenca: `${b64u(corpo)}.${b64u(assinatura)}` };
  }

  /** nuvem: dados da empresa para o servidor local começar igual à nuvem */
  async dadosIniciais(empresaId: string, token: string | undefined) {
    if (modoLocal()) throw new NotFoundException();
    await this.empresaPorToken(empresaId, token);
    const g = await this.backup.gerar(empresaId, null);
    await this.ds.query(`UPDATE empresas SET servidor_local = servidor_local || jsonb_build_object('ativadoEm', now()) WHERE id = $1`, [empresaId]);
    return g.arquivo;
  }

  // =============== SERVIDOR LOCAL (no cliente) ===============

  private conferirLicenca(texto: string, chavePublica: string): Licenca {
    const [c, a] = texto.split('.');
    if (!c || !a) throw new BadRequestException('Licença inválida.');
    const corpo = deB64u(c);
    if (!verify(null, corpo, chavePublica, deB64u(a))) throw new BadRequestException('Assinatura da licença não confere.');
    return JSON.parse(corpo.toString('utf8')) as Licenca;
  }

  private async nuvem<T>(url: string, caminho: string, opcoes: { method?: string; headers?: Record<string, string>; body?: string } = {}, binario = false): Promise<T> {
    let r: { ok: boolean; status: number; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> };
    try {
      r = await fetch(`${url.replace(/\/+$/, '')}/api${caminho}`, { ...opcoes, headers: { 'Content-Type': 'application/json', ...(opcoes.headers ?? {}) } });
    } catch {
      throw new BadRequestException('Sem internet para falar com a nuvem da Virtual Barra.');
    }
    if (!r.ok) {
      const t = await r.text();
      let msg = `Erro ${r.status} na nuvem.`;
      try { msg = JSON.parse(t).message ?? msg; } catch { /* sem json */ }
      throw new BadRequestException(msg);
    }
    return (binario ? Buffer.from(await r.arrayBuffer()) : JSON.parse(await r.text())) as T;
  }

  async status() {
    if (!modoLocal()) return { modo: 'nuvem' as const };
    const [l] = await this.ds.query(`SELECT empresa_id, valida_ate, ultima_renovacao, ultimo_erro, ativado_em FROM licenca_local WHERE id = 1`);
    if (!l) return { modo: 'local' as const, ativado: false };
    const [e] = await this.ds.query(`SELECT nome FROM empresas WHERE id = $1`, [l.empresa_id]);
    const dias = l.valida_ate ? Math.floor((new Date(l.valida_ate).getTime() - Date.now()) / 86400_000) : -1;
    return {
      modo: 'local' as const, ativado: true, empresa: e?.nome ?? null, validaAte: l.valida_ate, diasRestantes: dias, vencida: dias < 0,
      ultimaRenovacao: l.ultima_renovacao, ultimoErro: l.ultimo_erro, ativadoEm: l.ativado_em,
    };
  }

  /** ativa o servidor local com o código gerado no /vb: baixa licença e dados da nuvem */
  async ativar(codigo: string, nuvemUrl?: string) {
    if (!modoLocal()) throw new NotFoundException();
    const [ja] = await this.ds.query(`SELECT 1 FROM licenca_local WHERE id = 1`);
    if (ja) throw new ConflictException('Este servidor já está ativado.');
    let dec: { e: string; t: string };
    try { dec = JSON.parse(deB64u(codigo.trim().replace(/^VB-/, '')).toString('utf8')); } catch { throw new BadRequestException('Código de ativação inválido.'); }
    if (!dec?.e || !dec?.t) throw new BadRequestException('Código de ativação inválido.');
    const url = (nuvemUrl || process.env.VB_NUVEM_URL || NUVEM_PADRAO).trim();
    const { chave } = await this.nuvem<{ chave: string }>(url, '/publico/servidor-local/chave-publica');
    const cab = { 'x-servidor-token': dec.t };
    const { licenca } = await this.nuvem<{ licenca: string }>(url, `/publico/servidor-local/licenca/${dec.e}`, { method: 'POST', headers: cab, body: JSON.stringify({ versao: process.env.VB_VERSAO ?? '' }) });
    const lic = this.conferirLicenca(licenca, chave);
    if (lic.e !== dec.e) throw new BadRequestException('Licença de outra empresa.');
    const arquivo = await this.nuvem<Buffer>(url, `/publico/servidor-local/dados/${dec.e}`, { headers: cab }, true);
    const dados = this.backup.abrir(arquivo, null);
    const registros = await this.backup.aplicarDados(dados);
    await this.ds.query(
      `INSERT INTO licenca_local (id, empresa_id, nuvem_url, token_cripto, chave_publica, licenca, valida_ate, modulos, ultima_renovacao) VALUES (1,$1,$2,$3,$4,$5,$6,$7::jsonb, now())`,
      [lic.e, url, cifrar(dec.t, 'vb-servidor'), chave, licenca, lic.v, JSON.stringify(lic.m)]);
    await this.ds.query(`UPDATE empresas SET modulos = $2::jsonb WHERE id = $1`, [lic.e, JSON.stringify(lic.m)]);
    this.log.log(`Servidor ativado para ${lic.n} (${registros} registros trazidos da nuvem).`);
    return { ok: true, empresa: lic.n, registros, validaAte: lic.v };
  }

  /** renova a licença quando há internet; vencida, desliga os módulos pagos (o básico continua) */
  async renovar() {
    if (!modoLocal()) return;
    const [l] = await this.ds.query(`SELECT * FROM licenca_local WHERE id = 1`);
    if (!l) return;
    try {
      const { licenca } = await this.nuvem<{ licenca: string }>(l.nuvem_url, `/publico/servidor-local/licenca/${l.empresa_id}`, {
        method: 'POST', headers: { 'x-servidor-token': decifrar(l.token_cripto, 'vb-servidor') }, body: JSON.stringify({ versao: process.env.VB_VERSAO ?? '' }),
      });
      const lic = this.conferirLicenca(licenca, l.chave_publica);
      if (lic.e !== l.empresa_id) throw new Error('Licença de outra empresa.');
      await this.ds.query(`UPDATE licenca_local SET licenca = $1, valida_ate = $2, modulos = $3::jsonb, ultima_renovacao = now(), ultimo_erro = NULL WHERE id = 1`,
        [licenca, lic.v, JSON.stringify(lic.m)]);
      await this.ds.query(`UPDATE empresas SET modulos = $2::jsonb WHERE id = $1`, [lic.e, JSON.stringify(lic.m)]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.ds.query(`UPDATE licenca_local SET ultimo_erro = $1 WHERE id = 1`, [msg.slice(0, 300)]);
      if (l.valida_ate && new Date(l.valida_ate).getTime() < Date.now()) {
        await this.ds.query(`UPDATE empresas SET modulos = '{}'::jsonb WHERE id = $1`, [l.empresa_id]);
        this.log.warn('Licença vencida: módulos pagos desligados até renovar.');
      }
    }
  }
}
