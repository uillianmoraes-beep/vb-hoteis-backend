import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Ambiente, RegrasAmbiente } from '../ambientes/ambiente.entity';
import { Categoria } from '../categorias/categoria.entity';
import { Unidade } from '../unidades/unidade.entity';
import { Periodo } from './periodo.entity';
import { TabelaPreco } from './tabela-preco.entity';
import { Preco } from './preco.entity';
import { SalvarDiariasDto, SalvarTarifasDto } from './tarifas.dto';
import { UsuarioToken } from '../common/permissoes';
import {
  AposUltimo, PeriodoCalc, PrecosCalc, RegrasCalc, centavos, dentroDaFaixa, hhmmParaMin, partesLocais,
} from '../estadias/calculadora';

export const FUSO = 'America/Sao_Paulo';

/** Tudo o que é preciso para calcular contas de um ambiente, já carregado. */
export interface Motor {
  ambiente: Ambiente;
  regras: RegrasCalc & { alertaViradaMin: number };
  periodos: (PeriodoCalc & { categoriaIds: string[] | null })[];
  pernoite: PeriodoCalc | null;
  tabelas: TabelaPreco[];
  /** tabelaId -> categoriaId -> preços */
  precos: Map<string, Map<string, PrecosCalc>>;
}

export function regrasPadrao(r: RegrasAmbiente | null | undefined): RegrasCalc & { alertaViradaMin: number } {
  return {
    toleranciaMin: r?.toleranciaMin ?? 15,
    aposUltimo: (r?.aposUltimo ?? 'hora_adicional') as AposUltimo,
    pessoasIncluidas: r?.pessoasIncluidas ?? 2,
    alertaViradaMin: r?.alertaViradaMin ?? 10,
  };
}

@Injectable()
export class TarifasService {
  constructor(
    @InjectRepository(Ambiente) private readonly ambientes: Repository<Ambiente>,
    @InjectRepository(Periodo) private readonly periodos: Repository<Periodo>,
    @InjectRepository(TabelaPreco) private readonly tabelas: Repository<TabelaPreco>,
    @InjectRepository(Preco) private readonly precos: Repository<Preco>,
    @InjectRepository(Categoria) private readonly categorias: Repository<Categoria>,
    @InjectRepository(Unidade) private readonly unidades: Repository<Unidade>,
    private readonly ds: DataSource,
  ) {}

  private async ambienteDo(u: UsuarioToken, ambienteId: string) {
    const amb = await this.ambientes.findOne({ where: { id: ambienteId, empresaId: u.empresaId } });
    if (!amb) throw new NotFoundException('Ambiente não encontrado.');
    if (u.ambientesIds && u.ambientesIds.length && !u.ambientesIds.includes(amb.id)) {
      throw new ForbiddenException('Ambiente não liberado para você.');
    }
    return amb;
  }

  /** Configuração completa para a tela de tarifas. */
  async carregar(u: UsuarioToken, ambienteId: string) {
    const ambiente = await this.ambienteDo(u, ambienteId);
    const periodos = await this.periodos.find({ where: { ambienteId, ativo: true }, order: { ordem: 'ASC', criadoEm: 'ASC' } });
    const tabelas = await this.tabelas.find({ where: { ambienteId, ativo: true }, order: { prioridade: 'DESC', criadoEm: 'ASC' } });
    const precos = tabelas.length ? await this.precos.find({ where: { tabelaId: In(tabelas.map((t) => t.id)) } }) : [];
    const categorias = await this.categorias.find({ where: { empresaId: u.empresaId, ativo: true }, order: { ordem: 'ASC', nome: 'ASC' } });
    return {
      ambiente: { id: ambiente.id, nome: ambiente.nome, tipo: ambiente.tipo },
      regras: regrasPadrao(ambiente.regras),
      periodos,
      tabelas: tabelas.map((t) => ({
        ...t,
        precos: precos
          .filter((p) => p.tabelaId === t.id)
          .map((p) => ({ categoriaId: p.categoriaId, tipo: p.tipo, periodoId: p.periodoId, valor: Number(p.valor), duracaoMin: p.duracaoMin })),
      })),
      categorias,
    };
  }

