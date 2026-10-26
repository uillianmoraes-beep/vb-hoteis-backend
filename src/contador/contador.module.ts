import { Module } from '@nestjs/common';
import { LeitorContadorService } from './leitor';
import { HoleriteController, HoleriteService } from './holerite';
import { SimplesController, SimplesService } from './simples';
import { AreaContadorController, AreaContadorService } from './area';

/** Área do contador: conferência do holerite e cruzamento do Simples Nacional com o faturamento. */
@Module({
  providers: [LeitorContadorService, HoleriteService, SimplesService, AreaContadorService],
  controllers: [HoleriteController, SimplesController, AreaContadorController],
})
export class ContadorModule {}
