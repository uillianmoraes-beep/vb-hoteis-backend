/** Monta o ticket em ESC/POS (impressoras térmicas 80 mm = 48 colunas, 58 mm = 32). */
export interface LinhaTicket { t: string; grande?: boolean; negrito?: boolean; centro?: boolean }

const ESC = '\x1b';
const GS = '\x1d';
/** sem acento: funciona em qualquer impressora, sem depender da página de código */
export const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '');

function quebrar(texto: string, colunas: number): string[] {
  const saida: string[] = [];
  for (const parte of texto.split('\n')) {
    let resto = parte;
    while (resto.length > colunas) {
      let corte = resto.lastIndexOf(' ', colunas);
      if (corte <= 0) corte = colunas;
      saida.push(resto.slice(0, corte));
      resto = resto.slice(corte).trimStart();
    }
    saida.push(resto);
  }
  return saida;
}

export function montarTicket(linhas: LinhaTicket[], colunas: number, copias = 1): { dados: string; texto: string } {
  let out = '';
  const texto: string[] = [];
  for (let c = 0; c < Math.max(1, copias); c++) {
    out += `${ESC}@`;
    for (const l of linhas) {
      const larg = l.grande ? Math.floor(colunas / 2) : colunas;
      out += `${ESC}a${l.centro ? '\x01' : '\x00'}${ESC}E${l.negrito || l.grande ? '\x01' : '\x00'}${GS}!${l.grande ? '\x11' : '\x00'}`;
      for (const q of quebrar(semAcento(l.t), larg)) {
        out += `${q}\n`;
        if (c === 0) texto.push(q);
      }
    }
    out += `${GS}!\x00${ESC}E\x00${ESC}a\x00\n\n\n${GS}V\x42\x00`;
  }
  return { dados: Buffer.from(out, 'latin1').toString('base64'), texto: texto.join('\n') };
}
