// ── Setup: templates + shared photo uploader ───────────────────────────────
// Split a length into `n` near-equal integer segments → [[start,size],…].
function tplSegments(total, n) {
  const segs = []; let acc = 0;
  for (let i = 0; i < n; i++) {
    const size = Math.round(total * (i + 1) / n) - Math.round(total * i / n);
    segs.push([acc, size]); acc += size;
  }
  return segs;
}
// How many "patches" a quilt pattern tiles into, scaled to the grid.
function tplPatchCount(cols, rows) {
  const unit = Math.max(2, Math.round(Math.min(cols, rows) / 8));
  return { nx: Math.max(2, Math.round(cols / unit)), ny: Math.max(2, Math.round(rows / unit)) };
}
const tplKona = n => konaByName(n) || KONA[0];
// The colors a layout will actually sew with: the whole chosen palette when
// there is one, otherwise the named Kona defaults that belong to that chart.
// Cycling the whole list — not just the first two — is what keeps a six-color
// palette from collapsing into the same navy-and-white two-tone on every card.
function tplSwatches(palette, fallbacks) {
  if (palette && palette.length) return palette;
  return fallbacks.map(tplKona);
}
function tplTriPoints(s) {
  const { r, c, w, h } = s;
  if (s.dir === '/') return s.half === 'a'
    ? `${c},${r} ${c + w},${r} ${c},${r + h}`
    : `${c + w},${r} ${c + w},${r + h} ${c},${r + h}`;
  return s.half === 'a'
    ? `${c},${r} ${c + w},${r} ${c + w},${r + h}`
    : `${c},${r} ${c},${r + h} ${c + w},${r + h}`;
}

// Lily's Quilt, a 10×12 baby-blanket plaid: ground bands ('g') crossed by
// vertical ('v') and horizontal ('h') stripes, each crossing its own fabric.
// Sizes are in blocks. The repeat (all but the closing ground band) tiles about
// once per Lily-sized span, so a throw gets more plaid rather than bigger
// patches. Every band keeps at least one block and only the wide bands stretch
// or shrink to fit, because a band rounded away merges its neighbours into one
// stripe. → [[start, size, role], …]
const LILY_COLS = [[1, 'g'], [1, 'v'], [1, 'g'], [3, 'v'], [1, 'g'], [2, 'v'], [1, 'g']];
const LILY_ROWS = [[1, 'g'], [2, 'h'], [1, 'g'], [2, 'h'], [1, 'g'], [2, 'h'], [1, 'g'], [1, 'h'], [1, 'g']];
function lilyBands(bands, total, native) {
  const repeats = Math.max(1, Math.round(total / native));
  const seq = [];
  for (let i = 0; i < repeats; i++) seq.push(...bands.slice(0, -1));
  seq.push(bands[bands.length - 1]);
  // Too small for the full band set (coasters): one-block windowpane.
  if (total < seq.length) {
    const stripe = bands.find(([, role]) => role !== 'g')[1];
    return Array.from({ length: total }, (_, i) => [i, 1, i % 2 ? stripe : 'g']);
  }
  const extra = total - seq.length;
  const wide = seq.reduce((s, [n]) => s + n - 1, 0) || 1;
  const out = [];
  let start = 0, acc = 0;
  for (const [n, role] of seq) {
    const before = Math.round(extra * acc / wide);
    acc += n - 1;
    const size = 1 + Math.round(extra * acc / wide) - before;
    out.push([start, size, role]);
    start += size;
  }
  return out;
}

