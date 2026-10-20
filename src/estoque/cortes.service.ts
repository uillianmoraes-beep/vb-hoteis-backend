import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UsuarioToken } from '../common/permissoes';
import { moverEstoque } from './estoque.core';
import { LancarCorteDto, ModeloCorteDto } from './estoque.dto';

const num = (v: unknown) => Number(v ?? 0);
const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Produção e cortes (porcionamento): a matéria-prima sai do estoque e as porções entram,
 * com o custo da matéria dividido pelo peso de cada saída (a perda de limpeza fica no custo delas).
 * É opcional: quem já compra cortado só dá entrada do bife pela nota.
 */
@Injectable()
export class CortesService {
  constructor(private readonly ds: DataSource) {}

  async modelos(u: UsuarioToken) {
    const ms: { id: string; nome: string; materia_id: string; materia: string; unidade: string; perda_pct: string; ativo: boolean }[] = await this.ds.query(
      `SELECT m.id, m.nome, m.materia_id, p.nome AS materia, p.unidade, m.perda_pct, m.ativo FROM cortes_modelos m JOIN produtos p ON p.id = m.materia_id
        WHERE m.empresa_id = $1 AND m.ativo ORDER BY m.nome`, [u.empresaId]);
    const ss: { modelo_id: string; produto_id: string; nome: string; unidade: string; percentual: string; peso_porcao: string | null }[] = ms.length ? await this.ds.query(
      `SELECT s.modelo_id, s.produto_id, p.nome, p.unidade, s.percentual, s.peso_porcao FROM cortes_modelo_saidas s JOIN produtos p ON p.id = s.produto_id
        WHERE s.modelo_id = ANY($1::uuid[]) ORDER BY s.ordem`, [ms.map((m) => m.id)]) : [];
    return ms.map((m) => ({
      id: m.id, nome: m.nome, materiaId: m.materia_id, materia: m.materia, unidade: m.unidade, perdaPct: num(m.perda_pct),
      saidas: ss.filter((s) => s.modelo_id === m.id).map((s) => ({
        produtoId: s.produto_id, nome: s.nome, unidade: s.unidade, percentual: num(s.percentual), pesoPorcao: s.peso_porcao === null ? null : num(s.peso_porcao),
      })),
    }));
  }

  private async validarProdutos(empresaId: string, ids: string[]) {
    const unicos = [...new Set(ids)];
    const ok = await this.ds.query(`SELECT id FROM produtos WHERE id = ANY($1::uuid[]) AND empresa_id = $2`, [unicos, empresaId]);
    if (ok.length !== unicos.length) throw new BadRequestException('Produto não encontrado.');
  }

  async salvarModelo(u: UsuarioToken, dto: ModeloCorteDto, id?: string) {
    if (!dto.saidas.length) throw new BadRequestException('Coloque ao menos uma saída (ex.: bife de 380 g).');
    if (dto.saidas.some((s) => s.produtoId === dto.materiaId)) throw new BadRequestException('A matéria-prima não pode ser saída dela mesma.');
    const soma = dto.saidas.reduce((t, s) => t + s.percentual, 0);
    if (soma > 100.01) throw new BadRequestException(`As saídas somam ${r2(soma)}% do aproveitado: o máximo é 100%.`);
    await this.validarProdutos(u.empresaId, [dto.materiaId, ...dto.saidas.map((s) => s.produtoId)]);
    return this.ds.transaction(async (m) => {
      let modeloId = id;
      if (id) {
        const [x] = await m.query(`UPDATE cortes_modelos SET nome = $3, materia_id = $4, perda_pct = $5 WHERE id = $1 AND empresa_id = $2 RETURNING id`,
          [id, u.empresaId, dto.nome.trim(), dto.materiaId, dto.perdaPct]);
        if (!x) throw new NotFoundException('Modelo não encontrado.');
        await m.query(`DELETE FROM cortes_modelo_saidas WHERE modelo_id = $1`, [id]);
      } else {
        const [x] = await m.query(`INSERT INTO cortes_modelos (empresa_id, nome, materia_id, perda_pct) VALUES ($1,$2,$3,$4) RETURNING id`,
          [u.empresaId, dto.nome.trim(), dto.materiaId, dto.perdaPct]);
        modeloId = x.id;
      }
      for (const [i, s] of dto.saidas.entries()) {
        await m.query(`INSERT INTO cortes_modelo_saidas (modelo_id, produto_id, percentual, peso_porcao, ordem) VALUES ($1,$2,$3,$4,$5)`,
          [modeloId, s.produtoId, s.percentual, s.pesoPorcao && s.pesoPorcao > 0 ? s.pesoPorcao : null, i]);
      }
      // as porções passam a controlar estoque (entram pelo corte e saem pela venda/ficha)
      await m.query(`UPDATE produtos SET controla_estoque = true WHERE id = ANY($1::uuid[]) AND NOT controla_estoque`, [[dto.materiaId, ...dto.saidas.map((s) => s.produtoId)]]);
      return { ok: true, id: modeloId };
    });
  }

