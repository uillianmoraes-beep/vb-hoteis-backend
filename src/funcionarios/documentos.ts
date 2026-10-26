import { BadRequestException, Body, Controller, Delete, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Res, StreamableFile } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { promises as fs } from 'fs';
import { dirname, join, normalize, sep } from 'path';
import { randomUUID } from 'crypto';
import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

/**
 * Documentos do funcionário em PDF (ou foto do documento): RG, CPF, CTPS, contrato, exames (ASO)…
 * O arquivo fica na pasta do servidor (VB_FOTOS_DIR, a mesma das fotos, sem prazo de apagar) e o banco guarda o caminho.
 * Documento com validade (exame periódico, CNH) avisa quando vence.
 */

export const TIPOS_DOCUMENTO = {
  rg: 'RG', cpf: 'CPF', ctps: 'Carteira de trabalho (CTPS)', contrato: 'Contrato de trabalho', aso: 'Exame médico (ASO)', atestado: 'Atestado médico',
  residencia: 'Comprovante de residência', titulo: 'Título de eleitor', reservista: 'Reservista', cnh: 'CNH',
  certidao: 'Certidão (nascimento/casamento)', filhos: 'Documentos dos filhos', escolaridade: 'Escolaridade/cursos',
  advertencia: 'Advertência/suspensão', ferias: 'Aviso/recibo de férias', holerite: 'Holerite / recibo de pagamento', rescisao: 'Rescisão',
  pis: 'PIS / NIS', registro: 'Ficha de registro do empregado', vt: 'Termo do vale-transporte (opção ou recusa)', lgpd: 'Termo de uso de dados (LGPD)',
  salario_familia: 'Termo do salário-família', dependentes_ir: 'Declaração de dependentes (IR)', compensacao: 'Acordo de compensação / banco de horas',
  ficha_epi: 'Ficha de EPI assinada', ponto: 'Espelho de ponto assinado', ppp: 'PPP (perfil profissiográfico)', aviso_previo: 'Aviso prévio / pedido de demissão',
  trct: 'TRCT (termo de rescisão)', fgts: 'Guia / extrato do FGTS', seguro_desemprego: 'Guias do seguro-desemprego', outro: 'Outro',
} as const;
const TIPOS_ARQUIVO: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };
const MAX_BYTES = 8_000_000;

class DocumentoDto {
  @IsIn(Object.keys(TIPOS_DOCUMENTO)) tipo!: keyof typeof TIPOS_DOCUMENTO;
  @IsOptional() @IsString() @MaxLength(120) descricao?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) validade?: string;
  @IsString() @MinLength(1) @MaxLength(160) nomeArquivo!: string;
  /** data:application/pdf;base64,… (ou foto jpeg/png do documento) */
  @IsString() @MaxLength(11_000_000) arquivo!: string;
}

const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const dia = (v: unknown) => (v ? (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)) : null);

@Injectable()
export class DocumentosService {
  constructor(private readonly ds: DataSource) {}

  private pasta() {
    const p = (process.env.VB_FOTOS_DIR || '').trim();
    if (!p) throw new BadRequestException('A pasta de arquivos não está configurada neste servidor (VB_FOTOS_DIR). Fale com a Virtual Barra.');
    return p;
  }

  /** caminho absoluto (nunca sai da pasta) */
  private caminho(relativo: string) {
    const base = normalize(this.pasta());
    const abs = normalize(join(base, relativo));
    if (!abs.startsWith(base.endsWith(sep) ? base : base + sep)) throw new NotFoundException('Documento não encontrado.');
    return abs;
  }

