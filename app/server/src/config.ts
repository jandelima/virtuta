import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Configuração por variáveis de ambiente (veja .env.example). Um arquivo .env na pasta
// de execução também é lido; variáveis já definidas no ambiente têm prioridade.

if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const env = process.env;
const bool = (v: string | undefined) => v === '1' || v === 'true';

export const config = {
  port: Number(env.PORT ?? 8787),
  /** Endereço público do app, usado no retorno do login e nos convites. */
  publicUrl: (env.PUBLIC_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
  dataDir: resolve(env.DATA_DIR ?? './data'),
  staticDir: resolve(env.STATIC_DIR ?? './dist/public'),
  google: {
    clientId: env.GOOGLE_CLIENT_ID ?? '',
    clientSecret: env.GOOGLE_CLIENT_SECRET ?? '',
  },
  /** Só contas Google deste domínio entram (ex.: empresa.com.br). */
  allowedDomain: (env.ALLOWED_DOMAIN ?? '').toLowerCase(),
  adminEmails: (env.ADMIN_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  /** Login sem Google, só para desenvolvimento local. Nunca ligar em produção. */
  devLogin: bool(env.DEV_LOGIN),
  livekit: {
    /** Endereço que o navegador usa para falar com o LiveKit (ws:// local, wss:// em produção). */
    url: env.LIVEKIT_URL ?? 'ws://localhost:7880',
    apiKey: env.LIVEKIT_API_KEY ?? 'devkey',
    apiSecret: env.LIVEKIT_API_SECRET ?? 'secret',
  },
  officeName: env.OFFICE_NAME ?? 'Virtuta',
};

export const secureCookies = config.publicUrl.startsWith('https://');
export const googleEnabled = !!(config.google.clientId && config.google.clientSecret && config.allowedDomain);

mkdirSync(config.dataDir, { recursive: true });

if (config.devLogin && secureCookies) {
  console.warn('[aviso] DEV_LOGIN está ligado com endereço https: desligue em produção.');
}
