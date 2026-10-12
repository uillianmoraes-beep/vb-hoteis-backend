import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { MotivosBloqueioService } from './motivos-bloqueio.service';
import { AtualizarMotivoDto, CriarMotivoDto } from './motivos-bloqueio.dto';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

@Controller('motivos-bloqueio')
export class MotivosBloqueioController {
  constructor(private readonly service: MotivosBloqueioService) {}

  @Get()
  listar(@Usuario() u: UsuarioToken, @Query('inativos') inativos?: string) {
    return this.service.listar(u.empresaId, inativos === 'true');
  }

  @Post()
  @Requer('motivos.gerenciar')
  criar(@Usuario() u: UsuarioToken, @Body() dto: CriarMotivoDto) {
    return this.service.criar(u.empresaId, dto);
  }

  @Patch(':id')
  @Requer('motivos.gerenciar')
  atualizar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AtualizarMotivoDto) {
    return this.service.atualizar(u.empresaId, id, dto);
  }

  @Delete(':id')
  @Requer('motivos.gerenciar')
  desativar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.desativar(u.empresaId, id);
  }
}
