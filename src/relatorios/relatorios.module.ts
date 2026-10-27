import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Estadia } from '../estadias/estadia.entity';
import { EstadiaPagamento } from '../estadias/estadia-pagamento.entity';
import { Unidade } from '../unidades/unidade.entity';
import { Ambiente } from '../ambientes/ambiente.entity';
import { Categoria } from '../categorias/categoria.entity';
import { RelatoriosController } from './relatorios.controller';
import { RelatoriosService } from './relatorios.service';
import { EstornosController, EstornosService } from './estornos';
import { ConferenciaGarcomController, ConferenciaGarcomService } from './conferencia-garcom';

@Module({
  imports: [TypeOrmModule.forFeature([Estadia, EstadiaPagamento, Unidade, Ambiente, Categoria])],
  providers: [RelatoriosService, EstornosService, ConferenciaGarcomService],
  controllers: [EstornosController, ConferenciaGarcomController, RelatoriosController],
})
export class RelatoriosModule {}
