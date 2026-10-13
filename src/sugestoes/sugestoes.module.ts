import { Module } from '@nestjs/common';
import { SugestoesService } from './sugestoes.service';
import { SugestoesController } from './sugestoes.controller';

@Module({ providers: [SugestoesService], controllers: [SugestoesController] })
export class SugestoesModule {}
