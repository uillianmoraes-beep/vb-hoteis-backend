import ExcelJS from 'exceljs';

/** Colunas da planilha de importação de produtos (a ordem é a da planilha). */
export const COLUNAS = [
  { chave: 'nome', titulo: 'Nome *', largura: 34, ajuda: 'Obrigatório. Ex.: Coca-Cola lata, Contra filé (peça), Papel higiênico' },
  { chave: 'uso', titulo: 'Para que serve', largura: 16, ajuda: 'Venda ou Uso interno (ingrediente, limpeza, higiene). Vazio = Venda' },
  { chave: 'tipo', titulo: 'Tipo', largura: 12, ajuda: 'Produto ou Serviço. Vazio = Produto' },
  { chave: 'grupo', titulo: 'Grupo', largura: 20, ajuda: 'Ex.: Bebidas, Porções, Carnes, Limpeza' },
  { chave: 'unidade', titulo: 'Unidade', largura: 10, ajuda: 'un, kg, g, l, ml, cx, pct, dz, porcao, garrafa. Vazio = un' },
  { chave: 'preco', titulo: 'Preço de venda', largura: 14, ajuda: 'Só para venda. Ex.: 10,00' },
  { chave: 'custo', titulo: 'Preço de custo', largura: 14, ajuda: 'Por unidade (ou por kg). Ex.: 4,50' },
  { chave: 'codigo', titulo: 'Código', largura: 12, ajuda: 'Código interno (opcional)' },
  { chave: 'barras', titulo: 'Código de barras', largura: 18, ajuda: 'EAN da embalagem (opcional)' },
  { chave: 'controla', titulo: 'Controla estoque', largura: 15, ajuda: 'Sim ou Não. Vazio = Sim para produto' },
  { chave: 'minimo', titulo: 'Estoque mínimo', largura: 14, ajuda: 'Avisa quando ficar abaixo (opcional)' },
  { chave: 'usadoEm', titulo: 'Usado em', largura: 20, ajuda: 'Todos, ou os ambientes separados por ; (ex.: Motel; Hotel)' },
  { chave: 'frigobar', titulo: 'Frigobar', largura: 10, ajuda: 'Sim ou Não' },
  { chave: 'ressarcimento', titulo: 'Avaria / ressarcimento', largura: 20, ajuda: 'Sim para roupão, toalha, copo (cobrado fora da nota)' },
  { chave: 'saldo', titulo: 'Saldo inicial', largura: 13, ajuda: 'Quantidade que tem hoje (opcional): entra no estoque' },
  { chave: 'local', titulo: 'Local do saldo', largura: 22, ajuda: 'Nome do local (ex.: Centro de distribuição). Vazio = o principal' },
  // tributação (vazio = usa os padrões da Configuração fiscal)
  { chave: 'f_ncm', titulo: 'NCM', largura: 12, ajuda: '8 números. Ex.: 22021000 (refrigerante)' },
  { chave: 'f_cest', titulo: 'CEST', largura: 11, ajuda: '7 números, quando tem substituição tributária. Ex.: 0300700' },
  { chave: 'f_cfop', titulo: 'CFOP', largura: 8, ajuda: '4 números. Ex.: 5102 (venda), 5405 (venda com substituição tributária)' },
  { chave: 'f_origem', titulo: 'Origem', largura: 8, ajuda: '0 a 8. 0 = nacional' },
  { chave: 'f_unidade', titulo: 'Unidade fiscal', largura: 10, ajuda: 'Unidade na nota: UN, KG, LT, CX… Vazio = a unidade do produto' },
  { chave: 'f_cstIcms', titulo: 'CST/CSOSN ICMS', largura: 12, ajuda: 'Simples: CSOSN de 3 números (ex.: 102, 500). Regime normal: CST de 2 números (ex.: 00, 60)' },
  { chave: 'f_aliquotaIcms', titulo: 'Alíquota ICMS %', largura: 12, ajuda: 'Ex.: 18' },
  { chave: 'f_reducaoBc', titulo: 'Redução BC ICMS %', largura: 12, ajuda: 'Redução da base de cálculo (opcional)' },
  { chave: 'f_aliquotaFcp', titulo: 'FCP %', largura: 8, ajuda: 'Fundo de combate à pobreza (opcional)' },
  { chave: 'f_codBeneficio', titulo: 'Código benefício (cBenef)', largura: 14, ajuda: 'Código do benefício fiscal do estado (opcional)' },
  { chave: 'f_cstPis', titulo: 'CST PIS', largura: 8, ajuda: '2 números. Ex.: 01, 04 (monofásico), 49, 99' },
  { chave: 'f_aliquotaPis', titulo: 'Alíquota PIS %', largura: 11, ajuda: 'Ex.: 0,65' },
  { chave: 'f_cstCofins', titulo: 'CST COFINS', largura: 10, ajuda: '2 números. Ex.: 01, 04 (monofásico), 49, 99' },
  { chave: 'f_aliquotaCofins', titulo: 'Alíquota COFINS %', largura: 12, ajuda: 'Ex.: 3' },
  { chave: 'f_cstIbsCbs', titulo: 'CST IBS/CBS', largura: 11, ajuda: 'Reforma tributária: 3 números. Ex.: 000' },
  { chave: 'f_cClassTrib', titulo: 'cClassTrib', largura: 11, ajuda: 'Reforma tributária: 6 números. Ex.: 000001' },
  { chave: 'f_indOp', titulo: 'cIndOp', largura: 10, ajuda: 'Indicador da operação (6 números), quando a nota pedir' },
  { chave: 'f_aliquotaIbs', titulo: 'Alíquota IBS %', largura: 11, ajuda: 'Ex.: 0,1' },
  { chave: 'f_aliquotaIbsUf', titulo: 'IBS estadual %', largura: 11, ajuda: 'Parte do estado (opcional)' },
  { chave: 'f_aliquotaIbsMun', titulo: 'IBS municipal %', largura: 11, ajuda: 'Parte do município (opcional)' },
  { chave: 'f_aliquotaCbs', titulo: 'Alíquota CBS %', largura: 11, ajuda: 'Ex.: 0,9' },
  { chave: 'f_reducaoIbsUf', titulo: 'Redução IBS estadual %', largura: 12, ajuda: 'Opcional' },
  { chave: 'f_reducaoIbsMun', titulo: 'Redução IBS municipal %', largura: 12, ajuda: 'Opcional' },
  { chave: 'f_reducaoCbs', titulo: 'Redução CBS %', largura: 12, ajuda: 'Opcional' },
  { chave: 'f_codigoServico', titulo: 'Serviço (LC 116)', largura: 12, ajuda: 'Só para serviço (NFS-e). Ex.: 09.01' },
  { chave: 'f_codigoMunicipal', titulo: 'Código municipal', largura: 14, ajuda: 'Código de tributação do município (NFS-e)' },
  { chave: 'f_cnae', titulo: 'CNAE', largura: 10, ajuda: '7 números (NFS-e)' },
  { chave: 'f_aliquotaIss', titulo: 'Alíquota ISS %', largura: 11, ajuda: 'Ex.: 5' },
  { chave: 'f_issRetido', titulo: 'ISS retido', largura: 9, ajuda: 'Sim ou Não' },
  { chave: 'f_observacao', titulo: 'Obs. fiscal', largura: 24, ajuda: 'Informação para a nota (opcional)' },
] as const;

