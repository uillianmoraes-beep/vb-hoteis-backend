// Sobe tudo do zero (banco de teste limpo, Focus e Spedy falsas, servidor) e roda os roteiros.
// Uso: node testes/e2e/tudo.mjs [pedaço-do-nome-do-roteiro ...]
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, readFileSync, createWriteStream } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ctx, resumo, inicioRoteiro, verifica, entrar, espera, rodarRoteiros, guardarSessao } from './lib.mjs';
import { iniciarFocus } from './falsos/focus.mjs';
import { iniciarSpedy } from './falsos/spedy.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = join(aqui, '..', '..');
const PGTESTE = process.env.PGTESTE_DIR || 'C:/Users/UILLIAM/pgteste-vb';

// credenciais de teste do admin (só existem no banco de teste)
const env = Object.fromEntries(
  readFileSync(join(PGTESTE, 'teste.env'), 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

const portaLivre = () => new Promise((ok) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); });
});

const temp = mkdtempSync(join(tmpdir(), 'vb-e2e-'));
let pgSrv = null;
let servidor = null;
let codigoSaida = 1;

async function limpar() {
  try { servidor?.kill(); } catch { /* já saiu */ }
  try { await pgSrv?.stop(); } catch { /* já parou */ }
  try { rmSync(temp, { recursive: true, force: true }); } catch { /* o Windows às vezes segura o arquivo */ }
}

process.on('SIGINT', async () => { await limpar(); process.exit(130); });

try {
  // 1. banco limpo, numa pasta temporária e porta livre
  const { default: EmbeddedPostgres } = await import(pathToFileURL(join(PGTESTE, 'node_modules', 'embedded-postgres', 'dist', 'index.js')).href);
  const portaPg = await portaLivre();
  pgSrv = new EmbeddedPostgres({ databaseDir: join(temp, 'pg'), user: 'vb', password: 'vb', port: portaPg, persistent: false, initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {}, onError: () => {} });
  await pgSrv.initialise();
  await pgSrv.start();
  await pgSrv.createDatabase('vbteste');
  ctx.dbUrl = `postgres://vb:vb@127.0.0.1:${portaPg}/vbteste`;
  console.log(`Banco de teste limpo na porta ${portaPg}`);

  // 2. Focus e Spedy de mentira
  ctx.focus = await iniciarFocus(await portaLivre());
  ctx.spedy = await iniciarSpedy(await portaLivre());

  // 3. servidor (as migrations rodam sozinhas ao subir)
  const porta = await portaLivre();
  ctx.base = `http://127.0.0.1:${porta}/api`;
  const log = createWriteStream(join(aqui, 'servidor.log'));
  const envServidor = { ...process.env };
  delete envServidor.ANTHROPIC_API_KEY; // caminho sem IA
  delete envServidor.ANTHROPIC_BASE_URL;
  delete envServidor.VB_MODO;
  Object.assign(envServidor, {
    DATABASE_URL: ctx.dbUrl,
    DATABASE_SSL: 'false',
    PORT: String(porta),
    JWT_SECRET: 'segredo-so-de-teste-e2e',
    NODE_ENV: 'test',
    SEED_ADMIN_LOGIN: env.SEED_ADMIN_LOGIN,
    SEED_ADMIN_SENHA: env.SEED_ADMIN_SENHA,
    SEED_EMPRESA_NOME: 'Motel Teste',
    SEED_EXEMPLOS: 'true',
    VB_FOTOS_DIR: join(temp, 'fotos'),
    VB_BACKUP_DIR: join(temp, 'backup'),
    VB_CHAVE_MESTRA: 'chave-mestra-so-de-teste-e2e-123',
    FOCUS_URL_HOMOLOGACAO: ctx.focus.url,
    FOCUS_URL_PRODUCAO: ctx.focus.url,
    SPEDY_URL_SANDBOX: ctx.spedy.url,
    SPEDY_URL_PRODUCAO: ctx.spedy.url,
  });
  servidor = spawn(process.execPath, [join(raiz, 'dist', 'main.js')], { cwd: raiz, env: envServidor, stdio: ['ignore', 'pipe', 'pipe'] });
  servidor.stdout.pipe(log);
  servidor.stderr.pipe(log);
  let saiu = null;
  servidor.on('exit', (c) => { saiu = c; });

  inicioRoteiro('00 Subida do servidor e migrations');
  const t0 = Date.now();
  let pronto = false;
  while (Date.now() - t0 < 1_200_000 && saiu === null) {
    try { const r = await fetch(`${ctx.base}/health`); if (r.ok) { pronto = true; break; } } catch { /* ainda subindo */ }
    await espera(500);
  }
  if (!verifica('servidor subiu e respondeu /health (migrations sem erro)', pronto, `saiu com código ${saiu}; veja testes/e2e/servidor.log`)) throw new Error('servidor não subiu');
  const migs = (await import('./lib.mjs')).sql;
  const [m] = await migs(`SELECT count(*)::int n FROM migrations`);
  const arquivos = readdirSync(join(raiz, 'dist', 'database', 'migrations')).filter((f) => f.endsWith('.js')).length;
  verifica(`todas as migrations rodaram (${m.n} de ${arquivos})`, m.n === arquivos, { banco: m.n, arquivos });
  const [enc] = await migs(`SHOW server_encoding`);
  verifica('banco de teste em UTF-8, como o de produção', enc.server_encoding === 'UTF8', enc);
  console.log(`  (servidor pronto em ${Math.round((Date.now() - t0) / 1000)}s)`);

  ctx.admin = await entrar(env.SEED_ADMIN_LOGIN, env.SEED_ADMIN_SENHA);
  ctx.adminLogin = env.SEED_ADMIN_LOGIN;
  ctx.adminSenha = env.SEED_ADMIN_SENHA;
  ctx.chaveMestra = 'chave-mestra-so-de-teste-e2e-123';

  // 4. roteiros, na ordem do nome do arquivo
  await rodarRoteiros(process.argv.slice(2).filter((a) => !a.startsWith('--')));
  if (saiu !== null) verifica('servidor continuou no ar até o fim', false, `saiu com código ${saiu}`);
  codigoSaida = resumo() ? 1 : 0;
  if (process.argv.includes('--manter')) {
    // para desenvolver os roteiros: deixa tudo no ar e roda de novo com node testes/e2e/roteiros.mjs
    guardarSessao();
    console.log('\nTudo continua no ar (--manter). Rode: node testes/e2e/roteiros.mjs [nome]. Ctrl+C encerra.');
    await new Promise(() => {});
  }
} catch (e) {
  console.error('\nERRO GERAL:', e?.stack ?? e);
  resumo();
} finally {
  await limpar();
}
process.exit(codigoSaida);
