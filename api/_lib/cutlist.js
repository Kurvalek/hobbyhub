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

// Groups identical square/rect pieces (by color + cut dimensions, folding
// rotations so 2×3 and 3×2 merge) and identical HST units (by unordered color
// pair + block size). Pure — safe to call from both render templates.
export function quiltCutList(data) {
  const shapes = Array.isArray(data?.shapes) ? data.shapes : [];
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
