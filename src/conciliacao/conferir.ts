/**
 * Motor da conciliação: confere cada linha do arquivo (maquininha ou banco) com os pagamentos
 * do sistema (Pix, débito e crédito das contas). Funções puras, para testar sem banco de dados.
 *
 * - verde (conciliada): código do comprovante igual, mesmo valor e mesma forma;
 * - amarelo (sugerida): quase bateu (valor diferente, forma diferente, código parecido, ou sem código
 *   mas mesmo valor e horário perto). O gerente confirma com um toque;
 * - vermelho: sobrou dos dois lados (no sistema sem banco, ou no banco sem conta).
 */

export interface PagamentoSistema {
  id: string;
  forma: string;
  valor: number;
  momento: Date;
  comprovante: string | null;
}

export interface LinhaConferir {
  id: string;
  origem: 'maquininha' | 'banco';
  momento: Date;
  temHora: boolean;
  forma: string | null;
  nsu: string | null;
  autorizacao: string | null;
  valorBruto: number;
  descricao: string | null;
}

export interface Resultado {
  linhaId: string;
  pagamentoId: string;
  status: 'conciliada' | 'sugerida';
  situacao: string;
}

/** compara códigos sem zeros à esquerda e sem pontuação */
export const normal = (c: string | null | undefined) => (c ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/^0+/, '');

/** quantas letras/números trocados (só para códigos do mesmo tamanho, ou um a mais/menos) */
export function distancia(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 1) return 99;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

/** o código digitado é o desta linha? (NSU, autorização, ou o fim do ID do Pix) */
export function codigoBate(digitado: string | null, l: LinhaConferir): boolean {
  const c = normal(digitado);
  if (c.length < 3) return false;
  for (const x of [l.nsu, l.autorizacao]) {
    const y = normal(x);
    if (y && (y === c || (c.length >= 6 && y.endsWith(c)) || (y.length >= 6 && c.endsWith(y)))) return true;
  }
  // banco: o ID do Pix costuma vir no histórico
  if (l.origem === 'banco' && c.length >= 6 && normal(l.descricao).includes(c)) return true;
  return false;
}

export function codigoParecido(digitado: string | null, l: LinhaConferir): boolean {
  const c = normal(digitado);
  if (c.length < 4) return false;
  return [l.nsu, l.autorizacao].some((x) => { const y = normal(x); return y.length >= 4 && distancia(c, y) <= 2; });
}

const DIA = 86_400_000;
const diaSP = (d: Date) => new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 10);

/** horário perto: com hora, até 3 h; só a data, o mesmo dia ou o turno da madrugada (até 6h do dia seguinte) */
export function perto(l: LinhaConferir, p: PagamentoSistema): boolean {
  if (l.temHora) return Math.abs(l.momento.getTime() - p.momento.getTime()) <= 3 * 3600_000;
  const dl = diaSP(l.momento);
  const dp = diaSP(p.momento);
  if (dl === dp) return true;
  // pagamento lançado na madrugada (antes das 6h) do dia seguinte, ou banco que lança no dia seguinte
  const madrugada = diaSP(new Date(p.momento.getTime() - 6 * 3600_000));
  if (madrugada === dl) return true;
  return l.origem === 'banco' && Math.abs(Date.parse(`${dl}T12:00:00Z`) - Date.parse(`${dp}T12:00:00Z`)) <= DIA;
}

const mesmoValor = (a: number, b: number) => Math.abs(a - b) < 0.005;
/** bem perto: com hora, até 10 minutos; sem hora (extrato), o mesmo dia */
const bemPerto = (l: LinhaConferir, p: PagamentoSistema) =>
  l.temHora ? Math.abs(l.momento.getTime() - p.momento.getTime()) <= 10 * 60_000 : diaSP(l.momento) === diaSP(p.momento);
const formaOk = (l: LinhaConferir, p: PagamentoSistema) => !l.forma || l.forma === p.forma;

/**
 * Confere as linhas ainda sem par com os pagamentos ainda sem par.
 * Primeiro os casos certos (código + valor + forma), depois os quase certos, do mais forte para o mais fraco,
 * sem usar o mesmo pagamento duas vezes.
 */
