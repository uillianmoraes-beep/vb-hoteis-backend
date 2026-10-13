import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ReservasService } from './reservas.service';
import { CancelarReservaDto, CheckinReservaDto, ReservaDto } from './reservas.dto';
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

  @Post(':id/checkin')
  @HttpCode(200)
  @Requer('reservas.gerenciar', 'estadias.operar', 'estadias.entrada')
  checkin(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CheckinReservaDto) {
    return this.service.checkin(u, id, dto);
  }
}
