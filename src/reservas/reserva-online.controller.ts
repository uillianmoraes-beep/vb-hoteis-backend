import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ReservaOnlineService } from './reserva-online.service';
import { ConfigReservaOnlineDto, RascunhoReservaDto, ReservaPublicaDto } from './reservas.dto';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { Publico } from '../common/decorators/publico.decorator';
import { UsuarioToken } from '../common/permissoes';

const tk = (t: string) => t.replace(/[^a-f0-9]/gi, '').slice(0, 24);
const cod = (t: string) => t.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
const int = (v: string | undefined, padrao: number) => { const n = Number(v); return Number.isInteger(n) && n >= 0 && n <= 20 ? n : padrao; };

const uuid = (v?: string) => (v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : undefined);

@Controller()
export class ReservaOnlineController {
  constructor(private readonly service: ReservaOnlineService) {}

  // ----- o hóspede (sem login) -----
  @Publico() @Get('publico/reserva/:token')
  info(@Param('token') t: string) { return this.service.info(tk(t)); }

  @Publico() @Get('publico/reserva/:token/disponibilidade')
  disponibilidade(@Param('token') t: string, @Query('chegada') chegada = '', @Query('saida') saida = '', @Query('adultos') adultos?: string, @Query('criancas') criancas?: string) {
    return this.service.disponibilidade(tk(t), chegada, saida, Math.max(1, int(adultos, 2)), int(criancas, 0));
  }

  @Publico() @Get('publico/reserva/:token/simular')
  simular(@Param('token') t: string, @Query() q: Record<string, string>) {
    return this.service.simular(tk(t), {
      chegada: String(q.chegada ?? ''), saida: String(q.saida ?? ''), adultos: Math.max(1, int(q.adultos, 2)), criancas: int(q.criancas, 0),
      categoriaId: uuid(q.categoriaId) ?? '', unidadeId: uuid(q.unidadeId), cupom: q.cupom ? String(q.cupom).slice(0, 30) : undefined,
      pacoteId: uuid(q.pacoteId), telefone: q.telefone ? String(q.telefone).slice(0, 30) : undefined, documento: q.documento ? String(q.documento).slice(0, 30) : undefined,
    });
  }

  @Publico() @Post('publico/reserva/:token/rascunho') @HttpCode(200)
  rascunho(@Param('token') t: string, @Body() dto: RascunhoReservaDto) { return this.service.rascunho(tk(t), dto); }

  @Publico() @Post('publico/reserva/:token') @HttpCode(200)
  reservar(@Param('token') t: string, @Body() dto: ReservaPublicaDto) { return this.service.reservar(tk(t), dto); }

  @Publico() @Get('publico/minha-reserva/:codigo')
  consulta(@Param('codigo') c: string) {
    const x = cod(c);
    if (x.length < 6) throw new BadRequestException('Código inválido.');
    return this.service.consulta(x);
  }

  // ----- recepção / gerência -----
  @Get('reservas-online/config') @Requer('reservas.gerenciar')
  config(@Usuario() u: UsuarioToken) { return this.service.config(u); }

  @Put('reservas-online/config/:ambienteId') @Requer('reservas.gerenciar')
  salvar(@Usuario() u: UsuarioToken, @Param('ambienteId', ParseUUIDPipe) id: string, @Body() dto: ConfigReservaOnlineDto) { return this.service.salvarConfig(u, id, dto); }

  @Post('reservas-online/config/:ambienteId/novo-link') @HttpCode(200) @Requer('reservas.gerenciar')
  novoLink(@Usuario() u: UsuarioToken, @Param('ambienteId', ParseUUIDPipe) id: string) { return this.service.novoLink(u, id); }

  @Post('reservas-online/confirmar/:id') @HttpCode(200) @Requer('reservas.gerenciar', 'estadias.operar')
  confirmar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.confirmar(u, id); }
}
