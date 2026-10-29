import { PrecificacaoService } from '../precificacao/precificacao';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Produto } from './produto.entity';
import { AmbientesEmLoteDto, AtualizarProdutoDto, CriarProdutoDto, RenomearGrupoDto, SalvarFichaDto } from './produtos.dto';
import { limparFiscal } from '../common/fiscal';
import { moverEstoque } from '../estoque/estoque.core';
import { COLUNAS_FISCAIS, Chave, LinhaLida, ZEROS, lerPlanilha, planilhaModelo } from './importacao';
import { urlFoto } from './fotos';

@Injectable()
export class ProdutosService {
  constructor(@InjectRepository(Produto) private readonly repo: Repository<Produto>, private readonly precificacao: PrecificacaoService) {}

  async listar(empresaId: string, opcoes: { inativos?: boolean; busca?: string; uso?: string; ambienteId?: string } = {}) {
    const qb = this.repo.createQueryBuilder('p').where('p.empresaId = :empresaId', { empresaId });
    if (!opcoes.inativos) qb.andWhere('p.ativo = true');
    if (opcoes.uso === 'venda' || opcoes.uso === 'interno') qb.andWhere('p.uso = :uso', { uso: opcoes.uso });
    // só os usados neste ambiente (sem marcação = todos)
    if (opcoes.ambienteId && /^[0-9a-f-]{36}$/i.test(opcoes.ambienteId)) {
      qb.andWhere('(p.ambientesIds IS NULL OR cardinality(p.ambientesIds) = 0 OR :amb = ANY(p.ambientesIds))', { amb: opcoes.ambienteId });
    }
    const termo = opcoes.busca?.trim();
    if (termo) {
      qb.andWhere('(lower(p.nome) LIKE :t OR lower(p.codigo) = :c OR p.codigoBarras = :c OR lower(p.grupo) LIKE :t)', {
        t: `%${termo.toLowerCase()}%`,
        c: termo.toLowerCase(),
      });
    }
    const lista = await qb.orderBy('p.grupo', 'ASC', 'NULLS LAST').addOrderBy('p.nome', 'ASC').limit(500).getMany();
    // custo pelo estoque (média ponderada dos saldos; sem saldo, o último custo médio)
    const custos: { id: string; medio: string | null; ultimo: string | null }[] = lista.length ? await this.repo.query(
      `SELECT produto_id AS id, SUM(quantidade * custo_medio) FILTER (WHERE quantidade > 0) / NULLIF(SUM(quantidade) FILTER (WHERE quantidade > 0), 0) AS medio,
              MAX(custo_medio) AS ultimo FROM estoque_saldos WHERE produto_id = ANY($1::uuid[]) GROUP BY produto_id`, [lista.map((p) => p.id)]) : [];
    const mapa = new Map(custos.map((x) => [x.id, Number(x.medio ?? 0) || Number(x.ultimo ?? 0)]));
    // ficha técnica: custo do prato = soma dos insumos (custo do estoque ou o digitado) ÷ rendimento
    const fichas: { produto_id: string; n: number; custo: string }[] = lista.length ? await this.repo.query(
      `SELECT pi.produto_id, COUNT(*)::int AS n, SUM(pi.quantidade * COALESCE(NULLIF(c.custo_estoque, 0), i.custo, 0)) AS custo
         FROM produto_insumos pi JOIN produtos i ON i.id = pi.insumo_id
         LEFT JOIN LATERAL (SELECT COALESCE(SUM(quantidade * custo_medio) FILTER (WHERE quantidade > 0) / NULLIF(SUM(quantidade) FILTER (WHERE quantidade > 0), 0), MAX(custo_medio)) AS custo_estoque
                              FROM estoque_saldos WHERE produto_id = i.id) c ON true
        WHERE pi.produto_id = ANY($1::uuid[]) GROUP BY pi.produto_id`, [lista.map((p) => p.id)]) : [];
    const mapaFicha = new Map(fichas.map((f) => [f.produto_id, f]));
    return lista.map((p) => {
      const f = mapaFicha.get(p.id);
      const rend = Number(p.fichaRendimento) > 0 ? Number(p.fichaRendimento) : 1;
      return {
        ...p, fotoUrl: urlFoto(empresaId, p.foto), custoEstoque: Math.round((mapa.get(p.id) ?? 0) * 100) / 100 || null,
        insumos: f?.n ?? 0, custoFicha: f ? Math.round((Number(f.custo) / rend) * 100) / 100 : null,
      };
    });
  }

