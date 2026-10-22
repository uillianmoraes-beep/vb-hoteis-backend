import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { DespesasService } from './despesas.service';
import { AprovarContasDto, ContaPagarDto, ImportarNfeDto, PagarContaDto } from './despesas.dto';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

@Controller('contas-pagar')
export class DespesasController {
  constructor(private readonly service: DespesasService) {}

  @Get()
  @Requer('despesas.gerenciar', 'compras.gerenciar')
  listar(@Usuario() u: UsuarioToken, @Query('status') status?: string, @Query('de') de?: string, @Query('ate') ate?: string, @Query('cnpj') cnpj?: string) {
    return this.service.listar(u, { status, de, ate, cnpj });
  }

  /** notas e boletos esperando o financeiro */
  @Get('aprovacoes')
  @Requer('despesas.aprovar', 'despesas.gerenciar', 'compras.gerenciar')
  aprovacoes(@Usuario() u: UsuarioToken) {
    return this.service.aprovacoes(u);
  }

  @Post('aprovacoes')
  @HttpCode(200)
  @Requer('despesas.aprovar', 'despesas.gerenciar')
  aprovar(@Usuario() u: UsuarioToken, @Body() dto: AprovarContasDto) {
    return this.service.aprovar(u, dto);
  }

  @Post()
  @Requer('despesas.gerenciar', 'compras.gerenciar')
  criar(@Usuario() u: UsuarioToken, @Body() dto: ContaPagarDto) {
    return this.service.criar(u, dto);
  }

  @Post('importar-nfe')
  @Requer('despesas.gerenciar', 'compras.gerenciar')
  importarNfe(@Usuario() u: UsuarioToken, @Body() dto: ImportarNfeDto) {
    return this.service.importarNfe(u, dto);
  }

  @Patch(':id')
  @Requer('despesas.gerenciar', 'compras.gerenciar')
  atualizar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ContaPagarDto) {
    return this.service.atualizar(u, id, dto);
  }

  @Post(':id/pagar')
  @HttpCode(200)
  @Requer('despesas.gerenciar')
  pagar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PagarContaDto) {
    return this.service.pagar(u, id, dto);
  }

  @Post(':id/cancelar')
  @HttpCode(200)
  @Requer('despesas.gerenciar')
  cancelar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.cancelar(u, id);
  }
}