// Size-adaptive quilt starter layouts. build({cols,rows,palette}) → shapes[]
// (same shape objects the editor paints), so they tile/scale to any chosen
// preset. When `palette` (the colors picked on the palette step) is supplied,
// each layout colors its patches from it; otherwise it uses sensible defaults.
// There's no "Blank" card in the grid — "Skip for now" is the empty-canvas route.
const QUILT_TEMPLATES = [
  {
    id: 'checkerboard', name: 'Checkerboard', desc: 'Alternating squares in two or more fabrics.',
    build: ({ cols, rows, palette }) => {
      // One fabric holds the even squares so it still reads as a checker; the
      // odd squares walk the rest of the palette, which is how a scrappy
      // postage-stamp quilt shows every fabric without losing the grid.
      const colors = tplSwatches(palette, ['Bone', 'Hyacinth', 'Spice', 'Zucchini', 'Flame', 'Lilac']);
      const ground = colors[0];
      const prints = colors.length > 1 ? colors.slice(1) : colors;
      const { nx, ny } = tplPatchCount(cols, rows);
      const sx = tplSegments(cols, nx), sy = tplSegments(rows, ny), out = [];
      sy.forEach(([r, h], ri) => sx.forEach(([c, w], ci) => {
        if (w <= 0 || h <= 0) return;
        const color = (ri + ci) % 2 === 0 ? ground : prints[(ri * 3 + ci) % prints.length];
        out.push({ id: `tpl-${ri}-${ci}`, r, c, w, h, type: 'square', color });
      }));
      return out;
    }
  },
  {
    id: 'plaid', name: 'Plaid', desc: 'Wide and narrow stripes that cross like a woven plaid.',
    build: ({ cols, rows, palette }) => {
      // Ground, one vertical stripe, then (stripe, crossing) pairs for the
      // horizontal bands. Extra palette colors become extra pairs, so a longer
      // palette varies the rows instead of being dropped; a short one lets the
      // crossings fall back to the vertical stripe so it still reads as plaid.
      // The lightest color takes the ground: palettes aren't ordered light to
      // dark, and the plaid only reads when the stripes sit on something pale.
      const swatches = tplSwatches(palette, ['Natural', 'Mustard', 'Creamsicle', 'Terracotta', 'Dusty Blue', 'Tarragon']);
      const lum = c => { const n = parseInt(c.hex.slice(1), 16); return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255); };
      const ground = swatches.reduce((a, b) => (lum(b) > lum(a) ? b : a));
      const colors = [ground, ...swatches.filter(c => c !== ground)];
      const vert = colors[1] || ground;
      const pairs = [];
      for (let i = 2; i < colors.length; i += 2) pairs.push([colors[i], colors[i + 1] || vert]);
      if (!pairs.length) pairs.push([vert, vert]);
      const xs = lilyBands(LILY_COLS, cols, 10), ys = lilyBands(LILY_ROWS, rows, 12), out = [];
      let stripe = -1;
      ys.forEach(([r, h, rowRole], ri) => {
        if (rowRole === 'h') stripe++;
        const [band, cross] = pairs[Math.max(0, stripe) % pairs.length];
        xs.forEach(([c, w, colRole], ci) => {
          const color = rowRole === 'h' ? (colRole === 'v' ? cross : band) : (colRole === 'v' ? vert : ground);
          out.push({ id: `tpl-${ri}-${ci}`, r, c, w, h, type: 'square', color });
        });
      });
      return out;
    }
  },
  {
    id: 'ninepatch', name: 'Nine-Patch', desc: 'Classic 3×3 blocks in mixed fabrics.',
    build: ({ cols, rows, palette }) => {
      // Ground on the four side-centers, a different print on each corner of
      // the 3×3, and a third on the middle — the usual nine-patch roles, but
      // the prints keep moving so neighbouring blocks don't match.
      const colors = tplSwatches(palette, ['Natural', 'Rich Red', 'Butterscotch', 'Hyacinth', 'Palm', 'Wine']);
      const ground = colors[0];
      const prints = colors.length > 1 ? colors.slice(1) : colors;
      const { nx, ny } = tplPatchCount(cols, rows);
      const sx = tplSegments(cols, nx), sy = tplSegments(rows, ny), out = [];
      sy.forEach(([r, h], ri) => sx.forEach(([c, w], ci) => {
        if (w <= 0 || h <= 0) return;
        const br = ri % 3, bc = ci % 3;
        const corner = br % 2 === 0 && bc % 2 === 0;
        const center = br === 1 && bc === 1;
        let color = ground;
        if (center) color = prints[0];
        else if (corner) color = prints[1 + ((Math.floor(ri / 3) * 2 + Math.floor(ci / 3) + br + bc) % Math.max(1, prints.length - 1))];
        out.push({ id: `tpl-${ri}-${ci}`, r, c, w, h, type: 'square', color });
      }));
      return out;
    }
  },
  {
    id: 'railfence', name: 'Rail Fence', desc: 'Strips that alternate direction by block.',
    build: ({ cols, rows, palette }) => {
      const rails = tplSwatches(palette, ['Butterscotch', 'Dresden Blue', 'Terracotta', 'Peach', 'Hyacinth', 'Zucchini']);
      // Weave in fours even when the palette is longer — a six-wide group on a
      // twelve-patch thumb is one flip, and the fence stops reading as woven.
      const group = Math.min(4, rails.length);
      const { nx, ny } = tplPatchCount(cols, rows);
      const sx = tplSegments(cols, nx), sy = tplSegments(rows, ny), out = [];
      sy.forEach(([r, h], ri) => sx.forEach(([c, w], ci) => {
        if (w <= 0 || h <= 0) return;
        const horiz = (Math.floor(ri / group) + Math.floor(ci / group)) % 2 === 0;
        out.push({ id: `tpl-${ri}-${ci}`, r, c, w, h, type: 'square', color: rails[(horiz ? ri : ci) % rails.length] });
      }));
      return out;
    }
  },
  {
    id: 'hst', name: 'Half-Square Triangles', desc: 'Triangle blocks in paired colors.',
    build: ({ cols, rows, palette }) => {
      // Each block is still two triangles, but neighbouring blocks pick the
      // next pair along the palette, so the field is a run of colorways
      // rather than one navy-and-white pair tiled forever.
      const colors = tplSwatches(palette, ['Hyacinth', 'Ice Peach', 'Spice', 'Lemon', 'Zucchini', 'Midnight']);
      const n = colors.length;
      const { nx, ny } = tplPatchCount(cols, rows);
      const sx = tplSegments(cols, nx), sy = tplSegments(rows, ny), out = [];
      sy.forEach(([r, h], ri) => sx.forEach(([c, w], ci) => {
        if (w <= 0 || h <= 0) return;
        const k = (ri + ci) % n;
        const a = colors[k], b = colors[(k + 1) % n];
        const pid = `hst-${ri}-${ci}`, flip = (ri + ci) % 2 === 0;
        out.push({ id: pid + 'a', r, c, w, h, type: 'tri', color: flip ? a : b, dir: '/', half: 'a', pairId: pid });
        out.push({ id: pid + 'b', r, c, w, h, type: 'tri', color: flip ? b : a, dir: '/', half: 'b', pairId: pid });
      }));
      return out;
    }
  },
];

