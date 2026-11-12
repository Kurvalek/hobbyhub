// One-time authoring script: builds the cross-stitch chart data consumed by
// index.html (window.STITCH_TEMPLATE_DATA) into assets/stitch-templates-data.js.
//
// Every chart is one of the starter designs in tools/stitch-starters.mjs: each
// is drawn in named color roles that are DMC flosses already, and carries its
// words as text layers the studio opens in the text tool. The words are set
// here, in headless Chrome, by the studio's own text code (src/stitch-text.jsx)
// in the real web fonts, so the chart, the picker thumbnail and the editable
// words all agree stitch for stitch. That step needs Chrome and the network
// (for Google Fonts).
//
// It also writes a scaled-up preview PNG per design to tools/_preview/ so the
// designs can be eyeballed before embedding.
//
//   node tools/gen-stitch-templates.mjs
//
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { PNG } from 'pngjs';
import puppeteer from 'puppeteer-core';
import { STARTERS } from './stitch-starters.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PREVIEW_DIR = path.join(__dirname, '_preview');
const OUT_JS = path.join(ROOT, 'assets', 'stitch-templates-data.js');

// ── Pull the DMC floss list straight out of the app's color catalog so the
// roles' flosses are the exact ones the app ships with. ────────────────────
function loadDMC() {
  const src = fs.readFileSync(path.join(ROOT, 'assets', 'color-catalogs.js'), 'utf8');
  const m = src.match(/const DMC_ENC = "([^"]*)"/);
  if (!m) throw new Error('DMC_ENC not found in assets/color-catalogs.js');
  return m[1].split('|').map(s => {
    const [code, name, hex] = s.split('~');
    return { code, name, hex: '#' + hex, r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) };
  });
}
const DMC = loadDMC();

// ── Drawing canvas for the starter designs ─────────────────────────────────
// A grid of hex-or-null cells plus a handful of shape primitives. Coordinates
// are edges: (0,0) is the board's top-left corner and a stitch (i,j) covers
// [i,i+1)×[j,j+1), so a shape stitches every cell whose center it contains.
// Fractional inputs are fine, which is what keeps curves reading as curves at
// 30 stitches wide. `put` alone takes a stitch's own (i,j).
function Canvas(W, H) {
  const cells = new Array(W * H).fill(null);
  const put = (x, y, hex) => {
    const ix = Math.round(x), iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= W || iy >= H) return;
    cells[iy * W + ix] = hex;
  };
  const cv = {
    W, H, cells, put,
    // Filled w×h rectangle at (x,y).
    rect(x, y, w, h, hex) {
      for (let j = Math.round(y); j < Math.round(y) + h; j++)
        for (let i = Math.round(x); i < Math.round(x) + w; i++) put(i, j, hex);
      return cv;
    },
    // One-stitch outline of the w×h rectangle at (x,y).
    box(x, y, w, h, hex) {
      cv.rect(x, y, w, 1, hex); cv.rect(x, y + h - 1, w, 1, hex);
      cv.rect(x, y, 1, h, hex); cv.rect(x + w - 1, y, 1, h, hex);
      return cv;
    },
    // Filled rectangle with its corners rounded off at radius r.
    roundRect(x, y, w, h, r, hex) {
      for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
        const px = i + 0.5, py = j + 0.5;
        const qx = Math.max(x + r - px, 0, px - (x + w - r)), qy = Math.max(y + r - py, 0, py - (y + h - r));
        if (qx * qx + qy * qy <= r * r) put(i, j, hex);
      }
      return cv;
    },
    // Stitches whose centers sit inside polygon `pts` ([[x,y],…]) and between
    // d0 and d1 stitches in from its edge — (0, Infinity) fills it, (2, 3)
    // runs a one-stitch line two stitches inside it.
    poly(pts, hex, d0 = 0, d1 = Infinity) {
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      for (let j = Math.floor(Math.min(...ys)); j < Math.ceil(Math.max(...ys)); j++) {
        for (let i = Math.floor(Math.min(...xs)); i < Math.ceil(Math.max(...xs)); i++) {
          const px = i + 0.5, py = j + 0.5;
          let inside = false, d = Infinity;
          for (let k = 0, m = pts.length - 1; k < pts.length; m = k++) {
            const [ax, ay] = pts[m], [bx, by] = pts[k];
            if ((ay > py) !== (by > py) && px < ax + ((py - ay) * (bx - ax)) / (by - ay)) inside = !inside;
            const ex = bx - ax, ey = by - ay, l2 = ex * ex + ey * ey;
            const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / l2)) : 0;
            d = Math.min(d, Math.hypot(px - (ax + ex * t), py - (ay + ey * t)));
          }
          if (inside && d >= d0 && d < d1) put(i, j, hex);
        }
      }
      return cv;
    },
    // Stitches whose centers sit between r0 and r1 from (cx,cy): a disc when
    // r0 is 0, a ring otherwise. Pass null to cut a hole.
    ring(cx, cy, r0, r1, hex) {
      for (let j = Math.floor(cy - r1); j <= Math.ceil(cy + r1); j++) {
        for (let i = Math.floor(cx - r1); i <= Math.ceil(cx + r1); i++) {
          const d = Math.hypot(i + 0.5 - cx, j + 0.5 - cy);
          if (d >= r0 && d < r1) put(i, j, hex);
        }
      }
      return cv;
    },
  };
  return cv;
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

