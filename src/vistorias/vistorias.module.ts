import { Module } from '@nestjs/common';
import { ManutencaoModule } from '../manutencao/manutencao.module';
import { VistoriasController } from './vistorias.controller';
import { VistoriasService } from './vistorias.service';
import { AguaService } from './agua.service';
import { FotosService } from './fotos.service';

@Module({
  imports: [ManutencaoModule],
  providers: [VistoriasService, AguaService, FotosService],
  controllers: [VistoriasController],
})
export class VistoriasModule {}
