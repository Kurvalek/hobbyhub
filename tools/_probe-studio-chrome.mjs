// Scratch: report the computed chrome styling of the quilt studio, so a restyle can
// be checked against what the browser actually resolves rather than screenshot
// pixels. Not part of the shipped app.
//
//   node tools/_probe-studio-chrome.mjs
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
await page.evaluate(() => {
  [...document.querySelectorAll('.land-craft')].find(e => e.textContent.includes('Quilt'))?.click();
});
await page.waitForSelector('.size-card-name', { timeout: 10000 });
await page.evaluate(() => {
  [...document.querySelectorAll('.size-card')]
    .find(e => e.querySelector('.size-card-name')?.textContent.trim() === 'Throw Blanket')?.click();
});
for (const step of ['skip', 'skip', 'template']) {
  const sel = step === 'template' ? '.tmpl-card' : '.back-skip';
  await page.waitForSelector(sel, { timeout: 10000 });
  await page.evaluate((s) => {
    (s === '.tmpl-card'
      ? document.querySelector('.tmpl-card')
      : [...document.querySelectorAll('.back-skip')].find(e => /Skip/i.test(e.textContent)))?.click();
  }, sel);
  await new Promise(r => setTimeout(r, 300));
}
await page.waitForSelector('.header-right', { timeout: 10000 });
await new Promise(r => setTimeout(r, 800));

const out = await page.evaluate(() => {
  const rootStyle = getComputedStyle(document.documentElement);
  const tok = (n) => rootStyle.getPropertyValue(n).trim();
  const of = (sel, props) => {
    const el = document.querySelector(sel);
    if (!el) return `${sel}: MISSING`;
    const cs = getComputedStyle(el);
    return `${sel}: ` + props.map(p => `${p}=${cs[p]}`).join('  ');
  };
  return {
    tokens: {
      appBg: tok('--app-bg'),
      canvasBg: tok('--canvas-bg'),
      divBorder: tok('--div-border'),
      surfaceCard: tok('--surface-card'),
      fontSans: tok('--font-sans'),
      fontDisplay: tok('--font-display'),
      warmFg: tok('--warm-fg'),
      warmMuted: tok('--warm-muted'),
      brandPaper: tok('--brand-paper'),
      brandCream: tok('--brand-cream'),
    },
    elements: [
      of('body', ['backgroundColor', 'fontFamily', 'color']),
      of('.app', ['backgroundColor']),
      of('.tool-rail', ['backgroundColor', 'borderRightColor']),
      of('.header', ['backgroundColor']),
      of('.panel', ['backgroundColor', 'borderRightColor']),
      of('.header-right .btn', ['backgroundColor', 'borderRadius', 'fontFamily', 'fontSize', 'borderColor', 'color']),
      of('.header-right .btn-dark', ['backgroundColor', 'color', 'borderRadius']),
      of('.icon-btn', ['borderRadius']),
      of('canvas', ['backgroundColor']),
    ],
  };
});
console.log(JSON.stringify(out.tokens, null, 1));
out.elements.forEach(l => console.log(l));

await browser.close();
server.close();
