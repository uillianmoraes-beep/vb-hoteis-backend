import { Module } from '@nestjs/common';
import { ManutencaoService } from './manutencao.service';
import { ManutencaoController } from './manutencao.controller';

@Module({ providers: [ManutencaoService], controllers: [ManutencaoController] })
export class ManutencaoModule {}
