// One-time authoring script: builds the cross-stitch chart data consumed by
// index.html (window.STITCH_TEMPLATE_DATA) into assets/stitch-templates-data.js.
//
// Charts come from one of two sources:
//   • an image in assets/stitch-templates/ (`file`) — cover-fit + box-sampled
//     down to a canonical grid, with the background auto-detected from the image
//     corners and dropped (→ empty cells);
//   • a drawing function (`draw`) — the Bookmark designs are authored here with
//     the shape primitives below so they default to the metime brand palette.
//
// Either way every kept cell is snapped to the nearest DMC floss (the same
// Euclidean match the app uses) and quantized to a small palette.
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

// ── Drawing canvas for the authored (non-photo) charts ─────────────────────
// A grid of hex-or-null cells plus the handful of primitives the bookmark
// designs need. Coordinates are cell centers; fractional inputs are fine, the
// primitives rasterize them, which is what keeps curves reading as curves at 30
// stitches wide.
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
    // Solid border frame `t` stitches thick.
    frame(t, hex) {
      cv.rect(0, 0, W, t, hex); cv.rect(0, H - t, W, t, hex);
      cv.rect(0, 0, t, H, hex); cv.rect(W - t, 0, t, H, hex);
      return cv;
    },
    // Filled ellipse, `rot` in degrees.
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
    // Tapered round-capped stroke from (x0,y0) to (x1,y1) — the workhorse for
    // petals, leaf fingers, fins and stems.
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
    // Filled triangle.
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
    // Capsule aimed by angle (degrees clockwise from straight up) + length.
    ray(x, y, angle, len, r0, r1, hex) {
      const a = (angle * Math.PI) / 180;
      return cv.capsule(x, y, x + Math.sin(a) * len, y - Math.cos(a) * len, r0, r1, hex);
    },
  };
  return cv;
}

// metime brand tokens used by the authored charts (see the :root block in
// index.html). Each snaps to its nearest DMC floss during quantization, so the
// studio palette, floss list and kit costing all still work off real flosses.
const BRAND = {
  linen:  '#E9E7D9',   // --color-linen-600  → Ecru
  cream:  '#F5F3EE',   // --metime-cream     → 3866 Mocha Brn Ult Vy Lt
  slate:  '#707F87',   // setup-card border  → 3768 Gray Green Dark
  ink:    '#120F06',   // --color-taupe-900  → 3371 Black Brown
  tomato: '#E8583A',   // --metime-tomato    → 608 Burnt Orange Bright
  coral:  '#FDA198',   // --metime-grapefruit→ 352 Coral Light
  golden: '#FBBB3F',   // --metime-golden    → 725 Topaz Med Lt
  olive:  '#B5BB46',   // --metime-avocado   → 733 Olive Green Md
};

// A cut-paper frond: short stem with tapered paddle "fingers" fanning off it.
// `fingers` entries are { a: degrees from vertical, len: fraction of size, w }.
function frond(cv, cx, cy, size, hex, fingers) {
  const baseY = cy + size * 0.40, forkY = cy + size * 0.12;
  cv.capsule(cx, baseY, cx, forkY, 1.1, 1.1, hex);
  for (const f of fingers) cv.ray(cx, forkY, f.a, size * f.len, 1.2, f.w, hex);
}

// Bookmark 1 — five cut-paper leaves stacked inside a solid border.
function drawLeafStack(cv) {
  cv.fill(BRAND.linen);
  const leaves = [
    { hex: BRAND.golden, fingers: [{ a: -62, len: .52, w: 2.1 }, { a: -30, len: .70, w: 2.3 }, { a: 0, len: .82, w: 2.5 }, { a: 30, len: .70, w: 2.3 }, { a: 62, len: .52, w: 2.1 }] },
    { hex: BRAND.slate,  fingers: [{ a: -50, len: .58, w: 2.6 }, { a: -18, len: .80, w: 2.8 }, { a: 16, len: .78, w: 2.8 }, { a: 52, len: .56, w: 2.5 }] },
    { hex: BRAND.olive,  fingers: [{ a: -38, len: .52, w: 2.3 }, { a: 0, len: .70, w: 2.5 }, { a: 38, len: .52, w: 2.3 }] },
    { hex: BRAND.ink,    fingers: [{ a: -68, len: .46, w: 1.9 }, { a: -42, len: .62, w: 2.1 }, { a: -14, len: .78, w: 2.2 }, { a: 14, len: .78, w: 2.2 }, { a: 42, len: .62, w: 2.1 }, { a: 68, len: .46, w: 1.9 }] },
    { hex: BRAND.tomato, fingers: [{ a: -54, len: .54, w: 2.4 }, { a: -20, len: .80, w: 2.6 }, { a: 16, len: .76, w: 2.6 }, { a: 50, len: .54, w: 2.4 }] },
  ];
  leaves.forEach((l, i) => frond(cv, 15, 18 + i * 21.8, 19, l.hex, l.fingers));
  cv.frame(2, BRAND.slate);
}

