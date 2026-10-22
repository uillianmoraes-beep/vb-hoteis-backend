import ExcelJS from 'exceljs';
import { createHash } from 'crypto';

/**
 * Leitura dos arquivos da conciliação, para qualquer banco e qualquer maquininha:
 * - OFX: o extrato padrão que todo banco exporta;
 * - Excel/CSV: relatório da maquininha (ou extrato em planilha). As colunas são reconhecidas pelo título
 *   e o cliente confere/corrige uma vez; o modelo fica guardado para as próximas importações.
 */

export interface LinhaArquivo {
  chave: string;
  momento: Date;
  temHora: boolean;
  dataPagamento: string | null;
  forma: 'pix' | 'debito' | 'credito' | null;
  bandeira: string | null;
  parcelas: number | null;
  nsu: string | null;
  autorizacao: string | null;
  valorBruto: number;
  taxa: number | null;
  valorLiquido: number | null;
  descricao: string | null;
}

/** campos que uma coluna pode ser */
export const CAMPOS = {
  data: 'Data (e hora) da venda',
  hora: 'Hora',
  dataPagamento: 'Data do pagamento / previsão',
  forma: 'Tipo (débito, crédito, Pix)',
  bandeira: 'Bandeira',
  parcelas: 'Parcelas',
  nsu: 'NSU / DOC',
  autorizacao: 'Código de autorização',
  bruto: 'Valor bruto (da venda)',
  taxa: 'Taxa (R$)',
  liquido: 'Valor líquido (a receber)',
  descricao: 'Descrição / histórico',
} as const;
export type Campo = keyof typeof CAMPOS;
/** mapa: campo → número da coluna (0, 1, 2…) */
export type Mapa = Partial<Record<Campo, number>>;

const sem = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** palavras de cada campo nos títulos das colunas (a primeira que bater fica) */
const PALAVRAS: [Campo, RegExp][] = [
  ['dataPagamento', /^(data (de |do |da )?(pagamento|recebimento|credito|liquidacao)|previsao( de pagamento| de recebimento)?|data prevista|vencimento)/],
  ['autorizacao', /(autoriza|^aut$|cod aut)/],
  ['nsu', /(^nsu|nsu$|^doc|cv nsu|^cv$|stone id|id da transacao|codigo da transacao|numero da transacao|^id$|e2e|end to end)/],
  ['liquido', /(liquido|a receber|valor recebido|valor creditado)/],
  ['taxa', /(^taxa|^tarifa|^mdr|desconto|valor da taxa|custo)/],
  ['bruto', /(bruto|valor da venda|valor original|valor da transacao|^valor$|^valor r$|^valor rs$)/],
  ['parcelas', /(parcela|^plano$|qtd parc)/],
  ['bandeira', /bandeira/],
  ['forma', /(^tipo|forma de pagamento|modalidade|^produto|meio de pagamento|tipo de transacao)/],
  ['hora', /^hora/],
  ['data', /(^data|^dt|momento|data hora)/],
  ['descricao', /(historico|descricao|lancamento|memo)/],
];

export function adivinharMapa(cabecalho: string[]): Mapa {
  const mapa: Mapa = {};
  cabecalho.forEach((titulo, i) => {
    const t = sem(titulo);
    if (!t) return;
    for (const [campo, re] of PALAVRAS) {
      if (mapa[campo] === undefined && re.test(t)) { mapa[campo] = i; return; }
    }
  });
  return mapa;
}

export const assinatura = (cabecalho: string[]) => cabecalho.map(sem).filter(Boolean).join('|').slice(0, 2000);

/* ---------------- valores ---------------- */

export function numero(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let t = String(v).replace(/R\$|\s| /g, '');
  if (!t) return null;
  const negativo = /^\(.*\)$/.test(t) || /-$/.test(t) || /^-/.test(t) || /D$/i.test(t);
  t = t.replace(/[()\-+DC]/gi, '');
  // 1.234,56 | 1,234.56 | 1234,56 | 1234.56
  if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(/,/g, '');
  const n = Number(t);
  return Number.isFinite(n) ? (negativo ? -n : n) : null;
}

