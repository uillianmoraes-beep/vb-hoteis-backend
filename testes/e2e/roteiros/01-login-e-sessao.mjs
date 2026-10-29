// Login, um computador por vez (sid), senha errada, cabeçalhos de segurança e usuários de cada perfil.
import { api, verifica, status, exige, entrar, sql } from '../lib.mjs';

export default async function (ctx) {
  const adm = ctx.admin;
  verifica('login do admin devolve token e perfil Administrador', adm.token && adm.login.usuario?.perfil?.nome === 'Administrador', adm.login.usuario);
  verifica('admin tem permissão total (*)', adm.login.usuario.permissoes.includes('*'));

  const eu = await adm.get('/auth/eu');
  status('/auth/eu responde com o token', eu, 200);
  status('sem token: 401', await api('GET', '/auth/eu'), 401);
  status('token inventado: 401', await api('GET', '/auth/eu', undefined, 'abc.def.ghi'), 401);

  // senha errada
  const errada = await api('POST', '/auth/login', { login: ctx.adminLogin, senha: 'senha-errada' }, undefined, { headers: { 'x-forwarded-for': '10.9.9.1' } });
  status('senha errada: 401', errada, 401);
  verifica('mensagem de senha errada não diz se o login existe', /incorretos/i.test(errada.json?.message ?? ''), errada.json);
  const naoExiste = await api('POST', '/auth/login', { login: 'ninguem-aqui', senha: 'x12345' }, undefined, { headers: { 'x-forwarded-for': '10.9.9.1' } });
  status('login que não existe: 401', naoExiste, 401);

  // um computador por vez: o segundo login derruba o primeiro
  const pc1 = await entrar(ctx.adminLogin, ctx.adminSenha);
  status('computador 1 entra', await pc1.get('/auth/eu'), 200);
  const pc2 = await entrar(ctx.adminLogin, ctx.adminSenha);
  status('computador 2 entra', await pc2.get('/auth/eu'), 200);
  // o cache da sessão é de 15 s no mesmo processo; o login atualiza na hora
  const caiu = await pc1.get('/auth/eu');
  status('computador 1 cai quando o 2 entra (401)', caiu, 401);
  verifica('mensagem fala de outro computador', /outro computador/i.test(caiu.json?.message ?? ''), caiu.json);
  ctx.admin = pc2; // o token antigo do admin morreu junto

  // headers de segurança
  const h = (await api('GET', '/health')).headers;
  verifica('cabeçalho X-Content-Type-Options: nosniff', h.get('x-content-type-options') === 'nosniff');
  verifica('cabeçalho X-Frame-Options: DENY', h.get('x-frame-options') === 'DENY');
  verifica('cabeçalho Strict-Transport-Security', !!h.get('strict-transport-security'));
  verifica('cabeçalho Referrer-Policy', !!h.get('referrer-policy'));
  verifica('sem X-Powered-By (não entrega que é Express)', !h.get('x-powered-by'), h.get('x-powered-by'));

  // limite de tentativas: 30 logins em 10 min por endereço → o 31º leva 429
  let ultimo;
  for (let i = 0; i < 31; i++) ultimo = await api('POST', '/auth/login', { login: 'robo', senha: 'robo123' }, undefined, { headers: { 'x-forwarded-for': '10.250.250.250' } });
  status('31º login seguido do mesmo endereço: 429', ultimo, 429);
  const outroIp = await api('POST', '/auth/login', { login: 'robo', senha: 'robo123' }, undefined, { headers: { 'x-forwarded-for': '10.250.250.251' } });
  status('outro endereço continua podendo tentar (401, não 429)', outroIp, 401);

  // usuários de cada perfil (usados nos próximos roteiros)
  const perfis = await ctx.admin.get('/perfis');
  exige('lista os perfis', perfis.status === 200 && Array.isArray(perfis.json), perfis.json);
  const perfil = (n) => perfis.json.find((p) => p.nome === n);
  ctx.dados.perfis = Object.fromEntries(perfis.json.map((p) => [p.nome, p.id]));
  const usuarios = {};
  for (const [nome, login] of [['Recepção', 'recepcao1'], ['Gerente', 'gerente1'], ['Portaria', 'portaria1'], ['Camareira', 'camareira1'], ['Saída', 'saida1']]) {
    const r = await ctx.admin.post('/usuarios', { nome: `Teste ${nome}`, login, senha: 'senha-teste-123', perfilId: perfil(nome)?.id });
    status(`cria usuário do perfil ${nome}`, r, [200, 201]);
    usuarios[nome] = r.json?.id;
  }
  ctx.dados.usuarios = usuarios;

  // usuário desativado não entra
  const des = await ctx.admin.post('/usuarios', { nome: 'Desligado', login: 'desligado1', senha: 'senha-teste-123', perfilId: perfil('Camareira').id });
  await ctx.admin.patch(`/usuarios/${des.json?.id}`, { ativo: false });
  status('usuário desativado não entra', await api('POST', '/auth/login', { login: 'desligado1', senha: 'senha-teste-123' }, undefined, { headers: { 'x-forwarded-for': '10.9.9.2' } }), 401);

  // bloqueio por senhas erradas (padrão: 5 tentativas)
  for (let i = 0; i < 5; i++) await api('POST', '/auth/login', { login: 'saida1', senha: 'errada-' + i }, undefined, { headers: { 'x-forwarded-for': '10.9.9.3' } });
  const bloq = await api('POST', '/auth/login', { login: 'saida1', senha: 'senha-teste-123' }, undefined, { headers: { 'x-forwarded-for': '10.9.9.3' } });
  verifica('depois de 5 senhas erradas, nem a senha certa entra', bloq.status === 401 && /bloquead/i.test(bloq.json?.message ?? ''), bloq.json);
  status('gerente desbloqueia o usuário', await ctx.admin.post(`/usuarios/${usuarios['Saída']}/desbloquear`), [200, 201]);
  const volta = await api('POST', '/auth/login', { login: 'saida1', senha: 'senha-teste-123' }, undefined, { headers: { 'x-forwarded-for': '10.9.9.3' } });
  status('depois de desbloqueado, entra', volta, 200);

  // a senha nunca volta na resposta
  const lista = await ctx.admin.get('/usuarios');
  verifica('lista de usuários não traz a senha (hash)', !/senha_?hash|\$2[aby]\$/i.test(lista.texto), lista.texto.slice(0, 200));
  const [u] = await sql(`SELECT senha_hash FROM usuarios WHERE login = 'recepcao1'`);
  verifica('senha gravada com bcrypt (não em texto puro)', /^\$2[aby]\$/.test(u?.senha_hash ?? ''));
}
