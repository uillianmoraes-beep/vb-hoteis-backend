/**
 * Emissor próprio da NFS-e padrão nacional (Sefin Nacional / Sistema Nacional NFS-e), sem intermediário:
 * o sistema monta a DPS (rascunho da nota) no leiaute oficial v1.01, assina com o certificado A1 da empresa,
 * manda compactada (gzip + base64) por conexão com o certificado (mTLS) e recebe a NFS-e na hora (é síncrono).
 * Cancelamento pelo evento e101101. Docs: gov.br/nfse › Documentação técnica (Anexo I DPS, Anexo II eventos, XSD 1.01).
 *
 * Como a Spedy, recebe a nota no formato da Focus (o resto do sistema não muda) e devolve no formato da Focus.
 */
import { request, type RequestOptions } from 'https';
import { request as requestHttp } from 'http';
import { gzipSync, gunzipSync } from 'zlib';
import * as forge from 'node-forge';
import { SignedXml } from 'xml-crypto';
import type { AmbienteFocus, CaminhoFocus, RespostaFocus } from './focus';
import { ErroFocus } from './focus';

const BASES: Record<AmbienteFocus, string> = {
  producao: 'https://sefin.nfse.gov.br/SefinNacional',
  homologacao: 'https://sefin.producaorestrita.nfse.gov.br/SefinNacional',
};
/** NFSE_NACIONAL_URL_HOMOLOGACAO / NFSE_NACIONAL_URL_PRODUCAO trocam o endereço (testes locais) */
export const baseNacional = (a: AmbienteFocus) =>
  (a === 'producao' ? process.env.NFSE_NACIONAL_URL_PRODUCAO : process.env.NFSE_NACIONAL_URL_HOMOLOGACAO) || BASES[a];

const VERSAO = '1.01';
const VER_APLIC = 'VBHoteis-1.0';
const NS = 'http://www.sped.fazenda.gov.br/nfse';
const so = (v: unknown) => String(v ?? '').replace(/\D/g, '');
type J = Record<string, any>;

/* ------------------------------------------------------------ certificado */

export interface Certificado { chavePem: string; certPem: string; cnpj: string | null; titular: string; validade: Date; inicio: Date }

/** lê o certificado A1 (.pfx em base64) com a senha; também serve para conferir antes de guardar */
export function lerCertificado(pfxBase64: string, senha: string): Certificado {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.decode64(pfxBase64));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, senha);
  } catch {
    throw new ErroFocus('Não consegui abrir o certificado: confira se é o arquivo .pfx do A1 e se a senha está certa.');
  }
  const chaves = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
  ];
  const certs = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  const chave = chaves.find((b) => b.key)?.key as forge.pki.rsa.PrivateKey | undefined;
  if (!chave || !certs.length) throw new ErroFocus('O arquivo do certificado não tem a chave ou o certificado dentro.');
  // o certificado da empresa é o que casa com a chave (os outros são da cadeia da certificadora)
  const pub = forge.pki.setRsaPublicKey(chave.n, chave.e);
  const doTitular = certs.map((b) => b.cert!).find((c) => c && forge.pki.publicKeyToPem(c.publicKey) === forge.pki.publicKeyToPem(pub)) ?? certs[0].cert!;
  const cn = String(doTitular.subject.getField('CN')?.value ?? '');
  const cnpj = (cn.match(/:(\d{14})\b/) ?? cn.match(/(\d{14})/))?.[1] ?? null;
  return {
    chavePem: forge.pki.privateKeyToPem(chave), certPem: forge.pki.certificateToPem(doTitular),
    cnpj, titular: cn.split(':')[0].trim() || cn, validade: doTitular.validity.notAfter, inicio: doTitular.validity.notBefore,
  };
}

/* ----------------------------------------------------------------- XML */

