import {
  Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query,
} from '@nestjs/common';
import { UnidadesService } from './unidades.service';
import {
  AtualizarUnidadeDto, CriarUnidadeDto, CriarUnidadesLoteDto, MudarStatusDto,
} from './dto/unidades.dto';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

@Controller('unidades')
export class UnidadesController {
  constructor(private readonly service: UnidadesService) {}

  @Get()
  listar(@Usuario() u: UsuarioToken, @Query('ambienteId') ambienteId?: string) {
    return this.service.listar(u, ambienteId);
  }

  @Get(':id')
  buscar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.buscar(u, id);
  }

  @Get(':id/historico')
  historico(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Query('limite') limite?: string) {
    return this.service.historico(u, id, limite ? Number(limite) : 50);
  }

  @Post()
  @Requer('unidades.gerenciar')
  criar(@Usuario() u: UsuarioToken, @Body() dto: CriarUnidadeDto) {
    return this.service.criar(u, dto);
  }

  @Post('lote')
  @Requer('unidades.gerenciar')
  criarEmLote(@Usuario() u: UsuarioToken, @Body() dto: CriarUnidadesLoteDto) {
    return this.service.criarEmLote(u, dto);
  }

  @Patch(':id')
  @Requer('unidades.gerenciar')
  atualizar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AtualizarUnidadeDto) {
    return this.service.atualizar(u, id, dto);
  }

  /** Permissões conferidas dentro do service (status, bloquear, desbloquear). */
  @Patch(':id/status')
  mudarStatus(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MudarStatusDto) {
    return this.service.mudarStatus(u, id, dto);
  }

  @Delete(':id')
  @Requer('unidades.gerenciar')
  desativar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.desativar(u, id);
  }
}
