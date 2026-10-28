import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { NotasService } from './notas.service';
import { DesfazerNotaDto, MarcarNotasDto } from './estadias.dto';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

@Controller('notas')
export class NotasController {
  constructor(private readonly service: NotasService) {}

  /** ?status=pendente|emitida&de=AAAA-MM-DD&ate=AAAA-MM-DD */
  @Get()
  @Requer('estadias.operar', 'notas.gerenciar')
  listar(@Usuario() u: UsuarioToken, @Query('status') status?: string, @Query('de') de?: string, @Query('ate') ate?: string, @Query('ambienteId') ambienteId?: string,
    @Query('forma') forma?: string) {
    return this.service.listar(u, { status, de, ate, ambienteId, forma });
  }

  /** últimas contas fechadas de uma suíte/quarto com as notas (a recepção emite depois sem abrir Notas fiscais) */
  @Get('unidade/:unidadeId')
  @Requer('estadias.operar', 'notas.gerenciar')
  daUnidade(@Usuario() u: UsuarioToken, @Param('unidadeId', ParseUUIDPipe) unidadeId: string, @Query('limite') limite?: string) {
    return this.service.daUnidade(u, unidadeId, Number(limite) || 3);
  }

  @Get('config')
  @Requer('estadias.operar', 'notas.gerenciar')
  config(@Usuario() u: UsuarioToken) {
    return this.service.config(u);
  }

  @Put('config')
  @Requer('notas.gerenciar')
  salvarConfig(@Usuario() u: UsuarioToken, @Body() corpo: { hospedagem?: unknown }) {
    return this.service.salvarConfig(u, corpo);
  }

  @Post('emitidas')
  @HttpCode(200)
  @Requer('estadias.operar', 'notas.gerenciar')
  marcar(@Usuario() u: UsuarioToken, @Body() dto: MarcarNotasDto) {
    return this.service.marcarEmitidas(u, dto);
  }

  @Post(':id/desfazer')
  @HttpCode(200)
  @Requer('notas.gerenciar')
  desfazer(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DesfazerNotaDto) {
    return this.service.desfazer(u, id, dto);
  }
}