  /**
   * "Usar também em…" para vários produtos: põe ou tira um ambiente. Produto sem marcação (todos)
   * que sai de um ambiente passa a valer só nos outros ambientes ativos.
   */
  async ambientesEmLote(empresaId: string, dto: AmbientesEmLoteDto) {
    const [a] = await this.repo.query(`SELECT id FROM ambientes WHERE id = $1 AND empresa_id = $2`, [dto.ambienteId, empresaId]);
    if (!a) throw new NotFoundException('Ambiente não encontrado.');
    if (!dto.produtoIds.length) return { ok: true, produtos: 0 };
    if (dto.usar) {
      await this.repo.query(
        `UPDATE produtos SET ambientes_ids = array_append(ambientes_ids, $3::uuid)
          WHERE empresa_id = $1 AND id = ANY($2::uuid[]) AND ambientes_ids IS NOT NULL AND cardinality(ambientes_ids) > 0 AND NOT ($3::uuid = ANY(ambientes_ids))`,
        [empresaId, dto.produtoIds, dto.ambienteId]);
    } else {
      const todos: { id: string }[] = await this.repo.query(`SELECT id FROM ambientes WHERE empresa_id = $1 AND ativo AND id <> $2`, [empresaId, dto.ambienteId]);
      await this.repo.query(
        `UPDATE produtos SET ambientes_ids = CASE WHEN ambientes_ids IS NULL OR cardinality(ambientes_ids) = 0 THEN $4::uuid[] ELSE array_remove(ambientes_ids, $3::uuid) END
          WHERE empresa_id = $1 AND id = ANY($2::uuid[])`,
        [empresaId, dto.produtoIds, dto.ambienteId, todos.map((x) => x.id)]);
    }
    return { ok: true, produtos: dto.produtoIds.length };
  }

  /** planilha modelo com os ambientes e locais desta empresa */
  async modeloImportacao(empresaId: string) {
    const ambs: { nome: string }[] = await this.repo.query(`SELECT nome FROM ambientes WHERE empresa_id = $1 AND ativo ORDER BY nome`, [empresaId]);
    const locs: { nome: string }[] = await this.repo.query(`SELECT nome FROM estoque_locais WHERE empresa_id = $1 AND ativo ORDER BY padrao DESC, nome`, [empresaId]);
    return planilhaModelo(ambs.map((a) => a.nome), locs.map((l) => l.nome));
  }

  /** todos os produtos ativos na mesma planilha da importação (com a tributação), para corrigir no Excel e importar de volta */
  async exportar(empresaId: string) {
    const ambs: { id: string; nome: string }[] = await this.repo.query(`SELECT id, nome FROM ambientes WHERE empresa_id = $1 AND ativo ORDER BY nome`, [empresaId]);
    const locs: { nome: string }[] = await this.repo.query(`SELECT nome FROM estoque_locais WHERE empresa_id = $1 AND ativo ORDER BY padrao DESC, nome`, [empresaId]);
    const prods = await this.repo.find({ where: { empresaId, ativo: true }, order: { grupo: 'ASC', nome: 'ASC' } });
    const nomeAmb = new Map(ambs.map((a) => [a.id, a.nome]));
    const simNao = (b: boolean) => (b ? 'Sim' : 'Não');
    const linhas = prods.map((p) => {
      const l: Partial<Record<Chave, string | number>> = {
        nome: p.nome, uso: p.uso === 'interno' ? 'Uso interno' : 'Venda', tipo: p.tipo === 'servico' ? 'Serviço' : 'Produto', grupo: p.grupo ?? '',
        unidade: p.unidade, preco: p.uso === 'interno' ? '' : Number(p.preco), custo: p.custo === null ? '' : Number(p.custo), codigo: p.codigo ?? '',
        barras: p.codigoBarras ?? '', controla: simNao(p.controlaEstoque), minimo: Number(p.estoqueMinimo) || '',
        usadoEm: p.ambientesIds?.length ? p.ambientesIds.map((id) => nomeAmb.get(id)).filter(Boolean).join('; ') : 'Todos',
        frigobar: simNao(p.frigobar), ressarcimento: simNao(p.ressarcimento),
      };
      const f = (p.fiscal ?? {}) as Record<string, unknown>;
      for (const c of COLUNAS_FISCAIS) {
        const v = f[c.campo];
        if (v === undefined || v === null || v === '') continue;
        l[c.chave] = typeof v === 'boolean' ? simNao(v) : typeof v === 'number' ? v : String(v);
      }
      return l;
    });
    return planilhaModelo(ambs.map((a) => a.nome), locs.map((l) => l.nome), linhas);
  }

