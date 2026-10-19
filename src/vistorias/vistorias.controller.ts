import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, StreamableFile } from '@nestjs/common';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';
import { VistoriasService } from './vistorias.service';
import { AguaService } from './agua.service';
import { FotosService } from './fotos.service';
import { montarPlanilha } from './planilha';
import { AguaLocalDto, AguaRegistroDto, ConfigVistoriaDto, DecisaoDto, FotoDto, VistoriaDto } from './vistorias.dto';

/** Menu Vistoriadoras / Revisões: vistorias das suítes e quartos, piscinas e hidros, cadastros. */
@Controller('vistorias')
export class VistoriasController {
  constructor(private readonly service: VistoriasService, private readonly agua: AguaService, private readonly fotos: FotosService) {}

  /* ---------- fotos ---------- */

  @Post('fotos')
  @Requer('vistorias.fazer', 'piscinas.registrar')
  enviarFoto(@Usuario() u: UsuarioToken, @Body() dto: FotoDto) {
    return this.fotos.salvar(u, dto);
  }

  @Get('fotos/:id')
  @Header('Content-Type', 'image/jpeg')
  @Header('Cache-Control', 'private, max-age=86400')
  @Requer('vistorias.fazer', 'vistorias.decidir', 'vistorias.relatorio', 'piscinas.registrar')
  async foto(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Query('mini') mini?: string) {
    return new StreamableFile(await this.fotos.ler(u, id, mini === '1'));
  }

  /* ---------- cadastros ---------- */

  @Get('config/:ambienteId')
  @Requer('vistorias.fazer', 'vistorias.configurar')
  config(@Usuario() u: UsuarioToken, @Param('ambienteId', ParseUUIDPipe) ambienteId: string) {
    return this.service.config(u, ambienteId);
  }

  @Put('config/:ambienteId')
  @Requer('vistorias.configurar')
  salvarConfig(@Usuario() u: UsuarioToken, @Param('ambienteId', ParseUUIDPipe) ambienteId: string, @Body() dto: ConfigVistoriaDto) {
    return this.service.salvarConfig(u, ambienteId, dto);
  }

  /* ---------- vistoria ---------- */

  @Get('pendentes')
  @Requer('vistorias.fazer', 'vistorias.decidir')
  pendentes(@Usuario() u: UsuarioToken, @Query('ambienteId') ambienteId?: string) {
    return this.service.pendentes(u, ambienteId && /^[0-9a-f-]{36}$/i.test(ambienteId) ? ambienteId : undefined);
  }

  @Get('unidade/:unidadeId')
  @Requer('vistorias.fazer')
  preparar(@Usuario() u: UsuarioToken, @Param('unidadeId', ParseUUIDPipe) unidadeId: string) {
    return this.service.preparar(u, unidadeId);
  }

  @Post()
  @Requer('vistorias.fazer')
  registrar(@Usuario() u: UsuarioToken, @Body() dto: VistoriaDto) {
    return this.service.registrar(u, dto);
  }

  @Post(':id/decidir')
  @HttpCode(200)
  @Requer('vistorias.decidir')
  decidir(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisaoDto) {
    return this.service.decidir(u, id, dto);
  }

  @Post(':id/ciente')
  @HttpCode(200)
  @Requer('vistorias.decidir')
  ciente(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.ciente(u, id);
  }

  @Get('historico')
  @Requer('vistorias.relatorio', 'vistorias.decidir')
  historico(@Usuario() u: UsuarioToken, @Query() q: Record<string, string>) {
    return this.service.listar(u, q);
  }

  /** planilha (Excel) com as fotos em miniatura e o link para a foto inteira */
  @Get('planilha')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Requer('vistorias.relatorio')
  async planilha(@Usuario() u: UsuarioToken, @Query() q: Record<string, string>) {
    const r = await this.service.listar(u, q, 1500);
    const origem = /^https?:\/\/[^\s/]+$/.test(q.origem ?? '') ? q.origem : null;
    const buf = await montarPlanilha(r.lista as never, r, {
      titulo: `Vistorias de ${r.periodo.de.split('-').reverse().join('/')} a ${r.periodo.ate.split('-').reverse().join('/')}`,
      linkFoto: (id) => (origem ? `${origem}/foto/${id}` : null),
      miniatura: (id) => this.fotos.miniatura(u.empresaId, id),
    });
    return new StreamableFile(buf, { disposition: `attachment; filename="vistorias-${r.periodo.de}-a-${r.periodo.ate}.xlsx"` });
  }

  /* ---------- piscinas e hidros ---------- */

  @Get('agua/locais')
  @Requer('piscinas.registrar', 'vistorias.configurar')
  aguaLocais(@Usuario() u: UsuarioToken, @Query('todos') todos?: string) {
    return this.agua.locais(u, todos === '1');
  }

  @Post('agua/locais')
  @Requer('vistorias.configurar')
  criarLocal(@Usuario() u: UsuarioToken, @Body() dto: AguaLocalDto) {
    return this.agua.criarLocal(u, dto);
  }

  @Patch('agua/locais/:id')
  @Requer('vistorias.configurar')
  atualizarLocal(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AguaLocalDto) {
    return this.agua.atualizarLocal(u, id, dto);
  }

  @Delete('agua/locais/:id')
  @Requer('vistorias.configurar')
  excluirLocal(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.agua.excluirLocal(u, id);
  }

  @Post('agua')
  @Requer('piscinas.registrar')
  registrarAgua(@Usuario() u: UsuarioToken, @Body() dto: AguaRegistroDto) {
    return this.agua.registrar(u, dto);
  }

  @Get('agua/historico')
  @Requer('piscinas.registrar', 'vistorias.relatorio')
  historicoAgua(@Usuario() u: UsuarioToken, @Query() q: Record<string, string>) {
    return this.agua.historico(u, q);
  }
}
