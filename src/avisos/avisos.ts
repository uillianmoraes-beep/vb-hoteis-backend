import { BadRequestException, Body, Controller, Delete, Get, Global, HttpCode, Injectable, Logger, Module, OnModuleDestroy, OnModuleInit, Post, Put } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import * as webpush from 'web-push';
import * as nodemailer from 'nodemailer';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';
import { cifrar, decifrar } from '../common/cripto';

/**
 * Avisos no celular e resumo automático:
 * - notificação no celular/computador pelo navegador (sem instalar app): nova reserva online, chamado do totem,
 *   pedido de quarto e o resumo do dia;
 * - resumo diário na hora marcada (vendas de ontem, ocupação, chegadas, contas a pagar e a receber), por notificação e por e-mail.
 * As chaves das notificações são criadas sozinhas no primeiro uso; o e-mail usa o servidor de e-mail (SMTP) que a empresa cadastrar.
 */

const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const horaSP = () => new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false });
const somaDias = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const br = (d: string) => d.split('-').reverse().join('/');

interface Smtp { host: string; porta: number; usuario: string; senhaCripto?: string; remetente: string; seguro?: boolean }
interface ConfigAvisos { resumoHora?: string; resumoPush?: boolean; resumoEmail?: boolean; emails?: string[]; smtp?: Smtp; ultimoResumo?: string }

class ChavesDto {
  @IsString() @MaxLength(200) p256dh!: string;
  @IsString() @MaxLength(100) auth!: string;
}
class InscricaoDto {
  @IsString() @MaxLength(1000) endpoint!: string;
  @ValidateNested() @Type(() => ChavesDto) keys!: ChavesDto;
  @IsOptional() @IsString() @MaxLength(120) aparelho?: string;
}
class SairDto {
  @IsString() @MaxLength(1000) endpoint!: string;
}
class SmtpDto {
  @IsString() @MaxLength(120) host!: string;
  @IsInt() @Min(1) @Max(65535) porta!: number;
  @IsString() @MaxLength(160) usuario!: string;
  /** só quando trocar (fica guardada criptografada e nunca volta para a tela) */
  @IsOptional() @IsString() @MaxLength(200) senha?: string;
  @IsEmail() @MaxLength(160) remetente!: string;
}
class ConfigDto {
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) resumoHora!: string;
  @IsBoolean() resumoPush!: boolean;
  @IsBoolean() resumoEmail!: boolean;
  @IsArray() @ArrayMaxSize(10) @IsEmail({}, { each: true }) emails!: string[];
  @IsOptional() @ValidateNested() @Type(() => SmtpDto) smtp?: SmtpDto | null;
}

export interface Aviso { titulo: string; texto: string; link?: string }

