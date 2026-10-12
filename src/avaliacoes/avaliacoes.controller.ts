import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { AvaliacoesService } from './avaliacoes.service';
import { ResponderAvaliacaoDto, SalvarPerguntasDto } from './avaliacoes.dto';
import { Publico } from '../common/decorators/publico.decorator';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

/** Página pública do QR (cliente, sem login). */
@Controller('publico/avaliacao')
export class AvaliacaoPublicaController {
  constructor(private readonly service: AvaliacoesService) {}

  @Get(':token')
  @Publico()
  ver(@Param('token') token: string) {
    return this.service.publico(token);
  }

  @Post(':token')
  @HttpCode(200)
  @Publico()
  responder(@Param('token') token: string, @Body() dto: ResponderAvaliacaoDto) {
    return this.service.responder(token, dto);
  }
}

@Controller('avaliacoes')
export class AvaliacoesController {
  constructor(private readonly service: AvaliacoesService) {}

  @Get('perguntas')
  @Requer('avaliacoes.ver')
  perguntas(@Usuario() u: UsuarioToken) {
    return this.service.perguntas(u);
  }

  @Put('perguntas')
  @Requer('avaliacoes.ver')
  salvarPerguntas(@Usuario() u: UsuarioToken, @Body() dto: SalvarPerguntasDto) {
    return this.service.salvarPerguntas(u, dto);
  }

  @Get()
  @Requer('avaliacoes.ver')
  relatorio(@Usuario() u: UsuarioToken, @Query('de') de?: string, @Query('ate') ate?: string) {
    return this.service.relatorio(u, { de, ate });
  }
}
