import { Controller, Get, Injectable, Query } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DadosFiscais, tributacaoEfetiva } from '../common/fiscal';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

export interface Problema { nivel: 'erro' | 'aviso'; campo: string; texto: string }

const CSOSN = ['101', '102', '103', '201', '202', '203', '300', '400', '500', '900'];
const CST_NORMAL = ['00', '02', '10', '15', '20', '30', '40', '41', '50', '51', '53', '60', '61', '70', '90'];
const CFOP_ST = ['5405', '5403', '5401', '6403', '6404'];

/**
 * Confere a tributação de um item de NFC-e antes de emitir: o que a SEFAZ costuma rejeitar
 * (campo faltando, NCM que não existe, CFOP e CSOSN/CST que não combinam, CEST na substituição tributária).
 * `d` é a tributação efetiva (padrão → regra do CFOP → produto).
 */
export function conferirItem(d: DadosFiscais, regime: string | null, ncmExiste: (n: string) => boolean | null): Problema[] {
  const p: Problema[] = [];
  const erro = (campo: string, texto: string) => p.push({ nivel: 'erro', campo, texto });
  const aviso = (campo: string, texto: string) => p.push({ nivel: 'aviso', campo, texto });
  if (!d.ncm) erro('ncm', 'sem NCM');
  else if (d.ncm.length !== 8) erro('ncm', `NCM ${d.ncm} não tem 8 números`);
  else if (ncmExiste(d.ncm) === false) erro('ncm', `NCM ${d.ncm} não existe na tabela vigente`);
  if (!d.cfop) erro('cfop', 'sem CFOP');
  if (d.origem === undefined || d.origem === '') erro('origem', 'sem origem da mercadoria');
  if (!d.cstIcms) erro('cstIcms', `sem ${regime === 'normal' ? 'CST' : 'CSOSN'} do ICMS`);
  else if (regime && regime !== 'normal' && !CSOSN.includes(d.cstIcms)) erro('cstIcms', `${d.cstIcms} não é CSOSN válido no Simples (ex.: 102, 500)`);
  else if (regime === 'normal' && !CST_NORMAL.includes(d.cstIcms)) erro('cstIcms', `${d.cstIcms} não é CST válido no regime normal (ex.: 00, 60)`);
  const st = !!d.cfop && CFOP_ST.includes(d.cfop);
  const icmsSt = d.cstIcms === '500' || d.cstIcms === '60';
  if (st && d.cstIcms && !icmsSt) erro('cstIcms', `CFOP ${d.cfop} (substituição tributária) pede CSOSN 500 ou CST 60, está ${d.cstIcms}`);
  if (!st && d.cfop && icmsSt) erro('cfop', `CSOSN/CST ${d.cstIcms} é de substituição tributária: o CFOP deveria ser 5405, está ${d.cfop}`);
  if ((st || icmsSt) && !d.cest) erro('cest', 'substituição tributária sem CEST');
  if (d.cest && d.cest.length !== 7) erro('cest', `CEST ${d.cest} não tem 7 números`);
  if (!d.cstPis) erro('cstPis', 'sem CST do PIS');
  if (!d.cstCofins) erro('cstCofins', 'sem CST da COFINS');
  if (d.cstPis && d.cstCofins && d.cstPis !== d.cstCofins) aviso('cstPis', `CST do PIS (${d.cstPis}) diferente do da COFINS (${d.cstCofins})`);
  if (!d.unidade) aviso('unidade', 'sem unidade tributável (UN, KG…)');
  if (!d.cstIbsCbs || !d.cClassTrib) aviso('cstIbsCbs', 'sem CST/classificação do IBS/CBS (reforma tributária)');
  return p;
}

@Injectable()
export class ConferenciaService {
  constructor(private readonly ds: DataSource) {}

  private async contexto(empresaId: string) {
    const regras = await this.ds.query(`SELECT documento, cfop, dados, ativo FROM regras_fiscais WHERE empresa_id = $1`, [empresaId]);
    const [e] = await this.ds.query(`SELECT regime_tributario FROM empresas WHERE id = $1`, [empresaId]);
    const [{ n }] = await this.ds.query(`SELECT COUNT(*)::int AS n FROM ncm`);
    return { regras, regime: (e?.regime_tributario as string | null) ?? null, temTabela: n > 0 };
  }

