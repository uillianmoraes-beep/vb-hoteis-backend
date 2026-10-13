import { Module } from '@nestjs/common';
import { EstadiasModule } from '../estadias/estadias.module';
import { ReservasService } from './reservas.service';
import { ReservasController } from './reservas.controller';

@Module({ imports: [EstadiasModule], providers: [ReservasService], controllers: [ReservasController] })
export class ReservasModule {}
