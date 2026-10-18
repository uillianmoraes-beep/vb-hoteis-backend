import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UsuarioToken } from '../common/permissoes';
import { soDigitos } from '../common/cnpj';
import { moverEstoque } from '../estoque/estoque.core';
import { AdicionarFornecedoresDto, CotacaoDto, EscolhasDto, FornecedorDto, ModeloDto, ReceberDto, RespostaDto } from './compras.dto';

interface Q { query: (sql: string, params?: unknown[]) => Promise<any> }
const num = (v: unknown) => Number(v ?? 0);
const r2 = (v: number) => Math.round(v * 100) / 100;
const TOKEN = `substr(md5(random()::text || clock_timestamp()::text || gen_random_uuid()::text), 1, 24)`;
const linhas = (r: any) => (Array.isArray(r?.[0]) ? r[0] : r);
/** mesma chave para o mesmo produto (cadastrado) ou para o mesmo texto (item avulso) */
const CHAVE_ITEM = `COALESCE(i.produto_id::text, lower(trim(i.descricao)))`;
const chaveItem = (i: { produto_id?: unknown; descricao?: unknown }) => (i.produto_id ? String(i.produto_id) : String(i.descricao ?? '').trim().toLowerCase());

export interface UltimoPreco { preco: number; marca: string | null; fornecedor: string; data: string; comprado: boolean; numero: number }

@Injectable()
export class ComprasService {
  constructor(private readonly ds: DataSource) {}

  // ---------- fornecedores ----------

  async fornecedores(u: UsuarioToken, todos = false) {
    const l = await this.ds.query(`SELECT * FROM fornecedores WHERE empresa_id = $1${todos ? '' : ' AND ativo'} ORDER BY ativo DESC, nome`, [u.empresaId]);
    return l.map((f: Record<string, unknown>) => ({
      id: f.id, nome: f.nome, cnpj: f.cnpj, contato: f.contato, telefone: f.telefone, email: f.email, categorias: f.categorias, observacao: f.observacao, ativo: f.ativo,
    }));
  }

  private valoresFornecedor(dto: FornecedorDto) {
    const t = (v?: string | null) => (v ?? '').trim() || null;
    return [dto.nome.trim(), soDigitos(dto.cnpj) || null, t(dto.contato), soDigitos(dto.telefone) || null, t(dto.email), t(dto.categorias), t(dto.observacao)];
  }