  async apagarModelo(u: UsuarioToken, id: string) {
    await this.ds.query(`UPDATE cortes_modelos SET ativo = false WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    return { ok: true };
  }

  async lancar(u: UsuarioToken, dto: LancarCorteDto) {
    const [local] = await this.ds.query(`SELECT id FROM estoque_locais WHERE id = $1 AND empresa_id = $2 AND ativo`, [dto.localId, u.empresaId]);
    if (!local) throw new NotFoundException('Local de estoque não encontrado.');
    const itens = dto.itens.filter((i) => i.quantidade > 0);
    if (!itens.length) throw new BadRequestException('Informe quanto saiu de cada corte.');
    if (itens.some((i) => i.produtoId === dto.materiaId)) throw new BadRequestException('A matéria-prima não pode ser saída dela mesma.');
    await this.validarProdutos(u.empresaId, [dto.materiaId, ...itens.map((i) => i.produtoId)]);
    let modelo: Awaited<ReturnType<CortesService['modelos']>>[number] | undefined;
    if (dto.modeloId) {
      modelo = (await this.modelos(u)).find((x) => x.id === dto.modeloId);
      if (!modelo) throw new NotFoundException('Modelo de corte não encontrado.');
    }
    // peso de cada saída: informado, ou porções × peso da porção do modelo, ou a própria quantidade (kg)
    const pesos = itens.map((i) => {
      if (i.pesoKg && i.pesoKg > 0) return i.pesoKg;
      const s = modelo?.saidas.find((x) => x.produtoId === i.produtoId);
      return s?.pesoPorcao ? i.quantidade * s.pesoPorcao : i.quantidade;
    });
    const aproveitado = pesos.reduce((t, p) => t + p, 0);
    if (aproveitado > dto.pesoKg * 1.05) throw new BadRequestException(`As saídas pesam ${r3(aproveitado)} kg, mais do que a peça (${r3(dto.pesoKg)} kg). Confira os pesos.`);
    const esperadoPct = modelo ? 100 - modelo.perdaPct : null;
    return this.ds.transaction(async (m) => {
      const [{ n }] = await m.query(`SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM cortes WHERE empresa_id = $1`, [u.empresaId]);
      const ref = `corte:${n}`;
      const custoUnit = await moverEstoque(m, { empresaId: u.empresaId, localId: local.id, produtoId: dto.materiaId, quantidade: -dto.quantidade, tipo: 'producao_saida',
        referencia: ref, observacao: `Corte nº ${n}${modelo ? ` · ${modelo.nome}` : ''}`, usuario: u.nome });
      let custoTotal = custoUnit * dto.quantidade;
      if (!(custoTotal > 0)) {
        const [p] = await m.query(`SELECT custo FROM produtos WHERE id = $1`, [dto.materiaId]);
        custoTotal = num(p?.custo) * dto.quantidade;
      }
      const [c] = await m.query(
        `INSERT INTO cortes (empresa_id, numero, modelo_id, local_id, materia_id, quantidade, peso_kg, aproveitado_kg, esperado_pct, custo_total, fornecedor, observacao, usuario_nome)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [u.empresaId, n, modelo?.id ?? null, local.id, dto.materiaId, dto.quantidade, dto.pesoKg, r3(aproveitado), esperadoPct, r2(custoTotal),
          dto.fornecedor?.trim() || null, dto.observacao?.trim() || null, u.nome]);
      const aprovKg = dto.pesoKg * (1 - (modelo?.perdaPct ?? 0) / 100);
      for (const [k, i] of itens.entries()) {
        const share = aproveitado > 0 ? pesos[k] / aproveitado : 0;
        const unit = i.quantidade > 0 ? (custoTotal * share) / i.quantidade : 0;
        const s = modelo?.saidas.find((x) => x.produtoId === i.produtoId);
        const esperado = s ? (s.pesoPorcao ? Math.floor((aprovKg * s.percentual) / 100 / s.pesoPorcao) : r3((aprovKg * s.percentual) / 100)) : null;
        await m.query(`INSERT INTO corte_itens (corte_id, produto_id, quantidade, peso_kg, esperado, custo_unitario) VALUES ($1,$2,$3,$4,$5,$6)`,
          [c.id, i.produtoId, i.quantidade, r3(pesos[k]), esperado, unit.toFixed(4)]);
        await moverEstoque(m, { empresaId: u.empresaId, localId: local.id, produtoId: i.produtoId, quantidade: i.quantidade, tipo: 'producao_entrada', custoUnitario: unit,
          referencia: ref, observacao: `Corte nº ${n}`, usuario: u.nome, lote: i.lote, validade: i.validade?.slice(0, 10) });
      }
      return { ok: true, id: c.id, numero: n, rendimentoPct: dto.pesoKg > 0 ? r2((aproveitado / dto.pesoKg) * 100) : 0, custoTotal: r2(custoTotal) };
    });
  }

  /** histórico: rendimento real × esperado, e médias por matéria-prima, fornecedor e por quem cortou */
  async historico(u: UsuarioToken, f: { de: string; ate: string }) {
    const cs: Record<string, unknown>[] = await this.ds.query(
      `SELECT c.*, p.nome AS materia, p.unidade, l.nome AS local, m.nome AS modelo FROM cortes c JOIN produtos p ON p.id = c.materia_id
         JOIN estoque_locais l ON l.id = c.local_id LEFT JOIN cortes_modelos m ON m.id = c.modelo_id
        WHERE c.empresa_id = $1 AND c.criado_em >= $2::date AND c.criado_em < $3::date + 1 ORDER BY c.criado_em DESC LIMIT 500`, [u.empresaId, f.de, f.ate]);
    const its: Record<string, unknown>[] = cs.length ? await this.ds.query(
      `SELECT i.*, p.nome, p.unidade FROM corte_itens i JOIN produtos p ON p.id = i.produto_id WHERE i.corte_id = ANY($1::uuid[])`, [cs.map((c) => c.id)]) : [];
    const lista = cs.map((c) => {
      const peso = num(c.peso_kg);
      const real = peso > 0 ? r2((num(c.aproveitado_kg) / peso) * 100) : 0;
      return {
        id: c.id, numero: c.numero, criadoEm: c.criado_em, materia: c.materia, unidade: c.unidade, modelo: c.modelo, local: c.local,
        quantidade: num(c.quantidade), pesoKg: peso, aproveitadoKg: num(c.aproveitado_kg), rendimentoPct: real,
        esperadoPct: c.esperado_pct === null ? null : num(c.esperado_pct), custoTotal: num(c.custo_total), fornecedor: c.fornecedor, usuario: c.usuario_nome, observacao: c.observacao,
        custoKgAproveitado: num(c.aproveitado_kg) > 0 ? r2(num(c.custo_total) / num(c.aproveitado_kg)) : null,
        itens: its.filter((i) => i.corte_id === c.id).map((i) => ({
          nome: i.nome, unidade: i.unidade, quantidade: num(i.quantidade), pesoKg: num(i.peso_kg), esperado: i.esperado === null ? null : num(i.esperado), custoUnitario: r2(num(i.custo_unitario)),
        })),
      };
    });
    const agrupar = (chave: (x: typeof lista[number]) => string) => {
      const g = new Map<string, { nome: string; cortes: number; peso: number; aproveitado: number; custo: number }>();
      for (const x of lista) {
        const k = chave(x);
        const a = g.get(k) ?? { nome: k, cortes: 0, peso: 0, aproveitado: 0, custo: 0 };
        a.cortes += 1; a.peso += x.pesoKg; a.aproveitado += x.aproveitadoKg; a.custo += x.custoTotal;
        g.set(k, a);
      }
      return [...g.values()].map((a) => ({
        nome: a.nome, cortes: a.cortes, pesoKg: r3(a.peso), rendimentoPct: a.peso > 0 ? r2((a.aproveitado / a.peso) * 100) : 0,
        custoKgAproveitado: a.aproveitado > 0 ? r2(a.custo / a.aproveitado) : null,
      })).sort((a, b) => b.rendimentoPct - a.rendimentoPct);
    };
    return {
      lista,
      porFornecedor: agrupar((x) => `${x.materia} · ${(x.fornecedor as string | null) || 'sem fornecedor'}`),
      porUsuario: agrupar((x) => (x.usuario as string | null) || '—'),
    };
  }
}
