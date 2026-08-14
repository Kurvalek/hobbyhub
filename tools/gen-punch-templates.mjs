// One-time authoring script: builds the punch needle chart data consumed by
// index.html (window.PUNCH_TEMPLATE_DATA) into assets/punch-templates-data.js.
//
// Parallel to tools/gen-stitch-templates.mjs, with two differences that follow
// from the craft:
//   • cells snap to DMC Laine Colbert tapestry wool (assets/tapestry-wool.js)
//     rather than six-strand floss;
//   • the designs are far bolder. Punch needle runs about 5 loops to the inch,
//     so a whole piece is 20-70 loops across where a cross-stitch chart is
//     hundreds. Fine detail simply cannot survive, so every shape here is big,
//     high-contrast and readable at a glance.
//
// Every chart is stitched edge to edge on a colored ground: the picker previews
// each one on a white card, so a bare or near-white ground would stop reading
// as a finished piece. One ground per design, spread light to dark.
//
//   node tools/gen-punch-templates.mjs
//
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PREVIEW_DIR = path.join(__dirname, '_preview-punch');
const OUT_JS = path.join(ROOT, 'assets', 'punch-templates-data.js');

// ── Snap to the exact wool list the app ships with ─────────────────────────
function loadWool() {
  const js = fs.readFileSync(path.join(ROOT, 'assets', 'tapestry-wool.js'), 'utf8');
  const m = js.match(/window\.TAPESTRY_WOOL = "([^"]*)"/);
  if (!m) throw new Error('TAPESTRY_WOOL not found — run tools/gen-tapestry-wool.mjs first');
  return m[1].split('|').filter(Boolean).map(s => {
    const [code, name, hex] = s.split('~');
    return { code, name, hex: '#' + hex, r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) };
  });
}
const WOOL = loadWool();
function nearestWool(r, g, b) {
  let best = null, bd = Infinity;
  for (const c of WOOL) { const d = (r - c.r) ** 2 + (g - c.g) ** 2 + (b - c.b) ** 2; if (d < bd) { bd = d; best = c; } }
  return best;
}