@Injectable()
export class AvisosService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Avisos');
  private chaves: { publica: string; privada: string } | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly ds: DataSource) {}

  onModuleInit() {
    this.timer = setInterval(() => { void this.rotinaResumo(); }, 5 * 60_000);
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  /** chaves das notificações (VAPID): criadas uma vez e guardadas no banco */
  private async vapid() {
    if (this.chaves) return this.chaves;
    const [c] = await this.ds.query(`SELECT valor FROM sistema_config WHERE chave = 'vapid'`);
    if (c?.valor?.publica) {
      this.chaves = { publica: c.valor.publica, privada: decifrar(c.valor.privadaCripto, 'vb-vapid') };
    } else {
      const k = webpush.generateVAPIDKeys();
      await this.ds.query(`INSERT INTO sistema_config (chave, valor) VALUES ('vapid', $1::jsonb) ON CONFLICT (chave) DO NOTHING`,
        [JSON.stringify({ publica: k.publicKey, privadaCripto: cifrar(k.privateKey, 'vb-vapid') })]);
      const [d] = await this.ds.query(`SELECT valor FROM sistema_config WHERE chave = 'vapid'`);
      this.chaves = { publica: d.valor.publica, privada: decifrar(d.valor.privadaCripto, 'vb-vapid') };
    }
    return this.chaves;
  }

  async chavePublica() { return { chave: (await this.vapid()).publica }; }

  async inscrever(u: UsuarioToken, dto: InscricaoDto) {
    if (!/^https:\/\//.test(dto.endpoint)) throw new BadRequestException('Inscrição inválida.');
    await this.ds.query(
      `INSERT INTO push_inscricoes (empresa_id, usuario_id, endpoint, chaves, aparelho) VALUES ($1,$2,$3,$4::jsonb,$5)
       ON CONFLICT (endpoint) DO UPDATE SET empresa_id = $1, usuario_id = $2, chaves = $4::jsonb, aparelho = $5, atualizado_em = now()`,
      [u.empresaId, u.sub, dto.endpoint, JSON.stringify(dto.keys), dto.aparelho?.slice(0, 120) || null]);
    return { ok: true };
  }

  async sair(u: UsuarioToken, endpoint: string) {
    await this.ds.query(`DELETE FROM push_inscricoes WHERE endpoint = $1 AND usuario_id = $2`, [endpoint, u.sub]);
    return { ok: true };
  }

  async meus(u: UsuarioToken) {
    const l = await this.ds.query(`SELECT aparelho, criado_em FROM push_inscricoes WHERE usuario_id = $1 ORDER BY criado_em DESC`, [u.sub]);
    return l;
  }

  private async mandar(inscricoes: { id: string; endpoint: string; chaves: { p256dh: string; auth: string } }[], aviso: Aviso) {
    if (!inscricoes.length) return 0;
    const k = await this.vapid();
    const corpo = JSON.stringify({ titulo: aviso.titulo.slice(0, 80), texto: aviso.texto.slice(0, 400), link: aviso.link ?? '/' });
    let n = 0;
    for (const i of inscricoes) {
      try {
        await webpush.sendNotification({ endpoint: i.endpoint, keys: i.chaves }, corpo, { vapidDetails: { subject: 'mailto:suporte@virtualbarra.com.br', publicKey: k.publica, privateKey: k.privada }, TTL: 6 * 3600 });
        n++;
      } catch (e) {
        const st = (e as { statusCode?: number }).statusCode;
        // aparelho desinscrito ou trocado: apaga
        if (st === 404 || st === 410) await this.ds.query(`DELETE FROM push_inscricoes WHERE id = $1`, [i.id]).catch(() => undefined);
        else this.log.warn(`Notificação não foi: ${e instanceof Error ? e.message : e}`);
      }
    }
    return n;
  }

  /** manda para quem da empresa tem alguma das permissões (sem permissão = todos os aparelhos da empresa) */
  async avisar(empresaId: string, aviso: Aviso, permissoes: string[] = []) {
    try {
      const l = await this.ds.query(
        `SELECT p.id, p.endpoint, p.chaves FROM push_inscricoes p JOIN usuarios us ON us.id = p.usuario_id AND us.ativo JOIN perfis pf ON pf.id = us.perfil_id
          WHERE p.empresa_id = $1 AND (cardinality($2::text[]) = 0 OR pf.permissoes ? '*' OR pf.permissoes ?| $2::text[])`, [empresaId, permissoes]);
      return await this.mandar(l, aviso);
    } catch (e) {
      this.log.warn(`Aviso não enviado: ${e instanceof Error ? e.message : e}`);
      return 0;
    }
  }

  async teste(u: UsuarioToken) {
    const l = await this.ds.query(`SELECT id, endpoint, chaves FROM push_inscricoes WHERE usuario_id = $1`, [u.sub]);
    if (!l.length) throw new BadRequestException('Este usuário ainda não ligou os avisos em nenhum aparelho.');
    const n = await this.mandar(l, { titulo: 'VB Hotéis', texto: 'Teste: os avisos estão chegando neste aparelho. ✔', link: '/painel' });
    return { ok: true, enviados: n };
  }

  /* ---------------- resumo diário ---------------- */

  private async config(empresaId: string): Promise<ConfigAvisos> {
    const [e] = await this.ds.query(`SELECT avisos_config FROM empresas WHERE id = $1`, [empresaId]);
    return (e?.avisos_config ?? {}) as ConfigAvisos;
  }

  async verConfig(u: UsuarioToken) {
    const c = await this.config(u.empresaId);
    return {
      resumoHora: c.resumoHora ?? '08:00', resumoPush: c.resumoPush ?? true, resumoEmail: c.resumoEmail ?? false, emails: c.emails ?? [], ultimoResumo: c.ultimoResumo ?? null,
      smtp: c.smtp ? { host: c.smtp.host, porta: c.smtp.porta, usuario: c.smtp.usuario, remetente: c.smtp.remetente, temSenha: !!c.smtp.senhaCripto } : null,
    };
  }

  async salvarConfig(u: UsuarioToken, dto: ConfigDto) {
    const antes = await this.config(u.empresaId);
    let smtp: Smtp | undefined;
    if (dto.smtp) {
      smtp = { host: dto.smtp.host.trim(), porta: dto.smtp.porta, usuario: dto.smtp.usuario.trim(), remetente: dto.smtp.remetente.trim(), seguro: dto.smtp.porta === 465,
        senhaCripto: dto.smtp.senha ? cifrar(dto.smtp.senha, 'vb-smtp') : antes.smtp?.senhaCripto };
    }
    if (dto.resumoEmail && !smtp?.senhaCripto) throw new BadRequestException('Para mandar o resumo por e-mail, cadastre o servidor de e-mail (SMTP) com a senha.');
    const c: ConfigAvisos = { ...antes, resumoHora: dto.resumoHora, resumoPush: dto.resumoPush, resumoEmail: dto.resumoEmail, emails: dto.emails.map((x) => x.trim().toLowerCase()), smtp };
    await this.ds.query(`UPDATE empresas SET avisos_config = $2::jsonb WHERE id = $1`, [u.empresaId, JSON.stringify(c)]);
    return { ok: true };
  }

  /** o texto do resumo (ontem, agora, hoje e contas) */
  async montarResumo(empresaId: string) {
    const hoje = hojeSP(), ontem = somaDias(hoje, -1);
    const q = async (sql: string, p: unknown[]) => (await this.ds.query(sql, p).catch(() => [{}]))[0] ?? {};
    const vendas = await q(`SELECT count(*)::int AS n, COALESCE(sum(valor_total),0) AS t FROM estadias WHERE empresa_id = $1 AND status = 'fechada' AND (saida_em AT TIME ZONE 'America/Sao_Paulo')::date = $2`, [empresaId, ontem]);
    const ocup = await q(`SELECT count(*) FILTER (WHERE status IN ('ocupada','conta_entregue','paga'))::int AS ocupadas, count(*)::int AS total FROM unidades WHERE empresa_id = $1 AND ativo`, [empresaId]);
    const cheg = await q(`SELECT count(*)::int AS n FROM reservas WHERE empresa_id = $1 AND chegada = $2 AND status IN ('pendente','confirmada')`, [empresaId, hoje]);
    const pagar = await q(`SELECT count(*) FILTER (WHERE vencimento <= $2)::int AS n, COALESCE(sum(valor) FILTER (WHERE vencimento <= $2),0) AS t, count(*) FILTER (WHERE vencimento < $2)::int AS vencidas FROM contas_pagar WHERE empresa_id = $1 AND status = 'aberta'`, [empresaId, hoje]);
    const receber = await q(`SELECT COALESCE(sum(valor),0) AS t FROM contas_receber WHERE empresa_id = $1 AND status = 'aberta' AND vencimento < $2`, [empresaId, hoje]);
    const [emp] = await this.ds.query(`SELECT nome FROM empresas WHERE id = $1`, [empresaId]);
    const linhas = [
      `Ontem (${br(ontem)}): ${vendas.n ?? 0} conta(s) fechada(s), ${brl(Number(vendas.t ?? 0))}.`,
      `Agora: ${ocup.ocupadas ?? 0} de ${ocup.total ?? 0} ocupados.`,
      Number(cheg.n) ? `Hoje chegam ${cheg.n} reserva(s).` : '',
      Number(pagar.n) ? `Contas a pagar até hoje: ${pagar.n} (${brl(Number(pagar.t))})${Number(pagar.vencidas) ? `, ${pagar.vencidas} vencida(s)` : ''}.` : 'Nenhuma conta a pagar vencendo hoje.',
      Number(receber.t) > 0 ? `A receber vencido: ${brl(Number(receber.t))}.` : '',
    ].filter(Boolean);
    return { titulo: `Resumo de ${emp?.nome ?? 'hoje'}`, linhas };
  }

  private async email(c: ConfigAvisos, assunto: string, texto: string) {
    if (!c.smtp?.senhaCripto || !c.emails?.length) return false;
    const t = nodemailer.createTransport({ host: c.smtp.host, port: c.smtp.porta, secure: c.smtp.porta === 465, auth: { user: c.smtp.usuario, pass: decifrar(c.smtp.senhaCripto, 'vb-smtp') }, connectionTimeout: 15_000 });
    await t.sendMail({ from: c.smtp.remetente, to: c.emails.join(', '), subject: assunto, text: texto });
    return true;
  }

  async enviarResumo(empresaId: string) {
    const c = await this.config(empresaId);
    const r = await this.montarResumo(empresaId);
    const res = { push: 0, email: false, erroEmail: null as string | null };
    if (c.resumoPush ?? true) res.push = await this.avisar(empresaId, { titulo: r.titulo, texto: r.linhas.join(' '), link: '/dashboard' }, ['relatorios.ver', 'caixa.adm']);
    if (c.resumoEmail) {
      try { res.email = await this.email(c, `${r.titulo} · ${br(hojeSP())}`, `${r.linhas.join('\n')}\n\nVB Hotéis`); } catch (e) { res.erroEmail = e instanceof Error ? e.message : String(e); }
    }
    await this.ds.query(`UPDATE empresas SET avisos_config = COALESCE(avisos_config, '{}'::jsonb) || jsonb_build_object('ultimoResumo', $2::text) WHERE id = $1`, [empresaId, hojeSP()]);
    return { ...res, linhas: r.linhas };
  }

  /** a cada 5 minutos: manda o resumo das empresas que chegaram na hora marcada e ainda não receberam hoje */
  private async rotinaResumo() {
    const hora = horaSP(), hoje = hojeSP();
    const l = await this.ds.query(
      `SELECT id FROM empresas WHERE ativo AND (avisos_config->>'resumoPush' = 'true' OR avisos_config->>'resumoEmail' = 'true')
          AND COALESCE(avisos_config->>'resumoHora', '08:00') <= $1 AND COALESCE(avisos_config->>'ultimoResumo', '') <> $2`, [hora, hoje]).catch(() => []);
    for (const e of l) await this.enviarResumo(e.id).catch((x) => this.log.warn(`Resumo ${e.id}: ${x instanceof Error ? x.message : x}`));
  }
}

@Controller('avisos')
export class AvisosController {
  constructor(private readonly service: AvisosService) {}

  @Get('chave') chave() { return this.service.chavePublica(); }
  @Get('meus') meus(@Usuario() u: UsuarioToken) { return this.service.meus(u); }
  @Post('inscrever') @HttpCode(200) inscrever(@Usuario() u: UsuarioToken, @Body() dto: InscricaoDto) { return this.service.inscrever(u, dto); }
  @Delete('inscrever') sair(@Usuario() u: UsuarioToken, @Body() dto: SairDto) { return this.service.sair(u, dto.endpoint); }
  @Post('teste') @HttpCode(200) teste(@Usuario() u: UsuarioToken) { return this.service.teste(u); }

  @Get('config') @Requer('empresa.editar', 'relatorios.ver')
  config(@Usuario() u: UsuarioToken) { return this.service.verConfig(u); }

  @Put('config') @Requer('empresa.editar')
  salvar(@Usuario() u: UsuarioToken, @Body() dto: ConfigDto) { return this.service.salvarConfig(u, dto); }

  @Post('resumo-agora') @HttpCode(200) @Requer('empresa.editar', 'relatorios.ver')
  resumo(@Usuario() u: UsuarioToken) { return this.service.enviarResumo(u.empresaId); }
}

@Global()
@Module({ providers: [AvisosService], controllers: [AvisosController], exports: [AvisosService] })
export class AvisosModule {}
