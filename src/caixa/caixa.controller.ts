import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CaixaService } from './caixa.service';
import { AbrirTurnoDto, FecharTurnoDto, LancamentoAdmDto, MovimentoDto } from './caixa.dto';
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
  adm(@Usuario() u: UsuarioToken, @Query('de') de?: string, @Query('ate') ate?: string) {
    return this.service.adm(u, { de, ate });
  }

  @Post('adm')
  @Requer('caixa.adm')
  lancarAdm(@Usuario() u: UsuarioToken, @Body() dto: LancamentoAdmDto) {
    return this.service.lancarAdm(u, dto);
  }
}
