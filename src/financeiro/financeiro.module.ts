import { Module } from '@nestjs/common';
import { PlanoContasController, PlanoContasService } from './plano-contas';
import { ContasBancariasController, ContasBancariasService } from './contas-bancarias';
import { RelatoriosFinanceirosController, RelatoriosFinanceirosService } from './relatorios';
import { VendasTerceirosController, VendasTerceirosService } from './vendas-terceiros';
import { ReservaController, ReservaService } from './reserva';
import { BensController, BensService } from './bens';

/** Financeiro: plano de contas, contas bancárias e maquininhas, relatórios do dono (DRE, fluxo de caixa, recebíveis). */
@Module({
  providers: [PlanoContasService, ContasBancariasService, RelatoriosFinanceirosService, VendasTerceirosService, ReservaService, BensService],
  controllers: [PlanoContasController, ContasBancariasController, RelatoriosFinanceirosController, VendasTerceirosController, ReservaController, BensController],
  exports: [PlanoContasService, ContasBancariasService],
})
export class FinanceiroModule {}
