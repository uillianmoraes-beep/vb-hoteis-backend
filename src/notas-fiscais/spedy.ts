/**
 * Cliente da API da Spedy (alternativa à Focus NFe). Docs: https://docs.spedy.com.br — chave no cabeçalho X-Api-Key;
 * base https://api.spedy.com.br (produção) ou https://sandbox-api.spedy.com.br (testes: conta separada, NFS-e simulada).
 *
 * O sistema monta as notas no formato da Focus; aqui elas são traduzidas para o formato da Spedy, e a resposta da Spedy
 * volta no formato da Focus. Assim o resto (contas, cancelamento, acompanhamento) não muda.
 */
import { createHmac } from 'crypto';
import type { AmbienteFocus, CaminhoFocus, RespostaFocus } from './focus';
import { ErroFocus } from './focus';

const BASES: Record<AmbienteFocus, string> = { producao: 'https://api.spedy.com.br', homologacao: 'https://sandbox-api.spedy.com.br' };
/** SPEDY_URL_SANDBOX / SPEDY_URL_PRODUCAO trocam o endereço (testes locais) */
export const baseSpedy = (a: AmbienteFocus) => (a === 'producao' ? process.env.SPEDY_URL_PRODUCAO : process.env.SPEDY_URL_SANDBOX) || BASES[a];

/** caminho de cada tipo de nota na Spedy */
const MODELO: Record<CaminhoFocus, string> = { nfce: 'consumer-invoices', nfe: 'product-invoices', nfse: 'service-invoices', nfsen: 'service-invoices' };

type J = Record<string, any>;
const num = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : Number(v));
const so = (v: unknown) => String(v ?? '').replace(/\D/g, '');
/** tira os campos vazios (a Spedy recusa alguns nulos) */
function limpar<T>(o: T): T {
  if (Array.isArray(o)) { const l = o.map(limpar).filter((x) => x !== undefined); return (l.length ? l : undefined) as T; }
  if (o && typeof o === 'object') {
    const r: J = {};
    for (const [k, v] of Object.entries(o as J)) {
      const x = limpar(v);
      if (x === undefined || x === null || x === '' || (typeof x === 'object' && !Array.isArray(x) && !Object.keys(x).length)) continue;
      r[k] = x;
    }
    return r as T;
  }
  return o;
}

/** a referência da nota no sistema ("vb-<uuid>") cabe nos 36 caracteres do integrationId da Spedy */
export const integracao = (ref: string) => ref.replace(/^vb-/, '').slice(0, 36);

/* ------------------------------------------------------- tradução de ida */

const PAGAMENTO: Record<string, string> = {
  '01': 'money', '02': 'check', '03': 'creditCard', '04': 'debitCard', '05': 'storeCredit', '10': 'foodVoucher', '11': 'mealVoucher', '12': 'giftVoucher',
  '13': 'fuelVoucher', '14': 'commercialDuplicate', '15': 'billetBanking', '16': 'bankDeposit', '17': 'pix', '18': 'bankTransfer', '19': 'fidelityProgram', '90': 'noPayment', '99': 'other',
};
const PRESENCA: Record<string, string> = { '0': 'none', '1': 'presence', '2': 'internet', '3': 'telephone', '4': 'delivery', '9': 'othersNonPresenceOperation' };
const FINALIDADE: Record<string, string> = { '1': 'normal', '2': 'complement', '3': 'adjustment', '4': 'devolution' };
const FRETE: Record<string, string> = { '0': 'byIssuer', '1': 'byReceiver', '2': 'byThirdParties', '3': 'byIssuerOwnTransport', '4': 'byReceiverOwnTransport', '9': 'free' };