  async criarFornecedor(u: UsuarioToken, dto: FornecedorDto) {
    const [f] = await this.ds.query(
      `INSERT INTO fornecedores (empresa_id, nome, cnpj, contato, telefone, email, categorias, observacao) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [u.empresaId, ...this.valoresFornecedor(dto)]);
    return { id: f.id };
  }

  async atualizarFornecedor(u: UsuarioToken, id: string, dto: FornecedorDto) {
    const r = await this.ds.query(
      `UPDATE fornecedores SET nome = $3, cnpj = $4, contato = $5, telefone = $6, email = $7, categorias = $8, observacao = $9, ativo = $10
        WHERE id = $1 AND empresa_id = $2 RETURNING id`,
      [id, u.empresaId, ...this.valoresFornecedor(dto), dto.ativo ?? true]);
    if (!linhas(r).length) throw new NotFoundException('Fornecedor não encontrado.');
    return { ok: true };
  }

  // ---------- cotações ----------

  async listar(u: UsuarioToken, status?: string) {
    const params: unknown[] = [u.empresaId];
    let w = '';
    if (status && ['aberta', 'fechada', 'cancelada'].includes(status)) { params.push(status); w = ` AND c.status = $2`; }
    const l = await this.ds.query(
      `SELECT c.id, c.numero, c.titulo, c.status, c.prazo::text AS prazo, c.criado_em, c.criado_por, c.fechada_em,
              (SELECT COUNT(*) FROM cotacao_itens i WHERE i.cotacao_id = c.id) AS itens,
              (SELECT COUNT(*) FROM cotacao_fornecedores cf WHERE cf.cotacao_id = c.id) AS fornecedores,
              (SELECT COUNT(*) FROM cotacao_fornecedores cf WHERE cf.cotacao_id = c.id AND cf.status = 'respondeu') AS respondidos
         FROM cotacoes c WHERE c.empresa_id = $1${w} ORDER BY c.criado_em DESC LIMIT 200`, params);
    return l.map((c: Record<string, unknown>) => ({
      id: c.id, numero: c.numero, titulo: c.titulo, status: c.status, prazo: (c.prazo as string | null) ?? null,
      criadoEm: c.criado_em, criadoPor: c.criado_por, fechadaEm: c.fechada_em, itens: num(c.itens), fornecedores: num(c.fornecedores), respondidos: num(c.respondidos),
    }));
  }

  private async cotacao(empresaId: string, id: string, q: Q = this.ds) {
    const [c] = await q.query(`SELECT *, prazo::text AS prazo_txt FROM cotacoes WHERE id = $1 AND empresa_id = $2`, [id, empresaId]);
    if (!c) throw new NotFoundException('Cotação não encontrada.');
    return c as { id: string; numero: number; status: string; titulo: string; local_id: string | null; empresa_id: string };
  }

  private aberta(c: { status: string }) {
    if (c.status !== 'aberta') throw new BadRequestException('Esta cotação já foi fechada ou cancelada.');
  }

  private async convidar(m: Q, empresaId: string, cotacaoId: string, fornecedores: string[]) {
    if (!fornecedores.length) return;
    const ok = await m.query(`SELECT id FROM fornecedores WHERE empresa_id = $1 AND id = ANY($2::uuid[])`, [empresaId, fornecedores]);
    if (ok.length !== new Set(fornecedores).size) throw new BadRequestException('Algum fornecedor não foi encontrado.');
    for (const f of ok) {
      await m.query(`INSERT INTO cotacao_fornecedores (cotacao_id, fornecedor_id, token) VALUES ($1,$2,${TOKEN}) ON CONFLICT (cotacao_id, fornecedor_id) DO NOTHING`, [cotacaoId, f.id]);
    }
  }

  async criar(u: UsuarioToken, dto: CotacaoDto) {
    if (dto.localId) {
      const [l] = await this.ds.query(`SELECT id FROM estoque_locais WHERE id = $1 AND empresa_id = $2`, [dto.localId, u.empresaId]);
      if (!l) throw new BadRequestException('Local de estoque não encontrado.');
    }
    const prods = dto.itens.filter((i) => i.produtoId).map((i) => i.produtoId!);
    if (prods.length) {
      const ok = await this.ds.query(`SELECT id FROM produtos WHERE empresa_id = $1 AND id = ANY($2::uuid[])`, [u.empresaId, prods]);
      if (ok.length !== new Set(prods).size) throw new BadRequestException('Algum produto não foi encontrado.');
    }
    return this.ds.transaction(async (m) => {
      const [{ n }] = linhas(await m.query(`UPDATE empresas SET ultima_cotacao = ultima_cotacao + 1 WHERE id = $1 RETURNING ultima_cotacao AS n`, [u.empresaId]));
      const [c] = await m.query(
        `INSERT INTO cotacoes (empresa_id, numero, titulo, local_id, prazo, observacao, criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [u.empresaId, n, dto.titulo.trim(), dto.localId ?? null, dto.prazo ?? null, dto.observacao?.trim() || null, u.nome]);
      let ordem = 0;
      for (const i of dto.itens) {
        await m.query(`INSERT INTO cotacao_itens (cotacao_id, produto_id, descricao, quantidade, unidade, ordem) VALUES ($1,$2,$3,$4,$5,$6)`,
          [c.id, i.produtoId ?? null, i.descricao.trim(), i.quantidade, (i.unidade ?? 'un').trim() || 'un', ordem++]);
      }
      await this.convidar(m, u.empresaId, c.id, dto.fornecedores);
      return { id: c.id, numero: n };
    });
  }

  async adicionarFornecedores(u: UsuarioToken, id: string, dto: AdicionarFornecedoresDto) {
    this.aberta(await this.cotacao(u.empresaId, id));
    await this.convidar(this.ds, u.empresaId, id, dto.fornecedores);
    return { ok: true };
  }

  async removerFornecedor(u: UsuarioToken, id: string, cfId: string) {
    this.aberta(await this.cotacao(u.empresaId, id));
    await this.ds.query(`UPDATE cotacao_itens SET escolhido_id = NULL WHERE cotacao_id = $1 AND escolhido_id = $2`, [id, cfId]);
    await this.ds.query(`DELETE FROM cotacao_fornecedores WHERE id = $1 AND cotacao_id = $2`, [cfId, id]);
    return { ok: true };
  }

  async detalhe(u: UsuarioToken, id: string) {
    const c = await this.cotacao(u.empresaId, id);
    const [local] = c.local_id ? await this.ds.query(`SELECT nome, cnpj FROM estoque_locais WHERE id = $1`, [c.local_id]) : [];
    const itens = await this.ds.query(`SELECT * FROM cotacao_itens WHERE cotacao_id = $1 ORDER BY ordem, descricao`, [id]);
    const cfs = await this.ds.query(
      `SELECT cf.*, f.nome, f.telefone, f.email, f.contato, f.cnpj FROM cotacao_fornecedores cf JOIN fornecedores f ON f.id = cf.fornecedor_id
        WHERE cf.cotacao_id = $1 ORDER BY f.nome`, [id]);
    const precos = await this.ds.query(
      `SELECT p.* FROM cotacao_precos p JOIN cotacao_fornecedores cf ON cf.id = p.cotacao_fornecedor_id WHERE cf.cotacao_id = $1`, [id]);
    const mapa = new Map<string, { preco: number | null; marca: string | null }>();
    for (const p of precos) mapa.set(`${p.cotacao_fornecedor_id}:${p.item_id}`, { preco: p.preco === null ? null : num(p.preco), marca: p.marca });
    const ultimos = await this.ultimosPrecos(u.empresaId, id, itens.map(chaveItem));

    const its = itens.map((i: Record<string, unknown>) => {
      const q = num(i.quantidade);
      const ofertas = cfs.map((f: { id: string }) => {
        const p = mapa.get(`${f.id}:${i.id}`);
        return { cotacaoFornecedorId: f.id, preco: p?.preco ?? null, marca: p?.marca ?? null, total: p?.preco ? r2(p.preco * q) : null };
      });
      const validas = ofertas.filter((o: { preco: number | null }) => o.preco !== null && o.preco > 0);
      const menor = validas.length ? validas.reduce((a: { preco: number }, b: { preco: number }) => (b.preco < a.preco ? b : a)) : null;
      return {
        id: i.id, produtoId: i.produto_id, descricao: i.descricao, quantidade: q, unidade: i.unidade, escolhidoId: i.escolhido_id,
        ofertas, menorId: menor?.cotacaoFornecedorId ?? null, ultimo: ultimos.get(chaveItem(i)) ?? null,
      };
    });
    const fornecedores = cfs.map((f: Record<string, unknown>) => {
      let total = 0; let cotados = 0; let escolhidos = 0; let totalEscolhido = 0;
      for (const i of its) {
        const o = i.ofertas.find((x: { cotacaoFornecedorId: string }) => x.cotacaoFornecedorId === f.id);
        if (o?.total) { total += o.total; cotados++; }
        if (i.escolhidoId === f.id && o?.total) { escolhidos++; totalEscolhido += o.total; }
      }
      return {
        id: f.id, fornecedorId: f.fornecedor_id, nome: f.nome, telefone: f.telefone, email: f.email, contato: f.contato, cnpj: f.cnpj, token: f.token, status: f.status,
        respondidoEm: f.respondido_em, prazoEntrega: f.prazo_entrega, condicaoPagamento: f.condicao_pagamento, frete: num(f.frete), observacao: f.observacao,
        total: r2(total), cotados, escolhidos, totalEscolhido: r2(totalEscolhido), completo: cotados === its.length,
        recebidoEm: f.recebido_em ?? null, recebidoPor: f.recebido_por ?? null,
      };
    });
    const totalEscolhido = r2(fornecedores.reduce((s: number, f: { totalEscolhido: number; escolhidos: number; frete: number }) => s + f.totalEscolhido + (f.escolhidos ? f.frete : 0), 0));
    const totalMenor = r2(its.reduce((s: number, i: { menorId: string | null; ofertas: { cotacaoFornecedorId: string; total: number | null }[] }) =>
      s + (i.ofertas.find((o) => o.cotacaoFornecedorId === i.menorId)?.total ?? 0), 0));
    const cc = c as unknown as Record<string, unknown>;
    return {
      id: c.id, numero: c.numero, titulo: c.titulo, status: c.status, prazo: (cc.prazo_txt as string | null) ?? null,
      observacao: cc.observacao, criadoPor: cc.criado_por, criadoEm: cc.criado_em, fechadaEm: cc.fechada_em, fechadaPor: cc.fechada_por,
      local: local ? { id: c.local_id, nome: local.nome, cnpj: local.cnpj } : null,
      itens: its, fornecedores, totalEscolhido, totalMenor,
    };
  }

  private async salvarResposta(m: Q, cotacaoId: string, cfId: string, dto: RespostaDto) {
    const ids = new Set((await m.query(`SELECT id FROM cotacao_itens WHERE cotacao_id = $1`, [cotacaoId])).map((i: { id: string }) => i.id));
    for (const p of dto.precos) {
      if (!ids.has(p.itemId)) throw new BadRequestException('Item não pertence a esta cotação.');
      await m.query(
        `INSERT INTO cotacao_precos (cotacao_fornecedor_id, item_id, preco, marca) VALUES ($1,$2,$3,$4)
         ON CONFLICT (cotacao_fornecedor_id, item_id) DO UPDATE SET preco = $3, marca = $4`,
        [cfId, p.itemId, p.preco === undefined || p.preco === null ? null : p.preco, p.marca?.trim() || null]);
    }
    await m.query(
      `UPDATE cotacao_fornecedores SET status = $2, respondido_em = now(), prazo_entrega = $3, condicao_pagamento = $4, frete = $5, observacao = $6 WHERE id = $1`,
      [cfId, dto.recusar ? 'recusou' : 'respondeu', dto.prazoEntrega?.trim() || null, dto.condicaoPagamento?.trim() || null, dto.frete ?? 0, dto.observacao?.trim() || null]);
  }

  /** a recepção/gerência digita os preços que o fornecedor passou por telefone/WhatsApp */
  async responderInterno(u: UsuarioToken, id: string, cfId: string, dto: RespostaDto) {
    this.aberta(await this.cotacao(u.empresaId, id));
    const [cf] = await this.ds.query(`SELECT id FROM cotacao_fornecedores WHERE id = $1 AND cotacao_id = $2`, [cfId, id]);
    if (!cf) throw new NotFoundException('Fornecedor não está nesta cotação.');
    await this.ds.transaction((m) => this.salvarResposta(m, id, cfId, dto));
    return { ok: true };
  }

  async escolher(u: UsuarioToken, id: string, dto: EscolhasDto) {
    this.aberta(await this.cotacao(u.empresaId, id));
    await this.ds.transaction(async (m) => {
      for (const e of dto.escolhas) {
        await m.query(
          `UPDATE cotacao_itens SET escolhido_id = (SELECT cf.id FROM cotacao_fornecedores cf WHERE cf.id = $3::uuid AND cf.cotacao_id = $2) WHERE id = $1 AND cotacao_id = $2`,
          [e.itemId, id, e.cotacaoFornecedorId ?? null]);
      }
    });
    return { ok: true };
  }

  async melhorPreco(u: UsuarioToken, id: string) {
    const d = await this.detalhe(u, id);
    this.aberta(d);
    return this.escolher(u, id, { escolhas: d.itens.map((i: { id: string; menorId: string | null }) => ({ itemId: i.id, cotacaoFornecedorId: i.menorId })) });
  }

  async fechar(u: UsuarioToken, id: string) {
    this.aberta(await this.cotacao(u.empresaId, id));
    const [{ n }] = await this.ds.query(`SELECT COUNT(*) AS n FROM cotacao_itens WHERE cotacao_id = $1 AND escolhido_id IS NOT NULL`, [id]);
    if (!num(n)) throw new BadRequestException('Escolha de quem comprar cada item antes de fechar (ou use "Menor preço").');
    await this.ds.query(`UPDATE cotacoes SET status = 'fechada', fechada_em = now(), fechada_por = $3 WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId, u.nome]);
    return { ok: true };
  }

  async cancelar(u: UsuarioToken, id: string) {
    const c = await this.cotacao(u.empresaId, id);
    if (c.status === 'cancelada') return { ok: true };
    await this.ds.query(`UPDATE cotacoes SET status = 'cancelada', fechada_em = now(), fechada_por = $3 WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId, u.nome]);
    return { ok: true };
  }

  async reabrir(u: UsuarioToken, id: string) {
    await this.cotacao(u.empresaId, id);
    const [rec] = await this.ds.query(`SELECT 1 FROM cotacao_fornecedores WHERE cotacao_id = $1 AND recebido_em IS NOT NULL LIMIT 1`, [id]);
    if (rec) throw new BadRequestException('Já foi dada entrada no estoque de um pedido desta cotação. Para comprar de novo, use "Repetir cotação".');
    await this.ds.query(`UPDATE cotacoes SET status = 'aberta', fechada_em = NULL, fechada_por = NULL WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    return { ok: true };
  }

  /** pedido de compra de um fornecedor (itens escolhidos dele) */
  async pedido(u: UsuarioToken, id: string, cfId: string) {
    const d = await this.detalhe(u, id);
    const f = d.fornecedores.find((x: { id: string }) => x.id === cfId);
    if (!f) throw new NotFoundException('Fornecedor não está nesta cotação.');
    const [emp] = await this.ds.query(`SELECT nome, razao_social, cnpj FROM empresas WHERE id = $1`, [u.empresaId]);
    let comprador = { nome: emp?.razao_social || emp?.nome || '', cnpj: emp?.cnpj ?? null as string | null };
    if (d.local?.cnpj) {
      const [a] = await this.ds.query(
        `SELECT razao_social, nome, cnpj FROM ambientes WHERE empresa_id = $1 AND regexp_replace(coalesce(cnpj,''),'\\D','','g') = $2 LIMIT 1`, [u.empresaId, d.local.cnpj]);
      if (a) comprador = { nome: a.razao_social || a.nome, cnpj: a.cnpj };
    }
    const itens = d.itens.filter((i: { escolhidoId: string | null }) => i.escolhidoId === cfId).map((i: { descricao: string; quantidade: number; unidade: string; ofertas: { cotacaoFornecedorId: string; preco: number | null; marca: string | null; total: number | null }[] }) => {
      const o = i.ofertas.find((x) => x.cotacaoFornecedorId === cfId)!;
      return { descricao: i.descricao, quantidade: i.quantidade, unidade: i.unidade, preco: o.preco, marca: o.marca, total: o.total ?? 0 };
    });
    const subtotal = r2(itens.reduce((s: number, i: { total: number }) => s + i.total, 0));
    return {
      numero: d.numero, titulo: d.titulo, status: d.status, local: d.local?.nome ?? null, comprador,
      fornecedor: { nome: f.nome, cnpj: f.cnpj, telefone: f.telefone, email: f.email, contato: f.contato, prazoEntrega: f.prazoEntrega, condicaoPagamento: f.condicaoPagamento, frete: f.frete },
      itens, subtotal, total: r2(subtotal + (itens.length ? f.frete : 0)), fechadaEm: d.fechadaEm, fechadaPor: d.fechadaPor,
    };
  }

  // ---------- histórico de preços ----------

  /**
   * Último preço de cada item (mesmo produto ou mesmo texto) em outras cotações.
   * Sem fornecedor: prefere o que foi comprado (cotação fechada); com fornecedor: o último que ele passou.
   */
  private async ultimosPrecos(empresaId: string, excluirCotacao: string, chaves: string[], fornecedorId?: string): Promise<Map<string, UltimoPreco>> {
    const mapa = new Map<string, UltimoPreco>();
    const unicas = [...new Set(chaves.filter(Boolean))];
    if (!unicas.length) return mapa;
    const params: unknown[] = [empresaId, excluirCotacao, unicas];
    if (fornecedorId) params.push(fornecedorId);
    const l = await this.ds.query(
      `SELECT DISTINCT ON (chave) chave, preco, marca, fornecedor, data, comprado, numero FROM (
         SELECT ${CHAVE_ITEM} AS chave, p.preco, p.marca, f.nome AS fornecedor, c.numero,
                COALESCE(cf.respondido_em, c.criado_em) AS data, (i.escolhido_id = cf.id AND c.status = 'fechada') AS comprado
           FROM cotacao_itens i
           JOIN cotacoes c ON c.id = i.cotacao_id
           JOIN cotacao_precos p ON p.item_id = i.id
           JOIN cotacao_fornecedores cf ON cf.id = p.cotacao_fornecedor_id
           JOIN fornecedores f ON f.id = cf.fornecedor_id
          WHERE c.empresa_id = $1 AND c.id <> $2 AND c.status <> 'cancelada' AND p.preco > 0
            AND ${CHAVE_ITEM} = ANY($3::text[])${fornecedorId ? ' AND cf.fornecedor_id = $4' : ''}
       ) x ORDER BY chave, ${fornecedorId ? '' : 'comprado DESC, '}data DESC`, params);
    for (const r of l) {
      mapa.set(r.chave, { preco: num(r.preco), marca: r.marca ?? null, fornecedor: r.fornecedor, data: r.data, comprado: !!r.comprado, numero: num(r.numero) });
    }
    return mapa;
  }

  /** preços que os distribuidores já passaram (todas as cotações), do mais novo para o mais antigo */
  async historicoPrecos(u: UsuarioToken, busca?: string) {
    const params: unknown[] = [u.empresaId];
    let filtro = '';
    if (busca?.trim()) {
      params.push(`%${busca.trim()}%`);
      filtro = ` AND (i.descricao ILIKE $2 OR pr.nome ILIKE $2 OR f.nome ILIKE $2 OR pr.grupo ILIKE $2)`;
    }
    const l = await this.ds.query(
      `SELECT ${CHAVE_ITEM} AS chave, i.produto_id, COALESCE(pr.nome, i.descricao) AS item, i.unidade, pr.grupo,
              f.id AS fornecedor_id, f.nome AS fornecedor, p.preco, p.marca, c.id AS cotacao_id, c.numero,
              COALESCE(cf.respondido_em, c.criado_em) AS data, (i.escolhido_id = cf.id AND c.status = 'fechada') AS comprado
         FROM cotacao_precos p
         JOIN cotacao_itens i ON i.id = p.item_id
         JOIN cotacoes c ON c.id = i.cotacao_id
         JOIN cotacao_fornecedores cf ON cf.id = p.cotacao_fornecedor_id
         JOIN fornecedores f ON f.id = cf.fornecedor_id
         LEFT JOIN produtos pr ON pr.id = i.produto_id
        WHERE c.empresa_id = $1 AND c.status <> 'cancelada' AND p.preco > 0${filtro}
        ORDER BY data DESC LIMIT 800`, params);
    return l.map((r: Record<string, unknown>) => ({
      chave: r.chave, produtoId: r.produto_id ?? null, item: r.item, unidade: r.unidade, grupo: r.grupo ?? null,
      fornecedorId: r.fornecedor_id, fornecedor: r.fornecedor, preco: num(r.preco), marca: r.marca ?? null,
      cotacaoId: r.cotacao_id, numero: num(r.numero), data: r.data, comprado: !!r.comprado,
    }));
  }

  // ---------- listas padrão ----------

  async modelos(u: UsuarioToken) {
    const l = await this.ds.query(`SELECT id, nome, itens, atualizado_em FROM cotacao_modelos WHERE empresa_id = $1 ORDER BY nome`, [u.empresaId]);
    return l.map((m: Record<string, unknown>) => ({ id: m.id, nome: m.nome, itens: Array.isArray(m.itens) ? m.itens : [], atualizadoEm: m.atualizado_em }));
  }

  async salvarModelo(u: UsuarioToken, dto: ModeloDto) {
    const nome = dto.nome.trim();
    if (!nome) throw new BadRequestException('Dê um nome para a lista.');
    const itens = dto.itens
      .filter((i) => i.descricao.trim())
      .map((i) => ({ produtoId: i.produtoId ?? null, descricao: i.descricao.trim(), quantidade: i.quantidade ?? null, unidade: (i.unidade ?? 'un').trim() || 'un' }));
    if (!itens.length) throw new BadRequestException('A lista precisa de pelo menos um item.');
    const [m] = await this.ds.query(
      `INSERT INTO cotacao_modelos (empresa_id, nome, itens) VALUES ($1,$2,$3::jsonb)
       ON CONFLICT (empresa_id, nome) DO UPDATE SET itens = EXCLUDED.itens, atualizado_em = now() RETURNING id`,
      [u.empresaId, nome, JSON.stringify(itens)]);
    return { id: m.id };
  }

  async excluirModelo(u: UsuarioToken, id: string) {
    const r = await this.ds.query(`DELETE FROM cotacao_modelos WHERE id = $1 AND empresa_id = $2 RETURNING id`, [id, u.empresaId]);
    if (!linhas(r).length) throw new NotFoundException('Lista não encontrada.');
    return { ok: true };
  }

  // ---------- entrada no estoque ----------

  /** dá entrada no estoque dos itens comprados de um fornecedor (cotação fechada), com o preço da cotação como custo */
  async receber(u: UsuarioToken, id: string, cfId: string, dto: ReceberDto) {
    const c = await this.cotacao(u.empresaId, id);
    if (c.status !== 'fechada') throw new BadRequestException('Feche a cotação antes de dar entrada no estoque.');
    const [cf] = await this.ds.query(
      `SELECT cf.id, cf.recebido_em, f.nome FROM cotacao_fornecedores cf JOIN fornecedores f ON f.id = cf.fornecedor_id WHERE cf.id = $1 AND cf.cotacao_id = $2`, [cfId, id]);
    if (!cf) throw new NotFoundException('Fornecedor não está nesta cotação.');
    if (cf.recebido_em) throw new BadRequestException(`A entrada deste pedido já foi feita em ${new Date(cf.recebido_em).toLocaleDateString('pt-BR')}.`);
    const localId = dto.localId || c.local_id;
    if (!localId) throw new BadRequestException('Escolha em qual estoque os itens vão entrar.');
    const [local] = await this.ds.query(`SELECT id, nome FROM estoque_locais WHERE id = $1 AND empresa_id = $2 AND ativo`, [localId, u.empresaId]);
    if (!local) throw new BadRequestException('Local de estoque não encontrado.');

    const itens = await this.ds.query(
      `SELECT i.id, i.produto_id, i.descricao, i.quantidade, p.preco FROM cotacao_itens i
         JOIN cotacao_precos p ON p.item_id = i.id AND p.cotacao_fornecedor_id = $2
        WHERE i.cotacao_id = $1 AND i.escolhido_id = $2 ORDER BY i.ordem`, [id, cfId]);
    if (!itens.length) throw new BadRequestException('Nenhum item foi comprado deste fornecedor.');
    const prods = [...new Set(itens.filter((i: { produto_id: string | null }) => i.produto_id).map((i: { produto_id: string }) => i.produto_id))];
    const existem = new Set<string>(prods.length
      ? (await this.ds.query(`SELECT id FROM produtos WHERE empresa_id = $1 AND id = ANY($2::uuid[])`, [u.empresaId, prods])).map((p: { id: string }) => p.id)
      : []);
    const informado = new Map((dto.itens ?? []).map((x) => [x.itemId, x]));
    const semCadastro: string[] = [];
    let entradas = 0;
    await this.ds.transaction(async (m) => {
      for (const i of itens) {
        if (!i.produto_id || !existem.has(i.produto_id)) { semCadastro.push(i.descricao); continue; }
        const inf = informado.get(i.id);
        const q = inf ? inf.quantidade : num(i.quantidade);
        if (!(q > 0)) continue;
        const custo = inf?.custo !== undefined && inf?.custo !== null ? inf.custo : num(i.preco);
        await m.query(`UPDATE produtos SET controla_estoque = true WHERE id = $1 AND NOT controla_estoque`, [i.produto_id]);
        await moverEstoque(m, {
          empresaId: u.empresaId, localId: local.id, produtoId: i.produto_id, quantidade: q, tipo: 'entrada', custoUnitario: custo,
          documento: dto.documento?.trim() || `Cotação ${c.numero}`, referencia: `cotacao:${id}:${cfId}`,
          observacao: `Compra de ${cf.nome} (cotação nº ${c.numero})`, usuario: u.nome,
        });
        entradas++;
      }
      await m.query(`UPDATE cotacao_fornecedores SET recebido_em = now(), recebido_por = $2 WHERE id = $1`, [cfId, u.nome]);
    });
    return { ok: true, entradas, semCadastro, local: local.nome };
  }

  // ---------- link público do fornecedor ----------

  private async porToken(token: string) {
    const [cf] = await this.ds.query(
      `SELECT cf.*, f.nome AS fornecedor, c.id AS cot_id, c.numero, c.titulo, c.prazo::text AS prazo, c.observacao AS cot_obs, c.status AS cot_status, c.empresa_id,
              e.nome AS empresa
         FROM cotacao_fornecedores cf JOIN fornecedores f ON f.id = cf.fornecedor_id JOIN cotacoes c ON c.id = cf.cotacao_id JOIN empresas e ON e.id = c.empresa_id
        WHERE cf.token = $1`, [token]);
    if (!cf) throw new NotFoundException('Link de cotação inválido.');
    return cf;
  }

  async publico(token: string) {
    const cf = await this.porToken(token);
    const itens = await this.ds.query(
      `SELECT i.id, i.produto_id, i.descricao, i.quantidade, i.unidade, p.preco, p.marca FROM cotacao_itens i
         LEFT JOIN cotacao_precos p ON p.item_id = i.id AND p.cotacao_fornecedor_id = $2
        WHERE i.cotacao_id = $1 ORDER BY i.ordem, i.descricao`, [cf.cot_id, cf.id]);
    const ultimos = await this.ultimosPrecos(cf.empresa_id, cf.cot_id, itens.map(chaveItem), cf.fornecedor_id);
    return {
      empresa: cf.empresa, fornecedor: cf.fornecedor, numero: cf.numero, titulo: cf.titulo,
      prazo: cf.prazo ?? null,
      observacao: cf.cot_obs, aberta: cf.cot_status === 'aberta', status: cf.status, respondidoEm: cf.respondido_em,
      prazoEntrega: cf.prazo_entrega, condicaoPagamento: cf.condicao_pagamento, frete: num(cf.frete), obsFornecedor: cf.observacao,
      itens: itens.map((i: Record<string, unknown>) => ({ id: i.id, descricao: i.descricao, quantidade: num(i.quantidade), unidade: i.unidade, preco: i.preco === null ? null : num(i.preco), marca: i.marca,
        ultimoPreco: ultimos.get(chaveItem(i))?.preco ?? null, ultimaMarca: ultimos.get(chaveItem(i))?.marca ?? null })),
    };
  }

  async responderPublico(token: string, dto: RespostaDto) {
    const cf = await this.porToken(token);
    if (cf.cot_status !== 'aberta') throw new BadRequestException('Esta cotação já foi encerrada. Obrigado!');
    await this.ds.transaction((m) => this.salvarResposta(m, cf.cot_id, cf.id, dto));
    return { ok: true };
  }
}