// ── Drawing canvas ─────────────────────────────────────────────────────────
function Canvas(W, H) {
  const cells = new Array(W * H).fill(null);
  const put = (x, y, hex) => {
    const ix = Math.round(x), iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= W || iy >= H) return;
    cells[iy * W + ix] = hex;
  };
  const cv = {
    W, H, cells, put,
    fill(hex) { cells.fill(hex); return cv; },
    rect(x, y, w, h, hex) {
      for (let j = Math.round(y); j < Math.round(y) + h; j++)
        for (let i = Math.round(x); i < Math.round(x) + w; i++) put(i, j, hex);
      return cv;
    },
    frame(t, hex) {
      cv.rect(0, 0, W, t, hex); cv.rect(0, H - t, W, t, hex);
      cv.rect(0, 0, t, H, hex); cv.rect(W - t, 0, t, H, hex);
      return cv;
    },
    ellipse(cx, cy, rx, ry, hex, rot = 0) {
      const a = (rot * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
      const reach = Math.ceil(Math.max(rx, ry)) + 1;
      for (let y = Math.round(cy) - reach; y <= Math.round(cy) + reach; y++) {
        for (let x = Math.round(cx) - reach; x <= Math.round(cx) + reach; x++) {
          const dx = x - cx, dy = y - cy;
          const u = dx * cos + dy * sin, v = -dx * sin + dy * cos;
          if ((u / rx) ** 2 + (v / ry) ** 2 <= 1.02) put(x, y, hex);
        }
      }
      return cv;
    },
    // Ring: everything between the inner and outer radius.
    ring(cx, cy, rOuter, rInner, hex) {
      const reach = Math.ceil(rOuter) + 1;
      for (let y = Math.round(cy) - reach; y <= Math.round(cy) + reach; y++) {
        for (let x = Math.round(cx) - reach; x <= Math.round(cx) + reach; x++) {
          const d = Math.hypot(x - cx, y - cy);
          if (d <= rOuter + 0.2 && d >= rInner - 0.2) put(x, y, hex);
        }
      }
      return cv;
    },
    capsule(x0, y0, x1, y1, r0, r1, hex) {
      const dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy;
      const rMax = Math.max(r0, r1);
      const xa = Math.floor(Math.min(x0, x1) - rMax - 1), xb = Math.ceil(Math.max(x0, x1) + rMax + 1);
      const ya = Math.floor(Math.min(y0, y1) - rMax - 1), yb = Math.ceil(Math.max(y0, y1) + rMax + 1);
      for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
        const t = len2 ? Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / len2)) : 0;
        const px = x0 + dx * t, py = y0 + dy * t, r = r0 + (r1 - r0) * t;
        if ((x - px) ** 2 + (y - py) ** 2 <= r * r + 0.25) put(x, y, hex);
      }
      return cv;
    },
    tri(x0, y0, x1, y1, x2, y2, hex) {
      const xa = Math.floor(Math.min(x0, x1, x2)), xb = Math.ceil(Math.max(x0, x1, x2));
      const ya = Math.floor(Math.min(y0, y1, y2)), yb = Math.ceil(Math.max(y0, y1, y2));
      const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
      if (!area) return cv;
      for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
        const w0 = ((x1 - x) * (y2 - y) - (x2 - x) * (y1 - y)) / area;
        const w1 = ((x2 - x) * (y0 - y) - (x0 - x) * (y2 - y)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 >= -0.02 && w1 >= -0.02 && w2 >= -0.02) put(x, y, hex);
      }
      return cv;
    },
    ray(x, y, angle, len, r0, r1, hex) {
      const a = (angle * Math.PI) / 180;
      return cv.capsule(x, y, x + Math.sin(a) * len, y - Math.cos(a) * len, r0, r1, hex);
    },
    // Horizontal band whose centre line rides a sine wave — the stripes and
    // the hill crests are both this.
    wave(yMid, amp, period, thick, hex, phase = 0) {
      for (let x = 0; x < W; x++) {
        const y = yMid + Math.sin((x / period) * Math.PI * 2 + phase) * amp;
        for (let t = -thick / 2; t <= thick / 2; t += 0.5) put(x, y + t, hex);
      }
      return cv;
    },
    // Everything below the sine crest, to the bottom edge — a solid hill.
    hill(yMid, amp, period, hex, phase = 0) {
      for (let x = 0; x < W; x++) {
        const y = yMid + Math.sin((x / period) * Math.PI * 2 + phase) * amp;
        for (let j = Math.round(y); j < H; j++) put(x, j, hex);
      }
      return cv;
    },
  };
  return cv;
}

// metime brand tokens, same set the cross-stitch charts draw from. Each snaps
// to its nearest tapestry wool during quantization, so the studio palette and
// yarn list still come out as real, orderable colors.
const BRAND = {
  linen:  '#D5D1BD',
  cream:  '#F5F3EE',
  ice:    '#CCD6EB',
  slate:  '#707F87',
  ink:    '#120F06',
  tomato: '#E8583A',
  coral:  '#FDA198',
  golden: '#FBBB3F',
  olive:  '#B5BB46',
};

// ── The four charts ────────────────────────────────────────────────────────

// Square 1 — a sunburst. Rays alternate warm and cool so the wheel still reads
// once it is resampled down to a 20-loop coaster.
function drawSunburst(cv) {
  const cx = (cv.W - 1) / 2, cy = (cv.H - 1) / 2;
  cv.fill(BRAND.ice);
  cv.frame(2, BRAND.slate);
  const R = Math.min(cx, cy) - 3.5;
  for (let i = 0; i < 12; i++) {
    const a = i * 30;
    cv.ray(cx, cy, a, R, 3.1, 1.3, i % 2 ? BRAND.tomato : BRAND.golden);
  }
  cv.ellipse(cx, cy, R * 0.42, R * 0.42, BRAND.ink);
  cv.ellipse(cx, cy, R * 0.26, R * 0.26, BRAND.coral);
}

