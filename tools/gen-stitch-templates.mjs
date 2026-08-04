// One-time authoring script: converts the curated inspiration images in
// assets/stitch-templates/ into compact cross-stitch chart data that gets
// pasted into index.html (const STITCH_TEMPLATE_DATA).
//
// For each design it: cover-fits + box-samples the image down to a canonical
// grid, auto-detects the background color from the image corners and drops
// near-background cells (→ empty), snaps every kept cell to the nearest DMC
// floss (same Euclidean match the app uses), then quantizes to a small palette.
//
// It also writes a scaled-up preview PNG per design to tools/_preview/ so the
// conversion can be eyeballed before embedding.
//
//   node tools/gen-stitch-templates.mjs
//
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const IMG_DIR = path.join(ROOT, 'assets', 'stitch-templates');
const PREVIEW_DIR = path.join(__dirname, '_preview');
const OUT_JS = path.join(ROOT, 'assets', 'stitch-templates-data.js');

// ── Pull the DMC floss list straight out of index.html so we snap to the exact
// same palette the app ships with. ──────────────────────────────────────────
function loadDMC() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const m = html.match(/const DMC_ENC = "([^"]*)"/);
  if (!m) throw new Error('DMC_ENC not found in index.html');
  return m[1].split('|').map(s => {
    const [code, name, hex] = s.split('~');
    return { code, name, hex: '#' + hex, r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) };
  });
}
const DMC = loadDMC();
function nearestDMC(r, g, b) {
  let best = null, bd = Infinity;
  for (const c of DMC) { const d = (r - c.r) ** 2 + (g - c.g) ** 2 + (b - c.b) ** 2; if (d < bd) { bd = d; best = c; } }
  return best;
}

// ── Per-design conversion config. `w`/`h` = canonical grid the chart is baked
// at (build() in-app nearest-neighbour resamples it to each preset size).
// `bgTol` = RGB distance from the auto-detected corner background under which a
// cell is treated as empty. `colors` = max palette size after quantization. ──
const DESIGNS = [
  { file: 'alien.png',        id: 'alien',        name: 'Little Alien',      desc: 'A friendly space visitor.',        presets: ['Coaster Set', 'Small Hoop'],              w: 70,  h: 70,  bgTol: 60, colors: 8 },
  { file: 'ufo.png',          id: 'ufo',          name: 'Flying Saucer',     desc: 'A beaming little UFO.',            presets: ['Coaster Set', 'Small Hoop'],              w: 70,  h: 70,  bgTol: 60, colors: 8 },
  { file: 'moth.png',         id: 'moth',         name: 'Celestial Moth',    desc: 'A moon-phase moth motif.',         presets: ['Coaster Set', 'Small Hoop', 'Medium Hoop'], w: 104, h: 104, bgTol: 46, colors: 14 },
  { file: 'heart.png',        id: 'heart',        name: 'Floral Heart',      desc: 'Wildflowers in a heart.',          presets: ['Coaster Set', 'Small Hoop', 'Medium Hoop'], w: 104, h: 104, bgTol: 40, colors: 16 },
  { file: 'bouquet.png',      id: 'bouquet',      name: 'Flower Bouquet',    desc: 'A vase of summer blooms.',         presets: ['Small Hoop', 'Medium Hoop'],              w: 104, h: 104, bgTol: 52, colors: 14 },
  { file: 'alphabet.png',     id: 'alphabet',     name: 'Alphabet Sampler',  desc: 'A classic bordered ABC sampler.',  presets: ['Medium Hoop'],                            w: 112, h: 112, bgTol: 60, colors: 6 },
  { file: 'folk-flowers.png', id: 'folk-flowers', name: 'Folk Flowers',      desc: 'Three stacked wildflowers.',       presets: ['Bookmark'],                               w: 30,  h: 120, bgTol: 55, colors: 10 },
  { file: 'folk-band.png',    id: 'folk-band',    name: 'Folk Band',         desc: 'A woven red folk border.',         presets: ['Bookmark'],                               w: 30,  h: 120, bgTol: 60, colors: 3 },
  { file: 'rose-vine.png',    id: 'rose-vine',    name: 'Rose Vine',         desc: 'A climbing rose border.',          presets: ['Bookmark'],                               w: 30,  h: 120, bgTol: 60, colors: 5 },
  { file: 'pink-geo.png',     id: 'pink-geo',     name: 'Pink Geometric',    desc: 'A geometric floral band.',         presets: ['Bookmark'],                               w: 30,  h: 120, bgTol: 60, colors: 5 },
];

