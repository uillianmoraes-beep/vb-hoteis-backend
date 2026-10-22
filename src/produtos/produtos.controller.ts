import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, StreamableFile } from '@nestjs/common';
import { ProdutosService } from './produtos.service';
import { ImportarProdutosDto, AmbientesEmLoteDto, AtualizarProdutoDto, CriarProdutoDto, RenomearGrupoDto, SalvarFichaDto } from './produtos.dto';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

@Controller('produtos')
export class ProdutosController {
  constructor(private readonly service: ProdutosService) {}

  @Get()
  @Requer('produtos.gerenciar', 'estadias.operar')
  listar(@Usuario() u: UsuarioToken, @Query('inativos') inativos?: string, @Query('busca') busca?: string, @Query('uso') uso?: string, @Query('ambienteId') ambienteId?: string) {
    return this.service.listar(u.empresaId, { inativos: inativos === 'true', busca, uso, ambienteId });
  }

  /** "Usar também em…" (ou tirar de) um ambiente, para vários produtos */
  @Put('ambientes')
  @Requer('produtos.gerenciar')
  ambientesEmLote(@Usuario() u: UsuarioToken, @Body() dto: AmbientesEmLoteDto) {
    return this.service.ambientesEmLote(u.empresaId, dto);
  }

  /** planilha modelo (Excel) para importar produtos */
  @Get('importacao/modelo')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Requer('produtos.gerenciar')
  async modeloImportacao(@Usuario() u: UsuarioToken) {
    return new StreamableFile(await this.service.modeloImportacao(u.empresaId), { disposition: 'attachment; filename="modelo-produtos.xlsx"' });
  }

  /** todos os produtos (com a tributação) na planilha de importação */
  @Get('exportar')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Requer('produtos.gerenciar')
  async exportar(@Usuario() u: UsuarioToken) {
    return new StreamableFile(await this.service.exportar(u.empresaId), { disposition: 'attachment; filename="produtos.xlsx"' });
  }

  /** importa a planilha (simular = só a prévia) */
  @Post('importacao')
  @HttpCode(200)
  @Requer('produtos.gerenciar')
  importar(@Usuario() u: UsuarioToken, @Body() dto: ImportarProdutosDto) {
    return this.service.importar(u.empresaId, u.nome, dto.arquivo, !!dto.simular, { usadoEm: dto.usadoEm, localId: dto.localId });
  }

  @Get('grupos')
  @Requer('produtos.gerenciar', 'estoque.gerenciar')
  grupos(@Usuario() u: UsuarioToken) {
    return this.service.grupos(u.empresaId);
  }

  @Put('grupos')
  @Requer('produtos.gerenciar')
  renomearGrupo(@Usuario() u: UsuarioToken, @Body() dto: RenomearGrupoDto) {
    return this.service.renomearGrupo(u.empresaId, dto);
  }

  @Post()
  @Requer('produtos.gerenciar')
  criar(@Usuario() u: UsuarioToken, @Body() dto: CriarProdutoDto) {
    return this.service.criar(u.empresaId, dto);
  }

  /** ficha técnica (ingredientes que baixam do estoque ao vender) */
  @Get(':id/ficha')
  @Requer('produtos.gerenciar')
  ficha(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.ficha(u.empresaId, id);
  }

  @Put(':id/ficha')
  @Requer('produtos.gerenciar')
  salvarFicha(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SalvarFichaDto) {
    return this.service.salvarFicha(u.empresaId, id, dto);
  }

  @Patch(':id')
  @Requer('produtos.gerenciar')
  atualizar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AtualizarProdutoDto) {
    return this.service.atualizar(u.empresaId, id, dto);
  }

  @Delete(':id')
  @Requer('produtos.gerenciar')
  desativar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.desativar(u.empresaId, id);
  }
}
