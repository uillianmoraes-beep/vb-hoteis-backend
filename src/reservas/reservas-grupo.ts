import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { GrupoReservaDto } from './reservas.dto';
import { UsuarioToken } from '../common/permissoes';

/**
 * Quarto coletivo: cada cama é uma unidade (unidades.coletivo = código do quarto).
 * A reserva de empresa diz quantas camas em cada noite; o sistema monta uma reserva por cama,
 * mantendo a mesma cama nas noites seguidas (um check-in só para quem fica vários dias).
 */

const FUSO = 'America/Sao_Paulo';
const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: FUSO });
const dia = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const br = (d: string) => d.split('-').reverse().join('/');
const somaDias = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const noites = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
type Q = DataSource | EntityManager;

/** quartos coletivos da empresa (hotel/pousada), com o número de camas */
export async function quartosColetivos(ds: Q, empresaId: string) {
  const l = await ds.query(
    `SELECT un.coletivo, un.ambiente_id, a.nome AS ambiente, count(*)::int AS camas, min(c.nome) AS categoria
       FROM unidades un JOIN ambientes a ON a.id = un.ambiente_id LEFT JOIN categorias c ON c.id = un.categoria_id
      WHERE un.empresa_id = $1 AND un.ativo = true AND un.coletivo IS NOT NULL AND a.tipo IN ('hotel','pousada')
      GROUP BY un.coletivo, un.ambiente_id, a.nome, a.ordem ORDER BY a.ordem, un.coletivo`, [empresaId]);
  return l.map((q: Record<string, unknown>) => ({ coletivo: q.coletivo, ambienteId: q.ambiente_id, ambiente: q.ambiente, camas: q.camas, categoria: q.categoria }));
}

async function novoNumero(m: EntityManager, empresaId: string) {
  const c = await m.query('UPDATE empresas SET ultima_reserva = ultima_reserva + 1 WHERE id = $1 RETURNING ultima_reserva', [empresaId]);
  const linha = Array.isArray(c?.[0]) ? c[0][0] : c?.[0];
  return linha ? Number(linha.ultima_reserva) : null;
}

async function inserirCama(m: EntityManager, g: Record<string, unknown>, unidadeId: string, ambienteId: string, chegada: string, saida: string, por: string) {
  const diaria = Number(g.valor_diaria);
  const obs = [`Empresa: ${g.nome}`, g.observacao ? String(g.observacao) : ''].filter(Boolean).join(' · ').slice(0, 500);
  await m.query(
    `INSERT INTO reservas (empresa_id, numero, unidade_id, ambiente_id, hospede, telefone, chegada, saida, adultos, criancas, valor_diaria,
       valor_total, sinal, origem, observacao, status, criado_por, vista_em, grupo_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,0,$9,$10,0,'Empresa',$11,'confirmada',$12, now(), $13)`,
    [g.empresa_id, await novoNumero(m, String(g.empresa_id)), unidadeId, ambienteId, g.nome, g.telefone ?? null, chegada, saida,
      diaria.toFixed(2), (diaria * noites(chegada, saida)).toFixed(2), obs, por, g.id]);
}

/**
 * Refaz as reservas das camas do grupo: apaga as ainda não hospedadas e cria de novo conforme
 * "camas" (uma posição por noite). Quem já fez check-in fica como está e conta na noite.
 */
