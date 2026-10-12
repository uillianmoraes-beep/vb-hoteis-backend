import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UsuarioToken } from '../permissoes';

/** Injeta o usuário logado (dados do token) no parâmetro do controller. */
export const Usuario = createParamDecorator((_: unknown, ctx: ExecutionContext): UsuarioToken => {
  const req = ctx.switchToHttp().getRequest();
  return req.usuario as UsuarioToken;
});
