import { BadRequestException, Body, Controller, Delete, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Res, StreamableFile } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsNumber, IsOptional, IsString, Matches, MaxLength, Min, ValidateNested } from 'class-validator';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { dirname, join, normalize, sep } from 'path';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';
import { LeitorContadorService } from './leitor';
import type { Item } from './holerite';

/**
 * Cruzamento do Simples Nacional (extrato do PGDAS-D que o contador gera) com o faturamento real do sistema, por CNPJ:
 * receita declarada no mês e nos meses anteriores, separação revenda × serviços, conta do DAS, limites e se o DAS
 * está lançado nas contas a pagar. O sistema não recalcula o imposto (isso é do contador); ele confere os números que entram nele.
 */

const COMPETENCIA = /^\d{4}-(0[1-9]|1[0-2])$/;
const r2 = (v: number) => Math.round(v * 100) / 100;
const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
const digitos = (t: string | null | undefined) => (t ?? '').replace(/\D/g, '');
const somaMes = (c: string, k: number) => { const [a, m] = c.split('-').map(Number); const t = a * 12 + m - 1 + k; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };

class TributosDto {
  @IsNumber() irpj!: number; @IsNumber() csll!: number; @IsNumber() cofins!: number; @IsNumber() pis!: number;
  @IsNumber() cpp!: number; @IsNumber() icms!: number; @IsNumber() ipi!: number; @IsNumber() iss!: number;
}
class AtividadeDto {
  @IsString() @MaxLength(400) descricao!: string;
  @IsNumber() @Min(0) receita!: number;
  @ValidateNested() @Type(() => TributosDto) tributos!: TributosDto;
  @IsNumber() @Min(0) total!: number;
}
class MesDto { @Matches(COMPETENCIA) competencia!: string; @IsNumber() @Min(0) valor!: number }
class SimplesDto {
  @IsString() @MaxLength(18) cnpj!: string;
  @IsOptional() @IsString() @MaxLength(150) nome?: string;
  @Matches(COMPETENCIA) competencia!: string;
  @IsNumber() @Min(0) receitaPa!: number;
  @IsNumber() @Min(0) rbt12!: number;
  @IsNumber() @Min(0) rba!: number;
  @IsNumber() @Min(0) rbaa!: number;
  @IsOptional() @IsNumber() @Min(0) sublimite?: number;
  @IsArray() @ArrayMaxSize(36) @ValidateNested({ each: true }) @Type(() => MesDto) receitasAnteriores!: MesDto[];
  @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => AtividadeDto) atividades!: AtividadeDto[];
  @IsNumber() @Min(0) totalDas!: number;
  @IsOptional() @IsNumber() @Min(0) principal?: number;
  @IsOptional() @IsNumber() @Min(0) multa?: number;
  @IsOptional() @IsNumber() @Min(0) juros?: number;
  @IsOptional() @Matches(/^(\d{4}-\d{2}-\d{2})?$/) vencimento?: string;
  @IsOptional() @IsString() @MaxLength(30) numeroDas?: string;
  @IsOptional() @IsBoolean() pagamentoReconhecido?: boolean;
}
class SalvarSimplesDto {
  @ValidateNested() @Type(() => SimplesDto) dados!: SimplesDto;
  @IsOptional() @IsString() @MaxLength(11_000_000) arquivo?: string;
  @IsOptional() @IsString() @MaxLength(160) nomeArquivo?: string;
}
class LerDto { @IsString() @MaxLength(11_000_000) arquivo!: string }

interface Receita { mercadorias: number; servicos: number; descontos: number; bruto: number; liquido: number }

@Injectable()
export class SimplesService {
  constructor(private readonly ds: DataSource, private readonly leitor: LeitorContadorService) {}

  /** CNPJs (básico = 8 primeiros dígitos) da empresa: o principal e os dos ambientes */
  private async cnpjs(empresaId: string) {
    const [e] = await this.ds.query(`SELECT cnpj, razao_social, nome FROM empresas WHERE id = $1`, [empresaId]).catch(() => this.ds.query(`SELECT cnpj, nome FROM empresas WHERE id = $1`, [empresaId]));
    const amb: { cnpj: string | null; nome: string; razao_social: string | null }[] = await this.ds.query(`SELECT cnpj, nome, razao_social FROM ambientes WHERE empresa_id = $1`, [empresaId]);
    const principal = digitos(e?.cnpj);
    return { principal, basicos: [...new Set([principal, ...amb.map((a) => digitos(a.cnpj))].filter((c) => c.length >= 8).map((c) => c.slice(0, 8)))] };
  }

