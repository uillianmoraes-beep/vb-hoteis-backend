// Notas fiscais: emissor Focus (motel) e Spedy (hotel, CNPJ próprio), NFC-e + NFS-e da conta,
// recusa com motivo, cancelamento, PDF da Spedy pelo próprio sistema, relatórios /notas e filtro por forma.
import { api, verifica, status, exige, entrar, sql, pedidosRecebidos } from '../lib.mjs';

const CNPJ_EMPRESA = '11222333000181';
const CNPJ_HOTEL = '11444777000161';
const FISCAL = { ncm: '22021000', cfop: '5102', cstIcms: '102', origem: '0' };

export default async function (ctx) {
  const d = ctx.dados;
  const adm = ctx.admin;
  const rec = await entrar(d.logins.recepcao, d.logins.senha);

  // CNPJs: a empresa (motel) e o hotel com CNPJ próprio
  status('cadastra o CNPJ da empresa', await adm.patch('/empresa', { cnpj: CNPJ_EMPRESA }), 200);
  status('hotel com CNPJ próprio', await adm.patch(`/ambientes/${d.hotelId}`, { cnpj: CNPJ_HOTEL }), 200);
  const emis = await adm.get('/notas-fiscais/emissores');
  exige('lista os CNPJs para ligar o emissor', emis.status === 200 && emis.json.length === 2, emis.json);

  // emissores
  const ibgeRuim = await adm.put(`/notas-fiscais/emissores/${CNPJ_EMPRESA}`, { ambiente: 'homologacao', provedor: 'focus', tokenHomologacao: 'token-bom', dados: { codigoMunicipio: '123' } });
  verifica('código IBGE com menos de 7 números é recusado', ibgeRuim.status === 400, ibgeRuim.json);
  const estranho = await adm.put('/notas-fiscais/emissores/99888777000100', { ambiente: 'homologacao', tokenHomologacao: 'x' });
  verifica('não liga emissor em CNPJ que não é da empresa', estranho.status === 400, estranho.json);
  status('liga a Focus no CNPJ da empresa', await adm.put(`/notas-fiscais/emissores/${CNPJ_EMPRESA}`, {
    ambiente: 'homologacao', provedor: 'focus', tokenHomologacao: 'token-ruim', nfsePadrao: 'nacional',
    dados: { codigoMunicipio: '3300308', uf: 'RJ', regime: 'simples', aliquotaIss: 5 },
  }), 200);
  const testeRuim = await adm.post(`/notas-fiscais/emissores/${CNPJ_EMPRESA}/testar`);
  verifica('token errado: o teste avisa que a Focus recusou', testeRuim.status === 400 && /token/i.test(testeRuim.json?.message ?? ''), testeRuim.json);
  const salvo = await adm.put(`/notas-fiscais/emissores/${CNPJ_EMPRESA}`, {
    ambiente: 'homologacao', provedor: 'focus', tokenHomologacao: 'token-bom', nfsePadrao: 'nacional',
    dados: { codigoMunicipio: '3300308', uf: 'RJ', regime: 'simples', aliquotaIss: 5 },
  });
  status('troca para o token certo', salvo, 200);
  verifica('o token não volta inteiro na tela (só o final)', salvo.json?.tokenHomologacao?.startsWith('••••') && !JSON.stringify(salvo.json).includes('token-bom'), salvo.json?.tokenHomologacao);
  const [cripto] = await sql(`SELECT token_homologacao FROM focus_emissores WHERE cnpj = $1`, [CNPJ_EMPRESA]);
  verifica('token gravado cifrado no banco', cripto && !String(cripto.token_homologacao).includes('token-bom'), cripto);
  status('teste da Focus com o token certo', await adm.post(`/notas-fiscais/emissores/${CNPJ_EMPRESA}/testar`), 200);
  status('liga a Spedy no CNPJ do hotel', await adm.put(`/notas-fiscais/emissores/${CNPJ_HOTEL}`, {
    ambiente: 'homologacao', provedor: 'spedy', spedyHomologacao: 'chave-boa', nfsePadrao: 'nacional', dpsSerie: 900,
    dados: { codigoMunicipio: '3300308', uf: 'RJ', regime: 'simples', aliquotaIss: 5 },
  }), 200);
  status('teste da Spedy', await adm.post(`/notas-fiscais/emissores/${CNPJ_HOTEL}/testar`), 200);
  const lig = await rec.get('/notas-fiscais/ligado');
  verifica('recepção vê que as notas estão ligadas (homologação)', lig.json?.ligado === true && lig.json?.ambiente === 'homologacao', lig.json);

  // tributação dos produtos
  const [agua, cerveja] = d.produtos;
  for (const p of [agua, cerveja]) status(`tributação do produto ${p.nome}`, await adm.patch(`/produtos/${p.id}`, { fiscal: FISCAL }), 200);

  // conta do motel: consumo + hospedagem → NFC-e e NFS-e pela Focus
  const s6 = d.suites[5];
  const c1 = await rec.post('/estadias', { unidadeId: s6.id });
  exige('entrada na suíte 06', [200, 201].includes(c1.status), c1.json);
  await rec.post(`/estadias/${c1.json.id}/itens`, { produtoId: agua.id, quantidade: 2 });
  await rec.post(`/estadias/${c1.json.id}/itens`, { produtoId: cerveja.id, quantidade: 1 });
  const antes = await rec.post(`/notas-fiscais/conta/${c1.json.id}`, {});
  verifica('nota antes de fechar a conta é recusada', antes.status === 400, antes.json);
  const det1 = await rec.get(`/estadias/${c1.json.id}`);
  status('fecha a conta da 06 no pix', await rec.post(`/estadias/${c1.json.id}/fechar`, { pagamentos: [{ forma: 'pix', valor: det1.json.conta.total }] }), 200);
  const pend = await rec.get('/notas?status=pendente');
  status('/notas lista as pendentes', pend, 200);
  const itensPend = pend.json?.itens ?? pend.json;
  verifica('conta da 06 aparece nas notas a emitir', Array.isArray(itensPend) && itensPend.some((x) => (x.estadiaId ?? x.id) === c1.json.id), pend.json);
  const soPix = await rec.get('/notas?status=pendente&forma=pix');
  const soDin = await rec.get('/notas?status=pendente&forma=dinheiro');
  const lp = soPix.json?.itens ?? soPix.json, ld = soDin.json?.itens ?? soDin.json;
  verifica('filtro forma=pix traz a conta da 06', lp.some((x) => (x.estadiaId ?? x.id) === c1.json.id), lp.length);
  verifica('filtro forma=dinheiro NÃO traz a conta da 06', !ld.some((x) => (x.estadiaId ?? x.id) === c1.json.id), ld.length);
  const formaRuim = await rec.get('/notas?status=pendente&forma=bitcoin');
  verifica('forma desconhecida é ignorada (sem erro 500)', formaRuim.status === 200, formaRuim.status);

  const em1 = await rec.post(`/notas-fiscais/conta/${c1.json.id}`, {});
  status('emite as notas da conta (Focus)', em1, 200);
  const notas1 = em1.json?.notas ?? [];
  verifica('saíram 2 notas: NFC-e (consumo) e NFS-e (hospedagem)', notas1.length === 2, em1.json);
  verifica('as duas autorizadas', notas1.every((n) => n.status === 'autorizado'), notas1.map((n) => [n.tipo, n.status, n.mensagem]));
  const pf = await pedidosRecebidos(ctx.focus);
  const nfce = pf.find((p) => p.metodo === 'POST' && p.caminho === '/v2/nfce');
  verifica('Focus recebeu a NFC-e com o CNPJ da empresa', nfce?.corpo?.cnpj_emitente === CNPJ_EMPRESA, nfce?.corpo?.cnpj_emitente);
  verifica('NFC-e com 2 itens e pagamento Pix (17)', nfce?.corpo?.items?.length === 2 && nfce?.corpo?.formas_pagamento?.[0]?.forma_pagamento === '17', nfce?.corpo?.formas_pagamento);
  const somaItens = nfce ? nfce.corpo.items.reduce((s, i) => s + i.valor_bruto - (i.valor_desconto ?? 0), 0) : 0;
  verifica('NFC-e soma o consumo (2×6 + 14 = 26)', Math.abs(somaItens - 26) < 0.001, somaItens);
  const nfsen = pf.find((p) => p.metodo === 'POST' && p.caminho === '/v2/nfsen');
  verifica('NFS-e nacional da hospedagem (R$ 70) com série e número da DPS', nfsen?.corpo?.valor_servico === 70 && nfsen?.corpo?.serie_dps && nfsen?.corpo?.numero_dps, nfsen?.corpo);
  const deNovo = await rec.post(`/notas-fiscais/conta/${c1.json.id}`, {});
  verifica('não emite a mesma conta duas vezes', deNovo.status === 400, deNovo.json);

  const lista = await adm.get(`/notas-fiscais?estadiaId=${c1.json.id}`);
  status('/notas-fiscais lista as notas da conta', lista, 200);
  const unid = await rec.get(`/notas/unidade/${s6.id}`);
  status('/notas/unidade/:id (últimas contas da suíte com as notas)', unid, 200);
  verifica('a última conta da 06 traz as 2 notas', JSON.stringify(unid.json).includes(c1.json.id), unid.json);
  const emitidas = await rec.get('/notas?status=emitida');
  const le = emitidas.json?.itens ?? emitidas.json;
  verifica('conta da 06 passa para "emitida"', le.some((x) => (x.estadiaId ?? x.id) === c1.json.id), le.length);

  // cancelamento da NFC-e
  const nfceNota = notas1.find((n) => n.tipo === 'nfce');
  const curta = await rec.post(`/notas-fiscais/${nfceNota?.id}/cancelar`, { justificativa: 'curta' });
  verifica('justificativa curta é recusada', curta.status === 400, curta.json);
  const cancRec = await rec.post(`/notas-fiscais/${nfceNota?.id}/cancelar`, { justificativa: 'Cliente desistiu da compra no balcão' });
  verifica('recepção cancela só com liberação (403 sem senha) ou cancela', [200, 403].includes(cancRec.status), cancRec.json);
  if (cancRec.status === 403) status('admin cancela a NFC-e', await adm.post(`/notas-fiscais/${nfceNota?.id}/cancelar`, { justificativa: 'Cliente desistiu da compra no balcão' }), 200);
  const [nc] = await sql(`SELECT status FROM notas_fiscais WHERE id = $1`, [nfceNota?.id]);
  verifica('NFC-e fica cancelada', nc?.status === 'cancelado', nc);

  // hotel pela Spedy: nota "processando" e depois autorizada
  const q104 = d.quartos[3];
  const h = await rec.post('/estadias', { unidadeId: q104.id, noites: 1 });
  exige('check-in no 104', [200, 201].includes(h.status), h.json);
  await rec.post(`/estadias/${h.json.id}/itens`, { produtoId: agua.id, quantidade: 1 });
  status('fecha o 104 no débito', await rec.post(`/estadias/${h.json.id}/fechar`, { pagamentos: [{ forma: 'debito', valor: 206 }], nota: { emitir: true, documento: '52998224725', nome: 'Hóspede Hotel' } }), 200);
  const em2 = await rec.post(`/notas-fiscais/conta/${h.json.id}`, {});
  status('emite as notas do hotel (Spedy)', em2, 200);
  const notas2 = em2.json?.notas ?? [];
  verifica('Spedy: as notas ficam "processando" na hora', notas2.length === 2 && notas2.every((n) => n.status === 'processando'), notas2.map((n) => [n.tipo, n.status]));
  const ps = await pedidosRecebidos(ctx.spedy);
  const consumer = ps.find((p) => p.metodo === 'POST' && p.caminho === '/v1/consumer-invoices');
  const service = ps.find((p) => p.metodo === 'POST' && p.caminho === '/v1/service-invoices');
  verifica('Spedy recebeu a NFC-e e a NFS-e', consumer && service, ps.map((p) => `${p.metodo} ${p.caminho}`));
  verifica('NFS-e da Spedy com a série da DPS (900) e o CPF do hóspede', service?.corpo?.rpsSeries === '900' && service?.corpo?.receiver?.federalTaxNumber === '52998224725', service?.corpo);
  for (const n of notas2) {
    const at = await rec.post(`/notas-fiscais/${n.id}/atualizar`);
    status(`atualiza a ${n.tipo} na Spedy`, at, 200);
    verifica(`${n.tipo} autorizada depois de atualizar`, at.json?.status === 'autorizado', at.json);
  }
  const vista = await adm.get(`/notas-fiscais/${notas2[0]?.id}`);
  const link = vista.json?.danfe ?? vista.json?.pdf ?? vista.json?.urlPdf ?? vista.json?.url_danfe ?? JSON.stringify(vista.json).match(/\/publico\/notas-arquivo[^"]*/)?.[0];
  verifica('nota da Spedy traz o link do PDF pelo próprio sistema', typeof link === 'string' && link.includes('/publico/notas-arquivo'), vista.json);
  if (typeof link === 'string' && link.includes('/publico/notas-arquivo')) {
    const caminho = link.slice(link.indexOf('/publico/notas-arquivo'));
    const pdf = await api('GET', caminho);
    verifica('o PDF abre sem login, pelo link assinado', pdf.status === 200 && pdf.texto.startsWith('%PDF'), pdf.status);
    const adulterado = await api('GET', caminho.replace(/s=[^&]+/, 's=assinatura-falsa'));
    verifica('link com a assinatura alterada não abre (404)', adulterado.status === 404, adulterado.status);
  }

  // recusa: o motivo aparece para a pessoa
  const s7 = d.suites[6];
  const c3 = await rec.post('/estadias', { unidadeId: s7.id });
  await rec.post(`/estadias/${c3.json.id}/itens`, { produtoId: cerveja.id, quantidade: 1 });
  const det3 = await rec.get(`/estadias/${c3.json.id}`);
  status('fecha a 07 em dinheiro', await rec.post(`/estadias/${c3.json.id}/fechar`, { pagamentos: [{ forma: 'dinheiro', valor: det3.json.conta.total }] }), 200);
  await fetch(`${ctx.focus.url}/__recusar`);
  const em3 = await rec.post(`/notas-fiscais/conta/${c3.json.id}`, { quais: 'nfce' });
  const n3 = em3.json?.notas?.[0];
  verifica('nota recusada volta com status de erro e o motivo', n3?.status === 'erro' && /Rejei/i.test(JSON.stringify(n3)), em3.json);
  const em3b = await rec.post(`/notas-fiscais/conta/${c3.json.id}`, { quais: 'nfce' });
  verifica('depois da recusa, dá para emitir de novo', em3b.status === 200 && em3b.json?.notas?.[0]?.status === 'autorizado', em3b.json);

  // NF-e avulsa com destinatário e carta de correção
  const nfe = await adm.post('/notas-fiscais/nfe', {
    destinatario: { nome: 'Empresa Compradora', documento: '11444777000161', logradouro: 'Rua A', numero: '10', bairro: 'Centro', municipio: 'Barra do Piraí', uf: 'RJ', cep: '27100000' },
    itens: [{ produtoId: agua.id, quantidade: 10, valorUnitario: 5 }], formaPagamento: 'pix',
  });
  status('emite NF-e avulsa', nfe, [200, 201]);
  const nfeId = nfe.json?.id ?? nfe.json?.nota?.id;
  if (nfeId) {
    const cce = await adm.post(`/notas-fiscais/${nfeId}/carta-correcao`, { correcao: 'Corrige o endereço do destinatário para Rua B, número 20.' });
    status('carta de correção da NF-e', cce, [200, 201]);
  }
  const nfeDocRuim = await adm.post('/notas-fiscais/nfe', {
    destinatario: { nome: 'X', documento: '123', logradouro: 'Rua A', numero: '1', bairro: 'Centro', municipio: 'Barra', uf: 'RJ', cep: '27100000' },
    itens: [{ produtoId: agua.id, quantidade: 1, valorUnitario: 5 }],
  });
  verifica('NF-e com CPF/CNPJ inválido é recusada', nfeDocRuim.status === 400, nfeDocRuim.json);
}
