import { Module } from '@nestjs/common';
import { EstadiasModule } from '../estadias/estadias.module';
import { CobrancaModule } from '../cobranca/cobranca.module';
import { ReservasService } from './reservas.service';
import { ReservasController } from './reservas.controller';
import { ReservaOnlineService } from './reserva-online.service';
import { ReservaOnlineController } from './reserva-online.controller';
import { PromocoesController, PromocoesService } from './promocoes';
import { CalendarioIcalController, CalendarioIcalService } from './calendario-ical';

@Module({ imports: [EstadiasModule, CobrancaModule], providers: [ReservasService, ReservaOnlineService, PromocoesService, CalendarioIcalService], controllers: [ReservasController, ReservaOnlineController, PromocoesController, CalendarioIcalController] })
export class ReservasModule {}
