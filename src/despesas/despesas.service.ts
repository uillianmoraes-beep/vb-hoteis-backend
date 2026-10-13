import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ContaPagarDto, ImportarNfeDto, PagarContaDto } from './despesas.dto';
import { UsuarioToken } from '../common/permissoes';

const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const fmt = (v: Record<string, unknown>) => ({
  id: v.id, descricao: v.descricao, fornecedor: v.fornecedor, categoria: v.categoria, valor: Number(v.valor),
  vencimento: v.vencimento instanceof Date ? v.vencimento.toISOString().slice(0, 10) : String(v.vencimento).slice(0, 10),
  status: v.status, recorrente: v.recorrente, pagoEm: v.pago_em ? (v.pago_em instanceof Date ? v.pago_em.toISOString().slice(0, 10) : String(v.pago_em).slice(0, 10)) : null,
  valorPago: v.valor_pago === null ? null : Number(v.valor_pago), formaPagamento: v.forma_pagamento, codigoBarras: v.codigo_barras,
  observacao: v.observacao, criadoPor: v.criado_por, pagoPor: v.pago_por,
  valorVariavel: !!v.valor_variavel, valorConfirmado: v.valor_confirmado !== false, chaveNfe: v.chave_nfe ?? null,
});
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

  async listar(u: UsuarioToken, filtro: { status?: string; de?: string; ate?: string }) {
    const params: unknown[] = [u.empresaId];
    let where = 'empresa_id = $1';
    if (filtro.status === 'abertas') where += ` AND status = 'aberta'`;
    else if (filtro.status === 'pagas') where += ` AND status = 'paga'`;
    if (filtro.de) { params.push(filtro.de); where += ` AND vencimento >= $${params.length}`; }
    if (filtro.ate) { params.push(filtro.ate); where += ` AND vencimento <= $${params.length}`; }
    const lista = (await this.ds.query(`SELECT * FROM contas_pagar WHERE ${where} AND status <> 'cancelada' ORDER BY vencimento, descricao LIMIT 2000`, params)).map(fmt);
    const hoje = hojeSP();
    const em7 = new Date(Date.now() + 7 * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    const [tot] = await this.ds.query(
      `SELECT COALESCE(SUM(valor) FILTER (WHERE vencimento < $2),0) AS vencidas, COALESCE(SUM(valor) FILTER (WHERE vencimento BETWEEN $2 AND $3),0) AS semana,
              COALESCE(SUM(valor),0) AS abertas FROM contas_pagar WHERE empresa_id = $1 AND status = 'aberta'`, [u.empresaId, hoje, em7]);
    // contas de valor que varia: perto do vencimento (10 dias) o sistema pede o valor do mês
    const em10 = new Date(Date.now() + 10 * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    const aguardando = (await this.ds.query(
      `SELECT * FROM contas_pagar WHERE empresa_id = $1 AND status = 'aberta' AND valor_confirmado = false AND vencimento <= $2 ORDER BY vencimento`, [u.empresaId, em10])).map(fmt);
    return { totais: { vencidas: Number(tot.vencidas), proximos7: Number(tot.semana), abertas: Number(tot.abertas) }, hoje, lista, aguardandoValor: aguardando };
  }

  async criar(u: UsuarioToken, dto: ContaPagarDto) {
    await this.ds.query(
      `INSERT INTO contas_pagar (empresa_id, descricao, fornecedor, categoria, valor, vencimento, recorrente, codigo_barras, observacao, criado_por, valor_variavel) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [u.empresaId, dto.descricao.trim(), dto.fornecedor?.trim() || null, dto.categoria?.trim() || null, dto.valor.toFixed(2), dto.vencimento, dto.recorrente ?? 'nao',
        dto.codigoBarras?.trim() || null, dto.observacao?.trim() || null, u.nome, (dto.recorrente ?? 'nao') === 'mensal' && !!dto.valorVariavel]);
    return { ok: true };
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
              valor_variavel=$11, valor_confirmado=true WHERE id=$1 AND empresa_id=$2`,
      [id, u.empresaId, dto.descricao.trim(), dto.fornecedor?.trim() || null, dto.categoria?.trim() || null, dto.valor.toFixed(2), dto.vencimento, dto.recorrente ?? 'nao',
        dto.codigoBarras?.trim() || null, dto.observacao?.trim() || null, (dto.recorrente ?? 'nao') === 'mensal' && !!dto.valorVariavel]);
    return { ok: true };
  }

  async pagar(u: UsuarioToken, id: string, dto: PagarContaDto) {
    const v = await this.buscar(u, id);
    if (v.status !== 'aberta') throw new BadRequestException('Esta conta já foi paga ou cancelada.');
    const valor = dto.valorPago ?? Number(v.valor);
    const pagoEm = dto.pagoEm ?? hojeSP();
    await this.ds.transaction(async (m) => {
      await m.query(`UPDATE contas_pagar SET status='paga', pago_em=$3, valor_pago=$4, forma_pagamento=$5, pago_por=$6 WHERE id=$1 AND empresa_id=$2`,
        [id, u.empresaId, pagoEm, valor.toFixed(2), dto.forma, u.nome]);
      if ((dto.lancarCaixa ?? 'sim') === 'sim') {
        await m.query(`INSERT INTO caixa_movimentos (empresa_id, turno_id, caixa, tipo, forma, valor, descricao, categoria, usuario_id, usuario_nome) VALUES ($1, NULL, 'adm', 'saida', $2, $3, $4, $5, $6, $7)`,
          [u.empresaId, dto.forma, valor.toFixed(2), `Conta paga: ${v.descricao}${v.fornecedor ? ` · ${v.fornecedor}` : ''}`.slice(0, 300), v.categoria ?? 'Contas a pagar', u.sub, u.nome]);
      }
      // conta fixa todo mês: já cria a do mês seguinte
      if (v.recorrente === 'mensal') {
        const venc = v.vencimento instanceof Date ? v.vencimento.toISOString().slice(0, 10) : String(v.vencimento).slice(0, 10);
        await m.query(
          `INSERT INTO contas_pagar (empresa_id, descricao, fornecedor, categoria, valor, vencimento, recorrente, observacao, criado_por, valor_variavel, valor_confirmado)
           VALUES ($1,$2,$3,$4,$5,$6,'mensal',$7,$8,$9,$10)`,
          [u.empresaId, v.descricao, v.fornecedor, v.categoria, valor.toFixed(2), maisUmMes(venc), v.observacao, u.nome, !!v.valor_variavel, !v.valor_variavel]);
      }
    });
    return { ok: true };
  }

  /** nota de compra (XML): uma conta por duplicata; pode já entrar como paga */
  async importarNfe(u: UsuarioToken, dto: ImportarNfeDto) {
    const [ja] = await this.ds.query(`SELECT id FROM contas_pagar WHERE empresa_id = $1 AND chave_nfe = $2 AND status <> 'cancelada' LIMIT 1`, [u.empresaId, dto.chave]);
    if (ja) throw new BadRequestException('Esta nota fiscal já foi lançada em contas a pagar.');
    const hoje = hojeSP();
    await this.ds.transaction(async (m) => {
      const n = dto.parcelas.length;
      for (const [i, p] of dto.parcelas.entries()) {
        const desc = `NF ${dto.numero}${n > 1 ? ` · parcela ${i + 1}/${n}` : ''}`;
        const [c] = await m.query(
          `INSERT INTO contas_pagar (empresa_id, descricao, fornecedor, categoria, valor, vencimento, recorrente, observacao, criado_por, chave_nfe)
           VALUES ($1,$2,$3,$4,$5,$6,'nao',$7,$8,$9) RETURNING id`,
          [u.empresaId, desc, dto.fornecedor.trim(), dto.categoria?.trim() || 'Fornecedores', p.valor.toFixed(2), p.vencimento, `Importada do XML · chave ${dto.chave}`, u.nome, dto.chave]);
        if (dto.pagaCom) {
          await m.query(`UPDATE contas_pagar SET status='paga', pago_em=$2, valor_pago=valor, forma_pagamento=$3, pago_por=$4 WHERE id=$1`, [c.id, hoje, dto.pagaCom, u.nome]);
          if ((dto.lancarCaixa ?? 'sim') === 'sim') {
            await m.query(`INSERT INTO caixa_movimentos (empresa_id, turno_id, caixa, tipo, forma, valor, descricao, categoria, usuario_id, usuario_nome) VALUES ($1, NULL, 'adm', 'saida', $2, $3, $4, $5, $6, $7)`,
              [u.empresaId, dto.pagaCom, p.valor.toFixed(2), `Conta paga: ${desc} · ${dto.fornecedor}`.slice(0, 300), dto.categoria?.trim() || 'Fornecedores', u.sub, u.nome]);
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