  async salvar(u: UsuarioToken, ambienteId: string, dto: SalvarTarifasDto) {
    const ambiente = await this.ambienteDo(u, ambienteId);

    // validações de negócio
    const nomes = new Set<string>();
    let pernoites = 0;
    for (const p of dto.periodos) {
      const n = p.nome.trim().toLowerCase();
      if (!n) throw new BadRequestException('Todo período precisa de nome.');
      if (nomes.has(n)) throw new BadRequestException(`Período repetido: ${p.nome}.`);
      nomes.add(n);
      if (p.tipo === 'horas' && !(p.duracaoMin && p.duracaoMin > 0)) throw new BadRequestException(`Informe a duração de "${p.nome}".`);
      if (p.tipo === 'pernoite') {
        pernoites++;
        if (hhmmParaMin(p.pernoiteInicio) === null || hhmmParaMin(p.pernoiteFim) === null) {
          throw new BadRequestException(`Informe o horário de início e de saída do pernoite "${p.nome}".`);
        }
      }
    }
    if (pernoites > 1) throw new BadRequestException('Só pode haver um pernoite por ambiente.');
    if (dto.tabelas.length === 0) throw new BadRequestException('Crie pelo menos uma tabela de preços.');
    const categoriasValidas = new Set(
      (await this.categorias.find({ where: { empresaId: u.empresaId } })).map((c) => c.id),
    );

    await this.ds.transaction(async (m) => {
      await m.update(Ambiente, { id: ambiente.id }, { regras: { ...dto.regras } });

      // períodos
      const existentes: Periodo[] = await m.find(Periodo, { where: { ambienteId } });
      const idsExistentes = new Set(existentes.map((p) => p.id));
      const chaveParaId = new Map<string, string>();
      const manter = new Set<string>();
      for (const [i, p] of dto.periodos.entries()) {
        const dados = {
          nome: p.nome.trim(),
          tipo: p.tipo,
          duracaoMin: p.tipo === 'horas' ? p.duracaoMin ?? null : null,
          pernoiteInicio: p.tipo === 'pernoite' ? p.pernoiteInicio ?? null : null,
          pernoiteFim: p.tipo === 'pernoite' ? p.pernoiteFim ?? null : null,
          categoriaIds: p.categoriaIds && p.categoriaIds.length ? p.categoriaIds.filter((c) => categoriasValidas.has(c)) : null,
          ordem: p.ordem ?? i,
          ativo: true,
        };
        if (idsExistentes.has(p.chave)) {
          await m.update(Periodo, { id: p.chave }, dados);
          chaveParaId.set(p.chave, p.chave);
          manter.add(p.chave);
        } else {
          const novo: Periodo = await m.save(m.create(Periodo, { ...dados, empresaId: u.empresaId, ambienteId }));
          chaveParaId.set(p.chave, novo.id);
          manter.add(novo.id);
        }
      }
      const remover = existentes.filter((p) => !manter.has(p.id)).map((p) => p.id);
      if (remover.length) await m.delete(Periodo, { id: In(remover) });

      // tabelas e preços
      const tabelasExistentes: TabelaPreco[] = await m.find(TabelaPreco, { where: { ambienteId } });
      const idsTabelas = new Set(tabelasExistentes.map((t) => t.id));
      const tabelasMantidas = new Set<string>();
      for (const t of dto.tabelas) {
        const dados = {
          nome: t.nome.trim(),
          diasSemana: [...new Set(t.diasSemana)].sort(),
          horaInicio: t.horaInicio || null,
          horaFim: t.horaFim || null,
          dataInicio: t.dataInicio || null,
          dataFim: t.dataFim || t.dataInicio || null,
          prioridade: t.prioridade ?? 0,
          ativo: true,
        };
        if (!dados.nome) throw new BadRequestException('Toda tabela de preços precisa de nome.');
        if (!dados.diasSemana.length) throw new BadRequestException(`Marque ao menos um dia na tabela "${dados.nome}".`);
        if (dados.dataInicio && dados.dataFim && dados.dataFim < dados.dataInicio) {
          throw new BadRequestException(`Na tabela "${dados.nome}", a data final é antes da inicial.`);
        }
        let tabelaId: string;
        if (t.id && idsTabelas.has(t.id)) {
          await m.update(TabelaPreco, { id: t.id }, dados);
          tabelaId = t.id;
        } else {
          const nova: TabelaPreco = await m.save(m.create(TabelaPreco, { ...dados, empresaId: u.empresaId, ambienteId }));
          tabelaId = nova.id;
        }
        tabelasMantidas.add(tabelaId);
        await m.delete(Preco, { tabelaId });
        const linhas = t.precos
          .filter((p) => categoriasValidas.has(p.categoriaId))
          .map((p) => {
            const periodoId = p.tipo === 'periodo' ? chaveParaId.get(p.periodoChave ?? '') ?? null : null;
            if (p.tipo === 'periodo' && !periodoId) return null;
            return m.create(Preco, {
              tabelaId, categoriaId: p.categoriaId, tipo: p.tipo, periodoId, valor: p.valor.toFixed(2),
              duracaoMin: p.tipo === 'periodo' && p.duracaoMin ? p.duracaoMin : null,
            });
          })
          .filter((x): x is Preco => x !== null);
        if (linhas.length) await m.save(linhas);
      }
      const tabelasRemover = tabelasExistentes.filter((t) => !tabelasMantidas.has(t.id)).map((t) => t.id);
      if (tabelasRemover.length) await m.delete(TabelaPreco, { id: In(tabelasRemover) });
    });

    return this.carregar(u, ambienteId);
  }

