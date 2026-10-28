import { Global, Module } from '@nestjs/common';
import { RevendaService } from './revenda.service';
import { AreaClienteController, RevendaController, RevendaPublicoController } from './revenda.controller';

@Global()
@Module({
  providers: [RevendaService],
  exports: [RevendaService],
  controllers: [RevendaPublicoController, AreaClienteController, RevendaController],
})
export class RevendaModule {}
