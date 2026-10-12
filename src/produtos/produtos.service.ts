import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Produto } from './produto.entity';
import { AtualizarProdutoDto, CriarProdutoDto } from './produtos.dto';
import { limparFiscal } from '../common/fiscal';

@Injectable()
export class ProdutosService {
  constructor(@InjectRepository(Produto) private readonly repo: Repository<Produto>) {}

  listar(empresaId: string, opcoes: { inativos?: boolean; busca?: string } = {}) {
    const qb = this.repo.createQueryBuilder('p').where('p.empresaId = :empresaId', { empresaId });
    if (!opcoes.inativos) qb.andWhere('p.ativo = true');
    const termo = opcoes.busca?.trim();
    if (termo) {
      qb.andWhere('(lower(p.nome) LIKE :t OR lower(p.codigo) = :c OR lower(p.grupo) LIKE :t)', {
        t: `%${termo.toLowerCase()}%`,
        c: termo.toLowerCase(),
      });
    }
    return qb.orderBy('p.grupo', 'ASC', 'NULLS LAST').addOrderBy('p.nome', 'ASC').limit(500).getMany();
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

  async criar(empresaId: string, dto: CriarProdutoDto) {
    await this.codigoLivre(empresaId, dto.codigo);
    return this.repo.save(
      this.repo.create({
        empresaId,
        nome: dto.nome.trim(),
        codigo: dto.codigo?.trim() || null,
        grupo: dto.grupo?.trim() || null,
        tipo: dto.tipo ?? 'produto',
        preco: dto.preco.toFixed(2),
        fiscal: limparFiscal(dto.fiscal),
      }),
    );
  }

  async atualizar(empresaId: string, id: string, dto: AtualizarProdutoDto) {
    const p = await this.buscar(empresaId, id);
    if (dto.codigo !== undefined) await this.codigoLivre(empresaId, dto.codigo, id);
    if (dto.nome !== undefined) p.nome = dto.nome.trim();
    if (dto.codigo !== undefined) p.codigo = dto.codigo?.trim() || null;
    if (dto.grupo !== undefined) p.grupo = dto.grupo?.trim() || null;
    if (dto.tipo !== undefined) p.tipo = dto.tipo;
    if (dto.preco !== undefined) p.preco = dto.preco.toFixed(2);
    if (dto.ativo !== undefined) p.ativo = dto.ativo;
    if (dto.fiscal !== undefined) p.fiscal = limparFiscal(dto.fiscal);
    return this.repo.save(p);
  }

  async desativar(empresaId: string, id: string) {
    const p = await this.buscar(empresaId, id);
    p.ativo = false;
    return this.repo.save(p);
  }
}
