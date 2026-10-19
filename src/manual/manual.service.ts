import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { promises as fs } from 'fs';
import { join, normalize } from 'path';
import { PrintManualDto } from './manual.dto';

const TELA = /^[a-z0-9-]{1,40}$/;
const JPEG = /^data:image\/jpeg;base64,/;

export interface PrintManual { tela: string; legenda: string; marcas: { x: number; y: number; texto: string }[]; atualizadoEm: string }

/**
 * Prints do manual de utilização ("Gerar prints automaticamente"): um por tela e por empresa,
 * na pasta das fotos (VB_FOTOS_DIR/manual/<empresa>/<tela>.jpg + .json com legenda e bolinhas).
 * Não entram no prazo de guarda das fotos da vistoria: ficam até serem gerados de novo.
 */
@Injectable()
export class ManualService {
  private pasta(empresaId: string) {
    const base = (process.env.VB_FOTOS_DIR || '').trim();
    if (!base) throw new BadRequestException('A pasta das fotos não está configurada neste servidor (VB_FOTOS_DIR). Fale com a Virtual Barra.');
    return normalize(join(base, 'manual', empresaId));
  }

  private tela(tela: string) {
    if (!TELA.test(tela)) throw new NotFoundException('Tela não encontrada.');
    return tela;
  }

  async listar(empresaId: string): Promise<PrintManual[]> {
    if (!(process.env.VB_FOTOS_DIR || '').trim()) return [];
    const dir = this.pasta(empresaId);
    let arquivos: string[] = [];
    try { arquivos = await fs.readdir(dir); } catch { return []; }
    const lista: PrintManual[] = [];
    for (const a of arquivos.filter((x) => x.endsWith('.json'))) {
      try {
        const dados = JSON.parse(await fs.readFile(join(dir, a), 'utf8')) as PrintManual;
        if (arquivos.includes(`${dados.tela}.jpg`)) lista.push(dados);
      } catch { /* arquivo estragado: ignora */ }
    }
    return lista;
  }

  async ler(empresaId: string, tela: string) {
    try {
      return await fs.readFile(join(this.pasta(empresaId), `${this.tela(tela)}.jpg`));
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      throw new NotFoundException('Print não encontrado.');
    }
  }

  async salvar(empresaId: string, tela: string, dto: PrintManualDto): Promise<PrintManual> {
    this.tela(tela);
    if (!JPEG.test(dto.imagem)) throw new BadRequestException('O print tem que ser JPEG.');
    const bin = Buffer.from(dto.imagem.replace(JPEG, ''), 'base64');
    if (bin.length > 2_200_000) throw new BadRequestException('Print grande demais.');
    const dir = this.pasta(empresaId);
    await fs.mkdir(dir, { recursive: true });
    const dados: PrintManual = {
      tela, legenda: dto.legenda.trim().slice(0, 80),
      marcas: dto.marcas.map((m) => ({ x: Math.round(m.x * 10) / 10, y: Math.round(m.y * 10) / 10, texto: m.texto.trim().slice(0, 200) })),
      atualizadoEm: new Date().toISOString(),
    };
    await fs.writeFile(join(dir, `${tela}.jpg`), bin);
    await fs.writeFile(join(dir, `${tela}.json`), JSON.stringify(dados));
    return dados;
  }

  async apagar(empresaId: string, tela: string) {
    const dir = this.pasta(empresaId);
    this.tela(tela);
    await fs.rm(join(dir, `${tela}.jpg`), { force: true });
    await fs.rm(join(dir, `${tela}.json`), { force: true });
    return { ok: true };
  }
}
