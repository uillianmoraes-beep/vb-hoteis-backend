import { Module } from '@nestjs/common';
import { CaixaModule } from '../caixa/caixa.module';
import { ImpressaoModule } from '../impressao/impressao.module';
import { BalcaoService } from './balcao.service';
import { BalcaoController } from './balcao.controller';

@Module({
  imports: [CaixaModule, ImpressaoModule],
  providers: [BalcaoService],
  controllers: [BalcaoController],
})
export class BalcaoModule {}
