import { BadRequestException, Body, Controller, Delete, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Query, Res, StreamableFile } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { IsIn, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { dirname, join, normalize, sep } from 'path';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';
import { LeitorContadorService } from './leitor';

/**
 * Área do contador (login próprio, perfil Contador): o que ele entrega no mês (folha, guias de FGTS, INSS, DAS…)
 * com o arquivo, o valor e o vencimento — o administrativo vê o que falta e lança a guia nas contas a pagar com um clique —
 * e as notas do mês para ele baixar: saídas emitidas, pendentes, desfeitas, entradas (NF-e de compra) e estornos.
 */

export const TIPOS_ENTREGA = {
  folha: { nome: 'Folha de pagamento / holerites', obrigatorio: true, categoria: 'Salários e encargos' },
  fgts: { nome: 'Guia do FGTS (FGTS Digital)', obrigatorio: true, categoria: 'Salários e encargos' },
  inss: { nome: 'Guia do INSS (DCTFWeb)', obrigatorio: true, categoria: 'Salários e encargos' },
  das: { nome: 'DAS do Simples Nacional', obrigatorio: true, categoria: 'Impostos e taxas' },
  irrf: { nome: 'DARF do imposto de renda (IRRF)', obrigatorio: false, categoria: 'Impostos e taxas' },
  iss: { nome: 'Guia do ISS', obrigatorio: false, categoria: 'Impostos e taxas' },
  icms: { nome: 'Guia do ICMS', obrigatorio: false, categoria: 'Impostos e taxas' },
  ferias: { nome: 'Recibos de férias', obrigatorio: false, categoria: 'Salários e encargos' },
  rescisao: { nome: 'Rescisão (TRCT, guia do FGTS rescisório)', obrigatorio: false, categoria: 'Salários e encargos' },
  balancete: { nome: 'Balancete / relatórios contábeis', obrigatorio: false, categoria: 'Contabilidade' },
  outro: { nome: 'Outro documento', obrigatorio: false, categoria: 'Contabilidade' },
} as const;
type TipoEntrega = keyof typeof TIPOS_ENTREGA;

const COMPETENCIA = /^\d{4}-(0[1-9]|1[0-2])$/;
const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const dia = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);
const somaMes = (c: string, k: number) => { const [a, m] = c.split('-').map(Number); const t = a * 12 + m - 1 + k; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };
const r2 = (v: number) => Math.round(v * 100) / 100;

class EntregaDto {
  @Matches(COMPETENCIA) competencia!: string;
  @IsIn(Object.keys(TIPOS_ENTREGA)) tipo!: TipoEntrega;
  @IsOptional() @IsString() @MaxLength(200) descricao?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100_000_000) valor?: number;
  @IsOptional() @Matches(/^(\d{4}-\d{2}-\d{2})?$/) vencimento?: string;
  @IsString() @MaxLength(11_000_000) arquivo!: string;
  @IsOptional() @IsString() @MaxLength(160) nomeArquivo?: string;
}

@Injectable()
export class AreaContadorService {
  constructor(private readonly ds: DataSource, private readonly leitor: LeitorContadorService) {}

  private pasta() {
    const p = (process.env.VB_FOTOS_DIR || '').trim();
    if (!p) throw new BadRequestException('A pasta de arquivos não está configurada neste servidor (VB_FOTOS_DIR). Fale com a Virtual Barra.');
    return normalize(p);
  }
  private caminho(rel: string) {
    const base = this.pasta();
    const abs = normalize(join(base, rel));
    if (!abs.startsWith(base.endsWith(sep) ? base : base + sep)) throw new NotFoundException('Arquivo não encontrado.');
    return abs;
  }

  async entregas(u: UsuarioToken, competenciaQ?: string) {
    const competencia = competenciaQ && COMPETENCIA.test(competenciaQ) ? competenciaQ : somaMes(hojeSP().slice(0, 7), -1);
    const l: Record<string, unknown>[] = await this.ds.query(
      `SELECT e.*, c.status AS conta_status FROM contador_entregas e LEFT JOIN contas_pagar c ON c.id = e.conta_pagar_id WHERE e.empresa_id = $1 AND e.competencia = $2 ORDER BY e.criado_em`,
      [u.empresaId, competencia]);
    const lista = l.map((e) => ({
      id: e.id as string, tipo: e.tipo as string, tipoNome: TIPOS_ENTREGA[e.tipo as TipoEntrega]?.nome ?? e.tipo, descricao: e.descricao, valor: e.valor === null ? null : Number(e.valor),
      vencimento: dia(e.vencimento), nomeArquivo: e.nome_arquivo, enviadoPor: e.enviado_por, em: e.criado_em, contaPagarId: e.conta_pagar_id ?? null, contaStatus: e.conta_status ?? null,
    }));
    const tem = new Set(lista.map((e) => e.tipo));
    return {
      competencia, tipos: TIPOS_ENTREGA, lista,
      faltando: (Object.keys(TIPOS_ENTREGA) as TipoEntrega[]).filter((k) => TIPOS_ENTREGA[k].obrigatorio && !tem.has(k)).map((k) => TIPOS_ENTREGA[k].nome),
      total: r2(lista.reduce((s, e) => s + (e.valor ?? 0), 0)),
    };
  }

