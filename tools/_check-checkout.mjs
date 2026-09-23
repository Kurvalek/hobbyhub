// Scratch check: the size → Shopify product mapping and the kit prices on the
// size cards. Not part of the shipped app.
//
//   node tools/_check-checkout.mjs [products_export.csv] [--live]
//
// By default this answers the Storefront call itself, so the run is
// deterministic, works offline, and doesn't lean on the live catalog. That still
// exercises the app's own code path — alias batching, price formatting, card
// rendering. Pass --live to additionally query the real store and confirm the
// committed token and catalog still line up with SHOPIFY_KITS.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { chromePath } from './_verify.mjs';
// The real BOM function, so "what the review page lists" is checked against the
// same arithmetic the packer's pick-list comes from rather than a copy of it.
import { designToBom } from '../api/_lib/bom.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const LIVE = process.argv.includes('--live');
// Swapped in for the committed token so the stub path is deterministic even
// after the real token is rotated.
const TOKEN_RE = /(const SHOPIFY_STOREFRONT_TOKEN = ")[^"]*(")/;
const FAKE_TOKEN = 'check_storefront_token';

// Prices the stubbed Storefront API reports, by product handle. These mirror
// products_export.csv so a price showing up on the wrong card is visible.
const STUB_PRICES = {
  'quilted-coaster-set': 38,
  'quilted-wall-hanging': 69,
  'baby-quilt': 89,
  'throw-quilt': 149,
  'cross-stitch-coaster-set': 38,
  'cross-stitch-bookmark': 26,
  'cross-stitch-wall-art-small': 34,
  'cross-stitch-wall-art-medium': 52,
  'punch-needle-coaster-set': 46,
  'punch-needle-wall-art': 56,
  'punch-needle-pillow': 89,
};

// What each craft's size cards should end up showing. null = no price line,
// because that size has no product.
const EXPECTED = {
  'Cross-stitch': { 'Coaster Set': '$38', 'Bookmark': '$26', 'Small Hoop': '$34', 'Medium Hoop': '$52' },
  'Quilt': { 'Coasters': '$38', 'Wall Hanging': '$69', 'Baby Blanket': '$89', 'Throw Blanket': '$149' },
  'Punch Needle': { 'Coaster': '$46', 'Small Hoop': null, 'Wall Hanging': '$56', 'Pillow': '$89' },
};

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.woff2': 'font/woff2', '.woff': 'font/woff',
};

// Same static server as _verify.mjs, except index.html gets the stand-in token
// so shopifyStoreConfigured() is true and the price lookups actually fire.
function servePatched() {
  const server = http.createServer((req, res) => {
    const [rawPath, query = ''] = req.url.split('?');
    let p = decodeURIComponent(rawPath);
    if (p === '/') p = '/index.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(404); res.end('nope'); return;
    }
    if (path.basename(f) === 'index.html') {
      const html = fs.readFileSync(f, 'utf8');
      if (!TOKEN_RE.test(html)) {
        console.log('note: could not find the token constant to substitute');
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html.replace(TOKEN_RE, `$1${FAKE_TOKEN}$2`));
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port })));
}

const failures = [];
function check(ok, label, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
}

const { server, port } = await servePatched();
const browser = await puppeteer.launch({
  executablePath: chromePath(), headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  defaultViewport: { width: 1440, height: 950 },
});
const page = await browser.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));

// Every Storefront call the page makes, so we can assert it batches.
const storefrontCalls = [];
// cartCreate inputs, and the bodies POSTed to /api/designs — the two sides of a
// purchase, recorded so we can prove a guest reaches checkout without saving.
const cartCalls = [];
const designSaves = [];
// Every /api/bom request and the BOM it answered with.
const bomCalls = [];
// Every /api/mockup POST, including the reference PNG the studio drew.
const mockupCalls = [];
// Flipped to false for the last section, to prove the preview disappears rather
// than offering a button that can't work when no image key is set.
let mockupConfigured = true;
// Set to an HTTP status to make the image service fail, for the failure path.
let mockupFails = 0;
// Stands in for the generated photo. Legible in the screenshots and obviously not
// the design's own preview, which is the whole job of a stub here.
const STUB_MOCKUP = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320">' +
  '<rect width="320" height="320" fill="#D65C44"/>' +
  '<text x="160" y="168" text-anchor="middle" font-family="sans-serif" font-size="22" fill="#FFF">' +
  'generated preview</text></svg>'
);
// Uploaded designs by id, so GET /api/designs/:id can hand one back the way the
// real store does — that read is how the review page survives being rebuilt.
const designStore = new Map();
const SHOPIFY_HOST = 'shop.makemetime.com';
const STUB_CHECKOUT_URL = `https://${SHOPIFY_HOST}/cart/c/check-cart-token`;
const STUB_DESIGN_ID = '00000000-0000-4000-8000-00000000cafe';

await page.setRequestInterception(true);
page.on('request', (req) => {
  const url = req.url();

  // Stand in for the Vercel function, which isn't running here. Returning an id
  // for an unauthenticated POST is what the real endpoint does — guest saves are
  // stored with user_id null, which is what makes buying without an account work.
  if (new URL(url).pathname === '/api/designs' && req.method() === 'POST') {
    let body = {};
    try { body = JSON.parse(req.postData() || '{}'); } catch {}
    designSaves.push({ type: body.type, data: body.data, auth: !!req.headers().authorization });
    designStore.set(STUB_DESIGN_ID, { type: body.type, data: body.data });
    return req.respond({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ id: STUB_DESIGN_ID }),
    });
  }

  // Reading a design back by id. Anonymous in the real API too — the uuid is the
  // capability, which is what lets a guest return to their own kit.
  const readMatch = new URL(url).pathname.match(/^\/api\/designs\/(.+)$/);
  if (readMatch && req.method() === 'GET') {
    const rec = designStore.get(decodeURIComponent(readMatch[1]));
    if (!rec) return req.respond({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' });
    return req.respond({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ id: readMatch[1], type: rec.type, name: rec.data.name || 'Untitled', data: rec.data }),
    });
  }

  // The finished-product preview. The image model is never called — this stands in
  // for it — but the reference PNG the studio drew is kept so we can prove the page
  // sends a real picture of the design rather than an empty square.
  if (new URL(url).pathname === '/api/mockup') {
    if (req.method() === 'GET') {
      return req.respond({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ configured: mockupConfigured }),
      });
    }
    let body = {};
    try { body = JSON.parse(req.postData() || '{}'); } catch {}
    mockupCalls.push({ type: body.type, presetName: body.presetName, image: body.image });
    if (!mockupConfigured) return req.respond({ status: 501, contentType: 'application/json', body: '{"error":"mockups_not_configured"}' });
    if (mockupFails) return req.respond({
      status: mockupFails, contentType: 'application/json',
      body: JSON.stringify({ error: mockupFails === 422 ? 'blocked_by_moderation' : 'mockup_failed' }),
    });
    return req.respond({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ image: STUB_MOCKUP }),
    });
  }

  // The supply list. Deliberately the real designToBom rather than canned rows,
  // so a change to the skein constants shows up as a change on the page.
  if (new URL(url).pathname === '/api/bom' && req.method() === 'POST') {
    let body = {};
    try { body = JSON.parse(req.postData() || '{}'); } catch {}
    const bom = designToBom({ type: body.type, data: body.data });
    bomCalls.push({ type: body.type, bom });
    if (!bom) return req.respond({ status: 422, contentType: 'application/json', body: '{"error":"unsupported_for_type"}' });
    return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ bom }) });
  }

  // Where a real purchase lands. Answered locally so the run never touches the
  // live store, while page.url() still shows the URL the app redirected to.
  if (url === STUB_CHECKOUT_URL) {
    return req.respond({ status: 200, contentType: 'text/html', body: '<title>checkout</title>' });
  }

  if (!url.includes('/api/') || !url.includes('graphql.json')) {
    // Once redirected, the stub checkout page is same-origin with the real shop,
    // so its incidentals (favicon) would otherwise go out over the wire.
    if (new URL(url).host === SHOPIFY_HOST) return req.respond({ status: 204 });
    return req.continue();
  }
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, x-shopify-storefront-access-token',
  };
  // The custom auth header makes this a preflighted cross-origin request.
  if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: cors });

  let body = {};
  try { body = JSON.parse(req.postData() || '{}'); } catch {}
  const variables = body.variables || {};
  const query = body.query || '';

  if (/cartCreate/.test(query)) {
    cartCalls.push(variables.input || {});
    return req.respond({
      status: 200, contentType: 'application/json', headers: cors,
      body: JSON.stringify({ data: { cartCreate: { cart: { checkoutUrl: STUB_CHECKOUT_URL }, userErrors: [] } } }),
    });
  }

  const handles = Object.keys(variables)
    .filter(k => /^h\d+$/.test(k))
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
    .map(k => variables[k]);
  storefrontCalls.push({ handles, query });

  // Mirror the aliases the app asked for: k0..kN, positionally.
  const data = {};
  handles.forEach((handle, i) => {
    const amount = STUB_PRICES[handle];
    data[`k${i}`] = amount == null ? null : {
      variants: {
        nodes: [{
          id: `gid://shopify/ProductVariant/${1000 + i}`,
          availableForSale: true,
          price: { amount: amount.toFixed(2), currencyCode: 'USD' },
        }],
      },
    };
  });
  req.respond({
    status: 200, contentType: 'application/json', headers: cors,
    body: JSON.stringify({ data }),
  });
});

