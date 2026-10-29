// Dois computadores (ou dois cliques) ao mesmo tempo: não pode abrir duas contas na mesma suíte,
// fechar a mesma conta duas vezes, abrir dois caixas nem emitir a nota duas vezes.
import { verifica, exige, entrar, sql } from '../lib.mjs';

const ok = (r) => r.status === 200 || r.status === 201;

export default async function (ctx) {
  const d = ctx.dados;
  const rec = await entrar(d.logins.recepcao, d.logins.senha);
  const ger = await entrar(d.logins.gerente, d.logins.senha);
  const s9 = d.suites[8];
  // o caixa do motel precisa estar aberto para receber
  const cx = await ctx.admin.get(`/caixa/atual?ambienteId=${d.motelId}`);
  if (!cx.json?.turno) await ctx.admin.post('/caixa/turnos', { ambienteId: d.motelId, trocoInicial: 0 });
  // rodando de novo no mesmo banco: as suítes do teste voltam a ficar livres
  await sql(`UPDATE unidades SET status = 'livre' WHERE id = ANY($1) AND NOT EXISTS (SELECT 1 FROM estadias e WHERE e.unidade_id = unidades.id AND e.status IN ('aberta','conta_entregue'))`, [[s9.id, d.suites[9].id]]);

  const entradas = await Promise.all([rec.post('/estadias', { unidadeId: s9.id }), ger.post('/estadias', { unidadeId: s9.id }), rec.post('/estadias', { unidadeId: s9.id })]);
  verifica('3 entradas ao mesmo tempo na suíte 09: só 1 vale', entradas.filter(ok).length === 1, entradas.map((r) => r.status));
  const [{ n }] = await sql(`SELECT count(*)::int n FROM estadias WHERE unidade_id = $1 AND status IN ('aberta','conta_entregue')`, [s9.id]);
  verifica('no banco, só 1 conta aberta na suíte 09', n === 1, n);
  const conta = entradas.find(ok);
  exige('uma entrada deu certo', conta, entradas.map((r) => r.json));

  // estorno do mesmo item com dois cliques: o produto volta uma vez só ao estoque
  const cerveja = d.produtos[1];
  const comItem = await rec.post(`/estadias/${conta.json.id}/itens`, { produtoId: cerveja.id, quantidade: 2 });
  const item = comItem.json?.itens?.find((i) => i.produtoId === cerveja.id && i.status === 'ativo');
  if (item) {
    const lib = { motivo: 'Lançado errado', autorizacao: { login: d.logins.gerente, senha: d.logins.senha } };
    await Promise.all([rec.post(`/estadias/${conta.json.id}/itens/${item.id}/estornar`, lib), rec.post(`/estadias/${conta.json.id}/itens/${item.id}/estornar`, lib)]);
    const [{ s }] = await sql(`SELECT coalesce(sum(quantidade),0)::float s FROM estoque_movimentos WHERE referencia = $1`, [`item:${item.id}`]);
    verifica('2 estornos do mesmo item ao mesmo tempo: estoque volta ao normal (saldo do item = 0)', s === 0, s);
  }

  const total = (await rec.get(`/estadias/${conta.json.id}`)).json.conta.total;
  const fechamentos = await Promise.all([1, 2, 3].map(() => rec.post(`/estadias/${conta.json.id}/fechar`, { pagamentos: [{ forma: 'pix', valor: total }] })));
  verifica('3 fechamentos ao mesmo tempo: só 1 vale', fechamentos.filter(ok).length === 1, fechamentos.map((r) => r.status));
  const pags = await sql(`SELECT count(*)::int n, coalesce(sum(valor),0)::float s FROM estadia_pagamentos WHERE estadia_id = $1`, [conta.json.id]);
  verifica(`pagamento gravado uma vez só (R$ ${total})`, pags[0].n === 1 && pags[0].s === total, pags[0]);

  // dois caixas no mesmo ambiente
  const amb = d.restauranteId;
  const atual = await ctx.admin.get(`/caixa/atual?ambienteId=${amb}`);
  if (atual.json?.turno?.id) await ctx.admin.post(`/caixa/turnos/${atual.json.turno.id}/fechar`, { contado: atual.json.resumo?.esperado ?? {} });
  const caixas = await Promise.all([ctx.admin.post('/caixa/turnos', { ambienteId: amb, trocoInicial: 0 }), ger.post('/caixa/turnos', { ambienteId: amb, trocoInicial: 0 })]);
  const [{ abertos }] = await sql(`SELECT count(*)::int abertos FROM caixa_turnos WHERE ambiente_id = $1 AND status = 'aberto'`, [amb]);
  verifica('2 aberturas de caixa ao mesmo tempo: só 1 caixa aberto e o outro recebe aviso (400)', abertos === 1 && caixas.some((r) => r.status === 400) && !caixas.some((r) => r.status >= 500), { respostas: caixas.map((r) => r.status), abertos });

  // fechar o mesmo caixa duas vezes ao mesmo tempo (manda o dinheiro para o caixa ADM duas vezes?)
  const [turno] = await sql(`SELECT id FROM caixa_turnos WHERE ambiente_id = $1 AND status = 'aberto'`, [amb]);
  if (turno) {
    await ctx.admin.post(`/caixa/turnos/${turno.id}/movimentos`, { tipo: 'reforco', valor: 30, descricao: 'Troco' });
    const fechs = await Promise.all([ctx.admin.post(`/caixa/turnos/${turno.id}/fechar`, { contado: { dinheiro: 30 }, fundoProximo: 0 }), ger.post(`/caixa/turnos/${turno.id}/fechar`, { contado: { dinheiro: 30 }, fundoProximo: 0 })]);
    const [{ q }] = await sql(`SELECT count(*)::int q FROM caixa_movimentos WHERE turno_id = $1 AND caixa = 'adm'`, [turno.id]);
    verifica('2 fechamentos do mesmo caixa ao mesmo tempo: o dinheiro vai uma vez só para o caixa ADM', q === 1, { respostas: fechs.map((r) => r.status), lancamentosAdm: q });
  }

  // pagar a mesma conta a pagar duas vezes ao mesmo tempo
  const cp = await ger.post('/contas-pagar', { descricao: 'Água (cliques)', valor: 77, vencimento: new Date().toISOString().slice(0, 10) });
  const [cpRow] = await sql(`SELECT id FROM contas_pagar WHERE descricao = 'Água (cliques)' ORDER BY criado_em DESC LIMIT 1`);
  if (cpRow) {
    const pgs = await Promise.all([ger.post(`/contas-pagar/${cpRow.id}/pagar`, { forma: 'dinheiro', lancarCaixa: 'sim' }), ctx.admin.post(`/contas-pagar/${cpRow.id}/pagar`, { forma: 'dinheiro', lancarCaixa: 'sim' })]);
    const [{ q }] = await sql(`SELECT count(*)::int q FROM caixa_movimentos WHERE caixa = 'adm' AND descricao ILIKE '%Água (cliques)%'`);
    verifica('2 baixas da mesma conta a pagar ao mesmo tempo: sai uma vez só do caixa ADM', q <= 1, { respostas: pgs.map((r) => r.status), saidas: q, criada: cp.status });
  }

  // baixa do mesmo título a receber duas vezes ao mesmo tempo
  const lanc = await ctx.admin.post('/faturamento/receber', { clienteId: d.clienteFaturadoId, descricao: 'Título (cliques)', valor: 55, vencimento: new Date().toISOString().slice(0, 10) });
  const [cr] = await sql(`SELECT id FROM contas_receber WHERE descricao = 'Título (cliques)' ORDER BY criado_em DESC LIMIT 1`).catch(() => []);
  if (cr) {
    const bxs = await Promise.all([ctx.admin.post(`/faturamento/receber/${cr.id}/baixar`, { forma: 'pix' }), ger.post(`/faturamento/receber/${cr.id}/baixar`, { forma: 'pix' })]);
    const [{ q }] = await sql(`SELECT count(*)::int q FROM caixa_movimentos WHERE caixa = 'adm' AND tipo = 'entrada' AND descricao ILIKE '%Título (cliques)%'`);
    verifica('2 baixas do mesmo título a receber ao mesmo tempo: entra uma vez só no caixa ADM', q <= 1, { respostas: bxs.map((r) => r.status), entradas: q });
  } else verifica('lança título a receber manual', false, lanc.json);

  // nota da mesma conta emitida duas vezes ao mesmo tempo
  const s10 = d.suites[9];
  const c2 = await rec.post('/estadias', { unidadeId: s10.id });
  if (ok(c2)) {
    await rec.post(`/estadias/${c2.json.id}/itens`, { produtoId: d.produtos[0].id, quantidade: 1 });
    const det = await rec.get(`/estadias/${c2.json.id}`);
    await rec.post(`/estadias/${c2.json.id}/fechar`, { pagamentos: [{ forma: 'dinheiro', valor: det.json.conta.total }] });
    await Promise.all([rec.post(`/notas-fiscais/conta/${c2.json.id}`, { quais: 'nfce' }), ger.post(`/notas-fiscais/conta/${c2.json.id}`, { quais: 'nfce' })]);
    const [{ notas }] = await sql(`SELECT count(*)::int notas FROM notas_fiscais WHERE estadia_id = $1 AND tipo = 'nfce' AND status IN ('autorizado','processando')`, [c2.json.id]);
    verifica('2 cliques em "emitir nota" ao mesmo tempo: só 1 NFC-e', notas === 1, notas);
  }
}