const esc = (t: unknown) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** elemento com texto (vazio/undefined = não sai) */
const el = (nome: string, v: unknown) => (v === undefined || v === null || v === '' ? '' : `<${nome}>${esc(v)}</${nome}>`);
/** grupo (sai só se tiver algo dentro) */
const gr = (nome: string, ...filhos: string[]) => { const d = filhos.join(''); return d ? `<${nome}>${d}</${nome}>` : ''; };
const dec2 = (n: unknown) => (Math.round(Number(n ?? 0) * 100) / 100).toFixed(2);
/** texto livre: sem quebra de linha nem caractere de controle (a SEFAZ recusa) */
const limpo = (t: unknown, max: number) => String(t ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** data e hora de Brasília com o fuso, 1 minuto atrás (o sistema nacional recusa horário "no futuro") */
function agoraBrasilia() {
  const d = new Date(Date.now() - 3 * 3600_000 - 60_000);
  return `${d.toISOString().slice(0, 19)}-03:00`;
}

/** Id da DPS: "DPS" + município (7) + tipo de inscrição (1=CPF, 2=CNPJ) + CNPJ/CPF (14) + série (5) + número (15) */
export function idDps(cMun: string, doc: string, serie: string | number, numero: string | number) {
  const d = String(doc ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  return `DPS${so(cMun).padStart(7, '0')}${d.length === 11 ? '1' : '2'}${d.padStart(14, '0')}${String(serie).padStart(5, '0')}${String(numero).padStart(15, '0')}`;
}

/**
 * leiaute em uso em cada ambiente: o novo (reforma tributária, com finNFSe) ou o anterior.
 * Começa no novo; se o sistema nacional recusar pelo leiaute, troca e manda de novo (e lembra).
 */
const LEIAUTE_NOVO: Record<AmbienteFocus, boolean> = { producao: true, homologacao: true };

/** DPS v1.01 a partir da nota no formato da Focus (NFS-e nacional) */
export function montarDps(c: J, tpAmb: 1 | 2, novo = true) {
  const cnpj = so(c.cnpj_prestador);
  const cMun = so(c.codigo_municipio_emissora);
  const serie = String(c.serie_dps ?? 1);
  const numero = String(c.numero_dps);
  const id = idDps(cMun, cnpj, serie, numero);
  const opSimp = Number(c.codigo_opcao_simples_nacional ?? 1);
  const tomaDoc = so(c.cpf_tomador || c.cnpj_tomador);
  const tomador = tomaDoc
    ? `<toma>${tomaDoc.length === 11 ? el('CPF', tomaDoc) : el('CNPJ', tomaDoc)}${el('xNome', limpo(c.razao_social_tomador || 'Consumidor', 300))}</toma>`
    : '';
  const cTribNac = so(c.codigo_tributacao_nacional_iss).padEnd(6, '0').slice(0, 6);
  const cTribMun = so(c.codigo_tributacao_municipal_iss);
  // no Simples (ME/EPP e MEI) o ISS vai no DAS: a alíquota só sai para quem não é do Simples
  const aliq = opSimp === 1 && c.percentual_aliquota_relativa_municipio !== undefined ? dec2(c.percentual_aliquota_relativa_municipio) : '';
  const inf =
    `<infDPS Id="${id}">` +
    el('tpAmb', tpAmb) + el('dhEmi', agoraBrasilia()) + el('verAplic', VER_APLIC) + el('serie', serie) + el('nDPS', numero) +
    el('dCompet', c.data_competencia) + el('tpEmit', 1) + (novo ? el('finNFSe', 0) : '') + el('cLocEmi', cMun) +
    `<prest>${el('CNPJ', cnpj)}<regTrib>${el('opSimpNac', opSimp)}${opSimp === 3 ? el('regApTribSN', c.regime_tributario_simples_nacional ?? 1) : ''}${el('regEspTrib', c.regime_especial_tributacao ?? 0)}</regTrib></prest>` +
    tomador +
    `<serv>` +
      `<locPrest>${el('cLocPrestacao', so(c.codigo_municipio_prestacao) || cMun)}</locPrest>` +
      `<cServ>${el('cTribNac', cTribNac)}${cTribMun.length === 3 ? el('cTribMun', cTribMun) : ''}${el('xDescServ', limpo(c.descricao_servico, 2000))}</cServ>` +
      gr('infoCompl', el('xInfComp', c.informacoes_complementares ? limpo(c.informacoes_complementares, 2000) : '')) +
    `</serv>` +
    `<valores>` +
      `<vServPrest>${el('vServ', dec2(c.valor_servico))}</vServPrest>` +
      `<trib>` +
        `<tribMun>${el('tribISSQN', c.tributacao_iss ?? 1)}${el('tpRetISSQN', c.tipo_retencao_iss ?? 1)}${el('pAliq', aliq)}</tribMun>` +
        `<totTrib><indTotTrib>0</indTotTrib></totTrib>` +
      `</trib>` +
    `</valores>` +
    `</infDPS>`;
  return { id, xml: `<DPS xmlns="${NS}" versao="${VERSAO}">${inf}</DPS>` };
}

/** pedido de cancelamento (evento e101101) */
export function montarCancelamento(chave: string, cnpjAutor: string, tpAmb: 1 | 2, motivo: string, codigo: 1 | 2 | 9 = 1) {
  const id = `PRE${chave}101101`;
  const inf =
    `<infPedReg Id="${id}">` + el('tpAmb', tpAmb) + el('verAplic', VER_APLIC) + el('dhEvento', agoraBrasilia()) +
    el('CNPJAutor', so(cnpjAutor)) + el('chNFSe', chave) +
    `<e101101>${el('xDesc', 'Cancelamento de NFS-e')}${el('cMotivo', codigo)}${el('xMotivo', limpo(motivo, 255))}</e101101>` +
    `</infPedReg>`;
  return { id, xml: `<pedRegEvento xmlns="${NS}" versao="${VERSAO}">${inf}</pedRegEvento>` };
}

/** assinatura digital (XMLDSig, RSA-SHA1, C14N, envelopada) logo depois do grupo assinado */
export function assinar(xml: string, grupo: 'infDPS' | 'infPedReg', cert: Certificado) {
  const sig = new SignedXml({
    privateKey: cert.chavePem,
    publicCert: cert.certPem,
    signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
  });
  sig.addReference({
    xpath: `//*[local-name(.)='${grupo}']`,
    transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'],
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
  });
  sig.computeSignature(xml, { location: { reference: `//*[local-name(.)='${grupo}']`, action: 'after' } });
  return sig.getSignedXml();
}

const compactar = (xml: string) => gzipSync(Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>${xml}`, 'utf8')).toString('base64');
export const descompactar = (b64: string) => gunzipSync(Buffer.from(b64, 'base64')).toString('utf8');
/** valor de uma tag simples no XML da NFS-e */
export const tag = (xml: string, nome: string) => xml.match(new RegExp(`<(?:\\w+:)?${nome}[^>]*>([^<]*)</(?:\\w+:)?${nome}>`))?.[1] ?? null;

/** junta as mensagens de erro do sistema nacional (os nomes dos campos variam entre as versões) */
export function mensagemNacional(j: J | null | undefined): string {
  if (!j) return '';
  const lista = (j.erros ?? j.Erros ?? j.erro ?? j.mensagens ?? []) as J[];
  const partes = (Array.isArray(lista) ? lista : [lista]).map((e) => {
    const cod = e?.codigo ?? e?.Codigo ?? '';
    const txt = e?.descricao ?? e?.Descricao ?? e?.mensagem ?? e?.Mensagem ?? '';
    const comp = e?.complemento ?? e?.Complemento ?? '';
    return [cod && `${cod}:`, txt, comp && `(${comp})`].filter(Boolean).join(' ');
  }).filter(Boolean);
  if (!partes.length && (j.mensagem || j.message || j.title)) partes.push(String(j.mensagem ?? j.message ?? j.title));
  return [...new Set(partes)].join(' · ');
}

/* -------------------------------------------------------------- cliente */

/** o que o emissor guarda da nota (para consultar e cancelar depois) */
export interface NotaGuardada { resposta: J | null; envio: J | null }

export class Nacional {
  readonly base: string;
  readonly tpAmb: 1 | 2;
  constructor(
    private readonly cert: Certificado,
    readonly ambiente: AmbienteFocus,
    private readonly cnpj: string,
    private readonly arquivoDe: (caminho: string) => string | null,
    private readonly lerNota: (ref: string) => Promise<NotaGuardada | null>,
  ) {
    this.base = baseNacional(ambiente);
    this.tpAmb = ambiente === 'producao' ? 1 : 2;
  }

  /** chamada com o certificado (mTLS); devolve status e corpo json */
  private chamar(metodo: 'GET' | 'POST' | 'HEAD', caminho: string, corpo?: unknown): Promise<{ status: number; json: J }> {
    const url = new URL(`${this.base}${caminho}`);
    const dados = corpo === undefined ? undefined : Buffer.from(JSON.stringify(corpo), 'utf8');
    const fazer = url.protocol === 'http:' ? requestHttp : request;
    return new Promise((ok, falha) => {
      const opcoes: RequestOptions = {
        method: metodo,
        key: this.cert.chavePem, cert: this.cert.certPem,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'VB-Solucoes-Hoteleiras/1.0', ...(dados ? { 'Content-Length': dados.length } : {}) },
        timeout: 60_000,
      };
      const req = fazer(url, opcoes, (res) => {
        const partes: Buffer[] = [];
        res.on('data', (p) => partes.push(p));
        res.on('end', () => {
          const texto = Buffer.concat(partes).toString('utf8');
          let json: J = {};
          try { json = texto ? JSON.parse(texto) : {}; } catch { json = { mensagem: texto.slice(0, 300) }; }
          ok({ status: res.statusCode ?? 0, json });
        });
      });
      req.on('timeout', () => req.destroy(new Error('tempo esgotado')));
      req.on('error', (e) => falha(e));
      if (dados) req.write(dados);
      req.end();
    });
  }

  private erroDe(status: number, json: J): ErroFocus {
    if (status === 401 || status === 403) return new ErroFocus('O sistema nacional da NFS-e recusou o certificado. Confira se o A1 é desta empresa e está dentro da validade.', status, json);
    return new ErroFocus(`NFS-e nacional: ${mensagemNacional(json) || `erro ${status}`}`, status, json);
  }

  /** a nota pronta no jeito da Focus */
  private traduzir(json: J, idDpsEnviada: string | null): RespostaFocus {
    const xml = json.nfseXmlGZipB64 ? descompactar(String(json.nfseXmlGZipB64)) : null;
    const chave = String(json.chaveAcesso ?? (xml ? (xml.match(/Id="NFS([0-9A-Z]{50})"/)?.[1] ?? '') : '')) || null;
    return {
      status: 'autorizado',
      mensagem_sefaz: 'NFS-e gerada pelo sistema nacional.',
      numero: xml ? (tag(xml, 'nNFSe') ?? undefined) : undefined,
      serie: undefined,
      chave_nfe: chave ?? undefined,
      caminho_xml_nota_fiscal: chave ? `nacional:${chave}/xml` : undefined,
      caminho_danfe: chave ? `nacional:${chave}/pdf` : undefined,
      url_consulta_nf: chave ? `https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=${chave}` : undefined,
      id_dps: idDpsEnviada ?? json.idDps ?? undefined,
      nfse_xml: xml ?? undefined,
      alertas: json.alertas ?? undefined,
    };
  }

  /** confere certificado e conexão: consulta os parâmetros do município (não emite nada) */
  async testar(codigoMunicipio?: string) {
    if (this.cert.validade.getTime() < Date.now()) throw new ErroFocus(`O certificado venceu em ${this.cert.validade.toLocaleDateString('pt-BR')}.`);
    if (this.cert.cnpj && so(this.cert.cnpj).slice(0, 8) !== so(this.cnpj).slice(0, 8)) throw new ErroFocus(`O certificado é do CNPJ ${this.cert.cnpj}, não deste emissor (${this.cnpj}).`);
    if (!codigoMunicipio) return true;
    let r: { status: number; json: J };
    try { r = await this.chamar('GET', `/parametros_municipais/${so(codigoMunicipio)}/convenio`); }
    catch { throw new ErroFocus('Não consegui falar com o sistema nacional da NFS-e (internet ou certificado).'); }
    if (r.status === 401 || r.status === 403 || r.status >= 500) throw this.erroDe(r.status, r.json);
    return true;
  }

  /**
   * o que o município tem no sistema nacional: convênio e, para cada código de hospedagem (09.01.01 a 09.01.04),
   * se está cadastrado e com qual alíquota (ajuda a entender a recusa E0312)
   */
  async diagnostico(codigoMunicipio: string) {
    const cMun = so(codigoMunicipio);
    const resumo = (j: J) => JSON.stringify(j).slice(0, 200);
    // o governo às vezes responde com uma página (não JSON): aí a consulta só não está disponível
    const semPagina = (r: { status: number; json: J }) => (/<html|<!doctype/i.test(String(r.json?.mensagem ?? '')) ? 'consulta indisponível' : mensagemNacional(r.json));
    const linhas: string[] = [];
    const conv = await this.chamar('GET', `/parametros_municipais/${cMun}/convenio`).catch((e) => ({ status: 0, json: { erro: (e as Error).message } as J }));
    linhas.push(`Convênio do município ${cMun}: ${conv.status === 200 ? 'ok' : `não encontrado (${conv.status})`} ${conv.status === 200 ? resumo(conv.json) : semPagina(conv)}`);
    for (const cod of ['090101', '090102', '090103', '090104']) {
      const r = await this.chamar('GET', `/parametros_municipais/${cMun}/${cod}`).catch((e) => ({ status: 0, json: { erro: (e as Error).message } as J }));
      linhas.push(`${cod.slice(0, 2)}.${cod.slice(2, 4)}.${cod.slice(4)}: ${r.status === 200 ? `cadastrado ${resumo(r.json)}` : `sem resposta (${r.status}) ${semPagina(r)}`}`);
    }
    return linhas;
  }

  async emitir(tipo: CaminhoFocus, _ref: string, corpo: unknown): Promise<{ status: number; json: RespostaFocus }> {
    if (tipo !== 'nfsen') throw new ErroFocus('O emissor próprio faz só a NFS-e padrão nacional por enquanto.');
    let { id, xml } = montarDps(corpo as J, this.tpAmb, LEIAUTE_NOVO[this.ambiente]);
    let assinado = assinar(xml, 'infDPS', this.cert);
    let r: { status: number; json: J };
    try {
      r = await this.chamar('POST', '/nfse', { dpsXmlGZipB64: compactar(assinado) });
      // recusa pelo leiaute (campo finNFSe a mais ou a menos): troca de leiaute e manda de novo, uma vez
      const msg = mensagemNacional(r.json);
      if (r.status >= 400 && /finNFSe/.test(msg)) {
        LEIAUTE_NOVO[this.ambiente] = !LEIAUTE_NOVO[this.ambiente];
        ({ id, xml } = montarDps(corpo as J, this.tpAmb, LEIAUTE_NOVO[this.ambiente]));
        assinado = assinar(xml, 'infDPS', this.cert);
        r = await this.chamar('POST', '/nfse', { dpsXmlGZipB64: compactar(assinado) });
      }
    } catch {
      // não sabemos se chegou: fica "processando" e a consulta pela DPS resolve
      return { status: 202, json: { status: 'processando_autorizacao', mensagem: 'Sem resposta do sistema nacional; conferindo se a nota foi gerada.', id_dps: id, dps_xml: assinado } };
    }
    if (r.status >= 500) return { status: r.status, json: { status: 'processando_autorizacao', mensagem: `Sistema nacional instável (erro ${r.status}); conferindo se a nota foi gerada.`, id_dps: id, dps_xml: assinado } };
    if (r.status >= 400) throw this.erroDe(r.status, { ...r.json, id_dps: id });
    return { status: r.status, json: { ...this.traduzir(r.json, id), dps_xml: assinado } };
  }

  /** consulta pela DPS (quando o envio ficou sem resposta) ou pela chave */
  async consultar(_tipo: CaminhoFocus, ref: string): Promise<{ status: number; json: RespostaFocus }> {
    const n = await this.lerNota(ref);
    const resp = (n?.resposta ?? {}) as J;
    if (resp.status === 'cancelado') return { status: 200, json: resp };
    let chave = resp.chave_nfe as string | undefined;
    if (!chave && resp.id_dps) {
      const d = await this.chamar('GET', `/dps/${resp.id_dps}`).catch(() => null);
      if (!d || d.status === 404) return { status: 404, json: {} };
      if (d.status >= 400) return { status: 200, json: { ...resp, status: 'processando_autorizacao' } };
      chave = d.json.chaveAcesso ?? undefined;
    }
    if (!chave) return { status: 404, json: {} };
    const r = await this.chamar('GET', `/nfse/${chave}`).catch(() => null);
    if (!r || r.status >= 400) return { status: 200, json: { ...resp, chave_nfe: chave, status: resp.status ?? 'processando_autorizacao' } };
    return { status: 200, json: { ...resp, ...this.traduzir({ ...r.json, chaveAcesso: chave }, resp.id_dps ?? null) } };
  }

  async cancelar(_tipo: CaminhoFocus, ref: string, justificativa: string): Promise<{ status: number; json: RespostaFocus }> {
    const n = await this.lerNota(ref);
    const resp = (n?.resposta ?? {}) as J;
    const chave = resp.chave_nfe as string | undefined;
    if (!chave) throw new ErroFocus('Esta nota não tem a chave do sistema nacional.');
    const { xml } = montarCancelamento(chave, this.cnpj, this.tpAmb, justificativa);
    const assinado = assinar(xml, 'infPedReg', this.cert);
    let r: { status: number; json: J };
    try { r = await this.chamar('POST', `/nfse/${chave}/eventos`, { pedidoRegistroEventoXmlGZipB64: compactar(assinado) }); }
    catch { throw new ErroFocus('Não consegui falar com o sistema nacional para cancelar. Tente de novo em instantes.'); }
    if (r.status >= 400) throw this.erroDe(r.status, r.json);
    return { status: r.status, json: { ...resp, status: 'cancelado', mensagem_sefaz: 'NFS-e cancelada no sistema nacional.', evento_cancelamento: r.json.eventoXmlGZipB64 ? descompactar(String(r.json.eventoXmlGZipB64)) : undefined } };
  }

  async cartaCorrecao(): Promise<{ status: number; json: RespostaFocus }> {
    throw new ErroFocus('NFS-e não tem carta de correção: cancele e emita de novo.');
  }

  /** PDF (DANFSe) e XML saem pelo próprio sistema, num endereço assinado */
  arquivo(caminho: string | undefined | null) {
    if (!caminho) return null;
    return caminho.startsWith('nacional:') ? this.arquivoDe(caminho) : caminho;
  }
}

/* ------------------------------------------------------------ DANFSe */

const fmtDoc = (d: string | null) => {
  const x = so(d);
  if (x.length === 14) return x.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (x.length === 11) return x.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return d ?? '';
};
const reais = (v: string | null) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** DANFSe simples (página para imprimir) a partir do XML da NFS-e */
export function danfseHtml(xml: string) {
  const bloco = (nome: string) => xml.match(new RegExp(`<${nome}>([\\s\\S]*?)</${nome}>`))?.[1] ?? '';
  const emit = bloco('emit');
  const toma = bloco('toma');
  const chave = xml.match(/Id="NFS([0-9A-Z]{50})"/)?.[1] ?? '';
  const teste = tag(xml, 'tpAmb') === '2'; // a DPS dentro da NFS-e diz o ambiente (2 = testes)
  const linha = (r: string, v: unknown) => `<tr><th>${esc(r)}</th><td>${esc(v)}</td></tr>`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>DANFSe ${esc(tag(xml, 'nNFSe'))}</title>
<style>body{font-family:Arial,sans-serif;max-width:800px;margin:16px auto;color:#111;font-size:13px}h1{font-size:18px;margin:0}
.cab{display:flex;justify-content:space-between;border:2px solid #111;padding:10px;gap:10px}.aviso{background:#fee2e2;color:#991b1b;text-align:center;font-weight:700;padding:6px;margin:8px 0}
table{width:100%;border-collapse:collapse;margin-top:8px}th,td{border:1px solid #999;padding:5px;text-align:left;vertical-align:top}th{width:30%;background:#f3f4f6}
h2{font-size:14px;margin:14px 0 4px}.desc{white-space:pre-wrap;border:1px solid #999;padding:8px}@media print{button{display:none}}</style></head><body>
${teste ? '<div class="aviso">NFS-e SEM VALIDADE JURÍDICA (ambiente de testes)</div>' : ''}
<div class="cab"><div><h1>DANFSe – Documento Auxiliar da NFS-e</h1><div>Nota Fiscal de Serviço eletrônica · padrão nacional</div></div>
<div style="text-align:right"><div>Número <b>${esc(tag(xml, 'nNFSe'))}</b></div><div>Emitida em ${esc((tag(xml, 'dhProc') ?? '').replace('T', ' ').slice(0, 16))}</div></div></div>
<table>${linha('Chave de acesso', chave)}${linha('Competência', tag(xml, 'dCompet'))}${linha('Município', tag(xml, 'xLocEmi'))}</table>
<h2>Prestador</h2><table>${linha('Nome', tag(emit, 'xNome'))}${linha('CNPJ/CPF', fmtDoc(tag(emit, 'CNPJ') ?? tag(emit, 'CPF')))}${linha('Inscrição municipal', tag(emit, 'IM') ?? '—')}</table>
<h2>Tomador</h2><table>${toma ? linha('Nome', tag(toma, 'xNome')) + linha('CNPJ/CPF', fmtDoc(tag(toma, 'CNPJ') ?? tag(toma, 'CPF'))) : linha('Tomador', 'Não identificado')}</table>
<h2>Serviço</h2><table>${linha('Código', `${tag(xml, 'cTribNac') ?? ''} – ${tag(xml, 'xTribNac') ?? ''}`)}${linha('Local da prestação', tag(xml, 'xLocPrestacao'))}</table>
<div class="desc">${esc(tag(xml, 'xDescServ'))}</div>
<h2>Valores</h2><table>${linha('Valor do serviço', reais(tag(xml, 'vServ')))}${linha('Base de cálculo', reais(tag(xml, 'vBC')))}${linha('Alíquota ISS', tag(xml, 'pAliqAplic') ? `${tag(xml, 'pAliqAplic')}%` : '—')}${linha('ISS', reais(tag(xml, 'vISSQN')))}${linha('Valor líquido', reais(tag(xml, 'vLiq')))}</table>
<p>Consulte a autenticidade em <b>nfse.gov.br</b> (Consulta pública) com a chave de acesso.</p>
<button onclick="print()">Imprimir</button></body></html>`;
}
