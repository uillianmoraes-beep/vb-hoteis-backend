#!/usr/bin/env bash
# Instalação do VB Soluções Hoteleiras em servidor local (Ubuntu/Debian).
# Uso: sudo bash instalar.sh
set -euo pipefail
PASTA=/opt/vb-hoteis
ORIGEM="$(cd "$(dirname "$0")" && pwd)"

if [ "$(id -u)" -ne 0 ]; then echo "Rode com sudo: sudo bash instalar.sh"; exit 1; fi
echo "== VB Soluções Hoteleiras · servidor local =="

if ! command -v docker >/dev/null 2>&1; then
  echo "Instalando o Docker..."
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker >/dev/null 2>&1 || true

mkdir -p "$PASTA"
cp "$ORIGEM/docker-compose.yml" "$ORIGEM/Caddyfile" "$PASTA/"
cd "$PASTA"

if [ ! -f .env ]; then
  read -rp "Pasta dos backups (HD externo/NAS) [${PASTA}/backups]: " PASTA_BACKUP
  PASTA_BACKUP=${PASTA_BACKUP:-$PASTA/backups}
  mkdir -p "$PASTA_BACKUP"
  cat > .env <<ENV
SENHA_BANCO=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 48)
PASTA_BACKUP=$PASTA_BACKUP
DOCKER_CONFIG_JSON=/root/.docker/config.json
ENV
  chmod 600 .env
  echo "Arquivo .env criado (guarde uma cópia em lugar seguro: sem ele não dá para reinstalar com os mesmos dados)."
fi

if [ ! -f /root/.docker/config.json ] || ! grep -q ghcr.io /root/.docker/config.json; then
  echo "Token de acesso às imagens (fornecido pela Virtual Barra):"
  read -rsp "Token: " TOKEN; echo
  echo "$TOKEN" | docker login ghcr.io -u uillianmoraes-beep --password-stdin
fi

docker compose pull
docker compose up -d

IP=$(hostname -I | awk '{print $1}')
echo
echo "Pronto! Abra no navegador de qualquer computador da rede:"
echo "   http://$IP/ativar   (primeira vez: cole o código de ativação)"
echo "Depois:  http://$IP"
echo "Dica: reserve este IP no roteador para ele nunca mudar."
