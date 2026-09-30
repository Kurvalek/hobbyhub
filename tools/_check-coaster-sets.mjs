// Coaster set templates (punch needle): four different designs from one card.
//
// Covers what the set plumbing added on top of a normal template: the mosaic is
// split one panel per page, a palette picked on the next step lands the same way
// on all four, the pages survive a save/reopen, and none of it leaks into the
// sizes or crafts that aren't coaster sets.
import { open, clickText, texts } from './_verify.mjs';

const SETS = ['Four Cats', 'Fruit Stand', 'Pasta Night', 'Four Daisies'];
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${msg}`); if (!cond) fails++; };

const t = await open();
const { page } = t;

// A signature of what's actually punched on the board: the colour at the centre
// of every cell. Reading a raw pixel lattice instead picks up the grid overlay's
// antialiasing, which lands differently depending on how the repaint was
// scheduled, and makes two pixel-identical boards look like they differ.
const readSig = () => page.evaluate(() => {
  const cv = document.querySelector('canvas');
  if (!cv) return null;
  const dims = (document.body.textContent.match(/(\d+)\s*×\s*(\d+)\s*loops/)
    || document.body.textContent.match(/(\d+)\s*×\s*(\d+)\s*stitches/));
  if (!dims) return null;
  const cols = +dims[1], rows = +dims[2];
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  const cw = cv.width / cols, ch = cv.height / rows;
  let h = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = Math.floor(c * cw + cw / 2), y = Math.floor(r * ch + ch / 2);
      const i = (y * cv.width + x) * 4;
      h = (h * 31 + d[i] * 7 + d[i + 1] * 3 + d[i + 2]) | 0;
    }
  }
  return h;
});
// The studio repaints on a rAF, so settle before hashing.
const pageSig = async () => {
  let prev = await readSig();
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 100));
    const next = await readSig();
    if (next === prev) return next;
    prev = next;
  }
  return prev;
};
const allPageSigs = async () => {
  const tabs = await texts(page, '.coaster-tab');
  const sigs = [];
  for (let i = 0; i < tabs.length; i++) {
    await clickText(page, '.coaster-tab', `Coaster ${i + 1}`);
    sigs.push(await pageSig());
  }
  return sigs;
};
const toTemplates = async (craft, size) => {
  await t.restart();
  await clickText(page, '.land-craft', craft);
  await clickText(page, '.size-card', size);
  await new Promise(r => setTimeout(r, 300));
};

// ── The cards are offered, and only where a set makes sense ────────────────
await toTemplates('Punch Needle', 'Coaster');
const coasterCards = await texts(page, '.tmpl-card-name');
for (const name of SETS) ok(coasterCards.includes(name), `Coaster offers "${name}"`);
// The sets replaced the single-piece charts at this size rather than joining
// them: four coasters carrying one abstract pattern wasn't a set worth offering.
ok(coasterCards.length === SETS.length, `Coaster offers the sets and nothing else (${coasterCards.join(', ')})`);
const specs = await texts(page, '.tmpl-card .brand-spec-v, .tmpl-card .spec-v');
ok(specs.some(s => /20 × 20 loops · set of 4/.test(s)), 'a set card quotes one coaster, not the mosaic');

for (const size of ['Small Hoop', 'Large Hoop', 'Pillow']) {
  await toTemplates('Punch Needle', size);
  const cards = await texts(page, '.tmpl-card-name');
  ok(SETS.every(n => !cards.includes(n)), `${size} offers no set charts`);
  // ...and is not left with an empty template step by that exclusion.
  ok(cards.length > 0, `${size} still offers charts of its own (${cards.join(', ')})`);
}
await toTemplates('Cross-stitch', 'Coaster');
const xsCards = await texts(page, '.tmpl-card-name');
ok(SETS.every(n => !xsCards.includes(n)), 'cross-stitch coasters offer no punch set charts');

// ── Each set seeds four DIFFERENT coasters ─────────────────────────────────
for (const name of SETS) {
  await toTemplates('Punch Needle', 'Coaster');
  await clickText(page, '.tmpl-card', name);
  await clickText(page, '.back-skip', 'Skip for now');
  await new Promise(r => setTimeout(r, 500));
  const sigs = await allPageSigs();
  ok(sigs.length === 4, `${name}: four coaster pages`);
  ok(new Set(sigs).size === 4, `${name}: all four pages differ`);
  ok(sigs.every(s => s !== null), `${name}: every page drew something`);
}

// ── A palette on the next step re-dresses all four the same way ────────────
// The four pages are split off one recolored mosaic, so every coaster has to
// agree on which palette color took the ground — otherwise a set comes out in
// four unrelated colorways.
await toTemplates('Punch Needle', 'Coaster');
await clickText(page, '.tmpl-card', 'Four Cats');
await clickText(page, '.pal-card', 'Coastal');
await new Promise(r => setTimeout(r, 600));
const dressed = await allPageSigs();
ok(new Set(dressed).size === 4, 'recolored set still has four distinct coasters');
const grounds = await page.evaluate(() => {
  // The ground is whatever color covers the most loops on a page; read it off
  // the canvas corner, which no motif reaches.
  const cv = document.querySelector('canvas');
  const d = cv.getContext('2d').getImageData(2, 2, 1, 1).data;
  return [d[0], d[1], d[2]].join(',');
});
ok(!!grounds, `ground after recolor: rgb(${grounds})`);
ok(grounds === '161,194,215', 'the ground took the palette color nearest its own tone');
const used = await texts(page, '.mat-row');
ok(used.length > 0, `recolored set lists its yarns (${used.length})`);

// ── Stepping back and forward rebuilds the set, not a flattened copy ───────
// The studio's grid isn't in the history entry — only the template id and the
// palette are — so a restored set has to be split out of the chart again.
await toTemplates('Punch Needle', 'Coaster');
await clickText(page, '.tmpl-card', 'Pasta Night');
await clickText(page, '.back-skip', 'Skip for now');
await new Promise(r => setTimeout(r, 500));
const before = await allPageSigs();

await page.goBack({ waitUntil: 'load' });   // back to the palette step
await new Promise(r => setTimeout(r, 600));
ok((await texts(page, '.pal-card-name')).length > 0, 'back lands on the palette step');
await page.goForward({ waitUntil: 'load' });
await new Promise(r => setTimeout(r, 900));
const after = await allPageSigs();
ok(after.length === 4, 'restored set still has four pages');
ok(new Set(after).size === 4, 'restored set keeps four distinct coasters');
ok(JSON.stringify(after) === JSON.stringify(before), 'restored pages match what was there before');

// ── The ordinary template path still works ─────────────────────────────────
// Sets share the seeding helper with every other chart, so a plain template has
// to keep landing as one design — four identical coasters where the size calls
// for a set, a single canvas where it doesn't. Punch needle has no single-piece
// chart at coaster size any more, so cross-stitch's coaster set carries this.
await toTemplates('Cross-stitch', 'Coaster');
const xsCoasterNames = await texts(page, '.tmpl-card-name');
await clickText(page, '.tmpl-card', xsCoasterNames[0]);
await clickText(page, '.back-skip', 'Skip for now');
await new Promise(r => setTimeout(r, 500));
const plain = await allPageSigs();
ok(plain.length === 4, 'a plain chart on a coaster size still opens four pages');
ok(new Set(plain).size === 1, 'a plain chart copies itself to all four');

await toTemplates('Punch Needle', 'Large Hoop');
await clickText(page, '.tmpl-card', 'Rolling Hills');
await clickText(page, '.back-skip', 'Skip for now');
await new Promise(r => setTimeout(r, 500));
ok((await texts(page, '.coaster-tab')).length === 0, 'Large Hoop has no coaster tabs');
ok((await pageSig()) !== null, 'Large Hoop still seeds its chart');

await toTemplates('Punch Needle', 'Small Hoop');
await clickText(page, '.tmpl-card', 'Sunburst');
await clickText(page, '.back-skip', 'Skip for now');
await new Promise(r => setTimeout(r, 500));
ok((await pageSig()) !== null, 'Small Hoop still seeds Sunburst');

const errors = t.errors.filter(e => !e.startsWith('[BABEL]'));
ok(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`);

await t.close();
console.log(fails ? `\n${fails} FAILED` : '\nall good');
process.exit(fails ? 1 : 0);
