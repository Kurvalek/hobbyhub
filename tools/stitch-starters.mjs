// Starter designs for the cross-stitch studio, read by gen-stitch-templates.mjs.
//
// Each design belongs to one size and is drawn in named color roles, each one a
// DMC floss. A role's `tone` is how it re-dresses when the maker picks a
// palette: 'dark' takes the palette's darkest floss, 'light' its lightest,
// 'accent' its most colorful, and 'mid' whichever is nearest in lightness to
// the role's own floss. Light roles are only ever stitched over a darker
// shape, never straight onto the Aida, so they stay readable on any fabric.
//
// Defaults are only ever the metime brand colors, as their nearest flosses
// (see METIME): the five accents plus the brand's black and cream. Light
// lettering on any of the accents is too faint to read in thread, so black is
// the dark wherever a design needs one.
//
// `draw(cv, c)` stitches the shapes with c[roleId] (see Canvas in the
// generator; these use its edge-coordinate primitives). Anything not drawn is
// left unstitched, so the Aida shows through.
//
// `texts` are the words. Each becomes a text-tool layer in the studio, so the
// maker retypes it rather than unpicking stitches. `x` is where the ink's
// center (or left/right edge, by `align`) goes, and `top` or `cy` sets the
// ink's top or middle. The generator sets the words in the real fonts and
// fails the build if a box would show "Off the edge" or two layers overlap.

// 70 × 70, a 5" hoop. The hoop is as wide as the board, so everything stays
// inside a circle about 34 stitches from the middle (35, 35).
const SMALL_HOOP = { presets: ['Small Hoop'], w: 70, h: 70 };
// 40 × 40, one design repeated on all four coasters of the set.
const COASTER = { presets: ['Coaster Set'], w: 40, h: 40 };
// 30 × 120. A line of Sampler can be at most 26 stitches of ink (about four
// letters) before its box shows "Off the edge", which sets the wording below.
const BOOKMARK = { presets: ['Bookmark'], w: 30, h: 120 };
// 120 × 120, an 8" hoop, so everything stays within about 58 stitches of the
// middle (60, 60). Sampler 8 is the only height a line of words fits across.
const MEDIUM_HOOP = { presets: ['Medium Hoop'], w: 120, h: 120 };

const METIME = {
  tomato: '608',   // Burnt Orange Bright   ← --metime-tomato     #E8583A
  golden: '725',   // Topaz Med Lt          ← --metime-golden     #FBBB3F
  ice: '3747',     // Blue Violet Vy Lt     ← --metime-ice        #CCD6EB
  avocado: '733',  // Olive Green Md        ← --metime-avocado    #B5BB46
  grapefruit: '352', // Coral Light         ← --metime-grapefruit #FDA198
  black: '310',    // Black                 ← --metime-black      #171717 (3371 is nearer but reads brown)
  cream: '3865',   // Winter White          ← --metime-cream      #F9F7F2
};

