import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { CaixaMovimento, CaixaTurno, Valores } from './caixa.entity';
import { AbrirTurnoDto, FecharTurnoDto, LancamentoAdmDto, MovimentoDto } from './caixa.dto';
import { EstadiaPagamento } from '../estadias/estadia-pagamento.entity';
import { Estadia } from '../estadias/estadia.entity';
import { Unidade } from '../unidades/unidade.entity';
import { Ambiente } from '../ambientes/ambiente.entity';
import { Empresa } from '../empresas/empresa.entity';
import { UsuarioEntity } from '../usuarios/usuario.entity';
import { moduloAtivo } from '../common/modulos';
import { UsuarioToken, temPermissao } from '../common/permissoes';

const FORMAS = ['dinheiro', 'pix', 'debito', 'credito', 'faturado'] as const;
const DIA = 86_400_000;
const c = (v: number | string | null | undefined) => Math.round(Number(v ?? 0) * 100);
const r = (cent: number) => Math.round(cent) / 100;

@Injectable()
export class CaixaService {
  constructor(
    @InjectRepository(CaixaTurno) private readonly turnos: Repository<CaixaTurno>,
    @InjectRepository(CaixaMovimento) private readonly movimentos: Repository<CaixaMovimento>,
    @InjectRepository(EstadiaPagamento) private readonly pagamentos: Repository<EstadiaPagamento>,
    @InjectRepository(Estadia) private readonly estadias: Repository<Estadia>,
    @InjectRepository(Unidade) private readonly unidades: Repository<Unidade>,
    @InjectRepository(Ambiente) private readonly ambientes: Repository<Ambiente>,
    @InjectRepository(Empresa) private readonly empresas: Repository<Empresa>,
    @InjectRepository(UsuarioEntity) private readonly usuarios: Repository<UsuarioEntity>,
    private readonly ds: DataSource,
  ) {}

  private async moduloLigado(empresaId: string) {
    const e = await this.empresas.findOne({ where: { id: empresaId } });
    return moduloAtivo(e?.modulos, 'caixa');
  }

  private async exigirModulo(u: UsuarioToken) {
    if (!(await this.moduloLigado(u.empresaId))) throw new ForbiddenException('Módulo de caixa não contratado.');
  }

  private podeVerAmbiente(u: UsuarioToken, ambienteId: string) {
    return !u.ambientesIds?.length || u.ambientesIds.includes(ambienteId);
  }

  /**
   * Usado pelas contas: em qual turno cai o recebimento. Sem o módulo, null.
   * Com o módulo e sem caixa aberto, bloqueia (o dinheiro precisa entrar em algum caixa).
   */
  async turnoParaRecebimento(empresaId: string, ambienteId: string): Promise<string | null> {
    if (!(await this.moduloLigado(empresaId))) return null;
    const t = await this.turnos.findOne({ where: { empresaId, ambienteId, status: 'aberto' } });
    if (!t) throw new BadRequestException('O caixa está fechado. Abra o caixa (menu Caixa) antes de receber.');
    return t.id;
  }

  /** Liberação por senha de quem tem a permissão (ex.: sangria). */
  private async liberar(u: UsuarioToken, permissao: string, acao: string, aut?: { login: string; senha: string }) {
    if (temPermissao(u, permissao)) return null;
    if (!aut) throw new ForbiddenException(`Seu perfil não pode ${acao}. Peça para alguém com permissão liberar com login e senha.`);
    const quem = await this.usuarios.createQueryBuilder('x').addSelect('x.senhaHash').leftJoinAndSelect('x.perfil', 'perfil')
      .where('lower(x.login) = lower(:l)', { l: aut.login.trim() }).andWhere('x.empresaId = :e', { e: u.empresaId }).getOne();
    if (!quem || !quem.ativo || !(await bcrypt.compare(aut.senha, quem.senhaHash))) throw new ForbiddenException('Login ou senha de quem libera estão incorretos.');
    const perms = quem.perfil?.permissoes ?? [];
    if (!perms.includes('*') && !perms.includes(permissao)) throw new ForbiddenException(`${quem.nome} também não pode ${acao}.`);
    if (quem.id === u.sub) throw new ForbiddenException('A liberação precisa ser de outra pessoa.');
    return quem.nome;
  }

