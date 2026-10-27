import { BadRequestException, Body, Controller, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

/**
 * Controle de temperatura dos equipamentos de frio (Anvisa RDC 216): refrigerados até 5 °C, congelados a −18 °C ou menos.
 * Cada equipamento tem a sua faixa e quantas leituras por dia; cada leitura fora da faixa pede a ação tomada.
 * A planilha do mês sai pronta para a vigilância sanitária.
 */

/** [nome, mínimo, máximo] — faixas comuns, o gestor pode ajustar */
export const TIPOS_FRIO: Record<string, [string, number | null, number | null]> = {
  geladeira: ['Geladeira / refrigerador', 0, 5],
  freezer: ['Freezer / congelador', null, -18],
  camara_fria: ['Câmara fria (resfriados)', 0, 5],
  camara_cong: ['Câmara de congelados', null, -18],
  bebidas: ['Geladeira de bebidas / expositor', 0, 8],
  balcao: ['Balcão refrigerado', 0, 5],
};
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

class EquipamentoDto {
  @IsString() @MinLength(2) @MaxLength(80) nome!: string;
  @IsIn(Object.keys(TIPOS_FRIO)) tipo!: string;
  @IsOptional() @IsString() @MaxLength(80) local?: string;
  @IsOptional() @IsUUID() ambienteId?: string | null;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 1 }) @Min(-40) @Max(30) minimo?: number | null;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 1 }) @Min(-40) @Max(30) maximo?: number | null;
  @IsOptional() @IsInt() @Min(1) @Max(12) leiturasDia?: number;
  @IsOptional() @IsBoolean() ativo?: boolean;
}
class LeituraDto {
  @IsUUID() equipamentoId!: string;
  @IsNumber({ maxDecimalPlaces: 1 }) @Min(-50) @Max(50) temperatura!: number;
  @IsOptional() @IsString() @MaxLength(300) acao?: string;
}

@Injectable()
export class TemperaturasService {
  constructor(private readonly ds: DataSource) {}

  /** equipamentos com a última leitura e quantas foram feitas hoje */
  async painel(u: UsuarioToken) {
    const hoje = hojeSP();
    const eqs: Record<string, unknown>[] = await this.ds.query(
      `SELECT e.*, a.nome AS ambiente,
              (SELECT row_to_json(r) FROM (SELECT temperatura, fora_da_faixa, usuario_nome, criado_em FROM temperaturas_registros WHERE equipamento_id = e.id ORDER BY criado_em DESC LIMIT 1) r) AS ultima,
              (SELECT count(*)::int FROM temperaturas_registros WHERE equipamento_id = e.id AND (criado_em AT TIME ZONE 'America/Sao_Paulo')::date = $2::date) AS hoje,
              (SELECT count(*)::int FROM temperaturas_registros WHERE equipamento_id = e.id AND fora_da_faixa AND criado_em > now() - interval '7 days') AS fora7
         FROM equipamentos_frio e LEFT JOIN ambientes a ON a.id = e.ambiente_id WHERE e.empresa_id = $1 ORDER BY e.ativo DESC, e.nome`, [u.empresaId, hoje]);
    const lista = eqs.map((e) => {
      const ult = e.ultima as { temperatura: string; fora_da_faixa: boolean; usuario_nome: string | null; criado_em: string } | null;
      return {
        id: e.id, nome: e.nome, tipo: e.tipo, tipoNome: TIPOS_FRIO[e.tipo as string]?.[0] ?? e.tipo, local: e.local, ambienteId: e.ambiente_id, ambiente: e.ambiente,
        minimo: e.minimo === null ? null : Number(e.minimo), maximo: e.maximo === null ? null : Number(e.maximo), leiturasDia: Number(e.leituras_dia), ativo: e.ativo,
        ultima: ult ? { temperatura: Number(ult.temperatura), fora: ult.fora_da_faixa, quem: ult.usuario_nome, em: ult.criado_em } : null,
        leiturasHoje: Number(e.hoje), foraUltimos7: Number(e.fora7),
        faltamHoje: e.ativo ? Math.max(0, Number(e.leituras_dia) - Number(e.hoje)) : 0,
      };
    });
    return {
      hoje, tipos: Object.fromEntries(Object.entries(TIPOS_FRIO).map(([k, [nome, min, max]]) => [k, { nome, minimo: min, maximo: max }])),
      equipamentos: lista,
      resumo: {
        ativos: lista.filter((e) => e.ativo).length,
        faltamHoje: lista.reduce((s, e) => s + e.faltamHoje, 0),
        foraAgora: lista.filter((e) => e.ativo && e.ultima?.fora).length,
      },
    };
  }