/** data (e hora, se tiver) no fuso de São Paulo */
export function dataHora(v: unknown, hora?: unknown): { momento: Date; temHora: boolean } | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) {
    // o Excel guarda a data "como está" (sem fuso): lê os números e trata como horário de Brasília
    const temHora = v.getUTCHours() + v.getUTCMinutes() + v.getUTCSeconds() > 0;
    const d = new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate(), v.getUTCHours() + 3, v.getUTCMinutes(), v.getUTCSeconds()));
    if (!temHora && hora) return juntarHora(d, hora);
    return { momento: temHora ? d : new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate(), 15)), temHora };
  }
  const t = String(v).trim();
  let a: number, m: number, d: number, h = 0, mi = 0, s = 0, temHora = false;
  let r = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (r) {
    d = +r[1]; m = +r[2]; a = +r[3]; if (a < 100) a += 2000;
    if (r[4]) { h = +r[4]; mi = +r[5]; s = +(r[6] ?? 0); temHora = true; }
  } else {
    r = t.match(/^(\d{4})-?(\d{2})-?(\d{2})(?:[ T]?(\d{2}):?(\d{2}):?(\d{2})?)?/);
    if (!r) return null;
    a = +r[1]; m = +r[2]; d = +r[3];
    if (r[4]) { h = +r[4]; mi = +r[5]; s = +(r[6] ?? 0); temHora = h + mi + s > 0; }
  }
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const base = new Date(Date.UTC(a, m - 1, d, temHora ? h + 3 : 15, temHora ? mi : 0, temHora ? s : 0));
  if (!temHora && hora) return juntarHora(base, hora);
  return { momento: base, temHora };
}

function juntarHora(dia: Date, hora: unknown): { momento: Date; temHora: boolean } {
  let h: number | null = null, mi = 0;
  if (hora instanceof Date) { h = hora.getUTCHours(); mi = hora.getUTCMinutes(); }
  else if (typeof hora === 'number') { const tot = Math.round(hora * 1440); h = Math.floor(tot / 60) % 24; mi = tot % 60; }
  else { const r = String(hora).match(/(\d{1,2}):(\d{2})/); if (r) { h = +r[1]; mi = +r[2]; } }
  if (h === null) return { momento: dia, temHora: false };
  return { momento: new Date(Date.UTC(dia.getUTCFullYear(), dia.getUTCMonth(), dia.getUTCDate(), h + 3, mi)), temHora: true };
}

const dia = (v: unknown) => { const x = dataHora(v); return x ? new Date(x.momento.getTime() - 3 * 3600_000).toISOString().slice(0, 10) : null; };

export function forma(v: unknown): LinhaArquivo['forma'] {
  const t = sem(String(v ?? ''));
  if (!t) return null;
  if (/pix/.test(t)) return 'pix';
  if (/deb|debit|maestro|electron|elo debito|visa electron/.test(t)) return 'debito';
  if (/cred|credit|parcel|a vista|avista/.test(t)) return 'credito';
  return null;
}

export const codigo = (v: unknown) => {
  const t = String(v ?? '').trim().replace(/\s+/g, '');
  return t && t !== '0' && t !== '-' ? t.slice(0, 60) : null;
};

const hash = (partes: unknown[]) => createHash('sha1').update(partes.map((p) => String(p ?? '')).join('|')).digest('hex').slice(0, 40);

/* ---------------- OFX ---------------- */

/** extrato OFX (SGML ou XML, qualquer banco): só os lançamentos */
export function lerOfx(buf: Buffer): { linhas: LinhaArquivo[]; conta: string | null } {
  let texto = buf.toString('utf8');
  if (texto.includes('�')) texto = buf.toString('latin1');
  const tag = (bloco: string, nome: string) => {
    const r = bloco.match(new RegExp(`<${nome}>([^<\\r\\n]*)`, 'i'));
    return r ? r[1].trim() : null;
  };
  const conta = tag(texto, 'ACCTID');
  const blocos = texto.split(/<STMTTRN>/i).slice(1).map((b) => b.split(/<\/STMTTRN>/i)[0]);
  const linhas: LinhaArquivo[] = [];
  for (const b of blocos) {
    const valor = numero(tag(b, 'TRNAMT'));
    const quando = tag(b, 'DTPOSTED');
    if (valor === null || !quando) continue;
    const r = quando.match(/^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/);
    if (!r) continue;
    const temHora = !!r[4] && +r[4] + +(r[5] ?? 0) + +(r[6] ?? 0) > 0;
    const momento = new Date(Date.UTC(+r[1], +r[2] - 1, +r[3], temHora ? +r[4] + 3 : 15, temHora ? +(r[5] ?? 0) : 0, temHora ? +(r[6] ?? 0) : 0));
    const memo = [tag(b, 'NAME'), tag(b, 'MEMO')].filter(Boolean).join(' · ').slice(0, 300) || null;
    const fitid = tag(b, 'FITID');
    linhas.push({
      chave: `ofx:${conta ?? ''}:${fitid ?? hash([quando, valor, memo, tag(b, 'CHECKNUM')])}`.slice(0, 120),
      momento, temHora, dataPagamento: null, forma: /pix/i.test(memo ?? '') ? 'pix' : null, bandeira: null, parcelas: null,
      nsu: codigo(tag(b, 'CHECKNUM') ?? tag(b, 'REFNUM')), autorizacao: null, valorBruto: valor, taxa: null, valorLiquido: valor, descricao: memo,
    });
  }
  return { linhas, conta };
}

/* ---------------- planilha (Excel ou CSV) ---------------- */

