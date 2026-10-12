import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Empresa } from './empresa.entity';
import { EmpresasService } from './empresas.service';
import { EmpresasController } from './empresas.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Empresa])],
  providers: [EmpresasService],
  controllers: [EmpresasController],
  exports: [EmpresasService],
})
export class EmpresasModule {}
