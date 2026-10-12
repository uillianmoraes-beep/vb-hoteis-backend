import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Empresa } from './empresa.entity';
import { AtualizarEmpresaDto } from './empresas.dto';

@Injectable()
export class EmpresasService {
  constructor(@InjectRepository(Empresa) private readonly repo: Repository<Empresa>) {}

  async buscar(id: string): Promise<Empresa> {
    const empresa = await this.repo.findOne({ where: { id } });
    if (!empresa) throw new NotFoundException('Empresa não encontrada.');
    return empresa;
  }

  async atualizar(id: string, dto: AtualizarEmpresaDto): Promise<Empresa> {
    const empresa = await this.buscar(id);
    Object.assign(empresa, dto);
    return this.repo.save(empresa);
  }
}
