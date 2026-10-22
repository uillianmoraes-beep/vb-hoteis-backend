import { BadRequestException, Controller, Get, Injectable, Query } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

/**
 * Posição do estoque numa data (o saldo de cada produto no fim daquele dia, com o custo médio do dia)
 * e a comparação entre duas datas: diferença de quantidade, de custo e de valor, o que entrou e saiu
 * no meio, e o valor do estoque no fim de cada mês.
 */

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
/** fim do dia em São Paulo */
const fimDia = (d: string) => new Date(Date.parse(`${d}T03:00:00Z`) + 86_400_000);
const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

interface Saldo { produto_id: string; q: number; custo: number }

@Injectable()
export class PosicaoEstoqueService {
  constructor(private readonly ds: DataSource) {}

  /** saldo e custo de cada produto (somando os locais escolhidos) no fim do dia */
  private async saldosEm(empresaId: string, dia: string, locais: string[] | null): Promise<Map<string, Saldo>> {
    const l: { produto_id: string; saldo: string; custo: string }[] = await this.ds.query(
      `SELECT DISTINCT ON (local_id, produto_id) local_id, produto_id, saldo_depois AS saldo,
              COALESCE(custo_medio_depois, CASE WHEN tipo = 'entrada' THEN NULL ELSE custo_unitario END, custo_unitario) AS custo
         FROM estoque_movimentos
        WHERE empresa_id = $1 AND criado_em < $2 ${locais ? 'AND local_id = ANY($3::uuid[])' : ''}
        ORDER BY local_id, produto_id, criado_em DESC`, locais ? [empresaId, fimDia(dia), locais] : [empresaId, fimDia(dia)]);
    const m = new Map<string, Saldo>();
    for (const x of l) {
      const q = Number(x.saldo ?? 0);
      const c = Number(x.custo ?? 0);
      const s = m.get(x.produto_id) ?? { produto_id: x.produto_id, q: 0, custo: 0 };
      // custo do produto somando locais: médio ponderado pelo saldo positivo
      const base = Math.max(0, s.q) + Math.max(0, q);
      s.custo = base > 0 ? (Math.max(0, s.q) * s.custo + Math.max(0, q) * c) / base : c || s.custo;
      s.q = r3(s.q + q);
      m.set(x.produto_id, s);
    }
    return m;
  }

