# VB Soluções Hoteleiras — API

Backend do sistema híbrido para motel, hotel, pousada e restaurante da Virtual Barra.
NestJS + TypeORM + PostgreSQL, publicado no Railway.

## Como sobe

- `npm run build` compila para `dist/`; `npm start` roda `dist/main.js`.
- As mudanças de banco ficam em `src/database/migrations` e **rodam sozinhas a cada deploy**.
  Não é preciso rodar SQL no console do Railway.
- Na primeira subida, com o banco vazio, o sistema cria a empresa, os perfis padrão,
  os motivos de bloqueio e o administrador (variáveis `SEED_*`). Com `SEED_EXEMPLOS=true`
  cria também Motel (suítes 01 a 12) e Hotel (quartos 101 a 104).

## Variáveis no Railway

| Variável | Exemplo | Para quê |
| --- | --- | --- |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | Conexão com o banco |
| `DATABASE_SSL` | `false` | `true` só se conectar de fora do Railway |
| `JWT_SECRET` | texto longo aleatório | Assinatura dos logins |
| `JWT_EXPIRA_EM` | `12h` | Duração do login |
| `SEED_EMPRESA_NOME` | `Motel Exemplo` | Nome da empresa na primeira subida |
| `SEED_ADMIN_NOME` | `Uilliam` | Nome do administrador |
| `SEED_ADMIN_LOGIN` | `admin@virtualbarra.com` | Login do administrador |
| `SEED_ADMIN_SENHA` | senha forte | Senha inicial (troque depois) |
| `SEED_EXEMPLOS` | `true` | Cria unidades de exemplo |
| `CORS_ORIGENS` | endereço do frontend | Vazio libera todos |

## Rotas (prefixo `/api`)

| Método e rota | O que faz | Permissão |
| --- | --- | --- |
| `GET /health` | Teste do servidor e do banco | pública |
| `POST /auth/login` | `{ login, senha }` → token | pública |
| `GET /auth/eu` | Usuário logado | logado |
| `PATCH /auth/minha-senha` | `{ senhaAtual, novaSenha }` | logado |
| `GET /painel?ambienteId=` | Unidades, resumo por status e alertas "Precisa de você agora" | `painel.ver` |
| `GET /unidades` · `GET /unidades/:id` | Lista e detalhe | logado |
| `POST /unidades` · `POST /unidades/lote` | Cria uma ou várias (ex.: 01 a 20) | `unidades.gerenciar` |
| `PATCH /unidades/:id` · `DELETE /unidades/:id` | Edita e desativa | `unidades.gerenciar` |
| `PATCH /unidades/:id/status` | `{ status, motivoBloqueioId?, observacao? }` | ver regras abaixo |
| `GET /unidades/:id/historico` | Quem mudou, quando e por quê | logado |
| `GET/POST/PATCH/DELETE /ambientes` | Motel, hotel, pousada, restaurante, bar | `ambientes.gerenciar` |
| `GET/POST/PATCH/DELETE /categorias` | Standard, Luxo, Hidro… | `categorias.gerenciar` |
| `GET/POST/PATCH/DELETE /motivos-bloqueio` | Motivos de bloqueio | `motivos.gerenciar` |
| `GET /perfis/permissoes` · `GET/POST/PATCH/DELETE /perfis` | Perfis, permissões e limites | `perfis.gerenciar` |
| `GET/POST/PATCH /usuarios` · `PATCH /usuarios/:id/senha` | Usuários | `usuarios.gerenciar` |
| `GET/PATCH /empresa` | Dados e vocabulário da empresa | `empresa.editar` |

### Regras de status

- Status: `livre`, `ocupada`, `conta_entregue`, `limpeza`, `vistoria`, `bloqueada`, `reservada`.
- **Livre** só vem de vistoria, reservada ou bloqueada: a limpeza sempre passa pela revisora.
- **Vistoria** só vem de limpeza ou bloqueada.
- **Bloqueada** exige motivo e a permissão `unidades.bloquear`; sair do bloqueio exige `unidades.desbloquear`.
- Toda mudança grava histórico com usuário, data, motivo e observação.
- `ocupada` e `conta_entregue` ainda podem ser marcadas à mão para teste; no próximo lote passam a vir da entrada do cliente.

### Perfis criados na primeira subida

Administrador (tudo), Gerente, Recepção (desconto até 10%), Supervisor da limpeza, Revisora e Camareira.
Mudança de perfil vale no próximo login do usuário.
