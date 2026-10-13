import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { BalcaoService } from './balcao.service';
import { DespertadorDto, VendaAvulsaDto } from './balcao.dto';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

@Controller()
export class BalcaoController {
  constructor(private readonly service: BalcaoService) {}

  @Post('vendas-avulsas')
  @Requer('estadias.operar', 'caixa.principal')
  vender(@Usuario() u: UsuarioToken, @Body() dto: VendaAvulsaDto) {
    return this.service.vender(u, dto);
  }

  @Get('vendas-avulsas')
  @Requer('estadias.operar', 'caixa.principal', 'relatorios.ver')
  listar(@Usuario() u: UsuarioToken, @Query('de') de?: string, @Query('ate') ate?: string) {
    return this.service.listarVendas(u, { de, ate });
  }

  @Get('vendas-avulsas/:id')
  @Requer('estadias.operar', 'caixa.principal', 'relatorios.ver')
  venda(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.venda(u, id);
  }

  @Get('despertadores')
  @Requer('painel.ver', 'estadias.operar')
  pendentes(@Usuario() u: UsuarioToken) {
    return this.service.pendentes(u);
  }

  @Post('despertadores')
  @Requer('estadias.operar', 'painel.ver')
  criar(@Usuario() u: UsuarioToken, @Body() dto: DespertadorDto) {
    return this.service.criarDespertador(u, dto);
  }

  @Post('despertadores/:id/feito')
  @HttpCode(200)
  @Requer('estadias.operar', 'painel.ver')
  feito(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.concluirDespertador(u, id, 'feito');
  }

  @Post('despertadores/:id/cancelar')
  @HttpCode(200)
  @Requer('estadias.operar', 'painel.ver')
  cancelar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.concluirDespertador(u, id, 'cancelado');
  }
}
