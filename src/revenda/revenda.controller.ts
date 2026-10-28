import { Body, Controller, Get, HttpCode, Ip, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, Res, StreamableFile } from '@nestjs/common';
import { createReadStream } from 'fs';
import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Publico } from '../common/decorators/publico.decorator';
import { UsuarioToken } from '../common/permissoes';
import { IDIOMAS, RevendaService, Situacao } from './revenda.service';

class TesteDto {
  @IsString() @MinLength(2) @MaxLength(150) empresa!: string;
  @IsString() @MinLength(2) @MaxLength(120) nome!: string;
  @IsEmail({}, { message: 'E-mail inválido.' }) @MaxLength(120) email!: string;
  @IsString() @MinLength(10, { message: 'Telefone com DDD.' }) @MaxLength(20) telefone!: string;
  @IsString() @MinLength(6, { message: 'A senha precisa ter pelo menos 6 caracteres.' }) @MaxLength(60) senha!: string;
  @IsIn(['motel', 'hotel', 'pousada', 'outro']) tipo!: string;
  @IsOptional() @IsString() @MaxLength(80) cidade?: string;
  @IsOptional() @IsIn(Object.keys(IDIOMAS)) idioma?: string;
  @IsBoolean() aceite!: boolean;
}
class ContratarDto {
  @IsUUID() planoId!: string;
  @IsString() @MaxLength(20) documento!: string;
  @IsEmail({}, { message: 'E-mail inválido.' }) email!: string;
  @IsOptional() @IsInt() @Min(1) @Max(28) diaVencimento?: number;
}
class ChamadoDto {
  @IsString() @MinLength(3) @MaxLength(150) assunto!: string;
  @IsOptional() @IsIn(['duvida', 'erro', 'pedido', 'financeiro']) categoria?: string;
  @IsString() @MinLength(3) @MaxLength(5000) texto!: string;
  @IsOptional() @IsString() @MaxLength(150) tela?: string;
  @IsOptional() @IsString() @MaxLength(4000) respostaIa?: string;
}
class TextoDto { @IsString() @MinLength(1) @MaxLength(5000) texto!: string }
class SugerirDto {
  @IsString() @MinLength(3) @MaxLength(2000) pergunta!: string;
  @IsOptional() @IsString() @MaxLength(10000) trechos?: string;
  @IsOptional() @IsString() @MaxLength(150) tela?: string;
}
class ErroDto {
  @IsString() @MinLength(1) @MaxLength(2000) mensagem!: string;
  @IsOptional() @IsString() @MaxLength(4000) detalhe?: string;
  @IsOptional() @IsString() @MaxLength(300) tela?: string;
}
class TraduzirDto {
  @IsIn(Object.keys(IDIOMAS)) idioma!: string;
  @IsArray() @ArrayMaxSize(80) @IsString({ each: true }) textos!: string[];
}
class IdiomaDto { @IsIn(Object.keys(IDIOMAS)) idioma!: string }
class ClienteDto {
  @IsOptional() @IsUUID() planoId?: string | null;
  @IsOptional() @IsIn(['teste', 'demo', 'ativa', 'atrasada', 'bloqueada', 'suspensa', 'cancelada']) situacao?: Situacao;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) testeAte?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(28) diaVencimento?: number;
  @IsOptional() @IsNumber() @Min(0) valor?: number | null;
  @IsOptional() @IsString() @MaxLength(2000) observacao?: string | null;
  @IsOptional() @IsObject() modulos?: Record<string, boolean>;
  @IsOptional() @IsBoolean() aplicarModulosDoPlano?: boolean;
}
class NovoClienteDto {
  @IsString() @MinLength(2) @MaxLength(150) empresa!: string;
  @IsString() @MinLength(2) @MaxLength(120) nome!: string;
  @IsString() @MinLength(3) @MaxLength(120) login!: string;
  @IsString() @MinLength(6) @MaxLength(60) senha!: string;
  @IsOptional() @IsString() @MaxLength(20) telefone?: string;
  @IsOptional() @IsString() @MaxLength(120) email?: string;
  @IsBoolean() exemplos!: boolean;
  @IsBoolean() demonstracao!: boolean;
  @IsOptional() @IsUUID() planoId?: string;
  @IsOptional() @IsInt() @Min(1) @Max(120) testeDias?: number;
}
class PassoDto {
  @IsString() @MaxLength(30) passo!: string;
  @IsOptional() @IsBoolean() feito?: boolean;
  @IsOptional() @IsString() @MaxLength(300) obs?: string | null;
}
class PlanoDto {
  @IsString() @MinLength(2) @MaxLength(60) nome!: string;
  @IsOptional() @IsString() @MaxLength(400) descricao?: string | null;
  @IsNumber() @Min(0) preco!: number;
  @IsObject() modulos!: Record<string, boolean>;
  @IsOptional() @IsInt() @Min(1) limiteUnidades?: number | null;
  @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) itens!: string[];
  @IsBoolean() destaque!: boolean;
  @IsBoolean() ativo!: boolean;
  @IsOptional() @IsInt() ordem?: number;
}
class MensalidadeDto {
  @IsUUID() empresaId!: string;
  @Matches(/^\d{4}-\d{2}$/) competencia!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) vencimento!: string;
  @IsNumber() @Min(1) valor!: number;
  @IsOptional() @IsString() @MaxLength(120) descricao?: string;
}
class BaixaDto {
  @IsIn(['pagar', 'cancelar', 'reabrir']) acao!: 'pagar' | 'cancelar' | 'reabrir';
  @IsOptional() @IsString() @MaxLength(20) forma?: string;
  @IsOptional() @IsString() @MaxLength(200) observacao?: string;
}
class RespostaDto {
  @IsOptional() @IsString() @MaxLength(5000) texto?: string;
  @IsOptional() @IsIn(['aberto', 'respondido', 'aguardando', 'fechado']) situacao?: string;
}
class ResolverDto {
  @IsBoolean() resolvido!: boolean;
  @IsOptional() @IsString() @MaxLength(3000) solucao?: string | null;
}
class DownloadDto {
  @IsString() @MaxLength(20) categoria!: string;
  @IsString() @MinLength(2) @MaxLength(120) nome!: string;
  @IsOptional() @IsString() @MaxLength(400) descricao?: string | null;
  @IsOptional() @IsString() @MaxLength(500) url?: string | null;
  @IsOptional() @IsString() @MaxLength(30) versao?: string | null;
  @IsBoolean() publico!: boolean;
  @IsBoolean() ativo!: boolean;
  @IsOptional() @IsInt() ordem?: number;
}
class ConfigDto {
  @IsInt() @Min(1) @Max(90) testeDias!: number;
  @IsInt() @Min(0) @Max(60) diasAviso!: number;
  @IsInt() @Min(1) @Max(120) diasBloqueio!: number;
  @IsOptional() @IsString() @MaxLength(20) whatsapp?: string | null;
  @IsOptional() @IsString() @MaxLength(120) email?: string | null;
  @IsOptional() @IsObject() textos?: Record<string, string>;
}

