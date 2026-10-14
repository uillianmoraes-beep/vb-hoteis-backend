import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ImpressaoService } from './impressao.service';
import { ImpressoraDto, ResultadoAgenteDto } from './impressao.dto';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { Publico } from '../common/decorators/publico.decorator';
import { UsuarioToken } from '../common/permissoes';

@Controller()
export class ImpressaoController {
  constructor(private readonly service: ImpressaoService) {}

  @Get('impressoras') @Requer('empresa.editar', 'produtos.gerenciar')
  listar(@Usuario() u: UsuarioToken) { return this.service.listar(u); }

  @Post('impressoras') @Requer('empresa.editar', 'produtos.gerenciar')
  criar(@Usuario() u: UsuarioToken, @Body() dto: ImpressoraDto) { return this.service.salvar(u, null, dto); }

  @Put('impressoras/:id') @Requer('empresa.editar', 'produtos.gerenciar')
  salvar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ImpressoraDto) { return this.service.salvar(u, id, dto); }

  @Delete('impressoras/:id') @Requer('empresa.editar', 'produtos.gerenciar')
  excluir(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.excluir(u, id); }

  @Post('impressoras/:id/testar') @HttpCode(200) @Requer('empresa.editar', 'produtos.gerenciar')
  testar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.testar(u, id); }

  @Post('impressao/fila/:id/reenviar') @HttpCode(200) @Requer('empresa.editar', 'produtos.gerenciar', 'estadias.operar')
  reenviar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.reenviar(u, id); }

  @Post('impressao/agente/token') @HttpCode(200) @Requer('empresa.editar')
  token(@Usuario() u: UsuarioToken) { return this.service.gerarTokenAgente(u); }

  // agente instalado num PC do hotel (sistema na nuvem)
  @Publico() @Get('publico/impressao/agente/fila')
  fila(@Headers('x-agente-token') token?: string) { return this.service.filaAgente(token); }

  @Publico() @Post('publico/impressao/agente/:id') @HttpCode(200)
  resultado(@Param('id', ParseUUIDPipe) id: string, @Headers('x-agente-token') token: string | undefined, @Body() dto: ResultadoAgenteDto) {
    return this.service.resultadoAgente(token, id, dto.ok, dto.erro);
  }
}
