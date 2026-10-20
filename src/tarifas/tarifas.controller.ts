import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { TarifasService } from './tarifas.service';
import { AplicarPromocaoDto, SalvarDiariasDto, SalvarTarifasDto } from './tarifas.dto';
import { PromocoesService } from './promocoes.service';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

@Controller('tarifas')
export class TarifasController {
  constructor(private readonly service: TarifasService, private readonly promocoes: PromocoesService) {}

  /** Tarifas inteligentes: dias fracos, preço real × sugerido, ideias e promoções do ambiente */
  @Get('inteligentes/:ambienteId')
  @Requer('tarifas.gerenciar')
  inteligentes(@Usuario() u: UsuarioToken, @Param('ambienteId', ParseUUIDPipe) ambienteId: string, @Query('dias') dias?: string) {
    return this.promocoes.analise(u, ambienteId, Number(dias) || 90);
  }

  @Post('promocoes')
  @Requer('tarifas.gerenciar')
  aplicarPromocao(@Usuario() u: UsuarioToken, @Body() dto: AplicarPromocaoDto) {
    return this.promocoes.aplicar(u, dto);
  }

  @Post('promocoes/:id/encerrar')
  @HttpCode(200)
  @Requer('tarifas.gerenciar')
  encerrarPromocao(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.promocoes.encerrar(u, id);
  }

  @Get('previa/:unidadeId')
  @Requer('estadias.operar', 'estadias.entrada', 'tarifas.gerenciar')
  previa(@Usuario() u: UsuarioToken, @Param('unidadeId', ParseUUIDPipe) unidadeId: string) {
    return this.service.previa(u, unidadeId);
  }

  /** hotel/pousada: diária de cada categoria */
  @Get('diarias/:ambienteId')
  @Requer('tarifas.gerenciar', 'reservas.gerenciar', 'estadias.operar')
  diarias(@Usuario() u: UsuarioToken, @Param('ambienteId', ParseUUIDPipe) ambienteId: string) {
    return this.service.diarias(u, ambienteId);
  }

  @Put('diarias/:ambienteId')
  @Requer('tarifas.gerenciar')
  salvarDiarias(@Usuario() u: UsuarioToken, @Param('ambienteId', ParseUUIDPipe) ambienteId: string, @Body() dto: SalvarDiariasDto) {
    return this.service.salvarDiarias(u, ambienteId, dto);
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
