import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Ambiente } from './ambiente.entity';
import { AtualizarAmbienteDto, CriarAmbienteDto } from './ambientes.dto';

@Injectable()
export class AmbientesService {
  constructor(@InjectRepository(Ambiente) private readonly repo: Repository<Ambiente>) {}

  listar(empresaId: string, incluirInativos = false) {
    return this.repo.find({
      where: incluirInativos ? { empresaId } : { empresaId, ativo: true },
      order: { ordem: 'ASC', nome: 'ASC' },
    });
  }

  async buscar(empresaId: string, id: string) {
    const item = await this.repo.findOne({ where: { id, empresaId } });
    if (!item) throw new NotFoundException('Ambiente não encontrado.');
    return item;
  }

  criar(empresaId: string, dto: CriarAmbienteDto) {
    return this.repo.save(this.repo.create({ ...dto, empresaId }));
  }

  async atualizar(empresaId: string, id: string, dto: AtualizarAmbienteDto) {
    const item = await this.buscar(empresaId, id);
    Object.assign(item, dto);
    return this.repo.save(item);
  }

  /** Não apaga: desativa, para não perder histórico. */
  async desativar(empresaId: string, id: string) {
    const item = await this.buscar(empresaId, id);
    item.ativo = false;
    return this.repo.save(item);
  }
}
