import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { CobrancaService } from './cobranca.service';
import { ConfigCobrancaDto, FaturarClienteDto, GerarCobrancaDto } from './cobranca.dto';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { Publico } from '../common/decorators/publico.decorator';
import { UsuarioToken } from '../common/permissoes';

/** endereço público deste backend (para o aviso do Asaas) */
const baseDe = (host?: string, proto?: string) => `${(proto ?? 'https').split(',')[0].trim()}://${(host ?? '').split(',')[0].trim()}`;

@Controller()
export class CobrancaController {
  constructor(private readonly service: CobrancaService) {}

  @Publico() @Post('publico/asaas/:empresaId') @HttpCode(200)
  webhook(@Param('empresaId') empresaId: string, @Headers('asaas-access-token') token: string | undefined, @Body() corpo: Record<string, any>) {
    return this.service.webhook(empresaId, token, corpo);
  }

  @Get('cobranca/config') @Requer('empresa.editar', 'faturamento.gerenciar')
  config(@Usuario() u: UsuarioToken, @Headers('x-forwarded-host') fh?: string, @Headers('host') h?: string, @Headers('x-forwarded-proto') p?: string) {
    return this.service.config(u, baseDe(fh || h, p));
  }

  @Put('cobranca/config') @Requer('empresa.editar')
  salvar(@Usuario() u: UsuarioToken, @Body() dto: ConfigCobrancaDto, @Headers('x-forwarded-host') fh?: string, @Headers('host') h?: string, @Headers('x-forwarded-proto') p?: string) {
    return this.service.salvarConfig(u, dto, baseDe(fh || h, p));
  }

  @Post('cobranca/config/webhook-manual') @HttpCode(200) @Requer('empresa.editar')
  manual(@Usuario() u: UsuarioToken) { return this.service.webhookManual(u); }

  @Get('cobranca/ativa') @Requer('faturamento.gerenciar', 'reservas.gerenciar', 'empresa.editar')
  async ativa(@Usuario() u: UsuarioToken) { return { ativa: await this.service.ativa(u.empresaId) }; }

  @Get('cobrancas') @Requer('faturamento.gerenciar', 'empresa.editar')
  listar(@Usuario() u: UsuarioToken) { return this.service.listar(u); }

  @Post('cobrancas/:id/cancelar') @HttpCode(200) @Requer('faturamento.gerenciar')
  cancelar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.cancelar(u, id); }

  /** um clique: fatura (uma por CNPJ) + boleto/Pix + nota pendente + texto pronto para mandar */
  @Post('faturamento/clientes/:id/faturar') @HttpCode(200) @Requer('faturamento.gerenciar')
  faturar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: FaturarClienteDto) { return this.service.faturarCliente(u, id, dto); }

  @Get('faturamento/faturas/:id/envio') @Requer('faturamento.gerenciar')
  envio(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.envio(u, id); }

  @Get('faturamento/faturas/:id/cobranca') @Requer('faturamento.gerenciar')
  daFatura(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.daFatura(u, id); }

  @Post('faturamento/faturas/:id/cobranca') @HttpCode(200) @Requer('faturamento.gerenciar')
  gerar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: GerarCobrancaDto) { return this.service.gerarFatura(u, id, dto.forma); }
}
