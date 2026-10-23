import { useRef, useState } from 'react';
import { IcCheck } from './icons.jsx';
import { DMC } from './catalog.jsx';

// Compact, run-length-encoded grid so saved designs stay small in localStorage.
export function serializeGrid(cells) {
  const colors = [], cidx = new Map(), vals = new Array(cells.length);
  for (let i = 0; i < cells.length; i++) {
    const h = cells[i];
    if (!h) { vals[i] = 0; continue; }
    let ix = cidx.get(h);
    if (ix === undefined) { ix = colors.length; colors.push(h); cidx.set(h, ix); }
    vals[i] = ix + 1;
  }
  const runs = [];
  let i = 0;
  while (i < vals.length) { let j = i + 1; while (j < vals.length && vals[j] === vals[i]) j++; runs.push((j - i) + '.' + vals[i]); i = j; }
  return { colors, rle: runs.join('|') };
}
export function deserializeGrid(g, len) {
  const cells = new Array(len).fill(null);
  if (!g || !g.rle) return cells;
  let i = 0;
  for (const run of g.rle.split('|')) {
    const dot = run.indexOf('.');
    const c = +run.slice(0, dot), v = +run.slice(dot + 1);
    for (let k = 0; k < c && i < len; k++) { if (v > 0) cells[i] = g.colors[v - 1] || null; i++; }
  }
  return cells;
}
// Tally filled cells per thread color for the materials readout. `library` is
// the craft's thread catalog (floss or yarn), used to name colors that are on
// the board but not in the working palette.
export function computeStitchStats(cells, W, H, pal, library) {
  const map = new Map();
  let total = 0;
  for (const h of cells) {
    if (!h) continue;
    total++;
    map.set(h, (map.get(h) || 0) + 1);
  }
  const byHex = new Map((pal || []).map(c => [c.hex, c]));
  const colors = Array.from(map.entries()).map(([hex, count]) => {
    const dmc = byHex.get(hex) || (library || DMC).find(c => c.hex === hex) || { code: "?", name: "Custom", hex };
    return { hex, code: dmc.code, name: dmc.name, count };
  }).sort((a, b) => b.count - a.count);
  return { total, possible: W * H, colors };
}

// A coaster order is always a set of 4, across quilt / cross-stitch / punch.
export const COASTER_COUNT = 4;
export const isCoasterSize = name => name === 'Coaster' || name === 'Coaster Set';
let _shapeIdSeq = 1;
export function nextShapeId() { return 's' + (_shapeIdSeq++) + '-' + Math.random().toString(36).slice(2, 8); }
export function cloneQuiltShapes(shapes) {
  const pairMap = new Map();
  const pairFor = pid => {
    if (pid == null) return undefined;
    if (!pairMap.has(pid)) pairMap.set(pid, nextShapeId());
    return pairMap.get(pid);
  };
  return (shapes || []).map(s => ({
    ...s,
    id: nextShapeId(),
    pairId: s.pairId != null ? pairFor(s.pairId) : undefined,
    color: s.color && typeof s.color === 'object' ? { ...s.color } : s.color,
  }));
}

