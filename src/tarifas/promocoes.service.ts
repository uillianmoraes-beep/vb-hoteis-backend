import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UsuarioToken } from '../common/permissoes';
import { dentroDaFaixa, partesLocais } from '../estadias/calculadora';
import { AplicarPromocaoDto } from './tarifas.dto';
import { FUSO, Motor, TarifasService } from './tarifas.service';

const DIA = 86_400_000;
const NOMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const hojeLocal = () => new Date().toLocaleDateString('sv-SE', { timeZone: FUSO });
/** arredonda para o múltiplo de 5 mais próximo (preço de vitrine) */
const redondo = (v: number) => Math.max(0, Math.round(v / 5) * 5);
const r2 = (v: number) => Math.round(v * 100) / 100;
const hh = (h: number) => `${String(h % 24).padStart(2, '0')}:00`;

export type Nivel = 'fraco' | 'baixo' | 'normal' | 'forte';
/** desconto sugerido por nível do dia (fração) */
const DESCONTO: Record<Nivel, number> = { fraco: 0.2, baixo: 0.1, normal: 0, forte: 0 };
const nivelDe = (indice: number): Nivel => (indice < 0.6 ? 'fraco' : indice < 0.85 ? 'baixo' : indice < 1.15 ? 'normal' : 'forte');

interface PromoLinha {
  id: string; ambiente_id: string; nome: string; dias_semana: number[]; hora_inicio: string | null; hora_fim: string | null;
  data_inicio: string; data_fim: string; tabela_id: string | null; diarias: Record<string, number> | null;
  brinde_produto_id: string | null; brinde_quantidade: string; ativo: boolean; criado_por: string | null; criado_em: Date;
}

/**
 * Tarifas inteligentes: acha os dias e horários fracos pelo movimento passado e sugere preço
 * promocional ou brinde; a gerência ajusta e aplica. Nada muda sem alguém aplicar.
 */
@Injectable()
export class PromocoesService {
  constructor(private readonly ds: DataSource, private readonly tarifas: TarifasService) {}

  private async ambiente(u: UsuarioToken, ambienteId: string) {
    const [a] = await this.ds.query(`SELECT id, nome, tipo, diarias FROM ambientes WHERE id = $1 AND empresa_id = $2`, [ambienteId, u.empresaId]);
    if (!a) throw new NotFoundException('Ambiente não encontrado.');
    if (u.ambientesIds?.length && !u.ambientesIds.includes(a.id)) throw new ForbiddenException('Ambiente não liberado para você.');
    return a as { id: string; nome: string; tipo: string; diarias: Record<string, { diaria: number; fimSemana?: number | null }> | null };
  }

  /** tabela comum (sem data especial) que vale naquele dia da semana: a base para a promoção */
  private tabelaBase(motor: Motor, dia: number) {
    const comuns = motor.tabelas.filter((t) => !t.dataInicio);
    return comuns.find((t) => t.diasSemana.includes(dia)) ?? comuns[0] ?? null;
  }

  /** custo de um produto: custo médio do estoque (ponderado) ou o custo digitado no cadastro */
  async custoProduto(empresaId: string, produtoId: string): Promise<number | null> {
    const [p] = await this.ds.query(
      `SELECT p.custo,
              (SELECT SUM(s.quantidade * s.custo_medio) / NULLIF(SUM(s.quantidade), 0) FROM estoque_saldos s WHERE s.produto_id = p.id AND s.quantidade > 0) AS medio,
              (SELECT MAX(s.custo_medio) FROM estoque_saldos s WHERE s.produto_id = p.id) AS ultimo
         FROM produtos p WHERE p.id = $1 AND p.empresa_id = $2`, [produtoId, empresaId]);
    if (!p) return null;
    const v = Number(p.medio ?? 0) || Number(p.ultimo ?? 0) || Number(p.custo ?? 0);
    return v > 0 ? r2(v) : null;
  }