type Resposta = { setHeader: (k: string, v: string) => void };
const disposicao = (nome: string) => `attachment; filename="${nome.replace(/"/g, '')}"`;

/** site de vendas, teste grátis e downloads públicos */
@Controller('publico/revenda')
export class RevendaPublicoController {
  constructor(private readonly s: RevendaService) {}

  @Publico() @Get('planos') planos() { return this.s.planosPublicos(); }

  @Publico() @Post('teste') @HttpCode(200)
  teste(@Body() dto: TesteDto, @Ip() ip: string, @Req() req: { headers: Record<string, string | undefined> }) {
    if (!dto.aceite) return { ok: false, message: 'É preciso aceitar os termos.' };
    const real = (req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || ip;
    return this.s.criarTeste(dto, real);
  }

  @Publico() @Get('downloads') downloads() { return this.s.downloadsPublicos(); }

  @Publico() @Get('downloads/:id/baixar')
  async baixar(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Resposta) {
    const a = await this.s.arquivoDownload(id, true);
    res.setHeader('Content-Disposition', disposicao(a.nome));
    return new StreamableFile(createReadStream(a.abs));
  }
}

/** área do cliente (qualquer empresa) */
@Controller('area-cliente')
export class AreaClienteController {
  constructor(private readonly s: RevendaService) {}

  @Get() area(@Usuario() u: UsuarioToken) { return this.s.area(u); }
  @Get('sessao') sessao(@Usuario() u: UsuarioToken) { return this.s.infoSessao(u.empresaId); }
  @Post('contratar') @HttpCode(200) contratar(@Usuario() u: UsuarioToken, @Body() dto: ContratarDto) { return this.s.contratar(u, dto); }
  @Post('mensalidades/:id/pagar') @HttpCode(200) pagar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.s.pagar(u, id); }

  @Get('suporte') chamados(@Usuario() u: UsuarioToken) { return this.s.chamados(u); }
  @Get('suporte/nao-lidos') async naoLidos(@Usuario() u: UsuarioToken) { return { n: await this.s.naoLidosCliente(u.empresaId) }; }
  @Post('suporte') abrir(@Usuario() u: UsuarioToken, @Body() dto: ChamadoDto) { return this.s.abrirChamado(u, dto); }
  @Post('suporte/sugerir') @HttpCode(200) sugerir(@Usuario() u: UsuarioToken, @Body() dto: SugerirDto) { return this.s.sugerir(u, dto); }
  @Get('suporte/:id') ver(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.s.verChamado(u, id); }
  @Post('suporte/:id/mensagem') @HttpCode(200) responder(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TextoDto) { return this.s.responderCliente(u, id, dto.texto); }

