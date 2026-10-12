import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { Estadia } from './estadia.entity';
import { Unidade } from '../unidades/unidade.entity';
import { UnidadeEvento } from '../unidades/unidade-evento.entity';
import { UsuarioEntity } from '../usuarios/usuario.entity';
import { Perfil } from '../perfis/perfil.entity';
import { FUSO, Motor, TarifasService } from '../tarifas/tarifas.service';
import { AbrirEstadiaDto, AtualizarEstadiaDto, CancelarEstadiaDto, FecharEstadiaDto } from './estadias.dto';
import { StatusUnidade, UsuarioToken, temPermissao } from '../common/permissoes';
import { calcularConta, centavos, minutosAteHorario, reais, ResultadoCalc } from './calculadora';

export interface ContaCalculada extends ResultadoCalc {
  minutosUso: number;
  tabelaNome: string | null;
  parado: boolean;
}

@Injectable()
export class EstadiasService {
  constructor(
    @InjectRepository(Estadia) private readonly repo: Repository<Estadia>,
    @InjectRepository(Unidade) private readonly unidades: Repository<Unidade>,
    @InjectRepository(UsuarioEntity) private readonly usuarios: Repository<UsuarioEntity>,
    @InjectRepository(Perfil) private readonly perfis: Repository<Perfil>,
    private readonly tarifas: TarifasService,
    private readonly ds: DataSource,
  ) {}

  /* ---------------- cálculo ---------------- */