  async analise(u: UsuarioToken, ambienteId: string, diasPeriodo = 90) {
    const a = await this.ambiente(u, ambienteId);
    const dias = Math.min(365, Math.max(28, diasPeriodo));
    const hoje = hojeLocal();
    const ini = new Date(new Date(`${hoje}T00:00:00-03:00`).getTime() - (dias - 1) * DIA);
    const mov: { dow: number; hora: number; n: number; receita: string }[] = await this.ds.query(
      `SELECT EXTRACT(DOW FROM e.entrada_em AT TIME ZONE '${FUSO}')::int AS dow, EXTRACT(HOUR FROM e.entrada_em AT TIME ZONE '${FUSO}')::int AS hora,
              count(*)::int AS n, COALESCE(sum(e.valor_total) FILTER (WHERE e.status = 'fechada'), 0) AS receita
         FROM estadias e WHERE e.empresa_id = $1 AND e.ambiente_id = $2 AND e.status <> 'cancelada' AND e.entrada_em >= $3 GROUP BY 1, 2`,
      [u.empresaId, ambienteId, ini]);
    // quantas vezes cada dia da semana caiu no período
    const vezes = Array(7).fill(0);
    for (let i = 0; i < dias; i++) vezes[new Date(ini.getTime() + i * DIA + 15 * 3600_000).getUTCDay()] += 1;
    const total = mov.reduce((s, m) => s + Number(m.n), 0);
    const mediaGeral = total / dias;
    const hotel = a.tipo !== 'motel';

    const motor = hotel ? null : await this.tarifas.motor(u.empresaId, ambienteId);
    const cats: { id: string; nome: string }[] = await this.ds.query(
      `SELECT DISTINCT c.id, c.nome, c.ordem FROM categorias c JOIN unidades un ON un.categoria_id = c.id
        WHERE un.ambiente_id = $1 AND un.ativo AND c.ativo ORDER BY c.ordem, c.nome`, [ambienteId]);

    const diasSemana = NOMES.map((nome, d) => {
      const doDia = mov.filter((m) => m.dow === d);
      const entradas = doDia.reduce((s, m) => s + Number(m.n), 0);
      const receita = doDia.reduce((s, m) => s + Number(m.receita), 0);
      const media = vezes[d] ? entradas / vezes[d] : 0;
      const indice = mediaGeral > 0 ? media / mediaGeral : 1;
      const nivel: Nivel = total ? nivelDe(indice) : 'normal';
      const desconto = DESCONTO[nivel];
      // janela de 4 horas mais fraca entre 8h e 20h (para promoção de horário no motel)
      let janela: { inicio: string; fim: string; entradas: number } | null = null;
      if (!hotel && total) {
        const porHora = Array.from({ length: 24 }, (_, h) => Number(doDia.find((m) => m.hora === h)?.n ?? 0));
        let melhor = Infinity;
        for (let h = 8; h <= 16; h++) {
          const soma = porHora[h] + porHora[h + 1] + porHora[h + 2] + porHora[h + 3];
          if (soma < melhor) { melhor = soma; janela = { inicio: hh(h), fim: hh(h + 4), entradas: soma }; }
        }
      }
      // preços: real × sugerido
      const precos: { categoriaId: string; categoria: string; periodoId: string | null; periodo: string; real: number; sugerido: number }[] = [];
      if (hotel) {
        const cfg = a.diarias ?? {};
        for (const c of cats) {
          const x = cfg[c.id];
          if (!x || !(x.diaria > 0)) continue;
          const real = (d === 5 || d === 6) && x.fimSemana ? x.fimSemana : x.diaria;
          precos.push({ categoriaId: c.id, categoria: c.nome, periodoId: null, periodo: 'Diária', real, sugerido: desconto ? redondo(real * (1 - desconto)) : real });
        }
      } else if (motor) {
        const base = this.tabelaBase(motor, d);
        for (const c of cats) {
          const pc = this.tarifas.precosDe(motor, base?.id ?? null, c.id);
          for (const p of this.tarifas.periodosDe(motor, pc, c.id)) {
            const real = (pc.porPeriodo[p.id] ?? 0) / 100;
            if (!(real > 0)) continue;
            precos.push({ categoriaId: c.id, categoria: c.nome, periodoId: p.id, periodo: p.nome, real, sugerido: desconto ? redondo(real * (1 - desconto)) : real });
          }
        }
      }
      const ideias: string[] = [];
      if (nivel === 'fraco' || nivel === 'baixo') {
        const pct = Math.round(desconto * 100);
        if (hotel) {
          ideias.push(`Diária ${pct}% menor em ${nome.toLowerCase()} para atrair quem viaja a trabalho.`);
          ideias.push('Mesmo preço com café da manhã e almoço inclusos: o cliente sente que ganhou mais e a diária não cai.');
          ideias.push(`Pacote "chegue ${nome.toLowerCase()}, fique 2 noites" com a segunda noite mais barata.`);
        } else {
          ideias.push(`Períodos ${pct}% mais baratos em ${nome.toLowerCase()}${janela ? `, ou só das ${janela.inicio} às ${janela.fim} (o horário mais fraco)` : ''}.`);
          ideias.push('Mesmo preço com brinde (combo, pizza ou espumante): a tarifa não cai e o cliente volta.');
          ideias.push('Tempo maior pelo mesmo preço (ex.: 6 horas pelo preço de 4).');
        }
      }
      return {
        dia: d, nome, entradas, receita: r2(receita), mediaEntradas: Math.round(media * 10) / 10,
        indice: Math.round(indice * 100) / 100, nivel, descontoSugerido: Math.round(desconto * 100), janela, precos, ideias,
      };
    });
    return {
      ambiente: { id: a.id, nome: a.nome, tipo: a.tipo, hotel }, dias, totalEntradas: total,
      mediaPorDia: Math.round(mediaGeral * 10) / 10, diasSemana, promocoes: await this.listar(u, ambienteId),
    };
  }

