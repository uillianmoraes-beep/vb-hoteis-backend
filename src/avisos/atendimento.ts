import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Injectable, Logger, Module, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomBytes, timingSafeEqual } from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { Publico } from '../common/decorators/publico.decorator';
import { UsuarioToken } from '../common/permissoes';
import { WhatsappModule, WhatsappService } from './whatsapp';

/**
 * WhatsApp com atendente: o provedor (Z-API ou Evolution) avisa o sistema a cada mensagem que chega;
 * cada cliente vira uma conversa que a recepção responde pela tela de Atendimento (com respostas prontas).
 * Quando ninguém assumiu a conversa, a IA pode responder sozinha com as informações que o gestor escreveu
 * (preços, endereço, regras) e passa para um atendente quando não souber ou o cliente pedir.
 */

const MARCA_ATENDENTE = '[ATENDENTE]';
const SISTEMA_IA = `Você atende pelo WhatsApp os clientes de um estabelecimento de hospedagem (motel, hotel ou pousada) no Brasil.
Regras:
- Responda em português do Brasil, curto (no máximo 4 linhas), simpático e direto, como uma recepcionista experiente. Pode usar no máximo um emoji.
- Use SÓ as informações do estabelecimento abaixo e a situação das suítes. Nunca invente preço, horário, promoção ou regra que não esteja escrito.
- Motel: discrição total. Nunca confirme se alguém está ou esteve no local, nunca fale de outros clientes, placas ou nomes.
- Não aceite reserva nem pagamento por conta própria: anote o que o cliente quer (data, horário, quantas pessoas, tipo de suíte) e diga que um atendente vai confirmar.
- Se não souber, se o cliente pedir para falar com uma pessoa, reclamar, falar de cobrança, objeto esquecido, emergência ou algo delicado, responda que vai chamar um atendente e termine a mensagem com ${MARCA_ATENDENTE}
- Nunca diga que é uma IA a não ser que perguntem; se perguntarem, diga que é o atendimento automático e que um atendente pode assumir.`;

const so = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const curta = (t: string) => t.replace(/\s+/g, ' ').trim().slice(0, 300);

class EnviarDto {
  @IsString() @MinLength(1) @MaxLength(4000) texto!: string;
}
class ConfigAtendimentoDto {
  @IsBoolean() iaAtendimento!: boolean;
  @IsOptional() @IsString() @MaxLength(6000) iaInfo?: string;
  @IsOptional() @IsBoolean() iaSoForaDoHorario?: boolean;
  @IsOptional() @IsString() @MaxLength(5) horaInicio?: string;
  @IsOptional() @IsString() @MaxLength(5) horaFim?: string;
}
class RespostaDto {
  @IsString() @MinLength(2) @MaxLength(60) titulo!: string;
  @IsString() @MinLength(2) @MaxLength(2000) texto!: string;
  @IsOptional() @IsInt() @Min(0) @Max(999) ordem?: number;
}
class NovaConversaDto {
  @IsString() @MinLength(10) @MaxLength(20) telefone!: string;
  @IsOptional() @IsString() @MaxLength(120) nome?: string;
}

interface ConfigAt { iaAtendimento?: boolean; iaInfo?: string; iaSoForaDoHorario?: boolean; horaInicio?: string; horaFim?: string; webhookSegredo?: string }
interface Entrada { telefone: string; nome: string | null; texto: string; idExterno: string | null; fromMe: boolean }

@Injectable()
export class AtendimentoService {
  private readonly log = new Logger('Atendimento');
  private readonly ia = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
  /** respostas da IA marcadas para daqui a alguns segundos (junta várias mensagens seguidas do cliente) */
  private readonly agendadas = new Map<string, NodeJS.Timeout>();

  constructor(private readonly ds: DataSource, private readonly zap: WhatsappService) {}

  private async config(empresaId: string): Promise<ConfigAt> {
    const [e] = await this.ds.query(`SELECT whatsapp_config FROM empresas WHERE id = $1`, [empresaId]);
    return (e?.whatsapp_config ?? {}) as ConfigAt;
  }

