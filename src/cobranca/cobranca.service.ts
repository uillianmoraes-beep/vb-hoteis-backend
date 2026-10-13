import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'crypto';
import { UsuarioToken } from '../common/permissoes';
import { soDigitos } from '../common/cnpj';
import { FaturamentoService } from '../faturamento/faturamento.service';
import { Asaas, ErroAsaas, type AmbienteAsaas } from './asaas';

/** guardado em empresas.cobranca (a chave vai criptografada) */
interface ConfigCobranca {
  provedor?: 'asaas';
  ativo?: boolean;
  ambiente?: AmbienteAsaas;
  chaveCripto?: string;
  chaveFinal?: string;
  webhookToken?: string;
  webhookOk?: boolean;
  webhookErro?: string | null;
}

const FUSO = 'America/Sao_Paulo';
const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: FUSO });
const somaDias = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const dia = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10));
const linhas = (r: any) => (Array.isArray(r?.[0]) ? r[0] : r);

/** chave de criptografia derivada do segredo do servidor */
const chaveServidor = () => createHash('sha256').update(`vb-cobranca:${process.env.JWT_SECRET ?? ''}`).digest();
function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', chaveServidor(), iv);
  const enc = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return [iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}
function decifrar(t: string): string {
  const [iv, tag, enc] = t.split('.');
  const d = createDecipheriv('aes-256-gcm', chaveServidor(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString('utf8');
}

@Injectable()
export class CobrancaService {
  private readonly log = new Logger('Cobranca');
  constructor(private readonly ds: DataSource, private readonly faturamento: FaturamentoService) {}

  private async cfg(empresaId: string): Promise<ConfigCobranca> {
    const [e] = await this.ds.query(`SELECT cobranca FROM empresas WHERE id = $1`, [empresaId]);
    return (e?.cobranca ?? {}) as ConfigCobranca;
  }

  private async cliente(empresaId: string): Promise<Asaas> {
    const c = await this.cfg(empresaId);
    if (!c.ativo || !c.chaveCripto) throw new BadRequestException('Cobrança automática não está ligada. Configure em Cobrança automática (Asaas).');
    return new Asaas(decifrar(c.chaveCripto), c.ambiente ?? 'sandbox');
  }

  /** a cobrança automática está ligada nesta empresa? */
  async ativa(empresaId: string) {
    const c = await this.cfg(empresaId);
    return !!(c.ativo && c.chaveCripto);
  }

  private webhookUrl(base: string, empresaId: string) { return `${base.replace(/\/$/, '')}/publico/asaas/${empresaId}`; }

  // ---------------- configuração ----------------

  async config(u: UsuarioToken, base: string) {
    const c = await this.cfg(u.empresaId);
    return {
      provedor: 'asaas', ativo: !!c.ativo, ambiente: c.ambiente ?? 'sandbox', temChave: !!c.chaveCripto, chaveFinal: c.chaveFinal ?? null,
      webhookUrl: this.webhookUrl(base, u.empresaId), webhookOk: !!c.webhookOk, webhookErro: c.webhookErro ?? null,
      // só aparece enquanto o aviso automático não foi cadastrado, para configurar à mão no painel do Asaas
      webhookToken: c.webhookOk ? null : c.webhookToken ?? null,
    };
  }

  async salvarConfig(u: UsuarioToken, dto: { ativo: boolean; ambiente: AmbienteAsaas; chave?: string; email?: string }, base: string) {
    const atual = await this.cfg(u.empresaId);
    const nova: ConfigCobranca = { ...atual, provedor: 'asaas', ativo: dto.ativo, ambiente: dto.ambiente };
    const trocouAmbiente = atual.ambiente !== dto.ambiente;
    if (dto.chave?.trim()) {
      const chave = dto.chave.trim();
      await new Asaas(chave, dto.ambiente).testar().catch((e) => { throw new BadRequestException(e instanceof ErroAsaas ? e.message : 'Não consegui testar a chave.'); });
      nova.chaveCripto = cifrar(chave);
      nova.chaveFinal = chave.slice(-4);
      nova.webhookOk = false;
    } else if (trocouAmbiente) {
      nova.webhookOk = false;
    }
    if (dto.ativo && !nova.chaveCripto) throw new BadRequestException('Informe a chave de API do Asaas.');
    if (!nova.webhookToken) nova.webhookToken = randomBytes(24).toString('hex');
    // cadastra sozinho o aviso de pagamento (webhook) no Asaas
    if (dto.ativo && nova.chaveCripto && !nova.webhookOk) {
      try {
        const [emp] = await this.ds.query(`SELECT nome FROM empresas WHERE id = $1`, [u.empresaId]);
        await new Asaas(decifrar(nova.chaveCripto), dto.ambiente).criarWebhook({
          name: `VB Soluções Hoteleiras · ${emp?.nome ?? ''}`.slice(0, 60), url: this.webhookUrl(base, u.empresaId),
          email: dto.email?.trim() || 'virtualbarra.notificacoes@gmail.com', authToken: nova.webhookToken,
        });
        nova.webhookOk = true;
        nova.webhookErro = null;
      } catch (e) {
        nova.webhookOk = false;
        nova.webhookErro = e instanceof Error ? e.message : 'Não consegui cadastrar o aviso de pagamento.';
      }
    }
    await this.ds.query(`UPDATE empresas SET cobranca = $2::jsonb WHERE id = $1`, [u.empresaId, JSON.stringify(nova)]);
    return this.config(u, base);
  }

  /** marca o aviso como cadastrado à mão no painel do Asaas */
  async webhookManual(u: UsuarioToken) {
    const c = await this.cfg(u.empresaId);
    await this.ds.query(`UPDATE empresas SET cobranca = $2::jsonb WHERE id = $1`, [u.empresaId, JSON.stringify({ ...c, webhookOk: true, webhookErro: null })]);
    return { ok: true };
  }

  async listar(u: UsuarioToken) {
    const l = await this.ds.query(
      `SELECT c.*, f.numero AS fatura_numero, r.numero AS reserva_numero, COALESCE(cf.nome, r.hospede) AS pagador
         FROM cobrancas c
         LEFT JOIN faturas f ON c.tipo = 'fatura' AND f.id = c.referencia_id LEFT JOIN clientes_faturados cf ON cf.id = f.cliente_id
         LEFT JOIN reservas r ON c.tipo = 'reserva_sinal' AND r.id = c.referencia_id
        WHERE c.empresa_id = $1 ORDER BY c.criado_em DESC LIMIT 300`, [u.empresaId]);
    return l.map((c: Record<string, unknown>) => ({
      id: c.id, tipo: c.tipo, forma: c.forma, valor: Number(c.valor), vencimento: c.vencimento ? dia(c.vencimento) : null, status: c.status, link: c.link,
      pagoEm: c.pago_em, valorLiquido: c.valor_liquido === null ? null : Number(c.valor_liquido), criadoEm: c.criado_em, pagador: c.pagador,
      referencia: c.tipo === 'fatura' ? `Fatura nº ${c.fatura_numero ?? '—'}` : `Sinal da reserva nº ${c.reserva_numero ?? '—'}`,
    }));
  }

  // ---------------- fatura: boleto / Pix ----------------

  async gerarFatura(u: UsuarioToken, faturaId: string, forma: 'BOLETO' | 'PIX') {
    const api = await this.cliente(u.empresaId);
    const [f] = await this.ds.query(
      `SELECT f.*, c.nome, c.documento, c.email, c.telefone, c.asaas_cliente FROM faturas f JOIN clientes_faturados c ON c.id = f.cliente_id
        WHERE f.id = $1 AND f.empresa_id = $2`, [faturaId, u.empresaId]);
    if (!f) throw new NotFoundException('Fatura não encontrada.');
    if (f.status !== 'aberta') throw new BadRequestException('Fatura já paga ou cancelada.');
    const [ja] = await this.ds.query(`SELECT id FROM cobrancas WHERE tipo = 'fatura' AND referencia_id = $1 AND status = 'pendente' LIMIT 1`, [faturaId]);
    if (ja) throw new BadRequestException('Esta fatura já tem uma cobrança gerada. Cancele a cobrança antes de gerar outra.');
    const doc = soDigitos(f.documento);
    if (doc.length !== 11 && doc.length !== 14) throw new BadRequestException(`O cliente ${f.nome} precisa ter CPF ou CNPJ no cadastro para gerar boleto/Pix.`);
    try {
      let clienteAsaas = f.asaas_cliente as string | null;
      if (!clienteAsaas) {
        const c = await api.criarCliente({ name: f.nome, cpfCnpj: doc, email: f.email || null, mobilePhone: soDigitos(f.telefone) || null, externalReference: `cliente:${f.cliente_id}` });
        clienteAsaas = c.id;
        await this.ds.query(`UPDATE clientes_faturados SET asaas_cliente = $2 WHERE id = $1`, [f.cliente_id, clienteAsaas]);
      }
      const venc = dia(f.vencimento) < hojeSP() ? somaDias(hojeSP(), 1) : dia(f.vencimento);
      const p = await api.criarCobranca({
        customer: clienteAsaas, billingType: forma, value: Number(f.valor), dueDate: venc,
        description: `Fatura nº ${f.numero ?? ''}`.trim(), externalReference: `fatura:${faturaId}`,
      });
      let linha: string | null = null; let nosso: string | null = null;
      if (forma === 'BOLETO') {
        const l = await api.linhaDigitavel(p.id).catch(() => null);
        linha = l?.identificationField ?? null; nosso = l?.nossoNumero ?? null;
      }
      const pix = await api.pix(p.id).catch(() => null);
      const link = p.bankSlipUrl || p.invoiceUrl || null;
      await this.ds.query(
        `INSERT INTO cobrancas (empresa_id, externo_id, tipo, referencia_id, forma, valor, vencimento, linha, link, pix_copia_cola, pix_imagem, criado_por)
         VALUES ($1,$2,'fatura',$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [u.empresaId, p.id, faturaId, forma, Number(f.valor).toFixed(2), venc, linha, link, pix?.payload ?? null, pix?.encodedImage ?? null, u.nome]);
      await this.ds.query(
        `UPDATE faturas SET boleto_linha = COALESCE($3, boleto_linha), boleto_nosso_numero = COALESCE($4, boleto_nosso_numero), boleto_link = $5, vencimento = $6
          WHERE id = $1 AND empresa_id = $2`, [faturaId, u.empresaId, linha ?? (forma === 'PIX' ? pix?.payload?.slice(0, 120) ?? null : null), nosso, link, venc]);
      await this.ds.query(`UPDATE contas_receber SET vencimento = $2 WHERE fatura_id = $1 AND status = 'aberta'`, [faturaId, venc]);
      return { ok: true, link, linha, pix: pix?.payload ?? null };
    } catch (e) {
      if (e instanceof ErroAsaas) throw new BadRequestException(e.message);
      throw e;
    }
  }

  /** cobrança atual da fatura (para a tela e a impressão) */
  async daFatura(u: UsuarioToken, faturaId: string) {
    const [c] = await this.ds.query(
      `SELECT id, forma, valor, vencimento, status, linha, link, pix_copia_cola, pix_imagem, pago_em FROM cobrancas
        WHERE empresa_id = $1 AND tipo = 'fatura' AND referencia_id = $2 ORDER BY criado_em DESC LIMIT 1`, [u.empresaId, faturaId]);
    if (!c) return null;
    return { id: c.id, forma: c.forma, valor: Number(c.valor), vencimento: c.vencimento ? dia(c.vencimento) : null, status: c.status, linha: c.linha, link: c.link, pix: c.pix_copia_cola, pixImagem: c.pix_imagem, pagoEm: c.pago_em };
  }

  async cancelar(u: UsuarioToken, id: string) {
    const [c] = await this.ds.query(`SELECT * FROM cobrancas WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!c) throw new NotFoundException('Cobrança não encontrada.');
    if (c.status !== 'pendente' && c.status !== 'vencida') throw new BadRequestException('Só dá para cancelar cobrança em aberto.');
    const api = await this.cliente(u.empresaId);
    await api.cancelar(c.externo_id).catch((e) => { if (e instanceof ErroAsaas && !/não encontrad|removid/i.test(e.message)) throw new BadRequestException(e.message); });
    await this.ds.query(`UPDATE cobrancas SET status = 'cancelada' WHERE id = $1`, [id]);
    if (c.tipo === 'fatura') await this.ds.query(`UPDATE faturas SET boleto_linha = NULL, boleto_nosso_numero = NULL, boleto_link = NULL WHERE id = $1 AND status = 'aberta'`, [c.referencia_id]);
    return { ok: true };
  }

  // ---------------- sinal da reserva online (Pix) ----------------

  /** cria o Pix do sinal; devolve null se não der (a reserva continua feita) */
  async pixReserva(empresaId: string, r: { reservaId: string; numero: number | null; nome: string; cpf: string; telefone: string; email?: string | null; valor: number }) {
    try {
      const api = await this.cliente(empresaId);
      const c = await api.criarCliente({ name: r.nome, cpfCnpj: soDigitos(r.cpf), email: r.email || null, mobilePhone: soDigitos(r.telefone) || null, externalReference: `reserva:${r.reservaId}` });
      const venc = somaDias(hojeSP(), 1);
      const p = await api.criarCobranca({ customer: c.id, billingType: 'PIX', value: r.valor, dueDate: venc, description: `Sinal da reserva nº ${r.numero ?? ''}`.trim(), externalReference: `reserva:${r.reservaId}` });
      const pix = await api.pix(p.id);
      await this.ds.query(
        `INSERT INTO cobrancas (empresa_id, externo_id, tipo, referencia_id, forma, valor, vencimento, link, pix_copia_cola, pix_imagem, criado_por)
         VALUES ($1,$2,'reserva_sinal',$3,'PIX',$4,$5,$6,$7,$8,'Reserva online')`,
        [empresaId, p.id, r.reservaId, r.valor.toFixed(2), venc, p.invoiceUrl ?? null, pix.payload, pix.encodedImage]);
      return { valor: r.valor, copiaECola: pix.payload, imagem: pix.encodedImage, vencimento: venc };
    } catch (e) {
      this.log.warn(`Pix da reserva ${r.reservaId} não gerado: ${e instanceof Error ? e.message : e}`);
      return null;
    }
  }

  // ---------------- aviso de pagamento (webhook do Asaas) ----------------

  async webhook(empresaId: string, token: string | undefined, corpo: { event?: string; payment?: { id?: string; status?: string; value?: number; netValue?: number; billingType?: string; paymentDate?: string | null; clientPaymentDate?: string | null } }) {
    if (!/^[0-9a-f-]{36}$/i.test(empresaId)) throw new NotFoundException();
    const c = await this.cfg(empresaId);
    const a = Buffer.from(token ?? '');
    const b = Buffer.from(c.webhookToken ?? '');
    if (!c.webhookToken || a.length !== b.length || !timingSafeEqual(a, b)) throw new ForbiddenException('Token inválido.');
    const ev = corpo?.event ?? '';
    const pag = corpo?.payment;
    if (!pag?.id) return { ok: true };
    const [cob] = await this.ds.query(`SELECT * FROM cobrancas WHERE empresa_id = $1 AND provedor = 'asaas' AND externo_id = $2`, [empresaId, pag.id]);
    if (!cob) return { ok: true, ignorado: true };

    if (ev === 'PAYMENT_OVERDUE' && cob.status === 'pendente') {
      await this.ds.query(`UPDATE cobrancas SET status = 'vencida' WHERE id = $1`, [cob.id]);
      return { ok: true };
    }
    if ((ev === 'PAYMENT_DELETED' || ev === 'PAYMENT_REFUNDED') && cob.status !== 'cancelada') {
      await this.ds.query(`UPDATE cobrancas SET status = $2 WHERE id = $1`, [cob.id, ev === 'PAYMENT_REFUNDED' ? 'estornada' : 'cancelada']);
      return { ok: true };
    }
    if (ev !== 'PAYMENT_RECEIVED' && ev !== 'PAYMENT_CONFIRMED') return { ok: true };

    // marca como paga uma vez só (o Asaas pode avisar CONFIRMED e depois RECEIVED)
    const res = await this.ds.query(
      `UPDATE cobrancas SET status = 'paga', pago_em = now(), valor_liquido = $2 WHERE id = $1 AND status IN ('pendente','vencida') RETURNING id`,
      [cob.id, pag.netValue ?? null]);
    if (!linhas(res).length) return { ok: true, jaPaga: true };

    const pagoEm = (pag.clientPaymentDate || pag.paymentDate || hojeSP()).slice(0, 10);
    const sistema = { sub: null as unknown as string, empresaId, perfilId: null as unknown as string, nome: 'Asaas (automático)', permissoes: [], ambientesIds: [] } as unknown as UsuarioToken;
    if (cob.tipo === 'fatura') {
      await this.faturamento.baixarFatura(sistema, cob.referencia_id, { forma: cob.forma === 'PIX' || pag.billingType === 'PIX' ? 'pix' : 'boleto', pagoEm })
        .catch((e) => this.log.warn(`Fatura ${cob.referencia_id} não baixada: ${e instanceof Error ? e.message : e}`));
    } else if (cob.tipo === 'reserva_sinal') {
      // sinal pago: soma no sinal, confirma a reserva e faz o quarto piscar de novo
      await this.ds.query(
        `UPDATE reservas SET sinal = sinal + $3, sinal_forma = 'pix', status = CASE WHEN status = 'pendente' THEN 'confirmada' ELSE status END,
                vista_em = NULL, atualizado_em = now() WHERE id = $1 AND empresa_id = $2`,
        [cob.referencia_id, empresaId, Number(cob.valor).toFixed(2)]);
    }
    return { ok: true };
  }
}
