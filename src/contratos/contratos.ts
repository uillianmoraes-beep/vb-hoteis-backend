import { BadRequestException, Body, Controller, Delete, Get, Headers, HttpCode, Injectable, Ip, Module, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, Equals, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { createHash, randomBytes } from 'crypto';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { Publico } from '../common/decorators/publico.decorator';
import { UsuarioToken } from '../common/permissoes';
import { ADITIVO_PADRAO, AREAS, Area, CLAUSULAS_PADRAO, QUALIFICACAO_PADRAO } from './modelos-padrao';

/**
 * Contratos (igual aos do app Virtual Barra, adaptados ao hotel): com empresas clientes (o hotel é a CONTRATADA: hospedagem,
 * alimentação, lavanderia, eventos) e com fornecedores do hotel (o hotel é a CONTRATANTE). O texto sai dos modelos de cláusulas
 * (gerais + as dos serviços marcados), vai por link para a outra parte assinar (data, hora, IP e código de conferência),
 * tem versões e aditivos, e a cobrança do mês vai para o faturamento (cliente) ou para as contas a pagar (fornecedor).
 */

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const FORMAS = { boleto: 'boleto bancário', pix: 'Pix', transferencia: 'transferência bancária', cartao: 'cartão de crédito', fatura: 'fatura mensal (faturamento)' } as const;
const UNIDADES = { mes: 'por mês', diaria: 'por diária', refeicao: 'por refeição', evento: 'por evento', unico: 'valor único' } as const;
const STATUS = ['rascunho', 'aguardando', 'ativo', 'encerrado', 'cancelado'] as const;
const r2 = (v: number) => Math.round(v * 100) / 100;
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const br = (d: string) => d.split('-').reverse().join('/');
const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const dia = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);
const digitos = (t?: string | null) => (t ?? '').replace(/\D/g, '');
function somaMeses(d: string, k: number) {
  const [a, m, dd] = d.split('-').map(Number);
  const t = a * 12 + (m - 1) + k;
  const ano = Math.floor(t / 12), mes = (t % 12) + 1;
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${ano}-${String(mes).padStart(2, '0')}-${String(Math.min(dd, ultimo)).padStart(2, '0')}`;
}
const somaDias = (d: string, k: number) => new Date(Date.parse(`${d}T12:00:00Z`) + k * 86_400_000).toISOString().slice(0, 10);
const doc = (d: string) => { const x = digitos(d); return x.length === 14 ? x.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : x.length === 11 ? x.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') : d; };
const linhas = <T,>(r: unknown): T[] => (Array.isArray(r) && Array.isArray(r[0]) ? r[0] : (r as T[]));

class ParteDto {
  @IsIn(['pj', 'pf']) tipo!: 'pj' | 'pf';
  @IsString() @MinLength(2) @MaxLength(150) nome!: string;
  @IsOptional() @IsString() @MaxLength(20) documento?: string;
  @IsOptional() @IsString() @MaxLength(120) representante?: string;
  @IsOptional() @IsString() @MaxLength(160) email?: string;
  @IsOptional() @IsString() @MaxLength(30) telefone?: string;
  @IsOptional() @IsString() @MaxLength(200) endereco?: string;
  @IsOptional() @IsString() @MaxLength(80) cidade?: string;
  @IsOptional() @IsString() @MaxLength(2) uf?: string;
  @IsOptional() @IsString() @MaxLength(10) cep?: string;
}
class ServicoDto {
  @IsIn(Object.keys(AREAS)) area!: Area;
  @IsOptional() @IsString() @MaxLength(200) descricao?: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(10_000_000) valor!: number;
  @IsIn(Object.keys(UNIDADES)) unidade!: keyof typeof UNIDADES;
}
class CondicoesDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => ServicoDto) servicos!: ServicoDto[];
  @Matches(DATA) inicio!: string;
  @IsInt() @Min(1) @Max(120) vigenciaMeses!: number;
  @IsInt() @Min(1) @Max(31) diaVencimento!: number;
  @IsIn(Object.keys(FORMAS)) formaPagamento!: keyof typeof FORMAS;
  /** texto com as variáveis; vazio = monta pelos modelos */
  @IsOptional() @IsString() @MaxLength(200_000) texto?: string;
}
class ContratoDto extends CondicoesDto {
  @IsIn(['cliente', 'fornecedor']) lado!: 'cliente' | 'fornecedor';
  @ValidateNested() @Type(() => ParteDto) parte!: ParteDto;
  @IsOptional() @IsUUID() clienteFaturadoId?: string;
}
class AditivoDto extends CondicoesDto {
  @IsString() @MinLength(3) @MaxLength(3000) alteracao!: string;
}
class MontarDto {
  @IsIn(['cliente', 'fornecedor']) lado!: 'cliente' | 'fornecedor';
  @IsArray() @ArrayMaxSize(30) @IsIn(Object.keys(AREAS), { each: true }) areas!: Area[];
}
class ModeloDto {
  @IsIn(['qualificacao', 'clausula', 'aditivo']) tipo!: 'qualificacao' | 'clausula' | 'aditivo';
  @IsOptional() @IsIn(['geral', ...Object.keys(AREAS)]) area?: string;
  @IsString() @MinLength(1) @MaxLength(150) titulo!: string;
  @IsString() @MinLength(1) @MaxLength(50_000) texto!: string;
  @IsOptional() @IsInt() @Min(0) @Max(1000) ordem?: number;
  @IsOptional() @IsBoolean() ativo?: boolean;
}
class AssinarDto {
  @IsString() @MinLength(3) @MaxLength(120) nome!: string;
  @IsString() @MinLength(11) @MaxLength(20) documento!: string;
  @Equals(true) aceite!: boolean;
}
class EncerrarDto { @IsOptional() @IsString() @MaxLength(300) motivo?: string }
class LancarDto { @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) competencia!: string }

interface Parte { tipo: 'pj' | 'pf'; nome: string; documento?: string; representante?: string; email?: string; telefone?: string; endereco?: string; cidade?: string; uf?: string; cep?: string }
interface Servico { area: Area; descricao?: string; valor: number; unidade: keyof typeof UNIDADES }

@Injectable()
export class ContratosService {
  constructor(private readonly ds: DataSource) {}

  /* ---------------- modelos ---------------- */

  private async semear(empresaId: string) {
    const [tem] = await this.ds.query(`SELECT 1 FROM contrato_modelos WHERE empresa_id = $1 LIMIT 1`, [empresaId]);
    if (tem) return;
    await this.ds.query(`INSERT INTO contrato_modelos (empresa_id, tipo, area, titulo, texto, ordem) VALUES ($1,'qualificacao',NULL,'Qualificação do hotel',$2,0)`, [empresaId, QUALIFICACAO_PADRAO]);
    await this.ds.query(`INSERT INTO contrato_modelos (empresa_id, tipo, area, titulo, texto, ordem) VALUES ($1,'aditivo',NULL,'Termo aditivo',$2,0)`, [empresaId, ADITIVO_PADRAO]);
    for (const c of CLAUSULAS_PADRAO) {
      await this.ds.query(`INSERT INTO contrato_modelos (empresa_id, tipo, area, titulo, texto, ordem) VALUES ($1,'clausula',$2,$3,$4,$5)`, [empresaId, c.area, c.titulo, c.texto, c.ordem]);
    }
  }

  async modelos(u: UsuarioToken) {
    await this.semear(u.empresaId);
    const l = await this.ds.query(`SELECT * FROM contrato_modelos WHERE empresa_id = $1 ORDER BY tipo, area NULLS FIRST, ordem, titulo`, [u.empresaId]);
    return {
      areas: AREAS, formas: FORMAS, unidades: UNIDADES,
      lista: l.map((m: Record<string, unknown>) => ({ id: m.id, tipo: m.tipo, area: m.area, titulo: m.titulo, texto: m.texto, ordem: Number(m.ordem), ativo: !!m.ativo })),
    };
  }

  async salvarModelo(u: UsuarioToken, dto: ModeloDto, id?: string) {
    const area = dto.tipo === 'clausula' ? dto.area ?? 'geral' : null;
    if (id) {
      const r = linhas(await this.ds.query(`UPDATE contrato_modelos SET titulo=$3, texto=$4, ordem=$5, ativo=$6, area=COALESCE($7, area), atualizado_em=now() WHERE id=$1 AND empresa_id=$2 RETURNING id`,
        [id, u.empresaId, dto.titulo.trim(), dto.texto, dto.ordem ?? 0, dto.ativo ?? true, area]));
      if (!r.length) throw new NotFoundException('Modelo não encontrado.');
      return { ok: true, id };
    }
    if (dto.tipo !== 'clausula') throw new BadRequestException('Só dá para criar cláusulas novas (a qualificação e o aditivo já existem: edite).');
    const [r] = await this.ds.query(`INSERT INTO contrato_modelos (empresa_id, tipo, area, titulo, texto, ordem) VALUES ($1,'clausula',$2,$3,$4,$5) RETURNING id`, [u.empresaId, area, dto.titulo.trim(), dto.texto, dto.ordem ?? 0]);
    return { ok: true, id: r.id };
  }

  async apagarModelo(u: UsuarioToken, id: string) {
    await this.ds.query(`DELETE FROM contrato_modelos WHERE id = $1 AND empresa_id = $2 AND tipo = 'clausula'`, [id, u.empresaId]);
    return { ok: true };
  }

  /** monta o texto (com as variáveis) pelas cláusulas gerais + as dos serviços marcados, na ordem */
  async montar(u: UsuarioToken, dto: MontarDto) {
    await this.semear(u.empresaId);
    const areas = new Set<string>(['geral', ...dto.areas]);
    const l: { area: string; titulo: string; texto: string }[] = await this.ds.query(
      `SELECT area, titulo, texto FROM contrato_modelos WHERE empresa_id = $1 AND tipo = 'clausula' AND ativo ORDER BY ordem, titulo`, [u.empresaId]);
    const escolhidas = l.filter((c) => areas.has(c.area));
    const titulo = dto.lado === 'cliente' ? 'CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE HOSPEDAGEM E HOTELARIA' : 'CONTRATO DE PRESTAÇÃO DE SERVIÇOS';
    return { texto: [titulo, ...escolhidas.map((c, i) => `CLÁUSULA ${i + 1}ª — ${c.titulo.toUpperCase()}\n\n${c.texto}`)].join('\n\n') };
  }

  /* ---------------- texto final ---------------- */

  private qualParte(p: Parte) {
    const f = (v: string | undefined, o: string) => (v?.trim() ? v.trim() : `[PREENCHER: ${o}]`);
    const end = [p.endereco?.trim(), p.cidade?.trim() && p.uf?.trim() ? `${p.cidade.trim()}/${p.uf.trim().toUpperCase()}` : p.cidade?.trim(), p.cep?.trim() ? `CEP ${p.cep.trim()}` : ''].filter(Boolean).join(', ');
    return p.tipo === 'pj'
      ? `${p.nome.trim()}, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº ${f(p.documento ? doc(p.documento) : undefined, 'CNPJ')}, com sede em ${end || '[PREENCHER: endereço]'}, neste ato representada por ${f(p.representante, 'representante legal')}`
      : `${p.nome.trim()}, pessoa física, inscrita no CPF sob o nº ${f(p.documento ? doc(p.documento) : undefined, 'CPF')}, residente em ${end || '[PREENCHER: endereço]'}`;
  }

  private servicosTexto(s: Servico[]) {
    return s.map((x) => `• ${AREAS[x.area] ?? x.area}${x.descricao ? `: ${x.descricao}` : ''} — ${brl(x.valor)} ${UNIDADES[x.unidade] ?? ''}`).join('\n');
  }

  private valorMensal(s: Servico[]) {
    return r2(s.filter((x) => x.unidade === 'mes').reduce((a, x) => a + x.valor, 0));
  }

  /** troca as variáveis pelo que está no contrato */
  private async renderizar(empresaId: string, c: { numero: number; lado: string; parte: Parte }, v: { texto: string; servicos: Servico[]; inicio: string; vigencia_meses: number; dia_vencimento: number; forma_pagamento: string; alteracao?: string | null }) {
    const [e] = await this.ds.query(`SELECT nome, cnpj FROM empresas WHERE id = $1`, [empresaId]);
    const [q] = await this.ds.query(`SELECT texto FROM contrato_modelos WHERE empresa_id = $1 AND tipo = 'qualificacao' LIMIT 1`, [empresaId]);
    const hotel = String(q?.texto ?? QUALIFICACAO_PADRAO).replace(/\{\{NOME_HOTEL\}\}/g, e?.nome ?? '').replace(/\{\{CNPJ_HOTEL\}\}/g, e?.cnpj ? doc(e.cnpj) : '[PREENCHER: CNPJ do hotel]');
    const parte = this.qualParte(c.parte);
    const inicio = dia(v.inicio)!;
    const fim = somaDias(somaMeses(inicio, v.vigencia_meses), -1);
    const vars: Record<string, string> = {
      CONTRATANTE: c.lado === 'cliente' ? parte : hotel, CONTRATADA: c.lado === 'cliente' ? hotel : parte,
      SERVICOS: this.servicosTexto(v.servicos), VALOR_TOTAL: brl(this.valorMensal(v.servicos)), DIA_VENCIMENTO: String(v.dia_vencimento),
      FORMA_PAGAMENTO: FORMAS[v.forma_pagamento as keyof typeof FORMAS] ?? v.forma_pagamento, VIGENCIA: `${v.vigencia_meses} ${Number(v.vigencia_meses) === 1 ? 'mês' : 'meses'}`,
      DATA_INICIO: br(inicio), DATA_FIM: br(fim), ALTERACAO: v.alteracao ?? '', NUMERO: String(c.numero), NOME_HOTEL: e?.nome ?? '', CNPJ_HOTEL: e?.cnpj ? doc(e.cnpj) : '',
    };
    return v.texto.replace(/\{\{([A-Z_]+)\}\}/g, (m, k: string) => (k in vars ? vars[k] : m));
  }

  /* ---------------- contratos ---------------- */

  async listar(u: UsuarioToken, status?: string, busca?: string) {
    const p: unknown[] = [u.empresaId];
    let where = 'c.empresa_id = $1';
    if (status && (STATUS as readonly string[]).includes(status)) { p.push(status); where += ` AND c.status = $${p.length}`; }
    if (busca?.trim()) { p.push(`%${busca.trim()}%`); where += ` AND (c.parte->>'nome' ILIKE $${p.length} OR c.parte->>'documento' ILIKE $${p.length} OR c.numero::text ILIKE $${p.length})`; }
    const l: Record<string, unknown>[] = await this.ds.query(
      `SELECT c.*, v.valor_mensal, v.inicio, v.vigencia_meses FROM contratos c LEFT JOIN contrato_versoes v ON v.contrato_id = c.id AND v.numero = COALESCE(c.versao_vigente, (SELECT max(numero) FROM contrato_versoes WHERE contrato_id = c.id))
        WHERE ${where} ORDER BY c.numero DESC LIMIT 300`, p);
    const hoje = hojeSP();
    return {
      lista: l.map((c) => {
        const ini = dia(c.inicio);
        const fim = ini ? somaDias(somaMeses(ini, Number(c.vigencia_meses)), -1) : null;
        return {
          id: c.id, numero: Number(c.numero), lado: c.lado, status: c.status, nome: (c.parte as Parte).nome, documento: (c.parte as Parte).documento ?? null,
          valorMensal: c.valor_mensal === null ? null : Number(c.valor_mensal), fim, venceLogo: c.status === 'ativo' && !!fim && fim <= somaDias(hoje, 30),
        };
      }),
    };
  }

  private async contrato(u: UsuarioToken, id: string) {
    const [c] = await this.ds.query(`SELECT * FROM contratos WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!c) throw new NotFoundException('Contrato não encontrado.');
    return c;
  }

  async ver(u: UsuarioToken, id: string) {
    const c = await this.contrato(u, id);
    const vs: Record<string, unknown>[] = await this.ds.query(`SELECT * FROM contrato_versoes WHERE contrato_id = $1 ORDER BY numero DESC`, [id]);
    const cob = await this.ds.query(`SELECT competencia, referencia_id, valor, criado_em FROM contrato_cobrancas WHERE contrato_id = $1 ORDER BY competencia DESC LIMIT 24`, [id]);
    const [cliente] = c.cliente_faturado_id ? await this.ds.query(`SELECT id, nome FROM clientes_faturados WHERE id = $1`, [c.cliente_faturado_id]) : [];
    const [conta] = c.conta_pagar_id ? await this.ds.query(`SELECT id, status, vencimento FROM contas_pagar WHERE id = $1`, [c.conta_pagar_id]) : [];
    return {
      id: c.id, numero: Number(c.numero), lado: c.lado, status: c.status, parte: c.parte, versaoVigente: c.versao_vigente, encerradoEm: c.encerrado_em, motivo: c.motivo_encerramento,
      clienteFaturado: cliente ? { id: cliente.id, nome: cliente.nome } : null, contaPagar: conta ? { id: conta.id, status: conta.status, vencimento: dia(conta.vencimento) } : null,
      cobrancas: cob.map((x: Record<string, unknown>) => ({ competencia: x.competencia, valor: Number(x.valor), em: x.criado_em })),
      versoes: vs.map((v) => ({
        id: v.id, numero: Number(v.numero), tipo: v.tipo, alteracao: v.alteracao, servicos: v.servicos, valorMensal: Number(v.valor_mensal), inicio: dia(v.inicio), vigenciaMeses: Number(v.vigencia_meses),
        fim: somaDias(somaMeses(dia(v.inicio)!, Number(v.vigencia_meses)), -1), diaVencimento: Number(v.dia_vencimento), formaPagamento: v.forma_pagamento, texto: v.texto, textoFinal: v.texto_final,
        status: v.status, token: v.token, hash: v.hash, enviadoEm: v.enviado_em, assinaturaParte: v.assinatura_parte, assinaturaHotel: v.assinatura_hotel,
      })),
    };
  }

  /** prévia do texto final de uma versão (com as variáveis trocadas) e o que falta preencher */
  async previa(u: UsuarioToken, id: string, numero: number) {
    const c = await this.contrato(u, id);
    const [v] = await this.ds.query(`SELECT * FROM contrato_versoes WHERE contrato_id = $1 AND numero = $2`, [id, numero]);
    if (!v) throw new NotFoundException('Versão não encontrada.');
    const texto = v.texto_final ?? await this.renderizar(u.empresaId, { numero: Number(c.numero), lado: c.lado, parte: c.parte }, v);
    return { texto, pendencias: [...new Set(texto.match(/\[PREENCHER:[^\]]*\]/g) ?? [])] };
  }

  private async textoInicial(u: UsuarioToken, lado: 'cliente' | 'fornecedor', servicos: Servico[], texto?: string) {
    if (texto?.trim()) return texto;
    return (await this.montar(u, { lado, areas: [...new Set(servicos.map((s) => s.area))] })).texto;
  }

  async criar(u: UsuarioToken, dto: ContratoDto) {
    await this.semear(u.empresaId);
    if (dto.clienteFaturadoId) {
      const [cf] = await this.ds.query(`SELECT 1 FROM clientes_faturados WHERE id = $1 AND empresa_id = $2`, [dto.clienteFaturadoId, u.empresaId]);
      if (!cf) throw new NotFoundException('Cliente do faturamento não encontrado.');
    }
    const texto = await this.textoInicial(u, dto.lado, dto.servicos, dto.texto);
    return this.ds.transaction(async (m) => {
      const [c] = await m.query(
        `INSERT INTO contratos (empresa_id, numero, lado, status, parte, cliente_faturado_id, criado_por)
         VALUES ($1, (SELECT GREATEST(1000, COALESCE(max(numero),1000)) + 1 FROM contratos WHERE empresa_id = $1), $2, 'rascunho', $3, $4, $5) RETURNING id, numero`,
        [u.empresaId, dto.lado, JSON.stringify(dto.parte), dto.lado === 'cliente' ? dto.clienteFaturadoId ?? null : null, u.nome]);
      await m.query(
        `INSERT INTO contrato_versoes (empresa_id, contrato_id, numero, tipo, servicos, valor_mensal, inicio, vigencia_meses, dia_vencimento, forma_pagamento, texto, criado_por)
         VALUES ($1,$2,1,'original',$3,$4,$5,$6,$7,$8,$9,$10)`,
        [u.empresaId, c.id, JSON.stringify(dto.servicos), this.valorMensal(dto.servicos), dto.inicio, dto.vigenciaMeses, dto.diaVencimento, dto.formaPagamento, texto, u.nome]);
      return { ok: true, id: c.id, numero: c.numero };
    });
  }

  /** edita o rascunho (dados da outra parte e a versão em rascunho) */
  async editar(u: UsuarioToken, id: string, dto: ContratoDto) {
    const c = await this.contrato(u, id);
    const [v] = await this.ds.query(`SELECT * FROM contrato_versoes WHERE contrato_id = $1 AND status = 'rascunho' ORDER BY numero DESC LIMIT 1`, [id]);
    if (!v) throw new BadRequestException('Não há versão em rascunho: para mudar um contrato assinado, faça um aditivo.');
    const texto = await this.textoInicial(u, c.lado, dto.servicos, dto.texto);
    await this.ds.query(`UPDATE contratos SET parte = $2, cliente_faturado_id = COALESCE($3, cliente_faturado_id) WHERE id = $1`, [id, JSON.stringify(dto.parte), c.lado === 'cliente' ? dto.clienteFaturadoId ?? null : null]);
    await this.ds.query(`UPDATE contrato_versoes SET servicos=$2, valor_mensal=$3, inicio=$4, vigencia_meses=$5, dia_vencimento=$6, forma_pagamento=$7, texto=$8 WHERE id = $1`,
      [v.id, JSON.stringify(dto.servicos), this.valorMensal(dto.servicos), dto.inicio, dto.vigenciaMeses, dto.diaVencimento, dto.formaPagamento, texto]);
    return { ok: true };
  }

  /** congela o texto, gera o código de conferência e o link para a outra parte assinar */
  async enviar(u: UsuarioToken, id: string) {
    const c = await this.contrato(u, id);
    if (c.status === 'encerrado' || c.status === 'cancelado') throw new BadRequestException('Contrato encerrado ou cancelado.');
    const [v] = await this.ds.query(`SELECT * FROM contrato_versoes WHERE contrato_id = $1 AND status IN ('rascunho','aguardando') ORDER BY numero DESC LIMIT 1`, [id]);
    if (!v) throw new BadRequestException('Não há versão para enviar.');
    if (v.status === 'aguardando') return { ok: true, token: v.token };
    const texto = await this.renderizar(u.empresaId, { numero: Number(c.numero), lado: c.lado, parte: c.parte }, v);
    const falta = [...new Set(texto.match(/\[PREENCHER:[^\]]*\]/g) ?? [])];
    if (falta.length) throw new BadRequestException(`Complete antes de enviar: ${falta.map((x) => x.replace(/^\[PREENCHER:\s*|\]$/g, '')).join(', ')}.`);
    const hash = createHash('sha256').update(`${c.id}|${v.numero}|${texto}`).digest('hex');
    const token = randomBytes(24).toString('hex');
    await this.ds.query(`UPDATE contrato_versoes SET texto_final = $2, hash = $3, token = $4, status = 'aguardando', enviado_em = now() WHERE id = $1`, [v.id, texto, hash, token]);
    if (c.status === 'rascunho') await this.ds.query(`UPDATE contratos SET status = 'aguardando' WHERE id = $1`, [id]);
    return { ok: true, token };
  }

  /** volta o envio para rascunho (antes de alguém assinar) */
  async voltarRascunho(u: UsuarioToken, id: string) {
    const c = await this.contrato(u, id);
    const r = linhas(await this.ds.query(
      `UPDATE contrato_versoes SET status = 'rascunho', texto_final = NULL, hash = NULL, token = NULL, enviado_em = NULL
        WHERE contrato_id = $1 AND status = 'aguardando' AND assinatura_parte IS NULL AND assinatura_hotel IS NULL RETURNING numero`, [id]));
    if (!r.length) throw new BadRequestException('Não dá para voltar: alguém já assinou (faça um aditivo ou cancele).');
    if (c.status === 'aguardando') await this.ds.query(`UPDATE contratos SET status = 'rascunho' WHERE id = $1`, [id]);
    return { ok: true };
  }

  /** o hotel assina (quem está logado) */
  async assinarHotel(u: UsuarioToken, id: string, ip: string) {
    await this.contrato(u, id);
    const [v] = await this.ds.query(`SELECT * FROM contrato_versoes WHERE contrato_id = $1 AND status = 'aguardando' ORDER BY numero DESC LIMIT 1`, [id]);
    if (!v) throw new BadRequestException('Envie o contrato para assinatura antes.');
    if (v.assinatura_hotel) throw new BadRequestException('O hotel já assinou esta versão.');
    await this.ds.query(`UPDATE contrato_versoes SET assinatura_hotel = $2 WHERE id = $1`, [v.id, JSON.stringify({ nome: u.nome, em: new Date().toISOString(), ip })]);
    await this.concluirSeAssinado(v.id);
    return { ok: true };
  }

  /** as duas partes assinaram: versão vale, contrato fica ativo (e o cliente entra no faturamento se ainda não estava) */
  private async concluirSeAssinado(versaoId: string) {
    const [v] = await this.ds.query(`SELECT v.*, c.lado, c.parte, c.cliente_faturado_id, c.empresa_id AS emp FROM contrato_versoes v JOIN contratos c ON c.id = v.contrato_id WHERE v.id = $1`, [versaoId]);
    if (!v?.assinatura_hotel || !v.assinatura_parte) return;
    await this.ds.query(`UPDATE contrato_versoes SET status = 'assinado' WHERE id = $1`, [versaoId]);
    await this.ds.query(`UPDATE contrato_versoes SET status = 'substituida' WHERE contrato_id = $1 AND numero < $2 AND status = 'assinado'`, [v.contrato_id, v.numero]);
    let clienteId = v.cliente_faturado_id as string | null;
    if (v.lado === 'cliente' && !clienteId) {
      const p = v.parte as Parte;
      const d = digitos(p.documento);
      const [ja] = d ? await this.ds.query(`SELECT id FROM clientes_faturados WHERE empresa_id = $1 AND regexp_replace(COALESCE(documento,''), '\\D', '', 'g') = $2 LIMIT 1`, [v.emp, d]) : [];
      if (ja) clienteId = ja.id;
      else {
        const [n] = await this.ds.query(
          `INSERT INTO clientes_faturados (empresa_id, nome, documento, contato, telefone, email, endereco, observacao) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [v.emp, p.nome.slice(0, 120), d || null, p.representante?.slice(0, 120) || null, p.telefone?.slice(0, 30) || null, p.email?.slice(0, 120) || null,
            [p.endereco, p.cidade && p.uf ? `${p.cidade}/${p.uf}` : p.cidade, p.cep].filter(Boolean).join(', ').slice(0, 250) || null, 'criado pelo contrato assinado']);
        clienteId = n.id;
      }
    }
    await this.ds.query(`UPDATE contratos SET status = 'ativo', versao_vigente = $2, cliente_faturado_id = COALESCE($3, cliente_faturado_id) WHERE id = $1`, [v.contrato_id, v.numero, clienteId]);
  }

  async aditivo(u: UsuarioToken, id: string, dto: AditivoDto) {
    const c = await this.contrato(u, id);
    if (c.status !== 'ativo') throw new BadRequestException('Só contrato ativo recebe aditivo.');
    const [aberta] = await this.ds.query(`SELECT 1 FROM contrato_versoes WHERE contrato_id = $1 AND status IN ('rascunho','aguardando')`, [id]);
    if (aberta) throw new BadRequestException('Já existe um aditivo em andamento: termine ou cancele antes.');
    await this.semear(u.empresaId);
    const [m] = await this.ds.query(`SELECT texto FROM contrato_modelos WHERE empresa_id = $1 AND tipo = 'aditivo' LIMIT 1`, [u.empresaId]);
    const [{ n }] = await this.ds.query(`SELECT COALESCE(max(numero),0) + 1 AS n FROM contrato_versoes WHERE contrato_id = $1`, [id]);
    await this.ds.query(
      `INSERT INTO contrato_versoes (empresa_id, contrato_id, numero, tipo, alteracao, servicos, valor_mensal, inicio, vigencia_meses, dia_vencimento, forma_pagamento, texto, criado_por)
       VALUES ($1,$2,$3,'aditivo',$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [u.empresaId, id, n, dto.alteracao.trim(), JSON.stringify(dto.servicos), this.valorMensal(dto.servicos), dto.inicio, dto.vigenciaMeses, dto.diaVencimento, dto.formaPagamento,
        dto.texto?.trim() || (m?.texto ?? ADITIVO_PADRAO), u.nome]);
    return { ok: true, numero: Number(n) };
  }

  async cancelarVersao(u: UsuarioToken, id: string) {
    const c = await this.contrato(u, id);
    const r = linhas(await this.ds.query(`UPDATE contrato_versoes SET status = 'cancelada' WHERE contrato_id = $1 AND status IN ('rascunho','aguardando') RETURNING numero`, [id]));
    if (!r.length) throw new BadRequestException('Nada em andamento para cancelar.');
    if (c.status === 'rascunho' || c.status === 'aguardando') await this.ds.query(`UPDATE contratos SET status = 'cancelado' WHERE id = $1`, [id]);
    return { ok: true };
  }

  async encerrar(u: UsuarioToken, id: string, dto: EncerrarDto) {
    const c = await this.contrato(u, id);
    if (c.status !== 'ativo') throw new BadRequestException('Só contrato ativo pode ser encerrado.');
    await this.ds.query(`UPDATE contratos SET status = 'encerrado', encerrado_em = now(), motivo_encerramento = $2 WHERE id = $1`, [id, dto.motivo?.trim() || null]);
    if (c.conta_pagar_id) await this.ds.query(`UPDATE contas_pagar SET recorrente = 'nao' WHERE id = $1 AND status = 'aberta'`, [c.conta_pagar_id]);
    return { ok: true };
  }

  async apagar(u: UsuarioToken, id: string) {
    const c = await this.contrato(u, id);
    if (c.status !== 'rascunho' && c.status !== 'cancelado') throw new BadRequestException('Só dá para apagar rascunho ou contrato cancelado.');
    await this.ds.query(`DELETE FROM contratos WHERE id = $1`, [id]);
    return { ok: true };
  }

  /** cliente: lança o valor do mês no faturamento (uma vez por mês) */
  async lancarMes(u: UsuarioToken, id: string, dto: LancarDto) {
    const c = await this.contrato(u, id);
    if (c.lado !== 'cliente' || c.status !== 'ativo') throw new BadRequestException('Só contrato de cliente ativo.');
    if (!c.cliente_faturado_id) throw new BadRequestException('Ligue o contrato a um cliente do faturamento.');
    const [v] = await this.ds.query(`SELECT * FROM contrato_versoes WHERE contrato_id = $1 AND numero = $2`, [id, c.versao_vigente]);
    const valor = Number(v?.valor_mensal ?? 0);
    if (!(valor > 0)) throw new BadRequestException('Este contrato não tem valor mensal (só serviços por uso).');
    const [ja] = await this.ds.query(`SELECT 1 FROM contrato_cobrancas WHERE contrato_id = $1 AND competencia = $2`, [id, dto.competencia]);
    if (ja) throw new BadRequestException('Este mês já foi lançado.');
    const [a, mth] = dto.competencia.split('-').map(Number);
    const ultimo = new Date(Date.UTC(a, mth, 0)).getUTCDate();
    const venc = `${dto.competencia}-${String(Math.min(Number(v.dia_vencimento), ultimo)).padStart(2, '0')}`;
    await this.ds.transaction(async (m) => {
      const [cr] = await m.query(`INSERT INTO contas_receber (empresa_id, cliente_id, descricao, valor, vencimento, criado_por) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [u.empresaId, c.cliente_faturado_id, `Contrato nº ${c.numero} · ${br(`${dto.competencia}-01`).slice(3)}`, valor.toFixed(2), venc, u.nome]);
      await m.query(`INSERT INTO contrato_cobrancas (contrato_id, competencia, referencia_id, valor) VALUES ($1,$2,$3,$4)`, [id, dto.competencia, cr.id, valor.toFixed(2)]);
    });
    return { ok: true, valor, vencimento: venc };
  }

  /** fornecedor: cria a conta de todo mês nas contas a pagar (ela se repete sozinha ao pagar) */
  async contaMensal(u: UsuarioToken, id: string) {
    const c = await this.contrato(u, id);
    if (c.lado !== 'fornecedor' || c.status !== 'ativo') throw new BadRequestException('Só contrato de fornecedor ativo.');
    if (c.conta_pagar_id) throw new BadRequestException('A conta mensal já foi criada.');
    const [v] = await this.ds.query(`SELECT * FROM contrato_versoes WHERE contrato_id = $1 AND numero = $2`, [id, c.versao_vigente]);
    const valor = Number(v?.valor_mensal ?? 0);
    if (!(valor > 0)) throw new BadRequestException('Este contrato não tem valor mensal.');
    const hoje = hojeSP();
    let venc = `${hoje.slice(0, 7)}-${String(Math.min(Number(v.dia_vencimento), 28)).padStart(2, '0')}`;
    if (venc < hoje) venc = somaMeses(venc, 1);
    const [cp] = await this.ds.query(
      `INSERT INTO contas_pagar (empresa_id, descricao, fornecedor, categoria, valor, vencimento, recorrente, observacao, criado_por) VALUES ($1,$2,$3,$4,$5,$6,'mensal',$7,$8) RETURNING id`,
      [u.empresaId, `Contrato nº ${c.numero}`, (c.parte as Parte).nome.slice(0, 120), 'Serviços de terceiros', valor.toFixed(2), venc, `contrato nº ${c.numero}`, u.nome]);
    await this.ds.query(`UPDATE contratos SET conta_pagar_id = $2 WHERE id = $1`, [id, cp.id]);
    return { ok: true, vencimento: venc };
  }

  /* ---------------- público: a outra parte lê e assina ---------------- */

  async publico(token: string) {
    const [v] = await this.ds.query(
      `SELECT v.*, c.numero AS contrato_numero, c.lado, c.parte, e.nome AS hotel FROM contrato_versoes v JOIN contratos c ON c.id = v.contrato_id JOIN empresas e ON e.id = c.empresa_id WHERE v.token = $1`, [token]);
    if (!v) throw new NotFoundException('Contrato não encontrado.');
    return {
      hotel: v.hotel, numero: Number(v.contrato_numero), versao: Number(v.numero), tipo: v.tipo, parte: (v.parte as Parte).nome, texto: v.texto_final, hash: v.hash,
      status: v.status, assinaturaParte: v.assinatura_parte ? { nome: v.assinatura_parte.nome, em: v.assinatura_parte.em, ip: v.assinatura_parte.ip } : null,
      assinaturaHotel: v.assinatura_hotel ? { nome: v.assinatura_hotel.nome, em: v.assinatura_hotel.em } : null,
      podeAssinar: v.status === 'aguardando' && !v.assinatura_parte,
    };
  }

  async assinarPublico(token: string, dto: AssinarDto, ip: string, agente: string) {
    const [v] = await this.ds.query(`SELECT id, status, assinatura_parte FROM contrato_versoes WHERE token = $1`, [token]);
    if (!v) throw new NotFoundException('Contrato não encontrado.');
    if (v.status !== 'aguardando' || v.assinatura_parte) throw new BadRequestException('Este contrato não está esperando a sua assinatura.');
    const d = digitos(dto.documento);
    if (d.length !== 11 && d.length !== 14) throw new BadRequestException('Informe o CPF (ou CNPJ) de quem está assinando.');
    await this.ds.query(`UPDATE contrato_versoes SET assinatura_parte = $2 WHERE id = $1 AND assinatura_parte IS NULL`,
      [v.id, JSON.stringify({ nome: dto.nome.trim(), documento: d, em: new Date().toISOString(), ip, agente: agente.slice(0, 300) })]);
    await this.concluirSeAssinado(v.id);
    return { ok: true };
  }

  /** para o sino: esperando assinatura há mais de 3 dias e contratos que acabam em 30 dias */
  async avisos(empresaId: string) {
    const [a] = await this.ds.query(
      `SELECT (SELECT count(*) FROM contrato_versoes v JOIN contratos c ON c.id = v.contrato_id WHERE c.empresa_id = $1 AND v.status = 'aguardando' AND v.enviado_em < now() - interval '3 days')::int AS esperando,
              (SELECT count(*) FROM contratos c JOIN contrato_versoes v ON v.contrato_id = c.id AND v.numero = c.versao_vigente
                WHERE c.empresa_id = $1 AND c.status = 'ativo' AND (v.inicio + make_interval(months => v.vigencia_meses)) <= ($2::date + 30))::int AS vencendo`, [empresaId, hojeSP()]);
    return { esperando: Number(a?.esperando ?? 0), vencendo: Number(a?.vencendo ?? 0) };
  }
}

const P = ['contratos.gerenciar'] as const;
const ipDe = (ip: string, fwd?: string) => (fwd?.split(',')[0]?.trim() || ip || '').slice(0, 60);

@Controller('contratos')
export class ContratosController {
  constructor(private readonly service: ContratosService) {}

  @Get() @Requer(...P) listar(@Usuario() u: UsuarioToken, @Query('status') status?: string, @Query('busca') busca?: string) { return this.service.listar(u, status, busca); }
  @Get('modelos') @Requer(...P) modelos(@Usuario() u: UsuarioToken) { return this.service.modelos(u); }
  @Post('modelos') @Requer(...P) criarModelo(@Usuario() u: UsuarioToken, @Body() dto: ModeloDto) { return this.service.salvarModelo(u, dto); }
  @Put('modelos/:id') @Requer(...P) editarModelo(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ModeloDto) { return this.service.salvarModelo(u, dto, id); }
  @Delete('modelos/:id') @Requer(...P) apagarModelo(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.apagarModelo(u, id); }
  @Post('montar') @Requer(...P) montar(@Usuario() u: UsuarioToken, @Body() dto: MontarDto) { return this.service.montar(u, dto); }
  @Post() @Requer(...P) criar(@Usuario() u: UsuarioToken, @Body() dto: ContratoDto) { return this.service.criar(u, dto); }
  @Get(':id') @Requer(...P) ver(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.ver(u, id); }
  @Get(':id/previa/:numero') @Requer(...P) previa(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Param('numero') n: string) { return this.service.previa(u, id, Number(n)); }
  @Put(':id') @Requer(...P) editar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ContratoDto) { return this.service.editar(u, id, dto); }
  @Post(':id/enviar') @Requer(...P) enviar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.enviar(u, id); }
  @Post(':id/voltar-rascunho') @Requer(...P) voltar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.voltarRascunho(u, id); }
  @Post(':id/assinar') @Requer(...P) assinar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string, @Headers('x-forwarded-for') fwd?: string) { return this.service.assinarHotel(u, id, ipDe(ip, fwd)); }
  @Post(':id/aditivo') @Requer(...P) aditivo(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AditivoDto) { return this.service.aditivo(u, id, dto); }
  @Post(':id/cancelar') @Requer(...P) cancelar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.cancelarVersao(u, id); }
  @Post(':id/encerrar') @Requer(...P) encerrar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EncerrarDto) { return this.service.encerrar(u, id, dto); }
  @Post(':id/lancar-mes') @Requer('contratos.gerenciar', 'faturamento.gerenciar') lancar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LancarDto) { return this.service.lancarMes(u, id, dto); }
  @Post(':id/conta-mensal') @Requer('contratos.gerenciar', 'despesas.gerenciar') contaMensal(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.contaMensal(u, id); }
  @Delete(':id') @Requer(...P) apagar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.apagar(u, id); }
}

@Controller('publico/contrato')
export class ContratoPublicoController {
  constructor(private readonly service: ContratosService) {}

  @Get(':token') @Publico() ver(@Param('token') token: string) { return this.service.publico(token); }
  @Post(':token') @HttpCode(200) @Publico()
  assinar(@Param('token') token: string, @Body() dto: AssinarDto, @Ip() ip: string, @Headers('x-forwarded-for') fwd?: string, @Headers('user-agent') agente?: string) {
    return this.service.assinarPublico(token, dto, ipDe(ip, fwd), agente ?? '');
  }
}

@Module({ providers: [ContratosService], controllers: [ContratosController, ContratoPublicoController] })
export class ContratosModule {}