const url = `http://127.0.0.1:${port}/index.html`;
// Navigating to a URL the tab is already on counts as a reload, and the app now
// resumes the step recorded on that history entry. Every load below wants to look
// like a first visit instead, so each gets a URL the tab has never seen.
let visit = 0;
const freshUrl = () => `${url}?visit=${++visit}`;
try {
  await page.goto(freshUrl(), { waitUntil: 'networkidle0', timeout: 20000 });
} catch {
  await page.goto(freshUrl(), { waitUntil: 'load', timeout: 40000 });
}
await page.waitForFunction(
  () => document.querySelector('#root') && document.querySelector('#root').children.length > 0,
  { timeout: 15000 }
);

// ── 1. Mapping integrity ───────────────────────────────────────────────────
// Every preset name in SHOPIFY_KITS has to match a real preset, or checkout
// silently falls back to save-only for a size that is in fact for sale.
console.log('\n── mapping ──');
const mapping = await page.evaluate(() => {
  if (typeof SHOPIFY_KITS === 'undefined') return { unreachable: true };
  return {
    kits: SHOPIFY_KITS,
    presets: {
      'quilt': PRESETS.map(p => p.name),
      'cross-stitch': STITCH_PRESETS.map(p => p.name),
      'punch-needle': PUNCH_PRESETS.map(p => p.name),
    },
    // Exercise the real resolver rather than re-deriving it here.
    resolved: Object.keys(SHOPIFY_KITS).reduce((acc, type) => {
      const key = type === 'quilt' ? 'preset' : 'presetName';
      const names = type === 'quilt'
        ? PRESETS.map(p => p.name)
        : (type === 'cross-stitch' ? STITCH_PRESETS : PUNCH_PRESETS).map(p => p.name);
      acc[type] = names.reduce((m, name) => {
        m[name] = kitHandle(type, { [key]: name });
        return m;
      }, {});
      return acc;
    }, {}),
    custom: kitHandle('quilt', { preset: 'Custom' }),
    missingDesign: kitHandle('quilt', null),
  };
});

if (mapping.unreachable) {
  check(false, 'SHOPIFY_KITS reachable from page scope');
} else {
  for (const [type, byPreset] of Object.entries(mapping.kits)) {
    const real = mapping.presets[type];
    for (const name of Object.keys(byPreset)) {
      check(real.includes(name), `${type}: mapped preset "${name}" exists`,
        real.includes(name) ? '' : `not one of ${real.join(' | ')}`);
    }
  }

  // Handles must exist in the product export, or the Storefront returns null.
  // The export isn't in the repo, so pass its path:
  //   node tools/_check-checkout.mjs ~/Desktop/products_export.csv
  const csvPath = process.argv[2] || path.join(ROOT, 'products_export.csv');
  if (fs.existsSync(csvPath)) {
    const csvHandles = new Set(
      fs.readFileSync(csvPath, 'utf8').split('\n').slice(1)
        .map(l => l.split(',')[0].trim()).filter(Boolean)
    );
    for (const byPreset of Object.values(mapping.kits)) {
      for (const handle of Object.values(byPreset)) {
        check(csvHandles.has(handle), `handle "${handle}" exists in products_export.csv`);
      }
    }
  } else {
    console.log('note: products_export.csv not in repo root — skipped handle cross-check');
  }

  // 12 presets across the three crafts; every one but punch needle's
  // "Small Hoop" is for sale. (The 12th product, cross-stitch-wall-art-large,
  // has no preset, so 11 of 12 products are reachable.)
  const mappedCount = Object.values(mapping.resolved)
    .reduce((n, m) => n + Object.values(m).filter(Boolean).length, 0);
  check(mappedCount === 11, 'exactly 11 presets resolve to a product', `got ${mappedCount}`);
  check(mapping.resolved['punch-needle']['Small Hoop'] === null,
    'punch-needle "Small Hoop" resolves to null (save-only)');
  check(mapping.custom === null, 'a "Custom" size resolves to null');
  check(mapping.missingDesign === null, 'a missing design resolves to null');
}