  async salvarEquipamento(u: UsuarioToken, dto: EquipamentoDto, id?: string) {
    const padrao = TIPOS_FRIO[dto.tipo];
    const min = dto.minimo === undefined ? padrao[1] : dto.minimo;
    const max = dto.maximo === undefined ? padrao[2] : dto.maximo;
    if (min !== null && max !== null && min > max) throw new BadRequestException('A mínima não pode ser maior que a máxima.');
    if (min === null && max === null) throw new BadRequestException('Informe pelo menos a temperatura máxima.');
    const v = [u.empresaId, dto.nome.trim(), dto.tipo, dto.local?.trim() || null, dto.ambienteId || null, min, max, dto.leiturasDia ?? 2, dto.ativo ?? true];
    if (id) {
      const [linhas] = await this.ds.query(
        `UPDATE equipamentos_frio SET nome = $2, tipo = $3, local = $4, ambiente_id = $5, minimo = $6, maximo = $7, leituras_dia = $8, ativo = $9 WHERE empresa_id = $1 AND id = $10 RETURNING id`, [...v, id]);
      if (!linhas?.length) throw new NotFoundException('Equipamento não encontrado.');
    } else {
      await this.ds.query(`INSERT INTO equipamentos_frio (empresa_id, nome, tipo, local, ambiente_id, minimo, maximo, leituras_dia, ativo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, v);
    }
    return this.painel(u);
  }

  /** uma leitura; fora da faixa só grava com a ação tomada (ajustou o termostato, mudou os alimentos de lugar…) */
  async registrar(u: UsuarioToken, dto: LeituraDto) {
    const [e] = await this.ds.query(`SELECT minimo, maximo, nome FROM equipamentos_frio WHERE id = $1 AND empresa_id = $2 AND ativo`, [dto.equipamentoId, u.empresaId]);
    if (!e) throw new NotFoundException('Equipamento não encontrado.');
    const t = dto.temperatura;
    const fora = (e.minimo !== null && t < Number(e.minimo)) || (e.maximo !== null && t > Number(e.maximo));
    if (fora && (dto.acao?.trim().length ?? 0) < 5) {
      throw new BadRequestException(`${t.toLocaleString('pt-BR')} °C está fora da faixa do ${e.nome}. Diga o que foi feito (ex.: ajustei o termostato, passei os alimentos para outro freezer).`);
    }
    await this.ds.query(`INSERT INTO temperaturas_registros (empresa_id, equipamento_id, temperatura, fora_da_faixa, acao, usuario_nome) VALUES ($1,$2,$3,$4,$5,$6)`,
      [u.empresaId, dto.equipamentoId, t, fora, dto.acao?.trim() || null, u.nome]);
    return this.painel(u);
  }

  /** planilha do mês (ou do período) para a vigilância sanitária: um equipamento por bloco, leitura por leitura */
  async planilha(u: UsuarioToken, deQ?: string, ateQ?: string, equipamentoId?: string) {
    const ate = ateQ && DATA.test(ateQ) ? ateQ : hojeSP();
    const de = deQ && DATA.test(deQ) ? deQ : `${ate.slice(0, 7)}-01`;
    const p: unknown[] = [u.empresaId, de, ate];
    let w = '';
    if (equipamentoId) { p.push(equipamentoId); w = ` AND e.id = $${p.length}`; }
    const eqs: Record<string, unknown>[] = await this.ds.query(
      `SELECT e.id, e.nome, e.tipo, e.local, e.minimo, e.maximo, e.leituras_dia FROM equipamentos_frio e WHERE e.empresa_id = $1${equipamentoId ? ' AND e.id = $2' : ''} ORDER BY e.nome`,
      equipamentoId ? [u.empresaId, equipamentoId] : [u.empresaId]);
    const regs: Record<string, unknown>[] = await this.ds.query(
      `SELECT r.equipamento_id, r.temperatura, r.fora_da_faixa, r.acao, r.usuario_nome, r.criado_em FROM temperaturas_registros r JOIN equipamentos_frio e ON e.id = r.equipamento_id
        WHERE r.empresa_id = $1 AND (r.criado_em AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN $2::date AND $3::date${w} ORDER BY r.criado_em`, p);
    const [emp] = await this.ds.query(`SELECT nome, cnpj FROM empresas WHERE id = $1`, [u.empresaId]);
    return {
      de, ate, empresa: emp?.nome ?? '', cnpj: emp?.cnpj ?? null,
      equipamentos: eqs.map((e) => {
        const dele = regs.filter((r) => r.equipamento_id === e.id);
        return {
          id: e.id, nome: e.nome, tipoNome: TIPOS_FRIO[e.tipo as string]?.[0] ?? e.tipo, local: e.local,
          minimo: e.minimo === null ? null : Number(e.minimo), maximo: e.maximo === null ? null : Number(e.maximo), leiturasDia: Number(e.leituras_dia),
          leituras: dele.map((r) => ({ temperatura: Number(r.temperatura), fora: r.fora_da_faixa, acao: r.acao, quem: r.usuario_nome, em: r.criado_em })),
          foraDaFaixa: dele.filter((r) => r.fora_da_faixa).length,
        };
      }),
    };
  }
}

@Controller('temperaturas')
export class TemperaturasController {
  constructor(private readonly service: TemperaturasService) {}

  @Get()
  @Requer('cozinha.ver', 'estoque.gerenciar', 'governanca.operar', 'produtos.gerenciar', 'relatorios.ver')
  painel(@Usuario() u: UsuarioToken) { return this.service.painel(u); }

  @Post('leituras')
  @Requer('cozinha.ver', 'estoque.gerenciar', 'governanca.operar', 'produtos.gerenciar')
  registrar(@Usuario() u: UsuarioToken, @Body() dto: LeituraDto) { return this.service.registrar(u, dto); }

  @Post('equipamentos')
  @Requer('estoque.gerenciar', 'produtos.gerenciar', 'empresa.editar')
  criar(@Usuario() u: UsuarioToken, @Body() dto: EquipamentoDto) { return this.service.salvarEquipamento(u, dto); }

  @Patch('equipamentos/:id')
  @Requer('estoque.gerenciar', 'produtos.gerenciar', 'empresa.editar')
  editar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EquipamentoDto) { return this.service.salvarEquipamento(u, dto, id); }

  @Get('planilha')
  @Requer('cozinha.ver', 'estoque.gerenciar', 'governanca.operar', 'produtos.gerenciar', 'relatorios.ver')
  planilha(@Usuario() u: UsuarioToken, @Query('de') de?: string, @Query('ate') ate?: string, @Query('equipamentoId') equipamentoId?: string) {
    return this.service.planilha(u, de, ate, equipamentoId);
  }
}
