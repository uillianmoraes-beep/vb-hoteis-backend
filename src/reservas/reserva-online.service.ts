import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { fichaDaReserva } from './reservas.service';
import { DataSource } from 'typeorm';
import { randomBytes } from 'crypto';
import { UsuarioToken } from '../common/permissoes';
import { ConfigReservaOnlineDto, RascunhoReservaDto, ReservaPublicaDto } from './reservas.dto';
import { aplicarPromocoes, type Fidelidade } from './promocoes';
import { CobrancaService } from '../cobranca/cobranca.service';
import { enviarParaLocal } from '../servidor-local/ponte.core';
import { conferirCpfLivre } from './cpf-unico';

interface Q { query: (sql: string, params?: unknown[]) => Promise<any> }

/** configuração guardada em ambientes.reserva_online */
export interface ConfigOnline {
  ativo?: boolean;
  confirmacao?: 'automatica' | 'recepcao';
  escolherQuarto?: boolean;
  mensagem?: string;
  minNoites?: number;
  maxNoites?: number;
  janelaDias?: number;
  whatsapp?: string;
  /** % do total cobrado como sinal por Pix (0 = sem sinal) */
  sinalPct?: number;
  categorias?: Record<string, { ativo: boolean; diaria: number; pessoaExtra?: number; descricao?: string }>;
  quartos?: Record<string, { destaque?: string; acrescimo?: number; oculto?: boolean }>;
}

const FUSO = 'America/Sao_Paulo';
const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: FUSO });
const somaDias = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const noites = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
const r2 = (v: number) => Math.round(v * 100) / 100;
const dia = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const TOKEN = `substr(md5(random()::text || clock_timestamp()::text || gen_random_uuid()::text), 1, 20)`;
/** código que o hóspede usa para acompanhar (sem letras que confundem) */
const novoCodigo = () => {
  const alfa = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const hex = randomBytes(8).toString('hex');
  let s = '';
  for (let i = 0; i < 8; i++) s += alfa[parseInt(hex.slice(i * 2, i * 2 + 2), 16) % alfa.length];
  return s;
};

@Injectable()
export class ReservaOnlineService {
  constructor(private readonly ds: DataSource, private readonly cobranca: CobrancaService) {}

  // ---------------- recepção / gerência ----------------

  async config(u: UsuarioToken) {
    const ambs = await this.ds.query(
      `SELECT id, nome, tipo, reserva_online, token_reserva FROM ambientes WHERE empresa_id = $1 AND ativo AND tipo IN ('hotel','pousada') ORDER BY ordem, nome`, [u.empresaId]);
    const uns = await this.ds.query(
      `SELECT un.id, un.codigo, un.nome, un.capacidade, un.ambiente_id, un.categoria_id, c.nome AS categoria
         FROM unidades un LEFT JOIN categorias c ON c.id = un.categoria_id
        WHERE un.empresa_id = $1 AND un.ativo AND un.coletivo IS NULL ORDER BY un.ordem, un.codigo`, [u.empresaId]);
    return ambs.map((a: Record<string, unknown>) => {
      const daqui = uns.filter((x: { ambiente_id: string }) => x.ambiente_id === a.id);
      const cats = new Map<string, { id: string; nome: string; quartos: number }>();
      for (const x of daqui) {
        if (!x.categoria_id) continue;
        const c = cats.get(x.categoria_id) ?? { id: x.categoria_id, nome: x.categoria, quartos: 0 };
        c.quartos++;
        cats.set(x.categoria_id, c);
      }
      return {
        id: a.id, nome: a.nome, tipo: a.tipo, token: a.token_reserva, config: (a.reserva_online ?? {}) as ConfigOnline,
        categorias: [...cats.values()],
        quartos: daqui.map((x: Record<string, unknown>) => ({ id: x.id, codigo: x.codigo, nome: x.nome, capacidade: x.capacidade, categoriaId: x.categoria_id, categoria: x.categoria })),
      };
    });
  }

