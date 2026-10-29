// Revenda: planos, teste grátis pelo site, parceiros com código, bloqueio por atraso (402)
// e isolamento entre empresas (o cliente novo não enxerga nada da primeira empresa).
import { api, verifica, status, exige, entrar } from '../lib.mjs';

let ip = 1;
const site = (caminho, corpo) => api('POST', caminho, corpo, undefined, { headers: { 'x-forwarded-for': `10.77.0.${ip++}` } });

export default async function (ctx) {
  const d = ctx.dados;
  const adm = ctx.admin;
  const marca = Date.now().toString(36);

  // planos
  const plano = await adm.post('/revenda/planos', { nome: `Motel Básico ${marca}`, preco: 199.9, modulos: { caixa: true, notas: true }, itens: ['Painel', 'Caixa'], destaque: false, ativo: true, segmento: 'hospedagem' });
  status('Virtual Barra cria um plano', plano, [200, 201]);
  const pub = await api('GET', '/publico/revenda/planos');
  status('site lista os planos sem login', pub, 200);
  verifica('plano novo aparece no site', JSON.stringify(pub.json).includes(`Motel Básico ${marca}`), JSON.stringify(pub.json).slice(0, 200));

  // parceiro pelo site → Virtual Barra aprova e dá o código
  const sp = await site('/publico/revenda/parceiro', { tipo: 'indicacao', nome: `Parceiro ${marca}`, responsavel: 'Carlos', email: `parceiro-${marca}@exemplo.com`, telefone: '24999998888' });
  status('alguém se cadastra como parceiro pelo site', sp, 200);
  const parcs = await adm.get('/revenda/parceiros');
  status('lista parceiros', parcs, 200);
  const listaP = parcs.json?.parceiros ?? parcs.json ?? [];
  const p = listaP.find?.((x) => x.nome === `Parceiro ${marca}`);
  exige('parceiro novo aparece pendente', p, listaP);
  const codigo = `T${marca}`.slice(0, 10).toUpperCase();
  status('aprova o parceiro com um código', await adm.put(`/revenda/parceiros/${p.id}`, { tipo: 'indicacao', nome: p.nome, codigo, comissao: 10, desconto: 5, situacao: 'ativo' }), 200);
  status('código do parceiro abre no site', await api('GET', `/publico/revenda/parceiro/${codigo}`), 200);
  status('código que não existe: 404', await api('GET', '/publico/revenda/parceiro/NAOEXISTE9'), [404, 400]);

  // teste grátis
  const email = `cliente-${marca}@exemplo.com`;
  const semAceite = await site('/publico/revenda/teste', { empresa: 'Motel Novo', nome: 'Dono', email, telefone: '24988887777', senha: 'senha-cliente-1', tipo: 'motel', aceite: false });
  verifica('sem aceitar os termos, não cria', semAceite.json?.ok === false, semAceite.json);
  const t = await site('/publico/revenda/teste', { empresa: `Motel Novo ${marca}`, nome: 'Dono Novo', email, telefone: '24988887777', senha: 'senha-cliente-1', tipo: 'motel', aceite: true, parceiro: codigo });
  status('teste grátis cria a empresa', t, 200);
  const dup = await site('/publico/revenda/teste', { empresa: 'Outro', nome: 'Dono', email, telefone: '24988887777', senha: 'senha-cliente-1', tipo: 'motel', aceite: true });
  verifica('mesmo e-mail não cria de novo', dup.status === 400, dup.json);
  const cli = await entrar(email, 'senha-cliente-1');
  verifica('dono do teste entra com o e-mail', !!cli.token);
  const eu = await cli.get('/auth/eu');
  verifica('empresa nova está em teste', eu.json?.assinatura?.situacao === 'teste', eu.json?.assinatura);
  const empresaNova = eu.json?.empresa?.id;
  verifica('empresa nova é outra empresa', empresaNova && empresaNova !== d.empresaId);
  status('dono do teste usa o painel', await cli.get('/painel'), 200);

  // isolamento entre empresas
  const umaSuite = d.suites[0];
  verifica('cliente NÃO vê suíte da outra empresa (404)', [403, 404].includes((await cli.get(`/unidades/${umaSuite.id}`)).status));
  verifica('cliente NÃO muda status de suíte da outra empresa', [403, 404].includes((await cli.patch(`/unidades/${umaSuite.id}/status`, { status: 'limpeza' })).status));
  const [conta] = await (await import('../lib.mjs')).sql(`SELECT id FROM estadias WHERE empresa_id = $1 LIMIT 1`, [d.empresaId]);
  if (conta) {
    verifica('cliente NÃO abre conta da outra empresa (404)', [403, 404].includes((await cli.get(`/estadias/${conta.id}`)).status));
    verifica('cliente NÃO lança item em conta da outra empresa', [403, 404].includes((await cli.post(`/estadias/${conta.id}/itens`, { descricao: 'x', quantidade: 1, precoUnitario: 1 })).status));
  }
  const { sql } = await import('../lib.mjs');
  const um = async (t) => (await sql(`SELECT id FROM ${t} WHERE empresa_id = $1 LIMIT 1`, [d.empresaId]))[0]?.id;
  const alheios = [
    ['PATCH', `/produtos/${d.produtos[0].id}`, { preco: 0.01 }],
    ['GET', `/faturamento/clientes/${d.clienteFaturadoId}/extrato`],
    ['POST', `/contas-pagar/${await um('contas_pagar')}/pagar`, { forma: 'pix' }],
    ['POST', `/contas-pagar/${await um('contas_pagar')}/cancelar`, {}],
    ['GET', `/caixa/turnos/${d.turnoMotel}`],
    ['POST', `/caixa/turnos/${d.turnoMotel}/movimentos`, { tipo: 'sangria', valor: 1, descricao: 'x' }],
    ['GET', `/notas-fiscais/${await um('notas_fiscais')}`],
    ['POST', `/notas-fiscais/${await um('notas_fiscais')}/cancelar`, { justificativa: 'Tentativa de outra empresa cancelar' }],
    ['POST', `/reservas/${await um('reservas')}/cancelar`, { motivo: 'x' }],
    ['GET', `/funcionarios/${await um('funcionarios')}`],
    ['GET', `/tarifas/${d.motelId}`],
    ['POST', `/faturamento/receber/${await um('contas_receber')}/baixar`, { forma: 'pix' }],
  ];
  for (const [m, c, b] of alheios) {
    const r = await api(m, c, b, cli.token);
    verifica(`cliente NÃO mexe na outra empresa: ${m} ${c.replace(/[0-9a-f-]{36}/, ':id')}`, [403, 404].includes(r.status), `${r.status}: ${r.texto.slice(0, 150)}`);
  }
  const [prod] = await sql(`SELECT preco FROM produtos WHERE id = $1`, [d.produtos[0].id]);
  verifica('preço do produto da primeira empresa continua igual', Number(prod.preco) === d.produtos[0].preco, prod);
  const unsCli = await cli.get('/unidades');
  verifica('lista de unidades do cliente só tem as dele', Array.isArray(unsCli.json) && !unsCli.json.some((u) => u.id === umaSuite.id), unsCli.json?.length);
  for (const r of ['/revenda/clientes', '/revenda/planos', '/revenda/parceiros', '/revenda/mensalidades', '/revenda/config']) {
    verifica(`cliente NÃO acessa ${r} (só a Virtual Barra)`, (await cli.get(r)).status === 403);
  }
  verifica('cliente NÃO cria plano', (await cli.post('/revenda/planos', { nome: 'Hack', preco: 0, modulos: {}, itens: [], destaque: false, ativo: true })).status === 403);
  verifica('cliente NÃO usa a licença sem a chave mestra', (await api('PUT', `/licenca/${empresaNova}`, { notas: true })).status === 403);

  // painel da revenda vê o cliente com o parceiro
  const clientes = await adm.get('/revenda/clientes');
  status('Virtual Barra lista os clientes', clientes, 200);
  const lc = clientes.json?.clientes ?? clientes.json ?? [];
  const c = lc.find?.((x) => x.id === empresaNova);
  verifica('cliente novo aparece em teste', c?.situacao === 'teste', c);
  verifica('cliente veio pelo parceiro', c && (c.parceiroId === p.id || c.parceiro_id === p.id || JSON.stringify(c).includes(p.id) || JSON.stringify(c).includes(p.nome)), c);

  // bloqueio por atraso
  status('Virtual Barra bloqueia o cliente', await adm.patch(`/revenda/clientes/${empresaNova}`, { situacao: 'bloqueada' }), 200);
  const bloq = await cli.get('/painel');
  verifica('cliente bloqueado recebe 402 no painel', bloq.status === 402 && bloq.json?.bloqueado === true, bloq);
  status('bloqueado ainda abre a Área do cliente (para pagar)', await cli.get('/area-cliente'), 200);
  status('bloqueado ainda vê /auth/eu', await cli.get('/auth/eu'), 200);
  verifica('bloqueado NÃO dá entrada em suíte (402)', (await cli.post('/estadias', { unidadeId: umaSuite.id })).status === 402);
  status('Virtual Barra libera de novo', await adm.patch(`/revenda/clientes/${empresaNova}`, { situacao: 'ativa' }), 200);
  status('liberado, volta a usar o painel', await cli.get('/painel'), 200);

  // limite de cadastros pelo site (10 por hora por endereço)
  let ultimo;
  for (let i = 0; i < 11; i++) ultimo = await api('POST', '/publico/revenda/teste', { empresa: 'Robô', nome: 'Robô', email: `robo${i}-${marca}@exemplo.com`, telefone: '24900000000', senha: 'robo123', tipo: 'motel', aceite: true }, undefined, { headers: { 'x-forwarded-for': '10.88.88.88' } });
  status('11º cadastro seguido do mesmo endereço: 429', ultimo, 429);
}
