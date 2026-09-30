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

// Pixel-art stamp: one character per loop, mapped through `key` to a color.
// A character missing from the key (by convention '.') leaves the cell alone, so
// stamps layer. The shape helpers above are the wrong tool for a 20-loop coaster
// — a cat's eye is three cells wide there, and an ellipse that small lands
// wherever the rounding falls — so the coaster sets place those loops by hand.
function stamp(cv, rows, key, ox = 0, oy = 0) {
  rows.forEach((line, y) => {
    for (let x = 0; x < line.length; x++) {
      const hex = key[line[x]];
      if (hex) cv.put(ox + x, oy + y, hex);
    }
  });
}

// Repaint whatever already holds `from` and passes `test` — a way to texture the
// inside of a shape that's been laid down without spilling past its edge.
function shadeWithin(cv, from, to, test) {
  for (let y = 0; y < cv.H; y++) {
    for (let x = 0; x < cv.W; x++) {
      const i = y * cv.W + x;
      if (cv.cells[i] === from && test(x, y)) cv.cells[i] = to;
    }
  }
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

// ── Coaster sets ───────────────────────────────────────────────────────────
// A coaster order is always four pieces, and the studio keeps them on separate
// pages. A `set` design is authored as a 2×2 mosaic of 20×20 panels — one per
// coaster — so the picker can show the whole set on one card the way the
// shop photographs them, and the studio can split the mosaic back into pages.
//
// 20×20 is the finished loop count, so panels are drawn at their true size: no
// resampling, and every loop is placed deliberately.

// Four colorways of one cat head, which is how the sets are actually sold — the
// silhouette is the expensive part to get right at 20 loops, and repeating it
// makes the four read as a family rather than four unrelated charts.
const CAT_BODY = [
  '...BB..........BB...',
  '..BBBB........BBBB..',
  '..BBBBB......BBBBB..',
  '..BBBBBBBBBBBBBBBB..',
  '.BBBBBBBBBBBBBBBBBB.',
  '.BBBBBBBBBBBBBBBBBB.',
  'BBBBBBBBBBBBBBBBBBBB',
  'BBBBBBBBBBBBBBBBBBBB',
  'BBBBBBBBBBBBBBBBBBBB',
  'BBBBBBBBBBBBBBBBBBBB',
  'BBBBBBBBBBBBBBBBBBBB',
  'BBBBBBBBBBBBBBBBBBBB',
  'BBBBBBBBBBBBBBBBBBBB',
  'BBBBBBBBBBBBBBBBBBBB',
  'BBBBBBBBBBBBBBBBBBBB',
  'BBBBBBBBBBBBBBBBBBBB',
  '.BBBBBBBBBBBBBBBBBB.',
  '..BBBBBBBBBBBBBBBB..',
  '...BBBBBBBBBBBBBB...',
  '.....BBBBBBBBBB.....',
];
const CAT_EARS = ['...EE..........EE...', '...EEE........EEE...', '....EE........EE....'];
const CAT_MUZZLE = [
  '.......FFFFFF.......',
  '......FFFFFFFF......',
  '......FFFFFFFF......',
  '.......FFFFFF.......',
  '........FFFF........',
];
const CAT_FACE = [
  '.....Y........Y.....',
  '....YYY......YYY....',
  '....YYY......YYY....',
  '.....Y........Y.....',
  '....................',
  '..WW.....NN.....WW..',
  '........W..W........',
  '...WW....WW....WW...',
];
// Markings go on between the body and the face, so a tabby stripe reads across
// the head but never crosses an eye.
const CAT_CALICO = [
  '...PP..........QQ...',
  '..PPPP........QQQQ..',
  '..PPPPP......QQQQQ..',
  '..PPPPPP.....QQQQQ..',
  '.PPPPPP.......QQQQQ.',
  '.PPPPP.........QQQQ.',
  'PPPP.............QQQ',
  'PPP.................',
  'PP..................',
];
const CAT_CALICO_LOW = ['.PPPP...............', '..PPP...............', '...PP...............'];
// Yellow spectacles, then a white bib — the tuxedo is otherwise a silhouette.
const CAT_TUXEDO = [
  '.....Q........Q.....',
  '....Q.Q......Q.Q....',
  '...Q...Q....Q...Q...',
  '...Q...Q....Q...Q...',
  '....Q.Q......Q.Q....',
  '.....Q........Q.....',
];
const CAT_TUXEDO_BIB = ['.......PPPPPP.......', '......PPPPPPPP......', '.......PPPPPP.......'];
const CAT_GREY_STRIPES = [
  '....P....PP....P....',
  '....P....PP....P....',
  '....P....PP....P....',
  '.....P...PP...P.....',
];
const CAT_TABBY = [
  '......PP.PP.PP......',
  '......PP.PP.PP......',
  '......PP.PP.PP......',
  '.....PP..PP..PP.....',
];
const CAT_TABBY_CHEEKS = ['..PP............PP..', '...PP..........PP...'];

// Unlike the charts above, the sets name their colors as the exact tapestry wool
// they'll be stitched in rather than brand tokens. With only eight to spend on
// four cats, a token that quantizes to the nearest khaki is one cat lost, so
// these are chosen from the library and pass through untouched.
const CATS = {
  ground: '#A2B5C6',   // 7593 Antique Blue Light — every colorway reads on it
  cream:  '#FCFBF8',   // BLANC
  ink:    '#1E1108',   // 7535 Black Brown
  grey:   '#ABABAB',   // 7620 Steel Gray Light
  ginger: '#B35F2B',   // 7445 Mahogany Medium
  amber:  '#6F2F00',   // 7449 Mahogany Very Dark
  pink:   '#EBB7AF',   // 7213 Shell Pink Very Light
  yellow: '#FDED54',   // 7433 Lemon
};
// `line` carries the whiskers and mouth, so it has to contrast with the body
// rather than the muzzle: on the tuxedo that means cream, everywhere else ink.
function catPanel({ body, muzzle, eye, line, marks = [] }) {
  return (cv) => {
    stamp(cv, CAT_BODY, { B: body });
    for (const m of marks) stamp(cv, m.rows, m.key, 0, m.oy);
    stamp(cv, CAT_EARS, { E: CATS.pink }, 0, 1);
    stamp(cv, CAT_MUZZLE, { F: muzzle }, 0, 12);
    stamp(cv, CAT_FACE, { Y: eye, N: CATS.pink, W: line }, 0, 8);
  };
}
const CAT_PANELS = [
  catPanel({ body: CATS.cream, muzzle: CATS.cream, eye: CATS.ink, line: CATS.ink, marks: [
    { rows: CAT_CALICO, key: { P: CATS.ginger, Q: CATS.amber }, oy: 0 },
    { rows: CAT_CALICO_LOW, key: { P: CATS.ginger }, oy: 16 },
  ] }),
  catPanel({ body: CATS.ink, muzzle: CATS.cream, eye: CATS.ink, line: CATS.cream, marks: [
    { rows: CAT_TUXEDO, key: { Q: CATS.yellow }, oy: 7 },
    { rows: CAT_TUXEDO_BIB, key: { P: CATS.cream }, oy: 17 },
  ] }),
  catPanel({ body: CATS.grey, muzzle: CATS.cream, eye: CATS.yellow, line: CATS.ink, marks: [
    { rows: CAT_GREY_STRIPES, key: { P: CATS.ink }, oy: 4 },
  ] }),
  catPanel({ body: CATS.ginger, muzzle: CATS.cream, eye: CATS.ink, line: CATS.ink, marks: [
    { rows: CAT_TABBY, key: { P: CATS.amber }, oy: 3 },
    { rows: CAT_TABBY_CHEEKS, key: { P: CATS.amber }, oy: 11 },
  ] }),
];

// Four fruits, and here the silhouette is the whole point, so each panel is its
// own drawing rather than a recolor.
const FRUIT = {
  ground: '#BDDDED',   // 7828 Blue Very Light
  red:    '#E04848',   // 7606 Coral Medium
  ink:    '#1E1108',   // 7535 Black Brown
  olive:  '#94AB4F',   // 7769 Avocado Green Light
  rind:   '#4C5826',   // 7936 Avocado Green Very Dark
  golden: '#FDED54',   // 7433 Lemon
  pale:   '#F2E3CE',   // 7451 Beige Brown Ultra Very Light
  plum:   '#835B8B',   // 7245 Lavender Very Dark
};
const STRAWBERRY = [
  '........LLL.........',
  '.....LLLLILLLL......',
  '....LLLLLLLLLLL.....',
  '...RRRRRRRRRRRRR....',
  '..RRPRRRRRPRRRRRR...',
  '..RRRRRPRRRRRPRRR...',
  '.RRRRRRRRRRRRRRRR...',
  '.RRPRRRRPRRRRRPRR...',
  '.RRRRRRRRRRRRRRRR...',
  '..RRRRPRRRRPRRRRR...',
  '..RRRRRRRRRRRRRR....',
  '...RRRPRRRRPRRRR....',
  '...RRRRRRRRRRRR.....',
  '....RRRRPRRRRR......',
  '.....RRRRRRRR.......',
  '......RRRRRR........',
  '.......RRRR.........',
  '........RR..........',
];
// The lemon is wider than it is tall and tapers to a nub at each tip, which is
// the only thing separating it from the plum at this size.
const LEMON = [
  '..........LLLL......',
  '.........LLLLLL.....',
  '.........SLLLL......',
  '.......GGGGGG.......',
  '.....GGGGGGGGGG.....',
  '...GGGGGGGGGGGGGG...',
  '..GGGGGGGGGGGGGGGG..',
  '.GGGGGGGGGGGGGGGGGG.',
  'GGGGGGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGGGGGGG',
  '.GGGGGGGGGGGGGGGGGG.',
  '..GGGGGGGGGGGGGGGG..',
  '....GGGGGGGGGGGG....',
  '......GGGGGGGG......',
];
const LEMON_SHINE = ['.....PP.............', '....PPP.............', '.....PP.............'];
// A slice, flat edge up: the straight top is what keeps it from reading as
// another berry.
const WATERMELON = [
  '..RRRRRRRRRRRRRRRR..',
  '..RRRRRRRRRRRRRRRR..',
  '..RRRRKRRRRRRKRRRR..',
  '..RRRRRRRRRRRRRRRR..',
  '..RRRKRRRRRRRRKRRR..',
  '...RRRRRRRRRRRRRR...',
  '...RRRRRKRRKRRRRR...',
  '...RRRRRRRRRRRRR....',
  '....RRRRRRRRRRR.....',
  '....RRRRKRRRRRR.....',
  '.....RRRRRRRRR......',
  '.....PPPPPPPPP......',
  '......VVVVVVV.......',
  '.......VVVVV........',
];
const PLUM = [
  '.............LL.....',
  '..........LLLL......',
  '.........SS.........',
  '.......UUUSUUU......',
  '.....UUUUUSUUUUU....',
  '....UUUUUUSUUUUUU...',
  '...UUUUUUUSUUUUUUU..',
  '...UUUUUUUSUUUUUUU..',
  '..UUUUUUUUSUUUUUUUU.',
  '..UUUUUUUUSUUUUUUUU.',
  '..UUUUUUUUSUUUUUUUU.',
  '...UUUUUUUSUUUUUUU..',
  '...UUUUUUUSUUUUUUU..',
  '....UUUUUUSUUUUUU...',
  '.....UUUUUSUUUUU....',
  '.......UUUUUUU......',
];
const FRUIT_PANELS = [
  (cv) => stamp(cv, STRAWBERRY, { R: FRUIT.red, P: FRUIT.pale, L: FRUIT.olive, I: FRUIT.rind }, 0, 1),
  (cv) => {
    stamp(cv, LEMON, { G: FRUIT.golden, L: FRUIT.olive, S: FRUIT.rind }, 0, 1);
    stamp(cv, LEMON_SHINE, { P: FRUIT.pale }, 0, 8);
  },
  (cv) => stamp(cv, WATERMELON, { R: FRUIT.red, K: FRUIT.ink, P: FRUIT.pale, V: FRUIT.rind }, 0, 3),
  (cv) => stamp(cv, PLUM, { U: FRUIT.plum, S: FRUIT.ink, L: FRUIT.olive }, 0, 2),
];

// The four shapes in the shop's coaster photograph: farfalle, ravioli, fusilli,
// macaroni. Three tones of semolina plus a dark edge.
const PASTA = {
  ground: '#396987',   // 7318 Blue Very Dark — semolina on anything pale vanishes
  pale:   '#F2E3CE',   // 7451 Beige Brown Ultra Very Light
  golden: '#C8AB6C',   // 7677 Golden Olive Light
  amber:  '#AE7720',   // 7781 Topaz Dark
  deep:   '#653919',   // 7467 Coffee Brown Dark
};
const FARFALLE = [
  '..DD..........DD....',
  '.DPPD........DPPD...',
  'DPPPPD......DPPPPD..',
  'DPGPPPD....DPPPGPD..',
  'DPPGPPPD..DPPPGPPD..',
  'DPPPGPPPDDPPPGPPPD..',
  'DPPPPGPPDAAPPGPPPPD.',
  'DPPPPGPPDAAPPGPPPPD.',
  'DPPPGPPPDDPPPGPPPD..',
  'DPPGPPPD..DPPPGPPD..',
  'DPGPPPD....DPPPGPD..',
  'DPPPPD......DPPPPD..',
  '.DPPD........DPPD...',
  '..DD..........DD....',
];
const RAVIOLI = [
  '..D.D.D.D.D.D.D.D...',
  '.DAAAAAAAAAAAAAAAD..',
  'DAAAAAAAAAAAAAAAAAD.',
  '.AAPPPPPPPPPPPPPAA..',
  'DAAPPPPPPPPPPPPPAAD.',
  '.AAPPGGGGGGGGGPPAA..',
  'DAAPPGPPPPPPPGPPAAD.',
  '.AAPPGPPPPPPPGPPAA..',
  'DAAPPGPPPPPPPGPPAAD.',
  '.AAPPGPPPPPPPGPPAA..',
  'DAAPPGGGGGGGGGPPAAD.',
  '.AAPPPPPPPPPPPPPAA..',
  'DAAPPPPPPPPPPPPPAAD.',
  'DAAAAAAAAAAAAAAAAAD.',
  '.DAAAAAAAAAAAAAAAD..',
  '..D.D.D.D.D.D.D.D...',
];
const MACARONI = [
  '.....DDDDDD.........',
  '...DDAAAAAADD.......',
  '..DAAPPPPPPAAD......',
  '.DAAPPPPPPPPAAD.....',
  '.DAPPPPAAAPPPAD.....',
  'DAAPPPAD.DPPPAAD....',
  'DAAPPAD...DPPAAD....',
  'DAAPPAD...DDAAD.....',
  'DAAPPAD....DDD......',
  'DAAPPAD.............',
  'DAAPPPAD............',
  '.DAAPPPAD...........',
  '.DAAAPPPAD..........',
  '..DDAAPPPAD.........',
  '....DDAAAAD.........',
  '......DDDDD.........',
];
const PASTA_PANELS = [
  (cv) => stamp(cv, FARFALLE, { P: PASTA.pale, G: PASTA.golden, A: PASTA.amber, D: PASTA.deep }, 1, 3),
  (cv) => stamp(cv, RAVIOLI, { P: PASTA.pale, G: PASTA.golden, A: PASTA.amber, D: PASTA.deep }, 1, 2),
  // Fusilli is the one piece with no outline worth hand-placing: it's a rod with
  // a twist, and the twist is a repeating slant, so it's cheaper to shade the
  // rod after laying it down than to spell out sixteen rows of ridges.
  (cv) => {
    cv.capsule(9.5, 4.5, 9.5, 15.5, 5.4, 5.4, PASTA.deep);
    cv.capsule(9.5, 4.5, 9.5, 15.5, 4.4, 4.4, PASTA.pale);
    shadeWithin(cv, PASTA.pale, PASTA.amber, (x, y) => (x * 2 + y * 3) % 12 < 5);
    shadeWithin(cv, PASTA.pale, PASTA.golden, (x, y) => (x * 2 + y * 3) % 12 === 5);
  },
  (cv) => stamp(cv, MACARONI, { P: PASTA.pale, A: PASTA.amber, D: PASTA.deep }, 3, 2),
];

// Four daisies, one colorway each. Radially symmetric, so unlike the cats these
// can come off the shape helpers cleanly.
const DAISY = {
  ground: '#E7D6C1',   // 7470 Yellow Beige Light
  centre: '#FDED54',   // 7433 Lemon
  lilac:  '#A37BA7',   // 7708 Lavender Dark
  pink:   '#FF798C',   // 7104 Carnation Medium
  orange: '#EB6307',   // 7946 Burnt Orange Medium
  blue:   '#6B9EBF',   // 7314 Blue Medium
};
function daisyPanel(petal) {
  return (cv) => {
    const c = (cv.W - 1) / 2;
    for (let i = 0; i < 5; i++) {
      const a = (i * 72) * Math.PI / 180;
      cv.ellipse(c + Math.sin(a) * 5.2, c - Math.cos(a) * 5.2, 3.6, 3.6, petal);
    }
    cv.ellipse(c, c, 3.2, 3.2, DAISY.centre);
  };
}
const DAISY_PANELS = [daisyPanel(DAISY.lilac), daisyPanel(DAISY.pink),
  daisyPanel(DAISY.orange), daisyPanel(DAISY.blue)];

const SQUARE = ['Coaster', 'Small Hoop', 'Pillow'];
const PORTRAIT = ['Large Hoop'];
const COASTER = ['Coaster'];
const SET = { presets: COASTER, w: 40, h: 40, unit: { w: 20, h: 20 }, cols: 2, rows: 2 };
const DESIGNS = [
  { id: 'pn-sunburst', name: 'Sunburst', desc: 'Radiating rays around a bold centre.',
    presets: SQUARE, w: 40, h: 40, colors: 6, draw: drawSunburst },
  { id: 'pn-waves', name: 'Wavy Stripes', desc: 'Five rolling bands of color.',
    presets: SQUARE, w: 40, h: 40, colors: 6, draw: drawWavyStripes },
  { id: 'pn-hills', name: 'Rolling Hills', desc: 'A low sun over layered hills.',
    presets: PORTRAIT, w: 40, h: 50, colors: 6, draw: drawRollingHills },
  { id: 'pn-bloom', name: 'Big Bloom', desc: 'One oversized flower, stem and leaves.',
    presets: PORTRAIT, w: 40, h: 50, colors: 6, draw: drawBigBloom },
  { ...SET, id: 'pn-cats', name: 'Four Cats', desc: 'A calico, a tuxedo, a grey and a ginger.',
    colors: 8, ground: CATS.ground, panels: CAT_PANELS },
  { ...SET, id: 'pn-fruit', name: 'Fruit Stand', desc: 'Strawberry, lemon, watermelon, plum.',
    colors: 8, ground: FRUIT.ground, panels: FRUIT_PANELS },
  { ...SET, id: 'pn-pasta', name: 'Pasta Night', desc: 'Farfalle, ravioli, fusilli, macaroni.',
    colors: 6, ground: PASTA.ground, panels: PASTA_PANELS },
  { ...SET, id: 'pn-daisies', name: 'Four Daisies', desc: 'One simple daisy, in four colors.',
    colors: 6, ground: DAISY.ground, panels: DAISY_PANELS },
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
  if (d.panels) {
    // Each panel gets its own canvas so its drawing can't spill into a
    // neighbour, then lands in place on the mosaic.
    d.panels.forEach((draw, i) => {
      const sub = Canvas(d.unit.w, d.unit.h);
      if (d.ground) sub.fill(d.ground);
      draw(sub);
      const ox = (i % d.cols) * d.unit.w, oy = Math.floor(i / d.cols) * d.unit.h;
      for (let y = 0; y < d.unit.h; y++)
        for (let x = 0; x < d.unit.w; x++) cv.put(ox + x, oy + y, sub.cells[y * d.unit.w + x]);
    });
  } else {
    d.draw(cv);
  }
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
  const entry = { id: d.id, name: d.name, desc: d.desc, presets: d.presets, w: d.w, h: d.h, colors, rle };
  if (d.panels) entry.set = { cols: d.cols, rows: d.rows, w: d.unit.w, h: d.unit.h };
  out.push(entry);
  const tag = d.panels ? ` set=${d.cols}x${d.rows} of ${d.unit.w}x${d.unit.h}` : '';
  console.log(`${d.id.padEnd(12)} ${d.w}x${d.h}  colors=${colors.length}  fill=${(100 * fill / (d.w * d.h)).toFixed(0)}%  rleBytes=${rle.length}${tag}`);
  console.log(`             ${names.map(n => `${n.code} ${n.hex}`).join('  ')}`);
}

const banner = '// AUTO-GENERATED by tools/gen-punch-templates.mjs — do not hand-edit.\n'
  + '// Regenerate: node tools/gen-punch-templates.mjs\n'
  + '// Each entry is a canonical punch needle chart: { id, name, desc, presets, w, h,\n'
  + '//   colors:[hex...], rle } where rle tokens are "<idxB36>.<runB36>" and idx 0 = empty.\n'
  + '// A `set:{cols,rows,w,h}` entry is a mosaic of that many panels, one per coaster.\n'
  + '// Colors are DMC Laine Colbert tapestry wool (see assets/tapestry-wool.js).\n';
fs.writeFileSync(OUT_JS, banner + 'window.PUNCH_TEMPLATE_DATA = ' + JSON.stringify(out) + ';\n');
console.log('\nWrote', path.relative(ROOT, OUT_JS), '(' + fs.statSync(OUT_JS).size + ' bytes)');
console.log('Previews in', path.relative(ROOT, PREVIEW_DIR));
