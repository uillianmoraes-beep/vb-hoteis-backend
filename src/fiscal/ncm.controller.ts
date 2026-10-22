import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { IsIn } from 'class-validator';
import { Usuario } from '../common/decorators/usuario.decorator';
import { UsuarioToken } from '../common/permissoes';
import { NcmService } from './ncm.service';
import { Requer } from '../common/decorators/requer.decorator';

class RegimeDto {
  @IsIn(['simples', 'mei', 'normal', 'presumido', 'real']) regime!: 'simples' | 'mei' | 'normal' | 'presumido' | 'real';
}

/** Buscar tributação (NCM) pelo nome do produto: tabela oficial + sugestão por IA. */
@Controller('fiscal/ncm')
export class NcmController {
  constructor(private readonly service: NcmService) {}

  @Get()
  @Requer('produtos.gerenciar', 'notas.gerenciar')
  async buscar(@Usuario() u: UsuarioToken, @Query('q') q = '') {
    return { ...(await this.service.buscar(q)), regime: await this.service.regime(u.empresaId) };
  }

  /** regime tributário da empresa (Simples, MEI ou normal) */
  @Get('regime')
  @Requer('produtos.gerenciar', 'notas.gerenciar')
  async regime(@Usuario() u: UsuarioToken) {
    return { regime: await this.service.regime(u.empresaId) };
  }

  @Put('regime')
  @Requer('produtos.gerenciar', 'notas.gerenciar')
  salvarRegime(@Usuario() u: UsuarioToken, @Body() dto: RegimeDto) {
    return this.service.salvarRegime(u.empresaId, dto.regime);
  }
}
