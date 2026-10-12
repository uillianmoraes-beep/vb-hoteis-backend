import { BadRequestException } from '@nestjs/common';

/**
 * Dados fiscais de cada produto/serviço (e do serviço de hospedagem da empresa).
 * Guardados como jsonb e limpos aqui: só entram as chaves conhecidas, com o
 * formato esperado. O emissor (NFC-e / NFS-e) usa isto quando for integrado.
 */
export interface DadosFiscais {
  // produto (NFC-e)
  ncm?: string; // 8 dígitos
  cest?: string; // 7 dígitos
  cfop?: string; // 4 dígitos
  origem?: string; // 0..8
  unidade?: string; // UN, KG, LT…
  cstIcms?: string; // CST (regime normal) ou CSOSN (Simples), 2–3 dígitos
  aliquotaIcms?: number;
  cstPis?: string;
  aliquotaPis?: number;
  cstCofins?: string;
  aliquotaCofins?: number;
  // serviço (NFS-e)
  codigoServico?: string; // item da LC 116, ex.: 09.01
  codigoMunicipal?: string; // código de tributação do município
  cnae?: string;
  aliquotaIss?: number;
  issRetido?: boolean;
  // reforma tributária (IBS / CBS)
  cstIbsCbs?: string; // 3 dígitos
  cClassTrib?: string; // 6 dígitos
  aliquotaIbs?: number;
  aliquotaIbsUf?: number;
  aliquotaIbsMun?: number;
  aliquotaCbs?: number;
  reducaoIbsUf?: number;
  reducaoIbsMun?: number;
  reducaoCbs?: number;
  // ICMS complementos
  aliquotaFcp?: number;
  reducaoBc?: number;
  codBeneficio?: string; // cBenef
  // comum
  observacao?: string;
}

export const DOCUMENTOS_FISCAIS = ['nfce', 'nfe', 'nfs', 'devolucao'] as const;
export type DocumentoFiscal = (typeof DOCUMENTOS_FISCAIS)[number];

/**
 * Tributação que vale para um item: regra padrão do documento → regra do CFOP
 * do item (ou do CFOP padrão) → o que estiver preenchido no próprio item.
 * Campo vazio no produto = usa o da configuração.
 */
export function tributacaoEfetiva(
  item: DadosFiscais,
  regras: { documento: string; cfop: string | null; dados: DadosFiscais; ativo: boolean }[],
  documento: DocumentoFiscal,
): DadosFiscais {
  const doDoc = regras.filter((r) => r.ativo && r.documento === documento);
  const padrao = doDoc.find((r) => !r.cfop)?.dados ?? {};
  const cfop = item.cfop || padrao.cfop;
  const porCfop = cfop ? doDoc.find((r) => r.cfop === cfop)?.dados ?? {} : {};
  const out: Record<string, unknown> = { ...padrao, ...porCfop };
  for (const [k, v] of Object.entries(item)) if (v !== undefined && v !== null && v !== '') out[k] = v;
  if (cfop) out.cfop = cfop;
  return out as DadosFiscais;
}

const DIGITOS: Record<string, [number, number, string]> = {
  ncm: [8, 8, 'NCM tem 8 números'],
  cest: [7, 7, 'CEST tem 7 números'],
  cfop: [4, 4, 'CFOP tem 4 números'],
  origem: [1, 1, 'Origem é um número de 0 a 8'],
  cstIcms: [2, 3, 'CST/CSOSN do ICMS tem 2 ou 3 números'],
  cstPis: [2, 2, 'CST do PIS tem 2 números'],
  cstCofins: [2, 2, 'CST da COFINS tem 2 números'],
  cnae: [7, 7, 'CNAE tem 7 números'],
  cstIbsCbs: [3, 3, 'CST do IBS/CBS tem 3 números'],
  cClassTrib: [6, 6, 'cClassTrib tem 6 números'],
};
const TEXTOS: Record<string, number> = { codBeneficio: 10, unidade: 6, codigoServico: 10, codigoMunicipal: 20, observacao: 300 };
const ALIQUOTAS = [
  'aliquotaIcms', 'aliquotaPis', 'aliquotaCofins', 'aliquotaIss', 'aliquotaIbs', 'aliquotaIbsUf', 'aliquotaIbsMun', 'aliquotaCbs',
  'reducaoIbsUf', 'reducaoIbsMun', 'reducaoCbs', 'aliquotaFcp', 'reducaoBc',
];

export function limparFiscal(bruto: unknown): DadosFiscais {
  if (bruto === null || bruto === undefined) return {};
  if (typeof bruto !== 'object' || Array.isArray(bruto)) throw new BadRequestException('Dados fiscais inválidos.');
  const b = bruto as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, [min, max, msg]] of Object.entries(DIGITOS)) {
    const v = b[k];
    if (v === undefined || v === null || v === '') continue;
    const d = String(v).replace(/\D/g, '');
    if (d.length < min || d.length > max) throw new BadRequestException(`${msg}.`);
    out[k] = d;
  }
  for (const [k, max] of Object.entries(TEXTOS)) {
    const v = b[k];
    if (v === undefined || v === null || v === '') continue;
    out[k] = String(v).trim().slice(0, max);
  }
  for (const k of ALIQUOTAS) {
    const v = b[k];
    if (v === undefined || v === null || v === '') continue;
    const n = Number(String(v).replace(',', '.'));
    if (!Number.isFinite(n) || n < 0 || n > 100) throw new BadRequestException('Alíquota deve ser de 0 a 100%.');
    out[k] = Math.round(n * 10000) / 10000;
  }
  if (b.issRetido !== undefined) out.issRetido = !!b.issRetido;
  return out as DadosFiscais;
}
