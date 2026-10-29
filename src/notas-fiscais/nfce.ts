/**
 * Emissor próprio da NFC-e (modelo 65, leiaute 4.00) direto na SEFAZ do estado (ou na SVRS, que autoriza por vários
 * estados), sem intermediário e sem custo por nota: monta o XML, assina com o A1 da empresa, gera o QR Code
 * (versão 2 com o CSC ou versão 3), manda por SOAP com o certificado e guarda a nota autorizada (nfeProc).
 * Sem internet ou com a SEFAZ fora do ar, emite em contingência (tpEmis 9): o cupom sai na hora e a nota é
 * transmitida sozinha depois (a lei dá 24 horas).
 *
 * Como a Spedy e o emissor da NFS-e, recebe a nota no formato da Focus e devolve no formato da Focus.
 */
import { request, type RequestOptions } from 'https';
import { request as requestHttp } from 'http';
import { createHash, createSign, randomInt } from 'crypto';
import * as QRCode from 'qrcode';
import type { AmbienteFocus, CaminhoFocus, RespostaFocus } from './focus';
import { ErroFocus } from './focus';
import { assinar, type Certificado } from './nacional';
import { UFS_NFCE, type ServicosNfce } from './sefaz-ufs';

type J = Record<string, any>;
const NS = 'http://www.portalfiscal.inf.br/nfe';
const VER_PROC = 'VBHoteis-1.0';
const so = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const esc = (t: unknown) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const el = (nome: string, v: unknown) => (v === undefined || v === null || v === '' ? '' : `<${nome}>${esc(v)}</${nome}>`);
const limpo = (t: unknown, max: number) => String(t ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const n2 = (v: unknown) => (Math.round(Number(v ?? 0) * 100) / 100).toFixed(2);
const n4 = (v: unknown) => (Math.round(Number(v ?? 0) * 10000) / 10000).toFixed(4);
const n10 = (v: unknown) => { const x = Number(v ?? 0); return Number.isInteger(x * 100) ? x.toFixed(2) : x.toFixed(10).replace(/0+$/, '').replace(/\.$/, '.00'); };
/** valor de uma tag simples (a primeira) */
export const tagX = (xml: string, nome: string) => xml.match(new RegExp(`<(?:\\w+:)?${nome}[^>]*>([^<]*)</(?:\\w+:)?${nome}>`))?.[1] ?? null;
const bloco = (xml: string, nome: string) => xml.match(new RegExp(`<(?:\\w+:)?${nome}[\\s>][\\s\\S]*?</(?:\\w+:)?${nome}>`))?.[0] ?? null;

/* ------------------------------------------------------------ emitente */

/** dados do estabelecimento que vão na NFC-e (Configuração fiscal › Emissor de notas) */
export interface EmitenteNfce {
  cnpj: string; razao: string; fantasia?: string; ie: string; crt: 1 | 3 | 4;
  logradouro: string; numero: string; complemento?: string; bairro: string; cMun: string; municipio: string; uf: string; cep: string; fone?: string;
}
export interface CscNfce { id: string; token: string }

/** confere os dados do emitente antes de mandar (a SEFAZ recusaria) */
export function conferirEmitente(e: Partial<EmitenteNfce>) {
  const falta: string[] = [];
  if (so(e.cnpj).length !== 14) falta.push('CNPJ');
  if (!e.razao) falta.push('razão social');
  if (!so(e.ie)) falta.push('inscrição estadual');
  if (!e.logradouro || !e.numero || !e.bairro) falta.push('endereço (rua, número e bairro)');
  if (so(e.cMun).length !== 7 || !e.municipio) falta.push('cidade (código IBGE e nome)');
  if (!e.uf || !UFS_NFCE[e.uf]) falta.push('UF');
  if (so(e.cep).length !== 8) falta.push('CEP');
  if (falta.length) throw new ErroFocus(`Para a NFC-e própria faltam no emissor: ${falta.join(', ')} (Configuração fiscal › Emissor de notas).`);
}

/* --------------------------------------------------------------- chave */

/** dígito da chave (módulo 11, pesos 2 a 9) */
export function dvChave(c43: string) {
  let soma = 0, peso = 2;
  for (let i = c43.length - 1; i >= 0; i--) { soma += Number(c43[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const r = soma % 11;
  return r < 2 ? 0 : 11 - r;
}

/** chave de 44: cUF + AAMM + CNPJ + modelo + série + número + tpEmis + cNF + dígito */
export function chaveNfce(cUF: number, aamm: string, cnpj: string, serie: number, numero: number, tpEmis: number, cNF: string) {
  const c43 = `${cUF}${aamm}${so(cnpj).padStart(14, '0')}65${String(serie).padStart(3, '0')}${String(numero).padStart(9, '0')}${tpEmis}${cNF}`;
  return `${c43}${dvChave(c43)}`;
}

/* ----------------------------------------------------------------- XML */

const TPAG_OK = ['01', '02', '03', '04', '05', '10', '11', '12', '13', '15', '16', '17', '18', '19', '20', '21', '22', '90', '91', '99'];

/** grupo do ICMS pelo CST/CSOSN do item (formato da Focus) */
function icms(i: J) {
  const cst = String(i.icms_situacao_tributaria ?? '').trim();
  const orig = el('orig', i.icms_origem ?? 0);
  if (cst.length === 3) {
    if (cst === '101') return `<ICMSSN101>${orig}${el('CSOSN', cst)}${el('pCredSN', n4(i.icms_aliquota_credito_simples ?? 0))}${el('vCredICMSSN', n2(i.icms_valor_credito_simples ?? 0))}</ICMSSN101>`;
    if (['102', '103', '300', '400'].includes(cst)) return `<ICMSSN102>${orig}${el('CSOSN', cst)}</ICMSSN102>`;
    if (cst === '500') return `<ICMSSN500>${orig}${el('CSOSN', cst)}</ICMSSN500>`;
    if (cst === '900') return `<ICMSSN900>${orig}${el('CSOSN', cst)}</ICMSSN900>`;
    throw new ErroFocus(`CSOSN ${cst} (${i.descricao}) ainda não é aceito pela NFC-e própria; use 102, 103, 300, 400, 500 ou 900.`);
  }
  if (cst === '00') return `<ICMS00>${orig}${el('CST', '00')}${el('modBC', i.icms_modalidade_base_calculo ?? 3)}${el('vBC', n2(i.icms_base_calculo))}${el('pICMS', n4(i.icms_aliquota))}${el('vICMS', n2(i.icms_valor))}</ICMS00>`;
  if (cst === '20') return `<ICMS20>${orig}${el('CST', '20')}${el('modBC', i.icms_modalidade_base_calculo ?? 3)}${el('pRedBC', n4(i.icms_reducao_base_calculo ?? 0))}${el('vBC', n2(i.icms_base_calculo))}${el('pICMS', n4(i.icms_aliquota))}${el('vICMS', n2(i.icms_valor))}</ICMS20>`;
  if (['40', '41', '50'].includes(cst)) return `<ICMS40>${orig}${el('CST', cst)}</ICMS40>`;
  if (cst === '60') return `<ICMS60>${orig}${el('CST', '60')}</ICMS60>`;
  if (cst === '90') return `<ICMS90>${orig}${el('CST', '90')}</ICMS90>`;
  throw new ErroFocus(`CST do ICMS ${cst || '(vazio)'} (${i.descricao}) ainda não é aceito pela NFC-e própria.`);
}

/** PIS ou COFINS pelo CST */
function pisCofins(grupo: 'PIS' | 'COFINS', cst: string, base?: unknown, aliq?: unknown, valor?: unknown) {
  const c = String(cst || '49').padStart(2, '0');
  const p = grupo === 'PIS' ? 'PIS' : 'COFINS';
  if (['01', '02'].includes(c)) return `<${grupo}><${p}Aliq>${el('CST', c)}${el('vBC', n2(base))}${el(`p${p}`, n4(aliq))}${el(`v${p}`, n2(valor))}</${p}Aliq></${grupo}>`;
  if (['04', '05', '06', '07', '08', '09'].includes(c)) return `<${grupo}><${p}NT>${el('CST', c)}</${p}NT></${grupo}>`;
  return `<${grupo}><${p}Outr>${el('CST', c)}${el('vBC', n2(base ?? 0))}${el(`p${p}`, n4(aliq ?? 0))}${el(`v${p}`, n2(valor ?? 0))}</${p}Outr></${grupo}>`;
}

export interface OpcoesNfce { tpAmb: 1 | 2; serie: number; numero: number; tpEmis: 1 | 9; cNF?: string; xJust?: string; dhCont?: string }

/** data e hora de Brasília com o fuso, 1 minuto atrás (a SEFAZ recusa horário no futuro) */
export function agoraBrasilia(menosSeg = 60) {
  const d = new Date(Date.now() - 3 * 3600_000 - menosSeg * 1000);
  return `${d.toISOString().slice(0, 19)}-03:00`;
}

/** monta o XML da NFC-e (sem assinatura) a partir da nota no formato da Focus */
export function montarNfce(c: J, emit: EmitenteNfce, o: OpcoesNfce) {
  const uf = UFS_NFCE[emit.uf];
  if (!uf) throw new ErroFocus(`UF ${emit.uf} sem endereço da SEFAZ cadastrado.`);
  const dhEmi = agoraBrasilia();
  const aamm = dhEmi.slice(2, 4) + dhEmi.slice(5, 7);
  let cNF = o.cNF ?? String(randomInt(10_000_000, 99_999_999));
  if (cNF === String(o.numero).padStart(8, '0')) cNF = String((Number(cNF) + 1) % 100_000_000).padStart(8, '0');
  const chave = chaveNfce(uf.cUF, aamm, emit.cnpj, o.serie, o.numero, o.tpEmis, cNF);
  const itens = (c.items ?? []) as J[];
  if (!itens.length) throw new ErroFocus('A NFC-e precisa de pelo menos um item.');
  let vProd = 0, vDesc = 0, vOutro = 0, vBC = 0, vICMS = 0, vPIS = 0, vCOFINS = 0;
  const dets = itens.map((i, k) => {
    const gtin = so(i.codigo_barras_comercial);
    const ean = [8, 12, 13, 14].includes(gtin.length) ? gtin : 'SEM GTIN';
    vProd += Number(i.valor_bruto ?? 0); vDesc += Number(i.valor_desconto ?? 0); vOutro += Number(i.valor_outras_despesas ?? 0);
    if (['00', '20'].includes(String(i.icms_situacao_tributaria))) { vBC += Number(i.icms_base_calculo ?? 0); vICMS += Number(i.icms_valor ?? 0); }
    vPIS += Number(i.pis_valor ?? 0); vCOFINS += Number(i.cofins_valor ?? 0);
    const prod =
      el('cProd', limpo(i.codigo_produto, 60)) + el('cEAN', ean) + el('xProd', o.tpAmb === 2 && k === 0 ? 'NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL' : limpo(i.descricao, 120)) +
      el('NCM', so(i.codigo_ncm) || '00000000') + el('CEST', so(i.cest) || '') + el('cBenef', i.codigo_beneficio_fiscal) +
      el('CFOP', so(i.cfop)) + el('uCom', limpo(i.unidade_comercial || 'UN', 6)) + el('qCom', n4(i.quantidade_comercial)) +
      el('vUnCom', n10(i.valor_unitario_comercial)) + el('vProd', n2(i.valor_bruto)) + el('cEANTrib', ean) +
      el('uTrib', limpo(i.unidade_tributavel || i.unidade_comercial || 'UN', 6)) + el('qTrib', n4(i.quantidade_tributavel ?? i.quantidade_comercial)) +
      el('vUnTrib', n10(i.valor_unitario_tributavel ?? i.valor_unitario_comercial)) +
      (Number(i.valor_desconto) > 0 ? el('vDesc', n2(i.valor_desconto)) : '') + (Number(i.valor_outras_despesas) > 0 ? el('vOutro', n2(i.valor_outras_despesas)) : '') +
      el('indTot', 1);
    const imposto = `<imposto><ICMS>${icms(i)}</ICMS>${pisCofins('PIS', i.pis_situacao_tributaria, i.pis_base_calculo, i.pis_aliquota_porcentual, i.pis_valor)}${pisCofins('COFINS', i.cofins_situacao_tributaria, i.cofins_base_calculo, i.cofins_aliquota_porcentual, i.cofins_valor)}</imposto>`;
    return `<det nItem="${k + 1}"><prod>${prod}</prod>${imposto}</det>`;
  }).join('');
  const vNF = vProd - vDesc + vOutro;
  const doc = so(c.cpf_destinatario || c.cnpj_destinatario);
  const dest = doc ? `<dest>${doc.length === 11 ? el('CPF', doc) : el('CNPJ', doc)}${c.nome_destinatario ? el('xNome', o.tpAmb === 2 ? 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL' : limpo(c.nome_destinatario, 60)) : ''}${el('indIEDest', 9)}</dest>` : '';
  // pagamentos (a soma tem que bater com o total da nota)
  const formas = ((c.formas_pagamento ?? []) as J[]).filter((p) => Number(p.valor_pagamento) > 0 || p.forma_pagamento === '90');
  const pags = (formas.length ? formas : [{ forma_pagamento: '90', valor_pagamento: 0 }]).map((p) => {
    const t = TPAG_OK.includes(String(p.forma_pagamento)) ? String(p.forma_pagamento) : '99';
    const card = ['03', '04', '17'].includes(t) ? `<card>${el('tpIntegra', String(p.tipo_integracao ?? '2') === '1' ? 1 : 2)}</card>` : '';
    return `<detPag>${el('tPag', t)}${t === '99' ? el('xPag', limpo(p.descricao_pagamento || 'Outros', 60)) : ''}${el('vPag', n2(t === '90' ? 0 : p.valor_pagamento))}${card}</detPag>`;
  }).join('');
  const resp = process.env.VB_RESP_TEC_CNPJ && process.env.VB_RESP_TEC_EMAIL && process.env.VB_RESP_TEC_FONE
    ? `<infRespTec>${el('CNPJ', so(process.env.VB_RESP_TEC_CNPJ))}${el('xContato', limpo(process.env.VB_RESP_TEC_CONTATO || 'Virtual Barra', 60))}${el('email', process.env.VB_RESP_TEC_EMAIL)}${el('fone', so(process.env.VB_RESP_TEC_FONE))}</infRespTec>` : '';
  const ide =
    el('cUF', uf.cUF) + el('cNF', cNF) + el('natOp', limpo(c.natureza_operacao || 'VENDA AO CONSUMIDOR', 60)) + el('mod', 65) + el('serie', o.serie) + el('nNF', o.numero) +
    el('dhEmi', dhEmi) + el('tpNF', 1) + el('idDest', 1) + el('cMunFG', so(emit.cMun)) + el('tpImp', 4) + el('tpEmis', o.tpEmis) + el('cDV', chave.slice(-1)) +
    el('tpAmb', o.tpAmb) + el('finNFe', 1) + el('indFinal', 1) + el('indPres', String(c.presenca_comprador ?? '1') === '4' ? 4 : 1) + el('procEmi', 0) + el('verProc', VER_PROC) +
    (o.tpEmis === 9 ? el('dhCont', o.dhCont ?? dhEmi) + el('xJust', limpo(o.xJust || 'Sem comunicacao com a SEFAZ no momento da venda', 256)) : '');
  const ender =
    el('xLgr', limpo(emit.logradouro, 60)) + el('nro', limpo(emit.numero, 60)) + el('xCpl', emit.complemento ? limpo(emit.complemento, 60) : '') + el('xBairro', limpo(emit.bairro, 60)) +
    el('cMun', so(emit.cMun)) + el('xMun', limpo(emit.municipio, 60)) + el('UF', emit.uf) + el('CEP', so(emit.cep)) + el('cPais', 1058) + el('xPais', 'BRASIL') + el('fone', so(emit.fone) || '');
  const emitXml = `<emit>${el('CNPJ', so(emit.cnpj))}${el('xNome', limpo(emit.razao, 60))}${el('xFant', emit.fantasia ? limpo(emit.fantasia, 60) : '')}<enderEmit>${ender}</enderEmit>${el('IE', so(emit.ie))}${el('CRT', emit.crt)}</emit>`;
  const tot = `<total><ICMSTot>${el('vBC', n2(vBC))}${el('vICMS', n2(vICMS))}${el('vICMSDeson', '0.00')}${el('vFCP', '0.00')}${el('vBCST', '0.00')}${el('vST', '0.00')}${el('vFCPST', '0.00')}${el('vFCPSTRet', '0.00')}${el('vProd', n2(vProd))}${el('vFrete', '0.00')}${el('vSeg', '0.00')}${el('vDesc', n2(vDesc))}${el('vII', '0.00')}${el('vIPI', '0.00')}${el('vIPIDevol', '0.00')}${el('vPIS', n2(vPIS))}${el('vCOFINS', n2(vCOFINS))}${el('vOutro', n2(vOutro))}${el('vNF', n2(vNF))}</ICMSTot></total>`;
  const infCpl = c.informacoes_adicionais_contribuinte ? `<infAdic>${el('infCpl', limpo(c.informacoes_adicionais_contribuinte, 5000))}</infAdic>` : '';
  const inf = `<infNFe versao="4.00" Id="NFe${chave}"><ide>${ide}</ide>${emitXml}${dest}${dets}${tot}<transp>${el('modFrete', 9)}</transp><pag>${pags}</pag>${infCpl}${resp}</infNFe>`;
  return { chave, cNF, dhEmi, vNF, xml: `<NFe xmlns="${NS}">${inf}</NFe>` };
}

/* -------------------------------------------------------------- QR Code */

/** conteúdo do QR Code: versão 2 (com o CSC) ou 3 (online sem CSC; contingência assinada com o certificado) */
export function textoQr(a: { chave: string; url: string; versao: string; tpAmb: 1 | 2; tpEmis: number; dhEmi: string; vNF: number; digest: string; dest: string; csc?: CscNfce; cert: Certificado }) {
  const url = a.url.includes('?p=') ? a.url : `${a.url}?p=`;
  if (a.versao === '300') {
    if (a.tpEmis !== 9) return `${url}${a.chave}|3|${a.tpAmb}`;
    const tpDest = a.dest.length === 14 ? '1' : a.dest.length === 11 ? '2' : '';
    const seq = `${a.chave}|3|${a.tpAmb}|${a.dhEmi.slice(8, 10)}|${n2(a.vNF)}|${tpDest}|${a.dest}`;
    const ass = createSign('RSA-SHA1').update(seq).sign(a.cert.chavePem, 'base64');
    return `${url}${seq}|${ass}`;
  }
  if (!a.csc?.id || !a.csc?.token) throw new ErroFocus('Falta o CSC da NFC-e (código e número do token) no emissor: a SEFAZ do estado fornece.');
  const id = String(Number(so(a.csc.id)));
  const seq = a.tpEmis !== 9
    ? `${a.chave}|2|${a.tpAmb}|${id}`
    : `${a.chave}|2|${a.tpAmb}|${a.dhEmi.slice(8, 10)}|${n2(a.vNF)}|${Buffer.from(a.digest, 'utf8').toString('hex')}|${id}`;
  const hash = createHash('sha1').update(seq + a.csc.token).digest('hex').toUpperCase();
  return `${url}${seq}|${hash}`;
}

/** assina e põe o QR Code: devolve o XML pronto para mandar */
export function fecharNfce(xml: string, m: { chave: string; dhEmi: string; vNF: number; tpEmis: number }, tpAmb: 1 | 2, uf: string, cert: Certificado, csc?: CscNfce, dest = '') {
  const assinado = assinar(xml, 'infNFe', cert);
  const s: ServicosNfce = UFS_NFCE[uf][tpAmb === 1 ? 'producao' : 'homologacao'];
  if (!s.qr) throw new ErroFocus(`Sem o endereço do QR Code da SEFAZ-${uf}.`);
  const digest = tagX(assinado, 'DigestValue') ?? '';
  const qr = textoQr({ chave: m.chave, url: s.qr, versao: s.qrVersao ?? '200', tpAmb, tpEmis: m.tpEmis, dhEmi: m.dhEmi, vNF: m.vNF, digest, dest, csc, cert });
  const supl = `<infNFeSupl><qrCode>${esc(qr)}</qrCode><urlChave>${esc(s.urlChave ?? '')}</urlChave></infNFeSupl>`;
  return { xml: assinado.replace('<Signature', `${supl}<Signature`), qr };
}

/* ---------------------------------------------------------------- SOAP */

const ACAO: Record<string, string> = {
  NfeAutorizacao: 'NFeAutorizacao4', NfeRetAutorizacao: 'NFeRetAutorizacao4', NfeConsultaProtocolo: 'NFeConsultaProtocolo4',
  RecepcaoEvento: 'NFeRecepcaoEvento4', NfeStatusServico: 'NFeStatusServico4', NfeInutilizacao: 'NFeInutilizacao4',
};
/** SEFAZ_URL_TESTE: manda tudo para um endereço só (SEFAZ de mentira nos testes) */
const urlServico = (s: ServicosNfce, servico: keyof typeof ACAO) => process.env.SEFAZ_URL_TESTE ? `${process.env.SEFAZ_URL_TESTE}/${servico}` : s[servico as keyof ServicosNfce];

export class ErroConexaoSefaz extends Error {}

/** chama um serviço da SEFAZ (SOAP 1.2, com o certificado) e devolve o XML da resposta */
export function soap(cert: Certificado, url: string, servico: keyof typeof ACAO, dados: string): Promise<string> {
  const ns = `http://www.portalfiscal.inf.br/nfe/wsdl/${ACAO[servico]}`;
  const corpo = Buffer.from(`<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><nfeDadosMsg xmlns="${ns}">${dados}</nfeDadosMsg></soap12:Body></soap12:Envelope>`, 'utf8');
  const u = new URL(url);
  const fazer = u.protocol === 'http:' ? requestHttp : request;
  return new Promise((ok, falha) => {
    const opcoes: RequestOptions = {
      method: 'POST', key: cert.chavePem, cert: cert.certPem, timeout: 30_000,
      headers: { 'Content-Type': `application/soap+xml; charset=utf-8; action="${ns}"`, 'Content-Length': corpo.length },
    };
    const req = fazer(u, opcoes, (res) => {
      const partes: Buffer[] = [];
      res.on('data', (p) => partes.push(p));
      res.on('end', () => {
        const txt = Buffer.concat(partes).toString('utf8');
        if ((res.statusCode ?? 0) >= 500 && !/<cStat>/.test(txt)) return falha(new ErroConexaoSefaz(`SEFAZ respondeu erro ${res.statusCode}`));
        ok(txt);
      });
    });
    req.on('timeout', () => req.destroy(new ErroConexaoSefaz('tempo esgotado')));
    req.on('error', (e) => falha(e instanceof ErroConexaoSefaz ? e : new ErroConexaoSefaz(e.message)));
    req.write(corpo);
    req.end();
  });
}

/** cStat de "SEFAZ fora do ar / sem condições": a nota vai para a contingência */
const FORA_DO_AR = ['108', '109'];

/* ------------------------------------------------------------- cliente */

export interface NotaGuardadaNfce { resposta: J | null; envio: J | null }

export class SefazNfce {
  readonly tpAmb: 1 | 2;
  constructor(
    private readonly cert: Certificado,
    readonly ambiente: AmbienteFocus,
    private readonly emit: EmitenteNfce,
    private readonly csc: CscNfce | undefined,
    private readonly arquivoDe: (caminho: string) => string | null,
    private readonly lerNota: (ref: string) => Promise<NotaGuardadaNfce | null>,
  ) {
    this.tpAmb = ambiente === 'producao' ? 1 : 2;
  }

  private get servicos() { return UFS_NFCE[this.emit.uf][this.ambiente]; }

  /** confere certificado, dados e se a SEFAZ está no ar */
  async testar() {
    conferirEmitente(this.emit);
    if (this.cert.validade.getTime() < Date.now()) throw new ErroFocus(`O certificado venceu em ${this.cert.validade.toLocaleDateString('pt-BR')}.`);
    if (this.servicos.qrVersao !== '300' && (!this.csc?.id || !this.csc?.token)) throw new ErroFocus('Falta o CSC da NFC-e (número do token e código) no emissor.');
    const uf = UFS_NFCE[this.emit.uf];
    const dados = `<consStatServ xmlns="${NS}" versao="4.00">${el('tpAmb', this.tpAmb)}${el('cUF', uf.cUF)}${el('xServ', 'STATUS')}</consStatServ>`;
    let r: string;
    try { r = await soap(this.cert, urlServico(this.servicos, 'NfeStatusServico')!, 'NfeStatusServico', dados); }
    catch (e) { throw new ErroFocus(`Não consegui falar com a SEFAZ (${uf.autorizador}): ${(e as Error).message}.`); }
    const st = tagX(r, 'cStat');
    if (st !== '107') throw new ErroFocus(`SEFAZ (${uf.autorizador}): ${st ?? '?'} ${tagX(r, 'xMotivo') ?? 'sem resposta'}`);
    return `SEFAZ ${uf.autorizador} em operação (${this.ambiente === 'producao' ? 'produção' : 'homologação'}).`;
  }

  /** nota autorizada (nfeProc) no jeito da Focus */
  private traduzirAutorizada(nfe: string, prot: string, m: { chave: string; numero: number; serie: number; qr: string; contingencia: boolean }): RespostaFocus {
    const nfeProc = `<nfeProc xmlns="${NS}" versao="4.00">${nfe.replace(/^<\?xml[^>]*\?>/, '')}${prot}</nfeProc>`;
    return {
      status: 'autorizado', mensagem_sefaz: `${tagX(prot, 'xMotivo') ?? 'Autorizado o uso da NFC-e'}${m.contingencia ? ' (emitida em contingência e transmitida)' : ''}`,
      numero: m.numero, serie: m.serie, chave_nfe: m.chave, protocolo: tagX(prot, 'nProt') ?? undefined,
      caminho_xml_nota_fiscal: `nacional:${m.chave}/xml`, caminho_danfe: `nacional:${m.chave}/pdf`, url_consulta_nf: m.qr,
      nfe_xml: nfeProc, contingencia_pendente: false,
    };
  }

  /** manda o XML assinado; devolve a resposta no jeito da Focus (ou lança ErroConexaoSefaz) */
  private async transmitir(xml: string, m: { chave: string; numero: number; serie: number; qr: string; contingencia: boolean }): Promise<RespostaFocus> {
    const nfe = xml.replace(/^<\?xml[^>]*\?>/, '');
    const dados = `<enviNFe xmlns="${NS}" versao="4.00">${el('idLote', String(Date.now()).slice(-15))}${el('indSinc', 1)}${nfe}</enviNFe>`;
    const r = await soap(this.cert, urlServico(this.servicos, 'NfeAutorizacao')!, 'NfeAutorizacao', dados);
    const stLote = tagX(r, 'cStat');
    if (stLote && FORA_DO_AR.includes(stLote)) throw new ErroConexaoSefaz(tagX(r, 'xMotivo') ?? 'SEFAZ fora do ar');
    const prot = bloco(r, 'protNFe');
    if (stLote === '103') return { status: 'processando_autorizacao', mensagem: 'Lote recebido pela SEFAZ; aguardando o resultado.', chave_nfe: m.chave, numero: m.numero, serie: m.serie, recibo: tagX(r, 'nRec') ?? undefined, xml_assinado: xml, url_consulta_nf: m.qr };
    const st = prot ? tagX(prot, 'cStat') : stLote;
    if (st === '100' || st === '150') return this.traduzirAutorizada(nfe, prot!, m);
    // duplicidade: a nota já foi autorizada antes (ex.: resposta perdida) → consulta e guarda
    if (st === '204' || st === '539') {
      const c = await this.consultaChave(m.chave);
      if (c.prot) return this.traduzirAutorizada(nfe, c.prot, m);
    }
    const motivo = `${st ?? stLote}: ${(prot ? tagX(prot, 'xMotivo') : null) ?? tagX(r, 'xMotivo') ?? 'recusada'}`;
    return { status: 'erro_autorizacao', mensagem: `SEFAZ: ${motivo}`, chave_nfe: m.chave, numero: m.numero, serie: m.serie, xml_assinado: xml };
  }

  private async consultaChave(chave: string) {
    const dados = `<consSitNFe xmlns="${NS}" versao="4.00">${el('tpAmb', this.tpAmb)}${el('xServ', 'CONSULTAR')}${el('chNFe', chave)}</consSitNFe>`;
    const r = await soap(this.cert, urlServico(this.servicos, 'NfeConsultaProtocolo')!, 'NfeConsultaProtocolo', dados);
    const prot = bloco(r, 'protNFe');
    const evCanc = /<tpEvento>110111<\/tpEvento>[\s\S]*?<cStat>(135|155)<\/cStat>/.test(r);
    return { cStat: tagX(r, 'cStat'), xMotivo: tagX(r, 'xMotivo'), prot: prot && ['100', '150'].includes(tagX(prot, 'cStat') ?? '') ? prot : null, cancelada: evCanc || tagX(r, 'cStat') === '101' };
  }

  async emitir(tipo: CaminhoFocus, _ref: string, corpo: unknown): Promise<{ status: number; json: RespostaFocus }> {
    if (tipo !== 'nfce') throw new ErroFocus('O emissor próprio da SEFAZ faz só a NFC-e por enquanto.');
    conferirEmitente(this.emit);
    const c = corpo as J;
    const serie = Number(c.serie ?? 1), numero = Number(c.numero);
    if (!numero) throw new ErroFocus('Sem o número da NFC-e (série e próximo número no emissor).');
    const dest = so(c.cpf_destinatario || c.cnpj_destinatario);
    const m1 = montarNfce(c, this.emit, { tpAmb: this.tpAmb, serie, numero, tpEmis: 1 });
    const f1 = fecharNfce(m1.xml, { ...m1, tpEmis: 1 }, this.tpAmb, this.emit.uf, this.cert, this.csc, dest);
    try {
      return { status: 200, json: await this.transmitir(f1.xml, { chave: m1.chave, numero, serie, qr: f1.qr, contingencia: false }) };
    } catch (e) {
      if (!(e instanceof ErroConexaoSefaz)) throw e;
      // sem internet ou SEFAZ fora: contingência off-line (outra chave, tpEmis 9); o cupom sai agora e a nota vai depois
      const m9 = montarNfce(c, this.emit, { tpAmb: this.tpAmb, serie, numero, tpEmis: 9, cNF: m1.cNF, xJust: `Sem comunicacao com a SEFAZ: ${e.message}`.slice(0, 256) });
      const f9 = fecharNfce(m9.xml, { ...m9, tpEmis: 9 }, this.tpAmb, this.emit.uf, this.cert, this.csc, dest);
      return {
        status: 200, json: {
          status: 'autorizado', mensagem_sefaz: 'Emitida em CONTINGÊNCIA (SEFAZ ou internet fora do ar): o cupom vale e a nota é transmitida sozinha quando voltar.',
          numero, serie, chave_nfe: m9.chave, url_consulta_nf: f9.qr, caminho_xml_nota_fiscal: `nacional:${m9.chave}/xml`, caminho_danfe: `nacional:${m9.chave}/pdf`,
          nfe_xml: f9.xml, xml_assinado: f9.xml, contingencia_pendente: true, contingencia_desde: new Date().toISOString(),
        },
      };
    }
  }

  /** nota em contingência: tenta transmitir (chamado de tempos em tempos) */
  async transmitirPendente(ref: string): Promise<RespostaFocus | null> {
    const n = await this.lerNota(ref);
    const r = (n?.resposta ?? {}) as J;
    if (!r.contingencia_pendente || !r.xml_assinado) return null;
    const m = { chave: r.chave_nfe, numero: Number(r.numero), serie: Number(r.serie), qr: r.url_consulta_nf, contingencia: true };
    try {
      const t = await this.transmitir(r.xml_assinado, m);
      if (t.status === 'autorizado') return t;
      // recusada depois de entregue ao cliente: avisa (o contador precisa ver)
      return { ...r, status: 'erro_autorizacao', mensagem: `Contingência recusada pela SEFAZ: ${t.mensagem ?? ''}`, contingencia_pendente: false };
    } catch (e) {
      if (e instanceof ErroConexaoSefaz) return null; // ainda fora do ar
      throw e;
    }
  }

  async consultar(_tipo: CaminhoFocus, ref: string): Promise<{ status: number; json: RespostaFocus }> {
    const n = await this.lerNota(ref);
    const r = (n?.resposta ?? {}) as J;
    if (r.contingencia_pendente) {
      const t = await this.transmitirPendente(ref).catch(() => null);
      return { status: 200, json: t ?? r };
    }
    if (!r.chave_nfe) return { status: 404, json: {} };
    let c: Awaited<ReturnType<SefazNfce['consultaChave']>>;
    try { c = await this.consultaChave(r.chave_nfe); } catch { return { status: 200, json: r }; }
    if (c.cancelada) return { status: 200, json: { ...r, status: 'cancelado' } };
    if (c.prot && r.status !== 'autorizado' && r.xml_assinado) {
      return { status: 200, json: this.traduzirAutorizada(r.xml_assinado, c.prot, { chave: r.chave_nfe, numero: Number(r.numero), serie: Number(r.serie), qr: r.url_consulta_nf, contingencia: false }) };
    }
    if (r.status === 'processando_autorizacao' && c.cStat === '217') return { status: 200, json: { ...r, status: 'erro_autorizacao', mensagem: 'A SEFAZ não recebeu esta nota.' } };
    return { status: 200, json: r };
  }

  /** cancelamento: evento 110111 (prazo da NFC-e: 30 minutos na maioria dos estados) */
  async cancelar(_tipo: CaminhoFocus, ref: string, justificativa: string): Promise<{ status: number; json: RespostaFocus }> {
    const n = await this.lerNota(ref);
    const r = (n?.resposta ?? {}) as J;
    if (r.contingencia_pendente) throw new ErroFocus('Esta NFC-e ainda está em contingência (não transmitida): espere a SEFAZ voltar para cancelar.');
    if (!r.chave_nfe || !r.protocolo) throw new ErroFocus('Esta nota não tem o protocolo de autorização da SEFAZ.');
    const uf = UFS_NFCE[this.emit.uf];
    const id = `ID110111${r.chave_nfe}01`;
    const inf = `<infEvento Id="${id}">${el('cOrgao', uf.cUF)}${el('tpAmb', this.tpAmb)}${el('CNPJ', so(this.emit.cnpj))}${el('chNFe', r.chave_nfe)}${el('dhEvento', agoraBrasilia(30))}${el('tpEvento', '110111')}${el('nSeqEvento', 1)}${el('verEvento', '1.00')}<detEvento versao="1.00">${el('descEvento', 'Cancelamento')}${el('nProt', r.protocolo)}${el('xJust', limpo(justificativa, 255))}</detEvento></infEvento>`;
    const assinado = assinar(`<evento xmlns="${NS}" versao="1.00">${inf}</evento>`, 'infEvento', this.cert);
    const dados = `<envEvento xmlns="${NS}" versao="1.00">${el('idLote', String(Date.now()).slice(-15))}${assinado}</envEvento>`;
    let resp: string;
    try { resp = await soap(this.cert, urlServico(this.servicos, 'RecepcaoEvento')!, 'RecepcaoEvento', dados); }
    catch (e) { throw new ErroFocus(`Não consegui falar com a SEFAZ para cancelar: ${(e as Error).message}. Tente de novo.`); }
    const ret = bloco(resp, 'retEvento') ?? resp;
    const st = tagX(ret, 'cStat');
    if (st === '135' || st === '155') {
      return { status: 200, json: { ...r, status: 'cancelado', mensagem_sefaz: tagX(ret, 'xMotivo') ?? 'Cancelamento homologado', evento_cancelamento: `<procEventoNFe xmlns="${NS}" versao="1.00">${assinado}${ret}</procEventoNFe>` } };
    }
    throw new ErroFocus(`Cancelamento recusado pela SEFAZ: ${st ?? '?'} ${tagX(ret, 'xMotivo') ?? ''}`);
  }

  async cartaCorrecao(): Promise<{ status: number; json: RespostaFocus }> {
    throw new ErroFocus('A NFC-e não tem carta de correção: cancele (no prazo) e emita de novo.');
  }

  arquivo(caminho: string | undefined | null) {
    if (!caminho) return null;
    return caminho.startsWith('nacional:') ? this.arquivoDe(caminho) : caminho;
  }
}

/* -------------------------------------------------------- cupom (DANFE) */

const brl = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const PAG: Record<string, string> = { '01': 'Dinheiro', '02': 'Cheque', '03': 'Cartão de crédito', '04': 'Cartão de débito', '05': 'Crédito loja', '10': 'Vale alimentação', '11': 'Vale refeição', '12': 'Vale presente', '15': 'Boleto', '16': 'Depósito', '17': 'Pix', '18': 'Transferência', '90': 'Sem pagamento', '99': 'Outros' };

/** cupom da NFC-e (DANFE NFC-e) em 80 mm, para imprimir, com o QR Code */
export async function danfceHtml(xml: string) {
  const inf = bloco(xml, 'infNFe') ?? xml;
  const emit = bloco(inf, 'emit') ?? '';
  const ender = bloco(emit, 'enderEmit') ?? '';
  const ide = bloco(inf, 'ide') ?? '';
  const chave = xml.match(/Id="NFe(\d{44})"/)?.[1] ?? '';
  const qr = (tagX(xml, 'qrCode') ?? '').replace(/&amp;/g, '&');
  const prot = bloco(xml, 'infProt');
  const tpAmb = tagX(ide, 'tpAmb');
  const tpEmis = tagX(ide, 'tpEmis');
  const img = qr ? await QRCode.toDataURL(qr, { margin: 1, width: 220 }) : '';
  const itens = [...inf.matchAll(/<det nItem="(\d+)">([\s\S]*?)<\/det>/g)].map((m) => {
    const p = bloco(m[2], 'prod') ?? '';
    return `<tr><td>${esc(tagX(p, 'cProd'))}</td><td>${esc(tagX(p, 'xProd'))}<br><small>${Number(tagX(p, 'qCom')).toLocaleString('pt-BR')} ${esc(tagX(p, 'uCom'))} x ${brl(tagX(p, 'vUnCom'))}</small></td><td class="d">${brl(tagX(p, 'vProd'))}</td></tr>`;
  }).join('');
  const tot = bloco(inf, 'ICMSTot') ?? '';
  const pags = [...inf.matchAll(/<detPag>([\s\S]*?)<\/detPag>/g)].map((m) => `<tr><td>${esc(PAG[tagX(m[1], 'tPag') ?? ''] ?? tagX(m[1], 'xPag') ?? 'Outros')}</td><td class="d">${brl(tagX(m[1], 'vPag'))}</td></tr>`).join('');
  const dest = bloco(inf, 'dest');
  const docDest = dest ? (tagX(dest, 'CPF') ?? tagX(dest, 'CNPJ')) : null;
  const ch = chave.replace(/(\d{4})/g, '$1 ').trim();
  const dh = (tagX(ide, 'dhEmi') ?? '').replace('T', ' ').slice(0, 19);
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>NFC-e ${esc(tagX(ide, 'nNF'))}</title>
<style>@page{size:80mm auto;margin:3mm}body{font-family:Arial,sans-serif;width:74mm;margin:0 auto;font-size:11px;color:#000}
.c{text-align:center}.d{text-align:right;white-space:nowrap}h1{font-size:12px;margin:2px 0}table{width:100%;border-collapse:collapse}td{vertical-align:top;padding:1px 0}
hr{border:0;border-top:1px dashed #000;margin:4px 0}.aviso{font-weight:700;text-align:center;margin:4px 0}@media print{button{display:none}}</style></head><body>
<div class="c"><h1>${esc(tagX(emit, 'xFant') ?? tagX(emit, 'xNome'))}</h1>${esc(tagX(emit, 'xNome'))}<br>CNPJ ${esc(tagX(emit, 'CNPJ'))} · IE ${esc(tagX(emit, 'IE'))}<br>${esc(tagX(ender, 'xLgr'))}, ${esc(tagX(ender, 'nro'))} · ${esc(tagX(ender, 'xBairro'))} · ${esc(tagX(ender, 'xMun'))}/${esc(tagX(ender, 'UF'))}</div><hr>
<div class="c"><b>DANFE NFC-e · Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica</b></div>
${tpAmb === '2' ? '<div class="aviso">EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO – SEM VALOR FISCAL</div>' : ''}${tpEmis === '9' ? '<div class="aviso">EMITIDA EM CONTINGÊNCIA<br>Pendente de autorização</div>' : ''}<hr>
<table><tr><td><b>Código</b></td><td><b>Descrição</b></td><td class="d"><b>Valor</b></td></tr>${itens}</table><hr>
<table><tr><td>Qtde. total de itens</td><td class="d">${(inf.match(/<det nItem=/g) ?? []).length}</td></tr>
${Number(tagX(tot, 'vDesc')) > 0 ? `<tr><td>Descontos</td><td class="d">${brl(tagX(tot, 'vDesc'))}</td></tr>` : ''}${Number(tagX(tot, 'vOutro')) > 0 ? `<tr><td>Acréscimos</td><td class="d">${brl(tagX(tot, 'vOutro'))}</td></tr>` : ''}
<tr><td><b>Valor a pagar</b></td><td class="d"><b>${brl(tagX(tot, 'vNF'))}</b></td></tr></table><hr>
<table><tr><td><b>Forma de pagamento</b></td><td class="d"><b>Valor pago</b></td></tr>${pags}</table><hr>
<div class="c">Consulte pela chave de acesso em<br>${esc(tagX(xml, 'urlChave'))}<br><b>${ch}</b></div><hr>
<div class="c">${docDest ? `CONSUMIDOR ${docDest.length === 11 ? 'CPF' : 'CNPJ'} ${esc(docDest)}` : 'CONSUMIDOR NÃO IDENTIFICADO'}</div><hr>
<div class="c">NFC-e nº ${esc(tagX(ide, 'nNF'))} · Série ${esc(tagX(ide, 'serie'))} · ${esc(dh)}<br>${prot ? `Protocolo de autorização ${esc(tagX(prot, 'nProt'))}<br>${esc((tagX(prot, 'dhRecbto') ?? '').replace('T', ' ').slice(0, 19))}` : ''}</div>
${img ? `<div class="c"><img src="${img}" alt="QR Code da NFC-e" width="180" height="180"></div>` : ''}
${bloco(inf, 'infCpl') ? `<hr><div>${esc(tagX(inf, 'infCpl'))}</div>` : ''}
<button onclick="print()">Imprimir</button></body></html>`;
}
