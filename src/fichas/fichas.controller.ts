import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { FichasService } from './fichas.service';
import { CriarFichaDto, SalvarFichaDto } from './fichas.dto';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { Publico } from '../common/decorators/publico.decorator';
import { UsuarioToken } from '../common/permissoes';

@Controller()
export class FichasController {
  constructor(private readonly service: FichasService) {}

  @Post('fichas')
  @Requer('estadias.operar', 'estadias.entrada')
  criar(@Usuario() u: UsuarioToken, @Body() dto: CriarFichaDto) {
    return this.service.criar(u, dto);
  }

  @Get('fichas')
  @Requer('estadias.operar', 'estadias.entrada')
  listar(@Usuario() u: UsuarioToken, @Query('estadiaId') estadiaId?: string, @Query('busca') busca?: string) {
    return this.service.listar(u, { estadiaId, busca });
  }

  @Get('fichas/:id')
  @Requer('estadias.operar', 'estadias.entrada')
  uma(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.uma(u, id);
  }

  @Patch('fichas/:id')
  @Requer('estadias.operar', 'estadias.entrada')
  salvar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SalvarFichaDto) {
    return this.service.salvar(u, id, dto);
  }

  @Publico()
  @Get('publico/ficha/:token')
  publica(@Param('token') token: string) {
    return this.service.publica(token);
  }

  @Publico()
  @Post('publico/ficha/:token')
  enviar(@Param('token') token: string, @Body() dto: SalvarFichaDto) {
    return this.service.enviarPublica(token, dto);
  }
}
