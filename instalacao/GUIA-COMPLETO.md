# Guia de instalação do servidor do cliente · VB Hotéis

Passo a passo para o técnico da Virtual Barra instalar o VB Hotéis no computador do cliente,
com proteção contra falhas (redundância) e cópias de segurança (backups).
O objetivo é o sistema funcionar **24 horas por dia**, mesmo sem internet e mesmo se o computador quebrar.

---

## 1. Antes da visita (checklist)

- [ ] Plano contratado e empresa criada no painel da Virtual Barra (Revenda › Clientes).
- [ ] **Código de ativação** gerado em `/vb` › Servidores locais (vale 24 horas).
- [ ] **Token de acesso às imagens** do sistema (fica com a Virtual Barra).
- [ ] Pendrive com a pasta `instalacao` e o Ubuntu Server 24.04 (pendrive de instalação).
- [ ] Combinar com o cliente: horário sem movimento (a virada leva cerca de 2 horas).

## 2. Equipamento (o que pedir ao cliente)

| Item | Mínimo | Por quê |
|---|---|---|
| Computador servidor | Mini PC ou desktop, i3/Ryzen 3, **8 GB**, **SSD 240 GB** | Roda o sistema e o banco de dados |
| **Nobreak** | 600 VA, com 15 a 30 minutos de bateria | Queda de luz não desliga o servidor nem corrompe dados |
| HD externo ou NAS | 1 TB | Recebe os backups automáticos |
| Cabo de rede | Servidor **no cabo**, não no Wi-Fi | Estabilidade |
| Roteador | Wi-Fi cobrindo recepção, portaria e quartos | Celulares e tablets usam o servidor pelo Wi-Fi |
| **Computador reserva** (recomendado) | Qualquer PC com 8 GB e SSD | Assume se o servidor quebrar (ver item 7) |

## 3. Rede

1. Ligue o servidor **no cabo** do roteador.
2. No roteador, **reserve um IP fixo** para o servidor (ex.: `192.168.0.10`).
3. Ligue o roteador e o servidor **no nobreak**.
4. Anote: IP do servidor, senha do Wi-Fi e senha do roteador (na ficha do cliente).

## 4. Instalação (Ubuntu Server, recomendado)

1. Instale o **Ubuntu Server 24.04** no SSD (usuário `vb`, marque "OpenSSH server").
2. Copie a pasta `instalacao` do pendrive para o servidor.
3. Ligue o HD externo/NAS e anote a pasta onde ele aparece (ex.: `/mnt/backup`).
4. Rode: `sudo bash instalar.sh`
   - Pasta dos backups: a do HD externo (ex.: `/mnt/backup/vb`).
   - Token: o token de acesso às imagens.
5. No fim, o instalador mostra o endereço: `http://IP-DO-SERVIDOR/ativar`.
6. Abra esse endereço num computador da rede, cole o **código de ativação**: a licença e os dados da empresa descem da nuvem.
7. Entre com o login do cliente em `http://IP-DO-SERVIDOR`.
8. **Guarde o arquivo `/opt/vb-hoteis/.env`** no cofre da Virtual Barra (tem a senha do banco; sem ele não dá para reinstalar com os mesmos dados).

> Windows: instale o Docker Desktop e rode `instalar-windows.ps1` como administrador; depois siga os passos 5 a 8.

## 5. Depois de instalado

- **Impressoras**: em cada computador da recepção/cozinha, instale o agente de impressão (Área do cliente › Downloads).
- **Celulares e tablets**: sempre no **Wi-Fi do hotel**. No 4G eles não enxergam o servidor.
- **Atalho na tela**: abra `http://IP-DO-SERVIDOR` no navegador e "Adicionar à tela inicial".
- **Treinamento** da equipe e checklist da implantação (Área do cliente › Implantação).

## 6. Backups (cópias de segurança): regra 3-2-1

O sistema guarda os dados em **3 lugares**, em **2 tipos de mídia**, com **1 fora do hotel**:

