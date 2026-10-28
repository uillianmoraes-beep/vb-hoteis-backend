import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AprovarContasDto, ContaPagarDto, ImportarNfeDto, PagarContaDto } from './despesas.dto';
import { UsuarioToken } from '../common/permissoes';
import { randomUUID } from 'crypto';
import { cnpjDoForm, filtroCnpj } from '../common/cnpj';

const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const fmt = (v: Record<string, unknown>) => ({
  id: v.id, descricao: v.descricao, fornecedor: v.fornecedor, categoria: v.categoria, valor: Number(v.valor),
  vencimento: v.vencimento instanceof Date ? v.vencimento.toISOString().slice(0, 10) : String(v.vencimento).slice(0, 10),
  status: v.status, recorrente: v.recorrente, pagoEm: v.pago_em ? (v.pago_em instanceof Date ? v.pago_em.toISOString().slice(0, 10) : String(v.pago_em).slice(0, 10)) : null,
  valorPago: v.valor_pago === null ? null : Number(v.valor_pago), formaPagamento: v.forma_pagamento, codigoBarras: v.codigo_barras,
  observacao: v.observacao, criadoPor: v.criado_por, pagoPor: v.pago_por,
  valorVariavel: !!v.valor_variavel, valorConfirmado: v.valor_confirmado !== false, chaveNfe: v.chave_nfe ?? null, cnpj: v.cnpj ?? null,
  aprovacao: v.aprovacao ?? 'aprovada', loteId: v.lote_id ?? null, notaTotal: v.nota_total === null || v.nota_total === undefined ? null : Number(v.nota_total),
  aprovadoPor: v.aprovado_por ?? null, motivoRecusa: v.motivo_recusa ?? null,
});
const somaDias = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
function maisUmMes(d: string) {
  const [a, m, dia] = d.split('-').map(Number);
  const ult = new Date(Date.UTC(a, m + 1, 0)).getUTCDate();
  const nm = m === 12 ? 1 : m + 1;
  const na = m === 12 ? a + 1 : a;
  return `${na}-${String(nm).padStart(2, '0')}-${String(Math.min(dia, ult)).padStart(2, '0')}`;
}

@Injectable()
export class DespesasService {
  constructor(private readonly ds: DataSource) {}

  /** pode aprovar despesas? (lido do perfil agora: quem ganhou a permissão não precisa entrar de novo) */
  private async podeAprovar(u: UsuarioToken) {
    const [p] = await this.ds.query(`SELECT permissoes FROM perfis WHERE id = $1`, [u.perfilId]);
    const l: string[] = p?.permissoes ?? u.permissoes ?? [];
    return l.includes('*') || l.includes('despesas.aprovar');
  }

  /** quem não aprova despesas (ex.: setor de compras) lança e espera o financeiro */
  private async aprovacaoDe(u: UsuarioToken) {
    return (await this.podeAprovar(u)) ? 'aprovada' : 'pendente';
  }

