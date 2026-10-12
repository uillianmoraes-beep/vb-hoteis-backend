import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Perfil } from './perfil.entity';
import { UsuarioEntity } from '../usuarios/usuario.entity';
import { PerfisService } from './perfis.service';
import { PerfisController } from './perfis.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Perfil, UsuarioEntity])],
  providers: [PerfisService],
  controllers: [PerfisController],
  exports: [PerfisService],
})
export class PerfisModule {}
