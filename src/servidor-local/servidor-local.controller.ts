import { Body, Controller, Get, Headers, HttpCode, Ip, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import { ServidorLocalService } from './servidor-local.service';
import { PonteService } from './ponte.service';
import { Publico } from '../common/decorators/publico.decorator';
import { Requer } from '../common/decorators/requer.decorator';

@Controller()
export class ServidorLocalController {
  constructor(private readonly service: ServidorLocalService, private readonly ponte: PonteService) {}

  // ----- nuvem: usadas pelos servidores locais -----
  @Publico() @Get('publico/servidor-local/chave-publica')
  chave() { return this.service.chavePublica(); }

  @Publico() @Post('publico/servidor-local/licenca/:empresaId') @HttpCode(200)
  licenca(@Param('empresaId') id: string, @Headers('x-servidor-token') token: string | undefined, @Body() corpo: { versao?: string }, @Ip() ip: string, @Headers('x-forwarded-for') fwd?: string) {
    return this.service.emitirLicenca(id, token, { versao: corpo?.versao, ip: (fwd?.split(',')[0] ?? ip ?? '').trim() });
  }

  @Publico() @Get('publico/servidor-local/dados/:empresaId')
  async dados(@Param('empresaId') id: string, @Headers('x-servidor-token') token: string | undefined, @Res() res: any) {
    const b = await this.service.dadosIniciais(id, token);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.end(b);
  }

  // ----- /vb (chave mestra) -----
  @Publico() @Post('licenca/:empresaId/servidor-local') @HttpCode(200)
  gerar(@Headers('x-chave-mestra') chave: string | undefined, @Param('empresaId', ParseUUIDPipe) id: string) { return this.service.gerarCodigo(chave, id); }

  @Publico() @Get('licenca/servidores-locais')
  servidores(@Headers('x-chave-mestra') chave?: string) { return this.service.situacaoServidores(chave); }

  // ----- nuvem: ponte com os servidores locais -----
  @Publico() @Get('publico/ponte/:empresaId/eventos')
  eventos(@Param('empresaId') id: string, @Headers('x-servidor-token') token?: string) { return this.ponte.eventos(id, token); }

  @Publico() @Post('publico/ponte/:empresaId/eventos/confirmar') @HttpCode(200)
  confirmar(@Param('empresaId') id: string, @Headers('x-servidor-token') token: string | undefined, @Body() corpo: { ids?: string[] }) {
    return this.ponte.confirmar(id, token, (corpo?.ids ?? []).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 200));
  }

  @Publico() @Post('publico/ponte/:empresaId/espelho') @HttpCode(200)
  espelho(@Param('empresaId') id: string, @Headers('x-servidor-token') token: string | undefined, @Req() req: { body: unknown }) { return this.ponte.receberEspelho(id, token, req.body as Buffer); }

  @Publico() @Post('publico/ponte/:empresaId/backup') @HttpCode(200)
  backup(@Param('empresaId') id: string, @Headers('x-servidor-token') token: string | undefined, @Req() req: { body: unknown }) { return this.ponte.receberBackup(id, token, req.body as Buffer); }

  // ----- servidor local -----
  @Publico() @Get('servidor-local/status')
  async status() {
    const s = await this.service.status();
    return { ...s, ponte: await this.ponte.statusPonte(), webNuvem: process.env.VB_NUVEM_WEB || 'https://vb-hoteis-frontend-production.up.railway.app' };
  }

  @Post('servidor-local/sincronizar') @HttpCode(200) @Requer('empresa.editar')
  async sincronizar() { await this.ponte.sincronizar(true); return this.ponte.statusPonte(); }

  @Publico() @Post('servidor-local/ativar') @HttpCode(200)
  ativar(@Body() corpo: { codigo?: string; nuvemUrl?: string }) { return this.service.ativar(String(corpo?.codigo ?? ''), corpo?.nuvemUrl); }

  @Post('servidor-local/renovar') @HttpCode(200) @Requer('empresa.editar')
  async renovar() { await this.service.renovar(); return this.service.status(); }
}
