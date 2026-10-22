import { createHash } from 'crypto';

/**
 * Arquivos de teste da conciliação: monta um relatório de maquininha (CSV) e um extrato do banco (OFX)
 * a partir dos Pix e cartões lançados no sistema, com alguns erros de propósito, para ver cada cor
 * aparecer sem depender de movimento de verdade (e para mostrar a conciliação a um cliente).
 */

export interface PagTeste { forma: string; valor: number; momento: Date; comprovante: string | null; unidade: string | null }
export interface MaqTeste {
  nome: string; taxaDebito: number | null; taxaCredito: number | null; taxaPix: number | null; prazoDebito: number; prazoCredito: number;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const sp = (d: Date) => new Date(d.getTime() - 3 * 3600_000);
const dataBr = (d: Date) => sp(d).toISOString().slice(0, 10).split('-').reverse().join('/');
const horaBr = (d: Date) => sp(d).toISOString().slice(11, 16);
const ofxData = (d: Date) => sp(d).toISOString().slice(0, 19).replace(/[-:T]/g, '');
const maisDias = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const dinheiro = (v: number) => v.toFixed(2).replace('.', ',');

/** troca dois números do meio do código (erro de digitação) */
function trocarDigitos(c: string) {
  const i = Math.max(1, Math.floor(c.length / 2) - 1);
  const a = c.split('');
  if (a[i] === a[i + 1]) a[i + 1] = String((Number(a[i + 1]) + 1) % 10);
  else [a[i], a[i + 1]] = [a[i + 1], a[i]];
  return a.join('');
}

/** número fixo para a mesma venda (baixar o teste de novo não cria NSU diferente) */
const fixo = (semente: string, base = 500000, faixa = 400000) => String(base + (parseInt(createHash('sha1').update(semente).digest('hex').slice(0, 8), 16) % faixa));

export function gerarArquivosTeste(pags: PagTeste[], maq: MaqTeste, hoje: Date) {
  const novoCodigo = (semente: string) => fixo(semente);
  const cartoes = pags.filter((p) => p.forma === 'debito' || p.forma === 'credito');
  const pixes = pags.filter((p) => p.forma === 'pix');
  const roteiro: string[] = [];
  const quem = (p: PagTeste) => `${p.forma === 'pix' ? 'Pix' : p.forma === 'debito' ? 'Débito' : 'Crédito'} de R$ ${dinheiro(p.valor)} (${dataBr(p.momento)} ${horaBr(p.momento)}${p.unidade ? `, suíte ${p.unidade}` : ''})`;
  const taxaDe = (forma: string) => (forma === 'debito' ? maq.taxaDebito ?? 1.99 : forma === 'credito' ? maq.taxaCredito ?? 3.49 : maq.taxaPix ?? 0);

  /* ---- relatório da maquininha (CSV) ---- */
  const linhas: string[] = ['Data da venda;Hora;Tipo;Bandeira;Parcelas;NSU;Cód. Autorização;Valor bruto;Taxa;Valor líquido;Previsão de pagamento'];
  const depositos = new Map<string, { quando: Date; valor: number }>();
  cartoes.forEach((p, i) => {
    if (i === 2 && cartoes.length >= 4) { roteiro.push(`🔴 No sistema sem banco: ${quem(p)} — tirei do relatório (como venda cancelada na máquina).`); return; }
    let forma = p.forma;
    let codigo = p.comprovante?.replace(/\s/g, '') || '';
    let taxaPct = taxaDe(forma);
    if (i === 0 && codigo.length >= 4) {
      codigo = trocarDigitos(codigo);
      roteiro.push(`🟡 Código parecido: ${quem(p)} — no relatório o código é ${codigo} (no sistema ${p.comprovante}). Use "Confirmar e corrigir o código".`);
    } else if (i === 1) {
      forma = p.forma === 'debito' ? 'credito' : 'debito';
      taxaPct = taxaDe(forma);
      roteiro.push(`🟡 Forma diferente: ${quem(p)} — no relatório veio ${forma === 'debito' ? 'Débito' : 'Crédito'}. Use "Corrigir para…".`);
    } else if (i === 3) {
      taxaPct = r2(taxaPct + 1);
      roteiro.push(`${codigo ? '🟢' : '🟢 Sem código'} + taxa a mais: ${quem(p)} — a maquininha cobrou ${dinheiro(taxaPct)}% (contrato ${dinheiro(taxaDe(forma))}%). Aparece na aba Taxas.`);
    } else if (!codigo) {
      roteiro.push(`🟢 Sem código: ${quem(p)} — a recepção não digitou o código; se for o único com o mesmo valor, forma e horário, o sistema confere sozinho (senão fica amarelo para confirmar).`);
    }
    if (!codigo) codigo = novoCodigo(`venda:${p.momento.toISOString()}:${p.valor}`);
    const taxa = r2((p.valor * taxaPct) / 100);
    const liquido = r2(p.valor - taxa);
    const pagamento = maisDias(p.momento, forma === 'debito' ? maq.prazoDebito : maq.prazoCredito);
    linhas.push([dataBr(p.momento), horaBr(p.momento), forma === 'debito' ? 'Débito' : 'Crédito à vista', 'Visa', '1', codigo, codigo.slice(-6),
      dinheiro(p.valor), dinheiro(taxa), dinheiro(liquido), dataBr(pagamento)].join(';'));
    // o que já caiu na conta: um depósito por dia de pagamento
    if (pagamento <= hoje) {
      const k = dataBr(pagamento);
      const d = depositos.get(k) ?? { quando: pagamento, valor: 0 };
      d.valor = r2(d.valor + liquido);
      depositos.set(k, d);
    }
  });
  // venda na maquininha que ninguém lançou
  const base = cartoes[0]?.momento ?? pixes[0]?.momento ?? hoje;
  const extra = new Date(base.getTime() + 47 * 60_000);
  linhas.push([dataBr(extra), horaBr(extra), 'Débito', 'Master', '1', novoCodigo(`extra:${extra.toISOString()}`), '771122', '77,77', dinheiro(r2(0.7777 * taxaDe('debito'))),
    dinheiro(r2(77.77 - 0.7777 * taxaDe('debito'))), dataBr(maisDias(extra, maq.prazoDebito))].join(';'));
  // a maquininha também paga esta venda: entra no depósito do dia
  const pagExtra = maisDias(extra, maq.prazoDebito);
  if (pagExtra <= hoje) {
    const k = dataBr(pagExtra);
    const d = depositos.get(k) ?? { quando: pagExtra, valor: 0 };
    d.valor = r2(d.valor + r2(77.77 - 0.7777 * taxaDe('debito')));
    depositos.set(k, d);
  }
  roteiro.push(`🔴 No banco sem conta: Débito de R$ 77,77 (${dataBr(extra)} ${horaBr(extra)}) — venda na maquininha que não foi lançada em conta nenhuma.`);
  linhas.push(['TOTAL', '', '', '', '', '', '', '', '', '', ''].join(';'));

  /* ---- extrato do banco (OFX) ---- */
  const trans: string[] = [];
  const lanc = (quando: Date, valor: number, memo: string) => {
    trans.push(`<STMTTRN>\n<TRNTYPE>${valor < 0 ? 'DEBIT' : 'CREDIT'}\n<DTPOSTED>${ofxData(quando)}[-3:BRT]\n<TRNAMT>${valor.toFixed(2)}\n<FITID>TESTE${fixo(`${quando.toISOString()}:${valor}:${memo}`, 10000000, 89999999)}\n<MEMO>${memo}\n</STMTTRN>`);
  };
  pixes.forEach((p, i) => {
    if (i === 1 && pixes.length >= 3) { roteiro.push(`🔴 No sistema sem banco: ${quem(p)} — tirei do extrato (Pix que não entrou).`); return; }
    const id = p.comprovante?.replace(/\s/g, '') || '';
    lanc(new Date(p.momento.getTime() + 60_000), p.valor, `PIX RECEBIDO - CLIENTE TESTE ${id ? `E2E${id}` : ''}`.trim());
    roteiro.push(id ? `🟢 Pix certo: ${quem(p)} — achado no extrato pelo código.` : `🟢 Pix sem código: ${quem(p)} — único com esse valor no dia: conferido sozinho.`);
  });
  for (const d of depositos.values()) {
    lanc(d.quando, d.valor, `${maq.nome.toUpperCase()} PAGAMENTOS`);
    roteiro.push(`🟢 Depósito da maquininha: R$ ${dinheiro(d.valor)} em ${dataBr(d.quando)} — soma das vendas daquele dia, já sem a taxa.`);
  }
  lanc(new Date(base.getTime() + 3 * 3600_000), 120, 'PIX RECEBIDO - FULANO DE TAL');
  roteiro.push(`🔴 No banco sem conta: Pix de R$ 120,00 (${dataBr(base)}) — entrou no banco e ninguém lançou.`);
  lanc(new Date(base.getTime() + 4 * 3600_000), -15.9, 'TARIFA BANCARIA PACOTE');
  roteiro.push('⚪ Tarifa de R$ 15,90 — é saída do banco: fica guardada, fora da conferência.');

  const datas = [...pags.map((p) => p.momento), extra].sort((a, b) => a.getTime() - b.getTime());
  const ofx = ['OFXHEADER:100', 'DATA:OFXSGML', 'VERSION:102', 'SECURITY:NONE', 'ENCODING:USASCII', 'CHARSET:1252', 'COMPRESSION:NONE', 'OLDFILEUID:NONE', 'NEWFILEUID:NONE', '',
    '<OFX>', '<BANKMSGSRSV1>', '<STMTTRNRS>', '<STMTRS>', '<CURDEF>BRL', '<BANKACCTFROM>', '<BANKID>999', '<ACCTID>TESTE-0001', '<ACCTTYPE>CHECKING', '</BANKACCTFROM>', '<BANKTRANLIST>',
    `<DTSTART>${ofxData(datas[0])}`, `<DTEND>${ofxData(datas[datas.length - 1])}`, ...trans, '</BANKTRANLIST>', '</STMTRS>', '</STMTTRNRS>', '</BANKMSGSRSV1>', '</OFX>', ''].join('\r\n');
  if (!cartoes.length) roteiro.unshift('Não há débito nem crédito lançado no período: o relatório da maquininha só tem a venda de teste.');
  if (!pixes.length) roteiro.unshift('Não há Pix lançado no período: o extrato só tem os depósitos e os lançamentos de teste.');
  return { csv: '﻿' + linhas.join('\r\n') + '\r\n', ofx, roteiro };
}
