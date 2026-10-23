# Virtuta nesta VPS

Implantação em 23/10/2026. IP público: **168.231.94.205**. Ubuntu 22.04, 4 vCPUs,
16 GB de RAM, aproximadamente 150 GB disponíveis na implantação. Os sites já existentes
permanecem no Nginx. App e LiveKit usam usuários próprios sem privilégios e systemd.

## DNS na Hostinger

Em **Domínios → virtuta.site → DNS / Nameservers → Registros DNS**, configure:

| Tipo | Nome | Destino | TTL |
| --- | --- | --- | --- |
| A | @ | 168.231.94.205 | 300 |
| CNAME | www | virtuta.site | 300 |
| A | lk | 168.231.94.205 | 300 |

Substitua o A de estacionamento (`2.57.91.91` na implantação). Remova A/AAAA conflitantes
somente de `@`, `www` e `lk`. Não altere MX/TXT de e-mail. Não precisa trocar nameservers;
o domínio já usa `aurora.dns-parking.com` e `nebula.dns-parking.com`.
Se houver CAA restringindo emissores, permita `letsencrypt.org`.

Não é necessário criar AAAA. Se quiser IPv6, o endereço da VPS é
`2a02:4780:14:d692::1`; o servidor e o firewall estão preparados para ele.
Se houver firewall adicional no painel da VPS, permita 80/tcp, 443/tcp, 7881/tcp e 7882/udp,
além do acesso administrativo SSH. Não abra 8787 nem 7880.

## HTTPS automático

Status: DNS validado e certificado público Let's Encrypt emitido em 23/10/2026,
com validade inicial até 21/01/2027. App e LiveKit respondem por HTTPS; `www`
redireciona para `virtuta.site`. A renovação automática permanece configurada.

Enquanto não há certificado, HTTP retorna 503 e publica apenas o desafio ACME. O site
não oferece login ou sessões por HTTP. `virtuta-https.timer` consulta DNS a cada cinco
minutos e verifica os três nomes em dois resolvedores públicos. Quando apontarem somente
para esta VPS, solicita um certificado Let's Encrypt e ativa `nginx-https.conf`.
Depois disso, HTTP redireciona para HTTPS e `www` redireciona para o domínio principal.
Se uma tentativa ACME falhar, o intervalo entre novas tentativas é de seis horas para
evitar limites de emissão. Esse fluxo já concluiu a primeira emissão.

```bash
systemctl start virtuta-https.service
journalctl -u virtuta-https -n 30 --no-pager
systemctl list-timers virtuta-https.timer certbot.timer
```

A renovação usa o `certbot.timer` preexistente, com hook que valida e recarrega o Nginx.
O certificado cobre `virtuta.site`, `www.virtuta.site` e `lk.virtuta.site`.
Após a primeira emissão, pode-se validar a renovação com `certbot renew --cert-name virtuta.site --dry-run`.

## Ativar login Google

O domínio permitido já é **lsd.ufcg.edu.br** e o administrador configurado é
**jan.filho@lsd.ufcg.edu.br**. `DEV_LOGIN=0`; o sistema se recusa a iniciar em produção
se alguém tentar habilitar o login de desenvolvimento. Nenhum usuário foi pré-criado.
O primeiro usuário só ganha administração automaticamente se não houver lista explícita de administradores.

Status: credenciais OAuth instaladas em 23/10/2026, no arquivo protegido
`/etc/virtuta/app.env`. Login Google ativo; redirecionamento, cliente, callback,
domínio e cookie de estado validados pela URL pública. A conclusão do login com
uma conta real exige a autenticação do próprio usuário no Google.

Para recriar as credenciais no futuro, use no Google Cloud um cliente OAuth do tipo **Aplicativo da Web**:

- Origem JavaScript autorizada: `https://virtuta.site`.
- URI de redirecionamento: `https://virtuta.site/api/auth/google/callback`.
- Escopos usados: `openid email profile`.
- Os escopos básicos de login têm exceção às restrições comuns do modo de teste.
- O modo Interno só funciona se o projeto Google Cloud pertencer à organização Workspace
  correspondente. A checagem de domínio também é feita no servidor.

Edite **`/etc/virtuta/app.env`**, de propriedade de root e modo 0600, e preencha
`GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`. Não coloque as credenciais no Git ou no chat.

```bash
sudoedit /etc/virtuta/app.env
systemctl restart virtuta
curl -s http://127.0.0.1:8787/api/me
```

O último comando deve continuar retornando 401 sem sessão, mas com `googleEnabled: true`.
As chaves fortes do LiveKit já foram geradas e configuradas nos dois serviços.

## Operação e atualização

