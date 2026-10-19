import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { Estadia, FormaPagamento } from './estadia.entity';
import { EstadiaItem } from './estadia-item.entity';
import { EstadiaPagamento } from './estadia-pagamento.entity';
import { EstadiaEvento } from './estadia-evento.entity';
import { Unidade } from '../unidades/unidade.entity';
import { UnidadeEvento } from '../unidades/unidade-evento.entity';
import { UsuarioEntity } from '../usuarios/usuario.entity';
import { Perfil } from '../perfis/perfil.entity';
import { Produto } from '../produtos/produto.entity';
import { Empresa } from '../empresas/empresa.entity';
import { Ambiente } from '../ambientes/ambiente.entity';
import { moduloAtivo } from '../common/modulos';
import { FUSO, Motor, TarifasService } from '../tarifas/tarifas.service';
import { FaturamentoService } from '../faturamento/faturamento.service';
import { cnpjDoAmbiente } from '../common/cnpj';
import { baixarConsumo, devolverConsumo } from '../estoque/estoque.core';
import { CaixaService } from '../caixa/caixa.service';
import { GorjetasService } from '../gorjetas/gorjetas.service';
import { CortesiasService } from '../cortesias/cortesias.service';
import { Penhora } from '../caixa/penhora.entity';
import { CaixaMovimento, CaixaTurno } from '../caixa/caixa.entity';
import { Gorjeta } from '../gorjetas/gorjeta.entity';
import {
  AbrirEstadiaDto, AdiantamentoDto, PagamentoDto, AtualizarEstadiaDto, CancelarEstadiaDto, CorrigirEstadiaDto, EstornarItemDto, FecharEstadiaDto,
  LancarItemDto, MudarFormaDto, TransferirDto, TrocarCobrancaDto,
} from './estadias.dto';
import { StatusUnidade, UsuarioToken, temPermissao } from '../common/permissoes';
import { ImpressaoService } from '../impressao/impressao.service';
import { AutorizacaoEntrada, liberarPermissao, quemLibera, registrarLiberacao } from '../common/liberacao';
import { calcularConta, centavos, minutosAteHorario, reais, ResultadoCalc } from './calculadora';

export interface ContaCalculada extends ResultadoCalc {
  minutosUso: number;
  tabelaNome: string | null;
  parado: boolean;
  pacote: string | null;
}

const ABERTAS = ['aberta', 'conta_entregue'];
const NOMES_FORMA: Record<string, string> = { dinheiro: 'dinheiro', pix: 'Pix', debito: 'débito', credito: 'crédito', faturado: 'faturado', penhora: 'penhora' };
const brl = (c: number) => `R$ ${reais(c).replace('.', ',')}`;

/** Confere dígitos de CPF/CNPJ. Retorna só números ou lança erro. */
export function documentoFiscal(bruto?: string): string | null {
  const d = (bruto ?? '').replace(/\D/g, '');
  if (!d) return null;
  const todosIguais = /^(\d)\1+$/.test(d);
  if (d.length === 11 && !todosIguais) {
    const dv = (n: number) => {
      let s = 0;
      for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
      const r = (s * 10) % 11;
      return r === 10 ? 0 : r;
    };
    if (dv(9) === Number(d[9]) && dv(10) === Number(d[10])) return d;
  }
  if (d.length === 14 && !todosIguais) {
    const dv = (n: number) => {
      const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
      const s = pesos.reduce((acc, p, i) => acc + Number(d[i]) * p, 0);
      const r = s % 11;
      return r < 2 ? 0 : 11 - r;
    };
    if (dv(12) === Number(d[12]) && dv(13) === Number(d[13])) return d;
  }
  throw new BadRequestException('CPF/CNPJ inválido. Confira os números ou deixe em branco.');
}

@Injectable()
export class EstadiasService {
  constructor(
    @InjectRepository(Estadia) private readonly repo: Repository<Estadia>,
    @InjectRepository(EstadiaItem) private readonly itens: Repository<EstadiaItem>,
    @InjectRepository(EstadiaPagamento) private readonly pagamentos: Repository<EstadiaPagamento>,
    @InjectRepository(EstadiaEvento) private readonly eventos: Repository<EstadiaEvento>,
    @InjectRepository(Unidade) private readonly unidades: Repository<Unidade>,
    @InjectRepository(UsuarioEntity) private readonly usuarios: Repository<UsuarioEntity>,
    @InjectRepository(Perfil) private readonly perfis: Repository<Perfil>,
    @InjectRepository(Produto) private readonly produtos: Repository<Produto>,
    @InjectRepository(Empresa) private readonly empresas: Repository<Empresa>,
    private readonly tarifas: TarifasService,
    private readonly caixa: CaixaService,
    private readonly gorjetas: GorjetasService,
    private readonly cortesias: CortesiasService,
    private readonly faturamento: FaturamentoService,
    private readonly impressao: ImpressaoService,
    private readonly ds: DataSource,
  ) {}

  /* ---------------- cálculo ---------------- */

  calcular(e: Estadia, motor: Motor, consumo: number, agora = new Date()): ContaCalculada {
    const fim = e.status === 'conta_entregue' && e.contaEntregueEm ? new Date(e.contaEntregueEm) : agora;
    const minutosUso = Math.max(0, Math.floor((fim.getTime() - new Date(e.entradaEm).getTime()) / 60000) - (e.pausadoMin ?? 0));
    const precos = this.tarifas.precosDe(motor, e.tabelaId, e.categoriaId);
    const periodos = this.tarifas.periodosDe(motor, precos, e.categoriaId);
    const pernoite = periodos.find((p) => p.tipo === 'pernoite') ?? null;
    const r = calcularConta({
      periodos,
      regras: motor.regras,
      precos,
      modalidade: e.modalidade === 'pernoite' && pernoite ? 'pernoite' : 'periodo',
      pessoas: e.pessoas,
      minutosUso,
      minutosAteFimPernoite: pernoite ? minutosAteHorario(new Date(e.entradaEm), pernoite.pernoiteFim, FUSO) : null,
      periodoMinimoId: e.modalidade === 'periodo' ? e.periodoMinimoId : null,
      consumo,
    });
    const tabela = motor.tabelas.find((t) => t.id === e.tabelaId);
    if (e.totalCombinado !== null && e.totalCombinado !== undefined && e.saidaPrevista) {
      return { ...this.contaCombinada(e, fim, consumo), minutosUso, tabelaNome: 'Reserva', parado: e.status === 'conta_entregue', pacote: null };
    }
    const pacote = e.periodoMinimoId ? periodos.find((p) => p.id === e.periodoMinimoId)?.nome ?? null : null;
    return { ...r, minutosUso, tabelaNome: tabela?.nome ?? null, parado: e.status === 'conta_entregue', pacote };
  }

