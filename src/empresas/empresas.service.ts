import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Empresa } from './empresa.entity';
import { AtualizarEmpresaDto } from './empresas.dto';
import { STATUS_UNIDADE } from '../common/permissoes';

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
    const { aparencia, ...resto } = dto;
    Object.assign(empresa, resto);
    if (aparencia) empresa.aparencia = this.limparAparencia(aparencia);
    return this.repo.save(empresa);
  }

  /** Aceita só nome de tema simples e cores hexadecimais dos status conhecidos. */
  private limparAparencia(a: { tema?: string; cores?: Record<string, string>; menu?: string }) {
    const tema = typeof a.tema === 'string' && /^[a-z0-9-]{1,30}$/.test(a.tema) ? a.tema : 'dia';
    const cores: Record<string, string> = {};
    for (const [st, cor] of Object.entries(a.cores ?? {})) {
      if ((STATUS_UNIDADE as readonly string[]).includes(st) && typeof cor === 'string' && /^#[0-9a-fA-F]{6}$/.test(cor)) {
        cores[st] = cor.toUpperCase();
      }
    }
    // cor própria do menu lateral (opcional)
    const menu = typeof a.menu === 'string' && /^#[0-9a-fA-F]{6}$/.test(a.menu) ? a.menu.toUpperCase() : undefined;
    return menu ? { tema, cores, menu } : { tema, cores };
  }
}