  /**
   * Importa a planilha: cria os produtos novos e atualiza os que já existem (mesmo código de barras, código ou nome),
   * só com o que estiver preenchido. `simular` devolve a prévia sem gravar. Saldo inicial entra no estoque.
   */
  async importar(empresaId: string, usuario: string, arquivoBase64: string, simular: boolean, padroes: { usadoEm?: string[]; localId?: string } = {}) {
    let linhas: LinhaLida[];
    try {
      linhas = await lerPlanilha(Buffer.from(arquivoBase64, 'base64'));
    } catch (e) {
      throw new BadRequestException(e instanceof Error && e.message.includes('Nome') ? e.message : 'Não consegui ler o arquivo. Use a planilha modelo (.xlsx).');
    }
    if (!linhas.length) throw new BadRequestException('A planilha não tem produtos na aba "Produtos".');
    if (linhas.length > 3000) throw new BadRequestException('Até 3.000 produtos por planilha.');
    const ambs: { id: string; nome: string }[] = await this.repo.query(`SELECT id, nome FROM ambientes WHERE empresa_id = $1 AND ativo`, [empresaId]);
    const locs: { id: string; nome: string; ambiente_id: string | null }[] =
      await this.repo.query(`SELECT id, nome, ambiente_id FROM estoque_locais WHERE empresa_id = $1 AND ativo ORDER BY padrao DESC, criado_em`, [empresaId]);
    const existentes: { id: string; nome: string; codigo: string | null; codigo_barras: string | null }[] =
      await this.repo.query(`SELECT id, nome, codigo, codigo_barras FROM produtos WHERE empresa_id = $1`, [empresaId]);
    const sem = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    const porBarras = new Map(existentes.filter((p) => p.codigo_barras).map((p) => [p.codigo_barras!, p]));
    const porCodigo = new Map(existentes.filter((p) => p.codigo).map((p) => [sem(p.codigo!), p]));
    const porNome = new Map(existentes.map((p) => [sem(p.nome), p]));
    const num = (t?: string) => {
      if (!t) return undefined;
      const limpo = t.replace(/R\$|\s/g, '');
      const v = Number(/,\d{1,3}$/.test(limpo) ? limpo.replace(/\./g, '').replace(',', '.') : limpo.replace(/,/g, ''));
      return Number.isFinite(v) ? v : NaN;
    };
    const simNao = (t?: string) => (t === undefined ? undefined : /^(s|sim|x|1|true|verdadeiro)$/i.test(t.trim()));
    const UNIDADES = ['un', 'kg', 'g', 'l', 'ml', 'cx', 'pct', 'dz', 'porcao', 'garrafa'];
    const vistos = new Set<string>();
    const resultado = linhas.map((l) => {
      const erros: string[] = [];
      const nome = (l.nome ?? '').slice(0, 120);
      if (!nome) erros.push('sem nome');
      const chave = sem(nome);
      if (chave && vistos.has(chave)) erros.push('nome repetido na planilha');
      vistos.add(chave);
      const uso = l.uso ? (/interno/i.test(l.uso) ? 'interno' as const : /venda/i.test(l.uso) ? 'venda' as const : null) : undefined;
      if (uso === null) erros.push('"Para que serve" deve ser Venda ou Uso interno');
      const tipo = l.tipo ? (/servi/i.test(l.tipo) ? 'servico' as const : /produt/i.test(l.tipo) ? 'produto' as const : null) : undefined;
      if (tipo === null) erros.push('Tipo deve ser Produto ou Serviço');
      const unidade = l.unidade ? sem(l.unidade).replace(/^lt$/, 'l').replace(/^unid?(ade)?$/, 'un') : undefined;
      if (unidade && !UNIDADES.includes(unidade)) erros.push(`unidade "${l.unidade}" não reconhecida`);
      const preco = num(l.preco); const custo = num(l.custo); const minimo = num(l.minimo); const saldo = num(l.saldo);
      for (const [n, v] of [['preço de venda', preco], ['custo', custo], ['estoque mínimo', minimo], ['saldo inicial', saldo]] as const) {
        if (v !== undefined && (Number.isNaN(v) || v < 0)) erros.push(`${n} inválido`);
      }
      let ambientesIds: string[] | null | undefined;
      if (l.usadoEm) {
        if (/^todos?$/i.test(l.usadoEm.trim())) ambientesIds = null;
        else {
          const nomes = l.usadoEm.split(/[;,/]/).map((x) => x.trim()).filter(Boolean);
          const achados = nomes.map((n) => ambs.find((a) => sem(a.nome) === sem(n) || sem(a.nome).includes(sem(n))));
          if (achados.some((x) => !x)) erros.push(`"Usado em": ambiente não encontrado (${nomes.filter((_, i) => !achados[i]).join(', ')})`);
          ambientesIds = [...new Set(achados.filter(Boolean).map((a) => a!.id))];
        }
      }
      let localId: string | null = null;
      if (saldo && saldo > 0) {
        const padraoLocal = padroes.localId ? locs.find((x) => x.id === padroes.localId) : undefined;
        const loc = l.local ? locs.find((x) => sem(x.nome) === sem(l.local!)) : (padraoLocal ?? locs.find((x) => !x.ambiente_id) ?? locs[0]);
        if (!loc) erros.push(l.local ? `local "${l.local}" não encontrado` : 'não há local de estoque para o saldo');
        else localId = loc.id;
      }
      // tributação: só as colunas preenchidas; o resto continua como está (ou vem dos padrões)
      const brutoFiscal: Record<string, unknown> = {};
      for (const c of COLUNAS_FISCAIS) {
        let v: string | undefined = l[c.chave];
        if (!v) continue;
        const z = ZEROS[c.campo];
        if (z && /^\d+$/.test(v) && v.length >= z[1] && v.length < z[0]) v = v.padStart(z[0], '0');
        brutoFiscal[c.campo] = c.campo === 'issRetido' ? simNao(v) : v;
      }
      let fiscal: Record<string, unknown> | undefined;
      if (Object.keys(brutoFiscal).length) {
        try { fiscal = limparFiscal(brutoFiscal) as Record<string, unknown>; } catch (e) { erros.push(`tributação: ${(e as Error).message.replace(/\.$/, '')}`); }
      }
      const barras = l.barras?.replace(/\D/g, '') || undefined;
      const ja = (barras && porBarras.get(barras)) || (l.codigo && porCodigo.get(sem(l.codigo))) || porNome.get(chave);
      return {
        linha: l.linha, nome, acao: erros.length ? 'erro' as const : ja ? 'atualizar' as const : 'novo' as const, erros, existenteId: ja ? ja.id : null,
        dados: {
          uso, tipo, grupo: l.grupo?.slice(0, 60), unidade, preco, custo, codigo: l.codigo?.slice(0, 30), barras: barras?.slice(0, 20),
          controla: simNao(l.controla), minimo, ambientesIds, frigobar: simNao(l.frigobar), ressarcimento: simNao(l.ressarcimento), saldo, localId, fiscal,
        },
      };
    });
    const resumo = {
      novos: resultado.filter((r) => r.acao === 'novo').length, atualizados: resultado.filter((r) => r.acao === 'atualizar').length,
      erros: resultado.filter((r) => r.acao === 'erro').length,
      linhas: resultado.map((r) => ({ linha: r.linha, nome: r.nome, acao: r.acao, erros: r.erros })),
    };
    if (simular) return { ...resumo, gravado: false };

    await this.repo.manager.transaction(async (m) => {
      for (const r of resultado.filter((x) => x.acao !== 'erro')) {
        const d = r.dados;
        let id = r.existenteId;
        if (!id) {
          const tipo = d.tipo ?? 'produto';
          const [novo] = await m.query(
            `INSERT INTO produtos (empresa_id, nome, codigo, codigo_barras, grupo, tipo, uso, preco, custo, controla_estoque, estoque_minimo, unidade, ambientes_ids, frigobar, ressarcimento, fiscal)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb) RETURNING id`,
            [empresaId, r.nome, d.codigo ?? null, d.barras ?? null, d.grupo ?? null, tipo, d.uso ?? 'venda', (d.uso === 'interno' ? 0 : d.preco ?? 0).toFixed(2),
              d.custo !== undefined ? d.custo.toFixed(2) : null, d.controla ?? tipo === 'produto', d.minimo ?? 0, d.unidade ?? 'un',
              // "Usado em" em branco: o que foi escolhido na tela de importar (vazio = todos)
              ((d.ambientesIds === undefined ? padroes.usadoEm : d.ambientesIds) ?? []).length ? (d.ambientesIds === undefined ? padroes.usadoEm : d.ambientesIds) : null, !!d.frigobar, !!d.ressarcimento,
              JSON.stringify(d.fiscal ?? {})]);
          id = novo.id as string;
        } else {
          // só o que veio preenchido
          const sets: string[] = [];
          const vals: unknown[] = [id];
          const put = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
          if (d.codigo !== undefined) put('codigo', d.codigo);
          if (d.barras !== undefined) put('codigo_barras', d.barras);
          if (d.grupo !== undefined) put('grupo', d.grupo);
          if (d.tipo !== undefined) put('tipo', d.tipo);
          if (d.uso !== undefined) put('uso', d.uso);
          if (d.preco !== undefined) put('preco', d.preco.toFixed(2));
          if (d.custo !== undefined) put('custo', d.custo.toFixed(2));
          if (d.controla !== undefined) put('controla_estoque', d.controla);
          if (d.minimo !== undefined) put('estoque_minimo', d.minimo);
          if (d.unidade !== undefined) put('unidade', d.unidade);
          if (d.ambientesIds !== undefined) put('ambientes_ids', d.ambientesIds && d.ambientesIds.length ? d.ambientesIds : null);
          if (d.frigobar !== undefined) put('frigobar', d.frigobar);
          if (d.ressarcimento !== undefined) put('ressarcimento', d.ressarcimento);
          if (d.fiscal) { vals.push(JSON.stringify(d.fiscal)); sets.push(`fiscal = COALESCE(fiscal, '{}'::jsonb) || $${vals.length}::jsonb`); }
          if (sets.length) await m.query(`UPDATE produtos SET ${sets.join(', ')}, atualizado_em = now() WHERE id = $1`, vals);
        }
        if (d.saldo && d.saldo > 0 && d.localId) {
          await m.query(`UPDATE produtos SET controla_estoque = true WHERE id = $1`, [id]);
          await moverEstoque(m, { empresaId, localId: d.localId, produtoId: id, quantidade: d.saldo, tipo: 'entrada', custoUnitario: d.custo ?? null,
            documento: 'Importação', observacao: 'Saldo inicial (planilha)', usuario });
        }
      }
    });
    return { ...resumo, gravado: true };
  }