export const STARTERS = [
  {
    ...SMALL_HOOP, id: 'drop-cap', name: 'Drop Cap', desc: 'Serif + Sampler · 2 colors',
    roles: [
      { id: 'ink', code: METIME.black, tone: 'dark' },
      { id: 'accent', code: METIME.tomato, tone: 'accent' },
    ],
    draw(cv, c) {
      // A double-ruled square with a small square on each corner.
      cv.box(14, 10, 42, 42, c.ink).box(16, 12, 38, 38, c.ink);
      for (const [x, y] of [[14, 10], [55, 10], [14, 51], [55, 51]]) cv.rect(x - 1, y - 1, 3, 3, c.accent);
    },
    texts: [
      { text: 'R', font: 'serif', size: 36, role: 'ink', x: 35, cy: 31 },
      { text: 'ROSALIND', font: 'sampler', size: 8, role: 'accent', x: 35, top: 56 },
    ],
  },
  {
    ...SMALL_HOOP, id: 'matchbook', name: 'Matchbook', desc: 'Serif + Sampler · 5 colors',
    roles: [
      // The cover is listed before the ornament so, of the two colorful roles,
      // it gets a palette's boldest floss.
      { id: 'cover', code: METIME.tomato, tone: 'accent' },
      { id: 'flap', code: METIME.black, tone: 'dark' },
      { id: 'cream', code: METIME.cream, tone: 'light' },
      { id: 'gold', code: METIME.golden, tone: 'accent' },
      { id: 'striker', code: METIME.ice, tone: 'mid' },
    ],
    draw(cv, c) {
      // Closed matchbook, front view: the cover, then the flap tucked over its
      // foot with the striker and two staples.
      cv.rect(11, 10, 48, 39, c.cover);
      cv.rect(11, 49, 48, 11, c.flap);
      for (const [x, y] of [[11, 10], [58, 10], [11, 59], [58, 59]]) cv.put(x, y, null);
      cv.box(12, 11, 46, 37, c.cream);
      cv.rect(14, 51, 42, 3, c.striker);
      cv.rect(22, 56, 2, 2, c.striker).rect(46, 56, 2, 2, c.striker);
      // A small diamond between short rules, between the initials and the year.
      cv.rect(34, 35, 2, 1, c.gold).rect(33, 36, 4, 1, c.gold).rect(34, 37, 2, 1, c.gold);
      cv.rect(28, 36, 4, 1, c.gold).rect(38, 36, 4, 1, c.gold);
    },
    texts: [
      { text: 'THE', font: 'sampler', size: 8, role: 'cream', x: 35, top: 15 },
      { text: 'K & J', font: 'serif', size: 14, role: 'cream', x: 35, cy: 28 },
      { text: 'EST 2024', font: 'sampler', size: 8, role: 'cream', x: 35, top: 40 },
    ],
  },
  {
    ...SMALL_HOOP, id: 'hotel-key', name: 'Hotel Key Tag', desc: 'Serif + Sampler · 3 colors',
    roles: [
      { id: 'fob', code: METIME.black, tone: 'dark' },
      { id: 'cream', code: METIME.cream, tone: 'light' },
      { id: 'gold', code: METIME.golden, tone: 'accent' },
    ],
    draw(cv, c) {
      // An elongated hexagon fob with a cream line just inside its edge, and
      // the key-ring hole near the top: unstitched, ringed in mustard.
      const fob = [[35, 2], [54, 13], [54, 58], [35, 68], [16, 58], [16, 13]];
      cv.poly(fob, c.fob).poly(fob, c.cream, 2, 3);
      cv.ring(35, 12.5, 2.6, 4.1, c.gold).ring(35, 12.5, 0, 2.6, null);
    },
    texts: [
      { text: 'HOTEL', font: 'sampler', size: 8, role: 'cream', x: 35, top: 19 },
      { text: 'Nora', font: 'serif', size: 12, role: 'gold', x: 35, cy: 30 },
      { text: 'ROOM', font: 'sampler', size: 8, role: 'cream', x: 35, top: 38 },
      { text: '214', font: 'sampler', size: 16, role: 'cream', x: 35, top: 46 },
    ],
  },
  {
    ...SMALL_HOOP, id: 'text-thread', name: 'Text Thread', desc: 'Sampler · 4 colors',
    roles: [
      { id: 'ink', code: METIME.black, tone: 'dark' },
      { id: 'cream', code: METIME.cream, tone: 'light' },
      { id: 'sent', code: METIME.tomato, tone: 'accent' },
      { id: 'received', code: METIME.ice, tone: 'mid' },
    ],
    draw(cv, c) {
      // Each bubble is one solid shape, tail included, so one fill recolors it
      // and the select tool picks it up whole to resize.
      cv.roundRect(9, 13, 48, 11, 4, c.received);
      cv.poly([[9.5, 19], [14, 24], [7, 26]], c.received);
      cv.roundRect(15, 27, 48, 22, 4, c.sent);
      cv.poly([[62.5, 44], [58, 49], [65, 51]], c.sent);
    },
    texts: [
      { text: 'MISS YOU', font: 'sampler', size: 8, role: 'ink', x: 33, cy: 18.5 },
      { text: 'MISS YOU\nMORE', font: 'sampler', size: 8, role: 'cream', x: 39, cy: 38 },
      { text: 'DELIVERED', font: 'sampler', size: 8, role: 'ink', align: 'right', x: 61, top: 52 },
    ],
  },
  {
    ...COASTER, id: 'monogram', name: 'The Monogram', desc: 'Serif · 3 colors',
    roles: [
      { id: 'ink', code: METIME.black, tone: 'dark' },
      { id: 'initial', code: METIME.tomato, tone: 'accent' },
      { id: 'corner', code: METIME.golden, tone: 'accent' },
    ],
    draw(cv, c) {
      cv.box(2, 2, 36, 36, c.ink).box(4, 4, 32, 32, c.ink);
      for (const [x, y] of [[2, 2], [37, 2], [2, 37], [37, 37]]) cv.rect(x - 1, y - 1, 3, 3, c.corner);
    },
    texts: [
      { text: 'S', font: 'serif', size: 26, role: 'initial', x: 20, cy: 20 },
    ],
  },
  {
    ...COASTER, id: 'wavy-check', name: 'Wavy Check', desc: 'Pattern · 2 colors',
    roles: [
      { id: 'check', code: METIME.tomato, tone: 'dark' },
      { id: 'ground', code: METIME.grapefruit, tone: 'light' },
    ],
    draw(cv, c) {
      // An 8-stitch checkerboard read through a sine warp in each direction,
      // so the squares bulge and pinch instead of sitting square.
      const warp = t => 3 * Math.sin((2 * Math.PI * t) / 40);
      for (let y = 0; y < cv.H; y++) for (let x = 0; x < cv.W; x++) {
        const u = x + 0.5 + warp(y + 0.5), v = y + 0.5 + warp(x + 0.5);
        cv.put(x, y, (Math.floor(u / 8) + Math.floor(v / 8)) % 2 ? c.ground : c.check);
      }
    },
    texts: [],
  },
  {
    ...COASTER, id: 'house-bar', name: 'House Bar', desc: 'Sampler · 3 colors',
    roles: [
      { id: 'badge', code: METIME.black, tone: 'dark' },
      { id: 'cream', code: METIME.cream, tone: 'light' },
      { id: 'gold', code: METIME.golden, tone: 'accent' },
    ],
    draw(cv, c) {
      // The ring hugs the rim: at 40 stitches the lettering needs nearly the
      // whole badge, and the badge runs out to the coaster's edges.
      cv.ring(20, 20, 0, 20.6, c.badge).ring(20, 20, 18.8, 19.8, c.cream);
    },
    texts: [
      { text: 'NOLAN', font: 'sampler', size: 8, role: 'cream', x: 20, top: 9 },
      { text: 'BAR', font: 'sampler', size: 16, role: 'gold', x: 20, cy: 20 },
      { text: 'EST 21', font: 'sampler', size: 8, role: 'cream', x: 20, top: 26 },
    ],
  },
  {
    ...COASTER, id: 'postage-stamp', name: 'Postage Stamp', desc: 'Sampler · 4 colors',
    roles: [
      { id: 'paper', code: METIME.cream, tone: 'light' },
      { id: 'sun', code: METIME.tomato, tone: 'accent' },
      { id: 'sky', code: METIME.golden, tone: 'mid' },
      { id: 'sea', code: METIME.ice, tone: 'mid' },
    ],
    draw(cv, c) {
      // The stamp, with every other stitch along its edge left out for the
      // perforations.
      cv.rect(2, 2, 36, 36, c.paper);
      for (let i = 3; i < 38; i += 2) for (const [x, y] of [[i, 2], [i, 37], [2, i], [37, i]]) cv.put(x, y, null);
      // A sun setting into striped water.
      cv.rect(6, 6, 28, 13, c.sky).ring(20, 19, 0, 7, c.sun);
      for (const y of [19, 20, 22, 23, 25, 26]) cv.rect(6, y, 28, 1, c.sea);
      cv.rect(6, 21, 28, 1, c.paper).rect(6, 24, 28, 1, c.paper);
    },
    texts: [
      { text: 'NY', font: 'sampler', size: 8, role: 'sun', align: 'left', x: 6, top: 29 },
      { text: '26', font: 'sampler', size: 8, role: 'sun', align: 'right', x: 34, top: 29 },
    ],
  },
  {
    ...BOOKMARK, id: 'bookplate', name: 'Bookplate', desc: 'Serif + Sampler · 2 colors',
    roles: [
      { id: 'ink', code: METIME.black, tone: 'dark' },
      { id: 'accent', code: METIME.tomato, tone: 'accent' },
    ],
    draw(cv, c) {
      cv.box(0, 0, 30, 120, c.ink).box(2, 2, 26, 116, c.ink);
      cv.rect(11, 16, 8, 1, c.accent).rect(11, 33, 8, 1, c.accent);
      // A chain of diamond outlines, tip to tip, down the rest of the length.
      for (let i = 0; i < 8; i++) {
        const cy = 43.5 + i * 9;
        cv.poly([[15, cy - 4.5], [19.5, cy], [15, cy + 4.5], [10.5, cy]], c.ink, 0, 1);
      }
    },
    texts: [
      { text: 'EX', font: 'sampler', size: 8, role: 'accent', x: 15, top: 8 },
      { text: 'MR', font: 'serif', size: 12, role: 'ink', x: 15, cy: 25 },
    ],
  },
  {
    ...BOOKMARK, id: 'ticket-stub', name: 'Ticket Stub', desc: 'Sampler · 3 colors',
    roles: [
      { id: 'ink', code: METIME.black, tone: 'dark' },
      { id: 'edge', code: METIME.tomato, tone: 'accent' },
      { id: 'paper', code: METIME.grapefruit, tone: 'mid' },
    ],
    draw(cv, c) {
      cv.roundRect(0, 1, 30, 118, 2, c.edge).roundRect(1, 2, 28, 116, 1, c.paper);
      // The tear line: a notch out of each side, ringed in the edge color, and
      // a dotted line between them.
      for (const x of [0, 30]) cv.ring(x, 87.5, 0, 4, c.edge).ring(x, 87.5, 0, 3, null);
      for (let x = 5; x < 25; x += 2) cv.put(x, 87, c.edge);
      cv.rect(9, 20, 12, 1, c.edge).rect(9, 51, 12, 1, c.edge);
      const bars = '1101001110110100101101';
      for (let i = 0; i < bars.length; i++) if (bars[i] === '1') cv.rect(4 + i, 100, 1, 12, c.ink);
    },
    texts: [
      { text: 'ADMIT', font: 'sampler', size: 8, role: 'ink', x: 15, top: 5 },
      { text: 'ONE', font: 'sampler', size: 8, role: 'ink', x: 15, top: 12 },
      { text: 'JUNE', font: 'sampler', size: 8, role: 'ink', x: 15, top: 24 },
      { text: '14', font: 'sampler', size: 16, role: 'ink', x: 15, top: 31 },
      { text: '2019', font: 'sampler', size: 8, role: 'ink', x: 15, top: 44 },
      { text: 'SPAC', font: 'sampler', size: 8, role: 'ink', x: 15, top: 55 },
      { text: 'ROW', font: 'sampler', size: 8, role: 'ink', align: 'left', x: 2, top: 62 },
      { text: 'G', font: 'sampler', size: 8, role: 'ink', align: 'right', x: 27, top: 62 },
      { text: 'SEAT', font: 'sampler', size: 8, role: 'ink', x: 15, top: 69 },
      { text: '14', font: 'sampler', size: 8, role: 'ink', x: 15, top: 76 },
      { text: '0614', font: 'sampler', size: 8, role: 'ink', x: 15, top: 93 },
    ],
  },
  {
    ...BOOKMARK, id: 'book-club-receipt', name: 'Book Club Receipt', desc: 'Sampler · 4 colors',
    roles: [
      { id: 'ink', code: METIME.black, tone: 'dark' },
      { id: 'paper', code: METIME.cream, tone: 'light' },
      { id: 'star', code: METIME.golden, tone: 'accent' },
      { id: 'rule', code: METIME.ice, tone: 'mid' },
    ],
    draw(cv, c) {
      // Paper torn to a zigzag at both ends.
      const tooth = x => [0, 1, 2, 1][x % 4];
      for (let y = 0; y < cv.H; y++) for (let x = 0; x < cv.W; x++) {
        if (y >= 1 + tooth(x) && y <= 118 - tooth(x)) cv.put(x, y, c.paper);
      }
      for (const y of [28, 78]) for (let x = 2; x < 28; x++) if ((x - 2) % 3 < 2) cv.put(x, y, c.rule);
      // Five dots under each title, the rating's worth in gold. Re-rating is
      // pencil and eraser.
      for (const [y, stars] of [[39, 5], [50, 4], [61, 5], [72, 3]]) {
        for (let k = 0; k < 5; k++) cv.put(3 + 2 * k, y, k < stars ? c.star : c.rule);
      }
      const bars = '1011011101001011011101';
      for (let i = 0; i < bars.length; i++) if (bars[i] === '1') cv.rect(4 + i, 97, 1, 12, c.ink);
    },
    texts: [
      { text: 'BOOK', font: 'sampler', size: 8, role: 'ink', x: 15, top: 6 },
      { text: 'CLUB', font: 'sampler', size: 8, role: 'ink', x: 15, top: 13 },
      { text: '11.26', font: 'sampler', size: 8, role: 'ink', x: 15, top: 20 },
      { text: 'DUNE', font: 'sampler', size: 8, role: 'ink', align: 'left', x: 3, top: 32 },
      { text: 'EMMA', font: 'sampler', size: 8, role: 'ink', align: 'left', x: 3, top: 43 },
      { text: 'SULA', font: 'sampler', size: 8, role: 'ink', align: 'left', x: 3, top: 54 },
      { text: 'CIRCE', font: 'sampler', size: 8, role: 'ink', align: 'left', x: 3, top: 65 },
      { text: 'TTL 4', font: 'sampler', size: 8, role: 'ink', align: 'left', x: 3, top: 82 },
      { text: 'THX', font: 'sampler', size: 8, role: 'ink', x: 15, top: 89 },
    ],
  },
  {
    ...BOOKMARK, id: 'moon-phases', name: 'Moon Phases', desc: 'Sampler · 2 colors',
    roles: [
      { id: 'sky', code: METIME.black, tone: 'dark' },
      { id: 'moon', code: METIME.golden, tone: 'light' },
    ],
    draw(cv, c) {
      cv.rect(0, 0, 30, 120, c.sky);
      // New to full in seven steps, lit from the right. A lit fraction f puts
      // the terminator at (1 - 2f) of the half-width on each row.
      const r = 5.5;
      for (let i = 0; i < 7; i++) {
        const cy = 11 + i * 13, f = i / 6;
        if (!f) { cv.ring(15, cy, r - 1, r, c.moon); continue; }
        for (let y = Math.floor(cy - r); y < cy + r; y++) for (let x = 9; x < 21; x++) {
          const dx = x + 0.5 - 15, dy = y + 0.5 - cy, half = Math.sqrt(Math.max(0, r * r - dy * dy));
          if (dx * dx + dy * dy < r * r && dx >= half * (1 - 2 * f)) cv.put(x, y, c.moon);
        }
      }
      for (const [x, y] of [[4, 6], [25, 17], [3, 29], [26, 41], [5, 54], [24, 66], [3, 79], [26, 90], [4, 95]]) cv.put(x, y, c.moon);
      for (const [x, y] of [[25, 5], [4, 43], [25, 80]]) cv.rect(x - 1, y, 3, 1, c.moon).rect(x, y - 1, 1, 3, c.moon);
    },
    texts: [
      { text: '6.14', font: 'sampler', size: 8, role: 'moon', x: 15, top: 101 },
      { text: '2019', font: 'sampler', size: 8, role: 'moon', x: 15, top: 108 },
    ],
  },
  {
    ...MEDIUM_HOOP, id: 'quote-sampler', name: 'Quote Sampler', desc: 'Sampler · 4 colors',
    roles: [
      { id: 'ink', code: METIME.black, tone: 'dark' },
      { id: 'flower', code: METIME.tomato, tone: 'accent' },
      { id: 'pot', code: METIME.golden, tone: 'accent' },
      { id: 'leaf', code: METIME.avocado, tone: 'mid' },
    ],
    draw(cv, c) {
      cv.box(20, 20, 80, 80, c.ink).box(22, 22, 76, 76, c.ink);
      for (let x = 26; x < 94; x += 2) cv.put(x, 53, c.flower);
      // A potted tulip either side of the initials.
      for (const cx of [35, 85]) {
        cv.poly([[cx - 5, 61], [cx - 2.5, 64], [cx, 61], [cx + 2.5, 64], [cx + 5, 61], [cx + 5, 66], [cx + 3, 69], [cx - 3, 69], [cx - 5, 66]], c.flower);
        cv.rect(cx - 1, 69, 2, 16, c.leaf);
        cv.poly([[cx - 1, 82], [cx - 7, 76], [cx - 8, 71], [cx - 3, 75], [cx - 1, 78]], c.leaf);
        cv.poly([[cx + 1, 82], [cx + 7, 76], [cx + 8, 71], [cx + 3, 75], [cx + 1, 78]], c.leaf);
        cv.rect(cx - 7, 85, 14, 2, c.pot);
        cv.poly([[cx - 6, 87], [cx + 6, 87], [cx + 4.5, 94], [cx - 4.5, 94]], c.pot);
      }
    },
    texts: [
      { text: 'STAYING IN\nIS THE PLAN', font: 'sampler', size: 8, role: 'ink', x: 60, top: 31 },
      { text: 'K & J', font: 'sampler', size: 8, role: 'ink', x: 60, top: 70 },
      { text: '2026', font: 'sampler', size: 8, role: 'flower', x: 60, top: 80 },
    ],
  },
  {
    ...MEDIUM_HOOP, id: 'recipe-card', name: 'Recipe Card', desc: 'Serif + Sampler · 4 colors',
    roles: [
      { id: 'ink', code: METIME.black, tone: 'dark' },
      { id: 'card', code: METIME.cream, tone: 'light' },
      { id: 'band', code: METIME.tomato, tone: 'accent' },
      { id: 'rule', code: METIME.ice, tone: 'mid' },
    ],
    draw(cv, c) {
      // An index card edged in the header's color, which also keeps the cream
      // card from vanishing into pale Aida.
      cv.rect(17, 20, 86, 80, c.band).rect(18, 38, 84, 61, c.card);
      for (let y = 63; y < 99; y += 8) cv.rect(20, y, 80, 1, c.rule);
    },
    texts: [
      { text: 'KITCHEN OF', font: 'sampler', size: 8, role: 'card', x: 60, top: 23 },
      { text: 'NONNA ROSE', font: 'sampler', size: 8, role: 'card', x: 60, top: 30 },
      { text: 'Sunday Sauce', font: 'serif', size: 10, role: 'band', x: 60, cy: 47 },
      { text: '2 LB TOMATOES', font: 'sampler', size: 8, role: 'ink', align: 'left', x: 21, top: 57 },
      { text: '1 ONION', font: 'sampler', size: 8, role: 'ink', align: 'left', x: 21, top: 65 },
      { text: '4 GARLIC', font: 'sampler', size: 8, role: 'ink', align: 'left', x: 21, top: 73 },
      { text: 'OLIVE OIL', font: 'sampler', size: 8, role: 'ink', align: 'left', x: 21, top: 81 },
      { text: 'FRESH BASIL', font: 'sampler', size: 8, role: 'ink', align: 'left', x: 21, top: 89 },
    ],
  },
  {
    ...MEDIUM_HOOP, id: 'polaroid', name: 'Polaroid', desc: 'Script · 4 colors',
    roles: [
      { id: 'frame', code: METIME.cream, tone: 'light' },
      { id: 'sun', code: METIME.tomato, tone: 'accent' },
      { id: 'glow', code: METIME.golden, tone: 'accent' },
      { id: 'sky', code: METIME.grapefruit, tone: 'mid' },
    ],
    draw(cv, c) {
      cv.rect(22, 17, 76, 86, c.frame);
      // Sky in two flat bands with the sun half set on the horizon (y 62).
      cv.rect(27, 22, 66, 20, c.sky).rect(27, 42, 66, 20, c.glow);
      for (let y = 48; y < 62; y++) for (let x = 46; x < 74; x++) {
        if (Math.hypot(x + 0.5 - 60, y + 0.5 - 62) < 14) cv.put(x, y, c.sun);
      }
      // Water: pink stripes split by thin lines of the frame's color, starting
      // with one along the horizon, and the sun's reflection in short golden
      // dashes that narrow down them.
      const glints = [[-11, 9], [3, 7], [-8, 6], [4, 10], [-6, 4], [1, 6], [-4, 3], [3, 4], [-3, 2], [1, 3], [-2, 2], [1, 1], [-1, 2], [0, 1], [-1, 1], [1, 1], [0, 1]];
      for (let y = 62, k = 0; y < 88; y++) {
        if ((y - 62) % 3 === 0) { cv.rect(27, y, 66, 1, c.frame); continue; }
        cv.rect(27, y, 66, 1, c.sky);
        const [dx, w] = glints[k++];
        cv.rect(60 + dx, y, w, 1, c.glow);
        if (k < 8) cv.rect(60 - dx - w + (k % 2 ? 2 : -2), y, Math.max(1, w - 3), 1, c.glow);
      }
    },
    texts: [
      { text: "summer '26", font: 'script', size: 13, role: 'sun', x: 60, cy: 95 },
    ],
  },
  {
    ...MEDIUM_HOOP, id: 'contour-map', name: 'Contour Map', desc: 'Serif + Sampler · 3 colors',
    roles: [
      { id: 'ink', code: METIME.black, tone: 'dark' },
      { id: 'sage', code: METIME.avocado, tone: 'mid' },
      { id: 'rust', code: METIME.tomato, tone: 'accent' },
    ],
    draw(cv, c) {
      cv.box(14, 24, 92, 72, c.ink);
      // Three hills. A stitch is on a contour where it's on the high side of a
      // height band's edge, which keeps diagonal runs joined at the corners.
      // Every third contour is in rust.
      const x0 = 15, x1 = 105, y0 = 25, y1 = 70, step = 0.12;
      const hill = (x, y, cx, cy, a, s) => a * Math.exp(-((x - cx) ** 2 + ((y - cy) * 1.25) ** 2) / (2 * s * s));
      const h = (x, y) => hill(x, y, 38, 44, 1, 15) + hill(x, y, 82, 38, 0.85, 13) + hill(x, y, 70, 68, 0.5, 10);
      const band = (x, y) => Math.floor(h(x + 0.5, y + 0.5) / step);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const b = band(x, y);
        let edge = false;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= x0 && nx < x1 && ny >= y0 && ny < y1 && band(nx, ny) < b) edge = true;
        }
        if (edge) cv.put(x, y, b % 3 ? c.sage : c.rust);
      }
      cv.rect(15, 70, 90, 1, c.ink);
    },
    texts: [
      { text: 'Saratoga', font: 'serif', size: 14, role: 'ink', x: 60, top: 74 },
      { text: '43.08 N 73.78 W', font: 'sampler', size: 8, role: 'rust', x: 60, top: 89 },
    ],
  },
];
