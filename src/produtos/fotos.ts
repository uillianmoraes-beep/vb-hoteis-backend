import { BadRequestException, Body, Controller, Get, Injectable, Logger, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query, Res, StreamableFile } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { promises as fs } from 'fs';
import { dirname, join, normalize, sep } from 'path';
import { randomUUID } from 'crypto';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { Publico } from '../common/decorators/publico.decorator';
import { UsuarioToken } from '../common/permissoes';

/**
 * Fotos dos produtos e dos tipos de enxoval: o sistema busca sozinho (código de barras e nome no Open Food Facts,
 * fotos da Wikipédia/Wikimedia), o gestor escolhe outra ou manda a dele. A foto fica na pasta do servidor
 * (VB_FOTOS_DIR/<empresa>/produtos) e é aberta sem login (não tem nada sigiloso), para aparecer também no cardápio do quarto.
 */

type Alvo = 'produto' | 'enxoval';
const TABELA: Record<Alvo, string> = { produto: 'produtos', enxoval: 'enxoval_tipos' };
const ARQUIVO = /^[0-9a-f-]{36}\.(jpg|png|webp)$/;
const MIME: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const MAX = 4 * 1024 * 1024;
/** só baixa imagem destes endereços (o que a busca devolve) */
const HOSTS = ['images.openfoodfacts.org', 'upload.wikimedia.org', 'thumb.wikimedia.org'];
const UA = 'VBHoteis/1.0 (sistema de hotelaria; contato: suporte VB)';
/** palavras que não ajudam a comparar nomes */
const SEM_PESO = new Set(['com', 'sem', 'lata', 'long', 'neck', 'garrafa', 'pet', 'unidade', 'porcao', 'para', 'del', 'the', 'and']);

export interface Candidato { url: string; fonte: string; titulo: string }

const Termos = z.object({
  itens: z.array(z.object({
    n: z.number().int().describe('o número do item na lista'),
    ingles: z.string().describe('2 a 5 palavras em inglês para achar uma foto do item (ex.: "sirloin steak french fries", "bath towel")'),
    embalado: z.boolean().describe('true se é produto industrializado de supermercado (bebida, lata, garrafa, pacote)'),
  })),
});

/** palavras que contam para comparar nomes (sem acento, 3 letras ou mais) */
const palavras = (t: string) => new Set(t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter((p) => p.length >= 3 && !SEM_PESO.has(p)));

export const urlFoto = (empresaId: string, foto: string | null | undefined) => (foto ? `/fotos-produto/${empresaId}/${foto}` : null);

@Injectable()
export class FotosProdutoService {
  private readonly log = new Logger('Fotos');
  private readonly ia = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

  constructor(private readonly ds: DataSource) {}

  private pasta() {
    const p = (process.env.VB_FOTOS_DIR || '').trim();
    if (!p) throw new BadRequestException('A pasta de arquivos não está configurada neste servidor (VB_FOTOS_DIR). Fale com a Virtual Barra.');
    return normalize(p);
  }
  private caminho(empresaId: string, arquivo: string) {
    if (!/^[0-9a-f-]{36}$/.test(empresaId) || !ARQUIVO.test(arquivo)) throw new NotFoundException('Foto não encontrada.');
    const base = this.pasta();
    const abs = normalize(join(base, empresaId, 'produtos', arquivo));
    if (!abs.startsWith(base.endsWith(sep) ? base : base + sep)) throw new NotFoundException('Foto não encontrada.');
    return abs;
  }

  async abrir(empresaId: string, arquivo: string) {
    try { return { bin: await fs.readFile(this.caminho(empresaId, arquivo)), mime: MIME[arquivo.split('.').pop()!] }; } catch { throw new NotFoundException('Foto não encontrada.'); }
  }

  /* ---------------- busca ---------------- */

