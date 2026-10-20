import { Controller, Get, Query } from '@nestjs/common';
import { NcmService } from './ncm.service';
import { Requer } from '../common/decorators/requer.decorator';

/** Buscar tributação (NCM) pelo nome do produto: tabela oficial + sugestão por IA. */
@Controller('fiscal/ncm')
export class NcmController {
  constructor(private readonly service: NcmService) {}

  @Get()
  @Requer('produtos.gerenciar', 'notas.gerenciar')
  buscar(@Query('q') q = '') {
    return this.service.buscar(q);
  }
}
