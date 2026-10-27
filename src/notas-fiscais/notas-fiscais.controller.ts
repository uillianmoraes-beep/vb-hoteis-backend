import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';
import { NotasFiscaisService } from './notas-fiscais.service';
import { CancelarNotaDto, CartaCorrecaoDto, EmissorDto, EmitirContaDto, EmitirDevolucaoDto, EmitirNfeDto } from './notas-fiscais.dto';

/** Notas emitidas pelo sistema (Focus NFe): NFC-e, NF-e, NFS-e e devolução. */
@Controller('notas-fiscais')
export class NotasFiscaisController {
  constructor(private readonly service: NotasFiscaisService) {}

  /** emissor de cada CNPJ (os tokens aparecem só com o final) */
  @Get('emissores')
  @Requer('notas.gerenciar')
  emissores(@Usuario() u: UsuarioToken) {
    return this.service.emissores(u);
  }

  @Put('emissores/:cnpj')
  @Requer('notas.gerenciar')
  salvarEmissor(@Usuario() u: UsuarioToken, @Param('cnpj') cnpj: string, @Body() dto: EmissorDto) {
    return this.service.salvarEmissor(u, cnpj, dto);
  }

  @Post('emissores/:cnpj/testar')
  @HttpCode(200)
  @Requer('notas.gerenciar')
  testar(@Usuario() u: UsuarioToken, @Param('cnpj') cnpj: string) {
    return this.service.testarEmissor(u, cnpj);
  }

  /** a recepção só precisa saber se já dá para emitir pelo sistema */
  @Get('ligado')
  @Requer('notas.gerenciar', 'estadias.operar')
  ligado(@Usuario() u: UsuarioToken) {
    return this.service.ligado(u);
  }

  /** ?de&ate&tipo=nfce|nfe|nfse|devolucao&status=…&estadiaId=… */
  @Get()
  @Requer('notas.gerenciar', 'estadias.operar')
  listar(@Usuario() u: UsuarioToken, @Query('de') de?: string, @Query('ate') ate?: string, @Query('tipo') tipo?: string,
    @Query('status') status?: string, @Query('estadiaId') estadiaId?: string) {
    return this.service.listar(u, { de, ate, tipo, status, estadiaId });
  }

  @Get(':id')
  @Requer('notas.gerenciar', 'estadias.operar')
  ver(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.ver(u, id);
  }

  /** notas de uma conta fechada (consumo na NFC-e, hospedagem na NFS-e) */
  @Post('conta/:estadiaId')
  @HttpCode(200)
  @Requer('notas.gerenciar', 'estadias.operar')
  emitirConta(@Usuario() u: UsuarioToken, @Param('estadiaId', ParseUUIDPipe) estadiaId: string, @Body() dto: EmitirContaDto) {
    return this.service.emitirConta(u, estadiaId, dto);
  }

  @Post('nfe')
  @HttpCode(200)
  @Requer('notas.gerenciar')
  emitirNfe(@Usuario() u: UsuarioToken, @Body() dto: EmitirNfeDto) {
    return this.service.emitirNfe(u, dto);
  }

  @Post('devolucao')
  @HttpCode(200)
  @Requer('notas.gerenciar')
  emitirDevolucao(@Usuario() u: UsuarioToken, @Body() dto: EmitirDevolucaoDto) {
    return this.service.emitirDevolucao(u, dto);
  }

  @Post(':id/atualizar')
  @HttpCode(200)
  @Requer('notas.gerenciar', 'estadias.operar')
  atualizar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.atualizar(u, id);
  }

  /** quem não tem "notas.cancelar" pede a liberação do gerente */
  @Post(':id/cancelar')
  @HttpCode(200)
  @Requer('notas.gerenciar', 'notas.cancelar', 'estadias.operar')
  cancelar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelarNotaDto) {
    return this.service.cancelar(u, id, dto);
  }

  @Post(':id/carta-correcao')
  @HttpCode(200)
  @Requer('notas.gerenciar')
  cartaCorrecao(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CartaCorrecaoDto) {
    return this.service.cartaCorrecao(u, id, dto);
  }
}