function itemSefaz(i: J) {
  const cst = String(i.icms_situacao_tributaria ?? '');
  return {
    code: i.codigo_produto, gtinCode: i.codigo_barras_comercial, description: i.descricao, ncm: i.codigo_ncm, cest: i.cest,
    cfop: num(i.cfop), unit: i.unidade_comercial, quantity: num(i.quantidade_comercial), unitAmount: num(i.valor_unitario_comercial),
    totalAmount: num(i.valor_bruto), unitTax: i.unidade_tributavel, quantityTax: num(i.quantidade_tributavel), unitTaxAmount: num(i.valor_unitario_tributavel),
    discountAmount: num(i.valor_desconto), othersAmount: num(i.valor_outras_despesas), makeupTotal: true, taxBenefitCode: i.codigo_beneficio_fiscal,
    returnedPercent: num(i.percentual_devolvido),
    taxes: {
      icms: {
        origin: num(i.icms_origem ?? 0),
        // 3 números = CSOSN do Simples (102, 500…); 2 números = CST do regime normal
        ...(cst.length === 3 ? { csosn: num(cst) } : { cst: num(cst) }),
        baseTaxModality: num(i.icms_modalidade_base_calculo), baseTax: num(i.icms_base_calculo), rate: num(i.icms_aliquota), amount: num(i.icms_valor),
        baseTaxReduction: num(i.icms_reducao_base_calculo),
      },
      pis: { cst: num(i.pis_situacao_tributaria), baseTax: num(i.pis_base_calculo), rate: num(i.pis_aliquota_porcentual), amount: num(i.pis_valor) },
      cofins: { cst: num(i.cofins_situacao_tributaria), baseTax: num(i.cofins_base_calculo), rate: num(i.cofins_aliquota_porcentual), amount: num(i.cofins_valor) },
      ibsCbs: i.ibs_cbs_situacao_tributaria ? {
        cst: num(i.ibs_cbs_situacao_tributaria), classification: num(i.ibs_cbs_classificacao_tributaria), baseTax: num(i.ibs_cbs_base_calculo),
        ibsStateRate: num(i.ibs_uf_aliquota), ibsStateAmount: num(i.ibs_uf_valor), ibsCityRate: num(i.ibs_mun_aliquota), ibsCityAmount: num(i.ibs_mun_valor),
        cbsRate: num(i.cbs_aliquota), cbsAmount: num(i.cbs_valor),
      } : undefined,
    },
  };
}

/** NFC-e e NF-e (o formato da Spedy é o mesmo, com os nomes do XML da SEFAZ) */
export function paraSpedySefaz(c: J, ref: string, nfe: boolean) {
  const doc = so(c.cpf_destinatario || c.cnpj_destinatario);
  const receiver = doc ? {
    name: c.nome_destinatario, federalTaxNumber: doc, stateTaxNumber: c.inscricao_estadual_destinatario, email: c.email_destinatario, phoneNumber: c.telefone_destinatario,
    address: c.logradouro_destinatario ? {
      street: c.logradouro_destinatario, number: c.numero_destinatario, district: c.bairro_destinatario, postalCode: c.cep_destinatario,
      city: { name: c.municipio_destinatario, state: c.uf_destinatario }, country: 'BRA',
    } : undefined,
  } : undefined;
  return limpar({
    integrationId: integracao(ref),
    effectiveDate: c.data_emissao,
    number: num(c.numero), series: c.serie != null ? String(c.serie) : undefined,
    operationNature: c.natureza_operacao,
    operationDate: nfe ? c.data_entrada_saida : undefined,
    operationType: nfe ? (String(c.tipo_documento ?? '1') === '0' ? 'incoming' : 'outgoing') : undefined,
    purposeType: FINALIDADE[String(c.finalidade_emissao ?? '1')],
    destination: String(c.local_destino ?? '1') === '2' ? 'interstate' : String(c.local_destino) === '3' ? 'international' : 'internal',
    presenceType: PRESENCA[String(c.presenca_comprador ?? '1')],
    isFinalCustomer: String(c.consumidor_final ?? '1') === '1',
    receiver,
    transport: { freightModality: FRETE[String(c.modalidade_frete ?? '9')] ?? 'free' },
    payments: ((c.formas_pagamento ?? []) as J[]).map((p) => ({
      method: PAGAMENTO[String(p.forma_pagamento)] ?? 'other', amount: num(p.valor_pagamento),
      card: ['03', '04', '17'].includes(String(p.forma_pagamento)) ? { isIntegratedPayment: String(p.tipo_integracao) === '1' } : undefined,
    })),
    items: ((c.items ?? []) as J[]).map(itemSefaz),
    referencedDocuments: ((c.notas_referenciadas ?? []) as J[]).map((r) => ({ accessKey: r.chave_nfe })),
    additionalInformation: c.informacoes_adicionais_contribuinte,
    sendEmailToCustomer: false,
  });
}

