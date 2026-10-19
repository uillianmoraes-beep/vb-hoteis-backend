import { ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { LimitesPerfil, UsuarioToken } from './permissoes';

/**
 * Liberação do gerente: quando o perfil de quem está operando não pode fazer algo
 * (estorno, cancelamento, desconto acima do limite, sangria…), outra pessoa libera
 * com a SENHA DE LIBERAÇÃO dela (só números, sem precisar do login) ou com login e senha.
 * Toda liberação fica registrada (quem pediu, quem liberou, o quê e quanto).
 */
export interface AutorizacaoEntrada { login?: string; senha?: string; pin?: string }

export interface QuemLibera { id: string; nome: string; permissoes: string[]; limites: LimitesPerfil }

interface Consultavel { query(sql: string, params?: unknown[]): Promise<any> }

const SELECT = `SELECT u.id, u.nome, u.ativo, u.senha_hash, u.pin_hash, p.permissoes, p.limites
  FROM usuarios u LEFT JOIN perfis p ON p.id = u.perfil_id WHERE u.empresa_id = $1`;

function montar(r: Record<string, any>): QuemLibera {
  return { id: r.id, nome: r.nome, permissoes: Array.isArray(r.permissoes) ? r.permissoes : [], limites: r.limites ?? {} };
}

/** confere a senha de liberação (ou login e senha) e devolve quem liberou */
export async function quemLibera(q: Consultavel, empresaId: string, aut: AutorizacaoEntrada): Promise<QuemLibera> {
  const pin = (aut.pin ?? '').trim();
  if (pin) {
    const lista: Record<string, any>[] = await q.query(`${SELECT} AND u.ativo AND u.pin_hash IS NOT NULL`, [empresaId]);
    for (const r of lista) {
      if (await bcrypt.compare(pin, r.pin_hash)) return montar(r);
    }
    throw new ForbiddenException('Senha de liberação incorreta.');
  }
  const login = (aut.login ?? '').trim();
  if (!login || !aut.senha) throw new ForbiddenException('Informe a senha de liberação do gerente.');
  const [r] = await q.query(`${SELECT} AND lower(u.login) = lower($2)`, [empresaId, login]);
  if (!r || !r.ativo || !(await bcrypt.compare(aut.senha, r.senha_hash))) {
    throw new ForbiddenException('Login ou senha de quem libera estão incorretos.');
  }
  return montar(r);
}

export interface RegistroLiberacao {
  acao: string;
  permissao?: string | null;
  ambienteId?: string | null;
  estadiaId?: string | null;
  detalhe?: string | null;
  /** em reais */
  valor?: number | null;
  meio?: 'pin' | 'login';
}

/** grava no histórico de liberações (não atrapalha a operação se falhar) */
export async function registrarLiberacao(q: Consultavel, u: UsuarioToken, quem: QuemLibera, r: RegistroLiberacao) {
  try {
    await q.query(
      `INSERT INTO liberacoes (empresa_id, ambiente_id, estadia_id, pedido_por_id, pedido_por, liberado_por_id, liberado_por, acao, permissao, detalhe, valor, meio)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [u.empresaId, r.ambienteId ?? null, r.estadiaId ?? null, u.sub, u.nome, quem.id, quem.nome, r.acao.slice(0, 120), r.permissao ?? null,
        r.detalhe ? r.detalhe.slice(0, 300) : null, r.valor ?? null, r.meio ?? 'login']);
  } catch { /* histórico é complementar */ }
}

/**
 * Libera uma ação que exige permissão: se o próprio usuário pode, segue sem senha;
 * senão confere quem libera, se ele pode, e registra.
 */
export async function liberarPermissao(
  q: Consultavel, u: UsuarioToken, permissao: string, nomeAcao: string, aut: AutorizacaoEntrada | undefined, ctx: Omit<RegistroLiberacao, 'acao' | 'permissao'> = {},
): Promise<string | null> {
  if (u.permissoes.includes('*') || u.permissoes.includes(permissao)) return null;
  if (!aut || (!aut.pin && !aut.login)) throw new ForbiddenException(`Seu perfil não pode ${nomeAcao}. Peça a senha de liberação do gerente.`);
  const quem = await quemLibera(q, u.empresaId, aut);
  if (!quem.permissoes.includes('*') && !quem.permissoes.includes(permissao)) throw new ForbiddenException(`${quem.nome} também não pode ${nomeAcao}.`);
  if (quem.id === u.sub) throw new ForbiddenException('A liberação precisa ser de outra pessoa.');
  await registrarLiberacao(q, u, quem, { ...ctx, acao: nomeAcao, permissao, meio: aut.pin ? 'pin' : 'login' });
  return quem.nome;
}
