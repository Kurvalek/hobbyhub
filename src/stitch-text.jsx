import { useEffect, useLayoutEffect, useRef } from 'react';
import { IcHand, IcMinus, IcPlus } from './icons.jsx';

// Lettering for the grid studio. Words are typed into a box on the canvas, set
// in the real face at the size they'll be stitched, and only become stitches
// when the box is let go. The box and the stitches share one layout, worked in
// stitch units, so the letters land where they were typed.

// Script and Old Style are pixel faces drawn on a grid (Jacquarda Bastarda 9
// and Jacquard 12, after weaving and needlework charts). At the heights in
// `sizes` one pixel of the face is exactly one stitch, so they stitch exactly
// as drawn; anywhere between, pixels would split across stitches, so their
// height steps between those sizes only. Outline faces scale freely.
export const XS_FONTS = {
  serif:    { label: 'Serif',     family: '"Arvo", serif',                     weight: 700 },
  sans:     { label: 'Sans',      family: '"Cal Sans", sans-serif',            weight: 400 },
  script:   { label: 'Script',    family: '"Jacquarda Bastarda 9", serif',     weight: 400, sizes: [13, 26, 39] },
  sampler:  { label: 'Sampler',   family: '"Rye", serif',                      weight: 400 },
  oldstyle: { label: 'Old Style', family: '"Jacquard 12", serif',              weight: 400, sizes: [21, 42] },
  swash:    { label: 'Swash',     family: '"Oleo Script Swash Caps", cursive', weight: 700 },
};
export const XS_TEXT_MIN = 6, XS_TEXT_MAX = 40;
const fontOf = id => XS_FONTS[id] || XS_FONTS.sans;
// A height the face can be stitched at: the largest of its sizes that isn't
// taller than asked (or its smallest). Rounding down rather than to the
// nearest keeps hopping between faces from ratcheting the words up in size.
export function snapTextSize(fontId, size) {
  const sizes = fontOf(fontId).sizes;
  if (!sizes) return Math.max(XS_TEXT_MIN, Math.min(XS_TEXT_MAX, Math.round(size)));
  return [...sizes].reverse().find(s => s <= size) ?? sizes[0];
}
// One step up or down from `size`: the next allowed height for a pixel face.
export function stepTextSize(fontId, size, dir) {
  const sizes = fontOf(fontId).sizes;
  if (!sizes) return snapTextSize(fontId, size + dir);
  const next = dir > 0 ? sizes.find(s => s > size) : [...sizes].reverse().find(s => s < size);
  return next ?? size;
}
const sizeRange = fontId => {
  const sizes = fontOf(fontId).sizes;
  return sizes ? [sizes[0], sizes[sizes.length - 1]] : [XS_TEXT_MIN, XS_TEXT_MAX];
};

// Line pitch for multi-line text, in stitches. Tighter than a typographic
// leading would be: at this size the gap is counted in whole stitches, and
// anything looser reads as separate blocks rather than one stitched verse.
export function xsLineHeight(sizeCells) { return Math.max(sizeCells + 2, Math.round(sizeCells * 1.35)); }

let measureCtx = null;
const ctx2d = () => (measureCtx || (measureCtx = document.createElement('canvas').getContext('2d')));

// Where every line sits, in stitches from the box's top-left. Lines are centred
// in the box and their baselines fall where a CSS line box of the same height
// would put them, then both snap to whole stitches so letters start on the grid.
export function layoutStitchText(text, fontId, sizeCells) {
  const f = fontOf(fontId);
  const size = snapTextSize(fontId, sizeCells);
  const ctx = ctx2d();
  ctx.font = `${f.weight} ${size * 8}px ${f.family}`;
  const probe = ctx.measureText('Hg');
  const asc = (probe.fontBoundingBoxAscent ?? size * 8 * 0.8) / 8;
  const desc = (probe.fontBoundingBoxDescent ?? size * 8 * 0.2) / 8;
  const lineH = xsLineHeight(size);
  const raw = String(text).split('\n');
  const widths = raw.map(ln => ctx.measureText(ln).width / 8);
  const boxW = Math.max(1, Math.ceil(Math.max(...widths)));
  const lead = (lineH - (asc + desc)) / 2 + asc;
  const lines = raw.map((ln, i) => ({
    text: ln, w: widths[i],
    x: Math.round((boxW - widths[i]) / 2),
    baseline: Math.round(i * lineH + lead),
  }));
  return { lines, boxW, boxH: raw.length * lineH, lineH, size, font: f };
}

