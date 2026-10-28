/**
 * Proteções gerais do servidor: cabeçalhos de segurança e limite de pedidos por endereço
 * (dificulta robôs testando senhas e copiando o sistema em massa).
 */
interface Req { method: string; url: string; ip?: string; headers: Record<string, string | string[] | undefined> }
interface Res { setHeader(n: string, v: string): void; removeHeader(n: string): void; status(c: number): Res; json(b: unknown): void }

const janelas = new Map<string, { n: number; ate: number }>();

/** rotas sensíveis: [pedaço do caminho, pedidos permitidos, minutos] */
const LIMITES: [RegExp, number, number][] = [
  [/^\/api\/auth\/login/, 30, 10],
  [/^\/api\/auth\/confirmar-senha/, 30, 10],
  [/^\/api\/publico\/revenda\/(teste|parceiro)/, 10, 60],
  [/^\/api\/publico\//, 600, 10],
];

function ipDe(req: Req) {
  const f = req.headers['x-forwarded-for'];
  return ((Array.isArray(f) ? f[0] : f)?.split(',')[0] ?? req.ip ?? '').trim();
}

export function protecao(req: Req, res: Res, next: () => void) {
  res.removeHeader('X-Powered-By');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000');

  if (req.method !== 'OPTIONS') {
    const regra = LIMITES.find(([r]) => r.test(req.url));
    if (regra) {
      const [r, max, min] = regra;
      const chave = `${r.source}|${ipDe(req)}`;
      const agora = Date.now();
      let j = janelas.get(chave);
      if (!j || j.ate < agora) {
        if (janelas.size > 20000) janelas.clear();
        j = { n: 0, ate: agora + min * 60000 };
        janelas.set(chave, j);
      }
      if (++j.n > max) {
        res.status(429).json({ statusCode: 429, message: 'Muitas tentativas seguidas deste endereço. Aguarde alguns minutos e tente de novo.' });
        return;
      }
    }
  }
  next();
}
