import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { PerfisService } from './perfis.service';
import { AtualizarPerfilDto, CriarPerfilDto } from './perfis.dto';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

@Controller('perfis')
@Requer('perfis.gerenciar', 'usuarios.gerenciar')
export class PerfisController {
  constructor(private readonly service: PerfisService) {}

  @Get('permissoes')
  catalogo() {
    return this.service.catalogo();
  }

  @Get()
  listar(@Usuario() u: UsuarioToken) {
    return this.service.listar(u.empresaId);
  }

  @Post()
  @Requer('perfis.gerenciar')
  criar(@Usuario() u: UsuarioToken, @Body() dto: CriarPerfilDto) {
    return this.service.criar(u.empresaId, dto);
  }

  @Patch(':id')
  @Requer('perfis.gerenciar')
  atualizar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AtualizarPerfilDto) {
    return this.service.atualizar(u.empresaId, id, dto);
  }

  @Delete(':id')
  @Requer('perfis.gerenciar')
  remover(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.remover(u.empresaId, id);
  }
}