// Bookmark 2 — a blocky fish on still linen, nose up, tail fanning out below.
function drawLittleFish(cv) {
  cv.fill(BRAND.linen);
  const cx = 15;
  // Forked tail — two lobes sharing the center line, so the trailing edge dips
  // into a shallow notch — then the body over it so the join reads as one fish.
  cv.tri(cx, 86, cx - 11, 110, cx, 103, BRAND.ink);
  cv.tri(cx, 86, cx + 11, 110, cx, 103, BRAND.ink);
  cv.tri(cx + 8, 40, cx + 14, 50, cx + 7, 56, BRAND.ink);       // dorsal fin
  cv.tri(cx - 8, 58, cx - 14, 68, cx - 7, 72, BRAND.ink);       // pectoral fin
  cv.capsule(cx, 70, cx, 90, 6, 3.4, BRAND.slate);              // peduncle
  cv.ellipse(cx, 48, 9.2, 34, BRAND.slate);                     // body
  // Head: coral snout, one eye, a stitched mouth, a gill stroke.
  cv.ellipse(cx, 19, 4.4, 5.5, BRAND.coral);
  cv.capsule(cx, 15, cx + 2.5, 16.5, 0.6, 0.6, BRAND.ink);
  cv.ellipse(cx - 3, 26, 1.5, 1.5, BRAND.ink);
  cv.capsule(cx - 6, 31, cx - 3, 38, 0.9, 0.9, BRAND.slate);
  // Belly clouds.
  cv.ellipse(cx - 3, 44, 4.4, 6.5, BRAND.cream);
  cv.ellipse(cx, 38, 3.4, 4, BRAND.cream);
  cv.ellipse(cx + 3, 66, 4, 5.5, BRAND.cream);
  cv.ellipse(cx - 1, 70, 3, 3.6, BRAND.cream);
  // Scale spots.
  cv.ellipse(cx + 5, 36, 2.8, 2.8, BRAND.coral);
  cv.ellipse(cx - 5, 58, 2.8, 2.8, BRAND.coral);
  cv.ellipse(cx + 4, 78, 2.8, 2.8, BRAND.coral);
  cv.ellipse(cx + 5, 50, 2.6, 2.6, BRAND.tomato);
  cv.ellipse(cx - 5, 72, 2.6, 2.6, BRAND.tomato);
  cv.ellipse(cx, 86, 2.4, 2.4, BRAND.tomato);
}

// Bookmark 3 — an all-over scatter of petals and little blooms.
function drawPetalScatter(cv) {
  // { x, y, a: angle, len, w, hex } petals; blooms get a ring of five.
  const petals = [
    { x: 8,  y: 9,   a: 20,  len: 8,  w: 2.6, hex: BRAND.tomato },
    { x: 22, y: 14,  a: -35, len: 7,  w: 2.4, hex: BRAND.slate },
    { x: 13, y: 22,  a: 70,  len: 6,  w: 2.2, hex: BRAND.golden },
    { x: 25, y: 28,  a: 15,  len: 7,  w: 2.4, hex: BRAND.ink },
    { x: 6,  y: 33,  a: -25, len: 8,  w: 2.6, hex: BRAND.coral },
    { x: 17, y: 40,  a: 45,  len: 7,  w: 2.4, hex: BRAND.tomato },
    { x: 27, y: 47,  a: -60, len: 6,  w: 2.2, hex: BRAND.golden },
    { x: 5,  y: 52,  a: 30,  len: 7,  w: 2.4, hex: BRAND.slate },
    { x: 15, y: 58,  a: -15, len: 8,  w: 2.6, hex: BRAND.ink },
    { x: 25, y: 66,  a: 40,  len: 7,  w: 2.4, hex: BRAND.coral },
    { x: 7,  y: 70,  a: -50, len: 6,  w: 2.2, hex: BRAND.golden },
    { x: 16, y: 78,  a: 25,  len: 8,  w: 2.6, hex: BRAND.tomato },
    { x: 27, y: 85,  a: -20, len: 6,  w: 2.2, hex: BRAND.slate },
    { x: 6,  y: 90,  a: 55,  len: 7,  w: 2.4, hex: BRAND.ink },
    { x: 18, y: 97,  a: -40, len: 7,  w: 2.4, hex: BRAND.coral },
    { x: 26, y: 104, a: 20,  len: 6,  w: 2.2, hex: BRAND.tomato },
    { x: 8,  y: 108, a: -18, len: 8,  w: 2.6, hex: BRAND.golden },
    { x: 19, y: 114, a: 35,  len: 6,  w: 2.2, hex: BRAND.slate },
  ];
  for (const p of petals) cv.ray(p.x, p.y, p.a, p.len, 1.2, p.w, p.hex);
  const blooms = [
    { x: 9,  y: 17, hex: BRAND.golden },
    { x: 21, y: 56, hex: BRAND.coral },
    { x: 11, y: 100, hex: BRAND.tomato },
  ];
  for (const b of blooms) {
    for (let k = 0; k < 5; k++) cv.ray(b.x, b.y, k * 72, 4.6, 1.1, 2.2, b.hex);
    cv.ellipse(b.x, b.y, 1.6, 1.6, BRAND.ink);
  }
}

