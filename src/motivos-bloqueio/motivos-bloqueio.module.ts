import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MotivoBloqueio } from './motivo-bloqueio.entity';
import { MotivosBloqueioService } from './motivos-bloqueio.service';
import { MotivosBloqueioController } from './motivos-bloqueio.controller';

@Module({
  imports: [TypeOrmModule.forFeature([MotivoBloqueio])],
  providers: [MotivosBloqueioService],
  controllers: [MotivosBloqueioController],
  exports: [MotivosBloqueioService],
})
export class MotivosBloqueioModule {}