  /** grupos em uso, com quantos produtos de venda e de uso interno */
  async grupos(empresaId: string) {
    const l: { grupo: string; venda: number; interno: number }[] = await this.repo.query(
      `SELECT grupo, COUNT(*) FILTER (WHERE uso = 'venda')::int AS venda, COUNT(*) FILTER (WHERE uso = 'interno')::int AS interno
         FROM produtos WHERE empresa_id = $1 AND ativo AND grupo IS NOT NULL AND grupo <> '' GROUP BY grupo ORDER BY grupo`, [empresaId]);
    return l;
  }

  /** renomeia (ou junta com outro) um grupo em todos os produtos */
  async renomearGrupo(empresaId: string, dto: RenomearGrupoDto) {
    const de = dto.de.trim();
    if (!de) throw new BadRequestException('Informe o grupo.');
    const r = await this.repo.query(`UPDATE produtos SET grupo = $3 WHERE empresa_id = $1 AND grupo = $2`, [empresaId, de, dto.para.trim() || null]);
    return { ok: true, produtos: Array.isArray(r) ? r[1] ?? 0 : 0 };
  }

  /** ficha técnica do produto: insumos com unidade e custo */
  async ficha(empresaId: string, id: string) {
    const p = await this.buscar(empresaId, id);
    const itens: { insumo_id: string; nome: string; unidade: string; quantidade: string; custo: string | null; controla_estoque: boolean }[] = await this.repo.query(
      `SELECT pi.insumo_id, i.nome, i.unidade, pi.quantidade, i.controla_estoque,
              COALESCE(NULLIF((SELECT COALESCE(SUM(quantidade * custo_medio) FILTER (WHERE quantidade > 0) / NULLIF(SUM(quantidade) FILTER (WHERE quantidade > 0), 0), MAX(custo_medio))
                                 FROM estoque_saldos WHERE produto_id = i.id), 0), i.custo) AS custo
         FROM produto_insumos pi JOIN produtos i ON i.id = pi.insumo_id WHERE pi.produto_id = $1 ORDER BY i.nome`, [p.id]);
    return {
      rendimento: Number(p.fichaRendimento) || 1,
      itens: itens.map((i) => ({ insumoId: i.insumo_id, nome: i.nome, unidade: i.unidade, quantidade: Number(i.quantidade), custoUnitario: i.custo === null ? null : Math.round(Number(i.custo) * 10000) / 10000, controlaEstoque: i.controla_estoque })),
    };
  }

