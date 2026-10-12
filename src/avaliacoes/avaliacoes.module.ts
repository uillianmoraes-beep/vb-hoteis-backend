import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Avaliacao } from './avaliacao.entity';
import { Estadia } from '../estadias/estadia.entity';
import { Unidade } from '../unidades/unidade.entity';
import { Empresa } from '../empresas/empresa.entity';
import { AvaliacoesService } from './avaliacoes.service';
import { AvaliacaoPublicaController, AvaliacoesController } from './avaliacoes.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Avaliacao, Estadia, Unidade, Empresa])],
  providers: [AvaliacoesService],
  controllers: [AvaliacaoPublicaController, AvaliacoesController],
})
export class AvaliacoesModule {}
