// Turns a quilt design's placed `shapes` into a true per-piece cutting list —
// the "cut N squares at X inches" breakdown a maker actually follows, as opposed
// to the color-aggregated yardage in `materials` (where a 2×2 block counts as 4
// grid units, not one 6.5" square).
//
// A quilt shape is one physical piece on a cols×rows grid at `bs` finished
// inches per cell:
//   square/rect: { r, c, w, h, color }            → one cut piece, w*bs × h*bs finished
//   HST half:    { ..., type:'tri', half, pairId } → two halves per pairId = one
//                                                     half-square-triangle unit

// ¼" seam allowance on every side => +0.5" total to each finished dimension
// (matches SEAM in index.html and the studio's calcYardage).
const SEAM = 0.5;
// Half-square-triangle "2-at-a-time" method: start from squares cut 7/8" larger
// than the finished block, sew, cut the diagonal, then trim to finished + 0.5".
const HST_ADD = 0.875;

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Renders inches to the nearest 1/8 as a tidy fraction, e.g. 3.5 -> `3 1/2"`,
// 6.875 -> `6 7/8"`, 4 -> `4"`.
export function fmtInches(n) {
  if (n == null || !isFinite(n)) return "—";
  let whole = Math.floor(n);
  let e = Math.round((n - whole) * 8);
  if (e === 8) {
    whole += 1;
    e = 0;
  }
  if (!e) return `${whole}"`;
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const g = gcd(e, 8);
  const frac = `${e / g}/${8 / g}`;
  return whole ? `${whole} ${frac}"` : `${frac}"`;
}

function colorId(color) {
  if (!color) return "?";
  return color.code || color.name || color.hex || "?";
}

function isComplementaryHst(a, b) {
  return !!(a && b && a.type === "tri" && b.type === "tri"
    && a.r === b.r && a.c === b.c && a.h === b.h && a.w === b.w
    && a.dir === b.dir && a.half !== b.half);
}
function bboxHasCell(s, r, c) {
  return r >= s.r && r < s.r + s.h && c >= s.c && c < s.c + s.w;
}
function triHitsCell(s, r, c) {
  if (!s || s.type !== "tri" || !s.h || !s.w) return false;
  const x0 = (c - s.c) / s.w, y0 = (r - s.r) / s.h;
  const x1 = x0 + 1 / s.w, y1 = y0 + 1 / s.h;
  const inside = (fx, fy) => s.dir === "/"
    ? (s.half === "a" ? fx + fy <= 1 + 1e-9 : fx + fy >= 1 - 1e-9)
    : (s.half === "a" ? fy <= fx + 1e-9 : fy >= fx - 1e-9);
  return inside(x0, y0) || inside(x1, y0) || inside(x0, y1) || inside(x1, y1)
    || inside((x0 + x1) / 2, (y0 + y1) / 2);
}
function coversCell(s, r, c) {
  if (!bboxHasCell(s, r, c)) return false;
  return s.type === "tri" ? triHitsCell(s, r, c) : true;
}
function fullyCoversCell(s, r, c) {
  if (!bboxHasCell(s, r, c)) return false;
  if (s.type !== "tri") return true;
  if (!s.h || !s.w) return false;
  const x0 = (c - s.c) / s.w, y0 = (r - s.r) / s.h;
  const x1 = x0 + 1 / s.w, y1 = y0 + 1 / s.h;
  const inside = (fx, fy) => s.dir === "/"
    ? (s.half === "a" ? fx + fy <= 1 + 1e-9 : fx + fy >= 1 - 1e-9)
    : (s.half === "a" ? fy <= fx + 1e-9 : fy >= fx - 1e-9);
  return inside(x0, y0) && inside(x1, y0) && inside(x0, y1) && inside(x1, y1);
}
function cellBuriedBy(lower, upper, r, c) {
  if (!coversCell(upper, r, c) || isComplementaryHst(lower, upper)) return false;
  if (lower.type !== "tri") return fullyCoversCell(upper, r, c);
  return fullyCoversCell(upper, r, c) || coversCell(upper, r, c);
}