// ── 2. Prices on the size cards ────────────────────────────────────────────
console.log('\n── size cards ──');
for (const [craft, expected] of Object.entries(EXPECTED)) {
  storefrontCalls.length = 0;
  await page.goto(freshUrl(), { waitUntil: 'load', timeout: 40000 });
  await page.waitForFunction(
    () => document.querySelector('#root') && document.querySelector('#root').children.length > 0,
    { timeout: 15000 }
  );
  await page.evaluate((name) => {
    const el = [...document.querySelectorAll('.land-craft')].find(e => e.textContent.includes(name));
    if (el) el.click();
  }, craft);
  // Wait for the cards, then for the stubbed prices to land on them.
  await page.waitForSelector('.size-card-name', { timeout: 10000 });
  await page.waitForFunction(
    () => document.querySelectorAll('.size-card-price').length > 0,
    { timeout: 10000 }
  ).catch(() => {});

  const slug = craft.toLowerCase().replace(/[^a-z]+/g, '-');
  await page.screenshot({ path: `tools/_shot-checkout-${slug}.png` });

  const cards = await page.$$eval('.size-card', els => els.map(e => ({
    name: (e.querySelector('.size-card-name') || {}).textContent?.trim() || '',
    price: (e.querySelector('.size-card-price') || {}).textContent?.trim() || null,
  })));

  console.log(`\n${craft}:`);
  for (const [name, want] of Object.entries(expected)) {
    const card = cards.find(c => c.name === name);
    if (!card) { check(false, `${craft} / ${name}: card present`); continue; }
    const got = card.price;
    if (want === null) {
      check(got === null, `${craft} / ${name}: no price line`, got ? `showed "${got}"` : '');
    } else {
      check(got === `Kit ${want}`, `${craft} / ${name}: shows ${want}`, got ? `got "${got}"` : 'got nothing');
    }
  }

  // One request per craft, carrying every sellable handle — not one per card.
  const calls = storefrontCalls.length;
  const batched = storefrontCalls[0];
  check(calls === 1, `${craft}: one batched Storefront call`, `made ${calls}`);
  if (batched) {
    const sellable = Object.values(expected).filter(v => v !== null).length;
    check(batched.handles.length === sellable,
      `${craft}: batch asks for all ${sellable} sellable handles`, `asked ${batched.handles.length}`);
    check(/product\(handle:/.test(batched.query), `${craft}: uses product(handle:) not productByHandle`);
  }
}

// ── 3. Buy kit is the primary CTA in both editors ──────────────────────────
// The editors are reached by picking a craft, a size, then working through the
// setup steps. `steps` names each one: 'skip' takes the blank path, 'template'
// picks the first layout so the canvas arrives with a design on it. The crafts
// order their steps differently — quilt is backing, palette, template; the grid
// crafts are template, palette — so the caller spells the sequence out.
async function walkToEditor(craft, size, steps) {
  await page.goto(freshUrl(), { waitUntil: 'load', timeout: 40000 });
  await page.waitForFunction(
    () => document.querySelector('#root') && document.querySelector('#root').children.length > 0,
    { timeout: 15000 }
  );
  await page.evaluate((name) => {
    const el = [...document.querySelectorAll('.land-craft')].find(e => e.textContent.includes(name));
    if (el) el.click();
  }, craft);
  await page.waitForSelector('.size-card-name', { timeout: 10000 });
  await page.evaluate((name) => {
    const el = [...document.querySelectorAll('.size-card')]
      .find(e => (e.querySelector('.size-card-name') || {}).textContent?.trim() === name);
    if (el) el.click();
  }, size);
  for (const step of steps) {
    const sel = step === 'template' ? '.tmpl-card' : '.back-skip';
    await page.waitForSelector(sel, { timeout: 10000 });
    await page.evaluate((s) => {
      const el = s === '.tmpl-card'
        ? document.querySelector('.tmpl-card')
        : [...document.querySelectorAll('.back-skip')].find(e => /Skip/i.test(e.textContent));
      if (el) el.click();
    }, sel);
    await new Promise(r => setTimeout(r, 300));
  }
  await page.waitForSelector('.header-right, .xs-topbar', { timeout: 10000 });
  await new Promise(r => setTimeout(r, 700));
}

// The labelled buttons in the editor's top bar, in DOM order. Icon-only controls
// (back, panel toggle) are .icon-btn and deliberately excluded.
const topbarButtons = () => page.evaluate(() => {
  const bar = document.querySelector('.header-right') || document.querySelector('.xs-topbar');
  if (!bar) return null;
  return [...bar.querySelectorAll('button.btn')].map(b => ({
    text: b.textContent.trim(),
    dark: b.classList.contains('btn-dark'),
    disabled: b.disabled,
    title: b.title,
  }));
});

console.log('\n── editor CTA ──');
// Every craft is walked twice: once down the blank path, where buying is held
// back, and once picking a template, where the CTA is live.
const CTA_CASES = [
  { craft: 'Quilt', size: 'Throw Blanket', price: '$149', blank: ['skip', 'skip', 'skip'], designed: ['skip', 'skip', 'template'] },
  { craft: 'Cross-stitch', size: 'Medium Hoop', price: '$52', blank: ['skip', 'skip'], designed: ['template', 'skip'] },
  { craft: 'Punch Needle', size: 'Pillow', price: '$89', blank: ['skip', 'skip'], designed: ['template', 'skip'] },
];

for (const { craft, size, price, blank } of CTA_CASES) {
  await walkToEditor(craft, size, blank);
  const btns = await topbarButtons();
  console.log(`\n${craft} / ${size}:`, btns);
  if (!btns) { check(false, `${craft}: editor top bar found`); continue; }

  const buy = btns.find(b => /^Buy kit/.test(b.text));
  const dark = btns.filter(b => b.dark);
  const saves = btns.filter(b => /^Save/.test(b.text));

  check(!!buy, `${craft}: a "Buy kit" button is in the editor top bar`);
  check(dark.length === 1 && dark[0] === buy,
    `${craft}: Buy kit is the only primary (btn-dark)`,
    dark.map(b => b.text).join(' | ') || 'none');
  check(saves.length > 0 && saves.every(b => !b.dark),
    `${craft}: Save is still present but demoted`,
    saves.map(b => `${b.text}${b.dark ? ' (dark)' : ''}`).join(' | ') || 'no Save button');
  check(btns[btns.length - 1] === buy, `${craft}: Buy kit is the rightmost control`);
  if (buy) {
    check(buy.text.includes(price), `${craft}: Buy kit carries the price ${price}`, `label "${buy.text}"`);
    // Nothing on the canvas yet: the price is shown but the sale waits, because
    // the kit would ship with no design to make.
    check(buy.disabled, `${craft}: Buy kit waits for an empty canvas`,
      `disabled=${buy.disabled}, title "${buy.title}"`);
    check(/first/i.test(buy.title), `${craft}: the title says what's missing`, `"${buy.title}"`);
  }

  // The uuid is an internal handle — it used to be printed next to the button.
  const kitId = await page.evaluate(() => /Kit ID/i.test(document.body.innerText));
  check(!kitId, `${craft}: no "Kit ID" shown before checkout`);

  const slug = craft.toLowerCase().replace(/[^a-z]+/g, '-');
  await page.screenshot({ path: `tools/_shot-cta-${slug}-blank.png` });
}

// Same three crafts, now with a template applied — the CTA has to come alive.
for (const { craft, size, price, designed } of CTA_CASES) {
  await walkToEditor(craft, size, designed);
  const buy = (await topbarButtons() || []).find(b => /^Buy kit/.test(b.text));
  check(!!buy && !buy.disabled, `${craft}: Buy kit is clickable once a template is applied`,
    buy ? `disabled=${buy.disabled}, title "${buy.title}"` : 'no button');
  check(!!buy && buy.text.includes(price), `${craft}: still priced ${price} in the editor`, buy?.text);
  const slug = craft.toLowerCase().replace(/[^a-z]+/g, '-');
  await page.screenshot({ path: `tools/_shot-cta-${slug}.png` });
}

// A size with no product keeps the button in place but disabled, and says why.
await walkToEditor('Punch Needle', 'Small Hoop', ['skip', 'skip']);
const unsold = (await topbarButtons() || []).find(b => /^Buy kit/.test(b.text));
check(!!unsold && unsold.disabled, 'punch needle Small Hoop: Buy kit is disabled',
  unsold ? `disabled=${unsold.disabled}` : 'no button');
check(!!unsold && /sold as a kit/i.test(unsold.title),
  'punch needle Small Hoop: the title explains the size is unsold', unsold ? `"${unsold.title}"` : '');
check(!!unsold && !/\$/.test(unsold.text), 'punch needle Small Hoop: no price on the label',
  unsold ? `"${unsold.text}"` : '');

// Clicks Buy kit in whichever editor is showing and waits for the review page.
// Deliberately not a navigation: the studio stays mounted underneath.
async function buyKit() {
  await page.evaluate(() => {
    const bar = document.querySelector('.header-right') || document.querySelector('.xs-topbar');
    const btn = [...bar.querySelectorAll('button.btn')].find(b => /^Buy kit/.test(b.textContent));
    if (btn) btn.click();
  });
  await page.waitForSelector('.kit-layer .kit-band', { timeout: 15000 }).catch(() => null);
  await new Promise(r => setTimeout(r, 700));
}

// The review page lives in a fixed layer sized to the window, so the document is
// never taller than the viewport and `fullPage` captures only the first screen.
// Grow the viewport by whatever the worst-overflowing column is hiding, so one
// shot shows the whole page, then put it back. Measured per width because the
// columns reflow: what overflows at 1440 isn't what overflows at 390.
async function shootReview(slug) {
  // First at a real window, which is the only way to see the thing the layout is
  // for: both columns cut off mid-content and the price bar sitting on the floor.
  await page.setViewport({ width: 1440, height: 900 });
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({ path: `tools/_shot-kit-review-${slug}-window.png` });
  for (const [w, tag] of [[1440, ''], [390, '-mobile']]) {
    await page.setViewport({ width: w, height: 950 });
    await new Promise(r => setTimeout(r, 500));
    const hidden = await page.evaluate(() => {
      const layer = document.querySelector('.kit-layer');
      if (!layer) return 0;
      const ports = [layer, ...layer.querySelectorAll('.kit-scroll')];
      return Math.max(0, ...ports.map(p => p.scrollHeight - p.clientHeight));
    });
    await page.setViewport({ width: w, height: Math.min(2600, 950 + hidden) });
    await new Promise(r => setTimeout(r, 500));
    await page.screenshot({ path: `tools/_shot-kit-review-${slug}${tag}.png` });
  }
  await page.setViewport({ width: 1440, height: 950 });
  await new Promise(r => setTimeout(r, 400));
}

// What the review page is currently saying.
const reviewPage = () => page.evaluate(() => {
  const layer = document.querySelector('.kit-layer');
  if (!layer) return null;
  const groups = [...layer.querySelectorAll('.kit-group')].map(g => ({
    title: (g.querySelector('.kit-group-title') || {}).textContent?.trim() || '',
    rows: [...g.querySelectorAll('.kit-row')].map(r => ({
      label: (r.querySelector('.kit-row-label') || {}).textContent?.trim() || '',
      qty: (r.querySelector('.kit-row-qty') || {}).textContent?.trim() || null,
      swatch: !!r.querySelector('.kit-sw'),
    })),
  }));
  return {
    title: (layer.querySelector('.brand-title') || {}).textContent?.trim() || '',
    sub: (layer.querySelector('.brand-head-sub') || {}).textContent?.trim() || '',
    price: (layer.querySelector('.kit-buy-v') || {}).textContent?.trim() || null,
    checkout: (layer.querySelector('.kit-buy-go') || {}).textContent?.trim() || null,
    hasPreview: !!layer.querySelector('.kit-tile-art svg, .kit-tile-art canvas'),
    tiles: layer.querySelectorAll('.kit-tile').length,
    specs: [...layer.querySelectorAll('.brand-spec')].map(s => [
      s.querySelector('.brand-spec-k').textContent.trim(),
      s.querySelector('.brand-spec-v').textContent.trim(),
    ]),
    groups,
    // Whether the studio is still mounted behind it — the whole reason the page
    // is a layer and not a replacement.
    studioBehind: !!document.querySelector('.app, .xs-app'),
  };
});

// ── 4. A guest reviews the kit, then buys, without saving or signing in ────
// The design is uploaded when Buy kit is pressed — Shopify needs something to
// attach, and the review page has to survive a rebuilt document — but the shopper
// is never asked to save or make an account.
console.log('\n── guest purchase ──');
designSaves.length = 0; cartCalls.length = 0; storefrontCalls.length = 0; bomCalls.length = 0;
await walkToEditor('Quilt', 'Baby Blanket', ['skip', 'skip', 'template']);
// The variant the stub minted for this handle, so the assertion below doesn't
// depend on where baby-quilt happened to sit in the batch.
const babyIndex = (storefrontCalls.find(c => c.handles.includes('baby-quilt'))?.handles || []).indexOf('baby-quilt');
const babyVariant = `gid://shopify/ProductVariant/${1000 + babyIndex}`;
const signedOut = await page.evaluate(() => !/Sign out|My account/i.test(document.body.innerText));
check(signedOut, 'starting from a signed-out session');

await buyKit();
const quiltReview = await reviewPage();
check(!!quiltReview, 'Buy kit opens the kit review page');
check(page.url() !== STUB_CHECKOUT_URL, 'Buy kit no longer jumps straight to Shopify', page.url());
check(cartCalls.length === 0, 'no cart is created before the maker has seen the kit', `${cartCalls.length}`);
check(designSaves.length === 1, 'the design is uploaded exactly once', `${designSaves.length} POSTs`);
check(designSaves[0] && !designSaves[0].auth, 'uploaded with no Authorization header (guest)');
check(designSaves[0]?.type === 'quilt', 'uploaded under the right craft type', designSaves[0]?.type);
// The preset value is the SHOPIFY_KITS key ("Baby blanket"), not the card's
// display name ("Baby Blanket") — that mapping is what picks the product.
check(designSaves[0]?.data?.preset === 'Baby blanket', 'uploaded record carries the chosen size',
  designSaves[0]?.data?.preset);

if (quiltReview) {
  console.log(JSON.stringify(quiltReview, null, 1));
  check(quiltReview.studioBehind, 'the studio stays mounted under the review page');
  check(quiltReview.hasPreview, 'the design is previewed on the page');
  // Two: the design itself, and the finished-product preview alongside it.
  check(quiltReview.tiles === 2, 'the design and the finished-product preview sit side by side',
    `${quiltReview.tiles}`);
  check(quiltReview.price === '$89', 'the kit price is stated', String(quiltReview.price));
  check(quiltReview.checkout === 'Checkout', 'Checkout is the call to action', String(quiltReview.checkout));
  const kitGroup = quiltReview.groups.find(g => /In your kit/i.test(g.title));
  const ownGroup = quiltReview.groups.find(g => /You'll need/i.test(g.title));
  check(!!kitGroup, 'there is an "In your kit" list');
  check(!!ownGroup, "there is a \"You'll need\" list");
  const labels = (kitGroup?.rows || []).map(r => r.label);
  check(labels.some(l => /^Kona /.test(l)), 'the quilt fabrics are listed by Kona code', labels.slice(0, 3).join(' | '));
  check(labels.includes('Batting'), 'batting is listed');
  check(labels.some(l => /cutting and assembly guide/i.test(l)), 'the printed guide is listed');
  check((kitGroup?.rows || []).some(r => r.swatch), 'fabric rows carry a colour swatch');
  const yards = (kitGroup?.rows || []).filter(r => /^Kona /.test(r.label)).map(r => r.qty);
  check(yards.length > 0 && yards.every(q => /yd$/.test(q || '')), 'fabrics are quantified in yards', yards.join(' | '));
  check(quiltReview.specs.some(([k]) => /Finished size/i.test(k)), 'the finished size is stated',
    JSON.stringify(quiltReview.specs));
  await shootReview('quilt');
}

// The numbers on the page have to be the packer's numbers, not a second opinion.
check(bomCalls.length >= 1, 'the review page asked the server for the supply list', `${bomCalls.length} calls`);
const quiltBom = bomCalls[bomCalls.length - 1]?.bom;
if (quiltBom) {
  const want = (quiltBom.fabrics || []).map(f => `Kona ${f.code} — ${f.name}`);
  const got = (quiltReview?.groups.find(g => /In your kit/i.test(g.title))?.rows || []).map(r => r.label);
  check(want.length > 0 && want.every(l => got.includes(l)),
    'every fabric designToBom returned is on the page', `${want.length} wanted, page has ${got.length} rows`);
}

// ── 4b. The way forward stays put while the two halves scroll on their own ────
// Someone reading down a long colour list shouldn't have to scroll back up to find
// the button, and scrolling that list shouldn't carry the design it describes off
// the screen. A shortish window so these assertions don't depend on this particular
// kit's list happening to be long enough to overflow — but not past the point where
// the layout deliberately gives up and hands the page back to its own scroller.
console.log('\n── review page scrolling ──');
await page.setViewport({ width: 1440, height: 720 });
await new Promise(r => setTimeout(r, 500));
const scrollModel = await page.evaluate(async () => {
  const layer = document.querySelector('.kit-layer');
  const ports = [...layer.querySelectorAll('.kit-scroll')];
  const [left, right] = [ports[0], ports[ports.length - 1]];
  const go = layer.querySelector('.kit-buy-go');
  const onScreen = () => {
    const r = go.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= window.innerHeight + 1;
  };
  const before = onScreen();
  right.scrollTop = right.scrollHeight;
  await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
  return {
    ports: ports.length,
    layerScrolls: layer.scrollHeight > layer.clientHeight + 1,
    rightOverflows: right.scrollHeight > right.clientHeight + 1,
    rightMoved: right.scrollTop > 0,
    leftStayed: left.scrollTop === 0,
    footOutsideList: !layer.querySelector('.kit-foot').closest('.kit-scroll'),
    goBefore: before,
    goAfter: onScreen(),
  };
});
console.log(JSON.stringify(scrollModel));
check(scrollModel.ports === 2, 'the review page has one scrollport per column', `${scrollModel.ports}`);
check(!scrollModel.layerScrolls, 'the page itself does not scroll — its columns do');
check(scrollModel.rightOverflows, 'the supply column has more in it than fits, so the rest of this means something');
check(scrollModel.rightMoved && scrollModel.leftStayed,
  'scrolling the supply list leaves the design column exactly where it was',
  `left at ${scrollModel.leftStayed ? 0 : 'moved'}`);
check(scrollModel.footOutsideList, 'the price and Checkout sit outside the scrolling list');
check(scrollModel.goBefore && scrollModel.goAfter,
  'Checkout is on screen both before and after the list is scrolled to its end',
  `before ${scrollModel.goBefore}, after ${scrollModel.goAfter}`);

// Past a certain shortness there's no room left to divide, and a scroll area
// squeezed to nothing would clip the button — so the layout gives up on its own
// terms and hands the page back to the document scroller.
await page.setViewport({ width: 1440, height: 520 });
await new Promise(r => setTimeout(r, 400));
const shortWindow = await page.evaluate(() => {
  const layer = document.querySelector('.kit-layer');
  const r = layer.querySelector('.kit-buy-go').getBoundingClientRect();
  return {
    layerScrolls: layer.scrollHeight > layer.clientHeight + 1,
    goVisible: r.top >= 0 && r.bottom <= window.innerHeight + 1,
  };
});
check(shortWindow.layerScrolls && shortWindow.goVisible,
  'in a window too short to divide, the page scrolls and Checkout is still on screen',
  JSON.stringify(shortWindow));

// On a phone there's one column and the page scrolls as a whole — two stacked
// scrollports is just two places to get stuck. The bar earns its keep by sticking
// to the bottom of the window instead, so it's showing the entire time the supply
// list is. Short again on purpose: a real phone is taller, and at a real height
// this kit's ten rows fit on one screen with nothing left to pin against.
await page.setViewport({ width: 390, height: 430 });
await new Promise(r => setTimeout(r, 500));
const mobileScroll = await page.evaluate(async () => {
  const layer = document.querySelector('.kit-layer');
  const right = layer.querySelector('.kit-col:last-child');
  const go = layer.querySelector('.kit-buy-go');
  // Bring the top of the supply column to the top of the window: from here the
  // bar should already be pinned, with the whole list still to come below it.
  layer.scrollTop += right.getBoundingClientRect().top;
  await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
  const r = go.getBoundingClientRect();
  return {
    layerScrolls: layer.scrollHeight > layer.clientHeight + 1,
    oneColumn: getComputedStyle(layer.querySelector('.kit-band')).gridTemplateColumns.split(' ').length === 1,
    listStillBelow: layer.querySelector('.kit-col:last-child .kit-scroll').getBoundingClientRect().bottom > window.innerHeight,
    goVisible: r.top >= 0 && r.bottom <= window.innerHeight + 1,
  };
});
console.log(JSON.stringify(mobileScroll));
check(mobileScroll.oneColumn, 'on a phone the two columns stack');
check(mobileScroll.layerScrolls, 'stacked, the page scrolls as one');
check(mobileScroll.listStillBelow && mobileScroll.goVisible,
  'Checkout is pinned to the bottom of the window with the list still running past it',
  `visible ${mobileScroll.goVisible}, list overruns ${mobileScroll.listStillBelow}`);
await page.setViewport({ width: 1440, height: 950 });
await new Promise(r => setTimeout(r, 400));

// Only now does Shopify get involved.
const navigated = page.waitForNavigation({ timeout: 15000 }).catch(() => null);
await page.evaluate(() => document.querySelector('.kit-layer .kit-buy-go').click());
await navigated;
await new Promise(r => setTimeout(r, 600));
check(cartCalls.length === 1, 'Checkout creates one cart', `${cartCalls.length}`);
const line = cartCalls[0]?.lines?.[0];
check(babyIndex >= 0 && line?.merchandiseId === babyVariant,
  'the cart line is the Baby Blanket variant', `${line?.merchandiseId} (wanted ${babyVariant})`);
check(line?.attributes?.[0]?.key === '_design_id' && line?.attributes?.[0]?.value === STUB_DESIGN_ID,
  'the design id rides along on the cart line', JSON.stringify(line?.attributes));
check(page.url() === STUB_CHECKOUT_URL, 'the browser is sent to the Shopify checkout URL', page.url());
check(designSaves.length === 1, 'Checkout does not upload a second copy', `${designSaves.length} POSTs`);

// The grid crafts list skeins rather than yardage, and their record is built
// differently (commitFloat, then buildStitchRecord), so both are walked too.
for (const { craft, size, type, unit, thread } of [
  { craft: 'Cross-stitch', size: 'Bookmark', type: 'cross-stitch', unit: 'stitches', thread: 'floss' },
  { craft: 'Punch Needle', size: 'Pillow', type: 'punch-needle', unit: 'loops', thread: 'yarn' },
]) {
  console.log(`\n${craft}:`);
  designSaves.length = 0; cartCalls.length = 0; bomCalls.length = 0;
  await walkToEditor(craft, size, ['template', 'skip']);
  await buyKit();
  const review = await reviewPage();
  check(!!review, `${craft}: Buy kit opens the review page`);
  check(designSaves.length === 1 && designSaves[0].type === type,
    `${craft}: the design uploads on buy`, `${designSaves.length} POSTs, type ${designSaves[0]?.type}`);
  check(designSaves[0]?.data?.presetName === size, `${craft}: the record carries its size`,
    designSaves[0]?.data?.presetName);
  check(designSaves[0]?.data?.stitches > 0, `${craft}: the record has ${unit} in it`,
    `${designSaves[0]?.data?.stitches}`);

  const bom = bomCalls[bomCalls.length - 1]?.bom;
  const rows = review?.groups.find(g => /In your kit/i.test(g.title))?.rows || [];
  if (bom) {
    // The listed skeins are the ones designToBom worked out, per colour.
    const want = (bom[thread] || []).map(t => ({
      label: `DMC ${t.code} — ${t.name}`,
      qty: `${t.skeins} skein${t.skeins === 1 ? '' : 's'}`,
    }));
    const missing = want.filter(w => !rows.some(r => r.label === w.label && r.qty === w.qty));
    check(want.length > 0 && missing.length === 0,
      `${craft}: every ${thread} colour is listed with the skeins designToBom worked out`,
      missing.length ? `missing ${JSON.stringify(missing.slice(0, 3))}` : `${want.length} colours`);
    check(rows.some(r => /needle/i.test(r.label)), `${craft}: the needle is listed`,
      rows.map(r => r.label).find(l => /needle/i.test(l)) || 'none');
    check(review?.specs.some(([k, v]) => /Skeins/i.test(k) && v === String(bom.totalSkeins)),
      `${craft}: the skein total matches the BOM`, JSON.stringify(review?.specs));
  }
  // Punch needle kits differ by SKU, not by design: the pillow's backing and
  // insert come from KIT_INFO, because designToBom deliberately leaves them out.
  if (type === 'punch-needle') {
    check(rows.some(r => /pillow insert/i.test(r.label)),
      'the pillow kit lists its backing and insert', rows.map(r => r.label).join(' | '));
  }
  await shootReview(type);

  const gone = page.waitForNavigation({ timeout: 15000 }).catch(() => null);
  await page.evaluate(() => document.querySelector('.kit-layer .kit-buy-go').click());
  await gone;
  await new Promise(r => setTimeout(r, 500));
  check(cartCalls[0]?.lines?.[0]?.attributes?.[0]?.value === STUB_DESIGN_ID,
    `${craft}: the cart line carries the design id`);
  check(page.url() === STUB_CHECKOUT_URL, `${craft}: Checkout reaches Shopify`, page.url());
}

// ── 4b. The finished-product preview ───────────────────────────────────────
// A second tile on the review page renders the design as the made-up object. It's
// a button rather than automatic because every press is a paid image-model call,
// and the result is cached so an abandoned checkout doesn't pay twice.
console.log('\n── finished-product preview ──');
mockupCalls.length = 0;
await walkToEditor('Cross-stitch', 'Medium Hoop', ['template', 'skip']);
await buyKit();

// Reads the preview tile: the one whose caption isn't "Your design". Matched on the
// caption alone, since the preview's own copy also mentions the design.
const previewTile = () => page.evaluate(() => {
  const cap = t => (t.querySelector('.kit-tile-cap') || {}).textContent?.trim() || '';
  const tiles = [...document.querySelectorAll('.kit-layer .kit-tile')];
  const tile = tiles.find(t => !/^Your design$/i.test(cap(t))) || null;
  if (!tile) return { tiles: tiles.length, present: false };
  const img = tile.querySelector('img');
  return {
    tiles: tiles.length,
    present: true,
    cta: (tile.querySelector('button') || {}).textContent?.trim() || null,
    msg: (tile.querySelector('.kit-tile-msg') || {}).textContent?.trim() || null,
    cap: cap(tile),
    img: img ? img.getAttribute('src') : null,
    // Proof it actually decoded, rather than being a broken <img> with a src.
    shown: img ? img.naturalWidth > 0 : false,
  };
});

const before = await previewTile();
check(before.present, 'a second tile offers the finished-product preview', JSON.stringify(before));
check(before.tiles === 2, 'two tiles side by side once the service is configured', `${before.tiles}`);
check(/See it finished/i.test(before.cta || ''), 'it offers a button rather than generating on arrival',
  String(before.cta));
check(mockupCalls.length === 0, 'nothing is generated until asked', `${mockupCalls.length} calls`);

const previewBtn = '.kit-layer .kit-tile .kit-tile-blank button';
await page.click(previewBtn);
await page.waitForFunction(
  () => {
    const cap = t => (t.querySelector('.kit-tile-cap') || {}).textContent?.trim() || '';
    const t = [...document.querySelectorAll('.kit-layer .kit-tile')].find(e => !/^Your design$/i.test(cap(e)));
    return !!(t && t.querySelector('img'));
  },
  { timeout: 15000 }
).catch(() => null);
const after = await previewTile();
check(mockupCalls.length === 1, 'pressing it asks the server once', `${mockupCalls.length} calls`);
check(after.img === STUB_MOCKUP, 'the returned image is what gets shown', String(after.img).slice(0, 40));
check(after.shown, 'and it actually decodes');
check(/not a photo/i.test(after.cap || ''), 'the caption says it is an illustration', String(after.cap));

// The prompt is the server's business; the client may only say which kit it is.
const call = mockupCalls[0] || {};
check(call.type === 'cross-stitch', 'the craft is sent', String(call.type));
check(call.presetName === 'Medium Hoop', 'the finished size is sent', String(call.presetName));
check(!('prompt' in call), 'the client sends no prompt of its own', Object.keys(call).join(','));

// The reference image has to be a real picture of the design. Decode the PNG the
// studio drew and check it carries the design's own colours.
const ref = await page.evaluate(async (dataUrl) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
  const cv = document.createElement('canvas');
  cv.width = img.naturalWidth; cv.height = img.naturalHeight;
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, cv.width, cv.height);
  const seen = new Set();
  for (let i = 0; i < data.length; i += 4) {
    seen.add(`#${[data[i], data[i + 1], data[i + 2]].map(v => v.toString(16).padStart(2, '0')).join('')}`);
  }
  return { w: cv.width, h: cv.height, colors: [...seen] };
}, call.image);
check(ref.w === 1024 && ref.h === 1024, 'the reference image is a 1024px square', `${ref.w}x${ref.h}`);
check(ref.colors.length > 2, 'it is a picture of the design, not a blank square',
  `${ref.colors.length} distinct colours`);
