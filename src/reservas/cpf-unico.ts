import { BadRequestException } from '@nestjs/common';

type Q = { query: (sql: string, p?: unknown[]) => Promise<any> };
const br = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10)).split('-').reverse().join('/');

/**
 * Uma pessoa (CPF) não pode ter duas hospedagens ao mesmo tempo: outra reserva com datas que se cruzam
 * ou já hospedada em outro quarto nessas datas. Em outra data pode. CNPJ (empresa) fica livre: reserva vários quartos.
 */
export async function conferirCpfLivre(q: Q, empresaId: string, documento: string | null | undefined, chegada: string, saida: string, ignorarReservaId?: string) {
  const cpf = (documento ?? '').replace(/\D/g, '');
  if (cpf.length !== 11) return;
  const p: unknown[] = [empresaId, cpf, chegada, saida];
  const [r] = await q.query(
    `SELECT r.numero, r.hospede, r.chegada, r.saida, un.codigo FROM reservas r LEFT JOIN unidades un ON un.id = r.unidade_id
      WHERE r.empresa_id = $1 AND regexp_replace(COALESCE(r.documento,''), '\D', '', 'g') = $2 AND r.status IN ('pendente','confirmada','hospedada')
        AND r.chegada < $4 AND r.saida > $3 ${ignorarReservaId ? 'AND r.id <> $5' : ''} LIMIT 1`,
    ignorarReservaId ? [...p, ignorarReservaId] : p);
  if (r) {
    throw new BadRequestException(`Este CPF já tem a reserva nº ${r.numero ?? '—'} (${r.hospede}${r.codigo ? `, quarto ${r.codigo}` : ''}) de ${br(r.chegada)} a ${br(r.saida)}. `
      + 'O mesmo CPF não pode ter duas hospedagens ao mesmo tempo; para outra data, pode.');
  }
  // hospedado agora (entrada sem reserva) com a ficha deste CPF, em datas que se cruzam
  const [e] = await q.query(
    `SELECT un.codigo, e.saida_prevista FROM estadias e JOIN fichas_hospede f ON f.estadia_id = e.id LEFT JOIN unidades un ON un.id = e.unidade_id
      WHERE e.empresa_id = $1 AND e.status IN ('aberta','conta_entregue') AND regexp_replace(COALESCE(f.dados->>'cpf',''), '\D', '', 'g') = $2
        AND (e.entrada_em AT TIME ZONE 'America/Sao_Paulo')::date < $4 AND COALESCE(e.saida_prevista, (now() AT TIME ZONE 'America/Sao_Paulo')::date + 1) > $3 LIMIT 1`, p).catch(() => []);
  if (e) {
    throw new BadRequestException(`Este CPF está hospedado agora no quarto ${e.codigo ?? '—'}${e.saida_prevista ? ` (saída prevista ${br(e.saida_prevista)})` : ''}. `
      + 'O mesmo CPF não pode ter duas hospedagens ao mesmo tempo; para outra data, pode.');
  }
}
