// Hotel (diárias e noites), reservas (conflito de datas, check-in com sinal), conta faturada
// (contas a receber e baixa) e mesa de restaurante (modalidade "mesa").
import { verifica, status, exige, entrar, sql, hojeSP } from '../lib.mjs';

const mais = (dias) => {
  const d = new Date(`${hojeSP()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};

export default async function (ctx) {
  const d = ctx.dados;
  const adm = ctx.admin;
  const [q101, q102, q103] = d.quartos;

  // caixa do hotel e do restaurante abertos
  for (const amb of [d.hotelId, d.restauranteId]) {
    const a = await adm.get(`/caixa/atual?ambienteId=${amb}`);
    if (!a.json?.turno) status('abre o caixa do ambiente', await adm.post('/caixa/turnos', { ambienteId: amb, trocoInicial: 0 }), [200, 201]);
  }
  const rec = await entrar(d.logins.recepcao, d.logins.senha);

  // check-in sem reserva, 2 noites (diária 200)
  const h1 = await rec.post('/estadias', { unidadeId: q101.id, noites: 2, pessoas: 2 });
  exige('check-in no quarto 101 por 2 noites', [200, 201].includes(h1.status), h1.json);
  verifica('saída prevista = hoje + 2', h1.json.saidaPrevista === mais(2), h1.json.saidaPrevista);
  verifica('total combinado = 2 × 200 = 400', h1.json.conta.total === 400, h1.json.conta);
  const noites = await rec.get(`/estadias/${h1.json.id}/noites`);
  status('lista as noites da hospedagem', noites, 200);
  const trioPessoa = await rec.post('/estadias', { unidadeId: q102.id, noites: 1, pessoas: 3 });
  exige('check-in com 3 pessoas no 102', [200, 201].includes(trioPessoa.status), trioPessoa.json);
  verifica('3ª pessoa cobra R$ 50 a mais (250)', trioPessoa.json.conta.total === 250, trioPessoa.json.conta);

  // CPF inválido na nota avisa antes de gravar
  const cpfRuim = await rec.post(`/estadias/${trioPessoa.json.id}/fechar`, { pagamentos: [{ forma: 'pix', valor: 250 }], nota: { emitir: true, documento: '12345678900' } });
  verifica('CPF inválido para a nota é recusado (400)', cpfRuim.status === 400 && /CPF/i.test(cpfRuim.json?.message ?? ''), cpfRuim.json);
  status('fecha o 102 com nota no CPF', await rec.post(`/estadias/${trioPessoa.json.id}/fechar`, { pagamentos: [{ forma: 'pix', valor: 250 }], nota: { emitir: true, documento: '529.982.247-25', nome: 'Hóspede Teste' } }), 200);

  // cliente faturado (empresa que paga depois)
  const cli = await adm.post('/faturamento/clientes', { nome: 'Empresa Parceira Ltda', documento: '11.444.777/0001-61', prazoDias: 30 });
  exige('cadastra cliente faturado', [200, 201].includes(cli.status), cli.json);
  d.clienteFaturadoId = cli.json.id;
  // faturado sem escolher a empresa: vira título "a definir" e o financeiro escolhe depois
  const fat = await rec.post(`/estadias/${h1.json.id}/fechar`, { pagamentos: [{ forma: 'faturado', valor: 400 }] });
  status('fecha o 101 faturado (empresa a definir)', fat, 200);
  const receber = await adm.get('/faturamento/receber');
  status('contas a receber abre', receber, 200);
  const lista = Array.isArray(receber.json) ? receber.json : receber.json?.itens ?? receber.json?.lista ?? [];
  const titulo = lista.find((r) => r.estadiaId === h1.json.id || r.estadia_id === h1.json.id);
  verifica('conta faturada virou conta a receber de R$ 400', titulo && Number(titulo.valor) === 400, lista.slice(0, 3));
  if (titulo) {
    status('financeiro define a empresa do título', await adm.post(`/faturamento/receber/${titulo.id}/cliente`, { clienteId: cli.json.id }), 200);
    status('dá baixa no recebimento (pix)', await adm.post(`/faturamento/receber/${titulo.id}/baixar`, { forma: 'pix' }), 200);
    const [r] = await sql(`SELECT status FROM contas_receber WHERE id = $1`, [titulo.id]);
    verifica('título fica pago', r?.status === 'paga' || r?.status === 'pago' || r?.status === 'recebida', r);
    const deNovo = await adm.post(`/faturamento/receber/${titulo.id}/baixar`, { forma: 'pix' });
    verifica('não dá baixa duas vezes', deNovo.status === 400, deNovo.json);
  }
  const extrato = await adm.get(`/faturamento/clientes/${cli.json.id}/extrato`);
  status('extrato do cliente faturado', extrato, 200);
  const resumoFat = await adm.get('/faturamento/resumo');
  status('resumo do faturamento', resumoFat, 200);

  // reservas
  const res1 = await rec.post('/reservas', { unidadeId: q103.id, hospede: 'Maria Teste', chegada: mais(5), saida: mais(7), sinal: 100, sinalForma: 'pix', status: 'confirmada' });
  verifica('recepção (estadias.operar) cria reserva', [200, 201].includes(res1.status), res1.json);
  const conflito = await rec.post('/reservas', { unidadeId: q103.id, hospede: 'João Conflito', chegada: mais(6), saida: mais(8) });
  verifica('reserva em cima de outra no mesmo quarto é recusada', conflito.status === 400 || conflito.status === 409, conflito.json);
  const invertida = await rec.post('/reservas', { unidadeId: q103.id, hospede: 'Datas Trocadas', chegada: mais(10), saida: mais(9) });
  verifica('saída antes da chegada é recusada', invertida.status === 400, invertida.json);
  const encostada = await rec.post('/reservas', { unidadeId: q103.id, hospede: 'Chega no dia da saída', chegada: mais(7), saida: mais(8) });
  verifica('reserva que chega no dia da saída da outra é aceita', [200, 201].includes(encostada.status), encostada.json);
  const listaRes = await rec.get(`/reservas?de=${hojeSP()}&ate=${mais(30)}`);
  status('lista reservas', listaRes, 200);
  const hoje = await rec.post('/reservas', { unidadeId: q103.id, hospede: 'Chega Hoje', chegada: hojeSP(), saida: mais(1), sinal: 50, sinalForma: 'dinheiro', status: 'confirmada' });
  exige('reserva para hoje', [200, 201].includes(hoje.status), hoje.json);
  const ck = await rec.post(`/reservas/${hoje.json.id}/checkin`, { lancarSinal: 'sim' });
  status('check-in da reserva de hoje, lançando o sinal', ck, 200);
  const est = ck.json?.estadia ?? ck.json;
  const estId = est?.id ?? ck.json?.estadiaId;
  if (estId) {
    const det = await rec.get(`/estadias/${estId}`);
    verifica('sinal de R$ 50 entra como adiantamento', det.json.adiantado === 50, { adiantado: det.json.adiantado, pagamentos: det.json.pagamentos });
    const ck2 = await rec.post(`/reservas/${hoje.json.id}/checkin`, {});
    verifica('não faz o check-in da mesma reserva duas vezes', ck2.status === 400, ck2.json);
  } else verifica('check-in devolve a conta aberta', false, ck.json);
  status('cancela a reserva da Maria', await rec.post(`/reservas/${res1.json?.id}/cancelar`, { motivo: 'Desistiu' }), 200);

  // mesa de restaurante
  const garcom = rec;
  const m1 = await garcom.post('/estadias', { unidadeId: d.mesaId, pessoas: 4 });
  exige('abre a MESA 01', [200, 201].includes(m1.status), m1.json);
  verifica('mesa abre com modalidade "mesa" e conta zerada', m1.json.modalidade === 'mesa' && m1.json.conta.total === 0, { modalidade: m1.json.modalidade, conta: m1.json.conta });
  const [, cerveja, porcao] = d.produtos;
  await garcom.post(`/estadias/${m1.json.id}/itens`, { produtoId: porcao.id, quantidade: 1 });
  await garcom.post(`/estadias/${m1.json.id}/itens`, { produtoId: cerveja.id, quantidade: 3 });
  const dm = await garcom.get(`/estadias/${m1.json.id}`);
  verifica('mesa cobra só o consumo (38 + 3×14 = 80), sem hora', dm.json.conta.total === 80, dm.json.conta);
  const fm = await garcom.post(`/estadias/${m1.json.id}/fechar`, {
    pagamentos: [{ forma: 'credito', valor: 40, gorjetaAdicional: 8 }, { forma: 'dinheiro', valor: 40, valorRecebido: 50, trocoDestino: 'gorjeta', gorjetaPara: 'Garçom' }],
  });
  status('fecha a mesa dividida (crédito com gorjeta + dinheiro com troco para gorjeta)', fm, 200);
  const gorj = await sql(`SELECT valor, forma, origem FROM gorjetas WHERE estadia_id = $1 ORDER BY valor`, [m1.json.id]).catch((e) => [{ erro: e.message }]);
  verifica('gorjetas registradas: 8 no crédito e 10 do troco', gorj.length === 2 && Number(gorj[0].valor) === 8 && Number(gorj[1].valor) === 10, gorj);
}
