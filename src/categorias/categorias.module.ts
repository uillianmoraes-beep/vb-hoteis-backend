import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Categoria } from './categoria.entity';
import { CategoriasService } from './categorias.service';
import { CategoriasController } from './categorias.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Categoria])],
  providers: [CategoriasService],
  controllers: [CategoriasController],
  exports: [CategoriasService],
})
export class CategoriasModule {}
