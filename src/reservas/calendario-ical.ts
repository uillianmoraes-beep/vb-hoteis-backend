import { BadRequestException, Body, Controller, Delete, Get, Header, HttpCode, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { lookup } from 'dns/promises';
import { isIP } from 'net';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { Publico } from '../common/decorators/publico.decorator';
import { UsuarioToken } from '../common/permissoes';

/**
 * Calendário com Airbnb, Booking e outros (iCal, sem contrato):
 * - cada quarto tem um link .ics com os dias ocupados no VB (reservas, hóspedes na casa) para colar no Airbnb/Booking;
 * - o VB lê o link .ics que o Airbnb/Booking dá e cria as reservas de lá no quarto (atualiza e cancela também), a cada 30 minutos.
 * Assim um quarto vendido num lugar fica fechado nos outros. Preço e disponibilidade em tempo real exigem um channel manager (contrato).
 */

const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const dia = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10));
const somaDias = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const TOKEN = `substr(md5(random()::text || clock_timestamp()::text || gen_random_uuid()::text), 1, 24)`;
const linhas = <T,>(r: unknown): T[] => (Array.isArray(r) && Array.isArray(r[0]) ? r[0] : (r as T[]));
/** só sites de reserva conhecidos (o servidor não busca endereço qualquer) */
const SITES = /(^|\.)(airbnb\.[a-z.]+|booking\.com|expedia\.[a-z.]+|vrbo\.com|homeaway\.[a-z.]+|hotels\.com|decolar\.com|despegar\.com|tripadvisor\.[a-z.]+|google\.com|googleusercontent\.com|hostfully\.com|hospedin\.com|cloudbeds\.com|omnibees\.com|hsystem\.com\.br|stays\.net|smoobu\.com|lodgify\.com)$/i;

class CalendarioDto {
  @IsUUID() unidadeId!: string;
  @IsString() @MinLength(2) @MaxLength(40) nome!: string;
  @IsString() @MinLength(10) @MaxLength(1000) url!: string;
}

interface Evento { uid: string; inicio: string; fim: string; resumo: string }

/** lê os eventos de um arquivo .ics (datas no formato do iCal: 20261110 ou 20261110T150000Z) */
export function lerIcal(texto: string): Evento[] {
  const desdobrado = texto.replace(/\r?\n[ \t]/g, '');
  const eventos: Evento[] = [];
  for (const bloco of desdobrado.split('BEGIN:VEVENT').slice(1)) {
    const corpo = bloco.split('END:VEVENT')[0];
    const campo = (nome: string) => {
      const m = new RegExp(`^${nome}(?:;[^:\\r\\n]*)?:(.*)$`, 'mi').exec(corpo);
      return m ? m[1].trim() : '';
    };
    const data = (v: string) => (/^\d{8}/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : '');
    const inicio = data(campo('DTSTART'));
    let fim = data(campo('DTEND'));
    if (!inicio) continue;
    if (!fim || fim <= inicio) fim = somaDias(inicio, 1);
    const uid = campo('UID') || `${inicio}-${fim}`;
    eventos.push({ uid: uid.slice(0, 200), inicio, fim, resumo: campo('SUMMARY').replace(/\\,/g, ',').replace(/\\n/g, ' ').slice(0, 120) });
  }
  return eventos;
}

/** endereço que o servidor pode buscar: https, site de reserva conhecido e IP público */
async function conferirUrl(url: string) {
  let u: URL;
  try { u = new URL(url.trim()); } catch { throw new BadRequestException('Link inválido.'); }
  if (u.protocol !== 'https:') throw new BadRequestException('O link precisa começar com https://');
  if (!SITES.test(u.hostname)) throw new BadRequestException('Use o link de calendário (.ics) do Airbnb, Booking, Expedia, VRBO, Google Agenda ou outro site de reservas conhecido.');
  const ips: { address: string }[] = await lookup(u.hostname, { all: true }).catch(() => []);
  const privado = (ip: string) => /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|::1|fc|fd|fe80)/i.test(ip);
  if (!ips.length || ips.some((x) => !isIP(x.address) || privado(x.address))) throw new BadRequestException('Não consegui chegar nesse endereço.');
  return u.toString();
}

