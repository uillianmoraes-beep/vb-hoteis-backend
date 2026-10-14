import { Module } from '@nestjs/common';
import { ImpressaoModule } from '../impressao/impressao.module';
import { EstadiasModule } from '../estadias/estadias.module';
import { PedidosService } from './pedidos.service';
import { PedidosController } from './pedidos.controller';

@Module({ imports: [EstadiasModule, ImpressaoModule], providers: [PedidosService], controllers: [PedidosController] })
export class PedidosModule {}
