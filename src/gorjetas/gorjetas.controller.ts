import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { GorjetasService, type ConfigGorjeta } from './gorjetas.service';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

@Controller('gorjetas')
export class GorjetasController {
  constructor(private readonly service: GorjetasService) {}

  @Get('beneficiarios')
  @Requer('estadias.operar', 'gorjetas.gerenciar')
  beneficiarios(@Usuario() u: UsuarioToken) {
    return this.service.beneficiarios(u);
  }

  @Get()
  @Requer('gorjetas.gerenciar')
  relatorio(@Usuario() u: UsuarioToken, @Query('de') de?: string, @Query('ate') ate?: string) {
    return this.service.relatorio(u, { de, ate });
  }

  @Put('config')
  @Requer('gorjetas.gerenciar')
  config(@Usuario() u: UsuarioToken, @Body() dto: Partial<ConfigGorjeta>) {
    return this.service.salvarConfig(u, dto);
  }

  @Post('repasse/:chave')
  @HttpCode(200)
  @Requer('gorjetas.gerenciar')
  repassar(@Usuario() u: UsuarioToken, @Param('chave') chave: string, @Body() corpo: { forma?: string }) {
    return this.service.repassar(u, decodeURIComponent(chave), corpo?.forma ?? 'dinheiro');
  }
}
