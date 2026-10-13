import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { EstoqueService } from './estoque.service';
import { EntradaDto, EntradaNotaDto, InventarioDto, LocalDto, PerdaDto, TransferenciaDto } from './estoque.dto';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

const hoje = () => new Date().toISOString().slice(0, 10);
const dataOk = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined);

@Controller('estoque')
@Requer('estoque.gerenciar')
export class EstoqueController {
  constructor(private readonly service: EstoqueService) {}

  @Get('locais') locais(@Usuario() u: UsuarioToken) { return this.service.locais(u); }
  @Post('locais') criarLocal(@Usuario() u: UsuarioToken, @Body() dto: LocalDto) { return this.service.criarLocal(u, dto); }
  @Put('locais/:id') atualizarLocal(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LocalDto) { return this.service.atualizarLocal(u, id, dto); }

  @Get('saldos') saldos(@Usuario() u: UsuarioToken, @Query('cnpj') cnpj?: string, @Query('busca') busca?: string) { return this.service.saldos(u, { cnpj, busca }); }
  @Get('abaixo-minimo') abaixo(@Usuario() u: UsuarioToken, @Query('cnpj') cnpj?: string) { return this.service.abaixoDoMinimo(u, cnpj); }

  @Post('entrada') entrada(@Usuario() u: UsuarioToken, @Body() dto: EntradaDto) { return this.service.entrada(u, dto); }
  @Get('vinculos') vinculos(@Usuario() u: UsuarioToken, @Query('fornecedor') f = '') { return this.service.vinculos(u, f); }
  @Post('entrada-nota') entradaNota(@Usuario() u: UsuarioToken, @Body() dto: EntradaNotaDto) { return this.service.entradaNota(u, dto); }
  @Post('transferencia') transferir(@Usuario() u: UsuarioToken, @Body() dto: TransferenciaDto) { return this.service.transferir(u, dto); }
  @Post('inventario') inventario(@Usuario() u: UsuarioToken, @Body() dto: InventarioDto) { return this.service.inventario(u, dto); }
  @Post('perda') perda(@Usuario() u: UsuarioToken, @Body() dto: PerdaDto) { return this.service.perda(u, dto); }

  @Get('movimentos')
  movimentos(@Usuario() u: UsuarioToken, @Query() q: Record<string, string>) {
    return this.service.movimentos(u, { de: dataOk(q.de), ate: dataOk(q.ate), localId: q.localId || undefined, produtoId: q.produtoId || undefined, tipo: q.tipo, cnpj: q.cnpj });
  }

  @Get('relatorio')
  relatorio(@Usuario() u: UsuarioToken, @Query('de') de?: string, @Query('ate') ate?: string, @Query('cnpj') cnpj?: string) {
    const fim = dataOk(ate) ?? hoje();
    return this.service.relatorio(u, { de: dataOk(de) ?? `${fim.slice(0, 8)}01`, ate: fim, cnpj });
  }
}