async function planejar(m: EntityManager, g: Record<string, unknown>, por: string) {
  const chegada = dia(g.chegada);
  const saida = dia(g.saida);
  const camas = (g.camas as number[]) ?? [];
  const n = noites(chegada, saida);
  if (camas.length !== n) throw new BadRequestException('Informe quantas camas em cada noite do período.');
  const leitos: { id: string; codigo: string; ambiente_id: string }[] = await m.query(
    `SELECT id, codigo, ambiente_id FROM unidades WHERE empresa_id = $1 AND ativo = true AND coletivo = $2 ORDER BY ordem, codigo`,
    [g.empresa_id, g.coletivo]);
  if (!leitos.length) throw new BadRequestException(`O quarto coletivo ${g.coletivo} não tem camas cadastradas.`);
  const maior = Math.max(0, ...camas);
  if (maior > leitos.length) throw new BadRequestException(`O quarto ${g.coletivo} tem só ${leitos.length} cama(s); você pediu ${maior}.`);

  await m.query(`DELETE FROM reservas WHERE grupo_id = $1 AND status IN ('pendente','confirmada')`, [g.id]);
  const ocupadas: { unidade_id: string; chegada: string; saida: string; grupo_id: string | null; hospede: string; numero: number | null }[] = await m.query(
    `SELECT unidade_id, chegada, saida, grupo_id, hospede, numero FROM reservas
      WHERE unidade_id = ANY($1::uuid[]) AND status IN ('pendente','confirmada','hospedada') AND chegada < $3 AND saida > $2`,
    [leitos.map((l) => l.id), chegada, saida]);

  // noite d = a noite que começa em chegada + d
  const ocupado = new Map<string, Set<number>>(leitos.map((l) => [l.id, new Set<number>()]));
  const doGrupo = new Array(n).fill(0) as number[];
  for (const o of ocupadas) {
    const a = Math.max(0, noites(chegada, dia(o.chegada)));
    const b = Math.min(n, noites(chegada, dia(o.saida)));
    for (let d = a; d < b; d++) {
      ocupado.get(o.unidade_id)!.add(d);
      if (o.grupo_id === g.id) doGrupo[d]++;
    }
  }

  const plano = new Map<string, Set<number>>(leitos.map((l) => [l.id, new Set<number>()]));
  for (let d = 0; d < n; d++) {
    const falta = camas[d] - doGrupo[d];
    if (falta < 0) {
      throw new BadRequestException(`Na noite de ${br(somaDias(chegada, d))} já tem ${doGrupo[d]} pessoa(s) desta empresa hospedada(s). Não dá para pôr menos que isso.`);
    }
    if (!falta) continue;
    // a cama que já era do grupo na noite anterior continua (mesma pessoa, sem novo check-in)
    const livres = leitos.filter((l) => !ocupado.get(l.id)!.has(d));
    livres.sort((x, y) => Number(plano.get(y.id)!.has(d - 1)) - Number(plano.get(x.id)!.has(d - 1)));
    if (livres.length < falta) {
      const outras = ocupadas.filter((o) => o.grupo_id !== g.id && dia(o.chegada) <= somaDias(chegada, d) && dia(o.saida) > somaDias(chegada, d));
      throw new BadRequestException(
        `Na noite de ${br(somaDias(chegada, d))} faltam ${falta - livres.length} cama(s) livre(s) no quarto ${g.coletivo}` +
        `${outras.length ? ` (ocupadas por: ${outras.map((o) => `nº ${o.numero ?? '—'} ${o.hospede}`).join(', ')})` : ''}.`);
    }
    for (const l of livres.slice(0, falta)) plano.get(l.id)!.add(d);
  }

  let criadas = 0;
  for (const l of leitos) {
    const ns = plano.get(l.id)!;
    for (let d = 0; d < n; d++) {
      if (!ns.has(d) || ns.has(d - 1)) continue;
      let fim = d;
      while (ns.has(fim + 1)) fim++;
      await inserirCama(m, g, l.id, l.ambiente_id, somaDias(chegada, d), somaDias(chegada, fim + 1), por);
      criadas++;
    }
  }
  return criadas;
}

const fmtGrupo = (g: Record<string, unknown>) => ({
  id: g.id, coletivo: g.coletivo, ambienteId: g.ambiente_id, clienteFaturadoId: g.cliente_faturado_id, cliente: g.cliente_nome ?? null,
  nome: g.nome, telefone: g.telefone, chegada: dia(g.chegada), saida: dia(g.saida), camas: g.camas, valorDiaria: Number(g.valor_diaria),
  observacao: g.observacao, status: g.status, criadoPor: g.criado_por,
});

export class ReservasGrupo {
  constructor(private readonly ds: DataSource) {}