  calcular(e: Estadia, motor: Motor, agora = new Date()): ContaCalculada {
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
    });
    const tabela = motor.tabelas.find((t) => t.id === e.tabelaId);
    return { ...r, minutosUso, tabelaNome: tabela?.nome ?? null, parado: e.status === 'conta_entregue' };
  }

  /** Contas abertas de várias unidades de uma vez (para o painel). */
  async abertasComConta(empresaId: string, unidadeIds: string[]) {
    if (!unidadeIds.length) return new Map<string, { estadia: Estadia; conta: ContaCalculada; motor: Motor }>();
    const abertas = await this.repo.find({ where: { empresaId, unidadeId: In(unidadeIds), status: In(['aberta', 'conta_entregue']) } });
    const motores = new Map<string, Motor>();
    const resultado = new Map<string, { estadia: Estadia; conta: ContaCalculada; motor: Motor }>();
    const agora = new Date();
    for (const e of abertas) {
      if (!motores.has(e.ambienteId)) motores.set(e.ambienteId, await this.tarifas.motor(empresaId, e.ambienteId));
      const motor = motores.get(e.ambienteId)!;
      resultado.set(e.unidadeId, { estadia: e, conta: this.calcular(e, motor, agora), motor });
    }
    return resultado;
  }

  /* ---------------- apoio ---------------- */

  private podeVer(u: UsuarioToken, ambienteId: string) {
    return !u.ambientesIds || u.ambientesIds.length === 0 || u.ambientesIds.includes(ambienteId);
  }

  private async buscar(u: UsuarioToken, id: string) {
    const e = await this.repo.findOne({ where: { id, empresaId: u.empresaId } });
    if (!e) throw new NotFoundException('Entrada não encontrada.');
    if (!this.podeVer(u, e.ambienteId)) throw new ForbiddenException('Entrada de outro ambiente.');
    return e;
  }

  private async mudarUnidade(m: EntityManager, u: UsuarioToken, unidade: Unidade, novo: StatusUnidade, obs?: string) {
    await m.update(Unidade, { id: unidade.id }, { status: novo, statusDesde: new Date(), motivoBloqueioId: null, observacaoStatus: null });
    await m.insert(UnidadeEvento, {
      empresaId: u.empresaId, unidadeId: unidade.id, statusAnterior: unidade.status, statusNovo: novo,
      motivoBloqueioId: null, observacao: obs ?? null, usuarioId: u.sub, usuarioNome: u.nome,
    });
  }

  private resumo(e: Estadia, conta: ContaCalculada) {
    return {
      ...e,
      conta: {
        ...conta,
        valorHospedagem: conta.valorHospedagem / 100,
        valorPessoas: conta.valorPessoas / 100,
        total: conta.total / 100,
      },
    };
  }

  /* ---------------- operações ---------------- */

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

    const salva = await this.ds.transaction(async (m) => {
      const e = await m.save(
        m.create(Estadia, {
          empresaId: u.empresaId,
          ambienteId: unidade.ambienteId,
          unidadeId: unidade.id,
          categoriaId: unidade.categoriaId,
          tabelaId: tabela.id,
          modalidade,
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
      return e;
    });
    return this.resumo(salva, this.calcular(salva, motor));
  }

  async detalhe(u: UsuarioToken, id: string) {
    const e = await this.buscar(u, id);
    const motor = await this.tarifas.motor(u.empresaId, e.ambienteId);
    return this.resumo(e, this.calcular(e, motor));
  }

  async atualizar(u: UsuarioToken, id: string, dto: AtualizarEstadiaDto) {
    const e = await this.buscar(u, id);
    if (!['aberta', 'conta_entregue'].includes(e.status)) throw new BadRequestException('Esta entrada já foi encerrada.');
    await this.repo.update(
      { id },
      {
        ...(dto.placa !== undefined && { placa: dto.placa.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || null }),
        ...(dto.pessoas !== undefined && { pessoas: dto.pessoas }),
        ...(dto.observacao !== undefined && { observacao: dto.observacao || null }),
      },
    );
    return this.detalhe(u, id);
  }

  async entregarConta(u: UsuarioToken, id: string) {
    const e = await this.buscar(u, id);
    if (e.status !== 'aberta') throw new BadRequestException('A conta só pode ser entregue com a entrada aberta.');
    const unidade = await this.unidades.findOneOrFail({ where: { id: e.unidadeId } });
    await this.ds.transaction(async (m) => {
      await m.update(Estadia, { id }, { status: 'conta_entregue', contaEntregueEm: new Date() });
      await this.mudarUnidade(m, u, unidade, 'conta_entregue', 'Conta entregue');
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
    const e = await this.buscar(u, id);
    if (!['aberta', 'conta_entregue'].includes(e.status)) throw new BadRequestException('Esta entrada já foi encerrada.');
    const motor = await this.tarifas.motor(u.empresaId, e.ambienteId);
    const conta = this.calcular(e, motor);
    const desconto = centavos(dto.desconto ?? 0);
    const acrescimo = centavos(dto.acrescimo ?? 0);
    if (desconto > conta.total + acrescimo) throw new BadRequestException('O desconto é maior que a conta.');
    if ((desconto > 0 || acrescimo > 0) && !dto.motivo?.trim()) throw new BadRequestException('Informe o motivo do desconto ou acréscimo.');
    const autorizadoPor = await this.conferirLimite(u, conta.total, desconto, acrescimo, dto);
    const total = conta.total - desconto + acrescimo;
    const forma = total === 0 && desconto > 0 ? 'cortesia' : dto.formaPagamento;

    const unidade = await this.unidades.findOneOrFail({ where: { id: e.unidadeId } });
    await this.ds.transaction(async (m) => {
      await m.update(Estadia, { id }, {
        status: 'fechada',
        saidaEm: new Date(),
        periodoNome: conta.periodoNome,
        valorHospedagem: reais(conta.valorHospedagem),
        valorPessoas: reais(conta.valorPessoas),
        desconto: reais(desconto),
        acrescimo: reais(acrescimo),
        valorTotal: reais(total),
        formaPagamento: forma,
        motivoAjuste: dto.motivo?.trim() || null,
        autorizadoPor,
        usuarioSaidaId: u.sub,
        usuarioSaidaNome: u.nome,
      });
      await this.mudarUnidade(m, u, unidade, 'limpeza', `Saída · R$ ${reais(total).replace('.', ',')}`);
    });
    return this.detalhe(u, id);
  }

  async cancelar(u: UsuarioToken, id: string, dto: CancelarEstadiaDto) {
    const e = await this.buscar(u, id);
    if (!['aberta', 'conta_entregue'].includes(e.status)) throw new BadRequestException('Esta entrada já foi encerrada.');
    const unidade = await this.unidades.findOneOrFail({ where: { id: e.unidadeId } });
    await this.ds.transaction(async (m) => {
      await m.update(Estadia, { id }, {
        status: 'cancelada', saidaEm: new Date(), motivoAjuste: dto.motivo.trim(), usuarioSaidaId: u.sub, usuarioSaidaNome: u.nome,
      });
      await this.mudarUnidade(m, u, unidade, dto.destino ?? 'livre', `Entrada cancelada: ${dto.motivo.trim()}`);
    });
    return { ok: true };
  }

  async temAberta(unidadeId: string) {
    return this.repo.exists({ where: { unidadeId, status: In(['aberta', 'conta_entregue']) } });
  }
}
