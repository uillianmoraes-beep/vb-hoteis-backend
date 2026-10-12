import { Controller, Get, Query } from '@nestjs/common';
import { PainelService } from './painel.service';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

@Controller('painel')
export class PainelController {
  constructor(private readonly service: PainelService) {}

  @Get()
  @Requer('painel.ver')
  montar(@Usuario() u: UsuarioToken, @Query('ambienteId') ambienteId?: string) {
    return this.service.montar(u, ambienteId);
  }
}
