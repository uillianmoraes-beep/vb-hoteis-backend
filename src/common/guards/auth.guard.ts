import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { ROTA_PUBLICA } from '../decorators/publico.decorator';
import { UsuarioToken } from '../permissoes';
import { MSG_OUTRO_COMPUTADOR, guardarSessao, sessaoEmCache } from '../sessoes';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly reflector: Reflector, private readonly ds: DataSource) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const publico = this.reflector.getAllAndOverride<boolean>(ROTA_PUBLICA, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (publico) return true;

    const req = ctx.switchToHttp().getRequest();
    const cabecalho: string | undefined = req.headers?.authorization;
    const [tipo, token] = (cabecalho || '').split(' ');
    if (tipo !== 'Bearer' || !token) {
      throw new UnauthorizedException('Faça login para continuar.');
    }
    try {
      req.usuario = await this.jwt.verifyAsync<UsuarioToken>(token);
    } catch {
      throw new UnauthorizedException('Sessão expirada. Faça login novamente.');
    }
    // um computador por vez: o login mais novo vale, o anterior cai
    const u = req.usuario as UsuarioToken;
    if (u.sid) {
      let atual = sessaoEmCache(u.sub);
      if (atual === undefined) {
        const [r] = await this.ds.query(`SELECT sessao_id FROM usuarios WHERE id = $1`, [u.sub]);
        atual = (r?.sessao_id as string | null) ?? null;
        guardarSessao(u.sub, atual);
      }
      if (atual && atual !== u.sid) throw new UnauthorizedException(MSG_OUTRO_COMPUTADOR);
    }
    return true;
  }
}
