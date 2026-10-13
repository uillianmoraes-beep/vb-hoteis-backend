import { Module } from '@nestjs/common';
import { EstadiasModule } from '../estadias/estadias.module';
import { PedidosService } from './pedidos.service';
import { PedidosController } from './pedidos.controller';

@Module({ imports: [EstadiasModule], providers: [PedidosService], controllers: [PedidosController] })
export class PedidosModule {}
