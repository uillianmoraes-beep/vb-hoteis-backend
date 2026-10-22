import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';
import { CAMPOS, LinhaArquivo, Mapa, acharCabecalho, adivinharMapa, assinatura, lerOfx, lerTabela, linhasDaPlanilha } from './leitura';
import { LinhaConferir, PagamentoSistema, acharDeposito, conferir, taxaContrato } from './conferir';

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const DIA = 86_400_000;
const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const somaDias = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * DIA).toISOString().slice(0, 10);
const diaSP = (d: Date) => new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
/** começo do dia em São Paulo */
const inicioDia = (d: string) => new Date(`${d}T03:00:00Z`);
const linhasDe = (r: unknown) => (Array.isArray(r) && Array.isArray(r[0]) ? (r[0] as unknown[]) : (r as unknown[]));

class ImportarDto {
  @IsIn(['banco', 'maquininha']) origem!: 'banco' | 'maquininha';
  @IsOptional() @IsUUID() contaBancariaId?: string;
  @IsOptional() @IsUUID() maquininhaId?: string;
  @IsString() @MinLength(3) @MaxLength(200) nome!: string;
  /** arquivo em base64 (OFX, XLSX ou CSV) */
  @IsString() @MaxLength(14_000_000) arquivo!: string;
  /** planilha: número da coluna de cada campo (conferido pelo cliente) */
  @IsOptional() @IsObject() mapa?: Mapa;
  /** planilha: linha do cabeçalho (0 = primeira) */
  @IsOptional() @IsInt() @Min(0) @Max(50) cabecalho?: number;
  @IsOptional() @IsBoolean() simular?: boolean;
}
class ConfirmarDto {
  @IsOptional() @IsUUID() pagamentoId?: string;
  /** troca o código digitado na recepção pelo do arquivo */
  @IsOptional() @IsBoolean() corrigirCodigo?: boolean;
}
class IgnorarDto {
  @IsString() @MinLength(3) @MaxLength(300) motivo!: string;
}
class PeriodoDto {
  @Matches(DATA) de!: string;
  @Matches(DATA) ate!: string;
}

interface Maq { id: string; nome: string; conta_bancaria_id: string | null; taxa_debito: string | null; taxa_credito: string | null; taxa_credito_2a6: string | null; taxa_credito_7a12: string | null; taxa_pix: string | null }
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const taxasMaq = (m: Maq) => ({ taxaDebito: n(m.taxa_debito), taxaCredito: n(m.taxa_credito), taxaCredito2a6: n(m.taxa_credito_2a6), taxaCredito7a12: n(m.taxa_credito_7a12), taxaPix: n(m.taxa_pix) });

@Injectable()
export class ConciliacaoService {
  constructor(private readonly ds: DataSource) {}

  /* ---------------- importar ---------------- */

