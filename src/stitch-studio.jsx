import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AIDA_FABRICS } from '../assets/color-catalogs.js';
import {
  ACCOUNTS_OFFLINE_SAVE_MSG, canonicalPresetName, deleteCloudDesign, loadSavedPunch,
  formatKitPrice, loadSavedStitches, persistSavedPunch, persistSavedStitches, stashPendingSave,
  upsertCloudDesign, useAuth, useKitPrices,
} from './services.jsx';
import { BuyKitButton, KitCheckoutButton } from './kit-checkout.jsx';
import {
  COASTER_COUNT, computeStitchStats, deserializeGrid, isCoasterSize, refitGrid,
  seedCoasterPages, serializeGrid,
} from './design-model.jsx';
import {
  IcArrowL, IcCheck, IcCircle, IcCopy, IcDrop, IcErase, IcGrid, IcHand, IcHelp, IcImage,
  IcLineTool, IcMarquee, IcPen, IcPlus, IcRedo, IcSave, IcSaved, IcSquare, IcText, IcTrash,
  IcUndo, IcX, MetimeLogo,
} from './icons.jsx';
import {
  DMC, DMC_PALETTES, dmcByCode, extractColors, nearestDMC, nearestWool, NIB_SIZES, PN_DEFAULT_CODES,
  PUNCH_CLOTHS, PUNCH_NEEDLE_PALETTE_MAX, PUNCH_PRESETS, resolveDmcPalette, resolveWoolPalette,
  STITCH_PRESETS, WOOL, WOOL_PALETTES, woolByCode, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP,
} from './catalog.jsx';
import {
  EdGuideFooter, EdHintBubble, EdMenu, EdMenuButton, EdNav, EdNavIcon, EdPaletteEditor,
  EdPaletteStarters, EdPanel, EdRow, EdSheet, EdSlider, EdStatCards, EdSwatch, edSwatchStyle,
  EdTipsSwitch, EdTools, EdZoomControls, EdZoomPill, inchDims, LibraryPopover, Switch,
  useCanvasPinchZoom, useEdGuide, useIsMobile, useShowTips,
} from './editor-ui.jsx';
import { AccountChip, AccountsOfflineNote } from './account.jsx';
import { gridSeedFromTemplate, stitchTemplatesFor } from './templates.jsx';
import {
  buildGridFromImage, punchImageBackground, xsFitImageToGrid, XS_SIMPLIFY, XS_SIMPLIFY_DEFAULT,
  xsSimplifySpec,
} from './photo.jsx';
import { CROSS_STITCH_PALETTE_MAX, StitchTemplateThumb } from './studio-shared.jsx';
import { studioCovered } from './kit-review.jsx';

