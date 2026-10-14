import { Module } from '@nestjs/common';
import { ImpressaoService } from './impressao.service';
import { ImpressaoController } from './impressao.controller';

@Module({ providers: [ImpressaoService], controllers: [ImpressaoController], exports: [ImpressaoService] })
export class ImpressaoModule {}
