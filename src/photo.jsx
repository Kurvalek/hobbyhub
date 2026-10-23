import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { IcCamera, IcImage, IcLink, IcPaste, IcShuffle } from './icons.jsx';
import { extractColors, hexToRgb, nearestInList } from './catalog.jsx';
import { BottomSheet, Switch, useIsMobile } from './editor-ui.jsx';
import { BrandSpecs } from './landing.jsx';

// ── Fitting an uploaded photo onto a stitch canvas ─────────────────────────
// A photo almost never shares its proportions with the canvas it lands on (a
// heart dropped on a 30×120 bookmark), so filling the grid would stretch the
// motif or crop most of it away. Instead we CONTAIN it: trim the dead border off
// the source, scale what's left to fit inside the grid at its own aspect ratio,
// and centre it. The cells around it stay unstitched fabric — room for the user
// to duplicate the motif up the strip with the selection tool.
const XS_TRIM_SAMPLE = 240;     // border scan runs on a downscale this wide
const XS_TRIM_TOL = 30;         // RGB distance still counted as background
const XS_TRIM_NOISE = 0.01;     // share of a row/col allowed to differ
const XS_TRIM_MIN = 0.03;       // ignore trims that shave off less than this
const XS_FIT_MIN_SHARE = 0.15;  // motif's short side, as a share of the grid's

// The rect of `img` that still holds the subject: uniform or fully transparent
// borders — the white field around an exported motif — get cropped off, so
// containing the image doesn't leave a speck floating in a huge margin. Only
// unambiguous borders are trimmed (a photo's varied edges are left alone), and
// a pixel of padding is handed back so anti-aliased edges survive. Memoized on
// the element: the studio's trace overlay asks for the same rect every frame.
function xsTrimRect(img) {
  if (img.__xsTrim) return img.__xsTrim;
  const full = { x: 0, y: 0, w: img.width, h: img.height, bg: null };
  const keep = rect => (img.__xsTrim = rect);
  if (!img.width || !img.height) return full;   // not decoded yet — don't memoize
  const scale = Math.min(1, XS_TRIM_SAMPLE / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0, w, h);
  let data; try { data = ctx.getImageData(0, 0, w, h).data; } catch (e) { return keep(full); }
  if (w < 8 || h < 8) return keep(full);
  // What the border is made of: bucket its pixels coarsely and take the mode.
  // A border that isn't overwhelmingly one thing isn't a margin — bail out.
  const border = [];
  for (let x = 0; x < w; x++) { border.push(x, (h - 1) * w + x); }
  for (let y = 1; y < h - 1; y++) { border.push(y * w, y * w + w - 1); }
  const buckets = new Map();
  for (const i of border) {
    const k = data[i * 4 + 3] < 32 ? 'clear'
      : `${data[i * 4] >> 4},${data[i * 4 + 1] >> 4},${data[i * 4 + 2] >> 4}`;
    buckets.set(k, (buckets.get(k) || 0) + 1);
  }
  let mode = null, best = 0;
  for (const [k, n] of buckets) if (n > best) { best = n; mode = k; }
  if (!mode || best / border.length < 0.6) return keep(full);
  let bg = null;
  if (mode !== 'clear') {
    const [r, g, b] = mode.split(',').map(Number);
    bg = { r: r * 16 + 8, g: g * 16 + 8, b: b * 16 + 8 };
  }
  const isBg = i => {
    if (data[i * 4 + 3] < 32) return true;
    if (!bg) return false;
    const dr = data[i * 4] - bg.r, dg = data[i * 4 + 1] - bg.g, db = data[i * 4 + 2] - bg.b;
    return dr * dr + dg * dg + db * db <= XS_TRIM_TOL * XS_TRIM_TOL;
  };
  const allow = len => Math.floor(len * XS_TRIM_NOISE);
  const rowIsBg = (y, x0, x1) => {
    let off = 0, cap = allow(x1 - x0 + 1);
    for (let x = x0; x <= x1; x++) if (!isBg(y * w + x) && ++off > cap) return false;
    return true;
  };
  const colIsBg = (x, y0, y1) => {
    let off = 0, cap = allow(y1 - y0 + 1);
    for (let y = y0; y <= y1; y++) if (!isBg(y * w + x) && ++off > cap) return false;
    return true;
  };
  let top = 0, bot = h - 1, left = 0, right = w - 1;
  while (top < bot && rowIsBg(top, 0, w - 1)) top++;
  while (bot > top && rowIsBg(bot, 0, w - 1)) bot--;
  while (left < right && colIsBg(left, top, bot)) left++;
  while (right > left && colIsBg(right, top, bot)) right--;
  const pad = 1 + Math.ceil(Math.max(w, h) * 0.01);
  top = Math.max(0, top - pad); bot = Math.min(h - 1, bot + pad);
  left = Math.max(0, left - pad); right = Math.min(w - 1, right + pad);
  const tw = right - left + 1, th = bot - top + 1;
  // Nothing worth trimming, or the scan ate the subject → keep the whole image
  // (but still report the field color we found).
  if (tw < 4 || th < 4) return keep({ ...full, bg });
  if (tw > w * (1 - XS_TRIM_MIN) && th > h * (1 - XS_TRIM_MIN)) return keep({ ...full, bg });
  const x = Math.floor(left / w * img.width), y = Math.floor(top / h * img.height);
  return keep({
    x, y,
    w: Math.max(1, Math.ceil((right + 1) / w * img.width) - x),
    h: Math.max(1, Math.ceil((bot + 1) / h * img.height) - y),
    bg,
  });
}

// Source and destination rects for placing `img` on a W×H grid: contained at
// its own aspect ratio and centred, so the whole motif reads. One axis always
// fills the grid, which keeps a contained motif from ever being a speck — but a
// wildly letterboxed source (a panorama on a bookmark) would still land as a
// hairline, so the fit may grow past contain, cropping the long axis from the
// centre, until the short side covers XS_FIT_MIN_SHARE of the grid's short side.
export function xsFitImageToGrid(img, W, H) {
  const src = xsTrimRect(img);
  if (!src.w || !src.h) return null;
  let scale = Math.min(W / src.w, H / src.h);
  let dw = src.w * scale, dh = src.h * scale;
  const floor = Math.max(2, Math.round(Math.min(W, H) * XS_FIT_MIN_SHARE));
  const short = Math.min(dw, dh);
  if (short > 0 && short < floor) { const g = floor / short; scale *= g; dw *= g; dh *= g; }
  let { x: sx, y: sy, w: sw, h: sh } = src;
  if (dw > W) { const k = W / scale; sx += (sw - k) / 2; sw = k; dw = W; }
  if (dh > H) { const k = H / scale; sy += (sh - k) / 2; sh = k; dh = H; }
  dw = Math.max(1, Math.min(W, Math.round(dw)));
  dh = Math.max(1, Math.min(H, Math.round(dh)));
  return { sx, sy, sw, sh, dx: Math.floor((W - dw) / 2), dy: Math.floor((H - dh) / 2), dw, dh };
}