// Every colour in the design should appear in the raster it drew.
const designColors = (designSaves[designSaves.length - 1]?.data?.colors || []).map(c => c.hex.toLowerCase());
const drawn = new Set(ref.colors);
const absent = designColors.filter(h => !drawn.has(h));
check(designColors.length > 0 && absent.length === 0,
  "every one of the design's thread colours is in the reference image",
  absent.length ? `missing ${absent.join(' ')}` : `${designColors.length} colours`);
await shootReview('mockup-cross-stitch');

// Leaving and coming back must not pay for the same picture twice.
await page.goBack({ timeout: 15000 }).catch(() => null);
await new Promise(r => setTimeout(r, 700));
await buyKit();
const again = await previewTile();
check(mockupCalls.length === 1, 'returning to the review page reuses the cached preview',
  `${mockupCalls.length} calls`);
check(again.img === STUB_MOCKUP, 'and shows it straight away', String(again.img).slice(0, 40));

// The cache has to outlive the tab, because the gap between abandoning a checkout
// and reconsidering usually does. sessionStorage would not survive this walk.
await walkToEditor('Cross-stitch', 'Medium Hoop', ['template', 'skip']);
await buyKit();
const nextVisit = await previewTile();
check(mockupCalls.length === 1, 'a later visit to the same design still costs nothing',
  `${mockupCalls.length} calls`);
