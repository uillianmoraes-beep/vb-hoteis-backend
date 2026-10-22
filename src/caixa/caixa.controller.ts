import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { CaixaService } from './caixa.service';
import { AbrirTurnoDto, ConfigCaixaDto, FecharTurnoDto, LancamentoAdmDto, MovimentoDto } from './caixa.dto';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

@Controller('caixa')
export class CaixaController {
  constructor(private readonly service: CaixaService) {}

  @Get('atual')
  @Requer('caixa.principal', 'caixa.relatorios')
  atual(@Usuario() u: UsuarioToken, @Query('ambienteId', ParseUUIDPipe) ambienteId: string) {
    return this.service.atual(u, ambienteId);
  }

  @Get('config')
  @Requer('caixa.principal', 'caixa.adm', 'caixa.relatorios')
  config(@Usuario() u: UsuarioToken) {
    return this.service.config(u);
  }

  /** recepção: maquininhas e se o código do comprovante é obrigatório */
  @Get('comprovante')
  configComprovante(@Usuario() u: UsuarioToken) {
    return this.service.configComprovante(u);
  }

  @Put('config')
  @Requer('caixa.adm')
  salvarConfig(@Usuario() u: UsuarioToken, @Body() dto: ConfigCaixaDto) {
    return this.service.salvarConfig(u, dto);
  }

  @Get('movimentos/:id')
  @Requer('caixa.principal', 'caixa.adm', 'caixa.relatorios')
  movimentoDetalhe(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.movimentoDetalhe(u, id);
  }

  @Post('turnos')
  @Requer('caixa.principal')
  abrir(@Usuario() u: UsuarioToken, @Body() dto: AbrirTurnoDto) {
    return this.service.abrir(u, dto);
  }

  @Post('turnos/:id/movimentos')
  @HttpCode(200)
  @Requer('caixa.principal')
  movimento(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MovimentoDto) {
    return this.service.movimento(u, id, dto);
  }

  @Post('turnos/:id/fechar')
  @HttpCode(200)
  @Requer('caixa.principal')
  fechar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: FecharTurnoDto) {
    return this.service.fechar(u, id, dto);
  }

  @Get('turnos')
  @Requer('caixa.relatorios')
  listar(@Usuario() u: UsuarioToken, @Query('de') de?: string, @Query('ate') ate?: string, @Query('ambienteId') ambienteId?: string) {
    return this.service.listar(u, { de, ate, ambienteId });
  }

  @Get('turnos/:id')
  @Requer('caixa.principal', 'caixa.relatorios')
  detalhe(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.detalhe(u, id);
  }

  @Get('adm')
  @Requer('caixa.adm')
  adm(@Usuario() u: UsuarioToken, @Query('de') de?: string, @Query('ate') ate?: string, @Query('cnpj') cnpj?: string) {
    return this.service.adm(u, { de, ate, cnpj });
  }

  @Post('adm')
  @Requer('caixa.adm')
  lancarAdm(@Usuario() u: UsuarioToken, @Body() dto: LancamentoAdmDto) {
    return this.service.lancarAdm(u, dto);
  }
}
