import { Body, Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto, TrocarMinhaSenhaDto } from './dto/login.dto';
import { Publico } from '../common/decorators/publico.decorator';
import { Usuario } from '../common/decorators/usuario.decorator';
import { UsuarioToken } from '../common/permissoes';

@Controller('auth')
export class AuthController {
  constructor(private readonly service: AuthService) {}

  @Publico()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.service.login(dto.login, dto.senha);
  }

  @Get('eu')
  eu(@Usuario() u: UsuarioToken) {
    return this.service.eu(u);
  }

  @Patch('minha-senha')
  trocarMinhaSenha(@Usuario() u: UsuarioToken, @Body() dto: TrocarMinhaSenhaDto) {
    return this.service.trocarMinhaSenha(u, dto.senhaAtual, dto.novaSenha);
  }
}