  private async funcionario(u: UsuarioToken, id: string) {
    const [f] = await this.ds.query(`SELECT id, nome FROM funcionarios WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!f) throw new NotFoundException('Funcionário não encontrado.');
    return f as { id: string; nome: string };
  }

  async listar(u: UsuarioToken, funcionarioId: string) {
    await this.funcionario(u, funcionarioId);
    const hoje = hojeSP();
    const l = await this.ds.query(
      `SELECT id, tipo, descricao, validade, nome_arquivo, mime, bytes, enviado_por, criado_em FROM funcionario_documentos
        WHERE empresa_id = $1 AND funcionario_id = $2 ORDER BY tipo, criado_em DESC`, [u.empresaId, funcionarioId]);
    return {
      tipos: TIPOS_DOCUMENTO,
      documentos: l.map((d: Record<string, unknown>) => {
        const validade = dia(d.validade);
        return {
          id: d.id, tipo: d.tipo, tipoNome: TIPOS_DOCUMENTO[d.tipo as keyof typeof TIPOS_DOCUMENTO] ?? d.tipo, descricao: d.descricao, validade,
          vencido: !!validade && validade < hoje, nomeArquivo: d.nome_arquivo, mime: d.mime, bytes: Number(d.bytes), enviadoPor: d.enviado_por, criadoEm: d.criado_em,
        };
      }),
    };
  }

  async enviar(u: UsuarioToken, funcionarioId: string, dto: DocumentoDto) {
    await this.funcionario(u, funcionarioId);
    const m = /^data:([a-z/]+);base64,/.exec(dto.arquivo);
    const ext = m ? TIPOS_ARQUIVO[m[1]] : undefined;
    if (!m || !ext) throw new BadRequestException('Envie o documento em PDF (ou uma foto JPG/PNG).');
    const bin = Buffer.from(dto.arquivo.slice(m[0].length), 'base64');
    if (!bin.length) throw new BadRequestException('O arquivo está vazio.');
    if (bin.length > MAX_BYTES) throw new BadRequestException('Arquivo grande demais (máximo 8 MB).');
    if (ext === 'pdf' && bin.subarray(0, 5).toString('latin1') !== '%PDF-') throw new BadRequestException('Esse arquivo não é um PDF de verdade.');
    const id = randomUUID();
    const rel = join(u.empresaId, 'funcionarios', funcionarioId, `${id}.${ext}`);
    await fs.mkdir(dirname(this.caminho(rel)), { recursive: true });
    await fs.writeFile(this.caminho(rel), bin);
    await this.ds.query(
      `INSERT INTO funcionario_documentos (id, empresa_id, funcionario_id, tipo, descricao, validade, nome_arquivo, mime, arquivo, bytes, enviado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, u.empresaId, funcionarioId, dto.tipo, dto.descricao?.trim() || null, dto.validade || null, dto.nomeArquivo.trim().slice(0, 160), m[1], rel, bin.length, u.nome]);
    return { ok: true, id };
  }

  async ler(u: UsuarioToken, funcionarioId: string, docId: string) {
    const [d] = await this.ds.query(`SELECT arquivo, mime, nome_arquivo FROM funcionario_documentos WHERE id = $1 AND funcionario_id = $2 AND empresa_id = $3`, [docId, funcionarioId, u.empresaId]);
    if (!d) throw new NotFoundException('Documento não encontrado.');
    try {
      return { bin: await fs.readFile(this.caminho(d.arquivo)), mime: d.mime as string, nome: d.nome_arquivo as string };
    } catch {
      throw new NotFoundException('O arquivo não está mais na pasta do servidor.');
    }
  }

  async apagar(u: UsuarioToken, funcionarioId: string, docId: string) {
    const [d] = await this.ds.query(`SELECT arquivo FROM funcionario_documentos WHERE id = $1 AND funcionario_id = $2 AND empresa_id = $3`, [docId, funcionarioId, u.empresaId]);
    if (!d) throw new NotFoundException('Documento não encontrado.');
    await this.ds.query(`DELETE FROM funcionario_documentos WHERE id = $1`, [docId]);
    await fs.rm(this.caminho(d.arquivo), { force: true }).catch(() => undefined);
    return { ok: true };
  }
}

@Controller('funcionarios')
export class DocumentosController {
  constructor(private readonly service: DocumentosService) {}

  @Get(':id/documentos')
  @Requer('funcionarios.gerenciar', 'funcionarios.financeiro')
  listar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.listar(u, id);
  }

  @Post(':id/documentos')
  @Requer('funcionarios.gerenciar')
  enviar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DocumentoDto) {
    return this.service.enviar(u, id, dto);
  }

  @Get(':id/documentos/:doc')
  @Requer('funcionarios.gerenciar', 'funcionarios.financeiro')
  async abrir(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Param('doc', ParseUUIDPipe) doc: string, @Res({ passthrough: true }) res: { setHeader: (k: string, v: string) => void }) {
    const a = await this.service.ler(u, id, doc);
    res.setHeader('Content-Type', a.mime);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(a.nome)}`);
    return new StreamableFile(a.bin);
  }

  @Delete(':id/documentos/:doc')
  @Requer('funcionarios.gerenciar')
  apagar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Param('doc', ParseUUIDPipe) doc: string) {
    return this.service.apagar(u, id, doc);
  }
}
