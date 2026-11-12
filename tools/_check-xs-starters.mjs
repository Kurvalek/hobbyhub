// Scratch: the starter designs end to end in the guided studio — each lays
// exactly as charted (on every coaster of a set), its words reopen in the text
// tool without an "Off the edge" warning, retyped words keep their alignment,
// fill runs under words and recolors them, a palette preset re-dresses words
// and all, and undo steps back through every one of those. Not part of the app.
//
//   node tools/_check-xs-starters.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import { open } from './_verify.mjs';

// The board size of whatever was laid last.
let W = 70, H = 70;
const pause = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
};

// The charts as the generator wrote them, words stamped on top.
const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync('assets/stitch-templates-data.js', 'utf8'), ctx);
const DATA = ctx.window.STITCH_TEMPLATE_DATA;
const STARTERS = DATA.filter(d => d.texts);
const SIZES = [...new Set(STARTERS.map(d => d.presets[0]))];
function chart(d) {
  const grid = [];
  for (const tok of d.rle.split(' ')) {
    const [v, run] = tok.split('.').map(s => parseInt(s, 36));
    for (let k = 0; k < run; k++) grid.push(v ? d.colors[v - 1].toUpperCase() : null);
  }
  const words = d.texts.map(t => { let k = 0; return t.cells.split(' ').map(g => (k += parseInt(g, 36))); });
  d.texts.forEach((t, i) => { for (const k of words[i]) grid[k] = d.colors[t.role].toUpperCase(); });
  return { grid, words };
}

const { page, errors, close } = await open({ width: 1440, height: 950 });
const base = page.url().split('?')[0];
const click = sel => page.evaluate(s => { const el = document.querySelector(s); if (el) el.click(); return !!el; }, sel);

// The board as painted: each stitch's center pixel, unstitched as null.
async function board(w = W, h = H) {
  await page.mouse.move(2, 2);
  await pause(120);
  return page.evaluate((W, H) => {
    const cv = document.querySelector('.xs-canvas');
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    const s = cv.width / W, out = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (Math.floor((y + 0.5) * s) * cv.width + Math.floor((x + 0.5) * s)) * 4;
      const hex = '#' + [d[i], d[i + 1], d[i + 2]].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
      out.push(hex === '#FFFFFF' ? null : hex);
    }
    return out;
  }, w, h);
}
const norm = g => g.map(h => (h === '#FFFFFF' ? null : h));
const diff = (a, b) => a.reduce((n, h, i) => n + (h !== b[i] ? 1 : 0), 0);
async function tapCell(k) {
  const r = await page.evaluate(() => { const b = document.querySelector('.xs-canvas').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
  await page.mouse.click(r.x + ((k % W) + 0.5) * r.w / W, r.y + (Math.floor(k / W) + 0.5) * r.h / H);
  await pause(200);
}
const tool = id => click(`[data-ed-tool="${id}"]`);
const typeInBox = text => page.evaluate(v => {
  const ta = document.querySelector('.xs-textbox-input');
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, v);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}, text);
const done = async () => { await click('.xs-textmenu .btn-dark'); await pause(200); };
const undo = async () => { await page.keyboard.down('Meta'); await page.keyboard.press('z'); await page.keyboard.up('Meta'); await pause(200); };
const toast = () => page.evaluate(() => document.querySelector('.ed-toast')?.textContent || '');
const inkBox = (g, hex, y0 = 0, y1 = H) => {
  let l = W, r = -1;
  for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) if (g[y * W + x] === hex) { l = Math.min(l, x); r = Math.max(r, x); }
  return { l, r: r + 1, mid: (l + r + 1) / 2 };
};

async function startGuided(size) {
  await page.goto(`${base}?fresh=1&v=${Date.now()}`, { waitUntil: 'load', timeout: 40000 });
  await page.waitForSelector('.land-craft', { timeout: 15000 });
  await page.evaluate(() => [...document.querySelectorAll('.land-craft')].find(e => e.textContent.includes('Cross')).click());
  await page.waitForSelector(`[data-ed-size="${size}"]`, { timeout: 10000 });
  await click(`[data-ed-size="${size}"]`);
  await page.waitForSelector('[data-ed-template]', { timeout: 10000 });
  await pause(300);
}
async function lay(id) {
  const d = DATA.find(x => x.id === id);
  W = d.w; H = d.h;
  await startGuided(d.presets[0]);
  await click(`[data-ed-template="${id}"]`);
  await pause(900);
}
const coaster = async i => { await click(`[data-ed-coaster="${i}"]`); await pause(250); };
const textValue = () => page.evaluate(() => document.querySelector('.xs-textbox-input')?.value ?? null);

