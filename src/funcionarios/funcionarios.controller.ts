import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { FuncionariosService } from './funcionarios.service';
import { ConfigRevisaoDto, FuncionarioDto, LancamentoFuncDto, RevisaoDto } from './funcionarios.dto';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken, temPermissao } from '../common/permissoes';

@Controller('funcionarios')
export class FuncionariosController {
  constructor(private readonly service: FuncionariosService) {}

  /** lista (governança usa para escolher a camareira: ?funcao=camareira&ambienteId=) */
  @Get()
  @Requer('funcionarios.gerenciar', 'governanca.operar', 'unidades.status', 'estadias.operar', 'contador.acessar', 'ferramentas.gerenciar')
  listar(@Usuario() u: UsuarioToken, @Query('funcao') funcao?: string, @Query('ambienteId') ambienteId?: string, @Query('todos') todos?: string) {
    return this.service.listar(u, { funcao, ambienteId, todos: todos === '1' && temPermissao(u, 'funcionarios.gerenciar') });
  }

  @Get('revisao/itens')
  @Requer('governanca.operar', 'unidades.status', 'funcionarios.gerenciar')
  itensRevisao(@Usuario() u: UsuarioToken) {
    return this.service.itensRevisao(u);
  }

  @Put('revisao/itens')
  @Requer('funcionarios.gerenciar')
  salvarItensRevisao(@Usuario() u: UsuarioToken, @Body() dto: ConfigRevisaoDto) {
    return this.service.salvarItensRevisao(u, dto);
  }

  @Post('revisao')
  @Requer('governanca.operar', 'unidades.status')
  revisar(@Usuario() u: UsuarioToken, @Body() dto: RevisaoDto) {
    return this.service.revisar(u, dto);
  }

  @Get('revisao/relatorio')
  @Requer('governanca.operar', 'relatorios.ver', 'funcionarios.gerenciar')
  relatorioRevisoes(@Usuario() u: UsuarioToken, @Query('de') de?: string, @Query('ate') ate?: string) {
    return this.service.relatorioRevisoes(u, { de, ate });
  }

  @Get(':id')
  @Requer('funcionarios.gerenciar')
  um(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.foto(u, id);
  }

  @Post()
  @Requer('funcionarios.gerenciar')
  criar(@Usuario() u: UsuarioToken, @Body() dto: FuncionarioDto) {
    return this.service.criar(u, dto);
  }

  @Patch(':id')
  @Requer('funcionarios.gerenciar')
  atualizar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: FuncionarioDto) {
    return this.service.atualizar(u, id, dto);
  }

  @Get(':id/ficha')
  @Requer('funcionarios.financeiro')
  ficha(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Query('de') de?: string, @Query('ate') ate?: string) {
    return this.service.ficha(u, id, { de, ate });
  }

  @Post(':id/lancamentos')
  @Requer('funcionarios.financeiro')
  lancar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LancamentoFuncDto) {
    return this.service.lancar(u, id, dto);
  }

  @Delete(':id/lancamentos/:lancId')
  @Requer('funcionarios.financeiro')
  removerLancamento(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Param('lancId', ParseUUIDPipe) lancId: string) {
    return this.service.removerLancamento(u, id, lancId);
  }
}
