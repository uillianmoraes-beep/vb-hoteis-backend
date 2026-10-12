import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { FiscalService } from './fiscal.service';
import { SalvarRegraDto } from './fiscal.dto';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

@Controller('fiscal/regras')
export class FiscalController {
  constructor(private readonly service: FiscalService) {}

  @Get()
  @Requer('notas.gerenciar', 'produtos.gerenciar')
  listar(@Usuario() u: UsuarioToken) {
    return this.service.listar(u);
  }

  @Post()
  @Requer('notas.gerenciar')
  criar(@Usuario() u: UsuarioToken, @Body() dto: SalvarRegraDto) {
    return this.service.criar(u, dto);
  }

  @Patch(':id')
  @Requer('notas.gerenciar')
  atualizar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SalvarRegraDto) {
    return this.service.atualizar(u, id, dto);
  }

  @Delete(':id')
  @Requer('notas.gerenciar')
  remover(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.remover(u, id);
  }
}
