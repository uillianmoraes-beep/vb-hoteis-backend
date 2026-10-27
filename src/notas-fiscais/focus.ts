/**
 * Cliente mínimo da API da Focus NFe (v2).
 * Docs: https://doc.focusnfe.com.br — autenticação HTTP Basic com o token da empresa como usuário e senha vazia;
 * base https://api.focusnfe.com.br (produção) ou https://homologacao.focusnfe.com.br (testes, sem valor fiscal).
 */
import { BadRequestException } from '@nestjs/common';

export type AmbienteFocus = 'producao' | 'homologacao';
export type CaminhoFocus = 'nfce' | 'nfe' | 'nfse' | 'nfsen';

/** erro da Focus: vira resposta 400 com a mensagem para a pessoa */
export class ErroFocus extends BadRequestException {
  constructor(mensagem: string, readonly statusFocus = 0, readonly corpo: unknown = null) { super(mensagem); }
}

/** resposta das consultas/emissões (os campos variam pelo tipo de nota) */
export interface RespostaFocus {
  status?: string;
  status_sefaz?: string;
  mensagem_sefaz?: string;
  numero?: string | number;
  serie?: string | number;
  chave_nfe?: string;
  codigo_verificacao?: string;
  caminho_xml_nota_fiscal?: string;
  caminho_danfe?: string;
  url?: string;
  url_danfse?: string;
  url_consulta_nf?: string;
  qrcode_url?: string;
  caminho_xml_cancelamento?: string;
  caminho_pdf_carta_correcao?: string;
  numero_carta_correcao?: number;
  erros?: { codigo?: string; mensagem?: string; correcao?: string; campo?: string }[];
  codigo?: string;
  mensagem?: string;
  [k: string]: unknown;
}

const BASES: Record<AmbienteFocus, string> = { producao: 'https://api.focusnfe.com.br', homologacao: 'https://homologacao.focusnfe.com.br' };
/** endereço base (FOCUS_URL_HOMOLOGACAO / FOCUS_URL_PRODUCAO trocam o endereço, para testes locais) */
export const baseFocus = (a: AmbienteFocus) =>
  (a === 'producao' ? process.env.FOCUS_URL_PRODUCAO : process.env.FOCUS_URL_HOMOLOGACAO) || BASES[a];

/** junta a mensagem de erro da Focus num texto só */
export function mensagemFocus(j: RespostaFocus | null | undefined): string {
  if (!j) return '';
  const partes = [
    j.mensagem_sefaz && j.status_sefaz && j.status !== 'autorizado' ? `${j.mensagem_sefaz}` : '',
    j.mensagem ?? '',
    ...(j.erros ?? []).map((e) => [e.mensagem, e.correcao ? `(${e.correcao})` : ''].filter(Boolean).join(' ')),
  ].filter(Boolean);
  return [...new Set(partes)].join(' · ');
}

export class Focus {
  readonly base: string;
  constructor(private readonly token: string, readonly ambiente: AmbienteFocus) {
    this.base = baseFocus(ambiente);
  }

  private async chamar<T = RespostaFocus>(metodo: 'GET' | 'POST' | 'DELETE', caminho: string, corpo?: unknown): Promise<{ status: number; json: T }> {
    let resp: Response;
    try {
      resp = await fetch(`${this.base}/v2${caminho}`, {
        method: metodo,
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.token}:`).toString('base64')}`,
          'Content-Type': 'application/json',
          'User-Agent': 'VB-Solucoes-Hoteleiras/1.0',
        },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      throw new ErroFocus('Não consegui falar com a Focus NFe agora. Tente de novo em instantes.');
    }
    const texto = await resp.text();
    let json: any = null;
    try { json = texto ? JSON.parse(texto) : null; } catch { /* resposta sem json */ }
    if (resp.status === 401) throw new ErroFocus('A Focus recusou o token. Confira se copiou o token certo (de homologação ou de produção) desta empresa.', 401);
    if (resp.status === 404 && metodo !== 'GET') throw new ErroFocus('A Focus não encontrou esta nota.', 404, json);
    if (resp.status >= 400 && resp.status !== 404) {
      throw new ErroFocus(`Focus: ${mensagemFocus(json) || `erro ${resp.status}`}`, resp.status, json);
    }
    return { status: resp.status, json: (json ?? {}) as T };
  }

  /** confere o token: uma consulta de nota que não existe responde 404 (token bom) ou 401 (token errado) */
  async testar() {
    const r = await this.chamar('GET', `/nfce/teste-conexao-vb-${Date.now()}`);
    return r.status === 404 || r.status === 200;
  }

  emitir(tipo: CaminhoFocus, ref: string, corpo: unknown) {
    return this.chamar('POST', `/${tipo}?ref=${encodeURIComponent(ref)}`, corpo);
  }

  consultar(tipo: CaminhoFocus, ref: string) {
    return this.chamar('GET', `/${tipo}/${encodeURIComponent(ref)}`);
  }

  cancelar(tipo: CaminhoFocus, ref: string, justificativa: string) {
    return this.chamar('DELETE', `/${tipo}/${encodeURIComponent(ref)}`, { justificativa });
  }

  cartaCorrecao(ref: string, correcao: string) {
    return this.chamar('POST', `/nfe/${encodeURIComponent(ref)}/carta_correcao`, { correcao });
  }

  /** endereço completo de um arquivo (a Focus devolve o caminho sem o começo) */
  arquivo(caminho: string | undefined | null) {
    if (!caminho) return null;
    return /^https?:\/\//.test(caminho) ? caminho : `${this.base}${caminho}`;
  }
}
