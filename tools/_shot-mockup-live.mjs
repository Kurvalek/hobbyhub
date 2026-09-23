// Scratch: capture the reference PNGs the studio would send to the image model,
// using the app's own rasterizer rather than a reimplementation of it. Not part of
// the shipped app.
//
//   node tools/_shot-mockup-live.mjs
//
// Writes tools/_live-ref-<slug>.png for each craft, plus the payload JSON the
// endpoint expects. Posting those to a real deployment is a separate step, kept
// separate on purpose: every post spends money.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { chromePath } from './_verify.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
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
      res.end(fs.readFileSync(f, 'utf8').replace(TOKEN_RE, '$1live_ref_token$2'));
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

// The design record as the studio would upload it. Captured rather than rebuilt,
// so the raster below is drawn from exactly what a real buyer would send.
let captured = null;
await page.setRequestInterception(true);
page.on('request', (req) => {
  const u = new URL(req.url());
  if (u.pathname === '/api/designs' && req.method() === 'POST') {
    try { captured = JSON.parse(req.postData() || '{}'); } catch {}
    return req.respond({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ id: '00000000-0000-4000-8000-00000000cafe' }),
    });
  }
  // Nothing here should reach the paid endpoint: the browser's job is only to
  // draw. Reporting it unconfigured keeps the tile from even offering to.
  if (u.pathname === '/api/mockup') {
    return req.respond({ status: 200, contentType: 'application/json', body: '{"configured":false}' });
  }
  if (u.hostname.endsWith('myshopify.com') || u.hostname === 'shop.makemetime.com') {
    return req.respond({ status: 200, contentType: 'application/json', body: '{"data":{}}' });
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
  await new Promise(r => setTimeout(r, 700));
}

const CASES = [
  { craft: 'Cross-stitch', size: 'Medium Hoop', steps: ['template', 'skip'], slug: 'cross-stitch' },
  { craft: 'Punch Needle', size: 'Pillow', steps: ['template', 'skip'], slug: 'punch-needle' },
  { craft: 'Quilt', size: 'Throw Blanket', steps: ['skip', 'skip', 'template'], slug: 'quilt' },
];

const out = [];
for (const { craft, size, steps, slug } of CASES) {
  captured = null;
  await walkToEditor(craft, size, steps);
  // Buy kit is what uploads the design, which is how we get the record.
  await page.evaluate(() => {
    const bar = document.querySelector('.header-right') || document.querySelector('.xs-topbar');
    [...bar.querySelectorAll('button.btn')].find(b => /^Buy kit/.test(b.textContent))?.click();
  });
  await page.waitForSelector('.kit-layer .kit-band', { timeout: 15000 }).catch(() => null);
  await new Promise(r => setTimeout(r, 600));
  if (!captured) { console.log(`${slug}: no design captured, skipping`); continue; }

  const { dataUrl, preset } = await page.evaluate((rec) => ({
    dataUrl: designToPng(rec.type, rec.data),
    preset: kitPresetName(rec.type, rec.data),
  }), captured);
  if (!dataUrl) { console.log(`${slug}: rasterizer returned nothing, skipping`); continue; }

  const png = Buffer.from(dataUrl.split(',')[1], 'base64');
  fs.writeFileSync(path.join(ROOT, `tools/_live-ref-${slug}.png`), png);
  fs.writeFileSync(
    path.join(ROOT, `tools/_live-payload-${slug}.json`),
    JSON.stringify({ type: captured.type, presetName: preset, image: dataUrl })
  );
  console.log(`${slug}: ${preset} — ref PNG ${(png.length / 1024).toFixed(0)}KB, payload ${(dataUrl.length / 1024).toFixed(0)}KB`);
  out.push(slug);
}

await browser.close();
server.close();
console.log(`\nwrote ${out.length}: ${out.join(', ')}`);