  /**
   * faturamento do sistema por mês para um CNPJ básico: contas fechadas e balcão pelo CNPJ do ambiente
   * (ambiente sem CNPJ = empresa principal) e os lançamentos avulsos do faturamento pelo CNPJ deles
   */
  private async receitas(empresaId: string, basico: string, de: string, ate: string) {
    const { principal } = await this.cnpjs(empresaId);
    const doCnpj = `left(COALESCE(NULLIF(regexp_replace(COALESCE(a.cnpj,''), '\\D', '', 'g'), ''), $4), 8) = $5`;
    const tz = `AT TIME ZONE 'America/Sao_Paulo'`;
    const ini = `${de}-01`, fim = `${somaMes(ate, 1)}-01`;
    const contas: { mes: string; servicos: string; consumo: string; desconto: string; acrescimo: string }[] = await this.ds.query(
      `SELECT to_char(e.saida_em ${tz}, 'YYYY-MM') AS mes, sum(COALESCE(e.valor_hospedagem,0) + COALESCE(e.valor_pessoas,0)) AS servicos, sum(COALESCE(e.valor_consumo,0)) AS consumo,
              sum(COALESCE(e.desconto,0)) AS desconto, sum(COALESCE(e.acrescimo,0)) AS acrescimo
         FROM estadias e JOIN ambientes a ON a.id = e.ambiente_id
        WHERE e.empresa_id = $1 AND e.status = 'fechada' AND e.saida_em >= ($2::date)::timestamp ${tz} AND e.saida_em < ($3::date)::timestamp ${tz} AND ${doCnpj} GROUP BY 1`,
      [empresaId, ini, fim, principal, basico]);
    const balcao: { mes: string; total: string }[] = await this.ds.query(
      `SELECT to_char(v.criado_em ${tz}, 'YYYY-MM') AS mes, sum(v.total) AS total FROM vendas_avulsas v JOIN ambientes a ON a.id = v.ambiente_id
        WHERE v.empresa_id = $1 AND NOT v.cancelada AND v.criado_em >= ($2::date)::timestamp ${tz} AND v.criado_em < ($3::date)::timestamp ${tz} AND ${doCnpj} GROUP BY 1`,
      [empresaId, ini, fim, principal, basico]);
    const avulsos: { mes: string; total: string }[] = await this.ds.query(
      `SELECT to_char(c.criado_em ${tz}, 'YYYY-MM') AS mes, sum(c.valor) AS total FROM contas_receber c
        WHERE c.empresa_id = $1 AND c.estadia_id IS NULL AND c.status <> 'cancelada' AND c.criado_em >= ($2::date)::timestamp ${tz} AND c.criado_em < ($3::date)::timestamp ${tz}
          AND left(COALESCE(NULLIF(c.cnpj, ''), $4), 8) = $5 GROUP BY 1`,
      [empresaId, ini, fim, principal, basico]).catch(() => []);
    const m = new Map<string, Receita>();
    const pega = (mes: string) => { if (!m.has(mes)) m.set(mes, { mercadorias: 0, servicos: 0, descontos: 0, bruto: 0, liquido: 0 }); return m.get(mes)!; };
    for (const c of contas) { const x = pega(c.mes); x.servicos += Number(c.servicos) + Number(c.acrescimo); x.mercadorias += Number(c.consumo); x.descontos += Number(c.desconto); }
    for (const b of balcao) pega(b.mes).mercadorias += Number(b.total);
    for (const a of avulsos) pega(a.mes).servicos += Number(a.total);
    for (const x of m.values()) { x.bruto = r2(x.servicos + x.mercadorias); x.liquido = r2(x.bruto - x.descontos); x.servicos = r2(x.servicos); x.mercadorias = r2(x.mercadorias); x.descontos = r2(x.descontos); }
    return m;
  }