// A motif exported on a flat field — a heart on white — shouldn't land as a
// stitched block of that field: it reads far better as a motif on bare fabric,
// which is also what the user duplicates around. So the field is cleared, but
// only where it's reachable from the edge of the fitted motif: a flood fill, so
// a same-colored highlight *inside* the subject stays stitched. If nearly the
// whole motif turns out to be field (a snowfield photo), the fill is rolled back
// rather than handing back an empty canvas.
const XS_FIELD_MAX_CLEAR = 0.92;   // clearing more of the motif than this is a misread
function xsClearGroundField(grid, isField, W, H, fit) {
  const before = grid.slice(), stack = [];
  let cleared = 0;
  const push = (x, y) => {
    if (x < fit.dx || y < fit.dy || x >= fit.dx + fit.dw || y >= fit.dy + fit.dh) return;
    const i = y * W + x;
    if (!isField[i] || grid[i] === null) return;
    grid[i] = null; cleared++; stack.push(i);
  };
  for (let x = fit.dx; x < fit.dx + fit.dw; x++) { push(x, fit.dy); push(x, fit.dy + fit.dh - 1); }
  for (let y = fit.dy; y < fit.dy + fit.dh; y++) { push(fit.dx, y); push(fit.dx + fit.dw - 1, y); }
  while (stack.length) {
    const i = stack.pop(), x = i % W, y = (i - x) / W;
    push(x - 1, y); push(x + 1, y); push(x, y - 1); push(x, y + 1);
  }
  if (cleared > fit.dw * fit.dh * XS_FIELD_MAX_CLEAR) for (let i = 0; i < grid.length; i++) grid[i] = before[i];
}

// ── Flattening a photo into something worth stitching ──────────────────────
// A photograph holds far more variation than a chart can show. Map it stitch by
// stitch and every scrap of skin texture, JPEG mush and lens noise becomes its
// own fleck of floss: the chart turns to confetti, and stitching it means
// starting and finishing threads for two squares at a time. Cartoons come out
// clean only because they were already flat.
//
// So the photo is flattened on the way in. Colour is averaged over a wider area
// BEFORE the palette is applied — averaging colors is what merges texture,
// whereas averaging palette *choices* only reshuffles them — and the grid is
// then tidied twice over: neighbours outvote lone stitches, and islands too
// small to be worth a thread are absorbed into what surrounds them.
//
// How hard to push is the stitcher's call, so it's a short ladder rather than a
// slider. `blur` is 3×3 averaging passes over the sampled color, `smooth` is
// majority passes on the finished grid, `speck` is the smallest island kept
// (in stitches, on a 70×70 chart — scaled to the motif below).
export const XS_SIMPLIFY = [
  { id: 'detailed', label: 'Detailed', blur: 0, smooth: 0, speck: 0,
    note: 'Every shade the palette can hold. Busiest to stitch.' },
  { id: 'soft',     label: 'Soft',     blur: 1, smooth: 1, speck: 3,
    note: 'Texture calmed down, shading kept.' },
  { id: 'simple',   label: 'Simple',   blur: 2, smooth: 2, speck: 8,
    note: 'Broad blocks of color. Easiest to follow.' },
  { id: 'flat',     label: 'Flat',     blur: 3, smooth: 3, speck: 20,
    note: 'Poster-like. Shapes only, almost no shading.' },
];
export const XS_SIMPLIFY_DEFAULT = 'simple';
export const xsSimplifySpec = id => XS_SIMPLIFY.find(s => s.id === id) || XS_SIMPLIFY.find(s => s.id === XS_SIMPLIFY_DEFAULT);

// Drawing the motif a few times larger than the grid and averaging each cell's
// own block gives a true area mean, so a busy patch resolves to the color it
// reads as from across the room instead of to whichever pixel happened to land
// on the cell's centre. `cover` is how much of the cell came back opaque.
const XS_SUPERSAMPLE = 3;
function xsSampleCells(img, fit, W, H) {
  const S = XS_SUPERSAMPLE, sw = W * S, sh = H * S;
  const cv = document.createElement('canvas'); cv.width = sw; cv.height = sh;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, fit.sx, fit.sy, fit.sw, fit.sh, fit.dx * S, fit.dy * S, fit.dw * S, fit.dh * S);
  let data; try { data = ctx.getImageData(0, 0, sw, sh).data; } catch (e) { return null; }
  const rgb = new Float32Array(W * H * 3), cover = new Float32Array(W * H);
  for (let cy = 0; cy < H; cy++) {
    for (let cx = 0; cx < W; cx++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++) {
        const row = (cy * S + sy) * sw + cx * S;
        for (let sx = 0; sx < S; sx++) {
          const p = (row + sx) * 4, w = data[p + 3] / 255;
          r += data[p] * w; g += data[p + 1] * w; b += data[p + 2] * w; a += w;
        }
      }
      const i = cy * W + cx;
      cover[i] = a / (S * S);
      if (a > 0) { rgb[i * 3] = r / a; rgb[i * 3 + 1] = g / a; rgb[i * 3 + 2] = b / a; }
    }
  }
  return { rgb, cover };
}

// One 3×3 mean over the covered cells. Repeated passes approximate a gaussian,
// which falls off more kindly than one wide box would.
function xsBlurCells(rgb, cover, W, H, passes) {
  let src = rgb;
  for (let p = 0; p < passes; p++) {
    const out = new Float32Array(src.length);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (cover[i] <= 0) continue;
        let r = 0, g = 0, b = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy; if (ny < 0 || ny >= H) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx; if (nx < 0 || nx >= W) continue;
            const j = ny * W + nx;
            if (cover[j] <= 0) continue;
            r += src[j * 3]; g += src[j * 3 + 1]; b += src[j * 3 + 2]; n++;
          }
        }
        out[i * 3] = r / n; out[i * 3 + 1] = g / n; out[i * 3 + 2] = b / n;
      }
    }
    src = out;
  }
  return src;
}

