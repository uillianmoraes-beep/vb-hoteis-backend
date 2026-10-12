import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { Gorjeta } from './gorjeta.entity';
import { Empresa } from '../empresas/empresa.entity';
import { UsuarioEntity } from '../usuarios/usuario.entity';
import { CaixaMovimento } from '../caixa/caixa.entity';
import { UsuarioToken } from '../common/permissoes';

export interface ConfigGorjeta {
  /** gorjeta em dinheiro até este valor é paga na hora */
  limiteNaHora: number;
  /** taxa da casa sobre gorjeta no cartão/pix (%) */
  taxaPct: number;
  periodo: 'semanal' | 'quinzenal' | 'mensal';
}
export const CONFIG_PADRAO: ConfigGorjeta = { limiteNaHora: 10, taxaPct: 0, periodo: 'quinzenal' };

const c = (v: number | string | null | undefined) => Math.round(Number(v ?? 0) * 100);
const r = (x: number) => Math.round(x) / 100;

@Injectable()
export class GorjetasService {
  constructor(
    @InjectRepository(Gorjeta) private readonly repo: Repository<Gorjeta>,
    @InjectRepository(Empresa) private readonly empresas: Repository<Empresa>,
    @InjectRepository(UsuarioEntity) private readonly usuarios: Repository<UsuarioEntity>,
  ) {}

  async config(empresaId: string): Promise<ConfigGorjeta> {
    const e = await this.empresas.findOne({ where: { id: empresaId } });
    return { ...CONFIG_PADRAO, ...(e?.configGorjeta ?? {}) };
  }

  async salvarConfig(u: UsuarioToken, dto: Partial<ConfigGorjeta>) {
    const atual = await this.config(u.empresaId);
    const limite = Number(dto.limiteNaHora ?? atual.limiteNaHora);
    const taxa = Number(dto.taxaPct ?? atual.taxaPct);
    if (!Number.isFinite(limite) || limite < 0 || limite > 100_000) throw new BadRequestException('Limite inválido.');
    if (!Number.isFinite(taxa) || taxa < 0 || taxa > 100) throw new BadRequestException('Taxa deve ser de 0 a 100%.');
    const periodo = (['semanal', 'quinzenal', 'mensal'] as const).includes(dto.periodo as ConfigGorjeta['periodo']) ? (dto.periodo as ConfigGorjeta['periodo']) : atual.periodo;
    const nova: ConfigGorjeta = { limiteNaHora: Math.round(limite * 100) / 100, taxaPct: Math.round(taxa * 100) / 100, periodo };
    await this.empresas.update({ id: u.empresaId }, { configGorjeta: nova });
    return nova;
  }

  /** Quem pode receber gorjeta (usuários marcados) + a Casa. */
  async beneficiarios(u: UsuarioToken) {
    const lista = await this.usuarios.find({ where: { empresaId: u.empresaId, ativo: true, recebeGorjeta: true }, order: { nome: 'ASC' } });
    return { config: await this.config(u.empresaId), pessoas: lista.map((x) => ({ id: x.id, nome: x.nome })) };
  }

  /**
   * Grava as gorjetas de um fechamento. Regra: dinheiro até o limite → paga na hora;
   * acima disso ou cartão/pix → a repassar (com a taxa no cartão/pix); Casa → fica na casa.
   */
  async registrar(m: EntityManager, u: UsuarioToken, dados: { estadiaId: string; turnoId: string | null; itens: { origem: 'troco' | 'adicional'; forma: string; valorCent: number; beneficiarioId?: string | null; nome?: string | null }[] }) {
    if (!dados.itens.length) return [];
    const cfg = await this.config(u.empresaId);
    const ids = dados.itens.map((i) => i.beneficiarioId).filter((x): x is string => !!x);
    const pessoas = ids.length ? await this.usuarios.find({ where: { id: In(ids), empresaId: u.empresaId } }) : [];
    const nomeDe = new Map(pessoas.map((p) => [p.id, p.nome]));
    const salvas: Gorjeta[] = [];
    for (const i of dados.itens) {
      if (i.valorCent <= 0) continue;
      const nome = (i.beneficiarioId && nomeDe.get(i.beneficiarioId)) || i.nome?.trim() || 'Casa';
      const casa = nome === 'Casa' && !i.beneficiarioId;
      const taxa = i.forma === 'dinheiro' || casa ? 0 : cfg.taxaPct;
      const liquido = Math.round(i.valorCent * (1 - taxa / 100));
      const status: Gorjeta['status'] = casa ? 'casa' : i.forma === 'dinheiro' && i.valorCent <= c(cfg.limiteNaHora) ? 'paga_na_hora' : 'a_repassar';
      const g = m.create(Gorjeta, {
        empresaId: u.empresaId, estadiaId: dados.estadiaId, turnoId: dados.turnoId, origem: i.origem, forma: i.forma,
        valor: r(i.valorCent).toFixed(2), taxaPct: taxa.toFixed(2), valorLiquido: r(liquido).toFixed(2),
        beneficiarioId: i.beneficiarioId && nomeDe.has(i.beneficiarioId) ? i.beneficiarioId : null, beneficiarioNome: nome,
        status, usuarioNome: u.nome,
      });
      salvas.push(await m.save(g));
    }
    return salvas;
  }