// Two HST halves that share a block are one unit, not a stack.
function isComplementaryHst(a, b) {
  return !!(a && b && a.type === 'tri' && b.type === 'tri'
    && a.r === b.r && a.c === b.c && a.h === b.h && a.w === b.w
    && a.dir === b.dir && a.half !== b.half);
}
function quiltBboxHasCell(s, r, c) {
  return r >= s.r && r < s.r + s.h && c >= s.c && c < s.c + s.w;
}
function quiltTriHitsCell(s, r, c) {
  if (!s || s.type !== 'tri' || !s.h || !s.w) return false;
  const x0 = (c - s.c) / s.w, y0 = (r - s.r) / s.h;
  const x1 = x0 + 1 / s.w, y1 = y0 + 1 / s.h;
  const inside = (fx, fy) => s.dir === '/'
    ? (s.half === 'a' ? fx + fy <= 1 + 1e-9 : fx + fy >= 1 - 1e-9)
    : (s.half === 'a' ? fy <= fx + 1e-9 : fy >= fx - 1e-9);
  return inside(x0, y0) || inside(x1, y0) || inside(x0, y1) || inside(x1, y1)
    || inside((x0 + x1) / 2, (y0 + y1) / 2);
}
function quiltCoversCell(s, r, c) {
  if (!quiltBboxHasCell(s, r, c)) return false;
  return s.type === 'tri' ? quiltTriHitsCell(s, r, c) : true;
}
function quiltFullyCoversCell(s, r, c) {
  if (!quiltBboxHasCell(s, r, c)) return false;
  if (s.type !== 'tri') return true;
  if (!s.h || !s.w) return false;
  const x0 = (c - s.c) / s.w, y0 = (r - s.r) / s.h;
  const x1 = x0 + 1 / s.w, y1 = y0 + 1 / s.h;
  const inside = (fx, fy) => s.dir === '/'
    ? (s.half === 'a' ? fx + fy <= 1 + 1e-9 : fx + fy >= 1 - 1e-9)
    : (s.half === 'a' ? fy <= fx + 1e-9 : fy >= fx - 1e-9);
  return inside(x0, y0) && inside(x1, y0) && inside(x0, y1) && inside(x1, y1);
}
function quiltCellBuriedBy(lower, upper, r, c) {
  if (!quiltCoversCell(upper, r, c) || isComplementaryHst(lower, upper)) return false;
  if (lower.type !== 'tri') return quiltFullyCoversCell(upper, r, c);
  return quiltFullyCoversCell(upper, r, c) || quiltCoversCell(upper, r, c);
}
// A piece that sits entirely under later shapes is not on the quilt top — keep
// it out of yardage and the cut list so a stack does not buy two fabrics.
function quiltVisibleShapes(shapes) {
  const list = Array.isArray(shapes) ? shapes : [];
  return list.filter((s, idx) => {
    const above = list.slice(idx + 1);
    if (!above.length) return true;
    let hits = 0;
    for (let r = s.r; r < s.r + s.h; r++) {
      for (let c = s.c; c < s.c + s.w; c++) {
        if (!quiltCoversCell(s, r, c)) continue;
        hits++;
        if (!above.some(a => quiltCellBuriedBy(s, a, r, c))) return true;
      }
    }
    return hits === 0;
  });
}
export function quiltAddVisibleArea(shapes, add) {
  const cells = new Set();
  for (const s of shapes) {
    if (!s) continue;
    for (let r = s.r; r < s.r + s.h; r++) {
      for (let c = s.c; c < s.c + s.w; c++) cells.add(r + ',' + c);
    }
  }
  for (const k of cells) {
    const [r, c] = k.split(',').map(Number);
    let claimedA = false, claimedB = false;
    for (let i = shapes.length - 1; i >= 0; i--) {
      const s = shapes[i];
      if (!quiltCoversCell(s, r, c)) continue;
      if (s.type !== 'tri') {
        const amt = (claimedA ? 0 : 0.5) + (claimedB ? 0 : 0.5);
        if (amt) add(s.color, amt);
        break;
      }
      const half = s.half === 'b' ? 'b' : 'a';
      if (half === 'a' && !claimedA) { add(s.color, 0.5); claimedA = true; }
      if (half === 'b' && !claimedB) { add(s.color, 0.5); claimedB = true; }
      if (claimedA && claimedB) break;
    }
  }
}
export function quiltOverlapCells(shapes) {
  const list = Array.isArray(shapes) ? shapes : [];
  const byCell = new Map();
  for (const s of list) {
    for (let r = s.r; r < s.r + s.h; r++) {
      for (let c = s.c; c < s.c + s.w; c++) {
        if (!quiltCoversCell(s, r, c)) continue;
        const k = r + ',' + c;
        if (!byCell.has(k)) byCell.set(k, []);
        byCell.get(k).push(s);
      }
    }
  }
  const out = [];
  for (const [k, occ] of byCell) {
    if (occ.length < 2) continue;
    if (occ.length === 2 && isComplementaryHst(occ[0], occ[1])) continue;
    const [r, c] = k.split(',').map(Number);
    out.push({ r, c });
  }
  return out;
}
// Keep a duplicated group together and on the board. Prefer one cell down-right
// so the copy is visible; if that walks off an edge, slide along it or reverse.
export function quiltDuplicateOffset(shapes, rows, cols) {
  if (!shapes || !shapes.length) return null;
  let minR = Infinity, minC = Infinity, maxR = -Infinity, maxC = -Infinity;
  for (const s of shapes) {
    minR = Math.min(minR, s.r);
    minC = Math.min(minC, s.c);
    maxR = Math.max(maxR, s.r + s.h);
    maxC = Math.max(maxC, s.c + s.w);
  }
  const fits = (dr, dc) => minR + dr >= 0 && minC + dc >= 0
    && maxR + dr <= rows && maxC + dc <= cols && (dr !== 0 || dc !== 0);
  const tries = [[1, 1], [1, 0], [0, 1], [-1, -1], [-1, 0], [0, -1], [-1, 1], [1, -1]];
  for (const [dr, dc] of tries) if (fits(dr, dc)) return { dr, dc };
  return null;
}
export function seedCoasterUnits(shapes) {
  return Array.from({ length: COASTER_COUNT }, () => cloneQuiltShapes(shapes));
}
// Four copies of the one design — unless a set template supplied four different
// ones, in which case each coaster opens on its own.
export function seedCoasterPages(cells, len, pages = null) {
  if (pages && pages.length === COASTER_COUNT && pages.every(p => p && p.length === len)) {
    return pages.map(p => p.slice());
  }
  const src = (cells && cells.length === len) ? cells : new Array(len).fill(null);
  return Array.from({ length: COASTER_COUNT }, () => src.slice());
}
// Move a w×h stitch grid onto an nw×nh board at the same scale, centering the
// stitched area (not the old board) so off-center work survives a smaller
// size. Whatever still falls outside the new board is cropped.
export function refitGrid(cells, w, h, nw, nh) {
  const out = new Array(nw * nh).fill(null);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let i = 0; i < w * h; i++) {
    if (!cells[i]) continue;
    const x = i % w, y = (i / w) | 0;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) return out;
  const dx = Math.floor((nw - (x1 - x0 + 1)) / 2) - x0;
  const dy = Math.floor((nh - (y1 - y0 + 1)) / 2) - y0;
  for (let y = y0; y <= y1; y++) {
    const ny = y + dy; if (ny < 0 || ny >= nh) continue;
    for (let x = x0; x <= x1; x++) {
      const nx = x + dx; if (nx < 0 || nx >= nw) continue;
      out[ny * nw + nx] = cells[y * w + x];
    }
  }
  return out;
}

export function CoasterTabs({ active, onSelect, onCopyAll }) {
  const [copied, setCopied] = useState(false);
  const tRef = useRef(null);
  const copy = () => {
    onCopyAll();
    setCopied(true);
    if (tRef.current) clearTimeout(tRef.current);
    tRef.current = setTimeout(() => setCopied(false), 1600);
  };
  return (
    <div className="coaster-bar">
      <div className="coaster-tablist" role="tablist" aria-label="Coasters in this set">
        {Array.from({ length: COASTER_COUNT }, (_, i) => (
          <button key={i} type="button" role="tab" className={`coaster-tab${active === i ? ' active' : ''}`}
            aria-selected={active === i} onClick={() => onSelect(i)}>
            Coaster {i + 1}
          </button>
        ))}
      </div>
      <button type="button" className="btn coaster-copy" onClick={copy}
        title="Replace the other three coasters with this design">
        {copied ? <>Copied <IcCheck size={12}/></> : 'Copy to all'}
      </button>
    </div>
  );
}