  async conferir(empresaId: string, d: SimplesDto) {
    const itens: Item[] = [];
    const add = (i: Item) => itens.push(i);
    const { basicos } = await this.cnpjs(empresaId);
    const basico = digitos(d.cnpj).slice(0, 8);
    if (basico.length < 8) throw new BadRequestException('CNPJ do extrato inválido.');
    add({ chave: 'cnpj', titulo: 'CNPJ', status: basicos.includes(basico) ? 'ok' : 'atencao', informado: d.cnpj,
      texto: basicos.includes(basico) ? undefined : 'este CNPJ não está no cadastro da empresa nem dos ambientes (Configurações): o faturamento do sistema foi procurado mesmo assim' });

    const meses = [...d.receitasAnteriores.map((x) => x.competencia), d.competencia].sort();
    const rec = await this.receitas(empresaId, basico, meses[0] ?? d.competencia, d.competencia);
    const sis = rec.get(d.competencia) ?? { mercadorias: 0, servicos: 0, descontos: 0, bruto: 0, liquido: 0 };

    // 1. receita do mês: o que o contador declarou × o que o sistema faturou
    const dif = r2(d.receitaPa - sis.liquido);
    const difPct = sis.liquido ? (Math.abs(dif) / sis.liquido) * 100 : 100;
    add({ chave: 'receita', titulo: 'Receita do mês', status: !sis.bruto ? 'atencao' : difPct <= 1 ? 'ok' : difPct <= 5 ? 'atencao' : 'divergente',
      esperado: `${reais(sis.liquido)} (sistema)`, informado: `${reais(d.receitaPa)} (declarado)`, diferenca: dif,
      texto: !sis.bruto ? 'sem faturamento no sistema neste mês para este CNPJ' : `sistema: vendido ${reais(sis.bruto)} − descontos ${reais(sis.descontos)}${dif < 0 ? ' · declarou MENOS que o faturado (risco de multa na fiscalização)' : dif > 0 ? ' · declarou mais que o faturado (paga imposto a mais)' : ''}` });

    // 2. revenda (mercadorias) × serviços (hospedagem)
    const revenda = r2(d.atividades.filter((a) => /revenda|venda de mercad|comerc/i.test(a.descricao)).reduce((s, a) => s + a.receita, 0));
    const servicos = r2(d.atividades.filter((a) => /presta|servi/i.test(a.descricao)).reduce((s, a) => s + a.receita, 0));
    if (sis.bruto) {
      const propSis = sis.bruto ? sis.mercadorias / sis.bruto : 0;
      const mercLiq = r2(sis.mercadorias - sis.descontos * propSis), servLiq = r2(sis.servicos - sis.descontos * (1 - propSis));
      const ok = (a: number, b: number) => (b ? Math.abs(a - b) / b <= 0.05 : a === 0);
      add({ chave: 'revenda', titulo: 'Revenda de mercadorias (frigobar, bar, cozinha, balcão)', status: ok(revenda, mercLiq) ? 'ok' : 'atencao', esperado: reais(mercLiq), informado: reais(revenda), diferenca: r2(revenda - mercLiq),
        texto: 'produtos com substituição tributária ou monofásicos (bebidas) pagam menos imposto: confira se o contador separou' });
      add({ chave: 'servicos', titulo: 'Serviços (hospedagem e locação)', status: ok(servicos, servLiq) ? 'ok' : 'atencao', esperado: reais(servLiq), informado: reais(servicos), diferenca: r2(servicos - servLiq) });
    }
    const somaAtiv = r2(d.atividades.reduce((s, a) => s + a.receita, 0));
    add({ chave: 'atividades', titulo: 'Soma das atividades', status: Math.abs(somaAtiv - d.receitaPa) <= 0.05 ? 'ok' : 'divergente', esperado: reais(d.receitaPa), informado: reais(somaAtiv) });

    // 3. meses anteriores declarados × sistema
    const historico = d.receitasAnteriores.map((x) => {
      const s = rec.get(x.competencia);
      const dd = s ? r2(x.valor - s.liquido) : null;
      return { competencia: x.competencia, declarado: x.valor, sistema: s?.liquido ?? null, diferenca: dd, difPct: s?.liquido ? r2((Math.abs(dd!) / s.liquido) * 100) : null };
    });
    const comDados = historico.filter((h) => h.sistema !== null);
    const ruins = comDados.filter((h) => (h.difPct ?? 0) > 5);
    if (comDados.length) add({ chave: 'historico', titulo: 'Meses anteriores declarados', status: ruins.length ? 'atencao' : 'ok',
      texto: ruins.length ? `${ruins.length} mês(es) com diferença maior que 5%: ${ruins.map((h) => h.competencia.split('-').reverse().join('/')).join(', ')}` : `${comDados.length} mês(es) conferidos com o sistema` });

    // 4. as contas do próprio extrato
    const ult12 = Array.from({ length: 12 }, (_, i) => somaMes(d.competencia, -(i + 1)));
    const rbt12 = r2(d.receitasAnteriores.filter((x) => ult12.includes(x.competencia)).reduce((s, x) => s + x.valor, 0));
    if (d.receitasAnteriores.length >= 12) add({ chave: 'rbt12', titulo: 'Receita dos últimos 12 meses (RBT12)', status: Math.abs(rbt12 - d.rbt12) <= 1 ? 'ok' : 'divergente', esperado: reais(rbt12), informado: reais(d.rbt12),
      texto: 'é ela que define a faixa (alíquota) do Simples' });
    const ano = d.competencia.slice(0, 4);
    const rba = r2(d.receitasAnteriores.filter((x) => x.competencia.startsWith(ano) && x.competencia < d.competencia).reduce((s, x) => s + x.valor, 0) + d.receitaPa);
    add({ chave: 'rba', titulo: `Receita do ano ${ano} (RBA)`, status: Math.abs(rba - d.rba) <= 1 ? 'ok' : 'atencao', esperado: reais(rba), informado: reais(d.rba) });
    const tributos = r2(d.atividades.reduce((s, a) => s + a.total, 0));
    const principal = d.principal ?? r2(d.totalDas - (d.multa ?? 0) - (d.juros ?? 0));
    add({ chave: 'das', titulo: 'DAS (soma dos impostos das atividades)', status: Math.abs(tributos - principal) <= 0.05 ? 'ok' : 'divergente', esperado: reais(tributos), informado: reais(principal) });
    const aliq = d.receitaPa ? (principal / d.receitaPa) * 100 : 0;
    const [ant] = await this.ds.query(
      `SELECT dados FROM simples_apuracoes WHERE empresa_id = $1 AND cnpj_basico = $2 AND competencia < $3 ORDER BY competencia DESC LIMIT 1`, [empresaId, basico, d.competencia]).catch(() => []);
    const aliqAnt = ant?.dados?.receitaPa ? ((ant.dados.principal ?? ant.dados.totalDas) / ant.dados.receitaPa) * 100 : null;
    add({ chave: 'aliquota', titulo: 'Alíquota efetiva do mês', status: aliqAnt !== null && Math.abs(aliq - aliqAnt) > 1.5 ? 'atencao' : 'info', informado: pct(aliq),
      texto: aliqAnt !== null ? `mês anterior: ${pct(aliqAnt)}${Math.abs(aliq - aliqAnt) > 1.5 ? ' (mudou bastante: pergunte ao contador)' : ''}` : 'DAS ÷ receita do mês' });
    if (d.multa || d.juros) add({ chave: 'atraso', titulo: 'Multa e juros', status: 'atencao', informado: reais((d.multa ?? 0) + (d.juros ?? 0)), texto: 'o DAS foi gerado com atraso' });

    // 5. limites do Simples
    const sub = d.sublimite || 3_600_000;
    if (d.rbt12 > 4_800_000 || d.rba > 4_800_000) add({ chave: 'limite', titulo: 'Limite do Simples (R$ 4,8 milhões)', status: 'divergente', informado: reais(Math.max(d.rbt12, d.rba)), texto: 'passou do limite: a empresa sai do Simples. Fale com o contador já.' });
    else if (d.rbt12 > sub || d.rba > sub) add({ chave: 'sublimite', titulo: `Sublimite estadual (${reais(sub)})`, status: 'atencao', informado: `12 meses ${reais(d.rbt12)} · ano ${reais(d.rba)}`,
      texto: 'acima do sublimite, o ICMS e o ISS podem ter que sair do DAS e ser pagos à parte (no ano seguinte ou depois de passar 20%): confira com o contador' });
    const mesN = Number(d.competencia.slice(5, 7));
    const projecao = r2((d.rba / mesN) * 12);
    if (projecao > sub) add({ chave: 'projecao', titulo: `Projeção do ano ${ano}`, status: 'atencao', informado: reais(projecao), texto: `no ritmo atual o ano fecha acima de ${reais(sub)}` });

    // 6. o DAS está nas contas a pagar?
    const conta: { status: string; vencimento: unknown; pago_em: unknown }[] = await this.ds.query(
      `SELECT status, vencimento, pago_em FROM contas_pagar WHERE empresa_id = $1 AND status <> 'cancelada' AND abs(valor - $2) <= 0.05
          AND ($3::date IS NULL OR vencimento BETWEEN $3::date - 10 AND $3::date + 10) ORDER BY vencimento LIMIT 1`,
      [empresaId, d.totalDas, d.vencimento || null]).catch(() => []);
    add({ chave: 'contaspagar', titulo: 'DAS nas contas a pagar', status: conta[0] ? 'ok' : 'atencao',
      informado: conta[0] ? (conta[0].status === 'paga' ? 'lançado e pago' : 'lançado, a pagar') : 'não lançado',
      texto: conta[0] ? undefined : `lance ${reais(d.totalDas)} com vencimento ${d.vencimento ? d.vencimento.split('-').reverse().join('/') : '—'} em Contas a pagar para não esquecer` });
    // 7. a reserva do caixa estava guardando o suficiente?
    const comp: { nome: string; percentual: string | null; valor: string | null }[] = await this.ds.query(
      `SELECT nome, percentual, valor FROM reserva_compromissos WHERE empresa_id = $1 AND ativo AND tipo = 'imposto'`, [empresaId]).catch(() => []);
    for (const c of comp) {
      const previsto = c.percentual !== null ? (Number(c.percentual) / 100) * sis.liquido : Number(c.valor ?? 0);
      if (previsto) add({ chave: `reserva:${c.nome}`, titulo: `Reserva do caixa: ${c.nome}`, status: previsto + 0.5 >= d.totalDas ? 'ok' : 'atencao', esperado: reais(d.totalDas), informado: `${reais(r2(previsto))}${c.percentual !== null ? ` (${pct(Number(c.percentual))})` : ''}`,
        texto: previsto + 0.5 >= d.totalDas ? undefined : `a reserva guarda menos que o DAS: suba para ${pct(Math.ceil(aliq * 10) / 10)} do faturamento` });
    }

    const resumo = { divergencias: itens.filter((i) => i.status === 'divergente').length, atencoes: itens.filter((i) => i.status === 'atencao').length };
    return { itens, resumo, status: resumo.divergencias ? 'divergente' : resumo.atencoes ? 'atencao' : 'ok', historico, sistema: sis, aliquota: r2(aliq), basico };
  }

