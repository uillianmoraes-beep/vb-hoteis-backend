import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { UsuarioEntity } from '../usuarios/usuario.entity';
import { Empresa } from '../empresas/empresa.entity';
import { UsuarioToken } from '../common/permissoes';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(UsuarioEntity) private readonly usuarios: Repository<UsuarioEntity>,
    @InjectRepository(Empresa) private readonly empresas: Repository<Empresa>,
    private readonly jwt: JwtService,
  ) {}

  private buscarComSenha(where: string, valor: string) {
    return this.usuarios
      .createQueryBuilder('u')
      .addSelect('u.senhaHash')
      .leftJoinAndSelect('u.perfil', 'perfil')
      .where(where, { valor })
      .getOne();
  }

  async login(login: string, senha: string) {
    const usuario = await this.buscarComSenha('lower(u.login) = lower(:valor)', login.trim());
    const senhaOk = usuario ? await bcrypt.compare(senha, usuario.senhaHash) : false;
    if (!usuario || !senhaOk) throw new UnauthorizedException('Login ou senha incorretos.');
    if (!usuario.ativo) throw new UnauthorizedException('Usuário desativado. Fale com o gerente.');

    const empresa = await this.empresas.findOne({ where: { id: usuario.empresaId } });
    if (!empresa || !empresa.ativo) throw new UnauthorizedException('Acesso da empresa suspenso.');

    const payload: UsuarioToken = {
      sub: usuario.id,
      empresaId: usuario.empresaId,
      perfilId: usuario.perfilId,
      nome: usuario.nome,
      permissoes: usuario.perfil?.permissoes ?? [],
      ambientesIds: usuario.ambientesIds,
    };
    await this.usuarios.update({ id: usuario.id }, { ultimoAcesso: new Date() });

    return {
      token: await this.jwt.signAsync({ ...payload }),
      usuario: {
        id: usuario.id,
        nome: usuario.nome,
        login: usuario.login,
        perfil: usuario.perfil ? { id: usuario.perfil.id, nome: usuario.perfil.nome, limites: usuario.perfil.limites } : null,
        permissoes: payload.permissoes,
        ambientesIds: usuario.ambientesIds,
      },
      empresa: { id: empresa.id, nome: empresa.nome, vocabulario: empresa.vocabulario },
    };
  }

  async eu(u: UsuarioToken) {
    const usuario = await this.usuarios.findOne({ where: { id: u.sub }, relations: { perfil: true } });
    if (!usuario || !usuario.ativo) throw new UnauthorizedException('Usuário não encontrado ou desativado.');
    const empresa = await this.empresas.findOne({ where: { id: usuario.empresaId } });
    return {
      usuario: {
        id: usuario.id,
        nome: usuario.nome,
        login: usuario.login,
        perfil: usuario.perfil ? { id: usuario.perfil.id, nome: usuario.perfil.nome, limites: usuario.perfil.limites } : null,
        permissoes: usuario.perfil?.permissoes ?? [],
        ambientesIds: usuario.ambientesIds,
      },
      empresa: empresa ? { id: empresa.id, nome: empresa.nome, vocabulario: empresa.vocabulario } : null,
    };
  }

  async trocarMinhaSenha(u: UsuarioToken, senhaAtual: string, novaSenha: string) {
    const usuario = await this.buscarComSenha('u.id = :valor', u.sub);
    if (!usuario) throw new UnauthorizedException();
    if (!(await bcrypt.compare(senhaAtual, usuario.senhaHash))) {
      throw new BadRequestException('Senha atual incorreta.');
    }
    await this.usuarios.update({ id: u.sub }, { senhaHash: await bcrypt.hash(novaSenha, 10) });
    return { ok: true };
  }
}