// The text as stitches: [dx,dy] offsets from the box's top-left (overhanging
// swashes can go negative). Drawn supersampled on the same grid the stitches
// use, and a stitch is kept when the letters cover at least half of it — which
// for a pixel face at one of its sizes is every pixel, exactly.
export function rasterizeText(text, fontId, sizeCells) {
  if (!text || !String(text).trim()) return [];
  const L = layoutStitchText(text, fontId, sizeCells);
  const { font: f, size } = L;
  const mx = Math.ceil(size * 0.6) + 2, my = Math.ceil(size * 0.6) + 2;
  const gw = L.boxW + 2 * mx, gh = L.boxH + 2 * my;
  // Eight samples a side is plenty; very long verses at the largest height
  // drop a little to keep the scratch canvas a sensible size.
  const ss = Math.max(3, Math.min(8, Math.floor(Math.sqrt(16e6 / (gw * gh)))));
  const cv = document.createElement('canvas');
  cv.width = gw * ss; cv.height = gh * ss;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.font = `${f.weight} ${size * ss}px ${f.family}`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#000';
  for (const ln of L.lines) {
    if (ln.text.trim()) ctx.fillText(ln.text, (mx + ln.x) * ss, (my + ln.baseline) * ss);
  }
  let data;
  try { data = ctx.getImageData(0, 0, cv.width, cv.height).data; } catch (e) { return []; }
  const rowW = cv.width, half = 255 * ss * ss * 0.5;
  const out = [];
  for (let cy = 0; cy < gh; cy++) {
    for (let cx = 0; cx < gw; cx++) {
      let sum = 0;
      for (let y = cy * ss; y < (cy + 1) * ss; y++) {
        let p = (y * rowW + cx * ss) * 4 + 3;
        for (let x = 0; x < ss; x++, p += 4) sum += data[p];
      }
      if (sum >= half) out.push([cx - mx, cy - my]);
    }
  }
  return out;
}

// The box on the canvas: a textarea set in the chosen face at stitch scale,
// in the thread colour, so what you type is what gets stitched. `z` is screen
// pixels per stitch. Below 16px iOS zooms the page into a focused field, so a
// small box is laid out larger and scaled back down.
export function StitchTextBox({ box, font, size, color, z, board, onChange, onCommit, onMove, inputRef }) {
  const L = layoutStitchText(box.text || 'M', font, size);
  const f = L.font;
  // Anything past the board's edge won't be stitched, so say so while typing.
  const over = !!box.text && (box.x < 0 || box.y < 0 || box.x + L.boxW > board.w || box.y + L.boxH > board.h);
  const k = Math.max(1, 16 / (L.size * z));
  const taRef = useRef(null);
  const setRef = el => { taRef.current = el; if (inputRef) inputRef.current = el; };
  // A wide line can scroll the field sideways for a frame before the box grows
  // to fit; keep it pinned so the letters never drift off their stitches.
  useLayoutEffect(() => { const ta = taRef.current; if (ta) { ta.scrollLeft = 0; ta.scrollTop = 0; } });
  // Picking a face, height or colour moves focus to that button; hand it back
  // (or menu) so typing carries on. Sliders keep theirs, or the drag would stop.
  useEffect(() => {
    const ta = taRef.current, a = document.activeElement;
    if (ta && a !== ta && (!a || a === document.body || a.tagName === 'BUTTON' || a.tagName === 'SELECT')) ta.focus({ preventScroll: true });
  }, [font, size, color]);
  const drag = useRef(null);
  const onGrip = e => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, dx: 0, dy: 0 };
  };
  const onGripMove = e => {
    const d = drag.current; if (!d) return;
    const dx = Math.round((e.clientX - d.x) / z), dy = Math.round((e.clientY - d.y) / z);
    if (dx !== d.dx || dy !== d.dy) { onMove(dx - d.dx, dy - d.dy); d.dx = dx; d.dy = dy; }
  };
  const onGripUp = () => { drag.current = null; taRef.current?.focus({ preventScroll: true }); };
  return (
    <div className={`xs-textbox${over ? ' is-over' : ''}`} style={{ left: box.x * z, top: box.y * z, width: L.boxW * z, height: L.boxH * z }}>
      {/* Kept on the board: pulled right when the box starts off its left edge,
          and dropped below the box when there's no room above it. */}
      <div className={`xs-textbox-bar${box.y * z < 34 ? ' is-below' : ''}`} style={{ left: Math.max(-4, -box.x * z + 4) }}>
        <button type="button" className="xs-textbox-grip" aria-label="Move text" title="Drag to move"
          onPointerDown={onGrip} onPointerMove={onGripMove} onPointerUp={onGripUp} onPointerCancel={onGripUp}>
          <IcHand size={14}/>
        </button>
        {over && <span className="xs-textbox-warn" role="status">Runs off the edge</span>}
      </div>
      <textarea ref={setRef} className="xs-textbox-input" value={box.text} wrap="off" spellCheck={false}
        autoComplete="off" aria-label="Text to stitch" placeholder="Type"
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); onCommit(); }
        }}
        style={{
          fontFamily: f.family, fontWeight: f.weight, color,
          fontSize: L.size * z * k, lineHeight: `${L.lineH * z * k}px`,
          width: L.boxW * z * k, height: L.boxH * z * k,
          transform: k > 1 ? `scale(${1 / k})` : undefined,
        }}/>
    </div>
  );
}

