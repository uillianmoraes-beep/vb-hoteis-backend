import { BadRequestException, Body, Controller, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomBytes } from 'crypto';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { Publico } from '../common/decorators/publico.decorator';
import { UsuarioToken } from '../common/permissoes';

/**
 * Certificado de reciclagem: soma o que foi vendido como reciclável, óleo e sucata no período (Financeiro › Venda a terceiros),
 * separa por material e mostra a equivalência ecológica (estimativa com médias públicas). Cada certificado tem um código
 * que qualquer pessoa confere pelo QR code, sem login.
 */

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const r1 = (n: number) => Math.round(n * 10) / 10;

/** material pelo tipo e pelas palavras da descrição */
function material(tipo: string, descricao: string): string {
  const d = descricao.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (tipo === 'oleo' || /oleo/.test(d)) return 'oleo';
  if (/lat|alumin/.test(d)) return 'aluminio';
  if (/papel|caixa|jornal/.test(d)) return 'papel';
  if (/pet|plast|garrafa plast/.test(d)) return 'plastico';
  if (/vidro|garrafa/.test(d)) return 'vidro';
  if (tipo === 'sucata' || /ferro|metal|cobre|sucata|aco/.test(d)) return 'metal';
  return 'outros';
}
const NOMES: Record<string, string> = { aluminio: 'Alumínio (latinhas)', papel: 'Papel e papelão', plastico: 'Plástico (PET)', vidro: 'Vidro', metal: 'Metais e sucata', oleo: 'Óleo de cozinha usado', outros: 'Outros recicláveis' };

/** equivalência ecológica por material (médias públicas, só para dar ideia do tamanho) */
function equivalencias(m: Record<string, { kg: number; litros: number }>) {
  const out: { material: string; texto: string }[] = [];
  if (m.aluminio?.kg) out.push({ material: 'aluminio', texto: `${r1(m.aluminio.kg * 14).toLocaleString('pt-BR')} kWh de energia poupados (o consumo de uma casa por ${Math.max(1, Math.round((m.aluminio.kg * 14) / 150))} mês(es)) e ${r1(m.aluminio.kg * 5).toLocaleString('pt-BR')} kg de bauxita que não precisaram ser extraídos` });
  if (m.papel?.kg) out.push({ material: 'papel', texto: `${r1(m.papel.kg * 0.02).toLocaleString('pt-BR')} árvore(s) poupada(s) e ${r1(m.papel.kg * 26).toLocaleString('pt-BR')} litros de água economizados na fabricação` });
  if (m.plastico?.kg) out.push({ material: 'plastico', texto: `${r1(m.plastico.kg * 1.5).toLocaleString('pt-BR')} kg de gás carbônico (CO₂) que deixaram de ir para o ar` });
  if (m.vidro?.kg) out.push({ material: 'vidro', texto: `${r1(m.vidro.kg * 1.2).toLocaleString('pt-BR')} kg de areia e minerais que não precisaram ser extraídos` });
  if (m.metal?.kg) out.push({ material: 'metal', texto: `${r1(m.metal.kg * 1.5).toLocaleString('pt-BR')} kg de minério de ferro poupados` });
  if (m.oleo?.litros) out.push({ material: 'oleo', texto: `até ${Math.round(m.oleo.litros * 25000).toLocaleString('pt-BR')} litros de água protegidos da contaminação (1 litro de óleo pode contaminar 25 mil litros)` });
  return out;
}

class CertificadoDto {
  @Matches(DATA) de!: string;
  @Matches(DATA) ate!: string;
  @IsOptional() @IsString() @MaxLength(120) comprador?: string;
}

@Injectable()
export class ReciclagemService {
  constructor(private readonly ds: DataSource) {}

  /** soma por material no período (kg e litros), só das vendas não canceladas de recicláveis, óleo e sucata */
  private async somar(empresaId: string, de: string, ate: string, comprador?: string) {
    const p: unknown[] = [empresaId, de, ate];
    let w = '';
    if (comprador?.trim()) { p.push(comprador.trim().toLowerCase()); w = ` AND lower(comprador) = $${p.length}`; }
    const l: { tipo: string; descricao: string; quantidade: string; unidade: string; valor: string }[] = await this.ds.query(
      `SELECT tipo, descricao, quantidade, unidade, valor FROM vendas_terceiros
        WHERE empresa_id = $1 AND NOT cancelada AND tipo IN ('reciclavel','oleo','sucata') AND data BETWEEN $2 AND $3${w}`, p);
    const mats: Record<string, { kg: number; litros: number; unidades: number; valor: number }> = {};
    for (const v of l) {
      const m = material(v.tipo, v.descricao);
      const a = mats[m] ?? { kg: 0, litros: 0, unidades: 0, valor: 0 };
      const q = Number(v.quantidade), un = v.unidade.toLowerCase();
      if (un === 'kg') a.kg += q; else if (un === 't' || un === 'ton') a.kg += q * 1000; else if (un === 'l' || un === 'lt') a.litros += q; else a.unidades += q;
      a.valor += Number(v.valor);
      mats[m] = a;
    }
    const materiais = Object.entries(mats).map(([m, a]) => ({ material: m, nome: NOMES[m] ?? m, kg: r1(a.kg), litros: r1(a.litros), unidades: Math.round(a.unidades), valor: Math.round(a.valor * 100) / 100 }));
    return { materiais, equivalencias: equivalencias(mats), receita: Math.round(materiais.reduce((s, m) => s + m.valor, 0) * 100) / 100 };
  }

