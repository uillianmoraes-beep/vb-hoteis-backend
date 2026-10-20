import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';
import { EmprestimoService } from './emprestimo.service';
import { DevolverDto, EmprestarDto, EmprestimoAutoDto } from './emprestimo.dto';

/** Emprestar quartos a outro ambiente (ex.: hotel → motel no fim de semana) e devolver. */
@Controller('emprestimos')
export class EmprestimoController {
  constructor(private readonly service: EmprestimoService) {}

  @Post('emprestar')
  @HttpCode(200)
  @Requer('unidades.gerenciar')
  emprestar(@Usuario() u: UsuarioToken, @Body() dto: EmprestarDto) {
    return this.service.emprestar(u.empresaId, dto.ids, dto.ambienteId, dto.categoriaId, { id: u.sub, nome: u.nome });
  }

  @Post('devolver')
  @HttpCode(200)
  @Requer('unidades.gerenciar')
  devolver(@Usuario() u: UsuarioToken, @Body() dto: DevolverDto) {
    return this.service.devolver(u.empresaId, dto.ids, { id: u.sub, nome: u.nome });
  }

  /** para a faixa do Painel (todos que veem o Painel) */
  @Get('painel/:ambienteId')
  @Requer('painel.ver')
  painel(@Usuario() u: UsuarioToken, @Param('ambienteId', ParseUUIDPipe) ambienteId: string) {
    return this.service.resumoPainel(u, ambienteId);
  }

  @Get('auto/:ambienteId')
  @Requer('unidades.gerenciar')
  lerAuto(@Usuario() u: UsuarioToken, @Param('ambienteId', ParseUUIDPipe) ambienteId: string) {
    return this.service.lerAuto(u, ambienteId);
  }

  @Put('auto/:ambienteId')
  @Requer('unidades.gerenciar')
  salvarAuto(@Usuario() u: UsuarioToken, @Param('ambienteId', ParseUUIDPipe) ambienteId: string, @Body() dto: EmprestimoAutoDto) {
    return this.service.salvarAuto(u, ambienteId, dto);
  }
}
