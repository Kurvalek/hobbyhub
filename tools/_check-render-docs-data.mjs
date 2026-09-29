// Throwaway: shared sample design + order fixtures for the render checks.
import { designToBom } from "../api/_lib/bom.js";

const KONA = {
  snow: { name: "Snow", code: "1339", hex: "#F2F0E4" },
  cardinal: { name: "Cardinal", code: "1063", hex: "#B3282B" },
  teal: { name: "Teal Blue", code: "1373", hex: "#2E7C91" },
};

function quiltData() {
  const shapes = [];
  let id = 1;
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    const center = r >= 1 && r <= 2 && c >= 1 && c <= 2;
    if (center) {
      const pairId = `pin-${r}-${c}`;
      const dir = (r + c) % 2 === 0 ? "/" : "\\";
      shapes.push({ id: id++, r, c, w: 1, h: 1, type: "tri", dir, half: "a", pairId, color: KONA.cardinal });
      shapes.push({ id: id++, r, c, w: 1, h: 1, type: "tri", dir, half: "b", pairId, color: KONA.snow });
    } else {
      shapes.push({ id: id++, r, c, w: 1, h: 1, type: "square", color: (r + c) % 2 === 0 ? KONA.teal : KONA.snow });
    }
  }
  const items = [
    { ...KONA.snow, count: 10, yards: 0.5, cutSize: '6 1/2"', strips: 2 },
    { ...KONA.teal, count: 6, yards: 0.25, cutSize: '6 1/2"', strips: 1 },
    { ...KONA.cardinal, count: 4, yards: 0.25, cutSize: '6 7/8"', strips: 1 },
  ];
  return {
    name: "Pinwheel Sampler", cols: 4, rows: 4, bs: 6, preset: "Baby", shapes,
    backing: KONA.snow, binding: KONA.cardinal, pinned: [],
    materials: { items, total: 3, possible: 3, yards: 1 },
    fw: 24, fh: 24,
    backCalc: { yards: 1, backingW: 32, backingH: 32, widths: 1 },
    bindCalc: { yards: 0.25, strips: 3, perimeter: 96 },
    grandTotal: 2.25,
  };
}

function gridFromArt(art, legend) {
  const h = art.length, w = art[0].length;
  const palette = [...new Set(Object.values(legend).map((c) => c.hex))];
  const counts = new Map();
  const values = [];
  for (const line of art) for (const ch of line) {
    if (ch === ".") { values.push(0); continue; }
    const color = legend[ch];
    values.push(palette.indexOf(color.hex) + 1);
    counts.set(color.hex, (counts.get(color.hex) || 0) + 1);
  }
  const runs = [];
  let run = 1;
  for (let i = 1; i <= values.length; i++) {
    if (i < values.length && values[i] === values[i - 1]) run++;
    else { runs.push(`${run}.${values[i - 1]}`); run = 1; }
  }
  const colors = Object.values(legend).map((c) => ({ ...c, count: counts.get(c.hex) || 0 }))
    .filter((c) => c.count > 0).sort((a, b) => b.count - a.count);
  return { w, h, grid: { colors: palette, rle: runs.join("|") }, colors, stitches: colors.reduce((s, c) => s + c.count, 0) };
}

const HEART = [
  "..XXX...XXX..", ".XXoXX.XXXXX.", "XXoooXXXXXXXX", "XXXXXXXXXXXXX",
  ".XXXXXXXXXXX.", "..XXXXXXXXX..", "...XXXXXXX...", "....XXXXX....",
  ".....XXX.....", "......X......",
];
const SUN = [
  "....oooo....", "..oooooooo..", ".oooXXXXooo.", "ooooXXXXoooo",
  "oooXXXXXXooo", "ooXXXXXXXXoo", "ooXXXXXXXXoo", "oooXXXXXXooo",
  "ooooXXXXoooo", ".oooXXXXooo.", "..oooooooo..", "....oooo....",
];

const xsGrid = gridFromArt(HEART, { X: { code: "321", name: "Red", hex: "#C72C48" }, o: { code: "819", name: "Baby Pink Light", hex: "#F5D5DC" } });
const pnGrid = gridFromArt(SUN, { X: { code: "7947", name: "Marigold", hex: "#E8873A" }, o: { code: "7317", name: "Deep Teal", hex: "#2B6B77" } });

export const RECORDS = {
  quilt: { id: "11111111-1111-4111-8111-111111111111", type: "quilt", data: quiltData() },
  "cross-stitch": {
    id: "22222222-2222-4222-8222-222222222222", type: "cross-stitch",
    data: { name: "Little Heart", craft: "cross-stitch", presetName: "Small Hoop", ...xsGrid, palette: xsGrid.colors, colorsUsed: 2, fabric: { name: "Antique White", hex: "#F3EFE4" } },
  },
  "punch-needle": {
    id: "33333333-3333-4333-8333-333333333333", type: "punch-needle",
    data: { name: "Sunburst", craft: "punch-needle", presetName: "Wall Hanging", ...pnGrid, palette: pnGrid.colors, colorsUsed: 2, fabric: { name: "Natural Monk's Cloth", hex: "#E6DCC6" } },
  },
};

// Mirrors what api/_lib/orders.js hands back, with designToBom already frozen on.
export const ORDER = {
  orderId: "5550001", orderName: "#1042",
  createdAt: new Date().toISOString(), status: "new", checklist: {},
  customer: { name: "Wren Callaway", email: "wren.callaway@example.com" },
  shipping: { name: "Wren Callaway", address1: "418 Marigold Lane", address2: "Apt 2B", city: "Asheville", province: "North Carolina", zip: "28801", country: "United States" },
  items: [
    { lineItemId: "1", title: "Custom Quilt Kit", variantTitle: 'Baby · 24" × 24"', quantity: 1, sku: "KIT-QUILT-BABY", designId: RECORDS.quilt.id, designFound: true, type: "quilt", bom: designToBom(RECORDS.quilt) },
    { lineItemId: "2", title: "Custom Cross-Stitch Kit", variantTitle: "Small Hoop", quantity: 1, sku: "KIT-XS-SM", designId: RECORDS["cross-stitch"].id, designFound: true, type: "cross-stitch", bom: designToBom(RECORDS["cross-stitch"]) },
    { lineItemId: "3", title: "Custom Punch Needle Kit", variantTitle: "Wall Hanging", quantity: 2, sku: "KIT-PN-WALL", designId: RECORDS["punch-needle"].id, designFound: true, type: "punch-needle", bom: designToBom(RECORDS["punch-needle"]) },
    { lineItemId: "4", title: "Custom Quilt Kit", variantTitle: "Throw", quantity: 1, sku: "KIT-QUILT-THROW", designId: "44444444-4444-4444-8444-444444444444", designFound: false, type: "unknown", bom: null },
  ],
};
