// Build assets/tapestry-wool.js — the DMC Laine Colbert (tapestry wool,
// article 486) color library used by the punch needle studio.
//
// Regenerate: node tools/gen-tapestry-wool.mjs
//
// ── Provenance, and why this is a curated subset ──────────────────────────
// DMC does not publish hex or RGB values for Laine Colbert. The range is ~390
// shades and the only complete reference is a physical color card (W486) made
// from real wool samples. Every "tapestry wool hex chart" circulating online
// either reuses six-strand floss values without saying so, or is a photograph
// of that card under unknown lighting. Shipping 390 invented hexes would mean
// showing users colors their yarn will not match.
//
// So we build from the one source DMC does publish: its official Six Strand
// Embroidery Floss (article 117) → Laine Colbert (article 486) conversion
// chart. Each pair below is DMC's own statement that a given wool is the match
// for a given floss, so we take the wool's on-screen color from that floss —
// whose hex values the app already carries in DMC_ENC. That yields ~115
// confirmed colors spanning the full range rather than 390 guesses.
//
// Two honest caveats, restated in the generated file's header:
//   • Wool is matte virgin wool and reads slightly deeper and less saturated
//     than mercerized cotton. We do NOT fudge the values to simulate that —
//     an invented correction is not more accurate than none.
//   • Color names are the DMC color name of the matched floss. Retailer names
//     for wool codes contradict each other (7014 is listed as both "Thyme
//     Flower" and "Medium Grape" by different sellers), so naming off the
//     matched floss is at least consistent and traceable.
//
// Source: DMC® Embroidery Floss to Laine Colbert Tapestry Wool Color
// Conversion Chart, article 117 → 486.
// https://mystitchworld.com/PDF/DMC-Floss-To-Laine-Colbert-Conversion-Card.pdf

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

// Rows of the conversion chart, transcribed verbatim. The chart is laid out in
// four column-groups that read as alternating floss/wool codes across the row,
// so each line here is simply that alternation: floss, wool, floss, wool, ...
// Trailing * and X are DMC's match-quality markers and are stripped below.
// One trailing row of the published chart is mangled in every copy we could
// find (three rows collapsed into one, pairing ambiguous) and is omitted
// rather than guessed at.
const CHART_ROWS = [
  'ecru ecru 453X 7715* 778 7260 932 7593*',
  'white white 469 7768 782 7781 935* 7427',
  '208* 7245 470 7769 791 7820* 936 7936*',
  '209 7708* 471 7771 792 7798 937 7320',
  '211 7709* 472 7772 793 7798 938 7529',
  '221 7226 498 7108* 794 7799* 943* 7460',
  '223 7223* 500 7408 800 7800 946 7946*',
  '224 7213 501* 7387 801 7467* 950 7164',
  '300* 7449 502* 7542 806 7595 953 7952',
  '300 7459 504* 7604 806* 7304* 954 7954*',
  '301X 7445 519* 7302 807 7813 992 7956',
  '307 7433 543 7451* 813 7313 992 7598*',
  '309 7136 543* 7460 815 7110 986 7346',
  '310 noir 553* 7895 818 7132* 995 7995',
  '311* 7311* 554 7896 823 7308 996 7996',
  '315 7255* 580 7376 823* 7791 3013 7422',
  '315* 7228* 581* 7362 824 7318 3032X 7465*',
  '316 7253* 597 7597 825 7316 3041* 7262*',
  '318 7620 598* 7599 826 7314 3041X 7243*',
  '319 7428 610 7416 827 7828 3042* 7260',
  '319* 7365 611 7413 829* 7355 3042X 7241',
  '320 7406 613 7492 829* 7359 3047* 7470',
  '320 7386 632 7432 830 7582* 3047 7579',
  '321 7107 640 7319X 831 7573 3051* 7426',
  '326 7640 642 7413* 832 7676 3052* 7376',
  '327X 7245* 646* 7703 833 7677 3053* 7426',
  '327X 7266* 646 7622* 839 7416X 3053* 7424',
  '331XX 7297 647* 7333 840 7518* 3064* 7840*',
  '333X 7245 647 7390* 841 7519* 3328* 7195',
  '340X 7243 648 7275X 842 7520* 3347* 7547',
  '336 7307 666 7666 890 7428 3362* 7396',
  '350* 7606 704* 7341 892 7104 3371 7535',
];