// "Agree with your neighbours": a stitch outnumbered in its own 3×3 block takes
// the block's majority instead. Repeated, lone stitches melt into the shapes
// around them while any edge with real weight behind it stays put. Bare fabric
// votes like any other color, so the silhouette gets tidied too. Cells outside
// the fitted motif abstain — the margin must not eat into the design.
function xsMajorityPass(grid, W, H, fit) {
  const out = grid.slice(), votes = new Map();
  const x1 = fit.dx + fit.dw, y1 = fit.dy + fit.dh;
  for (let y = fit.dy; y < y1; y++) {
    for (let x = fit.dx; x < x1; x++) {
      votes.clear();
      const self = grid[y * W + x];
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy; if (ny < fit.dy || ny >= y1) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx; if (nx < fit.dx || nx >= x1) continue;
          const k = grid[ny * W + nx];
          // The centre counts double, so an even split keeps what is there.
          votes.set(k, (votes.get(k) || 0) + (dx || dy ? 1 : 2));
        }
      }
      let best = self, bn = votes.get(self) || 0;
      for (const [k, n] of votes) if (n > bn) { bn = n; best = k; }
      out[y * W + x] = best;
    }
  }
  return out;
}

// Absorb islands smaller than `min` stitches into whichever color surrounds
// them most. A three-stitch fleck of its own shade reads as dirt on the chart
// rather than as detail, and costs a thread start and finish to work.
function xsDespeckle(grid, W, H, fit, min) {
  if (min < 2) return;
  const x1 = fit.dx + fit.dw, y1 = fit.dy + fit.dh;
  const seen = new Uint8Array(W * H);
  for (let sy = fit.dy; sy < y1; sy++) {
    for (let sx = fit.dx; sx < x1; sx++) {
      const start = sy * W + sx;
      if (seen[start]) continue;
      const hex = grid[start], region = [start], edge = new Map();
      seen[start] = 1;
      for (let qi = 0; qi < region.length; qi++) {
        const i = region[qi], x = i % W, y = (i - x) / W;
        for (let d = 0; d < 4; d++) {
          const nx = x + (d === 0 ? -1 : d === 1 ? 1 : 0), ny = y + (d === 2 ? -1 : d === 3 ? 1 : 0);
          if (nx < fit.dx || ny < fit.dy || nx >= x1 || ny >= y1) continue;
          const j = ny * W + nx;
          if (grid[j] === hex) { if (!seen[j]) { seen[j] = 1; region.push(j); } }
          else edge.set(grid[j], (edge.get(grid[j]) || 0) + 1);
        }
      }
      if (region.length >= min || !edge.size) continue;
      let best = null, bn = 0;
      for (const [k, n] of edge) if (n > bn) { bn = n; best = k; }
      for (const i of region) grid[i] = best;
    }
  }
}

// Strip the background off a chart that's already been flattened. xsClearGroundField
// only handles a motif exported on ONE flat field, which a photograph never has:
// a strawberry on a tablecloth, a bird against a sky. But by the time the chart
// has been flattened the background is usually down to one or two palette
// colors, so it can be taken the same way — whatever the border ring is mostly
// made of, flooded inward, so a matching color deep inside the subject stays.
//
// Colors are matched with a little slack rather than exactly, so a shade of
// noise along the way doesn't wall the flood off. Anything that fails (a
// close-cropped portrait, where the border IS the subject) rolls back rather
// than handing over a chart with holes punched in it.
const XS_BG_BORDER_SHARE = 0.14;  // share of the border ring to count as background
const XS_BG_MAX_COLORS = 3;       // at most this many colors read as background
const XS_BG_TOL = 40;             // RGB distance still flooded through
const XS_BG_CENTER_MAX = 0.5;     // ...but only if the middle is this much clearer of it
function xsClearEdgeBackground(grid, W, H, fit) {
  const x1 = fit.dx + fit.dw, y1 = fit.dy + fit.dh;
  const ring = [];
  for (let x = fit.dx; x < x1; x++) { ring.push(fit.dy * W + x, (y1 - 1) * W + x); }
  for (let y = fit.dy + 1; y < y1 - 1; y++) { ring.push(y * W + fit.dx, y * W + x1 - 1); }
  const tally = new Map();
  for (const i of ring) if (grid[i]) tally.set(grid[i], (tally.get(grid[i]) || 0) + 1);
  // Crowding the border isn't enough on its own: a cream tablecloth around a
  // cream-mounted hoop is the same color in both places, and a flood that can't
  // tell them apart walks straight through the subject. So a color also has to
  // be scarce in the middle of the motif to be believed as background.
  const mid = new Map();
  const mx0 = fit.dx + Math.floor(fit.dw * 0.25), mx1 = fit.dx + Math.ceil(fit.dw * 0.75);
  const my0 = fit.dy + Math.floor(fit.dh * 0.25), my1 = fit.dy + Math.ceil(fit.dh * 0.75);
  for (let y = my0; y < my1; y++) for (let x = mx0; x < mx1; x++) {
    const v = grid[y * W + x];
    if (v) mid.set(v, (mid.get(v) || 0) + 1);
  }
  const midArea = Math.max(1, (mx1 - mx0) * (my1 - my0));
  const bgHex = [...tally.entries()]
    .filter(([hex, n]) => n >= ring.length * XS_BG_BORDER_SHARE
      && (mid.get(hex) || 0) / midArea <= (n / ring.length) * XS_BG_CENTER_MAX)
    .sort((a, b) => b[1] - a[1]).slice(0, XS_BG_MAX_COLORS).map(([hex]) => hexToRgb(hex));
  if (!bgHex.length) return;
  // A chart only ever holds palette colors, so each one is judged once.
  const verdict = new Map();
  const isBg = hex => {
    if (!hex) return true;                       // already bare fabric — flood through it
    let v = verdict.get(hex);
    if (v === undefined) {
      const c = hexToRgb(hex);
      v = bgHex.some(k => (c.r - k.r) ** 2 + (c.g - k.g) ** 2 + (c.b - k.b) ** 2 <= XS_BG_TOL * XS_BG_TOL);
      verdict.set(hex, v);
    }
    return v;
  };
  const before = grid.slice(), stack = [];
  let cleared = 0;
  const push = (x, y) => {
    if (x < fit.dx || y < fit.dy || x >= x1 || y >= y1) return;
    const i = y * W + x;
    if (grid[i] === null || !isBg(grid[i])) return;
    grid[i] = null; cleared++; stack.push(i);
  };
  for (const i of ring) push(i % W, Math.floor(i / W));
  while (stack.length) {
    const i = stack.pop(), x = i % W, y = (i - x) / W;
    push(x - 1, y); push(x + 1, y); push(x, y - 1); push(x, y + 1);
  }
  if (cleared > fit.dw * fit.dh * XS_FIELD_MAX_CLEAR) for (let i = 0; i < grid.length; i++) grid[i] = before[i];
}

