import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CortesiasService } from './cortesias.service';
import { CortesiaDto } from './cortesias.dto';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken, temPermissao } from '../common/permissoes';

@Controller('cortesias')
export class CortesiasController {
  constructor(private readonly service: CortesiasService) {}

  /** ativas e na validade (fechamento); com ?todas=1 o cadastro completo */
  @Get()
  @Requer('estadias.operar', 'cortesias.gerenciar')
  listar(@Usuario() u: UsuarioToken, @Query('todas') todas?: string) {
    return this.service.listar(u, todas === '1' && temPermissao(u, 'cortesias.gerenciar'));
  }

  @Post()
  @Requer('cortesias.gerenciar')
  criar(@Usuario() u: UsuarioToken, @Body() dto: CortesiaDto) {
    return this.service.criar(u, dto);
  }

  @Patch(':id')
  @Requer('cortesias.gerenciar')
  atualizar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CortesiaDto) {
    return this.service.atualizar(u, id, dto);
  }

  @Delete(':id')
  @Requer('cortesias.gerenciar')
  remover(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.remover(u, id);
  }
}
