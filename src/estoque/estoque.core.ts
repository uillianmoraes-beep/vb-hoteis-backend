/**
 * Movimentação do estoque usada pelos outros módulos (conta, venda avulsa, comanda),
 * sempre dentro da transação de quem chama. SQL direto: não depende de injeção.
 */
interface Q { query: (sql: string, params?: unknown[]) => Promise<any> }

const n3 = (v: number) => Math.round(v * 1000) / 1000;

/** local de estoque do ambiente (cria "Estoque <ambiente>" na primeira vez) */
export async function localDoAmbiente(m: Q, empresaId: string, ambienteId: string | null | undefined): Promise<string> {
  if (ambienteId) {
    const [l] = await m.query(`SELECT id FROM estoque_locais WHERE empresa_id = $1 AND ambiente_id = $2 AND ativo ORDER BY padrao DESC, criado_em LIMIT 1`, [empresaId, ambienteId]);
    if (l) return l.id;
    const [a] = await m.query(
      `SELECT a.nome, a.cnpj, e.cnpj AS principal FROM ambientes a JOIN empresas e ON e.id = a.empresa_id WHERE a.id = $1 AND a.empresa_id = $2`, [ambienteId, empresaId]);
    if (a) {
      const proprio = String(a.cnpj ?? '').replace(/\D/g, '');
      const cnpj = proprio && proprio !== String(a.principal ?? '').replace(/\D/g, '') ? proprio : null;
      const [novo] = await m.query(`INSERT INTO estoque_locais (empresa_id, nome, ambiente_id, cnpj) VALUES ($1,$2,$3,$4) RETURNING id`,
        [empresaId, `Estoque ${a.nome}`, ambienteId, cnpj]);
      return novo.id;
    }
  }
  const [p] = await m.query(`SELECT id FROM estoque_locais WHERE empresa_id = $1 AND ativo ORDER BY padrao DESC, criado_em LIMIT 1`, [empresaId]);
  if (p) return p.id;
  const [novo] = await m.query(`INSERT INTO estoque_locais (empresa_id, nome, padrao) VALUES ($1,'Estoque geral',true) RETURNING id`, [empresaId]);
  return novo.id;
}

export interface Movimento {
  empresaId: string; localId: string; produtoId: string;
  /** positivo entra, negativo sai */
  quantidade: number;
  tipo: 'entrada' | 'consumo' | 'venda' | 'transf_saida' | 'transf_entrada' | 'ajuste' | 'perda' | 'estorno' | 'producao_saida' | 'producao_entrada';
  /** custo de entrada (só nas entradas com custo; o resto usa o custo médio) */
  custoUnitario?: number | null;
  documento?: string | null; referencia?: string | null; observacao?: string | null; usuario?: string | null;
  /** só nas entradas: lote e validade (AAAA-MM-DD) */
  lote?: string | null; validade?: string | null;
}

/** movimenta e atualiza saldo e custo médio; devolve o custo usado */
export async function moverEstoque(m: Q, mv: Movimento): Promise<number> {
  const [s] = await m.query(`SELECT quantidade, custo_medio FROM estoque_saldos WHERE local_id = $1 AND produto_id = $2 FOR UPDATE`, [mv.localId, mv.produtoId]);
  const qAtual = Number(s?.quantidade ?? 0);
  let custo = Number(s?.custo_medio ?? 0);
  if (mv.quantidade > 0 && mv.custoUnitario !== undefined && mv.custoUnitario !== null) {
    // custo médio ponderado (saldo negativo não pesa)
    const base = Math.max(0, qAtual);
    custo = base + mv.quantidade > 0 ? (base * custo + mv.quantidade * mv.custoUnitario) / (base + mv.quantidade) : mv.custoUnitario;
  }
  const novo = n3(qAtual + mv.quantidade);
  await m.query(
    `INSERT INTO estoque_saldos (local_id, produto_id, quantidade, custo_medio) VALUES ($1,$2,$3,$4)
     ON CONFLICT (local_id, produto_id) DO UPDATE SET quantidade = $3, custo_medio = $4`,
    [mv.localId, mv.produtoId, novo, custo.toFixed(4)]);
  const custoMov = mv.quantidade > 0 && mv.custoUnitario !== undefined && mv.custoUnitario !== null ? mv.custoUnitario : custo;
  await m.query(
    `INSERT INTO estoque_movimentos (empresa_id, local_id, produto_id, tipo, quantidade, custo_unitario, saldo_depois, documento, referencia, observacao, usuario_nome, lote, validade)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [mv.empresaId, mv.localId, mv.produtoId, mv.tipo, n3(mv.quantidade), custoMov.toFixed(4), novo, mv.documento ?? null, mv.referencia ?? null,
      mv.observacao?.slice(0, 300) ?? null, mv.usuario ?? null, mv.lote?.trim().slice(0, 40) || null, mv.validade || null]);
  return custoMov;
}

/** consumo (conta, comanda, venda avulsa): baixa no local do ambiente, se o produto controla estoque */
export async function baixarConsumo(m: Q, empresaId: string, ambienteId: string | null | undefined, produtoId: string | null | undefined, quantidade: number,
  ref: { referencia: string; observacao?: string; usuario?: string; tipo?: 'consumo' | 'venda' }) {
  if (!produtoId || !(quantidade > 0)) return;
  const [p] = await m.query(`SELECT nome, controla_estoque, ficha_rendimento FROM produtos WHERE id = $1 AND empresa_id = $2`, [produtoId, empresaId]);
  if (!p) return;
  // ficha técnica: baixa os insumos da receita (proporcional ao rendimento) em vez do próprio produto
  const insumos: { insumo_id: string; quantidade: string; controla_estoque: boolean }[] = await m.query(
    `SELECT pi.insumo_id, pi.quantidade, i.controla_estoque FROM produto_insumos pi JOIN produtos i ON i.id = pi.insumo_id WHERE pi.produto_id = $1`, [produtoId]);
  if (insumos.length) {
    const localFicha = await localDoAmbiente(m, empresaId, ambienteId);
    const rend = Number(p.ficha_rendimento) > 0 ? Number(p.ficha_rendimento) : 1;
    for (const i of insumos) {
      if (!i.controla_estoque) continue;
      await moverEstoque(m, { empresaId, localId: localFicha, produtoId: i.insumo_id, quantidade: -n3((Number(i.quantidade) / rend) * quantidade), tipo: ref.tipo ?? 'consumo',
        referencia: ref.referencia, observacao: `${ref.observacao ? `${ref.observacao} · ` : ''}ficha de ${p.nome}`, usuario: ref.usuario });
    }
    return;
  }
  if (!p.controla_estoque) return;
  const localId = await localDoAmbiente(m, empresaId, ambienteId);
  await moverEstoque(m, { empresaId, localId, produtoId, quantidade: -quantidade, tipo: ref.tipo ?? 'consumo', referencia: ref.referencia, observacao: ref.observacao, usuario: ref.usuario });
}

/** desfaz as baixas de uma referência (item estornado, venda cancelada) */
export async function devolverConsumo(m: Q, empresaId: string, referencia: string, usuario?: string) {
  const movs = await m.query(
    `SELECT local_id, produto_id, SUM(quantidade) AS q FROM estoque_movimentos WHERE empresa_id = $1 AND referencia = $2 GROUP BY local_id, produto_id`, [empresaId, referencia]);
  for (const x of movs) {
    const q = Number(x.q);
    if (q < 0) await moverEstoque(m, { empresaId, localId: x.local_id, produtoId: x.produto_id, quantidade: -q, tipo: 'estorno', referencia, observacao: 'Estorno do consumo', usuario });
  }
}
