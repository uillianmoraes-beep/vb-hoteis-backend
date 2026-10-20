import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Unidade } from './unidade.entity';
import { UnidadeEvento } from './unidade-evento.entity';
import { Ambiente } from '../ambientes/ambiente.entity';
import { MotivoBloqueio } from '../motivos-bloqueio/motivo-bloqueio.entity';
import { Estadia } from '../estadias/estadia.entity';
import { UnidadesService } from './unidades.service';
import { UnidadesController } from './unidades.controller';
import { EmprestimoService } from './emprestimo.service';
import { EmprestimoController } from './emprestimo.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Unidade, UnidadeEvento, Ambiente, MotivoBloqueio, Estadia])],
  providers: [UnidadesService, EmprestimoService],
  controllers: [UnidadesController, EmprestimoController],
  exports: [UnidadesService],
})
export class UnidadesModule {}
