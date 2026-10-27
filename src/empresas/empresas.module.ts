import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Empresa } from './empresa.entity';
import { EmpresasService } from './empresas.service';
import { EmpresasController } from './empresas.controller';
import { DocumentosEmpresaController, DocumentosEmpresaService } from './documentos-empresa';

@Module({
  imports: [TypeOrmModule.forFeature([Empresa])],
  providers: [EmpresasService, DocumentosEmpresaService],
  controllers: [DocumentosEmpresaController, EmpresasController],
  exports: [EmpresasService],
})
export class EmpresasModule {}
