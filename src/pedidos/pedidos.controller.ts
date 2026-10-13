import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { PedidosService } from './pedidos.service';
import { CardapioDto, NovoPedidoDto, RecusarPedidoDto } from './pedidos.dto';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { Publico } from '../common/decorators/publico.decorator';
import { UsuarioToken } from '../common/permissoes';

@Controller()
export class PedidosController {
  constructor(private readonly service: PedidosService) {}

  @Publico() @Get('publico/pedido/:token')
  publico(@Param('token') token: string) { return this.service.publico(token.slice(0, 24)); }

  @Publico() @Post('publico/pedido/:token')
  pedir(@Param('token') token: string, @Body() dto: NovoPedidoDto) { return this.service.pedir(token.slice(0, 24), dto); }

  @Get('pedidos/pendentes') @Requer('painel.ver', 'estadias.operar', 'estadias.entrada')
  pendentes(@Usuario() u: UsuarioToken, @Query('ambienteId') ambienteId?: string) { return this.service.pendentes(u, ambienteId); }

  @Get('pedidos/historico') @Requer('estadias.operar', 'produtos.gerenciar')
  historico(@Usuario() u: UsuarioToken, @Query('dias') dias?: string) { return this.service.historico(u, Number(dias) || 7); }

  @Post('pedidos/:id/aceitar') @HttpCode(200) @Requer('estadias.operar')
  aceitar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.aceitar(u, id); }

  @Post('pedidos/:id/entregue') @HttpCode(200) @Requer('estadias.operar', 'estadias.entrada')
  entregue(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.entregue(u, id); }

  @Post('pedidos/:id/recusar') @HttpCode(200) @Requer('estadias.operar')
  recusar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RecusarPedidoDto) { return this.service.recusar(u, id, dto); }

  @Get('pedidos/qrcodes') @Requer('estadias.operar', 'produtos.gerenciar', 'unidades.gerenciar')
  qrcodes(@Usuario() u: UsuarioToken, @Query('ambienteId') ambienteId?: string) { return this.service.qrcodes(u, ambienteId); }

  @Post('pedidos/qrcodes/:unidadeId/trocar') @HttpCode(200) @Requer('produtos.gerenciar', 'unidades.gerenciar')
  trocar(@Usuario() u: UsuarioToken, @Param('unidadeId', ParseUUIDPipe) id: string) { return this.service.trocarQr(u, id); }

  @Get('pedidos/cardapio') @Requer('estadias.operar', 'produtos.gerenciar')
  cardapio(@Usuario() u: UsuarioToken) { return this.service.cardapio(u); }

  @Patch('pedidos/cardapio/:produtoId') @Requer('produtos.gerenciar')
  marcar(@Usuario() u: UsuarioToken, @Param('produtoId', ParseUUIDPipe) id: string, @Body() dto: CardapioDto) { return this.service.marcarCardapio(u, id, dto.cardapio); }
}
