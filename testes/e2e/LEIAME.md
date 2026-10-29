# Testes de ponta a ponta (antes de cada publicação)

Um comando só, do zero e sem intervenção:

```bash
bash testes/e2e/rodar.sh
```

O que ele faz:

1. Compila o servidor se algum arquivo de `src/` mudou desde a última compilação.
2. Sobe um **Postgres de teste limpo** (pasta temporária, porta livre, UTF-8), usando o Postgres
   portátil de `C:/Users/UILLIAM/pgteste-vb` (troque com `PGTESTE_DIR=...`). As credenciais do admin
   de teste vêm de `pgteste-vb/teste.env`. **Nunca usa banco nem chaves de produção.**
3. Sobe a **Focus e a Spedy de mentira** (`falsos/`), que autorizam na hora (a Spedy deixa
   "processando" até consultar, como a de verdade). Sem `ANTHROPIC_API_KEY` (caminho sem IA).
4. Sobe o servidor (`node dist/main.js`) — as migrations rodam sozinhas; se alguma quebrar, o
   primeiro item já sai FALHOU.
5. Roda os roteiros de `roteiros/` em ordem e imprime **OK / FALHOU** de cada verificação e um
   resumo no fim. Sai com código 0 só se tudo passou. A saída fica em `ultima-rodada.txt` e o log
   do servidor em `servidor.log`.

Rodar só alguns roteiros: `bash testes/e2e/rodar.sh 03 05` (pedaços do nome).

## Roteiros

| Arquivo | O que confere |
|---|---|
| 01-login-e-sessao | login, senha errada, bloqueio após 5 erros, um computador por vez, 429 no login, cabeçalhos de segurança |
| 02-cadastros-painel-permissoes | licença, ambientes, unidades, tarifas, produtos, painel, o que cada perfil NÃO pode acessar |
| 03-conta-motel-e-caixa | entrada, consumo, estorno com senha do gerente, fechamento em várias formas, desconto acima do limite, pernoite, transferência, cancelamento, caixa (reforço, sangria, despesa, fechamento com diferença) |
| 04-hotel-reservas-faturado-mesa | diárias, 3ª pessoa, CPF da nota, conta faturada → contas a receber, reservas (conflito de datas, check-in com sinal), mesa de restaurante com gorjeta |
| 05-notas-fiscais | emissor Focus e Spedy por CNPJ, NFC-e + NFS-e da conta, `/notas` com filtro `forma`, `/notas/unidade/:id`, recusa, cancelamento, PDF assinado da Spedy, NF-e e carta de correção |
| 06-estoque-e-compras | entrada, baixa pela venda, estorno devolve, transferência, inventário, perda, cotação respondida pelo link público, recebimento |
| 07-financeiro-e-conciliacao | contas a pagar (boletos, baixa), caixa ADM, DRE/fluxo, conciliação com os arquivos de teste da própria rota (CSV + OFX) |
| 08-rh-e-ponto | funcionários (o que a recepção vê), rosto com consentimento, ponto no tablet e pelo link, cerca de localização |
| 09-revenda-e-isolamento | planos, parceiros, teste grátis, bloqueio 402, uma empresa não mexe na outra, 429 no cadastro |
| 10-cliques-ao-mesmo-tempo | dois cliques / dois computadores ao mesmo tempo em entrada, fechamento, estorno, caixa, contas a pagar e receber, nota |

## Para quem mexe nos roteiros

Subir uma vez e deixar no ar (`node testes/e2e/tudo.mjs --manter`) e, em outro terminal, rodar
só o roteiro que está escrevendo: `node testes/e2e/roteiros.mjs 05`. Nesta máquina o servidor
leva de 2 a 4 minutos para subir e a compilação uns 8 minutos.
