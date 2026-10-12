import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CaixaService } from './caixa.service';
import { BaixarPenhoraDto, ResgatarPenhoraDto } from './caixa.dto';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

@Controller('penhoras')
export class PenhorasController {
  constructor(private readonly service: CaixaService) {}

  @Get()
  @Requer('estadias.operar', 'caixa.principal', 'relatorios.ver', 'penhoras.baixar')
  listar(@Usuario() u: UsuarioToken, @Query('status') status?: string, @Query('de') de?: string, @Query('ate') ate?: string) {
    return this.service.listarPenhoras(u, { status, de, ate });
  }

  @Post(':id/resgatar')
  @HttpCode(200)
  @Requer('estadias.operar', 'caixa.principal')
  resgatar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResgatarPenhoraDto) {
    return this.service.resgatarPenhora(u, id, dto);
  }

  @Post(':id/baixar')
  @HttpCode(200)
  @Requer('penhoras.baixar')
  baixar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BaixarPenhoraDto) {
    return this.service.baixarPenhora(u, id, dto);
  }
}