// Keep in sync with quiltVisibleShapes in src/design-model.jsx. A piece sitting entirely
// under later shapes is not on the quilt top, so it is not a piece to cut.
export function quiltVisibleShapes(shapes) {
  const list = Array.isArray(shapes) ? shapes : [];
  return list.filter((s, idx) => {
    const above = list.slice(idx + 1);
    if (!above.length) return true;
    let hits = 0;
    for (let r = s.r; r < s.r + s.h; r++) {
      for (let c = s.c; c < s.c + s.w; c++) {
        if (!coversCell(s, r, c)) continue;
        hits++;
        if (!above.some((a) => cellBuriedBy(s, a, r, c))) return true;
      }
    }
    return hits === 0;
  });
}

// Groups identical square/rect pieces (by color + cut dimensions, folding
// rotations so 2×3 and 3×2 merge) and identical HST units (by unordered color
// pair + block size). Pure — safe to call from both render templates.
export function quiltCutList(data) {
  const shapes = quiltVisibleShapes(Array.isArray(data?.shapes) ? data.shapes : []);
  const bs = Number(data?.bs) || 0;

  const squareMap = new Map();
  const triHalves = new Map(); // pairId -> [half, ...]

  for (const s of shapes) {
    if (!s || !s.color) continue;
    if (s.type === "tri") {
      const pid = s.pairId != null ? s.pairId : `solo-${s.id}`;
      if (!triHalves.has(pid)) triHalves.set(pid, []);
      triHalves.get(pid).push(s);
      continue;
    }
    const w = s.w || 1;
    const h = s.h || 1;
    const cutA = round2(w * bs + SEAM);
    const cutB = round2(h * bs + SEAM);
    // Fold rotations: a 2×3 and a 3×2 need the same cut.
    const lo = Math.min(cutA, cutB);
    const hi = Math.max(cutA, cutB);
    const key = `${colorId(s.color)}|${lo}x${hi}`;
    if (!squareMap.has(key)) {
      squareMap.set(key, {
        code: s.color.code || null,
        name: s.color.name || "Fabric",
        hex: s.color.hex || null,
        cutW: hi,
        cutH: lo,
        finishedW: round2(hi - SEAM),
        finishedH: round2(lo - SEAM),
        qty: 0,
      });
    }
    squareMap.get(key).qty += 1;
  }

  // Collapse each HST pair into a unit, then group units by color pair + size.
  const hstMap = new Map();
  for (const halves of triHalves.values()) {
    if (!halves.length) continue;
    const a = halves.find((x) => x.half === "a") || halves[0];
    const b = halves.find((x) => x.half === "b") || halves[1] || halves[0];
    const w = a.w || 1;
    const h = a.h || 1;
    const square = w === h; // standard HSTs are square blocks
    const finished = round2(w * bs);
    // Order the two colors deterministically so mirrored blocks group together.
    let ca = a.color;
    let cb = b.color;
    if (colorId(cb) < colorId(ca)) {
      const t = ca;
      ca = cb;
      cb = t;
    }
    const key = `${colorId(ca)}+${colorId(cb)}|${w}x${h}`;
    if (!hstMap.has(key)) {
      hstMap.set(key, {
        aCode: ca?.code || null,
        aName: ca?.name || "Fabric",
        aHex: ca?.hex || null,
        bCode: cb?.code || null,
        bName: cb?.name || "Fabric",
        bHex: cb?.hex || null,
        square,
        finished,
        finishedH: round2(h * bs),
        cutSquare: round2(finished + HST_ADD),
        trimTo: round2(finished + SEAM),
        units: 0,
      });
    }
    hstMap.get(key).units += 1;
  }

  const squares = Array.from(squareMap.values()).sort((x, y) => y.qty - x.qty);
  const hsts = Array.from(hstMap.values())
    .map((g) => ({ ...g, squaresPerColor: Math.ceil(g.units / 2) }))
    .sort((x, y) => y.units - x.units);

  return {
    squares,
    hsts,
    hasHst: hsts.length > 0,
    totals: {
      squarePieces: squares.reduce((s, g) => s + g.qty, 0),
      hstUnits: hsts.reduce((s, g) => s + g.units, 0),
    },
  };
}
