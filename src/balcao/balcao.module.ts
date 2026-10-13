import { Module } from '@nestjs/common';
import { CaixaModule } from '../caixa/caixa.module';
import { BalcaoService } from './balcao.service';
import { BalcaoController } from './balcao.controller';

@Module({
  imports: [CaixaModule],
  providers: [BalcaoService],
  controllers: [BalcaoController],
})
export class BalcaoModule {}
