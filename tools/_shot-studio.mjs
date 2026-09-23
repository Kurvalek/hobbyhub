// Scratch: shoot the three studio editors, desktop and mobile, for eyeballing
// chrome changes. Not part of the shipped app.
//
//   node tools/_shot-studio.mjs [suffix]
//
// Writes tools/_shot-studio-<craft><suffix>.png. Pass a suffix like "-before" to
// keep a set around to compare against.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { chromePath } from './_verify.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const SUFFIX = process.argv[2] || '';
const TOKEN_RE = /(const SHOPIFY_STOREFRONT_TOKEN = ")[^"]*(")/;
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.woff2': 'font/woff2', '.woff': 'font/woff',
};

function serve() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(404); res.end('nope'); return;
    }
    if (path.basename(f) === 'index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(fs.readFileSync(f, 'utf8').replace(TOKEN_RE, '$1shot_token$2'));
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port })));
}

const { server, port } = await serve();
const browser = await puppeteer.launch({
  executablePath: chromePath(), headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  defaultViewport: { width: 1440, height: 950 },
});
const page = await browser.newPage();

// Prices would otherwise sit in a loading state in every shot.
await page.setRequestInterception(true);
page.on('request', (req) => {
  const u = new URL(req.url());
  if (u.hostname.endsWith('myshopify.com') || u.hostname === 'shop.makemetime.com') {
    return req.respond({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ data: {} }),
    });
  }
  req.continue();
});

async function walkToEditor(craft, size, steps) {
  await page.goto(`http://127.0.0.1:${port}/index.html?r=${Math.random()}`, { waitUntil: 'load', timeout: 40000 });
  await page.waitForFunction(() => document.querySelector('#root')?.children.length > 0, { timeout: 15000 });
  await page.evaluate((name) => {
    [...document.querySelectorAll('.land-craft')].find(e => e.textContent.includes(name))?.click();
  }, craft);
  await page.waitForSelector('.size-card-name', { timeout: 10000 });
  await page.evaluate((name) => {
    [...document.querySelectorAll('.size-card')]
      .find(e => e.querySelector('.size-card-name')?.textContent.trim() === name)?.click();
  }, size);
  for (const step of steps) {
    const sel = step === 'template' ? '.tmpl-card' : '.back-skip';
    await page.waitForSelector(sel, { timeout: 10000 });
    await page.evaluate((s) => {
      (s === '.tmpl-card'
        ? document.querySelector('.tmpl-card')
        : [...document.querySelectorAll('.back-skip')].find(e => /Skip/i.test(e.textContent)))?.click();
    }, sel);
    await new Promise(r => setTimeout(r, 300));
  }
  await page.waitForSelector('.header-right, .xs-topbar', { timeout: 10000 });
  await new Promise(r => setTimeout(r, 900));
}

const CASES = [
  { craft: 'Quilt', size: 'Throw Blanket', steps: ['skip', 'skip', 'template'], slug: 'quilt' },
  { craft: 'Cross-stitch', size: 'Medium Hoop', steps: ['template', 'skip'], slug: 'cross-stitch' },
  { craft: 'Punch Needle', size: 'Pillow', steps: ['template', 'skip'], slug: 'punch-needle' },
];

for (const { craft, size, steps, slug } of CASES) {
  for (const [w, h, tag] of [[1440, 950, ''], [390, 844, '-mobile']]) {
    await page.setViewport({ width: w, height: h });
    await walkToEditor(craft, size, steps);
    const out = `tools/_shot-studio-${slug}${tag}${SUFFIX}.png`;
    await page.screenshot({ path: out });
    console.log(out);
  }
}

await browser.close();
server.close();
