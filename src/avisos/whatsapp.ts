import { BadRequestException, Body, Controller, Get, HttpCode, Injectable, Logger, Module, OnModuleDestroy, OnModuleInit, Post, Put } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';
import { cifrar, decifrar } from '../common/cripto';

/**
 * WhatsApp automático: o sistema manda sozinho a mensagem para o hóspede pelo número do hotel, usando um
 * provedor de WhatsApp contratado pela empresa (Z-API ou Evolution API):
 * - confirmação da reserva online (com o link para acompanhar e fazer o pré-check-in);
 * - lembrete na véspera da chegada (com o link do pré-check-in).
 * Sem provedor, tudo continua com o botão "Mandar no WhatsApp" (abre a conversa para a recepção enviar).
 */

const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const horaSP = () => new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false });
const somaDias = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const br = (d: string) => d.split('-').reverse().join('/');
const dia = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10));

interface ConfigZap {
  ativo?: boolean; provedor?: 'zapi' | 'evolution'; instancia?: string; url?: string; tokenCripto?: string; clientTokenCripto?: string;
  confirmacao?: boolean; lembrete?: boolean; ultimoLembrete?: string; site?: string;
}
class ConfigZapDto {
  @IsBoolean() ativo!: boolean;
  @IsIn(['zapi', 'evolution']) provedor!: 'zapi' | 'evolution';
  /** Z-API: ID da instância · Evolution: nome da instância */
  @IsString() @MinLength(2) @MaxLength(120) instancia!: string;
  /** Evolution: endereço do servidor (https://…) */
  @IsOptional() @IsString() @MaxLength(300) url?: string;
  /** só quando trocar (fica guardado criptografado) */
  @IsOptional() @IsString() @MaxLength(300) token?: string;
  @IsOptional() @IsString() @MaxLength(300) clientToken?: string;
  @IsBoolean() confirmacao!: boolean;
  @IsBoolean() lembrete!: boolean;
  /** endereço do sistema para os links das mensagens (ex.: https://vbhoteis.com.br) */
  @IsOptional() @IsString() @MaxLength(200) site?: string;
}
class TesteDto {
  @IsString() @MinLength(10) @MaxLength(30) telefone!: string;
}