  @Get('downloads/:id/baixar')
  async baixar(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Resposta) {
    const a = await this.s.arquivoDownload(id, false);
    res.setHeader('Content-Disposition', disposicao(a.nome));
    return new StreamableFile(createReadStream(a.abs));
  }

  /** erro que aconteceu no site (o sistema agrupa e a Virtual Barra vê no painel) */
  @Post('erros') @HttpCode(200)
  erro(@Usuario() u: UsuarioToken, @Body() dto: ErroDto) {
    return this.s.registrarErro({ origem: 'site', mensagem: dto.mensagem, detalhe: dto.detalhe, tela: dto.tela, empresaId: u.empresaId, usuario: u.nome });
  }

  @Post('traducao') @HttpCode(200) traduzir(@Usuario() u: UsuarioToken, @Body() dto: TraduzirDto) { return this.s.traduzir(u, dto); }
  @Put('idioma') idioma(@Usuario() u: UsuarioToken, @Body() dto: IdiomaDto) { return this.s.idioma(u, dto.idioma); }
}

/** painel da revenda (só a Virtual Barra) */
@Controller('revenda')
export class RevendaController {
  constructor(private readonly s: RevendaService) {}

  @Get('clientes') clientes(@Usuario() u: UsuarioToken) { return this.s.clientes(u); }
  @Post('clientes') criar(@Usuario() u: UsuarioToken, @Body() dto: NovoClienteDto) { return this.s.criarCliente(u, dto); }
  @Patch('clientes/:id') atualizar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ClienteDto) { return this.s.atualizarCliente(u, id, dto); }
  @Get('clientes/:id/implantacao') implantacao(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.s.implantacaoCliente(u, id); }
  @Put('clientes/:id/implantacao') marcar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PassoDto) { return this.s.marcarImplantacao(u, id, dto); }

  @Get('planos') planos(@Usuario() u: UsuarioToken) { return this.s.planos(u); }
  @Post('planos') novoPlano(@Usuario() u: UsuarioToken, @Body() dto: PlanoDto) { return this.s.salvarPlano(u, null, dto); }
  @Put('planos/:id') plano(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PlanoDto) { return this.s.salvarPlano(u, id, dto); }

  @Get('mensalidades') mensalidades(@Usuario() u: UsuarioToken, @Query('mes') mes?: string) { return this.s.mensalidades(u, mes); }
  @Post('mensalidades') gerar(@Usuario() u: UsuarioToken, @Body() dto: MensalidadeDto) { return this.s.gerarMensalidadeManual(u, dto); }
  @Post('mensalidades/:id') @HttpCode(200) baixa(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BaixaDto) { return this.s.baixarMensalidade(u, id, dto); }
  @Post('rotina') @HttpCode(200) async rotina(@Usuario() u: UsuarioToken) { await this.s.exigirPlataforma(u); await this.s.rotina(); return { ok: true }; }

  @Get('suporte') chamados(@Usuario() u: UsuarioToken, @Query('situacao') situacao?: string) { return this.s.chamadosPlataforma(u, situacao); }
  @Get('suporte/:id') chamado(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.s.verChamadoPlataforma(u, id); }
  @Post('suporte/:id') @HttpCode(200) responder(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RespostaDto) { return this.s.responderSuporte(u, id, dto); }

  @Get('erros') erros(@Usuario() u: UsuarioToken, @Query('todos') todos?: string) { return this.s.erros(u, todos === '1'); }
  @Put('erros/:id') resolver(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolverDto) { return this.s.resolverErro(u, id, dto); }

  @Get('downloads') downloads(@Usuario() u: UsuarioToken) { return this.s.downloadsPlataforma(u); }
  @Post('downloads') novoDownload(@Usuario() u: UsuarioToken, @Body() dto: DownloadDto) { return this.s.salvarDownload(u, null, dto); }
  @Put('downloads/:id') download(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DownloadDto) { return this.s.salvarDownload(u, id, dto); }
  /** corpo = o arquivo (application/octet-stream), até 300 MB */
  @Post('downloads/:id/arquivo') @HttpCode(200)
  arquivo(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Query('nome') nome: string, @Req() req: { body: Buffer }) {
    return this.s.enviarArquivo(u, id, String(nome ?? 'arquivo'), req.body);
  }

  @Get('config') config(@Usuario() u: UsuarioToken) { return this.s.config(u); }
  @Put('config') salvarConfig(@Usuario() u: UsuarioToken, @Body() dto: ConfigDto) { return this.s.salvarConfig(u, dto); }
}