  /* ----------------------------------------------------------- configuração */

  async verConfig(u: UsuarioToken) {
    const c = await this.config(u.empresaId);
    let segredo = c.webhookSegredo;
    if (!segredo) {
      segredo = randomBytes(18).toString('base64url');
      await this.ds.query(`UPDATE empresas SET whatsapp_config = COALESCE(whatsapp_config, '{}'::jsonb) || jsonb_build_object('webhookSegredo', $2::text) WHERE id = $1`, [u.empresaId, segredo]);
    }
    return {
      iaAtendimento: !!c.iaAtendimento, iaInfo: c.iaInfo ?? '', iaSoForaDoHorario: !!c.iaSoForaDoHorario, horaInicio: c.horaInicio ?? '08:00', horaFim: c.horaFim ?? '22:00',
      iaDisponivel: !!this.ia,
      /** o endereço que o gestor cola no painel do provedor ("ao receber mensagem") */
      webhookCaminho: `/publico/whatsapp/${u.empresaId}/${segredo}`,
    };
  }

  async salvarConfig(u: UsuarioToken, dto: ConfigAtendimentoDto) {
    const hora = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (dto.horaInicio && !hora.test(dto.horaInicio)) throw new BadRequestException('Horário inválido.');
    if (dto.horaFim && !hora.test(dto.horaFim)) throw new BadRequestException('Horário inválido.');
    const extra = { iaAtendimento: dto.iaAtendimento, iaInfo: dto.iaInfo?.trim() ?? '', iaSoForaDoHorario: !!dto.iaSoForaDoHorario, horaInicio: dto.horaInicio ?? '08:00', horaFim: dto.horaFim ?? '22:00' };
    await this.ds.query(`UPDATE empresas SET whatsapp_config = COALESCE(whatsapp_config, '{}'::jsonb) || $2::jsonb WHERE id = $1`, [u.empresaId, JSON.stringify(extra)]);
    return this.verConfig(u);
  }

  /* -------------------------------------------------------------- webhook */

  /** o provedor manda aqui cada mensagem (Z-API "ao receber" ou Evolution "messages.upsert") */
  async receber(empresaId: string, segredo: string, corpo: Record<string, any>) {
    const c = await this.config(empresaId).catch(() => ({} as ConfigAt));
    const a = Buffer.from(segredo ?? ''), b = Buffer.from(c.webhookSegredo ?? '');
    if (!c.webhookSegredo || a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false };
    const e = this.ler(corpo);
    if (!e || !e.texto.trim()) return { ok: true, ignorada: true };
    await this.guardarEntrada(empresaId, e);
    return { ok: true };
  }

  /** traduz o aviso dos dois provedores para o mesmo formato */
  private ler(c: Record<string, any>): Entrada | null {
    // Evolution: { event: 'messages.upsert', data: { key: { remoteJid, fromMe, id }, pushName, message: { conversation | extendedTextMessage.text } } }
    if (c?.data?.key?.remoteJid) {
      const jid = String(c.data.key.remoteJid);
      if (jid.endsWith('@g.us') || jid.includes('status@')) return null;
      const m = c.data.message ?? {};
      const texto = m.conversation ?? m.extendedTextMessage?.text ?? m.imageMessage?.caption ?? (m.imageMessage ? '[foto]' : m.audioMessage ? '[áudio]' : m.documentMessage ? '[documento]' : m.locationMessage ? '[localização]' : '');
      return { telefone: so(jid.split('@')[0]), nome: c.data.pushName ?? null, texto: String(texto), idExterno: c.data.key.id ?? null, fromMe: !!c.data.key.fromMe };
    }
    // Z-API: { phone, fromMe, isGroup, senderName, messageId, text: { message }, image: { caption } }
    if (c?.phone) {
      if (c.isGroup || c.isNewsletter || String(c.phone).includes('-group')) return null;
      const texto = c.text?.message ?? c.image?.caption ?? (c.image ? '[foto]' : c.audio ? '[áudio]' : c.document ? '[documento]' : c.location ? '[localização]' : c.buttonsResponseMessage?.message ?? c.listResponseMessage?.title ?? '');
      return { telefone: so(c.phone), nome: c.senderName ?? c.chatName ?? null, texto: String(texto), idExterno: c.messageId ?? null, fromMe: !!c.fromMe };
    }
    return null;
  }

