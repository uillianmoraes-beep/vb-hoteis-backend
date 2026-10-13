import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { UsuarioEntity } from '../usuarios/usuario.entity';
import { Empresa } from '../empresas/empresa.entity';
import { UsuarioToken } from '../common/permissoes';
import { CaixaService } from '../caixa/caixa.service';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(UsuarioEntity) private readonly usuarios: Repository<UsuarioEntity>,
    @InjectRepository(Empresa) private readonly empresas: Repository<Empresa>,
    private readonly jwt: JwtService,
    private readonly caixa: CaixaService,
  ) {}

  private buscarComSenha(where: string, valor: string) {
    return this.usuarios
      .createQueryBuilder('u')
      .addSelect('u.senhaHash')
      .leftJoinAndSelect('u.perfil', 'perfil')
      .where(where, { valor })
      .getOne();
  }

  async login(login: string, senha: string, agente?: string) {
    const usuario = await this.buscarComSenha('lower(u.login) = lower(:valor)', login.trim());
    const senhaOk = usuario ? await bcrypt.compare(senha, usuario.senhaHash) : false;
    if (!usuario || !senhaOk) throw new UnauthorizedException('Login ou senha incorretos.');
    if (!usuario.ativo) throw new UnauthorizedException('Usuário desativado. Fale com o gerente.');
    if (usuario.acessoCelular === false && /Mobi|Android|iPhone|iPad|iPod/i.test(agente ?? '')) {
      throw new UnauthorizedException('Seu usuário não tem acesso pelo celular. Use o computador da empresa.');
    }

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
    // troca de turno: abre o caixa no nome de quem entrou, com o fundo deixado pelo anterior
    const caixasAbertos = await this.caixa.abrirNoLogin(payload).catch(() => []);

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
      empresa: { id: empresa.id, nome: empresa.nome, vocabulario: empresa.vocabulario, aparencia: empresa.aparencia, modulos: empresa.modulos ?? {} },
      caixasAbertos,
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
      empresa: empresa ? { id: empresa.id, nome: empresa.nome, vocabulario: empresa.vocabulario, aparencia: empresa.aparencia, modulos: empresa.modulos ?? {} } : null,
    };
  }

  /** ambientes em que o usuário pode entrar (para a escolha logo após o login) */
  async meusAmbientes(u: UsuarioToken) {
    const l = await this.usuarios.query(
      `SELECT id, nome, tipo, cor FROM ambientes WHERE empresa_id = $1 AND ativo ORDER BY ordem, nome`, [u.empresaId]);
    return l.filter((a: { id: string }) => !u.ambientesIds?.length || u.ambientesIds.includes(a.id));
  }

  /**
   * Registra em qual ambiente o operador entrou (login) ou para qual trocou.
   * Na troca confere a senha do próprio usuário; tentativa com senha errada também fica registrada.
   */
  async entrarAmbiente(u: UsuarioToken, dto: { ambienteId: string; deAmbienteId?: string; tipo: 'login' | 'troca'; senha?: string }, ip: string, agente: string) {
    const [amb] = await this.usuarios.query(`SELECT id, nome FROM ambientes WHERE id = $1 AND empresa_id = $2 AND ativo`, [dto.ambienteId, u.empresaId]);
    if (!amb) throw new BadRequestException('Ambiente não encontrado.');
    if (u.ambientesIds?.length && !u.ambientesIds.includes(amb.id)) throw new ForbiddenException(`Seu usuário não tem acesso a ${amb.nome}.`);
    const registrar = (tipo: string) => this.usuarios.query(
      `INSERT INTO acessos_ambiente (empresa_id, usuario_id, usuario_nome, tipo, de_ambiente_id, para_ambiente_id, ip, agente) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [u.empresaId, u.sub, u.nome, tipo, dto.deAmbienteId ?? null, amb.id, ip.slice(0, 60) || null, agente.slice(0, 200) || null]);
    if (dto.tipo === 'troca') {
      const usuario = await this.buscarComSenha('u.id = :valor', u.sub);
      if (!usuario || !dto.senha || !(await bcrypt.compare(dto.senha, usuario.senhaHash))) {
        await registrar('negada');
        throw new BadRequestException('Senha incorreta.');
      }
    }
    await registrar(dto.tipo);
    return { ok: true, ambiente: amb.nome };
  }

  async acessos(u: UsuarioToken, f: { de: string; ate: string; ambienteId?: string; usuarioId?: string }) {
    const params: unknown[] = [u.empresaId, f.de, f.ate];
    let w = '';
    if (f.ambienteId) { params.push(f.ambienteId); w += ` AND (x.para_ambiente_id = $${params.length}::uuid OR x.de_ambiente_id = $${params.length}::uuid)`; }
    if (f.usuarioId) { params.push(f.usuarioId); w += ` AND x.usuario_id = $${params.length}::uuid`; }
    const l = await this.usuarios.query(
      `SELECT x.id, x.criado_em, x.usuario_id, x.usuario_nome, x.tipo, x.ip, x.agente, ad.nome AS de, ap.nome AS para
         FROM acessos_ambiente x LEFT JOIN ambientes ad ON ad.id = x.de_ambiente_id LEFT JOIN ambientes ap ON ap.id = x.para_ambiente_id
        WHERE x.empresa_id = $1 AND x.criado_em >= ($2::date)::timestamp AT TIME ZONE 'America/Sao_Paulo'
          AND x.criado_em < ($3::date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo'${w}
        ORDER BY x.criado_em DESC LIMIT 2000`, params);
    return l.map((x: Record<string, unknown>) => ({
      id: x.id, criadoEm: x.criado_em, usuarioId: x.usuario_id, usuario: x.usuario_nome, tipo: x.tipo, de: x.de, para: x.para, ip: x.ip, agente: x.agente,
    }));
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