  async salvarConfig(u: UsuarioToken, ambienteId: string, dto: ConfigReservaOnlineDto) {
    const [a] = await this.ds.query(`SELECT id FROM ambientes WHERE id = $1 AND empresa_id = $2 AND tipo IN ('hotel','pousada')`, [ambienteId, u.empresaId]);
    if (!a) throw new NotFoundException('Ambiente de hotel/pousada não encontrado.');
    if ((dto.sinalPct ?? 0) > 0 && !(await this.cobranca.ativa(u.empresaId))) {
      throw new BadRequestException('Para cobrar sinal por Pix, ligue antes a Cobrança automática (Asaas).');
    }
    if (dto.ativo && !dto.categorias.some((c) => c.ativo && c.diaria > 0)) {
      throw new BadRequestException('Ligue pelo menos uma categoria com o valor da diária.');
    }
    const cfg: ConfigOnline = {
      ativo: dto.ativo, confirmacao: dto.confirmacao, escolherQuarto: dto.escolherQuarto, mensagem: dto.mensagem?.trim() || undefined,
      minNoites: dto.minNoites ?? 1, maxNoites: dto.maxNoites ?? 30, janelaDias: dto.janelaDias ?? 365, whatsapp: (dto.whatsapp ?? '').replace(/\D/g, '') || undefined, sinalPct: dto.sinalPct ?? 0,
      categorias: Object.fromEntries(dto.categorias.map((c) => [c.categoriaId, { ativo: c.ativo, diaria: c.diaria, pessoaExtra: c.pessoaExtra ?? 0, descricao: c.descricao?.trim() || undefined }])),
      quartos: Object.fromEntries(dto.quartos.filter((q) => q.destaque?.trim() || q.acrescimo || q.oculto)
        .map((q) => [q.unidadeId, { destaque: q.destaque?.trim() || undefined, acrescimo: q.acrescimo || 0, oculto: !!q.oculto }])),
    };
    await this.ds.query(
      `UPDATE ambientes SET reserva_online = $3::jsonb, token_reserva = COALESCE(token_reserva, ${TOKEN}) WHERE id = $1 AND empresa_id = $2`,
      [ambienteId, u.empresaId, JSON.stringify(cfg)]);
    return { ok: true };
  }

  async novoLink(u: UsuarioToken, ambienteId: string) {
    await this.ds.query(`UPDATE ambientes SET token_reserva = ${TOKEN} WHERE id = $1 AND empresa_id = $2`, [ambienteId, u.empresaId]);
    return { ok: true };
  }

  async confirmar(u: UsuarioToken, id: string) {
    const r = await this.ds.query(
      `UPDATE reservas SET status = 'confirmada', vista_em = COALESCE(vista_em, now()), atualizado_em = now() WHERE id = $1 AND empresa_id = $2 AND status = 'pendente' RETURNING id`,
      [id, u.empresaId]);
    const linhas = Array.isArray(r?.[0]) ? r[0] : r;
    if (!linhas.length) throw new BadRequestException('Só dá para confirmar reserva que está aguardando.');
    return { ok: true };
  }

  // ---------------- público (o hóspede) ----------------

  private async ambientePorToken(token: string, q: Q = this.ds) {
    const [a] = await q.query(
      `SELECT a.id, a.nome, a.empresa_id, a.reserva_online, e.nome AS empresa FROM ambientes a JOIN empresas e ON e.id = a.empresa_id
        WHERE a.token_reserva = $1 AND a.ativo AND e.ativo`, [token]);
    const cfg = (a?.reserva_online ?? {}) as ConfigOnline;
    if (!a || !cfg.ativo) throw new NotFoundException('Reserva online indisponível neste link.');
    return { a, cfg };
  }