  async ler(dto: LerDto) {
    return { lido: await this.leitor.lerSimples(dto.arquivo), ia: true };
  }

  async previa(u: UsuarioToken, d: SimplesDto) {
    return this.conferir(u.empresaId, d);
  }

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

  async salvar(u: UsuarioToken, dto: SalvarSimplesDto) {
    const c = await this.conferir(u.empresaId, dto.dados);
    let arq: { rel: string; mime: string } | null = null;
    if (dto.arquivo) {
      const a = this.leitor.arquivo(dto.arquivo);
      const rel = join(u.empresaId, 'contador', `${randomUUID()}.${a.ext}`);
      await fs.mkdir(dirname(this.caminho(rel)), { recursive: true });
      await fs.writeFile(this.caminho(rel), a.bin);
      arq = { rel, mime: a.mime };
    }
    const [r] = await this.ds.query(
      `INSERT INTO simples_apuracoes (empresa_id, cnpj_basico, competencia, dados, arquivo, mime, nome_arquivo, status, divergencias, atencoes, criado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (empresa_id, cnpj_basico, competencia) DO UPDATE SET dados=$4, arquivo=COALESCE($5, simples_apuracoes.arquivo), mime=COALESCE($6, simples_apuracoes.mime),
         nome_arquivo=COALESCE($7, simples_apuracoes.nome_arquivo), status=$8, divergencias=$9, atencoes=$10, criado_por=$11, criado_em=now() RETURNING id`,
      [u.empresaId, c.basico, dto.dados.competencia, JSON.stringify(dto.dados), arq?.rel ?? null, arq?.mime ?? null, arq ? (dto.nomeArquivo || 'extrato-simples.pdf').slice(0, 160) : null,
        c.status, c.resumo.divergencias, c.resumo.atencoes, u.nome]);
    return { ok: true, id: r.id, ...c };
  }