// ── Starter designs: color roles + text layers ─────────────────────────────
function chromePath() {
  const guesses = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ];
  const hit = guesses.find(g => fs.existsSync(g));
  if (!hit) throw new Error('Setting the starter lettering needs Chrome, Chromium or Edge installed');
  return hit;
}

// Every text layer as the studio would stitch it: its box and its stitches as
// [dx,dy] offsets from the box's top-left. Runs src/stitch-text.jsx in Chrome
// with the same Google Fonts stylesheet index.html loads.
async function setLettering(layers) {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const fontsHref = (html.match(/href="(https:\/\/fonts\.googleapis\.com\/css2[^"]+)"/) || [])[1];
  if (!fontsHref) throw new Error('Google Fonts stylesheet not found in index.html');
  const bundle = await esbuild.build({
    absWorkingDir: ROOT, bundle: true, format: 'iife', globalName: 'XST', jsx: 'automatic', write: false,
    stdin: { contents: "export { XS_FONTS, layoutStitchText, rasterizeText } from './src/stitch-text.jsx';", resolveDir: ROOT, loader: 'js' },
    define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'warning',
  });
  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: 'new', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><html><head><link rel="stylesheet" href="${fontsHref.replace(/&amp;/g, '&')}"></head><body></body></html>`, { waitUntil: 'networkidle0' });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    return await page.evaluate(async (layers) => {
      const { XS_FONTS, layoutStitchText, rasterizeText } = window.XST;
      for (const id of new Set(layers.map(l => l.font))) {
        const f = XS_FONTS[id];
        if (!f) throw new Error(`Unknown font "${id}"`);
        const spec = `${f.weight} 16px ${f.family}`;
        await document.fonts.load(spec);
        if (!document.fonts.check(spec)) throw new Error(`${f.family} didn't load`);
      }
      return layers.map(l => {
        const L = layoutStitchText(l.text, l.font, l.size);
        return { size: L.size, boxW: L.boxW, boxH: L.boxH, offs: rasterizeText(l.text, l.font, l.size) };
      });
    }, layers);
  } finally {
    await browser.close();
  }
}

// Sorted stitch indices as base-36 gaps, the text layers' answer to toRLE.
const toGaps = list => list.map((k, i) => (k - (i ? list[i - 1] : 0)).toString(36)).join(' ');

// Places one set layer. Horizontally `x` is where the ink's center, left or
// right edge goes (by `align`); vertically the ink's top goes at `top`, or its
// middle at `cy`. Placing by ink rather than box keeps short words optically
// centered; the box's alignment is what the studio holds to when they're retyped.
function placeLayer(t, set, W) {
  const xs = set.offs.map(o => o[0]), ys = set.offs.map(o => o[1]);
  const l = Math.min(...xs), r = Math.max(...xs) + 1, tp = Math.min(...ys), b = Math.max(...ys) + 1;
  const align = t.align || 'center';
  const x = align === 'left' ? t.x - l : align === 'right' ? t.x - r : Math.round(t.x - (l + r) / 2);
  const y = t.top != null ? t.top - tp : Math.round(t.cy - (tp + b) / 2);
  const cells = [...new Set(set.offs.map(([dx, dy]) => (y + dy) * W + (x + dx)))].sort((a, c) => a - c);
  const outside = set.offs.some(([dx, dy]) => x + dx < 0 || y + dy < 0 || x + dx >= W);
  return { x, y, align, cells, outside, ink: { l: x + l, r: x + r, t: y + tp, b: y + b } };
}

// What a design has to get right before it ships. Errors stop the build;
// warnings are printed and let through.
function checkStarter(d, layers, idx) {
  const errors = [], warnings = [];
  const where = t => `"${t.text.replace(/\n/g, ' / ')}"`;
  const seen = new Map();
  for (const t of layers) {
    // The studio flags a box that crosses the board's edge ("Off the edge").
    // A stitch of margin covers browsers measuring a font a hair wider.
    if (t.x < 1 || t.y < 1 || t.x + t.boxW > d.w - 1 || t.y + t.boxH > d.h - 1) {
      errors.push(`${where(t)} box ${t.x},${t.y} ${t.boxW}×${t.boxH} is within a stitch of the edge`);
    }
    if (t.outside || t.cells.some(k => k >= d.w * d.h)) errors.push(`${where(t)} has stitches off the board`);
    for (const k of t.cells) {
      if (seen.has(k)) { errors.push(`${where(t)} overlaps ${where(seen.get(k))}`); break; }
      seen.set(k, t);
    }
  }
  if (d.roles.length > 4) warnings.push(`${d.roles.length} colors`);
  if (d.presets.some(p => /Hoop/.test(p))) {
    // A hoop's ring is as wide as the board, so its corners sit under the hoop.
    const cx = d.w / 2, cy = d.h / 2, R = d.w / 2 - 1;
    let n = 0;
    const all = idx.map(Boolean);
    for (const t of layers) for (const k of t.cells) all[k] = true;
    all.forEach((on, k) => { if (on && Math.hypot((k % d.w) + 0.5 - cx, Math.floor(k / d.w) + 0.5 - cy) > R) n++; });
    if (n) warnings.push(`${n} stitches within a stitch of the hoop or under it`);
  }
  return { errors, warnings };
}

