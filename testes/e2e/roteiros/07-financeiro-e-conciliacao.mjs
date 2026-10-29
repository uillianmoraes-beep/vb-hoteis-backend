// Financeiro: contas a pagar (lançar, aprovar, pagar), caixa ADM, DRE, fluxo, recebíveis
// e conciliação com os arquivos de teste que a própria rota gera (CSV da maquininha e OFX do banco).
import { verifica, status, exige, entrar, sql, hojeSP } from '../lib.mjs';

export default async function (ctx) {
  const d = ctx.dados;
  const adm = ctx.admin;
  const ger = ctx.gerente ?? await entrar(d.logins.gerente, d.logins.senha);

  // contas a pagar
  const cp = await ger.post('/contas-pagar', { descricao: 'Conta de luz', fornecedor: 'Light', categoria: 'Energia', valor: 850.4, vencimento: hojeSP() });
  exige('lança conta a pagar', [200, 201].includes(cp.status), cp.json);
  
  const parc = await ger.post('/contas-pagar', { descricao: 'Compra de enxoval', valor: 900, vencimento: hojeSP(), boletos: 3, prazos: [30, 60, 90], dataCompra: hojeSP() });
  status('lança compra em 3 boletos', parc, [200, 201]);
  const zero = await ger.post('/contas-pagar', { descricao: 'Valor zerado', valor: 0, vencimento: hojeSP() });
  verifica('conta a pagar de R$ 0 é recusada', zero.status === 400, zero.json);
  const lista = await ger.get('/contas-pagar');
  status('lista contas a pagar', lista, 200);
  const todas = lista.json?.lista ?? [];
  const cpId = todas.find((x) => x.descricao === 'Conta de luz')?.id;
  const boletos = todas.filter((c) => /enxoval/i.test(c.descricao));
  verifica('3 boletos de R$ 300', boletos.length >= 3 && boletos.every((b) => Number(b.valor) === 300), boletos.map((b) => b.valor));
  const pago = await ger.post(`/contas-pagar/${cpId}/pagar`, { forma: 'pix', lancarCaixa: 'sim' });
  status('dá baixa na conta de luz pelo pix', pago, [200, 201]);
  const [c] = await sql(`SELECT status FROM contas_pagar WHERE id = $1`, [cpId]).catch(() => [{}]);
  verifica('conta de luz fica paga', /pag/.test(c?.status ?? ''), c);
  const pagaDeNovo = await ger.post(`/contas-pagar/${cpId}/pagar`, { forma: 'pix' });
  verifica('não paga a mesma conta duas vezes', pagaDeNovo.status === 400, pagaDeNovo.json);

  // caixa ADM e relatórios
  const lanc = await adm.post('/caixa/adm', { tipo: 'saida', forma: 'transferencia', valor: 120, descricao: 'Manutenção do portão', categoria: 'Manutenção' });
  status('lança saída no caixa ADM', lanc, [200, 201]);
  const cadm = await adm.get('/caixa/adm');
  status('caixa ADM abre', cadm, 200);
  for (const r of ['/financeiro/dre', '/financeiro/fluxo', '/financeiro/recebiveis', '/relatorios/vendas', '/relatorios/dashboard', '/caixa/turnos']) {
    status(`relatório ${r} abre`, await ger.get(r), 200);
  }
  const dre = await ger.get(`/financeiro/dre?de=${hojeSP()}&ate=${hojeSP()}`);
  const receita = dre.json?.linhas?.find((l) => l.chave === 'receita')?.valores ?? [];
  verifica('DRE do mês tem receita maior que zero', receita[receita.length - 1] > 0, receita);
  const datasRuins = await ger.get('/financeiro/dre?de=2026-13-45&ate=xx');
  verifica('datas inválidas no DRE não dão erro 500', datasRuins.status < 500, datasRuins.status);

  // conciliação com os arquivos de teste
  status('cria conta e maquininha de teste', await adm.post('/contas-bancarias/teste'), [200, 201]);
  const contas = await adm.get('/contas-bancarias');
  const contaBanco = (contas.json?.contas ?? contas.json ?? []).find?.((x) => /Banco Teste/.test(x.nome));
  const maq = (contas.json?.maquininhas ?? []).find((x) => /Stone/.test(x.nome));
  exige('acha a conta e a maquininha de teste', contaBanco && maq, contas.json);
  const teste = await adm.get(`/conciliacao/teste?de=${hojeSP()}&ate=${hojeSP()}&maquininhaId=${maq.id}`);
  exige('a rota gera os arquivos de teste (CSV e OFX)', teste.status === 200 && teste.json.arquivos?.length === 2, teste.json);
  const [csv, ofx] = teste.json.arquivos;
  const b64 = (t) => Buffer.from(t, 'utf8').toString('base64');
  const impMaq = await adm.post('/conciliacao/importar', { origem: 'maquininha', maquininhaId: maq.id, nome: csv.nome, arquivo: b64(csv.conteudo) });
  status('importa o CSV da maquininha', impMaq, 200);
  const impBanco = await adm.post('/conciliacao/importar', { origem: 'banco', contaBancariaId: contaBanco.id, nome: ofx.nome, arquivo: b64(ofx.conteudo) });
  status('importa o OFX do banco', impBanco, 200);
  const dupla = await adm.post('/conciliacao/importar', { origem: 'banco', contaBancariaId: contaBanco.id, nome: ofx.nome, arquivo: b64(ofx.conteudo) });
  verifica('importar o mesmo extrato de novo não duplica as linhas (aviso ou 0 novas)', dupla.status === 400 || dupla.json?.novas === 0 || dupla.json?.inseridas === 0 || /já/i.test(JSON.stringify(dupla.json)), dupla.json);
  status('confere o período', await adm.post('/conciliacao/conferir', { de: hojeSP(), ate: hojeSP() }), 200);
  const ver = await adm.get(`/conciliacao?de=${hojeSP()}&ate=${hojeSP()}`);
  status('tela da conciliação', ver, 200);
  const linhas = ver.json?.linhas ?? ver.json?.lista ?? [];
  verifica('conciliação tem linhas do banco e da maquininha', linhas.some((l) => l.origem === 'banco') && linhas.some((l) => l.origem === 'maquininha'), linhas.length);
  verifica('o Pix de R$ 120 sem conta no sistema aparece sem par', linhas.some((l) => Number(l.valorBruto) === 120 && !l.pagamentoId && l.status !== 'conciliada' && l.status !== 'verde'), linhas.filter((l) => Number(l.valorBruto) === 120));
  const algumVerde = linhas.some((l) => ['verde', 'conciliada', 'confirmada'].includes(l.status) || l.situacao === 'verde');
  verifica('pelo menos uma linha conferida sozinha (verde)', algumVerde, linhas.map((l) => [l.origem, l.forma, l.valorBruto, l.status, l.situacao]).slice(0, 12));
  const rec = await entrar(d.logins.recepcao, d.logins.senha);
  verifica('recepção não importa extrato (403)', (await rec.post('/conciliacao/importar', { origem: 'banco', nome: 'x.ofx', arquivo: 'eA==' })).status === 403);
}
