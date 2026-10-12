import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Empresa } from '../empresas/empresa.entity';
import { LicencaController } from './licenca.controller';

@Module({ imports: [TypeOrmModule.forFeature([Empresa])], controllers: [LicencaController] })
export class LicencaModule {}