  async enviar(u: UsuarioToken, dto: EntregaDto) {
    const a = this.leitor.arquivo(dto.arquivo);
    const rel = join(u.empresaId, 'contador', 'entregas', `${randomUUID()}.${a.ext}`);
    await fs.mkdir(dirname(this.caminho(rel)), { recursive: true });
    await fs.writeFile(this.caminho(rel), a.bin);
    const [r] = await this.ds.query(
      `INSERT INTO contador_entregas (empresa_id, competencia, tipo, descricao, valor, vencimento, arquivo, mime, nome_arquivo, bytes, enviado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [u.empresaId, dto.competencia, dto.tipo, dto.descricao?.trim() || null, dto.valor ?? null, dto.vencimento || null, rel, a.mime, (dto.nomeArquivo || `${dto.tipo}.${a.ext}`).slice(0, 160), a.bin.length, u.nome]);
    return { ok: true, id: r.id };
  }

  async arquivo(u: UsuarioToken, id: string) {
    const [e] = await this.ds.query(`SELECT arquivo, mime, nome_arquivo FROM contador_entregas WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!e) throw new NotFoundException('Arquivo não encontrado.');
    try { return { bin: await fs.readFile(this.caminho(e.arquivo)), mime: e.mime as string, nome: e.nome_arquivo as string }; } catch { throw new NotFoundException('O arquivo não está mais na pasta do servidor.'); }
  }