  async listar(u: UsuarioToken, de: string, ate: string) {
    const l = await this.ds.query(
      `SELECT g.*, c.nome AS cliente_nome FROM reservas_grupo g LEFT JOIN clientes_faturados c ON c.id = g.cliente_faturado_id
        WHERE g.empresa_id = $1 AND g.status = 'ativa' AND g.chegada <= $3::date AND g.saida >= $2::date ORDER BY g.chegada`, [u.empresaId, de, ate]);
    return l.map(fmtGrupo);
  }

  async ver(u: UsuarioToken, id: string) {
    const [g] = await this.ds.query(
      `SELECT g.*, c.nome AS cliente_nome FROM reservas_grupo g LEFT JOIN clientes_faturados c ON c.id = g.cliente_faturado_id
        WHERE g.id = $1 AND g.empresa_id = $2`, [id, u.empresaId]);
    if (!g) throw new NotFoundException('Reserva da empresa não encontrada.');
    const camas = await this.ds.query(
      `SELECT r.id, r.numero, r.hospede, r.chegada, r.saida, r.status, r.estadia_id, un.codigo AS unidade, un.id AS unidade_id
         FROM reservas r JOIN unidades un ON un.id = r.unidade_id
        WHERE r.grupo_id = $1 AND r.status IN ('pendente','confirmada','hospedada') ORDER BY un.codigo, r.chegada`, [id]);
    return {
      ...fmtGrupo(g),
      reservas: camas.map((r: Record<string, unknown>) => ({
        id: r.id, numero: r.numero, hospede: r.hospede, chegada: dia(r.chegada), saida: dia(r.saida), status: r.status,
        estadiaId: r.estadia_id, unidade: r.unidade, unidadeId: r.unidade_id,
      })),
    };
  }

  private async validar(u: UsuarioToken, dto: GrupoReservaDto) {
    if (dto.saida <= dto.chegada) throw new BadRequestException('A saída tem que ser depois da chegada (pelo menos 1 diária).');
    if (noites(dto.chegada, dto.saida) > 120) throw new BadRequestException('Reserva de empresa de no máximo 120 diárias. Faça outra para o resto.');
    const [q] = await this.ds.query(
      `SELECT un.ambiente_id FROM unidades un JOIN ambientes a ON a.id = un.ambiente_id
        WHERE un.empresa_id = $1 AND un.ativo = true AND un.coletivo = $2 AND a.tipo IN ('hotel','pousada') LIMIT 1`, [u.empresaId, dto.coletivo]);
    if (!q) throw new NotFoundException('Quarto coletivo não encontrado.');
    if (dto.clienteFaturadoId) {
      const [c] = await this.ds.query(`SELECT id FROM clientes_faturados WHERE id = $1 AND empresa_id = $2`, [dto.clienteFaturadoId, u.empresaId]);
      if (!c) throw new BadRequestException('Cliente (empresa) não encontrado no Faturamento.');
    }
    if (!dto.camas.some((c) => c > 0)) throw new BadRequestException('Coloque pelo menos 1 cama em alguma noite.');
    return q.ambiente_id as string;
  }

  private valores(dto: GrupoReservaDto) {
    return [dto.coletivo, dto.clienteFaturadoId ?? null, dto.nome.trim(), dto.telefone?.trim() || null, dto.chegada, dto.saida,
      JSON.stringify(dto.camas), (dto.valorDiaria ?? 0).toFixed(2), dto.observacao?.trim() || null];
  }

  async criar(u: UsuarioToken, dto: GrupoReservaDto) {
    const ambienteId = await this.validar(u, dto);
    return this.ds.transaction(async (m) => {
      const [g] = await m.query(
        `INSERT INTO reservas_grupo (empresa_id, ambiente_id, coletivo, cliente_faturado_id, nome, telefone, chegada, saida, camas, valor_diaria, observacao, criado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12) RETURNING *`, [u.empresaId, ambienteId, ...this.valores(dto), u.nome]);
      const criadas = await planejar(m, g, u.nome);
      return { ok: true, id: g.id, reservas: criadas };
    });
  }

