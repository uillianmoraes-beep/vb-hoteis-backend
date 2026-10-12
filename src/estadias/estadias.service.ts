import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
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
import { moduloAtivo } from '../common/modulos';
import { FUSO, Motor, TarifasService } from '../tarifas/tarifas.service';
import {
  AbrirEstadiaDto, AdiantamentoDto, PagamentoDto, AtualizarEstadiaDto, CancelarEstadiaDto, CorrigirEstadiaDto, EstornarItemDto, FecharEstadiaDto,
  LancarItemDto, TransferirDto, TrocarCobrancaDto,
} from './estadias.dto';
import { StatusUnidade, UsuarioToken, temPermissao } from '../common/permissoes';
import { calcularConta, centavos, minutosAteHorario, reais, ResultadoCalc } from './calculadora';

export interface ContaCalculada extends ResultadoCalc {
  minutosUso: number;
  tabelaNome: string | null;
  parado: boolean;
  pacote: string | null;
}

const ABERTAS = ['aberta', 'conta_entregue'];
const NOMES_FORMA: Record<string, string> = { dinheiro: 'dinheiro', pix: 'Pix', debito: 'débito', credito: 'crédito', faturado: 'faturado' };
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
    const pacote = e.periodoMinimoId ? periodos.find((p) => p.id === e.periodoMinimoId)?.nome ?? null : null;
    return { ...r, minutosUso, tabelaNome: tabela?.nome ?? null, parado: e.status === 'conta_entregue', pacote };
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
    const motor = await this.tarifas.motor(u.empresaId, e.ambienteId);
    const consumo = (await this.consumoDe([e.id])).get(e.id) ?? 0;
    const [itens, pagamentos, eventos, unidade] = await Promise.all([
      this.itens.find({ where: { estadiaId: e.id }, order: { criadoEm: 'ASC' } }),
      this.pagamentos.find({ where: { estadiaId: e.id }, order: { criadoEm: 'ASC' } }),
      this.eventos.find({ where: { estadiaId: e.id }, order: { criadoEm: 'ASC' } }),
      this.unidades.findOne({ where: { id: e.unidadeId }, relations: { categoria: true } }),
    ]);
    const precos = this.tarifas.precosDe(motor, e.tabelaId, e.categoriaId);
    return {
      ...this.formatar(e, this.calcular(e, motor, consumo)),
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
      return { forma: p.forma, valor, recebido, troco, trocoDestino, gorjetaPara: trocoDestino === 'gorjeta' ? p.gorjetaPara?.trim() || 'Casa' : null };
    });
  }

  private async gravarAdiantamento(m: EntityManager, u: UsuarioToken, estadiaId: string, lista: PagamentoDto[], momento: 'entrada' | 'adiantamento') {
    const pags = this.lerPagamentos(lista).filter((p) => p.valor > 0);
    if (!pags.length) return 0;
    for (const p of pags) {
      await m.insert(EstadiaPagamento, {
        empresaId: u.empresaId, estadiaId, forma: p.forma, valor: reais(p.valor),
        valorRecebido: p.recebido !== null ? reais(p.recebido) : null, troco: reais(p.troco),
        trocoDestino: p.trocoDestino, gorjetaPara: p.gorjetaPara, usuarioId: u.sub, usuarioNome: u.nome, momento,
      });
    }
    const soma = pags.reduce((s, p) => s + p.valor, 0);
    await this.registrar(m, u, estadiaId, 'adiantamento',
      `${momento === 'entrada' ? 'Pago na entrada' : 'Recebido antecipado'}: ${pags.map((p) => `${NOMES_FORMA[p.forma] ?? p.forma} ${brl(p.valor)}${p.troco ? ` (troco ${brl(p.troco)})` : ''}`).join(' + ')}`);
    return soma;
  }

  /** Receber parte da conta antes do fechamento (ex.: portaria). */
  async adiantamento(u: UsuarioToken, id: string, dto: AdiantamentoDto) {
    await this.buscarAberta(u, id);
    await this.ds.transaction(async (m) => {
      const soma = await this.gravarAdiantamento(m, u, id, dto.pagamentos, 'adiantamento');
      if (!soma) throw new BadRequestException('Informe o valor recebido.');
    });
    return this.detalhe(u, id);
  }

  async abrir(u: UsuarioToken, dto: AbrirEstadiaDto) {
    const unidade = await this.unidades.findOne({ where: { id: dto.unidadeId, empresaId: u.empresaId, ativo: true } });
    if (!unidade) throw new NotFoundException('Unidade não encontrada.');
    if (!this.podeVer(u, unidade.ambienteId)) throw new ForbiddenException('Unidade de outro ambiente.');
    if (!['livre', 'reservada'].includes(unidade.status)) {
      throw new BadRequestException(`A unidade ${unidade.codigo} não está livre (está como ${unidade.status}).`);
    }
    const motor = await this.tarifas.motor(u.empresaId, unidade.ambienteId);
    const agora = new Date();
    const tabela = this.tarifas.escolherTabela(motor, agora);
    if (!tabela || motor.periodos.length === 0) {
      throw new BadRequestException('Este ambiente ainda não tem tabela de preços. Configure em Tarifas.');
    }
    const modalidade = dto.modalidade ?? 'periodo';
    if (modalidade === 'pernoite' && !this.tarifas.pernoiteDisponivel(motor, agora)) {
      throw new BadRequestException('Fora do horário de entrada do pernoite.');
    }
    const minimo = modalidade === 'periodo' && dto.periodoMinimoId
      ? motor.periodos.find((p) => p.id === dto.periodoMinimoId && p.tipo === 'horas') ?? null
      : null;

    const salva = await this.ds.transaction(async (m) => {
      const e = await m.save(
        m.create(Estadia, {
          empresaId: u.empresaId,
          ambienteId: unidade.ambienteId,
          unidadeId: unidade.id,
          categoriaId: unidade.categoriaId,
          tabelaId: tabela.id,
          modalidade,
          periodoMinimoId: minimo?.id ?? null,
          placa: dto.placa ? dto.placa.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || null : null,
          pessoas: dto.pessoas ?? Math.min(2, unidade.capacidade || 2),
          observacao: dto.observacao ?? null,
          status: 'aberta',
          entradaEm: agora,
          usuarioEntradaId: u.sub,
          usuarioEntradaNome: u.nome,
        }),
      );
      await this.mudarUnidade(m, u, unidade, 'ocupada', `Entrada${e.placa ? ` · ${e.placa}` : ''}`);
      if (dto.adiantamento?.length) await this.gravarAdiantamento(m, u, e.id, dto.adiantamento, 'entrada');
      await this.registrar(m, u, e.id, 'entrada',
        `Entrada na ${unidade.codigo}${e.placa ? `, placa ${e.placa}` : ''}, ${e.pessoas} pessoa(s), tabela ${tabela.nome}`
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

  async lancarItem(u: UsuarioToken, id: string, dto: LancarItemDto) {
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
      await m.insert(EstadiaItem, {
        empresaId: u.empresaId, estadiaId: e.id, produtoId, descricao,
        quantidade: String(dto.quantidade), precoUnitario: preco!.toFixed(2), total: reais(totalC),
        status: 'ativo', usuarioId: u.sub, usuarioNome: u.nome,
      });
      const qtd = Number.isInteger(dto.quantidade) ? dto.quantidade : dto.quantidade.toFixed(3);
      await this.registrar(m, u, e.id, 'consumo', `${qtd}× ${descricao} · ${brl(totalC)}`);
    });
    return this.detalhe(u, id);
  }

  async estornarItem(u: UsuarioToken, id: string, itemId: string, dto: EstornarItemDto) {
    const e = await this.buscarAberta(u, id);
    const item = await this.itens.findOne({ where: { id: itemId, estadiaId: e.id } });
    if (!item) throw new NotFoundException('Item não encontrado.');
    if (item.status === 'estornado') throw new BadRequestException('Este item já foi estornado.');
    await this.ds.transaction(async (m) => {
      await m.update(EstadiaItem, { id: item.id }, { status: 'estornado', motivoEstorno: dto.motivo.trim(), estornadoPor: u.nome, estornadoEm: new Date() });
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
  private async conferirLimite(u: UsuarioToken, total: number, desconto: number, acrescimo: number, dto: FecharEstadiaDto) {
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

    if (!dto.autorizacao) {
      throw new ForbiddenException('Passa do seu limite de desconto/acréscimo. Peça para alguém com permissão liberar com login e senha.');
    }
    const quem = await this.usuarios
      .createQueryBuilder('x')
      .addSelect('x.senhaHash')
      .leftJoinAndSelect('x.perfil', 'perfil')
      .where('lower(x.login) = lower(:l)', { l: dto.autorizacao.login.trim() })
      .andWhere('x.empresaId = :e', { e: u.empresaId })
      .getOne();
    if (!quem || !quem.ativo || !(await bcrypt.compare(dto.autorizacao.senha, quem.senhaHash))) {
      throw new ForbiddenException('Login ou senha de quem libera estão incorretos.');
    }
    const ehAdmin = (quem.perfil?.permissoes ?? []).includes('*');
    if (!ehAdmin && precisa(quem.perfil?.limites)) {
      throw new ForbiddenException(`${quem.nome} também não tem limite para esse valor.`);
    }
    return quem.nome;
  }

  async fechar(u: UsuarioToken, id: string, dto: FecharEstadiaDto) {
    const e = await this.buscarAberta(u, id);
    const notaDoc = dto.nota?.emitir ? documentoFiscal(dto.nota.documento) : null;
    const controlaNotas = moduloAtivo((await this.empresas.findOne({ where: { id: u.empresaId } }))?.modulos, 'notas');
    const motor = await this.tarifas.motor(u.empresaId, e.ambienteId);
    const consumo = (await this.consumoDe([e.id])).get(e.id) ?? 0;
    const conta = this.calcular(e, motor, consumo);
    const desconto = centavos(dto.desconto ?? 0);
    const acrescimo = centavos(dto.acrescimo ?? 0);
    if (desconto > conta.total + acrescimo) throw new BadRequestException('O desconto é maior que a conta.');
    if ((desconto > 0 || acrescimo > 0) && !dto.motivo?.trim()) throw new BadRequestException('Informe o motivo do desconto ou acréscimo.');
    const autorizadoPor = await this.conferirLimite(u, conta.total, desconto, acrescimo, dto);
    const total = conta.total - desconto + acrescimo;

    // pagamentos: com o que já foi pago na entrada, precisam somar exatamente o total
    const pags = this.lerPagamentos(dto.pagamentos ?? []);
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
    await this.ds.transaction(async (m) => {
      for (const p of pags) {
        await m.insert(EstadiaPagamento, {
          empresaId: u.empresaId, estadiaId: e.id, forma: p.forma, valor: reais(p.valor),
          valorRecebido: p.recebido !== null ? reais(p.recebido) : null, troco: reais(p.troco),
          trocoDestino: p.trocoDestino, gorjetaPara: p.gorjetaPara, usuarioId: u.sub, usuarioNome: u.nome, momento: 'fechamento',
        });
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
      const resumoPag = pags.length
        ? pags.map((p) => `${NOMES_FORMA[p.forma] ?? p.forma} ${brl(p.valor)}${p.troco ? ` (${p.trocoDestino === 'gorjeta' ? `gorjeta ${brl(p.troco)} p/ ${p.gorjetaPara}` : `troco ${brl(p.troco)}`})` : ''}`).join(' + ')
        : 'cortesia';
      await this.registrar(m, u, id, 'fechamento',
        `Fechada: ${brl(total)} · ${resumoPag}${desconto ? ` · desconto ${brl(desconto)}` : ''}${acrescimo ? ` · acréscimo ${brl(acrescimo)}` : ''}${autorizadoPor ? ` · liberado por ${autorizadoPor}` : ''}`);
      await this.mudarUnidade(m, u, unidade, 'limpeza', `Saída · ${brl(total)}`);
    });
    return this.detalhe(u, id);
  }

  async cancelar(u: UsuarioToken, id: string, dto: CancelarEstadiaDto) {
    const e = await this.buscarAberta(u, id);
    const unidade = await this.unidades.findOneOrFail({ where: { id: e.unidadeId } });
    await this.ds.transaction(async (m) => {
      await m.update(Estadia, { id }, {
        status: 'cancelada', saidaEm: new Date(), motivoAjuste: dto.motivo.trim(), usuarioSaidaId: u.sub, usuarioSaidaNome: u.nome,
      });
      await this.registrar(m, u, id, 'cancelamento', `Entrada cancelada: ${dto.motivo.trim()}`);
      await this.mudarUnidade(m, u, unidade, dto.destino ?? 'livre', `Entrada cancelada: ${dto.motivo.trim()}`);
    });
    return { ok: true };
  }
}
