import { Controller, Get, Query } from '@nestjs/common';
import { RelatoriosService } from './relatorios.service';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

@Controller('relatorios')
export class RelatoriosController {
  constructor(private readonly service: RelatoriosService) {}

  /** Vendas e usos do período: totais, por forma de pagamento, por categoria e a lista de contas fechadas. */
  @Get('vendas')
  @Requer('relatorios.ver')
  vendas(@Usuario() u: UsuarioToken, @Query('de') de?: string, @Query('ate') ate?: string, @Query('ambienteId') ambienteId?: string) {
    return this.service.vendas(u, { de, ate, ambienteId });
  }
}
