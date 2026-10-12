import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Estadia } from './estadia.entity';
import { Unidade } from '../unidades/unidade.entity';
import { UsuarioEntity } from '../usuarios/usuario.entity';
import { Perfil } from '../perfis/perfil.entity';
import { TarifasModule } from '../tarifas/tarifas.module';
import { EstadiasService } from './estadias.service';
import { EstadiasController } from './estadias.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Estadia, Unidade, UsuarioEntity, Perfil]), TarifasModule],
  providers: [EstadiasService],
  controllers: [EstadiasController],
  exports: [EstadiasService],
})
export class EstadiasModule {}