  async ver(u: UsuarioToken, de: string, ate: string | null, localId?: string) {
    const locaisEmpresa: { id: string; nome: string }[] = await this.ds.query(`SELECT id, nome FROM estoque_locais WHERE empresa_id = $1 ORDER BY padrao DESC, nome`, [u.empresaId]);
    const locais = localId ? locaisEmpresa.filter((l) => l.id === localId).map((l) => l.id) : null;
    if (localId && !locais?.length) throw new BadRequestException('Local não encontrado.');
    const produtos: { id: string; nome: string; grupo: string | null; unidade: string; preco: string }[] = await this.ds.query(
      `SELECT id, nome, grupo, unidade, preco FROM produtos WHERE empresa_id = $1 AND controla_estoque ORDER BY grupo NULLS LAST, nome`, [u.empresaId]);
    const a = await this.saldosEm(u.empresaId, de, locais);
    const b = ate ? await this.saldosEm(u.empresaId, ate, locais) : null;

    // o que aconteceu entre as duas datas
    const mov = new Map<string, Record<string, number>>();
    if (ate) {
      const l: { produto_id: string; grupo: string; q: string }[] = await this.ds.query(
        `SELECT produto_id, CASE WHEN tipo IN ('venda','consumo') THEN 'saidas' WHEN tipo = 'entrada' THEN 'entradas' WHEN tipo = 'perda' THEN 'perdas'
                                 WHEN tipo = 'ajuste' THEN 'ajustes' WHEN tipo = 'estorno' THEN 'devolucoes' ELSE 'outros' END AS grupo, sum(quantidade) AS q
           FROM estoque_movimentos WHERE empresa_id = $1 AND criado_em >= $2 AND criado_em < $3 ${locais ? 'AND local_id = ANY($4::uuid[])' : ''}
          GROUP BY 1, 2`, locais ? [u.empresaId, fimDia(de), fimDia(ate), locais] : [u.empresaId, fimDia(de), fimDia(ate)]);
      for (const x of l) { const k = mov.get(x.produto_id) ?? {}; k[x.grupo] = r3(Number(x.q)); mov.set(x.produto_id, k); }
    }

    const linhas = produtos.map((p) => {
      const x = a.get(p.id);
      const y = b?.get(p.id);
      const qa = x?.q ?? 0, ca = x?.custo ?? 0, qb = y?.q ?? 0, cb = y?.custo ?? 0;
      return {
        id: p.id, nome: p.nome, grupo: p.grupo, unidade: p.unidade,
        quantidade: qa, custo: r2(ca), valor: r2(Math.max(0, qa) * ca),
        ...(b ? {
          quantidade2: qb, custo2: r2(cb), valor2: r2(Math.max(0, qb) * cb),
          difQuantidade: r3(qb - qa), difValor: r2(Math.max(0, qb) * cb - Math.max(0, qa) * ca), difCustoPct: ca > 0 ? Math.round(((cb - ca) / ca) * 1000) / 10 : null,
          movimentos: mov.get(p.id) ?? {},
        } : {}),
      };
    }).filter((l) => l.quantidade !== 0 || (b && ((l as { quantidade2?: number }).quantidade2 !== 0 || Object.keys((l as { movimentos?: object }).movimentos ?? {}).length)));

    // valor do estoque no fim de cada mês entre as datas
    const meses: { mes: string; valor: number; itens: number }[] = [];
    if (ate) {
      const dia = new Date(`${de}T12:00:00Z`);
      let atual = new Date(Date.UTC(dia.getUTCFullYear(), dia.getUTCMonth() + 1, 0));
      let n = 0;
      while (atual.toISOString().slice(0, 10) < ate && n < 24) {
        const d = atual.toISOString().slice(0, 10);
        if (d >= de) {
          const s = await this.saldosEm(u.empresaId, d, locais);
          let v = 0, itens = 0;
          for (const x of s.values()) { if (x.q > 0) { v += x.q * x.custo; itens++; } }
          meses.push({ mes: d, valor: r2(v), itens });
        }
        atual = new Date(Date.UTC(atual.getUTCFullYear(), atual.getUTCMonth() + 2, 0));
        n++;
      }
      let v = 0, itens = 0;
      for (const x of b!.values()) { if (x.q > 0) { v += x.q * x.custo; itens++; } }
      meses.push({ mes: ate, valor: r2(v), itens });
    }
    const soma = (k: 'valor' | 'valor2') => r2(linhas.reduce((s, l) => s + Number((l as Record<string, unknown>)[k] ?? 0), 0));
    return {
      de, ate, localId: localId ?? null, locais: locaisEmpresa, linhas,
      totais: { valor: soma('valor'), ...(b ? { valor2: soma('valor2'), diferenca: r2(soma('valor2') - soma('valor')) } : {}) },
      meses,
    };
  }
}

@Controller('estoque/posicao')
@Requer('estoque.gerenciar', 'relatorios.ver')
export class PosicaoEstoqueController {
  constructor(private readonly service: PosicaoEstoqueService) {}

  @Get()
  ver(@Usuario() u: UsuarioToken, @Query('data') data?: string, @Query('ate') ate?: string, @Query('localId') localId?: string) {
    const d = data && DATA.test(data) ? data : hojeSP();
    const a = ate && DATA.test(ate) ? ate : null;
    if (a && a <= d) throw new BadRequestException('A segunda data tem que ser depois da primeira.');
    return this.service.ver(u, d, a, localId && /^[0-9a-f-]{36}$/i.test(localId) ? localId : undefined);
  }
}
