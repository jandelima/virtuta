# Virtuta

Escritório virtual da equipe: sala da equipe com mesas de cada integrante, salão aberto com
recepção, café, lounge e lazer, e uma sala de reunião.
Conversa por proximidade com voz, câmera e tela, quadros colaborativos, bilhetes nas mesas,
rádio compartilhada, foco coletivo, caixa de sugestões, visitantes e administração.

## Como é montado

| Parte | O que faz |
| --- | --- |
| `client/` | Página do escritório (TypeScript, three.js, LiveKit). Leve: cenário com poucas chamadas de desenho, sombra estática, quadros reduzidos quando nada se mexe e mídia carregada só quando alguém conversa. |
| `server/` | Um processo Node: login Google do domínio, sessões, presença em tempo real (WebSocket), regras de conversa, bilhetes, quadros, rádio, foco coletivo, caixa de sugestões, visitantes e administração. Dados em SQLite (`/data/virtuta.db`). |
| `shared/` | Planta do escritório e protocolo, usados pelos dois lados. |
| LiveKit | Servidor de mídia próprio (voz, câmera e tela). Cada pessoa só recebe a mídia de quem está na mesma conversa. |
| Caddy | HTTPS automático na VPS. |

## Desenvolvimento local

Requisitos: Node 22.22+ e Docker.

```bash
npm install
docker run -d --name virtuta-livekit --network host \
  livekit/livekit-server:v1.13.10 --dev --bind 127.0.0.1
npm run dev            # servidor em :8787 e página em http://localhost:5173
```

O arquivo `.env` de desenvolvimento liga o login sem Google (`DEV_LOGIN=1`): basta digitar um
nome. Para testar várias pessoas, use janelas anônimas ou outros navegadores.

`npm run check` confere os tipos; `npm run build` gera `dist/` (página e servidor).

## Testar na rede local

```bash
npm run lan            # build, LiveKit aberto para a rede e HTTPS pelo Caddy
```

O comando mostra o link (`https://<ip-deste-computador>:8443`). Quem estiver na mesma rede
abre o link, aceita o aviso de certificado (Avançado > Continuar) e entra digitando um nome.
O HTTPS é necessário: sem ele, o navegador bloqueia microfone e câmera fora do localhost.
Usa o mesmo banco do desenvolvimento (`data/`), então não rode `npm run dev` ao mesmo tempo.
Portas usadas: 8443/tcp (página e LiveKit), 7881/tcp e 7882/udp (mídia).

## Publicar numa VPS

A implantação desta máquina (`virtuta.site`, Nginx + systemd, sem Docker) está documentada
em [deploy/PRODUCAO.md](deploy/PRODUCAO.md). As instruções abaixo são a alternativa com Docker.

1. **VPS**: Linux com Docker (1 vCPU e 1 GB de RAM bastam para a equipe; 2 vCPU dão folga para vídeo).
2. **DNS**: aponte dois domínios para o IP da VPS, por exemplo `escritorio.suaempresa.com.br` e
   `lk.escritorio.suaempresa.com.br`.
3. **Firewall**: libere 80/tcp e 443/tcp (HTTPS), 7881/tcp e 7882/udp (mídia). Mantenha 7880 fechada.
   ```bash
   ufw allow 80,443,7881/tcp && ufw allow 7882/udp
   ```
4. **Login Google**: em console.cloud.google.com, crie um *ID do cliente OAuth* do tipo
   *Aplicativo da Web*, com o URI de redirecionamento
   `https://escritorio.suaempresa.com.br/api/auth/google/callback`. Em *Tela de consentimento*,
   escolha o tipo *Interno* (só contas do seu domínio).
5. **Configuração**: copie o projeto para a VPS, depois `cp .env.example .env` e preencha domínios,
   credenciais do Google, `ALLOWED_DOMAIN` e um par de chaves do LiveKit
   (`openssl rand -hex 16` e `openssl rand -hex 32`).
6. **Subir**:
   ```bash
   docker compose up -d --build
   ```
   O primeiro e-mail de `ADMIN_EMAILS` (ou a primeira pessoa a entrar) vira administração.

Atualizar: `git pull` (ou copiar os arquivos) e `docker compose up -d --build`.
Backup: o volume `dados` guarda o banco (`docker compose cp app:/data/virtuta.db ./backup.db`).

## Regras de conversa

- Chegar a 1,4 m de alguém disponível, por meio segundo, inicia a conversa; afastar-se além de
  2,2 m por 0,7 s encerra. Passar ao lado não conecta.
- Duas conversas não se fundem sozinhas; quem chega entra na conversa da pessoa mais próxima.
- Paredes isolam: sala da equipe, salão e sala de reunião nunca se misturam.
- Na sala de reunião, todos os presentes dividem a chamada. Com a porta fechada, quem chega bate e
  alguém de dentro autoriza.
- Em foco (individual ou coletivo), ausente ou com a conexão instável, ninguém é conectado
  automaticamente. Pedidos de “Posso falar?” continuam chegando e podem ser recusados.
- Microfone e câmera começam desligados e só a própria pessoa liga (teclas M e V).
