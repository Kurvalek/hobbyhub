// Scratch: report the corner radius every visible button actually resolves to, in
// the setup flow and in the studio. Written because a button's radius has three
// possible sources — the :root token, a .brand-shell override, and the tweak
// layer's inline custom property — so reading the stylesheet tells you what was
// declared, not what won. Not part of the shipped app.
//
//   node tools/_probe-radius.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { chromePath } from './_verify.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.woff2': 'font/woff2', '.woff': 'font/woff',
};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404); res.end('nope'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
const port = await new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));

const browser = await puppeteer.launch({
  executablePath: chromePath(), headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  defaultViewport: { width: 1440, height: 950 },
});
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load', timeout: 40000 });
await page.waitForFunction(() => document.querySelector('#root')?.children.length > 0, { timeout: 15000 });

// Every visible button on the current screen, grouped by resolved radius, so an
// odd one out is obvious without knowing in advance which rule to suspect.
const survey = (label) => page.evaluate((label) => {
  const groups = {};
  for (const el of document.querySelectorAll('button, [role="button"], .btn, .pill')) {
    const box = el.getBoundingClientRect();
    if (!box.width || !box.height) continue;
    const r = getComputedStyle(el).borderTopLeftRadius;
    const name = '.' + (String(el.className).trim().split(/\s+/)[0] || el.tagName.toLowerCase());
    (groups[r] = groups[r] || []).push(name);
  }
  const token = getComputedStyle(document.documentElement).getPropertyValue('--btn-radius').trim();
  return {
    label,
    token,
    radii: Object.fromEntries(
      Object.entries(groups).map(([r, names]) => [r, [...new Set(names)].sort()])),
  };
}, label);

const report = (s) => {
  console.log(`\n── ${s.label} ──   --btn-radius = ${s.token}`);
  for (const [r, names] of Object.entries(s.radii)) console.log(`  ${r.padStart(5)}  ${names.join(' ')}`);
};

report(await survey('craft picker'));

await page.evaluate(() => {
  [...document.querySelectorAll('.land-craft')].find(e => e.textContent.includes('Quilt'))?.click();
});
await page.waitForSelector('.size-card-name', { timeout: 10000 });
report(await survey('size step'));

await page.evaluate(() => {
  [...document.querySelectorAll('.size-card')]
    .find(e => e.querySelector('.size-card-name')?.textContent.trim() === 'Throw Blanket')?.click();
});
for (const step of ['skip', 'skip', 'template']) {
  const sel = step === 'template' ? '.tmpl-card' : '.back-skip';
  await page.waitForSelector(sel, { timeout: 10000 });
  if (step === 'skip') report(await survey('backing / palette step'));
  await page.evaluate((s) => {
    (s === '.tmpl-card'
      ? document.querySelector('.tmpl-card')
      : [...document.querySelectorAll('.back-skip')].find(e => /Skip/i.test(e.textContent)))?.click();
  }, sel);
  await new Promise(r => setTimeout(r, 300));
}
await page.waitForSelector('.header-right', { timeout: 10000 });
await new Promise(r => setTimeout(r, 800));
report(await survey('quilt studio'));

await browser.close();
server.close();