check(nextVisit.img === STUB_MOCKUP, 'and the preview is already there',
  String(nextVisit.img).slice(0, 40));

// A design already in someone's library keeps its id when they edit it, so a cache
// keyed on the id alone would hand back a picture of the layout they just changed.
// This harness makes that the case for every save — one stub id for all of them —
// so editing here changes the payload while the id stays put, which is exactly the
// collision the key's fingerprint half exists to catch.
const stitchesOf = (r) => ((r.specs || []).find(([k]) => /stitches/i.test(k)) || [])[1] || null;
const beforeEdit = stitchesOf(await reviewPage());
await page.goBack({ timeout: 15000 }).catch(() => null);
await page.waitForSelector('.xs-canvas', { timeout: 15000 }).catch(() => null);
await new Promise(r => setTimeout(r, 600));
const box = await page.$eval('.xs-canvas', el => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
}).catch(() => null);
check(!!box, 'the canvas is reachable again to edit it');
if (box) {
  // The pen has to be chosen explicitly; whatever tool the editor was left on
  // would otherwise select or pan and change nothing.
  await page.click('.xs-tool[title="Draw"]').catch(() => null);
  const cell = box.w / 120;
  const at = (cx, cy) => ({ x: box.x + (cx + 0.5) * cell, y: box.y + (cy + 0.5) * cell });
  for (let row = 2; row < 6; row++) {
    const a = at(2, row), b = at(20, row);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 10 });
    await page.mouse.up();
  }
  await new Promise(r => setTimeout(r, 500));
}
await buyKit();
const afterEditPage = await reviewPage();
const afterEditStitches = stitchesOf(afterEditPage);
// Without this the next two assertions would pass on a design that never changed.
check(!!beforeEdit && afterEditStitches !== beforeEdit, 'the edit actually changed the design',
  `${beforeEdit} -> ${afterEditStitches}`);
