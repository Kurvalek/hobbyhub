// Scratch: render words through the studio's own text rasterizer in headless
// Chrome, thicken the script face to a weight that can actually be punched, and
// print JS-ready pixel-art literals to paste into gen-punch-templates.mjs.
//
// Baking rather than rasterizing at build time keeps the generator pure Node,
// and still gets the real brand faces instead of hand-drawn letters.
//
//   node tools/_rasterize-lettering.mjs
//
import { open } from './_verify.mjs';

const { page, errors, close } = await open();

await page.evaluate(() => document.fonts.ready);
await page.evaluate(() => Promise.all([
  document.fonts.load('600 20px "Söhne"'),
  document.fonts.load('700 30px "Dancing Script"'),
]));

const res = await page.evaluate(() => {
  // Trim to the inked bounding box and return rows of '#'/'.'.
  function toRows(cells) {
    const xs = cells.map(c => c[0]), ys = cells.map(c => c[1]);
    const x0 = Math.min(...xs), y0 = Math.min(...ys);
    const w = Math.max(...xs) - x0 + 1, h = Math.max(...ys) - y0 + 1;
    const on = new Set(cells.map(c => `${c[0] - x0},${c[1] - y0}`));
    const rows = [];
    for (let y = 0; y < h; y++) {
      let s = '';
      for (let x = 0; x < w; x++) s += on.has(`${x},${y}`) ? '#' : '.';
      rows.push(s);
    }
    return rows;
  }
  // Grow one loop down and right. Dancing Script keeps its calligraphic
  // thick/thin contrast at every size, so the thin strokes land as single loops
  // however large the text is set, and a single loop of wool reads as a gap
  // rather than a line. Set the script large enough and this uniform thickening
  // lifts every stroke to two loops without the letters touching.
  function dilate(rows) {
    const h = rows.length, w = rows[0].length;
    const out = [];
    for (let y = 0; y < h + 1; y++) {
      let s = '';
      for (let x = 0; x < w + 1; x++) {
        const hit = (yy, xx) => yy >= 0 && yy < h && xx >= 0 && xx < w && rows[yy][xx] === '#';
        s += (hit(y, x) || hit(y - 1, x) || hit(y, x - 1)) ? '#' : '.';
      }
      out.push(s);
    }
    return out;
  }
  function stats(rows) {
    let thinnest = Infinity;
    for (const r of rows) for (const run of r.split(/\.+/)) if (run) thinnest = Math.min(thinnest, run.length);
    // Count enclosed background regions — the counters of o/b/d. If dilation
    // closes them the letters turn to blobs, so this is the thing to watch.
    const h = rows.length, w = rows[0].length;
    const seen = new Set();
    let holes = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (rows[y][x] === '#' || seen.has(`${x},${y}`)) continue;
      const q = [[x, y]]; seen.add(`${x},${y}`);
      let edge = false, n = 0;
      while (q.length) {
        const [cx, cy] = q.pop(); n++;
        if (cx === 0 || cy === 0 || cx === w - 1 || cy === h - 1) edge = true;
        for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const nx = cx + dx, ny = cy + dy, k = `${nx},${ny}`;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || seen.has(k) || rows[ny][nx] === '#') continue;
          seen.add(k); q.push([nx, ny]);
        }
      }
      if (!edge && n >= 2) holes++;
    }
    return { w: rows[0].length, h: rows.length, thinnest, holes };
  }

  // Söhne 600 at 20 already carries a two-loop minimum stroke, so the sans line
  // is taken as the face drew it. The script needs 34 to survive thickening.
  const home = toRows(window.rasterizeText('HOME', 'sans', 20));
  const body = dilate(toRows(window.rasterizeText('body', 'script', 34)));
  return { home: { rows: home, ...stats(home) }, body: { rows: body, ...stats(body) } };
});

function show(label, r) {
  console.log(`\n── ${label}: ${r.w}×${r.h}, thinnest run=${r.thinnest}, counters=${r.holes}`);
  for (const row of r.rows) console.log('   ' + row);
}
show('HOME sans 20', res.home);
show('body script 34 (thickened)', res.body);

// ── Compose on the 70×70 pillow to check the layout before baking ──────────
const W = 70, H = 70;
const hx = Math.round((W - res.home.w) / 2), hy = 9;
const bx = Math.round((W - res.body.w) / 2), by = 28;
const page70 = Array.from({ length: H }, () => new Array(W).fill('.'));
const place = (rows, ox, oy, ch) => rows.forEach((line, y) => {
  for (let x = 0; x < line.length; x++) if (line[x] === '#') {
    if (oy + y >= 0 && oy + y < H && ox + x >= 0 && ox + x < W) page70[oy + y][ox + x] = ch;
  }
});
place(res.home.rows, hx, hy, '#');
place(res.body.rows, bx, by, '#');
console.log(`\n── 70×70 pillow: HOME at (${hx},${hy}), body at (${bx},${by}) ──`);
console.log('   ' + '-'.repeat(W));
page70.forEach((row, i) => console.log(String(i).padStart(2) + '|' + row.join('')));

console.log('\n── JS literals ──');
const lit = (name, rows) => console.log(`const ${name} = [\n${rows.map(r => `  '${r}',`).join('\n')}\n];`);
lit('HOME_SANS', res.home.rows);
lit('BODY_SCRIPT', res.body.rows);
console.log(`\n// HOME at (${hx},${hy}); body at (${bx},${by})`);

console.log('\nerrors:', errors.length ? errors : 'none');
await close();
