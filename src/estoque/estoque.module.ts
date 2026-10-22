import { Module } from '@nestjs/common';
import { EstoqueService } from './estoque.service';
import { EstoqueController } from './estoque.controller';
import { CortesService } from './cortes.service';
import { PosicaoEstoqueController, PosicaoEstoqueService } from './posicao';

@Module({ providers: [EstoqueService, CortesService, PosicaoEstoqueService], controllers: [PosicaoEstoqueController, EstoqueController] })
export class EstoqueModule {}