const afterEdit = await previewTile();
check(!afterEdit.img, 'an edited design does not reuse the old picture',
  String(afterEdit.img).slice(0, 40));
check(/See it finished/i.test(afterEdit.cta || ''), 'it offers to make a new one',
  String(afterEdit.cta));
check(mockupCalls.length === 1, 'and does not generate one unasked', `${mockupCalls.length} calls`);

// A preview that fails says so and offers another go, and — the point of the
// section — leaves the kit buyable. The picture is a nicety; the order isn't.
mockupFails = 502;
mockupCalls.length = 0;
await walkToEditor('Quilt', 'Throw Blanket', ['skip', 'skip', 'template']);
// Every save in this harness comes back as the same stub id. The key's fingerprint
// half means a different design misses anyway, but clearing keeps this section
// independent of how many previews the ones above left behind.
await page.evaluate(() => localStorage.clear());
await buyKit();
await page.click(previewBtn);
await page.waitForFunction(() => !!document.querySelector('.kit-layer .kit-tile-msg.is-err'), { timeout: 15000 })
  .catch(() => null);
const failed = await previewTile();
check(/Couldn't make the preview/i.test(failed.msg || ''), 'a failed preview says so in plain words',
  String(failed.msg));
check(/See it finished/i.test(failed.cta || ''), 'and offers another go', String(failed.cta));
check(!failed.img, 'with no broken image left behind', String(failed.img));
const buyableAfterFail = await page.evaluate(() => {
  const go = document.querySelector('.kit-layer .kit-buy-go');
  return !!go && !go.disabled;
});
check(buyableAfterFail, 'and the kit is still buyable');
await shootReview('mockup-failed');