  async listar(u: UsuarioToken, ambienteId: string) {
    const ps: (PromoLinha & { produto: string | null })[] = await this.ds.query(
      `SELECT pr.*, to_char(pr.data_inicio, 'YYYY-MM-DD') AS data_inicio, to_char(pr.data_fim, 'YYYY-MM-DD') AS data_fim, p.nome AS produto
         FROM promocoes pr LEFT JOIN produtos p ON p.id = pr.brinde_produto_id
        WHERE pr.empresa_id = $1 AND pr.ambiente_id = $2 ORDER BY pr.ativo DESC, pr.criado_em DESC LIMIT 50`, [u.empresaId, ambienteId]);
    const hoje = hojeLocal();
    return ps.map((p) => ({
      id: p.id, nome: p.nome, diasSemana: p.dias_semana, horaInicio: p.hora_inicio, horaFim: p.hora_fim, dataInicio: p.data_inicio, dataFim: p.data_fim,
      brinde: p.produto ? { nome: p.produto, quantidade: Number(p.brinde_quantidade) } : null,
      diarias: p.diarias, situacao: !p.ativo ? 'encerrada' : p.data_fim < hoje ? 'terminou' : p.data_inicio > hoje ? 'agendada' : 'valendo',
      criadoPor: p.criado_por, criadoEm: p.criado_em,
    }));
  }

