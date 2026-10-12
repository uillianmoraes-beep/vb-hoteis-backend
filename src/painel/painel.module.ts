import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Unidade } from '../unidades/unidade.entity';
import { Ambiente } from '../ambientes/ambiente.entity';
import { PainelService } from './painel.service';
import { PainelController } from './painel.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Unidade, Ambiente])],
  providers: [PainelService],
  controllers: [PainelController],
})
export class PainelModule {}