  /**
   * Hotel com reserva: cobra o total combinado; se passar da saída prevista
   * (check-out até as 14h), cada dia a mais é mais uma diária combinada.
   */
  private contaCombinada(e: Estadia, fim: Date, consumo: number): ResultadoCalc {
    const partes = new Intl.DateTimeFormat('sv-SE', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).formatToParts(fim);
    const pt = (t: string) => partes.find((p) => p.type === t)?.value ?? '00';
    const diaFim = `${pt('year')}-${pt('month')}-${pt('day')}`;
    const hora = Number(pt('hour')) % 24;
    const saida = String(e.saidaPrevista).slice(0, 10);
    const dif = Math.round((Date.parse(`${diaFim}T12:00:00Z`) - Date.parse(`${saida}T12:00:00Z`)) / 86_400_000);
    const extras = dif < 0 || (dif === 0 && hora < 14) ? 0 : dif + (hora >= 14 ? 1 : 0);
    const diaria = centavos(Number(e.diariaCombinada ?? 0));
    const hosp = centavos(Number(e.totalCombinado ?? 0)) + extras * diaria;
    // quantas diárias: as combinadas (total ÷ diária) + as que passaram da saída prevista
    const combinadas = diaria > 0 ? Math.max(1, Math.round(centavos(Number(e.totalCombinado ?? 0)) / diaria)) : 1;
    const n = combinadas + extras;
    const saidaBr = saida.split('-').reverse().slice(0, 2).join('/');
    return {
      periodoNome: extras
        ? `${n} diárias (${extras} além da saída de ${saidaBr})`
        : `${n} diária${n > 1 ? 's' : ''} · saída ${saidaBr}`,
      valorHospedagem: hosp, horasAdicionais: 0, valorPessoas: 0, pessoasExtras: 0, consumo, total: hosp + consumo,
      proximaViradaMin: null, proximoNome: null, trechoInicio: 0, trechoFim: null, semPreco: false,
    };
  }

  private async consumoDe(ids: string[]): Promise<Map<string, number>> {
    const mapa = new Map<string, number>();
    if (!ids.length) return mapa;
    const linhas: { id: string; soma: string }[] = await this.itens
      .createQueryBuilder('i')
      .select('i.estadiaId', 'id')
      .addSelect('COALESCE(SUM(i.total), 0)', 'soma')
      .where('i.estadiaId IN (:...ids)', { ids })
      .andWhere(`i.status = 'ativo'`)
      .groupBy('i.estadiaId')
      .getRawMany();
    for (const l of linhas) mapa.set(l.id, centavos(l.soma));
    return mapa;
  }

