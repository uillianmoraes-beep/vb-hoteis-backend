import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Estadia } from '../estadias/estadia.entity';
import { EstadiaPagamento } from '../estadias/estadia-pagamento.entity';
import { Unidade } from '../unidades/unidade.entity';
import { Ambiente } from '../ambientes/ambiente.entity';
import { Categoria } from '../categorias/categoria.entity';
import { UsuarioToken } from '../common/permissoes';

const DIA = 86_400_000;
const c = (v: number | string | null | undefined) => Math.round(Number(v ?? 0) * 100);
const r = (cent: number) => Math.round(cent) / 100;

@Injectable()
export class RelatoriosService {
  constructor(
    @InjectRepository(Estadia) private readonly estadias: Repository<Estadia>,
    @InjectRepository(EstadiaPagamento) private readonly pagamentos: Repository<EstadiaPagamento>,
    @InjectRepository(Unidade) private readonly unidades: Repository<Unidade>,
    @InjectRepository(Ambiente) private readonly ambientes: Repository<Ambiente>,
    @InjectRepository(Categoria) private readonly categorias: Repository<Categoria>,
  ) {}

  async vendas(u: UsuarioToken, filtro: { de?: string; ate?: string; ambienteId?: string }) {
    const ate = filtro.ate ? new Date(`${filtro.ate}T23:59:59.999-03:00`) : new Date();
    const de = filtro.de ? new Date(`${filtro.de}T00:00:00-03:00`) : new Date(ate.getTime() - 7 * DIA);
    const qb = this.estadias.createQueryBuilder('e').where('e.empresaId = :emp', { emp: u.empresaId })
      .andWhere(`e.status = 'fechada'`).andWhere('e.saidaEm BETWEEN :de AND :ate', { de, ate });
    if (u.ambientesIds?.length) qb.andWhere('e.ambienteId IN (:...amb)', { amb: u.ambientesIds });
    if (filtro.ambienteId) qb.andWhere('e.ambienteId = :a', { a: filtro.ambienteId });
    const ests: Estadia[] = await qb.orderBy('e.saidaEm', 'DESC').limit(5000).getMany();
    const ids = ests.map((e) => e.id);
    const pags = ids.length ? await this.pagamentos.find({ where: { estadiaId: In(ids) } }) : [];
    const unis = ests.length ? await this.unidades.find({ where: { id: In([...new Set(ests.map((e) => e.unidadeId))]) } }) : [];
    const cats = await this.categorias.find({ where: { empresaId: u.empresaId } });
    const ambs = await this.ambientes.find({ where: { empresaId: u.empresaId } });
    const mapU = new Map(unis.map((x) => [x.id, x]));
    const mapC = new Map(cats.map((x) => [x.id, x.nome]));
    const mapA = new Map(ambs.map((x) => [x.id, x.nome]));

    const porForma: Record<string, number> = {};
    const formasDe = new Map<string, string[]>();
    for (const p of pags) {
      porForma[p.forma] = (porForma[p.forma] ?? 0) + c(p.valor);
      formasDe.set(p.estadiaId, [...(formasDe.get(p.estadiaId) ?? []), p.forma]);
    }
    const porCategoria = new Map<string, { nome: string; usos: number; total: number }>();
    let hosp = 0, cons = 0, desc = 0, acr = 0, total = 0, minutos = 0;
    for (const e of ests) {
      hosp += c(e.valorHospedagem) + c(e.valorPessoas);
      cons += c(e.valorConsumo);
      desc += c(e.desconto);
      acr += c(e.acrescimo);
      total += c(e.valorTotal);
      if (e.saidaEm) minutos += Math.max(0, (e.saidaEm.getTime() - e.entradaEm.getTime()) / 60000);
      const catId = e.categoriaId ?? mapU.get(e.unidadeId)?.categoriaId ?? null;
      const nome = (catId && mapC.get(catId)) || 'Sem categoria';
      const a = porCategoria.get(nome) ?? { nome, usos: 0, total: 0 };
      a.usos += 1; a.total += c(e.valorTotal);
      porCategoria.set(nome, a);
    }
    return {
      totais: {
        contas: ests.length, total: r(total), hospedagem: r(hosp), consumo: r(cons), descontos: r(desc), acrescimos: r(acr),
        ticketMedio: ests.length ? r(total / ests.length) : 0, permanenciaMediaMin: ests.length ? Math.round(minutos / ests.length) : 0,
      },
      porForma: Object.fromEntries(Object.entries(porForma).map(([k, v]) => [k, r(v)])),
      porCategoria: [...porCategoria.values()].map((x) => ({ ...x, total: r(x.total) })).sort((a, b) => b.total - a.total),
      lista: ests.map((e) => ({
        id: e.id, uso: e.numero, unidade: mapU.get(e.unidadeId)?.codigo ?? '—', ambiente: mapA.get(e.ambienteId) ?? '',
        entradaEm: e.entradaEm, saidaEm: e.saidaEm, periodo: e.periodoNome, placa: e.placa,
        hospedagem: r(c(e.valorHospedagem) + c(e.valorPessoas)), consumo: r(c(e.valorConsumo)), desconto: Number(e.desconto), total: Number(e.valorTotal ?? 0),
        formas: [...new Set(formasDe.get(e.id) ?? [])], fechadoPor: e.usuarioSaidaNome,
      })),
    };
  }
}
