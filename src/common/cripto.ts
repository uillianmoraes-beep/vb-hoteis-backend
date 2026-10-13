import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/** Criptografia de segredos guardados no banco (chaves de API), com chave derivada do segredo do servidor. */
const chaveServidor = (uso: string) => createHash('sha256').update(`${uso}:${process.env.JWT_SECRET ?? ''}`).digest();

export function cifrar(texto: string, uso = 'vb-cobranca'): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', chaveServidor(uso), iv);
  const enc = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return [iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}

export function decifrar(t: string, uso = 'vb-cobranca'): string {
  const [iv, tag, enc] = t.split('.');
  const d = createDecipheriv('aes-256-gcm', chaveServidor(uso), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString('utf8');
}
