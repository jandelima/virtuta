// Captura de tela do protótipo para inspeção visual.
// Uso: node scripts/shot.mjs <url> <saida.png> [largura] [altura] [esperaMs] [acoes.json]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const [url, out, w = '1440', h = '900', wait = '2500', actionsFile] = process.argv.slice(2);
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: +w, height: +h, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
await new Promise((r) => setTimeout(r, +wait));
if (actionsFile) {
  const actions = JSON.parse(fs.readFileSync(actionsFile, 'utf8'));
  for (const a of actions) {
    if (a.eval) await page.evaluate(a.eval);
    if (a.key) await page.keyboard.down(a.key);
    if (a.hold) await new Promise((r) => setTimeout(r, a.hold));
    if (a.key) await page.keyboard.up(a.key);
    if (a.click) await page.mouse.click(a.click[0], a.click[1]);
    if (a.wait) await new Promise((r) => setTimeout(r, a.wait));
    if (a.shot) await page.screenshot({ path: a.shot });
  }
}
await page.screenshot({ path: out });
console.log(logs.filter((l) => !l.includes('GPU stall')).slice(0, 30).join('\n'));
await browser.close();