// Face and height, shared by the desktop panel and the mobile tray.
export function StitchTextControls({ textFont, setTextFont, textSize, setTextSize, cfg, editing, onDone, compact = false }) {
  const pickFont = id => { setTextFont(id); setTextSize(s => snapTextSize(id, s)); };
  const step = d => setTextSize(s => stepTextSize(textFont, s, d));
  const [lo, hi] = sizeRange(textFont);
  const sizes = fontOf(textFont).sizes;
  if (compact) {
    return (
      <div className="xs-text-strip">
        <select className="xs-text-font" value={textFont} onChange={e => pickFont(e.target.value)} aria-label="Lettering style"
          style={{ fontFamily: fontOf(textFont).family }}>
          {Object.keys(XS_FONTS).map(id => <option key={id} value={id}>{XS_FONTS[id].label}</option>)}
        </select>
        <div className="ed-zoom-pill xs-text-size" role="group" aria-label={`Height in ${cfg.unitPlural}`}>
          <button type="button" onClick={() => step(-1)} disabled={textSize <= lo} aria-label="Smaller"><IcMinus/></button>
          <span className="ed-zoom-val">{textSize}</span>
          <button type="button" onClick={() => step(+1)} disabled={textSize >= hi} aria-label="Larger"><IcPlus/></button>
        </div>
        {editing && <button type="button" className="btn btn-xs btn-dark" onClick={onDone}>Done</button>}
      </div>
    );
  }
  return (
    <>
      {/* Six faces don't fit one row at a readable size, so they wrap 2×3. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {Object.keys(XS_FONTS).map(id => (
          <button key={id} type="button" className={`btn btn-sm${textFont === id ? ' btn-dark' : ''}`}
            style={{ flex: '1 1 42%', fontFamily: XS_FONTS[id].family, fontSize: 14 }}
            onClick={() => pickFont(id)}>{XS_FONTS[id].label}</button>
        ))}
      </div>
      <label className="xs-ctrl" style={{ gap: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--warm-muted)' }}>Height</span>
        {/* A pixel face's slider walks its own sizes, one notch each. */}
        {sizes
          ? <input type="range" min={0} max={sizes.length - 1} step={1} value={Math.max(0, sizes.indexOf(textSize))}
              onChange={e => setTextSize(sizes[+e.target.value])} style={{ flex: 1 }} aria-label="Height"/>
          : <input type="range" min={lo} max={hi} value={textSize} onChange={e => setTextSize(+e.target.value)} style={{ flex: 1 }} aria-label="Height"/>}
        <span style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>{textSize}</span>
      </label>
      {sizes && <p className="ed-note" style={{ margin: 0 }}>{fontOf(textFont).label} is drawn {cfg.unit} by {cfg.unit}, so it comes in {sizes.join(', ')} for an exact match.</p>}
      {editing
        ? <button type="button" className="btn btn-dark" onClick={onDone}>Done · stitch it</button>
        : <p className="ed-note" style={{ margin: 0 }}>Click the canvas where the words should start, type, then click away to stitch them.</p>}
    </>
  );
}
