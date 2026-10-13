import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { Gorjeta } from './gorjeta.entity';
import { Empresa } from '../empresas/empresa.entity';
import { UsuarioEntity } from '../usuarios/usuario.entity';
import { CaixaMovimento } from '../caixa/caixa.entity';
import { UsuarioToken } from '../common/permissoes';
import { cnpjDoAmbiente } from '../common/cnpj';

/** gorjeta do ambiente: pela conta (estadia) ou, sem conta, pelo turno do caixa */
const DO_AMBIENTE = `(g.estadia_id IN (SELECT id FROM estadias WHERE ambiente_id = :amb) OR (g.estadia_id IS NULL AND g.turno_id IN (SELECT id FROM caixa_turnos WHERE ambiente_id = :amb)))`;

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
    // funcionários cadastrados (sem login) que recebem gorjeta
    const funcs: { id: string; nome: string; usuario_id: string | null }[] = await this.repo.query(
      `SELECT id, nome, usuario_id FROM funcionarios WHERE empresa_id = $1 AND ativo AND recebe_gorjeta ORDER BY nome`, [u.empresaId]);
    const ligados = new Set(funcs.map((f) => f.usuario_id).filter(Boolean));
    const pessoas = [...funcs.map((f) => ({ id: f.id, nome: f.nome })), ...lista.filter((x) => !ligados.has(x.id)).map((x) => ({ id: x.id, nome: x.nome }))]
      .sort((a, b) => a.nome.localeCompare(b.nome));
    return { config: await this.config(u.empresaId), pessoas };
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
    const funcs: { id: string; nome: string }[] = ids.length ? await m.query(`SELECT id, nome FROM funcionarios WHERE empresa_id = $1 AND id = ANY($2::uuid[])`, [u.empresaId, ids]) : [];
    const nomeDe = new Map([...pessoas.map((p) => [p.id, p.nome] as [string, string]), ...funcs.map((f) => [f.id, f.nome] as [string, string])]);
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
  private async pendentesDe(empresaId: string, ambienteId?: string): Promise<Gorjeta[]> {
    const qb = this.repo.createQueryBuilder('g').where('g.empresaId = :e', { e: empresaId }).andWhere(`g.status = 'a_repassar'`);
    if (ambienteId) qb.andWhere(DO_AMBIENTE, { amb: ambienteId });
    return qb.orderBy('g.criadoEm', 'ASC').getMany();
  }

  /** nome do ambiente de cada gorjeta (para a lista) */
  private async ambientesDe(lista: Gorjeta[]): Promise<Map<string, string>> {
    const m = new Map<string, string>();
    if (!lista.length) return m;
    const rows = await this.repo.query(
      `SELECT g.id, COALESCE(ae.nome, at.nome) AS nome FROM gorjetas g
         LEFT JOIN estadias e ON e.id = g.estadia_id LEFT JOIN ambientes ae ON ae.id = e.ambiente_id
         LEFT JOIN caixa_turnos t ON t.id = g.turno_id LEFT JOIN ambientes at ON at.id = t.ambiente_id
        WHERE g.id = ANY($1::uuid[])`, [lista.map((g) => g.id)]);
    for (const x of rows) if (x.nome) m.set(x.id, x.nome);
    return m;
  }

  async relatorio(u: UsuarioToken, filtro: { de?: string; ate?: string; ambienteId?: string }) {
    const ate = filtro.ate ? new Date(`${filtro.ate}T23:59:59.999-03:00`) : new Date();
    const de = filtro.de ? new Date(`${filtro.de}T00:00:00-03:00`) : new Date(ate.getTime() - 31 * 86_400_000);
    const pendentes = await this.pendentesDe(u.empresaId, filtro.ambienteId);
    const porPessoa = new Map<string, { nome: string; bruto: number; liquido: number; qtd: number; desde: Date }>();
    for (const g of pendentes) {
      const k = g.beneficiarioId ?? g.beneficiarioNome;
      const a = porPessoa.get(k) ?? { nome: g.beneficiarioNome, bruto: 0, liquido: 0, qtd: 0, desde: g.criadoEm };
      a.bruto += c(g.valor); a.liquido += c(g.valorLiquido); a.qtd += 1;
      porPessoa.set(k, a);
    }
    const qb = this.repo.createQueryBuilder('g').where('g.empresaId = :e', { e: u.empresaId }).andWhere('g.criadoEm BETWEEN :de AND :ate', { de, ate });
    if (filtro.ambienteId) qb.andWhere(DO_AMBIENTE, { amb: filtro.ambienteId });
    const periodo: Gorjeta[] = await qb.orderBy('g.criadoEm', 'DESC').limit(3000).getMany();
    const ambs = await this.ambientesDe(periodo);
    return {
      config: await this.config(u.empresaId),
      pendentes: [...porPessoa.entries()].map(([chave, a]) => ({ chave, nome: a.nome, qtd: a.qtd, bruto: r(a.bruto), taxa: r(a.bruto - a.liquido), liquido: r(a.liquido), desde: a.desde }))
        .sort((x, y) => y.liquido - x.liquido),
      lista: periodo.map((g) => ({ ...g, ambiente: ambs.get(g.id) ?? null, valor: Number(g.valor), valorLiquido: Number(g.valorLiquido), taxaPct: Number(g.taxaPct) })),
    };
  }

  /** Repasse: marca as pendentes da pessoa como pagas e lança a saída no caixa ADM. */
  async repassar(u: UsuarioToken, chave: string, forma: string, ambienteId?: string) {
    const pend = await this.pendentesDe(u.empresaId, ambienteId);
    const cnpj = ambienteId ? await cnpjDoAmbiente(this.repo.manager, ambienteId) : null;
    const da = pend.filter((g) => (g.beneficiarioId ?? g.beneficiarioNome) === chave);
    if (!da.length) throw new BadRequestException('Nada a repassar para esta pessoa.');
    const liquido = da.reduce((s, g) => s + c(g.valorLiquido), 0);
    const agora = new Date();
    await this.repo.manager.transaction(async (m: EntityManager) => {
      await m.update(Gorjeta, { id: In(da.map((g) => g.id)) }, { status: 'repassada', repassadaEm: agora, repassadaPor: u.nome });
      await m.insert(CaixaMovimento, {
        empresaId: u.empresaId, turnoId: null, caixa: 'adm', tipo: 'saida', forma: ['dinheiro', 'pix', 'transferencia'].includes(forma) ? forma : 'dinheiro',
        valor: r(liquido).toFixed(2), descricao: `Repasse de gorjetas: ${da[0].beneficiarioNome} (${da.length})`, usuarioId: u.sub, usuarioNome: u.nome, autorizadoPor: null, cnpj,
      });
    });
    return { repassado: r(liquido), quantidade: da.length };
  }
}
