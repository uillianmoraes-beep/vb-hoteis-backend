import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ComprasService } from './compras.service';
import { AdicionarFornecedoresDto, CotacaoDto, EscolhasDto, FornecedorDto, ModeloDto, ReceberDto, RespostaDto } from './compras.dto';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { Publico } from '../common/decorators/publico.decorator';
import { UsuarioToken } from '../common/permissoes';

const tk = (t: string) => t.replace(/[^a-f0-9]/gi, '').slice(0, 32);

@Controller()
export class ComprasController {
  constructor(private readonly service: ComprasService) {}

  // link que o fornecedor abre (sem login)
  @Publico() @Get('publico/cotacao/:token')
  publico(@Param('token') t: string) { return this.service.publico(tk(t)); }

  @Publico() @Post('publico/cotacao/:token') @HttpCode(200)
  responder(@Param('token') t: string, @Body() dto: RespostaDto) { return this.service.responderPublico(tk(t), dto); }

  @Get('fornecedores') @Requer('compras.gerenciar', 'estoque.gerenciar', 'despesas.gerenciar')
  fornecedores(@Usuario() u: UsuarioToken, @Query('todos') todos?: string) { return this.service.fornecedores(u, todos === 'true'); }

  @Post('fornecedores') @Requer('compras.gerenciar')
  criarFornecedor(@Usuario() u: UsuarioToken, @Body() dto: FornecedorDto) { return this.service.criarFornecedor(u, dto); }

  @Put('fornecedores/:id') @Requer('compras.gerenciar')
  atualizarFornecedor(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: FornecedorDto) { return this.service.atualizarFornecedor(u, id, dto); }

  @Get('cotacoes') @Requer('compras.gerenciar')
  listar(@Usuario() u: UsuarioToken, @Query('status') status?: string) { return this.service.listar(u, status); }

  @Post('cotacoes') @Requer('compras.gerenciar')
  criar(@Usuario() u: UsuarioToken, @Body() dto: CotacaoDto) { return this.service.criar(u, dto); }

  @Get('cotacoes/:id') @Requer('compras.gerenciar')
  detalhe(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.detalhe(u, id); }

  @Post('cotacoes/:id/fornecedores') @HttpCode(200) @Requer('compras.gerenciar')
  adicionar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AdicionarFornecedoresDto) { return this.service.adicionarFornecedores(u, id, dto); }

  @Delete('cotacoes/:id/fornecedores/:cfId') @Requer('compras.gerenciar')
  remover(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Param('cfId', ParseUUIDPipe) cfId: string) { return this.service.removerFornecedor(u, id, cfId); }

  @Put('cotacoes/:id/precos/:cfId') @Requer('compras.gerenciar')
  precos(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Param('cfId', ParseUUIDPipe) cfId: string, @Body() dto: RespostaDto) { return this.service.responderInterno(u, id, cfId, dto); }

  @Post('cotacoes/:id/escolher') @HttpCode(200) @Requer('compras.gerenciar')
  escolher(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EscolhasDto) { return this.service.escolher(u, id, dto); }

  @Post('cotacoes/:id/menor-preco') @HttpCode(200) @Requer('compras.gerenciar')
  menor(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.melhorPreco(u, id); }

  @Post('cotacoes/:id/fechar') @HttpCode(200) @Requer('compras.gerenciar')
  fechar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.fechar(u, id); }

  @Post('cotacoes/:id/cancelar') @HttpCode(200) @Requer('compras.gerenciar')
  cancelar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.cancelar(u, id); }

  @Post('cotacoes/:id/reabrir') @HttpCode(200) @Requer('compras.gerenciar')
  reabrir(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.reabrir(u, id); }

  @Get('cotacoes/:id/pedido/:cfId') @Requer('compras.gerenciar')
  pedido(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Param('cfId', ParseUUIDPipe) cfId: string) { return this.service.pedido(u, id, cfId); }

  @Post('cotacoes/:id/receber/:cfId') @HttpCode(200) @Requer('compras.gerenciar')
  receber(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Param('cfId', ParseUUIDPipe) cfId: string, @Body() dto: ReceberDto) { return this.service.receber(u, id, cfId, dto); }

  // histórico de preços e listas padrão (fora de /cotacoes/:id para não confundir com o id)
  @Get('compras/precos') @Requer('compras.gerenciar')
  historico(@Usuario() u: UsuarioToken, @Query('busca') busca?: string) { return this.service.historicoPrecos(u, busca); }

  @Get('compras/produtos') @Requer('compras.gerenciar')
  produtosParaCotar(@Usuario() u: UsuarioToken, @Query('grupo') grupo?: string) { return this.service.produtosParaCotar(u, grupo?.trim() || undefined); }

  @Get('compras/grupos') @Requer('compras.gerenciar')
  gruposParaCotar(@Usuario() u: UsuarioToken) { return this.service.gruposParaCotar(u); }

  @Get('compras/listas') @Requer('compras.gerenciar')
  modelos(@Usuario() u: UsuarioToken) { return this.service.modelos(u); }

  @Post('compras/listas') @Requer('compras.gerenciar')
  salvarModelo(@Usuario() u: UsuarioToken, @Body() dto: ModeloDto) { return this.service.salvarModelo(u, dto); }

  @Delete('compras/listas/:id') @Requer('compras.gerenciar')
  excluirModelo(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.excluirModelo(u, id); }
}
