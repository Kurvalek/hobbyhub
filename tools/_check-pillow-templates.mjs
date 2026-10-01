// Punch needle pillow templates: the two lettering charts and the abstract one.
//
// Covers what this batch of designs actually promises — the right charts at the
// right sizes, baked lettering that survives the trip through quantization and
// RLE, two colours and no more on Homebody, and a Name in Daisies that arrives
// on the text tool in the script face with the middle of the pillow left clear
// for the maker's own words.
import { open, clickText, texts } from './_verify.mjs';

const PILLOW_ONLY = ['Homebody', 'Name in Daisies'];
const EVERY_SIZE = 'Soft Shapes';
const GONE = ['Sunburst', 'Wavy Stripes', 'Rolling Hills', 'Big Bloom'];
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${msg}`); if (!cond) fails++; };

const t = await open();
const { page } = t;

const toTemplates = async (size) => {
  await t.restart();
  await clickText(page, '.land-craft', 'Punch Needle');
  await clickText(page, '.size-card', size);
  await new Promise(r => setTimeout(r, 300));
  return texts(page, '.tmpl-card-name');
};
// Every distinct colour actually punched on the board, read at the centre of
// each cell so the grid overlay's antialiasing doesn't invent extra ones.
const boardColors = () => page.evaluate(() => {
  const cv = document.querySelector('canvas');
  const dims = document.body.textContent.match(/(\d+)\s*×\s*(\d+)\s*loops/);
  if (!cv || !dims) return null;
  const cols = +dims[1], rows = +dims[2];
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  const cw = cv.width / cols, ch = cv.height / rows;
  const seen = new Map();
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = Math.floor(c * cw + cw / 2), y = Math.floor(r * ch + ch / 2);
    const i = (y * cv.width + x) * 4;
    const k = `${d[i]},${d[i + 1]},${d[i + 2]}`;
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  return { cols, rows, counts: [...seen.entries()].sort((a, b) => b[1] - a[1]) };
});

// ── Offered where they read, and the old charts are gone ───────────────────
const pillow = await toTemplates('Pillow');
for (const n of [...PILLOW_ONLY, EVERY_SIZE]) ok(pillow.includes(n), `Pillow offers "${n}"`);
ok(pillow.length === 3, `Pillow offers those three and nothing else (${pillow.join(', ')})`);

for (const size of ['Small Hoop', 'Large Hoop']) {
  const cards = await toTemplates(size);
  // Lettering is the one thing that can't be resampled: dropping 70 loops to 30
  // leaves the caps six loops tall, and a square chart stretched onto a portrait
  // hoop squeezes them sideways. So the hoops get the abstract chart only.
  ok(cards.includes(EVERY_SIZE), `${size} offers "${EVERY_SIZE}"`);
  ok(PILLOW_ONLY.every(n => !cards.includes(n)), `${size} is not offered the lettering charts`);
  ok(cards.length > 0, `${size} is not left with an empty template step`);
}
const coaster = await toTemplates('Coaster');
ok([...PILLOW_ONLY, EVERY_SIZE].every(n => !coaster.includes(n)), 'Coaster offers no pillow charts');

const everywhere = [];
for (const size of ['Coaster', 'Small Hoop', 'Large Hoop', 'Pillow']) {
  everywhere.push(...await toTemplates(size));
}
for (const n of GONE) ok(!everywhere.includes(n), `"${n}" is gone from every size`);

// ── Homebody: two colours, and the words made it through ───────────────────
await toTemplates('Pillow');
await clickText(page, '.tmpl-card', 'Homebody');
await clickText(page, '.back-skip', 'Skip for now');
await new Promise(r => setTimeout(r, 700));
const hb = await boardColors();
ok(hb && hb.cols === 70 && hb.rows === 70, `Homebody opens 70 × 70 (${hb && hb.cols}×${hb && hb.rows})`);
ok(hb && hb.counts.length === 2, `Homebody is punched in exactly two colours (${hb && hb.counts.length})`);
// The ground has to dominate but the lettering still has to be a real presence:
// a chart that quantized its words away would read as one flat colour.
const inkShare = hb ? hb.counts[1][1] / (hb.cols * hb.rows) : 0;
ok(inkShare > 0.1 && inkShare < 0.4, `lettering covers ${(inkShare * 100).toFixed(0)}% of the pillow`);
ok(hb && hb.counts.map(c => c[0]).includes('235,183,175'), 'ground is the shell pink it was authored in');
ok(hb && hb.counts.map(c => c[0]).includes('224,72,72'), 'lettering is the coral it was authored in');

// ── Name in Daisies: opens ready to type, middle left clear ────────────────
await toTemplates('Pillow');
await clickText(page, '.tmpl-card', 'Name in Daisies');
await clickText(page, '.back-skip', 'Skip for now');
await new Promise(r => setTimeout(r, 700));
const seeded = await page.evaluate(() => {
  const ta = document.querySelector('textarea');
  const panel = ta && ta.parentElement;
  const faces = ['Serif', 'Sans', 'Script', 'Sampler'];
  const chosen = panel && [...panel.querySelectorAll('button')]
    .find(b => faces.includes(b.textContent.trim()) && b.classList.contains('btn-dark'));
  const range = panel && panel.querySelector('input[type=range]');
  return {
    tool: (document.querySelector('.xs-tool.active') || {}).title,
    font: chosen ? chosen.textContent.trim() : null,
    size: range ? +range.value : null,
    value: ta ? ta.value : null,
  };
});
ok(seeded.tool === 'Text', `Name in Daisies opens on the text tool (${seeded.tool})`);
ok(seeded.font === 'Script', `the script face is preselected (${seeded.font})`);
ok(seeded.size === 22, `the height is seeded to suit the pillow (${seeded.size})`);
ok(seeded.value === '', 'no name is baked in — the textarea starts empty');
// The daisies ring an empty band, so the middle rows must be bare ground: if a
// motif crept in there the maker would have to unpick it before typing.
const clearBand = await page.evaluate(() => {
  const cv = document.querySelector('canvas');
  const dims = document.body.textContent.match(/(\d+)\s*×\s*(\d+)\s*loops/);
  const cols = +dims[1], rows = +dims[2];
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  const cw = cv.width / cols, ch = cv.height / rows;
  const at = (c, r) => {
    const x = Math.floor(c * cw + cw / 2), y = Math.floor(r * ch + ch / 2);
    const i = (y * cv.width + x) * 4;
    return `${d[i]},${d[i + 1]},${d[i + 2]}`;
  };
  const ground = at(0, Math.floor(rows / 2));
  let tallest = 0, run = 0;
  for (let r = 0; r < rows; r++) {
    let bare = true;
    for (let c = 0; c < cols; c++) if (at(c, r) !== ground) { bare = false; break; }
    run = bare ? run + 1 : 0;
    tallest = Math.max(tallest, run);
  }
  return { ground, tallest };
});
ok(clearBand.ground === '242,227,206', 'ground is the cream it was authored in');
ok(clearBand.tallest >= 24, `${clearBand.tallest} clear rows across the middle for a name`);

// ── Soft Shapes survives both resamples ────────────────────────────────────
for (const [size, cols, rows] of [['Small Hoop', 30, 30], ['Large Hoop', 40, 50]]) {
  await toTemplates(size);
  await clickText(page, '.tmpl-card', EVERY_SIZE);
  await clickText(page, '.back-skip', 'Skip for now');
  await new Promise(r => setTimeout(r, 700));
  const b = await boardColors();
  ok(b && b.cols === cols && b.rows === rows, `${size} opens ${cols} × ${rows}`);
  // Resampling to a third of the loops must not collapse the design onto its
  // ground — all five shapes should still have loops of their own.
  ok(b && b.counts.length === 6, `${size} keeps all six colours (${b && b.counts.length})`);
}

const errors = t.errors.filter(e => !e.startsWith('[BABEL]'));
ok(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
await t.close();

// ── On mobile the text controls live in a sheet, which has to open itself ──
// Punch needle is the first craft with a seeded template, so this path was only
// ever exercised by cross-stitch before now.
{
  const m = await open({ width: 420, height: 860 });
  await clickText(m.page, '.land-craft', 'Punch Needle');
  await clickText(m.page, '.size-card', 'Pillow');
  await clickText(m.page, '.tmpl-card', 'Name in Daisies');
  await clickText(m.page, '.back-skip', 'Skip for now');
  await new Promise(r => setTimeout(r, 900));
  const sheet = await m.page.evaluate(() => {
    const ta = document.querySelector('textarea');
    const chosen = [...document.querySelectorAll('button.btn-sm')]
      .find(b => b.classList.contains('btn-dark') && ['Serif', 'Sans', 'Script', 'Sampler'].includes(b.textContent.trim()));
    return { inStudio: !!document.querySelector('.xs-app'), open: !!ta, font: chosen && chosen.textContent.trim() };
  });
  ok(sheet.inStudio, 'mobile reaches the punch needle studio');
  ok(sheet.open, 'the text sheet opens itself on arrival');
  ok(sheet.font === 'Script', `the script face is preselected in the sheet (${sheet.font})`);
  await m.page.screenshot({ path: 'tools/_shot-pillow-nameday-mobile.png' });
  const me = m.errors.filter(e => !e.startsWith('[BABEL]'));
  ok(me.length === 0, `no console errors on mobile${me.length ? ': ' + me.join(' | ') : ''}`);
  await m.close();
}

console.log(fails ? `\n${fails} FAILED` : '\nall good');
process.exit(fails ? 1 : 0);
