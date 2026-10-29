#!/usr/bin/env bash
# Roteiro de testes de ponta a ponta do backend: compila (se o código mudou), sobe um Postgres
# de teste limpo, roda as migrations, sobe o servidor com Focus e Spedy de mentira e roda tudo.
# Uso: bash testes/e2e/rodar.sh [pedaço-do-nome-do-roteiro ...]
set -euo pipefail
cd "$(dirname "$0")/../.."

TSC="$(node -p "require.resolve('typescript/bin/tsc')")"
if [ ! -f dist/main.js ] || [ -n "$(find src -name '*.ts' -newer dist/main.js -print -quit)" ]; then
  echo "Compilando o servidor (o código mudou desde a última compilação)..."
  rm -rf dist
  node "$TSC" -p tsconfig.build.json
fi

node testes/e2e/tudo.mjs "$@" 2>&1 | tee testes/e2e/ultima-rodada.txt
exit "${PIPESTATUS[0]}"
