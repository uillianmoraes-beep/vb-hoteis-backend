import { Body, Controller, Get, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';
import { montarTicket } from '../impressao/escpos';

/**
 * Certificados digitais (A1/A3) com a data de validade: o sistema avisa no sino 30 dias antes
 * (em vermelho na última semana) e pode imprimir sozinho um aviso numa impressora
 * nos dias 30, 15, 7, 3, 2 e 1 antes, no dia e todo dia depois de vencido.
 */

class CertificadoDto {
  @IsIn(['A1', 'A3', 'outro']) tipo!: 'A1' | 'A3' | 'outro';
  @IsString() @MinLength(2) @MaxLength(120) titular!: string;
  @IsOptional() @IsString() @MaxLength(18) cnpj?: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) validade!: string;
  @IsOptional() @IsString() @MaxLength(80) fornecedor?: string;
  @IsOptional() @IsString() @MaxLength(300) observacao?: string;
  /** impressora para o aviso impresso (vazio = só no sino) */
  @IsOptional() @IsUUID() impressoraId?: string | null;
  @IsOptional() @IsBoolean() ativo?: boolean;
}

const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const diasAte = (validade: string) => Math.round((Date.parse(`${validade}T12:00:00Z`) - Date.parse(`${hojeSP()}T12:00:00Z`)) / 86_400_000);
const dia = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const DIAS_IMPRIMIR = [30, 15, 7, 3, 2, 1, 0];
const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '');

@Injectable()
export class CertificadosService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Certificados');
  private timer?: NodeJS.Timeout;

  constructor(private readonly ds: DataSource) {}

  onModuleInit() {
    // confere de hora em hora (o aviso sai uma vez por dia)
    this.timer = setInterval(() => void this.imprimirAvisos(), 60 * 60_000);
    setTimeout(() => void this.imprimirAvisos(), 60_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async listar(u: UsuarioToken) {
    const l = await this.ds.query(
      `SELECT c.*, i.nome AS impressora FROM certificados c LEFT JOIN impressoras i ON i.id = c.impressora_id
        WHERE c.empresa_id = $1 ORDER BY c.ativo DESC, c.validade`, [u.empresaId]);
    return l.map((c: Record<string, unknown>) => {
      const v = dia(c.validade);
      return {
        id: c.id, tipo: c.tipo, titular: c.titular, cnpj: c.cnpj, validade: v, fornecedor: c.fornecedor, observacao: c.observacao,
        impressoraId: c.impressora_id, impressora: c.impressora ?? null, ativo: c.ativo, dias: diasAte(v),
      };
    });
  }

  private valores(dto: CertificadoDto) {
    return [dto.tipo, dto.titular.trim(), dto.cnpj?.replace(/\D/g, '') || null, dto.validade, dto.fornecedor?.trim() || null, dto.observacao?.trim() || null,
      dto.impressoraId || null, dto.ativo ?? true];
  }

  async criar(u: UsuarioToken, dto: CertificadoDto) {
    const [c] = await this.ds.query(
      `INSERT INTO certificados (empresa_id, tipo, titular, cnpj, validade, fornecedor, observacao, impressora_id, ativo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [u.empresaId, ...this.valores(dto)]);
    return { ok: true, id: c.id };
  }

  async atualizar(u: UsuarioToken, id: string, dto: CertificadoDto) {
    // trocou a validade (certificado renovado): os avisos impressos recomeçam
    const r = await this.ds.query(
      `UPDATE certificados SET tipo=$3, titular=$4, cnpj=$5, ultimo_aviso_impresso = CASE WHEN validade <> $6::date THEN NULL ELSE ultimo_aviso_impresso END,
         validade=$6, fornecedor=$7, observacao=$8, impressora_id=$9, ativo=$10 WHERE id=$1 AND empresa_id=$2 RETURNING id`,
      [id, u.empresaId, ...this.valores(dto)]);
    if (!(Array.isArray(r?.[0]) ? r[0].length : r?.length)) throw new NotFoundException('Certificado não encontrado.');
    return { ok: true };
  }

  /** aviso impresso nos dias marcados (uma vez por dia por certificado) */
  async imprimirAvisos() {
    try {
      const hoje = hojeSP();
      const l = await this.ds.query(
        `SELECT c.*, i.colunas, i.ativo AS imp_ativa FROM certificados c JOIN impressoras i ON i.id = c.impressora_id
          WHERE c.ativo AND c.validade <= ($1::date + 30) AND (c.ultimo_aviso_impresso IS NULL OR c.ultimo_aviso_impresso < $1::date)`, [hoje]);
      for (const c of l) {
        if (!c.imp_ativa) continue;
        const v = dia(c.validade);
        const n = diasAte(v);
        if (n >= 0 && !DIAS_IMPRIMIR.includes(n)) continue;
        const col = Number(c.colunas) || 48;
        const quando = n < 0 ? `VENCEU HA ${-n} DIA${n < -1 ? 'S' : ''}` : n === 0 ? 'VENCE HOJE' : `VENCE EM ${n} DIA${n > 1 ? 'S' : ''}`;
        const t = montarTicket([
          { t: 'ATENCAO', grande: true, centro: true },
          { t: 'CERTIFICADO DIGITAL', negrito: true, centro: true },
          { t: quando, grande: true, centro: true },
          { t: '-'.repeat(col) },
          { t: semAcento(`${c.tipo} · ${c.titular}`) },
          ...(c.cnpj ? [{ t: `CNPJ ${c.cnpj}` }] : []),
          { t: `Validade: ${v.split('-').reverse().join('/')}` },
          ...(c.fornecedor ? [{ t: semAcento(`Renovar com: ${c.fornecedor}`) }] : []),
          { t: '-'.repeat(col) },
          { t: semAcento('Sem certificado valido o sistema nao emite nota fiscal. Avise o gerente.') },
        ], col, 1);
        await this.ds.query(`INSERT INTO impressao_fila (empresa_id, impressora_id, origem, texto, dados) VALUES ($1,$2,'certificado',$3,$4)`, [c.empresa_id, c.impressora_id, t.texto, t.dados]);
        await this.ds.query(`UPDATE certificados SET ultimo_aviso_impresso = $2 WHERE id = $1`, [c.id, hoje]);
      }
    } catch (e) {
      this.log.error(`Aviso de certificado não impresso: ${e instanceof Error ? e.message : e}`);
    }
  }
}

@Controller('certificados')
export class CertificadosController {
  constructor(private readonly service: CertificadosService) {}

  @Get()
  @Requer('notas.gerenciar', 'empresa.editar')
  listar(@Usuario() u: UsuarioToken) {
    return this.service.listar(u);
  }

  @Post()
  @Requer('notas.gerenciar', 'empresa.editar')
  criar(@Usuario() u: UsuarioToken, @Body() dto: CertificadoDto) {
    return this.service.criar(u, dto);
  }

  @Patch(':id')
  @Requer('notas.gerenciar', 'empresa.editar')
  atualizar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CertificadoDto) {
    return this.service.atualizar(u, id, dto);
  }
}
