import { Module } from '@nestjs/common';
import { NotasFiscaisService } from './notas-fiscais.service';
import { NotasFiscaisController } from './notas-fiscais.controller';

@Module({ providers: [NotasFiscaisService], controllers: [NotasFiscaisController], exports: [NotasFiscaisService] })
export class NotasFiscaisModule {}