  /** Totais do turno: recebido por forma, gorjetas, movimentos e o esperado na gaveta. */
  async resumo(t: CaixaTurno) {
    const pags = await this.pagamentos.find({ where: { turnoId: t.id } });
    const movs = await this.movimentos.find({ where: { turnoId: t.id }, order: { criadoEm: 'ASC' } });
    const recebido: Record<string, number> = Object.fromEntries(FORMAS.map((f) => [f, 0]));
    const gorjetas = new Map<string, number>();
    for (const p of pags) {
      recebido[p.forma] = (recebido[p.forma] ?? 0) + c(p.valor);
      if (p.trocoDestino === 'gorjeta' && c(p.troco) > 0) {
        const quem = p.gorjetaPara || 'Casa';
        gorjetas.set(quem, (gorjetas.get(quem) ?? 0) + c(p.troco));
      }
    }
    const somaMov = (tipo: string, forma?: string) => movs.filter((m) => m.tipo === tipo && (!forma || m.forma === forma)).reduce((s, m) => s + c(m.valor), 0);
    const totalGorjetas = [...gorjetas.values()].reduce((s, v) => s + v, 0);
    const esperado: Valores = {};
    for (const f of FORMAS) esperado[f] = recebido[f] ?? 0;
    // na gaveta: troco inicial + dinheiro recebido + gorjetas deixadas (a repassar) + reforços − sangrias − despesas
    esperado.dinheiro = c(t.trocoInicial) + (recebido.dinheiro ?? 0) + totalGorjetas + somaMov('reforco') - somaMov('sangria') - somaMov('despesa', 'dinheiro');
    const contas = new Set(pags.map((p) => p.estadiaId)).size;
    return {
      recebido: Object.fromEntries(Object.entries(recebido).map(([k, v]) => [k, r(v)])),
      totalRecebido: r(Object.values(recebido).reduce((s, v) => s + v, 0)),
      contas,
      gorjetas: [...gorjetas.entries()].map(([para, v]) => ({ para, valor: r(v) })).sort((a, b) => b.valor - a.valor),
      totalGorjetas: r(totalGorjetas),
      sangrias: r(somaMov('sangria')),
      reforcos: r(somaMov('reforco')),
      despesas: r(somaMov('despesa')),
      esperado: Object.fromEntries(Object.entries(esperado).map(([k, v]) => [k, r(v)])),
      movimentos: movs.map((m) => ({ ...m, valor: Number(m.valor) })),
    };
  }

  private async ambienteNome(id: string) {
    return (await this.ambientes.findOne({ where: { id } }))?.nome ?? '';
  }

  /** Turno aberto do ambiente (o que a recepção vê). Fechamento cego: sem o esperado para quem não tem relatórios. */
  async atual(u: UsuarioToken, ambienteId: string) {
    await this.exigirModulo(u);
    if (!this.podeVerAmbiente(u, ambienteId)) throw new ForbiddenException('Ambiente não liberado para você.');
    const t = await this.turnos.findOne({ where: { empresaId: u.empresaId, ambienteId, status: 'aberto' } });
    if (!t) return { turno: null, ambiente: await this.ambienteNome(ambienteId) };
    const res = await this.resumo(t);
    const verTudo = temPermissao(u, 'caixa.relatorios');
    return {
      ambiente: await this.ambienteNome(ambienteId),
      turno: { ...t, trocoInicial: Number(t.trocoInicial) },
      resumo: verTudo ? res : { ...res, esperado: null, recebido: null, totalRecebido: null, gorjetas: res.gorjetas, totalGorjetas: res.totalGorjetas },
      cego: !verTudo,
    };
  }

  async abrir(u: UsuarioToken, dto: AbrirTurnoDto) {
    await this.exigirModulo(u);
    if (!this.podeVerAmbiente(u, dto.ambienteId)) throw new ForbiddenException('Ambiente não liberado para você.');
    const amb = await this.ambientes.findOne({ where: { id: dto.ambienteId, empresaId: u.empresaId } });
    if (!amb) throw new NotFoundException('Ambiente não encontrado.');
    const ja = await this.turnos.findOne({ where: { empresaId: u.empresaId, ambienteId: dto.ambienteId, status: 'aberto' } });
    if (ja) throw new BadRequestException(`Já existe um caixa aberto no ${amb.nome} (turno ${ja.numero}, por ${ja.abertoPor ?? '—'}).`);
    const salvo = await this.ds.transaction(async (m) => {
      const res = await m.query('UPDATE empresas SET ultimo_turno = ultimo_turno + 1 WHERE id = $1 RETURNING ultimo_turno', [u.empresaId]);
      const linha = Array.isArray(res?.[0]) ? res[0][0] : res?.[0];
      return m.save(m.create(CaixaTurno, {
        empresaId: u.empresaId, ambienteId: dto.ambienteId, numero: Number(linha?.ultimo_turno ?? 1), status: 'aberto',
        trocoInicial: dto.trocoInicial.toFixed(2), abertoPorId: u.sub, abertoPor: u.nome, abertoEm: new Date(),
      }));
    });
    return this.atual(u, salvo.ambienteId);
  }

