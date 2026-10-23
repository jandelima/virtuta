import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import WebSocket from 'ws';

const folder = mkdtempSync(join(tmpdir(), 'virtuta-security-'));
const script = resolve('dist/server.js');
const env = { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1',
  PUBLIC_URL: 'https://virtuta.site', DEV_LOGIN: '0', DATA_DIR: folder,
  STATIC_DIR: resolve('dist/public'), LIVEKIT_API_KEY: 'test-key',
  LIVEKIT_API_SECRET: 'test-secret-with-more-than-32-characters',
  GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', ALLOWED_DOMAIN: 'lsd.ufcg.edu.br',
  ADMIN_EMAILS: 'jan.filho@lsd.ufcg.edu.br' };
let child, db, base, port;
let output = '';
before(async () => {
  const listener = createServer();
  await new Promise((r) => listener.listen(0, '127.0.0.1', r));
  port = listener.address().port;
  await new Promise((r) => listener.close(r));
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [script], { cwd: folder, env: { ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  let healthy = false;
  for (let i = 0; i < 100; i++) {
    try { healthy = (await fetch(base + '/api/health')).ok; } catch { /* iniciando */ }
    if (healthy || child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 30));
  }
  assert.ok(healthy, output);
  db = new Database(join(folder, 'virtuta.db'));
  db.prepare('INSERT INTO users (id,email,name,role,created_at) VALUES (?,?,?,?,?)')
    .run('test-user', 'member@lsd.ufcg.edu.br', 'Test', 'member', Date.now());
  db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run('test-session', 'test-user', 0, Date.now() + 60_000);
});
after(async () => {
  db?.close();
  if (child && child.exitCode === null) {
    const stopped = new Promise((r) => child.once('exit', r));
    child.kill('SIGTERM');
    await stopped;
  }
  rmSync(folder, { recursive: true, force: true });
});

test('produção recusa login de desenvolvimento e segredo fraco', () => {
  for (const change of [{ DEV_LOGIN: '1' }, { LIVEKIT_API_SECRET: 'secret' }, { PUBLIC_URL: 'http://virtuta.site' }]) {
    const result = spawnSync(process.execPath, [script], { cwd: folder, env: { ...env, ...change }, encoding: 'utf8', timeout: 5000 });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Error:/);
  }
});
test('administrador explícito impede promoção automática do primeiro integrante', () => {
  const auth = pathToFileURL(resolve('server/src/auth.ts')).href;
  const loader = pathToFileURL(resolve('node_modules/tsx/dist/loader.mjs')).href;
  const result = spawnSync(process.execPath, ['--import', loader, '--input-type=module', '-e',
    `const { loginUser } = await import(${JSON.stringify(auth)});
     console.log(JSON.stringify([
       loginUser('member@lsd.ufcg.edu.br', 'First').user.role,
       loginUser('jan.filho@lsd.ufcg.edu.br', 'Admin').user.role
     ]));`], { cwd: folder, env: { ...env, DATA_DIR: join(folder, 'admin-check') }, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), ['member', 'admin']);
});
test('sessão válida continua funcionando e administração exige permissão', async () => {
  const headers = { cookie: 'vt_sess=test-session' };
  const me = await fetch(base + '/api/me', { headers });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).user.role, 'member');
  assert.equal((await fetch(base + '/api/admin', { headers })).status, 403);
  assert.equal((await fetch(base + '/api/media-token')).status, 401);
});
test('mutações autenticadas de outra origem são recusadas sem apagar sessão', async () => {
  for (const origin of ['https://evil.example', undefined]) {
    const headers = { cookie: 'vt_sess=test-session' };
    if (origin) headers.origin = origin;
    assert.equal((await fetch(base + '/api/auth/logout', { method: 'POST', headers })).status, 403);
  }
  assert.equal((await fetch(base + '/api/me', { headers: { cookie: 'vt_sess=test-session' } })).status, 200);
  assert.equal((await fetch(base + '/api/auth/dev', {
    method: 'POST', headers: { origin: env.PUBLIC_URL, 'content-type': 'application/json' }, body: '{"name":"Intruder"}',
  })).status, 404);
});
test('convites legítimos geram cookies Secure, HttpOnly e SameSite', async () => {
  db.prepare('INSERT INTO invites VALUES (?,?,?,?,?,0)')
    .run('test-invite', 'Guest', 'test-user', Date.now(), Date.now() + 60_000);
  const response = await fetch(base + '/api/invite/join', { method: 'POST',
    headers: { origin: env.PUBLIC_URL, 'content-type': 'application/json' },
    body: JSON.stringify({ token: 'test-invite', name: 'Guest' }) });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie');
  for (const flag of ['HttpOnly', 'SameSite=Lax', 'Secure']) assert.ok(cookie.includes(flag));
});

function wsAttempt(origin, cookie) {
  return new Promise((resolveResult, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      origin, headers: { cookie }, handshakeTimeout: 3000,
    });
    ws.once('open', () => { ws.close(); resolveResult(101); });
    ws.once('unexpected-response', (_req, res) => { res.resume(); ws.terminate(); resolveResult(res.statusCode); });
    ws.on('error', (e) => { if (!/closed before/.test(e.message)) reject(e); });
  });
}
test('WebSocket valida origem antes da sessão e mantém clientes legítimos', async () => {
  assert.equal(await wsAttempt('https://evil.example', 'vt_sess=test-session'), 403);
  assert.equal(await wsAttempt(env.PUBLIC_URL, 'vt_sess=test-session'), 101);
});
test('cookies malformados não derrubam HTTP nem upgrade WebSocket', async () => {
  assert.equal((await fetch(base + '/api/me', { headers: { cookie: 'vt_sess=%E0%A4%A' } })).status, 401);
  assert.equal(await wsAttempt(env.PUBLIC_URL, 'vt_sess=%E0%A4%A'), 401);
  assert.equal((await fetch(base + '/api/health')).status, 200);
  assert.equal(child.exitCode, null);
});
