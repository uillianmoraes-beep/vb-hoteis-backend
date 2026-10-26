import { Module } from '@nestjs/common';
import { LeitorContadorService } from './leitor';
import { HoleriteController, HoleriteService } from './holerite';
import { SimplesController, SimplesService } from './simples';

/** Área do contador: conferência do holerite e cruzamento do Simples Nacional com o faturamento. */
@Module({
  providers: [LeitorContadorService, HoleriteService, SimplesService],
  controllers: [HoleriteController, SimplesController],
})
export class ContadorModule {}