  private async ncmsExistentes(ncms: string[]) {
    const unicos = [...new Set(ncms.filter((x) => x?.length === 8))];
    if (!unicos.length) return new Set<string>();
    const l: { codigo: string }[] = await this.ds.query(`SELECT codigo FROM ncm WHERE codigo = ANY($1::varchar[])`, [unicos]);
    return new Set(l.map((x) => x.codigo));
  }

  /** produtos para venda (NFC-e) com algum problema na tributação */
  async produtos(u: UsuarioToken) {
    const ctx = await this.contexto(u.empresaId);
    const ps: { id: string; nome: string; fiscal: DadosFiscais; unidade: string }[] = await this.ds.query(
      `SELECT id, nome, fiscal, unidade FROM produtos WHERE empresa_id = $1 AND ativo AND tipo = 'produto' AND uso = 'venda' AND NOT ressarcimento ORDER BY nome`, [u.empresaId]);
    const efetivas = ps.map((p) => ({ p, d: tributacaoEfetiva(p.fiscal ?? {}, ctx.regras, 'nfce') }));
    const existem = await this.ncmsExistentes(efetivas.map((x) => x.d.ncm ?? ''));
    const lista = efetivas.map(({ p, d }) => ({
      produtoId: p.id, nome: p.nome,
      problemas: conferirItem(d, ctx.regime, (n) => (ctx.temTabela ? existem.has(n) : null)),
    }));
    return {
      regime: ctx.regime, total: ps.length,
      comErro: lista.filter((x) => x.problemas.some((q) => q.nivel === 'erro')).length,
      produtos: lista.filter((x) => x.problemas.length),
    };
  }

  /** itens das contas (relatório de notas) com problema: estadiaId → itens */
  async contas(u: UsuarioToken, ids: string[]) {
    if (!ids.length) return {};
    const ctx = await this.contexto(u.empresaId);
    const its: { estadia_id: string; descricao: string; produto_id: string; fiscal: DadosFiscais }[] = await this.ds.query(
      `SELECT DISTINCT ON (i.estadia_id, i.produto_id) i.estadia_id, i.descricao, i.produto_id, p.fiscal
         FROM estadia_itens i JOIN estadias e ON e.id = i.estadia_id JOIN produtos p ON p.id = i.produto_id
        WHERE e.empresa_id = $1 AND i.estadia_id = ANY($2::uuid[]) AND i.status = 'ativo' AND p.tipo = 'produto' AND NOT p.ressarcimento`,
      [u.empresaId, ids]);
    const efetivas = its.map((i) => ({ i, d: tributacaoEfetiva(i.fiscal ?? {}, ctx.regras, 'nfce') }));
    const existem = await this.ncmsExistentes(efetivas.map((x) => x.d.ncm ?? ''));
    const out: Record<string, { produtoId: string; item: string; problemas: Problema[] }[]> = {};
    for (const { i, d } of efetivas) {
      const problemas = conferirItem(d, ctx.regime, (n) => (ctx.temTabela ? existem.has(n) : null)).filter((q) => q.nivel === 'erro');
      if (!problemas.length) continue;
      (out[i.estadia_id] ??= []).push({ produtoId: i.produto_id, item: i.descricao, problemas });
    }
    return out;
  }
}

/** Conferência preventiva da tributação (antes de emitir a nota). */
@Controller('fiscal/conferencia')
export class ConferenciaController {
  constructor(private readonly service: ConferenciaService) {}

  @Get('produtos')
  @Requer('produtos.gerenciar', 'notas.gerenciar')
  produtos(@Usuario() u: UsuarioToken) {
    return this.service.produtos(u);
  }

  @Get('contas')
  @Requer('notas.gerenciar')
  contas(@Usuario() u: UsuarioToken, @Query('ids') ids = '') {
    return this.service.contas(u, ids.split(',').filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 500));
  }
}
