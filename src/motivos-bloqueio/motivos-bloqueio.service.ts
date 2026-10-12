import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MotivoBloqueio } from './motivo-bloqueio.entity';
import { AtualizarMotivoDto, CriarMotivoDto } from './motivos-bloqueio.dto';

@Injectable()
export class MotivosBloqueioService {
  constructor(@InjectRepository(MotivoBloqueio) private readonly repo: Repository<MotivoBloqueio>) {}

  listar(empresaId: string, incluirInativos = false) {
    return this.repo.find({
      where: incluirInativos ? { empresaId } : { empresaId, ativo: true },
      order: { ordem: 'ASC', nome: 'ASC' },
    });
  }

  async buscar(empresaId: string, id: string) {
    const item = await this.repo.findOne({ where: { id, empresaId } });
    if (!item) throw new NotFoundException('Motivo de bloqueio não encontrado.');
    return item;
  }

  criar(empresaId: string, dto: CriarMotivoDto) {
    return this.repo.save(this.repo.create({ ...dto, empresaId }));
  }

  async atualizar(empresaId: string, id: string, dto: AtualizarMotivoDto) {
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
