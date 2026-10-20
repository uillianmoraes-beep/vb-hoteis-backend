import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Produto } from './produto.entity';
import { AmbientesEmLoteDto, AtualizarProdutoDto, CriarProdutoDto, RenomearGrupoDto, SalvarFichaDto } from './produtos.dto';
import { limparFiscal } from '../common/fiscal';

@Injectable()
export class ProdutosService {
  constructor(@InjectRepository(Produto) private readonly repo: Repository<Produto>) {}

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
        ...p, custoEstoque: Math.round((mapa.get(p.id) ?? 0) * 100) / 100 || null,
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
    await this.codigoLivre(empresaId, dto.codigo);
    await this.barrasLivre(empresaId, dto.codigoBarras);
    return this.repo.save(
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
    if (dto.fiscal !== undefined) p.fiscal = limparFiscal(dto.fiscal);
    if (dto.controlaEstoque !== undefined) p.controlaEstoque = dto.controlaEstoque;
    if (dto.estoqueMinimo !== undefined) p.estoqueMinimo = String(dto.estoqueMinimo);
    if (dto.unidade !== undefined) p.unidade = dto.unidade.trim() || 'un';
    return this.repo.save(p);
  }

  async desativar(empresaId: string, id: string) {
    const p = await this.buscar(empresaId, id);
    p.ativo = false;
    return this.repo.save(p);
  }
}