  async salvarFicha(empresaId: string, id: string, dto: SalvarFichaDto) {
    const p = await this.buscar(empresaId, id);
    const ids = [...new Set(dto.itens.map((i) => i.insumoId))];
    if (ids.length !== dto.itens.length) throw new BadRequestException('Há ingrediente repetido na ficha.');
    if (ids.includes(p.id)) throw new BadRequestException('O produto não pode ser ingrediente dele mesmo.');
    if (ids.length) {
      const ok: { id: string; nome: string; tem_ficha: boolean }[] = await this.repo.query(
        `SELECT i.id, i.nome, EXISTS (SELECT 1 FROM produto_insumos x WHERE x.produto_id = i.id) AS tem_ficha FROM produtos i WHERE i.id = ANY($1::uuid[]) AND i.empresa_id = $2`, [ids, empresaId]);
      if (ok.length !== ids.length) throw new BadRequestException('Ingrediente não encontrado.');
      const composto = ok.find((x) => x.tem_ficha);
      if (composto) throw new BadRequestException(`"${composto.nome}" já tem ficha técnica: use os ingredientes dele direto.`);
    }
    await this.repo.manager.transaction(async (m) => {
      await m.query(`DELETE FROM produto_insumos WHERE produto_id = $1`, [p.id]);
      for (const i of dto.itens) {
        await m.query(`INSERT INTO produto_insumos (empresa_id, produto_id, insumo_id, quantidade) VALUES ($1,$2,$3,$4)`, [empresaId, p.id, i.insumoId, i.quantidade]);
      }
      // ingredientes passam a controlar estoque; o prato com ficha não baixa ele mesmo
      if (ids.length) await m.query(`UPDATE produtos SET controla_estoque = true WHERE id = ANY($1::uuid[]) AND NOT controla_estoque AND tipo = 'produto'`, [ids]);
      await m.query(`UPDATE produtos SET ficha_rendimento = $2 WHERE id = $1`, [p.id, dto.rendimento]);
    });
    return this.ficha(empresaId, id);
  }