// Square 2 — undulating stripes. No motif to lose, so it survives any size and
// gives the palette step something that shows off all six colors at once.
function drawWavyStripes(cv) {
  cv.fill(BRAND.linen);
  const bands = [BRAND.tomato, BRAND.golden, BRAND.olive, BRAND.slate, BRAND.ink];
  const step = cv.H / (bands.length + 1);
  bands.forEach((hex, i) => {
    cv.wave(step * (i + 1), 2.4, cv.W * 0.82, step * 0.62, hex, i * 0.9);
  });
}

// Portrait 1 — a landscape: sun over three overlapping hills. Big flat areas
// are exactly what punch needle is good at.
function drawRollingHills(cv) {
  cv.fill(BRAND.ice);
  cv.ellipse(cv.W * 0.70, cv.H * 0.22, cv.W * 0.15, cv.W * 0.15, BRAND.golden);
  cv.hill(cv.H * 0.52, 3.0, cv.W * 1.15, BRAND.olive, 0.4);
  cv.hill(cv.H * 0.68, 2.6, cv.W * 0.95, BRAND.slate, 2.2);
  cv.hill(cv.H * 0.84, 2.0, cv.W * 1.30, BRAND.ink, 4.0);
  // Dark frame, not the cream one this started as: the picker draws every card
  // on white, and a near-white border simply disappeared into it.
  cv.frame(2, BRAND.ink);
}

// Portrait 2 — one oversized bloom. A single flower head is the most forgiving
// motif at this gauge: the petals stay legible even at 30 loops wide.
function drawBigBloom(cv) {
  const cx = (cv.W - 1) / 2;
  cv.fill(BRAND.slate);
  cv.frame(2, BRAND.ink);
  const cy = cv.H * 0.38, R = cv.W * 0.30;
  // Stem and leaves first, so the petals overlap them.
  cv.capsule(cx, cy, cx, cv.H - 4, 1.4, 1.4, BRAND.olive);
  cv.ellipse(cx - R * 0.72, cv.H * 0.68, R * 0.50, R * 0.24, BRAND.olive, -32);
  cv.ellipse(cx + R * 0.72, cv.H * 0.80, R * 0.50, R * 0.24, BRAND.olive, 32);
  for (let i = 0; i < 8; i++) {
    const a = (i * 45) * Math.PI / 180;
    cv.ellipse(cx + Math.sin(a) * R * 0.82, cy - Math.cos(a) * R * 0.82,
      R * 0.44, R * 0.30, i % 2 ? BRAND.coral : BRAND.tomato, i * 45);
  }
  cv.ellipse(cx, cy, R * 0.42, R * 0.42, BRAND.golden);
  cv.ellipse(cx, cy, R * 0.18, R * 0.18, BRAND.ink);
}

const SQUARE = ['Coaster', 'Small Hoop', 'Pillow'];
const PORTRAIT = ['Wall Hanging'];
const DESIGNS = [
  { id: 'pn-sunburst', name: 'Sunburst', desc: 'Radiating rays around a bold centre.',
    presets: SQUARE, w: 40, h: 40, colors: 6, draw: drawSunburst },
  { id: 'pn-waves', name: 'Wavy Stripes', desc: 'Five rolling bands of color.',
    presets: SQUARE, w: 40, h: 40, colors: 6, draw: drawWavyStripes },
  { id: 'pn-hills', name: 'Rolling Hills', desc: 'A low sun over layered hills.',
    presets: PORTRAIT, w: 40, h: 50, colors: 6, draw: drawRollingHills },
  { id: 'pn-bloom', name: 'Big Bloom', desc: 'One oversized flower, stem and leaves.',
    presets: PORTRAIT, w: 40, h: 50, colors: 6, draw: drawBigBloom },
];

