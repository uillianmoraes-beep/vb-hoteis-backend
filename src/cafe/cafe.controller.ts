import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CafeService } from './cafe.service';
import { CafeItemDto, CriarListaDto, FecharListaDto } from './cafe.dto';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

@Controller('cafe')
export class CafeController {
  constructor(private readonly service: CafeService) {}

  @Get('itens') @Requer('cafe.gerenciar')
  itens(@Usuario() u: UsuarioToken, @Query('todos') todos?: string) { return this.service.itens(u, todos === '1'); }

  @Post('itens') @Requer('cafe.gerenciar')
  criarItem(@Usuario() u: UsuarioToken, @Body() dto: CafeItemDto) { return this.service.criarItem(u, dto); }

  @Post('itens/remover-repetidos') @HttpCode(200) @Requer('cafe.gerenciar')
  removerRepetidos(@Usuario() u: UsuarioToken) { return this.service.removerRepetidos(u); }

  @Delete('itens/:id') @Requer('cafe.gerenciar')
  excluirItem(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.excluirItem(u, id); }

  @Patch('itens/:id') @Requer('cafe.gerenciar')
  atualizarItem(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CafeItemDto) { return this.service.atualizarItem(u, id, dto); }

  @Get('previsao') @Requer('cafe.gerenciar', 'reservas.gerenciar')
  previsao(@Usuario() u: UsuarioToken, @Query('data') data?: string, @Query('ajuste') ajuste?: string) {
    const a = Number(ajuste);
    return this.service.previsao(u, data, Number.isFinite(a) ? Math.max(-500, Math.min(500, Math.trunc(a))) : 0);
  }

  @Get('listas') @Requer('cafe.gerenciar')
  listas(@Usuario() u: UsuarioToken, @Query('de') de?: string, @Query('ate') ate?: string) { return this.service.listas(u, de, ate); }

  @Post('listas') @Requer('cafe.gerenciar')
  criarLista(@Usuario() u: UsuarioToken, @Body() dto: CriarListaDto) { return this.service.criarLista(u, dto); }

  @Get('listas/:id') @Requer('cafe.gerenciar')
  lista(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.lista(u, id); }

  @Post('listas/:id/fechar') @HttpCode(200) @Requer('cafe.gerenciar')
  fechar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: FecharListaDto) { return this.service.fechar(u, id, dto); }

  @Post('listas/:id/reabrir') @HttpCode(200) @Requer('cafe.gerenciar')
  reabrir(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.reabrir(u, id); }

  @Get('relatorio') @Requer('cafe.gerenciar')
  relatorio(@Usuario() u: UsuarioToken, @Query('de') de?: string, @Query('ate') ate?: string) { return this.service.relatorio(u, de, ate); }
}