  async listar(u: UsuarioToken) {
    const l = await this.ds.query(
      `SELECT id, cnpj_basico, competencia, status, divergencias, atencoes, dados->>'receitaPa' AS receita, dados->>'totalDas' AS das, dados->>'vencimento' AS vencimento, arquivo IS NOT NULL AS tem_arquivo, criado_por, criado_em
         FROM simples_apuracoes WHERE empresa_id = $1 ORDER BY competencia DESC, cnpj_basico LIMIT 120`, [u.empresaId]);
    return {
      ia: this.leitor.disponivel,
      lista: l.map((x: Record<string, unknown>) => ({
        id: x.id, cnpjBasico: x.cnpj_basico, competencia: x.competencia, status: x.status, divergencias: Number(x.divergencias), atencoes: Number(x.atencoes),
        receita: Number(x.receita), das: Number(x.das), vencimento: x.vencimento || null, temArquivo: !!x.tem_arquivo, por: x.criado_por, em: x.criado_em,
      })),
    };
  }

  async ver(u: UsuarioToken, id: string) {
    const [s] = await this.ds.query(`SELECT * FROM simples_apuracoes WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!s) throw new NotFoundException('Apuração não encontrada.');
    return { id: s.id, dados: s.dados, temArquivo: !!s.arquivo, por: s.criado_por, em: s.criado_em, ...(await this.conferir(u.empresaId, s.dados)) };
  }

  async arquivo(u: UsuarioToken, id: string) {
    const [s] = await this.ds.query(`SELECT arquivo, mime, nome_arquivo FROM simples_apuracoes WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!s?.arquivo) throw new NotFoundException('Arquivo não encontrado.');
    try { return { bin: await fs.readFile(this.caminho(s.arquivo)), mime: s.mime as string, nome: s.nome_arquivo as string }; } catch { throw new NotFoundException('O arquivo não está mais na pasta do servidor.'); }
  }

