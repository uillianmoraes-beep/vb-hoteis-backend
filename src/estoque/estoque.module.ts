import { Module } from '@nestjs/common';
import { EstoqueService } from './estoque.service';
import { EstoqueController } from './estoque.controller';
import { CortesService } from './cortes.service';

@Module({ providers: [EstoqueService, CortesService], controllers: [EstoqueController] })
export class EstoqueModule {}
