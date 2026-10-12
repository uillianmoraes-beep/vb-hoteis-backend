import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RegraFiscal } from './regra-fiscal.entity';
import { Empresa } from '../empresas/empresa.entity';
import { FiscalService } from './fiscal.service';
import { FiscalController } from './fiscal.controller';

@Module({
  imports: [TypeOrmModule.forFeature([RegraFiscal, Empresa])],
  providers: [FiscalService],
  controllers: [FiscalController],
  exports: [FiscalService],
})
export class FiscalModule {}