// Distinct DMC color objects present in a cell-hex grid (for palette pre-seed).
function xsColorsFromGrid(grid) {
  if (!grid) return [];
  const seen = new Set(), out = [];
  for (const hex of grid) { if (hex && !seen.has(hex)) { seen.add(hex); const d = DMC.find(c => c.hex === hex); if (d) out.push(d); } }
  return out;
}
// Size-catered cross-stitch starter charts. Real chart data lives in
// assets/stitch-templates-data.js (window.STITCH_TEMPLATE_DATA) — baked from the
// curated inspiration images by tools/gen-stitch-templates.mjs. Each entry is a
// canonical W×H chart (colors + RLE); build({w,h}) decodes it once and nearest-
// neighbour resamples to the requested size, so a single chart scales to every
// preset that offers it.
function xsDecodeChart(entry) {
  if (entry._grid) return entry._grid;                       // memoized native grid
  const grid = new Array(entry.w * entry.h).fill(null);
  let pos = 0;
  for (const tok of entry.rle.split(' ')) {
    const dot = tok.indexOf('.');
    const idx = parseInt(tok.slice(0, dot), 36), run = parseInt(tok.slice(dot + 1), 36);
    const hex = idx ? entry.colors[idx - 1] : null;
    for (let k = 0; k < run; k++) grid[pos++] = hex;
  }
  entry._grid = grid;
  return grid;
}
// Nearest-neighbour resample a src (sw×sh) hex/null grid to dw×dh.
function xsResampleGrid(src, sw, sh, dw, dh) {
  if (sw === dw && sh === dh) return src.slice();
  const out = new Array(dw * dh).fill(null);
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor((y + 0.5) * sh / dh));
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.floor((x + 0.5) * sw / dw));
      out[y * dw + x] = src[sy * sw + sx];
    }
  }
  return out;
}
// ── Set charts: one template, four coasters ────────────────────────────────
// A coaster order is always four pieces on four studio pages, so a template
// meant for one can carry four different designs — four cats, four kinds of
// pasta. Those ship as a cols×rows mosaic of panels at their native loop count
// (see `set` in assets/punch-templates-data.js).
//
// Everything downstream still works on the mosaic: the picker previews it whole,
// the way the set is photographed, and the palette step re-dresses it in one
// pass, which is what keeps all four coasters agreeing on which palette color
// took which role. The mosaic is only split into pages on the way into the
// studio.
function xsSplitPanels(mosaic, cols, rows, w, h) {
  const mw = cols * w, out = [];
  for (let p = 0; p < cols * rows; p++) {
    const ox = (p % cols) * w, oy = Math.floor(p / cols) * h;
    const cells = new Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) cells[y * w + x] = mosaic[(oy + y) * mw + ox + x];
    out.push(cells);
  }
  return out;
}
function xsTilePanels(panels, cols, rows, w, h) {
  const mw = cols * w, out = new Array(mw * rows * h).fill(null);
  panels.forEach((panel, p) => {
    const ox = (p % cols) * w, oy = Math.floor(p / cols) * h;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) out[(oy + y) * mw + ox + x] = panel[y * w + x];
  });
  return out;
}
// Rebuilding a mosaic at another panel size resamples each panel on its own, so
// one coaster's edge can't bleed into its neighbour's.
function xsSetMosaic(entry, w, h) {
  const s = entry.set;
  if (w === s.w && h === s.h) return xsDecodeChart(entry).slice();
  const panels = xsSplitPanels(xsDecodeChart(entry), s.cols, s.rows, s.w, s.h)
    .map(p => xsResampleGrid(p, s.w, s.h, w, h));
  return xsTilePanels(panels, s.cols, s.rows, w, h);
}
// There's no "Blank" card in the grid — "Skip for now" is the empty-grid route.
// w/h are the chart's own stitch counts — the template picker uses them to
// preview each chart at its true proportion (a 30x120 bookmark as a tall strip).
function xsBuildTemplates(data) {
  return (data || []).map(entry => {
    const set = entry.set || null;
    return {
      id: entry.id, name: entry.name, desc: entry.desc, presets: entry.presets,
      w: entry.w, h: entry.h,
      set,
      // Charts built around lettering carry the font and height their words want,
      // and optionally the words themselves. The studio opens on the text tool
      // with those settings so the maker can type straight into the design
      // instead of hunting for a face that matches the chart.
      seedText: entry.seedText || null,
      // For a set, w/h are the size of ONE panel and the result is the whole
      // mosaic — `outSize` reports what actually came back.
      build: ({ w, h }) => set
        ? xsSetMosaic(entry, w, h)
        : xsResampleGrid(xsDecodeChart(entry), entry.w, entry.h, w, h),
      outSize: ({ w, h }) => set ? { w: w * set.cols, h: h * set.rows } : { w, h },
      splitPages: set
        ? (mosaic, { w, h }) => xsSplitPanels(mosaic, set.cols, set.rows, w, h)
        : null,
    };
  });
}
const CROSS_STITCH_TEMPLATES = xsBuildTemplates(window.STITCH_TEMPLATE_DATA);
const PUNCH_TEMPLATES = xsBuildTemplates(window.PUNCH_TEMPLATE_DATA);
const GRID_TEMPLATES = { 'cross-stitch': CROSS_STITCH_TEMPLATES, 'punch-needle': PUNCH_TEMPLATES };
// Size-catered charts offered for a given preset.
function stitchTemplatesFor(preset, craft = 'cross-stitch') {
  const name = preset && preset.name;
  return (GRID_TEMPLATES[craft] || []).filter(t => !t.presets || t.presets.includes(name));
}