// Bookmark 4 — a bold ribbon of coral shapes with a soft echo.
function drawCoralWave(cv) {
  cv.fill(BRAND.cream);
  // Four comma/bean shapes alternating side to side, each shadowed by a pale
  // echo one stitch out so the silhouette stays crisp against the ground.
  for (let i = 0; i < 4; i++) {
    const cy = 16 + i * 29, flip = i % 2 === 0 ? 1 : -1, cx = 15 - 2 * flip;
    const arc = (dx, dy, hex, r) => {
      cv.capsule(cx - 7 * flip + dx, cy - 10 + dy, cx + 5 * flip + dx, cy - 4 + dy, r * 0.8, r, hex);
      cv.capsule(cx + 5 * flip + dx, cy - 4 + dy, cx + 2 * flip + dx, cy + 9 + dy, r, r * 0.75, hex);
      cv.capsule(cx + 2 * flip + dx, cy + 9 + dy, cx - 8 * flip + dx, cy + 12 + dy, r * 0.75, r * 0.5, hex);
    };
    arc(1.6 * flip, 2, BRAND.coral, 4.2);
    arc(0, 0, BRAND.tomato, 4);
    // A small golden crescent nested in the hollow of each shape.
    cv.capsule(cx - 6 * flip, cy - 2, cx - 4 * flip, cy + 3, 1.5, 1.9, BRAND.golden);
  }
}

// ── Per-design conversion config. `w`/`h` = canonical grid the chart is baked
// at (build() in-app nearest-neighbour resamples it to each preset size).
// `bgTol` = RGB distance from the auto-detected corner background under which a
// cell is treated as empty (image designs only). `colors` = max palette size
// after quantization; emitted in descending stitch-count order, which is the
// role order the app's palette override maps onto. ──
const DESIGNS = [
  { file: 'alien.png',        id: 'alien',        name: 'Little Alien',      desc: 'A friendly space visitor.',        presets: ['Coaster Set', 'Small Hoop'],              w: 70,  h: 70,  bgTol: 60, colors: 8 },
  { file: 'ufo.png',          id: 'ufo',          name: 'Flying Saucer',     desc: 'A beaming little UFO.',            presets: ['Coaster Set', 'Small Hoop'],              w: 70,  h: 70,  bgTol: 60, colors: 8 },
  { file: 'moth.png',         id: 'moth',         name: 'Celestial Moth',    desc: 'A moon-phase moth motif.',         presets: ['Coaster Set', 'Small Hoop', 'Medium Hoop'], w: 104, h: 104, bgTol: 46, colors: 14 },
  { file: 'heart.png',        id: 'heart',        name: 'Floral Heart',      desc: 'Wildflowers in a heart.',          presets: ['Coaster Set', 'Small Hoop', 'Medium Hoop'], w: 104, h: 104, bgTol: 40, colors: 16 },
  { file: 'bouquet.png',      id: 'bouquet',      name: 'Flower Bouquet',    desc: 'A vase of summer blooms.',         presets: ['Small Hoop', 'Medium Hoop'],              w: 104, h: 104, bgTol: 52, colors: 14 },
  { file: 'alphabet.png',     id: 'alphabet',     name: 'Alphabet Sampler',  desc: 'A classic bordered ABC sampler.',  presets: ['Medium Hoop'],                            w: 112, h: 112, bgTol: 60, colors: 6 },
  { draw: drawLeafStack,      id: 'leaf-stack',   name: 'Cutout Leaves',     desc: 'Five paper-cut leaves in a frame.', presets: ['Bookmark'],                             w: 30,  h: 120, colors: 6 },
  { draw: drawLittleFish,     id: 'little-fish',  name: 'Little Fish',       desc: 'One blocky fish, head to tail.',   presets: ['Bookmark'],                               w: 30,  h: 120, colors: 6 },
  { draw: drawPetalScatter,   id: 'petal-scatter',name: 'Petal Scatter',     desc: 'Petals tossed across bare linen.', presets: ['Bookmark'],                               w: 30,  h: 120, colors: 5 },
  { draw: drawCoralWave,      id: 'coral-wave',   name: 'Coral Wave',        desc: 'A bold ribbon of coral shapes.',   presets: ['Bookmark'],                               w: 30,  h: 120, colors: 4 },
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

// A drawn canvas of hex-or-null cells → the {r,g,b}|null grid quantize() wants.
function drawnGrid(d) {
  const cv = Canvas(d.w, d.h);
  d.draw(cv);
  return cv.cells.map(hex => hex
    ? { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) }
    : null);
}

const out = [];
for (const d of DESIGNS) {
  const grid = d.draw ? drawnGrid(d) : sampleGrid(readPNG(d.file), d.w, d.h, d.bgTol);
  const { colors, idx } = quantize(grid, d.colors);
  // Despeckling trims anti-aliasing noise out of traced photos. Drawn charts are
  // already clean and use deliberate single stitches (an eye, a flower center),
  // so they skip it.
  const clean = d.draw ? idx : despeckle(idx, d.w, d.h);
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