  /** Pendentes por pessoa + histórico do período. */
  async relatorio(u: UsuarioToken, filtro: { de?: string; ate?: string }) {
    const ate = filtro.ate ? new Date(`${filtro.ate}T23:59:59.999-03:00`) : new Date();
    const de = filtro.de ? new Date(`${filtro.de}T00:00:00-03:00`) : new Date(ate.getTime() - 31 * 86_400_000);
    const pendentes = await this.repo.find({ where: { empresaId: u.empresaId, status: 'a_repassar' }, order: { criadoEm: 'ASC' } });
    const porPessoa = new Map<string, { nome: string; bruto: number; liquido: number; qtd: number; desde: Date }>();
    for (const g of pendentes) {
      const k = g.beneficiarioId ?? g.beneficiarioNome;
      const a = porPessoa.get(k) ?? { nome: g.beneficiarioNome, bruto: 0, liquido: 0, qtd: 0, desde: g.criadoEm };
      a.bruto += c(g.valor); a.liquido += c(g.valorLiquido); a.qtd += 1;
      porPessoa.set(k, a);
    }
    const periodo: Gorjeta[] = await this.repo.createQueryBuilder('g').where('g.empresaId = :e', { e: u.empresaId })
      .andWhere('g.criadoEm BETWEEN :de AND :ate', { de, ate }).orderBy('g.criadoEm', 'DESC').limit(3000).getMany();
    return {
      config: await this.config(u.empresaId),
      pendentes: [...porPessoa.entries()].map(([chave, a]) => ({ chave, nome: a.nome, qtd: a.qtd, bruto: r(a.bruto), taxa: r(a.bruto - a.liquido), liquido: r(a.liquido), desde: a.desde }))
        .sort((x, y) => y.liquido - x.liquido),
      lista: periodo.map((g) => ({ ...g, valor: Number(g.valor), valorLiquido: Number(g.valorLiquido), taxaPct: Number(g.taxaPct) })),
    };
  }

  /** Repasse: marca as pendentes da pessoa como pagas e lança a saída no caixa ADM. */
  async repassar(u: UsuarioToken, chave: string, forma: string) {
    const pend = await this.repo.find({ where: { empresaId: u.empresaId, status: 'a_repassar' } });
    const da = pend.filter((g) => (g.beneficiarioId ?? g.beneficiarioNome) === chave);
    if (!da.length) throw new BadRequestException('Nada a repassar para esta pessoa.');
    const liquido = da.reduce((s, g) => s + c(g.valorLiquido), 0);
    const agora = new Date();
    await this.repo.manager.transaction(async (m: EntityManager) => {
      await m.update(Gorjeta, { id: In(da.map((g) => g.id)) }, { status: 'repassada', repassadaEm: agora, repassadaPor: u.nome });
      await m.insert(CaixaMovimento, {
        empresaId: u.empresaId, turnoId: null, caixa: 'adm', tipo: 'saida', forma: ['dinheiro', 'pix', 'transferencia'].includes(forma) ? forma : 'dinheiro',
        valor: r(liquido).toFixed(2), descricao: `Repasse de gorjetas: ${da[0].beneficiarioNome} (${da.length})`, usuarioId: u.sub, usuarioNome: u.nome, autorizadoPor: null,
      });
    });
    return { repassado: r(liquido), quantidade: da.length };
  }
}