  async apagar(u: UsuarioToken, id: string) {
    const [s] = await this.ds.query(`DELETE FROM simples_apuracoes WHERE id = $1 AND empresa_id = $2 RETURNING arquivo`, [id, u.empresaId]);
    const rel = Array.isArray(s) ? s[0]?.arquivo : s?.arquivo;
    if (rel) await fs.rm(this.caminho(rel), { force: true }).catch(() => undefined);
    return { ok: true };
  }
}

@Controller('contador/simples')
export class SimplesController {
  constructor(private readonly service: SimplesService) {}

  @Get()
  @Requer('relatorios.ver', 'caixa.adm', 'notas.gerenciar', 'contador.acessar')
  listar(@Usuario() u: UsuarioToken) {
    return this.service.listar(u);
  }

  @Post('ler')
  @Requer('relatorios.ver', 'caixa.adm', 'notas.gerenciar', 'contador.acessar')
  ler(@Body() dto: LerDto) {
    return this.service.ler(dto);
  }

  @Post('previa')
  @Requer('relatorios.ver', 'caixa.adm', 'notas.gerenciar', 'contador.acessar')
  previa(@Usuario() u: UsuarioToken, @Body() dto: SimplesDto) {
    return this.service.previa(u, dto);
  }

  @Post()
  @Requer('relatorios.ver', 'caixa.adm', 'notas.gerenciar', 'contador.acessar')
  salvar(@Usuario() u: UsuarioToken, @Body() dto: SalvarSimplesDto) {
    return this.service.salvar(u, dto);
  }

  @Get(':id')
  @Requer('relatorios.ver', 'caixa.adm', 'notas.gerenciar', 'contador.acessar')
  ver(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.ver(u, id);
  }

  @Get(':id/arquivo')
  @Requer('relatorios.ver', 'caixa.adm', 'notas.gerenciar', 'contador.acessar')
  async abrir(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: { setHeader: (k: string, v: string) => void }) {
    const a = await this.service.arquivo(u, id);
    res.setHeader('Content-Type', a.mime);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(a.nome)}`);
    return new StreamableFile(a.bin);
  }

  @Delete(':id')
  @Requer('relatorios.ver', 'caixa.adm', 'notas.gerenciar', 'contador.acessar')
  apagar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.apagar(u, id);
  }
}
