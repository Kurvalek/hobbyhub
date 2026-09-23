// Scratch harness: serve the studio and drive it in headless Chrome.
// Not part of the shipped app — delete when the punch needle work lands.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(import.meta.dirname, '..');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.woff2': 'font/woff2', '.woff': 'font/woff',
};

export function serve() {
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
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port })));
}

export function chromePath() {
  const guesses = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ];
  for (const g of guesses) if (fs.existsSync(g)) return g;
  throw new Error('No Chrome found');
}

export async function open({ width = 1440, height = 950 } = {}) {
  const { server, port } = await serve();
  const browser = await puppeteer.launch({
    executablePath: chromePath(), headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    defaultViewport: { width, height },
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  // networkidle0 occasionally never settles — the page pulls a lot of fabric
  // thumbnails and the tiny static server sometimes resets a connection. The
  // #root gate below is the real readiness check, so fall back to `load`.
  const url = `http://127.0.0.1:${port}/index.html`;
  try {
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 20000 });
  } catch {
    await page.goto(url, { waitUntil: 'load', timeout: 40000 });
  }
  await page.waitForFunction(() => document.querySelector('#root') && document.querySelector('#root').children.length > 0, { timeout: 15000 });
  return {
    page, errors,
    // Back to the craft picker, as a first-time visitor sees it. A reload won't
    // do: the app resumes the step recorded on the current history entry, so
    // refreshing mid-flow lands back in the studio. A URL the tab has never seen
    // gets an entry with no snapshot on it, which is what "start over" means.
    restart: () => visit(page, port),
    close: async () => { await browser.close(); server.close(); },
  };
}

let visitSeq = 0;
async function visit(page, port) {
  await page.goto(`http://127.0.0.1:${port}/index.html?visit=${++visitSeq}`, { waitUntil: 'load', timeout: 40000 });
  await page.waitForFunction(() => document.querySelector('#root') && document.querySelector('#root').children.length > 0, { timeout: 15000 });
  await page.waitForSelector('.land-craft', { timeout: 15000 });
  await new Promise(r => setTimeout(r, 250));
}

// Click the first element whose trimmed text matches `text`.
export async function clickText(page, sel, text) {
  const ok = await page.evaluate((sel, text) => {
    const el = [...document.querySelectorAll(sel)].find(e => e.textContent.trim() === text
      || e.textContent.trim().startsWith(text));
    if (!el) return false;
    el.click(); return true;
  }, sel, text);
  if (!ok) throw new Error(`clickText: no ${sel} matching "${text}"`);
  await new Promise(r => setTimeout(r, 350));
}

export async function texts(page, sel) {
  return page.$$eval(sel, els => els.map(e => e.textContent.trim()));
}