  async previa(u: UsuarioToken, de: string, ate: string, comprador?: string) {
    if (!DATA.test(de) || !DATA.test(ate)) throw new BadRequestException('Período inválido.');
    const compradores: { comprador: string }[] = await this.ds.query(
      `SELECT DISTINCT comprador FROM vendas_terceiros WHERE empresa_id = $1 AND NOT cancelada AND comprador IS NOT NULL AND tipo IN ('reciclavel','oleo','sucata') ORDER BY 1`, [u.empresaId]);
    return { de, ate, ...(await this.somar(u.empresaId, de, ate, comprador)), compradores: compradores.map((c) => c.comprador) };
  }

  async emitir(u: UsuarioToken, dto: CertificadoDto) {
    if (dto.ate < dto.de) throw new BadRequestException('O fim do período é antes do começo.');
    const s = await this.somar(u.empresaId, dto.de, dto.ate, dto.comprador);
    if (!s.materiais.length) throw new BadRequestException('Não há venda de recicláveis, óleo ou sucata neste período.');
    const codigo = randomBytes(6).toString('base64url').replace(/[-_]/g, 'X').slice(0, 8).toUpperCase();
    const [c] = await this.ds.query(
      `INSERT INTO certificados_reciclagem (empresa_id, codigo, de, ate, comprador, materiais, equivalencias, receita, emitido_por)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9) RETURNING id`,
      [u.empresaId, codigo, dto.de, dto.ate, dto.comprador?.trim() || null, JSON.stringify(s.materiais), JSON.stringify(s.equivalencias), s.receita, u.nome]);
    return this.ver(u, c.id);
  }

  async listar(u: UsuarioToken) {
    const l: Record<string, unknown>[] = await this.ds.query(
      `SELECT id, codigo, to_char(de, 'YYYY-MM-DD') AS de, to_char(ate, 'YYYY-MM-DD') AS ate, comprador, materiais, receita, emitido_por, criado_em
         FROM certificados_reciclagem WHERE empresa_id = $1 ORDER BY criado_em DESC LIMIT 100`, [u.empresaId]);
    return l.map((c) => ({ id: c.id, codigo: c.codigo, de: c.de, ate: c.ate, comprador: c.comprador, materiais: c.materiais, receita: Number(c.receita), emitidoPor: c.emitido_por, criadoEm: c.criado_em }));
  }

  private async dados(where: string, p: unknown[]) {
    const [c] = await this.ds.query(
      `SELECT c.*, to_char(c.de, 'YYYY-MM-DD') AS de_txt, to_char(c.ate, 'YYYY-MM-DD') AS ate_txt, e.nome AS empresa, e.cnpj
         FROM certificados_reciclagem c JOIN empresas e ON e.id = c.empresa_id WHERE ${where}`, p);
    if (!c) throw new NotFoundException('Certificado não encontrado.');
    return {
      id: c.id, codigo: c.codigo, de: c.de_txt, ate: c.ate_txt, comprador: c.comprador, materiais: c.materiais, equivalencias: c.equivalencias,
      receita: Number(c.receita), emitidoPor: c.emitido_por, criadoEm: c.criado_em, empresa: c.empresa, cnpj: c.cnpj,
    };
  }

  ver(u: UsuarioToken, id: string) { return this.dados(`c.id = $1 AND c.empresa_id = $2`, [id, u.empresaId]); }

  /** conferência pública pelo QR code (sem o valor recebido) */
  async publico(codigo: string) {
    if (!/^[A-Z0-9]{6,12}$/.test(codigo)) throw new NotFoundException('Certificado não encontrado.');
    const { receita: _r, emitidoPor: _e, id: _i, ...resto } = await this.dados(`c.codigo = $1`, [codigo]);
    return resto;
  }
}

@Controller()
export class ReciclagemController {
  constructor(private readonly service: ReciclagemService) {}

  @Get('reciclagem/previa')
  @Requer('caixa.adm', 'relatorios.ver')
  previa(@Usuario() u: UsuarioToken, @Query('de') de: string, @Query('ate') ate: string, @Query('comprador') comprador?: string) {
    return this.service.previa(u, de, ate, comprador);
  }

  @Get('reciclagem/certificados')
  @Requer('caixa.adm', 'relatorios.ver')
  listar(@Usuario() u: UsuarioToken) { return this.service.listar(u); }

  @Post('reciclagem/certificados')
  @Requer('caixa.adm')
  emitir(@Usuario() u: UsuarioToken, @Body() dto: CertificadoDto) { return this.service.emitir(u, dto); }

  @Get('reciclagem/certificados/:id')
  @Requer('caixa.adm', 'relatorios.ver')
  ver(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.ver(u, id); }

  @Publico()
  @Get('publico/reciclagem/:codigo')
  publico(@Param('codigo') codigo: string) { return this.service.publico(codigo.toUpperCase()); }
}
