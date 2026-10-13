import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query,
} from '@nestjs/common';
import { UnidadesService } from './unidades.service';
import {
  AtualizarUnidadeDto, CriarUnidadeDto, CriarUnidadesLoteDto, MoverUnidadesDto, MudarStatusDto, ResponsavelDto,
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

  @Post('mover')
  @HttpCode(200)
  @Requer('unidades.gerenciar')
  mover(@Usuario() u: UsuarioToken, @Body() dto: MoverUnidadesDto) {
    return this.service.mover(u, dto);
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

  /** Governança: quem está limpando / vistoriando a unidade. */
  @Patch(':id/responsavel')
  @Requer('unidades.status', 'governanca.operar')
  responsavel(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResponsavelDto) {
    return this.service.definirResponsavel(u, id, dto.nome);
  }

  @Delete(':id')
  @Requer('unidades.gerenciar')
  desativar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.desativar(u, id);
  }
}