// A design the model refuses is a different message: nothing is wrong with the kit.
mockupFails = 422;
await page.click(previewBtn);
await page.waitForFunction(
  () => /still fine to order/i.test(document.querySelector('.kit-layer .kit-tile-msg.is-err')?.textContent || ''),
  { timeout: 15000 }
).catch(() => null);
const refused = await previewTile();
check(/still fine to order/i.test(refused.msg || ''),
  'a refused design says the kit is unaffected', String(refused.msg));
mockupFails = 0;

// With no image key set the tile is absent rather than dead.
mockupConfigured = false;
mockupCalls.length = 0;
await walkToEditor('Punch Needle', 'Coaster', ['template', 'skip']);
await buyKit();
const unconfigured = await previewTile();
check(!unconfigured.present, 'no preview tile when the image service is unconfigured',
  JSON.stringify(unconfigured));
check(unconfigured.tiles === 1, 'just the design, and no empty slot', `${unconfigured.tiles}`);
check(mockupCalls.length === 0, 'and nothing is asked of it', `${mockupCalls.length} calls`);
const stillBuyable = await page.evaluate(() => !!document.querySelector('.kit-layer .kit-buy-go'));
check(stillBuyable, 'the kit is still buyable without a preview');
mockupConfigured = true;

// A full store must not quietly refuse every write. That would look like a working
// cache while paying for the same picture on every visit — the exact bill this
// cache exists to prevent, hidden behind a swallowed exception.
const evicted = await page.evaluate((img) => {
  const PREFIX = 'metime.mockup.';
  localStorage.clear();
  // Twelve saves against a cap of ten: the oldest go, the newest stay.
  for (let i = 0; i < 12; i++) cacheMockup(`${PREFIX}design${i}.k`, `${img}#${i}`);
  let held = 0;
  for (let i = 0; i < localStorage.length; i++) {
    if ((localStorage.key(i) || '').startsWith(PREFIX)) held++;
  }
  return {
    held,
    newest: !!cachedMockup(`${PREFIX}design11.k`),
    oldest: !!cachedMockup(`${PREFIX}design0.k`),
  };
}, STUB_MOCKUP);
check(evicted.held > 0 && evicted.held <= 10, 'the preview cache is bounded, not unbounded',
  `${evicted.held} entries held`);
check(evicted.newest, 'the most recent preview is kept');
check(!evicted.oldest, 'and the oldest is the one dropped');

// ── 5. Back out of the review page, back out of checkout ───────────────────
// Two different Backs. From the review page the studio is still mounted, so the
// canvas has to come back exactly as it was left. From Shopify the document may
// have been thrown away entirely, in which case the review page is rebuilt from
// the design id in the history entry.
console.log('\n── back from the review page ──');
await walkToEditor('Quilt', 'Throw Blanket', ['skip', 'skip', 'template']);
const patchesBefore = await page.evaluate(() => {
  const m = document.body.innerText.match(/Patches placed\s*(\d+)/);
  return m ? +m[1] : null;
});
const tplBefore = await page.evaluate(() => history.state && history.state.quiltTemplateId);
await buyKit();
check(await page.evaluate(() => history.state && history.state.step) === 'cart',
  'the review page gets its own history entry');
check(await page.evaluate(() => history.state && history.state.cartDesignId) === STUB_DESIGN_ID,
  'the entry carries the design id, not the design');
await page.goBack({ timeout: 15000 }).catch(e => console.log('  goBack:', e.message));
await new Promise(r => setTimeout(r, 900));
const backToEditor = await page.evaluate(() => ({
  layer: !!document.querySelector('.kit-layer'),
  editor: !!document.querySelector('.app'),
  step: history.state && history.state.step,
  patches: (() => {
    const m = document.body.innerText.match(/Patches placed\s*(\d+)/);
    return m ? +m[1] : null;
  })(),
}));
check(!backToEditor.layer, 'Back closes the review page', JSON.stringify(backToEditor));
check(backToEditor.editor, 'Back lands on the editor');
check(backToEditor.step === 'q-editor', 'the entry describes the editor step again', String(backToEditor.step));
check(patchesBefore > 0 && backToEditor.patches === patchesBefore,
  'the canvas comes back untouched', `${backToEditor.patches} vs ${patchesBefore} patches`);

console.log('\n── back from checkout ──');
await buyKit();
// Opt this document out of the back-forward cache, the way a phone evicting the
// tab does, so Back is forced to build the page again from the history entry.
await page.evaluate(() => window.addEventListener('unload', () => {}));
const gone = page.waitForNavigation({ timeout: 15000 }).catch(() => null);
await page.evaluate(() => document.querySelector('.kit-layer .kit-buy-go').click());
await gone;
check(page.url() === STUB_CHECKOUT_URL, 'reached checkout', page.url());

