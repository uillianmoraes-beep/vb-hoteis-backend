import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROTA_PUBLICA } from '../common/decorators/publico.decorator';
import { UsuarioToken } from '../common/permissoes';
import { RevendaService, SITUACOES_BLOQUEIO } from './revenda.service';

/** rotas que continuam abertas com o acesso suspenso (para pagar, falar com o suporte e sair) */
const LIVRES = ['/api/area-cliente', '/api/auth', '/api/empresa'];

/**
 * Empresa bloqueada (teste acabou, mensalidade muito atrasada ou suspensa pela Virtual Barra):
 * só a Área do cliente funciona até regularizar. No servidor local não bloqueia.
 */
@Injectable()
export class AssinaturaGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly revenda: RevendaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if ((process.env.VB_MODO || '').toLowerCase() === 'local') return true;
    if (this.reflector.getAllAndOverride<boolean>(ROTA_PUBLICA, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest();
    const u: UsuarioToken | undefined = req.usuario;
    if (!u?.empresaId) return true;
    const caminho = String(req.originalUrl ?? req.url ?? '');
    if (LIVRES.some((l) => caminho.startsWith(l))) return true;
    const s = await this.revenda.situacao(u.empresaId);
    if (!SITUACOES_BLOQUEIO.includes(s)) return true;
    throw new HttpException({ statusCode: 402, bloqueado: true, message: 'O acesso ao sistema está suspenso. Abra a Área do cliente para regularizar ou falar com o suporte.' }, 402);
  }
}