  private async turnoAberto(u: UsuarioToken, id: string) {
    const t = await this.turnos.findOne({ where: { id, empresaId: u.empresaId } });
    if (!t) throw new NotFoundException('Turno não encontrado.');
    if (!this.podeVerAmbiente(u, t.ambienteId)) throw new ForbiddenException('Ambiente não liberado para você.');
    if (t.status !== 'aberto') throw new BadRequestException('Este caixa já foi fechado.');
    return t;
  }

  async movimento(u: UsuarioToken, id: string, dto: MovimentoDto) {
    await this.exigirModulo(u);
    const t = await this.turnoAberto(u, id);
    let autorizadoPor: string | null = null;
    if (dto.tipo === 'sangria') autorizadoPor = await this.liberar(u, 'caixa.sangria', 'fazer sangria', dto.autorizacao);
    if (dto.tipo === 'despesa' && !dto.descricao?.trim()) throw new BadRequestException('Diga do que foi a despesa.');
    if (dto.tipo !== 'reforco') {
      const res = await this.resumo(t);
      if (c(dto.valor) > c(res.esperado.dinheiro)) throw new BadRequestException(`Não tem esse valor em dinheiro no caixa (saldo do sistema: R$ ${res.esperado.dinheiro.toFixed(2).replace('.', ',')}).`);
    }
    await this.ds.transaction(async (m) => {
      await m.insert(CaixaMovimento, {
        empresaId: u.empresaId, turnoId: t.id, caixa: 'principal', tipo: dto.tipo, forma: 'dinheiro', valor: dto.valor.toFixed(2),
        descricao: dto.descricao?.trim() || null, usuarioId: u.sub, usuarioNome: u.nome, autorizadoPor,
      });
      // sangria vai para o caixa ADM
      if (dto.tipo === 'sangria') {
        await m.insert(CaixaMovimento, {
          empresaId: u.empresaId, turnoId: null, caixa: 'adm', tipo: 'sangria', forma: 'dinheiro', valor: dto.valor.toFixed(2),
          descricao: `Sangria do turno ${t.numero} (${await this.ambienteNome(t.ambienteId)})${dto.descricao?.trim() ? ` · ${dto.descricao.trim()}` : ''}`,
          usuarioId: u.sub, usuarioNome: u.nome, autorizadoPor,
        });
      }
    });
    return this.atual(u, t.ambienteId);
  }

  async fechar(u: UsuarioToken, id: string, dto: FecharTurnoDto) {
    await this.exigirModulo(u);
    const t = await this.turnoAberto(u, id);
    const res = await this.resumo(t);
    const contado: Valores = {};
    for (const f of FORMAS) {
      const v = Number(dto.contado?.[f] ?? 0);
      if (!Number.isFinite(v) || v < 0 || v > 10_000_000) throw new BadRequestException('Valor contado inválido.');
      contado[f] = r(c(v));
    }
    const dif: Valores = {};
    for (const f of FORMAS) dif[f] = r(c(contado[f]) - c(res.esperado[f]));
    const diferenca = r(FORMAS.reduce((s, f) => s + c(dif[f]), 0));
    await this.turnos.update({ id: t.id }, {
      status: 'fechado', fechadoPorId: u.sub, fechadoPor: u.nome, fechadoEm: new Date(),
      esperado: res.esperado, contado, diferenca: diferenca.toFixed(2), observacao: dto.observacao?.trim() || null,
    });
    return this.detalhe(u, t.id, true);
  }

  async detalhe(u: UsuarioToken, id: string, recemFechado = false) {
    await this.exigirModulo(u);
    const t = await this.turnos.findOne({ where: { id, empresaId: u.empresaId } });
    if (!t) throw new NotFoundException('Turno não encontrado.');
    if (!this.podeVerAmbiente(u, t.ambienteId)) throw new ForbiddenException('Ambiente não liberado para você.');
    // quem não tem relatórios só vê o turno que acabou de fechar (o seu)
    if (!temPermissao(u, 'caixa.relatorios') && !(recemFechado || (t.fechadoPorId === u.sub && t.fechadoEm && Date.now() - t.fechadoEm.getTime() < DIA))) {
      throw new ForbiddenException('Seu perfil não vê relatórios de caixa.');
    }
    const res = await this.resumo(t);
    const pags = await this.pagamentos.find({ where: { turnoId: t.id }, order: { criadoEm: 'ASC' } });
    const ests = pags.length ? await this.estadias.find({ where: { id: In([...new Set(pags.map((p) => p.estadiaId))]) } }) : [];
    const unis = ests.length ? await this.unidades.find({ where: { id: In([...new Set(ests.map((e) => e.unidadeId))]) } }) : [];
    const mapE = new Map(ests.map((e) => [e.id, e]));
    const mapU = new Map(unis.map((x) => [x.id, x.codigo]));
    return {
      turno: { ...t, trocoInicial: Number(t.trocoInicial), diferenca: t.diferenca === null ? null : Number(t.diferenca) },
      ambiente: await this.ambienteNome(t.ambienteId),
      resumo: res,
      recebimentos: pags.map((p) => {
        const e = mapE.get(p.estadiaId);
        return {
          id: p.id, hora: p.criadoEm, forma: p.forma, valor: Number(p.valor), troco: Number(p.troco), trocoDestino: p.trocoDestino, gorjetaPara: p.gorjetaPara,
          momento: p.momento, usuario: p.usuarioNome, uso: e?.numero ?? null, unidade: e ? mapU.get(e.unidadeId) ?? '—' : '—',
        };
      }),
    };
  }

