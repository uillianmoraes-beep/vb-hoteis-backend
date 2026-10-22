import { Module } from '@nestjs/common';
import { PlanoContasController, PlanoContasService } from './plano-contas';
import { ContasBancariasController, ContasBancariasService } from './contas-bancarias';
import { RelatoriosFinanceirosController, RelatoriosFinanceirosService } from './relatorios';
import { VendasTerceirosController, VendasTerceirosService } from './vendas-terceiros';
import { ReservaController, ReservaService } from './reserva';

/** Financeiro: plano de contas, contas bancárias e maquininhas, relatórios do dono (DRE, fluxo de caixa, recebíveis). */
@Module({
  providers: [PlanoContasService, ContasBancariasService, RelatoriosFinanceirosService, VendasTerceirosService, ReservaService],
  controllers: [PlanoContasController, ContasBancariasController, RelatoriosFinanceirosController, VendasTerceirosController, ReservaController],
  exports: [PlanoContasService, ContasBancariasService],
})
export class FinanceiroModule {}
