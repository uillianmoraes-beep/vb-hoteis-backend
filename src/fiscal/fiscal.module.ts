import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RegraFiscal } from './regra-fiscal.entity';
import { Empresa } from '../empresas/empresa.entity';
import { FiscalService } from './fiscal.service';
import { FiscalController } from './fiscal.controller';
import { NcmService } from './ncm.service';
import { NcmController } from './ncm.controller';
import { NumeracaoController } from './numeracao.controller';

@Module({
  imports: [TypeOrmModule.forFeature([RegraFiscal, Empresa])],
  providers: [FiscalService, NcmService],
  controllers: [FiscalController, NcmController, NumeracaoController],
  exports: [FiscalService],
})
export class FiscalModule {}
