import { BadRequestException, Body, Controller, Get, HttpCode, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { IsIn, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';
import { cnpjDoForm } from '../common/cnpj';

/**
 * Venda a terceiros: o que o hotel/motel vende fora da operação (latinhas, papelão, óleo usado, sucata,
 * TV, frigobar e ar-condicionado velhos…). Fica registrada com o comprador e entra direto no caixa ADM,
 * na conta "Venda de sucata e ativos" do plano de contas.
 */

export const TIPOS_VENDA = { reciclavel: 'Recicláveis (latinha, papelão, garrafa)', oleo: 'Óleo usado', sucata: 'Sucata / metal', ativo: 'Móveis e equipamentos usados', outro: 'Outros' } as const;
const CATEGORIA = 'Venda de sucata e ativos';
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const dia = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const r2 = (v: number) => Math.round(v * 100) / 100;

class VendaTerceiroDto {
  @Matches(DATA) data!: string;
  @IsIn(Object.keys(TIPOS_VENDA)) tipo!: keyof typeof TIPOS_VENDA;
  @IsString() @MinLength(2) @MaxLength(200) descricao!: string;
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) @Max(1_000_000) quantidade!: number;
  @IsOptional() @IsString() @MaxLength(10) unidade?: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(10_000_000) valor!: number;
  @IsIn(['dinheiro', 'pix', 'transferencia', 'debito', 'credito']) forma!: string;
  @IsOptional() @IsString() @MaxLength(120) comprador?: string;
  @IsOptional() @IsString() @MaxLength(18) documento?: string;
  @IsOptional() @IsString() @MaxLength(30) telefone?: string;
  @IsOptional() @IsString() @MaxLength(300) observacao?: string;
  @IsOptional() @IsString() @MaxLength(18) cnpj?: string;
}
class CancelarVendaDto {
  @IsString() @MinLength(3) @MaxLength(300) motivo!: string;
}

@Injectable()
export class VendasTerceirosService {
  constructor(private readonly ds: DataSource) {}

  async listar(u: UsuarioToken, de: string, ate: string) {
    const l = await this.ds.query(`SELECT * FROM vendas_terceiros WHERE empresa_id = $1 AND data BETWEEN $2 AND $3 ORDER BY data DESC, criado_em DESC`, [u.empresaId, de, ate]);
    const lista = l.map((v: Record<string, unknown>) => ({
      id: v.id, data: dia(v.data), tipo: v.tipo, descricao: v.descricao, quantidade: Number(v.quantidade), unidade: v.unidade, valorUnitario: Number(v.valor_unitario),
      valor: Number(v.valor), forma: v.forma, comprador: v.comprador, documento: v.documento, telefone: v.telefone, observacao: v.observacao, cnpj: v.cnpj,
      cancelada: v.cancelada, motivoCancelamento: v.motivo_cancelamento, criadoPor: v.criado_por, criadoEm: v.criado_em,
    }));
    const validas = lista.filter((v: { cancelada: boolean }) => !v.cancelada);
    const agrupar = (chave: (v: (typeof lista)[number]) => string) => {
      const m = new Map<string, { nome: string; qtd: number; valor: number }>();
      for (const v of validas) { const k = chave(v); const x = m.get(k) ?? { nome: k, qtd: 0, valor: 0 }; x.qtd++; x.valor = r2(x.valor + v.valor); m.set(k, x); }
      return [...m.values()].sort((a, b) => b.valor - a.valor);
    };
    return {
      de, ate, tipos: TIPOS_VENDA, lista,
      total: r2(validas.reduce((s: number, v: { valor: number }) => s + v.valor, 0)),
      porTipo: agrupar((v) => TIPOS_VENDA[v.tipo as keyof typeof TIPOS_VENDA] ?? String(v.tipo)),
      porComprador: agrupar((v) => String(v.comprador || 'Sem nome')),
      porMes: agrupar((v) => String(v.data).slice(0, 7)).sort((a, b) => a.nome.localeCompare(b.nome)),
      // nomes já usados, para sugerir
      compradores: [...new Set(lista.map((v: { comprador: string | null }) => v.comprador).filter(Boolean))],
    };
  }

  async criar(u: UsuarioToken, dto: VendaTerceiroDto) {
    if (dto.data > hojeSP()) throw new BadRequestException('A data da venda não pode ser no futuro.');
    const cnpj = cnpjDoForm(dto.cnpj);
    const desc = `Venda a terceiros: ${dto.descricao.trim()}${dto.comprador?.trim() ? ` · ${dto.comprador.trim()}` : ''}`.slice(0, 300);
    const id = await this.ds.transaction(async (m) => {
      const [v] = await m.query(
        `INSERT INTO vendas_terceiros (empresa_id, data, tipo, descricao, quantidade, unidade, valor_unitario, valor, forma, comprador, documento, telefone, observacao, cnpj, criado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
        [u.empresaId, dto.data, dto.tipo, dto.descricao.trim(), dto.quantidade, dto.unidade?.trim() || 'un', r2(dto.valor / dto.quantidade).toFixed(2), dto.valor.toFixed(2),
          dto.forma, dto.comprador?.trim() || null, dto.documento?.replace(/\D/g, '') || null, dto.telefone?.trim() || null, dto.observacao?.trim() || null, cnpj, u.nome]);
      // entra direto no caixa ADM (no dia da venda)
      await m.query(
        `INSERT INTO caixa_movimentos (empresa_id, turno_id, caixa, tipo, forma, valor, descricao, categoria, usuario_id, usuario_nome, cnpj, criado_em)
         VALUES ($1, NULL, 'adm', 'entrada', $2, $3, $4, $5, $6, $7, $8, CASE WHEN $9::date = (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN now() ELSE ($9::date + time '12:00') AT TIME ZONE 'America/Sao_Paulo' END)`,
        [u.empresaId, dto.forma, dto.valor.toFixed(2), desc, CATEGORIA, u.sub, u.nome, cnpj, dto.data]);
      return v.id as string;
    });
    return { ok: true, id };
  }

  async cancelar(u: UsuarioToken, id: string, dto: CancelarVendaDto) {
    const [v] = await this.ds.query(`SELECT * FROM vendas_terceiros WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!v) throw new NotFoundException('Venda não encontrada.');
    if (v.cancelada) throw new BadRequestException('Esta venda já foi cancelada.');
    await this.ds.transaction(async (m) => {
      await m.query(`UPDATE vendas_terceiros SET cancelada = true, motivo_cancelamento = $2 WHERE id = $1`, [id, dto.motivo.trim()]);
      // o dinheiro que entrou sai do caixa ADM (devolução ao comprador)
      await m.query(
        `INSERT INTO caixa_movimentos (empresa_id, turno_id, caixa, tipo, forma, valor, descricao, categoria, usuario_id, usuario_nome, cnpj)
         VALUES ($1, NULL, 'adm', 'saida', $2, $3, $4, $5, $6, $7, $8)`,
        [u.empresaId, v.forma, v.valor, `Venda a terceiros cancelada: ${v.descricao} · ${dto.motivo.trim()}`.slice(0, 300), CATEGORIA, u.sub, u.nome, v.cnpj]);
    });
    return { ok: true };
  }
}

@Controller('vendas-terceiros')
@Requer('caixa.adm')
export class VendasTerceirosController {
  constructor(private readonly service: VendasTerceirosService) {}

  @Get()
  listar(@Usuario() u: UsuarioToken, @Query('de') de?: string, @Query('ate') ate?: string) {
    const a = ate && DATA.test(ate) ? ate : hojeSP();
    const d = de && DATA.test(de) ? de : `${a.slice(0, 4)}-01-01`;
    return this.service.listar(u, d, a);
  }

  @Post()
  criar(@Usuario() u: UsuarioToken, @Body() dto: VendaTerceiroDto) {
    return this.service.criar(u, dto);
  }

  @Post(':id/cancelar')
  @HttpCode(200)
  cancelar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelarVendaDto) {
    return this.service.cancelar(u, id, dto);
  }
}