  async buscar(empresaId: string, id: string) {
    const p = await this.repo.findOne({ where: { id, empresaId } });
    if (!p) throw new NotFoundException('Produto não encontrado.');
    return p;
  }

  private async codigoLivre(empresaId: string, codigo: string | null | undefined, ignorar?: string) {
    if (!codigo) return;
    const outro = await this.repo
      .createQueryBuilder('p')
      .where('p.empresaId = :empresaId AND lower(p.codigo) = lower(:codigo)', { empresaId, codigo })
      .getOne();
    if (outro && outro.id !== ignorar) throw new BadRequestException(`O código ${codigo} já é de "${outro.nome}".`);
  }

  private async barrasLivre(empresaId: string, codigo: string | null | undefined, ignorar?: string) {
    if (!codigo?.trim()) return;
    const outro = await this.repo.findOne({ where: { empresaId, codigoBarras: codigo.trim() } });
    if (outro && outro.id !== ignorar) throw new BadRequestException(`O código de barras ${codigo} já é de "${outro.nome}".`);
  }

  async criar(empresaId: string, dto: CriarProdutoDto) {
    // limite de produtos do plano (Start, Plus…); a empresa da plataforma e quem está sem plano não têm limite
    const [lim] = await this.repo.query(
      `SELECT p.limite_produtos AS limite, (SELECT count(*)::int FROM produtos x WHERE x.empresa_id = e.id AND x.ativo) AS n, p.nome
         FROM empresas e JOIN planos p ON p.id = e.plano_id WHERE e.id = $1 AND NOT e.plataforma`, [empresaId]).catch(() => []);
    if (lim?.limite && Number(lim.n) >= Number(lim.limite)) {
      throw new BadRequestException(`O plano ${lim.nome} vai até ${lim.limite} produtos. Desative os que não usa ou troque de plano na Área do cliente.`);
    }
    await this.codigoLivre(empresaId, dto.codigo);
    await this.barrasLivre(empresaId, dto.codigoBarras);
    const salvo = await this.repo.save(
      this.repo.create({
        empresaId,
        nome: dto.nome.trim(),
        codigo: dto.codigo?.trim() || null,
        codigoBarras: dto.codigoBarras?.trim() || null,
        uso: dto.uso ?? 'venda',
        ambientesIds: dto.ambientesIds?.length ? [...new Set(dto.ambientesIds)] : null,
        custo: dto.custo !== undefined && dto.custo > 0 ? dto.custo.toFixed(2) : null,
        grupo: dto.grupo?.trim() || null,
        tipo: dto.tipo ?? 'produto',
        preco: dto.preco.toFixed(2),
        fiscal: limparFiscal(dto.fiscal),
        frigobar: !!dto.frigobar,
        ressarcimento: !!dto.ressarcimento,
        controlaEstoque: dto.controlaEstoque ?? (dto.tipo ?? 'produto') === 'produto',
        estoqueMinimo: String(dto.estoqueMinimo ?? 0),
        unidade: dto.unidade?.trim() || 'un',
      }),
    );
    await this.precificacao.guardarLiquidos(empresaId, [salvo.id]).catch(() => undefined);
    return salvo;
  }

