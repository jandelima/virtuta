import { randomBytes, createHmac } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { config, googleEnabled } from './config';
import { guests, invites, sessions, users, type UserRow } from './db';
import { DESKS } from '../../shared/layout';
import type { Look, PublicUser } from '../../shared/protocol';

export const SESSION_COOKIE = 'vt_sess';

export const randomId = (bytes = 16) => randomBytes(bytes).toString('base64url');

export function parseCookies(req: IncomingMessage) {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export interface Who { id: string; guest: boolean; token: string }

/** Identifica quem fez a requisição pela sessão no cookie. */
export function whoIs(req: IncomingMessage): Who | null {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (s.guest) return guests.get(s.user_id) ? { id: s.user_id, guest: true, token } : null;
  const u = users.get(s.user_id);
  return u && u.active ? { id: u.id, guest: false, token } : null;
}

// ---------- aparência padrão e cor de cada pessoa ----------
const MODELS = ['character-female-b', 'character-male-b', 'character-female-c', 'character-male-a', 'character-female-d', 'character-male-d', 'character-female-e', 'character-male-e', 'character-female-f', 'character-male-f'];
const COLORS = ['#3b5bdb', '#d9643a', '#169c8c', '#8b5cf6', '#c2874a', '#d6528c', '#2b8ab8', '#6d8f2e', '#c44f64', '#7c8597'];
function hash(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

export function publicUser(u: UserRow): PublicUser {
  const h = hash(u.id);
  return {
    id: u.id,
    name: u.name,
    role: u.role,
    desk: u.desk,
    look: u.look ? (JSON.parse(u.look) as Look) : null,
    model: MODELS[(u.desk ?? h) % MODELS.length],
    color: COLORS[(u.desk ?? h) % COLORS.length],
  };
}

export function publicGuest(id: string, name: string): PublicUser {
  return { id, name, role: 'guest', desk: null, look: null, model: 'character-male-e', color: '#7c8597' };
}

/** Cria (ou reativa) a pessoa do domínio e devolve a sessão. */
export function loginUser(email: string, name: string) {
  email = email.toLowerCase();
  let u = users.byEmail(email);
  const admin = config.adminEmails.includes(email) || users.all().length === 0;
  if (!u) {
    const taken = new Set(users.all().filter((x) => x.active).map((x) => x.desk));
    const desk = DESKS.find((d) => !taken.has(d.index))?.index ?? null;
    users.create({ id: randomId(9), email, name, role: admin ? 'admin' : 'member', desk });
    u = users.byEmail(email)!;
  } else if (!u.active) {
    return null;
  } else if (admin && u.role !== 'admin') {
    users.update(u.id, { role: 'admin' });
  }
  const token = randomId(32);
  sessions.create(token, u.id, false, 30);
  return { token, user: users.get(u.id)! };
}

export function loginGuest(inviteToken: string, name: string) {
  const inv = invites.valid(inviteToken);
  if (!inv) return null;
  const id = `g_${randomId(8)}`;
  guests.create(id, inviteToken, name.slice(0, 40) || inv.name);
  const token = randomId(32);
  // a sessão do visitante dura até o fim do convite
  sessions.create(token, id, true, Math.max(0.01, (inv.expires_at - Date.now()) / 864e5));
  return { token, id, host: inv.created_by };
}

// ---------- Google (OpenID Connect) ----------
export function googleAuthUrl(state: string) {
  const p = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: `${config.publicUrl}/api/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    hd: config.allowedDomain,
    prompt: 'select_account',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

/**
 * Troca o código pelo id_token. O token vem direto do Google por TLS e autenticado
 * com o segredo do cliente, então basta conferir audiência, emissor e domínio.
 */
export async function googleExchange(code: string) {
  if (!googleEnabled) throw new Error('Login Google não configurado');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      redirect_uri: `${config.publicUrl}/api/auth/google/callback`,
      grant_type: 'authorization_code',
    }),
  });
  if (!r.ok) throw new Error(`Google recusou o código (${r.status})`);
  const { id_token } = (await r.json()) as { id_token: string };
  const claims = JSON.parse(Buffer.from(id_token.split('.')[1], 'base64url').toString()) as {
    aud: string; iss: string; email: string; email_verified: boolean; hd?: string; name?: string; exp: number;
  };
  const domain = claims.email.split('@')[1]?.toLowerCase();
  if (claims.aud !== config.google.clientId) throw new Error('Token para outro aplicativo');
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)) throw new Error('Emissor inválido');
  if (claims.exp * 1000 < Date.now()) throw new Error('Token expirado');
  if (!claims.email_verified) throw new Error('E-mail não verificado');
  if (domain !== config.allowedDomain || (claims.hd ?? '').toLowerCase() !== config.allowedDomain) throw new Error('domain');
  return { email: claims.email, name: claims.name || claims.email.split('@')[0] };
}

// ---------- LiveKit ----------
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');

/** Token de acesso ao LiveKit (JWT HS256), sem depender do SDK do servidor. */
export function mediaToken(identity: string, name: string, room = 'escritorio') {
  const nowS = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({
    iss: config.livekit.apiKey,
    sub: identity,
    name,
    nbf: nowS - 10,
    exp: nowS + 6 * 3600,
    video: { room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true },
  });
  const sig = createHmac('sha256', config.livekit.apiSecret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
