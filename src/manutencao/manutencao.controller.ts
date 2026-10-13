import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ManutencaoService } from './manutencao.service';
import { ChamadoManutencaoDto, ConfigManutencaoDto } from './manutencao.dto';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

@Controller('manutencao')
export class ManutencaoController {
  constructor(private readonly service: ManutencaoService) {}

  @Get('config') @Requer('empresa.editar', 'unidades.bloquear', 'governanca.operar', 'painel.ver')
  config(@Usuario() u: UsuarioToken) { return this.service.config(u); }

  @Put('config') @Requer('empresa.editar')
  salvar(@Usuario() u: UsuarioToken, @Body() dto: ConfigManutencaoDto) { return this.service.salvarConfig(u, dto); }

  @Get('info') @Requer('empresa.editar', 'unidades.bloquear', 'governanca.operar')
  info(@Usuario() u: UsuarioToken) { return this.service.info(u); }

  @Get('chamados') @Requer('empresa.editar', 'unidades.bloquear', 'governanca.operar', 'relatorios.ver')
  listar(@Usuario() u: UsuarioToken, @Query('status') status?: string) { return this.service.listar(u, { status }); }

  @Post('chamados') @Requer('unidades.bloquear', 'governanca.operar', 'empresa.editar')
  abrir(@Usuario() u: UsuarioToken, @Body() dto: ChamadoManutencaoDto) { return this.service.abrir(u, dto); }

  @Post('chamados/:id/reenviar') @HttpCode(200) @Requer('unidades.bloquear', 'governanca.operar', 'empresa.editar')
  reenviar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.reenviar(u, id); }

  @Get('avisos') @Requer('painel.ver')
  avisos(@Usuario() u: UsuarioToken, @Query('ambienteId') ambienteId?: string) { return this.service.avisos(u, ambienteId); }

  @Post('chamados/:id/visto') @HttpCode(200) @Requer('painel.ver')
  visto(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.marcarVisto(u, id); }
}