// Sample an <img> into a W×H grid, snapping each cell to the nearest chosen
// color → a ready-to-stitch design (shared by the cross-stitch template step).
// Cells outside the fitted motif are left null: unstitched fabric.
export function buildGridFromImage(img, chosen, W, H, { simplify = XS_SIMPLIFY_DEFAULT, removeBg = true } = {}) {
  if (!img || !chosen || !chosen.length) return null;
  const fit = xsFitImageToGrid(img, W, H);
  if (!fit) return null;
  const sampled = xsSampleCells(img, fit, W, H);
  if (!sampled) return null;
  const spec = xsSimplifySpec(simplify);
  // A 40-stitch coaster can't take the blur a 120-stitch hoop can — three
  // passes there would erase the subject — so both knobs scale with the motif.
  const passes = Math.min(spec.blur, Math.max(0, Math.round(Math.min(fit.dw, fit.dh) / 22)));
  const speck = Math.round(spec.speck * (fit.dw * fit.dh) / (70 * 70));
  const soft = xsBlurCells(sampled.rgb, sampled.cover, W, H, passes);
  const bg = xsTrimRect(img).bg;
  const grid = new Array(W * H).fill(null);
  const isField = bg ? new Uint8Array(W * H) : null;
  for (let i = 0; i < W * H; i++) {
    if (sampled.cover[i] < 0.4) continue;
    if (bg) {
      // Read the field off the UNBLURRED sample: blurring bleeds the subject
      // into the margin, and a border cell that no longer matches the field
      // would strand the flood fill and leave the whole ground stitched.
      const dr = sampled.rgb[i * 3] - bg.r, dg = sampled.rgb[i * 3 + 1] - bg.g, db = sampled.rgb[i * 3 + 2] - bg.b;
      if (dr * dr + dg * dg + db * db <= XS_TRIM_TOL * XS_TRIM_TOL) isField[i] = 1;
    }
    const near = nearestInList({ r: soft[i * 3], g: soft[i * 3 + 1], b: soft[i * 3 + 2] }, chosen);
    grid[i] = near ? near.hex : null;
  }
  // Clear the ground before tidying, so the fringe left along the silhouette
  // has bare fabric to be absorbed into.
  if (bg && removeBg) xsClearGroundField(grid, isField, W, H, fit);
  let out = grid;
  for (let p = 0; p < spec.smooth; p++) out = xsMajorityPass(out, W, H, fit);
  // A photograph's background only reads as one color once the chart has been
  // flattened, so this waits until after the smoothing passes — then one more
  // pass tidies the silhouette the flood just cut.
  if (removeBg) {
    xsClearEdgeBackground(out, W, H, fit);
    if (spec.smooth) out = xsMajorityPass(out, W, H, fit);
  }
  xsDespeckle(out, W, H, fit, speck);
  return out;
}

// Shared image intake: file picker, drag-and-drop, clipboard paste, and http(s)
// URL. Always resolves to a same-origin data URL so canvas sampling
// (extractColors / sampleImageHex) works the same as a chosen file.
function isHttpImageUrl(value) {
  try {
    const u = new URL(String(value || '').trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (e) { return false; }
}

function fileNameFromUrl(value) {
  try {
    const path = new URL(String(value || '').trim()).pathname.split('/').pop();
    if (path) return decodeURIComponent(path);
  } catch (e) {}
  return 'image';
}

function imageFileFromClipboard(e) {
  const dt = e.clipboardData;
  if (!dt) return null;
  if (dt.files && dt.files.length) {
    for (let i = 0; i < dt.files.length; i++) {
      if (dt.files[i].type && dt.files[i].type.startsWith('image/')) return dt.files[i];
    }
  }
  if (dt.items) {
    for (let i = 0; i < dt.items.length; i++) {
      const it = dt.items[i];
      if (it.kind === 'file' && it.type && it.type.startsWith('image/')) {
        const f = it.getAsFile();
        if (f) return f;
      }
    }
  }
  return null;
}

function plainTextFromClipboard(e) {
  try { return (e.clipboardData && e.clipboardData.getData('text/plain')) || ''; }
  catch (err) { return ''; }
}

function readBlobAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = ev => resolve(ev.target.result);
    reader.onerror = () => reject(new Error('Could not read that image.'));
    reader.readAsDataURL(blob);
  });
}

function confirmImageSrc(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(src);
    img.onerror = () => reject(new Error('That URL does not look like an image.'));
    img.src = src;
  });
}

const REMOTE_IMAGE_ERR = "Couldn't load that image. Check the URL, or the site may block it. Try saving the file and dropping it instead.";
const REMOTE_CORS_ERR = "Couldn't read that image (the site blocks it). Try saving the file and dropping it instead.";

function loadImageViaElement(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const cv = document.createElement('canvas');
        cv.width = img.naturalWidth || img.width;
        cv.height = img.naturalHeight || img.height;
        if (!cv.width || !cv.height) { reject(new Error('That URL does not look like an image.')); return; }
        const ctx = cv.getContext('2d');
        ctx.drawImage(img, 0, 0);
        resolve(cv.toDataURL('image/png'));
      } catch (e) {
        reject(new Error(REMOTE_CORS_ERR));
      }
    };
    img.onerror = () => reject(new Error(REMOTE_IMAGE_ERR));
    img.src = url;
  });
}