function lerCsv(texto: string): string[][] {
  const primeira = texto.split(/\r?\n/).find((l) => l.trim()) ?? '';
  const sep = (primeira.match(/;/g)?.length ?? 0) >= (primeira.match(/,/g)?.length ?? 0) ? ';' : (primeira.includes('\t') ? '\t' : ',');
  const linhas: string[][] = [];
  let campo = '', linha: string[] = [], aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      linha.push(campo); campo = '';
      if (linha.some((x) => x.trim())) linhas.push(linha);
      linha = [];
    } else campo += c;
  }
  linha.push(campo);
  if (linha.some((x) => x.trim())) linhas.push(linha);
  return linhas;
}

function celula(v: ExcelJS.CellValue): unknown {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in v && v.result !== undefined) return celula(v.result as ExcelJS.CellValue);
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return String(v.text);
  }
  return v;
}

/** todas as linhas da planilha (primeira aba com dados) */
export async function lerTabela(buf: Buffer, nome: string): Promise<unknown[][]> {
  if (/\.(csv|txt)$/i.test(nome)) {
    let texto = buf.toString('utf8');
    if (texto.includes('�')) texto = buf.toString('latin1');
    return lerCsv(texto.replace(/^﻿/, ''));
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  for (const ws of wb.worksheets) {
    const linhas: unknown[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const l: unknown[] = [];
      for (let c = 1; c <= ws.columnCount; c++) l.push(celula(row.getCell(c).value));
      linhas.push(l);
    });
    if (linhas.length > 1) return linhas;
  }
  return [];
}

/** acha a linha do cabeçalho: a primeira (entre as 20 primeiras) com 3+ títulos e pelo menos um valor e uma data reconhecidos */
export function acharCabecalho(tabela: unknown[][]): number {
  for (let i = 0; i < Math.min(20, tabela.length); i++) {
    const titulos = tabela[i].map((x) => String(x ?? ''));
    if (titulos.filter((t) => t.trim()).length < 3) continue;
    const m = adivinharMapa(titulos);
    if ((m.bruto !== undefined || m.liquido !== undefined) && m.data !== undefined) return i;
  }
  return tabela.findIndex((l) => l.filter((x) => String(x ?? '').trim()).length >= 3);
}

/** converte as linhas da planilha com o mapa de colunas */
export function linhasDaPlanilha(tabela: unknown[][], cab: number, mapa: Mapa, origem: string, dono: string): { linhas: LinhaArquivo[]; erros: string[] } {
  const linhas: LinhaArquivo[] = [];
  const erros: string[] = [];
  const col = (l: unknown[], c: Campo) => (mapa[c] === undefined ? undefined : l[mapa[c]!]);
  for (let i = cab + 1; i < tabela.length; i++) {
    const l = tabela[i];
    if (!l.some((x) => String(x ?? '').trim())) continue;
    // linha de total / subtotal do relatório
    if (l.some((x) => /^(sub)?tota(l|is)\b/i.test(String(x ?? '').trim()))) continue;
    const quando = dataHora(col(l, 'data'), col(l, 'hora'));
    const bruto = numero(col(l, 'bruto'));
    const liquido = numero(col(l, 'liquido'));
    const valor = bruto ?? liquido;
    if (!quando || valor === null) {
      // linhas de total/rodapé não têm data
      if (quando || valor !== null) erros.push(`linha ${i + 1}: ${!quando ? 'sem data' : 'sem valor'}`);
      continue;
    }
    let taxa = numero(col(l, 'taxa'));
    if (taxa !== null) taxa = Math.abs(taxa);
    if (taxa === null && bruto !== null && liquido !== null) taxa = Math.round((bruto - liquido) * 100) / 100;
    const parc = numero(col(l, 'parcelas'));
    const nsu = codigo(col(l, 'nsu'));
    const aut = codigo(col(l, 'autorizacao'));
    const pag = col(l, 'dataPagamento') ? dia(col(l, 'dataPagamento')) : null;
    linhas.push({
      chave: `${origem}:${dono}:${hash([quando.momento.toISOString(), nsu, aut, valor, liquido, pag, parc, col(l, 'descricao'), i])}`.slice(0, 120),
      momento: quando.momento, temHora: quando.temHora, dataPagamento: pag,
      forma: forma(col(l, 'forma')) ?? forma(col(l, 'descricao')) ?? (parc && parc > 1 ? 'credito' : null),
      bandeira: String(col(l, 'bandeira') ?? '').trim().slice(0, 30) || null,
      parcelas: parc && parc > 0 && parc < 100 ? Math.round(parc) : null,
      nsu, autorizacao: aut, valorBruto: valor, taxa, valorLiquido: liquido ?? (taxa !== null ? Math.round((valor - taxa) * 100) / 100 : null),
      descricao: String(col(l, 'descricao') ?? '').trim().slice(0, 300) || null,
    });
  }
  return { linhas, erros };
}
