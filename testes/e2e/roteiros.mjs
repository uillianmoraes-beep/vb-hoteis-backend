// Roda roteiros contra o servidor que ficou no ar com `node testes/e2e/tudo.mjs --manter`.
// Uso: node testes/e2e/roteiros.mjs [pedaço-do-nome ...]
import { ctx, entrar, lerSessao, resumo, rodarRoteiros } from './lib.mjs';

const s = lerSessao();
Object.assign(ctx, s, { focus: { url: s.focusUrl }, spedy: { url: s.spedyUrl } });
ctx.admin = await entrar(s.adminLogin, s.adminSenha);
await rodarRoteiros(process.argv.slice(2));
process.exit(resumo() ? 1 : 0);
