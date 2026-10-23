import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { WebSocketServer } from 'ws';
import { config, googleEnabled, secureCookies } from './config';
import { guests, invites, sessions, settings, users } from './db';
import { SESSION_COOKIE, googleAuthUrl, googleExchange, loginGuest, loginUser, mediaToken, parseCookies, publicUser, randomId, whoIs } from './auth';
import { Office } from './office';
import { DESKS } from '../../shared/layout';

const office = new Office();

// ---------- utilidades HTTP ----------
function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
function redirect(res: ServerResponse, to: string, cookies: string[] = []) {
  res.writeHead(302, { location: to, 'set-cookie': cookies });
  res.end();
}
function cookie(name: string, value: string, maxAgeS: number) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeS}${secureCookies ? '; Secure' : ''}`;
}
async function body<T>(req: IncomingMessage): Promise<T> {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 64_000) throw new Error('corpo grande demais');
  }
  return (raw ? JSON.parse(raw) : {}) as T;
}
const sessionCookie = (token: string, days = 30) => cookie(SESSION_COOKIE, token, Math.round(days * 86400));

// ---------- rotas ----------
type Handler = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void> | void;
const routes: Record<string, Handler> = {
  'GET /api/health': (_req, res) => json(res, 200, { ok: true }),
  'GET /api/me': (req, res) => {
    const who = whoIs(req);
    const cfg = { googleEnabled, devLogin: config.devLogin, officeName: settings.get('officeName') ?? config.officeName, domain: config.allowedDomain };
    if (!who) return json(res, 401, { config: cfg });
    if (who.guest) {
      const g = guests.get(who.id)!;
      return json(res, 200, { config: cfg, user: { id: g.id, name: g.name, role: 'guest' } });
    }
    return json(res, 200, { config: cfg, user: publicUser(users.get(who.id)!), email: users.get(who.id)!.email });
  },

  'GET /api/auth/google': (_req, res) => {
    if (!googleEnabled) return json(res, 404, { error: 'Login Google não configurado' });
    const state = randomId(16);
    redirect(res, googleAuthUrl(state), [cookie('vt_state', state, 600)]);
  },

  'GET /api/auth/google/callback': async (req, res, url) => {
    const state = parseCookies(req).vt_state;
    if (!state || state !== url.searchParams.get('state')) return redirect(res, '/?erro=sessao');
    try {
      const { email, name } = await googleExchange(url.searchParams.get('code') ?? '');
      const r = loginUser(email, name);
      if (!r) return redirect(res, '/?erro=removido');
      redirect(res, '/', [sessionCookie(r.token), cookie('vt_state', '', 0)]);
    } catch (e) {
      const domain = (e as Error).message === 'domain';
      redirect(res, `/?erro=${domain ? 'dominio' : 'google'}`);
    }
  },

  'POST /api/auth/dev': async (req, res) => {
    if (!config.devLogin) return json(res, 404, { error: 'indisponível' });
    const b = await body<{ name?: string; email?: string }>(req);
    const name = String(b.name ?? '').trim().slice(0, 40);
    if (!name) return json(res, 400, { error: 'Informe um nome' });
    const email = String(b.email ?? `${name.toLowerCase().replace(/[^a-z0-9]+/g, '.')}@dev.local`);
    const r = loginUser(email, name);
    if (!r) return json(res, 403, { error: 'Acesso removido' });
    res.setHeader('set-cookie', sessionCookie(r.token));
    json(res, 200, { ok: true });
  },

  'POST /api/auth/logout': (req, res) => {
    const who = whoIs(req);
    if (who) sessions.delete(who.token);
    res.setHeader('set-cookie', cookie(SESSION_COOKIE, '', 0));
    json(res, 200, { ok: true });
  },

  'GET /api/media-token': (req, res) => {
    const who = whoIs(req);
    if (!who) return json(res, 401, {});
    const p = office.people.get(who.id);
    if (who.guest && (!p || p.presence.waiting)) return json(res, 403, {});
    json(res, 200, { url: config.livekit.url, token: mediaToken(who.id, office.nameOf(who.id)) });
  },

  // convites de visitantes
  'POST /api/invites': async (req, res) => {
    const who = whoIs(req);
    if (!who || who.guest) return json(res, 401, {});
    const b = await body<{ name?: string; hours?: number }>(req);
    const name = String(b.name ?? '').trim().slice(0, 40) || 'Visitante';
    const hours = Math.min(72, Math.max(1, Number(b.hours) || 8));
    const token = randomId(18);
    invites.create({ token, name, createdBy: who.id, hours });
    json(res, 200, { url: `${config.publicUrl}/?convite=${token}`, expiresAt: Date.now() + hours * 36e5 });
  },
  'GET /api/invite': (_req, res, url) => {
    const inv = invites.valid(url.searchParams.get('token') ?? '');
    if (!inv) return json(res, 404, { error: 'Convite inválido ou expirado' });
    json(res, 200, { name: inv.name, host: users.get(inv.created_by)?.name ?? '', expiresAt: inv.expires_at, officeName: settings.get('officeName') ?? config.officeName });
  },
  'POST /api/invite/join': async (req, res) => {
    const b = await body<{ token?: string; name?: string }>(req);
    const r = loginGuest(String(b.token ?? ''), String(b.name ?? ''));
    if (!r) return json(res, 404, { error: 'Convite inválido ou expirado' });
    res.setHeader('set-cookie', sessionCookie(r.token, 3));
    json(res, 200, { ok: true });
  },

  // administração
  'GET /api/admin': (req, res) => {
    if (!isAdmin(req)) return json(res, 403, {});
    json(res, 200, {
      members: users.all().map((u) => ({ ...publicUser(u), email: u.email, active: !!u.active, online: office.people.has(u.id) })),
      invites: invites.all().map((i) => ({ token: i.token, name: i.name, host: users.get(i.created_by)?.name ?? '', createdAt: i.created_at, expiresAt: i.expires_at, revoked: !!i.revoked })),
      settings: { officeName: settings.get('officeName') ?? config.officeName },
      desks: DESKS.map((d) => d.index),
    });
  },
  'POST /api/admin/member': async (req, res) => {
    if (!isAdmin(req)) return json(res, 403, {});
    const b = await body<{ id: string; role?: 'member' | 'admin'; desk?: number | null; active?: boolean; name?: string }>(req);
    const u = users.get(b.id);
    if (!u) return json(res, 404, {});
    if (b.desk !== undefined) {
      if (b.desk !== null && !DESKS.some((d) => d.index === b.desk)) return json(res, 400, { error: 'Mesa inexistente' });
      // quem estava na mesa escolhida fica sem mesa
      const holder = users.all().find((x) => x.desk === b.desk && x.id !== u.id);
      if (holder && b.desk !== null) { users.update(holder.id, { desk: null }); office.userChanged(holder.id); }
      users.update(u.id, { desk: b.desk });
    }
    if (b.role) users.update(u.id, { role: b.role === 'admin' ? 'admin' : 'member' });
    if (b.name) users.update(u.id, { name: String(b.name).slice(0, 40) });
    if (b.active !== undefined) {
      users.update(u.id, { active: b.active, ...(b.active ? {} : { desk: null }) });
      if (!b.active) sessions.deleteForUser(u.id);
    }
    office.userChanged(u.id);
    json(res, 200, { ok: true });
  },
  'POST /api/admin/invite/revoke': async (req, res) => {
    if (!isAdmin(req)) return json(res, 403, {});
    const b = await body<{ token: string }>(req);
    invites.revoke(b.token);
    json(res, 200, { ok: true });
  },
  'POST /api/admin/settings': async (req, res) => {
    if (!isAdmin(req)) return json(res, 403, {});
    const b = await body<{ officeName?: string }>(req);
    if (b.officeName) settings.set('officeName', String(b.officeName).slice(0, 40));
    json(res, 200, { ok: true });
  },
};

function isAdmin(req: IncomingMessage) {
  const who = whoIs(req);
  return !!who && !who.guest && users.get(who.id)?.role === 'admin';
}

// ---------- arquivos do app ----------
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};
function serveStatic(req: IncomingMessage, res: ServerResponse, url: URL) {
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(config.staticDir, rel);
  if (!file.startsWith(config.staticDir) || !existsSync(file) || statSync(file).isDirectory()) file = join(config.staticDir, 'index.html');
  if (!existsSync(file)) { res.writeHead(404); return res.end('Build do cliente não encontrado. Rode npm run build.'); }
  const ext = extname(file);
  // arquivos com hash no nome podem ficar em cache para sempre; o resto, revalidado
  const cache = rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : ext === '.glb' || ext === '.png' ? 'public, max-age=604800' : 'no-cache';
  res.writeHead(200, { 'content-type': TYPES[ext] ?? 'application/octet-stream', 'cache-control': cache });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}

const server = createServer(async (req, res) => {
  try {
    if (secureCookies && !['GET', 'HEAD', 'OPTIONS'].includes(req.method ?? '') && req.headers.origin !== config.publicUrl) {
      return json(res, 403, { error: 'origem não permitida' });
    }
    const url = new URL(req.url ?? '/', 'http://local');
    const route = routes[`${req.method} ${url.pathname}`];
    if (route) return await route(req, res, url);
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'rota inexistente' });
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, url);
    json(res, 405, {});
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, 500, { error: 'erro interno' });
  }
});

// ---------- tempo real ----------
const wss = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024 });
server.on('upgrade', (req, socket, head) => {
  if (req.url?.split('?')[0] !== '/ws') return socket.destroy();
  if (secureCookies && req.headers.origin !== config.publicUrl) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    return socket.destroy();
  }
  const who = whoIs(req);
  if (!who) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy(); }
  wss.handleUpgrade(req, socket, head, (ws) => {
    (ws as unknown as { alive: boolean }).alive = true;
    ws.on('pong', () => ((ws as unknown as { alive: boolean }).alive = true));
    office.connect(ws, who);
  });
});
// conexões mortas (computador suspenso, rede caída) são encerradas pelo batimento
setInterval(() => {
  for (const ws of wss.clients) {
    const w = ws as unknown as { alive: boolean };
    if (!w.alive) { ws.terminate(); continue; }
    w.alive = false;
    ws.ping();
  }
}, 15_000);
setInterval(() => sessions.purge(), 3600_000);

server.listen(config.port, config.host, () => {
  console.log(`Virtuta em http://localhost:${config.port} · login Google ${googleEnabled ? 'ativo' : 'desligado'}${config.devLogin ? ' · login de desenvolvimento ativo' : ''}`);
});

const shutdown = () => {
  office.flush();
  server.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
