import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ReservasService } from './reservas.service';
import { CancelarReservaDto, CheckinReservaDto, GrupoReservaDto, ReservaDto } from './reservas.dto';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

@Controller('reservas')
export class ReservasController {
  constructor(private readonly service: ReservasService) {}

  @Get()
  @Requer('reservas.gerenciar', 'estadias.operar', 'estadias.entrada')
  listar(@Usuario() u: UsuarioToken, @Query('de') de?: string, @Query('ate') ate?: string, @Query('busca') busca?: string) {
    return this.service.listar(u, { de, ate, busca });
  }

  @Get('painel')
  @Requer('painel.ver', 'reservas.gerenciar', 'estadias.operar', 'estadias.entrada')
  painel(@Usuario() u: UsuarioToken, @Query('ambienteId') ambienteId?: string) {
    return this.service.painel(u, ambienteId);
  }

  @Post('vistas/:unidadeId')
  @HttpCode(200)
  @Requer('painel.ver', 'reservas.gerenciar', 'estadias.operar', 'estadias.entrada')
  vistas(@Usuario() u: UsuarioToken, @Param('unidadeId', ParseUUIDPipe) unidadeId: string) {
    return this.service.marcarVistas(u, unidadeId);
  }

  @Get('grupos/:id')
  @Requer('reservas.gerenciar', 'estadias.operar', 'estadias.entrada')
  verGrupo(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.grupos.ver(u, id);
  }

  @Post('grupos')
  @Requer('reservas.gerenciar', 'estadias.operar')
  criarGrupo(@Usuario() u: UsuarioToken, @Body() dto: GrupoReservaDto) {
    return this.service.grupos.criar(u, dto);
  }

  @Patch('grupos/:id')
  @Requer('reservas.gerenciar', 'estadias.operar')
  atualizarGrupo(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: GrupoReservaDto) {
    return this.service.grupos.atualizar(u, id, dto);
  }

  @Post('grupos/:id/cancelar')
  @HttpCode(200)
  @Requer('reservas.gerenciar', 'estadias.operar')
  cancelarGrupo(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.grupos.cancelar(u, id);
  }

  @Post()
  @Requer('reservas.gerenciar', 'estadias.operar')
  criar(@Usuario() u: UsuarioToken, @Body() dto: ReservaDto) {
    return this.service.criar(u, dto);
  }

  @Patch(':id')
  @Requer('reservas.gerenciar', 'estadias.operar')
  atualizar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReservaDto) {
    return this.service.atualizar(u, id, dto);
  }

  @Post(':id/cancelar')
  @HttpCode(200)
  @Requer('reservas.gerenciar', 'estadias.operar')
  cancelar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelarReservaDto) {
    return this.service.cancelar(u, id, dto);
  }

  @Post(':id/pre-checkin')
  @HttpCode(200)
  @Requer('reservas.gerenciar', 'estadias.operar', 'estadias.entrada')
  preCheckin(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.preCheckin(u, id);
  }

  @Post(':id/checkin')
  @HttpCode(200)
  @Requer('reservas.gerenciar', 'estadias.operar', 'estadias.entrada')
  checkin(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CheckinReservaDto) {
    return this.service.checkin(u, id, dto);
  }
}
