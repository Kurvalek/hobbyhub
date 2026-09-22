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

await page.setRequestInterception(true);
page.on('request', (req) => {
  const url = req.url();
  if (!url.includes('/api/') || !url.includes('graphql.json')) return req.continue();
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
  const handles = Object.keys(variables)
    .filter(k => /^h\d+$/.test(k))
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
    .map(k => variables[k]);
  storefrontCalls.push({ handles, query: body.query || '' });

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
    status: 200,
    contentType: 'application/json',
    headers: cors,
    body: JSON.stringify({ data }),
  });
});

const url = `http://127.0.0.1:${port}/index.html`;
try {
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 20000 });
} catch {
  await page.goto(url, { waitUntil: 'load', timeout: 40000 });
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
  await page.goto(url, { waitUntil: 'load', timeout: 40000 });
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

// ── 3. Graceful degradation when Shopify is unreachable ────────────────────
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
await plain.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load', timeout: 40000 });
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
