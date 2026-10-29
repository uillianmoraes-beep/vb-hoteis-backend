// Focus NFe de mentira: guarda as notas em memória e autoriza na hora.
// Token "token-ruim" → 401. GET /__recusar → a próxima nota volta recusada.
import { createServer } from 'node:http';

export function iniciarFocus(porta) {
  const notas = new Map(); // `${tipo}/${ref}` → nota
  const pedidos = [];
  let recusarProxima = false; // GET /__recusar: a próxima nota volta recusada
  let numero = 1000;

  const srv = createServer(async (req, res) => {
    let corpo = '';
    for await (const c of req) corpo += c;
    const json = corpo ? JSON.parse(corpo) : undefined;
    const url = new URL(req.url, 'http://x');
    const token = Buffer.from((req.headers.authorization ?? '').replace(/^Basic /, ''), 'base64').toString().replace(/:$/, '');
    pedidos.push({ metodo: req.method, caminho: url.pathname, query: Object.fromEntries(url.searchParams), corpo: json, token });
    const resp = (st, j) => { res.writeHead(st, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j ?? {})); };
    if (url.pathname === '/__pedidos') { pedidos.pop(); return resp(200, pedidos); }
    if (url.pathname === '/__recusar') { pedidos.pop(); recusarProxima = true; return resp(200, { ok: true }); }
    if (token === 'token-ruim') return resp(401, { codigo: 'nao_autorizado', mensagem: 'Token inválido' });

    const m = url.pathname.match(/^\/v2\/(nfce|nfe|nfse|nfsen)(?:\/([^/]+))?(?:\/(carta_correcao))?$/);
    if (!m) {
      if (url.pathname.startsWith('/arquivos/')) { res.writeHead(200, { 'Content-Type': 'application/pdf' }); return res.end('%PDF-falso'); }
      return resp(404, { codigo: 'nao_encontrado', mensagem: 'Caminho não existe na Focus falsa' });
    }
    const [, tipo, refUrl, carta] = m;
    if (req.method === 'POST' && !refUrl) {
      const ref = url.searchParams.get('ref');
      const recusa = recusarProxima;
      recusarProxima = false;
      const n = recusa
        ? { status: 'erro_autorizacao', status_sefaz: '999', mensagem_sefaz: 'Rejeição de teste', ref }
        : {
            status: 'autorizado', status_sefaz: '100', mensagem_sefaz: 'Autorizado o uso', ref, numero: String(++numero), serie: '1',
            chave_nfe: `NFe${'3'.repeat(40)}${numero}`, caminho_xml_nota_fiscal: `/arquivos/${ref}.xml`, caminho_danfe: `/arquivos/${ref}.pdf`,
          };
      notas.set(`${tipo}/${ref}`, { ...n, corpo: json });
      return resp(201, n);
    }
    const n = notas.get(`${tipo}/${refUrl}`);
    if (req.method === 'GET') return n ? resp(200, n) : resp(404, { codigo: 'nao_encontrado', mensagem: 'Nota fiscal não encontrada' });
    if (!n) return resp(404, { codigo: 'nao_encontrado', mensagem: 'Nota fiscal não encontrada' });
    if (req.method === 'DELETE') {
      n.status = 'cancelado';
      n.caminho_xml_cancelamento = `/arquivos/${refUrl}-canc.xml`;
      return resp(200, { status: 'cancelado', status_sefaz: '135', mensagem_sefaz: 'Evento registrado', caminho_xml_cancelamento: n.caminho_xml_cancelamento });
    }
    if (req.method === 'POST' && carta) {
      n.cartas = (n.cartas ?? 0) + 1;
      return resp(201, { status: 'autorizado', status_sefaz: '135', numero_carta_correcao: n.cartas, caminho_pdf_carta_correcao: `/arquivos/${refUrl}-cce.pdf` });
    }
    return resp(405, { mensagem: 'método não previsto' });
  });

  return new Promise((ok) => srv.listen(porta, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${porta}`, pedidos, notas, fechar: () => srv.close() })));
}
