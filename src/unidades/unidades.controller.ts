import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query,
} from '@nestjs/common';
import { UnidadesService } from './unidades.service';
import {
  AtualizarUnidadeDto, CriarUnidadeDto, CriarUnidadesLoteDto, MoverUnidadesDto, MudarStatusDto, ResponsavelDto, TempoExtraDto,
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

  /** desempenho das camareiras (tempo de cada limpeza, extras, dentro da meta) */
  @Get('limpezas/desempenho')
  @Requer('governanca.operar', 'relatorios.ver', 'vistorias.relatorio')
  desempenho(@Usuario() u: UsuarioToken, @Query('de') de?: string, @Query('ate') ate?: string) {
    const d8 = (x?: string) => (x && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : undefined);
    const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    return this.service.desempenhoLimpeza(u, d8(de) ?? `${hoje.slice(0, 7)}-01`, d8(ate) ?? hoje);
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

  /** Governança: +10 min para a camareira (sem tirar da limpeza). */
  @Patch(':id/mais-tempo')
  @Requer('unidades.status', 'governanca.operar')
  maisTempo(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TempoExtraDto) {
    return this.service.maisTempo(u, id, dto.minutos);
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
