import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Ambiente } from '../ambientes/ambiente.entity';
import { Categoria } from '../categorias/categoria.entity';
import { Unidade } from '../unidades/unidade.entity';
import { Periodo } from './periodo.entity';
import { TabelaPreco } from './tabela-preco.entity';
import { Preco } from './preco.entity';
import { TarifasService } from './tarifas.service';
import { TarifasController } from './tarifas.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Ambiente, Categoria, Unidade, Periodo, TabelaPreco, Preco])],
  providers: [TarifasService],
  controllers: [TarifasController],
  exports: [TarifasService],
})
export class TarifasModule {}
