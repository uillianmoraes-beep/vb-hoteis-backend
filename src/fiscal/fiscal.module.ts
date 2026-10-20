import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RegraFiscal } from './regra-fiscal.entity';
import { Empresa } from '../empresas/empresa.entity';
import { FiscalService } from './fiscal.service';
import { FiscalController } from './fiscal.controller';
import { NcmService } from './ncm.service';
import { NcmController } from './ncm.controller';
import { NumeracaoController } from './numeracao.controller';
import { ConferenciaController, ConferenciaService } from './conferencia';

@Module({
  imports: [TypeOrmModule.forFeature([RegraFiscal, Empresa])],
  providers: [FiscalService, NcmService, ConferenciaService],
  controllers: [FiscalController, NcmController, NumeracaoController, ConferenciaController],
  exports: [FiscalService],
})
export class FiscalModule {}
