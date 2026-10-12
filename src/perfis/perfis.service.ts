import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Perfil } from './perfil.entity';
import { UsuarioEntity } from '../usuarios/usuario.entity';
import { AtualizarPerfilDto, CriarPerfilDto } from './perfis.dto';
import { PERMISSOES } from '../common/permissoes';

@Injectable()
export class PerfisService {
  constructor(
    @InjectRepository(Perfil) private readonly repo: Repository<Perfil>,
    @InjectRepository(UsuarioEntity) private readonly usuarios: Repository<UsuarioEntity>,
  ) {}

  catalogo() {
    return Object.entries(PERMISSOES).map(([chave, descricao]) => ({ chave, descricao }));
  }

  private validarPermissoes(lista: string[]) {
    const validas = new Set(Object.keys(PERMISSOES));
    const invalidas = lista.filter((p) => p !== '*' && !validas.has(p));
    if (invalidas.length) throw new BadRequestException(`Permissões desconhecidas: ${invalidas.join(', ')}`);
  }

  listar(empresaId: string) {
    return this.repo.find({ where: { empresaId }, order: { nome: 'ASC' } });
  }

  async buscar(empresaId: string, id: string) {
    const item = await this.repo.findOne({ where: { id, empresaId } });
    if (!item) throw new NotFoundException('Perfil não encontrado.');
    return item;
  }

  async criar(empresaId: string, dto: CriarPerfilDto) {
    this.validarPermissoes(dto.permissoes);
    if (await this.repo.exists({ where: { empresaId, nome: dto.nome } })) {
      throw new BadRequestException('Já existe um perfil com esse nome.');
    }
    return this.repo.save(this.repo.create({ ...dto, limites: dto.limites ?? {}, empresaId }));
  }

  async atualizar(empresaId: string, id: string, dto: AtualizarPerfilDto) {
    const perfil = await this.buscar(empresaId, id);
    if (perfil.sistema && dto.permissoes) {
      throw new BadRequestException('As permissões do Administrador não podem ser alteradas.');
    }
    if (dto.permissoes) this.validarPermissoes(dto.permissoes);
    if (dto.nome && dto.nome !== perfil.nome && (await this.repo.exists({ where: { empresaId, nome: dto.nome } }))) {
      throw new BadRequestException('Já existe um perfil com esse nome.');
    }
    Object.assign(perfil, dto);
    return this.repo.save(perfil);
  }

  async remover(empresaId: string, id: string) {
    const perfil = await this.buscar(empresaId, id);
    if (perfil.sistema) throw new BadRequestException('Este perfil é do sistema e não pode ser excluído.');
    if (await this.usuarios.exists({ where: { perfilId: id } })) {
      throw new BadRequestException('Há usuários com este perfil. Troque o perfil deles antes de excluir.');
    }
    await this.repo.delete({ id });
    return { ok: true };
  }
}
