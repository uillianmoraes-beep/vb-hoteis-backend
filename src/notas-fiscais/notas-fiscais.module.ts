import { Module } from '@nestjs/common';
import { NotasFiscaisService } from './notas-fiscais.service';
import { NotasArquivoController, NotasFiscaisController } from './notas-fiscais.controller';

@Module({ providers: [NotasFiscaisService], controllers: [NotasFiscaisController, NotasArquivoController], exports: [NotasFiscaisService] })
export class NotasFiscaisModule {}
