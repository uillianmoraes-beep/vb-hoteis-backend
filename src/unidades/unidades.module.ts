import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Unidade } from './unidade.entity';
import { UnidadeEvento } from './unidade-evento.entity';
import { Ambiente } from '../ambientes/ambiente.entity';
import { MotivoBloqueio } from '../motivos-bloqueio/motivo-bloqueio.entity';
import { Estadia } from '../estadias/estadia.entity';
import { UnidadesService } from './unidades.service';
import { UnidadesController } from './unidades.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Unidade, UnidadeEvento, Ambiente, MotivoBloqueio, Estadia])],
  providers: [UnidadesService],
  controllers: [UnidadesController],
  exports: [UnidadesService],
})
export class UnidadesModule {}
