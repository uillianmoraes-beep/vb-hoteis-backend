import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ProdutosService } from './produtos.service';
import { AtualizarProdutoDto, CriarProdutoDto } from './produtos.dto';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

@Controller('produtos')
export class ProdutosController {
  constructor(private readonly service: ProdutosService) {}

  @Get()
  @Requer('produtos.gerenciar', 'estadias.operar')
  listar(@Usuario() u: UsuarioToken, @Query('inativos') inativos?: string, @Query('busca') busca?: string) {
    return this.service.listar(u.empresaId, { inativos: inativos === 'true', busca });
  }

  @Post()
  @Requer('produtos.gerenciar')
  criar(@Usuario() u: UsuarioToken, @Body() dto: CriarProdutoDto) {
    return this.service.criar(u.empresaId, dto);
  }

  @Patch(':id')
  @Requer('produtos.gerenciar')
  atualizar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AtualizarProdutoDto) {
    return this.service.atualizar(u.empresaId, id, dto);
  }

  @Delete(':id')
  @Requer('produtos.gerenciar')
  desativar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.desativar(u.empresaId, id);
  }
}
