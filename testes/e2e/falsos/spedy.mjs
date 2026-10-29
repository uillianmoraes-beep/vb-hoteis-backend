// Spedy de mentira: guarda as notas em memória e autoriza na hora.
// Chave "chave-ruim" → 401. GET /__recusar → a próxima nota volta recusada.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

export function iniciarSpedy(porta) {
  const notas = new Map(); // id → nota
  const pedidos = [];
  let recusarProxima = false; // GET /__recusar: a próxima nota volta recusada
  let numero = 500;

  const srv = createServer(async (req, res) => {
    let corpo = '';
    for await (const c of req) corpo += c;
    const json = corpo ? JSON.parse(corpo) : undefined;
    const url = new URL(req.url, 'http://x');
    const chave = req.headers['x-api-key'];
    pedidos.push({ metodo: req.method, caminho: url.pathname, query: Object.fromEntries(url.searchParams), corpo: json, chave });
    const resp = (st, j) => { res.writeHead(st, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j ?? {})); };
    if (url.pathname === '/__pedidos') { pedidos.pop(); return resp(200, pedidos); }
    if (url.pathname === '/__recusar') { pedidos.pop(); recusarProxima = true; return resp(200, { ok: true }); }
    if (chave === 'chave-ruim') return resp(401, { message: 'Unauthorized' });

    const m = url.pathname.match(/^\/v1\/(consumer-invoices|product-invoices|service-invoices)(?:\/([0-9a-f-]{36}))?(?:\/(events|corrections|pdf|xml))?$/);
    if (!m) return resp(404, { message: 'não existe na Spedy falsa' });
    const [, modelo, id, sub] = m;

    if (req.method === 'GET' && !id) {
      const integ = url.searchParams.get('integrationId');
      const items = [...notas.values()].filter((n) => n.modelo === modelo && (!integ || n.integrationId === integ));
      return resp(200, { items: items.slice(0, Number(url.searchParams.get('pageSize') || 50)) });
    }
    if (req.method === 'POST' && !id) {
            const recusa = recusarProxima;
      recusarProxima = false;
      const n = {
        id: randomUUID(), modelo, integrationId: json?.integrationId, status: recusa ? 'rejected' : 'authorized',
        number: recusa ? 0 : ++numero, series: json?.rpsSeries ? Number(json.rpsSeries) : 1, accessKey: recusa ? null : `35${'1'.repeat(40)}${numero}`,
        authorization: { protocol: recusa ? null : `PROT${numero}` }, corpo: json,
        eventos: recusa ? [{ date: new Date().toISOString(), message: 'Rejeição de teste' }] : [],
      };
      notas.set(n.id, n);
      const { corpo: _c, eventos: _e, ...semCorpo } = n;
      return resp(201, { ...semCorpo, status: 'enqueued', number: 0 });
    }
    const n = id ? notas.get(id) : null;
    if (!n) return resp(404, { message: 'nota não encontrada' });
    if (req.method === 'GET' && !sub) { const { corpo: _c, eventos: _e, ...x } = n; return resp(200, x); }
    if (req.method === 'GET' && sub === 'events') return resp(200, n.eventos);
    if (req.method === 'GET' && (sub === 'pdf' || sub === 'xml')) { res.writeHead(200, { 'Content-Type': sub === 'pdf' ? 'application/pdf' : 'application/xml' }); return res.end(sub === 'pdf' ? '%PDF-spedy-falso' : '<xml>spedy</xml>'); }
    if (req.method === 'DELETE') { n.status = 'canceled'; const { corpo: _c, eventos: _e, ...x } = n; return resp(200, x); }
    if (req.method === 'POST' && sub === 'corrections') return resp(200, { ok: true });
    return resp(405, { message: 'método não previsto' });
  });

  return new Promise((ok) => srv.listen(porta, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${porta}`, pedidos, notas, fechar: () => srv.close() })));
}