await page.goBack({ waitUntil: 'load', timeout: 20000 }).catch(e => console.log('  goBack:', e.message));
await page.waitForSelector('.kit-layer .kit-band', { timeout: 15000 }).catch(() => null);
await new Promise(r => setTimeout(r, 1000));
const returned = await page.evaluate(() => ({
  layer: !!document.querySelector('.kit-layer'),
  craft: /What are you making/.test(document.body.innerText),
  step: history.state && history.state.step,
  tpl: history.state && history.state.quiltTemplateId,
  price: (document.querySelector('.kit-buy-v') || {}).textContent?.trim() || null,
  rows: document.querySelectorAll('.kit-layer .kit-row').length,
}));
check(returned.layer, 'Back from checkout rebuilds the review page', JSON.stringify(returned));
check(!returned.craft, 'not dumped on the craft picker');
check(returned.step === 'cart', 'the entry still describes the review step', String(returned.step));
check(returned.tpl === tplBefore, 'the size and template are still recorded underneath',
  `${returned.tpl} vs ${tplBefore}`);
check(returned.rows > 0, 'the supply list is listed again', `${returned.rows} rows`);
check(returned.price === '$149', 'and priced again', String(returned.price));

// One more Back, from a rebuilt review page, has to reach the studio rather than
// the craft picker — the snapshot carries the editor state underneath for exactly
// this.
await page.goBack({ timeout: 15000 }).catch(e => console.log('  goBack:', e.message));
await new Promise(r => setTimeout(r, 1200));
const deeper = await page.evaluate(() => ({
  editor: !!document.querySelector('.app'),
  step: history.state && history.state.step,
}));
check(deeper.editor, 'Back again reaches the studio, not the craft picker', JSON.stringify(deeper));
check(deeper.step === 'q-editor', 'on the editor entry', String(deeper.step));

// ── 6. Re-ordering a design already in the library ─────────────────────────
// The saved-design preview is the second way in, and it used to read "Saved for
// checkout ✓" with nowhere to go for anything already uploaded. Now it routes to
// the same review page. The library UI itself sits behind the account wall, so
// rather than sign in, mount the button on its own with savedId set.
console.log('\n── library re-order ──');
await page.goto(freshUrl(), { waitUntil: 'load', timeout: 40000 });
await page.waitForFunction(
  () => document.querySelector('#root') && document.querySelector('#root').children.length > 0,
  { timeout: 15000 }
);
const reorder = await page.evaluate(async () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let reviewed = null;
  ReactDOM.createRoot(host).render(React.createElement(KitCheckoutButton, {
    type: 'quilt',
    design: { preset: 'Throw', shapes: [] },
    savedId: '00000000-0000-4000-8000-0000000000aa',
    onReview: (kit) => { reviewed = kit; },
  }));
  // Let the render settle and the price lookup resolve.
  await new Promise(r => setTimeout(r, 1200));
  const b = host.querySelector('button');
  if (b) b.click();
  await new Promise(r => setTimeout(r, 900));
  return {
    text: b ? b.textContent.trim() : null,
    disabled: b ? b.disabled : null,
    reviewed,
  };
});
check(!!reorder.text, 'the saved-design preview renders a kit button', reorder.text || 'none found');
check(/Review kit/.test(reorder.text || ''),
  'a design already in the library routes to the review page', `label "${reorder.text}"`);
check(/\$149/.test(reorder.text || ''), 'the re-order button carries the price', reorder.text);
check(reorder.disabled === false, 'the re-order button is enabled', `disabled=${reorder.disabled}`);
check(reorder.reviewed?.designId === '00000000-0000-4000-8000-0000000000aa',
  're-ordering reuses the stored design rather than uploading again',
  JSON.stringify(reorder.reviewed?.designId));
check(reorder.reviewed?.type === 'quilt', 'and carries the craft type', reorder.reviewed?.type);

// ── 7. Graceful degradation when Shopify is unreachable ────────────────────
// Pricing is advisory, so an outage must never stop someone from designing: the
// cards still render, just without prices, and nothing throws.
console.log('\n── storefront unreachable ──');
const plain = await browser.newPage();
const plainErrors = [];
plain.on('pageerror', e => plainErrors.push(e.message));
await plain.setRequestInterception(true);
plain.on('request', (req) => {
  const url = req.url();
  if (url.includes('/api/') && url.includes('graphql.json')) return req.abort('failed');
  req.continue();
});
await plain.goto(freshUrl(), { waitUntil: 'load', timeout: 40000 });
await plain.waitForFunction(
  () => document.querySelector('#root') && document.querySelector('#root').children.length > 0,
  { timeout: 15000 }
);
await plain.evaluate(() => {
  const el = [...document.querySelectorAll('.land-craft')].find(e => e.textContent.includes('Quilt'));
  if (el) el.click();
});
await plain.waitForSelector('.size-card-name', { timeout: 10000 });
await new Promise(r => setTimeout(r, 800));
const plainCards = await plain.$$eval('.size-card', els => els.length);
const plainPrices = await plain.$$eval('.size-card-price', els => els.length);
check(plainCards === 4, 'quilt size cards still render', `got ${plainCards}`);
check(plainPrices === 0, 'no price lines when the lookup fails', `got ${plainPrices}`);
check(plainErrors.length === 0, 'no page errors', plainErrors.join('; '));

// ── 4. Live catalog (opt-in) ───────────────────────────────────────────────
// Hits the real store with the committed token to catch drift the stubbed run
// can't see: a rotated token, an unpublished kit, a renamed handle, a price
// change. Run with --live.
if (LIVE) {
  console.log('\n── live store ──');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const token = (html.match(TOKEN_RE) || [])[0]?.match(/"([^"]*)"/)?.[1];
  const domain = (html.match(/const SHOPIFY_STORE_DOMAIN = "([^"]*)"/) || [])[1];
  const version = (html.match(/const SHOPIFY_STOREFRONT_API_VERSION = "([^"]*)"/) || [])[1];
  const handles = Object.values(mapping.kits || {}).flatMap(m => Object.values(m));

  if (!token || !domain || token.startsWith('YOUR_')) {
    check(false, 'live: store domain and token are set in index.html');
  } else {
    const fragment = 'fragment K on Product { handle variants(first:1){nodes{id availableForSale price{amount}}} }';
    const selections = handles.map((h, i) => `k${i}: product(handle:${JSON.stringify(h)}){...K}`).join(' ');
    let body;
    try {
      const res = await fetch(`https://${domain}/api/${version}/graphql.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Storefront-Access-Token': token },
        body: JSON.stringify({ query: `${fragment} { ${selections} }` }),
      });
      check(res.ok, `live: Storefront reachable at ${domain}`, res.ok ? '' : `HTTP ${res.status}`);
      body = await res.json();
    } catch (e) {
      check(false, `live: Storefront reachable at ${domain}`, e.message);
    }
    if (body?.errors?.length) {
      check(false, 'live: token accepted', body.errors[0].message);
    } else if (body?.data) {
      handles.forEach((handle, i) => {
        const node = body.data[`k${i}`];
        if (!node) {
          check(false, `live: ${handle} resolves`, 'null — unpublished, or the handle changed');
          return;
        }
        const v = node.variants.nodes[0];
        check(!!v && v.availableForSale, `live: ${handle} is purchasable`,
          v ? (v.availableForSale ? `$${Number(v.price.amount)}` : 'not available for sale') : 'no variant');
      });
    }
  }
}

console.log('\nconsole errors:', errors.length ? errors : 'none');
console.log(failures.length ? `\n${failures.length} FAILED:\n  ${failures.join('\n  ')}` : '\nall checks passed');

await browser.close();
server.close();
process.exit(failures.length ? 1 : 0);
