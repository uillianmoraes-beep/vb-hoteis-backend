import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { NovoPedidoDto, PedidoRecepcaoDto, RecusarPedidoDto } from './pedidos.dto';
import { UsuarioToken } from '../common/permissoes';
import { ImpressaoService } from '../impressao/impressao.service';
import { enviarParaLocal } from '../servidor-local/ponte.core';
import { EstadiasService } from '../estadias/estadias.service';
import { AvisosService } from '../avisos/avisos';

interface ItemPedido { produtoId: string; nome: string; quantidade: number; preco: number }

const fmt = (p: Record<string, unknown>) => ({
  id: p.id, unidadeId: p.unidade_id, unidade: p.codigo ?? null, ambienteId: p.ambiente_id ?? null, estadiaId: p.estadia_id, itens: p.itens as ItemPedido[],
  total: Number(p.total), observacao: p.observacao, status: p.status, motivo: p.motivo, aceitoPor: p.aceito_por, aceitoEm: p.aceito_em,
  entreguePor: p.entregue_por, entregueEm: p.entregue_em, criadoEm: p.criado_em,
  origem: p.origem ?? 'qr', levadoPor: p.levado_por ?? null, saiuEm: p.saiu_em ?? null, lancadoPor: p.lancado_por ?? null,
  minutos: p.entregue_em ? Math.round((new Date(p.entregue_em as string).getTime() - new Date(p.criado_em as string).getTime()) / 60000) : null,
});

@Injectable()
export class PedidosService {
  constructor(private readonly ds: DataSource, private readonly estadias: EstadiasService, private readonly impressao: ImpressaoService, private readonly avisos: AvisosService) {}

  /* ---------------- cliente (QR code, sem login) ---------------- */

  private async unidadePorToken(token: string) {
    const [un] = await this.ds.query(
      `SELECT un.id, un.codigo, un.tipo, un.empresa_id, un.categoria_id, un.ambiente_id, e.nome AS empresa,
              (SELECT es.id FROM estadias es WHERE es.unidade_id = un.id AND es.status = 'aberta' ORDER BY es.entrada_em DESC LIMIT 1) AS estadia_id
         FROM unidades un JOIN empresas e ON e.id = un.empresa_id WHERE un.token_pedido = $1 AND un.ativo`, [token]);
    if (!un) throw new NotFoundException('QR code inválido.');
    return un;
  }

  async publico(token: string) {
    const un = await this.unidadePorToken(token);
    // serviços sem custo (toalha extra, cobertor, limpeza) também aparecem
    const cardapio = await this.ds.query(
      `SELECT id, nome, grupo, preco, tipo FROM produtos WHERE empresa_id = $1 AND ativo AND uso = 'venda' AND NOT ressarcimento AND cardapio AND (preco > 0 OR tipo = 'servico') AND NOT frigobar
          AND (ambientes_ids IS NULL OR cardinality(ambientes_ids) = 0 OR $2::uuid = ANY(ambientes_ids))
        ORDER BY (tipo = 'servico') DESC, grupo NULLS LAST, nome`, [un.empresa_id, un.ambiente_id]);
    // frigobar desta suíte/quarto: o que a categoria tem (ex.: presidencial com champanhe e vinho)
    const frigobar = un.categoria_id ? await this.ds.query(
      `SELECT p.id, p.nome, p.preco, f.quantidade FROM frigobar_categoria f JOIN produtos p ON p.id = f.produto_id
        WHERE f.empresa_id = $1 AND f.categoria_id = $2 AND p.ativo ORDER BY p.nome`, [un.empresa_id, un.categoria_id]) : [];
    const meus = un.estadia_id
      ? await this.ds.query(`SELECT id, itens, total, status, motivo, criado_em FROM pedidos WHERE estadia_id = $1 ORDER BY criado_em DESC LIMIT 20`, [un.estadia_id])
      : [];
    return {
      empresa: un.empresa, unidade: un.codigo, tipo: un.tipo, aberto: !!un.estadia_id,
      cardapio: cardapio.map((p: Record<string, unknown>) => ({ id: p.id, nome: p.nome, grupo: p.tipo === 'servico' && Number(p.preco) === 0 ? (p.grupo ?? 'Pedidos ao quarto') : p.grupo, preco: Number(p.preco), servico: p.tipo === 'servico' })),
      frigobar: frigobar.map((p: Record<string, unknown>) => ({ id: p.id, nome: p.nome, preco: Number(p.preco), quantidade: Number(p.quantidade) })),
      pedidos: meus.map((p: Record<string, unknown>) => ({ id: p.id, itens: p.itens, total: Number(p.total), status: p.status, motivo: p.motivo, criadoEm: p.criado_em })),
    };
  }

