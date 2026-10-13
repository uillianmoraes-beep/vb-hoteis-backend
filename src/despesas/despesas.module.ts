import { Module } from '@nestjs/common';
import { DespesasService } from './despesas.service';
import { DespesasController } from './despesas.controller';

@Module({ providers: [DespesasService], controllers: [DespesasController] })
export class DespesasModule {}