  async listar(u: UsuarioToken, filtro: { de?: string; ate?: string; ambienteId?: string }) {
    await this.exigirModulo(u);
    const ate = filtro.ate ? new Date(`${filtro.ate}T23:59:59.999-03:00`) : new Date();
    const de = filtro.de ? new Date(`${filtro.de}T00:00:00-03:00`) : new Date(ate.getTime() - 7 * DIA);
    const qb = this.turnos.createQueryBuilder('t').where('t.empresaId = :e', { e: u.empresaId }).andWhere('t.abertoEm BETWEEN :de AND :ate', { de, ate });
    if (u.ambientesIds?.length) qb.andWhere('t.ambienteId IN (:...amb)', { amb: u.ambientesIds });
    if (filtro.ambienteId) qb.andWhere('t.ambienteId = :a', { a: filtro.ambienteId });
    const lista: CaixaTurno[] = await qb.orderBy('t.abertoEm', 'DESC').limit(500).getMany();
    const ambs = await this.ambientes.find({ where: { empresaId: u.empresaId } });
    const nome = new Map(ambs.map((a) => [a.id, a.nome]));
    const saida = [];
    for (const t of lista) {
      const res = await this.resumo(t);
      saida.push({
        id: t.id, numero: t.numero, ambiente: nome.get(t.ambienteId) ?? '', status: t.status, abertoPor: t.abertoPor, abertoEm: t.abertoEm,
        fechadoPor: t.fechadoPor, fechadoEm: t.fechadoEm, totalRecebido: res.totalRecebido, recebido: res.recebido, contas: res.contas,
        totalGorjetas: res.totalGorjetas, sangrias: res.sangrias, diferenca: t.diferenca === null ? null : Number(t.diferenca),
      });
    }
    return saida;
  }

  /* ---------------- caixa ADM ---------------- */

  async adm(u: UsuarioToken, filtro: { de?: string; ate?: string }) {
    await this.exigirModulo(u);
    const ate = filtro.ate ? new Date(`${filtro.ate}T23:59:59.999-03:00`) : new Date();
    const de = filtro.de ? new Date(`${filtro.de}T00:00:00-03:00`) : new Date(ate.getTime() - 30 * DIA);
    const todos = await this.movimentos.find({ where: { empresaId: u.empresaId, caixa: 'adm' }, order: { criadoEm: 'DESC' } });
    const sinal = (m: CaixaMovimento) => (m.tipo === 'saida' ? -1 : 1) * c(m.valor);
    const saldoPorForma: Record<string, number> = {};
    for (const m of todos) saldoPorForma[m.forma] = (saldoPorForma[m.forma] ?? 0) + sinal(m);
    const periodo = todos.filter((m) => m.criadoEm >= de && m.criadoEm <= ate);
    return {
      saldo: r(todos.reduce((s, m) => s + sinal(m), 0)),
      saldoPorForma: Object.fromEntries(Object.entries(saldoPorForma).map(([k, v]) => [k, r(v)])),
      entradas: r(periodo.filter((m) => m.tipo !== 'saida').reduce((s, m) => s + c(m.valor), 0)),
      saidas: r(periodo.filter((m) => m.tipo === 'saida').reduce((s, m) => s + c(m.valor), 0)),
      lancamentos: periodo.map((m) => ({ ...m, valor: Number(m.valor) })),
    };
  }

  async lancarAdm(u: UsuarioToken, dto: LancamentoAdmDto) {
    await this.exigirModulo(u);
    await this.movimentos.insert({
      empresaId: u.empresaId, turnoId: null, caixa: 'adm', tipo: dto.tipo, forma: dto.forma, valor: dto.valor.toFixed(2),
      descricao: dto.descricao.trim(), usuarioId: u.sub, usuarioNome: u.nome, autorizadoPor: null,
    });
    return this.adm(u, {});
  }
}
