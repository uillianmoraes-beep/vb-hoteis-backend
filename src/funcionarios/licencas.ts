import { BadRequestException, Body, Controller, Delete, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

/**
 * Licenças e afastamentos: aparecem sozinhos na escala, avisam a volta e entram nas contas de férias e 13º.
 * Afastamento pelo INSS: os 15 primeiros dias a empresa paga; do 16º em diante o INSS paga (esses dias não contam
 * para o 13º da empresa, e mais de 6 meses no período aquisitivo fazem perder as férias — CLT art. 133, IV).
 */
export const TIPOS_LICENCA = {
  maternidade: { nome: 'Licença-maternidade', dias: 120 },
  paternidade: { nome: 'Licença-paternidade', dias: 5 },
  inss_doenca: { nome: 'Afastamento por doença (INSS)', dias: null },
  inss_acidente: { nome: 'Afastamento por acidente de trabalho (INSS)', dias: null },
  sem_salario: { nome: 'Licença sem salário', dias: null },
  casamento: { nome: 'Casamento (gala)', dias: 3 },
  luto: { nome: 'Luto (nojo)', dias: 2 },
  militar: { nome: 'Serviço militar / júri', dias: null },
  outra: { nome: 'Outra licença', dias: null },
} as const;
export type TipoLicenca = keyof typeof TIPOS_LICENCA;
/** tipos em que, depois dos 15 primeiros dias, quem paga é o INSS */
export const INSS: TipoLicenca[] = ['inss_doenca', 'inss_acidente'];

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const DIA = 86_400_000;
const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const dia = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);
const somaDias = (d: string, k: number) => new Date(Date.parse(`${d}T12:00:00Z`) + k * DIA).toISOString().slice(0, 10);
const difDias = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DIA);

export interface Licenca { id: string; funcionarioId: string; tipo: TipoLicenca; inicio: string; fim: string | null; documentoId: string | null; observacao: string | null }

/** dias de uma licença que não contam como trabalhados para 13º/férias (INSS do 16º dia em diante; sem salário: todos) */
export function diasAfastado(l: Licenca, ate: string): string[] {
  const ini = INSS.includes(l.tipo) ? somaDias(l.inicio, 15) : l.tipo === 'sem_salario' ? l.inicio : null;
  if (!ini) return [];
  const fim = l.fim && l.fim < ate ? l.fim : ate;
  const out: string[] = [];
  for (let d = ini; d <= fim; d = somaDias(d, 1)) out.push(d);
  return out;
}

/** todas as licenças da empresa (ou de um funcionário), da mais antiga para a mais nova */
export async function buscarLicencas(ds: DataSource, empresaId: string, funcionarioId?: string): Promise<Licenca[]> {
  try {
    const l = await ds.query(
      `SELECT * FROM funcionario_licencas WHERE empresa_id = $1 ${funcionarioId ? 'AND funcionario_id = $2' : ''} ORDER BY inicio`, funcionarioId ? [empresaId, funcionarioId] : [empresaId]);
    return l.map((x: Record<string, unknown>) => ({
      id: x.id as string, funcionarioId: x.funcionario_id as string, tipo: x.tipo as TipoLicenca, inicio: dia(x.inicio)!, fim: dia(x.fim),
      documentoId: (x.documento_id as string) ?? null, observacao: (x.observacao as string) ?? null,
    }));
  } catch {
    return []; // tabela nova ainda não criada
  }
}

class LicencaDto {
  @IsUUID() funcionarioId!: string;
  @IsIn(Object.keys(TIPOS_LICENCA)) tipo!: TipoLicenca;
  @Matches(DATA) inicio!: string;
  /** vazio = ainda não sabe quando volta (ex.: afastamento do INSS) */
  @IsOptional() @Matches(/^(\d{4}-\d{2}-\d{2})?$/) fim?: string;
  @IsOptional() @IsUUID() documentoId?: string;
  @IsOptional() @IsString() @MaxLength(300) observacao?: string;
}

@Injectable()
export class LicencasService {
  constructor(private readonly ds: DataSource) {}

  private descrever(l: Licenca, hoje: string) {
    const ate = l.fim ?? hoje;
    const dias = Math.max(0, difDias(l.inicio, ate) + 1);
    const inss = INSS.includes(l.tipo);
    return {
      ...l, tipoNome: TIPOS_LICENCA[l.tipo]?.nome ?? l.tipo, dias, aberta: !l.fim,
      situacao: l.inicio > hoje ? 'prevista' : !l.fim || l.fim >= hoje ? 'ativa' : 'encerrada',
      voltaEm: l.fim ? somaDias(l.fim, 1) : null, diasParaVoltar: l.fim && l.fim >= hoje ? difDias(hoje, somaDias(l.fim, 1)) : null,
      diasEmpresa: inss ? Math.min(15, dias) : null, diasInss: inss ? Math.max(0, dias - 15) : null,
      // a partir do 16º dia quem paga é o INSS: o funcionário tem que pedir o benefício e passar na perícia
      inssDesde: inss ? somaDias(l.inicio, 15) : null,
    };
  }

