// Módulos da licença, ambientes, unidades, tarifas e permissões por perfil.
import { api, verifica, status, exige, entrar } from '../lib.mjs';

export default async function (ctx) {
  const adm = ctx.admin;
  const d = ctx.dados;

  // liga os módulos vendidos à parte (como a Virtual Barra faz pela licença)
  const eu = await adm.get('/auth/eu');
  d.empresaId = eu.json.empresa.id;
  status('licença sem a chave mestra: 403', await api('PUT', `/licenca/${d.empresaId}`, { caixa: true }, undefined, { headers: { 'x-chave-mestra': 'errada-errada-errada-errada-errada' } }), 403);
  const lic = await api('PUT', `/licenca/${d.empresaId}`, { notas: true, caixa: true, estoque: true, hotel: true, restaurante: true, satisfacao: true }, undefined, { headers: { 'x-chave-mestra': ctx.chaveMestra } });
  status('liga os módulos pela licença', lic, 200);

  // ambientes e unidades do exemplo
  const ambs = await adm.get('/ambientes');
  exige('lista ambientes', ambs.status === 200 && Array.isArray(ambs.json), ambs.json);
  const motel = ambs.json.find((a) => a.tipo === 'motel');
  const hotel = ambs.json.find((a) => a.tipo === 'hotel');
  exige('exemplo tem Motel e Hotel', motel && hotel, ambs.json.map((a) => a.nome));
  d.motelId = motel.id;
  d.hotelId = hotel.id;

  const uns = await adm.get(`/unidades?ambienteId=${motel.id}`);
  exige('lista suítes do motel', uns.status === 200 && uns.json.length === 12, uns.json?.length);
  d.suites = uns.json.map((u) => ({ id: u.id, codigo: u.codigo, categoriaId: u.categoriaId ?? u.categoria?.id }));
  const quartos = await adm.get(`/unidades?ambienteId=${hotel.id}`);
  d.quartos = quartos.json.map((u) => ({ id: u.id, codigo: u.codigo, categoriaId: u.categoriaId ?? u.categoria?.id }));
  verifica('hotel tem 4 quartos', d.quartos.length === 4, d.quartos.length);

  // ambiente de restaurante com mesas
  const rest = await adm.post('/ambientes', { nome: 'Restaurante', tipo: 'restaurante', cor: '#EA580C' });
  status('cria ambiente Restaurante', rest, [200, 201]);
  d.restauranteId = rest.json?.id;
  const catMesa = await adm.post('/categorias', { ambienteId: d.restauranteId, nome: 'Salão', tipoUnidade: 'mesa' });
  status('cria categoria de mesas', catMesa, [200, 201]);
  const mesa = await adm.post('/unidades', { ambienteId: d.restauranteId, categoriaId: catMesa.json?.id, codigo: 'MESA 01', tipo: 'mesa' });
  status('cria a MESA 01', mesa, [200, 201]);
  d.mesaId = mesa.json?.id;
  const dup = await adm.post('/unidades', { ambienteId: d.restauranteId, categoriaId: catMesa.json?.id, codigo: 'MESA 01', tipo: 'mesa' });
  verifica('não deixa repetir o código da unidade no mesmo ambiente', dup.status >= 400 && dup.status < 500, dup);

  // tarifas do motel: preços para os períodos do exemplo
  const tar = await adm.get(`/tarifas/${motel.id}`);
  exige('carrega tarifas do motel', tar.status === 200 && tar.json.periodos?.length === 4, tar.json);
  const precosBase = { '4 horas': 70, '6 horas': 90, '12 horas': 130, Pernoite: 160 };
  const cats = tar.json.categorias.map((c) => c.id);
  const corpo = {
    regras: tar.json.regras,
    periodos: tar.json.periodos.map((p) => ({ chave: p.id, nome: p.nome, tipo: p.tipo, duracaoMin: p.duracaoMin, pernoiteInicio: p.pernoiteInicio, pernoiteFim: p.pernoiteFim, ordem: p.ordem })),
    tabelas: tar.json.tabelas.map((t) => ({
      id: t.id, nome: t.nome, diasSemana: t.diasSemana ?? [0, 1, 2, 3, 4, 5, 6], prioridade: t.prioridade ?? 0,
      precos: cats.flatMap((c) => [
        ...tar.json.periodos.map((p) => ({ categoriaId: c, tipo: 'periodo', periodoChave: p.id, valor: precosBase[p.nome], duracaoMin: p.duracaoMin })),
        { categoriaId: c, tipo: 'hora_adicional', valor: 20 },
      ]),
    })),
  };
  const salvo = await adm.put(`/tarifas/${motel.id}`, corpo);
  status('salva preços do motel', salvo, 200);
  const prev = await adm.get(`/tarifas/previa/${d.suites[0].id}`);
  status('prévia do preço da suíte 01', prev, 200);

  // diária do hotel
  const catsHotel = [...new Set(d.quartos.map((q) => q.categoriaId))];
  status('salva diária do hotel (R$ 200)', await adm.put(`/tarifas/diarias/${hotel.id}`, { itens: catsHotel.map((c) => ({ categoriaId: c, diaria: 200, pessoasIncluidas: 2, pessoaExtra: 50 })) }), 200);

  // produtos
  const prods = [];
  for (const [nome, preco] of [['Água 500 ml', 6], ['Cerveja long neck', 14], ['Porção de fritas', 38]]) {
    const r = await adm.post('/produtos', { nome, preco, grupo: 'Teste', controlaEstoque: true });
    status(`cadastra produto ${nome}`, r, [200, 201]);
    prods.push({ id: r.json?.id, nome, preco });
  }
  d.produtos = prods;

  // painel
  const painel = await adm.get(`/painel?ambienteId=${motel.id}`);
  status('painel do motel abre', painel, 200);
  verifica('painel mostra as 12 suítes livres', painel.json?.unidades?.filter((u) => u.status === 'livre').length === 12, painel.json?.resumo);

  // usuários de cada perfil entrando
  const rec = await entrar('recepcao1', 'senha-teste-123', motel.id);
  const cam = await entrar('camareira1', 'senha-teste-123');
  const sai = await entrar('saida1', 'senha-teste-123');
  const ger = await entrar('gerente1', 'senha-teste-123');
  ctx.recepcao = rec; ctx.gerente = ger; ctx.camareira = cam;
  d.logins = { recepcao: 'recepcao1', gerente: 'gerente1', camareira: 'camareira1', saida: 'saida1', portaria: 'portaria1', senha: 'senha-teste-123' };

  status('recepção vê o painel', await rec.get(`/painel?ambienteId=${motel.id}`), 200);
  const proibidosRecepcao = [
    ['GET', '/financeiro/dre'], ['GET', '/financeiro/fluxo'], ['GET', '/caixa/adm'], ['GET', '/contas-pagar'],
    ['GET', '/faturamento/receber'], ['GET', '/usuarios'], ['GET', '/perfis'], ['PUT', `/tarifas/${motel.id}`],
    ['GET', '/caixa/turnos'], ['POST', '/produtos'], ['GET', '/notas-fiscais/emissores'], ['GET', '/conciliacao'],
    ['GET', '/revenda/clientes'], ['GET', '/backup'], ['PATCH', '/empresa'], ['GET', '/estoque/locais'], ['GET', '/contador/holerites'],
  ];
  for (const [m, c] of proibidosRecepcao) {
    const r = await api(m, c, m === 'GET' ? undefined : {}, rec.token);
    verifica(`recepção NÃO acessa ${m} ${c} (403)`, r.status === 403, `veio ${r.status}: ${r.texto.slice(0, 150)}`);
  }
  for (const [m, c] of [['POST', '/estadias'], ['GET', '/caixa/atual'], ['GET', '/relatorios/vendas']]) {
    const r = await api(m, c, m === 'GET' ? undefined : { unidadeId: d.suites[0].id }, cam.token);
    verifica(`camareira NÃO acessa ${m} ${c} (403)`, r.status === 403, `veio ${r.status}: ${r.texto.slice(0, 150)}`);
  }
  verifica('perfil Saída NÃO vê o painel (403)', (await sai.get('/painel')).status === 403);
  status('gerente vê o DRE', await ger.get('/financeiro/dre'), 200);
  verifica('gerente NÃO edita a empresa (só o Administrador)', (await ger.patch('/empresa', { nome: 'Outro nome' })).status === 403);

  // mudança de status pela camareira (limpeza → livre) e bloqueio sem motivo
  const s12 = d.suites[11];
  status('camareira põe a suíte 12 em limpeza', await cam.patch(`/unidades/${s12.id}/status`, { status: 'limpeza' }), 200);
  status('camareira manda a suíte 12 para a vistoria', await cam.patch(`/unidades/${s12.id}/status`, { status: 'vistoria' }), 200);
  status('vistoria libera a suíte 12', await cam.patch(`/unidades/${s12.id}/status`, { status: 'livre' }), 200);
  const semMotivo = await adm.patch(`/unidades/${s12.id}/status`, { status: 'bloqueada' });
  verifica('bloquear sem motivo é recusado (400)', semMotivo.status === 400, semMotivo);
  const motivos = await adm.get('/motivos-bloqueio');
  status('bloqueia com motivo', await adm.patch(`/unidades/${s12.id}/status`, { status: 'bloqueada', motivoBloqueioId: motivos.json[0].id }), 200);
  const camDes = await cam.patch(`/unidades/${s12.id}/status`, { status: 'livre' });
  verifica('camareira NÃO desbloqueia (403)', camDes.status === 403, camDes);
  status('admin desbloqueia', await adm.patch(`/unidades/${s12.id}/status`, { status: 'livre' }), 200);
}
