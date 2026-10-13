/**
 * Vários CNPJs na mesma conta (ex.: motel e hotel juntos, cada um com seu CNPJ).
 * Cada ambiente pode ter CNPJ próprio; sem CNPJ próprio ele é da empresa principal.
 * Nos lançamentos guardamos o CNPJ só com números; null = empresa principal.
 */
export const soDigitos = (s?: string | null) => (s ?? '').replace(/\D/g, '');

interface Consulta { query: (sql: string, params?: unknown[]) => Promise<any> }

/** CNPJ (só números) do ambiente, ou null quando é o da empresa principal */
export async function cnpjDoAmbiente(q: Consulta, ambienteId: string | null | undefined): Promise<string | null> {
  if (!ambienteId) return null;
  const [r] = await q.query(`SELECT a.cnpj, e.cnpj AS principal FROM ambientes a JOIN empresas e ON e.id = a.empresa_id WHERE a.id = $1`, [ambienteId]);
  const proprio = soDigitos(r?.cnpj);
  return proprio && proprio !== soDigitos(r?.principal) ? proprio : null;
}

/** filtro de listagem: '' = todos · 'principal' = empresa principal · números = aquele CNPJ */
export function filtroCnpj(coluna: string, valor: string | undefined, params: unknown[]): string {
  if (!valor) return '';
  if (valor === 'principal') return ` AND ${coluna} IS NULL`;
  const d = soDigitos(valor);
  if (!d) return '';
  params.push(d);
  return ` AND ${coluna} = $${params.length}`;
}

/** valor de CNPJ recebido do formulário: 'principal'/vazio = null */
export const cnpjDoForm = (v?: string | null) => {
  const d = soDigitos(v);
  return v && v !== 'principal' && d ? d : null;
};
