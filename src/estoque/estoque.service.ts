import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UsuarioToken } from '../common/permissoes';
import { cnpjDoAmbiente, cnpjDoForm, filtroCnpj, soDigitos } from '../common/cnpj';
import { localDoAmbiente, moverEstoque } from './estoque.core';
import { EntradaDto, EntradaNotaDto, InventarioDto, LocalDto, MinimosDto, PerdaDto, TransferenciaDto } from './estoque.dto';

const num = (v: unknown) => Number(v ?? 0);
const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

const TIPOS: Record<string, string> = {
  entrada: 'Entrada', consumo: 'Consumo', venda: 'Venda avulsa', transf_saida: 'Transferência (saiu)', transf_entrada: 'Transferência (entrou)',
  ajuste: 'Ajuste de inventário', perda: 'Perda', estorno: 'Estorno', producao_saida: 'Corte (matéria-prima)', producao_entrada: 'Corte (porções)',
};

@Injectable()
export class EstoqueService {
  constructor(private readonly ds: DataSource) {}

  private async local(empresaId: string, id: string) {
    const [l] = await this.ds.query(`SELECT * FROM estoque_locais WHERE id = $1 AND empresa_id = $2`, [id, empresaId]);
    if (!l) throw new NotFoundException('Local de estoque não encontrado.');
    return l as { id: string; nome: string; cnpj: string | null; ambiente_id: string | null; ativo: boolean };
  }

  private async produtosDaEmpresa(empresaId: string, ids: string[]) {
    const unicos = [...new Set(ids)];
    const ps = await this.ds.query(`SELECT id, nome, controla_estoque FROM produtos WHERE empresa_id = $1 AND id = ANY($2::uuid[])`, [empresaId, unicos]);
    if (ps.length !== unicos.length) throw new BadRequestException('Algum produto não foi encontrado.');
    return new Map<string, { id: string; nome: string; controla_estoque: boolean }>(ps.map((p: { id: string }) => [p.id, p]));
  }

  // ---------- locais (centros de custo) ----------

  async locais(u: UsuarioToken) {
    // garante um local para cada ambiente ativo
    const ambs = await this.ds.query(
      `SELECT a.id FROM ambientes a WHERE a.empresa_id = $1 AND a.ativo AND NOT EXISTS (SELECT 1 FROM estoque_locais l WHERE l.ambiente_id = a.id)`, [u.empresaId]);
    for (const a of ambs) await localDoAmbiente(this.ds, u.empresaId, a.id);
    const ls = await this.ds.query(
      `SELECT l.*, a.nome AS ambiente, COALESCE(SUM(s.quantidade * s.custo_medio) FILTER (WHERE s.quantidade > 0), 0) AS valor,
              COUNT(s.produto_id) FILTER (WHERE s.quantidade <> 0) AS itens
         FROM estoque_locais l LEFT JOIN ambientes a ON a.id = l.ambiente_id LEFT JOIN estoque_saldos s ON s.local_id = l.id
        WHERE l.empresa_id = $1 GROUP BY l.id, a.nome ORDER BY l.ativo DESC, l.padrao DESC, l.nome`, [u.empresaId]);
    return ls.map((l: Record<string, unknown>) => ({
      id: l.id, nome: l.nome, ambienteId: l.ambiente_id, ambiente: l.ambiente, cnpj: l.cnpj, padrao: l.padrao, ativo: l.ativo,
      valor: r2(num(l.valor)), itens: num(l.itens),
    }));
  }

  private async cnpjDoLocal(dto: LocalDto): Promise<string | null> {
    if (dto.cnpj !== undefined && dto.cnpj !== null && dto.cnpj !== '') return cnpjDoForm(dto.cnpj);
    return dto.ambienteId ? cnpjDoAmbiente(this.ds, dto.ambienteId) : null;
  }