// ── Quantize + encode (mirrors the cross-stitch generator) ─────────────────
function quantize(grid, maxColors) {
  const snapped = grid.map(c => c ? nearestWool(c.r, c.g, c.b) : null);
  const freq = new Map();
  for (const c of snapped) if (c) freq.set(c.code, (freq.get(c.code) || 0) + 1);
  const keep = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxColors).map(([code]) => code);
  const keepSet = new Set(keep);
  const keepList = keep.map(code => WOOL.find(d => d.code === code));
  const remap = new Map();
  const resolve = (c) => {
    if (keepSet.has(c.code)) return c.code;
    if (remap.has(c.code)) return remap.get(c.code);
    let best = null, bd = Infinity;
    for (const k of keepList) { const d = (c.r - k.r) ** 2 + (c.g - k.g) ** 2 + (c.b - k.b) ** 2; if (d < bd) { bd = d; best = k; } }
    remap.set(c.code, best.code); return best.code;
  };
  const colorHex = keep.map(code => WOOL.find(d => d.code === code).hex);
  const colorIndex = new Map(keep.map((code, i) => [code, i + 1]));
  const idx = snapped.map(c => c ? colorIndex.get(resolve(c)) : 0);
  return { colors: colorHex, idx, names: keep.map(code => WOOL.find(d => d.code === code)) };
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
    let r = 228, g = 217, b = 195;                 // empty = monk's cloth
    if (v) { const h = colors[v - 1]; r = parseInt(h.slice(1, 3), 16); g = parseInt(h.slice(3, 5), 16); b = parseInt(h.slice(5, 7), 16); }
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const px = ((y * S + sy) * W * S + (x * S + sx)) * 4;
      png.data[px] = r; png.data[px + 1] = g; png.data[px + 2] = b; png.data[px + 3] = 255;
    }
  }
  fs.mkdirSync(PREVIEW_DIR, { recursive: true });
  fs.writeFileSync(path.join(PREVIEW_DIR, id + '.png'), PNG.sync.write(png));
}

function drawnGrid(d) {
  const cv = Canvas(d.w, d.h);
  d.draw(cv);
  return cv.cells.map(hex => hex
    ? { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) }
    : null);
}

const out = [];
for (const d of DESIGNS) {
  const { colors, idx, names } = quantize(drawnGrid(d), d.colors);
  const rle = toRLE(idx);
  const fill = idx.filter(Boolean).length;
  writePreview(d.id, colors, idx, d.w, d.h);
  out.push({ id: d.id, name: d.name, desc: d.desc, presets: d.presets, w: d.w, h: d.h, colors, rle });
  console.log(`${d.id.padEnd(12)} ${d.w}x${d.h}  colors=${colors.length}  fill=${(100 * fill / (d.w * d.h)).toFixed(0)}%  rleBytes=${rle.length}`);
  console.log(`             ${names.map(n => `${n.code} ${n.hex}`).join('  ')}`);
}

const banner = '// AUTO-GENERATED by tools/gen-punch-templates.mjs — do not hand-edit.\n'
  + '// Regenerate: node tools/gen-punch-templates.mjs\n'
  + '// Each entry is a canonical punch needle chart: { id, name, desc, presets, w, h,\n'
  + '//   colors:[hex...], rle } where rle tokens are "<idxB36>.<runB36>" and idx 0 = empty.\n'
  + '// Colors are DMC Laine Colbert tapestry wool (see assets/tapestry-wool.js).\n';
fs.writeFileSync(OUT_JS, banner + 'window.PUNCH_TEMPLATE_DATA = ' + JSON.stringify(out) + ';\n');
console.log('\nWrote', path.relative(ROOT, OUT_JS), '(' + fs.statSync(OUT_JS).size + ' bytes)');
console.log('Previews in', path.relative(ROOT, PREVIEW_DIR));