  async info(token: string) {
    const { a, cfg } = await this.ambientePorToken(token);
    const sinalPct = (cfg.sinalPct ?? 0) > 0 && (await this.cobranca.ativa(a.empresa_id)) ? cfg.sinalPct! : 0;
    const cats = await this.ds.query(
      `SELECT c.id, c.nome, c.descricao, c.foto, MAX(un.capacidade) AS capacidade, COUNT(un.id) AS quartos
         FROM categorias c JOIN unidades un ON un.categoria_id = c.id AND un.ativo AND un.ambiente_id = $1
        WHERE c.empresa_id = $2 GROUP BY c.id ORDER BY c.ordem, c.nome`, [a.id, a.empresa_id]);
    const pacotes = await this.ds.query(
      `SELECT id, nome, descricao, acrescimo, desconto_pct, desconto_valor, min_noites FROM promocoes
        WHERE empresa_id = $1 AND tipo = 'pacote' AND ativo AND (ambiente_id IS NULL OR ambiente_id = $2) AND (valido_ate IS NULL OR valido_ate >= $3::date)
          AND (limite_usos = 0 OR usos < limite_usos) ORDER BY nome`, [a.empresa_id, a.id, hojeSP()]).catch(() => []);
    const [cup] = await this.ds.query(`SELECT count(*)::int AS n FROM promocoes WHERE empresa_id = $1 AND tipo = 'cupom' AND ativo`, [a.empresa_id]).catch(() => [{ n: 0 }]);
    const [emp] = await this.ds.query(`SELECT fidelidade FROM empresas WHERE id = $1`, [a.empresa_id]).catch(() => [null]);
    const fid = (emp?.fidelidade ?? {}) as Fidelidade;
    return {
      pacotes: pacotes.map((p: Record<string, unknown>) => ({ id: p.id, nome: p.nome, descricao: p.descricao, acrescimo: Number(p.acrescimo), descontoPct: Number(p.desconto_pct), descontoValor: Number(p.desconto_valor), minNoites: Number(p.min_noites) })),
      temCupom: Number(cup?.n ?? 0) > 0,
      clube: fid.ativo ? `Clube de fidelidade: a cada ${fid.aCada} hospedagens, ${fid.descontoPct}% de desconto na próxima.` : null,
      hotel: a.empresa, ambiente: a.nome, mensagem: cfg.mensagem ?? null, escolherQuarto: !!cfg.escolherQuarto, confirmacao: cfg.confirmacao ?? 'recepcao',
      sinalPct, minNoites: cfg.minNoites ?? 1, maxNoites: cfg.maxNoites ?? 30, hoje: hojeSP(), ate: somaDias(hojeSP(), cfg.janelaDias ?? 365), whatsapp: cfg.whatsapp ?? null,
      categorias: cats.filter((c: { id: string }) => cfg.categorias?.[c.id]?.ativo && (cfg.categorias[c.id].diaria ?? 0) > 0).map((c: Record<string, unknown>) => ({
        id: c.id, nome: c.nome, descricao: cfg.categorias![c.id as string].descricao ?? c.descricao ?? null, foto: c.foto ?? null,
        capacidade: Number(c.capacidade ?? 2), diaria: cfg.categorias![c.id as string].diaria,
      })),
    };
  }