export function conferir(linhas: LinhaConferir[], pagamentos: PagamentoSistema[]): Resultado[] {
  const usados = new Set<string>();
  const feitas = new Set<string>();
  const out: Resultado[] = [];
  // banco: só Pix (os cartões chegam no banco como depósito da maquininha, conferido à parte)
  const candidatos = (l: LinhaConferir) => pagamentos.filter((p) => !usados.has(p.id) && (l.origem === 'maquininha' || p.forma === 'pix'));
  const regras: { status: Resultado['status']; situacao: string; unico?: boolean; teste: (l: LinhaConferir, p: PagamentoSistema) => boolean }[] = [
    { status: 'conciliada', situacao: 'ok', teste: (l, p) => codigoBate(p.comprovante, l) && mesmoValor(l.valorBruto, p.valor) && formaOk(l, p) },
    // sem código digitado, mas só existe um par possível (mesmo valor, mesma forma, até 10 min ou o mesmo dia no extrato): confere sozinho
    { status: 'conciliada', situacao: 'sem código: único com mesmo valor e horário', unico: true,
      teste: (l, p) => !normal(p.comprovante) && mesmoValor(l.valorBruto, p.valor) && !!l.forma && l.forma === p.forma && bemPerto(l, p) },
    { status: 'sugerida', situacao: 'forma diferente', teste: (l, p) => codigoBate(p.comprovante, l) && mesmoValor(l.valorBruto, p.valor) },
    { status: 'sugerida', situacao: 'valor diferente', teste: (l, p) => codigoBate(p.comprovante, l) && perto(l, p) },
    { status: 'sugerida', situacao: 'código parecido', teste: (l, p) => codigoParecido(p.comprovante, l) && mesmoValor(l.valorBruto, p.valor) && perto(l, p) },
    { status: 'sugerida', situacao: 'sem código: mesmo valor e horário', teste: (l, p) => !normal(p.comprovante) && mesmoValor(l.valorBruto, p.valor) && formaOk(l, p) && perto(l, p) },
    { status: 'sugerida', situacao: 'mesmo valor e horário, código diferente', teste: (l, p) => mesmoValor(l.valorBruto, p.valor) && formaOk(l, p) && perto(l, p) },
    { status: 'sugerida', situacao: 'forma diferente', teste: (l, p) => mesmoValor(l.valorBruto, p.valor) && perto(l, p) && l.origem === 'maquininha' },
  ];
  for (const r of regras) {
    for (const l of linhas) {
      if (feitas.has(l.id) || l.valorBruto <= 0) continue;
      // entre vários que servem, o de horário mais perto
      const ok = candidatos(l).filter((p) => r.teste(l, p))
        .sort((a, b) => Math.abs(a.momento.getTime() - l.momento.getTime()) - Math.abs(b.momento.getTime() - l.momento.getTime()));
      if (!ok.length) continue;
      if (r.unico) {
        // só quando não há dúvida: um pagamento para a linha e uma linha para o pagamento
        if (ok.length > 1) continue;
        const outras = linhas.filter((x) => x.id !== l.id && !feitas.has(x.id) && x.valorBruto > 0 && r.teste(x, ok[0]));
        if (outras.length) continue;
      }
      usados.add(ok[0].id);
      feitas.add(l.id);
      out.push({ linhaId: l.id, pagamentoId: ok[0].id, status: r.status, situacao: r.situacao });
    }
  }
  return out;
}

/** taxa que a maquininha cobrou × a do contrato */
export function taxaContrato(
  maq: { taxaDebito: number | null; taxaCredito: number | null; taxaCredito2a6: number | null; taxaCredito7a12: number | null; taxaPix: number | null },
  forma: string | null, parcelas: number | null,
): number | null {
  if (forma === 'debito') return maq.taxaDebito;
  if (forma === 'pix') return maq.taxaPix;
  if (forma === 'credito') {
    const p = parcelas ?? 1;
    if (p >= 7) return maq.taxaCredito7a12 ?? maq.taxaCredito2a6 ?? maq.taxaCredito;
    if (p >= 2) return maq.taxaCredito2a6 ?? maq.taxaCredito;
    return maq.taxaCredito;
  }
  return null;
}

/**
 * Depósito da maquininha no banco: um crédito do extrato que é a soma do líquido das vendas
 * de uma maquininha com pagamento previsto naquele dia (até 2 dias de diferença, R$ 0,10 de folga).
 */
export function acharDeposito(
  credito: { valor: number; dia: string },
  grupos: { chave: string; maquininha: string; dia: string; liquido: number; qtd: number }[],
): { chave: string; maquininha: string; dia: string; qtd: number } | null {
  const dif = (a: string, b: string) => Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / DIA;
  const ok = grupos.filter((g) => Math.abs(g.liquido - credito.valor) <= 0.1 && dif(g.dia, credito.dia) <= 2)
    .sort((a, b) => dif(a.dia, credito.dia) - dif(b.dia, credito.dia));
  return ok[0] ? { chave: ok[0].chave, maquininha: ok[0].maquininha, dia: ok[0].dia, qtd: ok[0].qtd } : null;
}