function loadRemoteImageSrc(url) {
  const trimmed = String(url || '').trim();
  return fetch(trimmed, { mode: 'cors' })
    .then(res => {
      if (!res.ok) throw new Error('http');
      const ct = ((res.headers.get('content-type') || '').split(';')[0] || '').trim();
      if (ct && !ct.startsWith('image/') && ct !== 'application/octet-stream') throw new Error('not-image');
      return res.blob();
    })
    .then(blob => {
      if (blob.type && !blob.type.startsWith('image/') && blob.type !== 'application/octet-stream') {
        throw new Error('not-image');
      }
      return readBlobAsDataUrl(blob).then(confirmImageSrc);
    })
    .catch(err => {
      if (err && err.message === 'not-image') {
        return Promise.reject(new Error('That URL does not look like an image.'));
      }
      return loadImageViaElement(trimmed);
    });
}

const PASTE_SHORTCUT = (typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || ''))
  ? '⌘V'
  : 'Ctrl+V';

// Knock the edge-connected field off a photo so "Remove background" is a real
// cutout, not just a later chart setting. Floods from the border so a matching
// color inside the subject stays. Returns a PNG data URL, or null if nothing
// is safe to punch (busy photograph, already transparent, or a near-empty result).
const PUNCH_TOL = 38;
const PUNCH_MAX_CLEAR = 0.92;
const PUNCH_MIN_CLEAR = 0.02;
export function punchImageBackground(img, { maxDim = 720 } = {}) {
  if (!img || !img.width || !img.height) return null;
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  let id; try { id = ctx.getImageData(0, 0, w, h); } catch (e) { return null; }
  const data = id.data, n = w * h;
  const buckets = new Map();
  const addBorder = i => {
    const k = data[i * 4 + 3] < 32 ? 'clear'
      : `${data[i * 4] >> 4},${data[i * 4 + 1] >> 4},${data[i * 4 + 2] >> 4}`;
    buckets.set(k, (buckets.get(k) || 0) + 1);
  };
  for (let x = 0; x < w; x++) { addBorder(x); addBorder((h - 1) * w + x); }
  for (let y = 1; y < h - 1; y++) { addBorder(y * w); addBorder(y * w + w - 1); }
  const borderN = [...buckets.values()].reduce((a, b) => a + b, 0);
  if (!borderN) return null;
  const clearShare = (buckets.get('clear') || 0) / borderN;
  if (clearShare >= 0.6) return null;
  const mid = new Map();
  const mx0 = Math.floor(w * 0.25), mx1 = Math.ceil(w * 0.75);
  const my0 = Math.floor(h * 0.25), my1 = Math.ceil(h * 0.75);
  const midArea = Math.max(1, (mx1 - mx0) * (my1 - my0));
  for (let y = my0; y < my1; y++) {
    for (let x = mx0; x < mx1; x++) {
      const p = (y * w + x) * 4;
      if (data[p + 3] < 32) continue;
      const k = `${data[p] >> 4},${data[p + 1] >> 4},${data[p + 2] >> 4}`;
      mid.set(k, (mid.get(k) || 0) + 1);
    }
  }
  const field = [...buckets.entries()]
    .filter(([k, c]) => k !== 'clear'
      && c / borderN >= 0.12
      && (mid.get(k) || 0) / midArea <= (c / borderN) * 0.5)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k]) => {
      const [r, g, b] = k.split(',').map(Number);
      return { r: r * 16 + 8, g: g * 16 + 8, b: b * 16 + 8 };
    });
  if (!field.length) return null;
  const tol = PUNCH_TOL * PUNCH_TOL;
  const isField = i => {
    if (data[i * 4 + 3] < 32) return true;
    return field.some(c => {
      const dr = data[i * 4] - c.r, dg = data[i * 4 + 1] - c.g, db = data[i * 4 + 2] - c.b;
      return dr * dr + dg * dg + db * db <= tol;
    });
  };
  const seen = new Uint8Array(n), stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (seen[i] || !isField(i)) return;
    seen[i] = 1; stack.push(i);
  };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 1; y < h - 1; y++) { push(0, y); push(w - 1, y); }
  while (stack.length) {
    const i = stack.pop(), x = i % w, y = (i - x) / w;
    push(x - 1, y); push(x + 1, y); push(x, y - 1); push(x, y + 1);
  }
  let cleared = 0;
  for (let i = 0; i < n; i++) if (seen[i] && data[i * 4 + 3] >= 32) cleared++;
  const opaque = n * (1 - clearShare);
  if (cleared < opaque * PUNCH_MIN_CLEAR || cleared > opaque * PUNCH_MAX_CLEAR) return null;
  for (let i = 0; i < n; i++) if (seen[i]) data[i * 4 + 3] = 0;
  const soft = PUNCH_TOL * 1.6, soft2 = soft * soft;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (seen[i] || data[i * 4 + 3] < 32) continue;
      if (!((x > 0 && seen[i - 1]) || (x < w - 1 && seen[i + 1])
        || (y > 0 && seen[i - w]) || (y < h - 1 && seen[i + w]))) continue;
      let best = Infinity;
      for (const c of field) {
        const dr = data[i * 4] - c.r, dg = data[i * 4 + 1] - c.g, db = data[i * 4 + 2] - c.b;
        const d = dr * dr + dg * dg + db * db;
        if (d < best) best = d;
      }
      if (best < soft2) data[i * 4 + 3] = Math.round(data[i * 4 + 3] * (best / soft2));
    }
  }
  ctx.putImageData(id, 0, 0);
  return cv.toDataURL('image/png');
}

