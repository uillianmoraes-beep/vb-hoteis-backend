# Servidor local · VB Soluções Hoteleiras

O sistema roda num computador do cliente e **funciona sem internet**: recepção, portaria,
governança e celulares/tablets no **Wi-Fi do hotel** continuam trabalhando com a internet fora.
A internet só é usada para: renovar a licença, atualizações, reserva online, Pix/boleto e cópia externa.

## Computador recomendado
- Mini PC ou desktop: Intel i3/Ryzen 3 (ou melhor), **8 GB de memória**, **SSD 240 GB**
- Ubuntu Server 22.04/24.04 (recomendado) ou Windows 10/11 Pro com Docker Desktop
- **Nobreak** e cabo de rede no roteador; **IP fixo** (reserva no roteador)
- HD externo ou NAS para os backups automáticos

## Instalar (Ubuntu)
1. Copie a pasta `instalacao` para o servidor.
2. `sudo bash instalar.sh` — informe a pasta dos backups e o token de acesso às imagens.
3. No painel da Virtual Barra (`/vb` › Servidores locais), gere o **código de ativação** da empresa.
4. Abra `http://IP-DO-SERVIDOR/ativar`, cole o código: licença e dados da empresa vêm da nuvem.
5. Entre com o mesmo login e senha de antes em `http://IP-DO-SERVIDOR`.

## Instalar (Windows)
Instale o Docker Desktop, depois rode `instalar-windows.ps1` (PowerShell como administrador) e siga os passos 3 a 5.

## No dia a dia
- **Celulares e tablets**: sempre no **Wi-Fi do hotel** (o roteador funciona sem internet). No 4G eles não enxergam o servidor nem as impressoras.
- **Atualizações**: descem sozinhas às 04:30 quando há internet.
- **Backup**: menu Backup › Rotina automática. Cada cópia é gravada também na pasta escolhida na instalação.
- **Licença**: renova sozinha a cada 6 horas com internet e vale 30 dias sem internet.
  Vencida, só os módulos extras desligam; o básico (painel, contas, caixa) continua.

## Comandos úteis (na pasta `/opt/vb-hoteis`)
- Ver se está tudo de pé: `docker compose ps`
- Atualizar agora: `docker compose pull && docker compose up -d`
- Reiniciar: `docker compose restart`
- **Guarde o arquivo `.env`** num lugar seguro: ele tem a senha do banco.
