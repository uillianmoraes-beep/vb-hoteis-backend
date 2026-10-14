import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CaixaService } from '../caixa/caixa.service';
import { DespertadorDto, VendaAvulsaDto } from './balcao.dto';
import { UsuarioToken } from '../common/permissoes';
import { ImpressaoService } from '../impressao/impressao.service';
import { baixarConsumo } from '../estoque/estoque.core';

const c = (v: number | string | null | undefined) => Math.round(Number(v ?? 0) * 100);
const r = (x: number) => Math.round(x) / 100;
const brl = (cent: number) => `R$ ${(cent / 100).toFixed(2).replace('.', ',')}`;

@Injectable()
export class BalcaoService {
  constructor(private readonly ds: DataSource, private readonly caixa: CaixaService, private readonly impressao: ImpressaoService) {}

  /* ---------- venda avulsa (fora da conta) ---------- */

  async vender(u: UsuarioToken, dto: VendaAvulsaDto) {
    const ids = [...new Set(dto.itens.map((i) => i.produtoId))];
    const prods: { id: string; nome: string; preco: string }[] = await this.ds.query(
      `SELECT id, nome, preco FROM produtos WHERE empresa_id = $1 AND ativo AND id = ANY($2::uuid[])`, [u.empresaId, ids]);
    const mapa = new Map(prods.map((p) => [p.id, p]));
    const itens = dto.itens.map((i) => {
      const p = mapa.get(i.produtoId);
      if (!p) throw new BadRequestException('Produto não encontrado ou inativo.');
      return { produtoId: p.id, nome: p.nome, quantidade: i.quantidade, valorUnit: Number(p.preco), total: r(c(p.preco) * i.quantidade) };
    });
    const total = itens.reduce((s, i) => s + c(i.total), 0);
    if (total <= 0) throw new BadRequestException('Venda sem valor.');
    const para = dto.para ?? 'cliente';
    let func: { id: string; nome: string } | null = null;
    if (para === 'funcionario' || dto.forma === 'ficha') {
      if (!dto.funcionarioId) throw new BadRequestException('Escolha o funcionário.');
      const [f] = await this.ds.query(`SELECT id, nome FROM funcionarios WHERE id = $1 AND empresa_id = $2 AND ativo`, [dto.funcionarioId, u.empresaId]);
      if (!f) throw new BadRequestException('Funcionário não encontrado.');
      func = f;
    }
    let recebido: number | null = null;
    let troco = 0;
    if (dto.forma === 'dinheiro' && dto.valorRecebido !== undefined && dto.valorRecebido !== null) {
      recebido = c(dto.valorRecebido);
      if (recebido < total) throw new BadRequestException(`Recebido menor que o total (${brl(total)}).`);
      troco = recebido - total;
    }
    // descontar na ficha não entra no caixa
    const turnoId = dto.forma === 'ficha' ? null : await this.caixa.turnoParaRecebimento(u.empresaId, dto.ambienteId);
    const resumo = itens.map((i) => `${i.quantidade}x ${i.nome}`).join(', ');
    const id = await this.ds.transaction(async (m) => {
      const [v] = await m.query(
        `INSERT INTO vendas_avulsas (empresa_id, ambiente_id, turno_id, para, funcionario_id, funcionario_nome, itens, total, forma, valor_recebido, troco, usuario_nome)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12) RETURNING id`,
        [u.empresaId, dto.ambienteId, turnoId, func ? 'funcionario' : 'cliente', func?.id ?? null, func?.nome ?? null, JSON.stringify(itens), r(total).toFixed(2), dto.forma,
          recebido !== null ? r(recebido).toFixed(2) : null, r(troco).toFixed(2), u.nome]);
      const vendaId = (Array.isArray(v) ? v[0] : v)?.id as string;
      for (const i of itens) await baixarConsumo(m, u.empresaId, dto.ambienteId, i.produtoId, i.quantidade, { referencia: `venda:${vendaId}`, observacao: 'Venda avulsa', usuario: u.nome, tipo: 'venda' });
      if (dto.forma === 'ficha' && func) {
        await m.query(
          `INSERT INTO funcionario_lancamentos (empresa_id, funcionario_id, tipo, valor, descricao, data, usuario_nome) VALUES ($1,$2,'desconto',$3,$4,$5,$6)`,
          [u.empresaId, func.id, r(total).toFixed(2), `Compra no balcão: ${resumo}`.slice(0, 300), new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }), u.nome]);
      }
      return (Array.isArray(v) ? v[0] : v)?.id as string;
    });
    void this.impressao.producao(u.empresaId, { ambienteId: dto.ambienteId, local: 'Venda avulsa', origem: 'venda', usuario: u.nome, itens: itens.map((i) => ({ produtoId: i.produtoId, nome: i.nome, quantidade: i.quantidade })) });
    return { id, total: r(total), troco: r(troco), itens };
  }

  async listarVendas(u: UsuarioToken, filtro: { de?: string; ate?: string }) {
    const ate = filtro.ate ?? new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    const de = filtro.de ?? ate;
    const lista = await this.ds.query(
      `SELECT * FROM vendas_avulsas WHERE empresa_id = $1 AND criado_em BETWEEN $2 AND $3 ORDER BY criado_em DESC LIMIT 1000`,
      [u.empresaId, new Date(`${de}T00:00:00-03:00`), new Date(`${ate}T23:59:59.999-03:00`)]);
    return lista.map((v: Record<string, unknown>) => ({
      id: v.id, criadoEm: v.criado_em, para: v.para, funcionario: v.funcionario_nome, itens: v.itens, total: Number(v.total), forma: v.forma,
      troco: Number(v.troco), cancelada: v.cancelada, usuario: v.usuario_nome,
    }));
  }

  async venda(u: UsuarioToken, id: string) {
    const [v] = await this.ds.query(`SELECT * FROM vendas_avulsas WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!v) throw new NotFoundException('Venda não encontrada.');
    return { id: v.id, criadoEm: v.criado_em, funcionario: v.funcionario_nome, itens: v.itens, total: Number(v.total), forma: v.forma, recebido: v.valor_recebido === null ? null : Number(v.valor_recebido), troco: Number(v.troco), usuario: v.usuario_nome };
  }

  /* ---------- despertador ---------- */

  private quando(h: string): Date {
    if (/^\d{2}:\d{2}$/.test(h)) {
      const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
      let d = new Date(`${hoje}T${h}:00-03:00`);
      if (d.getTime() < Date.now() - 60_000) d = new Date(d.getTime() + 86_400_000);
      return d;
    }
    return new Date(h);
  }

  async criarDespertador(u: UsuarioToken, dto: DespertadorDto) {
    const [un] = await this.ds.query(`SELECT id, codigo FROM unidades WHERE id = $1 AND empresa_id = $2`, [dto.unidadeId, u.empresaId]);
    if (!un) throw new NotFoundException('Suíte não encontrada.');
    const [est] = await this.ds.query(`SELECT id FROM estadias WHERE unidade_id = $1 AND status IN ('aberta','conta_entregue') LIMIT 1`, [un.id]);
    const horario = this.quando(dto.horario);
    if (Number.isNaN(horario.getTime())) throw new BadRequestException('Horário inválido.');
    await this.ds.query(
      `INSERT INTO despertadores (empresa_id, unidade_id, estadia_id, horario, observacao, criado_por) VALUES ($1,$2,$3,$4,$5,$6)`,
      [u.empresaId, un.id, est?.id ?? null, horario, dto.observacao?.trim() || null, u.nome]);
    return this.pendentes(u);
  }

  async pendentes(u: UsuarioToken) {
    const lista = await this.ds.query(
      `SELECT d.id, d.unidade_id, d.horario, d.observacao, d.criado_por, un.codigo, un.ambiente_id
       FROM despertadores d JOIN unidades un ON un.id = d.unidade_id
       WHERE d.empresa_id = $1 AND d.status = 'pendente' ORDER BY d.horario LIMIT 200`, [u.empresaId]);
    return lista.map((d: Record<string, unknown>) => ({ id: d.id, unidadeId: d.unidade_id, codigo: d.codigo, ambienteId: d.ambiente_id, horario: d.horario, observacao: d.observacao, criadoPor: d.criado_por }));
  }

  async concluirDespertador(u: UsuarioToken, id: string, status: 'feito' | 'cancelado') {
    const res = await this.ds.query(
      `UPDATE despertadores SET status = $3, feito_por = $4, feito_em = now() WHERE id = $1 AND empresa_id = $2 AND status = 'pendente' RETURNING id`, [id, u.empresaId, status, u.nome]);
    const linhas = Array.isArray(res?.[0]) ? res[0] : res;
    if (!linhas?.length) throw new NotFoundException('Despertador não encontrado ou já resolvido.');
    return this.pendentes(u);
  }
}