  async aplicar(u: UsuarioToken, dto: AplicarPromocaoDto) {
    const a = await this.ambiente(u, dto.ambienteId);
    const hotel = a.tipo !== 'motel';
    const dataInicio = dto.dataInicio ?? hojeLocal();
    if (dto.dataFim < dataInicio) throw new BadRequestException('A data final é antes da inicial.');
    const diasSemana = [...new Set(dto.diasSemana)].sort();
    if (!diasSemana.length) throw new BadRequestException('Escolha ao menos um dia da semana.');
    const horaInicio = dto.horaInicio || null;
    const horaFim = dto.horaFim || null;
    if (!!horaInicio !== !!horaFim) throw new BadRequestException('Informe o horário de início e de fim (ou deixe os dois vazios para o dia todo).');
    if (dto.brindeProdutoId) {
      const [p] = await this.ds.query(`SELECT id FROM produtos WHERE id = $1 AND empresa_id = $2 AND ativo`, [dto.brindeProdutoId, u.empresaId]);
      if (!p) throw new BadRequestException('Produto do brinde não encontrado.');
    }
    const nome = dto.nome.trim();
    return this.ds.transaction(async (m) => {
      let tabelaId: string | null = null;
      let diarias: Record<string, number> | null = null;
      if (hotel) {
        diarias = {};
        for (const p of dto.precos ?? []) if (p.valor > 0) diarias[p.categoriaId] = r2(p.valor);
        if (!Object.keys(diarias).length && !dto.brindeProdutoId) throw new BadRequestException('Mude algum preço ou escolha um brinde.');
      } else {
        // copia a tabela base do dia e troca só os preços editados
        const motor = await this.tarifas.motor(u.empresaId, a.id);
        const base = this.tabelaBase(motor, diasSemana[0]);
        if (!base) throw new BadRequestException('Este motel ainda não tem tabela de preços. Configure em Tarifas.');
        const [nova] = await m.query(
          `INSERT INTO tabelas_preco (empresa_id, ambiente_id, nome, dias_semana, hora_inicio, hora_fim, data_inicio, data_fim, prioridade, ativo)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,100,true) RETURNING id`,
          [u.empresaId, a.id, `Promo ${nome}`.slice(0, 60), diasSemana, horaInicio, horaFim, dataInicio, dto.dataFim]);
        tabelaId = nova.id;
        const novos = new Map((dto.precos ?? []).filter((p) => p.periodoId).map((p) => [`${p.categoriaId}:${p.periodoId}`, p.valor]));
        await m.query(
          `INSERT INTO precos (tabela_id, categoria_id, tipo, periodo_id, valor, duracao_min)
           SELECT $1, categoria_id, tipo, periodo_id, valor, duracao_min FROM precos WHERE tabela_id = $2`, [tabelaId, base.id]);
        for (const [k, v] of novos) {
          const [cat, per] = k.split(':');
          if (!(v >= 0)) continue;
          await m.query(`UPDATE precos SET valor = $4 WHERE tabela_id = $1 AND categoria_id = $2 AND periodo_id = $3 AND tipo = 'periodo'`, [tabelaId, cat, per, v.toFixed(2)]);
        }
      }
      const [pr] = await m.query(
        `INSERT INTO promocoes (empresa_id, ambiente_id, nome, dias_semana, hora_inicio, hora_fim, data_inicio, data_fim, tabela_id, diarias, brinde_produto_id, brinde_quantidade, criado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [u.empresaId, a.id, nome, diasSemana, horaInicio, horaFim, dataInicio, dto.dataFim, tabelaId, diarias ? JSON.stringify(diarias) : null,
          dto.brindeProdutoId ?? null, dto.brindeQuantidade ?? 1, u.nome]);
      return { ok: true, id: pr.id };
    });
  }

  async encerrar(u: UsuarioToken, id: string) {
    const [p] = await this.ds.query(`SELECT * FROM promocoes WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!p) throw new NotFoundException('Promoção não encontrada.');
    await this.ambiente(u, p.ambiente_id);
    await this.ds.transaction(async (m) => {
      await m.query(`UPDATE promocoes SET ativo = false, encerrado_em = now() WHERE id = $1`, [id]);
      if (p.tabela_id) await m.query(`UPDATE tabelas_preco SET ativo = false WHERE id = $1`, [p.tabela_id]);
    });
    return { ok: true };
  }

  /** promoções valendo num ambiente (para diária do hotel e brinde na entrada) */
  private async ativas(empresaId: string, ambienteId: string): Promise<PromoLinha[]> {
    return this.ds.query(
      `SELECT *, to_char(data_inicio, 'YYYY-MM-DD') AS data_inicio, to_char(data_fim, 'YYYY-MM-DD') AS data_fim
         FROM promocoes WHERE empresa_id = $1 AND ambiente_id = $2 AND ativo ORDER BY criado_em DESC`, [empresaId, ambienteId]);
  }

  private vale(p: PromoLinha, quando: Date) {
    const { diaSemana, minutoDia, data } = partesLocais(quando, FUSO);
    return data >= p.data_inicio && data <= p.data_fim && p.dias_semana.includes(diaSemana) && dentroDaFaixa(minutoDia, p.hora_inicio, p.hora_fim);
  }

  /** brinde da promoção que vale nesta entrada (motel: a da tabela escolhida; hotel: pelo dia) */
  async brindeDaEntrada(empresaId: string, ambienteId: string, tabelaId: string | null, quando: Date) {
    const ps = await this.ativas(empresaId, ambienteId);
    const p = ps.find((x) => x.brinde_produto_id && (x.tabela_id ? x.tabela_id === tabelaId : this.vale(x, quando)));
    return p ? { produtoId: p.brinde_produto_id!, quantidade: Number(p.brinde_quantidade) || 1, promocao: p.nome } : null;
  }
}
