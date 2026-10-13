import { Module } from '@nestjs/common';
import { FaturamentoService } from './faturamento.service';
import { FaturamentoController } from './faturamento.controller';

@Module({ providers: [FaturamentoService], controllers: [FaturamentoController], exports: [FaturamentoService] })
export class FaturamentoModule {}
