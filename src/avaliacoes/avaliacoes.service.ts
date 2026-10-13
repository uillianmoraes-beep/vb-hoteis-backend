import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Avaliacao } from './avaliacao.entity';
import { ResponderAvaliacaoDto, SalvarPerguntasDto } from './avaliacoes.dto';
import { Estadia } from '../estadias/estadia.entity';
import { Unidade } from '../unidades/unidade.entity';
import { Empresa } from '../empresas/empresa.entity';
import { moduloAtivo } from '../common/modulos';
import { UsuarioToken } from '../common/permissoes';

const DIA = 86_400_000;
/** o cliente tem até 3 dias depois da saída para avaliar */
const PRAZO_DIAS = 3;
const LEGADO = ['limpeza', 'atendimento', 'conforto', 'consumo'] as const;

export type Pergunta = { id: string; texto: string; ativo: boolean };
/** perguntas iniciais; a empresa muda, desliga ou cria outras */
export const PERGUNTAS_PADRAO: Pergunta[] = [
  { id: 'limpeza', texto: 'Limpeza da suíte', ativo: true },
  { id: 'atendimento', texto: 'Atendimento', ativo: true },
  { id: 'conforto', texto: 'Conforto e conservação', ativo: true },
  { id: 'refeicao', texto: 'A refeição estava boa?', ativo: true },
  { id: 'frigobar', texto: 'Frigobar e bebidas', ativo: true },
];
const perguntasDe = (e: Empresa | null | undefined): Pergunta[] => (e?.pesquisa?.length ? e.pesquisa : PERGUNTAS_PADRAO);

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
    const perguntas = perguntasDe(empresa).filter((p) => p.ativo).map(({ id, texto }) => ({ id, texto }));
    return { empresa: empresa.nome, unidade: unidade?.codigo ?? '', data: e.entradaEm, jaAvaliada: ja, expirada, perguntas };
  }

  async responder(token: string, dto: ResponderAvaliacaoDto) {
    const { e, empresa } = await this.porToken(token);
    const base = e.saidaEm ?? new Date();
    if (Date.now() - base.getTime() > PRAZO_DIAS * DIA) throw new BadRequestException('O prazo para avaliar esta estadia terminou.');
    if (e.status === 'cancelada') throw new BadRequestException('Esta estadia foi cancelada.');
    const validas = new Set(perguntasDe(empresa).filter((p) => p.ativo).map((p) => p.id));
    const respostas: Record<string, number> = {};
    for (const [k, v] of Object.entries(dto.respostas ?? {})) {
      const n = Number(v);
      if (validas.has(k) && Number.isInteger(n) && n >= 1 && n <= 5) respostas[k] = n;
    }
    // compatibilidade com a versão anterior da página
    for (const k of LEGADO) if (typeof dto[k] === 'number' && !respostas[k === 'consumo' ? 'frigobar' : k]) respostas[k === 'consumo' ? 'frigobar' : k] = dto[k] as number;
    const notas = Object.values(respostas);
    if (!notas.length) throw new BadRequestException('Dê pelo menos uma nota.');
    if ((await this.repo.count({ where: { estadiaId: e.id } })) > 0) throw new BadRequestException('Esta estadia já foi avaliada. Obrigado!');
    const geral = notas.reduce((s, n) => s + n, 0) / notas.length;
    await this.repo.insert({
      empresaId: e.empresaId, estadiaId: e.id, unidadeId: e.unidadeId, ambienteId: e.ambienteId,
      limpeza: respostas.limpeza ?? null, atendimento: respostas.atendimento ?? null, conforto: respostas.conforto ?? null, consumo: respostas.frigobar ?? null,
      respostas, geral: geral.toFixed(2), voltaria: dto.voltaria ?? null, comentario: dto.comentario?.trim().slice(0, 1000) || null,
    });
    return { ok: true };
  }

  async perguntas(u: UsuarioToken) {
    const empresa = await this.empresas.findOne({ where: { id: u.empresaId } });
    return perguntasDe(empresa);
  }

  async salvarPerguntas(u: UsuarioToken, dto: SalvarPerguntasDto) {
    const ids = new Set<string>();
    const lista = dto.perguntas.map((p) => {
      const id = p.id.trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 30) || `p${ids.size + 1}`;
      if (ids.has(id)) throw new BadRequestException('Há perguntas repetidas.');
      ids.add(id);
      return { id, texto: p.texto.trim(), ativo: !!p.ativo };
    });
    if (!lista.some((p) => p.ativo)) throw new BadRequestException('Deixe pelo menos uma pergunta ativa.');
    await this.empresas.update({ id: u.empresaId }, { pesquisa: lista });
    return lista;
  }

  async relatorio(u: UsuarioToken, filtro: { de?: string; ate?: string; ambienteId?: string }) {
    const empresa = await this.empresas.findOne({ where: { id: u.empresaId } });
    if (!moduloAtivo(empresa?.modulos, 'satisfacao')) throw new ForbiddenException('Módulo de satisfação não contratado.');
    const ate = filtro.ate ? new Date(`${filtro.ate}T23:59:59.999-03:00`) : new Date();
    const de = filtro.de ? new Date(`${filtro.de}T00:00:00-03:00`) : new Date(ate.getTime() - 30 * DIA);
    if (Number.isNaN(de.getTime()) || Number.isNaN(ate.getTime())) throw new BadRequestException('Período inválido.');

    const qb = this.repo.createQueryBuilder('a')
      .where('a.empresaId = :e', { e: u.empresaId })
      .andWhere('a.criadoEm BETWEEN :de AND :ate', { de, ate });
    if (u.ambientesIds?.length) qb.andWhere('a.ambienteId IN (:...amb)', { amb: u.ambientesIds });
    if (filtro.ambienteId) qb.andWhere('a.ambienteId = :fa', { fa: filtro.ambienteId });
    const lista: Avaliacao[] = await qb.orderBy('a.criadoEm', 'DESC').limit(5000).getMany();

    const usos = lista.length ? await this.estadias.find({ where: { id: In(lista.map((a) => a.estadiaId)) }, select: { id: true, numero: true } }) : [];
    const numUso = new Map(usos.map((x) => [x.id, x.numero]));
    const unidades = lista.length ? await this.unidades.find({ where: { id: In([...new Set(lista.map((a) => a.unidadeId).filter((x): x is string => !!x))]) } }) : [];
    const cod = new Map(unidades.map((x) => [x.id, x.codigo]));
    const media = (vals: (number | null)[]) => {
      const v = vals.filter((n): n is number => typeof n === 'number');
      return v.length ? Math.round((v.reduce((s, n) => s + n, 0) / v.length) * 100) / 100 : null;
    };
    const todas = perguntasDe(empresa);
    // perguntas que aparecem nas respostas, mesmo se a empresa desligou depois
    const usadas = new Set(lista.flatMap((a) => Object.keys(a.respostas ?? {})));
    const perguntas = todas.filter((p) => p.ativo || usadas.has(p.id)).map(({ id, texto }) => ({ id, texto }));
    const nota = (a: Avaliacao, id: string) => (typeof a.respostas?.[id] === 'number' ? a.respostas[id] : null);
    const criterios = perguntas.map((p) => ({ ...p, media: media(lista.map((a) => nota(a, p.id))) }));
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
      perguntas,
      criterios,
      voltaria: respostasVoltaria.length ? Math.round((respostasVoltaria.filter((a) => a.voltaria).length / respostasVoltaria.length) * 100) : null,
      distribuicao,
      unidades: [...porUnidade.entries()]
        .map(([codigo, l]) => ({ codigo, total: l.length, geral: media(l.map((a) => Number(a.geral))), notas: Object.fromEntries(perguntas.map((p) => [p.id, media(l.map((a) => nota(a, p.id)))])) }))
        .sort((a, b) => (a.geral ?? 9) - (b.geral ?? 9)),
      comentarios: lista.filter((a) => a.comentario).slice(0, 200).map((a) => ({
        id: a.id, uso: numUso.get(a.estadiaId) ?? null, data: a.criadoEm, unidade: cod.get(a.unidadeId ?? '') ?? '—', geral: Number(a.geral), voltaria: a.voltaria, comentario: a.comentario,
      })),
    };
  }
}
