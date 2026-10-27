import { Controller, Get, Query } from '@nestjs/common';
import { RelatoriosService } from './relatorios.service';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

@Controller('relatorios')
export class RelatoriosController {
  constructor(private readonly service: RelatoriosService) {}

  @Get('dashboard')
  @Requer('relatorios.ver')
  dashboard(@Usuario() u: UsuarioToken, @Query('dias') dias?: string, @Query('ambienteId') ambienteId?: string) {
    return this.service.dashboard(u, { dias: Number(dias) || 30, ambienteId });
  }

  /** Vendas e usos do período: totais, por forma de pagamento, por categoria e a lista de contas fechadas. */
  @Get('vendas')
  @Requer('relatorios.ver')
  vendas(@Usuario() u: UsuarioToken, @Query('de') de?: string, @Query('ate') ate?: string, @Query('ambienteId') ambienteId?: string, @Query('forma') forma?: string) {
    return this.service.vendas(u, { de, ate, ambienteId, forma });
  }

  /** Dias e horas mais movimentados, suítes mais e menos alugadas, produtos mais vendidos e os sem venda no período. */
  /** ocupação, giro, diária média e RevPAR por categoria de suíte (com o período anterior) */
  @Get('ocupacao-categoria')
  @Requer('relatorios.ver')
  ocupacaoCategoria(@Usuario() u: UsuarioToken, @Query('de') de?: string, @Query('ate') ate?: string, @Query('ambienteId') ambienteId?: string) {
    return this.service.ocupacaoCategoria(u, { de, ate, ambienteId });
  }

  @Get('desempenho')
  @Requer('relatorios.ver')
  desempenho(@Usuario() u: UsuarioToken, @Query('de') de?: string, @Query('ate') ate?: string, @Query('ambienteId') ambienteId?: string) {
    return this.service.desempenho(u, { de, ate, ambienteId });
  }
}