function readPNG(file) {
  const buf = fs.readFileSync(path.join(IMG_DIR, file));
  return PNG.sync.read(buf);
}

// Cover-fit + box-average an image region into a W×H grid of {r,g,b} (or null
// for cells that are dropped as background).
function sampleGrid(png, W, H, bgTol) {
  const { width: iw, height: ih, data } = png;
  const scale = Math.max(W / iw, H / ih);
  const sw = W / scale, sh = H / scale;      // source window (cover crop)
  const sx0 = (iw - sw) / 2, sy0 = (ih - sh) / 2;
  const at = (x, y) => { const i = (y * iw + x) * 4; return [data[i], data[i + 1], data[i + 2], data[i + 3]]; };

  // Background = median-ish average of the four image corners.
  const corner = (cx, cy) => { let r = 0, g = 0, b = 0, n = 0; const s = Math.max(2, Math.round(Math.min(iw, ih) * 0.04));
    for (let y = cy; y < cy + s; y++) for (let x = cx; x < cx + s; x++) { const [pr, pg, pb, pa] = at(x, y); if (pa < 40) continue; r += pr; g += pg; b += pb; n++; } return n ? [r / n, g / n, b / n] : null; };
  const corners = [corner(0, 0), corner(iw - Math.round(iw * 0.04) - 1, 0), corner(0, ih - Math.round(ih * 0.04) - 1), corner(iw - Math.round(iw * 0.04) - 1, ih - Math.round(ih * 0.04) - 1)].filter(Boolean);
  const bg = corners.length ? [corners.reduce((a, c) => a + c[0], 0) / corners.length, corners.reduce((a, c) => a + c[1], 0) / corners.length, corners.reduce((a, c) => a + c[2], 0) / corners.length] : [255, 255, 255];

  const grid = new Array(W * H).fill(null);
  for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) {
    const rx0 = Math.floor(sx0 + (tx / W) * sw), rx1 = Math.max(rx0 + 1, Math.floor(sx0 + ((tx + 1) / W) * sw));
    const ry0 = Math.floor(sy0 + (ty / H) * sh), ry1 = Math.max(ry0 + 1, Math.floor(sy0 + ((ty + 1) / H) * sh));
    let r = 0, g = 0, b = 0, n = 0, bgHits = 0, tot = 0;
    for (let y = ry0; y < ry1; y++) for (let x = rx0; x < rx1; x++) {
      if (x < 0 || y < 0 || x >= iw || y >= ih) continue;
      const [pr, pg, pb, pa] = at(x, y); if (pa < 40) continue;
      tot++;
      const db = (pr - bg[0]) ** 2 + (pg - bg[1]) ** 2 + (pb - bg[2]) ** 2;
      if (db < bgTol * bgTol) { bgHits++; continue; }   // background pixel — skip from average
      r += pr; g += pg; b += pb; n++;
    }
    // Cell is background if most of its pixels matched the background.
    if (!n || bgHits > tot * 0.55) { grid[ty * W + tx] = null; continue; }
    grid[ty * W + tx] = { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
  }
  return grid;
}