@Injectable()
export class CalendarioIcalService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Calendario');
  private timer: ReturnType<typeof setInterval> | null = null;
  private rodando = false;

  constructor(private readonly ds: DataSource) {}

  onModuleInit() {
    this.timer = setInterval(() => { void this.sincronizarTodos(); }, 30 * 60_000);
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async ver(u: UsuarioToken) {
    await this.ds.query(`UPDATE unidades SET ical_token = ${TOKEN} WHERE empresa_id = $1 AND ical_token IS NULL`, [u.empresaId]);
    const uns = await this.ds.query(
      `SELECT un.id, un.codigo, un.nome, un.ical_token, a.nome AS ambiente, c.nome AS categoria FROM unidades un JOIN ambientes a ON a.id = un.ambiente_id LEFT JOIN categorias c ON c.id = un.categoria_id
        WHERE un.empresa_id = $1 AND un.ativo AND a.tipo IN ('hotel','pousada') ORDER BY a.ordem, a.nome, un.ordem, un.codigo`, [u.empresaId]);
    const cals = await this.ds.query(`SELECT * FROM calendarios_externos WHERE empresa_id = $1 ORDER BY nome`, [u.empresaId]);
    return uns.map((x: Record<string, unknown>) => ({
      id: x.id, codigo: x.codigo, nome: x.nome, ambiente: x.ambiente, categoria: x.categoria, token: x.ical_token,
      externos: cals.filter((c: Record<string, unknown>) => c.unidade_id === x.id).map((c: Record<string, unknown>) => ({
        id: c.id, nome: c.nome, url: c.url, ultimoSync: c.ultimo_sync, ultimoErro: c.ultimo_erro, eventos: Number(c.eventos ?? 0),
      })),
    }));
  }

  async adicionar(u: UsuarioToken, dto: CalendarioDto) {
    const [un] = await this.ds.query(`SELECT id FROM unidades WHERE id = $1 AND empresa_id = $2`, [dto.unidadeId, u.empresaId]);
    if (!un) throw new NotFoundException('Quarto não encontrado.');
    const url = await conferirUrl(dto.url);
    const [c] = await this.ds.query(
      `INSERT INTO calendarios_externos (empresa_id, unidade_id, nome, url, criado_por) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [u.empresaId, dto.unidadeId, dto.nome.trim(), url, u.nome]);
    const r = await this.sincronizar(c.id);
    return { ok: true, id: c.id, ...r };
  }

  async remover(u: UsuarioToken, id: string) {
    await this.ds.query(`DELETE FROM calendarios_externos WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    return { ok: true };
  }

  async sincronizarEmpresa(u: UsuarioToken) {
    const cals = await this.ds.query(`SELECT id FROM calendarios_externos WHERE empresa_id = $1 AND ativo`, [u.empresaId]);
    const res = { novas: 0, mudadas: 0, canceladas: 0, erros: 0 };
    for (const c of cals) {
      const r = await this.sincronizar(c.id);
      res.novas += r.novas; res.mudadas += r.mudadas; res.canceladas += r.canceladas; if (r.erro) res.erros++;
    }
    return res;
  }

  private async sincronizarTodos() {
    if (this.rodando) return;
    this.rodando = true;
    try {
      const cals = await this.ds.query(`SELECT id FROM calendarios_externos WHERE ativo`).catch(() => []);
      for (const c of cals) await this.sincronizar(c.id);
    } finally { this.rodando = false; }
  }

  /** lê o calendário de fora e acerta as reservas daquele quarto */
  async sincronizar(id: string): Promise<{ novas: number; mudadas: number; canceladas: number; erro: string | null }> {
    const res = { novas: 0, mudadas: 0, canceladas: 0, erro: null as string | null };
    const [c] = await this.ds.query(
      `SELECT c.*, un.ambiente_id, un.codigo FROM calendarios_externos c JOIN unidades un ON un.id = c.unidade_id WHERE c.id = $1`, [id]);
    if (!c) return res;
    try {
      // segue no máximo 3 redirecionamentos, conferindo cada endereço
      let url = await conferirUrl(c.url);
      let r = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': 'VB-Hoteis-Calendario/1.0' }, redirect: 'manual' });
      for (let i = 0; i < 3 && r.status >= 300 && r.status < 400 && r.headers.get('location'); i++) {
        url = await conferirUrl(new URL(r.headers.get('location')!, url).toString());
        r = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': 'VB-Hoteis-Calendario/1.0' }, redirect: 'manual' });
      }
      if (!r.ok) throw new Error(`o site respondeu ${r.status}`);
      const texto = (await r.text()).slice(0, 3_000_000);
      if (!texto.includes('BEGIN:VCALENDAR')) throw new Error('o link não é um calendário (.ics)');
      const hoje = hojeSP();
      const eventos = lerIcal(texto).filter((e) => e.fim >= hoje && e.inicio <= somaDias(hoje, 730));
      const existentes: Record<string, unknown>[] = await this.ds.query(
        `SELECT id, externo_uid, chegada, saida, status FROM reservas WHERE calendario_id = $1`, [id]);
      const porUid = new Map(existentes.map((x) => [x.externo_uid as string, x]));
      for (const e of eventos) {
        const ja = porUid.get(e.uid);
        if (ja) {
          if (['pendente', 'confirmada'].includes(ja.status as string) && (dia(ja.chegada) !== e.inicio || dia(ja.saida) !== e.fim)) {
            await this.ds.query(`UPDATE reservas SET chegada = $2, saida = $3, atualizado_em = now(), vista_em = NULL WHERE id = $1`, [ja.id, e.inicio, e.fim]);
            res.mudadas++;
          }
          continue;
        }
        const bloqueio = /not available|indispon|blocked|bloque|closed/i.test(e.resumo);
        const nome = bloqueio ? `Bloqueio ${c.nome}` : (e.resumo && !/^reserved$|^reservado$|^closed/i.test(e.resumo) ? `${e.resumo} (${c.nome})` : `Reserva ${c.nome}`);
        const [conflito] = await this.ds.query(
          `SELECT numero, hospede FROM reservas WHERE unidade_id = $1 AND status IN ('pendente','confirmada','hospedada') AND chegada < $3 AND saida > $2 AND COALESCE(calendario_id::text, '') <> $4 LIMIT 1`,
          [c.unidade_id, e.inicio, e.fim, id]);
        const n = await this.ds.query('UPDATE empresas SET ultima_reserva = ultima_reserva + 1 WHERE id = $1 RETURNING ultima_reserva', [c.empresa_id]);
        const num = linhas<{ ultima_reserva: number }>(n)[0]?.ultima_reserva ?? null;
        await this.ds.query(
          `INSERT INTO reservas (empresa_id, numero, unidade_id, ambiente_id, hospede, chegada, saida, adultos, criancas, valor_diaria, valor_total, sinal, origem, observacao, status, criado_por, calendario_id, externo_uid)
           VALUES ($1,$2,$3,$4,$5,$6,$7,2,0,0,0,0,$8,$9,'confirmada',$10,$11,$12)`,
          [c.empresa_id, num, c.unidade_id, c.ambiente_id, nome.slice(0, 120), e.inicio, e.fim, c.nome.slice(0, 30),
            [`Veio do calendário do ${c.nome}. Valor e dados do hóspede estão no ${c.nome}.`, conflito ? `ATENÇÃO: cruza com a reserva nº ${conflito.numero ?? '—'} (${conflito.hospede}) no mesmo quarto.` : ''].filter(Boolean).join(' ').slice(0, 500),
            `Calendário ${c.nome}`.slice(0, 120), id, e.uid]);
        res.novas++;
      }
      // saiu do calendário de lá (cancelada no Airbnb/Booking): cancela aqui também, se ainda não chegou
      const uids = new Set(eventos.map((e) => e.uid));
      for (const x of existentes) {
        if (uids.has(x.externo_uid as string) || !['pendente', 'confirmada'].includes(x.status as string) || dia(x.chegada) < hoje) continue;
        await this.ds.query(`UPDATE reservas SET status = 'cancelada', motivo_cancelamento = $2, atualizado_em = now() WHERE id = $1`, [x.id, `Saiu do calendário do ${c.nome}`.slice(0, 300)]);
        res.canceladas++;
      }
      await this.ds.query(`UPDATE calendarios_externos SET ultimo_sync = now(), ultimo_erro = NULL, eventos = $2 WHERE id = $1`, [id, eventos.length]);
    } catch (e) {
      res.erro = e instanceof Error ? e.message : String(e);
      await this.ds.query(`UPDATE calendarios_externos SET ultimo_sync = now(), ultimo_erro = $2 WHERE id = $1`, [id, res.erro.slice(0, 300)]).catch(() => undefined);
      this.log.warn(`Calendário ${id}: ${res.erro}`);
    }
    return res;
  }

  /** o .ics do quarto (dias ocupados no VB) para o Airbnb/Booking ler */
  async exportar(token: string) {
    const [un] = await this.ds.query(`SELECT un.id, un.codigo, e.nome AS empresa FROM unidades un JOIN empresas e ON e.id = un.empresa_id WHERE un.ical_token = $1`, [token]);
    if (!un) throw new NotFoundException('Calendário não encontrado.');
    const hoje = hojeSP();
    const res = await this.ds.query(
      `SELECT id, chegada, saida FROM reservas WHERE unidade_id = $1 AND status IN ('pendente','confirmada','hospedada') AND saida >= $2::date - 1`, [un.id, hoje]);
    const casa = await this.ds.query(
      `SELECT id, (entrada_em AT TIME ZONE 'America/Sao_Paulo')::date AS chegada, COALESCE(saida_prevista, GREATEST($2::date + 1, (entrada_em AT TIME ZONE 'America/Sao_Paulo')::date + 1)) AS saida
         FROM estadias WHERE unidade_id = $1 AND status IN ('aberta','conta_entregue') AND NOT EXISTS (SELECT 1 FROM reservas r WHERE r.estadia_id = estadias.id)`, [un.id, hoje]);
    const d8 = (d: string) => d.replace(/-/g, '');
    const agora = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
    const ev = [...res, ...casa].map((x: Record<string, unknown>) => [
      'BEGIN:VEVENT', `UID:${x.id}@vbhoteis`, `DTSTAMP:${agora}`, `DTSTART;VALUE=DATE:${d8(dia(x.chegada))}`, `DTEND;VALUE=DATE:${d8(dia(x.saida))}`, 'SUMMARY:Ocupado', 'END:VEVENT',
    ].join('\r\n'));
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//VB Hoteis//Calendario//PT', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${String(un.empresa).replace(/[\r\n,;]/g, ' ')} ${un.codigo}`, ...ev, 'END:VCALENDAR', ''].join('\r\n');
  }
}

@Controller()
export class CalendarioIcalController {
  constructor(private readonly service: CalendarioIcalService) {}

  @Publico() @Get('publico/ical/:token') @Header('Content-Type', 'text/calendar; charset=utf-8')
  exportar(@Param('token') token: string) { return this.service.exportar(String(token).replace(/\.ics$/i, '').slice(0, 40)); }

  @Get('calendarios') @Requer('reservas.gerenciar')
  ver(@Usuario() u: UsuarioToken) { return this.service.ver(u); }

  @Post('calendarios') @Requer('reservas.gerenciar')
  adicionar(@Usuario() u: UsuarioToken, @Body() dto: CalendarioDto) { return this.service.adicionar(u, dto); }

  @Delete('calendarios/:id') @Requer('reservas.gerenciar')
  remover(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.remover(u, id); }

  @Post('calendarios/sincronizar') @HttpCode(200) @Requer('reservas.gerenciar')
  sincronizar(@Usuario() u: UsuarioToken) { return this.service.sincronizarEmpresa(u); }
}