  /** Carrega tudo de um ambiente para calcular contas. */
  async motor(empresaId: string, ambienteId: string): Promise<Motor> {
    const ambiente = await this.ambientes.findOne({ where: { id: ambienteId, empresaId } });
    if (!ambiente) throw new NotFoundException('Ambiente não encontrado.');
    const periodos = await this.periodos.find({ where: { ambienteId, ativo: true }, order: { ordem: 'ASC' } });
    const tabelas = await this.tabelas.find({ where: { ambienteId, ativo: true }, order: { prioridade: 'DESC', criadoEm: 'ASC' } });
    const precos = tabelas.length ? await this.precos.find({ where: { tabelaId: In(tabelas.map((t) => t.id)) } }) : [];

    const mapa = new Map<string, Map<string, PrecosCalc>>();
    for (const p of precos) {
      if (!mapa.has(p.tabelaId)) mapa.set(p.tabelaId, new Map());
      const porCat = mapa.get(p.tabelaId)!;
      if (!porCat.has(p.categoriaId)) porCat.set(p.categoriaId, { porPeriodo: {}, duracaoPorPeriodo: {}, horaAdicional: 0, pessoaAdicional: 0 });
      const alvo = porCat.get(p.categoriaId)!;
      const v = centavos(p.valor);
      if (p.tipo === 'periodo' && p.periodoId) {
        alvo.porPeriodo[p.periodoId] = v;
        if (p.duracaoMin) alvo.duracaoPorPeriodo[p.periodoId] = p.duracaoMin;
      }
      else if (p.tipo === 'hora_adicional') alvo.horaAdicional = v;
      else if (p.tipo === 'pessoa_adicional') alvo.pessoaAdicional = v;
    }
    const calc = periodos.map((p) => ({
      id: p.id, nome: p.nome, tipo: p.tipo, duracaoMin: p.duracaoMin, pernoiteInicio: p.pernoiteInicio, pernoiteFim: p.pernoiteFim,
      categoriaIds: p.categoriaIds,
    }));
    return {
      ambiente,
      regras: regrasPadrao(ambiente.regras),
      periodos: calc,
      pernoite: calc.find((p) => p.tipo === 'pernoite') ?? null,
      tabelas,
      precos: mapa,
    };
  }