@Injectable()
export class WhatsappService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('WhatsApp');
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly ds: DataSource) {}

  onModuleInit() { this.timer = setInterval(() => { void this.rotinaLembretes(); }, 15 * 60_000); }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private async config(empresaId: string): Promise<ConfigZap> {
    const [e] = await this.ds.query(`SELECT whatsapp_config FROM empresas WHERE id = $1`, [empresaId]);
    return (e?.whatsapp_config ?? {}) as ConfigZap;
  }

  async ver(u: UsuarioToken) {
    const c = await this.config(u.empresaId);
    const envios = await this.ds.query(`SELECT telefone, tipo, ok, erro, criado_em FROM whatsapp_envios WHERE empresa_id = $1 ORDER BY criado_em DESC LIMIT 30`, [u.empresaId]);
    return {
      ativo: !!c.ativo, provedor: c.provedor ?? 'zapi', instancia: c.instancia ?? '', url: c.url ?? '', temToken: !!c.tokenCripto, temClientToken: !!c.clientTokenCripto,
      confirmacao: c.confirmacao ?? true, lembrete: c.lembrete ?? true, site: c.site ?? '', envios,
    };
  }

  async salvar(u: UsuarioToken, dto: ConfigZapDto) {
    const antes = await this.config(u.empresaId);
    if (dto.provedor === 'evolution' && !/^https:\/\//.test(dto.url ?? '')) throw new BadRequestException('Informe o endereço do servidor da Evolution (https://…).');
    const site = (dto.site ?? '').trim().replace(/\/+$/, '');
    if (site && !/^https:\/\//.test(site)) throw new BadRequestException('O endereço do sistema precisa começar com https://');
    const c: ConfigZap = {
      ...antes, ativo: dto.ativo, provedor: dto.provedor, instancia: dto.instancia.trim(), url: dto.url?.trim().replace(/\/+$/, '') || undefined,
      tokenCripto: dto.token ? cifrar(dto.token.trim(), 'vb-zap') : antes.tokenCripto, clientTokenCripto: dto.clientToken ? cifrar(dto.clientToken.trim(), 'vb-zap') : antes.clientTokenCripto,
      confirmacao: dto.confirmacao, lembrete: dto.lembrete, site: site || undefined,
    };
    if (c.ativo && !c.tokenCripto) throw new BadRequestException('Coloque o token do provedor de WhatsApp.');
    await this.ds.query(`UPDATE empresas SET whatsapp_config = $2::jsonb WHERE id = $1`, [u.empresaId, JSON.stringify(c)]);
    return { ok: true };
  }

  /** manda uma mensagem de texto; devolve se foi */
  async enviar(empresaId: string, telefone: string, texto: string, tipo: string): Promise<boolean> {
    const c = await this.config(empresaId);
    if (!c.ativo || !c.tokenCripto) return false;
    let fone = telefone.replace(/\D/g, '');
    if (fone.length === 10 || fone.length === 11) fone = `55${fone}`;
    if (fone.length < 12) return false;
    let ok = false, erro: string | null = null;
    try {
      const token = decifrar(c.tokenCripto, 'vb-zap');
      const r = c.provedor === 'evolution'
        ? await fetch(`${c.url}/message/sendText/${encodeURIComponent(c.instancia ?? '')}`, { method: 'POST', signal: AbortSignal.timeout(20_000), headers: { 'Content-Type': 'application/json', apikey: token }, body: JSON.stringify({ number: fone, text: texto }) })
        : await fetch(`https://api.z-api.io/instances/${encodeURIComponent(c.instancia ?? '')}/token/${encodeURIComponent(token)}/send-text`, {
          method: 'POST', signal: AbortSignal.timeout(20_000),
          headers: { 'Content-Type': 'application/json', ...(c.clientTokenCripto ? { 'Client-Token': decifrar(c.clientTokenCripto, 'vb-zap') } : {}) }, body: JSON.stringify({ phone: fone, message: texto }),
        });
      ok = r.ok;
      if (!ok) erro = `o provedor respondeu ${r.status}: ${(await r.text().catch(() => '')).slice(0, 150)}`;
    } catch (e) { erro = e instanceof Error ? e.message : String(e); }
    await this.ds.query(`INSERT INTO whatsapp_envios (empresa_id, telefone, tipo, texto, ok, erro) VALUES ($1,$2,$3,$4,$5,$6)`, [empresaId, fone, tipo, texto.slice(0, 1000), ok, erro?.slice(0, 300) ?? null]).catch(() => undefined);
    if (!ok) this.log.warn(`WhatsApp não foi (${tipo}): ${erro}`);
    return ok;
  }

  async teste(u: UsuarioToken, telefone: string) {
    const [e] = await this.ds.query(`SELECT nome FROM empresas WHERE id = $1`, [u.empresaId]);
    const ok = await this.enviar(u.empresaId, telefone, `Teste do VB Hotéis: o WhatsApp automático de ${e?.nome ?? 'sua empresa'} está funcionando. ✔`, 'teste');
    if (!ok) throw new BadRequestException('Não foi. Confira se está ligado, a instância, o token e se o celular do provedor está conectado. O erro aparece na lista de envios.');
    return { ok: true };
  }

  private link(c: ConfigZap, caminho: string) { return c.site ? `${c.site}${caminho}` : ''; }

  /** confirmação para o hóspede quando a reserva online é feita */
  async confirmarReserva(empresaId: string, r: { telefone: string; nome: string; numero: number | null; chegada: string; saida: string; codigo: string; status: string; hotel: string }) {
    const c = await this.config(empresaId);
    if (!c.ativo || c.confirmacao === false) return;
    const link = this.link(c, `/minha-reserva/${r.codigo}`);
    const texto = [
      `Olá, ${r.nome.split(' ')[0]}! ${r.status === 'confirmada' ? 'Sua reserva está confirmada' : 'Recebemos o seu pedido de reserva'} em ${r.hotel}.`,
      `Reserva nº ${r.numero ?? ''} · ${br(r.chegada)} a ${br(r.saida)} · código ${r.codigo}.`,
      link ? `Acompanhe e faça o pré-check-in por aqui: ${link}` : '',
      'Qualquer dúvida, é só responder esta mensagem.',
    ].filter(Boolean).join('\n');
    await this.enviar(empresaId, r.telefone, texto, 'confirmacao');
  }

  /** a cada 15 minutos, depois das 10h: lembrete para quem chega amanhã (uma vez por dia por empresa) */
  private async rotinaLembretes() {
    if (horaSP() < '10:00') return;
    const hoje = hojeSP(), amanha = somaDias(hoje, 1);
    const emps = await this.ds.query(
      `SELECT id, nome, whatsapp_config FROM empresas WHERE ativo AND whatsapp_config->>'ativo' = 'true' AND COALESCE(whatsapp_config->>'lembrete', 'true') = 'true'
          AND COALESCE(whatsapp_config->>'ultimoLembrete', '') <> $1`, [hoje]).catch(() => []);
    for (const e of emps) {
      await this.ds.query(`UPDATE empresas SET whatsapp_config = whatsapp_config || jsonb_build_object('ultimoLembrete', $2::text) WHERE id = $1`, [e.id, hoje]);
      const c = e.whatsapp_config as ConfigZap;
      const rs = await this.ds.query(
        `SELECT r.id, r.hospede, r.telefone, r.numero, r.chegada, r.codigo_publico, (SELECT f.token FROM fichas_hospede f WHERE f.reserva_id = r.id AND f.status <> 'preenchida' LIMIT 1) AS ficha
           FROM reservas r WHERE r.empresa_id = $1 AND r.chegada = $2 AND r.status IN ('pendente','confirmada') AND COALESCE(r.telefone, '') <> '' AND r.calendario_id IS NULL`, [e.id, amanha]);
      for (const r of rs) {
        const link = r.ficha ? this.link(c, `/ficha/${r.ficha}`) : r.codigo_publico ? this.link(c, `/minha-reserva/${r.codigo_publico}`) : '';
        const texto = [`Olá, ${String(r.hospede).split(' ')[0]}! Esperamos você amanhã, ${br(dia(r.chegada))}, em ${e.nome}.`,
          link ? `Para chegar e só pegar a chave, faça o pré-check-in: ${link}` : '', 'Até amanhã!'].filter(Boolean).join('\n');
        await this.enviar(e.id, r.telefone, texto, 'lembrete');
      }
    }
  }
}

@Controller('whatsapp')
export class WhatsappController {
  constructor(private readonly service: WhatsappService) {}

  @Get() @Requer('empresa.editar', 'reservas.gerenciar')
  ver(@Usuario() u: UsuarioToken) { return this.service.ver(u); }

  @Put() @Requer('empresa.editar')
  salvar(@Usuario() u: UsuarioToken, @Body() dto: ConfigZapDto) { return this.service.salvar(u, dto); }

  @Post('teste') @HttpCode(200) @Requer('empresa.editar', 'reservas.gerenciar')
  teste(@Usuario() u: UsuarioToken, @Body() dto: TesteDto) { return this.service.teste(u, dto.telefone); }
}

@Module({ providers: [WhatsappService], controllers: [WhatsappController], exports: [WhatsappService] })
export class WhatsappModule {}
