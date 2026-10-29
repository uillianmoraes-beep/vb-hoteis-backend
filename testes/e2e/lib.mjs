// Ferramentas comuns dos roteiros: chamar a API, conferir resultados e contar OK/FALHOU.
import pg from 'pg';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ctx = {
  base: '',          // http://127.0.0.1:PORTA/api
  dbUrl: '',
  focus: null,       // Focus falsa (pedidos recebidos em .pedidos)
  spedy: null,       // Spedy falsa
  admin: null,       // { token, usuario }
  dados: {},         // o que um roteiro cria e outro usa
};

const resultados = [];
let roteiroAtual = '';

export function inicioRoteiro(nome) {
  roteiroAtual = nome;
  console.log(`\n=== ${nome}`);
}

/** registra uma verificação: OK ou FALHOU (com o detalhe) */
export function verifica(nome, ok, detalhe) {
  resultados.push({ roteiro: roteiroAtual, nome, ok: !!ok, detalhe });
  const d = !ok && detalhe !== undefined ? ` — ${typeof detalhe === 'string' ? detalhe : JSON.stringify(detalhe).slice(0, 400)}` : '';
  console.log(`  ${ok ? 'OK     ' : 'FALHOU '} ${nome}${d}`);
  return !!ok;
}

/** confere que a resposta veio com o código esperado */
export function status(nome, r, esperado) {
  const lista = Array.isArray(esperado) ? esperado : [esperado];
  return verifica(nome, lista.includes(r.status), `esperado ${lista.join('/')}, veio ${r.status}: ${JSON.stringify(r.json ?? r.texto).slice(0, 300)}`);
}

/** erro que interrompe o roteiro (o resto dele depende disto) */
export function exige(nome, ok, detalhe) {
  if (!verifica(nome, ok, detalhe)) throw new Error(`roteiro interrompido: ${nome}`);
}

export function resumo() {
  const falhas = resultados.filter((r) => !r.ok);
  console.log('\n================ RESUMO ================');
  const porRoteiro = new Map();
  for (const r of resultados) {
    const p = porRoteiro.get(r.roteiro) ?? { ok: 0, falhou: 0 };
    r.ok ? p.ok++ : p.falhou++;
    porRoteiro.set(r.roteiro, p);
  }
  for (const [n, p] of porRoteiro) console.log(`  ${p.falhou ? 'FALHOU' : 'OK    '}  ${n}  (${p.ok} ok${p.falhou ? `, ${p.falhou} falhou` : ''})`);
  console.log(`\n  Total: ${resultados.length} verificações, ${resultados.length - falhas.length} OK, ${falhas.length} FALHOU`);
  if (falhas.length) {
    console.log('\n  O que falhou:');
    for (const f of falhas) console.log(`   - [${f.roteiro}] ${f.nome}`);
  }
  return falhas.length;
}

/** chama a API. Devolve { status, json, texto, headers } (nunca lança por código HTTP) */
export async function api(metodo, caminho, corpo, token, extra = {}) {
  const headers = { ...(extra.headers ?? {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  let body;
  if (corpo instanceof Uint8Array || typeof corpo === 'string') {
    body = corpo;
  } else if (corpo !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(corpo);
  }
  const resp = await fetch(`${ctx.base}${caminho}`, { method: metodo, headers, body });
  const texto = await resp.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { /* não é json */ }
  return { status: resp.status, json, texto, headers: resp.headers };
}

/** cliente com o token guardado */
export function cliente(token) {
  return {
    token,
    get: (c, extra) => api('GET', c, undefined, token, extra),
    post: (c, b, extra) => api('POST', c, b ?? {}, token, extra),
    patch: (c, b, extra) => api('PATCH', c, b ?? {}, token, extra),
    put: (c, b, extra) => api('PUT', c, b ?? {}, token, extra),
    del: (c, b, extra) => api('DELETE', c, b, token, extra),
  };
}

/** faz o login (e entra no ambiente, se pedir). Cada login recebe um IP falso próprio para não cair no limite de 30/10min */
let ipFalso = 10;
export async function entrar(login, senha, ambienteId) {
  const ip = `10.0.0.${ipFalso++ % 250}`;
  const r = await api('POST', '/auth/login', { login, senha }, undefined, { headers: { 'x-forwarded-for': ip } });
  if (r.status !== 200) throw new Error(`login de ${login} falhou: ${r.status} ${r.texto.slice(0, 200)}`);
  let token = r.json.token ?? r.json.accessToken ?? r.json.access_token;
  if (ambienteId) {
    const a = await api('POST', '/auth/ambiente', { ambienteId, tipo: 'login' }, token);
    if (a.status !== 200) throw new Error(`entrar no ambiente falhou: ${a.status} ${a.texto.slice(0, 200)}`);
    token = a.json?.token ?? token;
  }
  return { ...cliente(token), login: r.json };
}

/** consulta direta no banco de teste */
export async function sql(texto, params = []) {
  const c = new pg.Client(ctx.dbUrl);
  await c.connect();
  try { return (await c.query(texto, params)).rows; } finally { await c.end(); }
}

/** roda os roteiros da pasta roteiros/ em ordem (filtro: pedaços do nome) */
export async function rodarRoteiros(filtro = []) {
  const pasta = join(dirname(fileURLToPath(import.meta.url)), 'roteiros');
  const lista = readdirSync(pasta).filter((f) => f.endsWith('.mjs')).sort()
    .filter((f) => !filtro.length || filtro.some((x) => f.includes(x)));
  for (const f of lista) {
    inicioRoteiro(f.replace(/\.mjs$/, ''));
    try {
      const mod = await import(`${pathToFileURL(join(pasta, f)).href}?v=${Date.now()}`);
      await mod.default(ctx);
    } catch (e) {
      const causa = e?.cause ? ` | causa: ${e.cause.code ?? ''} ${e.cause.message ?? e.cause}` : '';
      verifica('roteiro rodou até o fim', false, String(e?.stack ?? e).split('\n').slice(0, 3).join(' | ') + causa);
    }
    guardarSessao();
  }
}

const arquivoSessao = join(dirname(fileURLToPath(import.meta.url)), '.sessao.json');
/** guarda endereços e dados criados (para rodar só um roteiro com o servidor que ficou no ar) */
export function guardarSessao() {
  const { admin, focus, spedy, recepcao, gerente, camareira, ...resto } = ctx;
  writeFileSync(arquivoSessao, JSON.stringify({ ...resto, focusUrl: focus?.url, spedyUrl: spedy?.url }, null, 1));
}
export function lerSessao() {
  return JSON.parse(readFileSync(arquivoSessao, 'utf8'));
}

/** pedidos que a Focus ou a Spedy falsa recebeu */
export async function pedidosRecebidos(falso) {
  return (await fetch(`${falso.url}/__pedidos`)).json();
}

export const hojeSP =() => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
export const espera = (ms) => new Promise((r) => setTimeout(r, ms));