| Cópia | Onde | Quando | Quem faz |
|---|---|---|---|
| 1. Cópia do banco inteiro | HD externo/NAS (`backups/banco`) | **A cada hora** (guarda 7 dias) | Automático (serviço `copia-banco`) |
| 2. Backup do sistema (com senha) | HD externo/NAS | Todo dia no horário escolhido | Automático (menu Backup › Rotina automática) |
| 3. Cópia fora do hotel | Nuvem da Virtual Barra | Todo dia, quando há internet | Automático |

Configure no menu **Backup › Rotina automática**: horário (ex.: 03:00), quantas cópias guardar (30) e uma **senha do backup** (guardar no cofre).

**Todo mês, teste a restauração** (é o que garante que o backup presta):
1. Num computador de teste, instale o sistema (item 4) sem ativar.
2. Menu Backup › Restaurar: escolha o último arquivo e a senha.
3. Confira se as contas e o caixa do dia anterior aparecem. Anote na ficha do cliente.

## 7. Redundância: o que fazer se o servidor parar

**Nível 1 (todo cliente): proteção do próprio servidor**
- Nobreak, SSD, cabo de rede, IP fixo e os 3 backups acima.
- O sistema reinicia sozinho depois de queda de energia (`restart: always`).

**Nível 2 (recomendado): computador reserva**, volta em cerca de 30 minutos
1. Deixe o computador reserva já instalado (item 4, passos 1 a 4), **sem ativar**, com o mesmo `.env` do servidor.
2. Se o servidor quebrar: ligue o reserva no cabo, dê a ele **o mesmo IP** no roteador.
3. Em `/opt/vb-hoteis`: copie o último arquivo de `backups/banco` do HD externo e restaure:
   `docker compose exec -T banco pg_restore -U vbhoteis -d vbhoteis --clean --if-exists < ARQUIVO.dump`
4. `docker compose restart` e confira o login. Celulares e impressoras voltam sozinhos (mesmo IP).
5. Perda máxima: **até 1 hora** de lançamentos (a cópia do banco é de hora em hora).

**Nível 3 (contingência pela nuvem)**: se não houver computador reserva, a Virtual Barra pode
colocar a empresa para trabalhar **na nuvem** a partir da última cópia enviada, até o servidor voltar
(o hotel usa pela internet, no endereço do sistema). Chame o suporte da Virtual Barra.

## 8. Atualizações e licença

- Atualizações descem **sozinhas às 04:30** quando há internet.
- A licença renova sozinha a cada 6 horas e **vale 30 dias sem internet**.
- Sem internet o hotel continua: recepção, portaria, caixa, governança, celulares no Wi-Fi.
  Param só: reserva online, Pix/boleto automáticos e a emissão das notas fiscais (as contas ficam em "A emitir" e as notas saem quando a internet voltar).

## 9. Problemas comuns (para o suporte)

| Sintoma | O que fazer |
|---|---|
| Ninguém abre o sistema | Servidor ligado? Nobreak ok? Cabo de rede? No servidor: `docker compose ps` (todos "running") |
| Só os celulares não abrem | Estão no 4G? Colocar no Wi-Fi do hotel |
| Impressora não imprime | Rodar `reparar-impressao.bat` no computador da impressora (Downloads) |
| Sem internet | Rodar `reparar-internet.bat`; o sistema continua no local |
| HD externo cheio | Trocar o HD; os backups mais antigos já são apagados sozinhos |
| Servidor não liga | Item 7, Nível 2 (computador reserva) |

Comandos úteis (na pasta `/opt/vb-hoteis`):
- Ver se está tudo de pé: `docker compose ps`
- Ver erros do sistema: `docker compose logs --tail 100 api`
- Atualizar agora: `docker compose pull && docker compose up -d`
- Reiniciar: `docker compose restart`

## 10. Ficha do cliente (preencher na instalação)

- Empresa / CNPJ: ____________________
- IP do servidor: ____________  Pasta dos backups: ____________
- Computador reserva? ( ) sim ( ) não   IP: ____________
- `.env` guardado no cofre? ( )   Senha do backup no cofre? ( )
- Teste de restauração feito em: ___/___/______
- Técnico: ____________________
