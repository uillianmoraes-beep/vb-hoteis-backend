import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ROTA_PUBLICA } from '../decorators/publico.decorator';
import { UsuarioToken } from '../permissoes';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly reflector: Reflector) {}

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
    return true;
  }
}
