// Scratch diagnostic for browser Back through the setup flow: stepping back one
// screen at a time, jumping home from the studio, and coming back to a document
// the browser rebuilt from nothing. Not part of the app.
import { open } from './_verify.mjs';

const { page, errors, close } = await open();
const failures = [];
const check = (ok, label, detail) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

const where = () => page.evaluate(() => {
  const has = s => !!document.querySelector(s);
  const screen =
    has('.app') ? 'quilt-editor'
    : has('.xs-app') ? 'grid-editor'
    : has('.tmpl-card') ? 'template'
    : has('.size-card') ? 'size'
    : has('.land-craft') ? 'craft'
    : 'other';
  const heading = (document.querySelector('.proj-heading, .brand-title, h1, h2') || {}).textContent || '';
  // Patch count / stitch count, so a restored canvas can be told from a blank one.
  const nums = [...document.querySelectorAll('.xs-materials-num, .app .body div')]
    .map(e => e.textContent.trim()).filter(t => /^\d+$/.test(t));
  return {
    screen,
    heading: heading.trim().slice(0, 28),
    state: history.state && history.state.step,
    tplId: history.state && (history.state.quiltTemplateId || history.state.gridTemplateId),
    body: document.body.innerText.slice(0, 400),
    nums: nums.slice(0, 3),
  };
});

const show = async (label) => {
  const w = await where();
  console.log(`  ${label.padEnd(24)} ${String(w.screen).padEnd(13)} state=${String(w.state).padEnd(11)} tpl=${String(w.tplId)}`);
  return w;
};

const click = (sel, text) => page.evaluate(({ sel, text }) => {
  const els = [...document.querySelectorAll(sel)];
  const el = text ? els.find(e => e.textContent.includes(text)) : els[0];
  if (!el) throw new Error(`no ${sel} matching ${text || '(first)'}`);
  el.click();
}, { sel, text });

const settle = (ms = 450) => new Promise(r => setTimeout(r, ms));
const APP = page.url().split('#')[0];

// Fresh browsing context each time, so entries from an earlier scenario can't be
// mistaken for the app's own.
async function fresh() {
  const ctx = await page.browser().createBrowserContext?.();
  return ctx;
}

async function walk(craft, steps) {
  await click('.land-craft', craft);
  await settle();
  await page.waitForSelector('.size-card');
  await click('.size-card', '');
  await settle();
  for (const kind of steps) {
    const sel = kind === 'template' ? '.tmpl-card' : '.back-skip';
    await page.waitForSelector(sel);
    await click(sel, kind === 'template' ? '' : 'Skip');
    await settle();
  }
}

// A unique query gets a brand-new entry with no snapshot on it, which is what a
// first-ever visit looks like. Navigating to the identical URL would keep the
// previous entry's state and restore straight back into the studio.
const load = async () => {
  await page.goto(`${APP}?fresh=${Date.now()}`, { waitUntil: 'load' });
  await page.waitForSelector('.land-craft');
  await settle();
};

console.log('\n=== 1. Back steps back one screen at a time ===');
await load();
await walk('Quilt', ['skip', 'skip', 'template']);
let w = await show('in editor');
check(w.screen === 'quilt-editor' && w.state === 'q-editor', 'reached the quilt editor');
for (const want of ['q-template', 'q-palette', 'q-backing', 'q-size', 'craft']) {
  await page.goBack(); await settle();
  w = await show(`back -> ${want}`);
  check(w.state === want, `Back lands on ${want}`, `state=${w.state}`);
}

console.log('\n=== 2. Back after the document is rebuilt from nothing ===');
await load();
await walk('Quilt', ['skip', 'skip', 'template']);
w = await show('in editor');
const tplBefore = w.tplId;
// An unload listener disqualifies the page from the back-forward cache, which is
// what a phone evicting the tab does for real.
await page.evaluate(() => window.addEventListener('unload', () => {}));
await page.goto('https://example.com/', { waitUntil: 'domcontentloaded' }).catch(() => {});
await settle();
await page.goBack({ waitUntil: 'load' }).catch(e => console.log('  goBack:', e.message));
await settle(1200);
w = await show('back into the app');
check(w.screen === 'quilt-editor', 'lands back in the studio, not on the craft picker', w.heading);
check(w.state === 'q-editor', 'the entry still describes the studio step', `state=${w.state}`);
check(w.tplId === tplBefore, 'the chosen template came back', `${w.tplId} vs ${tplBefore}`);
check(!/What are you making/.test(w.body), 'the craft picker is not what rendered');

console.log('\n=== 3. Same, for a grid craft ===');
await load();
await walk('Cross-stitch', ['template', 'skip']);
w = await show('in editor');
const gTpl = w.tplId;
await page.evaluate(() => window.addEventListener('unload', () => {}));
await page.goto('https://example.com/', { waitUntil: 'domcontentloaded' }).catch(() => {});
await settle();
await page.goBack({ waitUntil: 'load' }).catch(() => {});
await settle(1200);
w = await show('back into the app');
check(w.screen === 'grid-editor', 'lands back in the grid studio', w.heading);
check(w.tplId === gTpl, 'the chart template came back', `${w.tplId} vs ${gTpl}`);
const stitches = await page.evaluate(() => {
  const el = [...document.querySelectorAll('.xs-materials-num, div')]
    .find(e => /^\d+$/.test(e.textContent.trim()) && +e.textContent.trim() > 0);
  return el ? +el.textContent.trim() : 0;
});
check(stitches > 0, 'the restored board has the chart on it', `${stitches} stitches`);

console.log('\n=== 4. "Back to projects" leaves Back working ===');
await load();
await walk('Quilt', ['skip', 'skip', 'template']);
await show('in editor');
await page.evaluate(() => document.querySelector('.app header .icon-btn, .app .icon-btn').click());
await settle(700);
w = await show('after Back to projects');
check(w.screen === 'craft', 'the studio hands back to the craft picker');
// One more Back should now leave the app rather than doing nothing five times.
const before = page.url();
await page.goBack().catch(() => {});
await settle(700);
const after = page.url();
w = await where();
check(after !== before || w.screen !== 'craft',
  'Back is not a dead button afterwards', `url ${before === after ? 'unchanged' : 'changed'}, screen=${w.screen}`);

console.log('\n=== 5. A plain reload resumes the step ===');
await load();
await walk('Quilt', ['skip', 'skip', 'template']);
await show('in editor');
await page.reload({ waitUntil: 'load' });
await settle(1200);
w = await show('after reload');
check(w.screen === 'quilt-editor', 'a refresh keeps the maker in the studio', w.heading);
check(w.tplId === 'checkerboard', 'with the template still chosen', String(w.tplId));

console.log('\n=== 6. A first visit still opens on the craft picker ===');
await load();
w = await show('fresh visit');
check(w.screen === 'craft', 'a visit with no history lands on "What are you making?"', w.heading);

console.log('\nconsole errors:', errors.length ? errors : 'none');
console.log(failures.length ? `\n${failures.length} FAILED:\n  ${failures.join('\n  ')}` : '\nall back checks passed');
await close();
process.exit(failures.length ? 1 : 0);
