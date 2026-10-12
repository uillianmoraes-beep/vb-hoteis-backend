import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { EstadiasService } from './estadias.service';
import {
  AbrirEstadiaDto, AdiantamentoDto, AtualizarEstadiaDto, CancelarEstadiaDto, CorrigirEstadiaDto, EstornarItemDto, FecharEstadiaDto,
  LancarItemDto, TransferirDto, TrocarCobrancaDto,
} from './estadias.dto';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

@Controller('estadias')
export class EstadiasController {
  constructor(private readonly service: EstadiasService) {}

  @Post()
  @Requer('estadias.entrada', 'estadias.operar')
  abrir(@Usuario() u: UsuarioToken, @Body() dto: AbrirEstadiaDto) {
    return this.service.abrir(u, dto);
  }

  @Get(':id')
  @Requer('painel.ver')
  detalhe(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.detalhe(u, id);
  }

  @Patch(':id')
  @Requer('estadias.operar')
  atualizar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AtualizarEstadiaDto) {
    return this.service.atualizar(u, id, dto);
  }

  @Post(':id/itens')
  @Requer('estadias.operar')
  lancar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LancarItemDto) {
    return this.service.lancarItem(u, id, dto);
  }

  @Post(':id/itens/:itemId/estornar')
  @HttpCode(200)
  @Requer('estadias.estornar')
  estornar(
    @Usuario() u: UsuarioToken,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: EstornarItemDto,
  ) {
    return this.service.estornarItem(u, id, itemId, dto);
  }

  @Post(':id/adiantamento')
  @HttpCode(200)
  @Requer('estadias.entrada', 'estadias.operar')
  adiantar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AdiantamentoDto) {
    return this.service.adiantamento(u, id, dto);
  }

  @Post(':id/entregar-conta')
  @HttpCode(200)
  @Requer('estadias.operar')
  entregar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.entregarConta(u, id);
  }

  @Post(':id/voltar')
  @HttpCode(200)
  @Requer('estadias.operar')
  voltar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.voltarAContar(u, id);
  }

  @Post(':id/transferir')
  @HttpCode(200)
  @Requer('estadias.operar')
  transferir(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TransferirDto) {
    return this.service.transferir(u, id, dto);
  }

  @Post(':id/cobranca')
  @HttpCode(200)
  @Requer('estadias.operar')
  cobranca(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TrocarCobrancaDto) {
    return this.service.trocarCobranca(u, id, dto);
  }

  @Post(':id/corrigir')
  @HttpCode(200)
  @Requer('estadias.corrigir')
  corrigir(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CorrigirEstadiaDto) {
    return this.service.corrigir(u, id, dto);
  }

  @Post(':id/fechar')
  @HttpCode(200)
  @Requer('estadias.operar')
  fechar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: FecharEstadiaDto) {
    return this.service.fechar(u, id, dto);
  }

  @Post(':id/cancelar')
  @HttpCode(200)
  @Requer('estadias.cancelar')
  cancelar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelarEstadiaDto) {
    return this.service.cancelar(u, id, dto);
  }
}
