import { Body, Controller, Get, Headers, HttpCode, Ip, Patch, Post, Query } from '@nestjs/common';
import { AuthService } from './auth.service';
import { EntrarAmbienteDto, LoginDto, TrocarMinhaSenhaDto } from './dto/login.dto';
import { Requer } from '../common/decorators/requer.decorator';
import { Publico } from '../common/decorators/publico.decorator';
import { Usuario } from '../common/decorators/usuario.decorator';
import { UsuarioToken } from '../common/permissoes';

@Controller('auth')
export class AuthController {
  constructor(private readonly service: AuthService) {}

  @Publico()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Headers('user-agent') agente?: string) {
    return this.service.login(dto.login, dto.senha, agente);
  }

  @Get('eu')
  eu(@Usuario() u: UsuarioToken) {
    return this.service.eu(u);
  }

  @Get('ambientes')
  meusAmbientes(@Usuario() u: UsuarioToken) {
    return this.service.meusAmbientes(u);
  }

  @Post('ambiente')
  @HttpCode(200)
  entrarAmbiente(@Usuario() u: UsuarioToken, @Body() dto: EntrarAmbienteDto, @Ip() ip: string, @Headers('x-forwarded-for') fwd?: string, @Headers('user-agent') agente?: string) {
    return this.service.entrarAmbiente(u, dto, (fwd?.split(',')[0] ?? ip ?? '').trim(), agente ?? '');
  }

  @Get('acessos')
  @Requer('usuarios.gerenciar', 'relatorios.ver')
  acessos(@Usuario() u: UsuarioToken, @Query() q: Record<string, string>) {
    const d = (x?: string) => (x && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : undefined);
    const uuid = (x?: string) => (x && /^[0-9a-f-]{36}$/i.test(x) ? x : undefined);
    const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    return this.service.acessos(u, { de: d(q.de) ?? hoje, ate: d(q.ate) ?? hoje, ambienteId: uuid(q.ambienteId), usuarioId: uuid(q.usuarioId) });
  }

  @Patch('minha-senha')
  trocarMinhaSenha(@Usuario() u: UsuarioToken, @Body() dto: TrocarMinhaSenhaDto) {
    return this.service.trocarMinhaSenha(u, dto.senhaAtual, dto.novaSenha);
  }
}
