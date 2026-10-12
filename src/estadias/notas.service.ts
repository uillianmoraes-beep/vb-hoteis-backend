import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Estadia } from './estadia.entity';
import { EstadiaEvento } from './estadia-evento.entity';
import { Unidade } from '../unidades/unidade.entity';
import { UsuarioToken } from '../common/permissoes';
import { DesfazerNotaDto, MarcarNotasDto } from './estadias.dto';
import { Empresa } from '../empresas/empresa.entity';
import { limparFiscal } from '../common/fiscal';
import { moduloAtivo } from '../common/modulos';

const DIA = 86_400_000;

/** Relatórios de notas: para emitir / emitidas, e marcação de emissão. */
@Injectable()
export class NotasService {
  constructor(
    @InjectRepository(Estadia) private readonly repo: Repository<Estadia>,
    @InjectRepository(EstadiaEvento) private readonly eventos: Repository<EstadiaEvento>,
    @InjectRepository(Unidade) private readonly unidades: Repository<Unidade>,
    @InjectRepository(Empresa) private readonly empresas: Repository<Empresa>,
  ) {}

  /** Tributação do serviço de hospedagem (vale para todas as contas). */
  async config(u: UsuarioToken) {
    const e = await this.empresas.findOne({ where: { id: u.empresaId } });
    return { ativo: moduloAtivo(e?.modulos, 'notas'), hospedagem: e?.fiscal?.hospedagem ?? {} };
  }

  /** O módulo precisa estar contratado. */
  private async exigirModulo(u: UsuarioToken) {
    const e = await this.empresas.findOne({ where: { id: u.empresaId } });
    if (!moduloAtivo(e?.modulos, 'notas')) throw new ForbiddenException('Módulo de notas fiscais não contratado.');
  }

  async salvarConfig(u: UsuarioToken, corpo: { hospedagem?: unknown }) {
    await this.exigirModulo(u);
    const fiscal = { hospedagem: limparFiscal(corpo?.hospedagem) };
    await this.empresas.update({ id: u.empresaId }, { fiscal });
    return fiscal;
  }

  async listar(u: UsuarioToken, filtro: { status?: string; de?: string; ate?: string; ambienteId?: string }) {
    await this.exigirModulo(u);
    const status = filtro.status === 'emitida' ? 'emitida' : 'pendente';
    const ate = filtro.ate ? new Date(`${filtro.ate}T23:59:59.999-03:00`) : new Date();
    const de = filtro.de ? new Date(`${filtro.de}T00:00:00-03:00`) : new Date(ate.getTime() - 30 * DIA);
    if (Number.isNaN(de.getTime()) || Number.isNaN(ate.getTime())) throw new BadRequestException('Período inválido.');
    if (ate.getTime() - de.getTime() > 400 * DIA) throw new BadRequestException('Escolha um período de até 1 ano.');

    const qb = this.repo
      .createQueryBuilder('e')
      .where('e.empresaId = :emp', { emp: u.empresaId })
      .andWhere('e.status = :st', { st: 'fechada' })
      .andWhere('e.notaStatus = :ns', { ns: status })
      .andWhere('e.saidaEm BETWEEN :de AND :ate', { de, ate });
    if (u.ambientesIds?.length) qb.andWhere('e.ambienteId IN (:...amb)', { amb: u.ambientesIds });
    if (filtro.ambienteId) qb.andWhere('e.ambienteId = :a', { a: filtro.ambienteId });
    const lista: Estadia[] = await qb.orderBy('e.saidaEm', 'DESC').limit(2000).getMany();

    const unidades = lista.length ? await this.unidades.find({ where: { id: In([...new Set(lista.map((e) => e.unidadeId))]) } }) : [];
    const cod = new Map(unidades.map((x) => [x.id, x.codigo]));
    const n = (v: string | null | undefined) => Number(v ?? 0);
    const itens = lista.map((e) => ({
      id: e.id,
      numero: e.numero,
      codigo: cod.get(e.unidadeId) ?? '—',
      entradaEm: e.entradaEm,
      saidaEm: e.saidaEm,
      placa: e.placa,
      hospedagem: n(e.valorHospedagem) + n(e.valorPessoas),
      consumo: n(e.valorConsumo),
      desconto: n(e.desconto),
      acrescimo: n(e.acrescimo),
      total: n(e.valorTotal),
      formaPagamento: e.formaPagamento,
      usuario: e.usuarioSaidaNome,
      notaNumero: e.notaNumero,
      notaEmitidaEm: e.notaEmitidaEm,
      notaEmitidaPor: e.notaEmitidaPor,
      documento: e.notaDocumento,
    }));
    const soma = (k: 'hospedagem' | 'consumo' | 'total') => Math.round(itens.reduce((s, i) => s + i[k], 0) * 100) / 100;
    return { status, de, ate, itens, totais: { quantidade: itens.length, hospedagem: soma('hospedagem'), consumo: soma('consumo'), total: soma('total') } };
  }

  async marcarEmitidas(u: UsuarioToken, dto: MarcarNotasDto) {
    await this.exigirModulo(u);
    if (!dto.ids.length) throw new BadRequestException('Escolha pelo menos uma conta.');
    const contas = await this.repo.find({ where: { id: In(dto.ids), empresaId: u.empresaId } });
    const validas = contas.filter((e) => e.status === 'fechada' && e.notaStatus === 'pendente' && (!u.ambientesIds?.length || u.ambientesIds.includes(e.ambienteId)));
    if (!validas.length) throw new BadRequestException('Nenhuma dessas contas está aguardando nota.');
    const numero = dto.numero?.trim() || null;
    if (numero && validas.length > 1) throw new BadRequestException('Número da nota só para uma conta por vez.');
    const agora = new Date();
    await this.repo.update({ id: In(validas.map((e) => e.id)) }, { notaStatus: 'emitida', notaNumero: numero, notaEmitidaEm: agora, notaEmitidaPor: u.nome });
    await this.eventos.insert(validas.map((e) => ({
      empresaId: u.empresaId, estadiaId: e.id, tipo: 'nota', usuarioId: u.sub, usuarioNome: u.nome,
      descricao: `Nota fiscal emitida${numero ? ` nº ${numero}` : ''}`,
    })));
    return { marcadas: validas.length };
  }

  async desfazer(u: UsuarioToken, id: string, dto: DesfazerNotaDto) {
    const e = await this.repo.findOne({ where: { id, empresaId: u.empresaId } });
    if (!e) throw new NotFoundException('Conta não encontrada.');
    if (e.notaStatus !== 'emitida') throw new BadRequestException('Esta conta não está com nota emitida.');
    await this.repo.update({ id }, { notaStatus: 'pendente', notaNumero: null, notaEmitidaEm: null, notaEmitidaPor: null });
    await this.eventos.insert({
      empresaId: u.empresaId, estadiaId: id, tipo: 'nota', usuarioId: u.sub, usuarioNome: u.nome,
      descricao: `Emissão da nota desfeita${e.notaNumero ? ` (era nº ${e.notaNumero})` : ''} · ${dto.motivo.trim()}`,
    });
    return { ok: true };
  }
}
