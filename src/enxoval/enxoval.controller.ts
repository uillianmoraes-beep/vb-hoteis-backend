import { Body, Controller, Delete, Get, HttpCode, Ip, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { EnxovalService } from './enxoval.service';
import { AssinarRelatorioDto, KitDto, MovimentoEnxovalDto, NovoRelatorioDto, ResponsavelEnxovalDto, TipoEnxovalDto, PrecoKgDto } from './enxoval.dto';
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

  @Get('lotes') @Requer('enxoval.gerenciar', 'governanca.operar')
  lotes(@Usuario() u: UsuarioToken) { return this.service.lotes(u); }

  @Get('lotes/:chave') @Requer('enxoval.gerenciar', 'governanca.operar', 'enxoval.aprovar')
  lote(@Usuario() u: UsuarioToken, @Param('chave') chave: string) { return this.service.lote(u, chave.slice(0, 40)); }

  @Get('movimentos/:id/fotos') @Requer('enxoval.gerenciar', 'governanca.operar', 'enxoval.aprovar')
  fotos(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.fotosMovimento(u, id); }

  /** custo da lavanderia por locação: ?de=AAAA-MM-DD&ate=AAAA-MM-DD */
  @Get('custo-lavanderia') @Requer('enxoval.gerenciar', 'enxoval.aprovar', 'relatorios.ver')
  custo(@Usuario() u: UsuarioToken, @Query('de') de?: string, @Query('ate') ate?: string) {
    const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    const ok = (d?: string) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
    const a = ok(ate) ? ate! : hoje;
    const d = ok(de) ? de! : new Date(Date.parse(`${a}T12:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
    return this.service.custoLavanderia(u, d, a);
  }

  @Put('config/preco-kg') @Requer('enxoval.gerenciar')
  precoKg(@Usuario() u: UsuarioToken, @Body() dto: PrecoKgDto) { return this.service.salvarPrecoKg(u, dto.precoKg); }

  @Get('config') @Requer('enxoval.gerenciar', 'enxoval.aprovar')
  config(@Usuario() u: UsuarioToken) { return this.service.config(u); }

  @Put('config/responsavel') @Requer('enxoval.aprovar', 'usuarios.gerenciar')
  responsavel(@Usuario() u: UsuarioToken, @Body() dto: ResponsavelEnxovalDto) { return this.service.definirResponsavel(u, dto.usuarioId); }

  @Get('relatorios') @Requer('enxoval.gerenciar', 'enxoval.aprovar')
  relatorios(@Usuario() u: UsuarioToken) { return this.service.relatorios(u); }

  @Post('relatorios') @Requer('enxoval.gerenciar', 'enxoval.aprovar')
  criarRelatorio(@Usuario() u: UsuarioToken, @Body() dto: NovoRelatorioDto) { return this.service.criarRelatorio(u, dto); }

  @Get('relatorios/:id') @Requer('enxoval.gerenciar', 'enxoval.aprovar')
  relatorio(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.relatorio(u, id); }

  @Delete('relatorios/:id') @Requer('enxoval.gerenciar', 'enxoval.aprovar')
  excluir(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.excluirRascunho(u, id); }

  @Post('relatorios/:id/assinar') @HttpCode(200) @Requer('enxoval.gerenciar', 'enxoval.aprovar')
  assinar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AssinarRelatorioDto, @Ip() ip: string) { return this.service.assinar(u, id, dto, ip ?? ''); }
}
