import { Module } from '@nestjs/common';
import { EstoqueService } from './estoque.service';
import { EstoqueController } from './estoque.controller';
import { CortesService } from './cortes.service';
import { PosicaoEstoqueController, PosicaoEstoqueService } from './posicao';
import { TemperaturasController, TemperaturasService } from './temperaturas';

@Module({ providers: [EstoqueService, CortesService, PosicaoEstoqueService, TemperaturasService], controllers: [PosicaoEstoqueController, TemperaturasController, EstoqueController] })
export class EstoqueModule {}
