import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSOES_EXIGIDAS } from '../decorators/requer.decorator';
import { temPermissao, UsuarioToken } from '../permissoes';

@Injectable()
export class PermissoesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const exigidas = this.reflector.getAllAndOverride<string[]>(PERMISSOES_EXIGIDAS, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!exigidas || exigidas.length === 0) return true;

    const usuario: UsuarioToken | undefined = ctx.switchToHttp().getRequest().usuario;
    if (!usuario) return false;
    if (exigidas.some((p) => temPermissao(usuario, p))) return true;
    throw new ForbiddenException('Seu perfil não tem permissão para esta ação.');
  }
}