// ── Dressing a template chart in the user's palette ────────────────────────
// Templates ship in metime brand colors (snapped to their nearest DMC floss —
// see tools/gen-stitch-templates.mjs). Picking a palette on the next step has to
// override those defaults without flattening the design, so we map the chart's
// colors onto the palette by role instead of just recoloring cell by cell.
// Relative luminance, 0–1.
function xsLuma(hex) {
  const n = parseInt(hex.slice(1), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}
// The chart's colors in role order: most-stitched first.
function xsGridRoles(grid) {
  const counts = new Map();
  for (const hex of grid) if (hex) counts.set(hex, (counts.get(hex) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([hex, count]) => ({ hex, count }));
}
// Re-dress a template design in `palette` (an array of DMC color objects):
//   • a stitched ground — the top color, when it covers most of the chart —
//     stays a ground: it takes the palette color closest to it in luminance, so
//     linen stays light and a dark field stays dark, and then sits out the rest;
//   • which of the remaining palette colors get used is decided by dominance,
//     walking the palette in the order the user sees it, so a design that needs
//     fewer colors than the palette offers takes its leading ones;
//   • which motif color gets which is decided by tone: both lists are sorted by
//     luminance and paired off, so the design's light/dark structure — and with
//     it the contrast that makes the motif read — survives the swap;
//   • a palette shorter than the design cycles rather than dropping colors, so
//     motif detail is never lost, just carried in fewer tones.
function xsRecolorGrid(grid, palette) {
  if (!grid || !palette || !palette.length) return grid;
  const roles = xsGridRoles(grid);
  const pal = palette.map(c => c && c.hex).filter(Boolean);
  if (!roles.length || !pal.length) return grid;
  const map = new Map();
  let motifs = roles, pool = pal;
  if (roles[0].count > grid.length * 0.35) {
    const groundLuma = xsLuma(roles[0].hex);
    const ground = pal.reduce((best, h) =>
      Math.abs(xsLuma(h) - groundLuma) < Math.abs(xsLuma(best) - groundLuma) ? h : best, pal[0]);
    const rest = pal.filter(h => h !== ground);
    // A one-color palette leaves nothing for the motif, so the ground keeps its
    // default rather than flattening the design into a single block of color.
    map.set(roles[0].hex, rest.length ? ground : roles[0].hex);
    motifs = roles.slice(1);
    pool = rest.length ? rest : pal;
  }
  if (motifs.length) {
    const byLuma = arr => [...arr].sort((a, b) => xsLuma(a) - xsLuma(b));
    const tones = byLuma(motifs.map((_, i) => pool[i % pool.length]));
    byLuma(motifs.map(r => r.hex)).forEach((hex, i) => map.set(hex, tones[i]));
  }
  return grid.map(hex => hex ? (map.get(hex) || hex) : null);
}

// What the studio should open on for a chosen template: the chart dressed in the
// picked palette (or its own colors, when the palette step was skipped), plus —
// for a set — one grid per coaster page. Both the template step and the palette
// step go through here, so stepping back and picking a different palette
// re-dresses the original chart rather than a recolored copy of it.
function gridSeedFromTemplate(tpl, preset, palette) {
  const chart = tpl.build(preset);
  const dressed = palette ? xsRecolorGrid(chart, palette) : chart;
  if (!dressed || !dressed.some(Boolean)) return { autoGrid: null, autoPages: null };
  if (!tpl.splitPages) return { autoGrid: dressed, autoPages: null };
  const pages = tpl.splitPages(dressed, preset);
  return { autoGrid: pages[0], autoPages: pages };
}
