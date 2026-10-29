// Estoque (locais, entrada, baixa pela venda na conta, estorno devolve, transferência, inventário, perda)
// e compras (fornecedor, cotação com resposta pelo link público, recebimento entrando no estoque).
import { api, verifica, status, exige, entrar } from '../lib.mjs';

export default async function (ctx) {
  const d = ctx.dados;
  const adm = ctx.admin;
  const [, cerveja] = d.produtos;

  const lm = await adm.post('/estoque/locais', { nome: 'Bar do motel', ambienteId: d.motelId, padrao: true });
  exige('cria local de estoque do motel', [200, 201].includes(lm.status), lm.json);
  const lr = await adm.post('/estoque/locais', { nome: 'Almoxarifado', padrao: false });
  exige('cria almoxarifado', [200, 201].includes(lr.status), lr.json);
  const motelLocal = lm.json.id, almox = lr.json.id;

  const saldo = async (localId) => {
    const s = await adm.get('/estoque/saldos');
    const p = (s.json?.produtos ?? s.json ?? []).find?.((x) => x.id === cerveja.id);
    return p?.saldos?.[localId] ?? 0;
  };

  status('entrada de 24 cervejas a R$ 5', await adm.post('/estoque/entrada', { localId: motelLocal, documento: 'NF 123', itens: [{ produtoId: cerveja.id, quantidade: 24, custo: 5 }] }), [200, 201]);
  verifica('saldo do bar = 24', (await saldo(motelLocal)) === 24, await saldo(motelLocal));

  // venda na conta baixa o estoque do local do ambiente; o estorno devolve
  const rec = await entrar(d.logins.recepcao, d.logins.senha);
  const s8 = d.suites[7];
  const c = await rec.post('/estadias', { unidadeId: s8.id });
  exige('entrada na suíte 08', [200, 201].includes(c.status), c.json);
  await rec.post(`/estadias/${c.json.id}/itens`, { produtoId: cerveja.id, quantidade: 3 });
  verifica('vender 3 cervejas baixa o saldo para 21', (await saldo(motelLocal)) === 21, await saldo(motelLocal));
  const det = await rec.get(`/estadias/${c.json.id}`);
  const item = det.json.itens.find((i) => i.produtoId === cerveja.id);
  await rec.post(`/estadias/${c.json.id}/itens/${item.id}/estornar`, { motivo: 'Lançado errado', autorizacao: { login: d.logins.gerente, senha: d.logins.senha } });
  verifica('estorno do item devolve ao estoque (24)', (await saldo(motelLocal)) === 24, await saldo(motelLocal));
  await rec.post(`/estadias/${c.json.id}/itens`, { produtoId: cerveja.id, quantidade: 2 });
  status('gerente cancela a entrada da 08', await ctx.gerente.post(`/estadias/${c.json.id}/cancelar`, { motivo: 'Teste de estoque', destino: 'livre' }), 200);
  verifica('cancelar a entrada devolve o consumo ao estoque (24)', (await saldo(motelLocal)) === 24, await saldo(motelLocal));

  // transferência
  const demais = await adm.post('/estoque/transferencia', { origemId: motelLocal, destinoId: almox, itens: [{ produtoId: cerveja.id, quantidade: 500 }] });
  verifica('transferir mais do que tem é recusado', demais.status === 400 && /insuficiente/i.test(demais.json?.message ?? ''), demais.json);
  const mesmo = await adm.post('/estoque/transferencia', { origemId: motelLocal, destinoId: motelLocal, itens: [{ produtoId: cerveja.id, quantidade: 1 }] });
  verifica('transferir para o mesmo local é recusado', mesmo.status === 400, mesmo.json);
  status('transfere 4 para o almoxarifado', await adm.post('/estoque/transferencia', { origemId: motelLocal, destinoId: almox, itens: [{ produtoId: cerveja.id, quantidade: 4 }] }), [200, 201]);
  verifica('bar 20 e almoxarifado 4', (await saldo(motelLocal)) === 20 && (await saldo(almox)) === 4, [await saldo(motelLocal), await saldo(almox)]);

  // inventário e perda
  status('inventário: contou 18 no bar', await adm.post('/estoque/inventario', { localId: motelLocal, itens: [{ produtoId: cerveja.id, quantidade: 18 }] }), [200, 201]);
  verifica('saldo ajustado para 18', (await saldo(motelLocal)) === 18, await saldo(motelLocal));
  const invNeg = await adm.post('/estoque/inventario', { localId: motelLocal, itens: [{ produtoId: cerveja.id, quantidade: -3 }] });
  verifica('inventário com quantidade negativa é recusado', invNeg.status === 400, invNeg.json);
  status('perda de 1 garrafa quebrada', await adm.post('/estoque/perda', { localId: motelLocal, tipo: 'perda', observacao: 'Quebrou', itens: [{ produtoId: cerveja.id, quantidade: 1 }] }), [200, 201]);
  verifica('saldo 17 depois da perda', (await saldo(motelLocal)) === 17, await saldo(motelLocal));
  status('movimentos do estoque', await adm.get('/estoque/movimentos'), 200);
  status('relatório do estoque', await adm.get('/estoque/relatorio'), 200);
  status('produtos abaixo do mínimo', await adm.get('/estoque/abaixo-minimo'), 200);

  // compras
  const forn = await adm.post('/fornecedores', { nome: 'Distribuidora Teste', cnpj: '11.444.777/0001-61', email: 'vendas@exemplo.com' });
  exige('cadastra fornecedor', [200, 201].includes(forn.status), forn.json);
  const cot = await adm.post('/cotacoes', { titulo: 'Cerveja do mês', localId: motelLocal, itens: [{ produtoId: cerveja.id, descricao: 'Cerveja long neck', quantidade: 48 }], fornecedores: [forn.json.id] });
  exige('cria cotação com o fornecedor', [200, 201].includes(cot.status), cot.json);
  const cd = await adm.get(`/cotacoes/${cot.json.id}`);
  status('abre a cotação', cd, 200);
  const cf = (cd.json.fornecedores ?? [])[0];
  const token = cf?.token ?? cf?.link?.split('/').pop();
  exige('fornecedor da cotação tem o link de resposta', !!token, cd.json);
  status('link inventado não abre (404)', await api('GET', '/publico/cotacao/token-que-nao-existe'), [404, 400]);
  const pub = await api('GET', `/publico/cotacao/${token}`);
  status('fornecedor abre a cotação pelo link, sem login', pub, 200);
  verifica('o link do fornecedor não mostra o preço de outros fornecedores nem o custo', !/custo|custoMedio/i.test(pub.texto), pub.texto.slice(0, 200));
  const itemId = (pub.json.itens ?? cd.json.itens)[0].id;
  status('fornecedor responde com o preço', await api('POST', `/publico/cotacao/${token}`, { precos: [{ itemId, preco: 4.5 }], prazoEntrega: '2 dias' }), [200, 201]);
  status('escolhe o menor preço', await adm.post(`/cotacoes/${cot.json.id}/menor-preco`), [200, 201]);
  status('fecha a cotação', await adm.post(`/cotacoes/${cot.json.id}/fechar`), [200, 201]);
  const receb = await adm.post(`/cotacoes/${cot.json.id}/receber/${cf.id}`, { localId: motelLocal, documento: 'NF 999' });
  status('recebe a mercadoria do pedido', receb, [200, 201]);
  verifica('recebimento entra no estoque do bar (17 + 48 = 65)', (await saldo(motelLocal)) === 65, await saldo(motelLocal));
}
