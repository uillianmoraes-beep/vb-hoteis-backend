import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { BaixaDto, BoletoDto, ClienteFaturadoDto, CreditoDto, GerarFaturaDto, LancamentoManualDto } from './faturamento.dto';
import { UsuarioToken } from '../common/permissoes';

const FUSO = 'America/Sao_Paulo';
const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: FUSO });
const dia = (v: unknown) => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const somaDias = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const brl = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`;
const NOME_FORMA: Record<string, string> = { boleto: 'boleto', pix: 'Pix', transferencia: 'transferência', dinheiro: 'dinheiro', debito: 'débito', credito: 'crédito', credito_cliente: 'crédito do cliente' };
/** forma que vai para o caixa ADM (boleto e transferência entram como as próprias formas) */
const formaCaixa = (f: string) => f;

const fmtCliente = (c: Record<string, unknown>) => ({
  id: c.id, nome: c.nome, documento: c.documento, contato: c.contato, telefone: c.telefone, email: c.email, endereco: c.endereco,
  prazoDias: c.prazo_dias, limite: c.limite === null ? null : Number(c.limite), observacao: c.observacao, ativo: c.ativo,
  devendo: Number(c.devendo ?? 0), vencido: Number(c.vencido ?? 0), credito: Number(c.credito ?? 0),
});
const fmtConta = (r: Record<string, unknown>) => ({
  id: r.id, clienteId: r.cliente_id, cliente: r.cliente_nome ?? null, estadiaId: r.estadia_id, faturaId: r.fatura_id, faturaNumero: r.fatura_numero ?? null,
  descricao: r.descricao, valor: Number(r.valor), vencimento: dia(r.vencimento), status: r.status, pagoEm: dia(r.pago_em), formaPagamento: r.forma_pagamento,
  pagoPor: r.pago_por, criadoPor: r.criado_por, criadoEm: r.criado_em,
});
const fmtFatura = (f: Record<string, unknown>) => ({
  id: f.id, numero: f.numero, clienteId: f.cliente_id, cliente: f.cliente_nome ?? null, emissao: dia(f.emissao), vencimento: dia(f.vencimento), valor: Number(f.valor),
  status: f.status, boletoLinha: f.boleto_linha, boletoNossoNumero: f.boleto_nosso_numero, boletoLink: f.boleto_link, observacao: f.observacao,
  pagoEm: dia(f.pago_em), valorPago: f.valor_pago === null ? null : Number(f.valor_pago), formaPagamento: f.forma_pagamento, pagoPor: f.pago_por,
  criadoPor: f.criado_por, qtd: f.qtd === undefined ? undefined : Number(f.qtd),
});

const SQL_SALDOS = `
  LEFT JOIN LATERAL (SELECT COALESCE(SUM(valor),0) AS devendo, COALESCE(SUM(valor) FILTER (WHERE vencimento < $2::date),0) AS vencido
                       FROM contas_receber r WHERE r.cliente_id = c.id AND r.status = 'aberta') d ON true
  LEFT JOIN LATERAL (SELECT COALESCE(SUM(CASE WHEN tipo = 'entrada' THEN valor ELSE -valor END),0) AS credito
                       FROM clientes_creditos k WHERE k.cliente_id = c.id) k ON true`;

@Injectable()
export class FaturamentoService {
  constructor(private readonly ds: DataSource) {}

  /* ---------------- clientes ---------------- */

  async clientes(u: UsuarioToken, todos = false) {
    const l = await this.ds.query(
      `SELECT c.*, d.devendo, d.vencido, k.credito FROM clientes_faturados c ${SQL_SALDOS}
        WHERE c.empresa_id = $1 ${todos ? '' : 'AND c.ativo = true'} ORDER BY c.nome`, [u.empresaId, hojeSP()]);
    return l.map(fmtCliente);
  }

  /** lista curta para escolher o cliente ao fechar a conta como faturado */
  async clientesSimples(u: UsuarioToken) {
    const l = await this.ds.query(`SELECT id, nome, documento FROM clientes_faturados WHERE empresa_id = $1 AND ativo = true ORDER BY nome`, [u.empresaId]);
    return l.map((c: Record<string, unknown>) => ({ id: c.id, nome: c.nome, documento: c.documento }));
  }

  private valoresCliente(dto: ClienteFaturadoDto) {
    return [dto.nome.trim(), dto.documento?.replace(/[^\dA-Za-z]/g, '') || null, dto.contato?.trim() || null, dto.telefone?.trim() || null,
      dto.email?.trim() || null, dto.endereco?.trim() || null, dto.prazoDias ?? 30, dto.limite === null || dto.limite === undefined ? null : dto.limite.toFixed(2),
      dto.observacao?.trim() || null, dto.ativo ?? true];
  }

  async criarCliente(u: UsuarioToken, dto: ClienteFaturadoDto) {
    const [c] = await this.ds.query(
      `INSERT INTO clientes_faturados (empresa_id, nome, documento, contato, telefone, email, endereco, prazo_dias, limite, observacao, ativo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`, [u.empresaId, ...this.valoresCliente(dto)]);
    return { ok: true, id: c.id };
  }

  async atualizarCliente(u: UsuarioToken, id: string, dto: ClienteFaturadoDto) {
    await this.cliente(u, id);
    await this.ds.query(
      `UPDATE clientes_faturados SET nome=$3, documento=$4, contato=$5, telefone=$6, email=$7, endereco=$8, prazo_dias=$9, limite=$10, observacao=$11, ativo=$12
        WHERE id=$1 AND empresa_id=$2`, [id, u.empresaId, ...this.valoresCliente(dto)]);
    return { ok: true };
  }

  private async cliente(u: UsuarioToken, id: string, m: EntityManager | DataSource = this.ds) {
    const [c] = await m.query(`SELECT * FROM clientes_faturados WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!c) throw new NotFoundException('Cliente não encontrado.');
    return c;
  }

  private async saldoCredito(m: EntityManager | DataSource, clienteId: string) {
    const [k] = await m.query(`SELECT COALESCE(SUM(CASE WHEN tipo = 'entrada' THEN valor ELSE -valor END),0) AS s FROM clientes_creditos WHERE cliente_id = $1`, [clienteId]);
    return Number(k?.s ?? 0);
  }

  async extrato(u: UsuarioToken, id: string) {
    const c = await this.cliente(u, id);
    const contas = await this.ds.query(
      `SELECT r.*, f.numero AS fatura_numero FROM contas_receber r LEFT JOIN faturas f ON f.id = r.fatura_id
        WHERE r.empresa_id = $1 AND r.cliente_id = $2 AND r.status <> 'cancelada' ORDER BY r.criado_em DESC LIMIT 500`, [u.empresaId, id]);
    const creditos = await this.ds.query(`SELECT * FROM clientes_creditos WHERE empresa_id = $1 AND cliente_id = $2 ORDER BY criado_em DESC LIMIT 300`, [u.empresaId, id]);
    return {
      cliente: fmtCliente({ ...c, credito: await this.saldoCredito(this.ds, id) }),
      contas: contas.map(fmtConta),
      creditos: creditos.map((k: Record<string, unknown>) => ({ id: k.id, tipo: k.tipo, valor: Number(k.valor), forma: k.forma, descricao: k.descricao, usuario: k.usuario_nome, em: k.criado_em })),
    };
  }

  /** crédito do cliente: pagou adiantado (entra no caixa ADM) ou devolução do saldo (sai do caixa ADM) */
  async credito(u: UsuarioToken, id: string, dto: CreditoDto) {
    const c = await this.cliente(u, id);
    await this.ds.transaction(async (m) => {
      if (dto.tipo === 'devolucao') {
        const saldo = await this.saldoCredito(m, id);
        if (dto.valor > saldo + 0.001) throw new BadRequestException(`O cliente só tem ${brl(saldo)} de crédito.`);
      }
      await m.query(`INSERT INTO clientes_creditos (empresa_id, cliente_id, tipo, valor, forma, descricao, usuario_nome) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [u.empresaId, id, dto.tipo, dto.valor.toFixed(2), dto.forma, dto.descricao?.trim() || (dto.tipo === 'entrada' ? 'Pagamento adiantado' : 'Devolução de crédito'), u.nome]);
      await this.caixaAdm(m, u, dto.tipo === 'entrada' ? 'entrada' : 'saida', dto.forma, dto.valor,
        `${dto.tipo === 'entrada' ? 'Crédito recebido' : 'Crédito devolvido'}: ${c.nome}${dto.descricao ? ` · ${dto.descricao.trim()}` : ''}`);
    });
    return { ok: true };
  }

  private async caixaAdm(m: EntityManager, u: UsuarioToken, tipo: 'entrada' | 'saida', forma: string, valor: number, descricao: string) {
    await m.query(
      `INSERT INTO caixa_movimentos (empresa_id, turno_id, caixa, tipo, forma, valor, descricao, categoria, usuario_id, usuario_nome) VALUES ($1, NULL, 'adm', $2, $3, $4, $5, 'Faturamento', $6, $7)`,
      [u.empresaId, tipo, formaCaixa(forma), valor.toFixed(2), descricao.slice(0, 300), u.sub, u.nome]);
  }

  /* ---------------- a receber ---------------- */

  /** chamado no fechamento da conta paga como "faturado" */
  async lancarDaConta(m: EntityManager, u: UsuarioToken, clienteId: string | null, estadiaId: string, valorCent: number, descricao: string) {
    let venc = somaDias(hojeSP(), 30);
    if (clienteId) {
      const c = await this.cliente(u, clienteId, m);
      if (!c.ativo) throw new BadRequestException(`O cliente ${c.nome} está inativo para faturamento.`);
      venc = somaDias(hojeSP(), Number(c.prazo_dias ?? 30));
      if (c.limite !== null) {
        const [d] = await m.query(`SELECT COALESCE(SUM(valor),0) AS s FROM contas_receber WHERE cliente_id = $1 AND status = 'aberta'`, [clienteId]);
        const novo = Number(d.s) + valorCent / 100;
        if (novo > Number(c.limite) + 0.001) throw new BadRequestException(`${c.nome} passaria do limite de faturamento (${brl(Number(c.limite))}; já deve ${brl(Number(d.s))}).`);
      }
    }
    await m.query(`INSERT INTO contas_receber (empresa_id, cliente_id, estadia_id, descricao, valor, vencimento, criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [u.empresaId, clienteId, estadiaId, descricao.slice(0, 250), (valorCent / 100).toFixed(2), venc, u.nome]);
  }

  async resumo(u: UsuarioToken) {
    const hoje = hojeSP();
    const [r] = await this.ds.query(
      `SELECT COALESCE(SUM(valor),0) AS aberto, COALESCE(SUM(valor) FILTER (WHERE vencimento < $2::date),0) AS vencido,
              COALESCE(SUM(valor) FILTER (WHERE vencimento BETWEEN $2::date AND $3::date),0) AS semana,
              COALESCE(SUM(valor) FILTER (WHERE cliente_id IS NULL),0) AS sem_cliente
         FROM contas_receber WHERE empresa_id = $1 AND status = 'aberta'`, [u.empresaId, hoje, somaDias(hoje, 7)]);
    const [k] = await this.ds.query(`SELECT COALESCE(SUM(CASE WHEN tipo = 'entrada' THEN valor ELSE -valor END),0) AS s FROM clientes_creditos WHERE empresa_id = $1`, [u.empresaId]);
    const [mes] = await this.ds.query(
      `SELECT COALESCE(SUM(valor),0) AS s FROM contas_receber WHERE empresa_id = $1 AND status = 'paga' AND pago_em >= date_trunc('month', $2::date)`, [u.empresaId, hoje]);
    return { hoje, aberto: Number(r.aberto), vencido: Number(r.vencido), proximos7: Number(r.semana), semCliente: Number(r.sem_cliente), creditos: Number(k.s), recebidoMes: Number(mes.s) };
  }

  async receber(u: UsuarioToken, f: { clienteId?: string; status?: string }) {
    const params: unknown[] = [u.empresaId];
    let where = `r.empresa_id = $1`;
    if (f.status === 'pagas') where += ` AND r.status = 'paga'`;
    else where += ` AND r.status = 'aberta'`;
    if (f.clienteId === 'sem') where += ` AND r.cliente_id IS NULL`;
    else if (f.clienteId) { params.push(f.clienteId); where += ` AND r.cliente_id = $${params.length}`; }
    const l = await this.ds.query(
      `SELECT r.*, c.nome AS cliente_nome, f.numero AS fatura_numero FROM contas_receber r
         LEFT JOIN clientes_faturados c ON c.id = r.cliente_id LEFT JOIN faturas f ON f.id = r.fatura_id
        WHERE ${where} ORDER BY ${f.status === 'pagas' ? 'r.pago_em DESC' : 'r.vencimento'}, r.criado_em LIMIT 2000`, params);
    return l.map(fmtConta);
  }

  async lancamentoManual(u: UsuarioToken, dto: LancamentoManualDto) {
    const c = await this.cliente(u, dto.clienteId);
    await this.ds.query(`INSERT INTO contas_receber (empresa_id, cliente_id, descricao, valor, vencimento, criado_por) VALUES ($1,$2,$3,$4,$5,$6)`,
      [u.empresaId, dto.clienteId, dto.descricao.trim(), dto.valor.toFixed(2), dto.vencimento ?? somaDias(hojeSP(), Number(c.prazo_dias ?? 30)), u.nome]);
    return { ok: true };
  }

  /** conta faturada sem cliente (ou no cliente errado): define o cliente */
  async definirCliente(u: UsuarioToken, id: string, clienteId: string) {
    const c = await this.cliente(u, clienteId);
    const [r] = await this.ds.query(`SELECT * FROM contas_receber WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!r) throw new NotFoundException('Lançamento não encontrado.');
    if (r.status !== 'aberta' || r.fatura_id) throw new BadRequestException('Só dá para trocar o cliente de lançamento em aberto e fora de fatura.');
    await this.ds.query(`UPDATE contas_receber SET cliente_id = $3, vencimento = GREATEST(vencimento, $4::date) WHERE id = $1 AND empresa_id = $2`,
      [id, u.empresaId, clienteId, somaDias(dia(r.criado_em) ?? hojeSP(), Number(c.prazo_dias ?? 30))]);
    return { ok: true };
  }

  async cancelarLancamento(u: UsuarioToken, id: string) {
    const [r] = await this.ds.query(`SELECT * FROM contas_receber WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!r) throw new NotFoundException('Lançamento não encontrado.');
    if (r.status !== 'aberta' || r.fatura_id) throw new BadRequestException('Só dá para cancelar lançamento em aberto e fora de fatura.');
    if (r.estadia_id) throw new BadRequestException('Este valor veio do fechamento de uma conta. Para mudar, corrija a forma de pagamento da conta.');
    await this.ds.query(`UPDATE contas_receber SET status = 'cancelada' WHERE id = $1`, [id]);
    return { ok: true };
  }

  /** recebe um lançamento avulso (fora de fatura) */
  async baixarLancamento(u: UsuarioToken, id: string, dto: BaixaDto) {
    await this.ds.transaction(async (m) => {
      const [r] = await m.query(`SELECT r.*, c.nome AS cliente_nome FROM contas_receber r LEFT JOIN clientes_faturados c ON c.id = r.cliente_id WHERE r.id = $1 AND r.empresa_id = $2 FOR UPDATE OF r`, [id, u.empresaId]);
      if (!r) throw new NotFoundException('Lançamento não encontrado.');
      if (r.status !== 'aberta') throw new BadRequestException('Este lançamento já foi recebido.');
      if (r.fatura_id) throw new BadRequestException('Este lançamento está numa fatura; receba pela fatura.');
      await this.receberValor(m, u, r.cliente_id, Number(r.valor), dto.forma, `Recebido: ${r.descricao}${r.cliente_nome ? ` · ${r.cliente_nome}` : ''}`);
      await m.query(`UPDATE contas_receber SET status='paga', pago_em=$2, forma_pagamento=$3, pago_por=$4 WHERE id=$1`, [id, dto.pagoEm ?? hojeSP(), dto.forma, u.nome]);
    });
    return { ok: true };
  }

  private async receberValor(m: EntityManager, u: UsuarioToken, clienteId: string | null, valor: number, forma: string, desc: string) {
    if (forma === 'credito_cliente') {
      if (!clienteId) throw new BadRequestException('Lançamento sem cliente não pode usar crédito.');
      const saldo = await this.saldoCredito(m, clienteId);
      if (valor > saldo + 0.001) throw new BadRequestException(`O cliente só tem ${brl(saldo)} de crédito.`);
      await m.query(`INSERT INTO clientes_creditos (empresa_id, cliente_id, tipo, valor, forma, descricao, usuario_nome) VALUES ($1,$2,'uso',$3,NULL,$4,$5)`,
        [u.empresaId, clienteId, valor.toFixed(2), desc.slice(0, 250), u.nome]);
    } else {
      await this.caixaAdm(m, u, 'entrada', forma, valor, desc);
    }
  }

  /* ---------------- faturas ---------------- */

  async gerarFatura(u: UsuarioToken, dto: GerarFaturaDto) {
    const c = await this.cliente(u, dto.clienteId);
    const id = await this.ds.transaction(async (m) => {
      const contas = await m.query(
        `SELECT id, valor FROM contas_receber WHERE empresa_id = $1 AND cliente_id = $2 AND status = 'aberta' AND fatura_id IS NULL AND id = ANY($3::uuid[]) FOR UPDATE`,
        [u.empresaId, dto.clienteId, dto.contas]);
      if (contas.length !== new Set(dto.contas).size) throw new BadRequestException('Algum lançamento já foi faturado, recebido ou é de outro cliente. Atualize a tela.');
      const valor = contas.reduce((s: number, r: Record<string, unknown>) => s + Math.round(Number(r.valor) * 100), 0) / 100;
      const n = await m.query('UPDATE empresas SET ultima_fatura = ultima_fatura + 1 WHERE id = $1 RETURNING ultima_fatura', [u.empresaId]);
      const linha = Array.isArray(n?.[0]) ? n[0][0] : n?.[0];
      const [f] = await m.query(
        `INSERT INTO faturas (empresa_id, numero, cliente_id, emissao, vencimento, valor, boleto_linha, boleto_nosso_numero, boleto_link, observacao, criado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [u.empresaId, linha ? Number(linha.ultima_fatura) : null, c.id, hojeSP(), dto.vencimento, valor.toFixed(2), dto.boletoLinha?.trim() || null,
          dto.boletoNossoNumero?.trim() || null, dto.boletoLink?.trim() || null, dto.observacao?.trim() || null, u.nome]);
      await m.query(`UPDATE contas_receber SET fatura_id = $2, vencimento = $3 WHERE id = ANY($1::uuid[])`, [dto.contas, f.id, dto.vencimento]);
      return f.id as string;
    });
    return { ok: true, id };
  }

  async faturas(u: UsuarioToken, f: { status?: string; clienteId?: string }) {
    const params: unknown[] = [u.empresaId];
    let where = `f.empresa_id = $1`;
    if (f.status === 'pagas') where += ` AND f.status = 'paga'`;
    else if (f.status === 'canceladas') where += ` AND f.status = 'cancelada'`;
    else where += ` AND f.status = 'aberta'`;
    if (f.clienteId) { params.push(f.clienteId); where += ` AND f.cliente_id = $${params.length}`; }
    const l = await this.ds.query(
      `SELECT f.*, c.nome AS cliente_nome, (SELECT count(*) FROM contas_receber r WHERE r.fatura_id = f.id) AS qtd
         FROM faturas f JOIN clientes_faturados c ON c.id = f.cliente_id WHERE ${where} ORDER BY f.vencimento DESC, f.numero DESC LIMIT 1000`, params);
    return l.map(fmtFatura);
  }

  async fatura(u: UsuarioToken, id: string) {
    const [f] = await this.ds.query(`SELECT f.*, c.nome AS cliente_nome FROM faturas f JOIN clientes_faturados c ON c.id = f.cliente_id WHERE f.id = $1 AND f.empresa_id = $2`, [id, u.empresaId]);
    if (!f) throw new NotFoundException('Fatura não encontrada.');
    const [c] = await this.ds.query(`SELECT * FROM clientes_faturados WHERE id = $1`, [f.cliente_id]);
    const [emp] = await this.ds.query(`SELECT * FROM empresas WHERE id = $1`, [u.empresaId]);
    const itens = await this.ds.query(
      `SELECT r.*, e.numero AS uso, e.entrada_em, e.saida_em, un.codigo AS unidade FROM contas_receber r
         LEFT JOIN estadias e ON e.id = r.estadia_id LEFT JOIN unidades un ON un.id = e.unidade_id
        WHERE r.fatura_id = $1 ORDER BY r.criado_em`, [id]);
    return {
      ...fmtFatura(f),
      clienteDados: fmtCliente(c),
      empresa: { nome: emp?.nome ?? '', documento: emp?.cnpj ?? emp?.documento ?? null, telefone: emp?.telefone ?? null, endereco: emp?.endereco ?? null },
      itens: itens.map((r: Record<string, unknown>) => ({ ...fmtConta(r), uso: r.uso, unidade: r.unidade, entradaEm: r.entrada_em, saidaEm: r.saida_em })),
    };
  }

  async boleto(u: UsuarioToken, id: string, dto: BoletoDto) {
    const [f] = await this.ds.query(`SELECT status FROM faturas WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!f) throw new NotFoundException('Fatura não encontrada.');
    if (f.status !== 'aberta') throw new BadRequestException('Fatura já paga ou cancelada.');
    await this.ds.query(
      `UPDATE faturas SET boleto_linha = $3, boleto_nosso_numero = $4, boleto_link = $5, vencimento = COALESCE($6::date, vencimento) WHERE id = $1 AND empresa_id = $2`,
      [id, u.empresaId, dto.boletoLinha?.trim() || null, dto.boletoNossoNumero?.trim() || null, dto.boletoLink?.trim() || null, dto.vencimento ?? null]);
    if (dto.vencimento) await this.ds.query(`UPDATE contas_receber SET vencimento = $2 WHERE fatura_id = $1`, [id, dto.vencimento]);
    return { ok: true };
  }

  async baixarFatura(u: UsuarioToken, id: string, dto: BaixaDto) {
    await this.ds.transaction(async (m) => {
      const [f] = await m.query(`SELECT f.*, c.nome AS cliente_nome FROM faturas f JOIN clientes_faturados c ON c.id = f.cliente_id WHERE f.id = $1 AND f.empresa_id = $2 FOR UPDATE OF f`, [id, u.empresaId]);
      if (!f) throw new NotFoundException('Fatura não encontrada.');
      if (f.status !== 'aberta') throw new BadRequestException('Esta fatura já foi paga ou cancelada.');
      const pagoEm = dto.pagoEm ?? hojeSP();
      await this.receberValor(m, u, f.cliente_id, Number(f.valor), dto.forma, `Fatura nº ${f.numero} paga (${NOME_FORMA[dto.forma] ?? dto.forma}) · ${f.cliente_nome}`);
      await m.query(`UPDATE faturas SET status='paga', pago_em=$2, valor_pago=valor, forma_pagamento=$3, pago_por=$4 WHERE id=$1`, [id, pagoEm, dto.forma, u.nome]);
      await m.query(`UPDATE contas_receber SET status='paga', pago_em=$2, forma_pagamento=$3, pago_por=$4 WHERE fatura_id=$1 AND status='aberta'`, [id, pagoEm, dto.forma, u.nome]);
    });
    return { ok: true };
  }

  async cancelarFatura(u: UsuarioToken, id: string) {
    const [f] = await this.ds.query(`SELECT status FROM faturas WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!f) throw new NotFoundException('Fatura não encontrada.');
    if (f.status !== 'aberta') throw new BadRequestException('Só dá para cancelar fatura em aberto.');
    await this.ds.transaction(async (m) => {
      await m.query(`UPDATE faturas SET status = 'cancelada' WHERE id = $1`, [id]);
      // os lançamentos voltam para "a receber", prontos para outra fatura
      await m.query(`UPDATE contas_receber SET fatura_id = NULL WHERE fatura_id = $1 AND status = 'aberta'`, [id]);
    });
    return { ok: true };
  }
}
