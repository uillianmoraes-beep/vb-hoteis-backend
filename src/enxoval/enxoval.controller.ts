import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { EnxovalService } from './enxoval.service';
import { KitDto, MovimentoEnxovalDto, TipoEnxovalDto } from './enxoval.dto';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

@Controller('enxoval')
export class EnxovalController {
  constructor(private readonly service: EnxovalService) {}

  @Get()
  @Requer('enxoval.gerenciar', 'governanca.operar')
  painel(@Usuario() u: UsuarioToken) {
    return this.service.painel(u);
  }

  @Get('historico')
  @Requer('enxoval.gerenciar', 'governanca.operar')
  historico(@Usuario() u: UsuarioToken, @Query('dias') dias?: string) {
    return this.service.historico(u, Math.min(365, Math.max(1, Number(dias) || 30)));
  }

  @Post('tipos')
  @Requer('enxoval.gerenciar')
  criarTipo(@Usuario() u: UsuarioToken, @Body() dto: TipoEnxovalDto) {
    return this.service.criarTipo(u, dto);
  }

  @Patch('tipos/:id')
  @Requer('enxoval.gerenciar')
  editarTipo(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TipoEnxovalDto) {
    return this.service.editarTipo(u, id, dto);
  }

  @Post('movimentos')
  @Requer('enxoval.gerenciar', 'governanca.operar')
  movimentar(@Usuario() u: UsuarioToken, @Body() dto: MovimentoEnxovalDto) {
    return this.service.movimentar(u, dto);
  }

  @Put('kits')
  @Requer('enxoval.gerenciar')
  kit(@Usuario() u: UsuarioToken, @Body() dto: KitDto) {
    return this.service.salvarKit(u, dto);
  }
}