  private async guardarEntrada(empresaId: string, e: Entrada) {
    if (e.telefone.length < 10) return;
    // o provedor às vezes manda o mesmo aviso duas vezes
    if (e.idExterno) {
      const [ja] = await this.ds.query(`SELECT 1 FROM whatsapp_mensagens WHERE empresa_id = $1 AND id_externo = $2`, [empresaId, e.idExterno]);
      if (ja) return;
    }
    const [conv] = await this.ds.query(
      `INSERT INTO whatsapp_conversas (empresa_id, telefone, nome, status, ultima_mensagem, ultima_mensagem_em, nao_lidas)
       VALUES ($1,$2,$3,'aberta',$4,now(),$5)
       ON CONFLICT (empresa_id, telefone) DO UPDATE SET
         nome = COALESCE(whatsapp_conversas.nome, EXCLUDED.nome), ultima_mensagem = EXCLUDED.ultima_mensagem, ultima_mensagem_em = now(),
         nao_lidas = whatsapp_conversas.nao_lidas + EXCLUDED.nao_lidas,
         status = CASE WHEN whatsapp_conversas.status = 'encerrada' AND NOT $6 THEN 'aberta' ELSE whatsapp_conversas.status END,
         ia_ativa = CASE WHEN whatsapp_conversas.status = 'encerrada' AND NOT $6 THEN true ELSE whatsapp_conversas.ia_ativa END
       RETURNING id, status, ia_ativa`,
      [empresaId, e.telefone, e.fromMe ? null : e.nome, curta(e.texto), e.fromMe ? 0 : 1, e.fromMe]);
    const inseriu = await this.ds.query(
      `INSERT INTO whatsapp_mensagens (empresa_id, conversa_id, direcao, autor, autor_nome, texto, id_externo) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (empresa_id, id_externo) WHERE id_externo IS NOT NULL DO NOTHING RETURNING id`,
      [empresaId, conv.id, e.fromMe ? 'saida' : 'entrada', e.fromMe ? 'celular' : 'cliente', e.fromMe ? 'Celular do hotel' : e.nome, e.texto.slice(0, 4000), e.idExterno]);
    if (!inseriu.length || e.fromMe) return;
    if (conv.status !== 'atendimento' && conv.ia_ativa) this.agendarIa(empresaId, conv.id);
  }

  /* ------------------------------------------------------------------- IA */