/** NFS-e (padrão nacional ou da prefeitura: a Spedy escolhe o provedor da cidade) */
export function paraSpedyServico(c: J, ref: string, nacional: boolean) {
  const s: J = c.servico ?? {};
  const t: J = c.tomador ?? {};
  const doc = so(nacional ? c.cpf_tomador || c.cnpj_tomador : t.cpf || t.cnpj);
  const nome = nacional ? c.razao_social_tomador : t.razao_social;
  const tribNac = nacional ? String(c.codigo_tributacao_nacional_iss ?? '') : '';
  const item = nacional ? (tribNac.length >= 4 ? `${tribNac.slice(0, 2)}.${tribNac.slice(2, 4)}` : undefined) : s.item_lista_servico;
  const valor = num(nacional ? c.valor_servico : s.valor_servicos);
  return limpar({
    integrationId: integracao(ref),
    effectiveDate: c.data_emissao,
    // padrão nacional: a série e o número da DPS vão do sistema (a DPS sem série é recusada)
    rpsSeries: nacional && c.serie_dps != null ? String(c.serie_dps) : undefined,
    rpsNumber: nacional ? num(c.numero_dps) : undefined,
    description: nacional ? c.descricao_servico : s.discriminacao,
    federalServiceCode: item,
    nationalTaxationCode: tribNac || undefined,
    cityServiceCode: nacional ? c.codigo_tributacao_municipal_iss : s.codigo_tributario_municipio,
    cnaeCode: s.codigo_cnae,
    taxationType: 'taxationInMunicipality',
    receiver: doc || nome ? { name: nome, federalTaxNumber: doc || undefined } : undefined,
    total: {
      invoiceAmount: valor,
      issRate: num(nacional ? c.percentual_aliquota_relativa_municipio : s.aliquota),
      issWithheld: nacional ? Number(c.tipo_retencao_iss) === 2 : !!s.iss_retido,
    },
    location: { code: num(nacional ? c.codigo_municipio_prestacao : s.codigo_municipio) },
    ibsCbs: c.ibs_cbs_situacao_tributaria ? { cst: num(c.ibs_cbs_situacao_tributaria), classification: num(c.ibs_cbs_classificacao_tributaria) } : undefined,
    additionalInformation: c.informacoes_complementares,
    sendEmailToCustomer: false,
  });
}

/* ------------------------------------------------------ tradução de volta */

/** situação da Spedy no jeito da Focus (o resto do sistema já entende) */
function statusFocus(s: string, cancelando = false) {
  if (s === 'authorized') return cancelando ? 'processando_cancelamento' : 'autorizado';
  if (s === 'canceled') return 'cancelado';
  if (['created', 'enqueued', 'received', 'inContingent'].includes(s)) return 'processando_autorizacao';
  return 'erro_autorizacao'; // rejected, denied, removed, disabled
}

export class Spedy {
  readonly base: string;
  constructor(private readonly chave: string, readonly ambiente: AmbienteFocus, private readonly arquivoDe: (caminho: string) => string | null) {
    this.base = baseSpedy(ambiente);
  }

