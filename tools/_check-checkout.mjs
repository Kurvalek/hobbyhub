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
// cartCreate inputs, and the bodies POSTed to /api/designs — the two sides of a
// purchase, recorded so we can prove a guest reaches checkout without saving.
const cartCalls = [];
const designSaves = [];
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
    return req.respond({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ id: STUB_DESIGN_ID }),
    });
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

// ── 4. A guest buys without saving or signing in first ─────────────────────
// The point of the whole change: one click from canvas to checkout. The design
// still gets uploaded (Shopify needs something to attach), but the shopper is
// never asked to save or make an account.
console.log('\n── guest purchase ──');
designSaves.length = 0; cartCalls.length = 0; storefrontCalls.length = 0;
await walkToEditor('Quilt', 'Baby Blanket', ['skip', 'skip', 'template']);
// The variant the stub minted for this handle, so the assertion below doesn't
// depend on where baby-quilt happened to sit in the batch.
const babyIndex = (storefrontCalls.find(c => c.handles.includes('baby-quilt'))?.handles || []).indexOf('baby-quilt');
const babyVariant = `gid://shopify/ProductVariant/${1000 + babyIndex}`;
const signedOut = await page.evaluate(() => !/Sign out|My account/i.test(document.body.innerText));
check(signedOut, 'starting from a signed-out session');

const navigated = page.waitForNavigation({ timeout: 15000 }).catch(() => null);
await page.evaluate(() => {
  const bar = document.querySelector('.header-right');
  const btn = [...bar.querySelectorAll('button.btn')].find(b => /^Buy kit/.test(b.textContent));
  if (btn) btn.click();
});
await navigated;
await new Promise(r => setTimeout(r, 600));

check(designSaves.length === 1, 'the design is uploaded exactly once', `${designSaves.length} POSTs`);
check(designSaves[0] && !designSaves[0].auth, 'uploaded with no Authorization header (guest)');
check(designSaves[0]?.type === 'quilt', 'uploaded under the right craft type', designSaves[0]?.type);
// The preset value is the SHOPIFY_KITS key ("Baby blanket"), not the card's
// display name ("Baby Blanket") — that mapping is what picks the product.
check(designSaves[0]?.data?.preset === 'Baby blanket', 'uploaded record carries the chosen size',
  designSaves[0]?.data?.preset);
check(cartCalls.length === 1, 'one cart was created', `${cartCalls.length}`);
const line = cartCalls[0]?.lines?.[0];
check(babyIndex >= 0 && line?.merchandiseId === babyVariant,
  'the cart line is the Baby Blanket variant', `${line?.merchandiseId} (wanted ${babyVariant})`);
check(line?.attributes?.[0]?.key === '_design_id' && line?.attributes?.[0]?.value === STUB_DESIGN_ID,
  'the design id rides along on the cart line', JSON.stringify(line?.attributes));
check(page.url() === STUB_CHECKOUT_URL, 'the browser is sent to the Shopify checkout URL', page.url());

// The grid editors build their record differently (commitFloat, then
// buildStitchRecord), so buy once from there too rather than trusting the quilt.
designSaves.length = 0; cartCalls.length = 0;
await walkToEditor('Cross-stitch', 'Bookmark', ['template', 'skip']);
const navigated2 = page.waitForNavigation({ timeout: 15000 }).catch(() => null);
await page.evaluate(() => {
  const bar = document.querySelector('.xs-topbar');
  const btn = [...bar.querySelectorAll('button.btn')].find(b => /^Buy kit/.test(b.textContent));
  if (btn) btn.click();
});
await navigated2;
await new Promise(r => setTimeout(r, 600));
check(designSaves.length === 1 && designSaves[0].type === 'cross-stitch',
  'a grid design uploads on buy', `${designSaves.length} POSTs, type ${designSaves[0]?.type}`);
check(designSaves[0]?.data?.presetName === 'Bookmark', 'the grid record carries its size',
  designSaves[0]?.data?.presetName);
