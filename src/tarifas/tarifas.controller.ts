import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { TarifasService } from './tarifas.service';
import { SalvarTarifasDto } from './tarifas.dto';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

@Controller('tarifas')
export class TarifasController {
  constructor(private readonly service: TarifasService) {}

  @Get('previa/:unidadeId')
  @Requer('estadias.operar', 'tarifas.gerenciar')
  previa(@Usuario() u: UsuarioToken, @Param('unidadeId', ParseUUIDPipe) unidadeId: string) {
    return this.service.previa(u, unidadeId);
  }

  @Get(':ambienteId')
  @Requer('tarifas.gerenciar')
  carregar(@Usuario() u: UsuarioToken, @Param('ambienteId', ParseUUIDPipe) ambienteId: string) {
    return this.service.carregar(u, ambienteId);
  }

  @Put(':ambienteId')
  @Requer('tarifas.gerenciar')
  salvar(@Usuario() u: UsuarioToken, @Param('ambienteId', ParseUUIDPipe) ambienteId: string, @Body() dto: SalvarTarifasDto) {
    return this.service.salvar(u, ambienteId, dto);
  }
}