  async listar(u: UsuarioToken, funcionarioId?: string) {
    const hoje = hojeSP();
    const l = await buscarLicencas(this.ds, u.empresaId, funcionarioId);
    const nomes = new Map<string, string>((await this.ds.query(`SELECT id, nome FROM funcionarios WHERE empresa_id = $1`, [u.empresaId])).map((f: { id: string; nome: string }) => [f.id, f.nome]));
    return { hoje, tipos: TIPOS_LICENCA, lista: l.map((x) => ({ ...this.descrever(x, hoje), nome: nomes.get(x.funcionarioId) ?? '' })).reverse() };
  }

  private async conferir(u: UsuarioToken, dto: LicencaDto, id?: string) {
    const [f] = await this.ds.query(`SELECT id FROM funcionarios WHERE id = $1 AND empresa_id = $2`, [dto.funcionarioId, u.empresaId]);
    if (!f) throw new NotFoundException('Funcionário não encontrado.');
    if (dto.fim && dto.fim < dto.inicio) throw new BadRequestException('A volta é antes do início.');
    if (dto.documentoId) {
      const [d] = await this.ds.query(`SELECT 1 FROM funcionario_documentos WHERE id = $1 AND funcionario_id = $2 AND empresa_id = $3`, [dto.documentoId, dto.funcionarioId, u.empresaId]);
      if (!d) throw new NotFoundException('Documento não encontrado.');
    }
    const [choque] = await this.ds.query(
      `SELECT 1 FROM funcionario_licencas WHERE funcionario_id = $1 AND id <> $4 AND inicio <= COALESCE($3::date, '9999-12-31') AND COALESCE(fim, '9999-12-31') >= $2`,
      [dto.funcionarioId, dto.inicio, dto.fim || null, id ?? '00000000-0000-0000-0000-000000000000']);
    if (choque) throw new BadRequestException('Já existe uma licença nessas datas para este funcionário.');
  }

  async criar(u: UsuarioToken, dto: LicencaDto) {
    await this.conferir(u, dto);
    const [r] = await this.ds.query(
      `INSERT INTO funcionario_licencas (empresa_id, funcionario_id, tipo, inicio, fim, documento_id, observacao, usuario_nome) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [u.empresaId, dto.funcionarioId, dto.tipo, dto.inicio, dto.fim || null, dto.documentoId ?? null, dto.observacao?.trim() || null, u.nome]);
    return { ok: true, id: r.id };
  }

  async editar(u: UsuarioToken, id: string, dto: LicencaDto) {
    await this.conferir(u, dto, id);
    const r = await this.ds.query(
      `UPDATE funcionario_licencas SET tipo=$3, inicio=$4, fim=$5, documento_id=COALESCE($6, documento_id), observacao=$7 WHERE id=$1 AND empresa_id=$2 AND funcionario_id=$8 RETURNING id`,
      [id, u.empresaId, dto.tipo, dto.inicio, dto.fim || null, dto.documentoId ?? null, dto.observacao?.trim() || null, dto.funcionarioId]);
    if (!(Array.isArray(r?.[0]) ? r[0].length : r?.length)) throw new NotFoundException('Licença não encontrada.');
    return { ok: true };
  }

  async apagar(u: UsuarioToken, id: string) {
    await this.ds.query(`DELETE FROM funcionario_licencas WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    return { ok: true };
  }

  /** para o sino: quem volta de licença nos próximos 7 dias, e afastado do INSS sem data de volta há mais de 15 dias */
  async avisos(empresaId: string) {
    const hoje = hojeSP();
    const l = await this.ds.query(
      `SELECT f.nome, l.fim FROM funcionario_licencas l JOIN funcionarios f ON f.id = l.funcionario_id
        WHERE l.empresa_id = $1 AND f.ativo AND l.inicio <= $2
          AND (l.fim BETWEEN $2::date - 1 AND $2::date + 6 OR (l.fim IS NULL AND l.tipo = ANY($3) AND l.inicio <= $2::date - 15))`,
      [empresaId, hoje, INSS]);
    return l.map((x: { nome: string; fim: unknown }) => `${x.nome}${x.fim ? ` volta ${somaDias(dia(x.fim)!, 1).split('-').reverse().join('/').slice(0, 5)}` : ' (INSS, sem data de volta)'}`) as string[];
  }
}

@Controller('rh/licencas')
export class LicencasController {
  constructor(private readonly service: LicencasService) {}

  @Get()
  @Requer('funcionarios.gerenciar', 'funcionarios.financeiro')
  listar(@Usuario() u: UsuarioToken, @Query('funcionarioId') funcionarioId?: string) {
    return this.service.listar(u, funcionarioId && /^[0-9a-f-]{36}$/i.test(funcionarioId) ? funcionarioId : undefined);
  }

  @Post()
  @Requer('funcionarios.gerenciar')
  criar(@Usuario() u: UsuarioToken, @Body() dto: LicencaDto) {
    return this.service.criar(u, dto);
  }

  @Put(':id')
  @Requer('funcionarios.gerenciar')
  editar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LicencaDto) {
    return this.service.editar(u, id, dto);
  }

  @Delete(':id')
  @Requer('funcionarios.gerenciar')
  apagar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.apagar(u, id);
  }
}