  private async chamar(metodo: 'GET' | 'POST' | 'DELETE' | 'PUT', caminho: string, corpo?: unknown): Promise<{ status: number; json: J }> {
    let resp: Response;
    try {
      resp = await fetch(`${this.base}/v1${caminho}`, {
        method: metodo,
        headers: { 'X-Api-Key': this.chave, 'Content-Type': 'application/json', 'User-Agent': 'VB-Solucoes-Hoteleiras/1.0' },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      throw new ErroFocus('Não consegui falar com a Spedy agora. Tente de novo em instantes.');
    }
    const texto = await resp.text();
    let json: J | null = null;
    try { json = texto ? JSON.parse(texto) : null; } catch { /* sem json */ }
    if (resp.status === 401 || resp.status === 403) throw new ErroFocus('A Spedy recusou a chave. Confira se copiou a chave certa (do sandbox para testes ou de produção) desta empresa.', resp.status);
    if (resp.status === 429) throw new ErroFocus('A Spedy pediu para esperar um pouco (muitos pedidos seguidos). Tente de novo em instantes.', 429);
    if (resp.status >= 400 && resp.status !== 404) throw new ErroFocus(`Spedy: ${mensagemSpedy(json) || `erro ${resp.status}`}`, resp.status, json);
    return { status: resp.status, json: json ?? {} };
  }

  /** a nota da Spedy no formato da Focus */
  private traduzir(modelo: string, n: J, cancelando = false): RespostaFocus {
    const st = statusFocus(String(n.status ?? ''), cancelando);
    const msg = n.processingDetail?.message as string | undefined;
    return {
      status: st,
      mensagem_sefaz: st === 'autorizado' ? (msg || 'Autorizada.') : msg,
      ...(st.startsWith('erro') ? { mensagem: msg || `Nota ${n.status === 'denied' ? 'denegada' : 'recusada'} (sem motivo informado pela Spedy).` } : {}),
      numero: n.number || undefined, // a Spedy devolve 0 enquanto a nota não tem número
      serie: n.series ?? n.rps?.series ?? undefined,
      chave_nfe: n.accessKey ?? undefined,
      codigo_verificacao: modelo === 'service-invoices' ? (n.authorization?.protocol ?? undefined) : undefined,
      // PDF e XML só existem depois de autorizada
      caminho_xml_nota_fiscal: n.id && n.status !== 'rejected' && !st.startsWith('processando_autorizacao') && !st.startsWith('erro') ? `spedy:${modelo}/${n.id}/xml` : undefined,
      caminho_danfe: n.id && !st.startsWith('processando_autorizacao') && !st.startsWith('erro') ? `spedy:${modelo}/${n.id}/pdf` : undefined,
      spedy_id: n.id,
    };
  }

  /** acha a nota pela referência do sistema */
  private async achar(modelo: string, ref: string): Promise<J | null> {
    const r = await this.chamar('GET', `/${modelo}?integrationId=${encodeURIComponent(integracao(ref))}&pageSize=1`);
    const l = (r.json.items ?? r.json.data ?? []) as J[];
    if (!l[0]?.id) return null;
    // a nota completa traz o motivo da recusa (processingDetail), que a lista pode não trazer
    const d = await this.chamar('GET', `/${modelo}/${l[0].id}`);
    const n = d.status === 200 && d.json?.id ? d.json : l[0];
    // recusada sem motivo na nota: o motivo fica nos eventos (o último com mensagem)
    if (['rejected', 'denied'].includes(String(n.status)) && !n.processingDetail?.message) {
      const ev = await this.chamar('GET', `/${modelo}/${n.id}/events`).catch(() => null);
      const lista = (Array.isArray(ev?.json) ? ev!.json : (ev?.json?.items ?? [])) as J[];
      const motivo = [...lista].sort((a, b) => String(b.date).localeCompare(String(a.date))).find((x) => x.message)?.message;
      if (motivo) n.processingDetail = { ...(n.processingDetail ?? {}), message: motivo };
    }
    return n;
  }

  /** confere a chave: a lista de notas responde 200 (chave boa) ou 401/403 (chave errada) */
  async testar() {
    await this.chamar('GET', '/service-invoices?pageSize=1');
    return true;
  }

  async emitir(tipo: CaminhoFocus, ref: string, corpo: unknown): Promise<{ status: number; json: RespostaFocus }> {
    const modelo = MODELO[tipo];
    const c = corpo as J;
    const envio = modelo === 'service-invoices' ? paraSpedyServico(c, ref, tipo === 'nfsen') : paraSpedySefaz(c, ref, tipo === 'nfe');
    const r = await this.chamar('POST', `/${modelo}`, envio);
    return { status: r.status, json: this.traduzir(modelo, r.json) };
  }

  async consultar(tipo: CaminhoFocus, ref: string): Promise<{ status: number; json: RespostaFocus }> {
    const modelo = MODELO[tipo];
    const n = await this.achar(modelo, ref);
    if (!n) return { status: 404, json: {} };
    return { status: 200, json: this.traduzir(modelo, n) };
  }

  async cancelar(tipo: CaminhoFocus, ref: string, justificativa: string): Promise<{ status: number; json: RespostaFocus }> {
    const modelo = MODELO[tipo];
    const n = await this.achar(modelo, ref);
    if (!n) throw new ErroFocus('A Spedy não encontrou esta nota.', 404);
    const r = await this.chamar('DELETE', `/${modelo}/${n.id}`, { reason: justificativa });
    // o cancelamento na Spedy é feito em seguida: enquanto não volta "canceled", fica aguardando
    return { status: r.status, json: this.traduzir(modelo, r.json?.id ? r.json : n, true) };
  }

  async cartaCorrecao(ref: string, correcao: string): Promise<{ status: number; json: RespostaFocus }> {
    const n = await this.achar('product-invoices', ref);
    if (!n) throw new ErroFocus('A Spedy não encontrou esta nota.', 404);
    await this.chamar('POST', `/product-invoices/${n.id}/corrections`, { letter: correcao });
    return { status: 200, json: { status: 'autorizado', numero_carta_correcao: undefined, caminho_pdf_carta_correcao: undefined } };
  }

  /** os arquivos da Spedy pedem a chave: o sistema entrega por um endereço próprio, assinado */
  arquivo(caminho: string | undefined | null) {
    if (!caminho) return null;
    return caminho.startsWith('spedy:') ? this.arquivoDe(caminho.slice(6)) : caminho;
  }

  /** baixa o PDF ou o XML (para o endereço próprio do sistema) */
  async baixar(caminho: string): Promise<{ tipo: string; dados: Buffer }> {
    if (!/^(consumer|product|service)-invoices\/[0-9a-f-]{36}\/(pdf|xml)$/i.test(caminho)) throw new ErroFocus('Arquivo inválido.');
    let resp: Response;
    try {
      resp = await fetch(`${this.base}/v1/${caminho}`, { headers: { 'X-Api-Key': this.chave }, signal: AbortSignal.timeout(60_000) });
    } catch { throw new ErroFocus('Não consegui falar com a Spedy agora.'); }
    if (!resp.ok) throw new ErroFocus(`A Spedy não entregou o arquivo (erro ${resp.status}).`, resp.status);
    return { tipo: caminho.endsWith('pdf') ? 'application/pdf' : 'application/xml', dados: Buffer.from(await resp.arrayBuffer()) };
  }
}

/** junta as mensagens de erro da Spedy (validação ou regra de negócio) */
export function mensagemSpedy(j: J | null | undefined): string {
  if (!j) return '';
  const partes: string[] = [];
  if (j.message) partes.push(String(j.message));
  if (j.title && !j.message) partes.push(String(j.title));
  if (j.detail) partes.push(String(j.detail));
  if (j.errors && typeof j.errors === 'object') {
    for (const [campo, v] of Object.entries(j.errors as J)) {
      const textos = Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : x?.message ?? JSON.stringify(x))) : [typeof v === 'string' ? v : (v as J)?.message ?? ''];
      for (const t of textos) if (t) partes.push(/^\d+$/.test(campo) ? t : `${campo}: ${t}`);
    }
  }
  return [...new Set(partes)].join(' · ');
}

/** assinatura do endereço de arquivo (não dá para trocar a nota nem a empresa sem saber o segredo) */
export function assinarArquivo(dados: string) {
  return createHmac('sha256', `${process.env.JWT_SECRET || 'vb'}|spedy-arquivo`).update(dados).digest('base64url').slice(0, 32);
}
