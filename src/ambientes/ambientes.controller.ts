import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { AmbientesService } from './ambientes.service';
import { AtualizarAmbienteDto, CriarAmbienteDto } from './ambientes.dto';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

@Controller('ambientes')
export class AmbientesController {
  constructor(private readonly service: AmbientesService) {}

  @Get()
  listar(@Usuario() u: UsuarioToken, @Query('inativos') inativos?: string) {
    return this.service.listar(u.empresaId, inativos === 'true');
  }

  @Post()
  @Requer('ambientes.gerenciar')
  criar(@Usuario() u: UsuarioToken, @Body() dto: CriarAmbienteDto) {
    return this.service.criar(u.empresaId, dto);
  }

  @Patch(':id')
  @Requer('ambientes.gerenciar')
  atualizar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AtualizarAmbienteDto) {
    return this.service.atualizar(u.empresaId, id, dto);
  }

  @Delete(':id')
  @Requer('ambientes.gerenciar')
  desativar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.desativar(u.empresaId, id);
  }
}
