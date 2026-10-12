import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CategoriasService } from './categorias.service';
import { AtualizarCategoriaDto, CriarCategoriaDto } from './categorias.dto';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

@Controller('categorias')
export class CategoriasController {
  constructor(private readonly service: CategoriasService) {}

  @Get()
  listar(@Usuario() u: UsuarioToken, @Query('inativos') inativos?: string) {
    return this.service.listar(u.empresaId, inativos === 'true');
  }

  @Post()
  @Requer('categorias.gerenciar')
  criar(@Usuario() u: UsuarioToken, @Body() dto: CriarCategoriaDto) {
    return this.service.criar(u.empresaId, dto);
  }

  @Patch(':id')
  @Requer('categorias.gerenciar')
  atualizar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AtualizarCategoriaDto) {
    return this.service.atualizar(u.empresaId, id, dto);
  }

  @Delete(':id')
  @Requer('categorias.gerenciar')
  desativar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.desativar(u.empresaId, id);
  }
}
