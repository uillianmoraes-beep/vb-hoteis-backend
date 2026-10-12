import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { SaidasService } from './saidas.service';
import { RegistrarSaidaDto } from './estadias.dto';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

@Controller('saidas')
export class SaidasController {
  constructor(private readonly service: SaidasService) {}

  @Post()
  @Requer('saida.registrar')
  registrar(@Usuario() u: UsuarioToken, @Body() dto: RegistrarSaidaDto) {
    return this.service.registrar(u, dto);
  }

  /** ?de=AAAA-MM-DD&ate=AAAA-MM-DD (padrão: últimas 24 h) */
  @Get()
  @Requer('saida.registrar', 'estadias.corrigir')
  listar(@Usuario() u: UsuarioToken, @Query('de') de?: string, @Query('ate') ate?: string) {
    return this.service.listar(u, { de, ate });
  }
}