check(designSaves[0]?.data?.stitches > 0, 'the grid record has stitches in it',
  `${designSaves[0]?.data?.stitches}`);
check(cartCalls[0]?.lines?.[0]?.attributes?.[0]?.value === STUB_DESIGN_ID,
  'the grid cart line carries the design id');
check(page.url() === STUB_CHECKOUT_URL, 'the grid editor reaches checkout too', page.url());

// ── 5. Coming back from checkout ───────────────────────────────────────────
// Buying redirects the tab to Shopify, so Back is the obvious way home. When the
// browser keeps the page in its back-forward cache that just works; when it
// doesn't — a phone under memory pressure, an unload listener, devtools open —
// the document is rebuilt, and it used to rebuild as "What are you making?".
console.log('\n── back from checkout ──');
await walkToEditor('Quilt', 'Throw Blanket', ['skip', 'skip', 'template']);
const tplBefore = await page.evaluate(() => history.state && history.state.quiltTemplateId);
// Opt this document out of the back-forward cache, the way a phone evicting the
// tab does, so Back is forced to build the page again from the history entry.
await page.evaluate(() => window.addEventListener('unload', () => {}));
const gone = page.waitForNavigation({ timeout: 15000 }).catch(() => null);
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('.header-right button.btn')].find(b => /^Buy kit/.test(b.textContent));
  if (btn) btn.click();
});
await gone;
check(page.url() === STUB_CHECKOUT_URL, 'reached checkout', page.url());

await page.goBack({ waitUntil: 'load', timeout: 20000 }).catch(e => console.log('  goBack:', e.message));
await new Promise(r => setTimeout(r, 1400));
const returned = await page.evaluate(() => ({
  editor: !!document.querySelector('.app'),
  craft: /What are you making/.test(document.body.innerText),
  step: history.state && history.state.step,
  tpl: history.state && history.state.quiltTemplateId,
  patches: (() => {
    const m = document.body.innerText.match(/Patches placed\s*(\d+)/);
    return m ? +m[1] : null;
  })(),
}));
check(returned.editor, 'Back from checkout returns to the studio', JSON.stringify(returned));
check(!returned.craft, 'not dumped on the craft picker');
check(returned.step === 'q-editor', 'the entry still describes the studio step', String(returned.step));
check(returned.tpl === tplBefore, 'the size and template are still chosen', `${returned.tpl} vs ${tplBefore}`);
check(returned.patches > 0, 'the quilt top is rebuilt, not blank', `${returned.patches} patches`);

// ── 6. Re-ordering a design already in the library ─────────────────────────
// The saved-design preview is the second way in, and it used to read "Saved for
// checkout ✓" with nowhere to go for anything already uploaded. The library UI
// itself sits behind the account wall, so rather than sign in, mount the button
// on its own with savedId set — which is the state that used to go wrong.
console.log('\n── library re-order ──');
await page.goto(freshUrl(), { waitUntil: 'load', timeout: 40000 });
await page.waitForFunction(
  () => document.querySelector('#root') && document.querySelector('#root').children.length > 0,
  { timeout: 15000 }
);
const reorder = await page.evaluate(async () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  ReactDOM.createRoot(host).render(React.createElement(KitCheckoutButton, {
    type: 'quilt',
    design: { preset: 'Throw', shapes: [] },
    savedId: '00000000-0000-4000-8000-0000000000aa',
  }));
  // Let the render settle and the price lookup resolve.
  await new Promise(r => setTimeout(r, 1200));
  const b = host.querySelector('button');
  return b ? { text: b.textContent.trim(), disabled: b.disabled } : null;
});
check(!!reorder, 'the saved-design preview renders a kit button', reorder ? reorder.text : 'none found');
check(!!reorder && /Add to cart/.test(reorder.text),
  'a design already in the library can still be bought', reorder ? `label "${reorder.text}"` : '');
check(!!reorder && /\$149/.test(reorder.text), 'the re-order button carries the price', reorder?.text);
check(!!reorder && !reorder.disabled, 'the re-order button is enabled', `disabled=${reorder?.disabled}`);

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