  async atualizar(u: UsuarioToken, id: string, dto: GrupoReservaDto) {
    const [atual] = await this.ds.query(`SELECT status FROM reservas_grupo WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!atual) throw new NotFoundException('Reserva da empresa não encontrada.');
    if (atual.status !== 'ativa') throw new BadRequestException('Esta reserva da empresa foi cancelada.');
    const ambienteId = await this.validar(u, dto);
    return this.ds.transaction(async (m) => {
      // UPDATE ... RETURNING volta [linhas, quantidade]
      const res = await m.query(
        `UPDATE reservas_grupo SET ambiente_id=$3, coletivo=$4, cliente_faturado_id=$5, nome=$6, telefone=$7, chegada=$8, saida=$9, camas=$10::jsonb,
           valor_diaria=$11, observacao=$12, atualizado_em=now() WHERE id=$1 AND empresa_id=$2 RETURNING *`,
        [id, u.empresaId, ambienteId, ...this.valores(dto)]);
      const g = Array.isArray(res?.[0]) ? res[0][0] : res?.[0];
      // quem já fez check-in fora do novo período impede a mudança
      const [fora] = await m.query(
        `SELECT r.numero, r.hospede FROM reservas r WHERE r.grupo_id = $1 AND r.status = 'hospedada' AND (r.chegada < $2 OR r.saida > $3) LIMIT 1`,
        [id, dto.chegada, dto.saida]);
      if (fora) throw new BadRequestException(`A reserva nº ${fora.numero ?? '—'} (${fora.hospede}) já fez check-in fora deste período. Mantenha as datas que cobrem a estadia dela.`);
      const criadas = await planejar(m, g, u.nome);
      return { ok: true, reservas: criadas };
    });
  }

  /** cancela as camas ainda não hospedadas; quem já está na casa continua com a conta aberta */
  async cancelar(u: UsuarioToken, id: string) {
    const [g] = await this.ds.query(`SELECT id FROM reservas_grupo WHERE id = $1 AND empresa_id = $2 AND status = 'ativa'`, [id, u.empresaId]);
    if (!g) throw new NotFoundException('Reserva da empresa não encontrada ou já cancelada.');
    await this.ds.transaction(async (m) => {
      await m.query(`UPDATE reservas SET status = 'cancelada', motivo_cancelamento = 'Reserva da empresa cancelada', atualizado_em = now()
                      WHERE grupo_id = $1 AND status IN ('pendente','confirmada')`, [id]);
      await m.query(`UPDATE reservas_grupo SET status = 'cancelada', atualizado_em = now() WHERE id = $1`, [id]);
    });
    return { ok: true };
  }
}

/**
 * Fechou a conta de uma cama da empresa antes da data prevista: a reserva dela termina hoje
 * e as noites que sobram voltam como reserva da empresa na mesma cama (para o próximo funcionário).
 */
export async function liberarCamaDoGrupo(m: EntityManager, estadiaId: string, por: string) {
  const [r] = await m.query(
    `SELECT r.id, r.unidade_id, r.ambiente_id, r.chegada, r.saida, r.grupo_id FROM reservas r
      WHERE r.estadia_id = $1 AND r.grupo_id IS NOT NULL LIMIT 1`, [estadiaId]);
  if (!r) return;
  const chegada = dia(r.chegada);
  const saida = dia(r.saida);
  const corte = [hojeSP(), somaDias(chegada, 1)].sort()[1];
  if (saida <= corte) return;
  await m.query(`UPDATE reservas SET saida = $2, valor_total = valor_diaria * $3, atualizado_em = now() WHERE id = $1`,
    [r.id, corte, noites(chegada, corte)]);
  const [g] = await m.query(`SELECT * FROM reservas_grupo WHERE id = $1 AND status = 'ativa'`, [r.grupo_id]);
  if (g) await inserirCama(m, g, r.unidade_id, r.ambiente_id, corte, saida, por);
}
