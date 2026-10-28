import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomBytes, timingSafeEqual } from 'crypto';
import { cifrar, decifrar } from '../common/cripto';
import { UsuarioToken } from '../common/permissoes';
import { soDigitos } from '../common/cnpj';
import { FaturamentoService } from '../faturamento/faturamento.service';
import { Asaas, ErroAsaas, type AmbienteAsaas } from './asaas';
import { enviarParaLocal } from '../servidor-local/ponte.core';

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

  private webhookUrl(base: string, empresaId: string) {
    // no servidor local o Asaas avisa a nuvem, que repassa pela ponte
    const b = (process.env.VB_MODO || '').toLowerCase() === 'local' ? (process.env.VB_NUVEM_URL || 'https://vb-hoteis-backend-production.up.railway.app') : base;
    return `${b.replace(/\/$/, '')}/api/publico/asaas/${empresaId}`;
  }

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

  /**
   * Faturar num clique: junta o que o cliente deve (fora de fatura), faz uma fatura por CNPJ,
   * gera o boleto/Pix no Asaas (quando ligado), deixa a nota pendente e devolve o texto para mandar.
   * Quando o Asaas avisar o pagamento, a fatura baixa sozinha (webhook).
   */
  async faturarCliente(u: UsuarioToken, clienteId: string, dto: { contas?: string[]; vencimento?: string; cobrar: 'BOLETO' | 'PIX' | 'nao'; nota?: boolean; observacao?: string }) {
    const [c] = await this.ds.query(`SELECT id, nome, prazo_dias FROM clientes_faturados WHERE id = $1 AND empresa_id = $2`, [clienteId, u.empresaId]);
    if (!c) throw new NotFoundException('Cliente não encontrado.');
    const abertas: { id: string; cnpj: string | null }[] = await this.ds.query(
      `SELECT id, cnpj FROM contas_receber WHERE empresa_id = $1 AND cliente_id = $2 AND status = 'aberta' AND fatura_id IS NULL ${dto.contas?.length ? 'AND id = ANY($3::uuid[])' : ''} ORDER BY criado_em`,
      dto.contas?.length ? [u.empresaId, clienteId, dto.contas] : [u.empresaId, clienteId]);
    if (!abertas.length) throw new BadRequestException(`${c.nome} não tem nada em aberto para faturar.`);
    const vencimento = dto.vencimento ?? somaDias(hojeSP(), Number(c.prazo_dias) > 0 ? Number(c.prazo_dias) : 7);
    if (vencimento < hojeSP()) throw new BadRequestException('O vencimento não pode ser antes de hoje.');
    const asaas = dto.cobrar !== 'nao' && (await this.ativa(u.empresaId));
    // uma fatura por CNPJ (motel e hotel têm nota e boleto separados)
    const grupos = new Map<string, string[]>();
    for (const a of abertas) grupos.set(a.cnpj ?? '', [...(grupos.get(a.cnpj ?? '') ?? []), a.id]);
    const feitas: { id: string; numero: number | null; valor: number; cobranca: { link: string | null; linha: string | null; pix: string | null } | null; aviso: string | null }[] = [];
    for (const ids of grupos.values()) {
      const { id } = await this.faturamento.gerarFatura(u, { clienteId, contas: ids, vencimento, observacao: dto.observacao });
      if (dto.nota) await this.ds.query(`UPDATE faturas SET nota_status = 'pendente' WHERE id = $1`, [id]);
      const [f] = await this.ds.query(`SELECT numero, valor FROM faturas WHERE id = $1`, [id]);
      let cobranca: { link: string | null; linha: string | null; pix: string | null } | null = null;
      let aviso: string | null = null;
      if (dto.cobrar !== 'nao' && !asaas) aviso = 'Boleto/Pix automático desligado (Asaas). A fatura foi feita; coloque o boleto à mão ou ligue em Ajustes → Cobrança.';
      if (asaas) {
        try { const r = await this.gerarFatura(u, id, dto.cobrar as 'BOLETO' | 'PIX'); cobranca = { link: r.link, linha: r.linha, pix: r.pix }; }
        catch (e) { aviso = `Fatura feita, mas o boleto não saiu: ${e instanceof Error ? e.message : String(e)}`; }
      }
      feitas.push({ id, numero: f?.numero ?? null, valor: Number(f?.valor ?? 0), cobranca, aviso });
    }
    const envios = await Promise.all(feitas.map((f) => this.envio(u, f.id)));
    return { ok: true, vencimento, faturas: feitas.map((f, i) => ({ ...f, envio: envios[i] })) };
  }

  /**
   * Conta fechada como faturado para um cliente com "faturar sozinho" ligado: fatura só com esta conta,
   * boleto/Pix (se o Asaas estiver ligado) e nota pendente, na hora. Sem cliente com isso ligado, não faz nada.
   */
  async faturarConta(u: UsuarioToken, estadiaId: string) {
    const l: { id: string; cliente_id: string; nome: string; auto_cobrar: string }[] = await this.ds.query(
      `SELECT r.id, r.cliente_id, c.nome, c.auto_cobrar FROM contas_receber r JOIN clientes_faturados c ON c.id = r.cliente_id
        WHERE r.empresa_id = $1 AND r.estadia_id = $2 AND r.status = 'aberta' AND r.fatura_id IS NULL AND c.auto_faturar AND c.ativo`, [u.empresaId, estadiaId]);
    if (!l.length) return { feito: false };
    const porCliente = new Map<string, typeof l>();
    for (const x of l) porCliente.set(x.cliente_id, [...(porCliente.get(x.cliente_id) ?? []), x]);
    const resultado: { cliente: string; faturas: Awaited<ReturnType<CobrancaService['faturarCliente']>>['faturas'] }[] = [];
    for (const [clienteId, contas] of porCliente) {
      const cobrar = (['BOLETO', 'PIX'].includes(contas[0].auto_cobrar) ? contas[0].auto_cobrar : 'nao') as 'BOLETO' | 'PIX' | 'nao';
      const r = await this.faturarCliente(u, clienteId, { contas: contas.map((c) => c.id), cobrar, nota: true });
      resultado.push({ cliente: contas[0].nome, faturas: r.faturas });
    }
    return { feito: true, resultado };
  }

  /** texto pronto para mandar a fatura por WhatsApp ou e-mail */
  async envio(u: UsuarioToken, faturaId: string) {
    const [f] = await this.ds.query(
      `SELECT f.*, c.nome, c.contato, c.telefone, c.email, e.nome AS empresa FROM faturas f JOIN clientes_faturados c ON c.id = f.cliente_id JOIN empresas e ON e.id = f.empresa_id
        WHERE f.id = $1 AND f.empresa_id = $2`, [faturaId, u.empresaId]);
    if (!f) throw new NotFoundException('Fatura não encontrada.');
    const cob = await this.daFatura(u, faturaId);
    const valor = Number(f.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const venc = dia(f.vencimento).split('-').reverse().join('/');
    const linhasTexto = [
      `Olá${f.contato ? `, ${String(f.contato).split(' ')[0]}` : ''}! Segue a fatura nº ${f.numero ?? ''} de ${f.empresa}.`,
      `Valor: ${valor} · vencimento ${venc}.`,
      cob?.link ? `Boleto / pagamento: ${cob.link}` : f.boleto_link ? `Boleto: ${f.boleto_link}` : '',
      cob?.linha || f.boleto_linha ? `Linha digitável: ${cob?.linha ?? f.boleto_linha}` : '',
      cob?.pix ? `Pix copia e cola: ${cob.pix}` : '',
      f.nota_numero ? `Nota fiscal nº ${f.nota_numero}.` : '',
      'Qualquer dúvida, estamos à disposição. Obrigado!',
    ].filter(Boolean);
    const texto = linhasTexto.join('\n');
    const fone = soDigitos(f.telefone);
    return {
      texto, telefone: f.telefone ?? null, email: f.email ?? null,
      whatsapp: fone.length >= 10 ? `https://wa.me/${fone.length <= 11 ? `55${fone}` : fone}?text=${encodeURIComponent(texto)}` : null,
      mailto: f.email ? `mailto:${f.email}?subject=${encodeURIComponent(`Fatura nº ${f.numero ?? ''} · ${f.empresa}`)}&body=${encodeURIComponent(texto)}` : null,
    };
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
    // empresa com servidor local: o aviso vai para o servidor local processar
    if (await enviarParaLocal(this.ds, empresaId, 'asaas', corpo)) return { ok: true, encaminhado: true };
    return this.processarPagamento(empresaId, corpo);
  }

  /** aplica o aviso do Asaas (chamado direto ou pelo servidor local ao buscar os eventos da nuvem) */
  async processarPagamento(empresaId: string, corpo: { event?: string; payment?: { id?: string; status?: string; value?: number; netValue?: number; billingType?: string; paymentDate?: string | null; clientPaymentDate?: string | null } }) {
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
    if (cob.tipo === 'mensalidade') {
      // mensalidade do sistema (revenda): baixa e libera o cliente se estava atrasado ou bloqueado
      const [pagas] = await this.ds.query(
        `UPDATE mensalidades SET situacao = 'paga', pago_em = now(), forma_pagamento = $2 WHERE id = $1 AND situacao = 'pendente' RETURNING empresa_id`,
        [cob.referencia_id, pag.billingType === 'PIX' ? 'pix' : 'boleto']);
      const cliente = (pagas as { empresa_id: string }[] | undefined)?.[0]?.empresa_id;
      if (cliente) {
        const [aberta] = await this.ds.query(`SELECT 1 FROM mensalidades WHERE empresa_id = $1 AND situacao = 'pendente' AND vencimento < CURRENT_DATE LIMIT 1`, [cliente]);
        if (!aberta) await this.ds.query(`UPDATE empresas SET situacao = 'ativa' WHERE id = $1 AND situacao IN ('atrasada','bloqueada') AND plano_id IS NOT NULL`, [cliente]);
      }
      return { ok: true };
    }
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