// The three wool colors the chart names in words rather than numbers.
const WORD_CODES = { noir: 'NOIR', white: 'BLANC', ecru: 'ECRU' };
// ...and the floss each corresponds to, for hex + naming.
const WORD_FLOSS = { noir: '310', white: 'White', ecru: 'Ecru' };
const WORD_NAMES = { NOIR: 'Noir', BLANC: 'Blanc', ECRU: 'Ecru' };

// Strip DMC's match-quality markers (* approximate, X / XX substitution) to
// get the bare catalog code.
const bare = tok => tok.replace(/[*X]+$/g, '');

// Pull the floss library straight out of index.html so the wool colors stay in
// lockstep with the floss hexes the rest of the app already uses.
function readFloss() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const m = html.match(/const DMC_ENC = "([^"]+)"/);
  if (!m) throw new Error('Could not find DMC_ENC in index.html');
  const byCode = new Map();
  for (const rec of m[1].split('|')) {
    const [code, name, hex] = rec.split('~');
    byCode.set(code, { code, name, hex });
  }
  return byCode;
}

function build() {
  const floss = readFloss();
  const wool = new Map();       // wool code -> { code, name, hex, floss }
  const misses = [];

  for (const row of CHART_ROWS) {
    const toks = row.split(/\s+/).filter(Boolean);
    for (let i = 0; i + 1 < toks.length; i += 2) {
      const flossTok = toks[i], woolTok = toks[i + 1];
      const woolCode = WORD_CODES[woolTok] || bare(woolTok);
      // First mapping wins: several flosses converge on one wool, and the
      // chart is ordered light-to-dark within a family, so the earlier pair is
      // the more representative one.
      if (wool.has(woolCode)) continue;
      const flossCode = WORD_FLOSS[flossTok] || bare(flossTok);
      const f = floss.get(flossCode);
      if (!f) { misses.push(`${flossCode} -> ${woolCode}`); continue; }
      wool.set(woolCode, {
        code: woolCode,
        name: WORD_NAMES[woolCode] || f.name,
        hex: f.hex,
        floss: f.code,
      });
    }
  }

  // Numeric order, with the named colors first so the picker opens on them.
  const rows = [...wool.values()].sort((a, b) => {
    const an = /^\d+$/.test(a.code), bn = /^\d+$/.test(b.code);
    if (an !== bn) return an ? 1 : -1;
    return an ? (+a.code - +b.code) : a.code.localeCompare(b.code);
  });

  const enc = rows.map(r => `${r.code}~${r.name}~${r.hex}`).join('|');
  const out = `// AUTO-GENERATED by tools/gen-tapestry-wool.mjs — do not hand-edit.
// Regenerate: node tools/gen-tapestry-wool.mjs
//
// DMC Laine Colbert tapestry wool (article 486), encoded code~name~HEX joined
// by | to match the DMC_ENC floss format, parsed once at load.
//
// DMC publishes no hex or RGB values for Laine Colbert — the only complete
// reference is the physical W486 wool card. These ${rows.length} colors are the ones
// DMC's own floss-to-wool conversion chart confirms, with each wool taking the
// on-screen color of the floss DMC matches it to. That is an equivalence DMC
// states, not a measurement of the wool: real skeins are matte virgin wool and
// will read a little deeper and less saturated than these swatches. Names are
// the matched floss's DMC color name, since retailer names for wool codes
// contradict one another.
//
// This is deliberately a curated subset of the ~390-shade range rather than a
// full catalog of invented values.
window.TAPESTRY_WOOL = "${enc}";
`;
  fs.writeFileSync(path.join(ROOT, 'assets/tapestry-wool.js'), out);

  console.log(`Wrote assets/tapestry-wool.js — ${rows.length} wool colors.`);
  if (misses.length) console.log(`Skipped (floss not in library): ${misses.join(', ')}`);
  console.log('\nSpot check:');
  for (const c of ['NOIR', 'BLANC', 'ECRU', '7107', '7666', '7995', '7428', '7535']) {
    const r = wool.get(c);
    console.log(`  ${c.padEnd(6)} ${r ? `${r.hex}  ${r.name}  (from floss ${r.floss})` : '— absent'}`);
  }
}

build();
