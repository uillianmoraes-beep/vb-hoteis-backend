import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { FaturamentoService } from './faturamento.service';
import { BaixaDto, BoletoDto, ClienteFaturadoDto, CreditoDto, GerarFaturaDto, LancamentoManualDto } from './faturamento.dto';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

class DefinirClienteDto {
  @IsUUID() clienteId!: string;
}

@Controller('faturamento')
export class FaturamentoController {
  constructor(private readonly service: FaturamentoService) {}

  @Get('resumo') @Requer('faturamento.gerenciar')
  resumo(@Usuario() u: UsuarioToken, @Query('cnpj') cnpj?: string) { return this.service.resumo(u, cnpj); }

  @Get('clientes') @Requer('faturamento.gerenciar')
  clientes(@Usuario() u: UsuarioToken, @Query('todos') todos?: string) { return this.service.clientes(u, todos === '1'); }

  /** para escolher o cliente ao fechar uma conta como faturado */
  @Get('clientes-simples') @Requer('faturamento.gerenciar', 'estadias.operar', 'caixa.principal')
  clientesSimples(@Usuario() u: UsuarioToken) { return this.service.clientesSimples(u); }

  @Post('clientes') @Requer('faturamento.gerenciar')
  criarCliente(@Usuario() u: UsuarioToken, @Body() dto: ClienteFaturadoDto) { return this.service.criarCliente(u, dto); }

  @Patch('clientes/:id') @Requer('faturamento.gerenciar')
  atualizarCliente(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ClienteFaturadoDto) { return this.service.atualizarCliente(u, id, dto); }

  @Get('clientes/:id/extrato') @Requer('faturamento.gerenciar')
  extrato(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.extrato(u, id); }

  @Post('clientes/:id/credito') @HttpCode(200) @Requer('faturamento.gerenciar')
  credito(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreditoDto) { return this.service.credito(u, id, dto); }

  @Get('receber') @Requer('faturamento.gerenciar')
  receber(@Usuario() u: UsuarioToken, @Query('clienteId') clienteId?: string, @Query('status') status?: string, @Query('cnpj') cnpj?: string) { return this.service.receber(u, { clienteId, status, cnpj }); }

  @Post('receber') @Requer('faturamento.gerenciar')
  lancar(@Usuario() u: UsuarioToken, @Body() dto: LancamentoManualDto) { return this.service.lancamentoManual(u, dto); }

  @Post('receber/:id/cliente') @HttpCode(200) @Requer('faturamento.gerenciar')
  definirCliente(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DefinirClienteDto) { return this.service.definirCliente(u, id, dto.clienteId); }

  @Post('receber/:id/baixar') @HttpCode(200) @Requer('faturamento.gerenciar')
  baixarLancamento(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BaixaDto) { return this.service.baixarLancamento(u, id, dto); }

  @Post('receber/:id/cancelar') @HttpCode(200) @Requer('faturamento.gerenciar')
  cancelarLancamento(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.cancelarLancamento(u, id); }

  @Get('faturas') @Requer('faturamento.gerenciar')
  faturas(@Usuario() u: UsuarioToken, @Query('status') status?: string, @Query('clienteId') clienteId?: string, @Query('cnpj') cnpj?: string) { return this.service.faturas(u, { status, clienteId, cnpj }); }

  @Post('faturas') @Requer('faturamento.gerenciar')
  gerar(@Usuario() u: UsuarioToken, @Body() dto: GerarFaturaDto) { return this.service.gerarFatura(u, dto); }

  @Get('faturas/:id') @Requer('faturamento.gerenciar')
  fatura(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.fatura(u, id); }

  @Patch('faturas/:id/boleto') @Requer('faturamento.gerenciar')
  boleto(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BoletoDto) { return this.service.boleto(u, id, dto); }

  @Post('faturas/:id/baixar') @HttpCode(200) @Requer('faturamento.gerenciar')
  baixarFatura(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BaixaDto) { return this.service.baixarFatura(u, id, dto); }

  @Post('faturas/:id/cancelar') @HttpCode(200) @Requer('faturamento.gerenciar')
  cancelarFatura(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.cancelarFatura(u, id); }
}
