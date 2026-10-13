import { Body, Controller, ForbiddenException, Get, Headers, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { SugestoesService } from './sugestoes.service';
import { NovaSugestaoDto, ResponderSugestaoDto } from './sugestoes.dto';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Publico } from '../common/decorators/publico.decorator';
import { UsuarioToken } from '../common/permissoes';

/** Qualquer usuário logado manda sugestão/problema; só a Virtual Barra (chave mestra) vê de todos e responde. */
@Controller()
export class SugestoesController {
  constructor(private readonly service: SugestoesService) {}

  private conferir(chave?: string) {
    const mestra = process.env.VB_CHAVE_MESTRA;
    if (!mestra || mestra.length < 24) throw new NotFoundException();
    const a = Buffer.from(chave ?? '');
    const b = Buffer.from(mestra);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ForbiddenException('Chave inválida.');
  }

  @Post('sugestoes')
  criar(@Usuario() u: UsuarioToken, @Body() dto: NovaSugestaoDto) { return this.service.criar(u, dto); }

  @Get('sugestoes/minhas')
  minhas(@Usuario() u: UsuarioToken) { return this.service.minhas(u); }

  @Publico() @Get('vb/sugestoes')
  todas(@Headers('x-chave-mestra') chave?: string, @Query('status') status?: string) { this.conferir(chave); return this.service.todas(status); }

  @Publico() @Patch('vb/sugestoes/:id')
  responder(@Headers('x-chave-mestra') chave: string | undefined, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResponderSugestaoDto) {
    this.conferir(chave);
    return this.service.responder(id, dto);
  }
}
