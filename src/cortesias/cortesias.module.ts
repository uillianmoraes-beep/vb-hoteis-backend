import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Cortesia } from './cortesia.entity';
import { CortesiasService } from './cortesias.service';
import { CortesiasController } from './cortesias.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Cortesia])],
  providers: [CortesiasService],
  controllers: [CortesiasController],
  exports: [CortesiasService],
})
export class CortesiasModule {}
