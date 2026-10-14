# Instalação do VB Soluções Hoteleiras em servidor local (Windows 10/11 com Docker Desktop).
# Uso: clique com o botão direito > "Executar com o PowerShell" (como administrador).
$ErrorActionPreference = "Stop"
$Pasta = "C:\VB-Hoteis"
$Origem = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host "== VB Soluções Hoteleiras · servidor local =="

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Host "Instale o Docker Desktop (https://www.docker.com/products/docker-desktop/), abra-o uma vez e rode este instalador de novo."
  exit 1
}
New-Item -ItemType Directory -Force -Path $Pasta | Out-Null
Copy-Item "$Origem\docker-compose.yml", "$Origem\Caddyfile" $Pasta -Force
Set-Location $Pasta

function Aleatorio($n) { -join ((1..$n) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) }) }
if (-not (Test-Path ".env")) {
  $PastaBackup = Read-Host "Pasta dos backups (HD externo/NAS) [C:\VB-Hoteis\backups]"
  if (-not $PastaBackup) { $PastaBackup = "C:\VB-Hoteis\backups" }
  New-Item -ItemType Directory -Force -Path $PastaBackup | Out-Null
  $cfg = "$env:USERPROFILE\.docker\config.json"
  @(
    "SENHA_BANCO=$(Aleatorio 48)",
    "JWT_SECRET=$(Aleatorio 96)",
    "PASTA_BACKUP=$($PastaBackup -replace '\\','/')",
    "DOCKER_CONFIG_JSON=$($cfg -replace '\\','/')"
  ) | Set-Content -Encoding ASCII ".env"
  Write-Host "Arquivo .env criado em $Pasta (guarde uma cópia em lugar seguro)."
}

$Token = Read-Host "Token de acesso às imagens (fornecido pela Virtual Barra)" -AsSecureString
$Plano = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($Token))
$Plano | docker login ghcr.io -u uillianmoraes-beep --password-stdin

docker compose pull
docker compose up -d
$IP = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" -and $_.PrefixOrigin -ne "WellKnown" } | Select-Object -First 1).IPAddress
Write-Host ""
Write-Host "Pronto! Abra no navegador de qualquer computador da rede:"
Write-Host "   http://$IP/ativar   (primeira vez: cole o código de ativação)"
Write-Host "Depois:  http://$IP"
Write-Host "Dica: reserve este IP no roteador e deixe o Docker Desktop abrindo com o Windows."
