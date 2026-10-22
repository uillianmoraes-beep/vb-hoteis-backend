import { Module } from '@nestjs/common';
import { PlanoContasController, PlanoContasService } from './plano-contas';
import { ContasBancariasController, ContasBancariasService } from './contas-bancarias';
import { RelatoriosFinanceirosController, RelatoriosFinanceirosService } from './relatorios';
import { VendasTerceirosController, VendasTerceirosService } from './vendas-terceiros';

/** Financeiro: plano de contas, contas bancárias e maquininhas, relatórios do dono (DRE, fluxo de caixa, recebíveis). */
@Module({
  providers: [PlanoContasService, ContasBancariasService, RelatoriosFinanceirosService, VendasTerceirosService],
  controllers: [PlanoContasController, ContasBancariasController, RelatoriosFinanceirosController, VendasTerceirosController],
  exports: [PlanoContasService, ContasBancariasService],
})
export class FinanceiroModule {}