  private dentroDoHorario(c: ConfigAt) {
    const h = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false });
    const i = c.horaInicio ?? '08:00', f = c.horaFim ?? '22:00';
    return i <= f ? h >= i && h < f : h >= i || h < f;
  }

  private agendarIa(empresaId: string, conversaId: string) {
    const ant = this.agendadas.get(conversaId);
    if (ant) clearTimeout(ant);
    this.agendadas.set(conversaId, setTimeout(() => {
      this.agendadas.delete(conversaId);
      void this.responderComIa(empresaId, conversaId).catch((err) => this.log.warn(`IA no WhatsApp: ${(err as Error).message}`));
    }, Number(process.env.WHATSAPP_IA_ESPERA_MS ?? 7000)));
  }

  async responderComIa(empresaId: string, conversaId: string) {
    const c = await this.config(empresaId);
    if (!this.ia || !c.iaAtendimento) return;
    if (c.iaSoForaDoHorario && this.dentroDoHorario(c)) return;
    const [conv] = await this.ds.query(`SELECT * FROM whatsapp_conversas WHERE id = $1 AND empresa_id = $2`, [conversaId, empresaId]);
    if (!conv || conv.status === 'atendimento' || conv.status === 'encerrada' || !conv.ia_ativa) return;
    const msgs: { direcao: string; autor: string; texto: string }[] = (await this.ds.query(
      `SELECT direcao, autor, texto FROM whatsapp_mensagens WHERE conversa_id = $1 ORDER BY criado_em DESC LIMIT 20`, [conversaId])).reverse();
    if (!msgs.length || msgs[msgs.length - 1].direcao !== 'entrada') return;
    // junta mensagens seguidas do mesmo lado (a API pede papéis alternados, começando pelo cliente)
    const conversa: Anthropic.MessageParam[] = [];
    for (const m of msgs) {
      const role = m.direcao === 'entrada' ? 'user' : 'assistant';
      const ultimo = conversa[conversa.length - 1];
      if (ultimo && ultimo.role === role) ultimo.content = `${ultimo.content as string}\n${m.texto}`;
      else conversa.push({ role, content: m.texto });
    }
    while (conversa.length && conversa[0].role !== 'user') conversa.shift();
    if (!conversa.length) return;

    const [emp] = await this.ds.query(`SELECT nome FROM empresas WHERE id = $1`, [empresaId]);
    const suites: { categoria: string; livres: number; total: number }[] = await this.ds.query(
      `SELECT COALESCE(c.nome, 'Suíte') AS categoria, count(*) FILTER (WHERE un.status = 'livre')::int AS livres, count(*)::int AS total
         FROM unidades un LEFT JOIN categorias c ON c.id = un.categoria_id WHERE un.empresa_id = $1 AND un.ativo GROUP BY 1 ORDER BY 1`, [empresaId]).catch(() => []);
    const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const contexto = [
      `Estabelecimento: ${emp?.nome ?? ''}. Agora: ${agora} (Brasília).`,
      `Informações escritas pelo gestor (use só isto para preços, endereço e regras):\n${c.iaInfo?.trim() || '(o gestor ainda não escreveu as informações: para qualquer pergunta de preço ou regra, chame um atendente)'}`,
      suites.length ? `Suítes livres agora: ${suites.map((s) => `${s.categoria} ${s.livres} de ${s.total}`).join('; ')}. (Disponibilidade muda a todo momento; não garanta suíte para depois.)` : '',
      `Nome do cliente no WhatsApp: ${conv.nome ?? 'não informado'}.`,
    ].filter(Boolean).join('\n\n');

    let texto = '';
    try {
      const r = await this.ia.messages.create({
        model: 'claude-opus-5-5',
        max_tokens: 1000,
        system: [{ type: 'text', text: SISTEMA_IA, cache_control: { type: 'ephemeral' } }, { type: 'text', text: contexto }],
        messages: conversa,
      });
      if (r.stop_reason === 'refusal') texto = `Vou chamar um atendente para falar com você. ${MARCA_ATENDENTE}`;
      else texto = r.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
    } catch (e) {
      this.log.warn(`IA do WhatsApp não respondeu: ${(e as Error).message}`);
      return;
    }
    if (!texto) return;
    // o cliente pode ter mandado outra mensagem ou um atendente pode ter assumido enquanto a IA pensava
    const [agoraConv] = await this.ds.query(`SELECT status, ia_ativa FROM whatsapp_conversas WHERE id = $1`, [conversaId]);
    if (!agoraConv || agoraConv.status === 'atendimento' || !agoraConv.ia_ativa) return;
    const chamar = texto.includes(MARCA_ATENDENTE);
    const limpo = texto.split(MARCA_ATENDENTE).join('').trim();
    if (limpo) {
      const ok = await this.zap.enviar(empresaId, conv.telefone, limpo, 'atendimento-ia');
      await this.ds.query(`INSERT INTO whatsapp_mensagens (empresa_id, conversa_id, direcao, autor, autor_nome, texto, enviada) VALUES ($1,$2,'saida','ia','Atendimento automático',$3,$4)`,
        [empresaId, conversaId, limpo, ok]);
    }
    await this.ds.query(
      `UPDATE whatsapp_conversas SET status = $2, ia_ativa = $3, ultima_mensagem = COALESCE($4, ultima_mensagem), ultima_mensagem_em = now() WHERE id = $1`,
      [conversaId, chamar ? 'aberta' : 'ia', !chamar, limpo ? curta(limpo) : null]);
  }

  /* ----------------------------------------------------------- atendente */

  async conversas(u: UsuarioToken, filtro?: string, busca?: string) {
    const p: unknown[] = [u.empresaId];
    let w = '';
    if (filtro === 'minhas') { p.push(u.sub); w += ` AND atendente_id = $${p.length} AND status = 'atendimento'`; }
    else if (filtro === 'encerradas') w += ` AND status = 'encerrada'`;
    else w += ` AND status <> 'encerrada'`;
    if (busca?.trim()) { p.push(`%${busca.trim().toLowerCase()}%`); w += ` AND (lower(COALESCE(nome,'')) LIKE $${p.length} OR telefone LIKE $${p.length})`; }
    const l: Record<string, unknown>[] = await this.ds.query(
      `SELECT * FROM whatsapp_conversas WHERE empresa_id = $1${w} ORDER BY (status = 'aberta' AND nao_lidas > 0) DESC, ultima_mensagem_em DESC LIMIT 300`, p);
    const [tot] = await this.ds.query(
      `SELECT count(*) FILTER (WHERE status = 'aberta')::int AS aguardando, count(*) FILTER (WHERE status = 'ia')::int AS ia,
              count(*) FILTER (WHERE status = 'atendimento')::int AS atendimento FROM whatsapp_conversas WHERE empresa_id = $1`, [u.empresaId]);
    return {
      conversas: l.map((c) => this.fmt(c)),
      resumo: { aguardando: Number(tot?.aguardando ?? 0), ia: Number(tot?.ia ?? 0), atendimento: Number(tot?.atendimento ?? 0) },
    };
  }

  private fmt(c: Record<string, unknown>) {
    return {
      id: c.id, telefone: c.telefone, nome: c.nome, status: c.status, atendenteId: c.atendente_id, atendente: c.atendente_nome, iaAtiva: c.ia_ativa,
      naoLidas: Number(c.nao_lidas), ultimaMensagem: c.ultima_mensagem, ultimaMensagemEm: c.ultima_mensagem_em,
    };
  }

  private async conversa(u: UsuarioToken, id: string) {
    const [c] = await this.ds.query(`SELECT * FROM whatsapp_conversas WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!c) throw new NotFoundException('Conversa não encontrada.');
    return c as Record<string, string | boolean | number | null>;
  }

  async mensagens(u: UsuarioToken, id: string) {
    const c = await this.conversa(u, id);
    const l = await this.ds.query(
      `SELECT id, direcao, autor, autor_nome, texto, enviada, criado_em FROM whatsapp_mensagens WHERE conversa_id = $1 ORDER BY criado_em DESC LIMIT 200`, [id]);
    if (Number(c.nao_lidas)) await this.ds.query(`UPDATE whatsapp_conversas SET nao_lidas = 0 WHERE id = $1`, [id]);
    // o que se sabe do cliente pelo telefone (reservas e hospedagens)
    const fone = String(c.telefone).slice(-11);
    const reservas = await this.ds.query(
      `SELECT numero, hospede, to_char(chegada, 'YYYY-MM-DD') AS chegada, to_char(saida, 'YYYY-MM-DD') AS saida, status FROM reservas
        WHERE empresa_id = $1 AND regexp_replace(COALESCE(telefone,''), '\\D', '', 'g') LIKE $2 ORDER BY chegada DESC LIMIT 5`, [u.empresaId, `%${fone}`]).catch(() => []);
    return {
      conversa: this.fmt(c),
      mensagens: l.reverse().map((m: Record<string, unknown>) => ({ id: m.id, direcao: m.direcao, autor: m.autor, autorNome: m.autor_nome, texto: m.texto, enviada: m.enviada, em: m.criado_em })),
      reservas,
    };
  }

  async enviar(u: UsuarioToken, id: string, dto: EnviarDto) {
    const c = await this.conversa(u, id);
    const texto = dto.texto.trim();
    if (!texto) throw new BadRequestException('Escreva a mensagem.');
    const ok = await this.zap.enviar(u.empresaId, String(c.telefone), texto, 'atendimento');
    await this.ds.query(`INSERT INTO whatsapp_mensagens (empresa_id, conversa_id, direcao, autor, autor_nome, texto, enviada) VALUES ($1,$2,'saida','atendente',$3,$4,$5)`,
      [u.empresaId, id, u.nome, texto, ok]);
    // quem responde assume a conversa (a IA para)
    await this.ds.query(
      `UPDATE whatsapp_conversas SET status = 'atendimento', atendente_id = $2, atendente_nome = $3, ia_ativa = false, nao_lidas = 0, ultima_mensagem = $4, ultima_mensagem_em = now() WHERE id = $1`,
      [id, u.sub, u.nome, curta(texto)]);
    const t = this.agendadas.get(id); if (t) { clearTimeout(t); this.agendadas.delete(id); }
    if (!ok) throw new BadRequestException('A mensagem ficou guardada, mas o WhatsApp não enviou. Confira em Ajustes › WhatsApp se o celular do provedor está conectado.');
    return this.mensagens(u, id);
  }

  async assumir(u: UsuarioToken, id: string) {
    await this.conversa(u, id);
    await this.ds.query(`UPDATE whatsapp_conversas SET status = 'atendimento', atendente_id = $2, atendente_nome = $3, ia_ativa = false WHERE id = $1`, [id, u.sub, u.nome]);
    const t = this.agendadas.get(id); if (t) { clearTimeout(t); this.agendadas.delete(id); }
    return this.mensagens(u, id);
  }

  /** devolve para a IA (ou deixa aguardando outro atendente) */
  async soltar(u: UsuarioToken, id: string) {
    await this.conversa(u, id);
    await this.ds.query(`UPDATE whatsapp_conversas SET status = 'aberta', atendente_id = NULL, atendente_nome = NULL, ia_ativa = true WHERE id = $1`, [id]);
    return this.mensagens(u, id);
  }

  async encerrar(u: UsuarioToken, id: string) {
    await this.conversa(u, id);
    await this.ds.query(`UPDATE whatsapp_conversas SET status = 'encerrada', nao_lidas = 0, ia_ativa = true WHERE id = $1`, [id]);
    return { ok: true };
  }

  /** começa uma conversa com um número (ex.: cliente que ligou) */
  async nova(u: UsuarioToken, dto: NovaConversaDto) {
    let fone = so(dto.telefone);
    if (fone.length === 10 || fone.length === 11) fone = `55${fone}`;
    if (fone.length < 12) throw new BadRequestException('Telefone com DDD, por favor.');
    const [c] = await this.ds.query(
      `INSERT INTO whatsapp_conversas (empresa_id, telefone, nome, status, atendente_id, atendente_nome, ia_ativa) VALUES ($1,$2,$3,'atendimento',$4,$5,false)
       ON CONFLICT (empresa_id, telefone) DO UPDATE SET status = 'atendimento', atendente_id = $4, atendente_nome = $5, ia_ativa = false, nome = COALESCE(EXCLUDED.nome, whatsapp_conversas.nome)
       RETURNING id`, [u.empresaId, fone, dto.nome?.trim() || null, u.sub, u.nome]);
    return { id: c.id };
  }

  /* ----------------------------------------------------- respostas prontas */

  async respostas(u: UsuarioToken) {
    return (await this.ds.query(`SELECT id, titulo, texto, ordem FROM whatsapp_respostas WHERE empresa_id = $1 ORDER BY ordem, titulo`, [u.empresaId]));
  }
  async salvarResposta(u: UsuarioToken, dto: RespostaDto, id?: string) {
    if (id) await this.ds.query(`UPDATE whatsapp_respostas SET titulo = $3, texto = $4, ordem = $5 WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId, dto.titulo.trim(), dto.texto.trim(), dto.ordem ?? 0]);
    else await this.ds.query(`INSERT INTO whatsapp_respostas (empresa_id, titulo, texto, ordem) VALUES ($1,$2,$3,$4)`, [u.empresaId, dto.titulo.trim(), dto.texto.trim(), dto.ordem ?? 0]);
    return this.respostas(u);
  }
  async apagarResposta(u: UsuarioToken, id: string) {
    await this.ds.query(`DELETE FROM whatsapp_respostas WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    return this.respostas(u);
  }
}

@Controller()
export class AtendimentoController {
  constructor(private readonly service: AtendimentoService) {}

  /** aviso do provedor de WhatsApp (sem login; protegido pelo segredo no endereço) */
  @Publico() @Post('publico/whatsapp/:empresaId/:segredo') @HttpCode(200)
  receber(@Param('empresaId', ParseUUIDPipe) empresaId: string, @Param('segredo') segredo: string, @Body() corpo: Record<string, any>) {
    return this.service.receber(empresaId, segredo, corpo ?? {});
  }

  @Get('atendimento/config') @Requer('empresa.editar', 'reservas.gerenciar', 'estadias.operar')
  verConfig(@Usuario() u: UsuarioToken) { return this.service.verConfig(u); }

  @Put('atendimento/config') @Requer('empresa.editar')
  salvarConfig(@Usuario() u: UsuarioToken, @Body() dto: ConfigAtendimentoDto) { return this.service.salvarConfig(u, dto); }

  @Get('atendimento/conversas') @Requer('estadias.operar', 'reservas.gerenciar', 'painel.ver')
  conversas(@Usuario() u: UsuarioToken, @Query('filtro') filtro?: string, @Query('busca') busca?: string) { return this.service.conversas(u, filtro, busca); }

  @Post('atendimento/conversas') @Requer('estadias.operar', 'reservas.gerenciar')
  nova(@Usuario() u: UsuarioToken, @Body() dto: NovaConversaDto) { return this.service.nova(u, dto); }

  @Get('atendimento/conversas/:id') @Requer('estadias.operar', 'reservas.gerenciar', 'painel.ver')
  mensagens(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.mensagens(u, id); }

  @Post('atendimento/conversas/:id/mensagens') @HttpCode(200) @Requer('estadias.operar', 'reservas.gerenciar')
  enviar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EnviarDto) { return this.service.enviar(u, id, dto); }

  @Post('atendimento/conversas/:id/assumir') @HttpCode(200) @Requer('estadias.operar', 'reservas.gerenciar')
  assumir(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.assumir(u, id); }

  @Post('atendimento/conversas/:id/soltar') @HttpCode(200) @Requer('estadias.operar', 'reservas.gerenciar')
  soltar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.soltar(u, id); }

  @Post('atendimento/conversas/:id/encerrar') @HttpCode(200) @Requer('estadias.operar', 'reservas.gerenciar')
  encerrar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.encerrar(u, id); }

  @Get('atendimento/respostas') @Requer('estadias.operar', 'reservas.gerenciar')
  respostas(@Usuario() u: UsuarioToken) { return this.service.respostas(u); }

  @Post('atendimento/respostas') @Requer('empresa.editar', 'reservas.gerenciar')
  criarResposta(@Usuario() u: UsuarioToken, @Body() dto: RespostaDto) { return this.service.salvarResposta(u, dto); }

  @Put('atendimento/respostas/:id') @Requer('empresa.editar', 'reservas.gerenciar')
  editarResposta(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RespostaDto) { return this.service.salvarResposta(u, dto, id); }

  @Delete('atendimento/respostas/:id') @Requer('empresa.editar', 'reservas.gerenciar')
  apagarResposta(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.apagarResposta(u, id); }
}

@Module({ imports: [WhatsappModule], providers: [AtendimentoService], controllers: [AtendimentoController] })
export class AtendimentoModule {}