- Runtime Node isolado: `/opt/virtuta/node` (22.23.4 na implantação), sem mudar o Node dos outros sites.
- LiveKit: `/opt/virtuta/livekit-server` (1.13.10). Downloads conferidos por SHA-256.
- Versões: `/opt/virtuta/releases/`; versão ativa: `/opt/virtuta/current`.
- Banco: `/var/lib/virtuta/virtuta.db` (SQLite WAL).
- Configurações/segredos: `/etc/virtuta/`.
- App: somente `127.0.0.1:8787`; sinalização LiveKit: somente `127.0.0.1:7880`.
- Mídia WebRTC: 7881/tcp e 7882/udp, criptografada pelo WebRTC.
- App: limite de 768 MB de memória. LiveKit: limite de 2 GB e até 2 vCPUs.
- Buffer máximo UDP aumentado para 7,5 MB em `/etc/sysctl.d/60-virtuta-webrtc.conf`.
- UFW ativo com entrada bloqueada por padrão e portas de SSH/web/mídia permitidas.
  As portas preexistentes 3010, 3011 e 3020 foram preservadas para os outros serviços.
- Nginx: limites de requisição, limite de corpo, TLS 1.2/1.3, HSTS, CSP e proteção de enquadramento.
  Logs próprios do app não registram query strings de OAuth/convites; logs de sinalização não registram tokens.
- Sessões usam HttpOnly, Secure e SameSite=Lax. Mutações e WebSocket verificam a origem em HTTPS.

```bash
systemctl status virtuta virtuta-livekit --no-pager
journalctl -u virtuta -u virtuta-livekit -n 60 --no-pager
curl -fsS http://127.0.0.1:8787/api/health
nginx -t

# Publicar alterações do repositório após revisar os arquivos:
cd /root/virtuta
bash app/deploy/release.sh
```

O script instala pelo lockfile, compila, executa os testes de segurança e instala somente
dependências de produção na versão publicada. Audita essas dependências, faz backup antes
de trocar a versão, reinicia e valida o health check. Se falhar, restaura o link da versão anterior.
Não faz migrações reversas do banco. As configurações de Nginx/systemd versionadas em
`deploy/` devem ser instaladas separadamente quando alteradas.

## Backups

`virtuta-backup.timer` roda diariamente às 03:30, com até 15 minutos de dispersão.
Usa a API SQLite Backup para incluir corretamente os dados em WAL e valida integridade.
Retenção local de 14 dias, em `/var/backups/virtuta/`, com acesso somente root.
Foi gerado e validado um backup inicial. Estes backups ficam na mesma VPS: ainda é
necessário copiar para armazenamento externo para proteção contra perda da máquina.

```bash
systemctl start virtuta-backup
journalctl -u virtuta-backup -n 10 --no-pager
```

Para restaurar, pare o app, preserve os arquivos atuais, copie o backup escolhido para
`/var/lib/virtuta/virtuta.db`, remova os arquivos auxiliares WAL/SHM antigos após preservar
o banco, devolva propriedade `virtuta:virtuta` e modo 0600, e reinicie o app.

## Limites da validação

Build, checagem TypeScript, testes de sessão/origem/WebSocket, auditoria npm e backup
verificados. Sete testes de segurança passaram. Dois contextos de navegador abriram o
escritório 3D, conectaram o WebSocket e publicaram/receberam áudio e vídeo via LiveKit,
sem erros no navegador. Esse teste usou uma instância temporária com dados fictícios,
um certificado de teste e proxy TLS acessível somente em loopback; não comprova emissão
do certificado público nem conectividade de uma rede externa. TLS 1.2/1.3 foram aceitos
e TLS 1.1 recusado no teste do proxy. Evidências locais em `/root/virtuta-deploy-checks/2026-10-23/`.

Um teste simples do health check local fez 2.000 requisições com concorrência 16,
zero falhas, aproximadamente 1.427 requisições/s e latência p95 de 24,71 ms.
Ele mede apenas essa operação simples da API. App e LiveKit consumiram juntos cerca
de 32 MB de RAM inicialmente em repouso; após o teste de mídia, aproximadamente 72 MB.
A capacidade inicial é adequada para uma equipe pequena. A capacidade com
vários vídeos depende de resolução e tráfego de rede; RAM livre não garante banda disponível.
O redirecionamento Google já foi validado com as credenciais instaladas. A autenticação
completa com uma conta real deve ser feita pelo próprio usuário.
Não há TURN/TLS dedicado; redes corporativas que bloqueiem UDP e também 7881/tcp podem
impedir a mídia. Chamadas reais pela internet dependem de DNS, certificado e acesso externo às portas.