// ── Cross-stitch: canvas editor ────────────────────────────────────────────
const XS_DEFAULT_CODES = ["310","B5200","666","797","700","726","435","3806","3846","971"];
// Everything the grid studio needs to know about the craft it is editing.
// The editor itself is craft-agnostic — cell grid, tools, selection, undo —
// so a craft is just a thread library, a ground fabric, a gauge and wording.
export const CRAFT_STUDIO = {
  'cross-stitch': {
    label: 'Cross-stitch',
    unit: 'stitch', unitPlural: 'stitches', unitTitle: 'Stitches',
    gauge: 14, gaugeLabel: '14-count', gaugeShort: '@14ct', gaugeBadge: '14 ct',
    majorGrid: 10,
    library: DMC, nearest: nearestDMC, byCode: dmcByCode, fallbackCode: '310',
    codePrefix: 'DMC', threadLabel: 'Floss', threadPlural: 'flosses', threadIcon: 'floss',
    palettes: DMC_PALETTES, resolvePalette: resolveDmcPalette,
    paletteMax: CROSS_STITCH_PALETTE_MAX, defaultCodes: XS_DEFAULT_CODES,
    fabrics: AIDA_FABRICS, fabricLabel: 'Aida',
    presets: STITCH_PRESETS, savedType: 'stitch',
    load: loadSavedStitches, persist: persistSavedStitches,
    checkoutType: 'cross-stitch',
  },
  'punch-needle': {
    label: 'Punch needle',
    unit: 'loop', unitPlural: 'loops', unitTitle: 'Loops',
    gauge: 5, gaugeLabel: '5 loops/in', gaugeShort: '@5/in', gaugeBadge: '5 lpi',
    // Wool is five times coarser than 14-count, so a 10-cell major line would
    // fall every two inches and stop being a useful counting aid.
    majorGrid: 5,
    library: WOOL, nearest: nearestWool, byCode: woolByCode, fallbackCode: 'NOIR',
    codePrefix: 'DMC', threadLabel: 'Yarn', threadPlural: 'yarns', threadIcon: 'yarn',
    palettes: WOOL_PALETTES, resolvePalette: resolveWoolPalette,
    paletteMax: PUNCH_NEEDLE_PALETTE_MAX, defaultCodes: PN_DEFAULT_CODES,
    fabrics: PUNCH_CLOTHS, fabricLabel: "Monk's cloth",
    presets: PUNCH_PRESETS, savedType: 'punch',
    load: loadSavedPunch, persist: persistSavedPunch,
    checkoutType: 'punch-needle',
  },
};
const XS_FONTS = {
  serif:    { label: "Serif",     family: '"Arvo", serif',                         weight: 700 },
  sans:     { label: "Sans",      family: '"Cal Sans", sans-serif',                weight: 400 },
  script:   { label: "Script",    family: '"Meow Script", cursive',                weight: 400 },
  sampler:  { label: "Sampler",   family: '"Rye", serif',                          weight: 400 },
  oldstyle: { label: "Old Style", family: '"Manufacturing Consent", serif',        weight: 400 },
  swash:    { label: "Swash",     family: '"Oleo Script Swash Caps", cursive',     weight: 700 },
};
// Line pitch for multi-line text, in stitches. Tighter than a typographic
// leading would be: at this size the gap is counted in whole stitches, and
// anything looser reads as separate blocks rather than one stitched verse.
function xsLineHeight(sizeCells) { return Math.max(sizeCells + 2, Math.round(sizeCells * 1.35)); }
// Render text to an offscreen canvas at 1px-per-stitch and return the list of
// [dx,dy] cell offsets that are "on" — i.e. the text as stitches. Newlines
// stack as centered lines, since a long phrase can't fit one line on a hoop
// and sampler layouts read centered anyway.
function rasterizeText(text, font, sizeCells) {
  if (!text) return [];
  const f = XS_FONTS[font] || XS_FONTS.sans;
  const size = Math.max(6, sizeCells);
  const fontStr = `${f.weight} ${size}px ${f.family}`;
  const lines = String(text).split('\n').map(s => s.trim());
  if (!lines.some(Boolean)) return [];
  const cv = document.createElement('canvas');
  let ctx = cv.getContext('2d');
  ctx.font = fontStr;
  const lineH = xsLineHeight(size);
  const metrics = lines.map(ln => {
    const m = ctx.measureText(ln || ' ');
    return {
      w: Math.ceil(m.width),
      asc: Math.ceil(m.actualBoundingBoxAscent || size * 0.8),
      desc: Math.ceil(m.actualBoundingBoxDescent || size * 0.25),
    };
  });
  // Baselines march down by lineH from the first line's ascent; the canvas has
  // to reach the lowest descender of any line, not just the last one.
  const base0 = metrics[0].asc + 1;
  const w = Math.max(1, Math.max(...metrics.map(m => m.w)) + 2);
  const h = Math.max(1, Math.max(...metrics.map((m, i) => base0 + i * lineH + m.desc)) + 1);
  cv.width = w; cv.height = h;
  ctx = cv.getContext('2d');
  ctx.font = fontStr;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#000';
  lines.forEach((ln, i) => { if (ln) ctx.fillText(ln, w / 2, base0 + i * lineH); });
  let data;
  try { data = ctx.getImageData(0, 0, w, h).data; } catch (e) { return []; }
  const out = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { if (data[(y * w + x) * 4 + 3] >= 128) out.push([x, y]); }
  return out;
}
// Text tool controls, shared by the desktop panel and the mobile sheet so the
// two can't drift apart. A textarea rather than a single-line input because
// stitched text is stacked — a phrase long enough to be worth saying doesn't
// fit across one hoop — so Enter starts a new centered line.
function StitchTextControls({ text, setText, textFont, setTextFont, textSize, setTextSize, autoFocus = false }) {
  return (
    <>
      {/* Four rows because the seeded verses run to four lines, and a shorter
          box hid the last one behind a scroll. */}
      <textarea rows={4} placeholder="Type text… Enter for a new line" value={text}
        onChange={e => setText(e.target.value)} autoFocus={autoFocus}
        style={{ resize: 'vertical', minHeight: 74, lineHeight: 1.35 }}/>
      {/* Six faces don't fit one row at a readable size, so they wrap 2×3. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {Object.keys(XS_FONTS).map(id => (
          <button key={id} className={`btn btn-sm${textFont === id ? ' btn-dark' : ''}`}
            style={{ flex: '1 1 42%', fontFamily: XS_FONTS[id].family, fontSize: 14 }}
            onClick={() => setTextFont(id)}>{XS_FONTS[id].label}</button>
        ))}
      </div>
      <label className="xs-ctrl" style={{ gap: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--warm-muted)' }}>Height</span>
        <input type="range" min={6} max={40} value={textSize} onChange={e => setTextSize(+e.target.value)} style={{ flex: 1 }}/>
        <span style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>{textSize}</span>
      </label>
      <div style={{ fontSize: 11, color: 'var(--warm-muted)' }}>Hover the canvas to place it, then click to stitch the text.</div>
    </>
  );
}
// Small canvas preview of a stitch grid (used in the saved-designs list/preview).
export function StitchThumb({ w, h, cells, size = 64, bg = '#FFFFFF' }) {
  const ref = useRef(null);
  // Fit the grid inside a size x size box at its own aspect ratio, so tall
  // strips (30x120 bookmarks) and wide grids are contained rather than cropped
  // by the caller's square thumb box.
  const scale = Math.min(size / w, size / h);
  const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext('2d');
    cv.width = cw; cv.height = ch;
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, cw, ch);
    for (let i = 0; i < cells.length; i++) {
      if (!cells[i]) continue;
      ctx.fillStyle = cells[i];
      ctx.fillRect((i % w) * scale, Math.floor(i / w) * scale, Math.ceil(scale), Math.ceil(scale));
    }
  }, [w, h, cells, cw, ch, scale, bg]);
  return <canvas ref={ref} style={{ width: cw, height: ch, maxWidth: '100%', maxHeight: '100%', display: 'block', margin: '0 auto', imageRendering: 'pixelated', borderRadius: 4 }}/>;
}

// ── Grid studio: tools + panels (cross-stitch and punch needle) ────────────
// `hint(verb, cfg)` gets 'Tap' or 'Click' and the craft's wording.
const STITCH_TOOLS = [
  { id: 'select', label: 'Select', key: 'V', Ic: IcMarquee, hint: v => `${v} a shape to select it · drag to box-select` },
  { id: 'pan', label: 'Move canvas', key: 'H', Ic: IcHand, hint: () => 'Drag to move around · pinch to zoom' },
  { id: 'pen', label: 'Pencil', key: 'P', Ic: IcPen, hint: (v, cfg) => `Drag to draw · ${v.toLowerCase()} for a single ${cfg.unit}` },
  { id: 'eraser', label: 'Eraser', key: 'E', Ic: IcErase, hint: (v, cfg) => `Drag to remove ${cfg.unitPlural}` },
  { id: 'fill', label: 'Fill', key: 'F', Ic: IcDrop, hint: v => `${v} an area to fill it with your color` },
  { id: 'line', label: 'Line', key: 'L', Ic: IcLineTool, hint: () => 'Drag from one end to the other' },
  { id: 'rect', label: 'Rectangle', key: 'R', Ic: IcSquare, hint: () => 'Drag to draw a rectangle' },
  { id: 'ellipse', label: 'Oval', key: 'O', Ic: IcCircle, hint: () => 'Drag to draw an oval' },
  { id: 'text', label: 'Text', key: 'T', Ic: IcText, hint: v => `Type your words, then ${v.toLowerCase()} the canvas to place them` },
];
// Tools that paint with the current color, so the palette rides along with them.
const STITCH_COLOR_TOOLS = new Set(['pen', 'fill', 'line', 'rect', 'ellipse', 'text']);

// Pencil-size icons from icons/pencil-size-{n}x{n}.svg, one per NIB_SIZES entry,
// with their stamp color swapped for the color being drawn with.
const NIB_ICON_STAMP = '#E8583A';
const nibIconCache = new Map();
function useNibIconSvg(n) {
  const [svg, setSvg] = useState(() => nibIconCache.get(n) || null);
  useEffect(() => {
    if (nibIconCache.has(n)) { setSvg(nibIconCache.get(n)); return undefined; }
    let alive = true;
    fetch(`icons/pencil-size-${n}x${n}.svg`).then(r => r.text()).then(t => {
      nibIconCache.set(n, t);
      if (alive) setSvg(t);
    }).catch(() => {});
    return () => { alive = false; };
  }, [n]);
  return svg;
}
function EdNibIcon({ nib, color }) {
  const svg = useNibIconSvg(nib);
  const fill = /^#[0-9a-f]{3,8}$/i.test(color?.hex || '') ? color.hex : 'var(--metime-black)';
  return (
    <span className="ed-nib-icon" aria-hidden="true"
      dangerouslySetInnerHTML={svg ? { __html: svg.split(NIB_ICON_STAMP).join(fill) } : undefined}/>
  );
}

function StitchNibs({ nib, onNib, cfg, label, color }) {
  return (
    <div className="ed-nibs" role="group" aria-label={`${label} size`}>
      {NIB_SIZES.map(n => (
        <button key={n} type="button" className={`ed-nib${nib === n ? ' is-active' : ''}`} aria-pressed={nib === n}
          title={`${n} × ${n} ${cfg.unitPlural} ( [ and ] )`} aria-label={`${n} × ${n}`} onClick={() => onNib(n)}>
          <EdNibIcon nib={n} color={color}/>
        </button>
      ))}
    </div>
  );
}

// The four coasters of a set as thumbnails, plus copying one across all four.
function StitchCoasterStrip({ pages, active, onSelect, onCopyAll, w, h, bg, className = '' }) {
  const [copied, setCopied] = useState(false);
  const tRef = useRef(null);
  useEffect(() => () => clearTimeout(tRef.current), []);
  const copy = () => {
    onCopyAll();
    setCopied(true);
    clearTimeout(tRef.current);
    tRef.current = setTimeout(() => setCopied(false), 1600);
  };
  return (
    <div className={`ed-coasters ${className}`}>
      <div className="ed-coaster-list ed-float" role="tablist" aria-label="Coasters in this set">
        {pages.map((cells, i) => (
          <button key={i} type="button" role="tab" aria-selected={active === i} data-ed-coaster={i}
            className={`ed-coaster${active === i ? ' is-active' : ''}`} title={`Coaster ${i + 1}`} aria-label={`Coaster ${i + 1}`}
            onClick={() => onSelect(i)}>
            <StitchThumb w={w} h={h} cells={cells} size={38} bg={bg}/>
            <span className="ed-coaster-n">{i + 1}</span>
          </button>
        ))}
      </div>
      <button type="button" className="btn ed-coaster-copy" onClick={copy} title="Replace the other three coasters with this one">
        {copied ? <>Copied <IcCheck size={12}/></> : 'Copy to all'}
      </button>
    </div>
  );
}

const loadImage = src => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error("Couldn't open that image."));
  img.src = src;
});
function readImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type || !file.type.startsWith('image/')) { reject(new Error('Please choose a JPG, PNG or WebP image.')); return; }
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.readAsDataURL(file);
  });
}

// Guided setup's own-image source, at the top of the Templates panel. Before an
// image: a drop target (click, drop or paste). After: the image and its two
// conversion settings, detail and background removal.
function StitchPhotoSource({ cfg, photo, busy, error, onFile, onDetail, onRemoveBg, onRemove }) {
  const fileRef = useRef(null);
  const [drag, setDrag] = useState(false);
  useEffect(() => {
    const onPaste = e => {
      const item = [...((e.clipboardData && e.clipboardData.items) || [])].find(i => i.type && i.type.startsWith('image/'));
      if (!item) return;
      e.preventDefault();
      onFile(item.getAsFile());
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [onFile]);
  const input = (
    <input ref={fileRef} type="file" accept="image/*" hidden data-ed-photo-input
      onChange={e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) onFile(f); }}/>
  );
  const chartsLabel = <div className="ed-label">Or start from a chart</div>;
  if (!photo) {
    return (
      <>
        <div className="ed-label">Use your own image</div>
        <button type="button" className={`ed-photo-drop${drag ? ' is-drag' : ''}`} disabled={busy}
          onClick={() => fileRef.current && fileRef.current.click()}
          onDragOver={e => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) onFile(f); }}>
          <IcImage size={20}/>
          <span className="ed-photo-drop-title">{busy ? 'Reading your image…' : 'Choose a photo'}</span>
          <span className="ed-photo-drop-sub">Or drop or paste one here, and we chart it in {cfg.threadLabel.toLowerCase()} colors.</span>
        </button>
        {error && <p className="ed-note ed-photo-error">{error}</p>}
        {input}
        <div className="ed-hr"/>
        {chartsLabel}
      </>
    );
  }
  return (
    <>
      <div className="ed-label">Your image</div>
      <div className="ed-photo-card" data-ed-photo>
        <img className={`ed-photo-thumb${photo.removeBg && photo.cutout ? ' is-cutout' : ''}`}
          src={(photo.removeBg && photo.cutout) || photo.original} alt="Your image"/>
        <div className="ed-photo-meta">
          <span className="ed-photo-name">{photo.name}</span>
          <span className="ed-photo-actions">
            <button type="button" className="ed-link" disabled={busy} onClick={() => fileRef.current && fileRef.current.click()}>Choose another</button>
            <button type="button" className="ed-link" onClick={onRemove}>Remove</button>
          </span>
        </div>
      </div>
      <div className="ed-sublabel">Detail</div>
      <div className="ed-seg" role="group" aria-label="Detail level">
        {XS_SIMPLIFY.map(s => (
          <button key={s.id} type="button" className={`ed-seg-btn${photo.simplify === s.id ? ' is-active' : ''}`}
            aria-pressed={photo.simplify === s.id} title={s.note} data-ed-detail={s.id} onClick={() => onDetail(s.id)}>{s.label}</button>
        ))}
      </div>
      <p className="ed-note">{xsSimplifySpec(photo.simplify).note}</p>
      <div className="ed-toggle-row">
        <span>Remove background</span>
        <Switch checked={photo.removeBg} onChange={onRemoveBg}
          title={photo.removeBg ? `Fill in the whole photo` : `Leave the background as bare ${cfg.fabricLabel}`}/>
      </div>
      {error && <p className="ed-note ed-photo-error">{error}</p>}
      {input}
      <div className="ed-hr"/>
      {chartsLabel}
    </>
  );
}

function StitchDesignsPanel({ cfg, templates, dims, fabric, isCoaster, onApply, photoSource = null }) {
  return (
    <>
      {photoSource}
      <p className="ed-intro">
        {isCoaster ? 'Starts this coaster (or the whole set) from a chart.' : 'Starts your canvas from a chart.'} Undo puts your design back.
      </p>
      <div className="ed-tiles">
        <button type="button" className="ed-tile" data-ed-template="blank" onClick={() => onApply(null)} title="Start from an empty canvas">
          <span className="ed-tile-thumb ed-tile-blank is-square" style={{ background: fabric.hex }}/>
          <span className="ed-tile-name">Blank</span>
        </button>
        {templates.map(t => (
          <button key={t.id} type="button" className="ed-tile" data-ed-template={t.id} title={t.desc} onClick={() => onApply(t)}>
            <span className="ed-tile-thumb is-square" style={{ background: fabric.hex }}>
              <StitchTemplateThumb tpl={t} preset={dims}/>
            </span>
            <span className="ed-tile-name">{t.name}{t.set ? ' · set' : ''}</span>
          </button>
        ))}
      </div>
      {templates.length === 0 && <p className="ed-note">There are no starter charts for this size yet.</p>}
      <p className="ed-note">Charts arrive in their own {cfg.threadLabel.toLowerCase()} colors, which join your palette.</p>
    </>
  );
}

function StitchFlossPanel({ cfg, pal, setPal, isActive, onPick, onAdd, stats, isCoaster, starters = null }) {
  const filled = stats.possible ? Math.round(stats.total / stats.possible * 100) : 0;
  return (
    <>
      {starters}
      <EdPaletteEditor pinned={pal} setPinned={setPal} isActive={isActive} onPick={onPick} onAdd={onAdd}
        addLabel={`Add ${cfg.threadLabel.toLowerCase()} from the library`}/>
      <EdStatCards items={[
        { k: cfg.unitTitle, v: stats.total.toLocaleString() },
        { k: 'Colors', v: stats.colors.length },
        { k: 'Covered', v: `${filled}%` },
      ]}/>
      <div className="ed-hr"/>
      <div className="ed-label">
        <span>{cfg.threadLabel} by color</span>
        {isCoaster && <span>All 4 coasters</span>}
      </div>
      {stats.colors.length === 0 ? (
        <p className="ed-intro">Add {cfg.unitPlural} to see your {cfg.threadLabel.toLowerCase()} list.</p>
      ) : (
        <div className="ed-list">
          {stats.colors.map(c => (
            <EdRow key={c.hex} swatch={c} title={`${cfg.codePrefix} ${c.code}`} name={c.name}
              value={c.count.toLocaleString()} onClick={() => onPick(c)}/>
          ))}
        </div>
      )}
      <p className="ed-note">Counts are {cfg.unitPlural}. Tap a color to draw with it.</p>
    </>
  );
}

function StitchFabricPanel({ cfg, fabric, setFabric, finished, bg, showBg, setShowBg, bgOpacity, setBgOpacity }) {
  return (
    <>
      <div className="ed-label">{cfg.fabricLabel} color</div>
      <div className="ed-list">
        {cfg.fabrics.map(f => (
          <div key={f.name} data-ed-fabric={f.name}>
            <EdRow swatch={f} title={f.name} sub={cfg.gaugeLabel}
              value={fabric.name === f.name ? <IcCheck size={16}/> : null} onClick={() => setFabric(f)}/>
          </div>
        ))}
      </div>
      <EdStatCards items={[
        { k: 'Count', v: cfg.gaugeLabel },
        { k: 'Finished', v: finished },
      ]}/>
      {bg && (
        <>
          <div className="ed-hr"/>
          <div className="ed-label">Tracing photo</div>
          <div className="ed-toggle-row" style={{ marginTop: 0 }}>
            <span>Show under the design</span>
            <Switch checked={showBg} onChange={setShowBg} title={showBg ? 'Hide the photo' : 'Show the photo'}/>
          </div>
          {showBg && (
            <EdSlider label="Opacity" value={Math.round(bgOpacity * 100)} display={`${Math.round(bgOpacity * 100)}%`}
              min={10} max={100} step={5} onChange={v => setBgOpacity(v / 100)}/>
          )}
        </>
      )}
    </>
  );
}

function StitchSizePanel({ cfg, current, onPick, W, H, finishedDims }) {
  const prices = useKitPrices(cfg.checkoutType);
  return (
    <>
      <div className="ed-label">Finished size</div>
      <div className="ed-choices">
        {cfg.presets.map(p => (
          <button key={p.name} type="button" className={`ed-choice${current === p.name ? ' is-active' : ''}`}
            aria-pressed={current === p.name} data-ed-size={p.name} onClick={() => onPick(p.name)}>
            <span className="ed-choice-name">{p.name}</span>
            <span className="ed-choice-sub">{finishedDims(p)}</span>
            <span className="ed-choice-sub">{p.w} × {p.h}{isCoasterSize(p.name) ? ' · set of 4' : ''}</span>
            {prices[p.name] && <span className="ed-choice-price">{formatKitPrice(prices[p.name])}</span>}
          </button>
        ))}
      </div>
      <EdStatCards items={[
        { k: 'Grid', v: `${W} × ${H}` },
        { k: 'Finished', v: finishedDims({ w: W, h: H }) },
        { k: 'Count', v: cfg.gaugeLabel },
      ]}/>
      <p className="ed-note">Your {cfg.unitPlural} keep their scale and stay centered. Anything outside a smaller size is cropped, and undo puts it back.</p>
    </>
  );
}

function StitchHelpPanel({ cfg, isMobile, showTips, setShowTips }) {
  const v = isMobile ? 'Tap' : 'Click';
  const tips = [
    { Ic: IcPen, t: 'Pencil & eraser', k: 'P · E', d: `Drag to draw or remove ${cfg.unitPlural}. The size buttons draw ${cfg.unitPlural} up to 5 wide${isMobile ? '' : ', and [ and ] step through them'}.` },
    { Ic: IcDrop, t: 'Fill', k: 'F', d: `${v} an area to fill everything of that color that touches it.` },
    { Ic: IcSquare, t: 'Line, rectangle & oval', k: 'L · R · O', d: 'Drag from corner to corner. The shape draws in your current color.' },
    { Ic: IcText, t: 'Text', k: 'T', d: `Type in the Text panel, pick a style and height, then ${v.toLowerCase()} the canvas to stitch it.` },
    { Ic: IcMarquee, t: 'Select', k: 'V', d: isMobile
      ? 'Tap a shape to select it, or drag to box-select. Drag to move it, pull a handle to resize, or tap a color to recolor it.'
      : 'Click a shape or drag a box. Shift adds, ⌥-drag copies, handles resize, ⌘D duplicates and Delete removes.' },
    { Ic: IcHand, t: 'Move canvas', k: 'H', d: isMobile ? 'Drag to look around. Pinch to zoom.' : 'Drag to look around. Pinch or ⌘-scroll to zoom.' },
    { Ic: IcUndo, t: 'Undo & redo', k: '⌘Z', d: 'Changes can be undone, including starter charts and clearing.' },
  ];
  return (
    <div className="ed-tips">
      <EdTipsSwitch checked={showTips} onChange={setShowTips}/>
      {tips.map(({ Ic, t, k, d }) => (
        <div key={t} className="ed-tip">
          <span className="ed-tip-ic"><Ic size={16}/></span>
          <div>
            <b>{t}{!isMobile && <span className="ed-kbd">{k}</span>}</b>
            <p>{d}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// `guided` is how a new design starts: the studio opens on Size and steps
// through the guide (size, starting point, colors, fabric) before free editing.
// A saved design opens without it, straight into editing.
export function CrossStitchApp({ preset, palette, initialDesign = null, onBack, craft = 'cross-stitch', guided = false, onReview = null }) {
  const CFG = CRAFT_STUDIO[craft] || CRAFT_STUDIO['cross-stitch'];
  const GUIDE = useMemo(() => [
    { id: 'size', title: 'Choose a size', next: 'Next: Starting point' },
    { id: 'designs', title: 'Pick a starting point', next: `Next: ${CFG.threadLabel}` },
    { id: 'floss', title: 'Choose your colors', next: `Next: ${CFG.fabricLabel}` },
    { id: 'fabric', title: `Choose your ${CFG.fabricLabel}`, next: 'Start designing' },
  ], [CFG]);
  // Board dimensions are stateful (not fixed to the initial preset) so a saved
  // design opened via loadDesign can restore the exact size it was made at,
  // rather than being forced into the currently active canvas size.
  const [dims, setDims] = useState({ w: preset.w, h: preset.h, name: preset.name });
  const W = dims.w, H = dims.h;
  const isMobile = useIsMobile();
  // The open panel: the desktop side panel, or the mobile sheet (null shows the
  // tools tray).
  const restingPanel = mobile => (mobile ? null : 'floss');
  const [panel, setPanel] = useState(() => guided ? 'size'
    : restingPanel(typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches));
  const guideCtl = useEdGuide({ steps: GUIDE, enabled: guided, panel, setPanel });
  const guide = guideCtl.on;
  const wasMobileRef = useRef(isMobile);
  useEffect(() => {
    if (wasMobileRef.current === isMobile) return;
    wasMobileRef.current = isMobile;
    if (guide) return;
    setPanel(p => (p === 'text' ? p : restingPanel(isMobile)));
  }, [isMobile]);
  const togglePanel = useCallback(id => {
    guideCtl.cancel();
    setPanel(p => p === id ? null : id);
  }, [guideCtl.cancel]);
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);
  const showToast = useCallback(msg => {
    setToast(msg);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 2200);
  }, []);
  const defaultPalette = useMemo(() => CFG.defaultCodes.map(CFG.byCode).filter(Boolean), [CFG]);
  const initPalette = useMemo(
    () => ((palette && palette.length) ? palette.slice() : defaultPalette.slice()),
    [palette, defaultPalette]);

  const [pal, setPal] = useState(initPalette);
  const [color, setColor] = useState(initPalette[0] || CFG.byCode(CFG.fallbackCode));
  const [tool, setTool] = useState("pen");
  // Text has its own panel, so picking it opens the panel and leaving it
  // returns to the resting one.
  const chooseTool = useCallback((id) => {
    setTool(id);
    if (id === 'text') setPanel('text');
    else setPanel(p => (p === 'text' ? restingPanel(isMobile) : p));
  }, [isMobile]);
  // Nib width is remembered per tool, so a fat eraser doesn't also fatten the
  // pencil when you switch back to it.
  const [penNib, setPenNib] = useState(1);
  const [eraserNib, setEraserNib] = useState(1);
  const nib = tool === 'eraser' ? eraserNib : penNib;
  const [bg, setBg] = useState(null);
  const [showBg, setShowBg] = useState(false);
  const [bgOpacity, setBgOpacity] = useState(0.5);
  const [showGrid, setShowGrid] = useState(true);
  const [cellSize, setCellSize] = useState(12);
  // The backing store is drawn at device resolution while the element keeps its
  // CSS size, so selection chrome can be stroked a true single device pixel wide
  // instead of being a bitmap pixel that the browser then blows up.
  const dpr = Math.min(3, Math.max(1, (typeof window !== 'undefined' && window.devicePixelRatio) || 1));
  const [confirmClear, setConfirmClear] = useState(false);
  const [zoom, setZoom] = useState(1);
  const adjustZoom = useCallback((delta) => {
    setZoom(z => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, +(z + delta).toFixed(2))));
  }, []);
  const resetZoom = useCallback(() => setZoom(1), []);
  const [fabric, setFabric] = useState(CFG.fabrics[0]);
  const [text, setText] = useState("");
  const [textFont, setTextFont] = useState("sans");
  const [textSize, setTextSize] = useState(14);
  // Canvas falls back to a generic face without complaint when a webfont hasn't
  // arrived yet, so early in a session the script and sampler styles rasterized
  // as plain serif — same cell count as Serif, wrong letterforms. Wait for the
  // faces, then re-rasterize. fontsReady is in the memo's deps purely to
  // retrigger it once they land.
  const [fontsReady, setFontsReady] = useState(() => typeof document === 'undefined' || !document.fonts);
  useEffect(() => {
    if (typeof document === 'undefined' || !document.fonts) return;
    let alive = true;
    Promise.all(Object.values(XS_FONTS).map(f =>
      document.fonts.load(`${f.weight} 16px ${f.family}`).catch(() => null)
    )).then(() => { if (alive) setFontsReady(true); });
    return () => { alive = false; };
  }, []);
  const textStamp = useMemo(() => rasterizeText(text, textFont, textSize), [text, textFont, textSize, fontsReady]);
  // Materials + save state (mirrors the quilt flow; cloud library when signed in).
  const auth = useAuth();
  const user = auth && auth.user;
  const cloudEnabled = !!(auth && auth.cloudEnabled);
  const cloudBlocked = !!(auth && auth.cloudBlocked);
  const libraryOn = !!(auth && auth.libraryOn);
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion(v => v + 1), []);
  const [savedStitches, setSavedStitches] = useState([]);
  const [saveError, setSaveError] = useState("");
  const stitchCacheReady = useRef(false);
  const [showSave, setShowSave] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [showMyStitches, setShowMyStitches] = useState(false);
  const [viewStitch, setViewStitch] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [materialsOpen, setMaterialsOpen] = useState(true);
  // Id of the saved design currently open, so "Save" updates it in place.
  const [currentStitchId, setCurrentStitchId] = useState(null);
  const [justSaved, setJustSaved] = useState(false);
  const savedFlashRef = useRef(null);
  const flashSaved = useCallback(() => {
    setJustSaved(true);
    if (savedFlashRef.current) clearTimeout(savedFlashRef.current);
    savedFlashRef.current = setTimeout(() => setJustSaved(false), 1600);
  }, []);
  const currentStitch = savedStitches.find(d => d.id === currentStitchId) || null;
  // Color library popover (mirrors the quilt "My palette" + / library pattern).
  const [search, setSearch] = useState("");
  const [grp, setGrp] = useState("All");
  const [xsCustoms, setXsCustoms] = useState([]);
  const [picker, setPicker] = useState(null);
  const libraryAnchorRef = useRef(null);
  const openLibrary = useCallback((anchorRef, placement) => {
    if (anchorRef && anchorRef.current) libraryAnchorRef.current = anchorRef.current;
    setPicker({ placement });
  }, []);
  const closePicker = useCallback(() => setPicker(null), []);
  const allColors = useMemo(() => [...CFG.library, ...xsCustoms], [xsCustoms, CFG]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allColors.filter(c =>
      (grp === "All" || c.group === grp) &&
      (!q || c.name.toLowerCase().includes(q) || (c.code && c.code.toLowerCase().includes(q))));
  }, [allColors, search, grp]);
  const dmcSuggested = useMemo(() => CFG.palettes.map(p => ({ name: p.name, colors: CFG.resolvePalette(p) })), [CFG]);
  useEffect(() => {
    if (!libraryOn || !stitchCacheReady.current) return;
    const ok = CFG.persist(savedStitches);
    setSaveError(ok ? "" : "Couldn't save. This device's storage may be full.");
  }, [savedStitches, libraryOn]);
  useEffect(() => {
    if (!libraryOn) { stitchCacheReady.current = false; setSavedStitches([]); return; }
    setSavedStitches(CFG.load());
    stitchCacheReady.current = true;
  }, [libraryOn, auth && auth.libraryTick, CFG]);
  useEffect(() => {
    if (!auth || !auth.lastSaved || auth.lastSaved.type !== CFG.checkoutType) return;
    setCurrentStitchId(auth.lastSaved.record.id);
    flashSaved();
    auth.consumeLastSaved();
  }, [auth && auth.lastSaved, CFG.checkoutType]);

  const pagesRef = useRef(null);
  const undoPagesRef = useRef(null);
  const [activeCoaster, setActiveCoaster] = useState(0);
  const activeCoasterRef = useRef(0);
  activeCoasterRef.current = activeCoaster;
  const isCoasterKit = isCoasterSize(dims.name);
  // Seeded once, on the first render only. `useRef(expr)` evaluates `expr`
  // every render and throws all but the first away, so this has to guard
  // itself: seeding the pages again on a later render would hand back a set of
  // blank coasters and drop whatever had been stitched on them.
  const cellsRef = useRef(null);
  if (cellsRef.current === null) {
    const seed = new Array(W * H).fill(null);
    if (!initialDesign && isCoasterSize(preset.name)) {
      const pages = seedCoasterPages(seed, W * H, null);
      pagesRef.current = pages;
      undoPagesRef.current = Array.from({ length: COASTER_COUNT }, () => []);
      cellsRef.current = pages[0];
    } else {
      cellsRef.current = seed;
    }
  }
  const previewRef = useRef(null);
  const nibHoverRef = useRef(null); // [x,y] under the pointer, outlined for wide nibs
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const bgImgRef = useRef(null);
  const rafRef = useRef(0);
  const undoRef = useRef((undoPagesRef.current && undoPagesRef.current[0]) || []);
  const drawingRef = useRef(false);
  const startRef = useRef(null);
  const lastRef = useRef(null);
  // Selection = one or more color groups. Stored as a Map of cell index -> hex
  // so a selection can span multiple colors (shift-add or marquee).
  const selRef = useRef(null);   // {cells:Map<number,string>, minX,minY,maxX,maxY} | null
  const dragRef = useRef(null);  // {dx,dy} in cells, while moving
  const movingRef = useRef(false);
  const pressRef = useRef(null);   // press awaiting the drag threshold: tap = pick a color group, drag = marquee
  const marqueeRef = useRef(null); // {x0,y0,x1,y1,add} while rubber-band selecting
  const resizeRef = useRef(null);  // {handle, start:{minX..maxY}} while dragging a handle
  const antsRef = useRef(0);       // marching-ants dash offset
  const [hasSel, setHasSel] = useState(false);
  const [selCursor, setSelCursor] = useState(null); // css cursor while over the selection
  // Aspect-ratio lock for corner resizes. Shift flips it, so the keyboard
  // convention still works and touch has a control of its own.
  const [lockRatio, setLockRatio] = useState(false);
  // The selection lives in a ref because the pointer handlers rewrite it every
  // frame, so its *contents* changing (shift-add, recolor, lift) needs an
  // explicit nudge to repaint the selection bar.
  const [, setSelTick] = useState(0);
  const touchSel = () => { setHasSel(!!selRef.current); setSelTick(t => t + 1); };

  const idx = (x, y) => y * W + x;
  const bindActivePage = () => {
    if (pagesRef.current) pagesRef.current[activeCoasterRef.current] = cellsRef.current;
  };
  const selectCoaster = (i) => {
    if (!pagesRef.current || i === activeCoaster) return;
    if (typeof commitFloat === 'function' && commitFloat()) { /* placed */ }
    selRef.current = null; movingRef.current = false;
    dragRef.current = null; marqueeRef.current = null; pressRef.current = null;
    setHasSel(false); setSelCursor(null);
    // Park the coaster being left before reaching for the next one.
    bindActivePage();
    if (undoPagesRef.current) undoPagesRef.current[activeCoaster] = undoRef.current;
    setActiveCoaster(i);
    activeCoasterRef.current = i;
    cellsRef.current = pagesRef.current[i];
    undoRef.current = (undoPagesRef.current && undoPagesRef.current[i]) || [];
    redoRef.current = [];
    previewRef.current = null;
    redraw(); bump();
  };
  const copyCoasterToAll = () => {
    if (!pagesRef.current) return;
    const src = cellsRef.current.slice();
    pagesRef.current = pagesRef.current.map((_, i) => i === activeCoaster ? cellsRef.current : src.slice());
    if (undoPagesRef.current) {
      undoPagesRef.current = undoPagesRef.current.map((stack, i) => i === activeCoaster ? stack : []);
    }
    redoRef.current = [];
    bump();
  };

  // Counts describe what the board will look like once a floating selection
  // lands, so the float is composited in before tallying. For a coaster set
  // the materials list is the sum of all four pages.
  const stats = useMemo(() => {
    const sel = selRef.current;
    const withFloat = (cells) => {
      if (!(sel && sel.floating)) return cells;
      const next = cells.slice();
      for (const [i, hex] of sel.cells) next[i] = hex;
      return next;
    };
    if (pagesRef.current) {
      const merged = [];
      const active = activeCoasterRef.current;
      for (let i = 0; i < pagesRef.current.length; i++) {
        const page = i === active ? withFloat(cellsRef.current) : pagesRef.current[i];
        for (const h of page) merged.push(h);
      }
      return computeStitchStats(merged, W, H * COASTER_COUNT, pal, CFG.library);
    }
    return computeStitchStats(withFloat(cellsRef.current), W, H, pal, CFG.library);
  }, [version, pal, W, H, CFG, activeCoaster]);

  const redraw = useCallback(() => {
    const cv = canvasRef.current; if (!cv) return;
    const ctx = cv.getContext('2d');
    const cs = cellSize;
    // Everything below is authored in CSS pixels; the transform maps them onto
    // the device-resolution backing store.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cw = cv.width / dpr, ch = cv.height / dpr;
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = fabric.hex;
    ctx.fillRect(0, 0, cw, ch);
    // Selection chrome is drawn a hairline wide: one CSS pixel on screen, so it
    // never fattens as the board is zoomed, but never thinner than a whole
    // backing-store pixel either — a sub-pixel stroke antialiases to grey mush
    // once the bitmap is scaled up. `align` nudges an odd-width stroke onto a
    // device-pixel boundary instead of letting it straddle two.
    const hair = Math.max(1 / zoom, 1 / dpr);
    const align = Math.round(hair * dpr) % 2 ? 0.5 / dpr : 0;
    if (showBg && bgImgRef.current) {
      const img = bgImgRef.current;
      ctx.save();
      ctx.globalAlpha = bgOpacity;
      // Same fit the design was generated with, so the trace sits under the
      // stitches it produced instead of drifting off across the margins.
      const fit = xsFitImageToGrid(img, W, H);
      if (fit) ctx.drawImage(img, fit.sx, fit.sy, fit.sw, fit.sh, fit.dx * cs, fit.dy * cs, fit.dw * cs, fit.dh * cs);
      ctx.restore();
    }
    const cells = cellsRef.current;
    const sel = selRef.current;
    // The grid never holds a floating layer, so it paints as-is; the float is
    // composited on top below and only merges in when it is committed.
    for (let i = 0; i < cells.length; i++) {
      if (!cells[i]) continue;
      ctx.fillStyle = cells[i];
      ctx.fillRect((i % W) * cs, Math.floor(i / W) * cs, cs, cs);
    }
    const pv = previewRef.current;
    if (pv) { ctx.fillStyle = color.hex; for (const [x, y] of pv) ctx.fillRect(x * cs, y * cs, cs, cs); }
    // Wide pencil/eraser nib: outline the block the pointer is about to cover,
    // in the same hairline-over-white treatment as the selection chrome.
    const nh = nibHoverRef.current;
    if (nh && nib > 1) {
      const off = Math.floor((nib - 1) / 2);
      const nx = (nh[0] - off) * cs, ny = (nh[1] - off) * cs, ns = nib * cs;
      ctx.save();
      ctx.translate(align, align);
      ctx.lineWidth = 3 * hair;
      ctx.strokeStyle = 'rgba(255,255,255,0.62)';
      ctx.strokeRect(nx, ny, ns, ns);
      ctx.lineWidth = hair;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeRect(nx, ny, ns, ns);
      ctx.restore();
    }
    if (sel) {
      const dxo = movingRef.current && dragRef.current ? dragRef.current.dx : 0;
      const dyo = movingRef.current && dragRef.current ? dragRef.current.dy : 0;
      for (const [i, hex] of sel.cells) {
        ctx.fillStyle = hex;
        ctx.fillRect(((i % W) + dxo) * cs, (Math.floor(i / W) + dyo) * cs, cs, cs);
      }
      const inSel = (xx, yy) => xx >= 0 && yy >= 0 && xx < W && yy < H && sel.cells.has(idx(xx, yy));
      const edge = new Path2D();
      for (const i of sel.cells.keys()) {
        const x = i % W, y = Math.floor(i / W);
        const px = (x + dxo) * cs, py = (y + dyo) * cs;
        if (!inSel(x, y - 1)) { edge.moveTo(px, py); edge.lineTo(px + cs, py); }
        if (!inSel(x, y + 1)) { edge.moveTo(px, py + cs); edge.lineTo(px + cs, py + cs); }
        if (!inSel(x - 1, y)) { edge.moveTo(px, py); edge.lineTo(px, py + cs); }
        if (!inSel(x + 1, y)) { edge.moveTo(px + cs, py); edge.lineTo(px + cs, py + cs); }
      }
      // The outline: one hairline hugging the selected stitches, over a soft
      // light underlay so it reads on pale Aida and dark stitching alike.
      ctx.save();
      ctx.translate(align, align);
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3 * hair;
      ctx.strokeStyle = 'rgba(255,255,255,0.62)';
      ctx.stroke(edge);
      ctx.lineWidth = hair;
      ctx.strokeStyle = 'rgba(0,0,0,0.92)';
      ctx.stroke(edge);
      ctx.restore();
      // The frame carries the resize affordance: a faint hairline box with a
      // slow travelling dash, quiet enough not to compete with the outline. The
      // rect is one continuous subpath, so the dashes actually crawl (the
      // per-cell outline above cannot — its dash phase restarts every segment).
      const f = selFrame(sel);
      const hx0 = (f.minX + dxo) * cs, hx1 = (f.maxX + 1 + dxo) * cs;
      const hy0 = (f.minY + dyo) * cs, hy1 = (f.maxY + 1 + dyo) * cs;
      ctx.save();
      ctx.translate(align, align);
      ctx.lineWidth = 3 * hair;
      ctx.strokeStyle = 'rgba(255,255,255,0.30)';
      ctx.strokeRect(hx0, hy0, hx1 - hx0, hy1 - hy0);
      ctx.lineWidth = hair;
      ctx.strokeStyle = 'rgba(0,0,0,0.44)';
      ctx.setLineDash([4 * hair, 4 * hair]);
      ctx.lineDashOffset = -antsRef.current * hair;
      ctx.strokeRect(hx0, hy0, hx1 - hx0, hy1 - hy0);
      ctx.restore();
      // Handles: small, crisp, hairline-ringed dots. Drawn at a constant screen
      // size, and deliberately smaller than the grab radius in `handleAt` — the
      // target stays as generous as ever, especially for touch.
      const hs = 8 / zoom, hr = 2 / zoom;
      ctx.save();
      ctx.translate(align, align);
      ctx.lineWidth = hair;
      for (const [, fx, fy] of SEL_HANDLES) {
        const px = hx0 + (hx1 - hx0) * fx - hs / 2, py = hy0 + (hy1 - hy0) * fy - hs / 2;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(px, py, hs, hs, hr); else ctx.rect(px, py, hs, hs);
        ctx.fillStyle = '#FFFFFF';
        ctx.shadowColor = 'rgba(0,0,0,0.38)';
        ctx.shadowBlur = 4 * hair;
        ctx.shadowOffsetY = hair;
        ctx.fill();
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
        ctx.strokeStyle = 'rgba(0,0,0,0.88)';
        ctx.stroke();
      }
      ctx.restore();
    }
    const mq = marqueeRef.current;
    if (mq) {
      const x = Math.min(mq.x0, mq.x1), y = Math.min(mq.y0, mq.y1);
      const w = Math.abs(mq.x1 - mq.x0) + 1, h = Math.abs(mq.y1 - mq.y0) + 1;
      // Rubber band, styled to match the selection chrome: a neutral tint under
      // a hairline, rather than an off-brand blue.
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      ctx.fillRect(x * cs, y * cs, w * cs, h * cs);
      ctx.translate(align, align);
      ctx.lineWidth = 3 * hair;
      ctx.strokeStyle = 'rgba(255,255,255,0.50)';
      ctx.strokeRect(x * cs, y * cs, w * cs, h * cs);
      ctx.lineWidth = hair;
      ctx.strokeStyle = 'rgba(0,0,0,0.72)';
      ctx.strokeRect(x * cs, y * cs, w * cs, h * cs);
      ctx.restore();
    }
    if (showGrid && cs >= 5) {
      // The canvas is exactly the board, so lines on the far edges are pulled
      // one pixel in; otherwise the right and bottom borders fall outside it.
      const gx = x => Math.min(x * cs, W * cs - 1) + 0.5;
      const gy = y => Math.min(y * cs, H * cs - 1) + 0.5;
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= W; x++) { ctx.moveTo(gx(x), 0); ctx.lineTo(gx(x), H * cs); }
      for (let y = 0; y <= H; y++) { ctx.moveTo(0, gy(y)); ctx.lineTo(W * cs, gy(y)); }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.34)';
      ctx.beginPath();
      for (let x = 0; x <= W; x += CFG.majorGrid) { ctx.moveTo(gx(x), 0); ctx.lineTo(gx(x), H * cs); }
      for (let y = 0; y <= H; y += CFG.majorGrid) { ctx.moveTo(0, gy(y)); ctx.lineTo(W * cs, gy(y)); }
      if (W % CFG.majorGrid) { ctx.moveTo(gx(W), 0); ctx.lineTo(gx(W), H * cs); }
      if (H % CFG.majorGrid) { ctx.moveTo(0, gy(H)); ctx.lineTo(W * cs, gy(H)); }
      ctx.stroke();
    }
  }, [cellSize, showBg, bgOpacity, showGrid, color, fabric, W, H, zoom, dpr, CFG, nib]);

  // Keep a ref to the latest redraw so a queued animation frame always paints
  // with current state. Without this, the rafRef dedupe guard below can let a
  // frame scheduled at a stale cell size (e.g. mid-resize during loadDesign)
  // fire last and repaint the board at the wrong size.
  const redrawRef = useRef(redraw);
  useLayoutEffect(() => { redrawRef.current = redraw; }, [redraw]);
  const scheduleRedraw = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => { rafRef.current = 0; redrawRef.current(); });
  }, []);

  const cancelPointerInteraction = useCallback(() => {
    drawingRef.current = false;
    movingRef.current = false;
    pressRef.current = null;
    dragRef.current = null;
    marqueeRef.current = null;
    resizeRef.current = null;
    previewRef.current = null;
    nibHoverRef.current = null;
    startRef.current = null;
    lastRef.current = null;
    scheduleRedraw();
  }, [scheduleRedraw]);
  const { isGestureActive } = useCanvasPinchZoom(wrapRef, zoom, setZoom, cancelPointerInteraction, tool === 'pan');

  // Fit the grid inside the wrap's padding, which keeps it clear of the floating
  // tools. Observing the wrap also catches the mobile tray changing height.
  useLayoutEffect(() => {
    const wrap = wrapRef.current; if (!wrap) return undefined;
    const fit = () => {
      const s = getComputedStyle(wrap);
      const availW = wrap.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
      const availH = wrap.clientHeight - parseFloat(s.paddingTop) - parseFloat(s.paddingBottom);
      const cs = Math.max(3, Math.min(30, Math.floor(Math.min(availW / W, availH / H))));
      setCellSize(cs);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [W, H]);

  // Layout effect (not passive) so the redraw runs for every committed render,
  // including the settled size after loadDesign resizes the board — a passive
  // effect can be coalesced away when the fit effect triggers a second render
  // before paint, leaving the canvas drawn at a stale cell size.
  useLayoutEffect(() => { redraw(); }, [redraw]);

  // Crawl the selection outline while a selection exists.
  useEffect(() => {
    if (!hasSel) { antsRef.current = 0; return undefined; }
    const t = setInterval(() => { antsRef.current = (antsRef.current + 1) % 8; scheduleRedraw(); }, 110);
    return () => clearInterval(t);
  }, [hasSel, scheduleRedraw]);

  useEffect(() => {
    if (!bg) { bgImgRef.current = null; redraw(); return; }
    const img = new Image();
    img.onload = () => { bgImgRef.current = img; redraw(); };
    img.src = bg;
  }, [bg, redraw]);

  // Redo covers the board in view: it's dropped by any new edit, and by
  // anything that swaps the board (another coaster, a size, a saved design).
  const redoRef = useRef([]);
  const recordUndo = (snapshot) => {
    undoRef.current.push(snapshot);
    if (undoRef.current.length > 40) undoRef.current.shift();
    redoRef.current = [];
  };
  const pushUndo = () => recordUndo(cellsRef.current.slice());
  const redo = useCallback(() => {
    if (!redoRef.current.length || (selRef.current && selRef.current.floating)) return;
    undoRef.current.push(cellsRef.current.slice());
    cellsRef.current = redoRef.current.pop();
    bindActivePage();
    selRef.current = null; movingRef.current = false;
    dragRef.current = null; marqueeRef.current = null; pressRef.current = null;
    setHasSel(false); setSelCursor(null);
    redraw(); bump();
  }, [redraw, bump]);
  const undo = useCallback(() => {
    // An uncommitted float is undone by dropping it and putting the grid back
    // the way it was before the lift — no undo entry is consumed, because none
    // was recorded yet.
    const sel = selRef.current;
    if (sel && sel.floating) {
      cellsRef.current = sel.before;
      bindActivePage();
      selRef.current = null; movingRef.current = false;
      dragRef.current = null; marqueeRef.current = null; pressRef.current = null;
      setHasSel(false); setSelCursor(null);
      redraw(); bump();
      return;
    }
    if (!undoRef.current.length) return;
    const last = undoRef.current[undoRef.current.length - 1];
    if (last.resize) { redoRef.current = []; restoreSize(undoRef.current.pop().resize); return; }
    redoRef.current.push(cellsRef.current.slice());
    cellsRef.current = undoRef.current.pop();
    bindActivePage();
    // The stitches the selection referred to may not exist any more, so drop it.
    selRef.current = null; movingRef.current = false;
    dragRef.current = null; marqueeRef.current = null; pressRef.current = null;
    setHasSel(false); setSelCursor(null);
    redraw(); bump();
  }, [redraw, bump]);

  const cellFromEvent = (e) => {
    const cv = canvasRef.current; const rect = cv.getBoundingClientRect();
    const cs = cellSize * zoom;
    const x = Math.floor((e.clientX - rect.left) / cs);
    const y = Math.floor((e.clientY - rect.top) / cs);
    if (x < 0 || y < 0 || x >= W || y >= H) return null;
    return [x, y];
  };
  const cellClamped = (e) => {
    const cv = canvasRef.current; const rect = cv.getBoundingClientRect();
    const cs = cellSize * zoom;
    let x = Math.floor((e.clientX - rect.left) / cs);
    let y = Math.floor((e.clientY - rect.top) / cs);
    return [Math.max(0, Math.min(W - 1, x)), Math.max(0, Math.min(H - 1, y))];
  };

  const lineCells = (x0, y0, x1, y1) => {
    const out = []; let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    let sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx - dy;
    while (true) { out.push([x0, y0]); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 > -dy) { err -= dy; x0 += sx; } if (e2 < dx) { err += dx; y0 += sy; } }
    return out;
  };
  // The pencil and eraser lay down a square nib `nib` stitches on a side. Odd
  // widths center on the pointer; even ones have no center stitch to land on,
  // so they sit one down and right of it.
  const nibOffset = Math.floor((nib - 1) / 2);
  const nibCells = (x, y) => {
    if (nib <= 1) return [[x, y]];
    const out = [];
    for (let dy = 0; dy < nib; dy++) for (let dx = 0; dx < nib; dx++) out.push([x - nibOffset + dx, y - nibOffset + dy]);
    return out;
  };
  const nibStroke = (line) => nib <= 1 ? line : line.flatMap(([x, y]) => nibCells(x, y));
  const rectCells = (x0, y0, x1, y1) => {
    const out = []; const xa = Math.min(x0, x1), xb = Math.max(x0, x1), ya = Math.min(y0, y1), yb = Math.max(y0, y1);
    for (let x = xa; x <= xb; x++) { out.push([x, ya]); out.push([x, yb]); }
    for (let y = ya; y <= yb; y++) { out.push([xa, y]); out.push([xb, y]); }
    return out;
  };
  const ellipseCells = (x0, y0, x1, y1) => {
    const out = []; const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const rx = Math.abs(x1 - x0) / 2, ry = Math.abs(y1 - y0) / 2;
    if (rx < 0.5 || ry < 0.5) return lineCells(x0, y0, x1, y1);
    const steps = Math.ceil(2 * Math.PI * Math.max(rx, ry));
    const seen = new Set();
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * 2 * Math.PI;
      const x = Math.round(cx + rx * Math.cos(t)), y = Math.round(cy + ry * Math.sin(t));
      const k = x + ',' + y; if (!seen.has(k) && x >= 0 && y >= 0 && x < W && y < H) { seen.add(k); out.push([x, y]); }
    }
    return out;
  };

  const applyCells = (list, hex) => { for (const [x, y] of list) { if (x >= 0 && y >= 0 && x < W && y < H) cellsRef.current[idx(x, y)] = hex; } };

  // Bucket fill: flood the contiguous region of cells matching the clicked
  // cell's value (empty by default) with `hex`, bounded by differently-colored
  // stitches. 4-connectivity.
  const floodFill = (sx, sy, hex) => {
    const cells = cellsRef.current;
    const target = cells[idx(sx, sy)];
    if (target === hex) return;
    const stack = [[sx, sy]];
    while (stack.length) {
      const [x, y] = stack.pop();
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const k = idx(x, y);
      if (cells[k] !== target) continue;
      cells[k] = hex;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
  };

  // Collect the connected group of same-color stitches touching (sx,sy).
  // Returns a list of cell indices (empty when the cell is unstitched).
  const collectRegion = (sx, sy) => {
    const cells = cellsRef.current;
    const target = cells[idx(sx, sy)];
    if (!target) return [];
    const set = new Set();
    const out = [];
    const stack = [[sx, sy]];
    while (stack.length) {
      const [x, y] = stack.pop();
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const k = idx(x, y);
      if (set.has(k) || cells[k] !== target) continue;
      set.add(k); out.push(k);
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    return out;
  };

  // Wrap a cell-index -> hex Map into a selection object (or null when empty),
  // computing the bounding box used to clamp moves to the grid. `keep` carries
  // the floating-layer bookkeeping over when a live float is re-positioned.
  const makeSel = (map, keep) => {
    if (!map || map.size === 0) return null;
    let minX = W, minY = H, maxX = 0, maxY = 0;
    for (const i of map.keys()) {
      const x = i % W, y = Math.floor(i / W);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    return {
      cells: map, minX, minY, maxX, maxY,
      floating: !!(keep && keep.floating),   // lifted off the grid, not yet stamped
      before: (keep && keep.before) || null, // grid snapshot from just before the lift
      srcKeys: (keep && keep.srcKeys) || null, // cells emptied by the lift (a move)
      copy: !!(keep && keep.copy),
      src: (keep && keep.src) || null,       // pristine pattern to resample resizes from
      box: (keep && keep.box) || null,       // resize frame, when it is wider than the stitches
    };
  };

  // The handle frame. After a downscale the outer row or column of a sparse
  // motif can sample to nothing, so the frame the user dragged is remembered
  // separately from the box the stitches actually occupy.
  const selFrame = (sel) => sel.box || { minX: sel.minX, minY: sel.minY, maxX: sel.maxX, maxY: sel.maxY };

  // Resize handles, as fractions along the frame. Corners scale both axes,
  // edges scale one.
  const SEL_HANDLES = [
    ['nw', 0, 0, 'nwse-resize'], ['n', 0.5, 0, 'ns-resize'], ['ne', 1, 0, 'nesw-resize'],
    ['e', 1, 0.5, 'ew-resize'], ['se', 1, 1, 'nwse-resize'], ['s', 0.5, 1, 'ns-resize'],
    ['sw', 0, 1, 'nesw-resize'], ['w', 0, 0.5, 'ew-resize'],
  ];
  // Which handle a pointer is on, in client space so the target keeps its size
  // at any zoom. Touch gets a much larger radius than the drawn dot, capped
  // against the frame so the middle of a small selection stays grabbable.
  const handleAt = (e) => {
    const sel = selRef.current, cv = canvasRef.current;
    if (!sel || !cv) return null;
    const rect = cv.getBoundingClientRect();
    const z = cellSize * zoom;
    const f = selFrame(sel);
    const x0 = rect.left + f.minX * z, x1 = rect.left + (f.maxX + 1) * z;
    const y0 = rect.top + f.minY * z, y1 = rect.top + (f.maxY + 1) * z;
    const reach = Math.min(
      e.pointerType === 'mouse' ? 11 : 24,
      Math.max(8, Math.min(x1 - x0, y1 - y0) * 0.4));
    let best = null, bestD = Infinity;
    for (const [id, fx, fy, cursor] of SEL_HANDLES) {
      const d = Math.hypot(e.clientX - (x0 + (x1 - x0) * fx), e.clientY - (y0 + (y1 - y0) * fy));
      if (d <= reach && d < bestD) { best = { id, cursor }; bestD = d; }
    }
    return best;
  };

  // Anywhere inside the selection's bounds grabs it, not just the stitched
  // cells — an outlined shape is hollow in the middle, and grabbing it there
  // should move the shape rather than start a new marquee.
  const inSelBounds = (sel, x, y) => {
    if (!sel) return false;
    const f = selFrame(sel);
    return x >= f.minX && x <= f.maxX && y >= f.minY && y <= f.maxY;
  };

  // ── Floating selection layer ──────────────────────────────────────────────
  // A selection that is being moved or duplicated is *lifted* out of the grid
  // and composited on top of it at draw time. Nothing under the float is
  // touched until it is committed, so it can be nudged around all day and the
  // stitches it passes over come straight back. The whole lift → drag → commit
  // cycle is one undo step, recorded from the pre-lift snapshot.
  const liftSelection = (copy) => {
    const sel = selRef.current;
    if (!sel || sel.floating) return;
    const before = cellsRef.current.slice();
    const srcKeys = [...sel.cells.keys()];
    // Keep the pattern at its lifted size and origin. Every resize resamples
    // from this, so scaling down and back up costs nothing until it commits.
    const sw = sel.maxX - sel.minX + 1, sh = sel.maxY - sel.minY + 1;
    const src = { w: sw, h: sh, cells: new Map() };
    for (const [i, hex] of sel.cells) {
      src.cells.set((Math.floor(i / W) - sel.minY) * sw + (i % W - sel.minX), hex);
    }
    // A move empties its source cells straight away; a copy leaves them.
    if (!copy) for (const i of srcKeys) cellsRef.current[i] = null;
    selRef.current = { ...sel, floating: true, before, srcKeys, copy, src };
  };

  // Option can be pressed or released mid-drag: re-derive the grid from the
  // pre-lift snapshot rather than trying to patch it.
  const setFloatCopy = (copy) => {
    const sel = selRef.current;
    if (!sel || !sel.floating || sel.copy === copy) return;
    cellsRef.current = sel.before.slice();
    if (!copy) for (const i of sel.srcKeys) cellsRef.current[i] = null;
    bindActivePage();
    selRef.current = { ...sel, copy };
  };

  // Stamp the float into the grid. Returns true when something was committed.
  const commitFloat = () => {
    const sel = selRef.current;
    if (!sel || !sel.floating) return false;
    recordUndo(sel.before);
    const cells = cellsRef.current;
    for (const [i, hex] of sel.cells) cells[i] = hex;
    // Once stamped, the stitches are the selection again: the resize frame and
    // the pristine copy belong to the finished lift, not to what comes next.
    selRef.current = { ...sel, floating: false, before: null, srcKeys: null, copy: false, src: null, box: null };
    bump();
    return true;
  };

  // Throw the float away and put the grid back as it was before the lift.
  const cancelFloat = () => {
    const sel = selRef.current;
    if (!sel || !sel.floating) return false;
    cellsRef.current = sel.before;
    bindActivePage();
    selRef.current = null; movingRef.current = false;
    dragRef.current = null; pressRef.current = null; resizeRef.current = null;
    setHasSel(false); setSelCursor(null);
    bump();
    return true;
  };

  // Re-key the selection to a new position. No grid writes while floating.
  const offsetSelection = (dx, dy) => {
    const sel = selRef.current;
    if (!sel || (dx === 0 && dy === 0)) return;
    const next = new Map();
    for (const [i, hex] of sel.cells) next.set(idx((i % W) + dx, Math.floor(i / W) + dy), hex);
    const box = sel.box
      ? { minX: sel.box.minX + dx, minY: sel.box.minY + dy, maxX: sel.box.maxX + dx, maxY: sel.box.maxY + dy }
      : null;
    selRef.current = makeSel(next, { ...sel, box });
  };

  // Scale the float into `box` by nearest-neighbour resample. Stitches are whole
  // cells, so there is no blending to do: enlarging repeats a cell, shrinking
  // keeps one cell per sampled block and drops the rest. Always resampled from
  // the pristine lifted pattern, so dragging a handle back out restores the
  // detail instead of compounding the loss.
  const resampleSelection = (box) => {
    const sel = selRef.current;
    if (!sel || !sel.src) return;
    const src = sel.src;
    const nw = box.maxX - box.minX + 1, nh = box.maxY - box.minY + 1;
    const next = new Map();
    for (let y = 0; y < nh; y++) {
      const sy = Math.min(src.h - 1, Math.floor(y * src.h / nh));
      for (let x = 0; x < nw; x++) {
        const sx = Math.min(src.w - 1, Math.floor(x * src.w / nw));
        const hex = src.cells.get(sy * src.w + sx);
        if (hex) next.set(idx(box.minX + x, box.minY + y), hex);
      }
    }
    // A very small downscale of a sparse motif can sample nothing at all —
    // keep the previous result rather than letting the selection evaporate.
    if (next.size === 0) return;
    selRef.current = makeSel(next, { ...sel, box });
  };

  // Ending a selection places whatever is floating. Anything that replaces or
  // drops the selection routes through here, so a float is never orphaned.
  const deselect = () => {
    commitFloat();
    selRef.current = null; movingRef.current = false;
    dragRef.current = null; marqueeRef.current = null; pressRef.current = null;
    resizeRef.current = null;
    setHasSel(false); setSelCursor(null); redraw();
  };

  const deleteSelection = () => {
    const sel = selRef.current; if (!sel) return;
    if (sel.floating) {
      // The float is discarded rather than stamped. A lifted move already
      // emptied its source cells, so that needs an undo point; a floating copy
      // never touched the grid, so dropping it changes nothing.
      if (!sel.copy) recordUndo(sel.before);
    } else {
      pushUndo();
      for (const i of sel.cells.keys()) cellsRef.current[i] = null;
    }
    selRef.current = null; movingRef.current = false; dragRef.current = null;
    setHasSel(false); setSelCursor(null);
    redraw(); bump();
  };

  // Duplicate via the toolbar button or Cmd/Ctrl-D — the touch path, since a
  // phone has no Option key. The copy floats two stitches down-right (or back
  // up-left against the bottom/right edge) so it can be dragged into place
  // without damaging the original underneath.
  const duplicateSelection = () => {
    const sel0 = selRef.current; if (!sel0) return;
    commitFloat();               // an existing float becomes the "original"
    liftSelection(true);
    const sel = selRef.current;
    let dx = Math.min(2, W - 1 - sel.maxX), dy = Math.min(2, H - 1 - sel.maxY);
    if (dx === 0 && dy === 0) { dx = Math.max(-2, -sel.minX); dy = Math.max(-2, -sel.minY); }
    offsetSelection(dx, dy);
    touchSel();
    redraw(); bump();
  };

  // Recolor the active selection to `c` (used when a "My palette" chip is
  // clicked while cells are selected). Repaints the selected cells and keeps
  // the selection active with its new color.
  const recolorSelection = (c) => {
    const sel = selRef.current;
    if (!sel || sel.cells.size === 0 || !c) return;
    const cells = cellsRef.current;
    // A floating layer recolors in place — it folds into the pending commit
    // rather than becoming an undo step of its own.
    if (!sel.floating) pushUndo();
    const map = new Map();
    for (const i of sel.cells.keys()) { if (!sel.floating) cells[i] = c.hex; map.set(i, c.hex); }
    selRef.current = { ...sel, cells: map };
    touchSel();
    redraw(); bump();
  };

  const onPointerDown = (e) => {
    if (tool === 'pan') return;
    if (isGestureActive() || !e.isPrimary) {
      cancelPointerInteraction();
      return;
    }
    const cell = cellFromEvent(e); if (!cell) return;
    if (tool === 'text') {
      if (!textStamp.length) return;
      pushUndo();
      applyCells(textStamp.map(([dx, dy]) => [cell[0] + dx, cell[1] + dy]), color.hex);
      previewRef.current = null; redraw(); bump();
      return;
    }
    if (tool === 'fill') {
      pushUndo();
      floodFill(cell[0], cell[1], color.hex);
      redraw(); bump();
      return;
    }
    if (tool === 'select') {
      const sel = selRef.current;
      e.currentTarget.setPointerCapture(e.pointerId);
      const grip = sel ? handleAt(e) : null;
      if (grip) {
        // Handles win over everything, including Shift — on a handle Shift
        // means "constrain the ratio", not "add to the selection". Nothing
        // lifts until the box actually changes, so a stray tap is a no-op.
        resizeRef.current = { handle: grip.id, start: { ...selFrame(sel) }, lifted: false };
        setSelCursor(grip.cursor);
        scheduleRedraw(); return;
      }
      if (sel && inSelBounds(sel, cell[0], cell[1]) && !e.shiftKey) {
        // Grab the selection. Nothing lifts until the pointer actually moves,
        // so a plain click inside a selection is a no-op.
        movingRef.current = true;
        startRef.current = cell; dragRef.current = { dx: 0, dy: 0, lifted: false, canToggleCopy: !sel.floating };
        scheduleRedraw(); return;
      }
      // Anywhere else the press is still ambiguous: a drag becomes a marquee,
      // a tap picks the color group under the finger. Resolved in move/up.
      pressRef.current = {
        cell, x: e.clientX, y: e.clientY, add: e.shiftKey,
        slop: e.pointerType === 'mouse' ? 3 : 8,
      };
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = true; startRef.current = cell; lastRef.current = cell;
    pushUndo();
    if (tool === 'pen') { applyCells(nibCells(cell[0], cell[1]), color.hex); scheduleRedraw(); }
    else if (tool === 'eraser') { applyCells(nibCells(cell[0], cell[1]), null); scheduleRedraw(); }
  };
  const onPointerMove = (e) => {
    if (isGestureActive()) return;
    if (tool === 'select') {
      if (resizeRef.current) {
        const r = resizeRef.current, h = r.handle, s = r.start;
        const [cx, cy] = cellClamped(e);
        let { minX, minY, maxX, maxY } = s;
        // The opposite edge is the anchor; the dragged one follows the pointer,
        // already clamped to the grid so a resize can never run off the board.
        if (h.includes('w')) minX = Math.min(cx, s.maxX);
        if (h.includes('e')) maxX = Math.max(cx, s.minX);
        if (h.includes('n')) minY = Math.min(cy, s.maxY);
        if (h.includes('s')) maxY = Math.max(cy, s.minY);
        const src = selRef.current.src;
        if (h.length === 2 && (lockRatio !== e.shiftKey)) {
          // Constrain to the pattern's original aspect: take the axis the
          // pointer pushed furthest, then re-anchor. Clamping at the board edge
          // wins over the ratio, so the box always stays legal.
          const rw = src ? src.w : s.maxX - s.minX + 1, rh = src ? src.h : s.maxY - s.minY + 1;
          const scale = Math.max((maxX - minX + 1) / rw, (maxY - minY + 1) / rh);
          const nw = Math.max(1, Math.round(rw * scale)), nh = Math.max(1, Math.round(rh * scale));
          if (h.includes('w')) minX = Math.max(0, maxX - nw + 1); else maxX = Math.min(W - 1, minX + nw - 1);
          if (h.includes('n')) minY = Math.max(0, maxY - nh + 1); else maxY = Math.min(H - 1, minY + nh - 1);
        }
        // Pointer moves land many times inside one cell; only resample when the
        // box really changed, which also keeps the selection bar re-renders to
        // one per size step.
        const last = r.last || s;
        if (last.minX === minX && last.minY === minY && last.maxX === maxX && last.maxY === maxY) return;
        if (!r.lifted) {
          // First real change: the stitches leave the grid for the float, so
          // the whole resize rides on one lift → commit undo step.
          if (!selRef.current.floating) liftSelection(e.altKey);
          r.lifted = true;
        }
        r.last = { minX, minY, maxX, maxY };
        resampleSelection({ minX, minY, maxX, maxY });
        touchSel();
        scheduleRedraw();
        return;
      }
      if (movingRef.current) {
        const [cx, cy] = cellClamped(e);
        const s = startRef.current, d = dragRef.current;
        let sel = selRef.current;
        // Clamp the offset to the grid: the group slides along the edge rather
        // than being clipped, so no stitches are ever lost off-board.
        let dx = Math.max(-sel.minX, Math.min(W - 1 - sel.maxX, cx - s[0]));
        let dy = Math.max(-sel.minY, Math.min(H - 1 - sel.maxY, cy - s[1]));
        if (!d.lifted && (dx !== 0 || dy !== 0)) {
          // First real movement: lift the stitches into the floating layer.
          if (!sel.floating) liftSelection(e.altKey);
          else if (e.altKey) { commitFloat(); liftSelection(true); }
          d.lifted = true;
          touchSel(); // once per drag, so the bar can say it is floating
        } else if (d.lifted && d.canToggleCopy) {
          setFloatCopy(e.altKey);
        }
        sel = selRef.current;
        dragRef.current = { ...d, dx, dy };
        setSelCursor(sel.copy ? 'copy' : 'move');
        scheduleRedraw();
        return;
      }
      if (marqueeRef.current) {
        const [cx, cy] = cellClamped(e);
        marqueeRef.current = { ...marqueeRef.current, x1: cx, y1: cy };
        scheduleRedraw();
        return;
      }
      const p = pressRef.current;
      if (p) {
        // Past the slop radius the press was a drag after all — rubber-band
        // from where it started, over stitches or bare fabric alike.
        if (Math.abs(e.clientX - p.x) > p.slop || Math.abs(e.clientY - p.y) > p.slop) {
          pressRef.current = null;
          const [cx, cy] = cellClamped(e);
          marqueeRef.current = { x0: p.cell[0], y0: p.cell[1], x1: cx, y1: cy, add: p.add };
          scheduleRedraw();
        }
        return;
      }
      const grip = selRef.current ? handleAt(e) : null;
      if (grip) { setSelCursor(grip.cursor); return; }
      const hover = cellFromEvent(e);
      const over = !!(hover && inSelBounds(selRef.current, hover[0], hover[1]));
      setSelCursor(over ? (e.altKey ? 'copy' : 'move') : null);
      return;
    }
    if (tool === 'text' && !drawingRef.current) {
      const cell = cellFromEvent(e);
      previewRef.current = (cell && textStamp.length) ? textStamp.map(([dx, dy]) => [cell[0] + dx, cell[1] + dy]) : null;
      scheduleRedraw();
      return;
    }
    if ((tool === 'pen' || tool === 'eraser') && !drawingRef.current) {
      // A wide nib covers stitches the pointer isn't sitting on, so show where
      // the next dab will land. Only resample when the cell actually changes.
      const cell = nib > 1 ? cellFromEvent(e) : null;
      const was = nibHoverRef.current;
      if (!cell !== !was || (cell && was && (cell[0] !== was[0] || cell[1] !== was[1]))) {
        nibHoverRef.current = cell; scheduleRedraw();
      }
      return;
    }
    if (!drawingRef.current) return;
    const cell = cellFromEvent(e); if (!cell) return;
    const last = lastRef.current;
    if (tool === 'pen' || tool === 'eraser') {
      const hex = tool === 'pen' ? color.hex : null;
      if (last) applyCells(nibStroke(lineCells(last[0], last[1], cell[0], cell[1])), hex);
      if (nib > 1) nibHoverRef.current = cell;
      lastRef.current = cell; scheduleRedraw();
    } else {
      const s = startRef.current;
      previewRef.current = tool === 'line' ? lineCells(s[0], s[1], cell[0], cell[1])
        : tool === 'rect' ? rectCells(s[0], s[1], cell[0], cell[1])
        : ellipseCells(s[0], s[1], cell[0], cell[1]);
      lastRef.current = cell; scheduleRedraw();
    }
  };
  const onPointerUp = () => {
    if (isGestureActive()) {
      cancelPointerInteraction();
      return;
    }
    if (tool === 'select') {
      if (resizeRef.current) {
        // The float already holds the resampled result; nothing to stamp.
        const touched = resizeRef.current.lifted;
        resizeRef.current = null;
        redraw();
        if (touched) bump();
        return;
      }
      if (movingRef.current) {
        const d = dragRef.current || { dx: 0, dy: 0 };
        movingRef.current = false; dragRef.current = null;
        // The float keeps its new home; the grid underneath is still untouched.
        offsetSelection(d.dx, d.dy);
        redraw(); bump();
        return;
      }
      if (marqueeRef.current) {
        commitFloat();
        const mq = marqueeRef.current; marqueeRef.current = null;
        const x0 = Math.min(mq.x0, mq.x1), x1 = Math.max(mq.x0, mq.x1);
        const y0 = Math.min(mq.y0, mq.y1), y1 = Math.max(mq.y0, mq.y1);
        const cells = cellsRef.current;
        const map = (mq.add && selRef.current) ? new Map(selRef.current.cells) : new Map();
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const k = idx(x, y); const hex = cells[k]; if (hex) map.set(k, hex);
        }
        selRef.current = makeSel(map); touchSel();
        redraw();
        return;
      }
      const p = pressRef.current;
      if (p) {
        pressRef.current = null;
        // Picking somewhere else ends the current selection, so place the float
        // before reading the grid under the tap.
        commitFloat();
        const hex = cellsRef.current[idx(p.cell[0], p.cell[1])];
        if (hex) {
          // Tap a stitch: take its whole contiguous color group. With Shift the
          // group toggles in and out of the current selection.
          const region = collectRegion(p.cell[0], p.cell[1]);
          const map = (p.add && selRef.current) ? new Map(selRef.current.cells) : new Map();
          const allIn = p.add && region.every(i => map.has(i));
          for (const i of region) { if (allIn) map.delete(i); else map.set(i, hex); }
          selRef.current = makeSel(map); touchSel();
        } else if (!p.add) {
          deselect();
        }
        redraw();
      }
      return;
    }
    if (!drawingRef.current) return;
    drawingRef.current = false;
    if (previewRef.current) { applyCells(previewRef.current, color.hex); previewRef.current = null; }
    redraw(); bump();
  };
  const onPointerLeave = (e) => {
    if (tool === 'select') {
      if (movingRef.current || marqueeRef.current || resizeRef.current) onPointerUp(e);
      else { pressRef.current = null; setSelCursor(null); }
      return;
    }
    if (drawingRef.current) { onPointerUp(e); }
    else if (previewRef.current) { previewRef.current = null; scheduleRedraw(); }
    if (nibHoverRef.current) { nibHoverRef.current = null; scheduleRedraw(); }
  };

  // Switching tools ends the selection, which places any floating layer first.
  useEffect(() => {
    previewRef.current = null;
    nibHoverRef.current = null;
    commitFloat();
    selRef.current = null; movingRef.current = false;
    dragRef.current = null; marqueeRef.current = null; pressRef.current = null;
    resizeRef.current = null;
    setHasSel(false); setSelCursor(null);
    scheduleRedraw();
  }, [tool, scheduleRedraw]);

  useEffect(() => {
    const onKey = (e) => {
      if (studioCovered()) return;
      const tag = e.target.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '+')) { e.preventDefault(); adjustZoom(+ZOOM_STEP); return; }
      if ((e.metaKey || e.ctrlKey) && (e.key === '-' || e.key === '_')) { e.preventDefault(); adjustZoom(-ZOOM_STEP); return; }
      if ((e.metaKey || e.ctrlKey) && e.key === '0') { e.preventDefault(); resetZoom(); return; }
      if (typing) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd' && selRef.current) {
        e.preventDefault(); duplicateSelection(); return;
      }
      if ((e.key === '[' || e.key === ']') && (tool === 'pen' || tool === 'eraser')) {
        e.preventDefault();
        const step = e.key === ']' ? 1 : -1;
        const nextNib = (n) => NIB_SIZES[Math.max(0, Math.min(NIB_SIZES.length - 1, NIB_SIZES.indexOf(n) + step))];
        (tool === 'eraser' ? setEraserNib : setPenNib)(nextNib);
        return;
      }
      // Enter and Esc both do what Done does: place the float and let go.
      if ((e.key === 'Escape' || e.key === 'Enter') && selRef.current) {
        e.preventDefault(); deselect(); return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selRef.current) {
        e.preventDefault();
        deleteSelection();
        return;
      }
      if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        const t = STITCH_TOOLS.find(x => x.key.toLowerCase() === e.key.toLowerCase());
        if (t) { e.preventDefault(); chooseTool(t.id); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, redraw, bump, adjustZoom, resetZoom, tool, chooseTool]);

  const clearAll = () => {
    // Drop any float first so one undo restores the board as it was before the
    // lift, rather than the half-lifted grid.
    cancelFloat();
    pushUndo();
    cellsRef.current = new Array(W * H).fill(null); previewRef.current = null;
    bindActivePage();
    redraw(); bump(); setConfirmClear(false);
  };

  // Snapshot the design; `id`/`name` come from the caller so the same builder
  // powers both "save new" and "update in place".
  const buildStitchRecord = (id, name) => {
    const grid = serializeGrid(cellsRef.current);
    // Callers commit any float first, so this always sees the finished board.
    const s = pagesRef.current
      ? computeStitchStats(pagesRef.current.flat(), W, H * COASTER_COUNT, pal, CFG.library)
      : computeStitchStats(cellsRef.current, W, H, pal, CFG.library);
    const record = {
      id, name, craft, presetName: dims.name, w: W, h: H,
      palette: pal, grid, bgImage: bg || null, fabric,
      stitches: s.total, colorsUsed: s.colors.length, colors: s.colors,
      updatedAt: Date.now(),
    };
    if (pagesRef.current) {
      record.pages = pagesRef.current.map(cells => ({ grid: serializeGrid(cells) }));
      record.activePage = activeCoasterRef.current;
    }
    return record;
  };
  // Mirrors commitQuiltSave: account first, then this device, and local-only
  // when Supabase isn't configured.
  const commitStitchSave = async (record, isNew) => {
    const store = (apiId) => {
      const saved = apiId ? { ...record, apiId } : record;
      setSavedStitches(p => isNew ? [saved, ...p] : p.map(x => x.id === record.id ? saved : x));
      if (isNew) setCurrentStitchId(saved.id);
      flashSaved();
    };
    if (!cloudEnabled) {
      store(null);
      setSaveError(cloudBlocked ? ACCOUNTS_OFFLINE_SAVE_MSG : "");
      return;
    }
    try {
      store(await upsertCloudDesign(CFG.checkoutType, record));
      setSaveError("");
    } catch (e) {
      console.warn("Design cloud save failed:", e);
      setSaveError("Couldn't save to your account. Check your connection and try again.");
    }
  };
  const saveNewDesign = () => {
    const name = saveName.trim(); if (!name) return;
    // Saving places a floating selection — what you see is what gets stored.
    if (commitFloat()) redraw();
    const id = Date.now();
    const record = buildStitchRecord(id, name);
    setShowSave(false); setSaveName("");
    if (cloudEnabled && !user) {
      stashPendingSave({ type: CFG.checkoutType, record, mode: "new" });
      auth.openAuth();
      return;
    }
    commitStitchSave(record, true);
  };
  const updateCurrentDesign = () => {
    if (currentStitchId == null) return;
    if (commitFloat()) redraw();
    const record = buildStitchRecord(currentStitchId, (currentStitch && currentStitch.name) || "Untitled");
    if (currentStitch && currentStitch.apiId) record.apiId = currentStitch.apiId;
    if (cloudEnabled && !user) {
      stashPendingSave({ type: CFG.checkoutType, record, mode: "update" });
      auth.openAuth();
      return;
    }
    commitStitchSave(record, false);
  };

  const loadDesign = (d) => {
    if (!d) return;
    setCurrentStitchId(d.id ?? null);
    undoRef.current = [];
    redoRef.current = [];
    // The incoming grid replaces everything, so any float is simply dropped.
    selRef.current = null; movingRef.current = false;
    dragRef.current = null; marqueeRef.current = null; pressRef.current = null;
    setHasSel(false); setSelCursor(null);
    // Restore the design at its saved size. Setting dims re-runs the fit and
    // redraw effects (both keyed on W/H), so the board resizes to match the
    // grid instead of the grid being squeezed into the active canvas size.
    if (typeof d.w === 'number' && typeof d.h === 'number') {
      setDims({ w: d.w, h: d.h, name: canonicalPresetName(craft, d.presetName) || 'Custom' });
    }
    const len = (d.w || W) * (d.h || H);
    if (isCoasterSize(d.presetName || dims.name)) {
      let pages;
      if (Array.isArray(d.pages) && d.pages.length === COASTER_COUNT) {
        pages = d.pages.map(p => deserializeGrid(p && p.grid, len));
      } else {
        pages = seedCoasterPages(deserializeGrid(d.grid, len), len);
      }
      pagesRef.current = pages;
      undoPagesRef.current = Array.from({ length: COASTER_COUNT }, () => []);
      const idx = Math.min(COASTER_COUNT - 1, Math.max(0, d.activePage || 0));
      setActiveCoaster(idx);
      activeCoasterRef.current = idx;
      cellsRef.current = pages[idx];
      undoRef.current = undoPagesRef.current[idx];
    } else {
      pagesRef.current = null;
      undoPagesRef.current = null;
      setActiveCoaster(0);
      activeCoasterRef.current = 0;
      cellsRef.current = deserializeGrid(d.grid, len);
      undoRef.current = [];
    }
    previewRef.current = null;
    if (Array.isArray(d.palette) && d.palette.length) { setPal(d.palette); setColor(d.palette[0]); }
    setBg(d.bgImage || null); setShowBg(!!d.bgImage);
    if (d.fabric) setFabric(d.fabric);
    setViewStitch(null); setShowMyStitches(false); setConfirmDeleteId(null);
    redraw(); bump();
  };
  // Opened straight from the landing page's saved list: load it on mount.
  useEffect(() => { if (initialDesign) loadDesign(initialDesign); }, []);

  // Size dropdown. The stitches keep their scale and are re-centered on the new
  // board (refitGrid crops anything that no longer fits). Leaving a coaster set
  // keeps the coaster on screen. The whole switch is a single undo step: the
  // entry holds the old board, pages and undo history, so undoing it puts all
  // of them back rather than trying to replay grids of the wrong length.
  const clearSelection = () => {
    selRef.current = null; movingRef.current = false;
    dragRef.current = null; marqueeRef.current = null; pressRef.current = null;
    setHasSel(false); setSelCursor(null);
    previewRef.current = null;
  };
  const restoreSize = (b) => {
    clearSelection();
    pagesRef.current = b.pages;
    undoPagesRef.current = b.undoPages;
    cellsRef.current = b.cells;
    undoRef.current = b.undo;
    setActiveCoaster(b.active);
    activeCoasterRef.current = b.active;
    setDims(b.dims);
    bump();
    scheduleRedraw();
  };
  const applySize = (name) => {
    const p = CFG.presets.find(x => x.name === name);
    if (!p || name === dims.name) return;
    commitFloat();
    clearSelection();
    bindActivePage();
    if (undoPagesRef.current) undoPagesRef.current[activeCoaster] = undoRef.current;
    const before = { dims, pages: pagesRef.current, undoPages: undoPagesRef.current,
      cells: cellsRef.current, undo: undoRef.current, active: activeCoaster };
    const fit = cells => refitGrid(cells, W, H, p.w, p.h);
    // Guided setup can pick the size after the design is in, so an untouched
    // chart or photo is laid again at the new size rather than cropped.
    const relaid = guided ? reseed(p, null) : null;
    const active = 0;
    if (isCoasterSize(p.name)) {
      pagesRef.current = relaid
        ? seedCoasterPages(relaid.autoGrid, p.w * p.h, relaid.autoPages)
        : seedCoasterPages(fit(cellsRef.current), p.w * p.h);
      undoPagesRef.current = pagesRef.current.map(() => [{ resize: before }]);
      cellsRef.current = pagesRef.current[active];
      undoRef.current = undoPagesRef.current[active];
    } else {
      pagesRef.current = null;
      undoPagesRef.current = null;
      cellsRef.current = relaid ? relaid.autoGrid.slice() : fit(cellsRef.current);
      undoRef.current = [{ resize: before }];
    }
    redoRef.current = [];
    setActiveCoaster(active);
    activeCoasterRef.current = active;
    if (relaid) markLaid();
    else sourceRef.current = null;
    setDims({ w: p.w, h: p.h, name: p.name });
    bump();
  };
  const finishedDims = p => inchDims(+(p.w / CFG.gauge).toFixed(1), +(p.h / CFG.gauge).toFixed(1));

  // Starter charts replace the canvas and stay undoable. A set chart re-dresses
  // all four coasters as one step, held like a size change so undo restores the
  // whole set and its histories; anything else lands on the coaster in view.
  // Charts keep their own colors so they match the thumbnail.
  const applyTemplate = (tpl) => {
    const len = W * H;
    const seed = tpl ? gridSeedFromTemplate(tpl, { name: dims.name, w: W, h: H }, null) : { autoGrid: null, autoPages: null };
    if (tpl && !(seed.autoGrid && seed.autoGrid.length === len)) { showToast(`${tpl.name} doesn't fit this size`); return; }
    if (guide) { applyGuidedTemplate(tpl, seed); return; }
    commitFloat();
    clearSelection();
    bindActivePage();
    const wholeSet = !!(pagesRef.current && seed.autoPages && seed.autoPages.length === COASTER_COUNT
      && seed.autoPages.every(p => p && p.length === len));
    if (wholeSet) {
      undoPagesRef.current[activeCoaster] = undoRef.current;
      const before = { dims, pages: pagesRef.current, undoPages: undoPagesRef.current,
        cells: cellsRef.current, undo: undoRef.current, active: activeCoaster };
      pagesRef.current = seed.autoPages.map(p => p.slice());
      undoPagesRef.current = pagesRef.current.map(() => [{ resize: before }]);
      cellsRef.current = pagesRef.current[activeCoaster];
      undoRef.current = undoPagesRef.current[activeCoaster];
      redoRef.current = [];
    } else {
      recordUndo(cellsRef.current.slice());
      cellsRef.current = seed.autoGrid ? seed.autoGrid.slice() : new Array(len).fill(null);
      bindActivePage();
    }
    const incoming = new Set();
    for (const cells of (wholeSet ? pagesRef.current : [cellsRef.current])) for (const h of cells) if (h) incoming.add(h);
    if (incoming.size) {
      const byHex = new Map(CFG.library.map(c => [c.hex, c]));
      setPal(prev => {
        const have = new Set(prev.map(c => c.hex));
        const add = [...incoming].filter(h => !have.has(h)).map(h => byHex.get(h)).filter(Boolean);
        return add.length ? [...prev, ...add] : prev;
      });
    }
    redraw(); bump();
    showToast(tpl ? `${tpl.name} applied · undo to go back` : 'Canvas cleared · undo to go back');
    if (isMobile) setPanel(null);
    if (tpl && tpl.seedText) {
      if (tpl.seedText.font) setTextFont(tpl.seedText.font);
      if (tpl.seedText.size) setTextSize(tpl.seedText.size);
      if (tpl.seedText.text) setText(tpl.seedText.text);
      chooseTool('text');
    }
  };

  // ── Guided setup ────────────────────────────────────────────────────────
  // What the design was started from — { kind: 'template', tpl } or
  // { kind: 'photo' } — with the palette it was dressed in and a copy of every
  // page as laid. While the board still matches that copy, a new size or
  // palette lays the source again instead of cropping or recoloring it.
  const sourceRef = useRef(null);
  const boardPages = () => (pagesRef.current
    ? pagesRef.current.map((p, i) => (i === activeCoasterRef.current ? cellsRef.current : p))
    : [cellsRef.current]);
  const markLaid = () => { if (sourceRef.current) sourceRef.current.laid = boardPages().map(p => p.slice()); };
  const sourceFresh = () => {
    const s = sourceRef.current;
    if (!s || !s.laid) return false;
    const pages = boardPages();
    return pages.length === s.laid.length
      && pages.every((p, i) => p.length === s.laid[i].length && p.every((h, j) => h === s.laid[i][j]));
  };
  // Every color on the board joins the palette, as starter charts do.
  const paletteWith = (base, pages) => {
    const byHex = new Map(CFG.library.map(c => [c.hex, c]));
    const have = new Set(base.map(c => c.hex)), out = base.slice();
    for (const cells of pages) for (const h of cells) {
      if (h && !have.has(h)) { have.add(h); const c = byHex.get(h); if (c) out.push(c); }
    }
    return out;
  };
  // Lays a seed on the board as one undo step. A coaster set takes it on every
  // coaster (its own four pages for a set chart).
  const layGuided = (seed) => {
    const len = W * H;
    commitFloat();
    clearSelection();
    bindActivePage();
    const grid = seed.autoGrid ? seed.autoGrid.slice() : new Array(len).fill(null);
    if (pagesRef.current) {
      undoPagesRef.current[activeCoaster] = undoRef.current;
      const before = { dims, pages: pagesRef.current, undoPages: undoPagesRef.current,
        cells: cellsRef.current, undo: undoRef.current, active: activeCoaster };
      pagesRef.current = seedCoasterPages(grid, len, seed.autoPages);
      undoPagesRef.current = pagesRef.current.map(() => [{ resize: before }]);
      cellsRef.current = pagesRef.current[activeCoaster];
      undoRef.current = undoPagesRef.current[activeCoaster];
      redoRef.current = [];
    } else {
      recordUndo(cellsRef.current.slice());
      cellsRef.current = grid;
    }
    redraw(); bump();
  };
  // The current source laid again at another size or in another palette, or
  // null when it can't be (an edited board, or a chart this size doesn't offer).
  const reseed = ({ w, h, name }, colors) => {
    const s = sourceRef.current;
    if (!s || !sourceFresh()) return null;
    if (s.kind === 'photo') {
      if (!photo) return null;
      const use = colors || s.palette;
      return use && use.length ? { autoGrid: photoGrid(photo, use, w, h), autoPages: null } : null;
    }
    if (!stitchTemplatesFor({ name, w, h }, craft).some(t => t.id === s.tpl.id)) return null;
    const seed = gridSeedFromTemplate(s.tpl, { name, w, h }, colors || s.palette);
    return seed.autoGrid && seed.autoGrid.length === w * h ? seed : null;
  };

  const applyGuidedTemplate = (tpl, seed) => {
    layGuided(seed);
    sourceRef.current = tpl ? { kind: 'template', tpl, palette: null } : null;
    markLaid();
    if (tpl) setPal(prev => paletteWith(prev, boardPages()));
    if (photo) { photoGenRef.current++; setPhoto(null); setBg(null); setShowBg(false); }
    showToast(tpl ? `${tpl.name} applied · undo to go back` : 'Canvas cleared · undo to go back');
    // A lettering chart still sets up the text tool, but its panel waits until
    // the guide is done.
    if (tpl && tpl.seedText) {
      if (tpl.seedText.font) setTextFont(tpl.seedText.font);
      if (tpl.seedText.size) setTextSize(tpl.seedText.size);
      if (tpl.seedText.text) setText(tpl.seedText.text);
      setTool('text');
    }
    guideCtl.advance('designs');
  };

  // Own-image source. The original and its background cutout are both kept, so
  // "Remove background" can flip between them without asking for the file again.
  const [photo, setPhoto] = useState(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const photoGenRef = useRef(0);
  const photoImg = ph => (ph.removeBg && ph.cutoutImg) || ph.img;
  const photoGrid = (ph, colors, w, h) =>
    buildGridFromImage(photoImg(ph), colors, w, h, { simplify: ph.simplify, removeBg: ph.removeBg });
  const suggestFromImage = img => {
    const maxDim = 160, scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0, w, h);
    let pixels; try { pixels = ctx.getImageData(0, 0, w, h); } catch { return []; }
    const seen = new Set(), colors = [];
    for (const c of extractColors(pixels, 24)) {
      const k = CFG.nearest(c);
      if (k && !seen.has(k.code)) { seen.add(k.code); colors.push(k); }
    }
    return colors.slice(0, CFG.paletteMax);
  };
  const layPhoto = (ph, colors) => {
    layGuided({ autoGrid: photoGrid(ph, colors, W, H), autoPages: null });
    sourceRef.current = { kind: 'photo', palette: colors };
    markLaid();
    setPal(paletteWith(colors, boardPages()));
    setColor(colors[0]);
    setBg((ph.removeBg && ph.cutout) || ph.original);
    setShowBg(true);
  };
  const onPhotoFile = async (file) => {
    const gen = ++photoGenRef.current;
    setPhotoBusy(true);
    setPhotoError('');
    try {
      const original = await readImageFile(file);
      const img = await loadImage(original);
      const cutout = punchImageBackground(img);
      const cutoutImg = cutout ? await loadImage(cutout) : null;
      if (gen !== photoGenRef.current) return;
      const ph = { name: file.name || 'Your image', original, img, cutout, cutoutImg, simplify: XS_SIMPLIFY_DEFAULT, removeBg: true };
      ph.suggested = suggestFromImage(photoImg(ph));
      if (!ph.suggested.length) throw new Error("We couldn't find any colors in that image.");
      setPhoto(ph);
      layPhoto(ph, ph.suggested);
      showToast('Charted from your image · undo to go back');
    } catch (e) {
      if (gen === photoGenRef.current) setPhotoError((e && e.message) || "Couldn't use that image.");
    } finally {
      if (gen === photoGenRef.current) setPhotoBusy(false);
    }
  };
  // The palette a photo setting re-charts in: whatever was chosen for it, or
  // its own suggestion if nothing else was.
  const photoPalette = ph => {
    const s = sourceRef.current;
    return s && s.kind === 'photo' && s.palette ? s.palette : ph.suggested;
  };
  const setPhotoDetail = simplify => {
    if (!photo || simplify === photo.simplify) return;
    const next = { ...photo, simplify };
    setPhoto(next);
    layPhoto(next, photoPalette(photo));
  };
  const setPhotoRemoveBg = removeBg => {
    if (!photo) return;
    const s = sourceRef.current;
    const onSuggestion = !s || s.kind !== 'photo' || s.palette === photo.suggested;
    const next = { ...photo, removeBg };
    const found = suggestFromImage(photoImg(next));
    next.suggested = found.length ? found : photo.suggested;
    setPhoto(next);
    layPhoto(next, onSuggestion ? next.suggested : s.palette);
  };
  const removePhoto = () => {
    photoGenRef.current++;
    const s = sourceRef.current;
    if (s && s.kind === 'photo' && sourceFresh()) layGuided({ autoGrid: null, autoPages: null });
    if (s && s.kind === 'photo') sourceRef.current = null;
    setPhoto(null); setPhotoError('');
    setBg(null); setShowBg(false);
  };

  // The guide's color step: a palette re-dresses an untouched photo or chart,
  // and otherwise swaps color for color by palette position.
  const starterPalettes = useMemo(() => [
    ...(photo ? [{ name: 'From your photo', colors: photo.suggested }] : []),
    ...dmcSuggested,
  ], [photo, dmcSuggested]);
  const applyPalette = colors => {
    if (!colors || !colors.length) return;
    const s = sourceRef.current;
    if (s && s.kind === 'photo' && photo && sourceFresh()) { layPhoto(photo, colors); return; }
    const seed = reseed({ w: W, h: H, name: dims.name }, colors);
    if (seed) {
      layGuided(seed);
      s.palette = colors;
      markLaid();
    } else {
      const map = new Map(pal.map((c, i) => [c.hex, colors[i % colors.length].hex]));
      const pages = boardPages().map(p => p.map(h => (h && map.has(h) ? map.get(h) : h)));
      layGuided({ autoGrid: pages[pagesRef.current ? activeCoaster : 0], autoPages: pagesRef.current ? pages : null });
      sourceRef.current = null;
    }
    setPal(paletteWith(colors, boardPages()));
    setColor(colors[0]);
  };
  const activeStarter = useMemo(() => {
    const key = pal.map(c => c.hex).join('|');
    const hit = starterPalettes.find(p => p.colors.map(c => c.hex).join('|') === key);
    return hit ? hit.name : null;
  }, [pal, starterPalettes]);

  const finishGuide = () => {
    guideCtl.end();
    setPanel(tool === 'text' ? 'text' : (isMobile ? null : 'floss'));
    showToast(craft === 'punch-needle' ? 'All set · happy punching' : 'All set · happy stitching');
  };
  const guideStep = guideCtl.step;
  const guideFooter = guideStep >= 0 && (
    <EdGuideFooter steps={GUIDE} step={guideStep}
      onBack={() => { guideCtl.cancel(); setPanel(GUIDE[guideStep - 1].id); }}
      onNext={() => {
        guideCtl.cancel();
        if (guideStep < GUIDE.length - 1) setPanel(GUIDE[guideStep + 1].id);
        else finishGuide();
      }}/>
  );

  const pickColor = (c) => {
    setColor(c);
    if (selRef.current) recolorSelection(c);
  };

  const toolDef = STITCH_TOOLS.find(t => t.id === tool) || STITCH_TOOLS[2];
  const toolHint = toolDef.hint(isMobile ? 'Tap' : 'Click', CFG);
  const [showTips, setShowTips] = useShowTips();
  const hintBubble = showTips && (
    <EdHintBubble text={toolHint} onHide={() => { setShowTips(false); showToast('Tips hidden. Turn them back on in Help.'); }}/>
  );
  const tools = STITCH_TOOLS.map(t => ({ ...t, icon: <t.Ic size={isMobile ? 20 : 18}/> }));
  const painting = STITCH_COLOR_TOOLS.has(tool);
  const nibbed = tool === 'pen' || tool === 'eraser';
  const setNib = n => (tool === 'eraser' ? setEraserNib : setPenNib)(n);
  const isColorActive = c => !!color && color.hex === c.hex;
  const canUndo = undoRef.current.length > 0;
  const canRedo = redoRef.current.length > 0;
  const openSave = () => { setSaveName(''); setShowSave(true); };
  const openSaveAs = () => { setSaveName(((currentStitch && currentStitch.name) || '') + ' copy'); setShowSave(true); };
  const finished = finishedDims({ w: W, h: H });
  const templates = useMemo(() => stitchTemplatesFor({ name: dims.name, w: W, h: H }, craft), [dims.name, W, H, craft]);
  // Coaster thumbnails: the page in view is read live, so they follow each edit.
  const coasterPages = useMemo(() => (pagesRef.current
    ? pagesRef.current.map((p, i) => (i === activeCoaster ? cellsRef.current : p).slice())
    : null), [version, activeCoaster, isCoasterKit]);
  const pillAddRef = useRef(null);
  const selAddRef = useRef(null);
  const trayRef = useRef(null);
  const [trayH, setTrayH] = useState(0);
  useLayoutEffect(() => {
    const el = trayRef.current;
    if (!el) { setTrayH(0); return undefined; }
    const measure = () => setTrayH(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isMobile, panel]);

  const threadWord = CFG.threadLabel.toLowerCase();
  const PANEL_TITLES = { designs: 'Templates', floss: CFG.threadLabel, fabric: 'Fabric', size: 'Size', text: 'Text', help: 'Help', menu: 'More' };
  const panelTitle = guideStep >= 0 ? GUIDE[guideStep].title : PANEL_TITLES[panel];
  const renderPanel = id => {
    if (id === 'designs') return (
      <StitchDesignsPanel cfg={CFG} templates={templates} dims={{ name: dims.name, w: W, h: H }} fabric={fabric}
        isCoaster={isCoasterKit} onApply={applyTemplate}
        photoSource={guided ? (
          <StitchPhotoSource cfg={CFG} photo={photo} busy={photoBusy} error={photoError} onFile={onPhotoFile}
            onDetail={setPhotoDetail} onRemoveBg={setPhotoRemoveBg} onRemove={removePhoto}/>
        ) : null}/>
    );
    if (id === 'floss') return (
      <StitchFlossPanel cfg={CFG} pal={pal} setPal={setPal} isActive={isColorActive} onPick={pickColor}
        onAdd={ref => openLibrary(ref)} stats={stats} isCoaster={isCoasterKit}
        starters={guide ? <EdPaletteStarters palettes={starterPalettes} activeName={activeStarter} onApply={applyPalette}/> : null}/>
    );
    if (id === 'fabric') return (
      <StitchFabricPanel cfg={CFG} fabric={fabric} setFabric={setFabric} finished={finished}
        bg={bg} showBg={showBg} setShowBg={setShowBg} bgOpacity={bgOpacity} setBgOpacity={setBgOpacity}/>
    );
    if (id === 'size') return (
      <StitchSizePanel cfg={CFG} current={dims.name} W={W} H={H} finishedDims={finishedDims}
        onPick={name => { applySize(name); if (guide) guideCtl.advance('size'); }}/>
    );
    if (id === 'text') return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <StitchTextControls autoFocus={!isMobile}
          text={text} setText={setText} textFont={textFont} setTextFont={setTextFont}
          textSize={textSize} setTextSize={setTextSize}/>
        <p className="ed-note" style={{ marginTop: 6 }}>{isMobile ? 'Close this, then tap' : 'Click'} the canvas to place your words in the current color.</p>
      </div>
    );
    if (id === 'help') return <StitchHelpPanel cfg={CFG} isMobile={isMobile} showTips={showTips} setShowTips={setShowTips}/>;
    if (id === 'menu') {
      const items = [
        ...(currentStitch
          ? [{ id: 'save', label: justSaved ? 'Saved' : 'Save', icon: justSaved ? <IcCheck size={16}/> : <IcSave/>, onClick: updateCurrentDesign },
             { id: 'save-as', label: 'Save as…', icon: <IcCopy size={16}/>, onClick: openSaveAs }]
          : [{ id: 'save', label: justSaved ? 'Saved' : 'Save design', icon: justSaved ? <IcCheck size={16}/> : <IcSave/>, onClick: openSave }]),
        ...(savedStitches.length > 0
          ? [{ id: 'mine', label: 'My designs', icon: <IcSaved size={18}/>, meta: savedStitches.length, onClick: () => setShowMyStitches(true) }]
          : []),
        { id: 'clear', label: isCoasterKit ? 'Clear this coaster' : 'Clear design', icon: <IcTrash size={16}/>,
          disabled: stats.total === 0 && !hasSel, onClick: () => setConfirmClear(true) },
        { id: 'help', label: 'Help', icon: <IcHelp size={16}/>, keepOpen: true, onClick: () => setPanel('help') },
      ];
      return <EdMenu items={items} onClose={() => setPanel(null)}/>;
    }
    return null;
  };

  const railPanels = [
    { id: 'designs', label: 'Templates', icon: <EdNavIcon name="designs"/> },
    { id: 'floss', label: CFG.threadLabel, icon: <EdNavIcon name={CFG.threadIcon}/> },
    { id: 'fabric', label: 'Fabric', icon: <EdNavIcon name="fabric"/> },
    { id: 'size', label: 'Size', icon: <EdNavIcon name="size"/> },
  ];
  const tabPanels = [
    { id: 'designs', label: 'Templates', icon: <EdNavIcon name="designs" size={26}/> },
    { id: 'floss', label: CFG.threadLabel, icon: <EdNavIcon name={CFG.threadIcon} size={26}/> },
    { id: 'tools', label: 'Tools', icon: <EdNavIcon name="tools" size={26}/> },
    { id: 'size', label: 'Size', icon: <EdNavIcon name="size" size={26}/> },
    { id: 'fabric', label: 'Fabric', icon: <EdNavIcon name="fabric" size={26}/> },
  ];
  // Guided mode lists the panels in the order the setup walks them, Size first.
  const inGuideOrder = list => {
    const rank = id => { const i = GUIDE.findIndex(g => g.id === id); return i < 0 ? GUIDE.length : i; };
    return list.slice().sort((a, b) => rank(a.id) - rank(b.id));
  };
  const railItems = [
    ...(guided ? inGuideOrder(railPanels) : railPanels),
    { id: 'sp', spacer: true },
    { id: 'help', label: 'Help', icon: <IcHelp/> },
  ];
  const tabItems = guided ? inGuideOrder(tabPanels) : tabPanels;
  const gridBtn = (
    <button type="button" className="icon-btn ed-grid-btn" aria-pressed={showGrid} onClick={() => setShowGrid(v => !v)}
      title={showGrid ? 'Hide grid lines' : 'Show grid lines'} aria-label="Grid lines">
      <IcGrid size={isMobile ? 18 : 16}/>
    </button>
  );
  const paletteSwatches = pal.map((c, i) => (
    <EdSwatch key={`${c.code || c.name}-${i}`} color={c} active={isColorActive(c)} onClick={() => pickColor(c)}
      title={`${CFG.codePrefix} ${c.code} · ${c.name}`}/>
  ));
  const addSwatch = (ref, placement, size) => (
    <button ref={ref} type="button" className="ed-swatch ed-swatch-add"
      onClick={() => openLibrary(ref, placement)} title={`Add ${threadWord} from the library`} aria-label={`Add ${threadWord}`}>
      <IcPlus size={size}/>
    </button>
  );
  const nibs = nibbed && (
    <StitchNibs nib={nib} onNib={setNib} cfg={CFG} label={tool === 'eraser' ? 'Eraser' : 'Pencil'} color={color}/>
  );
  const coasterStrip = isCoasterKit && coasterPages && (
    <StitchCoasterStrip pages={coasterPages} active={activeCoaster} onSelect={selectCoaster} onCopyAll={copyCoasterToAll}
      w={W} h={H} bg={fabric.hex}/>
  );
  const sel = hasSel ? selRef.current : null;
  const selInfo = sel && (() => {
    const f = selFrame(sel);
    const n = new Set(sel.cells.values()).size;
    return `${sel.cells.size} ${CFG.unitPlural} · ${n} color${n !== 1 ? 's' : ''} · ${f.maxX - f.minX + 1}×${f.maxY - f.minY + 1}`;
  })();
  const selBar = sel && (
    <div className={`ed-selbar ed-float ed-keep-sel ${isMobile ? 'ed-strip' : 'ed-palette-pill'}`}
      role="toolbar" aria-label="Selection">
      <div className={isMobile ? 'ed-sel-swatches' : 'ed-swatches'} title="Recolor the selection">
        {paletteSwatches}
      </div>
      {addSwatch(selAddRef, isMobile ? undefined : 'bottom-center', 12)}
      {!isMobile && <span className="ed-selbar-info">{selInfo}</span>}
      <button type="button" className={`btn btn-xs${lockRatio ? ' btn-dark' : ''}`} onClick={() => setLockRatio(v => !v)}
        aria-pressed={lockRatio} title="Keep the proportions when dragging a corner handle (hold Shift to flip)">Lock ratio</button>
      <button type="button" className="icon-btn" onClick={duplicateSelection} title="Duplicate (⌘D)" aria-label="Duplicate"><IcCopy size={16}/></button>
      <button type="button" className="icon-btn" onClick={deleteSelection} title={`Delete these ${CFG.unitPlural} (Delete)`} aria-label="Delete"><IcTrash size={16}/></button>
      <button type="button" className="btn btn-xs btn-dark" onClick={deselect} title="Deselect (Enter or Esc)">Done</button>
    </div>
  );

  return (
    <div className="app ed-app xs-ed" style={{ '--ed-tray-h': `${trayH}px` }}>

      <div className="ed-topbar">
        <div className="ed-topbar-left">
          {onBack && (
            <button type="button" className="icon-btn ed-lg" onClick={onBack} title="Back to projects" aria-label="Back to projects">
              <IcArrowL/>
            </button>
          )}
          {(!isMobile || !onBack) && (
            <a className="brand" href="/" aria-label="metime home"><MetimeLogo/></a>
          )}
          {!isMobile && <span className="ed-vrule"/>}
          <button type="button" className="icon-btn ed-lg" onClick={undo} disabled={!canUndo} title="Undo (⌘Z)" aria-label="Undo"><IcUndo/></button>
          <button type="button" className="icon-btn ed-lg" onClick={redo} disabled={!canRedo} title="Redo (⇧⌘Z)" aria-label="Redo"><IcRedo/></button>
        </div>
        <div className="ed-topbar-right header-right">
          {!isMobile && savedStitches.length > 0 && (
            <button type="button" className="ed-topbar-link is-tomato" onClick={() => setShowMyStitches(true)}>My designs</button>
          )}
          {!isMobile && (currentStitch ? (
            <>
              <button type="button" className="ed-topbar-link is-olive" title="Save as a new copy" onClick={openSaveAs}>Save as…</button>
              <button className="btn" title={`Update “${currentStitch.name}”`} onClick={updateCurrentDesign}>
                {justSaved ? <>Saved <IcCheck size={12}/></> : 'Save'}
              </button>
            </>
          ) : (
            <button className="btn" onClick={openSave}>
              {justSaved ? <>Saved <IcCheck size={12}/></> : 'Save design'}
            </button>
          ))}
          {!isMobile && <AccountChip/>}
          {isMobile && (
            <button type="button" className="icon-btn ed-lg ed-more-btn" aria-haspopup="menu" aria-expanded={panel === 'menu'}
              aria-label={justSaved ? 'Saved. More actions' : 'More actions'} title="More actions"
              onClick={() => togglePanel('menu')}>
              {justSaved ? <IcCheck size={18}/> : <span className="ed-more-dots" aria-hidden="true"><span/><span/><span/></span>}
            </button>
          )}
          {/* Buying needs no account and no prior save. An empty board is held
              back, since the kit would be cloth and no thread. */}
          <div className="ed-buy">
            <BuyKitButton type={CFG.checkoutType} design={{ presetName: dims.name }} onReview={onReview}
              blockedReason={stats.total === 0 ? `Add some ${CFG.unitPlural} first` : null}
              getDesign={() => { commitFloat(); return buildStitchRecord(currentStitchId ?? Date.now(), (currentStitch && currentStitch.name) || 'Untitled'); }}
              onSaved={id => { if (currentStitchId != null) setSavedStitches(p => p.map(x => x.id === currentStitchId ? { ...x, apiId: id } : x)); }}/>
          </div>
        </div>
      </div>

      <div className="ed-main">
        <div className="ed-stage-col">
          <div className={`ed-stage${!isMobile && showTips ? ' has-hint' : ''}`}>
            <div className={`xs-canvas-wrap${tool === 'pan' ? ' is-panning' : ''}${isCoasterKit ? ' has-coasters' : ''}`} ref={wrapRef}>
              <canvas ref={canvasRef} className="xs-canvas"
                width={Math.round(W * cellSize * dpr)} height={Math.round(H * cellSize * dpr)}
                style={{ cursor: tool === 'pan' ? 'grab' : tool === 'select' ? (selCursor || 'crosshair') : 'crosshair', width: W * cellSize * zoom, height: H * cellSize * zoom, flexShrink: 0 }}
                onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerLeave}/>
            </div>

            {!isMobile && <EdTools className="ed-dock ed-float" tools={tools} tool={tool} onTool={chooseTool}/>}
            {!isMobile && (selBar || ((nibbed || painting) && (
              <div className="ed-palette-pill ed-float ed-keep-sel">
                {nibbed && (
                  <EdMenuButton label={`${tool === 'eraser' ? 'Eraser' : 'Pencil'} size: ${nib} × ${nib}`}
                    menuLabel={`${tool === 'eraser' ? 'Eraser' : 'Pencil'} size`} width={206}
                    trigger={<span className="ed-menu-nib"><EdNibIcon nib={nib} color={color}/></span>}>
                    {nibs}
                  </EdMenuButton>
                )}
                {nibbed && painting && <span className="ed-strip-sep"/>}
                {painting && (
                  <EdMenuButton btnRef={pillAddRef} label={color ? `${CFG.threadLabel}: ${color.name}` : CFG.threadLabel}
                    menuLabel={CFG.threadLabel} width={256}
                    trigger={<span className="ed-menu-swatch" style={edSwatchStyle(color)}/>}>
                    <div className="ed-menu-swatches">
                      {paletteSwatches}
                      <button type="button" className="ed-swatch ed-swatch-add"
                        onClick={() => openLibrary(pillAddRef, 'bottom-center')} title={`Add ${threadWord} from the library`} aria-label={`Add ${threadWord}`}>
                        <IcPlus size={12}/>
                      </button>
                    </div>
                  </EdMenuButton>
                )}
              </div>
            )))}
            {!isMobile && (hintBubble || coasterStrip) && (
              <div className="ed-bottom-stack">
                {hintBubble}
                {coasterStrip}
              </div>
            )}

            {isMobile && (
              <div className="ed-canvas-head">
                <div className="ed-canvas-head-right">
                  {gridBtn}
                  <EdZoomPill zoom={zoom} onStep={adjustZoom} onFit={resetZoom}/>
                </div>
              </div>
            )}
            {isMobile && !panel && (
              <div className="ed-tray" ref={trayRef}>
                {hintBubble}
                {coasterStrip}
                {selBar || ((nibbed || painting) && (
                  <div className="ed-strip ed-float ed-keep-sel">
                    {nibs}
                    {nibs && painting && <span className="ed-strip-sep"/>}
                    {painting && paletteSwatches}
                    {painting && addSwatch(pillAddRef, undefined)}
                  </div>
                ))}
                <div className="ed-tray-card">
                  <div className="ed-handle"/>
                  <EdTools className="ed-tray-tools is-dense" tools={tools} tool={tool} onTool={chooseTool}/>
                </div>
              </div>
            )}
            {isMobile && (
              <EdSheet open={!!panel} id={panel} title={panelTitle} footer={guideFooter} onClose={() => setPanel(null)}>
                {panel && renderPanel(panel)}
              </EdSheet>
            )}
            {toast && <div className="ed-toast" role="status">{toast}</div>}
          </div>

          {!isMobile && (
            <div className="ed-statusbar">
              {gridBtn}
              <button type="button" className="btn btn-sm" onClick={() => setConfirmClear(true)} disabled={stats.total === 0 && !hasSel}
                title={isCoasterKit ? 'Clear this coaster' : 'Clear the design'}>Clear</button>
              <span className="ed-spacer"/>
              <EdZoomControls zoom={zoom} onZoom={setZoom} onStep={adjustZoom} onFit={resetZoom}/>
            </div>
          )}
        </div>

        {!isMobile && (
          <EdPanel open={!!panel} id={panel} title={panelTitle} footer={guideFooter} onClose={() => setPanel(null)}>
            {panel && renderPanel(panel)}
          </EdPanel>
        )}
        {!isMobile && <EdNav className="ed-rail" label="Panels" items={railItems} active={panel} onSelect={togglePanel}/>}
      </div>

      {isMobile && (
        <EdNav className="ed-tabbar" label="Panels" items={tabItems}
          active={panel === 'designs' || panel === 'floss' || panel === 'size' || panel === 'fabric' ? panel : (panel ? null : 'tools')}
          onSelect={id => id === 'tools' ? setPanel(null) : togglePanel(id)}/>
      )}

      {/* Color library popover, anchored to whichever + opened it. */}
      {picker && libraryAnchorRef.current && (
        <LibraryPopover
          anchorRef={libraryAnchorRef}
          onClose={closePicker}
          search={search} setSearch={setSearch}
          grp={grp} setGrp={setGrp}
          filtered={filtered}
          color={color} setColor={setColor}
          selIds={new Set()} setShapes={() => {}}
          customs={xsCustoms} setCustoms={setXsCustoms}
          setPinned={setPal}
          allColors={allColors}
          pinned={pal}
          suggested={dmcSuggested}
          isMobile={isMobile}
          afterPick={c => { if (selRef.current) recolorSelection(c); }}
          placement={picker.placement || 'left-anchored'}/>
      )}

      {confirmClear && (
        <div className="overlay" onClick={() => setConfirmClear(false)}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#FFFFFF', border: '1px solid #CCD6EB', borderRadius: 8, padding: 24, maxWidth: 340, width: '100%', margin: 16, boxShadow: '0 8px 32px rgba(0,0,0,0.14)' }}>
            <div style={{ fontWeight: 400, fontSize: 24, marginBottom: 8, fontFamily: 'var(--font-display)', lineHeight: 1.1 }}>{isCoasterKit ? 'Clear this coaster?' : 'Clear the design?'}</div>
            <div style={{ fontSize: 13, color: '#3D4E70', marginBottom: 20, lineHeight: 1.5 }}>
              {isCoasterKit ? `This removes every ${CFG.unit} from this coaster. The rest of the set is unchanged.` : `This removes every ${CFG.unit} from your design. You can undo it.`}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setConfirmClear(false)}>Cancel</button>
              <button className="btn btn-dark" onClick={() => { clearAll(); showToast('Cleared · undo to go back'); }}>{isCoasterKit ? 'Clear coaster' : 'Clear all'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Save dialog */}
      {showSave && (
        <div className="overlay" onClick={() => setShowSave(false)}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#FFFFFF', border: '1px solid #CCD6EB', borderRadius: 8, padding: 24, maxWidth: 380, width: '100%', margin: 16, boxShadow: '0 8px 32px rgba(0,0,0,0.14)' }}>
            <div style={{ fontWeight: 400, fontSize: 24, marginBottom: 16, fontFamily: 'var(--font-display)', lineHeight: 1.1 }}>{currentStitch ? 'Save a copy' : 'Save your design'}</div>
            <AccountsOfflineNote/>
            <input type="text" placeholder="Give your design a name…" value={saveName} onChange={e => setSaveName(e.target.value)}
              autoFocus onKeyDown={e => { if (e.key === 'Enter') saveNewDesign(); }} style={{ marginBottom: 16 }}/>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setShowSave(false)}>Cancel</button>
              <button className="btn btn-dark" onClick={saveNewDesign}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* My designs list */}
      {showMyStitches && (
        <div className="overlay" onClick={() => setShowMyStitches(false)}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#FFFFFF', border: '1px solid #CCD6EB', borderRadius: 8, padding: 24, maxWidth: 500, width: '100%', margin: 16, boxShadow: '0 8px 32px rgba(0,0,0,0.14)', maxHeight: '80vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ fontWeight: 400, fontSize: 24, fontFamily: 'var(--font-display)', lineHeight: 1.1 }}>My designs</div>
              <button onClick={() => setShowMyStitches(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--warm-muted)', display: 'flex' }}><IcX/></button>
            </div>
            {saveError && (
              <div style={{ fontSize: 12, color: 'var(--metime-tomato)', background: '#FBECE8', border: '1px solid #F3C9BF', borderRadius: 6, padding: '8px 10px', marginBottom: 12 }}>{saveError}</div>
            )}
            {savedStitches.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--warm-muted)', fontStyle: 'italic', padding: '20px 0', textAlign: 'center' }}>No saved designs yet</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {savedStitches.map(d => (
                  <div key={d.id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 12, border: '1px solid #CCD6EB', borderRadius: 6, cursor: 'pointer', transition: 'background .1s' }}
                    onClick={() => { setViewStitch(d); setShowMyStitches(false); }} title="Preview"
                    onMouseEnter={e => e.currentTarget.style.background = '#EDF2FC'}
                    onMouseLeave={e => e.currentTarget.style.background = '#FFFFFF'}>
                    <div style={{ width: 64, height: 64, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#FFFFFF', borderRadius: 4, overflow: 'hidden' }}>
                      <StitchThumb w={d.w} h={d.h} cells={deserializeGrid(d.grid, d.w * d.h)} size={64} bg={(d.fabric && d.fabric.hex) || '#FFFFFF'}/>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500, fontSize: 14, marginBottom: 2 }}>{d.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--warm-muted)' }}>{d.w} × {d.h} {CFG.unitPlural} · {canonicalPresetName(craft, d.presetName)}</div>
                      <div style={{ fontSize: 12, color: 'var(--warm-muted)' }}>{d.colorsUsed} color{d.colorsUsed !== 1 ? 's' : ''} · {d.stitches} {CFG.unitPlural}</div>
                    </div>
                    {confirmDeleteId === d.id ? (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                        <button className="btn btn-sm" onClick={() => setConfirmDeleteId(null)}>Cancel</button>
                        <button className="btn btn-sm btn-dark" onClick={() => { deleteCloudDesign(d.apiId); setSavedStitches(p => p.filter(x => x.id !== d.id)); setConfirmDeleteId(null); }}>Delete</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                        <button title="Delete design" onClick={e => { e.stopPropagation(); setConfirmDeleteId(d.id); }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--warm-muted)', display: 'flex', padding: 4 }}
                          onMouseEnter={e => e.currentTarget.style.color = 'var(--metime-tomato)'}
                          onMouseLeave={e => e.currentTarget.style.color = 'var(--warm-muted)'}><IcTrash/></button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Design preview */}
      {viewStitch && (() => {
        const d = viewStitch;
        return (
          <div className="overlay" onClick={() => setViewStitch(null)}>
            <div onClick={e => e.stopPropagation()}
              style={{ background: '#FFFFFF', border: '1px solid #CCD6EB', borderRadius: 8, maxWidth: 640, width: '100%', margin: 16, boxShadow: '0 8px 32px rgba(0,0,0,0.14)', maxHeight: '90vh', overflowY: 'auto' }}>
              <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #EDF2FC', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontWeight: 400, fontSize: 24, fontFamily: 'var(--font-display)', lineHeight: 1.1 }}>{d.name}</div>
                  <div style={{ fontSize: 13, color: 'var(--warm-muted)', marginTop: 2 }}>{d.w} × {d.h} {CFG.unitPlural} · {d.colorsUsed} colors{d.fabric ? ` · ${d.fabric.name} ${CFG.fabricLabel}` : ''}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button className="btn" onClick={() => loadDesign(d)}>Open on canvas</button>
                  <button onClick={() => setViewStitch(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--warm-muted)', display: 'flex' }}><IcX/></button>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
                <div style={{ padding: 24, borderRight: '1px solid #EDF2FC', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ width: '100%', maxWidth: 280, border: '1px solid #CCD6EB', borderRadius: 4, overflow: 'hidden' }}>
                    <StitchThumb w={d.w} h={d.h} cells={deserializeGrid(d.grid, d.w * d.h)} size={280} bg={(d.fabric && d.fabric.hex) || '#FFFFFF'}/>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <div style={{ padding: '16px 20px 8px' }}>
                    <div className="label" style={{ marginBottom: 4 }}>{CFG.threadLabel} list</div>
                    <div style={{ fontSize: 12, color: 'var(--warm-muted)' }}>{d.colors.length} color{d.colors.length !== 1 ? 's' : ''}</div>
                  </div>
                  <div style={{ flex: 1, overflowY: 'auto', maxHeight: 340 }}>
                    {d.colors.map(c => (
                      <div key={c.hex} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 20px', borderBottom: '1px solid #EDF2FC' }}>
                        <div style={{ width: 24, height: 24, background: c.hex, border: '1px solid rgba(0,0,0,0.10)', borderRadius: 3, flexShrink: 0 }}/>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 500 }}>{CFG.codePrefix} {c.code}</div>
                          <div style={{ fontSize: 11, color: 'var(--warm-muted)' }}>{c.name}</div>
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{c.count}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ padding: '12px 20px', borderTop: '1px solid #EDF2FC', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--warm-muted)' }}>Total {CFG.unitPlural}</div>
                      <div style={{ fontSize: 20, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{d.stitches}</div>
                    </div>
                    <KitCheckoutButton type={CFG.checkoutType} design={d} savedId={d.apiId} onReview={onReview}
                      onSaved={id=>setSavedStitches(p=>p.map(x=>x.id===d.id?{...x,apiId:id}:x))}/>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
