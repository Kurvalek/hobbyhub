import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { EdMenuButton } from './editor-ui.jsx';
import { IcCheck, IcHand, IcMinus, IcPlus, IcTrash } from './icons.jsx';

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

// Placed words as they're saved with a design: the stitches each placement
// covered become [index, what was there] pairs.
export const packTexts = list => list.map(({ cells, ...r }) => ({ ...r, cells: [...cells] }));
export const unpackTexts = list => (Array.isArray(list) ? list : [])
  .filter(r => r && typeof r.text === 'string' && Array.isArray(r.cells))
  .map(r => ({ ...r, page: r.page || 0, cells: new Map(r.cells) }));

// The box on the canvas: a textarea set in the chosen face at stitch scale,
// in the thread colour, so what you type is what gets stitched. `z` is screen
// pixels per stitch. Below 16px iOS zooms the page into a focused field, so a
// small box is laid out larger and scaled back down.
export function textOverEdge(box, font, size, board) {
  if (!box.text) return false;
  const L = layoutStitchText(box.text, font, size);
  return box.x < 0 || box.y < 0 || box.x + L.boxW > board.w || box.y + L.boxH > board.h;
}

export function StitchTextBox({ box, font, size, color, z, over, onChange, onCommit, inputRef, boxRef }) {
  const L = layoutStitchText(box.text || 'M', font, size);
  const f = L.font;
  const k = Math.max(1, 16 / (L.size * z));
  const taRef = useRef(null);
  const setRef = el => { taRef.current = el; if (inputRef) inputRef.current = el; };
  // A wide line can scroll the field sideways for a frame before the box grows
  // to fit; keep it pinned so the letters never drift off their stitches.
  useLayoutEffect(() => { const ta = taRef.current; if (ta) { ta.scrollLeft = 0; ta.scrollTop = 0; } });
  // Picking a face, height or colour moves focus to that button; hand it back
  // (or menu) so typing carries on. Sliders keep theirs, or the drag would stop.
  // Not on opening: whoever opened the box decides whether it takes focus (a
  // drag that lifts placed words shouldn't raise a phone keyboard).
  const opened = useRef(false);
  useEffect(() => {
    if (!opened.current) { opened.current = true; return; }
    const ta = taRef.current, a = document.activeElement;
    if (ta && a !== ta && (!a || a === document.body || a.tagName === 'BUTTON' || a.tagName === 'SELECT')) ta.focus({ preventScroll: true });
  }, [font, size, color]);
  return (
    <div ref={boxRef} className={`xs-textbox${over ? ' is-over' : ''}`} style={{ left: box.x * z, top: box.y * z, width: L.boxW * z, height: L.boxH * z }}>
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

// The open box's item menu, floating over it like a selection toolbar: a grip
// to move it, thread, face and height, delete and Done. It sits above the box,
// below it when there's no room, and centres on the part of the box that's on
// the board. Pressing its controls leaves the caret in the box.
export function StitchTextMenu({ boxRef, box, z, textFont, setTextFont, textSize, setTextSize, over, colorMenu, onMove, onDelete, onDone, cfg, compact = false }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  const place = useCallback(() => {
    const b = boxRef.current, m = ref.current;
    if (!b || !m) return;
    const stage = m.parentElement.getBoundingClientRect();
    const board = b.parentElement.getBoundingClientRect();
    const r = b.getBoundingClientRect();
    const mw = m.offsetWidth, mh = m.offsetHeight, gap = 14;
    // Worked in the stage's own coordinates; the menu is positioned inside it.
    const cx = (Math.max(r.left, board.left) + Math.min(r.right, board.right)) / 2 - stage.left;
    const left = Math.round(Math.max(8, Math.min(stage.width - 8 - mw, cx - mw / 2)));
    let top = r.top - stage.top - mh - gap, mode = 'above';
    if (top < 8) { top = r.bottom - stage.top + gap; mode = 'below'; }
    if (top + mh > stage.height - 8) { top = 8; mode = 'clamped'; }
    top = Math.round(top);
    const arrow = Math.round(Math.max(14, Math.min(mw - 14, cx - left)));
    setPos(p => (p && p.left === left && p.top === top && p.mode === mode && p.arrow === arrow ? p : { left, top, mode, arrow }));
  }, [boxRef]);
  useLayoutEffect(place);
  useEffect(() => {
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [place]);

  const drag = useRef(null);
  const onGrip = e => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, x0: box.x, y0: box.y };
  };
  const onGripMove = e => {
    const d = drag.current; if (!d) return;
    const x = d.x0 + Math.round((e.clientX - d.x) / z), y = d.y0 + Math.round((e.clientY - d.y) / z);
    if (x !== box.x || y !== box.y) onMove(x, y);
  };
  const onGripUp = () => { drag.current = null; };

  const f = fontOf(textFont);
  const pickFont = id => { setTextFont(id); setTextSize(s => snapTextSize(id, s)); };
  const step = d => setTextSize(s => stepTextSize(textFont, s, d));
  const [lo, hi] = sizeRange(textFont);
  return (
    <div ref={ref} className={`xs-textmenu ed-float ed-keep-text is-${pos ? pos.mode : 'above'}${compact ? ' is-compact' : ''}`} role="toolbar" aria-label="Text"
      style={pos ? { left: pos.left, top: pos.top, '--arrow-x': `${pos.arrow}px` } : { left: 0, top: 0, visibility: 'hidden' }}
      onMouseDown={e => e.preventDefault()}>
      <button type="button" className="icon-btn xs-textmenu-grip" aria-label="Move text" title="Drag to move"
        onPointerDown={onGrip} onPointerMove={onGripMove} onPointerUp={onGripUp} onPointerCancel={onGripUp}>
        <IcHand size={16}/>
      </button>
      <span className="ed-strip-sep"/>
      {colorMenu}
      <EdMenuButton label={`Lettering style: ${f.label}`} menuLabel="Style" width={200}
        trigger={<span className="xs-textmenu-font" style={{ fontFamily: f.family, fontWeight: f.weight }}>{compact ? 'Aa' : f.label}</span>}>
        <div className="xs-font-list" role="menu">
          {Object.keys(XS_FONTS).map(id => (
            <button key={id} type="button" role="menuitemradio" aria-checked={id === textFont}
              className={`xs-font-opt${id === textFont ? ' is-active' : ''}`}
              style={{ fontFamily: XS_FONTS[id].family, fontWeight: XS_FONTS[id].weight }} onClick={() => pickFont(id)}>
              <span>{XS_FONTS[id].label}</span>
              {id === textFont && <IcCheck size={14}/>}
            </button>
          ))}
        </div>
      </EdMenuButton>
      {/* A pixel face steps between the heights it's drawn at. */}
      <div className="ed-zoom-pill xs-text-size" role="group" aria-label={`Height in ${cfg.unitPlural}`}
        title={f.sizes ? `${f.label} comes in ${f.sizes.join(', ')} ${cfg.unitPlural} tall` : `Height in ${cfg.unitPlural}`}>
        <button type="button" onClick={() => step(-1)} disabled={textSize <= lo} aria-label="Smaller"><IcMinus/></button>
        <span className="ed-zoom-val">{textSize}</span>
        <button type="button" onClick={() => step(+1)} disabled={textSize >= hi} aria-label="Larger"><IcPlus/></button>
      </div>
      <span className="ed-strip-sep"/>
      {over && <span className="xs-textmenu-warn" role="status" title={`Only the part on the board is stitched`}>Off the edge</span>}
      <button type="button" className="icon-btn" onClick={onDelete} title="Delete text" aria-label="Delete text"><IcTrash size={16}/></button>
      <button type="button" className="btn btn-xs btn-dark" onClick={onDone} title="Stitch it (Esc)">Done</button>
    </div>
  );
}

