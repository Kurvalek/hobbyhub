// Turns a stored design record into a physical Bill of Materials — the pick-list
// used to pull supplies and pack a kit. Both design types already persist their
// materials breakdown when uploaded (quilt: `materials`/`backCalc`/`bindCalc`;
// cross-stitch: `colors`/`stitches`/`fabric`), so this module reshapes those
// precomputed numbers into supplies rather than recomputing geometry.

// Full-coverage stitches a single DMC skein reliably covers at 14-count with two
// strands. Deliberately conservative so kits never ship short; tune via env.
const STITCHES_PER_SKEIN = Number(process.env.STITCHES_PER_SKEIN) || 1500;

// Inches of margin added to every side of the cut Aida so there's room to hoop
// and finish. 3" per side => +6" total on each dimension.
const AIDA_MARGIN_IN = Number(process.env.AIDA_MARGIN_IN) || 3;
const DEFAULT_AIDA_COUNT = 14;

// Renders eighths-of-a-yard as a tidy fraction (ported from the studio's fmtY).
function fmtYards(y) {
  if (!y) return "0 yd";
  const w = Math.floor(y);
  const e = Math.round((y - w) * 8);
  if (!e) return `${w} yd`;
  if (e === 8) return `${w + 1} yd`;
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const g = gcd(e, 8);
  return w ? `${w} ${e / g}/${8 / g} yd` : `${e / g}/${8 / g} yd`;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function quiltBom(data) {
  const items = data?.materials?.items || [];
  const fabrics = items.map((it) => ({
    name: it.name || "Fabric",
    code: it.code || null,
    hex: it.hex || null,
    yards: it.yards || 0,
    yardsLabel: fmtYards(it.yards || 0),
    cutSize: it.cutSize || null,
    strips: it.strips || null,
  }));

  const fw = data.fw || 0;
  const fh = data.fh || 0;
  const backing = data.backing && data.backCalc
    ? { yards: data.backCalc.yards, yardsLabel: fmtYards(data.backCalc.yards) }
    : null;
  const binding = data.binding && data.bindCalc
    ? { yards: data.bindCalc.yards, yardsLabel: fmtYards(data.bindCalc.yards) }
    : null;

  // Batting is cut a few inches larger than the finished top on every side.
  const batting = fw && fh ? { w: fw + 8, h: fh + 8 } : null;
  const totalYards = data.grandTotal || 0;

  return {
    type: "quilt",
    finishedInches: fw && fh ? { w: fw, h: fh } : null,
    fabrics,
    backing,
    binding,
    batting,
    totalYards,
    totalYardsLabel: fmtYards(totalYards),
  };
}

function crossStitchBom(data) {
  const colors = data?.colors || [];
  const floss = colors.map((c) => ({
    code: c.code || "?",
    name: c.name || "Custom",
    hex: c.hex || null,
    stitches: c.count || 0,
    skeins: Math.max(1, Math.ceil((c.count || 0) / STITCHES_PER_SKEIN)),
  }));
  const totalSkeins = floss.reduce((s, f) => s + f.skeins, 0);
  const totalStitches = data.stitches || colors.reduce((s, c) => s + (c.count || 0), 0);

  const count = DEFAULT_AIDA_COUNT;
  const w = data.w || 0;
  const h = data.h || 0;
  const finishedInches = w && h
    ? { w: round2(w / count), h: round2(h / count) }
    : null;
  const aida = finishedInches
    ? {
        count,
        color: data?.fabric?.name || null,
        w: round2(finishedInches.w + AIDA_MARGIN_IN * 2),
        h: round2(finishedInches.h + AIDA_MARGIN_IN * 2),
      }
    : null;

  return {
    type: "cross-stitch",
    finishedStitches: w && h ? { w, h } : null,
    finishedInches,
    aida,
    needle: "Size 24 tapestry",
    floss,
    totalStitches,
    totalSkeins,
  };
}

// Given a stored design record ({ id, type, data }), returns a structured BOM,
// or null if the type isn't recognized.
export function designToBom(record) {
  if (!record || !record.data) return null;
  if (record.type === "quilt") return quiltBom(record.data);
  if (record.type === "cross-stitch") return crossStitchBom(record.data);
  return null;
}