  async importar(u: UsuarioToken, dto: ImportarDto) {
    const buf = Buffer.from(dto.arquivo, 'base64');
    if (buf.length > 10_000_000) throw new BadRequestException('Arquivo grande demais (até 10 MB). Exporte um período menor.');
    let maq: Maq | null = null;
    if (dto.origem === 'maquininha') {
      if (!dto.maquininhaId) throw new BadRequestException('Escolha de qual maquininha é o relatório.');
      [maq] = await this.ds.query(`SELECT * FROM maquininhas WHERE id = $1 AND empresa_id = $2`, [dto.maquininhaId, u.empresaId]);
      if (!maq) throw new BadRequestException('Maquininha não encontrada.');
    }
    if (dto.contaBancariaId) {
      const [c] = await this.ds.query(`SELECT id FROM contas_bancarias WHERE id = $1 AND empresa_id = $2`, [dto.contaBancariaId, u.empresaId]);
      if (!c) throw new BadRequestException('Conta bancária não encontrada.');
    }
    const dono = dto.maquininhaId ?? dto.contaBancariaId ?? 'geral';
    const ofx = /\.ofx$/i.test(dto.nome) || buf.subarray(0, 400).toString('latin1').includes('OFX');
    let linhas: LinhaArquivo[];
    let erros: string[] = [];
    let formato = 'ofx';
    let previaPlanilha: Record<string, unknown> | null = null;
    if (ofx) {
      linhas = lerOfx(buf).linhas;
      if (!linhas.length) throw new BadRequestException('Não achei lançamentos neste OFX.');
    } else {
      formato = /\.(csv|txt)$/i.test(dto.nome) ? 'csv' : 'xlsx';
      let tabela: unknown[][];
      try { tabela = await lerTabela(buf, dto.nome); } catch { throw new BadRequestException('Não consegui ler o arquivo. Use OFX, Excel (.xlsx) ou CSV.'); }
      if (tabela.length < 2) throw new BadRequestException('A planilha está vazia.');
      const cab = dto.cabecalho ?? acharCabecalho(tabela);
      if (cab < 0) throw new BadRequestException('Não achei a linha com os títulos das colunas.');
      const titulos = tabela[cab].map((x) => String(x ?? '').trim());
      const ass = assinatura(titulos);
      const [salvo] = await this.ds.query(`SELECT mapa FROM conciliacao_modelos WHERE empresa_id = $1 AND assinatura = $2 ORDER BY criado_em DESC LIMIT 1`, [u.empresaId, ass]);
      const mapa: Mapa = dto.mapa ?? (salvo?.mapa as Mapa) ?? adivinharMapa(titulos);
      previaPlanilha = {
        titulos, cabecalho: cab, mapa, modeloSalvo: !!salvo && !dto.mapa, campos: CAMPOS,
        amostra: tabela.slice(cab + 1, cab + 6).map((l) => titulos.map((_, i) => { const v = l[i]; return v instanceof Date ? v.toISOString().slice(0, 16).replace('T', ' ') : String(v ?? ''); })),
      };
      if (mapa.data === undefined || (mapa.bruto === undefined && mapa.liquido === undefined)) {
        return { precisaConferir: true, ...previaPlanilha, motivo: 'Diga qual coluna é a data e qual é o valor.' };
      }
      ({ linhas, erros } = linhasDaPlanilha(tabela, cab, mapa, dto.origem, dono));
      if (!linhas.length) return { precisaConferir: true, ...previaPlanilha, motivo: 'Com estas colunas não saiu nenhuma linha com data e valor. Confira as colunas.' };
      if (!dto.simular) {
        await this.ds.query(`DELETE FROM conciliacao_modelos WHERE empresa_id = $1 AND assinatura = $2`, [u.empresaId, ass]);
        await this.ds.query(`INSERT INTO conciliacao_modelos (empresa_id, origem, maquininha_id, conta_bancaria_id, assinatura, mapa) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
          [u.empresaId, dto.origem, dto.maquininhaId ?? null, dto.contaBancariaId ?? null, ass, JSON.stringify(mapa)]);
      }
    }
    const datas = linhas.map((l) => diaSP(l.momento)).sort();
    const de = datas[0];
    const ate = datas[datas.length - 1];
    const resumo = {
      linhas: linhas.length, de, ate, erros: erros.slice(0, 20),
      entradas: linhas.filter((l) => l.valorBruto > 0).length, saidas: linhas.filter((l) => l.valorBruto < 0).length,
      total: Math.round(linhas.reduce((s, l) => s + l.valorBruto, 0) * 100) / 100,
      formas: { pix: linhas.filter((l) => l.forma === 'pix').length, debito: linhas.filter((l) => l.forma === 'debito').length, credito: linhas.filter((l) => l.forma === 'credito').length },
      comCodigo: linhas.filter((l) => l.nsu || l.autorizacao).length,
    };
    if (dto.simular) return { precisaConferir: false, ...(previaPlanilha ?? {}), formato, resumo };

    const res = await this.ds.transaction(async (m) => {
      const [imp] = await m.query(
        `INSERT INTO conciliacao_importacoes (empresa_id, origem, formato, maquininha_id, conta_bancaria_id, arquivo, de, ate, linhas, criado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [u.empresaId, dto.origem, formato, dto.maquininhaId ?? null, dto.contaBancariaId ?? (maq?.conta_bancaria_id ?? null), dto.nome.slice(0, 200), de, ate, linhas.length, u.nome]);
      let novas = 0;
      for (const l of linhas) {
        // saída no extrato do banco não é recebimento: fica guardada, fora da conferência
        const saida = l.valorBruto < 0;
        const r = await m.query(
          `INSERT INTO conciliacao_linhas (empresa_id, importacao_id, origem, maquininha_id, conta_bancaria_id, chave, momento, tem_hora, data_pagamento, forma, bandeira, parcelas,
             nsu, autorizacao, valor_bruto, taxa, valor_liquido, descricao, status, situacao)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) ON CONFLICT DO NOTHING RETURNING id`,
          [u.empresaId, imp.id, dto.origem, dto.maquininhaId ?? null, dto.contaBancariaId ?? (maq?.conta_bancaria_id ?? null), l.chave, l.momento, l.temHora, l.dataPagamento, l.forma,
            l.bandeira, l.parcelas, l.nsu, l.autorizacao, l.valorBruto.toFixed(2), l.taxa === null ? null : l.taxa.toFixed(2), l.valorLiquido === null ? null : l.valorLiquido.toFixed(2),
            l.descricao, saida ? 'ignorada' : 'pendente', saida ? 'saída do banco' : null]);
        if (linhasDe(r).length) novas++;
      }
      await m.query(`UPDATE conciliacao_importacoes SET linhas = $2, repetidas = $3 WHERE id = $1`, [imp.id, novas, linhas.length - novas]);
      return { id: imp.id, novas, repetidas: linhas.length - novas };
    });
    const conf = await this.conferirPeriodo(u.empresaId, somaDias(de, -2), somaDias(ate, 2));
    return { precisaConferir: false, importado: true, ...res, resumo, conferencia: conf };
  }

  /* ---------------- conferir ---------------- */

  async conferirPeriodo(empresaId: string, de: string, ate: string) {
    return this.ds.transaction(async (m) => {
      const ini = inicioDia(somaDias(de, -1));
      const fim = inicioDia(somaDias(ate, 2));
      // as sugestões são refeitas (podem ter chegado arquivos ou códigos novos); verde e ignorada ficam
      await m.query(`UPDATE conciliacao_linhas SET status = 'pendente', situacao = NULL, pagamento_id = NULL
                      WHERE empresa_id = $1 AND status = 'sugerida' AND momento BETWEEN $2 AND $3`, [empresaId, ini, fim]);
      const linhas = await m.query(
        `SELECT * FROM conciliacao_linhas WHERE empresa_id = $1 AND status = 'pendente' AND valor_bruto > 0 AND momento BETWEEN $2 AND $3`, [empresaId, ini, fim]);
      let verdes = 0, amarelas = 0;
      for (const origem of ['maquininha', 'banco'] as const) {
        const minhas: LinhaConferir[] = linhas.filter((l: { origem: string }) => l.origem === origem).map((l: Record<string, unknown>) => ({
          id: l.id as string, origem, momento: new Date(l.momento as string), temHora: !!l.tem_hora, forma: (l.forma as string) ?? null,
          nsu: (l.nsu as string) ?? null, autorizacao: (l.autorizacao as string) ?? null, valorBruto: Number(l.valor_bruto), descricao: (l.descricao as string) ?? null,
        }));
        if (!minhas.length) continue;
        // pagamentos ainda sem par nesta origem (o mesmo Pix pode estar no relatório da maquininha e no extrato)
        const pags: PagamentoSistema[] = (await m.query(
          `SELECT p.id, p.forma, p.valor, p.criado_em, p.comprovante FROM estadia_pagamentos p
            WHERE p.empresa_id = $1 AND p.forma IN ('pix','debito','credito') AND p.criado_em BETWEEN $2 AND $3
              AND NOT EXISTS (SELECT 1 FROM conciliacao_linhas c WHERE c.pagamento_id = p.id AND c.origem = $4 AND c.status IN ('conciliada','sugerida'))`,
          [empresaId, new Date(ini.getTime() - DIA), new Date(fim.getTime() + DIA), origem])).map((p: Record<string, unknown>) => ({
          id: p.id as string, forma: p.forma as string, valor: Number(p.valor), momento: new Date(p.criado_em as string), comprovante: (p.comprovante as string) ?? null,
        }));
        for (const r of conferir(minhas, pags)) {
          await m.query(`UPDATE conciliacao_linhas SET status = $2::varchar, situacao = $3, pagamento_id = $4, conferido_por = CASE WHEN $2::varchar = 'conciliada' THEN 'automático' END,
                           conferido_em = CASE WHEN $2::varchar = 'conciliada' THEN now() END WHERE id = $1`, [r.linhaId, r.status, r.situacao, r.pagamentoId]);
          if (r.status === 'conciliada') verdes++; else amarelas++;
        }
      }
      verdes += await this.conferirDepositos(m, empresaId, ini, fim);
      return { verdes, amarelas };
    });
  }

  /** créditos do banco que são o depósito das vendas de cartão de uma maquininha */
  private async conferirDepositos(m: EntityManager, empresaId: string, ini: Date, fim: Date) {
    const creditos = await m.query(
      `SELECT id, momento, valor_bruto, conta_bancaria_id FROM conciliacao_linhas
        WHERE empresa_id = $1 AND origem = 'banco' AND status = 'pendente' AND valor_bruto > 0 AND COALESCE(forma, '') <> 'pix' AND momento BETWEEN $2 AND $3`,
      [empresaId, ini, fim]);
    if (!creditos.length) return 0;
    const grupos = (await m.query(
      `SELECT l.maquininha_id, mq.nome, mq.conta_bancaria_id, to_char(l.data_pagamento, 'YYYY-MM-DD') AS dia, sum(l.valor_liquido) AS liquido, count(*)::int AS qtd
         FROM conciliacao_linhas l JOIN maquininhas mq ON mq.id = l.maquininha_id
        WHERE l.empresa_id = $1 AND l.origem = 'maquininha' AND l.data_pagamento IS NOT NULL AND l.valor_liquido IS NOT NULL AND l.status <> 'ignorada'
          AND l.data_pagamento BETWEEN ($2::timestamptz - interval '5 days')::date AND ($3::timestamptz + interval '5 days')::date
          AND NOT EXISTS (SELECT 1 FROM conciliacao_linhas b WHERE b.origem = 'banco' AND b.status = 'conciliada'
                            AND b.deposito_de->>'chave' = l.maquininha_id::text || ':' || to_char(l.data_pagamento, 'YYYY-MM-DD'))
        GROUP BY l.maquininha_id, mq.nome, mq.conta_bancaria_id, l.data_pagamento`, [empresaId, ini, fim]))
      .map((g: Record<string, unknown>) => ({ chave: `${g.maquininha_id}:${g.dia}`, maquininha: g.nome as string, conta: g.conta_bancaria_id as string | null, dia: g.dia as string, liquido: Number(g.liquido), qtd: Number(g.qtd) }));
    let feitos = 0;
    const usados = new Set<string>();
    for (const c of creditos) {
      const dela = grupos.filter((g: { conta: string | null; chave: string }) => !usados.has(g.chave) && (!c.conta_bancaria_id || !g.conta || g.conta === c.conta_bancaria_id));
      const d = acharDeposito({ valor: Number(c.valor_bruto), dia: diaSP(new Date(c.momento)) }, dela);
      if (!d) continue;
      usados.add(d.chave);
      await m.query(`UPDATE conciliacao_linhas SET status = 'conciliada', situacao = $2, deposito_de = $3::jsonb, conferido_por = 'automático', conferido_em = now() WHERE id = $1`,
        [c.id, `depósito da ${d.maquininha} (${d.qtd} venda${d.qtd > 1 ? 's' : ''})`, JSON.stringify(d)]);
      feitos++;
    }
    return feitos;
  }

  /* ---------------- tela ---------------- */

  async ver(u: UsuarioToken, de: string, ate: string) {
    const ini = inicioDia(de);
    const fim = inicioDia(somaDias(ate, 1));
    const maqs: Maq[] = await this.ds.query(`SELECT * FROM maquininhas WHERE empresa_id = $1`, [u.empresaId]);
    const mapaMaq = new Map(maqs.map((x) => [x.id, x]));
    const linhas = await this.ds.query(
      `SELECT l.*, cb.nome AS conta_nome, p.forma AS p_forma, p.valor AS p_valor, p.criado_em AS p_momento, p.comprovante AS p_comprovante, p.usuario_nome AS p_usuario,
              p.maquininha AS p_maquininha, p.estadia_id AS p_estadia, e.numero AS p_uso, un.codigo AS p_unidade
         FROM conciliacao_linhas l LEFT JOIN contas_bancarias cb ON cb.id = l.conta_bancaria_id
         LEFT JOIN estadia_pagamentos p ON p.id = l.pagamento_id LEFT JOIN estadias e ON e.id = p.estadia_id LEFT JOIN unidades un ON un.id = e.unidade_id
        WHERE l.empresa_id = $1 AND l.momento >= $2 AND l.momento < $3 ORDER BY l.momento`, [u.empresaId, ini, fim]);
    let taxaAMais = 0;
    const lista = linhas.map((l: Record<string, unknown>) => {
      const maq = l.maquininha_id ? mapaMaq.get(l.maquininha_id as string) : undefined;
      const bruto = Number(l.valor_bruto);
      const taxa = n(l.taxa);
      let auditoria: { cobrada: number; contrato: number; aMais: number } | null = null;
      if (maq && taxa !== null && bruto > 0) {
        const contrato = taxaContrato(taxasMaq(maq), l.forma as string | null, n(l.parcelas));
        const cobrada = Math.round((taxa / bruto) * 10000) / 100;
        if (contrato !== null && cobrada > contrato + 0.01) {
          const aMais = Math.round((taxa - (bruto * contrato) / 100) * 100) / 100;
          if (aMais >= 0.01) { auditoria = { cobrada, contrato, aMais }; taxaAMais += aMais; }
        }
      }
      return {
        id: l.id, origem: l.origem, maquininha: maq?.nome ?? null, conta: l.conta_nome ?? null, momento: l.momento, temHora: l.tem_hora,
        dataPagamento: l.data_pagamento ? String(l.data_pagamento instanceof Date ? l.data_pagamento.toISOString() : l.data_pagamento).slice(0, 10) : null,
        forma: l.forma, bandeira: l.bandeira, parcelas: l.parcelas, nsu: l.nsu, autorizacao: l.autorizacao, valorBruto: bruto, taxa, valorLiquido: n(l.valor_liquido),
        descricao: l.descricao, status: l.status, situacao: l.situacao, observacao: l.observacao, conferidoPor: l.conferido_por, deposito: l.deposito_de ?? null, auditoria,
        pagamento: l.pagamento_id ? {
          id: l.pagamento_id, forma: l.p_forma, valor: Number(l.p_valor), momento: l.p_momento, comprovante: l.p_comprovante, usuario: l.p_usuario,
          maquininha: l.p_maquininha, estadiaId: l.p_estadia, uso: l.p_uso, unidade: l.p_unidade,
        } : null,
      };
    });
    // pagamentos sem par: só nos dias que algum arquivo importado cobre (antes de importar, nada é "falta")
    const [cob] = await this.ds.query(
      `SELECT min(de) AS de, max(ate) AS ate FROM conciliacao_importacoes WHERE empresa_id = $1 AND ate >= $2 AND de <= $3`, [u.empresaId, de, ate]);
    let semPar: unknown[] = [];
    if (cob?.de) {
      const cIni = inicioDia(String(cob.de instanceof Date ? cob.de.toISOString() : cob.de).slice(0, 10) > de ? String(cob.de instanceof Date ? cob.de.toISOString() : cob.de).slice(0, 10) : de);
      const cAteTxt = String(cob.ate instanceof Date ? cob.ate.toISOString() : cob.ate).slice(0, 10);
      const cFim = inicioDia(somaDias(cAteTxt < ate ? cAteTxt : ate, 1));
      semPar = (await this.ds.query(
        `SELECT p.id, p.forma, p.valor, p.criado_em, p.comprovante, p.maquininha, p.usuario_nome, p.estadia_id, e.numero, un.codigo
           FROM estadia_pagamentos p JOIN estadias e ON e.id = p.estadia_id LEFT JOIN unidades un ON un.id = e.unidade_id
          WHERE p.empresa_id = $1 AND p.forma IN ('pix','debito','credito') AND p.criado_em >= $2 AND p.criado_em < $3
            AND NOT EXISTS (SELECT 1 FROM conciliacao_linhas c WHERE c.pagamento_id = p.id AND c.status IN ('conciliada','sugerida'))
          ORDER BY p.criado_em`, [u.empresaId, cIni, cFim])).map((p: Record<string, unknown>) => ({
        id: p.id, forma: p.forma, valor: Number(p.valor), momento: p.criado_em, comprovante: p.comprovante, maquininha: p.maquininha, usuario: p.usuario_nome,
        estadiaId: p.estadia_id, uso: p.numero, unidade: p.codigo,
      }));
    }
    const conta = (s: string) => lista.filter((l: { status: string }) => l.status === s).length;
    const importacoes = await this.ds.query(
      `SELECT i.id, i.origem, i.formato, i.arquivo, i.de, i.ate, i.linhas, i.repetidas, i.criado_por, i.criado_em, mq.nome AS maquininha, cb.nome AS conta
         FROM conciliacao_importacoes i LEFT JOIN maquininhas mq ON mq.id = i.maquininha_id LEFT JOIN contas_bancarias cb ON cb.id = i.conta_bancaria_id
        WHERE i.empresa_id = $1 AND i.ate >= $2 AND i.de <= $3 ORDER BY i.criado_em DESC LIMIT 50`, [u.empresaId, de, ate]);
    // erros por recepcionista: sugestões (código/forma/valor errado) e pagamentos sem par
    const porUsuario = new Map<string, { usuario: string; avisos: number; semPar: number }>();
    for (const l of lista) {
      if (l.status !== 'sugerida' || !l.pagamento?.usuario) continue;
      const k = porUsuario.get(l.pagamento.usuario) ?? { usuario: l.pagamento.usuario, avisos: 0, semPar: 0 };
      k.avisos++; porUsuario.set(l.pagamento.usuario, k);
    }
    for (const p of semPar as { usuario: string | null }[]) {
      if (!p.usuario) continue;
      const k = porUsuario.get(p.usuario) ?? { usuario: p.usuario, avisos: 0, semPar: 0 };
      k.semPar++; porUsuario.set(p.usuario, k);
    }
    return {
      de, ate,
      resumo: {
        verdes: conta('conciliada'), amarelas: conta('sugerida'), vermelhasBanco: conta('pendente'), semParSistema: semPar.length, ignoradas: conta('ignorada'),
        taxaAMais: Math.round(taxaAMais * 100) / 100,
      },
      linhas: lista, semPar, importacoes,
      porUsuario: [...porUsuario.values()].sort((a, b) => b.avisos + b.semPar - (a.avisos + a.semPar)),
      maquininhas: maqs.filter((x) => (x as unknown as { ativo: boolean }).ativo !== false).map((x) => ({ id: x.id, nome: x.nome })),
      contas: await this.ds.query(`SELECT id, nome FROM contas_bancarias WHERE empresa_id = $1 AND ativo ORDER BY nome`, [u.empresaId]),
    };
  }

  /** pagamentos que podem ser o par desta linha (para ligar à mão) */
  async candidatos(u: UsuarioToken, id: string) {
    const l = await this.linha(u, id);
    const mom = new Date(l.momento);
    const l2 = await this.ds.query(
      `SELECT p.id, p.forma, p.valor, p.criado_em, p.comprovante, p.maquininha, p.usuario_nome, e.numero, un.codigo,
              EXISTS (SELECT 1 FROM conciliacao_linhas c WHERE c.pagamento_id = p.id AND c.status = 'conciliada' AND c.origem = $5) AS ja
         FROM estadia_pagamentos p JOIN estadias e ON e.id = p.estadia_id LEFT JOIN unidades un ON un.id = e.unidade_id
        WHERE p.empresa_id = $1 AND p.forma IN ('pix','debito','credito') AND p.criado_em BETWEEN $2 AND $3
        ORDER BY abs(p.valor - $4), abs(extract(epoch FROM p.criado_em - $6::timestamptz)) LIMIT 25`,
      [u.empresaId, new Date(mom.getTime() - 2 * DIA), new Date(mom.getTime() + 2 * DIA), Number(l.valor_bruto), l.origem, mom]);
    return l2.map((p: Record<string, unknown>) => ({
      id: p.id, forma: p.forma, valor: Number(p.valor), momento: p.criado_em, comprovante: p.comprovante, maquininha: p.maquininha, usuario: p.usuario_nome,
      uso: p.numero, unidade: p.codigo, jaConciliado: !!p.ja,
    }));
  }

  private async linha(u: UsuarioToken, id: string) {
    const [l] = await this.ds.query(`SELECT * FROM conciliacao_linhas WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!l) throw new NotFoundException('Linha não encontrada.');
    return l;
  }

  async confirmar(u: UsuarioToken, id: string, dto: ConfirmarDto) {
    const l = await this.linha(u, id);
    const pagamentoId = dto.pagamentoId ?? l.pagamento_id;
    if (pagamentoId) {
      const [p] = await this.ds.query(`SELECT p.id, p.comprovante, p.estadia_id FROM estadia_pagamentos p WHERE p.id = $1 AND p.empresa_id = $2`, [pagamentoId, u.empresaId]);
      if (!p) throw new BadRequestException('Pagamento não encontrado.');
      const novo = l.nsu ?? l.autorizacao;
      await this.ds.transaction(async (m) => {
        if (dto.corrigirCodigo && novo && novo !== p.comprovante) {
          await m.query(`UPDATE estadia_pagamentos SET comprovante = $2 WHERE id = $1`, [p.id, String(novo).slice(0, 60)]);
          await m.query(`INSERT INTO estadia_eventos (empresa_id, estadia_id, tipo, descricao, usuario_id, usuario_nome) VALUES ($1,$2,'ajuste',$3,$4,$5)`,
            [u.empresaId, p.estadia_id, `Conciliação: código do comprovante ${p.comprovante ?? '—'} → ${novo}`, u.sub, u.nome]);
        }
        await m.query(`UPDATE conciliacao_linhas SET status = 'conciliada', pagamento_id = $2, situacao = COALESCE(situacao, 'ligada à mão'),
                         observacao = $3, conferido_por = $4, conferido_em = now() WHERE id = $1`,
          [id, p.id, dto.corrigirCodigo && novo && novo !== p.comprovante ? `código corrigido de ${p.comprovante ?? '—'} para ${novo}` : l.observacao, u.nome]);
      });
    } else {
      await this.ds.query(`UPDATE conciliacao_linhas SET status = 'conciliada', situacao = COALESCE(situacao, 'conferida à mão'), conferido_por = $2, conferido_em = now() WHERE id = $1`, [id, u.nome]);
    }
    return { ok: true };
  }

  async ignorar(u: UsuarioToken, id: string, dto: IgnorarDto) {
    await this.linha(u, id);
    await this.ds.query(`UPDATE conciliacao_linhas SET status = 'ignorada', pagamento_id = NULL, observacao = $2, conferido_por = $3, conferido_em = now() WHERE id = $1`,
      [id, dto.motivo.trim(), u.nome]);
    return { ok: true };
  }

  async desfazer(u: UsuarioToken, id: string) {
    await this.linha(u, id);
    await this.ds.query(`UPDATE conciliacao_linhas SET status = 'pendente', situacao = NULL, pagamento_id = NULL, deposito_de = NULL, observacao = NULL,
                           conferido_por = NULL, conferido_em = NULL WHERE id = $1`, [id]);
    return { ok: true };
  }

  async excluirImportacao(u: UsuarioToken, id: string) {
    const r = await this.ds.query(`DELETE FROM conciliacao_importacoes WHERE id = $1 AND empresa_id = $2 RETURNING id`, [id, u.empresaId]);
    if (!linhasDe(r).length) throw new NotFoundException('Importação não encontrada.');
    return { ok: true };
  }
}

@Controller('conciliacao')
export class ConciliacaoController {
  constructor(private readonly service: ConciliacaoService) {}

  @Get()
  @Requer('caixa.adm')
  ver(@Usuario() u: UsuarioToken, @Query('de') de?: string, @Query('ate') ate?: string) {
    const a = ate && DATA.test(ate) ? ate : hojeSP();
    const d = de && DATA.test(de) ? de : somaDias(a, -6);
    if (d > a) throw new BadRequestException('A data inicial é depois da final.');
    if ((Date.parse(a) - Date.parse(d)) / DIA > 92) throw new BadRequestException('Escolha até 3 meses.');
    return this.service.ver(u, d, a);
  }

  @Post('importar')
  @HttpCode(200)
  @Requer('caixa.adm')
  importar(@Usuario() u: UsuarioToken, @Body() dto: ImportarDto) {
    return this.service.importar(u, dto);
  }

  @Post('conferir')
  @HttpCode(200)
  @Requer('caixa.adm')
  conferir(@Usuario() u: UsuarioToken, @Body() dto: PeriodoDto) {
    return this.service.conferirPeriodo(u.empresaId, dto.de, dto.ate);
  }

  @Get('linhas/:id/candidatos')
  @Requer('caixa.adm')
  candidatos(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.candidatos(u, id);
  }

  @Post('linhas/:id/confirmar')
  @HttpCode(200)
  @Requer('caixa.adm')
  confirmar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ConfirmarDto) {
    return this.service.confirmar(u, id, dto);
  }

  @Post('linhas/:id/ignorar')
  @HttpCode(200)
  @Requer('caixa.adm')
  ignorar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: IgnorarDto) {
    return this.service.ignorar(u, id, dto);
  }

  @Post('linhas/:id/desfazer')
  @HttpCode(200)
  @Requer('caixa.adm')
  desfazer(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.desfazer(u, id);
  }

  @Delete('importacoes/:id')
  @Requer('caixa.adm')
  excluir(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.excluirImportacao(u, id);
  }
}

@Module({ providers: [ConciliacaoService], controllers: [ConciliacaoController] })
export class ConciliacaoModule {}