  /**
   * Tabela que vale num momento. Tabelas de data especial (Dia dos Namorados etc.)
   * ganham das demais nos dias delas; depois vale dia da semana + horário, e a
   * maior prioridade desempata.
   */
  escolherTabela(motor: Motor, quando: Date): TabelaPreco | null {
    const { diaSemana, minutoDia, data } = partesLocais(quando, FUSO);
    const valeHorario = (t: TabelaPreco) => t.diasSemana.includes(diaSemana) && dentroDaFaixa(minutoDia, t.horaInicio, t.horaFim);
    const dia = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
    const especiais = motor.tabelas.filter(
      (t) => !!t.dataInicio && data >= dia(t.dataInicio) && data <= dia(t.dataFim ?? t.dataInicio) && valeHorario(t),
    );
    if (especiais.length) return especiais[0];
    const comuns = motor.tabelas.filter((t) => !t.dataInicio);
    return comuns.find(valeHorario) ?? comuns[0] ?? null;
  }

  precosDe(motor: Motor, tabelaId: string | null, categoriaId: string | null): PrecosCalc {
    const vazio: PrecosCalc = { porPeriodo: {}, duracaoPorPeriodo: {}, horaAdicional: 0, pessoaAdicional: 0 };
    if (!tabelaId || !categoriaId) return vazio;
    return motor.precos.get(tabelaId)?.get(categoriaId) ?? vazio;
  }

  /** Períodos que valem para a categoria, com a duração própria da tabela quando houver. */
  periodosDe(motor: Motor, precos: PrecosCalc, categoriaId: string | null): PeriodoCalc[] {
    return motor.periodos
      .filter((p) => !p.categoriaIds || p.categoriaIds.length === 0 || (categoriaId !== null && p.categoriaIds.includes(categoriaId)))
      .map((p) => ({
        id: p.id, nome: p.nome, tipo: p.tipo,
        duracaoMin: p.tipo === 'horas' ? precos.duracaoPorPeriodo[p.id] ?? p.duracaoMin : null,
        pernoiteInicio: p.pernoiteInicio, pernoiteFim: p.pernoiteFim,
      }));
  }

  /** Pode oferecer pernoite agora? (dentro da janela de entrada do pernoite) */
  pernoiteDisponivel(motor: Motor, quando: Date): boolean {
    const p = motor.pernoite;
    if (!p) return false;
    const { minutoDia } = partesLocais(quando, FUSO);
    return dentroDaFaixa(minutoDia, p.pernoiteInicio, p.pernoiteFim);
  }

  /** Prévia de preços para a janela de entrada de uma unidade. */
  async previa(u: UsuarioToken, unidadeId: string) {
    const unidade = await this.unidades.findOne({ where: { id: unidadeId, empresaId: u.empresaId }, relations: { categoria: true } });
    if (!unidade) throw new NotFoundException('Unidade não encontrada.');
    const motor = await this.motor(u.empresaId, unidade.ambienteId);
    const agora = new Date();
    const tabela = this.escolherTabela(motor, agora);
    const precos = this.precosDe(motor, tabela?.id ?? null, unidade.categoriaId);
    const itens = this.periodosDe(motor, precos, unidade.categoriaId).map((p) => ({
      id: p.id, nome: p.nome, tipo: p.tipo, duracaoMin: p.duracaoMin, valor: (precos.porPeriodo[p.id] ?? 0) / 100,
    }));
    return {
      unidade: { id: unidade.id, codigo: unidade.codigo, categoria: unidade.categoria?.nome ?? null, capacidade: unidade.capacidade },
      tabela: tabela ? { id: tabela.id, nome: tabela.nome, especial: !!tabela.dataInicio } : null,
      itens,
      horaAdicional: precos.horaAdicional / 100,
      pessoaAdicional: precos.pessoaAdicional / 100,
      regras: motor.regras,
      pernoite: motor.pernoite
        ? { nome: motor.pernoite.nome, inicio: motor.pernoite.pernoiteInicio, fim: motor.pernoite.pernoiteFim, disponivelAgora: this.pernoiteDisponivel(motor, agora) }
        : null,
      configurado: itens.length > 0 && itens.some((i) => i.valor > 0),
      /** hotel/pousada: diária da categoria (1 noite, 2 pessoas) */
      hotel: await this.precoHotel(u.empresaId, unidade.ambienteId, unidade.categoriaId, agora, 1, Math.min(2, unidade.capacidade || 2)),
    };
  }

  // ---------- diárias do hotel/pousada ----------

