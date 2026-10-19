import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Categoria } from './categoria.entity';
import { AtualizarCategoriaDto, CriarCategoriaDto } from './categorias.dto';

@Injectable()
export class CategoriasService {
  constructor(@InjectRepository(Categoria) private readonly repo: Repository<Categoria>) {}

  /**
   * Categorias da empresa. Com ambiente: só as daquele ambiente (e as ainda sem ambiente),
   * para o hotel não ver as do motel e vice-versa.
   */
  async listar(empresaId: string, incluirInativos = false, ambienteId?: string) {
    const qb = this.repo.createQueryBuilder('c').where('c.empresaId = :empresaId', { empresaId });
    if (!incluirInativos) qb.andWhere('c.ativo = true');
    if (ambienteId) qb.andWhere('(c.ambienteId = :ambienteId OR c.ambienteId IS NULL)', { ambienteId });
    const lista = await qb.orderBy('c.ordem', 'ASC').addOrderBy('c.nome', 'ASC').getMany();
    // quantas unidades ativas usam cada uma (a tela mostra e não deixa excluir categoria em uso)
    const usos: { categoria_id: string; n: number }[] = lista.length
      ? await this.repo.query(`SELECT categoria_id, count(*)::int AS n FROM unidades WHERE empresa_id = $1 AND ativo AND categoria_id IS NOT NULL GROUP BY categoria_id`, [empresaId])
      : [];
    const n = new Map(usos.map((x) => [x.categoria_id, Number(x.n)]));
    return lista.map((c) => ({ ...c, unidadesAtivas: n.get(c.id) ?? 0 }));
  }

  async buscar(empresaId: string, id: string) {
    const item = await this.repo.findOne({ where: { id, empresaId } });
    if (!item) throw new NotFoundException('Categoria não encontrada.');
    return item;
  }

  private async conferirAmbiente(empresaId: string, ambienteId?: string | null) {
    if (!ambienteId) return;
    const [a] = await this.repo.query(`SELECT 1 FROM ambientes WHERE id = $1 AND empresa_id = $2`, [ambienteId, empresaId]);
    if (!a) throw new BadRequestException('Ambiente inválido.');
  }

  private async conferirNome(empresaId: string, nome: string, ambienteId: string | null, ignorarId?: string) {
    const [x] = await this.repo.query(
      `SELECT 1 FROM categorias WHERE empresa_id = $1 AND ativo AND lower(trim(nome)) = lower(trim($2))
          AND ambiente_id IS NOT DISTINCT FROM $3 ${ignorarId ? 'AND id <> $4' : ''} LIMIT 1`,
      ignorarId ? [empresaId, nome, ambienteId, ignorarId] : [empresaId, nome, ambienteId]);
    if (x) throw new BadRequestException(`Já existe a categoria ${nome.trim()} neste ambiente.`);
  }

  async criar(empresaId: string, dto: CriarCategoriaDto) {
    await this.conferirAmbiente(empresaId, dto.ambienteId);
    await this.conferirNome(empresaId, dto.nome, dto.ambienteId ?? null);
    return this.repo.save(this.repo.create({ ...dto, nome: dto.nome.trim(), ambienteId: dto.ambienteId ?? null, empresaId }));
  }

  async atualizar(empresaId: string, id: string, dto: AtualizarCategoriaDto) {
    const item = await this.buscar(empresaId, id);
    if (dto.ambienteId !== undefined && dto.ambienteId !== item.ambienteId) {
      await this.conferirAmbiente(empresaId, dto.ambienteId);
      // categoria de um ambiente não pode ficar com unidades de outro
      const [outra] = await this.repo.query(
        `SELECT un.codigo FROM unidades un WHERE un.categoria_id = $1 AND un.ativo AND un.ambiente_padrao_id <> $2 LIMIT 1`, [id, dto.ambienteId]);
      if (outra) throw new BadRequestException(`A unidade ${outra.codigo} é de outro ambiente e usa esta categoria. Troque a categoria dela antes.`);
    }
    if (dto.nome !== undefined || dto.ambienteId !== undefined) {
      await this.conferirNome(empresaId, dto.nome ?? item.nome, dto.ambienteId ?? item.ambienteId, id);
    }
    Object.assign(item, dto);
    if (dto.nome !== undefined) item.nome = dto.nome.trim();
    return this.repo.save(item);
  }

  async desativar(empresaId: string, id: string) {
    const item = await this.buscar(empresaId, id);
    const [uso] = await this.repo.query(
      `SELECT count(*)::int AS n, string_agg(codigo, ', ' ORDER BY ordem, codigo) AS cods FROM (SELECT codigo, ordem FROM unidades WHERE categoria_id = $1 AND ativo LIMIT 12) x`, [id]);
    if (Number(uso?.n) > 0) {
      throw new BadRequestException(`A categoria ${item.nome} ainda tem unidades (${uso.cods}). Passe essas unidades para outra categoria antes de excluir.`);
    }
    item.ativo = false;
    return this.repo.save(item);
  }
}
