import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Ambiente } from './ambiente.entity';
import { AmbientesService } from './ambientes.service';
import { AmbientesController } from './ambientes.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Ambiente])],
  providers: [AmbientesService],
  controllers: [AmbientesController],
  exports: [AmbientesService],
})
export class AmbientesModule {}