  /** diárias de cada categoria do ambiente (hotel/pousada) */
  async diarias(u: UsuarioToken, ambienteId: string) {
    const [a] = await this.ds.query(`SELECT id, nome, tipo, diarias FROM ambientes WHERE id = $1 AND empresa_id = $2`, [ambienteId, u.empresaId]);
    if (!a) throw new NotFoundException('Ambiente não encontrado.');
    // categorias usadas nas unidades do ambiente (e as sem unidade ainda, para poder preparar)
    const cats: { id: string; nome: string; usadas: string }[] = await this.ds.query(
      `SELECT c.id, c.nome, (SELECT COUNT(*) FROM unidades un WHERE un.categoria_id = c.id AND un.ambiente_id = $2 AND un.ativo) AS usadas
         FROM categorias c WHERE c.empresa_id = $1 AND c.ativo ORDER BY c.ordem, c.nome`, [u.empresaId, ambienteId]);
    const cfg = (a.diarias ?? {}) as Record<string, DiariaCfg>;
    return {
      ambiente: { id: a.id, nome: a.nome, tipo: a.tipo },
      categorias: cats.map((c) => ({
        id: c.id, nome: c.nome, unidades: Number(c.usadas),
        diaria: cfg[c.id]?.diaria ?? 0, fimSemana: cfg[c.id]?.fimSemana ?? null,
        pessoasIncluidas: cfg[c.id]?.pessoasIncluidas ?? 2, pessoaExtra: cfg[c.id]?.pessoaExtra ?? 0, cafeIncluso: cfg[c.id]?.cafeIncluso ?? false,
      })),
    };
  }

  async salvarDiarias(u: UsuarioToken, ambienteId: string, dto: SalvarDiariasDto) {
    const [a] = await this.ds.query(`SELECT id FROM ambientes WHERE id = $1 AND empresa_id = $2`, [ambienteId, u.empresaId]);
    if (!a) throw new NotFoundException('Ambiente não encontrado.');
    const cfg: Record<string, DiariaCfg> = {};
    for (const i of dto.itens) {
      if (!(i.diaria > 0)) continue;
      cfg[i.categoriaId] = {
        diaria: i.diaria, fimSemana: i.fimSemana && i.fimSemana > 0 ? i.fimSemana : null,
        pessoasIncluidas: i.pessoasIncluidas ?? 2, pessoaExtra: i.pessoaExtra ?? 0, cafeIncluso: !!i.cafeIncluso,
      };
    }
    await this.ds.query(`UPDATE ambientes SET diarias = $2::jsonb WHERE id = $1`, [ambienteId, JSON.stringify(cfg)]);
    return { ok: true, categorias: Object.keys(cfg).length };
  }

  /**
   * Preço da hospedagem do hotel: soma das noites (sexta e sábado com a diária de fim de semana)
   * + pessoa extra por noite. null = a categoria não tem diária neste ambiente.
   */
  async precoHotel(empresaId: string, ambienteId: string, categoriaId: string | null, entrada: Date, noites: number, pessoas: number) {
    if (!categoriaId) return null;
    const [a] = await this.ds.query(`SELECT diarias FROM ambientes WHERE id = $1 AND empresa_id = $2`, [ambienteId, empresaId]);
    const c = ((a?.diarias ?? {}) as Record<string, DiariaCfg>)[categoriaId];
    if (!c || !(c.diaria > 0)) return null;
    let total = 0;
    const extra = Math.max(0, pessoas - (c.pessoasIncluidas ?? 2)) * (c.pessoaExtra ?? 0);
    for (let n = 0; n < noites; n++) {
      const dia = new Date(entrada.getTime() + n * 86_400_000);
      // noite de sexta ou de sábado (dia da entrada daquela noite)
      const dsem = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short' }).format(dia);
      const fimDeSemana = dsem === 'Fri' || dsem === 'Sat';
      total += (fimDeSemana && c.fimSemana ? c.fimSemana : c.diaria) + extra;
    }
    return { diaria: c.diaria + extra, total: Math.round(total * 100) / 100, cafeIncluso: !!c.cafeIncluso, fimSemana: c.fimSemana ?? null };
  }
}

interface DiariaCfg { diaria: number; fimSemana?: number | null; pessoasIncluidas?: number; pessoaExtra?: number; cafeIncluso?: boolean }