/** colunas de tributação: chave da planilha → campo em produtos.fiscal */
export const COLUNAS_FISCAIS = COLUNAS.filter((c) => c.chave.startsWith('f_')).map((c) => ({ chave: c.chave, campo: c.chave.slice(2) }));
/**
 * Códigos que o Excel transforma em número e perdem o zero da frente (ex.: CST 00, NCM 02…).
 * [tamanho certo, menor tamanho que ainda é zero perdido]: NCM com 7 números vira 0 + 7; com 3 é erro de digitação.
 */
export const ZEROS: Record<string, [number, number]> = {
  ncm: [8, 7], cest: [7, 6], cnae: [7, 6], cstPis: [2, 1], cstCofins: [2, 1], cstIcms: [2, 1], cstIbsCbs: [3, 1], cClassTrib: [6, 1], indOp: [6, 1],
};

export type Chave = (typeof COLUNAS)[number]['chave'];
export type LinhaLida = { linha: number } & Partial<Record<Chave, string>>;

const SIM_NAO = '"Sim,Não"';

/** Planilha modelo: aba Produtos com listas de escolha e exemplos, e aba Instruções com ambientes e locais da empresa. */
export async function planilhaModelo(ambientes: string[], locais: string[], produtos?: Partial<Record<Chave, string | number>>[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'VB Soluções Hoteleiras';
  const ws = wb.addWorksheet('Produtos', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = COLUNAS.map((c) => ({ header: c.titulo, key: c.chave, width: c.largura }));
  const cab = ws.getRow(1);
  cab.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  cab.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
  cab.alignment = { vertical: 'middle', wrapText: true };
  cab.height = 32;
  COLUNAS.forEach((c, i) => {
    cab.getCell(i + 1).note = c.ajuda;
    // tributação em verde; códigos como texto para não perder o zero da frente
    if (c.chave.startsWith('f_')) {
      cab.getCell(i + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF166534' } };
      if (!/aliquota|reducao/i.test(c.chave)) ws.getColumn(i + 1).numFmt = '@';
    }
  });
  ws.getColumn(COLUNAS.findIndex((c) => c.chave === 'barras') + 1).numFmt = '@';
  for (const p of produtos ?? []) ws.addRow(p);
  const exemplos: Partial<Record<Chave, string | number>>[] = [
    { nome: 'Coca-Cola lata 350ml', uso: 'Venda', tipo: 'Produto', grupo: 'Bebidas', unidade: 'un', preco: 10, custo: 3.5, barras: '7894900011517', controla: 'Sim', minimo: 24, usadoEm: 'Todos', frigobar: 'Sim', ressarcimento: 'Não', saldo: 120, local: locais[0] ?? '' },
    { nome: 'Contra filé (peça)', uso: 'Uso interno', tipo: 'Produto', grupo: 'Carnes', unidade: 'kg', custo: 49.9, controla: 'Sim', minimo: 5, usadoEm: 'Todos', saldo: 8.2, local: locais[0] ?? '' },
    { nome: 'Roupão de banho', uso: 'Venda', tipo: 'Produto', grupo: 'Avarias e reposição', unidade: 'un', preco: 120, custo: 60, controla: 'Não', usadoEm: 'Todos', ressarcimento: 'Sim' },
    { nome: 'Toalha extra', uso: 'Venda', tipo: 'Serviço', grupo: 'Pedidos ao quarto', unidade: 'un', preco: 0, controla: 'Não', usadoEm: ambientes[0] ?? 'Todos' },
  ];
  // exemplos numa aba à parte (a aba Produtos começa em branco, para não importar exemplo sem querer)
  const ex = wb.addWorksheet('Exemplos');
  ex.columns = COLUNAS.map((c) => ({ header: c.titulo, key: c.chave, width: c.largura }));
  ex.getRow(1).font = { bold: true };
  for (const e of exemplos) ex.addRow(e);
  const listas: [Chave, string][] = [
    ['uso', '"Venda,Uso interno"'], ['tipo', '"Produto,Serviço"'], ['unidade', '"un,kg,g,l,ml,cx,pct,dz,porcao,garrafa"'],
    ['controla', SIM_NAO], ['frigobar', SIM_NAO], ['ressarcimento', SIM_NAO], ['f_issRetido', SIM_NAO], ['f_origem', '"0,1,2,3,4,5,6,7,8"'],
  ];
  for (const [chave, formula] of listas) {
    const letra = ws.getColumn(COLUNAS.findIndex((c) => c.chave === chave) + 1).letter;
    // a lista vale para o intervalo todo, sem criar linhas vazias
    (ws as unknown as { dataValidations: { add: (r: string, v: ExcelJS.DataValidation) => void } }).dataValidations
      .add(`${letra}2:${letra}3001`, { type: 'list', allowBlank: true, formulae: [formula], showErrorMessage: true, error: 'Escolha um valor da lista.' });
  }
  const ins = wb.addWorksheet('Instruções');
  ins.columns = [{ width: 28 }, { width: 90 }];
  ins.addRow(['Como preencher']).font = { bold: true, size: 14 };
  ins.addRow(['', 'Uma linha por produto na aba "Produtos". Veja a aba "Exemplos" para se guiar.']);
  ins.addRow(['', 'Se o produto já existir (mesmo código de barras, código ou nome), ele é atualizado com o que estiver preenchido.']);
  ins.addRow(['', 'Antes de gravar, o sistema mostra uma prévia com o que vai criar, atualizar e as linhas com erro.']);
  ins.addRow(['', 'Colunas verdes = tributação. Em branco, o produto usa os padrões da Configuração fiscal. Preenchida, vale a do produto.']);
  ins.addRow(['', 'Para corrigir em massa: Exportar produtos, mudar no Excel e importar de volta (só o que estiver preenchido é atualizado).']);
  ins.addRow([]);
  ins.addRow(['Colunas']).font = { bold: true };
  for (const c of COLUNAS) ins.addRow([c.titulo, c.ajuda]);
  ins.addRow([]);
  ins.addRow(['Ambientes (Usado em)']).font = { bold: true };
  for (const a of ambientes) ins.addRow(['', a]);
  ins.addRow([]);
  ins.addRow(['Locais (Local do saldo)']).font = { bold: true };
  for (const l of locais) ins.addRow(['', l]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** texto de uma célula, qualquer que seja o formato (número, fórmula, texto rico, data) */
function texto(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v && v.result !== undefined) return texto(v.result as ExcelJS.CellValue);
    if ('richText' in v) return v.richText.map((t) => t.text).join('').trim();
    if ('text' in v) return String(v.text).trim();
  }
  return String(v).trim();
}

/** lê a aba "Produtos" (ou a primeira): acha as colunas pelo título e devolve as linhas preenchidas */
export async function lerPlanilha(buf: Buffer): Promise<LinhaLida[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.getWorksheet('Produtos') ?? wb.worksheets[0];
  if (!ws) return [];
  const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
  const mapa = new Map<number, Chave>();
  ws.getRow(1).eachCell((cell, col) => {
    const t = norm(texto(cell.value));
    const c = COLUNAS.find((x) => norm(x.titulo) === t);
    if (c) mapa.set(col, c.chave);
  });
  if (![...mapa.values()].includes('nome')) throw new Error('A planilha precisa da coluna "Nome". Use a planilha modelo.');
  const linhas: LinhaLida[] = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const l: LinhaLida = { linha: n };
    for (const [col, chave] of mapa) {
      const t = texto(row.getCell(col).value);
      if (t) l[chave] = t;
    }
    if (Object.keys(l).length > 1) linhas.push(l);
  });
  return linhas;
}
