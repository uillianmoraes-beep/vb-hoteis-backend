/**
 * Ponte (lado da nuvem): se a empresa trabalha com servidor local, o que chega pela internet
 * vira um evento para o servidor local buscar. SQL direto para qualquer módulo poder usar.
 */
interface Q { query: (sql: string, params?: unknown[]) => Promise<any> }

export const modoLocalAtivo = () => (process.env.VB_MODO || '').toLowerCase() === 'local';

/** a empresa tem servidor local ativado? (só faz sentido na nuvem) */
export async function empresaNoServidorLocal(q: Q, empresaId: string): Promise<boolean> {
  if (modoLocalAtivo()) return false;
  const [e] = await q.query(`SELECT (servidor_local->>'ativadoEm') IS NOT NULL AS sim FROM empresas WHERE id = $1`, [empresaId]);
  return !!e?.sim;
}

/** guarda o evento para o servidor local; devolve true se a empresa usa servidor local */
export async function enviarParaLocal(q: Q, empresaId: string, tipo: 'reserva' | 'pedido' | 'asaas', dados: unknown): Promise<boolean> {
  if (!(await empresaNoServidorLocal(q, empresaId))) return false;
  await q.query(`INSERT INTO ponte_eventos (empresa_id, tipo, dados) VALUES ($1, $2, $3::jsonb)`, [empresaId, tipo, JSON.stringify(dados)]);
  return true;
}
