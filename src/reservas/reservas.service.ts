import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomBytes } from 'crypto';
import { CancelarReservaDto, CheckinReservaDto, ReservaDto } from './reservas.dto';
import { UsuarioToken } from '../common/permissoes';
import { EstadiasService } from '../estadias/estadias.service';
import { quartosColetivos, ReservasGrupo } from './reservas-grupo';

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
const ATIVAS = `('pendente','confirmada','hospedada')`;

const fmt = (r: Record<string, unknown>) => ({
  id: r.id, numero: r.numero, unidadeId: r.unidade_id, unidade: r.unidade_codigo ?? null, categoria: r.categoria_nome ?? null,
  ambienteId: r.ambiente_id, hospede: r.hospede, telefone: r.telefone, email: r.email, documento: r.documento,
  chegada: dia(r.chegada), saida: dia(r.saida), noites: noites(dia(r.chegada), dia(r.saida)),
  adultos: r.adultos, criancas: r.criancas, valorDiaria: Number(r.valor_diaria), valorTotal: Number(r.valor_total),
  sinal: Number(r.sinal), sinalForma: r.sinal_forma, origem: r.origem, observacao: r.observacao, status: r.status,
  estadiaId: r.estadia_id, nova: !r.vista_em, motivoCancelamento: r.motivo_cancelamento, criadoPor: r.criado_por, criadoEm: r.criado_em,
  grupoId: r.grupo_id ?? null, codigoPublico: r.codigo_publico ?? null, categoriaPedida: r.categoria_pedida ?? null, quartoEscolhido: !!r.quarto_escolhido,
});

@Injectable()
export class ReservasService {
  readonly grupos: ReservasGrupo;
  constructor(private readonly ds: DataSource, private readonly estadias: EstadiasService) {
    this.grupos = new ReservasGrupo(ds);
  }

  /** Quartos de hotel/pousada (o motel não tem reserva por diária). */
  private async quartos(u: UsuarioToken) {
    const l = await this.ds.query(
      `SELECT un.id, un.codigo, un.status, un.capacidade, un.coletivo, c.nome AS categoria, a.id AS ambiente_id, a.nome AS ambiente
         FROM unidades un JOIN ambientes a ON a.id = un.ambiente_id LEFT JOIN categorias c ON c.id = un.categoria_id
        WHERE un.empresa_id = $1 AND un.ativo = true AND a.tipo IN ('hotel','pousada')
        ORDER BY a.ordem, a.nome, COALESCE(un.coletivo, un.codigo), un.coletivo IS NOT NULL, un.ordem, un.codigo`, [u.empresaId]);
    return l.map((q: Record<string, unknown>) => ({ id: q.id, codigo: q.codigo, status: q.status, capacidade: q.capacidade, coletivo: q.coletivo ?? null, categoria: q.categoria, ambienteId: q.ambiente_id, ambiente: q.ambiente }));
  }

  async listar(u: UsuarioToken, f: { de?: string; ate?: string; busca?: string }) {
    const hoje = hojeSP();
    const de = f.de && /^\d{4}-\d{2}-\d{2}$/.test(f.de) ? f.de : somaDias(hoje, -3);
    const ate = f.ate && /^\d{4}-\d{2}-\d{2}$/.test(f.ate) ? f.ate : somaDias(de, 30);
    let params: unknown[] = [u.empresaId, de, ate];
    let where = `r.empresa_id = $1 AND r.chegada <= $3::date AND r.saida >= $2::date`;
    const busca = f.busca?.trim().toLowerCase();
    if (busca) {
      params = [u.empresaId, `%${busca}%`, busca];
      where = `r.empresa_id = $1 AND (lower(r.hospede) LIKE $2 OR r.telefone LIKE $2 OR r.numero::text = $3)`;
    }
    const l = await this.ds.query(
      `SELECT r.*, un.codigo AS unidade_codigo, c.nome AS categoria_nome FROM reservas r
         LEFT JOIN unidades un ON un.id = r.unidade_id LEFT JOIN categorias c ON c.id = un.categoria_id
        WHERE ${where} ORDER BY r.chegada, r.hospede LIMIT 1000`, params);
    const [chegHoje] = await this.ds.query(`SELECT count(*)::int AS n FROM reservas WHERE empresa_id = $1 AND chegada = $2 AND status IN ('pendente','confirmada')`, [u.empresaId, hoje]);
    const [saiHoje] = await this.ds.query(`SELECT count(*)::int AS n FROM reservas WHERE empresa_id = $1 AND saida = $2 AND status = 'hospedada'`, [u.empresaId, hoje]);
    return {
      hoje, de, ate, chegadasHoje: chegHoje?.n ?? 0, saidasHoje: saiHoje?.n ?? 0, quartos: await this.quartos(u), lista: l.map(fmt),
      coletivos: await quartosColetivos(this.ds, u.empresaId), grupos: await this.grupos.listar(u, de, ate),
    };
  }