  private async json(url: string): Promise<Record<string, unknown> | null> {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
      if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return null;
      return (await r.json()) as Record<string, unknown>;
    } catch { return null; }
  }

  private async openFood(q: string, n: number): Promise<Candidato[]> {
    const u = new URL('https://search.openfoodfacts.org/search');
    u.searchParams.set('q', q); u.searchParams.set('page_size', String(n * 2)); u.searchParams.set('sort_by', '-unique_scans_n');
    u.searchParams.set('fields', 'product_name,image_front_url');
    const d = await this.json(u.toString());
    // pelo nome, só o que tem pelo menos metade das palavras do item (senão vem qualquer coisa do supermercado)
    const pedidas = palavras(q.replace(/countries_tags:\S+/, ''));
    const combina = (titulo: string) => {
      if (q.startsWith('code:') || !pedidas.size) return true;
      const t = palavras(titulo);
      return [...pedidas].filter((p) => t.has(p)).length * 2 >= pedidas.size;
    };
    return ((d?.hits as Record<string, string>[] | undefined) ?? []).filter((h) => h.image_front_url && combina(h.product_name ?? ''))
      .slice(0, n).map((h) => ({ url: h.image_front_url, fonte: 'Open Food Facts', titulo: h.product_name || q }));
  }

  private async wikipedia(q: string, n: number): Promise<Candidato[]> {
    const u = new URL('https://pt.wikipedia.org/w/api.php');
    for (const [k, v] of Object.entries({ action: 'query', generator: 'search', gsrsearch: q, gsrlimit: String(n + 2), prop: 'pageimages', piprop: 'thumbnail', pithumbsize: '400', format: 'json' })) u.searchParams.set(k, v);
    const d = await this.json(u.toString());
    const paginas = Object.values(((d?.query as Record<string, unknown> | undefined)?.pages ?? {}) as Record<string, { index: number; title: string; thumbnail?: { source: string } }>);
    // artigo sem nenhuma palavra do nome é ruído da busca (ex.: um presidente para "contra-filé")
    const pedidas = palavras(q);
    const toca = (t: string) => !pedidas.size || [...palavras(t)].some((p) => pedidas.has(p) || [...pedidas].some((x) => x.startsWith(p) || p.startsWith(x)));
    return paginas.filter((p) => p.thumbnail?.source && toca(p.title)).sort((a, b) => a.index - b.index).slice(0, n)
      .map((p) => ({ url: p.thumbnail!.source, fonte: 'Wikipédia', titulo: p.title }));
  }

  private async commons(q: string, n: number): Promise<Candidato[]> {
    const u = new URL('https://commons.wikimedia.org/w/api.php');
    for (const [k, v] of Object.entries({ action: 'query', generator: 'search', gsrnamespace: '6', gsrsearch: `${q} filetype:bitmap`, gsrlimit: String(n + 2), prop: 'imageinfo', iiprop: 'url', iiurlwidth: '400', format: 'json' })) u.searchParams.set(k, v);
    const d = await this.json(u.toString());
    const paginas = Object.values(((d?.query as Record<string, unknown> | undefined)?.pages ?? {}) as Record<string, { index: number; title: string; imageinfo?: { thumburl?: string }[] }>);
    return paginas.filter((p) => p.imageinfo?.[0]?.thumburl).sort((a, b) => a.index - b.index).slice(0, n)
      .map((p) => ({ url: p.imageinfo![0].thumburl!, fonte: 'Wikimedia', titulo: p.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, '') }));
  }

  /** palavras em inglês para a busca de fotos (uma chamada para vários itens); sem IA, nada */
  private async termos(nomes: string[]): Promise<Map<number, { ingles: string; embalado: boolean }>> {
    const m = new Map<number, { ingles: string; embalado: boolean }>();
    if (!this.ia || !nomes.length) return m;
    try {
      const r = await this.ia.messages.parse({
        model: 'claude-haiku-5-5',
        max_tokens: 2000,
        output_config: { format: zodOutputFormat(Termos) },
        system: 'Você ajuda a achar fotos de itens vendidos ou usados em motéis e hotéis no Brasil (bebidas, pratos, porções, itens de enxoval). '
          + 'Para cada item, dê palavras em inglês que achem uma boa foto do item sozinho num banco de imagens e diga se é produto embalado de supermercado.',
        messages: [{ role: 'user', content: nomes.map((n, i) => `${i + 1}. ${n}`).join('\n') }],
      });
      for (const x of r.parsed_output?.itens ?? []) if (x.n >= 1 && x.n <= nomes.length && x.ingles.trim()) m.set(x.n - 1, { ingles: x.ingles.trim().slice(0, 80), embalado: x.embalado });
    } catch (e) { this.log.warn(`IA indisponível para as fotos: ${e instanceof Error ? e.message : e}`); }
    return m;
  }

  private async procurar(nome: string, barras: string | null, alvo: Alvo, termo?: { ingles: string; embalado: boolean }, n = 8): Promise<Candidato[]> {
    const tarefas: Promise<Candidato[]>[] = [];
    if (alvo === 'produto') {
      if (barras && /^\d{8,14}$/.test(barras)) tarefas.push(this.openFood(`code:${barras}`, 1));
      if (!termo || termo.embalado) tarefas.push(this.openFood(`${nome} countries_tags:"en:brazil"`, 3));
    }
    if (termo) tarefas.push(this.commons(termo.ingles, 4));
    tarefas.push(this.wikipedia(nome, 3));
    const listas = await Promise.all(tarefas);
    const vistos = new Set<string>();
    return listas.flat().filter((c) => !vistos.has(c.url) && !!vistos.add(c.url)).slice(0, n);
  }

  private async item(u: UsuarioToken, alvo: Alvo, id: string) {
    const [x] = await this.ds.query(`SELECT * FROM ${TABELA[alvo]} WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!x) throw new NotFoundException(alvo === 'produto' ? 'Produto não encontrado.' : 'Tipo de enxoval não encontrado.');
    return x as Record<string, string | null>;
  }

  async buscar(u: UsuarioToken, alvo: Alvo, id: string, texto?: string) {
    const x = await this.item(u, alvo, id);
    const nome = (texto?.trim() || String(x.nome)).slice(0, 120);
    const t = await this.termos([nome]);
    return { candidatos: await this.procurar(nome, texto?.trim() ? null : x.codigo_barras ?? null, alvo, t.get(0)), ia: !!this.ia };
  }

  /* ---------------- gravar ---------------- */

  private async baixar(url: string): Promise<{ bin: Buffer; ext: string }> {
    let alvo: URL;
    try { alvo = new URL(url); } catch { throw new BadRequestException('Endereço da foto inválido.'); }
    if (alvo.protocol !== 'https:' || !HOSTS.includes(alvo.hostname)) throw new BadRequestException('Essa foto não vem de uma fonte aceita.');
    let r: Response;
    try { r = await fetch(alvo, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) }); } catch { throw new BadRequestException('Não consegui baixar a foto. Tente outra.'); }
    if (!r.ok || !HOSTS.includes(new URL(r.url).hostname)) throw new BadRequestException('Não consegui baixar a foto. Tente outra.');
    const tipo = (r.headers.get('content-type') ?? '').split(';')[0].trim();
    const ext = Object.entries(MIME).find(([, v]) => v === tipo)?.[0];
    if (!ext) throw new BadRequestException('Esse arquivo não é uma foto JPG, PNG ou WEBP.');
    const bin = Buffer.from(await r.arrayBuffer());
    if (!bin.length || bin.length > MAX) throw new BadRequestException('Foto vazia ou grande demais.');
    return { bin, ext };
  }

  private async gravar(empresaId: string, bin: Buffer, ext: string) {
    const arquivo = `${randomUUID()}.${ext}`;
    const abs = this.caminho(empresaId, arquivo);
    await fs.mkdir(dirname(abs), { recursive: true });
    await fs.writeFile(abs, bin);
    return arquivo;
  }

  private async trocar(empresaId: string, alvo: Alvo, id: string, arquivo: string | null, antiga: string | null, origem: string | null) {
    await this.ds.query(`UPDATE ${TABELA[alvo]} SET foto = $3, foto_origem = $4 WHERE id = $1 AND empresa_id = $2`, [id, empresaId, arquivo, origem]);
    if (antiga && antiga !== arquivo) await fs.rm(this.caminho(empresaId, antiga), { force: true }).catch(() => undefined);
  }

  async salvar(u: UsuarioToken, alvo: Alvo, id: string, dto: { url?: string; dataUrl?: string; remover?: boolean }) {
    const x = await this.item(u, alvo, id);
    if (dto.remover) {
      // tirou a foto: a busca automática não põe outra sozinha
      await this.trocar(u.empresaId, alvo, id, null, x.foto, 'removida');
      return { foto: null, fotoUrl: null };
    }
    let arquivo: string;
    if (dto.dataUrl) {
      const m = /^data:(image\/jpeg|image\/png|image\/webp);base64,/.exec(dto.dataUrl);
      if (!m) throw new BadRequestException('A foto tem que ser JPG, PNG ou WEBP.');
      const bin = Buffer.from(dto.dataUrl.slice(m[0].length), 'base64');
      if (!bin.length || bin.length > MAX) throw new BadRequestException('Foto vazia ou grande demais.');
      arquivo = await this.gravar(u.empresaId, bin, Object.entries(MIME).find(([, v]) => v === m[1])![0]);
    } else if (dto.url) {
      const b = await this.baixar(dto.url);
      arquivo = await this.gravar(u.empresaId, b.bin, b.ext);
    } else throw new BadRequestException('Escolha uma foto.');
    await this.trocar(u.empresaId, alvo, id, arquivo, x.foto, 'manual');
    return { foto: arquivo, fotoUrl: urlFoto(u.empresaId, arquivo) };
  }

  /**
   * Busca sozinho para os itens sem foto, de pouco em pouco (a tela chama de novo enquanto faltar).
   * Item que não achou fica marcado e não é tentado de novo; o gestor põe a foto à mão.
   */
  async automatico(u: UsuarioToken, alvo: Alvo, refazer = false) {
    this.pasta();
    const t = TABELA[alvo];
    if (refazer) await this.ds.query(`UPDATE ${t} SET foto_origem = NULL WHERE empresa_id = $1 AND foto IS NULL AND foto_origem = 'nao_achou'`, [u.empresaId]);
    const extra = alvo === 'produto' ? `AND tipo = 'produto' AND uso = 'venda'` : '';
    const lote: Record<string, string | null>[] = await this.ds.query(
      `SELECT * FROM ${t} WHERE empresa_id = $1 AND ativo AND foto IS NULL AND foto_origem IS NULL ${extra} ORDER BY nome LIMIT 12`, [u.empresaId]);
    const termos = await this.termos(lote.map((x) => String(x.nome)));
    let achou = 0, naoAchou = 0;
    await Promise.all(lote.map(async (x, i) => {
      const c = await this.procurar(String(x.nome), x.codigo_barras ?? null, alvo, termos.get(i), 3);
      for (const cand of c) {
        try {
          const b = await this.baixar(cand.url);
          const arquivo = await this.gravar(u.empresaId, b.bin, b.ext);
          await this.trocar(u.empresaId, alvo, String(x.id), arquivo, null, 'auto');
          achou++;
          return;
        } catch { /* tenta a próxima */ }
      }
      await this.ds.query(`UPDATE ${t} SET foto_origem = 'nao_achou' WHERE id = $1`, [x.id]);
      naoAchou++;
    }));
    const [f] = await this.ds.query(`SELECT count(*)::int AS n FROM ${t} WHERE empresa_id = $1 AND ativo AND foto IS NULL AND foto_origem IS NULL ${extra}`, [u.empresaId]);
    return { achou, naoAchou, faltam: Number(f?.n ?? 0) };
  }
}

class SalvarFotoDto {
  @IsOptional() @IsString() @MaxLength(1000) url?: string;
  @IsOptional() @IsString() @MaxLength(7_000_000) dataUrl?: string;
  @IsOptional() remover?: boolean;
}
class AutomaticoDto {
  @IsIn(['produto', 'enxoval']) alvo!: Alvo;
  @IsOptional() refazer?: boolean;
}
const alvoOk = (a: string): Alvo => { if (a !== 'produto' && a !== 'enxoval') throw new NotFoundException(); return a; };
const GERENCIAR = ['produtos.gerenciar', 'enxoval.gerenciar'] as const;

@Controller('fotos-produto')
export class FotosProdutoController {
  constructor(private readonly service: FotosProdutoService) {}

  /** a foto em si: sem login (aparece também no cardápio do quarto) */
  @Get(':empresaId/:arquivo')
  @Publico()
  async abrir(@Param('empresaId') empresaId: string, @Param('arquivo') arquivo: string, @Res({ passthrough: true }) res: { setHeader: (k: string, v: string) => void }) {
    const f = await this.service.abrir(empresaId, arquivo);
    res.setHeader('Content-Type', f.mime);
    // o nome muda quando troca a foto, então pode guardar por bastante tempo
    res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
    return new StreamableFile(f.bin);
  }

  @Get('buscar/:alvo/:id')
  @Requer(...GERENCIAR)
  buscar(@Usuario() u: UsuarioToken, @Param('alvo') alvo: string, @Param('id', ParseUUIDPipe) id: string, @Query('q') q?: string) {
    return this.service.buscar(u, alvoOk(alvo), id, q);
  }

  @Put(':alvo/:id')
  @Requer(...GERENCIAR)
  salvar(@Usuario() u: UsuarioToken, @Param('alvo') alvo: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SalvarFotoDto) {
    return this.service.salvar(u, alvoOk(alvo), id, dto);
  }

  @Post('automatico')
  @Requer(...GERENCIAR)
  automatico(@Usuario() u: UsuarioToken, @Body() dto: AutomaticoDto) {
    return this.service.automatico(u, dto.alvo, !!dto.refazer);
  }
}