// Drop zone + optional URL field used by PhotoDrop and PhotoUpload so paste/URL
// land in one place. Calls onSrc(dataUrl) — same path as a chosen file.
// Desktop: slim dashed drop row + pills. Mobile: "+ add image" opens a sheet.
// `utility` is the brand shell's compact form: one row of label + source
// buttons, with the whole strip still acting as the drop target. Same handlers
// and same sources as the other variants — only the layout differs.
function PhotoIntakeZone({ variant = 'pal', title, subtitle, onSrc, working = false, workingLabel, extra }) {
  const isMobile = useIsMobile();
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState('');
  const [urlText, setUrlText] = useState('');
  const [showUrl, setShowUrl] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef(null);
  const cameraRef = useRef(null);
  const urlRef = useRef(null);
  const urlId = useId();
  const busy = loading || working;
  const shownTitle = busy
    ? ((working && workingLabel) ? workingLabel : 'Loading…')
    : (variant === 'tmpl' ? 'Drop an image in this area, or' : 'Drop an image here');
  const ariaLabel = title || shownTitle;
  const isUtility = variant === 'utility';
  const heading = variant === 'tmpl' ? 'Create a design from an image' : null;
  // The utility strip reuses the tmpl drop/pill boxes (and its whole-strip drop
  // handlers), so it counts as `isTmpl` for everything except the heading.
  const isTmpl = variant === 'tmpl' || isUtility;

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    setShowUrl(false);
    setUrlText('');
    setError('');
  }, []);

  const acceptFile = useCallback(file => {
    if (!file || !file.type || !file.type.startsWith('image/')) {
      setError('Please choose a JPG, PNG, or WebP image.');
      return;
    }
    setError('');
    setShowUrl(false);
    setUrlText('');
    setLoading(true);
    const reader = new FileReader();
    reader.onload = ev => {
      setLoading(false);
      setError('');
      setMenuOpen(false);
      onSrc(ev.target.result, { name: file.name || 'image' });
    };
    reader.onerror = () => { setLoading(false); setError('Could not read that file.'); };
    reader.readAsDataURL(file);
  }, [onSrc]);

  const acceptUrl = useCallback(raw => {
    const url = String(raw || '').trim();
    setUrlText(url);
    setShowUrl(true);
    if (isMobile) setMenuOpen(true);
    if (!isHttpImageUrl(url)) {
      setError('Enter an http(s) image URL.');
      return;
    }
    setError('');
    setLoading(true);
    loadRemoteImageSrc(url)
      .then(src => { setLoading(false); setError(''); setMenuOpen(false); setShowUrl(false); setUrlText(''); onSrc(src, { name: fileNameFromUrl(url) }); })
      .catch(err => { setLoading(false); setError((err && err.message) || REMOTE_IMAGE_ERR); });
  }, [onSrc, isMobile]);

  useEffect(() => {
    const onPaste = e => {
      const file = imageFileFromClipboard(e);
      if (file) { e.preventDefault(); acceptFile(file); return; }
      const target = e.target;
      const tag = target && target.tagName;
      const isField = tag === 'INPUT' || tag === 'TEXTAREA' || (target && target.isContentEditable);
      const isOurs = target && target.closest && target.closest('.pal-upload-url');
      if (isField && !isOurs) return;
      const text = plainTextFromClipboard(e);
      if (text && isHttpImageUrl(text)) {
        e.preventDefault();
        acceptUrl(text);
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [acceptFile, acceptUrl]);

  useEffect(() => {
    if (showUrl && urlRef.current) urlRef.current.focus();
  }, [showUrl]);

  const onDrop = e => {
    e.preventDefault();
    setDrag(false);
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file && file.type && file.type.startsWith('image/')) { acceptFile(file); return; }
    const text = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || '').split('\n')[0].trim();
    if (isHttpImageUrl(text)) acceptUrl(text);
  };

  const onFileChange = e => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    acceptFile(file);
  };
  const openPicker = () => { if (fileRef.current) fileRef.current.click(); };
  const openCamera = () => { if (cameraRef.current) cameraRef.current.click(); };
  const onHitKey = e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker(); }
  };
  const toggleUrlField = () => {
    setShowUrl(open => {
      if (open) setError('');
      return !open;
    });
  };
  const pasteImageFromClipboard = () => {
    if (!navigator.clipboard || typeof navigator.clipboard.read !== 'function') {
      setError(`Press ${PASTE_SHORTCUT} to paste an image.`);
      return;
    }
    navigator.clipboard.read().then(items => {
      for (const item of items) {
        const type = (item.types || []).find(t => t.startsWith('image/'));
        if (!type) continue;
        return item.getType(type).then(blob => {
          const ext = (type.split('/')[1] || 'png').split('+')[0];
          acceptFile(new File([blob], `pasted.${ext}`, { type: blob.type || type }));
        });
      }
      setError(`Press ${PASTE_SHORTCUT} to paste an image.`);
    }).catch(() => {
      setError(`Press ${PASTE_SHORTCUT} to paste an image.`);
    });
  };

  const urlRow = showUrl ? (
    <div className="pal-upload-url">
      <label className="pal-upload-url-label" htmlFor={urlId}>Image URL</label>
      <div className="pal-upload-url-row">
        <input
          id={urlId}
          ref={urlRef}
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck="false"
          placeholder="https://"
          value={urlText}
          disabled={busy}
          onChange={e => { setUrlText(e.target.value); if (error) setError(''); }}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); acceptUrl(urlText); } }}
        />
        <button type="button" disabled={busy || !urlText.trim()} onClick={() => acceptUrl(urlText)}>Fetch</button>
      </div>
    </div>
  ) : null;
  const errNode = error ? <div className="err-msg pal-upload-error" role="alert">{error}</div> : null;
  const fileInputs = (
    <>
      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onFileChange}/>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={onFileChange}/>
    </>
  );
  const dropProps = {
    onDragOver: e => { e.preventDefault(); setDrag(true); },
    onDragLeave: () => setDrag(false),
    onDrop,
  };
  const pills = (
    <div className="pal-upload-pills">
      <button type="button" className="pal-upload-pill" onClick={openPicker} disabled={busy}>
        Browse
      </button>
      <button type="button" className="pal-upload-pill" onClick={pasteImageFromClipboard} disabled={busy}>
        Paste an image
      </button>
      <button
        type="button"
        className="pal-upload-pill"
        aria-pressed={showUrl}
        onClick={toggleUrlField}
        disabled={busy}>
        Paste a URL
      </button>
    </div>
  );

  const methodBtn = (key, icon, label, sub, onClick, pressed) => (
    <button
      type="button"
      className="pal-upload-method"
      aria-pressed={pressed || undefined}
      onClick={onClick}
      disabled={busy}>
      <span className="pal-upload-method-icon">{icon}</span>
      <span className="pal-upload-method-copy">
        <span className="pal-upload-method-title">{label}</span>
        <span className="pal-upload-method-sub">{sub}</span>
      </span>
    </button>
  );

  const menu = menuOpen ? (
    <BottomSheet
      onClose={closeMenu}
      title="Add an image"
      elevated
      sheetClassName="pal-upload-sheet">
      <div className="pal-upload-sheet-body">
        <div className="pal-upload-sheet-hint">JPG, PNG, or WebP</div>
        {methodBtn('camera', <IcCamera size={20}/>, 'Take a photo', 'Use your camera.', openCamera)}
        {methodBtn('files', <IcImage size={20}/>, 'Choose from your photos', 'Camera roll or files.', openPicker)}
        {methodBtn('paste', <IcPaste size={20}/>, 'Paste from clipboard', 'Whatever you last copied.', pasteImageFromClipboard)}
        <div className="pal-upload-method-block">
          {methodBtn('url', <IcLink size={20}/>, 'Use an image link', 'Paste a URL to an image.', toggleUrlField, showUrl)}
          {urlRow}
        </div>
        {errNode}
      </div>
    </BottomSheet>
  ) : null;

  if (isUtility) {
    const label = (
      <div className="brand-utility-text">
        <div className="brand-utility-title">{title || 'Start from your own image'}</div>
        <div className="brand-utility-sub">
          {busy ? (workingLabel || 'Loading…') : (subtitle || 'JPG, PNG or WebP.')}
        </div>
      </div>
    );
    if (isMobile) {
      return (
        <div className="brand-utility-intake">
          {label}
          <div className="brand-utility-actions">
            <button
              type="button"
              className="brand-btn"
              onClick={() => { setError(''); setShowUrl(false); setMenuOpen(true); }}
              disabled={busy}
              aria-haspopup="dialog"
              aria-expanded={menuOpen}>
              Add an image
            </button>
            {extra}
          </div>
          {menu}
          {fileInputs}
        </div>
      );
    }
    return (
      <div className="brand-utility-intake" {...dropProps}>
        {label}
        <div className="brand-utility-actions">
          {pills}
          {extra}
        </div>
        {showUrl && <div className="brand-utility-url">{urlRow}</div>}
        {errNode}
        {fileInputs}
      </div>
    );
  }

  if (isMobile) {
    return (
      <div className={isTmpl ? 'tmpl-upload' : 'pal-upload'}>
        {heading && <div className="tmpl-upload-heading">{heading}</div>}
        <button
          type="button"
          className="pal-btn secondary pal-upload-add"
          onClick={() => { setError(''); setShowUrl(false); setMenuOpen(true); }}
          disabled={busy}
          aria-haspopup="dialog"
          aria-expanded={menuOpen}>
          + add image
        </button>
        {menu}
        {fileInputs}
      </div>
    );
  }

  const drop = (
    <div
      className={`${isTmpl ? 'tmpl-upload-drop' : 'pal-upload-drop'} pal-upload-hit${drag ? ' drag' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      onClick={openPicker}
      onKeyDown={onHitKey}
      {...dropProps}>
      <div className="pal-upload-icon"><IcImage size={isTmpl ? 24 : 18}/></div>
      <div className={isTmpl ? 'tmpl-upload-title' : 'pal-upload-title'}>{shownTitle}</div>
    </div>
  );

  return (
    <div className={isTmpl ? 'tmpl-upload' : 'pal-upload'} {...(isTmpl ? dropProps : {})}>
      {heading && <div className="tmpl-upload-heading">{heading}</div>}
      {isTmpl && showUrl ? urlRow : drop}
      {pills}
      {!(isTmpl && showUrl) && urlRow}
      {errNode}
      {fileInputs}
    </div>
  );
}

// Reusable photo → palette uploader. Manages its own file/extraction state and
// reports the kept colors + image (+ any option toggles) via onApply. Used by
// the quilt palette page (Kona) and the cross-stitch template page (DMC).
function PhotoUpload({ nearest, idKey = 'name', paletteSize = 8, count = 32, applyLabel = 'Use these colors', hint, options = [], onApply }) {
  const [imgSrc, setImgSrc] = useState(null);
  const [extracted, setExtracted] = useState(null);
  const [pool, setPool] = useState([]);
  const [locked, setLocked] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [opts, setOpts] = useState(() => { const o = {}; options.forEach(d => o[d.key] = d.default ?? false); return o; });
  const imgElRef = useRef(null);
  const idOf = c => c[idKey];

  const ingestSrc = useCallback(src => {
    setBusy(true);
    const img = new Image();
    img.onload = () => {
      imgElRef.current = img;
      const maxDim = 160, scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0, w, h);
      let pixels; try { pixels = ctx.getImageData(0, 0, w, h); } catch (e) { setBusy(false); return; }
      const raw = extractColors(pixels, count), seen = new Set(), colors = [];
      for (const c of raw) { const k = nearest(c); if (k && !seen.has(k[idKey])) { seen.add(k[idKey]); colors.push(k); } }
      setImgSrc(src); setPool(colors); setLocked(new Set());
      setExtracted(colors.slice(0, Math.min(paletteSize, colors.length))); setBusy(false);
    };
    img.onerror = () => setBusy(false);
    img.src = src;
  }, [nearest, idKey, paletteSize, count]);

  const toggleLock = useCallback(id => { setLocked(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; }); }, []);
  const shuffle = arr => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const regenerate = useCallback(() => {
    if (!pool.length) return;
    setExtracted(prev => {
      if (!prev) return prev;
      const lk = new Set(prev.filter(c => locked.has(idOf(c))).map(idOf));
      const fill = shuffle(pool.filter(c => !lk.has(idOf(c)))); let fi = 0;
      return prev.map(c => lk.has(idOf(c)) ? c : (fill[fi++] || c));
    });
  }, [pool, locked]);
  const resetUpload = () => { setImgSrc(null); setExtracted(null); setPool([]); setLocked(new Set()); imgElRef.current = null; };
  const apply = () => {
    if (!extracted || !extracted.length) return;
    const kept = extracted.filter(c => locked.has(idOf(c)));
    const chosen = kept.length ? kept : extracted;
    onApply(chosen, { imgSrc, imgEl: imgElRef.current, options: opts });
  };

  return (
    <section className="pal-section">
      <div className="pal-section-head">
        <div className="pal-section-title">Upload an image</div>
        {hint && <div className="pal-section-sub">{hint}</div>}
      </div>
      {!extracted && (
        <PhotoIntakeZone
          title="Drop an image here or click to browse"
          subtitle="JPG, PNG, or WebP, or paste an image"
          onSrc={ingestSrc}
          working={busy}
          workingLabel="Reading colors…"/>
      )}
      {extracted && (
        <div className="pal-result">
          <img className="pal-result-preview" src={imgSrc} alt="Uploaded reference"/>
          <div className="pal-result-main">
            <div className="pal-section-sub" style={{ marginBottom: 6 }}>{extracted.length} colors found. Check the ones you want to keep (they stay when you regenerate and are the only colors added). Leave all unchecked to use them all.</div>
            <div className="pal-result-swatches">
              {extracted.map(c => {
                const isLocked = locked.has(idOf(c));
                return (
                  <label key={idOf(c)} className={`pal-chip${isLocked ? ' locked' : ''}`} title={c.code ? `DMC ${c.code} · ${c.name}` : `${c.name} ${c.hex}`}>
                    <input type="checkbox" className="pal-chip-check" checked={isLocked} onChange={() => toggleLock(idOf(c))}/>
                    <span className="pal-chip-color" style={{ background: c.hex }}/>
                    <span className="pal-chip-label">{c.code ? `${c.code} ${c.name}` : c.name}</span>
                  </label>
                );
              })}
            </div>
            {options.map(d => (
              <label key={d.key} className="pal-check">
                <input type="checkbox" checked={!!opts[d.key]} onChange={e => setOpts(o => ({ ...o, [d.key]: e.target.checked }))}/>
                {d.label}
              </label>
            ))}
            <div className="pal-actions">
              <button className="pal-btn" onClick={apply}>{applyLabel}</button>
              {pool.length > 1 && (
                <button className="pal-btn secondary" onClick={regenerate} title="Shuffle the palette">
                  <IcShuffle/>
                  Regenerate
                </button>
              )}
              <button className="pal-btn secondary" onClick={resetUpload}>Choose another</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// Upload-only photo picker for the cross-stitch template step. It just captures
// the image (as a data URL) and hands it forward — NO color extraction here.
// All color work (suggested palette, swapping) happens on the palette step.
export function PhotoDrop({ hint, resultHint, useLabel = 'Use this photo', onChoose, layout, extra }) {
  const [imgSrc, setImgSrc] = useState(null);
  const [fileName, setFileName] = useState('image');
  const [fileDims, setFileDims] = useState(null);
  const [removeBg, setRemoveBg] = useState(true);
  const [cutoutSrc, setCutoutSrc] = useState(null);
  const punchGen = useRef(0);
  const ingestSrc = useCallback((src, meta) => {
    const gen = ++punchGen.current;
    setImgSrc(src);
    setFileName((meta && meta.name) || 'image');
    setFileDims(null);
    setCutoutSrc(null);
    const img = new Image();
    img.onload = () => {
      if (gen !== punchGen.current) return;
      setFileDims({ w: img.naturalWidth, h: img.naturalHeight });
      requestAnimationFrame(() => {
        if (gen !== punchGen.current) return;
        setCutoutSrc(punchImageBackground(img));
      });
    };
    img.src = src;
  }, []);
  const reset = () => {
    punchGen.current++;
    setImgSrc(null); setFileName('image'); setFileDims(null); setRemoveBg(true); setCutoutSrc(null);
  };
  const resultCopy = resultHint || "We'll suggest a palette from this photo on the next step and use it to guide your design.";
  const displaySrc = removeBg && cutoutSrc ? cutoutSrc : imgSrc;
  const confirm = () => onChoose(displaySrc || imgSrc, { removeBg, name: fileName });
  // Brand shell: one compact strip. Empty state offers the sources; once an
  // image is in, the same strip becomes the confirm row. Same actions as the
  // `bar` layout, just folded into a single line of furniture.
  if (layout === 'utility') {
    return (
      <section className="brand-utility brand-bleed">
        {!imgSrc ? (
          <PhotoIntakeZone
            variant="utility"
            title="Start from your own image"
            subtitle={hint}
            extra={extra}
            onSrc={ingestSrc}/>
        ) : (
          <div className="brand-utility-result">
            <img className={`tmpl-upload-preview${removeBg && cutoutSrc ? ' is-cutout' : ''}`}
              src={displaySrc} alt="Uploaded reference"/>
            <div className="brand-utility-result-meta">
              <div className="tmpl-upload-file-name">{fileName}</div>
              <BrandSpecs rows={[{ k: 'Source', v: fileDims ? `${fileDims.w} × ${fileDims.h} px` : null }]}/>
              <Switch checked={removeBg} onChange={setRemoveBg} label="Remove background"/>
            </div>
            <div className="brand-utility-actions">
              <button type="button" className="tmpl-upload-use" onClick={confirm}>{useLabel}</button>
              <button type="button" className="tmpl-upload-another" onClick={reset}>Choose another</button>
            </div>
          </div>
        )}
      </section>
    );
  }
  if (layout === 'bar') {
    return (
      <section className="tmpl-upload-bar">
        {!imgSrc ? (
          <PhotoIntakeZone
            variant="tmpl"
            title="Drop an image in this area, or"
            subtitle={hint || 'JPG, PNG, or WebP, or paste an image'}
            onSrc={ingestSrc}/>
        ) : (
          <div className="tmpl-upload-result">
            <div className="tmpl-upload-file">
              <img className={`tmpl-upload-preview${removeBg && cutoutSrc ? ' is-cutout' : ''}`}
                src={displaySrc} alt="Uploaded reference"/>
              <div className="tmpl-upload-file-meta">
                <div>
                  <div className="tmpl-upload-file-name">{fileName}</div>
                  <div className="tmpl-upload-file-dims">{fileDims ? `${fileDims.w}px × ${fileDims.h}px` : ''}</div>
                </div>
                <Switch checked={removeBg} onChange={setRemoveBg} label="Remove background"/>
              </div>
            </div>
            <div className="tmpl-upload-actions">
              <button type="button" className="tmpl-upload-use" onClick={confirm}>{useLabel}</button>
              <button type="button" className="tmpl-upload-another" onClick={reset}>Choose another</button>
            </div>
          </div>
        )}
      </section>
    );
  }
  return (
    <section className="pal-section">
      <div className="pal-section-head">
        <div className="pal-section-title">Upload a photo</div>
        {hint && <div className="pal-section-sub">{hint}</div>}
      </div>
      {!imgSrc ? (
        <PhotoIntakeZone
          title="Drop a photo here or click to browse"
          subtitle="JPG, PNG, or WebP, or paste an image"
          onSrc={ingestSrc}/>
      ) : (
        <div className="pal-result">
          <img className="pal-result-preview" src={imgSrc} alt="Uploaded reference"/>
          <div className="pal-result-main">
            <div className="pal-section-sub" style={{ marginBottom: 12 }}>{resultCopy}</div>
            <div className="pal-actions">
              <button className="pal-btn" onClick={() => onChoose(imgSrc)}>{useLabel}</button>
              <button className="pal-btn secondary" onClick={reset}>Choose another</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
