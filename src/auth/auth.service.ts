import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { UsuarioEntity } from '../usuarios/usuario.entity';
import { Empresa } from '../empresas/empresa.entity';
import { UsuarioToken } from '../common/permissoes';
import { CaixaService } from '../caixa/caixa.service';
import { RevendaService } from '../revenda/revenda.service';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(UsuarioEntity) private readonly usuarios: Repository<UsuarioEntity>,
    @InjectRepository(Empresa) private readonly empresas: Repository<Empresa>,
    private readonly jwt: JwtService,
    private readonly caixa: CaixaService,
    private readonly revenda: RevendaService,
  ) {}

  private buscarComSenha(where: string, valor: string) {
    return this.usuarios
      .createQueryBuilder('u')
      .addSelect('u.senhaHash')
      .leftJoinAndSelect('u.perfil', 'perfil')
      .where(where, { valor })
      .getOne();
  }

  /** regras de segurança da empresa (padrão: 5 tentativas, 15 min de bloqueio, tela trava com 30 min parado) */
  async seguranca(empresaId: string) {
    const [e] = await this.usuarios.query(`SELECT config_seguranca FROM empresas WHERE id = $1`, [empresaId]);
    const c = (e?.config_seguranca ?? {}) as { tentativas?: number; bloqueioMin?: number; inatividadeMin?: number };
    return { tentativas: c.tentativas ?? 5, bloqueioMin: c.bloqueioMin ?? 15, inatividadeMin: c.inatividadeMin ?? 30 };
  }

  async salvarSeguranca(u: UsuarioToken, dto: { tentativas: number; bloqueioMin: number; inatividadeMin: number }) {
    await this.usuarios.query(`UPDATE empresas SET config_seguranca = $2::jsonb WHERE id = $1`, [u.empresaId, JSON.stringify(dto)]);
    return this.seguranca(u.empresaId);
  }

  /** senha errada conta; passou do limite, o usuário fica bloqueado por um tempo */
  private async contarFalha(usuarioId: string, empresaId: string) {
    const cfg = await this.seguranca(empresaId);
    const [r] = await this.usuarios.query(
      `UPDATE usuarios SET tentativas_falhas = tentativas_falhas + 1 WHERE id = $1 RETURNING tentativas_falhas`, [usuarioId]);
    const n = Number((Array.isArray(r) ? r[0] : r)?.tentativas_falhas ?? 0);
    if (cfg.tentativas > 0 && n >= cfg.tentativas) {
      await this.usuarios.query(`UPDATE usuarios SET tentativas_falhas = 0, bloqueado_ate = now() + ($2 || ' minutes')::interval WHERE id = $1`, [usuarioId, String(cfg.bloqueioMin)]);
      return { bloqueou: true, minutos: cfg.bloqueioMin, restantes: 0 };
    }
    return { bloqueou: false, minutos: 0, restantes: cfg.tentativas > 0 ? cfg.tentativas - n : null };
  }

  private async conferirBloqueio(usuarioId: string) {
    const [b] = await this.usuarios.query(`SELECT ceil(extract(epoch FROM bloqueado_ate - now()) / 60)::int AS min FROM usuarios WHERE id = $1 AND bloqueado_ate > now()`, [usuarioId]);
    if (b) throw new UnauthorizedException(`Muitas senhas erradas: este usuário está bloqueado por mais ${b.min} minuto(s). O gerente pode liberar em Equipe › Usuários.`);
  }

  async login(login: string, senha: string, agente?: string) {
    const usuario = await this.buscarComSenha('lower(u.login) = lower(:valor)', login.trim());
    if (usuario) await this.conferirBloqueio(usuario.id);
    const senhaOk = usuario ? await bcrypt.compare(senha, usuario.senhaHash) : false;
    if (usuario && !senhaOk) {
      const f = await this.contarFalha(usuario.id, usuario.empresaId);
      if (f.bloqueou) throw new UnauthorizedException(`Muitas senhas erradas: usuário bloqueado por ${f.minutos} minutos. O gerente pode liberar em Equipe › Usuários.`);
      if (f.restantes !== null && f.restantes <= 2) throw new UnauthorizedException(`Login ou senha incorretos. Mais ${f.restantes} tentativa(s) e o usuário fica bloqueado.`);
    }
    if (!usuario || !senhaOk) throw new UnauthorizedException('Login ou senha incorretos.');
    if (usuario.ativo) await this.usuarios.query(`UPDATE usuarios SET tentativas_falhas = 0, bloqueado_ate = NULL WHERE id = $1`, [usuario.id]);
    if (!usuario.ativo) throw new UnauthorizedException('Usuário desativado. Fale com o gerente.');
    if (usuario.acessoCelular === false && /Mobi|Android|iPhone|iPad|iPod/i.test(agente ?? '')) {
      throw new UnauthorizedException('Seu usuário não tem acesso pelo celular. Use o computador da empresa.');
    }

    const empresa = await this.empresas.findOne({ where: { id: usuario.empresaId } });
    if (!empresa || !empresa.ativo) throw new UnauthorizedException('Acesso da empresa suspenso.');
    // empresa que passou para o servidor local: na nuvem só fica o espelho (reserva online, comanda)
    if ((process.env.VB_MODO || '').toLowerCase() !== 'local') {
      const [sl] = await this.usuarios.query(`SELECT servidor_local->>'ativadoEm' AS ativado FROM empresas WHERE id = $1`, [empresa.id]);
      if (sl?.ativado) throw new UnauthorizedException('Esta empresa trabalha com o servidor local. Entre pelo endereço do servidor na rede do hotel (ex.: http://192.168.0.10).');
    }

    const payload: UsuarioToken = {
      sub: usuario.id,
      empresaId: usuario.empresaId,
      perfilId: usuario.perfilId,
      nome: usuario.nome,
      permissoes: usuario.perfil?.permissoes ?? [],
      ambientesIds: usuario.ambientesIds,
    };
    await this.usuarios.update({ id: usuario.id }, { ultimoAcesso: new Date() });
    // troca de turno: abre o caixa no nome de quem entrou, com o fundo deixado pelo anterior
    const caixasAbertos = await this.caixa.abrirNoLogin(payload).catch(() => []);

    return {
      token: await this.jwt.signAsync({ ...payload }),
      usuario: {
        id: usuario.id,
        nome: usuario.nome,
        login: usuario.login,
        perfil: usuario.perfil ? { id: usuario.perfil.id, nome: usuario.perfil.nome, limites: usuario.perfil.limites } : null,
        permissoes: payload.permissoes,
        ambientesIds: usuario.ambientesIds,
      },
      empresa: { id: empresa.id, nome: empresa.nome, vocabulario: empresa.vocabulario, aparencia: empresa.aparencia, modulos: empresa.modulos ?? {} },
      caixasAbertos,
      assinatura: await this.revenda.infoSessao(empresa.id).catch(() => null),
    };
  }

  async eu(u: UsuarioToken) {
    const usuario = await this.usuarios.findOne({ where: { id: u.sub }, relations: { perfil: true } });
    if (!usuario || !usuario.ativo) throw new UnauthorizedException('Usuário não encontrado ou desativado.');
    const empresa = await this.empresas.findOne({ where: { id: usuario.empresaId } });
    return {
      usuario: {
        id: usuario.id,
        nome: usuario.nome,
        login: usuario.login,
        perfil: usuario.perfil ? { id: usuario.perfil.id, nome: usuario.perfil.nome, limites: usuario.perfil.limites } : null,
        permissoes: usuario.perfil?.permissoes ?? [],
        ambientesIds: usuario.ambientesIds,
      },
      empresa: empresa ? { id: empresa.id, nome: empresa.nome, vocabulario: empresa.vocabulario, aparencia: empresa.aparencia, modulos: empresa.modulos ?? {} } : null,
      assinatura: empresa ? await this.revenda.infoSessao(empresa.id).catch(() => null) : null,
    };
  }

  /** ambientes em que o usuário pode entrar (para a escolha logo após o login) */
  async meusAmbientes(u: UsuarioToken) {
    const l = await this.usuarios.query(
      `SELECT id, nome, tipo, cor FROM ambientes WHERE empresa_id = $1 AND ativo ORDER BY ordem, nome`, [u.empresaId]);
    return l.filter((a: { id: string }) => !u.ambientesIds?.length || u.ambientesIds.includes(a.id));
  }

  /**
   * Registra em qual ambiente o operador entrou (login) ou para qual trocou.
   * Na troca confere a senha do próprio usuário; tentativa com senha errada também fica registrada.
   */
  async entrarAmbiente(u: UsuarioToken, dto: { ambienteId: string; deAmbienteId?: string; tipo: 'login' | 'troca'; senha?: string }, ip: string, agente: string) {
    const [amb] = await this.usuarios.query(`SELECT id, nome FROM ambientes WHERE id = $1 AND empresa_id = $2 AND ativo`, [dto.ambienteId, u.empresaId]);
    if (!amb) throw new BadRequestException('Ambiente não encontrado.');
    if (u.ambientesIds?.length && !u.ambientesIds.includes(amb.id)) throw new ForbiddenException(`Seu usuário não tem acesso a ${amb.nome}.`);
    const registrar = (tipo: string) => this.usuarios.query(
      `INSERT INTO acessos_ambiente (empresa_id, usuario_id, usuario_nome, tipo, de_ambiente_id, para_ambiente_id, ip, agente) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [u.empresaId, u.sub, u.nome, tipo, dto.deAmbienteId ?? null, amb.id, ip.slice(0, 60) || null, agente.slice(0, 200) || null]);
    if (dto.tipo === 'troca') {
      const usuario = await this.buscarComSenha('u.id = :valor', u.sub);
      if (!usuario || !dto.senha || !(await bcrypt.compare(dto.senha, usuario.senhaHash))) {
        await registrar('negada');
        throw new BadRequestException('Senha incorreta.');
      }
    }
    await registrar(dto.tipo);
    return { ok: true, ambiente: amb.nome };
  }

  async acessos(u: UsuarioToken, f: { de: string; ate: string; ambienteId?: string; usuarioId?: string }) {
    const params: unknown[] = [u.empresaId, f.de, f.ate];
    let w = '';
    if (f.ambienteId) { params.push(f.ambienteId); w += ` AND (x.para_ambiente_id = $${params.length}::uuid OR x.de_ambiente_id = $${params.length}::uuid)`; }
    if (f.usuarioId) { params.push(f.usuarioId); w += ` AND x.usuario_id = $${params.length}::uuid`; }
    const l = await this.usuarios.query(
      `SELECT x.id, x.criado_em, x.usuario_id, x.usuario_nome, x.tipo, x.ip, x.agente, ad.nome AS de, ap.nome AS para
         FROM acessos_ambiente x LEFT JOIN ambientes ad ON ad.id = x.de_ambiente_id LEFT JOIN ambientes ap ON ap.id = x.para_ambiente_id
        WHERE x.empresa_id = $1 AND x.criado_em >= ($2::date)::timestamp AT TIME ZONE 'America/Sao_Paulo'
          AND x.criado_em < ($3::date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo'${w}
        ORDER BY x.criado_em DESC LIMIT 2000`, params);
    return l.map((x: Record<string, unknown>) => ({
      id: x.id, criadoEm: x.criado_em, usuarioId: x.usuario_id, usuario: x.usuario_nome, tipo: x.tipo, de: x.de, para: x.para, ip: x.ip, agente: x.agente,
    }));
  }

  /** tela travada por inatividade: confere a senha de quem está logado */
  async confirmarSenha(u: UsuarioToken, senha: string) {
    const usuario = await this.buscarComSenha('u.id = :valor', u.sub);
    if (!usuario || !usuario.ativo) throw new UnauthorizedException('Usuário não encontrado ou desativado.');
    await this.conferirBloqueio(usuario.id);
    if (!(await bcrypt.compare(senha, usuario.senhaHash))) {
      const f = await this.contarFalha(usuario.id, usuario.empresaId);
      // bloqueou: a sessão acaba (401 manda para o login)
      if (f.bloqueou) throw new UnauthorizedException(`Muitas senhas erradas: usuário bloqueado por ${f.minutos} minutos.`);
      throw new BadRequestException(f.restantes !== null && f.restantes <= 2 ? `Senha incorreta. Mais ${f.restantes} tentativa(s) e o usuário fica bloqueado.` : 'Senha incorreta.');
    }
    await this.usuarios.query(`UPDATE usuarios SET tentativas_falhas = 0 WHERE id = $1`, [usuario.id]);
    return { ok: true };
  }

  async trocarMinhaSenha(u: UsuarioToken, senhaAtual: string, novaSenha: string) {
    const usuario = await this.buscarComSenha('u.id = :valor', u.sub);
    if (!usuario) throw new UnauthorizedException();
    if (!(await bcrypt.compare(senhaAtual, usuario.senhaHash))) {
      throw new BadRequestException('Senha atual incorreta.');
    }
    await this.usuarios.update({ id: u.sub }, { senhaHash: await bcrypt.hash(novaSenha, 10) });
    return { ok: true };
  }

  /* ---------- senha de liberação (gerente libera só com números, sem login) ---------- */

  async meuPin(u: UsuarioToken) {
    const [r] = await this.usuarios.query(`SELECT pin_hash IS NOT NULL AS tem, pin_definido_em FROM usuarios WHERE id = $1`, [u.sub]);
    return { temPin: !!r?.tem, definidoEm: r?.pin_definido_em ?? null };
  }

  async definirMeuPin(u: UsuarioToken, senhaAtual: string, pin?: string | null) {
    const usuario = await this.buscarComSenha('u.id = :valor', u.sub);
    if (!usuario || !(await bcrypt.compare(senhaAtual, usuario.senhaHash))) throw new BadRequestException('Senha de entrada incorreta.');
    const novo = (pin ?? '').trim();
    if (!novo) {
      await this.usuarios.query(`UPDATE usuarios SET pin_hash = NULL, pin_definido_em = NULL WHERE id = $1`, [u.sub]);
      return { ok: true, temPin: false };
    }
    if (!/^\d{4,8}$/.test(novo)) throw new BadRequestException('A senha de liberação tem de 4 a 8 números.');
    const seq = '01234567890123456789';
    const desc = '98765432109876543210';
    if (/^(\d)\1+$/.test(novo) || seq.includes(novo) || desc.includes(novo)) {
      throw new BadRequestException('Senha fácil demais (números repetidos ou em sequência). Escolha outra.');
    }
    // não pode repetir a de outra pessoa da empresa (senão não dá para saber quem liberou)
    const outros: { pin_hash: string }[] = await this.usuarios.query(
      `SELECT pin_hash FROM usuarios WHERE empresa_id = $1 AND id <> $2 AND pin_hash IS NOT NULL`, [u.empresaId, u.sub]);
    for (const o of outros) {
      if (await bcrypt.compare(novo, o.pin_hash)) throw new BadRequestException('Essa senha já é usada por outra pessoa. Escolha outra.');
    }
    await this.usuarios.query(`UPDATE usuarios SET pin_hash = $2, pin_definido_em = now() WHERE id = $1`, [u.sub, await bcrypt.hash(novo, 10)]);
    return { ok: true, temPin: true };
  }

  /** gerente apaga a senha de liberação de alguém (ex.: funcionário saiu ou esqueceu) */
  async removerPin(u: UsuarioToken, usuarioId: string) {
    await this.usuarios.query(`UPDATE usuarios SET pin_hash = NULL, pin_definido_em = NULL WHERE id = $1 AND empresa_id = $2`, [usuarioId, u.empresaId]);
    return { ok: true };
  }

  /** histórico de liberações: quem pediu, quem liberou, o quê, quanto */
  async liberacoes(u: UsuarioToken, f: { de: string; ate: string; ambienteId?: string }) {
    const params: unknown[] = [u.empresaId, f.de, f.ate];
    let w = '';
    if (f.ambienteId) { params.push(f.ambienteId); w = ` AND l.ambiente_id = $${params.length}::uuid`; }
    const l = await this.usuarios.query(
      `SELECT l.id, l.criado_em, l.pedido_por, l.liberado_por, l.acao, l.detalhe, l.valor, l.meio, a.nome AS ambiente, un.codigo AS unidade, e.numero AS uso
         FROM liberacoes l LEFT JOIN ambientes a ON a.id = l.ambiente_id LEFT JOIN estadias e ON e.id = l.estadia_id LEFT JOIN unidades un ON un.id = e.unidade_id
        WHERE l.empresa_id = $1 AND l.criado_em >= ($2::date)::timestamp AT TIME ZONE 'America/Sao_Paulo'
          AND l.criado_em < ($3::date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo'${w}
        ORDER BY l.criado_em DESC LIMIT 2000`, params);
    return l.map((x: Record<string, unknown>) => ({
      id: x.id, criadoEm: x.criado_em, pedidoPor: x.pedido_por, liberadoPor: x.liberado_por, acao: x.acao, detalhe: x.detalhe,
      valor: x.valor == null ? null : Number(x.valor), meio: x.meio, ambiente: x.ambiente, unidade: x.unidade, uso: x.uso,
    }));
  }
}