  private validarDatas(cfg: ConfigOnline, chegada: string, saida: string) {
    const hoje = hojeSP();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(chegada) || !/^\d{4}-\d{2}-\d{2}$/.test(saida)) throw new BadRequestException('Datas inválidas.');
    if (chegada < hoje) throw new BadRequestException('A data de chegada já passou.');
    if (chegada > somaDias(hoje, cfg.janelaDias ?? 365)) throw new BadRequestException('Ainda não abrimos reservas para essa data.');
    const n = noites(chegada, saida);
    if (n < (cfg.minNoites ?? 1)) throw new BadRequestException(`Mínimo de ${cfg.minNoites ?? 1} diária(s).`);
    if (n > (cfg.maxNoites ?? 30)) throw new BadRequestException(`Máximo de ${cfg.maxNoites ?? 30} diárias pela internet. Fale com a recepção.`);
    return n;
  }

  /** quartos livres no período (reservas, hóspedes na casa e bloqueios de hoje) */
  private async livres(q: Q, a: { id: string; empresa_id: string }, cfg: ConfigOnline, chegada: string, saida: string, pessoas: number) {
    const hoje = hojeSP();
    const uns = await q.query(
      `SELECT un.id, un.codigo, un.nome, un.capacidade, un.categoria_id, un.status FROM unidades un
        WHERE un.ambiente_id = $1 AND un.empresa_id = $2 AND un.ativo AND un.categoria_id IS NOT NULL AND un.coletivo IS NULL ORDER BY un.ordem, un.codigo`, [a.id, a.empresa_id]);
    const reservados = await q.query(
      `SELECT DISTINCT unidade_id FROM reservas WHERE empresa_id = $1 AND ambiente_id = $2 AND status IN ('pendente','confirmada','hospedada')
         AND chegada < $4::date AND saida > $3::date`, [a.empresa_id, a.id, chegada, saida]);
    const naCasa = await q.query(
      `SELECT DISTINCT unidade_id FROM estadias WHERE empresa_id = $1 AND ambiente_id = $2 AND status IN ('aberta','conta_entregue')
         AND COALESCE(saida_prevista, GREATEST($5::date + 1, (entrada_em AT TIME ZONE 'America/Sao_Paulo')::date + 1)) > $3::date
         AND (entrada_em AT TIME ZONE 'America/Sao_Paulo')::date < $4::date`, [a.empresa_id, a.id, chegada, saida, hoje]);
    const ocupados = new Set<string>([...reservados, ...naCasa].map((x: { unidade_id: string }) => x.unidade_id));
    const pertoDeHoje = chegada <= somaDias(hoje, 1);
    return uns.filter((x: { id: string; capacidade: number | null; categoria_id: string; status: string }) =>
      !ocupados.has(x.id) && !cfg.quartos?.[x.id]?.oculto && cfg.categorias?.[x.categoria_id]?.ativo
      && (x.capacidade ?? 2) >= pessoas && !(pertoDeHoje && x.status === 'bloqueada'));
  }

  private preco(cfg: ConfigOnline, categoriaId: string, unidadeId: string | null, n: number, pessoas: number) {
    const c = cfg.categorias?.[categoriaId];
    const extra = Math.max(0, pessoas - 2) * (c?.pessoaExtra ?? 0);
    const acrescimo = unidadeId ? cfg.quartos?.[unidadeId]?.acrescimo ?? 0 : 0;
    const diaria = r2((c?.diaria ?? 0) + extra + acrescimo);
    return { diaria, total: r2(diaria * n) };
  }

  async disponibilidade(token: string, chegada: string, saida: string, adultos: number, criancas: number) {
    const { a, cfg } = await this.ambientePorToken(token);
    const n = this.validarDatas(cfg, chegada, saida);
    const pessoas = Math.max(1, adultos) + Math.max(0, criancas);
    const livres = await this.livres(this.ds, a, cfg, chegada, saida, pessoas);
    const info = await this.info(token);
    return {
      noites: n,
      categorias: info.categorias.map((c: { id: string; nome: string }) => {
        const daCat = livres.filter((x: { categoria_id: string }) => x.categoria_id === c.id);
        return {
          id: c.id, nome: c.nome, livres: daCat.length, ...this.preco(cfg, c.id, null, n, pessoas),
          quartos: cfg.escolherQuarto ? daCat.map((x: { id: string; codigo: string; nome: string | null; capacidade: number }) => ({
            id: x.id, codigo: x.codigo, nome: x.nome, capacidade: x.capacidade, destaque: cfg.quartos?.[x.id]?.destaque ?? null,
            acrescimo: cfg.quartos?.[x.id]?.acrescimo ?? 0, ...this.preco(cfg, c.id, x.id, n, pessoas),
          })) : [],
        };
      }),
    };
  }

  /** o hóspede vê o total com pacote, cupom e clube antes de reservar */
  async simular(token: string, q: { chegada: string; saida: string; adultos: number; criancas: number; categoriaId: string; unidadeId?: string; cupom?: string; pacoteId?: string; telefone?: string; documento?: string }) {
    const { a, cfg } = await this.ambientePorToken(token);
    const n = this.validarDatas(cfg, q.chegada, q.saida);
    if (!cfg.categorias?.[q.categoriaId]?.ativo) throw new BadRequestException('Categoria indisponível.');
    const { total } = this.preco(cfg, q.categoriaId, q.unidadeId ?? null, n, Math.max(1, q.adultos) + Math.max(0, q.criancas));
    const r = await aplicarPromocoes(this.ds, { empresaId: a.empresa_id, ambienteId: a.id, total, noites: n, chegada: q.chegada, cupom: q.cupom, pacoteId: q.pacoteId, telefone: q.telefone, documento: q.documento });
    return { bruto: total, total: r.total, desconto: r.desconto, acrescimo: r.acrescimo, detalhes: r.detalhes, fidelidade: r.fidelidade };
  }

  /** guarda o contato de quem começou a reservar (para a recepção chamar se não terminar) */
  async rascunho(token: string, dto: RascunhoReservaDto) {
    const { a } = await this.ambientePorToken(token);
    const fone = dto.telefone.replace(/\D/g, '');
    if (fone.length < 10) return { ok: true };
    const [ja] = await this.ds.query(
      `SELECT id FROM reservas_rascunhos WHERE ambiente_id = $1 AND reserva_id IS NULL AND right(regexp_replace(telefone, '\\D', '', 'g'), 11) = right($2, 11) AND atualizado_em > now() - interval '2 days' LIMIT 1`, [a.id, fone]);
    const v = [dto.nome?.trim() || null, dto.telefone.trim(), dto.email?.trim() || null, dto.chegada || null, dto.saida || null, dto.adultos ?? null, dto.criancas ?? null, dto.categoriaId || null, dto.total ?? null];
    if (ja) await this.ds.query(`UPDATE reservas_rascunhos SET nome=COALESCE($2,nome), telefone=$3, email=COALESCE($4,email), chegada=COALESCE($5,chegada), saida=COALESCE($6,saida), adultos=COALESCE($7,adultos), criancas=COALESCE($8,criancas), categoria_id=COALESCE($9,categoria_id), total=COALESCE($10,total), atualizado_em=now() WHERE id=$1`, [ja.id, ...v]);
    else await this.ds.query(`INSERT INTO reservas_rascunhos (empresa_id, ambiente_id, nome, telefone, email, chegada, saida, adultos, criancas, categoria_id, total) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [a.empresa_id, a.id, ...v]);
    return { ok: true };
  }

  async reservar(token: string, dto: ReservaPublicaDto) {
    const { a, cfg } = await this.ambientePorToken(token);
    const n = this.validarDatas(cfg, dto.chegada, dto.saida);
    const pessoas = dto.adultos + (dto.criancas ?? 0);
    if (!cfg.categorias?.[dto.categoriaId]?.ativo) throw new BadRequestException('Categoria indisponível.');
    if (dto.unidadeId && !cfg.escolherQuarto) throw new BadRequestException('Este hotel não permite escolher o quarto.');
    const fone = dto.telefone.replace(/\D/g, '');
    if (fone.length < 10) throw new BadRequestException('Informe o telefone com DDD.');
    const [{ n: recentes }] = await this.ds.query(
      `SELECT COUNT(*)::int AS n FROM reservas WHERE empresa_id = $1 AND origem = 'Online' AND regexp_replace(coalesce(telefone,''),'\\D','','g') = $2 AND criado_em > now() - interval '1 hour'`,
      [a.empresa_id, fone]);
    if (recentes >= 3) throw new BadRequestException('Muitas reservas seguidas com este telefone. Fale com a recepção.');

    const sinalPct = (cfg.sinalPct ?? 0) > 0 && (await this.cobranca.ativa(a.empresa_id)) ? cfg.sinalPct! : 0;
    if (sinalPct > 0) {
      const cpf = (dto.documento ?? '').replace(/\D/g, '');
      if (cpf.length !== 11 && cpf.length !== 14) throw new BadRequestException('Informe o CPF para gerar o Pix do sinal.');
    }
    await conferirCpfLivre(this.ds, a.empresa_id, dto.documento, dto.chegada, dto.saida);
    // com sinal, a reserva só confirma quando o Pix for pago
    const status = sinalPct > 0 ? 'pendente' : cfg.confirmacao === 'automatica' ? 'confirmada' : 'pendente';
    const r = await this.ds.transaction(async (m) => {
      // uma reserva por vez neste hotel: dois hóspedes não pegam o mesmo quarto
      await m.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`reserva-online:${a.id}`]);
      const livres = await this.livres(m, a, cfg, dto.chegada, dto.saida, pessoas);
      const daCat = livres.filter((x: { categoria_id: string }) => x.categoria_id === dto.categoriaId);
      let quarto = dto.unidadeId ? daCat.find((x: { id: string }) => x.id === dto.unidadeId) : null;
      if (dto.unidadeId && !quarto) throw new BadRequestException('Esse quarto acabou de ser reservado. Escolha outro.');
      // sem escolha: primeiro quarto livre da categoria, preferindo os sem acréscimo
      if (!quarto) quarto = [...daCat].sort((x: { id: string }, y: { id: string }) => (cfg.quartos?.[x.id]?.acrescimo ?? 0) - (cfg.quartos?.[y.id]?.acrescimo ?? 0))[0];
      if (!quarto) throw new BadRequestException('Não há mais quartos livres nessa categoria para essas datas.');
      const { diaria, total: bruto } = this.preco(cfg, dto.categoriaId, dto.unidadeId ? quarto.id : null, n, pessoas);
      const promo = await aplicarPromocoes(m, { empresaId: a.empresa_id, ambienteId: a.id, total: bruto, noites: n, chegada: dto.chegada, cupom: dto.cupom, pacoteId: dto.pacoteId, telefone: dto.telefone, documento: dto.documento });
      const total = promo.total;
      const c = await m.query('UPDATE empresas SET ultima_reserva = ultima_reserva + 1 WHERE id = $1 RETURNING ultima_reserva', [a.empresa_id]);
      const linha = Array.isArray(c?.[0]) ? c[0][0] : c?.[0];
      const [cat] = await m.query(`SELECT nome FROM categorias WHERE id = $1`, [dto.categoriaId]);
      const codigo = novoCodigo();
      const [nova] = await m.query(
        `INSERT INTO reservas (empresa_id, numero, unidade_id, ambiente_id, hospede, telefone, email, documento, chegada, saida, adultos, criancas,
           valor_diaria, valor_total, sinal, origem, observacao, status, criado_por, vista_em, codigo_publico, categoria_pedida, quarto_escolhido)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,0,'Online',$15,$16,'Reserva online',NULL,$17,$18,$19) RETURNING id, numero`,
        [a.empresa_id, linha ? Number(linha.ultima_reserva) : null, quarto.id, a.id, dto.nome.trim(), dto.telefone.trim(), dto.email?.trim() || null,
          dto.documento?.trim() || null, dto.chegada, dto.saida, dto.adultos, dto.criancas ?? 0, diaria.toFixed(2), total.toFixed(2),
          [dto.observacao?.trim(), ...promo.detalhes].filter(Boolean).join(' · ').slice(0, 500) || null, status, codigo, cat?.nome ?? null, !!dto.unidadeId]);
      if (promo.desconto || promo.pacoteId || promo.cupomCodigo) {
        await m.query(`UPDATE reservas SET desconto = $2, cupom_codigo = $3, pacote_id = $4, pacote_nome = $5 WHERE id = $1`, [nova.id, promo.desconto.toFixed(2), promo.cupomCodigo, promo.pacoteId, promo.pacoteNome]);
        const usados = [promo.cupomId, promo.pacoteId].filter(Boolean);
        if (usados.length) await m.query(`UPDATE promocoes SET usos = usos + 1 WHERE id = ANY($1::uuid[])`, [usados]);
      }
      // quem tinha largado a reserva no meio e voltou: conta como recuperada
      await m.query(`UPDATE reservas_rascunhos SET reserva_id = $3 WHERE empresa_id = $1 AND reserva_id IS NULL AND right(regexp_replace(telefone, '\\D', '', 'g'), 11) = right($2, 11)`,
        [a.empresa_id, fone, nova.id]);
      return { ...nova, codigo, quarto, total, categoria: cat?.nome ?? '' };
    });
    const pix = sinalPct > 0
      ? await this.cobranca.pixReserva(a.empresa_id, { reservaId: r.id, numero: r.numero, nome: dto.nome.trim(), cpf: dto.documento ?? '', telefone: dto.telefone, email: dto.email, valor: r2((r.total * sinalPct) / 100) })
      : null;
    // empresa com servidor local: a reserva (e a cobrança do sinal) vai para lá pela ponte
    const [linha] = await this.ds.query(`SELECT * FROM reservas WHERE id = $1`, [r.id]);
    const cobrancas = await this.ds.query(`SELECT * FROM cobrancas WHERE tipo = 'reserva_sinal' AND referencia_id = $1`, [r.id]);
    await enviarParaLocal(this.ds, a.empresa_id, 'reserva', { reserva: linha, cobrancas });
    return {
      codigo: r.codigo, numero: r.numero, status, total: r.total, noites: n, categoria: r.categoria,
      quarto: dto.unidadeId ? r.quarto.codigo : null, sinal: sinalPct > 0 ? r2((r.total * sinalPct) / 100) : 0, pix,
    };
  }

  async consulta(codigo: string) {
    const [r] = await this.ds.query(
      `SELECT r.id, r.empresa_id, r.unidade_id, r.telefone, r.email, r.documento, r.sinal, r.numero, r.hospede, r.chegada, r.saida, r.adultos, r.criancas, r.valor_total, r.status, r.categoria_pedida, r.quarto_escolhido,
              un.codigo AS quarto, a.nome AS ambiente, a.reserva_online, e.nome AS hotel
         FROM reservas r JOIN unidades un ON un.id = r.unidade_id JOIN ambientes a ON a.id = r.ambiente_id JOIN empresas e ON e.id = r.empresa_id
        WHERE r.codigo_publico = $1`, [codigo]);
    if (!r) throw new NotFoundException('Reserva não encontrada. Confira o código.');
    const cfg = (r.reserva_online ?? {}) as ConfigOnline;
    const [pix] = r.status === 'pendente' ? await this.ds.query(
      `SELECT valor, pix_copia_cola, pix_imagem, vencimento FROM cobrancas WHERE tipo = 'reserva_sinal' AND referencia_id = $1 AND status = 'pendente' ORDER BY criado_em DESC LIMIT 1`, [r.id]) : [];
    // pré-check-in: o hóspede já preenche a ficha (documento e assinatura) pelo celular antes de chegar
    const ficha = ['pendente', 'confirmada'].includes(r.status) ? await fichaDaReserva(this.ds, r).catch(() => null) : null;
    return {
      preCheckin: ficha ? { token: ficha.token, preenchida: ficha.status === 'preenchida' } : null,
      pix: pix ? { valor: Number(pix.valor), copiaECola: pix.pix_copia_cola, imagem: pix.pix_imagem, vencimento: dia(pix.vencimento) } : null,
      sinalPago: Number(r.sinal ?? 0),
      numero: r.numero, hospede: String(r.hospede).split(' ')[0], chegada: dia(r.chegada), saida: dia(r.saida), adultos: r.adultos, criancas: r.criancas,
      total: Number(r.valor_total), status: r.status, categoria: r.categoria_pedida, hotel: r.hotel, ambiente: r.ambiente, whatsapp: cfg.whatsapp ?? null,
      // o número do quarto só aparece se o hóspede escolheu ou depois de confirmada
      quarto: r.quarto_escolhido || r.status === 'confirmada' || r.status === 'hospedada' ? r.quarto : null,
    };
  }
}
