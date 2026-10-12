import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Gorjeta } from './gorjeta.entity';
import { Empresa } from '../empresas/empresa.entity';
import { UsuarioEntity } from '../usuarios/usuario.entity';
import { CaixaMovimento } from '../caixa/caixa.entity';
import { GorjetasService } from './gorjetas.service';
import { GorjetasController } from './gorjetas.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Gorjeta, Empresa, UsuarioEntity, CaixaMovimento])],
  providers: [GorjetasService],
  controllers: [GorjetasController],
  exports: [GorjetasService],
})
export class GorjetasModule {}