async function buildStarters() {
  const layers = STARTERS.flatMap(d => d.texts);
  const set = layers.length ? await setLettering(layers) : [];
  let si = 0, failed = false;
  const built = STARTERS.map(d => {
    const roleHex = d.roles.map(r => {
      const c = DMC.find(x => x.code === r.code);
      if (!c) throw new Error(`${d.id}: no DMC ${r.code}`);
      return c.hex;
    });
    if (new Set(roleHex).size !== roleHex.length) throw new Error(`${d.id}: two roles share a floss`);
    const hexOf = Object.fromEntries(d.roles.map((r, i) => [r.id, roleHex[i]]));
    const cv = Canvas(d.w, d.h);
    d.draw(cv, hexOf);
    const idx = cv.cells.map(hex => (hex ? roleHex.indexOf(hex) + 1 : 0));
    if (cv.cells.some((h, i) => h && !idx[i])) throw new Error(`${d.id}: drew a color that isn't one of its roles`);
    const placed = d.texts.map(t => {
      const s = set[si++];
      const role = d.roles.findIndex(r => r.id === t.role);
      if (role < 0) throw new Error(`${d.id}: "${t.text}" uses unknown role ${t.role}`);
      return { ...t, role, size: s.size, boxW: s.boxW, boxH: s.boxH, ...placeLayer(t, s, d.w) };
    });
    const { errors, warnings } = checkStarter(d, placed, idx);
    const preview = idx.slice();
    for (const t of placed) for (const k of t.cells) preview[k] = t.role + 1;
    writePreview(d.id, roleHex, preview, d.w, d.h);
    const fill = preview.filter(Boolean).length;
    console.log(`${d.id.padEnd(14)} ${d.w}x${d.h}  colors=${roleHex.length}  fill=${(100 * fill / (d.w * d.h)).toFixed(0)}%  texts=${placed.length}`);
    for (const t of placed) console.log(`    ${JSON.stringify(t.text).padEnd(18)} ${t.font} ${t.size}  box ${t.x},${t.y} ${t.boxW}×${t.boxH}  ink x ${t.ink.l}–${t.ink.r} y ${t.ink.t}–${t.ink.b}`);
    for (const w of warnings) console.log(`  ! ${w}`);
    for (const e of errors) console.log(`  ✗ ${e}`);
    if (errors.length) failed = true;
    return {
      id: d.id, name: d.name, desc: d.desc, presets: d.presets, w: d.w, h: d.h,
      colors: roleHex, roles: d.roles.map(r => ({ id: r.id, tone: r.tone })), rle: toRLE(idx),
      texts: placed.map(t => ({
        text: t.text, font: t.font, size: t.size, role: t.role, align: t.align,
        x: t.x, y: t.y, boxW: t.boxW, boxH: t.boxH, cells: toGaps(t.cells),
      })),
    };
  });
  if (failed) throw new Error('Starter designs failed their checks (✗ above)');
  return built;
}

const out = await buildStarters();

const banner = '// AUTO-GENERATED by tools/gen-stitch-templates.mjs — do not hand-edit.\n'
  + '// Regenerate: node tools/gen-stitch-templates.mjs (reads tools/stitch-starters.mjs).\n'
  + '// Each entry is a canonical cross-stitch chart: { id, name, desc, presets, w, h,\n'
  + '//   colors:[hex...], rle, roles, texts } where rle tokens are "<idxB36>.<runB36>" and\n'
  + '//   idx 0 = empty, roles are [{id,tone}] (one per color) and texts are [{text, font,\n'
  + '//   size, role, align, x, y, boxW, boxH, cells}], cells being the layer\'s stitch\n'
  + '//   indices as base-36 gaps; the layer\'s stitches are not in rle.\n';
fs.writeFileSync(OUT_JS, banner + 'window.STITCH_TEMPLATE_DATA = ' + JSON.stringify(out) + ';\n');
console.log('\nWrote', path.relative(ROOT, OUT_JS), '(' + fs.statSync(OUT_JS).size + ' bytes)');
console.log('Previews in', path.relative(ROOT, PREVIEW_DIR));