  async pedir(token: string, dto: NovoPedidoDto) {
    const un = await this.unidadePorToken(token);
    if (!un.estadia_id) throw new BadRequestException('Os pedidos pelo celular funcionam enquanto você está hospedado. Fale com a recepção.');
    const [pend] = await this.ds.query(`SELECT count(*)::int AS n FROM pedidos WHERE estadia_id = $1 AND status = 'novo'`, [un.estadia_id]);
    if (Number(pend.n) >= 3) throw new BadRequestException('Você já tem pedidos aguardando a recepção. Aguarde um pouco.');
    const ids = [...new Set(dto.itens.map((i) => i.produtoId))];
    const prods = await this.ds.query(
      `SELECT id, nome, preco FROM produtos WHERE empresa_id = $1 AND ativo AND id = ANY($2::uuid[])
          AND ((cardapio AND (preco > 0 OR tipo = 'servico') AND NOT frigobar)
               OR id IN (SELECT produto_id FROM frigobar_categoria WHERE categoria_id = $3))`, [un.empresa_id, ids, un.categoria_id]);
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
    const [novo] = await this.ds.query(`INSERT INTO pedidos (empresa_id, unidade_id, estadia_id, itens, total, observacao) VALUES ($1,$2,$3,$4::jsonb,$5,$6) RETURNING *`,
      [un.empresa_id, un.id, un.estadia_id, JSON.stringify(itens), total.toFixed(2), dto.observacao?.trim() || null]);
    // empresa com servidor local: o pedido feito pela internet vai para lá pela ponte
    await enviarParaLocal(this.ds, un.empresa_id, 'pedido', { pedido: novo });
    void this.avisos.avisar(un.empresa_id, { titulo: `Pedido do quarto ${un.codigo}`, texto: itens.map((i) => `${i.quantidade}x ${i.nome}`).join(', ').slice(0, 300), link: '/servico-quartos' }, ['estadias.operar', 'cozinha.ver']);
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
        WHERE p.empresa_id = $1 AND p.status IN ('novo','aceito','saiu') AND p.criado_em > now() - interval '1 day'${f} ORDER BY p.criado_em`, params);
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

  /** um pedido, para imprimir o ticket do bar/cozinha */
  async um(u: UsuarioToken, id: string) {
    const [p] = await this.ds.query(
      `SELECT p.*, un.codigo, un.tipo, un.ambiente_id, e.nome AS empresa FROM pedidos p JOIN unidades un ON un.id = p.unidade_id JOIN empresas e ON e.id = p.empresa_id
        WHERE p.id = $1 AND p.empresa_id = $2`, [id, u.empresaId]);
    if (!p) throw new NotFoundException('Pedido não encontrado.');
    return { ...fmt(p), tipo: p.tipo, empresa: p.empresa };
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
        if (!(i.preco > 0)) continue; // serviço sem custo (toalha, cobertor, limpeza): só atender
        await this.estadias.lancarItem(u, p.estadia_id, { produtoId: i.produtoId, quantidade: i.quantidade, precoUnitario: i.preco }, { semImpressao: true });
      }
    } catch (e) {
      await this.ds.query(`UPDATE pedidos SET status = 'novo', aceito_por = NULL, aceito_em = NULL WHERE id = $1`, [id]);
      throw e;
    }
    // ticket do pedido inteiro (com os serviços, ex.: toalha) nas impressoras
    const [un] = await this.ds.query(`SELECT ambiente_id FROM unidades WHERE id = $1`, [p.unidade_id ?? p.unidadeId]);
    void this.impressao.producao(u.empresaId, {
      ambienteId: un?.ambiente_id ?? null, unidadeId: p.unidade_id ?? p.unidadeId, titulo: 'PEDIDO', origem: 'pedido', usuario: u.nome, obs: p.observacao ?? null,
      itens: (p.itens as ItemPedido[]).map((i) => ({ produtoId: i.produtoId, nome: i.nome, quantidade: i.quantidade })),
    });
    return { ok: true };
  }

  async entregue(u: UsuarioToken, id: string) {
    const p = await this.pedido(u, id);
    if (p.status !== 'aceito' && p.status !== 'saiu') throw new BadRequestException('Aceite o pedido antes de marcar como entregue.');
    await this.ds.query(`UPDATE pedidos SET status = 'entregue', entregue_por = $2, entregue_em = now(), levado_por = COALESCE(levado_por, $2) WHERE id = $1`, [id, u.nome]);
    return { ok: true };
  }

  /** saiu da cozinha/recepção para o quarto: quem está levando */
  async saiu(u: UsuarioToken, id: string, levadoPor: string) {
    const p = await this.pedido(u, id);
    if (p.status !== 'aceito') throw new BadRequestException(p.status === 'novo' ? 'Aceite o pedido antes.' : 'Este pedido já saiu ou foi entregue.');
    await this.ds.query(`UPDATE pedidos SET status = 'saiu', levado_por = $2, saiu_em = now() WHERE id = $1`, [id, levadoPor.trim().slice(0, 120) || u.nome]);
    return { ok: true };
  }

  /** a recepção lança o pedido (hóspede ligou ou pediu no balcão) */
  async criarPelaRecepcao(u: UsuarioToken, dto: PedidoRecepcaoDto) {
    const [un] = await this.ds.query(
      `SELECT un.id, un.codigo, (SELECT es.id FROM estadias es WHERE es.unidade_id = un.id AND es.status = 'aberta' ORDER BY es.entrada_em DESC LIMIT 1) AS estadia_id
         FROM unidades un WHERE un.id = $1 AND un.empresa_id = $2`, [dto.unidadeId, u.empresaId]);
    if (!un) throw new NotFoundException('Quarto não encontrado.');
    if (!un.estadia_id) throw new BadRequestException(`O ${un.codigo} não está ocupado agora.`);
    const ids = [...new Set(dto.itens.map((i) => i.produtoId))];
    const prods = await this.ds.query(`SELECT id, nome, preco FROM produtos WHERE empresa_id = $1 AND ativo AND id = ANY($2::uuid[])`, [u.empresaId, ids]);
    const mapa = new Map<string, Record<string, unknown>>(prods.map((p: Record<string, unknown>) => [String(p.id), p]));
    const itens: ItemPedido[] = [];
    for (const i of dto.itens) {
      const p = mapa.get(i.produtoId);
      if (!p) throw new BadRequestException('Um dos itens não está mais disponível.');
      const ja = itens.find((x) => x.produtoId === i.produtoId);
      if (ja) ja.quantidade += i.quantidade;
      else itens.push({ produtoId: i.produtoId, nome: String(p.nome), quantidade: i.quantidade, preco: Number(p.preco) });
    }
    const total = Math.round(itens.reduce((s, i) => s + i.preco * i.quantidade * 100, 0)) / 100;
    const [novo] = await this.ds.query(
      `INSERT INTO pedidos (empresa_id, unidade_id, estadia_id, itens, total, observacao, origem, lancado_por) VALUES ($1,$2,$3,$4::jsonb,$5,$6,'recepcao',$7) RETURNING id`,
      [u.empresaId, un.id, un.estadia_id, JSON.stringify(itens), total.toFixed(2), dto.observacao?.trim() || null, u.nome]);
    if (dto.aceitar) await this.aceitar(u, novo.id);
    return { ok: true, id: novo.id as string };
  }

  /** quartos ocupados (para lançar pedido pela recepção) e quem pode levar */
  async apoio(u: UsuarioToken) {
    const quartos = await this.ds.query(
      `SELECT un.id, un.codigo, a.nome AS ambiente FROM unidades un JOIN ambientes a ON a.id = un.ambiente_id
        WHERE un.empresa_id = $1 AND un.ativo AND EXISTS (SELECT 1 FROM estadias es WHERE es.unidade_id = un.id AND es.status = 'aberta')
        ORDER BY a.ordem, a.nome, un.ordem, un.codigo`, [u.empresaId]);
    const equipe = await this.ds.query(`SELECT nome FROM funcionarios WHERE empresa_id = $1 AND ativo ORDER BY nome`, [u.empresaId]);
    return { quartos, equipe: equipe.map((f: { nome: string }) => f.nome) };
  }

  /** o quadro do serviço de quartos: em aberto + o que fechou hoje */
  async quadro(u: UsuarioToken) {
    const abertos = await this.ds.query(
      `SELECT p.*, un.codigo, un.ambiente_id FROM pedidos p JOIN unidades un ON un.id = p.unidade_id
        WHERE p.empresa_id = $1 AND p.status IN ('novo','aceito','saiu') AND p.criado_em > now() - interval '2 days' ORDER BY p.criado_em`, [u.empresaId]);
    const hoje = await this.ds.query(
      `SELECT p.*, un.codigo, un.ambiente_id FROM pedidos p JOIN unidades un ON un.id = p.unidade_id
        WHERE p.empresa_id = $1 AND p.status IN ('entregue','recusado')
          AND (p.criado_em AT TIME ZONE 'America/Sao_Paulo')::date = (now() AT TIME ZONE 'America/Sao_Paulo')::date ORDER BY p.criado_em DESC`, [u.empresaId]);
    const ent = hoje.filter((p: Record<string, unknown>) => p.status === 'entregue').map(fmt);
    const tempos = ent.map((p: { minutos: number | null }) => p.minutos).filter((m: number | null): m is number => m !== null);
    return {
      agora: new Date().toISOString(), abertos: abertos.map(fmt), hoje: hoje.map(fmt),
      resumo: {
        novos: abertos.filter((p: Record<string, unknown>) => p.status === 'novo').length, preparando: abertos.filter((p: Record<string, unknown>) => p.status === 'aceito').length,
        aCaminho: abertos.filter((p: Record<string, unknown>) => p.status === 'saiu').length, entreguesHoje: ent.length,
        recusadosHoje: hoje.length - ent.length, tempoMedio: tempos.length ? Math.round(tempos.reduce((s: number, m: number) => s + m, 0) / tempos.length) : null,
        vendidoHoje: Math.round(ent.reduce((s: number, p: { total: number }) => s + p.total, 0) * 100) / 100,
      },
    };
  }

  /** relatório: tempo de atendimento, quem levou, o que mais pedem */
  async relatorio(u: UsuarioToken, dias: number) {
    const d = String(Math.min(180, Math.max(1, dias)));
    const [g] = await this.ds.query(
      `SELECT count(*)::int AS pedidos, count(*) FILTER (WHERE status = 'entregue')::int AS entregues, count(*) FILTER (WHERE status = 'recusado')::int AS recusados,
              count(*) FILTER (WHERE origem = 'recepcao')::int AS pela_recepcao, COALESCE(sum(total) FILTER (WHERE status = 'entregue'), 0) AS vendido,
              round(avg(extract(epoch FROM entregue_em - criado_em) / 60) FILTER (WHERE status = 'entregue'))::int AS tempo_medio,
              round(avg(extract(epoch FROM aceito_em - criado_em) / 60) FILTER (WHERE aceito_em IS NOT NULL))::int AS tempo_aceite
         FROM pedidos WHERE empresa_id = $1 AND criado_em > now() - ($2 || ' days')::interval`, [u.empresaId, d]);
    const porPessoa = await this.ds.query(
      `SELECT COALESCE(levado_por, entregue_por) AS nome, count(*)::int AS entregas, round(avg(extract(epoch FROM entregue_em - criado_em) / 60))::int AS tempo_medio
         FROM pedidos WHERE empresa_id = $1 AND status = 'entregue' AND criado_em > now() - ($2 || ' days')::interval GROUP BY 1 ORDER BY 2 DESC`, [u.empresaId, d]);
    const itens = await this.ds.query(
      `SELECT i->>'nome' AS nome, sum((i->>'quantidade')::int)::int AS quantidade, sum((i->>'quantidade')::int * (i->>'preco')::numeric) AS valor
         FROM pedidos p, jsonb_array_elements(p.itens) i WHERE p.empresa_id = $1 AND p.status = 'entregue' AND p.criado_em > now() - ($2 || ' days')::interval
        GROUP BY 1 ORDER BY 2 DESC LIMIT 20`, [u.empresaId, d]);
    const porHora = await this.ds.query(
      `SELECT extract(hour FROM criado_em AT TIME ZONE 'America/Sao_Paulo')::int AS hora, count(*)::int AS pedidos
         FROM pedidos WHERE empresa_id = $1 AND criado_em > now() - ($2 || ' days')::interval GROUP BY 1 ORDER BY 1`, [u.empresaId, d]);
    return {
      dias: Number(d),
      geral: { pedidos: Number(g?.pedidos ?? 0), entregues: Number(g?.entregues ?? 0), recusados: Number(g?.recusados ?? 0), pelaRecepcao: Number(g?.pela_recepcao ?? 0),
        vendido: Number(g?.vendido ?? 0), tempoMedio: g?.tempo_medio === null || g?.tempo_medio === undefined ? null : Number(g.tempo_medio),
        tempoAceite: g?.tempo_aceite === null || g?.tempo_aceite === undefined ? null : Number(g.tempo_aceite) },
      porPessoa: porPessoa.map((x: Record<string, unknown>) => ({ nome: x.nome ?? '—', entregas: Number(x.entregas), tempoMedio: x.tempo_medio === null ? null : Number(x.tempo_medio) })),
      itens: itens.map((x: Record<string, unknown>) => ({ nome: x.nome, quantidade: Number(x.quantidade), valor: Number(x.valor) })),
      porHora: porHora.map((x: Record<string, unknown>) => ({ hora: Number(x.hora), pedidos: Number(x.pedidos) })),
    };
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

  /** pedidos ao quarto prontos (sem custo): cria os que ainda não existem */
  async servicosPadrao(u: UsuarioToken) {
    const nomes = ['Troca de toalhas', 'Toalha extra', 'Cobertor', 'Travesseiro extra', 'Limpeza do quarto', 'Kit de higiene', 'Gelo'];
    let n = 0;
    for (const nome of nomes) {
      const [ja] = await this.ds.query(`SELECT id FROM produtos WHERE empresa_id = $1 AND lower(nome) = lower($2)`, [u.empresaId, nome]);
      if (ja) continue;
      await this.ds.query(`INSERT INTO produtos (empresa_id, nome, grupo, tipo, preco, cardapio, frigobar, ativo) VALUES ($1,$2,'Pedidos ao quarto','servico',0,true,false,true)`, [u.empresaId, nome]);
      n++;
    }
    return { ok: true, criados: n };
  }

  /** frigobar de cada categoria (o que vai em cada suíte/quarto e quantos) */
  async frigobarCategorias(u: UsuarioToken) {
    const l = await this.ds.query(`SELECT categoria_id, produto_id, quantidade FROM frigobar_categoria WHERE empresa_id = $1`, [u.empresaId]);
    return l.map((x: Record<string, unknown>) => ({ categoriaId: x.categoria_id, produtoId: x.produto_id, quantidade: Number(x.quantidade) }));
  }

  async salvarFrigobar(u: UsuarioToken, categoriaId: string, itens: { produtoId: string; quantidade: number }[]) {
    const [c] = await this.ds.query(`SELECT id FROM categorias WHERE id = $1 AND empresa_id = $2`, [categoriaId, u.empresaId]);
    if (!c) throw new NotFoundException('Categoria não encontrada.');
    await this.ds.transaction(async (m) => {
      await m.query(`DELETE FROM frigobar_categoria WHERE empresa_id = $1 AND categoria_id = $2`, [u.empresaId, categoriaId]);
      for (const i of itens.filter((x) => x.quantidade > 0)) {
        await m.query(`INSERT INTO frigobar_categoria (empresa_id, categoria_id, produto_id, quantidade)
                       SELECT $1, $2, id, $4 FROM produtos WHERE id = $3 AND empresa_id = $1`, [u.empresaId, categoriaId, i.produtoId, Math.min(99, Math.round(i.quantidade))]);
      }
    });
    return this.frigobarCategorias(u);
  }

  async cardapio(u: UsuarioToken) {
    const l = await this.ds.query(`SELECT id, nome, grupo, preco, cardapio, tipo, frigobar FROM produtos WHERE empresa_id = $1 AND ativo AND uso = 'venda' ORDER BY grupo NULLS LAST, nome`, [u.empresaId]);
    return l.map((p: Record<string, unknown>) => ({ id: p.id, nome: p.nome, grupo: p.grupo, preco: Number(p.preco), cardapio: p.cardapio, tipo: p.tipo, frigobar: p.frigobar }));
  }

  async marcarCardapio(u: UsuarioToken, produtoId: string, cardapio: boolean) {
    await this.ds.query(`UPDATE produtos SET cardapio = $3 WHERE id = $1 AND empresa_id = $2`, [produtoId, u.empresaId, cardapio]);
    return { ok: true };
  }
}
