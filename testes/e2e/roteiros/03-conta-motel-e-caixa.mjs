// Motel: entrada, consumo, estorno com liberação, entrega da conta, fechamento com várias formas,
// pernoite, cancelamento e o caixa (turno, sangria, reforço, despesa e fechamento com o esperado).
import { verifica, status, exige, entrar, sql } from '../lib.mjs';

const soma = (l) => Math.round(l.reduce((s, x) => s + x, 0) * 100) / 100;

export default async function (ctx) {
  const d = ctx.dados;
  const adm = ctx.admin;
  const rec = ctx.recepcao ?? await entrar(d.logins.recepcao, d.logins.senha, d.motelId);
  const [s1, s2, s3, s4] = d.suites;

  // fecha qualquer turno aberto de rodadas anteriores (rodando só este roteiro de novo)
  const aberto = await adm.get(`/caixa/atual?ambienteId=${d.motelId}`);
  if (aberto.json?.turno?.id) await adm.post(`/caixa/turnos/${aberto.json.turno.id}/fechar`, { contado: aberto.json.resumo?.esperado ?? {} });

  // entrada
  const e1 = await rec.post('/estadias', { unidadeId: s1.id, placa: 'abc-1d23', pessoas: 2 });
  exige('recepção dá entrada na suíte 01', e1.status === 201 || e1.status === 200, e1.json);
  verifica('placa fica em maiúsculas e sem traço', e1.json.placa === 'ABC1D23', e1.json.placa);
  verifica('conta nasce aberta, com número de uso', e1.json.status === 'aberta' && Number(e1.json.numero) > 0, e1.json);
  const dup = await rec.post('/estadias', { unidadeId: s1.id });
  verifica('não deixa dar entrada de novo na suíte ocupada (400)', dup.status === 400, dup.json);
  const painel = await rec.get(`/painel?ambienteId=${d.motelId}`);
  verifica('painel mostra a suíte 01 ocupada', painel.json.unidades.find((u) => u.id === s1.id)?.status === 'ocupada');

  // consumo
  const [agua, cerveja] = d.produtos;
  status('lança 2 águas', await rec.post(`/estadias/${e1.json.id}/itens`, { produtoId: agua.id, quantidade: 2 }), [200, 201]);
  status('lança 1 cerveja', await rec.post(`/estadias/${e1.json.id}/itens`, { produtoId: cerveja.id, quantidade: 1 }), [200, 201]);
  const avulso = await rec.post(`/estadias/${e1.json.id}/itens`, { descricao: 'Toalha extra', quantidade: 1 });
  verifica('item avulso sem preço é recusado (400)', avulso.status === 400, avulso.json);
  status('lança item avulso com preço', await rec.post(`/estadias/${e1.json.id}/itens`, { descricao: 'Toalha extra', quantidade: 1, precoUnitario: 10 }), [200, 201]);
  const qtdRuim = await rec.post(`/estadias/${e1.json.id}/itens`, { produtoId: agua.id, quantidade: -1 });
  verifica('quantidade negativa é recusada (400)', qtdRuim.status === 400, qtdRuim.json);

  let det = await rec.get(`/estadias/${e1.json.id}`);
  verifica('consumo = 2×6 + 14 + 10 = 36', det.json.conta.consumo === 36, det.json.conta);
  verifica('total = 4 horas (70) + consumo (36) = 106', det.json.conta.total === 106, det.json.conta);

  // estorno: recepção não tem estadias.estornar → pede liberação de outra pessoa
  const toalha = det.json.itens.find((i) => i.descricao === 'Toalha extra');
  const semLib = await rec.post(`/estadias/${e1.json.id}/itens/${toalha.id}/estornar`, { motivo: 'Lançado errado' });
  verifica('recepção sem liberação não estorna (403)', semLib.status === 403, semLib.json);
  const libErrada = await rec.post(`/estadias/${e1.json.id}/itens/${toalha.id}/estornar`, { motivo: 'Lançado errado', autorizacao: { login: d.logins.gerente, senha: 'errada' } });
  verifica('liberação com senha errada não estorna', libErrada.status >= 400 && libErrada.status < 500, libErrada.json);
  const comLib = await rec.post(`/estadias/${e1.json.id}/itens/${toalha.id}/estornar`, { motivo: 'Lançado errado', autorizacao: { login: d.logins.gerente, senha: d.logins.senha } });
  status('com a senha do gerente, estorna', comLib, 200);
  const deNovo = await rec.post(`/estadias/${e1.json.id}/itens/${toalha.id}/estornar`, { motivo: 'De novo', autorizacao: { login: d.logins.gerente, senha: d.logins.senha } });
  verifica('não estorna o mesmo item duas vezes (400)', deNovo.status === 400, deNovo.json);
  det = await rec.get(`/estadias/${e1.json.id}`);
  verifica('depois do estorno, total = 96', det.json.conta.total === 96, det.json.conta);

  // entregar conta
  status('entrega a conta', await rec.post(`/estadias/${e1.json.id}/entregar-conta`), 200);
  const p2 = await rec.get(`/painel?ambienteId=${d.motelId}`);
  verifica('suíte 01 fica "conta entregue"', p2.json.unidades.find((u) => u.id === s1.id)?.status === 'conta_entregue');
  const lancaDepois = await rec.post(`/estadias/${e1.json.id}/itens`, { produtoId: agua.id, quantidade: 1 });
  verifica('com a conta entregue ainda lança consumo? (aceito ou recusado, sem erro 500)', lancaDepois.status < 500, lancaDepois.json);
  det = await rec.get(`/estadias/${e1.json.id}`);
  const total = det.json.conta.total;

  // caixa fechado: não recebe
  const semCaixa = await rec.post(`/estadias/${e1.json.id}/fechar`, { pagamentos: [{ forma: 'pix', valor: total }] });
  verifica('com o caixa fechado, não recebe (400 avisando)', semCaixa.status === 400 && /caixa/i.test(semCaixa.json?.message ?? ''), semCaixa.json);

  // abre o caixa
  const turno = await adm.post('/caixa/turnos', { ambienteId: d.motelId, trocoInicial: 100 });
  exige('abre o caixa do motel com R$ 100 de troco', [200, 201].includes(turno.status), turno.json);
  const turnoId = turno.json.turno?.id ?? turno.json.id;
  const dois = await adm.post('/caixa/turnos', { ambienteId: d.motelId, trocoInicial: 0 });
  verifica('não abre dois caixas no mesmo ambiente', dois.status >= 400 && dois.status < 500, dois.json);

  // fechamento com várias formas
  const errado = await rec.post(`/estadias/${e1.json.id}/fechar`, { pagamentos: [{ forma: 'pix', valor: total - 1 }] });
  verifica('pagamentos que não somam o total são recusados (400)', errado.status === 400, errado.json);
  const recebidoMenor = await rec.post(`/estadias/${e1.json.id}/fechar`, { pagamentos: [{ forma: 'dinheiro', valor: total, valorRecebido: total - 5 }] });
  verifica('dinheiro recebido menor que o valor é recusado', recebidoMenor.status === 400, recebidoMenor.json);
  const dinheiro = 50;
  const pix = 20;
  const credito = Math.round((total - dinheiro - pix) * 100) / 100;
  const fech = await rec.post(`/estadias/${e1.json.id}/fechar`, {
    pagamentos: [
      { forma: 'dinheiro', valor: dinheiro, valorRecebido: 60 },
      { forma: 'pix', valor: pix, comprovante: 'E123' },
      { forma: 'credito', valor: credito, parcelas: 2 },
    ],
  });
  status(`fecha a conta de R$ ${total} em dinheiro (troco 10), pix e crédito`, fech, 200);
  const fechada = await adm.get(`/estadias/${e1.json.id}`);
  verifica('conta fica fechada com forma "misto"', fechada.json.status === 'fechada' && fechada.json.formaPagamento === 'misto', { status: fechada.json.status, forma: fechada.json.formaPagamento });
  const din = fechada.json.pagamentos.find((p) => p.forma === 'dinheiro');
  verifica('troco de R$ 10 registrado', din?.troco === 10, din);
  verifica('suíte 01 vai para limpeza depois de paga', (await adm.get(`/unidades/${s1.id}`)).json.status !== 'ocupada');
  const fecharDeNovo = await rec.post(`/estadias/${e1.json.id}/fechar`, { pagamentos: [{ forma: 'pix', valor: total }] });
  verifica('não fecha a mesma conta duas vezes (400)', fecharDeNovo.status === 400, fecharDeNovo.json);

  // desconto acima do limite da recepção (10%)
  const e2 = await rec.post('/estadias', { unidadeId: s2.id });
  exige('entrada na suíte 02', [200, 201].includes(e2.status), e2.json);
  const t2 = e2.json.conta.total;
  const desc = await rec.post(`/estadias/${e2.json.id}/fechar`, { desconto: t2 * 0.5, motivo: 'Cliente antigo', pagamentos: [{ forma: 'dinheiro', valor: t2 * 0.5 }] });
  verifica('desconto de 50% passa do limite da recepção (403)', desc.status === 403, desc.json);
  const descSemMotivo = await rec.post(`/estadias/${e2.json.id}/fechar`, { desconto: 5, pagamentos: [{ forma: 'dinheiro', valor: t2 - 5 }] });
  verifica('desconto sem motivo é recusado (400)', descSemMotivo.status === 400, descSemMotivo.json);
  const descLib = await rec.post(`/estadias/${e2.json.id}/fechar`, {
    desconto: t2 * 0.5, motivo: 'Cliente antigo', pagamentos: [{ forma: 'debito', valor: t2 * 0.5 }],
    autorizacao: { login: d.logins.gerente, senha: d.logins.senha },
  });
  status('com a senha do gerente, fecha com 50% de desconto', descLib, 200);

  // adiantamento na entrada (portaria) e pagamento do resto
  const e3 = await rec.post('/estadias', { unidadeId: s3.id, adiantamento: [{ forma: 'pix', valor: 30 }] });
  exige('entrada com R$ 30 pagos na portaria', [200, 201].includes(e3.status), e3.json);
  verifica('adiantado = 30', e3.json.adiantado === 30, e3.json.adiantado);
  const falta = e3.json.conta.total - 30;
  status('fecha pagando só o que falta', await rec.post(`/estadias/${e3.json.id}/fechar`, { pagamentos: [{ forma: 'dinheiro', valor: falta }] }), 200);

  // pernoite (pode estar fora do horário: então tem de recusar com aviso, não com erro)
  const e4 = await rec.post('/estadias', { unidadeId: s4.id, modalidade: 'pernoite' });
  if (e4.status === 400) {
    verifica('pernoite fora do horário é recusado com aviso', /pernoite/i.test(e4.json?.message ?? ''), e4.json);
    const e4b = await rec.post('/estadias', { unidadeId: s4.id });
    exige('entrada normal na suíte 04', [200, 201].includes(e4b.status), e4b.json);
    const troca = await rec.post(`/estadias/${e4b.json.id}/cobranca`, { modalidade: 'pernoite' });
    verifica('trocar para pernoite fora do horário não dá erro 500', troca.status < 500, troca.json);
    d.contaS4 = e4b.json.id;
  } else {
    verifica('entrada em pernoite', [200, 201].includes(e4.status) && e4.json.modalidade === 'pernoite', e4.json);
    verifica('pernoite cobra R$ 160', e4.json.conta.total === 160, e4.json.conta);
    d.contaS4 = e4.json.id;
  }

  // transferência e cancelamento
  const s5 = d.suites[4];
  status('transfere a conta da 04 para a 05', await rec.post(`/estadias/${d.contaS4}/transferir`, { unidadeId: s5.id, manterPreco: true, motivo: 'Ar-condicionado quebrado' }), 200);
  verifica('suíte 05 ocupada depois da transferência', (await adm.get(`/unidades/${s5.id}`)).json.status === 'ocupada');
  const canc = await rec.post(`/estadias/${d.contaS4}/cancelar`, { motivo: 'Cliente desistiu' });
  verifica('recepção sem permissão não cancela (403)', canc.status === 403, canc.json);
  status('gerente cancela a entrada', await ctx.gerente.post(`/estadias/${d.contaS4}/cancelar`, { motivo: 'Cliente desistiu', destino: 'livre' }), 200);
  verifica('suíte 05 volta a ficar livre', (await adm.get(`/unidades/${s5.id}`)).json.status === 'livre');

  // caixa: movimentos e fechamento
  status('reforço de R$ 50', await adm.post(`/caixa/turnos/${turnoId}/movimentos`, { tipo: 'reforco', valor: 50, descricao: 'Troco' }), 200);
  status('sangria de R$ 40', await adm.post(`/caixa/turnos/${turnoId}/movimentos`, { tipo: 'sangria', valor: 40, descricao: 'Cofre' }), 200);
  status('despesa de R$ 15', await adm.post(`/caixa/turnos/${turnoId}/movimentos`, { tipo: 'despesa', valor: 15, descricao: 'Gelo', categoria: 'Compras' }), 200);
  const atual = await adm.get(`/caixa/turnos/${turnoId}`);
  exige('detalhe do turno', atual.status === 200, atual.json);
  const res = atual.json.resumo ?? atual.json;
  const esperadoDinheiro = soma([100, dinheiro, falta, 50, -40, -15]);
  verifica(`dinheiro esperado na gaveta = ${esperadoDinheiro} (troco + recebidos + reforço − sangria − despesa)`, res.esperado?.dinheiro === esperadoDinheiro, res.esperado);
  verifica('pix esperado = 20 + 30 (portaria)', res.esperado?.pix === 50, res.esperado);
  verifica(`crédito esperado = ${credito}`, res.esperado?.credito === credito, res.esperado);
  verifica(`débito esperado = ${t2 * 0.5}`, res.esperado?.debito === t2 * 0.5, res.esperado);

  const fundoDemais = await adm.post(`/caixa/turnos/${turnoId}/fechar`, { contado: { ...res.esperado }, fundoProximo: res.esperado.dinheiro + 1 });
  verifica('fundo maior que o dinheiro contado é recusado', fundoDemais.status === 400, fundoDemais.json);
  const contado = { ...res.esperado, dinheiro: res.esperado.dinheiro - 2 };
  const fechaCaixa = await adm.post(`/caixa/turnos/${turnoId}/fechar`, { contado, fundoProximo: 100, observacao: 'Faltaram 2 reais' });
  status('fecha o caixa', fechaCaixa, 200);
  const [t] = await sql(`SELECT status, diferenca, retirado FROM caixa_turnos WHERE id = $1`, [turnoId]);
  verifica('turno fechado com diferença de −2,00', t?.status === 'fechado' && Number(t.diferenca) === -2, t);
  verifica('retirado = contado − fundo de 100', Number(t?.retirado) === Math.round((contado.dinheiro - 100) * 100) / 100, t);
  const adm2 = await sql(`SELECT forma, valor FROM caixa_movimentos WHERE turno_id = $1 AND caixa = 'adm'`, [turnoId]);
  verifica('fechamento manda dinheiro retirado, pix, débito e crédito para o caixa ADM', adm2.length === 4, adm2);
  const fecharDuas = await adm.post(`/caixa/turnos/${turnoId}/fechar`, { contado });
  verifica('não fecha o mesmo caixa duas vezes', fecharDuas.status === 400, fecharDuas.json);

  // reabre para os próximos roteiros (fica aberto)
  const reabre = await adm.post('/caixa/turnos', { ambienteId: d.motelId, trocoInicial: 100 });
  status('abre um novo turno com o fundo de R$ 100', reabre, [200, 201]);
  d.turnoMotel = reabre.json.turno?.id ?? reabre.json.id;
}
