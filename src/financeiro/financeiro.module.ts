import { Module } from '@nestjs/common';
import { PlanoContasController, PlanoContasService } from './plano-contas';
import { ContasBancariasController, ContasBancariasService } from './contas-bancarias';
import { RelatoriosFinanceirosController, RelatoriosFinanceirosService } from './relatorios';

/** Financeiro: plano de contas, contas bancárias e maquininhas, relatórios do dono (DRE, fluxo de caixa, recebíveis). */
@Module({
  providers: [PlanoContasService, ContasBancariasService, RelatoriosFinanceirosService],
  controllers: [PlanoContasController, ContasBancariasController, RelatoriosFinanceirosController],
  exports: [PlanoContasService, ContasBancariasService],
})
export class FinanceiroModule {}
