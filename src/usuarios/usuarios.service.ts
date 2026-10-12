import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { UsuarioEntity } from './usuario.entity';
import { Perfil } from '../perfis/perfil.entity';
import { AtualizarUsuarioDto, CriarUsuarioDto } from './usuarios.dto';

@Injectable()
export class UsuariosService {
  constructor(
    @InjectRepository(UsuarioEntity) private readonly repo: Repository<UsuarioEntity>,
    @InjectRepository(Perfil) private readonly perfis: Repository<Perfil>,
  ) {}

  listar(empresaId: string) {
    return this.repo.find({ where: { empresaId }, relations: { perfil: true }, order: { nome: 'ASC' } });
  }

  async buscar(empresaId: string, id: string) {
    const item = await this.repo.findOne({ where: { id, empresaId }, relations: { perfil: true } });
    if (!item) throw new NotFoundException('Usuário não encontrado.');
    return item;
  }

  private async validarPerfil(empresaId: string, perfilId: string) {
    if (!(await this.perfis.exists({ where: { id: perfilId, empresaId } }))) {
      throw new BadRequestException('Perfil inválido.');
    }
  }

  private async validarLoginLivre(login: string, ignorarId?: string) {
    const existente = await this.repo
      .createQueryBuilder('u')
      .where('lower(u.login) = lower(:login)', { login })
      .getOne();
    if (existente && existente.id !== ignorarId) throw new BadRequestException('Este login já está em uso.');
  }

  async criar(empresaId: string, dto: CriarUsuarioDto) {
    await this.validarPerfil(empresaId, dto.perfilId);
    await this.validarLoginLivre(dto.login);
    const { senha, ...resto } = dto;
    const salvo = await this.repo.save(
      this.repo.create({
        ...resto,
        login: dto.login.trim(),
        ambientesIds: dto.ambientesIds?.length ? dto.ambientesIds : null,
        senhaHash: await bcrypt.hash(senha, 10),
        empresaId,
      }),
    );
    return this.buscar(empresaId, salvo.id);
  }

  async atualizar(empresaId: string, id: string, dto: AtualizarUsuarioDto, idLogado: string) {
    const usuario = await this.buscar(empresaId, id);
    if (dto.perfilId) await this.validarPerfil(empresaId, dto.perfilId);
    if (dto.login && dto.login.toLowerCase() !== usuario.login.toLowerCase()) {
      await this.validarLoginLivre(dto.login, id);
    }
    if (dto.ativo === false && id === idLogado) {
      throw new BadRequestException('Você não pode desativar o próprio usuário.');
    }
    await this.repo.update(
      { id },
      {
        ...(dto.nome !== undefined && { nome: dto.nome }),
        ...(dto.login !== undefined && { login: dto.login.trim() }),
        ...(dto.perfilId !== undefined && { perfilId: dto.perfilId }),
        ...(dto.ativo !== undefined && { ativo: dto.ativo }),
        ...(dto.acessoCelular !== undefined && { acessoCelular: dto.acessoCelular }),
        ...(dto.ambientesIds !== undefined && {
          ambientesIds: dto.ambientesIds && dto.ambientesIds.length ? dto.ambientesIds : null,
        }),
      },
    );
    return this.buscar(empresaId, usuario.id);
  }

  async trocarSenha(empresaId: string, id: string, senha: string) {
    await this.buscar(empresaId, id);
    await this.repo.update({ id }, { senhaHash: await bcrypt.hash(senha, 10) });
    return { ok: true };
  }
}
