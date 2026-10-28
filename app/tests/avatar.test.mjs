import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import Database from 'better-sqlite3';
import puppeteer from 'puppeteer-core';

test('avatar confirma gravação e mantém a roupa visível após refresh e reconexão', { timeout: 120_000 }, async () => {
  const executablePath = process.env.CHROME_BIN ?? ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
  assert.ok(executablePath, 'Defina CHROME_BIN com o caminho do Chrome/Chromium');
  const folder = mkdtempSync(join(tmpdir(), 'virtuta-avatar-'));
  const listener = createServer();
  await new Promise((r) => listener.listen(0, '127.0.0.1', r));
  const port = listener.address().port;
  await new Promise((r) => listener.close(r));
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [resolve('dist/server.js')], { cwd: folder,
    env: { ...process.env, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port),
      PUBLIC_URL: base, DEV_LOGIN: '1', DATA_DIR: folder, STATIC_DIR: resolve('dist/public'),
      GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' }, stdio: 'ignore' });
  let browser, db, releaseSave;
  try {
    let healthy = false;
    for (let i = 0; i < 100; i++) {
      try { healthy = (await fetch(base + '/api/health')).ok; } catch { /* iniciando */ }
      if (healthy) break;
      await new Promise((r) => setTimeout(r, 30));
    }
    assert.ok(healthy);
    browser = await puppeteer.launch({ executablePath, headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage();
    page.setDefaultTimeout(30_000);
    await page.setViewport({ width: 1280, height: 900 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#devName');
    await page.type('#devName', 'Teste Avatar');
    await page.click('#dev button');
    await page.waitForSelector('.ae [data-save]');
    await page.click('.ae [data-tab="cabelo"]');
    await page.click('.ae [data-set*=\'"male-f"\']');

    // Uma falha não pode fechar o editor nem descartar as escolhas.
    let fail = true;
    const gate = new Promise((r) => { releaseSave = r; });
    await page.setRequestInterception(true);
    page.on('request', async (request) => {
      if (!request.url().endsWith('/api/me/look')) return request.continue();
      if (fail) return request.abort('internetdisconnected');
      await gate;
      if (!request.isInterceptResolutionHandled()) await request.continue();
    });
    await page.click('.ae [data-save]');
    await page.waitForSelector('.ae-error:not([hidden])');
    assert.equal(await page.$eval('.ae [data-save]', (el) => el.disabled), false);
    db = new Database(join(folder, 'virtuta.db'));
    assert.equal(db.prepare('SELECT look FROM users').get().look, null);

    // Confirmação HTTP funciona mesmo quando o WebSocket foi interrompido.
    await page.evaluate(() => window.__app.net.leave());
    fail = false;
    await page.click('.ae [data-save]');
    assert.equal(await page.$eval('.ae [data-save]', (el) => el.disabled), true);
    assert.match(await page.$eval('.ae [data-save]', (el) => el.textContent), /Salvando/);
    assert.equal(db.prepare('SELECT look FROM users').get().look, null);
    releaseSave();
    await page.waitForSelector('.ae', { hidden: true });
    const before = await page.evaluate(() => window.__app.users.get(window.__app.me).look);
    assert.equal(before.hairStyle, 'male-f');
    assert.deepEqual(JSON.parse(db.prepare('SELECT look FROM users').get().look), before);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__app?.me && window.__app.myAvatar);
    const after = await page.evaluate(() => ({ look: window.__app.users.get(window.__app.me).look,
      avatar: window.__app.myAvatar.person.look, editor: !!document.querySelector('.ae') }));
    assert.deepEqual(after.look, before);
    assert.deepEqual(after.avatar, before);
    assert.equal(after.editor, false);

    // Ao reconectar, conferir a malha desenhada, não apenas os dados do avatar.
    const geometry = () => page.evaluate(() => {
      const body = window.__app.myAvatar.model.getObjectByName('body-mesh');
      let hash = 2166136261;
      for (const attr of ['position', 'color']) {
        for (const value of body.geometry.attributes[attr].array) hash = Math.imul(hash ^ Math.round(value * 1e6), 16777619);
      }
      return hash >>> 0;
    });
    const previousGeometry = await geometry();
    await page.evaluate(() => {
      const net = window.__app.net;
      net.stopped = true;
      net.ws.close();
    });
    await page.waitForFunction(() => window.__app.netState === 'closed');
    const savedLook = { ...before, outfit: 'female-e', top: '#111216', bottom: '#111216', detail: '#ec7a3c' };
    const token = db.prepare('SELECT token FROM sessions WHERE guest = 0').get().token;
    const response = await fetch(base + '/api/me/look', { method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `vt_sess=${token}`, origin: base },
      body: JSON.stringify({ look: savedLook }) });
    assert.equal(response.status, 200);
    await page.evaluate(() => window.__app.net.connect());
    await page.waitForFunction(() => window.__app.netState === 'online' && window.__app.users.get(window.__app.me)?.look?.outfit === 'female-e');
    const reconnectedGeometry = await geometry();
    assert.notEqual(reconnectedGeometry, previousGeometry, 'Reconexão deve remontar a roupa visível quando o visual salvo mudou');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__app?.me && window.__app.myAvatar);
    assert.equal(await geometry(), reconnectedGeometry, 'Roupa após reconexão e após refresh deve ser idêntica');
    assert.deepEqual(errors, []);
  } finally {
    releaseSave?.();
    await browser?.close();
    db?.close();
    if (child.exitCode === null) {
      const exited = new Promise((r) => child.once('exit', r));
      child.kill('SIGTERM');
      await exited;
    }
    rmSync(folder, { recursive: true, force: true });
  }
});