  private async buscar(u: UsuarioToken, id: string) {
    const [r] = await this.ds.query(`SELECT * FROM reservas WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!r) throw new NotFoundException('Reserva não encontrada.');
    return r;
  }

  private async validar(u: UsuarioToken, dto: ReservaDto, ignorarId?: string) {
    if (dto.saida <= dto.chegada) throw new BadRequestException('A saída tem que ser depois da chegada (pelo menos 1 diária).');
    if (noites(dto.chegada, dto.saida) > 365) throw new BadRequestException('Reserva de no máximo 365 diárias.');
    const [q] = await this.ds.query(
      `SELECT un.id, un.codigo, un.ambiente_id, a.tipo FROM unidades un JOIN ambientes a ON a.id = un.ambiente_id WHERE un.id = $1 AND un.empresa_id = $2 AND un.ativo = true`,
      [dto.unidadeId, u.empresaId]);
    if (!q) throw new NotFoundException('Quarto não encontrado.');
    if (!['hotel', 'pousada'].includes(q.tipo)) throw new BadRequestException('Reserva por diária só nos quartos de hotel ou pousada.');
    // mesmo quarto, datas que se cruzam (o dia da saída de um pode ser a chegada do outro)
    const [choque] = await this.ds.query(
      `SELECT numero, hospede, chegada, saida FROM reservas WHERE empresa_id = $1 AND unidade_id = $2 AND status IN ${ATIVAS}
         AND chegada < $4 AND saida > $3 ${ignorarId ? 'AND id <> $5' : ''} LIMIT 1`,
      ignorarId ? [u.empresaId, dto.unidadeId, dto.chegada, dto.saida, ignorarId] : [u.empresaId, dto.unidadeId, dto.chegada, dto.saida]);
    if (choque) {
      throw new BadRequestException(`O quarto ${q.codigo} já tem a reserva nº ${choque.numero ?? '—'} (${choque.hospede}) de ${br(dia(choque.chegada))} a ${br(dia(choque.saida))}.`);
    }
    const n = noites(dto.chegada, dto.saida);
    const total = dto.valorTotal ?? (dto.valorDiaria ?? 0) * n;
    if ((dto.sinal ?? 0) > 0 && !dto.sinalForma) throw new BadRequestException('Informe como o sinal foi pago.');
    if ((dto.sinal ?? 0) > total && total > 0) throw new BadRequestException('O sinal não pode ser maior que o total da reserva.');
    return { q, total };
  }

  private campos(dto: ReservaDto) {
    return [
      dto.hospede.trim(), dto.telefone?.trim() || null, dto.email?.trim() || null, dto.documento?.trim() || null,
      dto.chegada, dto.saida, dto.adultos ?? 2, dto.criancas ?? 0, (dto.valorDiaria ?? 0).toFixed(2),
    ];
  }

  async criar(u: UsuarioToken, dto: ReservaDto) {
    const { q, total } = await this.validar(u, dto);
    const r = await this.ds.transaction(async (m) => {
      const c = await m.query('UPDATE empresas SET ultima_reserva = ultima_reserva + 1 WHERE id = $1 RETURNING ultima_reserva', [u.empresaId]);
      const linha = Array.isArray(c?.[0]) ? c[0][0] : c?.[0];
      const [nova] = await m.query(
        `INSERT INTO reservas (empresa_id, numero, unidade_id, ambiente_id, hospede, telefone, email, documento, chegada, saida, adultos, criancas, valor_diaria,
           valor_total, sinal, sinal_forma, origem, observacao, status, criado_por, vista_em)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20, now()) RETURNING id, numero`,
        [u.empresaId, linha ? Number(linha.ultima_reserva) : null, dto.unidadeId, q.ambiente_id, ...this.campos(dto),
          total.toFixed(2), (dto.sinal ?? 0).toFixed(2), (dto.sinal ?? 0) > 0 ? dto.sinalForma : null, dto.origem?.trim() || null,
          dto.observacao?.trim() || null, dto.status ?? 'confirmada', u.nome]);
      return nova;
    });
    return { ok: true, id: r.id, numero: r.numero };
  }

  async atualizar(u: UsuarioToken, id: string, dto: ReservaDto) {
    const r = await this.buscar(u, id);
    if (!['pendente', 'confirmada'].includes(r.status)) throw new BadRequestException('Só dá para alterar reserva ainda não hospedada.');
    const { q, total } = await this.validar(u, dto, id);
    await this.ds.query(
      `UPDATE reservas SET unidade_id=$3, ambiente_id=$4, hospede=$5, telefone=$6, email=$7, documento=$8, chegada=$9, saida=$10, adultos=$11, criancas=$12,
         valor_diaria=$13, valor_total=$14, sinal=$15, sinal_forma=$16, origem=$17, observacao=$18, status=$19, atualizado_em=now()
       WHERE id=$1 AND empresa_id=$2`,
      [id, u.empresaId, dto.unidadeId, q.ambiente_id, ...this.campos(dto), total.toFixed(2), (dto.sinal ?? 0).toFixed(2),
        (dto.sinal ?? 0) > 0 ? dto.sinalForma : null, dto.origem?.trim() || null, dto.observacao?.trim() || null, dto.status ?? r.status]);
    return { ok: true };
  }

  async cancelar(u: UsuarioToken, id: string, dto: CancelarReservaDto) {
    const r = await this.buscar(u, id);
    if (!['pendente', 'confirmada'].includes(r.status)) throw new BadRequestException('Esta reserva já foi hospedada ou cancelada.');
    await this.ds.query(`UPDATE reservas SET status=$3, motivo_cancelamento=$4, atualizado_em=now() WHERE id=$1 AND empresa_id=$2`,
      [id, u.empresaId, dto.tipo ?? 'cancelada', dto.motivo?.trim() || null]);
    return { ok: true };
  }

  /**
   * Dados do hotel para o painel em lista / linha do tempo: hóspede, FNRH, saída prevista,
   * chegada de hoje, próxima reserva e reservas novas ainda não vistas (piscam).
   */
  async painel(u: UsuarioToken, ambienteId?: string) {
    const hoje = hojeSP();
    const params: unknown[] = [u.empresaId];
    let filtroAmb = '';
    if (ambienteId && /^[0-9a-f-]{36}$/i.test(ambienteId)) { params.push(ambienteId); filtroAmb = ` AND un.ambiente_id = $${params.length}`; }
    const contas = await this.ds.query(
      `SELECT e.id, e.unidade_id, e.saida_prevista, e.entrada_em,
              (SELECT r.hospede FROM reservas r WHERE r.estadia_id = e.id LIMIT 1) AS hospede_reserva,
              (SELECT f.dados->>'nome' FROM fichas_hospede f WHERE f.estadia_id = e.id ORDER BY f.criado_em LIMIT 1) AS hospede_ficha,
              (SELECT CASE WHEN bool_or(COALESCE(f.dados->>'numeroOficial','') <> '') THEN 'registrada'
                           WHEN bool_or(f.status = 'preenchida') THEN 'preenchida' ELSE 'pendente' END
                 FROM fichas_hospede f WHERE f.estadia_id = e.id) AS fnrh
         FROM estadias e JOIN unidades un ON un.id = e.unidade_id
        WHERE e.empresa_id = $1 AND e.status IN ('aberta','conta_entregue')${filtroAmb}`, params);
    const pr = [...params, somaDias(hoje, -3), somaDias(hoje, 21)];
    const n = params.length;
    const res = await this.ds.query(
      `SELECT r.id, r.numero, r.unidade_id, r.hospede, r.chegada, r.saida, r.status, r.origem, r.estadia_id, r.vista_em, (r.adultos + r.criancas)::int AS pessoas, r.sinal
         FROM reservas r JOIN unidades un ON un.id = r.unidade_id
        WHERE r.empresa_id = $1 AND r.status IN ('pendente','confirmada','hospedada')${filtroAmb}
          AND r.chegada <= $${n + 2}::date AND r.saida >= $${n + 1}::date ORDER BY r.chegada`, pr);
    const unidades: Record<string, Record<string, unknown>> = {};
    const de = (id: string) => (unidades[id] ??= { hospede: null, fnrh: null, saidaPrevista: null, chegadaHoje: null, proxima: null, reservaNova: false });
    for (const c of contas) {
      const x = de(c.unidade_id);
      x.hospede = c.hospede_reserva ?? c.hospede_ficha ?? null;
      x.fnrh = c.fnrh ?? 'nenhuma';
      x.saidaPrevista = c.saida_prevista ? dia(c.saida_prevista) : null;
    }
    const reservas = res.map((r: Record<string, unknown>) => ({
      id: r.id, numero: r.numero, unidadeId: r.unidade_id, hospede: r.hospede, chegada: dia(r.chegada), saida: dia(r.saida), status: r.status,
      origem: r.origem, estadiaId: r.estadia_id, pessoas: r.pessoas, sinal: Number(r.sinal), nova: !r.vista_em,
    }));
    for (const r of reservas) {
      if (r.status === 'hospedada') continue;
      const x = de(String(r.unidadeId));
      if (r.nova) x.reservaNova = true;
      if (r.chegada === hoje) x.chegadaHoje = { id: r.id, numero: r.numero, hospede: r.hospede, saida: r.saida, pessoas: r.pessoas, origem: r.origem, sinal: r.sinal };
      else if (r.chegada > hoje && !x.proxima) x.proxima = { chegada: r.chegada, hospede: r.hospede };
    }
    return { hoje, unidades, reservas };
  }

  /** a recepção viu as reservas novas deste quarto (para de piscar) */
  async marcarVistas(u: UsuarioToken, unidadeId: string) {
    await this.ds.query(`UPDATE reservas SET vista_em = now() WHERE empresa_id = $1 AND unidade_id = $2 AND vista_em IS NULL`, [u.empresaId, unidadeId]);
    return { ok: true };
  }

  async checkin(u: UsuarioToken, id: string, dto: CheckinReservaDto) {
    const r = await this.buscar(u, id);
    if (!['pendente', 'confirmada'].includes(r.status)) throw new BadRequestException('Esta reserva já foi hospedada ou cancelada.');
    // quarto coletivo: a reserva vem com o nome da empresa; na chegada vale o nome do funcionário
    if (dto.hospede?.trim()) {
      r.hospede = dto.hospede.trim();
      await this.ds.query(`UPDATE reservas SET hospede = $2 WHERE id = $1`, [id, r.hospede]);
    }
    const hoje = hojeSP();
    if (dia(r.chegada) > hoje) throw new BadRequestException(`A chegada desta reserva é ${br(dia(r.chegada))}. Altere a data se o hóspede chegou antes.`);
    const sinal = Number(r.sinal);
    const lancar = (dto.lancarSinal ?? 'sim') === 'sim' && sinal > 0 && !!r.sinal_forma;
    const obs = [`Reserva nº ${r.numero ?? '—'} · ${r.hospede}`, `${br(dia(r.chegada))} a ${br(dia(r.saida))}`,
      Number(r.valor_diaria) > 0 ? `diária combinada R$ ${Number(r.valor_diaria).toFixed(2).replace('.', ',')}` : '',
      Number(r.valor_total) > 0 ? `total R$ ${Number(r.valor_total).toFixed(2).replace('.', ',')}` : '',
      sinal > 0 ? `sinal R$ ${sinal.toFixed(2).replace('.', ',')}${lancar ? ' (lançado)' : ' (não lançado)'}` : '',
      r.observacao ?? ''].filter(Boolean).join(' · ').slice(0, 500);
    const e = await this.estadias.abrir(u, {
      unidadeId: r.unidade_id,
      pessoas: Math.min(20, Math.max(1, Number(r.adultos) + Number(r.criancas))),
      observacao: obs,
      adiantamento: lancar ? [{ forma: r.sinal_forma, valor: sinal }] : undefined,
    } as never);
    const estadiaId = (e as unknown as { id: string }).id;
    await this.ds.query(`UPDATE reservas SET status='hospedada', estadia_id=$3, atualizado_em=now() WHERE id=$1 AND empresa_id=$2`, [id, u.empresaId, estadiaId]);
    // a conta passa a cobrar o valor combinado na reserva (se tiver valor)
    if (Number(r.valor_total) > 0) {
      await this.ds.query(`UPDATE estadias SET total_combinado = $2, diaria_combinada = $3, saida_prevista = $4 WHERE id = $1`,
        [estadiaId, Number(r.valor_total).toFixed(2), Number(r.valor_diaria) > 0 ? Number(r.valor_diaria).toFixed(2) : (Number(r.valor_total) / Math.max(1, noites(dia(r.chegada), dia(r.saida)))).toFixed(2), dia(r.saida)]);
    }
    // já deixa a ficha FNRH começada com o que a reserva tem
    try {
      const dados: Record<string, unknown> = { nome: r.hospede, checkin: `${dia(r.chegada)}T14:00`, checkout: `${dia(r.saida)}T12:00` };
      if (r.telefone) dados.telefone = r.telefone;
      if (r.email) dados.email = r.email;
      if (r.documento) dados.documento = r.documento;
      await this.ds.query(
        `INSERT INTO fichas_hospede (empresa_id, estadia_id, unidade_id, token, dados, criado_por) VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
        [u.empresaId, estadiaId, r.unidade_id, randomBytes(9).toString('base64url'), JSON.stringify(dados), u.nome]);
    } catch {
      /* a ficha pode ser criada depois na recepção */
    }
    return { ok: true, estadiaId };
  }
}
