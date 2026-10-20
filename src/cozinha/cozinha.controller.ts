import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { IsIn } from 'class-validator';
import { CozinhaService } from './cozinha.service';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

class AcaoDto {
  @IsIn(['avancar', 'voltar', 'cancelar']) acao!: 'avancar' | 'voltar' | 'cancelar';
}

@Controller('cozinha')
@Requer('cozinha.ver', 'painel.ver', 'estadias.operar')
export class CozinhaController {
  constructor(private readonly service: CozinhaService) {}

  @Get()
  listar(@Usuario() u: UsuarioToken, @Query('ambienteId') ambienteId?: string, @Query('grupos') grupos?: string, @Query('entregues') entregues?: string) {
    return this.service.listar(u, {
      ambienteId: ambienteId && /^[0-9a-f-]{36}$/i.test(ambienteId) ? ambienteId : undefined,
      grupos: grupos ? grupos.split('|').map((g) => g.trim()).filter(Boolean) : [], entregues: entregues === 'true',
    });
  }

  @Get('grupos')
  grupos(@Usuario() u: UsuarioToken) { return this.service.grupos(u); }

  @Get('prontos')
  prontos(@Usuario() u: UsuarioToken, @Query('ambienteId') ambienteId?: string) {
    return this.service.prontos(u, ambienteId && /^[0-9a-f-]{36}$/i.test(ambienteId) ? ambienteId : undefined);
  }

  @Post(':id')
  @HttpCode(200)
  mudar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AcaoDto) {
    return this.service.mudar(u, id, dto.acao);
  }
}