try {
  // ── The picker offers each size its own charts ──
  for (const size of SIZES) {
    await startGuided(size);
    const offered = await page.evaluate(() => [...document.querySelectorAll('[data-ed-template]')].map(e => e.dataset.edTemplate));
    const want = ['blank', ...STARTERS.filter(d => d.presets[0] === size).map(d => d.id)];
    check(offered.join() === want.join(), `${size} offers Blank + its four starters`, offered.join());
    await page.screenshot({ path: `tools/_shot-xs-starters-picker-${size.replace(/ /g, '-').toLowerCase()}.png` });
  }

  for (const d of STARTERS) {
    const { grid, words } = chart(d);
    await lay(d.id);
    let g = await board();
    check(diff(g, norm(grid)) === 0, `${d.id}: laid exactly as charted`, `${diff(g, norm(grid))} stitches differ`);
    const textTool = await page.evaluate(() => document.querySelector('[data-ed-tool="text"]')?.getAttribute('aria-pressed') === 'true');
    if (d.texts.length) {
      check(textTool, `${d.id}: opens on the text tool`);
      check(/tap a word/.test(await toast()), `${d.id}: toast says the words are editable`, await toast());
    } else {
      check(!textTool && /undo to go back/.test(await toast()), `${d.id}: no words, so no text tool`, await toast());
    }
    await page.screenshot({ path: `tools/_shot-xs-starter-${d.id}.png` });
    if (d.presets[0] === 'Coaster Set') {
      for (const i of [1, 2, 3]) {
        await coaster(i);
        const c = await board();
        check(diff(c, norm(grid)) === 0, `${d.id}: coaster ${i + 1} laid too`, `${diff(c, norm(grid))} differ`);
      }
      await coaster(0);
    }
    // Every word reopens in the text tool, on the board, and closes back untouched.
    for (const [i, t] of d.texts.entries()) {
      await tapCell(words[i][Math.floor(words[i].length / 2)]);
      const st = await page.evaluate(() => ({
        open: !!document.querySelector('.xs-textbox-input'),
        value: document.querySelector('.xs-textbox-input')?.value,
        over: !!document.querySelector('.xs-textmenu-warn'),
      }));
      check(st.open && st.value === t.text, `${d.id}: "${t.text.replace('\n', ' / ')}" reopens as text`, JSON.stringify(st.value));
      check(!st.over, `${d.id}: "${t.text.replace('\n', ' / ')}" isn't off the edge`);
      await done();
    }
    g = await board();
    check(diff(g, norm(grid)) === 0, `${d.id}: reopening every word changes nothing`, `${diff(g, norm(grid))} stitches differ`);
  }

  // ── Retyping keeps alignment ──
  {
    const d = DATA.find(x => x.id === 'drop-cap'), { words } = chart(d);
    await lay('drop-cap');
    const accent = d.colors[1].toUpperCase();
    const before = inkBox(await board(), accent, 53, 66);
    await tapCell(words[1][0]);
    await typeInBox('ANN');
    await done();
    const after = inkBox(await board(), accent, 53, 66);
    check(Math.abs(after.mid - before.mid) <= 1, 'drop-cap: a retyped name stays centered', `${before.l}–${before.r} → ${after.l}–${after.r}`);
    await page.screenshot({ path: 'tools/_shot-xs-starter-drop-cap-retyped.png' });
    await undo();
    check(diff(await board(), norm(chart(d).grid)) === 0, 'drop-cap: undo puts the name back');
  }
  {
    const d = DATA.find(x => x.id === 'text-thread'), { words } = chart(d);
    await lay('text-thread');
    const grey = d.colors[d.texts[2].role].toUpperCase();
    const before = inkBox(await board(), grey, 50, 60);
    await tapCell(words[2][0]);
    await typeInBox('READ 9:41');
    await done();
    const after = inkBox(await board(), grey, 50, 60);
    check(after.r === before.r, 'text-thread: a retyped "DELIVERED" stays right-aligned', `right edge ${before.r} → ${after.r}`);
  }

  // ── Fill runs under words and recolors them ──
  {
    const d = DATA.find(x => x.id === 'hotel-key'), { grid, words } = chart(d);
    await lay('hotel-key');
    await click('.ed-panel-head .icon-btn');   // out of the guide, into the editor
    await pause(300);
    const navy = d.colors[0].toUpperCase();
    // The thread menu's swatches, picked by position.
    const pickSwatch = async i => {
      await page.evaluate(() => document.querySelector('.ed-menu-swatch').closest('button').click());
      await pause(200);
      const name = await page.evaluate(i => {
        const sw = document.querySelectorAll('.ed-menu-swatches .ed-swatch:not(.ed-swatch-add)')[i];
        sw?.click();
        return sw?.title;
      }, i);
      await pause(200);
      return name;
    };
    await tool('fill');
    const swatch = await pickSwatch(2);
    // The navy between the cream band and the words, under the room number.
    const fobCell = 44 * W + 35;
    await tapCell(fobCell);
    let g = await board();
    // Expected: the navy region of the chart without its words, flooded; the
    // words themselves keep their stitches.
    const under = grid.slice(), inWord = new Set(words.flat());
    d.texts.forEach((t, i) => { for (const k of words[i]) under[k] = navy; });
    const want = grid.slice(), seen = new Set([fobCell]), stack = [fobCell];
    while (stack.length) {
      const k = stack.pop();
      if (!inWord.has(k)) want[k] = g[fobCell];
      const x = k % W, y = Math.floor(k / W);
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        const n = ny * W + nx;
        if (nx >= 0 && nx < W && ny >= 0 && ny < H && !seen.has(n) && under[n] === navy) { seen.add(n); stack.push(n); }
      }
    }
    check(g[fobCell] !== navy && diff(g, norm(want)) === 0, 'hotel-key: one fill recolors the fob, flowing under the words and through their counters',
      `${diff(g, norm(want))} differ · ${seen.size} cells flooded with ${swatch} ${g[fobCell]}`);
    await page.screenshot({ path: 'tools/_shot-xs-starter-hotel-filled.png' });
    // The words survive the fill as words, and lift off the new color.
    await tool('text');
    await tapCell(words[2][0]);
    const navyBefore = g.filter(h => h === navy).length;
    await typeInBox('SUITE');
    await done();
    g = await board();
    check(g.filter(h => h === navy).length === navyBefore, 'hotel-key: retyping a word after the fill leaves no old color under it');
    await page.screenshot({ path: 'tools/_shot-xs-starter-hotel-suite.png' });
    await tool('fill');
    await pickSwatch(1);
    await tapCell(words[1][0]);
    g = await board();
    const green = g[words[1][0]];
    check(words[1].every(k => g[k] === green) && green !== d.colors[2].toUpperCase(), 'hotel-key: fill on a word recolors the whole word', green);
    await tool('text');
    await tapCell(words[1][0]);
    const reopened = await page.evaluate(() => document.querySelector('.xs-textbox-input')?.value);
    check(reopened === 'Nora', 'hotel-key: the recolored word is still editable', JSON.stringify(reopened));
    await done();
    for (let i = 0; i < 3; i++) await undo();
    check(diff(await board(), norm(grid)) === 0, 'hotel-key: undo walks back through fill, retype and fill', `${diff(await board(), norm(grid))} differ`);
    await page.screenshot({ path: 'tools/_shot-xs-starter-hotel-undo.png' });
  }

  // ── A palette preset re-dresses the design, words and all ──
  {
    const d = DATA.find(x => x.id === 'matchbook'), { grid, words } = chart(d);
    await lay('matchbook');
    await click('[data-ed-palette="Blue & Cream"]');
    await pause(400);
    let g = await board();
    const colors = new Set(g.filter(Boolean));
    check(diff(g, norm(grid)) > 1000 && colors.size === 5, 'matchbook: Blue & Cream re-dresses it in 5 palette colors', [...colors].join(' '));
    await page.screenshot({ path: 'tools/_shot-xs-starter-matchbook-blue.png' });
    await tool('text');
    await tapCell(words[1][0]);
    const v = await page.evaluate(() => document.querySelector('.xs-textbox-input')?.value);
    check(v === 'K & J', 'matchbook: words stay editable after the palette', JSON.stringify(v));
    await typeInBox('A & B');
    await done();
    // A second palette on the edited board swaps role for role.
    await click('[data-ed-palette="Rust & Mustard"]');
    await pause(400);
    await tapCell(words[2][0]);
    const v2 = await page.evaluate(() => document.querySelector('.xs-textbox-input')?.value);
    check(v2 === 'EST 2024', 'matchbook: words stay editable after a palette on an edited board', JSON.stringify(v2));
    await done();
    g = await board();
    const cover = g[20 * W + 13], cream = g[words[2][0]];
    check(cover && cream && cover !== cream, 'matchbook: the words still contrast with the cover', `${cream} on ${cover}`);
    await page.screenshot({ path: 'tools/_shot-xs-starter-matchbook-rust.png' });
  }

  // ── Coaster sets: words on every coaster, each its own ──
  {
    const d = DATA.find(x => x.id === 'postage-stamp'), { grid, words } = chart(d);
    await lay('postage-stamp');
    const ink = d.colors[d.texts[0].role].toUpperCase();
    await tapCell(words[0][0]);
    await typeInBox('LA');
    await done();
    await tapCell(words[1][0]);
    await typeInBox('7');
    await done();
    const g = await board();
    const place = inkBox(g.map((h, k) => (k % W < 20 ? h : null)), ink, 29, 35);
    const year = inkBox(g.map((h, k) => (k % W >= 20 ? h : null)), ink, 29, 35);
    check(place.l === 6 && year.r === 34, 'postage-stamp: the place stays left-aligned and the year right-aligned', `place from ${place.l}, year to ${year.r}`);
    await coaster(2);
    check(diff(await board(), norm(grid)) === 0, 'postage-stamp: retyping coaster 1 leaves coaster 3 as it was');
    await tapCell(words[0][0]);
    check(await textValue() === 'NY', 'postage-stamp: coaster 3 has its own words to retype', JSON.stringify(await textValue()));
    await done();
    await page.screenshot({ path: 'tools/_shot-xs-starter-postage-coasters.png' });
  }
  {
    const d = DATA.find(x => x.id === 'monogram'), { words } = chart(d);
    await lay('monogram');
    await tapCell(words[0][Math.floor(words[0].length / 2)]);
    await typeInBox('M');
    await done();
    const mine = await board();
    await click('.ed-coaster-copy');
    await pause(300);
    await coaster(3);
    check(diff(await board(), mine) === 0, 'monogram: Copy to all puts the new initial on every coaster');
    const initial = d.colors[d.texts[0].role].toUpperCase();
    const k = mine.findIndex((h, i) => h === initial && i % W > 5 && i % W < 34 && i > 6 * W);
    await tapCell(k);
    check(await textValue() === 'M', 'monogram: the copied initial is still a word to retype', JSON.stringify(await textValue()));
    await done();
  }
  {
    const d = DATA.find(x => x.id === 'house-bar'), { grid, words } = chart(d);
    await lay('house-bar');
    await click('[data-ed-palette="Sage & Cream"]');
    await pause(400);
    const first = await board();
    await coaster(1);
    const second = await board();
    check(diff(first, norm(grid)) > 500 && diff(first, second) === 0, 'house-bar: a palette re-dresses all four coasters alike');
    await tapCell(words[1][0]);
    check(await textValue() === 'BAR', 'house-bar: words stay editable after the palette', JSON.stringify(await textValue()));
    await done();
    await page.screenshot({ path: 'tools/_shot-xs-starter-house-bar-sage.png' });
  }

  // ── Bookmarks: a retyped title stays left-aligned with the list ──
  {
    const d = DATA.find(x => x.id === 'book-club-receipt'), { grid, words } = chart(d);
    await lay('book-club-receipt');
    const ink = d.colors[d.texts[3].role].toUpperCase();
    await tapCell(words[3][0]);
    await typeInBox('IT');
    await done();
    const g = await board();
    const title = inkBox(g, ink, 32, 37);
    check(title.l === 3, 'book-club-receipt: a retyped title stays left-aligned', `starts at ${title.l}`);
    await undo();
    check(diff(await board(), norm(grid)) === 0, 'book-club-receipt: undo puts the title back');
    await page.screenshot({ path: 'tools/_shot-xs-starter-receipt-retyped.png' });
  }

  // ── Medium Hoop: the quote and the ingredients keep their alignment ──
  {
    const d = DATA.find(x => x.id === 'quote-sampler'), { grid, words } = chart(d);
    await lay('quote-sampler');
    const ink = d.colors[d.texts[0].role].toUpperCase();
    const inside = g => g.map((h, k) => (k % W > 23 && k % W < 96 ? h : null));
    const before = inkBox(inside(await board()), ink, 31, 48);
    await tapCell(words[0][0]);
    await typeInBox('HOME IS\nWHERE WE ARE');
    await done();
    const after = inkBox(inside(await board()), ink, 31, 48);
    check(Math.abs(after.mid - before.mid) <= 1, 'quote-sampler: a retyped quote stays centered', `${before.l}–${before.r} → ${after.l}–${after.r}`);
    await page.screenshot({ path: 'tools/_shot-xs-starter-quote-retyped.png' });
    await undo();
    check(diff(await board(), norm(grid)) === 0, 'quote-sampler: undo puts the quote back');
  }
  {
    const d = DATA.find(x => x.id === 'recipe-card'), { grid, words } = chart(d);
    await lay('recipe-card');
    const ink = d.colors[d.texts[4].role].toUpperCase();
    await tapCell(words[4][0]);
    await typeInBox('2 CARROTS');
    await done();
    const line = inkBox(await board(), ink, 65, 71);
    check(line.l === 21, 'recipe-card: a retyped ingredient stays left-aligned', `starts at ${line.l}`);
    await page.screenshot({ path: 'tools/_shot-xs-starter-recipe-retyped.png' });
    await undo();
    check(diff(await board(), norm(grid)) === 0, 'recipe-card: undo puts the ingredient back');
  }
  {
    const d = DATA.find(x => x.id === 'polaroid'), { grid, words } = chart(d);
    await lay('polaroid');
    await click('[data-ed-palette="Lilac & Sage"]');
    await pause(400);
    const g = await board();
    const caption = g[words[0][0]], frame = g[20 * W + 60];
    check(diff(g, norm(grid)) > 1000 && caption && frame && caption !== frame, 'polaroid: Lilac & Sage re-dresses it and the caption still stands off the frame', `${caption} on ${frame}`);
    await tapCell(words[0][0]);
    check(await textValue() === "summer '26", 'polaroid: the caption stays editable after the palette', JSON.stringify(await textValue()));
    await done();
    await page.screenshot({ path: 'tools/_shot-xs-starter-polaroid-lilac.png' });
  }

  // ── A starter the next size doesn't offer clears rather than crops ──
  {
    await lay('drop-cap');
    await click('.ed-guide .btn:not(.btn-dark)');
    await pause(300);
    await click('.ed-guide .btn:not(.btn-dark)');
    await pause(300);
    await click('[data-ed-size="Medium Hoop"]');
    await pause(300);
    const msg = await toast();
    const stitched = (await board(120, 120)).some(Boolean);
    check(!stitched && /made for Small Hoop/.test(msg), 'drop-cap: switching to Medium Hoop leaves a blank board', msg);
    await pause(900);
    const offered = await page.evaluate(() => [...document.querySelectorAll('[data-ed-template]')].map(e => e.dataset.edTemplate));
    check(!offered.includes('drop-cap') && offered.includes('quote-sampler'), 'Medium Hoop offers its own charts', offered.join());
  }

  // ── Phone ──
  {
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const d = DATA.find(x => x.id === 'text-thread'), { grid, words } = chart(d);
    await lay('text-thread');
    check(diff(await board(), norm(grid)) === 0, 'phone: text-thread lays as charted');
    await page.screenshot({ path: 'tools/_shot-xs-starter-phone.png' });
    for (let i = 0; i < 3; i++) { await click('[data-ed-guide-next]'); await pause(400); }
    const r = await page.evaluate(() => { const b = document.querySelector('.xs-canvas').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
    const k = words[1][Math.floor(words[1].length / 2)];
    await page.touchscreen.tap(r.x + ((k % W) + 0.5) * r.w / W, r.y + (Math.floor(k / W) + 0.5) * r.h / H);
    await pause(400);
    const st = await page.evaluate(() => ({ v: document.querySelector('.xs-textbox-input')?.value, over: !!document.querySelector('.xs-textmenu-warn') }));
    check(st.v === 'MISS YOU\nMORE' && !st.over, 'phone: a tap opens the sent message for retyping', JSON.stringify(st));
    await page.screenshot({ path: 'tools/_shot-xs-starter-phone-edit.png' });
  }
  {
    const d = DATA.find(x => x.id === 'house-bar'), { grid, words } = chart(d);
    await lay('house-bar');
    check(diff(await board(), norm(grid)) === 0, 'phone: house-bar lays as charted');
    await page.screenshot({ path: 'tools/_shot-xs-starter-phone-coaster.png' });
    for (let i = 0; i < 3; i++) { await click('[data-ed-guide-next]'); await pause(400); }
    const r = await page.evaluate(() => { const b = document.querySelector('.xs-canvas').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
    const k = words[0][Math.floor(words[0].length / 2)];
    await page.touchscreen.tap(r.x + ((k % W) + 0.5) * r.w / W, r.y + (Math.floor(k / W) + 0.5) * r.h / H);
    await pause(400);
    const st = await page.evaluate(() => ({ v: document.querySelector('.xs-textbox-input')?.value, over: !!document.querySelector('.xs-textmenu-warn') }));
    check(st.v === 'NOLAN' && !st.over, 'phone: a tap on a coaster opens its name for retyping', JSON.stringify(st));
    await page.screenshot({ path: 'tools/_shot-xs-starter-phone-coaster-edit.png' });
  }
  {
    const d = DATA.find(x => x.id === 'ticket-stub'), { grid, words } = chart(d);
    await lay('ticket-stub');
    check(diff(await board(), norm(grid)) === 0, 'phone: ticket-stub lays as charted');
    await page.screenshot({ path: 'tools/_shot-xs-starter-phone-bookmark.png' });
    for (let i = 0; i < 3; i++) { await click('[data-ed-guide-next]'); await pause(400); }
    const r = await page.evaluate(() => { const b = document.querySelector('.xs-canvas').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
    const k = words[3][Math.floor(words[3].length / 2)];
    await page.touchscreen.tap(r.x + ((k % W) + 0.5) * r.w / W, r.y + (Math.floor(k / W) + 0.5) * r.h / H);
    await pause(400);
    const st = await page.evaluate(() => ({ v: document.querySelector('.xs-textbox-input')?.value, over: !!document.querySelector('.xs-textmenu-warn') }));
    check(st.v === '14' && !st.over, 'phone: a tap on the bookmark opens the day for retyping', JSON.stringify(st));
    await page.screenshot({ path: 'tools/_shot-xs-starter-phone-bookmark-edit.png' });
  }
  {
    const d = DATA.find(x => x.id === 'recipe-card'), { grid, words } = chart(d);
    await lay('recipe-card');
    check(diff(await board(), norm(grid)) === 0, 'phone: recipe-card lays as charted');
    await page.screenshot({ path: 'tools/_shot-xs-starter-phone-medium.png' });
    for (let i = 0; i < 3; i++) { await click('[data-ed-guide-next]'); await pause(400); }
    const r = await page.evaluate(() => { const b = document.querySelector('.xs-canvas').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
    const k = words[1][Math.floor(words[1].length / 2)];
    await page.touchscreen.tap(r.x + ((k % W) + 0.5) * r.w / W, r.y + (Math.floor(k / W) + 0.5) * r.h / H);
    await pause(400);
    const st = await page.evaluate(() => ({ v: document.querySelector('.xs-textbox-input')?.value, over: !!document.querySelector('.xs-textmenu-warn') }));
    check(st.v === 'NONNA ROSE' && !st.over, 'phone: a tap on the recipe card opens the name for retyping', JSON.stringify(st));
    await page.screenshot({ path: 'tools/_shot-xs-starter-phone-medium-edit.png' });
  }
} finally {
  if (errors.length) console.log('page errors:\n  ' + errors.join('\n  '));
  await close();
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
