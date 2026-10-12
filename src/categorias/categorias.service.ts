import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Categoria } from './categoria.entity';
import { AtualizarCategoriaDto, CriarCategoriaDto } from './categorias.dto';

@Injectable()
export class CategoriasService {
  constructor(@InjectRepository(Categoria) private readonly repo: Repository<Categoria>) {}

  listar(empresaId: string, incluirInativos = false) {
    return this.repo.find({
      where: incluirInativos ? { empresaId } : { empresaId, ativo: true },
      order: { ordem: 'ASC', nome: 'ASC' },
    });
  }

  async buscar(empresaId: string, id: string) {
    const item = await this.repo.findOne({ where: { id, empresaId } });
    if (!item) throw new NotFoundException('Categoria não encontrada.');
    return item;
  }

  criar(empresaId: string, dto: CriarCategoriaDto) {
    return this.repo.save(this.repo.create({ ...dto, empresaId }));
  }

  async atualizar(empresaId: string, id: string, dto: AtualizarCategoriaDto) {
    const item = await this.buscar(empresaId, id);
    Object.assign(item, dto);
    return this.repo.save(item);
  }

  async desativar(empresaId: string, id: string) {
    const item = await this.buscar(empresaId, id);
    item.ativo = false;
    return this.repo.save(item);
  }
}
