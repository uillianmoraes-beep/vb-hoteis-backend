import { Module } from '@nestjs/common';
import { FaturamentoModule } from '../faturamento/faturamento.module';
import { CobrancaService } from './cobranca.service';
import { CobrancaController } from './cobranca.controller';

@Module({ imports: [FaturamentoModule], providers: [CobrancaService], controllers: [CobrancaController], exports: [CobrancaService] })
export class CobrancaModule {}
