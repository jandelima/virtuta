// Sobe o Virtuta para teste na rede local: build de produção, LiveKit acessível pela rede e
// HTTPS pelo Caddy (sem HTTPS o navegador bloqueia microfone e câmera fora do localhost).
// Uso: npm run lan            (LAN_IP=... para escolher o endereço; --no-build para pular o build)
import { execSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const sh = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });
const quiet = (cmd) => { try { execSync(cmd, { cwd: root, stdio: 'ignore' }); } catch { /* já não existia */ } };

// endereço deste computador na rede (o da rota padrão)
const ip = process.env.LAN_IP ?? execSync('ip route get 1.1.1.1').toString().match(/src (\S+)/)?.[1];
if (!ip) throw new Error('Não achei o endereço na rede local. Rode com LAN_IP=192.168.x.x npm run lan');
const url = `https://${ip}:8443`;

if (!process.argv.includes('--no-build') || !existsSync(`${root}dist/server.js`)) sh('npm run build');

// LiveKit: aceita conexões da rede e anuncia o endereço da rede para a mídia (UDP 7882, TCP 7881)
quiet('docker rm -f virtuta-livekit');
sh(`docker run -d --name virtuta-livekit --network host livekit/livekit-server:v1.13.10 --dev --bind 0.0.0.0 --node-ip ${ip}`);

// Caddy: HTTPS na porta 8443 para o app e para o LiveKit; o volume guarda o certificado entre execuções
quiet('docker rm -f virtuta-caddy-lan');
sh(`docker run -d --name virtuta-caddy-lan --network host -e LAN_IP=${ip} -v ${root}deploy/Caddyfile.lan:/etc/caddy/Caddyfile:ro -v virtuta-caddy-lan:/data caddy:2.8`);

console.log(`\n  Virtuta na rede local: ${url}\n  (no primeiro acesso, aceite o aviso de certificado: Avançado > Continuar)\n`);
const server = spawn('node', ['dist/server.js'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, PORT: '8787', PUBLIC_URL: url, LIVEKIT_URL: `wss://${ip}:8443`, DEV_LOGIN: '1', STATIC_DIR: './dist/public' },
});
const stop = () => { server.kill('SIGTERM'); quiet('docker rm -f virtuta-caddy-lan'); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
server.on('exit', (code) => process.exit(code ?? 0));
