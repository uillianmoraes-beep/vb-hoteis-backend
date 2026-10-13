import { Module } from '@nestjs/common';
import { EstadiasModule } from '../estadias/estadias.module';
import { CobrancaModule } from '../cobranca/cobranca.module';
import { ReservasService } from './reservas.service';
import { ReservasController } from './reservas.controller';
import { ReservaOnlineService } from './reserva-online.service';
import { ReservaOnlineController } from './reserva-online.controller';

@Module({ imports: [EstadiasModule, CobrancaModule], providers: [ReservasService, ReservaOnlineService], controllers: [ReservasController, ReservaOnlineController] })
export class ReservasModule {}
