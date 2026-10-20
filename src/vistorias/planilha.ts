import ExcelJS from 'exceljs';

const RESULTADO: Record<string, string> = { aprovado: 'Aprovado', ressalva: 'Com ressalva', reprovado: 'Reprovado' };
const COR: Record<string, string> = { aprovado: 'FFDCFCE7', ressalva: 'FFFFEDD5', reprovado: 'FFFEE2E2' };

export interface LinhaPlanilha {
  criadoEm: Date | string; ambiente: string | null; unidade: string | null; camareira: string | null; vistoriadora: string | null;
  resultado: string; itens: { item: string; ok: boolean }[]; reposicao: { nome: string; quantidade: number; semCobranca?: number }[];
  frigobarValidade: string | null; avaria: string | null; observacao: string | null; decisao: string | null; decididoPor: string | null;
  fotos: { id: string; local: string | null }[];
  avarias?: { nome: string; quantidade: number; valor: number }[];
}

/**
 * Planilha das vistorias: uma linha por vistoria, com as fotos em miniatura dentro da célula
 * e o link para abrir a foto inteira no sistema. Uma aba de resumo por vistoriadora e camareira.
 */
export async function montarPlanilha(
  linhas: LinhaPlanilha[],
  resumo: { porVistoriadora: { nome: string; total: number; aprovado: number; ressalva: number; reprovado: number }[]; porCamareira: typeof resumo.porVistoriadora },
  opcoes: { titulo: string; linkFoto: (id: string) => string | null; miniatura: (id: string) => Promise<Buffer | null> },
) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'VB Soluções Hoteleiras';
  const ws = wb.addWorksheet('Vistorias', { views: [{ state: 'frozen', ySplit: 2 }] });
  const maxFotos = Math.max(1, ...linhas.map((l) => l.fotos.length));
  const fixas = ['Data', 'Hora', 'Ambiente', 'Suíte / quarto', 'Camareira', 'Vistoriadora', 'Resultado', 'Itens com problema',
    'Reposição do frigobar', 'Validade frigobar', 'Avaria', 'Observação', 'Decisão do adm'];
  const larguras = [11, 7, 14, 10, 18, 18, 13, 36, 30, 11, 30, 30, 22];
  ws.mergeCells(1, 1, 1, fixas.length + maxFotos);
  ws.getCell(1, 1).value = opcoes.titulo;
  ws.getCell(1, 1).font = { bold: true, size: 13 };
  const cab = ws.getRow(2);
  [...fixas, ...Array.from({ length: maxFotos }, (_, i) => `Foto ${i + 1}`)].forEach((t, i) => { cab.getCell(i + 1).value = t; });
  cab.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  cab.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B2A4A' } };
  cab.alignment = { vertical: 'middle', wrapText: true };
  larguras.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  for (let i = 0; i < maxFotos; i++) ws.getColumn(fixas.length + i + 1).width = 16;

  let r = 3;
  for (const l of linhas) {
    const quando = new Date(l.criadoEm);
    const row = ws.getRow(r);
    const val = [
      quando.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      quando.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }),
      l.ambiente ?? '', l.unidade ?? '', l.camareira ?? '', l.vistoriadora ?? '', RESULTADO[l.resultado] ?? l.resultado,
      l.itens.filter((i) => !i.ok).map((i) => i.item).join('; '),
      l.reposicao.map((x) => `${x.quantidade}× ${x.nome}${x.semCobranca ? ` (${x.semCobranca} sem cobrança)` : ''}`).join('; '),
      l.frigobarValidade ? l.frigobarValidade.split('-').reverse().join('/') : '',
      [l.avaria ?? '', ...(l.avarias ?? []).map((x) => `${x.quantidade}× ${x.nome} (R$ ${x.valor.toFixed(2).replace('.', ',')})`)].filter(Boolean).join('; '), l.observacao ?? '',
      l.decisao === 'pendente' ? 'Aguardando' : l.decisao === 'limpeza' ? `Voltou p/ limpeza (${l.decididoPor ?? ''})` : l.decisao === 'manutencao' ? `Manutenção (${l.decididoPor ?? ''})` : '',
    ];
    val.forEach((v, i) => { row.getCell(i + 1).value = v; });
    row.getCell(7).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COR[l.resultado] ?? 'FFFFFFFF' } };
    row.alignment = { vertical: 'top', wrapText: true };
    row.height = l.fotos.length ? 72 : 30;
    for (let i = 0; i < l.fotos.length; i++) {
      const f = l.fotos[i];
      const col = fixas.length + i + 1;
      const link = opcoes.linkFoto(f.id);
      const cel = row.getCell(col);
      cel.value = link ? { text: f.local ?? 'foto', hyperlink: link } : (f.local ?? 'foto');
      cel.alignment = { vertical: 'bottom', horizontal: 'center' };
      cel.font = link ? { color: { argb: 'FF0E77DA' }, underline: true, size: 9 } : { size: 9 };
      const img = await opcoes.miniatura(f.id);
      if (img) {
        const imgId = wb.addImage({ buffer: img as unknown as ExcelJS.Buffer, extension: 'jpeg' });
        ws.addImage(imgId, { tl: { col: col - 1 + 0.05, row: r - 1 + 0.05 }, ext: { width: 100, height: 70 } });
      }
    }
    r++;
  }
  if (!linhas.length) ws.getCell(3, 1).value = 'Nenhuma vistoria no período.';
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: fixas.length } };

  const rs = wb.addWorksheet('Resumo');
  const bloco = (titulo: string, lista: typeof resumo.porVistoriadora, inicio: number) => {
    rs.getCell(inicio, 1).value = titulo;
    rs.getCell(inicio, 1).font = { bold: true, size: 12 };
    const h = rs.getRow(inicio + 1);
    ['Nome', 'Vistorias', 'Aprovadas', 'Com ressalva', 'Reprovadas', '% aprovadas'].forEach((t, i) => { h.getCell(i + 1).value = t; });
    h.font = { bold: true };
    lista.forEach((x, i) => {
      const row = rs.getRow(inicio + 2 + i);
      [x.nome, x.total, x.aprovado, x.ressalva, x.reprovado, x.total ? Math.round((x.aprovado / x.total) * 100) / 100 : 0].forEach((v, j) => { row.getCell(j + 1).value = v; });
      row.getCell(6).numFmt = '0%';
    });
    return inicio + lista.length + 4;
  };
  [24, 11, 11, 13, 12, 12].forEach((w, i) => { rs.getColumn(i + 1).width = w; });
  const prox = bloco('Por vistoriadora', resumo.porVistoriadora, 1);
  bloco('Por camareira', resumo.porCamareira, prox);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
