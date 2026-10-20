import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UsuarioToken } from '../common/permissoes';

const PROXIMO: Record<string, string> = { novo: 'preparando', preparando: 'pronto', pronto: 'entregue' };
const CAMPO: Record<string, string> = { preparando: 'iniciado_em', pronto: 'pronto_em', entregue: 'entregue_em' };

/** Tela da cozinha/bar: fila dos pedidos de produção, filtrada por ambiente e grupos de produto. */
@Injectable()
export class CozinhaService {
  constructor(private readonly ds: DataSource) {}

  async listar(u: UsuarioToken, f: { ambienteId?: string; grupos?: string[]; entregues?: boolean }) {
    const p: unknown[] = [u.empresaId];
    let w = '';
    if (f.ambienteId) { p.push(f.ambienteId); w += ` AND pp.ambiente_id = $${p.length}`; }
    else if (u.ambientesIds?.length) { p.push(u.ambientesIds); w += ` AND pp.ambiente_id = ANY($${p.length}::uuid[])`; }
    // abertos + os entregues/cancelados das últimas 2 horas (para conferir)
    const status = f.entregues
      ? `(pp.status IN ('novo','preparando','pronto') OR (pp.status IN ('entregue','cancelado') AND COALESCE(pp.entregue_em, pp.criado_em) > now() - interval '2 hours'))`
      : `pp.status IN ('novo','preparando','pronto')`;
    const peds: Record<string, unknown>[] = await this.ds.query(
      `SELECT pp.*, a.nome AS ambiente FROM producao_pedidos pp LEFT JOIN ambientes a ON a.id = pp.ambiente_id
        WHERE pp.empresa_id = $1 AND pp.criado_em > now() - interval '24 hours' AND ${status}${w} ORDER BY pp.criado_em LIMIT 200`, p);
    const its: Record<string, unknown>[] = peds.length
      ? await this.ds.query(`SELECT * FROM producao_itens WHERE pedido_id = ANY($1::uuid[])`, [peds.map((x) => x.id)]) : [];
    const grupos = (f.grupos ?? []).map((g) => g.toLowerCase());
    return peds.map((x) => ({
      id: x.id, local: x.local, ambiente: x.ambiente, origem: x.origem, usuario: x.usuario_nome, obs: x.obs, status: x.status,
      criadoEm: x.criado_em, iniciadoEm: x.iniciado_em, prontoEm: x.pronto_em, entregueEm: x.entregue_em, atualizadoPor: x.atualizado_por,
      itens: its.filter((i) => i.pedido_id === x.id && (!grupos.length || grupos.includes(String(i.grupo ?? '').toLowerCase())))
        .map((i) => ({ nome: i.nome, grupo: i.grupo, quantidade: Number(i.quantidade), obs: i.obs })),
    })).filter((x) => x.itens.length);
  }

  /** grupos que já passaram pela fila (para o filtro da tela) */
  async grupos(u: UsuarioToken) {
    const l: { grupo: string }[] = await this.ds.query(
      `SELECT DISTINCT i.grupo FROM producao_itens i JOIN producao_pedidos pp ON pp.id = i.pedido_id
        WHERE pp.empresa_id = $1 AND i.grupo IS NOT NULL AND pp.criado_em > now() - interval '60 days' ORDER BY 1`, [u.empresaId]);
    return l.map((x) => x.grupo);
  }

  /** avança (novo → preparando → pronto → entregue), volta um passo ou cancela */
  async mudar(u: UsuarioToken, id: string, acao: 'avancar' | 'voltar' | 'cancelar') {
    const [x] = await this.ds.query(`SELECT id, status FROM producao_pedidos WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!x) throw new NotFoundException('Pedido não encontrado.');
    let novo: string;
    if (acao === 'cancelar') novo = 'cancelado';
    else if (acao === 'voltar') novo = ({ preparando: 'novo', pronto: 'preparando', entregue: 'pronto' } as Record<string, string>)[x.status] ?? x.status;
    else novo = PROXIMO[x.status] ?? x.status;
    if (novo === x.status) throw new BadRequestException('Este pedido já foi finalizado.');
    const campo = acao === 'avancar' ? CAMPO[novo] : null;
    await this.ds.query(
      `UPDATE producao_pedidos SET status = $2, atualizado_por = $3${campo ? `, ${campo} = now()` : ''} WHERE id = $1`, [id, novo, u.nome]);
    return { ok: true, status: novo };
  }

  /** quantos estão prontos esperando entrega (aviso da recepção) */
  async prontos(u: UsuarioToken, ambienteId?: string) {
    const p: unknown[] = [u.empresaId];
    let w = '';
    if (ambienteId) { p.push(ambienteId); w = ` AND ambiente_id = $2`; }
    const l: { local: string | null; pronto_em: Date }[] = await this.ds.query(
      `SELECT local, pronto_em FROM producao_pedidos WHERE empresa_id = $1 AND status = 'pronto' AND criado_em > now() - interval '24 hours'${w} ORDER BY pronto_em`, p);
    return { quantidade: l.length, locais: l.map((x) => x.local).filter(Boolean) };
  }
}