  async criarLocal(u: UsuarioToken, dto: LocalDto) {
    if (dto.ambienteId) {
      const [a] = await this.ds.query(`SELECT id FROM ambientes WHERE id = $1 AND empresa_id = $2`, [dto.ambienteId, u.empresaId]);
      if (!a) throw new BadRequestException('Ambiente não encontrado.');
    }
    if (dto.padrao) await this.ds.query(`UPDATE estoque_locais SET padrao = false WHERE empresa_id = $1`, [u.empresaId]);
    const [l] = await this.ds.query(
      `INSERT INTO estoque_locais (empresa_id, nome, ambiente_id, cnpj, padrao) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [u.empresaId, dto.nome.trim(), dto.ambienteId ?? null, await this.cnpjDoLocal(dto), !!dto.padrao]);
    return { id: l.id };
  }

  async atualizarLocal(u: UsuarioToken, id: string, dto: LocalDto) {
    await this.local(u.empresaId, id);
    if (dto.padrao) await this.ds.query(`UPDATE estoque_locais SET padrao = false WHERE empresa_id = $1`, [u.empresaId]);
    await this.ds.query(
      `UPDATE estoque_locais SET nome = $3, ambiente_id = $4, cnpj = $5, padrao = $6, ativo = $7 WHERE id = $1 AND empresa_id = $2`,
      [id, u.empresaId, dto.nome.trim(), dto.ambienteId ?? null, await this.cnpjDoLocal(dto), !!dto.padrao, dto.ativo ?? true]);
    return { ok: true };
  }

  // ---------- saldos ----------

  async saldos(u: UsuarioToken, f: { cnpj?: string; busca?: string }) {
    const locais = (await this.locais(u)).filter((l: { ativo: boolean; cnpj: string | null }) =>
      l.ativo && (!f.cnpj || (f.cnpj === 'principal' ? !l.cnpj : l.cnpj === soDigitos(f.cnpj))));
    const ids = locais.map((l: { id: string }) => l.id);
    const params: unknown[] = [u.empresaId];
    let filtro = '';
    if (f.busca?.trim()) { params.push(`%${f.busca.trim()}%`, f.busca.trim()); filtro = ` AND (p.nome ILIKE $2 OR p.codigo ILIKE $2 OR p.codigo_barras = $3 OR p.grupo ILIKE $2)`; }
    const ps = await this.ds.query(
      `SELECT p.id, p.nome, p.codigo, p.codigo_barras, p.grupo, p.unidade, p.estoque_minimo, p.preco FROM produtos p
        WHERE p.empresa_id = $1 AND p.ativo AND p.controla_estoque${filtro} ORDER BY p.grupo NULLS LAST, p.nome`, params);
    const ss = ids.length ? await this.ds.query(`SELECT * FROM estoque_saldos WHERE local_id = ANY($1::uuid[])`, [ids]) : [];
    const porProduto = new Map<string, { localId: string; q: number; c: number; m: number }[]>();
    for (const s of ss) {
      const l = porProduto.get(s.produto_id) ?? [];
      l.push({ localId: s.local_id, q: num(s.quantidade), c: num(s.custo_medio), m: num(s.minimo) });
      porProduto.set(s.produto_id, l);
    }
    const produtos = ps.map((p: Record<string, unknown>) => {
      const l = porProduto.get(p.id as string) ?? [];
      const saldos: Record<string, number> = {};
      const custos: Record<string, number> = {};
      const minimos: Record<string, number> = {};
      for (const x of l) { saldos[x.localId] = x.q; custos[x.localId] = x.c; if (x.m > 0) minimos[x.localId] = x.m; }
      // falta para chegar ao mínimo: por local quando definido, senão pelo mínimo do produto no total
      const faltaLocais = l.reduce((s, x) => s + (x.m > 0 ? Math.max(0, x.m - Math.max(0, x.q)) : 0), 0);
      const total = r3(l.reduce((s, x) => s + x.q, 0));
      const valor = r2(l.reduce((s, x) => s + Math.max(0, x.q) * x.c, 0));
      return {
        id: p.id, nome: p.nome, codigo: p.codigo, codigoBarras: p.codigo_barras, grupo: p.grupo, unidade: p.unidade, minimo: num(p.estoque_minimo), preco: num(p.preco),
        saldos, custos, minimos, total, valor, custoMedio: total > 0 ? r2(valor / total) : 0,
        abaixoLocal: Object.keys(minimos).filter((k) => (saldos[k] ?? 0) < minimos[k]),
        falta: r3(Math.max(faltaLocais, num(p.estoque_minimo) > 0 ? num(p.estoque_minimo) - total : 0)),
      };
    });
    return { locais, produtos, valorTotal: r2(produtos.reduce((s: number, p: { valor: number }) => s + p.valor, 0)) };
  }

  // ---------- entradas ----------

  async entrada(u: UsuarioToken, dto: EntradaDto) {
    const l = await this.local(u.empresaId, dto.localId);
    const ps = await this.produtosDaEmpresa(u.empresaId, dto.itens.map((i) => i.produtoId));
    await this.ds.transaction(async (m) => {
      for (const i of dto.itens) {
        if (!(i.quantidade > 0)) throw new BadRequestException(`Quantidade inválida em "${ps.get(i.produtoId)?.nome}".`);
        await m.query(`UPDATE produtos SET controla_estoque = true WHERE id = $1 AND NOT controla_estoque`, [i.produtoId]);
        await moverEstoque(m, { empresaId: u.empresaId, localId: l.id, produtoId: i.produtoId, quantidade: i.quantidade, tipo: 'entrada',
          custoUnitario: i.custo ?? null, documento: dto.documento?.trim() || null, observacao: dto.observacao, usuario: u.nome,
          lote: i.lote, validade: i.validade?.slice(0, 10) });
      }
    });
    return { ok: true, itens: dto.itens.length };
  }

  async vinculos(u: UsuarioToken, fornecedor: string) {
    const d = soDigitos(fornecedor);
    if (!d) return [];
    const vs = await this.ds.query(
      `SELECT v.codigo, v.produto_id, v.fator, p.nome FROM estoque_vinculos v JOIN produtos p ON p.id = v.produto_id WHERE v.empresa_id = $1 AND v.fornecedor = $2`,
      [u.empresaId, d]);
    return vs.map((v: Record<string, unknown>) => ({ codigo: v.codigo, produtoId: v.produto_id, fator: num(v.fator), produto: v.nome }));
  }

  async entradaNota(u: UsuarioToken, dto: EntradaNotaDto) {
    const l = await this.local(u.empresaId, dto.localId);
    const doc = `NF-e ${dto.chave}`;
    const [ja] = await this.ds.query(`SELECT 1 FROM estoque_movimentos WHERE empresa_id = $1 AND documento = $2 AND tipo = 'entrada' LIMIT 1`, [u.empresaId, doc]);
    if (ja) throw new BadRequestException('Esta nota já deu entrada no estoque.');
    const fornecedor = soDigitos(dto.fornecedorCnpj);
    const usados = dto.itens.filter((i) => !i.ignorar && i.quantidade > 0);
    if (!usados.length) throw new BadRequestException('Nenhum item para dar entrada.');
    const existentes = usados.filter((i) => i.produtoId).map((i) => i.produtoId!);
    if (existentes.length) await this.produtosDaEmpresa(u.empresaId, existentes);
    let criados = 0;
    await this.ds.transaction(async (m) => {
      for (const i of usados) {
        let produtoId = i.produtoId ?? null;
        if (!produtoId) {
          // cria o produto com o nome da nota (preço de venda fica 0 para a gerência ajustar)
          const nome = i.nome.trim().slice(0, 120);
          const [p] = await m.query(`SELECT id FROM produtos WHERE empresa_id = $1 AND lower(nome) = lower($2) LIMIT 1`, [u.empresaId, nome]);
          if (p) produtoId = p.id;
          else {
            const [novo] = await m.query(
              `INSERT INTO produtos (empresa_id, nome, tipo, preco, controla_estoque, unidade) VALUES ($1,$2,'produto',0,true,$3) RETURNING id`,
              [u.empresaId, nome, 'un']);
            produtoId = novo.id;
            criados++;
          }
        }
        const fator = i.fator ?? 1;
        const qtd = r3(i.quantidade * fator);
        const custo = qtd > 0 ? i.valor / qtd : 0;
        await m.query(`UPDATE produtos SET controla_estoque = true WHERE id = $1 AND NOT controla_estoque`, [produtoId]);
        await moverEstoque(m, { empresaId: u.empresaId, localId: l.id, produtoId: produtoId!, quantidade: qtd, tipo: 'entrada', custoUnitario: custo,
          documento: doc, observacao: `${dto.fornecedor ?? 'Nota'} nº ${dto.numero ?? '—'} · ${i.nome}`.slice(0, 300), usuario: u.nome,
          lote: i.lote, validade: i.validade?.slice(0, 10) });
        const ean = (i.ean ?? '').replace(/\D/g, '');
        if (ean.length >= 8) {
          await m.query(`UPDATE produtos SET codigo_barras = $2 WHERE id = $1 AND codigo_barras IS NULL
            AND NOT EXISTS (SELECT 1 FROM produtos o WHERE o.empresa_id = $3 AND o.codigo_barras = $2)`, [produtoId, ean, u.empresaId]);
        }
        if (fornecedor && i.codigo) {
          await m.query(
            `INSERT INTO estoque_vinculos (empresa_id, fornecedor, codigo, produto_id, fator) VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (empresa_id, fornecedor, codigo) DO UPDATE SET produto_id = $4, fator = $5`,
            [u.empresaId, fornecedor, i.codigo.slice(0, 60), produtoId, fator]);
        }
      }
    });
    return { ok: true, itens: usados.length, produtosCriados: criados };
  }

  // ---------- transferência ----------

  async transferir(u: UsuarioToken, dto: TransferenciaDto) {
    if (dto.origemId === dto.destinoId) throw new BadRequestException('Origem e destino são o mesmo local.');
    const o = await this.local(u.empresaId, dto.origemId);
    const d = await this.local(u.empresaId, dto.destinoId);
    const outroCnpj = (o.cnpj ?? '') !== (d.cnpj ?? '');
    if (outroCnpj && !dto.comNota) {
      throw new BadRequestException(
        'Origem e destino têm CNPJ diferente: para a mercadoria passar de um para o outro é preciso emitir nota fiscal de transferência/venda. Confirme que a nota foi emitida.');
    }
    const ps = await this.produtosDaEmpresa(u.empresaId, dto.itens.map((i) => i.produtoId));
    const res = await this.ds.query(`UPDATE empresas SET ultima_transferencia = ultima_transferencia + 1 WHERE id = $1 RETURNING ultima_transferencia AS n`, [u.empresaId]);
    const n = Number((Array.isArray(res[0]) ? res[0][0] : res[0])?.n);
    const ref = `transf:${n}`;
    const obs = `${o.nome} → ${d.nome}${dto.observacao ? ` · ${dto.observacao}` : ''}`;
    await this.ds.transaction(async (m) => {
      for (const i of dto.itens) {
        if (!(i.quantidade > 0)) throw new BadRequestException(`Quantidade inválida em "${ps.get(i.produtoId)?.nome}".`);
        const [s] = await m.query(`SELECT quantidade FROM estoque_saldos WHERE local_id = $1 AND produto_id = $2`, [o.id, i.produtoId]);
        if (num(s?.quantidade) < i.quantidade - 0.0005) {
          throw new BadRequestException(`Saldo insuficiente de "${ps.get(i.produtoId)?.nome}" em ${o.nome} (tem ${r3(num(s?.quantidade))}).`);
        }
        const custo = await moverEstoque(m, { empresaId: u.empresaId, localId: o.id, produtoId: i.produtoId, quantidade: -i.quantidade, tipo: 'transf_saida',
          referencia: ref, documento: dto.documento?.trim() || null, observacao: obs, usuario: u.nome });
        await moverEstoque(m, { empresaId: u.empresaId, localId: d.id, produtoId: i.produtoId, quantidade: i.quantidade, tipo: 'transf_entrada', custoUnitario: custo,
          referencia: ref, documento: dto.documento?.trim() || null, observacao: obs, usuario: u.nome });
      }
    });
    return { ok: true, numero: n, comNota: outroCnpj };
  }

  // ---------- inventário e perdas ----------

  async inventario(u: UsuarioToken, dto: InventarioDto) {
    const l = await this.local(u.empresaId, dto.localId);
    await this.produtosDaEmpresa(u.empresaId, dto.itens.map((i) => i.produtoId));
    let ajustados = 0;
    await this.ds.transaction(async (m) => {
      for (const i of dto.itens) {
        if (i.quantidade < 0) throw new BadRequestException('A quantidade contada não pode ser negativa.');
        const [s] = await m.query(`SELECT quantidade FROM estoque_saldos WHERE local_id = $1 AND produto_id = $2`, [l.id, i.produtoId]);
        const dif = r3(i.quantidade - num(s?.quantidade));
        if (Math.abs(dif) < 0.0005) continue;
        await moverEstoque(m, { empresaId: u.empresaId, localId: l.id, produtoId: i.produtoId, quantidade: dif, tipo: 'ajuste',
          custoUnitario: dif > 0 && i.custo !== undefined ? i.custo : null, observacao: dto.observacao ?? 'Inventário (contagem)', usuario: u.nome });
        ajustados++;
      }
    });
    return { ok: true, ajustados };
  }

  async perda(u: UsuarioToken, dto: PerdaDto) {
    const l = await this.local(u.empresaId, dto.localId);
    await this.produtosDaEmpresa(u.empresaId, dto.itens.map((i) => i.produtoId));
    await this.ds.transaction(async (m) => {
      for (const i of dto.itens) {
        if (!(i.quantidade > 0)) throw new BadRequestException('Quantidade inválida.');
        await moverEstoque(m, { empresaId: u.empresaId, localId: l.id, produtoId: i.produtoId, quantidade: -i.quantidade, tipo: dto.tipo,
          observacao: dto.observacao, usuario: u.nome });
      }
    });
    return { ok: true };
  }

  // ---------- consultas ----------

  async movimentos(u: UsuarioToken, f: { de?: string; ate?: string; localId?: string; produtoId?: string; tipo?: string; cnpj?: string }) {
    const params: unknown[] = [u.empresaId];
    let w = '';
    if (f.de) { params.push(f.de); w += ` AND mv.criado_em >= $${params.length}::date`; }
    if (f.ate) { params.push(f.ate); w += ` AND mv.criado_em < $${params.length}::date + 1`; }
    if (f.localId) { params.push(f.localId); w += ` AND mv.local_id = $${params.length}::uuid`; }
    if (f.produtoId) { params.push(f.produtoId); w += ` AND mv.produto_id = $${params.length}::uuid`; }
    if (f.tipo && TIPOS[f.tipo]) { params.push(f.tipo); w += ` AND mv.tipo = $${params.length}`; }
    w += filtroCnpj('l.cnpj', f.cnpj, params);
    const ms = await this.ds.query(
      `SELECT mv.*, l.nome AS local, l.cnpj, p.nome AS produto, p.unidade FROM estoque_movimentos mv
         JOIN estoque_locais l ON l.id = mv.local_id JOIN produtos p ON p.id = mv.produto_id
        WHERE mv.empresa_id = $1${w} ORDER BY mv.criado_em DESC LIMIT 1000`, params);
    return ms.map((x: Record<string, unknown>) => ({
      id: x.id, criadoEm: x.criado_em, local: x.local, cnpj: x.cnpj, produto: x.produto, unidade: x.unidade, tipo: x.tipo, tipoNome: TIPOS[x.tipo as string] ?? x.tipo,
      quantidade: num(x.quantidade), custo: num(x.custo_unitario), valor: r2(num(x.quantidade) * num(x.custo_unitario)), saldo: x.saldo_depois === null ? null : num(x.saldo_depois),
      documento: x.documento, referencia: x.referencia, observacao: x.observacao, usuario: x.usuario_nome,
    }));
  }

  /** relatório do período por local (centro de custo) e por CNPJ, em valor de custo */
  async relatorio(u: UsuarioToken, f: { de: string; ate: string; cnpj?: string }) {
    const params: unknown[] = [u.empresaId, f.de, f.ate];
    const fc = filtroCnpj('l.cnpj', f.cnpj, params);
    const linhas = await this.ds.query(
      `SELECT l.id, l.nome, l.cnpj, mv.tipo, SUM(mv.quantidade * mv.custo_unitario) AS valor, SUM(mv.quantidade) AS qtd
         FROM estoque_movimentos mv JOIN estoque_locais l ON l.id = mv.local_id
        WHERE mv.empresa_id = $1 AND mv.criado_em >= $2::date AND mv.criado_em < $3::date + 1${fc}
        GROUP BY l.id, l.nome, l.cnpj, mv.tipo`, params);
    const ps: unknown[] = [u.empresaId];
    const fs = filtroCnpj('l.cnpj', f.cnpj, ps);
    const saldos = await this.ds.query(
      `SELECT l.id, l.nome, l.cnpj, COALESCE(SUM(s.quantidade * s.custo_medio) FILTER (WHERE s.quantidade > 0), 0) AS valor
         FROM estoque_locais l LEFT JOIN estoque_saldos s ON s.local_id = l.id WHERE l.empresa_id = $1 AND l.ativo${fs}
        GROUP BY l.id, l.nome, l.cnpj`, ps);
    type L = { id: string; nome: string; cnpj: string | null; porTipo: Record<string, number>; saldoAtual: number };
    const locais = new Map<string, L>();
    for (const s of saldos) locais.set(s.id, { id: s.id, nome: s.nome, cnpj: s.cnpj, porTipo: {}, saldoAtual: r2(num(s.valor)) });
    for (const x of linhas) {
      const l: L = locais.get(x.id) ?? { id: x.id, nome: x.nome, cnpj: x.cnpj, porTipo: {}, saldoAtual: 0 };
      l.porTipo[x.tipo] = r2(num(x.valor));
      locais.set(x.id, l);
    }
    // mais consumidos no período (custo)
    const top = await this.ds.query(
      `SELECT p.nome, p.unidade, -SUM(mv.quantidade) AS qtd, -SUM(mv.quantidade * mv.custo_unitario) AS custo
         FROM estoque_movimentos mv JOIN estoque_locais l ON l.id = mv.local_id JOIN produtos p ON p.id = mv.produto_id
        WHERE mv.empresa_id = $1 AND mv.criado_em >= $2::date AND mv.criado_em < $3::date + 1 AND mv.tipo IN ('consumo','venda','estorno')${fc}
        GROUP BY p.nome, p.unidade HAVING SUM(mv.quantidade) < 0 ORDER BY 4 DESC LIMIT 30`, params);
    return {
      tipos: TIPOS,
      locais: [...locais.values()].sort((a, b) => (a.cnpj ?? '').localeCompare(b.cnpj ?? '') || a.nome.localeCompare(b.nome)),
      maisConsumidos: top.map((t: Record<string, unknown>) => ({ nome: t.nome, unidade: t.unidade, quantidade: r3(num(t.qtd)), custo: r2(num(t.custo)) })),
    };
  }

  /**
   * Validades: para cada produto com saldo, reparte o saldo atual pelas entradas com validade,
   * da mais nova para a mais antiga (o que saiu primeiro foi o mais antigo). Lista os lotes que
   * ainda têm quantidade e vencem até `dias` dias a partir de hoje (inclui os já vencidos).
   */
  async validades(u: UsuarioToken, f: { cnpj?: string; dias?: number }) {
    const dias = Math.min(365, Math.max(0, f.dias ?? 60));
    const s = await this.saldos(u, { cnpj: f.cnpj });
    const comSaldo = (s.produtos as { id: string; nome: string; grupo: string | null; unidade: string; total: number }[]).filter((p) => p.total > 0);
    if (!comSaldo.length) return [];
    const locais = (s.locais as { id: string }[]).map((l) => l.id);
    const ents: { produto_id: string; quantidade: string; lote: string | null; validade: string; criado_em: Date; documento: string | null }[] = await this.ds.query(
      `SELECT produto_id, quantidade, lote, to_char(validade, 'YYYY-MM-DD') AS validade, criado_em, documento FROM estoque_movimentos
        WHERE empresa_id = $1 AND tipo = 'entrada' AND validade IS NOT NULL AND quantidade > 0
          AND produto_id = ANY($2::uuid[]) AND local_id = ANY($3::uuid[]) ORDER BY criado_em DESC`,
      [u.empresaId, comSaldo.map((p) => p.id), locais]);
    const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    const limite = new Date(Date.parse(`${hoje}T12:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
    const out: { produtoId: string; nome: string; grupo: string | null; unidade: string; lote: string | null; validade: string; diasParaVencer: number; quantidade: number; entradaEm: Date; documento: string | null }[] = [];
    for (const p of comSaldo) {
      let resta = p.total;
      for (const e of ents.filter((x) => x.produto_id === p.id)) {
        if (resta <= 0) break;
        const q = Math.min(resta, num(e.quantidade));
        resta = r3(resta - q);
        if (e.validade <= limite) {
          out.push({ produtoId: p.id, nome: p.nome, grupo: p.grupo, unidade: p.unidade, lote: e.lote, validade: e.validade,
            diasParaVencer: Math.round((Date.parse(`${e.validade}T12:00:00Z`) - Date.parse(`${hoje}T12:00:00Z`)) / 86_400_000),
            quantidade: r3(q), entradaEm: e.criado_em, documento: e.documento });
        }
      }
    }
    return out.sort((a, b) => a.validade.localeCompare(b.validade) || a.nome.localeCompare(b.nome));
  }

  /**
   * Sugestão de compra: pelo consumo médio dos últimos `dias` (vendas, consumo e saídas, menos estornos),
   * quanto comprar para durar `cobertura` dias além do estoque mínimo, descontando o saldo atual.
   */
  async sugestaoCompra(u: UsuarioToken, f: { cnpj?: string; dias?: number; cobertura?: number }) {
    const dias = Math.min(365, Math.max(7, f.dias ?? 30));
    const cobertura = Math.min(180, Math.max(1, f.cobertura ?? 15));
    const s = await this.saldos(u, { cnpj: f.cnpj });
    const locais = (s.locais as { id: string }[]).map((l) => l.id);
    const produtos = s.produtos as { id: string; nome: string; grupo: string | null; unidade: string; minimo: number; total: number; custoMedio: number; abaixoLocal: string[] }[];
    if (!produtos.length || !locais.length) return { dias, cobertura, itens: [] };
    const consumo: { produto_id: string; q: string; ultimo: Date | null }[] = await this.ds.query(
      `SELECT produto_id, -SUM(quantidade) AS q, MAX(criado_em) FILTER (WHERE tipo IN ('consumo','venda')) AS ultimo FROM estoque_movimentos
        WHERE empresa_id = $1 AND local_id = ANY($2::uuid[]) AND criado_em >= now() - ($3 || ' days')::interval
          AND tipo IN ('consumo','venda','estorno','perda','producao_saida') GROUP BY produto_id`, [u.empresaId, locais, String(dias)]);
    const mapa = new Map(consumo.map((c) => [c.produto_id, c]));
    // último preço de compra (entrada com custo)
    const ultimos: { produto_id: string; custo: string }[] = await this.ds.query(
      `SELECT DISTINCT ON (produto_id) produto_id, custo_unitario AS custo FROM estoque_movimentos
        WHERE empresa_id = $1 AND tipo = 'entrada' AND custo_unitario > 0 AND produto_id = ANY($2::uuid[]) ORDER BY produto_id, criado_em DESC`,
      [u.empresaId, produtos.map((p) => p.id)]);
    const custoCompra = new Map(ultimos.map((x) => [x.produto_id, num(x.custo)]));
    const itens = produtos.map((p) => {
      const c = mapa.get(p.id);
      const usado = Math.max(0, num(c?.q));
      const porDia = usado / dias;
      const alvo = porDia * cobertura + (p.minimo || 0);
      const saldo = p.total;
      const comprar = Math.max(0, Math.ceil(alvo - saldo));
      const custo = custoCompra.get(p.id) ?? p.custoMedio ?? 0;
      return {
        produtoId: p.id, nome: p.nome, grupo: p.grupo, unidade: p.unidade, saldo: r3(saldo), minimo: p.minimo,
        consumoPeriodo: r3(usado), consumoDia: Math.round(porDia * 100) / 100,
        diasRestantes: porDia > 0 ? Math.max(0, Math.floor(saldo / porDia)) : null,
        comprar, custoUnitario: r2(custo), valorEstimado: r2(comprar * custo),
        motivo: saldo <= 0 && usado > 0 ? 'acabou' : saldo < (p.minimo || 0) ? 'abaixo do mínimo' : comprar > 0 ? 'vai faltar' : 'ok',
      };
    }).filter((x) => x.comprar > 0 || x.saldo < x.minimo);
    const ordem: Record<string, number> = { acabou: 0, 'abaixo do mínimo': 1, 'vai faltar': 2, ok: 3 };
    itens.sort((a, b) => ordem[a.motivo] - ordem[b.motivo] || (a.diasRestantes ?? 9999) - (b.diasRestantes ?? 9999) || a.nome.localeCompare(b.nome));
    return { dias, cobertura, itens, valorTotal: r2(itens.reduce((t, i) => t + i.valorEstimado, 0)) };
  }

  /** produtos abaixo do mínimo (do produto no total, ou de algum local) */
  async abaixoDoMinimo(u: UsuarioToken, cnpj?: string) {
    const s = await this.saldos(u, { cnpj });
    return s.produtos.filter((p: { minimo: number; total: number; abaixoLocal: string[] }) => (p.minimo > 0 && p.total < p.minimo) || p.abaixoLocal.length > 0);
  }

  async salvarMinimos(u: UsuarioToken, dto: MinimosDto) {
    const l = await this.local(u.empresaId, dto.localId);
    if (dto.itens.length) await this.produtosDaEmpresa(u.empresaId, dto.itens.map((i) => i.produtoId));
    await this.ds.transaction(async (m) => {
      for (const i of dto.itens) {
        await m.query(
          `INSERT INTO estoque_saldos (local_id, produto_id, minimo) VALUES ($1,$2,$3) ON CONFLICT (local_id, produto_id) DO UPDATE SET minimo = $3`,
          [l.id, i.produtoId, i.minimo]);
      }
    });
    return { ok: true };
  }

  /**
   * Para a recepção: saldos do estoque do ambiente (mostrados ao lançar consumo)
   * e os avisos de produto abaixo do mínimo daquele ambiente.
   */
  async doAmbiente(u: UsuarioToken, ambienteId: string) {
    const [a] = await this.ds.query(`SELECT id FROM ambientes WHERE id = $1 AND empresa_id = $2`, [ambienteId, u.empresaId]);
    if (!a) throw new NotFoundException('Ambiente não encontrado.');
    const localId = await localDoAmbiente(this.ds, u.empresaId, ambienteId);
    const [loc] = await this.ds.query(`SELECT nome FROM estoque_locais WHERE id = $1`, [localId]);
    const [{ n }] = await this.ds.query(`SELECT COUNT(*) AS n FROM estoque_locais WHERE empresa_id = $1 AND ativo`, [u.empresaId]);
    const unico = num(n) <= 1;
    const ps = await this.ds.query(
      `SELECT p.id, p.nome, p.unidade, p.estoque_minimo, COALESCE(s.quantidade, 0) AS q, COALESCE(s.minimo, 0) AS m
         FROM produtos p LEFT JOIN estoque_saldos s ON s.produto_id = p.id AND s.local_id = $2
        WHERE p.empresa_id = $1 AND p.ativo AND p.controla_estoque ORDER BY p.nome`, [u.empresaId, localId]);
    const saldos: Record<string, number> = {};
    const alertas: { produtoId: string; nome: string; unidade: string; saldo: number; minimo: number }[] = [];
    for (const p of ps) {
      const q = num(p.q);
      saldos[p.id] = q;
      // mínimo do local; com um local só, vale também o mínimo do cadastro do produto
      const minimo = num(p.m) > 0 ? num(p.m) : unico ? num(p.estoque_minimo) : 0;
      if (minimo > 0 && q < minimo) alertas.push({ produtoId: p.id, nome: p.nome, unidade: p.unidade, saldo: r3(q), minimo });
    }
    alertas.sort((x, y) => x.saldo / x.minimo - y.saldo / y.minimo);
    return { localId, local: loc?.nome ?? '', saldos, alertas };
  }
}
