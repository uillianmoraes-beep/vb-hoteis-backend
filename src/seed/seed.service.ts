import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { Perfil } from '../perfis/perfil.entity';
import { UsuarioEntity } from '../usuarios/usuario.entity';
import { criarEmpresa } from './nova-empresa';

/**
 * Primeira subida: se ainda não existe nenhum usuário, cria a empresa,
 * os perfis padrão, os motivos de bloqueio e o administrador.
 * Com SEED_EXEMPLOS=true, cria também ambientes, categorias e unidades de exemplo.
 * Depois disso não faz mais nada.
 */
@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly log = new Logger('Seed');

  constructor(private readonly ds: DataSource) {}

  /** Remove o nome da variável se ele tiver sido colado junto do valor (ex.: "SEED_ADMIN_SENHA=abc"). */
  private limpar(nome: string, valor?: string): string | undefined {
    if (!valor) return undefined;
    let v = valor.trim();
    if (v.toUpperCase().startsWith(nome)) v = v.slice(nome.length).replace(/^\s*[=:]\s*/, '');
    return v.replace(/^["']|["']$/g, '').trim() || undefined;
  }

  /**
   * Com REDEFINIR_ADMIN=true, regrava login e senha do Administrador a partir de
   * SEED_ADMIN_LOGIN e SEED_ADMIN_SENHA. Depois de entrar, apague REDEFINIR_ADMIN.
   */
  private async redefinirAdmin(login: string, senha: string) {
    const perfil = await this.ds.getRepository(Perfil).findOne({ where: { sistema: true }, order: { criadoEm: 'ASC' } });
    if (!perfil) return;
    const repo = this.ds.getRepository(UsuarioEntity);
    const admin = await repo.findOne({ where: { perfilId: perfil.id }, order: { criadoEm: 'ASC' } });
    if (!admin) return;
    await repo.update({ id: admin.id }, { login: login.trim(), senhaHash: await bcrypt.hash(senha, 10), ativo: true });
    this.log.warn(`Login e senha do Administrador redefinidos (login: ${login.trim()}). Apague a variável REDEFINIR_ADMIN.`);
  }

  async onApplicationBootstrap() {
    const jaTemUsuario = await this.ds.getRepository(UsuarioEntity).exists();
    if (jaTemUsuario) {
      const loginR = this.limpar('SEED_ADMIN_LOGIN', process.env.SEED_ADMIN_LOGIN);
      const senhaR = this.limpar('SEED_ADMIN_SENHA', process.env.SEED_ADMIN_SENHA);
      if ((this.limpar('REDEFINIR_ADMIN', process.env.REDEFINIR_ADMIN) || '').toLowerCase() === 'true' && loginR && senhaR) {
        await this.redefinirAdmin(loginR, senhaR);
      }
      return;
    }

    const login = this.limpar('SEED_ADMIN_LOGIN', process.env.SEED_ADMIN_LOGIN);
    const senha = this.limpar('SEED_ADMIN_SENHA', process.env.SEED_ADMIN_SENHA);
    if (!login || !senha) {
      this.log.warn('Banco sem usuários. Configure SEED_ADMIN_LOGIN e SEED_ADMIN_SENHA para criar o administrador.');
      return;
    }

    await this.ds.transaction((m) => criarEmpresa(m, {
      nome: process.env.SEED_EMPRESA_NOME || 'Estabelecimento Exemplo',
      adminNome: process.env.SEED_ADMIN_NOME || 'Administrador',
      login, senha,
      exemplos: (process.env.SEED_EXEMPLOS || 'false').toLowerCase() === 'true',
    }));

    // a primeira empresa administra a revenda do sistema
    await this.ds.query(`UPDATE empresas SET plataforma = true WHERE id = (SELECT id FROM empresas ORDER BY criado_em LIMIT 1) AND NOT EXISTS (SELECT 1 FROM empresas WHERE plataforma)`);
    this.log.log(`Primeira configuração feita. Entre com o login ${login}.`);
  }
}
