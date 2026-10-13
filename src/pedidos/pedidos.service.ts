import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { NovoPedidoDto, RecusarPedidoDto } from './pedidos.dto';
import { UsuarioToken } from '../common/permissoes';
import { EstadiasService } from '../estadias/estadias.service';

interface ItemPedido { produtoId: string; nome: string; quantidade: number; preco: number }

const fmt = (p: Record<string, unknown>) => ({
  id: p.id, unidadeId: p.unidade_id, unidade: p.codigo ?? null, ambienteId: p.ambiente_id ?? null, estadiaId: p.estadia_id, itens: p.itens as ItemPedido[],
  total: Number(p.total), observacao: p.observacao, status: p.status, motivo: p.motivo, aceitoPor: p.aceito_por, aceitoEm: p.aceito_em,
  entreguePor: p.entregue_por, entregueEm: p.entregue_em, criadoEm: p.criado_em,
});

@Injectable()
export class PedidosService {
  constructor(private readonly ds: DataSource, private readonly estadias: EstadiasService) {}

  /* ---------------- cliente (QR code, sem login) ---------------- */

  private async unidadePorToken(token: string) {
    const [un] = await this.ds.query(
      `SELECT un.id, un.codigo, un.tipo, un.empresa_id, e.nome AS empresa,
              (SELECT es.id FROM estadias es WHERE es.unidade_id = un.id AND es.status = 'aberta' ORDER BY es.entrada_em DESC LIMIT 1) AS estadia_id
         FROM unidades un JOIN empresas e ON e.id = un.empresa_id WHERE un.token_pedido = $1 AND un.ativo`, [token]);
    if (!un) throw new NotFoundException('QR code inválido.');
    return un;
  }

  async publico(token: string) {
    const un = await this.unidadePorToken(token);
    const cardapio = await this.ds.query(
      `SELECT id, nome, grupo, preco FROM produtos WHERE empresa_id = $1 AND ativo AND cardapio AND preco > 0 ORDER BY grupo NULLS LAST, nome`, [un.empresa_id]);
    const meus = un.estadia_id
      ? await this.ds.query(`SELECT id, itens, total, status, motivo, criado_em FROM pedidos WHERE estadia_id = $1 ORDER BY criado_em DESC LIMIT 20`, [un.estadia_id])
      : [];
    return {
      empresa: un.empresa, unidade: un.codigo, tipo: un.tipo, aberto: !!un.estadia_id,
      cardapio: cardapio.map((p: Record<string, unknown>) => ({ id: p.id, nome: p.nome, grupo: p.grupo, preco: Number(p.preco) })),
      pedidos: meus.map((p: Record<string, unknown>) => ({ id: p.id, itens: p.itens, total: Number(p.total), status: p.status, motivo: p.motivo, criadoEm: p.criado_em })),
    };
  }

  async pedir(token: string, dto: NovoPedidoDto) {
    const un = await this.unidadePorToken(token);
    if (!un.estadia_id) throw new BadRequestException('Os pedidos pelo celular funcionam enquanto você está hospedado. Fale com a recepção.');
    const [pend] = await this.ds.query(`SELECT count(*)::int AS n FROM pedidos WHERE estadia_id = $1 AND status = 'novo'`, [un.estadia_id]);
    if (Number(pend.n) >= 3) throw new BadRequestException('Você já tem pedidos aguardando a recepção. Aguarde um pouco.');
    const ids = [...new Set(dto.itens.map((i) => i.produtoId))];
    const prods = await this.ds.query(`SELECT id, nome, preco FROM produtos WHERE empresa_id = $1 AND ativo AND cardapio AND id = ANY($2::uuid[])`, [un.empresa_id, ids]);
    const mapa = new Map<string, Record<string, unknown>>(prods.map((p: Record<string, unknown>) => [String(p.id), p]));
    const itens: ItemPedido[] = [];
    for (const i of dto.itens) {
      const p = mapa.get(i.produtoId);
      if (!p) throw new BadRequestException('Um dos itens não está mais disponível. Atualize a página.');
      const ja = itens.find((x) => x.produtoId === i.produtoId);
      if (ja) ja.quantidade += i.quantidade;
      else itens.push({ produtoId: i.produtoId, nome: String(p.nome), quantidade: i.quantidade, preco: Number(p.preco) });
    }
    const total = Math.round(itens.reduce((s, i) => s + i.preco * i.quantidade * 100, 0)) / 100;
    await this.ds.query(`INSERT INTO pedidos (empresa_id, unidade_id, estadia_id, itens, total, observacao) VALUES ($1,$2,$3,$4::jsonb,$5,$6)`,
      [un.empresa_id, un.id, un.estadia_id, JSON.stringify(itens), total.toFixed(2), dto.observacao?.trim() || null]);
    return { ok: true };
  }

  /* ---------------- recepção ---------------- */

  /** novos e aceitos ainda não entregues (piscam no painel) */
  async pendentes(u: UsuarioToken, ambienteId?: string) {
    const params: unknown[] = [u.empresaId];
    let f = '';
    if (ambienteId && /^[0-9a-f-]{36}$/i.test(ambienteId)) { params.push(ambienteId); f = ` AND un.ambiente_id = $2`; }
    const l = await this.ds.query(
      `SELECT p.*, un.codigo, un.ambiente_id FROM pedidos p JOIN unidades un ON un.id = p.unidade_id
        WHERE p.empresa_id = $1 AND p.status IN ('novo','aceito') AND p.criado_em > now() - interval '1 day'${f} ORDER BY p.criado_em`, params);
    return l.map(fmt);
  }

