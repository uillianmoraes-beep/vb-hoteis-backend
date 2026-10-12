import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Avaliacao } from './avaliacao.entity';
import { ResponderAvaliacaoDto } from './avaliacoes.dto';
import { Estadia } from '../estadias/estadia.entity';
import { Unidade } from '../unidades/unidade.entity';
import { Empresa } from '../empresas/empresa.entity';
import { moduloAtivo } from '../common/modulos';
import { UsuarioToken } from '../common/permissoes';

const DIA = 86_400_000;
/** o cliente tem até 3 dias depois da saída para avaliar */
const PRAZO_DIAS = 3;
const CRITERIOS = ['limpeza', 'atendimento', 'conforto', 'consumo'] as const;

@Injectable()
export class AvaliacoesService {
  constructor(
    @InjectRepository(Avaliacao) private readonly repo: Repository<Avaliacao>,
    @InjectRepository(Estadia) private readonly estadias: Repository<Estadia>,
    @InjectRepository(Unidade) private readonly unidades: Repository<Unidade>,
    @InjectRepository(Empresa) private readonly empresas: Repository<Empresa>,
  ) {}

  private async porToken(token: string) {
    if (!/^[A-Za-z0-9_-]{8,16}$/.test(token)) throw new NotFoundException('Avaliação não encontrada.');
    const e = await this.estadias.findOne({ where: { avaliacaoToken: token } });
    if (!e) throw new NotFoundException('Avaliação não encontrada.');
    const empresa = await this.empresas.findOne({ where: { id: e.empresaId } });
    if (!moduloAtivo(empresa?.modulos, 'satisfacao')) throw new NotFoundException('Avaliação não disponível.');
    return { e, empresa: empresa! };
  }

  /** Dados mínimos para a página pública (sem placa, valores ou nomes). */
  async publico(token: string) {
    const { e, empresa } = await this.porToken(token);
    const unidade = await this.unidades.findOne({ where: { id: e.unidadeId } });
    const ja = (await this.repo.count({ where: { estadiaId: e.id } })) > 0;
    const base = e.saidaEm ?? new Date();
    const expirada = Date.now() - base.getTime() > PRAZO_DIAS * DIA;
    return { empresa: empresa.nome, unidade: unidade?.codigo ?? '', data: e.entradaEm, jaAvaliada: ja, expirada };
  }

  async responder(token: string, dto: ResponderAvaliacaoDto) {
    const { e } = await this.porToken(token);
    const base = e.saidaEm ?? new Date();
    if (Date.now() - base.getTime() > PRAZO_DIAS * DIA) throw new BadRequestException('O prazo para avaliar esta estadia terminou.');
    if (e.status === 'cancelada') throw new BadRequestException('Esta estadia foi cancelada.');
    const notas = CRITERIOS.map((c) => dto[c]).filter((n): n is number => typeof n === 'number');
    if (!notas.length) throw new BadRequestException('Dê pelo menos uma nota.');
    if ((await this.repo.count({ where: { estadiaId: e.id } })) > 0) throw new BadRequestException('Esta estadia já foi avaliada. Obrigado!');
    const geral = notas.reduce((s, n) => s + n, 0) / notas.length;
    await this.repo.insert({
      empresaId: e.empresaId, estadiaId: e.id, unidadeId: e.unidadeId, ambienteId: e.ambienteId,
      limpeza: dto.limpeza ?? null, atendimento: dto.atendimento ?? null, conforto: dto.conforto ?? null, consumo: dto.consumo ?? null,
      geral: geral.toFixed(2), voltaria: dto.voltaria ?? null, comentario: dto.comentario?.trim().slice(0, 1000) || null,
    });
    return { ok: true };
  }

  async relatorio(u: UsuarioToken, filtro: { de?: string; ate?: string }) {
    const empresa = await this.empresas.findOne({ where: { id: u.empresaId } });
    if (!moduloAtivo(empresa?.modulos, 'satisfacao')) throw new ForbiddenException('Módulo de satisfação não contratado.');
    const ate = filtro.ate ? new Date(`${filtro.ate}T23:59:59.999-03:00`) : new Date();
    const de = filtro.de ? new Date(`${filtro.de}T00:00:00-03:00`) : new Date(ate.getTime() - 30 * DIA);
    if (Number.isNaN(de.getTime()) || Number.isNaN(ate.getTime())) throw new BadRequestException('Período inválido.');

    const qb = this.repo.createQueryBuilder('a')
      .where('a.empresaId = :e', { e: u.empresaId })
      .andWhere('a.criadoEm BETWEEN :de AND :ate', { de, ate });
    if (u.ambientesIds?.length) qb.andWhere('a.ambienteId IN (:...amb)', { amb: u.ambientesIds });
    const lista: Avaliacao[] = await qb.orderBy('a.criadoEm', 'DESC').limit(5000).getMany();

    const usos = lista.length ? await this.estadias.find({ where: { id: In(lista.map((a) => a.estadiaId)) }, select: { id: true, numero: true } }) : [];
    const numUso = new Map(usos.map((x) => [x.id, x.numero]));
    const unidades = lista.length ? await this.unidades.find({ where: { id: In([...new Set(lista.map((a) => a.unidadeId).filter((x): x is string => !!x))]) } }) : [];
    const cod = new Map(unidades.map((x) => [x.id, x.codigo]));
    const media = (vals: (number | null)[]) => {
      const v = vals.filter((n): n is number => typeof n === 'number');
      return v.length ? Math.round((v.reduce((s, n) => s + n, 0) / v.length) * 100) / 100 : null;
    };
    const criterios = Object.fromEntries(CRITERIOS.map((c) => [c, media(lista.map((a) => a[c]))]));
    const respostasVoltaria = lista.filter((a) => a.voltaria !== null);
    const porUnidade = new Map<string, Avaliacao[]>();
    for (const a of lista) {
      const k = cod.get(a.unidadeId ?? '') ?? '—';
      porUnidade.set(k, [...(porUnidade.get(k) ?? []), a]);
    }
    const distribuicao = [1, 2, 3, 4, 5].map((n) => lista.filter((a) => Math.round(Number(a.geral)) === n).length);

    return {
      de, ate,
      total: lista.length,
      geral: media(lista.map((a) => Number(a.geral))),
      criterios,
      voltaria: respostasVoltaria.length ? Math.round((respostasVoltaria.filter((a) => a.voltaria).length / respostasVoltaria.length) * 100) : null,
      distribuicao,
      unidades: [...porUnidade.entries()]
        .map(([codigo, l]) => ({ codigo, total: l.length, geral: media(l.map((a) => Number(a.geral))), ...Object.fromEntries(CRITERIOS.map((c) => [c, media(l.map((a) => a[c]))])) }))
        .sort((a, b) => (a.geral ?? 9) - (b.geral ?? 9)),
      comentarios: lista.filter((a) => a.comentario).slice(0, 200).map((a) => ({
        id: a.id, uso: numUso.get(a.estadiaId) ?? null, data: a.criadoEm, unidade: cod.get(a.unidadeId ?? '') ?? '—', geral: Number(a.geral), voltaria: a.voltaria, comentario: a.comentario,
      })),
    };
  }
}