  async apagar(u: UsuarioToken, id: string) {
    const [e] = await this.ds.query(`SELECT arquivo, conta_pagar_id FROM contador_entregas WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!e) throw new NotFoundException('Arquivo não encontrado.');
    if (e.conta_pagar_id) throw new BadRequestException('Esta guia já foi lançada nas contas a pagar: cancele a conta antes.');
    await this.ds.query(`DELETE FROM contador_entregas WHERE id = $1`, [id]);
    await fs.rm(this.caminho(e.arquivo), { force: true }).catch(() => undefined);
    return { ok: true };
  }

  /** lança a guia nas contas a pagar (valor e vencimento da entrega) */
  async lancar(u: UsuarioToken, id: string) {
    const [e] = await this.ds.query(`SELECT * FROM contador_entregas WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!e) throw new NotFoundException('Arquivo não encontrado.');
    if (e.conta_pagar_id) throw new BadRequestException('Já lançada nas contas a pagar.');
    if (!e.valor || !e.vencimento) throw new BadRequestException('Coloque o valor e o vencimento da guia antes de lançar.');
    const t = TIPOS_ENTREGA[e.tipo as TipoEntrega] ?? TIPOS_ENTREGA.outro;
    const comp = String(e.competencia).split('-').reverse().join('/');
    const [c] = await this.ds.query(
      `INSERT INTO contas_pagar (empresa_id, descricao, fornecedor, categoria, valor, vencimento, observacao, criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [u.empresaId, `${t.nome} ${comp}`.slice(0, 200), 'Contabilidade (guia)', t.categoria, e.valor, dia(e.vencimento), `enviado pelo contador (${e.enviado_por ?? '—'})${e.descricao ? ` · ${e.descricao}` : ''}`.slice(0, 300), u.nome]);
    await this.ds.query(`UPDATE contador_entregas SET conta_pagar_id = $2 WHERE id = $1`, [id, c.id]);
    return { ok: true, contaId: c.id };
  }

  /** notas do mês para o contador */
  async notas(u: UsuarioToken, competenciaQ?: string) {
    const competencia = competenciaQ && COMPETENCIA.test(competenciaQ) ? competenciaQ : somaMes(hojeSP().slice(0, 7), -1);
    const tz = `AT TIME ZONE 'America/Sao_Paulo'`;
    const ini = `${competencia}-01`, fim = `${somaMes(competencia, 1)}-01`;
    const entre = (col: string) => `${col} >= ($2::date)::timestamp ${tz} AND ${col} < ($3::date)::timestamp ${tz}`;
    const p = [u.empresaId, ini, fim];
    const q = (sql: string) => this.ds.query(sql, p).catch(() => []);
    const [emitidas, partes, pendentesContas, desfeitas, entradas, estornos, fatEmitidas, fatPendentes] = await Promise.all([
      q(`SELECT e.id, e.numero AS uso, e.nota_numero AS nota, e.nota_emitida_em AS em, e.nota_emitida_por AS por, e.valor_total AS valor, e.nota_documento AS documento, e.nota_nome AS nome, a.nome AS ambiente, a.cnpj
           FROM estadias e JOIN ambientes a ON a.id = e.ambiente_id WHERE e.empresa_id = $1 AND e.nota_status = 'emitida' AND ${entre('e.nota_emitida_em')} AND NOT EXISTS (SELECT 1 FROM estadia_notas n WHERE n.estadia_id = e.id) ORDER BY e.nota_emitida_em`),
      q(`SELECT n.id, e.numero AS uso, n.numero AS nota, n.emitida_em AS em, n.emitida_por AS por, n.valor, n.documento, n.nome, n.parte, a.nome AS ambiente, a.cnpj
           FROM estadia_notas n JOIN estadias e ON e.id = n.estadia_id JOIN ambientes a ON a.id = e.ambiente_id WHERE n.empresa_id = $1 AND n.status = 'emitida' AND ${entre('n.emitida_em')} ORDER BY n.emitida_em`),
      q(`SELECT e.id, e.numero AS uso, e.saida_em AS em, e.valor_total AS valor, e.nota_documento AS documento, e.nota_nome AS nome, a.nome AS ambiente
           FROM estadias e JOIN ambientes a ON a.id = e.ambiente_id WHERE e.empresa_id = $1 AND e.nota_status = 'pendente' AND e.status = 'fechada' AND ${entre('e.saida_em')} ORDER BY e.saida_em`),
      q(`SELECT v.criado_em AS em, v.usuario_nome AS por, v.descricao, e.numero AS uso FROM estadia_eventos v JOIN estadias e ON e.id = v.estadia_id
          WHERE v.empresa_id = $1 AND v.tipo = 'nota' AND v.descricao ILIKE '%desfeita%' AND ${entre('v.criado_em')} ORDER BY v.criado_em`),
      q(`SELECT chave_nfe AS chave, max(fornecedor) AS fornecedor, max(descricao) AS descricao, sum(valor) AS valor, min(vencimento) AS vencimento, count(*)::int AS parcelas, min(criado_em) AS lancada_em, max(cnpj) AS cnpj
           FROM contas_pagar WHERE empresa_id = $1 AND chave_nfe IS NOT NULL AND status <> 'cancelada' AND ${entre('criado_em')} GROUP BY chave_nfe ORDER BY min(criado_em)`),
      q(`SELECT i.descricao, i.quantidade, i.total, i.motivo_estorno AS motivo, i.estornado_por AS por, e.numero AS uso, i.criado_em AS em FROM estadia_itens i JOIN estadias e ON e.id = i.estadia_id
          WHERE i.empresa_id = $1 AND i.status = 'estornado' AND ${entre('i.criado_em')} ORDER BY i.criado_em`),
      // faturas de empresa: a nota sai pela fatura (uma nota para o mês do cliente)
      q(`SELECT f.id, f.numero, f.nota_numero AS nota, f.nota_emitida_em AS em, f.nota_emitida_por AS por, f.valor, c.documento, c.nome, f.cnpj
           FROM faturas f JOIN clientes_faturados c ON c.id = f.cliente_id WHERE f.empresa_id = $1 AND f.nota_status = 'emitida' AND f.status <> 'cancelada' AND ${entre('f.nota_emitida_em')} ORDER BY f.nota_emitida_em`),
      q(`SELECT f.id, f.numero, f.emissao AS em, f.valor, c.documento, c.nome FROM faturas f JOIN clientes_faturados c ON c.id = f.cliente_id
          WHERE f.empresa_id = $1 AND f.nota_status = 'pendente' AND f.status <> 'cancelada' AND f.emissao >= $2::date AND f.emissao < $3::date ORDER BY f.emissao`),
    ]);
    const pendentes = [
      ...pendentesContas,
      ...fatPendentes.map((x: Record<string, unknown>) => ({ id: x.id, uso: `fatura ${x.numero ?? ''}`.trim(), em: x.em, valor: x.valor, documento: x.documento, nome: x.nome, ambiente: 'Faturamento' })),
    ];
    const n = (v: unknown) => Number(v ?? 0);
    const saidas = [
      ...emitidas.map((x: Record<string, unknown>) => ({ tipo: 'conta', nota: x.nota, em: x.em, por: x.por, valor: n(x.valor), documento: x.documento, nome: x.nome, ambiente: x.ambiente, cnpj: x.cnpj, uso: x.uso })),
      ...fatEmitidas.map((x: Record<string, unknown>) => ({ tipo: 'fatura', nota: x.nota, em: x.em, por: x.por, valor: n(x.valor), documento: x.documento, nome: x.nome, ambiente: 'Faturamento', cnpj: x.cnpj, uso: `fatura ${x.numero ?? ''}`.trim() })),
      ...partes.map((x: Record<string, unknown>) => ({ tipo: x.parte === 'consumo' ? 'consumo' : 'parte', nota: x.nota, em: x.em, por: x.por, valor: n(x.valor), documento: x.documento, nome: x.nome, ambiente: x.ambiente, cnpj: x.cnpj, uso: x.uso })),
    ].sort((a, b) => String(a.em).localeCompare(String(b.em)));
    return {
      competencia, saidas, pendentes: pendentes.map((x: Record<string, unknown>) => ({ ...x, valor: n(x.valor) })), desfeitas,
      entradas: entradas.map((x: Record<string, unknown>) => ({ ...x, valor: n(x.valor) })), estornos: estornos.map((x: Record<string, unknown>) => ({ ...x, total: n(x.total), quantidade: n(x.quantidade) })),
      totais: {
        saidas: r2(saidas.reduce((s, x) => s + x.valor, 0)), pendentes: r2(pendentes.reduce((s: number, x: Record<string, unknown>) => s + n(x.valor), 0)),
        entradas: r2(entradas.reduce((s: number, x: Record<string, unknown>) => s + n(x.valor), 0)), estornos: r2(estornos.reduce((s: number, x: Record<string, unknown>) => s + n(x.total), 0)),
      },
    };
  }

  /** para o sino do administrativo: do dia 15 em diante, o que o contador ainda não entregou do mês passado */
  async faltando(empresaId: string) {
    const hoje = hojeSP();
    if (Number(hoje.slice(8, 10)) < 15) return { competencia: null as string | null, nomes: [] as string[] };
    const r = await this.entregas({ empresaId } as UsuarioToken);
    // só avisa quem usa a área (já recebeu alguma entrega algum dia)
    const [usa] = await this.ds.query(`SELECT 1 FROM contador_entregas WHERE empresa_id = $1 LIMIT 1`, [empresaId]);
    return { competencia: r.competencia, nomes: usa ? r.faltando : [] };
  }
}

const ACESSO = ['contador.acessar', 'funcionarios.gerenciar', 'funcionarios.financeiro', 'caixa.adm', 'relatorios.ver', 'notas.gerenciar'] as const;

@Controller('contador')
export class AreaContadorController {
  constructor(private readonly service: AreaContadorService) {}

  @Get('entregas')
  @Requer(...ACESSO)
  entregas(@Usuario() u: UsuarioToken, @Query('competencia') competencia?: string) {
    return this.service.entregas(u, competencia);
  }

  @Post('entregas')
  @Requer(...ACESSO)
  enviar(@Usuario() u: UsuarioToken, @Body() dto: EntregaDto) {
    return this.service.enviar(u, dto);
  }

  @Get('entregas/:id/arquivo')
  @Requer(...ACESSO)
  async arquivo(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: { setHeader: (k: string, v: string) => void }) {
    const a = await this.service.arquivo(u, id);
    res.setHeader('Content-Type', a.mime);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(a.nome)}`);
    return new StreamableFile(a.bin);
  }

  @Delete('entregas/:id')
  @Requer(...ACESSO)
  apagar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.apagar(u, id);
  }

  @Post('entregas/:id/lancar')
  @Requer('caixa.adm', 'despesas.gerenciar')
  lancar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.lancar(u, id);
  }

  @Get('notas')
  @Requer(...ACESSO)
  notas(@Usuario() u: UsuarioToken, @Query('competencia') competencia?: string) {
    return this.service.notas(u, competencia);
  }
}
