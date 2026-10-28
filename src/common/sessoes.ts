/**
 * Sessão atual de cada usuário (um computador por vez), guardada por alguns segundos
 * para não consultar o banco a cada pedido da tela.
 */
const cache = new Map<string, { sessao: string | null; ate: number }>();

export const MSG_OUTRO_COMPUTADOR = 'Sua conta foi aberta em outro computador. Entre de novo para continuar aqui (o outro computador sai).';

export function sessaoEmCache(usuarioId: string): string | null | undefined {
  const c = cache.get(usuarioId);
  if (!c || c.ate < Date.now()) return undefined;
  return c.sessao;
}

export function guardarSessao(usuarioId: string, sessao: string | null) {
  if (cache.size > 5000) cache.clear();
  cache.set(usuarioId, { sessao, ate: Date.now() + 15000 });
}