  /** Contas abertas de várias unidades de uma vez (para o painel). */
  /** Entradas e saídas de hoje (fuso de São Paulo), para o resumo do painel. */
  async contagemHoje(empresaId: string, ambienteIds: string[]) {
    if (!ambienteIds.length) return { entradas: 0, saidas: 0 };
    const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: FUSO });
    const ini = new Date(`${hoje}T00:00:00-03:00`);
    const [entradas, saidas] = await Promise.all([
      this.repo.createQueryBuilder('e').where('e.empresaId = :emp', { emp: empresaId }).andWhere('e.ambienteId IN (:...a)', { a: ambienteIds })
        .andWhere(`e.status <> 'cancelada'`).andWhere('e.entradaEm >= :ini', { ini }).getCount(),
      this.repo.createQueryBuilder('e').where('e.empresaId = :emp', { emp: empresaId }).andWhere('e.ambienteId IN (:...a)', { a: ambienteIds })
        .andWhere(`e.status = 'fechada'`).andWhere('e.saidaEm >= :ini', { ini }).getCount(),
    ]);
    return { entradas, saidas };
  }

  /** Última conta fechada de cada unidade (suíte paga esperando a saída: código do ticket para reimprimir). */
  async ultimasFechadas(empresaId: string, unidadeIds: string[]) {
    const r = new Map<string, Estadia>();
    if (!unidadeIds.length) return r;
    const lista = await this.repo.find({ where: { empresaId, unidadeId: In(unidadeIds), status: 'fechada' }, order: { saidaEm: 'DESC' }, take: unidadeIds.length * 5 });
    for (const e of lista) if (!r.has(e.unidadeId)) r.set(e.unidadeId, e);
    return r;
  }

  async abertasComConta(empresaId: string, unidadeIds: string[]) {
    const resultado = new Map<string, { estadia: Estadia; conta: ContaCalculada; motor: Motor }>();
    if (!unidadeIds.length) return resultado;
    const abertas = await this.repo.find({ where: { empresaId, unidadeId: In(unidadeIds), status: In(ABERTAS) } });
    const consumo = await this.consumoDe(abertas.map((a) => a.id));
    const motores = new Map<string, Motor>();
    const agora = new Date();
    for (const e of abertas) {
      if (!motores.has(e.ambienteId)) motores.set(e.ambienteId, await this.tarifas.motor(empresaId, e.ambienteId));
      const motor = motores.get(e.ambienteId)!;
      resultado.set(e.unidadeId, { estadia: e, conta: this.calcular(e, motor, consumo.get(e.id) ?? 0, agora), motor });
    }
    return resultado;
  }

  /* ---------------- apoio ---------------- */

  private podeVer(u: UsuarioToken, ambienteId: string) {
    return !u.ambientesIds || u.ambientesIds.length === 0 || u.ambientesIds.includes(ambienteId);
  }

  private async buscar(u: UsuarioToken, id: string) {
    const e = await this.repo.findOne({ where: { id, empresaId: u.empresaId } });
    if (!e) throw new NotFoundException('Conta não encontrada.');
    if (!this.podeVer(u, e.ambienteId)) throw new ForbiddenException('Conta de outro ambiente.');
    return e;
  }

  private async buscarAberta(u: UsuarioToken, id: string) {
    const e = await this.buscar(u, id);
    if (!ABERTAS.includes(e.status)) throw new BadRequestException('Esta conta já foi encerrada.');
    return e;
  }

  private async mudarUnidade(m: EntityManager, u: UsuarioToken, unidade: Unidade, novo: StatusUnidade, obs?: string) {
    await m.update(Unidade, { id: unidade.id }, { status: novo, statusDesde: new Date(), motivoBloqueioId: null, observacaoStatus: null });
    await m.insert(UnidadeEvento, {
      empresaId: u.empresaId, unidadeId: unidade.id, statusAnterior: unidade.status, statusNovo: novo,
      motivoBloqueioId: null, observacao: obs ?? null, usuarioId: u.sub, usuarioNome: u.nome,
    });
  }

  private async registrar(m: EntityManager | null, u: UsuarioToken, estadiaId: string, tipo: string, descricao: string) {
    const dados = { empresaId: u.empresaId, estadiaId, tipo, descricao, usuarioId: u.sub, usuarioNome: u.nome };
    if (m) await m.insert(EstadiaEvento, dados);
    else await this.eventos.insert(dados);
  }

  private formatar(e: Estadia, conta: ContaCalculada) {
    return {
      ...e,
      conta: {
        ...conta,
        valorHospedagem: conta.valorHospedagem / 100,
        valorPessoas: conta.valorPessoas / 100,
        consumo: conta.consumo / 100,
        total: conta.total / 100,
      },
    };
  }

  /* ---------------- leitura ---------------- */

  async detalhe(u: UsuarioToken, id: string) {
    const e = await this.buscar(u, id);
    if (!e.avaliacaoToken) {
      e.avaliacaoToken = randomBytes(9).toString('base64url');
      await this.repo.update({ id: e.id }, { avaliacaoToken: e.avaliacaoToken });
    }
    const motor = await this.tarifas.motor(u.empresaId, e.ambienteId);
    const consumo = (await this.consumoDe([e.id])).get(e.id) ?? 0;
    const [itens, pagamentos, eventos, unidade] = await Promise.all([
      this.itens.find({ where: { estadiaId: e.id }, order: { criadoEm: 'ASC' } }),
      this.pagamentos.find({ where: { estadiaId: e.id }, order: { criadoEm: 'ASC' } }),
      this.eventos.find({ where: { estadiaId: e.id }, order: { criadoEm: 'ASC' } }),
      this.unidades.findOne({ where: { id: e.unidadeId }, relations: { categoria: true } }),
    ]);
    const precos = this.tarifas.precosDe(motor, e.tabelaId, e.categoriaId);
    const [amb] = await this.ds.query(`SELECT tipo FROM ambientes WHERE id = $1`, [e.ambienteId]);
    return {
      ...this.formatar(e, this.calcular(e, motor, consumo)),
      /** motel | hotel | pousada… (a tela e o cupom dizem "Quarto" e mostram diárias no hotel) */
      tipoAmbiente: (amb?.tipo as string | undefined) ?? null,
      unidade: unidade ? { id: unidade.id, codigo: unidade.codigo, categoria: unidade.categoria?.nome ?? null } : null,
      itens: itens.map((i) => ({ ...i, quantidade: Number(i.quantidade), precoUnitario: Number(i.precoUnitario), total: Number(i.total) })),
      pagamentos: pagamentos.map((p) => ({ ...p, valor: Number(p.valor), troco: Number(p.troco), valorRecebido: p.valorRecebido ? Number(p.valorRecebido) : null })),
      adiantado: ABERTAS.includes(e.status) ? Math.round(pagamentos.reduce((s, p) => s + Number(p.valor), 0) * 100) / 100 : 0,
      eventos,
      opcoes: {
        periodos: this.tarifas.periodosDe(motor, precos, e.categoriaId).map((p) => ({ id: p.id, nome: p.nome, tipo: p.tipo, valor: (precos.porPeriodo[p.id] ?? 0) / 100 })),
        tabelas: motor.tabelas.map((t) => ({ id: t.id, nome: t.nome })),
        pernoiteDisponivel: this.tarifas.pernoiteDisponivel(motor, new Date()),
      },
    };
  }

  /* ---------------- operações ---------------- */

  /** Converte os pagamentos do formulário (reais) em centavos, com troco no dinheiro. */
  private lerPagamentos(lista: PagamentoDto[]) {
    return lista.map((p) => {
      const valor = centavos(p.valor);
      let recebido: number | null = null;
      let troco = 0;
      if (p.forma === 'dinheiro' && p.valorRecebido !== undefined && p.valorRecebido !== null) {
        recebido = centavos(p.valorRecebido);
        if (recebido < valor) throw new BadRequestException('Em dinheiro, o valor recebido é menor que o valor do pagamento.');
        troco = recebido - valor;
      }
      const trocoDestino = troco > 0 ? p.trocoDestino ?? 'cliente' : null;
      return {
        forma: p.forma, valor, recebido, troco, trocoDestino, gorjetaPara: trocoDestino === 'gorjeta' ? p.gorjetaPara?.trim() || 'Casa' : null,
        gorjetaUsuarioId: p.gorjetaUsuarioId ?? null, gorjetaAdicional: centavos(p.gorjetaAdicional ?? 0),
        penhoraItem: p.forma === 'penhora' ? p.penhoraItem?.trim() || '' : '', penhoraContato: p.forma === 'penhora' ? p.penhoraContato?.trim() || null : null,
        clienteFaturadoId: p.forma === 'faturado' ? p.clienteFaturadoId ?? null : null,
      };
    });
  }

  private async gravarAdiantamento(m: EntityManager, u: UsuarioToken, estadiaId: string, lista: PagamentoDto[], momento: 'entrada' | 'adiantamento', ambienteId: string) {
    const pags = this.lerPagamentos(lista).filter((p) => p.valor > 0);
    if (!pags.length) return 0;
    if (pags.some((p) => p.forma === 'penhora')) throw new BadRequestException('Penhora só no fechamento da conta.');
    const turnoId = await this.caixa.turnoParaRecebimento(u.empresaId, ambienteId);
    for (const p of pags) {
      await m.insert(EstadiaPagamento, {
        empresaId: u.empresaId, estadiaId, forma: p.forma, valor: reais(p.valor),
        valorRecebido: p.recebido !== null ? reais(p.recebido) : null, troco: reais(p.troco),
        trocoDestino: p.trocoDestino, gorjetaPara: p.gorjetaPara, usuarioId: u.sub, usuarioNome: u.nome, momento, turnoId,
      });
    }
    const soma = pags.reduce((s, p) => s + p.valor, 0);
    await this.registrar(m, u, estadiaId, 'adiantamento',
      `${momento === 'entrada' ? 'Pago na entrada' : 'Recebido antecipado'}: ${pags.map((p) => `${NOMES_FORMA[p.forma] ?? p.forma} ${brl(p.valor)}${p.troco ? ` (troco ${brl(p.troco)})` : ''}`).join(' + ')}`);
    return soma;
  }

  /** Receber parte da conta antes do fechamento (ex.: portaria). */
  async adiantamento(u: UsuarioToken, id: string, dto: AdiantamentoDto) {
    const e = await this.buscarAberta(u, id);
    await this.ds.transaction(async (m) => {
      const soma = await this.gravarAdiantamento(m, u, id, dto.pagamentos, 'adiantamento', e.ambienteId);
      if (!soma) throw new BadRequestException('Informe o valor recebido.');
    });
    return this.detalhe(u, id);
  }

  async abrir(u: UsuarioToken, dto: AbrirEstadiaDto) {
    const unidade = await this.unidades.findOne({ where: { id: dto.unidadeId, empresaId: u.empresaId, ativo: true } });
    if (!unidade) throw new NotFoundException('Unidade não encontrada.');
    if (!this.podeVer(u, unidade.ambienteId)) throw new ForbiddenException('Unidade de outro ambiente.');
    // hotel: quarto marcado "ocupado" à mão (sem conta) também pode receber o check-in
    let ocupadaSemConta = false;
    if (unidade.status === 'ocupada') {
      const [aberta] = await this.ds.query(`SELECT id FROM estadias WHERE unidade_id = $1 AND status IN ('aberta','conta_entregue') LIMIT 1`, [unidade.id]);
      ocupadaSemConta = !aberta;
    }
    if (!['livre', 'reservada'].includes(unidade.status) && !ocupadaSemConta) {
      throw new BadRequestException(`A unidade ${unidade.codigo} não está livre (está como ${unidade.status}).`);
    }
    const motor = await this.tarifas.motor(u.empresaId, unidade.ambienteId);
    const agora = new Date();
    const tabela = this.tarifas.escolherTabela(motor, agora);
    // hotel/pousada: cobra por diária da categoria (Tarifas › Diárias do hotel)
    const amb = await this.ds.query(`SELECT tipo FROM ambientes WHERE id = $1`, [unidade.ambienteId]);
    const ehHotel = amb[0]?.tipo && amb[0].tipo !== 'motel';
    const noites = dto.noites ?? 1;
    const pessoasEntrada = dto.pessoas ?? Math.min(2, unidade.capacidade || 2);
    const hotel = ehHotel ? await this.tarifas.precoHotel(u.empresaId, unidade.ambienteId, unidade.categoriaId, agora, noites, pessoasEntrada) : null;
    if (!hotel && (!tabela || motor.periodos.length === 0)) {
      throw new BadRequestException(ehHotel
        ? 'Esta categoria ainda não tem diária. Configure em Tarifas › Diárias do hotel.'
        : 'Este ambiente ainda não tem tabela de preços. Configure em Tarifas.');
    }
    // saída prevista: dia da entrada + noites (check-out até as 14h)
    const saidaPrevista = hotel
      ? new Intl.DateTimeFormat('sv-SE', { timeZone: FUSO }).format(new Date(agora.getTime() + noites * 86_400_000))
      : null;
    const modalidade = dto.modalidade ?? 'periodo';
    if (modalidade === 'pernoite' && !this.tarifas.pernoiteDisponivel(motor, agora)) {
      throw new BadRequestException('Fora do horário de entrada do pernoite.');
    }
    const minimo = modalidade === 'periodo' && dto.periodoMinimoId
      ? motor.periodos.find((p) => p.id === dto.periodoMinimoId && p.tipo === 'horas') ?? null
      : null;

    const salva = await this.ds.transaction(async (m) => {
      // número do uso: contador da empresa (trava a linha até o fim da transação)
      const r = await m.query('UPDATE empresas SET ultimo_uso = ultimo_uso + 1 WHERE id = $1 RETURNING ultimo_uso', [u.empresaId]);
      const linha = Array.isArray(r?.[0]) ? r[0][0] : r?.[0];
      const numero = linha ? Number(linha.ultimo_uso) : null;
      const e = await m.save(
        m.create(Estadia, {
          numero,
          empresaId: u.empresaId,
          ambienteId: unidade.ambienteId,
          unidadeId: unidade.id,
          categoriaId: unidade.categoriaId,
          tabelaId: tabela?.id ?? null,
          modalidade,
          periodoMinimoId: minimo?.id ?? null,
          placa: dto.placa ? dto.placa.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || null : null,
          pessoas: pessoasEntrada,
          observacao: dto.observacao ?? null,
          ...(hotel ? { diariaCombinada: hotel.diaria.toFixed(2), totalCombinado: hotel.total.toFixed(2), saidaPrevista } : {}),
          status: 'aberta',
          entradaEm: agora,
          usuarioEntradaId: u.sub,
          usuarioEntradaNome: u.nome,
        }),
      );
      await this.mudarUnidade(m, u, unidade, 'ocupada', `Entrada${e.placa ? ` · ${e.placa}` : ''}`);
      if (dto.adiantamento?.length) await this.gravarAdiantamento(m, u, e.id, dto.adiantamento, 'entrada', unidade.ambienteId);
      await this.registrar(m, u, e.id, 'entrada',
        `Uso nº ${e.numero ?? '—'} · entrada na ${unidade.codigo}${e.placa ? `, placa ${e.placa}` : ''}, ${e.pessoas} pessoa(s), `
        + (hotel ? `${noites} noite(s) · diária ${brl(Math.round(hotel.diaria * 100))} · total ${brl(Math.round(hotel.total * 100))} · saída prevista ${saidaPrevista!.split('-').reverse().join('/')}` : `tabela ${tabela!.nome}`)
        + (modalidade === 'pernoite' ? ', pernoite' : minimo ? `, pacote ${minimo.nome}` : ''));
      return e;
    });
    return this.detalhe(u, salva.id);
  }

  async atualizar(u: UsuarioToken, id: string, dto: AtualizarEstadiaDto) {
    const e = await this.buscarAberta(u, id);
    const mudancas: string[] = [];
    const placa = dto.placa !== undefined ? dto.placa.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || null : undefined;
    if (placa !== undefined && placa !== e.placa) mudancas.push(`placa ${e.placa ?? '—'} → ${placa ?? '—'}`);
    if (dto.pessoas !== undefined && dto.pessoas !== e.pessoas) mudancas.push(`pessoas ${e.pessoas} → ${dto.pessoas}`);
    if (dto.observacao !== undefined && (dto.observacao || null) !== e.observacao) mudancas.push('observação alterada');
    await this.repo.update(
      { id },
      {
        ...(placa !== undefined && { placa }),
        ...(dto.pessoas !== undefined && { pessoas: dto.pessoas }),
        ...(dto.observacao !== undefined && { observacao: dto.observacao || null }),
      },
    );
    if (mudancas.length) await this.registrar(null, u, id, 'ajuste', mudancas.join(' · '));
    return this.detalhe(u, id);
  }

  async lancarItem(u: UsuarioToken, id: string, dto: LancarItemDto, opcoes: { semImpressao?: boolean } = {}) {
    const e = await this.buscarAberta(u, id);
    let descricao = dto.descricao?.trim() ?? '';
    let preco = dto.precoUnitario;
    let produtoId: string | null = null;
    if (dto.produtoId) {
      const p = await this.produtos.findOne({ where: { id: dto.produtoId, empresaId: u.empresaId } });
      if (!p) throw new BadRequestException('Produto não encontrado.');
      produtoId = p.id;
      descricao = p.nome;
      if (preco === undefined) preco = Number(p.preco);
    }
    if (!descricao) throw new BadRequestException('Escolha um produto ou escreva a descrição do item.');
    if (preco === undefined) throw new BadRequestException('Informe o preço do item.');
    const totalC = Math.round(centavos(preco) * dto.quantidade);
    await this.ds.transaction(async (m) => {
      const insItem = await m.insert(EstadiaItem, {
        empresaId: u.empresaId, estadiaId: e.id, produtoId, descricao,
        quantidade: String(dto.quantidade), precoUnitario: preco!.toFixed(2), total: reais(totalC),
        status: 'ativo', usuarioId: u.sub, usuarioNome: u.nome,
      });
      // estoque: baixa no local do ambiente desta conta
      const itemId = insItem.identifiers?.[0]?.id as string | undefined;
      if (itemId) await baixarConsumo(m, u.empresaId, e.ambienteId, produtoId, dto.quantidade, { referencia: `item:${itemId}`, observacao: `Conta nº ${e.numero ?? '—'}`, usuario: u.nome });
      const qtd = Number.isInteger(dto.quantidade) ? dto.quantidade : dto.quantidade.toFixed(3);
      await this.registrar(m, u, e.id, 'consumo', `${qtd}× ${descricao} · ${brl(totalC)}`);
    });
    // comanda de preparo nas impressoras do bar/cozinha (se houver)
    if (!opcoes.semImpressao) {
      void this.impressao.producao(u.empresaId, { ambienteId: e.ambienteId, unidadeId: e.unidadeId, origem: 'consumo', usuario: u.nome, itens: [{ produtoId, nome: descricao, quantidade: dto.quantidade }] });
    }
    return this.detalhe(u, id);
  }

  async estornarItem(u: UsuarioToken, id: string, itemId: string, dto: EstornarItemDto) {
    const e = await this.buscarAberta(u, id);
    const item = await this.itens.findOne({ where: { id: itemId, estadiaId: e.id } });
    if (!item) throw new NotFoundException('Item não encontrado.');
    if (item.status === 'estornado') throw new BadRequestException('Este item já foi estornado.');
    const libE = await this.liberarAcao(u, 'estadias.estornar', 'estornar itens', dto.autorizacao, { ambienteId: e.ambienteId, estadiaId: e.id, detalhe: dto.motivo });
    if (libE) dto.motivo = `${dto.motivo.trim()} · liberado por ${libE}`;
    await this.ds.transaction(async (m) => {
      await m.update(EstadiaItem, { id: item.id }, { status: 'estornado', motivoEstorno: dto.motivo.trim(), estornadoPor: u.nome, estornadoEm: new Date() });
      await devolverConsumo(m, u.empresaId, `item:${item.id}`, u.nome);
      await this.registrar(m, u, e.id, 'estorno', `Estorno: ${item.descricao} · ${brl(centavos(item.total))} · ${dto.motivo.trim()}`);
    });
    return this.detalhe(u, id);
  }

  async entregarConta(u: UsuarioToken, id: string) {
    const e = await this.buscar(u, id);
    if (e.status !== 'aberta') throw new BadRequestException('A conta só pode ser entregue com a entrada aberta.');
    const unidade = await this.unidades.findOneOrFail({ where: { id: e.unidadeId } });
    await this.ds.transaction(async (m) => {
      await m.update(Estadia, { id }, { status: 'conta_entregue', contaEntregueEm: new Date() });
      await this.mudarUnidade(m, u, unidade, 'conta_entregue', 'Conta entregue');
      await this.registrar(m, u, id, 'conta_entregue', 'Conta entregue (tempo parado)');
    });
    return this.detalhe(u, id);
  }

  async voltarAContar(u: UsuarioToken, id: string) {
    const e = await this.buscar(u, id);
    if (e.status !== 'conta_entregue' || !e.contaEntregueEm) throw new BadRequestException('A conta não está entregue.');
    const parado = Math.max(0, Math.floor((Date.now() - new Date(e.contaEntregueEm).getTime()) / 60000));
    const unidade = await this.unidades.findOneOrFail({ where: { id: e.unidadeId } });
    await this.ds.transaction(async (m) => {
      await m.update(Estadia, { id }, { status: 'aberta', contaEntregueEm: null, pausadoMin: (e.pausadoMin ?? 0) + parado });
      await this.mudarUnidade(m, u, unidade, 'ocupada', 'Voltou a contar o tempo');
      await this.registrar(m, u, id, 'voltar', `Voltou a contar (ficou ${parado} min parado)`);
    });
    return this.detalhe(u, id);
  }

  async transferir(u: UsuarioToken, id: string, dto: TransferirDto) {
    const e = await this.buscarAberta(u, id);
    const origem = await this.unidades.findOneOrFail({ where: { id: e.unidadeId } });
    const destino = await this.unidades.findOne({ where: { id: dto.unidadeId, empresaId: u.empresaId, ativo: true } });
    if (!destino) throw new NotFoundException('Unidade de destino não encontrada.');
    if (destino.id === origem.id) throw new BadRequestException('Escolha uma unidade diferente.');
    if (!this.podeVer(u, destino.ambienteId)) throw new ForbiddenException('Unidade de outro ambiente.');
    if (!['livre', 'reservada'].includes(destino.status)) throw new BadRequestException(`A ${destino.codigo} não está livre.`);
    if (destino.ambienteId !== origem.ambienteId) throw new BadRequestException('Transferência só dentro do mesmo ambiente.');

    const novaCategoria = dto.manterPreco ? e.categoriaId : destino.categoriaId;
    await this.ds.transaction(async (m) => {
      await m.update(Estadia, { id }, { unidadeId: destino.id, categoriaId: novaCategoria });
      await this.mudarUnidade(m, u, destino, e.status === 'conta_entregue' ? 'conta_entregue' : 'ocupada', `Transferida da ${origem.codigo}`);
      await this.mudarUnidade(m, u, origem, 'limpeza', `Transferida para ${destino.codigo}: ${dto.motivo.trim()}`);
      await this.registrar(m, u, id, 'transferencia',
        `Transferida da ${origem.codigo} para ${destino.codigo} · ${dto.manterPreco ? 'manteve o preço da entrada' : 'passou a cobrar pela categoria nova'} · ${dto.motivo.trim()}`);
    });
    return this.detalhe(u, id);
  }

  async trocarCobranca(u: UsuarioToken, id: string, dto: TrocarCobrancaDto) {
    const e = await this.buscarAberta(u, id);
    const motor = await this.tarifas.motor(u.empresaId, e.ambienteId);
    if (dto.modalidade === 'pernoite' && !motor.pernoite) throw new BadRequestException('Este ambiente não tem pernoite.');
    let minimoId: string | null = null;
    let minimoNome = '';
    if (dto.modalidade === 'periodo' && dto.periodoMinimoId) {
      const p = motor.periodos.find((x) => x.id === dto.periodoMinimoId && x.tipo === 'horas');
      if (!p) throw new BadRequestException('Período inválido.');
      minimoId = p.id;
      minimoNome = p.nome;
    }
    await this.ds.transaction(async (m) => {
      await m.update(Estadia, { id }, { modalidade: dto.modalidade, periodoMinimoId: minimoId });
      await this.registrar(m, u, id, 'cobranca',
        dto.modalidade === 'pernoite' ? 'Cobrança trocada para pernoite' : minimoId ? `Cobrança trocada para pacote ${minimoNome}` : 'Cobrança trocada para por período (automático)');
    });
    return this.detalhe(u, id);
  }

  async corrigir(u: UsuarioToken, id: string, dto: CorrigirEstadiaDto) {
    const e = await this.buscarAberta(u, id);
    const libC = await this.liberarAcao(u, 'estadias.corrigir', 'corrigir a entrada', dto.autorizacao, { ambienteId: e.ambienteId, estadiaId: e.id, detalhe: dto.motivo });
    if (libC) dto.motivo = `${dto.motivo.trim()} · liberado por ${libC}`;
    const motor = await this.tarifas.motor(u.empresaId, e.ambienteId);
    const mudancas: string[] = [];
    const dados: Partial<Estadia> = {};
    if (dto.entradaEm) {
      const nova = new Date(dto.entradaEm);
      if (Number.isNaN(nova.getTime())) throw new BadRequestException('Hora de entrada inválida.');
      if (nova.getTime() > Date.now()) throw new BadRequestException('A hora de entrada não pode ser no futuro.');
      if (Date.now() - nova.getTime() > 3 * 24 * 60 * 60000) throw new BadRequestException('Correção limitada a 3 dias.');
      dados.entradaEm = nova;
      mudancas.push(`entrada ${new Date(e.entradaEm).toLocaleString('pt-BR', { timeZone: FUSO })} → ${nova.toLocaleString('pt-BR', { timeZone: FUSO })}`);
    }
    if (dto.tabelaId && dto.tabelaId !== e.tabelaId) {
      const t = motor.tabelas.find((x) => x.id === dto.tabelaId);
      if (!t) throw new BadRequestException('Tabela inválida.');
      dados.tabelaId = t.id;
      mudancas.push(`tabela ${motor.tabelas.find((x) => x.id === e.tabelaId)?.nome ?? '—'} → ${t.nome}`);
    }
    if (!mudancas.length) throw new BadRequestException('Nada para corrigir.');
    await this.ds.transaction(async (m) => {
      await m.update(Estadia, { id }, dados);
      await this.registrar(m, u, id, 'correcao', `Correção: ${mudancas.join(' · ')} · motivo: ${dto.motivo.trim()}`);
    });
    return this.detalhe(u, id);
  }

  /** Confere o limite do perfil; acima dele, exige login e senha de quem pode liberar. */
  /**
   * Ação que o perfil não tem: pede login e senha de alguém que tenha a permissão.
   * Retorna o nome de quem liberou (ou null se o próprio usuário pode).
   */
  private async liberarAcao(u: UsuarioToken, permissao: string, nomeAcao: string, aut?: AutorizacaoEntrada, ctx: { ambienteId?: string; estadiaId?: string; detalhe?: string; valor?: number } = {}) {
    return liberarPermissao(this.ds, u, permissao, nomeAcao, aut, ctx);
  }

  private async conferirLimite(u: UsuarioToken, total: number, desconto: number, acrescimo: number, dto: FecharEstadiaDto, ctx: { ambienteId?: string; estadiaId?: string } = {}) {
    const pct = (v: number) => (total > 0 ? (v / total) * 100 : v > 0 ? 100 : 0);
    const precisa = (limites: { descontoPercentual?: number; acrescimoPercentual?: number; cortesia?: boolean } | undefined) => {
      const l = limites ?? {};
      if (desconto > 0 && desconto >= total && total > 0 && !l.cortesia) return true;
      if (pct(desconto) > (l.descontoPercentual ?? 0) + 0.0001) return true;
      if (pct(acrescimo) > (l.acrescimoPercentual ?? 0) + 0.0001) return true;
      return false;
    };
    if (desconto === 0 && acrescimo === 0) return null;
    if (temPermissao(u, '*')) return null;
    const meu = await this.perfis.findOne({ where: { id: u.perfilId } });
    if (!precisa(meu?.limites)) return null;

    if (!dto.autorizacao || (!dto.autorizacao.pin && !dto.autorizacao.login)) {
      throw new ForbiddenException('Passa do seu limite de desconto/acréscimo. Peça a senha de liberação do gerente.');
    }
    const quem = await quemLibera(this.ds, u.empresaId, dto.autorizacao);
    const ehAdmin = quem.permissoes.includes('*');
    if (!ehAdmin && precisa(quem.limites)) {
      throw new ForbiddenException(`${quem.nome} também não tem limite para esse valor.`);
    }
    if (quem.id === u.sub) throw new ForbiddenException('A liberação precisa ser de outra pessoa.');
    const partes = [desconto > 0 ? `desconto de ${brl(desconto)} (${pct(desconto).toFixed(1).replace('.', ',')}%)` : '', acrescimo > 0 ? `acréscimo de ${brl(acrescimo)}` : ''].filter(Boolean);
    await registrarLiberacao(this.ds, u, quem, {
      acao: desconto > 0 ? 'desconto acima do limite' : 'acréscimo acima do limite',
      ambienteId: ctx.ambienteId, estadiaId: ctx.estadiaId,
      detalhe: [partes.join(' e '), dto.motivo?.trim()].filter(Boolean).join(' · '),
      valor: (desconto > 0 ? desconto : acrescimo) / 100, meio: dto.autorizacao.pin ? 'pin' : 'login',
    });
    return quem.nome;
  }

  async fechar(u: UsuarioToken, id: string, dto: FecharEstadiaDto) {
    const e = await this.buscarAberta(u, id);
    const notaDoc = dto.nota?.emitir ? documentoFiscal(dto.nota.documento) : null;
    const controlaNotas = moduloAtivo((await this.empresas.findOne({ where: { id: u.empresaId } }))?.modulos, 'notas');
    const motor = await this.tarifas.motor(u.empresaId, e.ambienteId);
    const consumo = (await this.consumoDe([e.id])).get(e.id) ?? 0;
    const conta = this.calcular(e, motor, consumo);
    // cortesia cadastrada: o desconto vem da regra dela (e não do limite do perfil)
    let cortesia: { nome: string; pct: number; aplicaEm: string; exigeSenha: boolean } | null = null;
    if (dto.cortesiaId) {
      const und = await this.unidades.findOne({ where: { id: e.unidadeId } });
      cortesia = await this.cortesias.paraConta(u.empresaId, dto.cortesiaId, e.unidadeId, e.categoriaId ?? und?.categoriaId ?? null);
    }
    const baseCortesia = cortesia ? (cortesia.aplicaEm === 'hospedagem' ? conta.valorHospedagem + conta.valorPessoas : conta.total) : 0;
    const desconto = cortesia ? Math.round((baseCortesia * cortesia.pct) / 100) : centavos(dto.desconto ?? 0);
    const acrescimo = centavos(dto.acrescimo ?? 0);
    if (desconto > conta.total + acrescimo) throw new BadRequestException('O desconto é maior que a conta.');
    if (!cortesia && (desconto > 0 || acrescimo > 0) && !dto.motivo?.trim()) throw new BadRequestException('Informe o motivo do desconto ou acréscimo.');
    let autorizadoPor = await this.conferirLimite(u, conta.total, cortesia ? 0 : desconto, acrescimo, dto, { ambienteId: e.ambienteId, estadiaId: e.id });
    if (cortesia?.exigeSenha) autorizadoPor = (await this.liberarAcao(u, 'cortesias.gerenciar', `usar a cortesia ${cortesia.nome}`, dto.autorizacao, { ambienteId: e.ambienteId, estadiaId: e.id, valor: desconto / 100 })) ?? autorizadoPor;
    if (cortesia && !dto.motivo?.trim()) dto.motivo = `Cortesia ${cortesia.nome} (${cortesia.pct}%)`;
    const total = conta.total - desconto + acrescimo;

    // pagamentos: com o que já foi pago na entrada, precisam somar exatamente o total
    const pags = this.lerPagamentos(dto.pagamentos ?? []);
    for (const pg of dto.pagadores ?? []) documentoFiscal(pg.documento); // CPF/CNPJ errado avisa antes de gravar
    if (pags.some((p) => p.forma === 'penhora' && p.penhoraItem.length < 2)) throw new BadRequestException('Na penhora, diga qual objeto o cliente deixou (ex.: celular, relógio).');
    const anteriores = await this.pagamentos.find({ where: { estadiaId: e.id } });
    const adiantado = anteriores.reduce((s, p) => s + centavos(Number(p.valor)), 0);
    const restante = total - adiantado;
    const pago = pags.reduce((s, p) => s + p.valor, 0);
    if (restante > 0 && pago !== restante) {
      throw new BadRequestException(adiantado
        ? `Já foram pagos ${brl(adiantado)} na entrada; falta ${brl(restante)}, mas os pagamentos somam ${brl(pago)}.`
        : `Os pagamentos somam ${brl(pago)}, mas a conta é ${brl(total)}.`);
    }
    if (restante <= 0 && pags.length) throw new BadRequestException(restante < 0 ? `A conta já está paga (sobram ${brl(-restante)} para devolver ao cliente).` : 'A conta já está paga.');
    const formas = [...new Set([...anteriores.map((p) => p.forma), ...pags.map((p) => p.forma)])];
    const forma = (total === 0 && !formas.length ? 'cortesia' : formas.length === 1 ? formas[0] : 'misto') as FormaPagamento;
    const trocoTotal = pags.reduce((s, p) => s + p.troco, 0);
    const gorjeta = pags.find((p) => p.trocoDestino === 'gorjeta');

    const unidade = await this.unidades.findOneOrFail({ where: { id: e.unidadeId } });
    const turnoId = pags.length ? await this.caixa.turnoParaRecebimento(u.empresaId, e.ambienteId) : null;
    await this.ds.transaction(async (m) => {
      for (const p of pags) {
        const ins = await m.insert(EstadiaPagamento, {
          empresaId: u.empresaId, estadiaId: e.id, forma: p.forma, valor: reais(p.valor),
          valorRecebido: p.recebido !== null ? reais(p.recebido) : null, troco: reais(p.troco),
          trocoDestino: p.trocoDestino, gorjetaPara: p.gorjetaPara, usuarioId: u.sub, usuarioNome: u.nome, momento: 'fechamento', turnoId,
        });
        if (p.forma === 'penhora') {
          await m.insert(Penhora, {
            empresaId: u.empresaId, ambienteId: e.ambienteId, estadiaId: e.id, pagamentoId: ins.identifiers?.[0]?.id ?? null, turnoId,
            valor: reais(p.valor), item: p.penhoraItem, contato: p.penhoraContato, status: 'aberta', usuarioNome: u.nome,
          });
          await this.registrar(m, u, id, 'penhora', `Penhora: ${p.penhoraItem} garante ${brl(p.valor)}${p.penhoraContato ? ` · contato ${p.penhoraContato}` : ''}`);
        }
        if (p.forma === 'faturado') {
          const quando = new Date(e.entradaEm).toLocaleDateString('pt-BR', { timeZone: FUSO });
          await this.faturamento.lancarDaConta(m, u, p.clienteFaturadoId, e.id, p.valor, `Uso nº ${e.numero ?? '—'} · ${unidade.codigo} · ${quando}${e.placa ? ` · ${e.placa}` : ''}`);
        }
      }
      // gorjetas identificadas: troco deixado e valor a mais no cartão/pix
      const itensGorjeta = pags.flatMap((p) => [
        ...(p.trocoDestino === 'gorjeta' && p.troco > 0 ? [{ origem: 'troco' as const, forma: 'dinheiro', valorCent: p.troco, beneficiarioId: p.gorjetaUsuarioId, nome: p.gorjetaPara }] : []),
        ...(p.gorjetaAdicional > 0 ? [{ origem: 'adicional' as const, forma: p.forma, valorCent: p.gorjetaAdicional, beneficiarioId: p.gorjetaUsuarioId, nome: p.gorjetaPara }] : []),
      ]);
      const gs = await this.gorjetas.registrar(m, u, { estadiaId: e.id, turnoId, itens: itensGorjeta });
      if (gs.length) {
        await this.registrar(m, u, id, 'gorjeta', `Gorjeta: ${gs.map((g) => `${g.beneficiarioNome} ${brl(Math.round(Number(g.valor) * 100))} (${g.status === 'paga_na_hora' ? 'paga na hora' : g.status === 'casa' ? 'casa' : 'a repassar'})`).join(' · ')}`);
      }
      if (restante < 0) await this.registrar(m, u, id, 'devolucao', `Pago a mais na entrada: devolver ${brl(-restante)} ao cliente`);
      await m.update(Estadia, { id }, {
        status: 'fechada',
        saidaEm: new Date(),
        periodoNome: conta.periodoNome,
        valorHospedagem: reais(conta.valorHospedagem),
        valorPessoas: reais(conta.valorPessoas),
        valorConsumo: reais(conta.consumo),
        desconto: reais(desconto),
        acrescimo: reais(acrescimo),
        valorTotal: reais(total),
        formaPagamento: forma,
        valorRecebido: pags.length === 1 && pags[0].recebido !== null ? reais(pags[0].recebido) : null,
        troco: reais(trocoTotal),
        trocoDestino: trocoTotal > 0 ? (gorjeta ? 'gorjeta' : 'cliente') : null,
        gorjetaPara: gorjeta?.gorjetaPara ?? null,
        motivoAjuste: dto.motivo?.trim() || null,
        cortesiaNome: cortesia?.nome ?? null,
        autorizadoPor,
        usuarioSaidaId: u.sub,
        usuarioSaidaNome: u.nome,
        // toda conta paga entra em "notas para emitir"
        notaStatus: controlaNotas && total > 0 ? 'pendente' : 'nao',
        notaDocumento: notaDoc,
        notaNome: dto.nota?.nome?.trim() || null,
        notaEmail: dto.nota?.email?.trim() || null,
        notaSolicitadaEm: controlaNotas && total > 0 ? new Date() : null,
      });
      // pagador separado: uma nota a emitir para cada parte (empresa × hóspede)
      if (controlaNotas && total > 0 && dto.pagadores?.length) {
        const hosp = conta.valorHospedagem + conta.valorPessoas;
        const empresa = dto.pagadores.find((x) => x.tipo === 'empresa');
        const hospede = dto.pagadores.find((x) => x.tipo === 'hospede');
        const parteEmp = !empresa ? 0 : Math.min(total, empresa.parte === 'hospedagem' ? hosp : empresa.parte === 'consumo' ? conta.consumo : total);
        const partes = [
          ...(empresa && parteEmp > 0 ? [{ p: empresa, valor: parteEmp }] : []),
          ...(total - parteEmp > 0 ? [{ p: hospede ?? { tipo: 'hospede' as const, parte: 'resto' as const }, valor: total - parteEmp }] : []),
        ];
        for (const x of partes) {
          await m.query(
            `INSERT INTO estadia_notas (empresa_id, estadia_id, pagador, nome, documento, parte, valor) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [u.empresaId, e.id, x.p.tipo, x.p.nome?.trim() || null, documentoFiscal(x.p.documento) ?? null,
              x.p.tipo === 'empresa' ? x.p.parte : empresa ? (empresa.parte === 'hospedagem' ? 'consumo' : empresa.parte === 'consumo' ? 'hospedagem' : 'resto') : 'tudo', reais(x.valor)]);
        }
        if (partes.length) {
          await this.registrar(m, u, id, 'nota', `Notas separadas: ${partes.map((x) => `${x.p.tipo === 'empresa' ? `empresa${x.p.nome ? ` (${x.p.nome})` : ''}` : 'hóspede'} ${brl(x.valor)}`).join(' · ')}`);
        }
      }
      const resumoPag = pags.length
        ? pags.map((p) => `${NOMES_FORMA[p.forma] ?? p.forma} ${brl(p.valor)}${p.troco ? ` (${p.trocoDestino === 'gorjeta' ? `gorjeta ${brl(p.troco)} p/ ${p.gorjetaPara}` : `troco ${brl(p.troco)}`})` : ''}`).join(' + ')
        : 'cortesia';
      await this.registrar(m, u, id, 'fechamento',
        `Fechada: ${brl(total)} · ${resumoPag}${desconto ? ` · desconto ${brl(desconto)}` : ''}${acrescimo ? ` · acréscimo ${brl(acrescimo)}` : ''}${autorizadoPor ? ` · liberado por ${autorizadoPor}` : ''}`);
      // motel com portão: a suíte fica "paga" até o ticket ser conferido na saída
      const amb = await m.findOne(Ambiente, { where: { id: e.ambienteId } });
      if (amb?.limpezaNaSaida && !e.saidaPortariaEm) await this.mudarUnidade(m, u, unidade, 'paga', `Paga · ${brl(total)} · aguardando saída`);
      else await this.mudarUnidade(m, u, unidade, 'limpeza', `Saída · ${brl(total)}`);
    });
    return this.detalhe(u, id);
  }

  /**
   * Corrige a forma de pagamento lançada errado. Com o caixa do turno ainda aberto, só muda
   * (o resumo do caixa recalcula). Com o turno já fechado, lança a correção no caixa ADM
   * (sai da forma errada e entra na certa) para a conciliação bater com o banco.
   */
  async mudarForma(u: UsuarioToken, pagamentoId: string, dto: MudarFormaDto) {
    const p = await this.pagamentos.findOne({ where: { id: pagamentoId, empresaId: u.empresaId } });
    if (!p) throw new NotFoundException('Pagamento não encontrado.');
    const formas = ['dinheiro', 'pix', 'debito', 'credito'];
    if (!formas.includes(p.forma)) throw new BadRequestException(`Pagamento em ${NOMES_FORMA[p.forma] ?? p.forma} não pode ter a forma trocada.`);
    if (p.forma === dto.forma) throw new BadRequestException('O pagamento já está nessa forma.');
    if (Number(p.troco) > 0) throw new BadRequestException('Este pagamento teve troco em dinheiro; para trocar a forma, estorne e lance de novo.');
    const autorizadoPor = await this.liberarAcao(u, 'pagamentos.corrigir', 'mudar a forma de pagamento', dto.autorizacao, { estadiaId: p.estadiaId, detalhe: dto.motivo, valor: Number(p.valor) });
    const e = await this.repo.findOne({ where: { id: p.estadiaId, empresaId: u.empresaId } });
    if (!e) throw new NotFoundException('Conta não encontrada.');
    const turno = p.turnoId ? await this.ds.getRepository(CaixaTurno).findOne({ where: { id: p.turnoId } }) : null;
    const de = p.forma;
    await this.ds.transaction(async (m) => {
      await m.update(EstadiaPagamento, { id: p.id }, { forma: dto.forma, valorRecebido: null });
      // gorjeta passada junto no cartão/pix acompanha a forma
      await m.update(Gorjeta, { estadiaId: e.id, origem: 'adicional', forma: de }, { forma: dto.forma });
      if (turno?.status === 'fechado') {
        const desc = `Correção de forma · uso ${e.numero ?? '—'} · turno ${turno.numero}: ${NOMES_FORMA[de]} → ${NOMES_FORMA[dto.forma]}`;
        const base = { empresaId: u.empresaId, turnoId: turno.id, caixa: 'adm' as const, valor: p.valor, usuarioId: u.sub, usuarioNome: u.nome, autorizadoPor, cnpj: await cnpjDoAmbiente(m, turno.ambienteId) };
        // dinheiro já foi conferido na gaveta (a diferença ficou no fechamento); só eletrônicos são corrigidos no ADM
        if (de !== 'dinheiro') await m.insert(CaixaMovimento, { ...base, tipo: 'saida', forma: de, descricao: desc });
        if (dto.forma !== 'dinheiro') await m.insert(CaixaMovimento, { ...base, tipo: 'entrada', forma: dto.forma, descricao: desc });
      }
      const todas: EstadiaPagamento[] = await m.find(EstadiaPagamento, { where: { estadiaId: e.id } });
      const lista = [...new Set(todas.map((x) => x.forma))];
      if (e.status === 'fechada') await m.update(Estadia, { id: e.id }, { formaPagamento: (lista.length === 1 ? lista[0] : 'misto') as FormaPagamento });
      await this.registrar(m, u, e.id, 'correcao',
        `Forma de pagamento corrigida: ${brl(centavos(Number(p.valor)))} de ${NOMES_FORMA[de]} para ${NOMES_FORMA[dto.forma]} · ${dto.motivo.trim()}${autorizadoPor ? ` · liberado por ${autorizadoPor}` : ''}`);
    });
    return { ok: true, turnoFechado: turno?.status === 'fechado' };
  }

  async cancelar(u: UsuarioToken, id: string, dto: CancelarEstadiaDto) {
    const e = await this.buscarAberta(u, id);
    const libX = await this.liberarAcao(u, 'estadias.cancelar', 'cancelar entradas', dto.autorizacao, { ambienteId: e.ambienteId, estadiaId: e.id, detalhe: dto.motivo });
    if (libX) dto.motivo = `${dto.motivo.trim()} · liberado por ${libX}`;
    const unidade = await this.unidades.findOneOrFail({ where: { id: e.unidadeId } });
    // o que foi consumido volta ao estoque e o que foi pago antes (entrada/adiantado) é devolvido
    const ativos = await this.itens.find({ where: { estadiaId: e.id, status: 'ativo' } });
    const pagos = await this.pagamentos.find({ where: { estadiaId: e.id } });
    const devolver = pagos.filter((p) => p.forma !== 'faturado' && p.forma !== 'penhora' && Number(p.valor) > 0);
    const turnoId = devolver.length ? await this.caixa.turnoParaRecebimento(u.empresaId, e.ambienteId) : null;
    await this.ds.transaction(async (m) => {
      for (const it of ativos) {
        await m.update(EstadiaItem, { id: it.id }, { status: 'estornado', motivoEstorno: `Entrada cancelada: ${dto.motivo.trim()}`, estornadoPor: u.nome, estornadoEm: new Date() });
        await devolverConsumo(m, u.empresaId, `item:${it.id}`, u.nome);
      }
      if (ativos.length) {
        await this.registrar(m, u, id, 'estorno', `Entrada cancelada: ${ativos.length} item(ns) estornado(s), produtos de volta ao estoque (${ativos.map((i) => i.descricao).join(', ')})`);
      }
      for (const p of devolver) {
        // a devolução sai do caixa do turno, na mesma forma em que foi paga (cartão/pix: estorne na maquininha/banco)
        if (turnoId) {
          await m.insert(CaixaMovimento, {
            empresaId: u.empresaId, turnoId, caixa: 'principal', tipo: 'despesa', forma: p.forma, valor: p.valor,
            descricao: `Devolução · entrada cancelada · ${unidade.codigo}${e.numero ? ` · uso ${e.numero}` : ''}`, categoria: 'Devolução ao cliente',
            usuarioId: u.sub, usuarioNome: u.nome, autorizadoPor: libX ?? null, cnpj: null,
          });
        }
        await this.registrar(m, u, id, 'devolucao', `Devolver ao cliente ${brl(centavos(p.valor))} (${NOMES_FORMA[p.forma] ?? p.forma})${turnoId ? ' · lançado no caixa' : ''}`);
      }
      await m.update(Estadia, { id }, {
        status: 'cancelada', saidaEm: new Date(), motivoAjuste: dto.motivo.trim(), usuarioSaidaId: u.sub, usuarioSaidaNome: u.nome,
      });
      await this.registrar(m, u, id, 'cancelamento', `Entrada cancelada: ${dto.motivo.trim()}`);
      await this.mudarUnidade(m, u, unidade, dto.destino ?? 'livre', `Entrada cancelada: ${dto.motivo.trim()}`);
    });
    return {
      ok: true,
      itensEstornados: ativos.length,
      devolver: devolver.map((p) => ({ forma: p.forma, valor: Number(p.valor) })),
      lancadoNoCaixa: !!turnoId,
    };
  }
}