  async atualizar(empresaId: string, id: string, dto: AtualizarProdutoDto) {
    const p = await this.buscar(empresaId, id);
    if (dto.codigo !== undefined) await this.codigoLivre(empresaId, dto.codigo, id);
    if (dto.nome !== undefined) p.nome = dto.nome.trim();
    if (dto.codigo !== undefined) p.codigo = dto.codigo?.trim() || null;
    if (dto.uso !== undefined) p.uso = dto.uso;
    if (dto.ambientesIds !== undefined) p.ambientesIds = dto.ambientesIds?.length ? [...new Set(dto.ambientesIds)] : null;
    if (dto.custo !== undefined) p.custo = dto.custo && dto.custo > 0 ? dto.custo.toFixed(2) : null;
    if (dto.codigoBarras !== undefined) { await this.barrasLivre(empresaId, dto.codigoBarras, id); p.codigoBarras = dto.codigoBarras?.trim() || null; }
    if (dto.grupo !== undefined) p.grupo = dto.grupo?.trim() || null;
    if (dto.tipo !== undefined) p.tipo = dto.tipo;
    if (dto.preco !== undefined) p.preco = dto.preco.toFixed(2);
    if (dto.ativo !== undefined) p.ativo = dto.ativo;
    if (dto.frigobar !== undefined) p.frigobar = dto.frigobar;
    if (dto.ressarcimento !== undefined) p.ressarcimento = dto.ressarcimento;
    if (dto.fiscal !== undefined) {
      // a precificação (lucro, tributos e valor líquido para a nota) fica guardada junto e não se perde ao editar
      const antes = (p.fiscal ?? {}) as Record<string, unknown>;
      const manter = Object.fromEntries(['precificacao', 'precoLiquido', 'tributosPct'].filter((k) => antes[k] !== undefined).map((k) => [k, antes[k]]));
      p.fiscal = { ...limparFiscal(dto.fiscal), ...manter } as typeof p.fiscal;
    }
    if (dto.controlaEstoque !== undefined) p.controlaEstoque = dto.controlaEstoque;
    if (dto.estoqueMinimo !== undefined) p.estoqueMinimo = String(dto.estoqueMinimo);
    if (dto.unidade !== undefined) p.unidade = dto.unidade.trim() || 'un';
    const salvo = await this.repo.save(p);
    await this.precificacao.guardarLiquidos(empresaId, [id]).catch(() => undefined);
    return salvo;
  }

  async desativar(empresaId: string, id: string) {
    const p = await this.buscar(empresaId, id);
    p.ativo = false;
    return this.repo.save(p);
  }
}
