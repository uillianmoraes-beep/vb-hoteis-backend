/**
 * Cliente mínimo da API do Asaas (v3).
 * Docs: https://docs.asaas.com — header access_token, base api.asaas.com/v3 (sandbox: api-sandbox.asaas.com/v3).
 */
export type AmbienteAsaas = 'producao' | 'sandbox';

export class ErroAsaas extends Error {}

export class Asaas {
  private readonly base: string;
  constructor(private readonly chave: string, ambiente: AmbienteAsaas) {
    this.base = ambiente === 'producao' ? 'https://api.asaas.com/v3' : 'https://api-sandbox.asaas.com/v3';
  }

  private async chamar<T>(metodo: 'GET' | 'POST' | 'DELETE', caminho: string, corpo?: unknown): Promise<T> {
    let resp: { ok: boolean; status: number; text: () => Promise<string> };
    try {
      resp = await fetch(`${this.base}${caminho}`, {
        method: metodo,
        headers: { access_token: this.chave, 'Content-Type': 'application/json', 'User-Agent': 'VB-Solucoes-Hoteleiras/1.0' },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
      });
    } catch {
      throw new ErroAsaas('Não consegui falar com o Asaas agora. Tente de novo em instantes.');
    }
    const texto = await resp.text();
    let json: any = null;
    try { json = texto ? JSON.parse(texto) : null; } catch { /* resposta sem json */ }
    if (!resp.ok) {
      if (resp.status === 401) throw new ErroAsaas('O Asaas recusou a chave de API. Confira se copiou a chave certa (produção ou sandbox).');
      const msg = json?.errors?.map((e: { description?: string }) => e.description).filter(Boolean).join(' ') || `Erro ${resp.status} no Asaas.`;
      throw new ErroAsaas(`Asaas: ${msg}`);
    }
    return json as T;
  }

  testar() { return this.chamar<{ totalCount: number }>('GET', '/customers?limit=1'); }

  criarCliente(c: { name: string; cpfCnpj: string; email?: string | null; mobilePhone?: string | null; externalReference?: string }) {
    return this.chamar<{ id: string }>('POST', '/customers', c);
  }

  criarCobranca(p: { customer: string; billingType: 'BOLETO' | 'PIX'; value: number; dueDate: string; description?: string; externalReference?: string }) {
    return this.chamar<{ id: string; status: string; invoiceUrl?: string; bankSlipUrl?: string | null }>('POST', '/payments', p);
  }

  linhaDigitavel(id: string) {
    return this.chamar<{ identificationField: string; nossoNumero: string; barCode: string }>('GET', `/payments/${id}/identificationField`);
  }

  pix(id: string) {
    return this.chamar<{ encodedImage: string; payload: string; expirationDate?: string }>('GET', `/payments/${id}/pixQrCode`);
  }

  cobranca(id: string) {
    return this.chamar<{ id: string; status: string; value: number; netValue?: number; paymentDate?: string | null }>('GET', `/payments/${id}`);
  }

  cancelar(id: string) { return this.chamar<{ deleted: boolean }>('DELETE', `/payments/${id}`); }

  criarWebhook(w: { name: string; url: string; email: string; authToken: string }) {
    return this.chamar<{ id: string }>('POST', '/webhooks', {
      ...w, enabled: true, interrupted: false, apiVersion: 3, sendType: 'SEQUENTIALLY',
      events: ['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED', 'PAYMENT_OVERDUE', 'PAYMENT_DELETED', 'PAYMENT_REFUNDED'],
    });
  }
}