// Snap → DMC, count usage, keep the top `maxColors`, remap the rest to the
// nearest kept floss. Returns { colors:[hex...], idx:Int (0=empty else 1-based) }.
function quantize(grid, maxColors) {
  const snapped = grid.map(c => c ? nearestDMC(c.r, c.g, c.b) : null);
  const freq = new Map();
  for (const c of snapped) if (c) freq.set(c.code, (freq.get(c.code) || 0) + 1);
  const keep = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxColors).map(([code]) => code);
  const keepSet = new Set(keep);
  const keepList = keep.map(code => DMC.find(d => d.code === code));
  const remap = new Map();
  const resolve = (c) => {
    if (keepSet.has(c.code)) return c.code;
    if (remap.has(c.code)) return remap.get(c.code);
    let best = null, bd = Infinity;
    for (const k of keepList) { const d = (c.r - k.r) ** 2 + (c.g - k.g) ** 2 + (c.b - k.b) ** 2; if (d < bd) { bd = d; best = k; } }
    remap.set(c.code, best.code); return best.code;
  };
  const colorHex = keep.map(code => DMC.find(d => d.code === code).hex);
  const colorIndex = new Map(keep.map((code, i) => [code, i + 1]));
  const idx = snapped.map(c => c ? colorIndex.get(resolve(c)) : 0);
  return { colors: colorHex, idx };
}

// Drop isolated single-cell specks (a kept cell whose 4-neighbours are all
// empty) — trims anti-alias noise so the chart reads cleanly.
function despeckle(idx, W, H) {
  const out = idx.slice();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (!idx[i]) continue;
    let neigh = 0;
    if (x > 0 && idx[i - 1]) neigh++;
    if (x < W - 1 && idx[i + 1]) neigh++;
    if (y > 0 && idx[i - W]) neigh++;
    if (y < H - 1 && idx[i + W]) neigh++;
    if (neigh === 0) out[i] = 0;
  }
  return out;
}

function toRLE(idx) {
  const toks = []; let run = 1;
  for (let i = 1; i <= idx.length; i++) {
    if (i < idx.length && idx[i] === idx[i - 1]) { run++; continue; }
    toks.push(idx[i - 1].toString(36) + '.' + run.toString(36)); run = 1;
  }
  return toks.join(' ');
}

function writePreview(id, colors, idx, W, H) {
  const S = Math.max(3, Math.round(360 / Math.max(W, H)));
  const png = new PNG({ width: W * S, height: H * S });
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = idx[y * W + x];
    let r = 235, g = 232, b = 226;                 // empty = soft aida
    if (v) { const h = colors[v - 1]; r = parseInt(h.slice(1, 3), 16); g = parseInt(h.slice(3, 5), 16); b = parseInt(h.slice(5, 7), 16); }
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const px = ((y * S + sy) * W * S + (x * S + sx)) * 4;
      png.data[px] = r; png.data[px + 1] = g; png.data[px + 2] = b; png.data[px + 3] = 255;
    }
  }
  fs.mkdirSync(PREVIEW_DIR, { recursive: true });
  fs.writeFileSync(path.join(PREVIEW_DIR, id + '.png'), PNG.sync.write(png));
}

const out = [];
for (const d of DESIGNS) {
  const png = readPNG(d.file);
  const grid = sampleGrid(png, d.w, d.h, d.bgTol);
  const { colors, idx } = quantize(grid, d.colors);
  const clean = despeckle(idx, d.w, d.h);
  const rle = toRLE(clean);
  const used = new Set(clean); const fill = clean.filter(Boolean).length;
  writePreview(d.id, colors, clean, d.w, d.h);
  out.push({ id: d.id, name: d.name, desc: d.desc, presets: d.presets, w: d.w, h: d.h, colors, rle });
  console.log(`${d.id.padEnd(14)} ${d.w}x${d.h}  colors=${colors.length}  fill=${(100 * fill / (d.w * d.h)).toFixed(0)}%  rleBytes=${rle.length}`);
}

const banner = '// AUTO-GENERATED by tools/gen-stitch-templates.mjs — do not hand-edit.\n'
  + '// Regenerate: node tools/gen-stitch-templates.mjs (reads assets/stitch-templates/*.png).\n'
  + '// Each entry is a canonical cross-stitch chart: { id, name, desc, presets, w, h,\n'
  + '//   colors:[hex...], rle } where rle tokens are "<idxB36>.<runB36>" and idx 0 = empty.\n';
fs.writeFileSync(OUT_JS, banner + 'window.STITCH_TEMPLATE_DATA = ' + JSON.stringify(out) + ';\n');
console.log('\nWrote', path.relative(ROOT, OUT_JS), '(' + fs.statSync(OUT_JS).size + ' bytes)');
console.log('Previews in', path.relative(ROOT, PREVIEW_DIR));