  async historico(u: UsuarioToken, dias = 7) {
    const l = await this.ds.query(
      `SELECT p.*, un.codigo, un.ambiente_id FROM pedidos p JOIN unidades un ON un.id = p.unidade_id
        WHERE p.empresa_id = $1 AND p.criado_em > now() - ($2 || ' days')::interval ORDER BY p.criado_em DESC LIMIT 500`, [u.empresaId, String(Math.min(90, Math.max(1, dias)))]);
    return l.map(fmt);
  }

  private async pedido(u: UsuarioToken, id: string) {
    const [p] = await this.ds.query(`SELECT * FROM pedidos WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!p) throw new NotFoundException('Pedido não encontrado.');
    return p;
  }

  /** aceita e lança cada item na conta da suíte/quarto */
  async aceitar(u: UsuarioToken, id: string) {
    const p = await this.pedido(u, id);
    if (p.status !== 'novo') throw new BadRequestException('Este pedido já foi atendido.');
    // marca primeiro (evita lançar duas vezes se dois clicarem juntos)
    const r = await this.ds.query(`UPDATE pedidos SET status = 'aceito', aceito_por = $2, aceito_em = now() WHERE id = $1 AND status = 'novo' RETURNING id`, [id, u.nome]);
    const ok = Array.isArray(r?.[0]) ? r[0].length : r?.length;
    if (!ok) throw new BadRequestException('Este pedido já foi atendido.');
    try {
      for (const i of p.itens as ItemPedido[]) {
        await this.estadias.lancarItem(u, p.estadia_id, { produtoId: i.produtoId, quantidade: i.quantidade, precoUnitario: i.preco });
      }
    } catch (e) {
      await this.ds.query(`UPDATE pedidos SET status = 'novo', aceito_por = NULL, aceito_em = NULL WHERE id = $1`, [id]);
      throw e;
    }
    return { ok: true };
  }

  async entregue(u: UsuarioToken, id: string) {
    const p = await this.pedido(u, id);
    if (p.status !== 'aceito') throw new BadRequestException('Aceite o pedido antes de marcar como entregue.');
    await this.ds.query(`UPDATE pedidos SET status = 'entregue', entregue_por = $2, entregue_em = now() WHERE id = $1`, [id, u.nome]);
    return { ok: true };
  }

  async recusar(u: UsuarioToken, id: string, dto: RecusarPedidoDto) {
    const p = await this.pedido(u, id);
    if (p.status !== 'novo') throw new BadRequestException('Só dá para recusar pedido novo.');
    await this.ds.query(`UPDATE pedidos SET status = 'recusado', motivo = $2, aceito_por = $3, aceito_em = now() WHERE id = $1`, [id, dto.motivo?.trim() || null, u.nome]);
    return { ok: true };
  }

  /** QR codes das unidades (para imprimir) */
  async qrcodes(u: UsuarioToken, ambienteId?: string) {
    await this.ds.query(
      `UPDATE unidades SET token_pedido = substr(md5(random()::text || id::text || clock_timestamp()::text), 1, 20) WHERE empresa_id = $1 AND token_pedido IS NULL`, [u.empresaId]);
    const params: unknown[] = [u.empresaId];
    let f = '';
    if (ambienteId && /^[0-9a-f-]{36}$/i.test(ambienteId)) { params.push(ambienteId); f = ` AND un.ambiente_id = $2`; }
    const l = await this.ds.query(
      `SELECT un.id, un.codigo, un.tipo, un.token_pedido, a.nome AS ambiente FROM unidades un JOIN ambientes a ON a.id = un.ambiente_id
        WHERE un.empresa_id = $1 AND un.ativo${f} ORDER BY a.ordem, a.nome, un.ordem, un.codigo`, params);
    const [emp] = await this.ds.query(`SELECT nome FROM empresas WHERE id = $1`, [u.empresaId]);
    return { empresa: emp?.nome ?? '', unidades: l.map((x: Record<string, unknown>) => ({ id: x.id, codigo: x.codigo, tipo: x.tipo, token: x.token_pedido, ambiente: x.ambiente })) };
  }

  /** gera um QR novo (o antigo para de funcionar) */
  async trocarQr(u: UsuarioToken, unidadeId: string) {
    await this.ds.query(`UPDATE unidades SET token_pedido = substr(md5(random()::text || id::text || clock_timestamp()::text), 1, 20) WHERE id = $1 AND empresa_id = $2`, [unidadeId, u.empresaId]);
    return { ok: true };
  }

  async cardapio(u: UsuarioToken) {
    const l = await this.ds.query(`SELECT id, nome, grupo, preco, cardapio FROM produtos WHERE empresa_id = $1 AND ativo ORDER BY grupo NULLS LAST, nome`, [u.empresaId]);
    return l.map((p: Record<string, unknown>) => ({ id: p.id, nome: p.nome, grupo: p.grupo, preco: Number(p.preco), cardapio: p.cardapio }));
  }

  async marcarCardapio(u: UsuarioToken, produtoId: string, cardapio: boolean) {
    await this.ds.query(`UPDATE produtos SET cardapio = $3 WHERE id = $1 AND empresa_id = $2`, [produtoId, u.empresaId, cardapio]);
    return { ok: true };
  }
}
