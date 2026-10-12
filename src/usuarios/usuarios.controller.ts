import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { UsuariosService } from './usuarios.service';
import { AtualizarUsuarioDto, CriarUsuarioDto, TrocarSenhaDto } from './usuarios.dto';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

@Controller('usuarios')
@Requer('usuarios.gerenciar')
export class UsuariosController {
  constructor(private readonly service: UsuariosService) {}

  @Get()
  listar(@Usuario() u: UsuarioToken) {
    return this.service.listar(u.empresaId);
  }

  @Get(':id')
  buscar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.buscar(u.empresaId, id);
  }

  @Post()
  criar(@Usuario() u: UsuarioToken, @Body() dto: CriarUsuarioDto) {
    return this.service.criar(u.empresaId, dto);
  }

  @Patch(':id')
  atualizar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AtualizarUsuarioDto) {
    return this.service.atualizar(u.empresaId, id, dto, u.sub);
  }

  @Patch(':id/senha')
  trocarSenha(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TrocarSenhaDto) {
    return this.service.trocarSenha(u.empresaId, id, dto.senha);
  }
}