  async listar(u: UsuarioToken, filtro: { status?: string; de?: string; ate?: string; cnpj?: string }) {
    const params: unknown[] = [u.empresaId];
    let where = 'empresa_id = $1';
    if (filtro.status === 'abertas') where += ` AND status = 'aberta'`;
    else if (filtro.status === 'pagas') where += ` AND status = 'paga'`;
    if (filtro.de) { params.push(filtro.de); where += ` AND vencimento >= $${params.length}`; }
    if (filtro.ate) { params.push(filtro.ate); where += ` AND vencimento <= $${params.length}`; }
    where += filtroCnpj('cnpj', filtro.cnpj, params);
    const pt: unknown[] = [u.empresaId, '', ''];
    const fct = filtroCnpj('cnpj', filtro.cnpj, pt);
    const lista = (await this.ds.query(`SELECT * FROM contas_pagar WHERE ${where} AND status <> 'cancelada' ORDER BY vencimento, descricao LIMIT 2000`, params)).map(fmt);
    const hoje = hojeSP();
    const em7 = new Date(Date.now() + 7 * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    const [tot] = await this.ds.query(
      `SELECT COALESCE(SUM(valor) FILTER (WHERE vencimento < $2),0) AS vencidas, COALESCE(SUM(valor) FILTER (WHERE vencimento BETWEEN $2 AND $3),0) AS semana,
              COALESCE(SUM(valor),0) AS abertas FROM contas_pagar WHERE empresa_id = $1 AND status = 'aberta'${fct}`, [u.empresaId, hoje, em7, ...pt.slice(3)]);
    // contas de valor que varia: perto do vencimento (10 dias) o sistema pede o valor do mês
    const em10 = new Date(Date.now() + 10 * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    const pa: unknown[] = [u.empresaId, em10];
    const fca = filtroCnpj('cnpj', filtro.cnpj, pa);
    const aguardando = (await this.ds.query(
      `SELECT * FROM contas_pagar WHERE empresa_id = $1 AND status = 'aberta' AND valor_confirmado = false AND vencimento <= $2${fca} ORDER BY vencimento`, pa)).map(fmt);
    return { totais: { vencidas: Number(tot.vencidas), proximos7: Number(tot.semana), abertas: Number(tot.abertas) }, hoje, lista, aguardandoValor: aguardando };
  }

  async criar(u: UsuarioToken, dto: ContaPagarDto) {
    const mensal = (dto.recorrente ?? 'nao') === 'mensal';
    // prazos (7/14/21…) contados da data da compra; senão N boletos de 30 em 30 dias a partir do 1º vencimento
    const prazos = !mensal && dto.prazos?.length ? [...dto.prazos].sort((a, b) => a - b) : null;
    const n = mensal ? 1 : prazos ? prazos.length : Math.max(1, dto.boletos ?? 1);
    const vence = (i: number) => (prazos ? somaDias(dto.dataCompra ?? dto.vencimento, prazos[i]) : somaDias(dto.vencimento, i * 30));
    const total = Math.round(dto.valor * 100);
    const lote = n > 1 ? randomUUID() : null;
    const aprovacao = await this.aprovacaoDe(u);
    await this.ds.transaction(async (m) => {
      for (let i = 0; i < n; i++) {
        // centavos que sobram da divisão vão no último boleto
        const valor = i < n - 1 ? Math.floor(total / n) : total - Math.floor(total / n) * (n - 1);
        await m.query(
          `INSERT INTO contas_pagar (empresa_id, descricao, fornecedor, categoria, valor, vencimento, recorrente, codigo_barras, observacao, criado_por, valor_variavel, cnpj, aprovacao, lote_id, nota_total)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [u.empresaId, `${dto.descricao.trim()}${n > 1 ? ` · boleto ${i + 1}/${n}${prazos ? ` (${prazos[i]} dias)` : ''}` : ''}`.slice(0, 200), dto.fornecedor?.trim() || null, dto.categoria?.trim() || null,
            (valor / 100).toFixed(2), vence(i), dto.recorrente ?? 'nao', i === 0 ? dto.codigoBarras?.trim() || null : null, dto.observacao?.trim() || null, u.nome,
            (dto.recorrente ?? 'nao') === 'mensal' && !!dto.valorVariavel, cnpjDoForm(dto.cnpj), aprovacao, lote, n > 1 ? dto.valor.toFixed(2) : null]);
      }
    });
    return { ok: true, boletos: n, aprovacao };
  }

  /** notas e boletos esperando o financeiro, agrupados (uma nota com vários boletos fica junta) */
  async aprovacoes(u: UsuarioToken) {
    const l = (await this.ds.query(
      `SELECT * FROM contas_pagar WHERE empresa_id = $1 AND status = 'aberta' AND aprovacao IN ('pendente','recusada') ORDER BY criado_em, vencimento`, [u.empresaId])).map(fmt);
    const grupos = new Map<string, ReturnType<typeof fmt>[]>();
    for (const c of l) { const k = String(c.loteId ?? c.chaveNfe ?? c.id); grupos.set(k, [...(grupos.get(k) ?? []), c]); }
    return [...grupos.values()].map((contas) => {
      const soma = Math.round(contas.reduce((s, c) => s + c.valor, 0) * 100) / 100;
      const nota = contas.find((c) => c.notaTotal !== null)?.notaTotal ?? null;
      return {
        ids: contas.map((c) => c.id), fornecedor: contas[0].fornecedor, descricao: contas[0].descricao, chaveNfe: contas[0].chaveNfe, criadoPor: contas[0].criadoPor,
        aprovacao: contas.some((c) => c.aprovacao === 'pendente') ? 'pendente' : 'recusada', motivoRecusa: contas[0].motivoRecusa,
        soma, totalNota: nota, bate: nota === null ? null : Math.abs(nota - soma) < 0.01, contas,
      };
    });
  }

  async aprovar(u: UsuarioToken, dto: AprovarContasDto) {
    if (!(await this.podeAprovar(u))) throw new ForbiddenException('Seu perfil não aprova contas a pagar (permissão "Despesas: aprovar").');
    if (dto.decisao === 'recusar' && (dto.motivo?.trim().length ?? 0) < 3) throw new BadRequestException('Diga o motivo da recusa (ex.: valor do boleto não bate com a nota).');
    const r = await this.ds.query(
      `UPDATE contas_pagar SET aprovacao = $3, aprovado_por = $4, aprovado_em = now(), motivo_recusa = $5
        WHERE empresa_id = $1 AND id = ANY($2::uuid[]) AND status = 'aberta' AND aprovacao IN ('pendente','recusada') RETURNING id`,
      [u.empresaId, dto.ids, dto.decisao === 'aprovar' ? 'aprovada' : 'recusada', u.nome, dto.decisao === 'recusar' ? dto.motivo!.trim() : null]);
    const n = Array.isArray(r?.[0]) ? r[0].length : r?.length ?? 0;
    if (!n) throw new BadRequestException('Estas contas já foram aprovadas, pagas ou canceladas.');
    return { ok: true, contas: n };
  }

  private async buscar(u: UsuarioToken, id: string) {
    const [v] = await this.ds.query(`SELECT * FROM contas_pagar WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!v) throw new NotFoundException('Conta não encontrada.');
    return v;
  }

  async atualizar(u: UsuarioToken, id: string, dto: ContaPagarDto) {
    const v = await this.buscar(u, id);
    if (v.status !== 'aberta') throw new BadRequestException('Só dá para editar conta em aberto.');
    await this.ds.query(
      `UPDATE contas_pagar SET descricao=$3, fornecedor=$4, categoria=$5, valor=$6, vencimento=$7, recorrente=$8, codigo_barras=$9, observacao=$10,
              valor_variavel=$11, valor_confirmado=true, cnpj=$12,
              aprovacao = CASE WHEN $13 = 'aprovada' THEN aprovacao ELSE 'pendente' END, motivo_recusa = CASE WHEN $13 = 'aprovada' THEN motivo_recusa ELSE NULL END
        WHERE id=$1 AND empresa_id=$2`,
      [id, u.empresaId, dto.descricao.trim(), dto.fornecedor?.trim() || null, dto.categoria?.trim() || null, dto.valor.toFixed(2), dto.vencimento, dto.recorrente ?? 'nao',
        dto.codigoBarras?.trim() || null, dto.observacao?.trim() || null, (dto.recorrente ?? 'nao') === 'mensal' && !!dto.valorVariavel, cnpjDoForm(dto.cnpj), await this.aprovacaoDe(u)]);
    return { ok: true };
  }

  async pagar(u: UsuarioToken, id: string, dto: PagarContaDto) {
    const v = await this.buscar(u, id);
    if (v.status !== 'aberta') throw new BadRequestException('Esta conta já foi paga ou cancelada.');
    if ((v.aprovacao ?? 'aprovada') !== 'aprovada') throw new BadRequestException(v.aprovacao === 'recusada' ? `O financeiro recusou esta conta: ${v.motivo_recusa ?? ''}` : 'Esta conta ainda espera a aprovação do financeiro.');
    const valor = dto.valorPago ?? Number(v.valor);
    const pagoEm = dto.pagoEm ?? hojeSP();
    await this.ds.transaction(async (m) => {
      // só baixa se ainda estiver aberta: dois cliques ao mesmo tempo não lançam a saída duas vezes
      const r = await m.query(`UPDATE contas_pagar SET status='paga', pago_em=$3, valor_pago=$4, forma_pagamento=$5, pago_por=$6 WHERE id=$1 AND empresa_id=$2 AND status='aberta' RETURNING id`,
        [id, u.empresaId, pagoEm, valor.toFixed(2), dto.forma, u.nome]);
      const linhas = Array.isArray(r?.[0]) ? r[0] : r;
      if (!linhas?.length) throw new BadRequestException('Esta conta já foi paga ou cancelada.');
      if ((dto.lancarCaixa ?? 'sim') === 'sim') {
        await m.query(`INSERT INTO caixa_movimentos (empresa_id, turno_id, caixa, tipo, forma, valor, descricao, categoria, usuario_id, usuario_nome, cnpj) VALUES ($1, NULL, 'adm', 'saida', $2, $3, $4, $5, $6, $7, $8)`,
          [u.empresaId, dto.forma, valor.toFixed(2), `Conta paga: ${v.descricao}${v.fornecedor ? ` · ${v.fornecedor}` : ''}`.slice(0, 300), v.categoria ?? 'Contas a pagar', u.sub, u.nome, v.cnpj ?? null]);
      }
      // conta fixa todo mês: já cria a do mês seguinte
      if (v.recorrente === 'mensal') {
        const venc = v.vencimento instanceof Date ? v.vencimento.toISOString().slice(0, 10) : String(v.vencimento).slice(0, 10);
        await m.query(
          `INSERT INTO contas_pagar (empresa_id, descricao, fornecedor, categoria, valor, vencimento, recorrente, observacao, criado_por, valor_variavel, valor_confirmado, cnpj)
           VALUES ($1,$2,$3,$4,$5,$6,'mensal',$7,$8,$9,$10,$11)`,
          [u.empresaId, v.descricao, v.fornecedor, v.categoria, valor.toFixed(2), maisUmMes(venc), v.observacao, u.nome, !!v.valor_variavel, !v.valor_variavel, v.cnpj ?? null]);
      }
    });
    return { ok: true };
  }

  /** nota de compra (XML): uma conta por duplicata; pode já entrar como paga */
  async importarNfe(u: UsuarioToken, dto: ImportarNfeDto) {
    const [ja] = await this.ds.query(`SELECT id FROM contas_pagar WHERE empresa_id = $1 AND chave_nfe = $2 AND status <> 'cancelada' LIMIT 1`, [u.empresaId, dto.chave]);
    if (ja) throw new BadRequestException('Esta nota fiscal já foi lançada em contas a pagar.');
    const hoje = hojeSP();
    const aprovacao = await this.aprovacaoDe(u);
    if (dto.pagaCom && aprovacao !== 'aprovada') throw new BadRequestException('Nota já paga só pode ser lançada pelo financeiro. Lance sem marcar como paga: ela vai para aprovação.');
    const lote = randomUUID();
    await this.ds.transaction(async (m) => {
      const n = dto.parcelas.length;
      for (const [i, p] of dto.parcelas.entries()) {
        const desc = `NF ${dto.numero}${n > 1 ? ` · parcela ${i + 1}/${n}` : ''}`;
        const [c] = await m.query(
          `INSERT INTO contas_pagar (empresa_id, descricao, fornecedor, categoria, valor, vencimento, recorrente, observacao, criado_por, chave_nfe, cnpj, aprovacao, lote_id, nota_total)
           VALUES ($1,$2,$3,$4,$5,$6,'nao',$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
          [u.empresaId, desc, dto.fornecedor.trim(), dto.categoria?.trim() || 'Fornecedores', p.valor.toFixed(2), p.vencimento, `Importada do XML · chave ${dto.chave}`, u.nome, dto.chave, cnpjDoForm(dto.cnpj),
            aprovacao, lote, dto.totalNota !== undefined ? dto.totalNota.toFixed(2) : null]);
        if (dto.pagaCom) {
          await m.query(`UPDATE contas_pagar SET status='paga', pago_em=$2, valor_pago=valor, forma_pagamento=$3, pago_por=$4 WHERE id=$1`, [c.id, hoje, dto.pagaCom, u.nome]);
          if ((dto.lancarCaixa ?? 'sim') === 'sim') {
            await m.query(`INSERT INTO caixa_movimentos (empresa_id, turno_id, caixa, tipo, forma, valor, descricao, categoria, usuario_id, usuario_nome, cnpj) VALUES ($1, NULL, 'adm', 'saida', $2, $3, $4, $5, $6, $7, $8)`,
              [u.empresaId, dto.pagaCom, p.valor.toFixed(2), `Conta paga: ${desc} · ${dto.fornecedor}`.slice(0, 300), dto.categoria?.trim() || 'Fornecedores', u.sub, u.nome, cnpjDoForm(dto.cnpj)]);
          }
        }
      }
    });
    return { ok: true, parcelas: dto.parcelas.length };
  }

  async cancelar(u: UsuarioToken, id: string) {
    const v = await this.buscar(u, id);
    if (v.status !== 'aberta') throw new BadRequestException('Só dá para cancelar conta em aberto.');
    await this.ds.query(`UPDATE contas_pagar SET status='cancelada' WHERE id=$1 AND empresa_id=$2`, [id, u.empresaId]);
    return { ok: true };
  }
}
