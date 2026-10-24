import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { KONA } from '../assets/color-catalogs.js';
import {
  ACCOUNTS_OFFLINE_SAVE_MSG, deleteCloudDesign, loadSavedQuilts, persistSavedQuilts,
  stashPendingSave, upsertCloudDesign, useAuth,
} from './services.jsx';
import { BuyKitButton, KitCheckoutButton, QuiltPdfButtons } from './kit-checkout.jsx';
import {
  cloneQuiltShapes, COASTER_COUNT, CoasterTabs, isCoasterSize, quiltAddVisibleArea,
  quiltOverlapCells, seedCoasterUnits,
} from './design-model.jsx';
import {
  IcArrowL, IcCheck, IcCopy, IcCursor, IcDrop, IcHand, IcHelp, IcPlus, IcRedo, IcSave, IcSaved,
  IcSquare, IcTrash, IcTri, IcUndo, IcX, MetimeLogo,
} from './icons.jsx';
import {
  calcBacking, calcBinding, calcYardage, fmtY, MAX, PRESETS, QUILT_PATTERNS, resolvePalette, SEAM,
  SUGGESTED_PALETTES, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP,
} from './catalog.jsx';
import { GridCanvas, QuiltOverlay } from './quilt-canvas.jsx';
import {
  EdGuideFooter, EdHintBubble, EdMenu, EdNav, EdNavIcon, EdPaletteStarters, EdPanel, EdRow,
  EdSheet, EdSlider, EdStatCards, EdSwatch, edSwatchStyle, EdTipsSwitch, EdTools,
  EdZoomControls, EdZoomPill, LibraryPopover, Popover, quiltColorKey, Switch, useEdGuide,
  useIsMobile, useShowTips,
} from './editor-ui.jsx';
import { AccountChip, AccountsOfflineNote } from './account.jsx';
import { QUILT_TEMPLATES } from './templates.jsx';
import {
  BackingPickerOverlay, FabricEnlargeOverlay, fabricFullSrc, QuiltTemplateThumb,
} from './studio-shared.jsx';
import { studioCovered } from './kit-review.jsx';

// ── Quilt studio: tools + panels ──────────────────────────────────────────
// `hint(verb)` gets 'Tap' or 'Click' so the line reads right on each device.
const QUILT_TOOLS = [
  { id: 'select', label: 'Select', key: 'V', Ic: IcCursor, hint: v => `${v} a patch to select it · drag to select several` },
  { id: 'pan', label: 'Move canvas', key: 'H', Ic: IcHand, hint: () => 'Drag to move around · pinch to zoom' },
  { id: 'paint', label: 'Patch', key: 'P', Ic: IcSquare, hint: v => `Drag to add a patch · ${v.toLowerCase()} a patch to recolor it` },
  { id: 'hst', label: 'Triangle', key: 'T', Ic: IcTri, hint: v => `${v} a block to add a triangle · ${v.toLowerCase()} again to turn it` },
  { id: 'replace', label: 'Replace', key: 'R', Ic: IcDrop, hint: v => `${v} a patch to swap that fabric everywhere` },
];
const QUILT_PAINT_TOOLS = new Set(['paint', 'hst', 'replace']);

const QUILT_THREADS = [
  { name: 'White', hex: '#FFFFFF' },
  { name: 'Natural', hex: '#E8DCC0' },
  { name: 'Gold', hex: '#C9A24B' },
  { name: 'Charcoal', hex: '#343434' },
];

// The guided setup: the studio opens on Size and walks the panels in this order.
const QUILT_GUIDE = [
  { id: 'size', title: 'Choose a size', next: 'Next: Template' },
  { id: 'templates', title: 'Pick a starting layout', next: 'Next: Fabrics' },
  { id: 'fabrics', title: 'Choose your fabrics', next: 'Next: Quilting' },
  { id: 'quilting', title: 'Choose your quilting', next: 'Start designing' },
];
const STARTER_PALETTES = SUGGESTED_PALETTES.map(p => ({ name: p.name, colors: resolvePalette(p) }));

function QuiltTemplatesPanel({ templates, palette, dims, isCoaster, onApply }) {
  const thumbRows = Math.max(4, Math.round(12 * (dims.h / dims.w)));
  return (
    <>
      <p className="ed-intro">
        {isCoaster ? 'Lays a layout on this coaster' : 'Lays a layout over your quilt'} in your palette's fabrics. Undo puts your design back.
      </p>
      <div className="ed-tiles">
        <button type="button" className="ed-tile" data-ed-template="blank" onClick={() => onApply(null)} title="Start from an empty canvas">
          <span className="ed-tile-thumb ed-tile-blank" style={{ aspectRatio: `12 / ${thumbRows}` }}/>
          <span className="ed-tile-name">Blank</span>
        </button>
        {templates.map(t => (
          <button key={t.id} type="button" className="ed-tile" data-ed-template={t.id} title={t.desc} onClick={() => onApply(t)}>
            <span className="ed-tile-thumb"><QuiltTemplateThumb tpl={t} preset={dims} palette={palette}/></span>
            <span className="ed-tile-name">{t.name}</span>
          </button>
        ))}
      </div>
    </>
  );
}

// Largest palette a quilt kit can hold. Infinity means no cap yet.
const MAX_PALETTE_FABRICS = Infinity;

// One fabric in "Your fabrics": tapping the row picks it (see pickColor), the
// ⋯ menu holds the actions that touch the whole quilt.
function QuiltFabricRow({ row, active, onPick, onSwap, onSelectAll, onRemove }) {
  const { fabric, count, strips, yards } = row;
  const [menuOpen, setMenuOpen] = useState(false);
  const moreRef = useRef(null);
  const rowRef = useRef(null);
  const used = count > 0;
  const items = [
    { id: 'swap', label: 'Swap for another fabric…', onClick: () => onSwap(fabric, rowRef.current) },
    { id: 'select', label: 'Select all patches', disabled: !used, onClick: () => onSelectAll(fabric) },
    { id: 'remove', label: 'Remove from kit', disabled: used, meta: used ? 'Swap it first' : null, onClick: () => onRemove(fabric) },
  ];
  return (
    <div ref={rowRef} className={`ed-fab-row${active ? ' is-active' : ''}${used ? '' : ' is-unused'}${menuOpen ? ' is-menu' : ''}`} data-ed-fabric={fabric.name}>
      <button type="button" className="ed-row" aria-pressed={active} onClick={() => onPick(fabric)}>
        <span className="ed-row-sw" style={edSwatchStyle(fabric)}/>
        <span className="ed-row-main">
          <span className="ed-row-title">{fabric.name}</span>
          <span className="ed-row-sub">
            {used ? `${count} pcs · ${strips} strip${strips !== 1 ? 's' : ''}` : 'In your kit · not used yet'}
          </span>
        </span>
        <span className="ed-row-value">{fmtY(yards)}</span>
      </button>
      <button ref={moreRef} type="button" className="icon-btn ed-fab-more" aria-haspopup="menu" aria-expanded={menuOpen}
        title={`More for ${fabric.name}`} aria-label={`More for ${fabric.name}`} onClick={() => setMenuOpen(v => !v)}>
        <span className="ed-more-dots" aria-hidden="true"><span/><span/><span/></span>
      </button>
      {menuOpen && createPortal(
        <Popover anchorRef={moreRef} onClose={() => setMenuOpen(false)} placement="bottom-end" width={232}>
          <div className="studio-menu ed-fab-menu" role="menu">
            {items.map(it => (
              <button key={it.id} type="button" className="studio-menu-item" role="menuitem" disabled={it.disabled}
                onClick={() => { setMenuOpen(false); it.onClick(); }}>
                <span className="studio-menu-label">{it.label}</span>
                {it.meta && <span className="studio-menu-meta">{it.meta}</span>}
              </button>
            ))}
          </div>
        </Popover>,
        moreRef.current?.closest('.ed-app') || document.body)}
    </div>
  );
}

function QuiltFabricsPanel({ rows, yards, isActive, onPick, onAdd, canAdd, onSwap, onSelectAll, onRemove,
  backing, backCalc, onBacking, onBackingView, binding, bindCalc, onBinding, stacked, starters = null }) {
  const bindRef = useRef(null);
  const addRef = useRef(null);
  return (
    <>
      {starters}
      <div className="ed-label">
        <span>Your fabrics</span>
        {yards > 0 && <span style={{ fontFamily: 'var(--font-sans)', fontSize: 11 }}>{fmtY(yards)}</span>}
      </div>
      <div className="ed-list is-plain ed-fab-list ed-keep-sel">
        {rows.map(row => (
          <QuiltFabricRow key={quiltColorKey(row.fabric)} row={row} active={isActive(row.fabric)}
            onPick={onPick} onSwap={onSwap} onSelectAll={onSelectAll} onRemove={onRemove}/>
        ))}
        <div className="ed-fab-row">
          <button ref={addRef} type="button" className="ed-row ed-fab-add" disabled={!canAdd}
            onClick={() => onAdd(addRef)}>
            <span className="ed-row-sw is-empty"><IcPlus/></span>
            <span className="ed-row-main">
              <span className="ed-row-title">Add fabric</span>
              {!canAdd && <span className="ed-row-sub">Your kit holds up to {MAX_PALETTE_FABRICS} fabrics</span>}
            </span>
          </button>
        </div>
      </div>

      <div className="ed-hr"/>
      <div className="ed-label">Backing &amp; binding</div>
      <div className="ed-list is-plain">
        <EdRow swatch={backing} title="Backing" name={backing?.name}
          sub={backing ? `${backCalc.backingW}" × ${backCalc.backingH}" · ${backCalc.widths} width${backCalc.widths !== 1 ? 's' : ''}` : 'Choose the fabric for the back'}
          value={backing ? fmtY(backCalc.yards) : null} action={backing ? null : 'Choose'}
          onClick={onBacking} onSwatchClick={onBackingView}/>
        <EdRow ref={bindRef} swatch={binding} title="Binding" name={binding?.name}
          sub={binding ? `${bindCalc.strips} strips · ${bindCalc.perimeter}" around` : 'Optional · finishes the edge'}
          value={binding ? fmtY(bindCalc.yards) : null} action={binding ? null : 'Add'}
          onClick={() => onBinding(bindRef)}/>
      </div>
      <p className="ed-note">
        {stacked > 0 && <>Stacked patches are hatched on the canvas and left out of the cut list. </>}
        Assumes 40" WOF, ¼" seam allowance. Backing adds 4" per side. Binding: 2.5" double-fold strips. Add 10 to 15% for shrinkage.
      </p>
    </>
  );
}

function QuiltQuiltingPanel({ qPattern, setQPattern, qSpacing, setQSpacing, qColor, setQColor, onMoreThread, showQ, setShowQ }) {
  const moreRef = useRef(null);
  const showSpacing = qPattern !== 'none' && qPattern !== 'ditch';
  const customThread = qColor && !QUILT_THREADS.some(t => t.name === qColor.name) ? qColor : null;
  return (
    <>
      <div className="ed-label">Pattern</div>
      <div className="ed-tiles ed-pattern-tiles">
        {QUILT_PATTERNS.map(p => (
          <button key={p.id} type="button" className={`ed-tile${qPattern === p.id ? ' is-active' : ''}`}
            aria-pressed={qPattern === p.id} data-ed-pattern={p.id}
            onClick={() => { setQPattern(p.id); if (p.id !== 'none') setShowQ(true); }}>
            <span className="ed-tile-thumb" style={{ position: 'relative', aspectRatio: '1', background: 'var(--metime-white)' }}>
              <svg viewBox="0 0 4 4" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
                {[1, 2, 3].map(i => (
                  <g key={i} stroke="rgba(23,23,23,0.08)" strokeWidth="1" vectorEffect="non-scaling-stroke">
                    <line x1={i} y1={0} x2={i} y2={4} vectorEffect="non-scaling-stroke"/>
                    <line x1={0} y1={i} x2={4} y2={i} vectorEffect="non-scaling-stroke"/>
                  </g>
                ))}
              </svg>
              <QuiltOverlay cols={4} rows={4} pattern={p.id} spacing={1} color="#171717"/>
            </span>
            <span className="ed-tile-name">{p.label}</span>
          </button>
        ))}
      </div>
      {showSpacing && (
        <EdSlider label="Spacing" value={qSpacing} min={1} max={8} onChange={setQSpacing}
          display={`Every ${qSpacing} block${qSpacing !== 1 ? 's' : ''}`}/>
      )}
      <div className="ed-label" style={{ marginTop: 22 }}>
        <span>Thread</span>
        <span style={{ color: 'var(--warm-fg)' }}>{qColor?.name}</span>
      </div>
      <div className="ed-threads">
        {QUILT_THREADS.map(t => (
          <EdSwatch key={t.name} color={t} active={qColor?.name === t.name} onClick={() => setQColor(t)}/>
        ))}
        {customThread && <EdSwatch color={customThread} active onClick={() => {}}/>}
        <button ref={moreRef} type="button" className="ed-link" onClick={() => onMoreThread(moreRef)}>More colors</button>
      </div>
      <div className="ed-toggle-row">
        <span>Show on quilt</span>
        <Switch checked={showQ} onChange={setShowQ} title={showQ ? 'Hide the quilting lines' : 'Show the quilting lines'}/>
      </div>
    </>
  );
}

function QuiltSizePanel({ preset, onPreset, bs, minBs, maxBs, onBs, cols, rows, fw, fh }) {
  return (
    <>
      <div className="ed-label">Finished size</div>
      <div className="ed-choices">
        {PRESETS.map(p => (
          <button key={p.name} type="button" className={`ed-choice${preset === p.name ? ' is-active' : ''}`}
            aria-pressed={preset === p.name} data-ed-size={p.name} onClick={() => onPreset(p.name)}>
            <span className="ed-choice-name">{p.label || p.name}</span>
            <span className="ed-choice-sub">{p.w}" × {p.h}"{p.note ? ` · ${p.note}` : ''}</span>
          </button>
        ))}
      </div>
      <EdSlider label="Block size" value={bs} display={`${bs}"`} min={minBs} max={maxBs} onChange={onBs}/>
      <EdStatCards items={[
        { k: 'Cut', v: `${bs + SEAM}"` },
        { k: 'Blocks', v: `${cols} × ${rows}` },
        { k: 'Finished', v: `${fw}" × ${fh}"` },
      ]}/>
      <p className="ed-note">Bigger blocks mean fewer, larger patches. Each block is cut {bs + SEAM}" square and finishes at {bs}" once sewn.</p>
    </>
  );
}

function QuiltHelpPanel({ isMobile, showTips, setShowTips }) {
  const v = isMobile ? 'Tap' : 'Click';
  const tips = [
    { Ic: IcSquare, t: 'Patch', k: 'P', d: `Drag across empty blocks to add a patch. ${v} or drag over patches to recolor them.` },
    { Ic: IcTri, t: 'Triangle', k: 'T', d: `${v} a block to split it into a half-square triangle. ${v} it again to turn it.` },
    { Ic: IcDrop, t: 'Replace', k: 'R', d: `${v} a patch to swap that fabric for your current one everywhere it's used.` },
    { Ic: IcCursor, t: 'Select', k: 'V', d: isMobile
      ? 'Tap a patch to select it, then drag to move it or pull a handle to resize it.'
      : 'Click to select, drag to box-select, Shift-click to add. Drag handles to resize, arrow keys nudge, Delete removes.' },
    { Ic: IcHand, t: 'Move canvas', k: 'H', d: isMobile ? 'Drag to look around. Pinch to zoom.' : 'Drag to look around. Pinch or ⌘-scroll to zoom.' },
    { Ic: IcUndo, t: 'Undo & redo', k: '⌘Z', d: 'Every change can be undone, including templates and clearing.' },
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

// ── App ───────────────────────────────────────────────────────────────────
function quiltGridForPreset(p, preferredBs = 3) {
  const minBs = p.name === 'Coaster' ? 1 : 2;
  const maxBs = Math.max(minBs, Math.min(12, Math.floor(Math.min(p.w, p.h) / 2)));
  let bs = Math.max(minBs, Math.min(maxBs, preferredBs));
  const finishedW = Math.min(MAX, Math.max(2, Math.round(p.w / bs))) * bs;
  const finishedH = Math.min(MAX, Math.max(2, Math.round(p.h / bs))) * bs;
  // Coasters are 5" square. A 2" block cannot hit that size (3 × 2" = 6"),
  // so pick a block size that keeps the finished quilt at the advertised inches.
  if (finishedW !== p.w || finishedH !== p.h) {
    for (let v = minBs; v <= maxBs; v++) {
      if (p.w % v === 0 && p.h % v === 0) { bs = v; break; }
    }
  }
  return {
    bs,
    cols: Math.min(MAX, Math.max(2, Math.round(p.w / bs))),
    rows: Math.min(MAX, Math.max(2, Math.round(p.h / bs))),
  };
}

// `guided` is how a new quilt starts: the studio opens straight onto the Size
// panel and steps through QUILT_GUIDE before handing over to free editing. A
// saved quilt opens without it, straight into editing.
export function App({ initialPreset = "Throw", initialPalette = null, initialQuilt = null, guided = false, onBack, onReview = null }) {
  const _initP = PRESETS.find(x => x.name === initialPreset) || PRESETS.find(x => x.name === "Throw") || PRESETS[0];
  const _initGrid = quiltGridForPreset(_initP, 3);
  const _initBs = _initGrid.bs;
  const _initCols = _initGrid.cols;
  const _initRows = _initGrid.rows;
  const [cols, setCols] = useState(_initCols);
  const [rows, setRows] = useState(_initRows);
  const [bs, setBs] = useState(_initBs);
  const isMobile = useIsMobile();
  // The open panel: 'templates' | 'fabrics' | 'quilting' | 'size' | 'help', or
  // on mobile also 'menu'. null means none — on mobile, the tools tray.
  const [panel, setPanel] = useState(() => {
    if (guided) return QUILT_GUIDE[0].id;
    return (typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches) ? null : 'fabrics';
  });
  const guideCtl = useEdGuide({ steps: QUILT_GUIDE, enabled: guided, panel, setPanel });
  const guide = guideCtl.on;
  const wasMobileRef = useRef(isMobile);
  useEffect(() => {
    if (wasMobileRef.current === isMobile) return;
    wasMobileRef.current = isMobile;
    if (guide) return;
    setPanel(isMobile ? null : 'fabrics');
  }, [isMobile]);
  const togglePanel = useCallback(id => {
    guideCtl.cancel();
    setPanel(p => p === id ? null : id);
  }, [guideCtl.cancel]);
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);
  const showToast = useCallback(msg => {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 2200);
  }, []);
  const coasterUnitsRef = useRef(null);
  const undoStacksRef = useRef(Array.from({ length: COASTER_COUNT }, () => []));
  const [activeCoaster, setActiveCoaster] = useState(0);
  const [coasterRev, setCoasterRev] = useState(0);
  const activeCoasterRef = useRef(0);
  activeCoasterRef.current = activeCoaster;
  const [shapes, _setShapes] = useState(() => {
    if (!initialQuilt && isCoasterSize(initialPreset)) {
      const units = seedCoasterUnits([]);
      coasterUnitsRef.current = units;
      return units[0];
    }
    return [];
  });
  const shapesRef = useRef(shapes);
  shapesRef.current = shapes;
  // Undo steps are usually the previous shapes array. Fabric actions that also
  // change the palette (or every coaster in a set) push a `{ shapes, pinned,
  // units }` snapshot instead, so they undo in one go too.
  const historyRef = useRef([]);
  const futureRef = useRef([]);
  // `{ merge: true }` folds this update into the previous undo step, so one
  // drag across the canvas undoes in one go.
  const setShapes = useCallback((updater, opts) => {
    _setShapes(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (next === prev) return prev;
      if (!(opts && opts.merge) || historyRef.current.length === 0) {
        historyRef.current.push(prev);
        if (historyRef.current.length > 100) historyRef.current.shift();
      }
      futureRef.current = [];
      return next;
    });
  }, []);
  const snapshotStep = () => ({
    shapes: shapesRef.current, pinned: pinnedRef.current, color: colorRef.current,
    units: coasterUnitsRef.current ? coasterUnitsRef.current.slice() : null,
  });
  const pushStep = useCallback(() => {
    historyRef.current.push(snapshotStep());
    if (historyRef.current.length > 100) historyRef.current.shift();
    futureRef.current = [];
  }, []);
  // Moves one step from `from` to `to`, leaving the current state behind in `to`.
  const stepHistory = (from, to) => {
    if (from.current.length === 0) return;
    const step = from.current.pop();
    if (Array.isArray(step)) {
      _setShapes(cur => { to.current.push(cur); return step; });
    } else {
      to.current.push(snapshotStep());
      _setShapes(step.shapes);
      setPinned(step.pinned);
      if (step.color) setColor(step.color);
      if (step.units && coasterUnitsRef.current) {
        coasterUnitsRef.current = step.units.slice();
        setCoasterRev(n => n + 1);
      }
    }
    setSelIds(new Set());
  };
  const undo = useCallback(() => stepHistory(historyRef, futureRef), []);
  const redo = useCallback(() => stepHistory(futureRef, historyRef), []);
  const [selIds, setSelIds] = useState(new Set());
  const [color, setColor] = useState(
    (initialPalette && initialPalette[0]) || KONA.find(c=>c.name==="Navy") || KONA[0]
  );
  const [tool, setTool] = useState("paint");
  const [search, setSearch] = useState("");
  const [grp, setGrp] = useState("All");
  const [customs, setCustoms] = useState([]);
  const [pinned, setPinned] = useState(
    (initialPalette && initialPalette.length) ? initialPalette : [
      KONA.find(c=>c.name==="White"), KONA.find(c=>c.name==="Black"),
      KONA.find(c=>c.name==="Natural"), KONA.find(c=>c.name==="Navy"),
      KONA.find(c=>c.name==="Rich Red"), KONA.find(c=>c.name==="Mustard"),
    ].filter(Boolean)
  );
  const pinnedRef = useRef(pinned);
  pinnedRef.current = pinned;
  const colorRef = useRef(color);
  colorRef.current = color;
  // The last template laid and the exact shapes it produced. While the canvas is
  // still those shapes, the guided setup can lay it again in a new size or
  // palette. `all`: it filled every coaster in a set, not just the active one.
  const templateRef = useRef(null);
  const templateFresh = () => !!templateRef.current && shapesRef.current === templateRef.current.shapes;
  const layTemplate = (tpl, { all, palette, cols, rows }) => {
    const built = tpl ? tpl.build({ cols, rows, palette }) : [];
    templateRef.current = tpl ? { tpl, shapes: built, all } : null;
    if (all && coasterUnitsRef.current) {
      const active = activeCoasterRef.current;
      coasterUnitsRef.current = coasterUnitsRef.current.map((_, i) => i === active ? built : cloneQuiltShapes(built));
      setCoasterRev(n => n + 1);
    }
    return built;
  };
  const [preset, setPreset] = useState(initialPreset);
  const [backing, setBacking] = useState(null);
  const [binding, setBinding] = useState(null);
  const [qPattern, setQPattern] = useState("none");
  const [qSpacing, setQSpacing] = useState(2);
  const [qColor, setQColor] = useState({ name:"White", hex:"#fff" });
  const [showQ, setShowQ] = useState(true);
  const [confirmClear, setConfirmClear] = useState(false);
  const auth = useAuth();
  const user = auth && auth.user;
  const cloudEnabled = !!(auth && auth.cloudEnabled);
  const cloudBlocked = !!(auth && auth.cloudBlocked);
  // The drawer is live while signed in — or always, when Supabase isn't
  // configured and there is no account to gate on.
  const libraryOn = !!(auth && auth.libraryOn);
  const [savedQuilts, setSavedQuilts] = useState([]);
  const [saveError, setSaveError] = useState("");
  const quiltCacheReady = useRef(false);
  // Cache on this device only while the drawer is live so a signed-out empty
  // list cannot wipe someone else's library.
  useEffect(() => {
    if (!libraryOn || !quiltCacheReady.current) return;
    const ok = persistSavedQuilts(savedQuilts);
    setSaveError(ok ? "" : "Couldn't save. This device's storage may be full.");
  }, [savedQuilts, libraryOn]);
  useEffect(() => {
    if (!libraryOn) { quiltCacheReady.current = false; setSavedQuilts([]); return; }
    setSavedQuilts(loadSavedQuilts());
    quiltCacheReady.current = true;
  }, [libraryOn, auth && auth.libraryTick]);
  useEffect(() => {
    if (!auth || !auth.lastSaved || auth.lastSaved.type !== "quilt") return;
    setCurrentQuiltId(auth.lastSaved.record.id);
    flashSaved();
    auth.consumeLastSaved();
  }, [auth && auth.lastSaved]);
  const [showSave, setShowSave] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [viewQuilt, setViewQuilt] = useState(null);
  const [showMyQuilts, setShowMyQuilts] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [showBackingPicker, setShowBackingPicker] = useState(false);
  const [inspectBacking, setInspectBacking] = useState(null);
  // Id of the saved quilt currently open on the canvas (null for an unsaved
  // design). Lets "Save" update in place instead of spawning a duplicate.
  const [currentQuiltId, setCurrentQuiltId] = useState(null);
  const [justSaved, setJustSaved] = useState(false);
  const savedFlashRef = useRef(null);
  const flashSaved = useCallback(() => {
    setJustSaved(true);
    if (savedFlashRef.current) clearTimeout(savedFlashRef.current);
    savedFlashRef.current = setTimeout(() => setJustSaved(false), 1600);
  }, []);
  const currentQuilt = savedQuilts.find(q => q.id === currentQuiltId) || null;
  // Snapshot every piece of editor state we persist. `id`/`name` are supplied
  // by the caller so the same builder serves both "save new" and "update".
  const buildQuiltRecord = (id, name) => {
    const record = {
      id, name, shapes: [...shapes], cols, rows, bs, preset, backing, binding, pinned: [...pinned],
      qPattern, qSpacing, qColor, showQ, materials: { ...materials }, fw, fh, backCalc, bindCalc, grandTotal,
      updatedAt: Date.now(),
    };
    if (isCoasterSize(preset) && coasterUnitsRef.current) {
      coasterUnitsRef.current[activeCoaster] = shapes;
      record.units = coasterUnitsRef.current.map(s => ({ shapes: s }));
      record.activeUnit = activeCoaster;
    }
    return record;
  };
  // Writes the design to the account, then to this device. With Supabase
  // unconfigured the cloud leg is skipped and the save is local-only, which is
  // how the studio worked before accounts existed.
  const commitQuiltSave = async (record, isNew) => {
    const store = (apiId) => {
      const saved = apiId ? { ...record, apiId } : record;
      setSavedQuilts(p => isNew ? [saved, ...p] : p.map(x => x.id === record.id ? saved : x));
      if (isNew) setCurrentQuiltId(saved.id);
      flashSaved();
    };
    if (!cloudEnabled) {
      store(null);
      setSaveError(cloudBlocked ? ACCOUNTS_OFFLINE_SAVE_MSG : "");
      return;
    }
    try {
      store(await upsertCloudDesign("quilt", record));
      setSaveError("");
    } catch (e) {
      console.warn("Quilt cloud save failed:", e);
      setSaveError("Couldn't save to your account. Check your connection and try again.");
    }
  };
  const saveNewQuilt = () => {
    const name = saveName.trim(); if (!name) return;
    const id = Date.now();
    const record = buildQuiltRecord(id, name);
    setShowSave(false); setSaveName("");
    // Save is the only account wall: designing, resizing, PDFs, and kit checkout
    // all work without one.
    if (cloudEnabled && !user) {
      stashPendingSave({ type: "quilt", record, mode: "new" });
      auth.openAuth();
      return;
    }
    commitQuiltSave(record, true);
  };
  const updateCurrentQuilt = () => {
    if (currentQuiltId == null) return;
    const record = buildQuiltRecord(currentQuiltId, (currentQuilt && currentQuilt.name) || "Untitled");
    if (currentQuilt && currentQuilt.apiId) record.apiId = currentQuilt.apiId;
    if (cloudEnabled && !user) {
      stashPendingSave({ type: "quilt", record, mode: "update" });
      auth.openAuth();
      return;
    }
    commitQuiltSave(record, false);
  };

  // Restore a saved quilt back onto the editor canvas. Rebuilds every piece of
  // editor state we persisted so the design opens exactly as it was saved.
  const loadQuilt = useCallback((q) => {
    if (!q) return;
    setCurrentQuiltId(q.id ?? null);
    historyRef.current = [];
    futureRef.current = [];
    undoStacksRef.current = Array.from({ length: COASTER_COUNT }, () => []);
    setSelIds(new Set());
    if (typeof q.cols === 'number') setCols(q.cols);
    if (typeof q.rows === 'number') setRows(q.rows);
    if (typeof q.bs === 'number') setBs(q.bs);
    if (q.preset) setPreset(q.preset);
    if (isCoasterSize(q.preset || '')) {
      const units = (Array.isArray(q.units) && q.units.length === COASTER_COUNT)
        ? q.units.map(u => Array.isArray(u.shapes) ? u.shapes : [])
        : seedCoasterUnits(Array.isArray(q.shapes) ? q.shapes : []);
      coasterUnitsRef.current = units;
      const idx = Math.min(COASTER_COUNT - 1, Math.max(0, q.activeUnit || 0));
      setActiveCoaster(idx);
      activeCoasterRef.current = idx;
      _setShapes(units[idx]);
    } else {
      coasterUnitsRef.current = null;
      setActiveCoaster(0);
      activeCoasterRef.current = 0;
      _setShapes(Array.isArray(q.shapes) ? q.shapes : []);
    }
    setBacking(q.backing || null);
    setBinding(q.binding || null);
    // Palette: prefer the saved "My palette", else rebuild it from the colors
    // actually used in the design (covers quilts saved before palette storage).
    let pal = Array.isArray(q.pinned) ? q.pinned.filter(Boolean) : [];
    if (!pal.length && Array.isArray(q.shapes)) {
      const seen = new Set();
      pal = [];
      for (const s of q.shapes) {
        if (s && s.color && s.color.hex && !seen.has(s.color.hex)) {
          seen.add(s.color.hex);
          pal.push(s.color);
        }
      }
    }
    if (pal.length) setPinned(pal);
    if (q.qPattern) setQPattern(q.qPattern);
    if (typeof q.qSpacing === 'number') setQSpacing(q.qSpacing);
    if (q.qColor) setQColor(q.qColor);
    if (typeof q.showQ === 'boolean') setShowQ(q.showQ);
    setViewQuilt(null);
    setShowMyQuilts(false);
    setConfirmDeleteId(null);
  }, []);
  // When launched from the landing page's saved list, drop that quilt onto the
  // canvas immediately.
  useEffect(() => { if (initialQuilt) loadQuilt(initialQuilt); }, []);
  // The library popover doubles as a fabric picker. `picker` is null when
  // closed, otherwise an object describing the active picker config:
  //   { onPick?, onClear?, showMyPalette?, title?, placement? }
  // (Empty object => default paint behaviour from the My palette + button.)
  const [picker, setPicker] = useState(null);
  const libraryAnchorRef = useRef(null);

  const openLibrary = useCallback((anchorRef, placement) => {
    if (anchorRef && anchorRef.current) libraryAnchorRef.current = anchorRef.current;
    setPicker({ placement });
  }, []);

  // Generic "color picker" popover with the My palette section pinned at the
  // top. Used for fabrics (backing/binding) and the thread color.
  const openColorPicker = useCallback((anchorRef, onPick, onClear, title) => {
    if (anchorRef && anchorRef.current) libraryAnchorRef.current = anchorRef.current;
    setPicker({ onPick, onClear, showMyPalette: true, title });
  }, []);

  const closePicker = useCallback(() => setPicker(null), []);

  // Replace every patch of one fabric with another, across every coaster in a
  // set, as one undo step. `swapInPalette` also puts the new fabric in the old
  // one's place in the palette (the row menu's Swap); the Replace tool leaves
  // the old fabric in the palette.
  const recolorAllMatching = useCallback((fromColor, toColor, { swapInPalette = false } = {}) => {
    if (!fromColor || !toColor || quiltColorKey(fromColor) === quiltColorKey(toColor)) return;
    const matches = c => c && quiltColorKey(c) === quiltColorKey(fromColor);
    const recolor = list => list.map(s => matches(s.color) ? { ...s, color: toColor } : s);
    pushStep();
    _setShapes(prev => recolor(prev));
    if (coasterUnitsRef.current) {
      let changed = false;
      coasterUnitsRef.current = coasterUnitsRef.current.map((u, i) => {
        if (i === activeCoaster) return u;
        const next = recolor(u);
        if (next.some((s, j) => s !== u[j])) changed = true;
        return next;
      });
      if (changed) setCoasterRev(n => n + 1);
    }
    setColor(c => matches(c) ? toColor : c);
    setPinned(p => {
      const has = p.some(x => quiltColorKey(x) === quiltColorKey(toColor));
      const at = swapInPalette ? p.findIndex(matches) : -1;
      if (at < 0) return has ? p : [...p, toColor];
      return has ? p.filter((_, j) => j !== at) : p.map((x, j) => j === at ? toColor : x);
    });
  }, [pushStep, activeCoaster]);

  const openFabricSwap = useCallback((fabric, el) => {
    if (el) libraryAnchorRef.current = el;
    setPicker({
      onPick: c => {
        if (quiltColorKey(c) === quiltColorKey(fabric)) return;
        recolorAllMatching(fabric, c, { swapInPalette: true });
        showToast(`Swapped ${fabric.name} for ${c.name}`);
      },
      showMyPalette: true,
      title: `Swap ${fabric.name} for…`,
      fromColor: fabric,
    });
  }, [recolorAllMatching, showToast]);

  const removeFromKit = useCallback(fabric => {
    const key = quiltColorKey(fabric);
    const rest = pinnedRef.current.filter(x => quiltColorKey(x) !== key);
    pushStep();
    setPinned(rest);
    setColor(c => quiltColorKey(c) === key && rest.length ? rest[0] : c);
    showToast(`Removed ${fabric.name} from your kit`);
  }, [pushStep, showToast]);

  // Selection only lives under the Select tool, so switch to it first.
  const selectAllOfFabric = useCallback(fabric => {
    const key = quiltColorKey(fabric);
    const ids = new Set(shapesRef.current.filter(s => quiltColorKey(s.color) === key).map(s => s.id));
    if (!ids.size) return;
    setTool('select');
    setSelIds(ids);
    if (isMobile) setPanel(null);
  }, [isMobile]);

  const handleSwapTriColors = useCallback(() => {
    const sel = shapes.filter(s => selIds.has(s.id));
    const pids = new Set();
    for (const s of sel) if (s.pairId) pids.add(s.pairId);
    if (pids.size === 0) return;
    const colorByPair = new Map();
    for (const s of shapes) if (s.pairId && pids.has(s.pairId)) {
      if (!colorByPair.has(s.pairId)) colorByPair.set(s.pairId, {});
      colorByPair.get(s.pairId)[s.half] = s.color;
    }
    setShapes(p => p.map(s => {
      if (!s.pairId || !pids.has(s.pairId)) return s;
      const c = colorByPair.get(s.pairId);
      return { ...s, color: s.half === 'a' ? c.b : c.a };
    }));
  }, [shapes, selIds, setShapes]);

  const swapDisabled = useMemo(() => {
    if (selIds.size === 0) return true;
    return !shapes.some(s => selIds.has(s.id) && s.type === 'tri' && s.pairId);
  }, [shapes, selIds]);

  useEffect(() => {
    const handleKey = e => {
      if (studioCovered()) return;
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const k = e.key.toLowerCase();
      if (e.metaKey || e.ctrlKey) {
        if (k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
        else if (k === 'y') { e.preventDefault(); redo(); }
        return;
      }
      if (e.altKey || document.querySelector('.overlay, .bottom-sheet')) return;
      const t = QUILT_TOOLS.find(x => x.key.toLowerCase() === k);
      if (t) { e.preventDefault(); setTool(t.id); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [undo, redo]);

  // Only the Select tool keeps a selection; the others act on tap.
  useEffect(() => { if (tool !== 'select') setSelIds(new Set()); }, [tool]);

  // Palette swatches set the working fabric and recolor any selection.
  const pickColor = useCallback(c => {
    setColor(c);
    if (selIds.size > 0) setShapes(p => p.map(s => selIds.has(s.id) ? { ...s, color: c } : s));
  }, [selIds, setShapes]);

  const replaceEverywhere = useCallback(from => {
    if (!from || !color) return;
    if (quiltColorKey(from) === quiltColorKey(color)) {
      showToast(`That patch is already ${color.name}. Pick another fabric first`);
      return;
    }
    recolorAllMatching(from, color);
    showToast(`Replaced ${from.name} with ${color.name}`);
  }, [color, recolorAllMatching, showToast]);

  const [zoom, setZoom] = useState(1);
  const adjustZoom = useCallback(delta => {
    setZoom(z => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, +(z + delta).toFixed(2))));
  }, []);
  const resetZoom = useCallback(() => setZoom(1), []);

  useEffect(() => {
    const onKey = e => {
      if (!(e.metaKey || e.ctrlKey) || studioCovered()) return;
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === '=' || e.key === '+') { e.preventDefault(); adjustZoom(+ZOOM_STEP); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); adjustZoom(-ZOOM_STEP); }
      else if (e.key === '0') { e.preventDefault(); resetZoom(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [adjustZoom, resetZoom]);

  // Dismiss the selection (and its floating toolbar) when the user mouses down
  // anywhere outside the canvas frame, the toolbar itself, popovers, or modals.
  useEffect(() => {
    if (selIds.size === 0) return undefined;
    const onDown = e => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest('.canvas-frame, .selection-toolbar, .popover, .popover-backdrop, .overlay, .ed-keep-sel, .bottom-sheet, .bottom-sheet-backdrop')) return;
      setSelIds(new Set());
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [selIds.size]);

  const allColors = useMemo(()=>[...customs,...KONA],[customs]);
  const filtered = useMemo(()=>{
    let l=allColors;
    if(grp!=="All") l=l.filter(c=>c.group===grp);
    if(search.trim()){const q=search.toLowerCase();l=l.filter(c=>c.name.toLowerCase().includes(q)||(c.code&&c.code.includes(q)));}
    return l;
  },[allColors,grp,search]);

  useEffect(()=>{
    const clamp = s => ({...s,r:Math.min(s.r,rows-1),c:Math.min(s.c,cols-1),h:Math.max(1,Math.min(s.h,rows-Math.min(s.r,rows-1))),w:Math.max(1,Math.min(s.w,cols-Math.min(s.c,cols-1)))});
    // Guided setup picks the size after the layout can be in place, so an
    // untouched template is laid again at the new size rather than cropped.
    const rebuild = guided && templateFresh() ? templateRef.current : null;
    if (coasterUnitsRef.current && !(rebuild && rebuild.all)) {
      const active = activeCoasterRef.current;
      coasterUnitsRef.current = coasterUnitsRef.current.map((u, i) => i === active ? u : u.map(clamp));
    }
    if (rebuild) setShapes(layTemplate(rebuild.tpl, { all: rebuild.all, palette: pinnedRef.current, cols, rows }));
    else setShapes(p=>p.map(clamp));
    setSelIds(new Set());
  },[rows,cols]);

  // Kit fabric multiplier: e.g. a Coaster kit ships 4 backing/binding panels.
  // Patch yardage for a set is the sum of the four designs, not 4× one design.
  const kitQty = (PRESETS.find(x=>x.name===preset)?.kitQty) || 1;
  const isCoasterKit = isCoasterSize(preset);

  const selectCoaster = (i) => {
    if (!coasterUnitsRef.current || i === activeCoaster) return;
    coasterUnitsRef.current[activeCoaster] = shapes;
    undoStacksRef.current[activeCoaster] = historyRef.current;
    setActiveCoaster(i);
    activeCoasterRef.current = i;
    historyRef.current = undoStacksRef.current[i] || [];
    futureRef.current = [];
    _setShapes(coasterUnitsRef.current[i]);
    setSelIds(new Set());
  };
  const copyCoasterToAll = () => {
    if (!coasterUnitsRef.current) return;
    coasterUnitsRef.current = coasterUnitsRef.current.map((_, i) =>
      i === activeCoaster ? shapes : cloneQuiltShapes(shapes));
    undoStacksRef.current = undoStacksRef.current.map((stack, i) => i === activeCoaster ? stack : []);
    setCoasterRev(n => n + 1);
  };

  const materials = useMemo(()=>{
    const map=new Map();
    const add=(col,amt)=>{if(!col)return;if(!map.has(col.name))map.set(col.name,{...col,count:0});map.get(col.name).count+=amt;};
    const units = (isCoasterKit && coasterUnitsRef.current)
      ? coasterUnitsRef.current.map((u, i) => i === activeCoaster ? shapes : u)
      : [shapes];
    // Only the quilt top counts — stacked area is taken from the piece you see.
    for (const u of units) quiltAddVisibleArea(u, add);
    const patchQty = isCoasterKit ? 1 : kitQty;
    const items=Array.from(map.values()).map(c=>({...c,...calcYardage(c.count,bs,patchQty)})).sort((a,b)=>b.count-a.count);
    const total=items.reduce((s,x)=>s+x.count,0);
    const possible = rows*cols*(isCoasterKit ? COASTER_COUNT : 1);
    const stacked = units.reduce((n, u) => n + quiltOverlapCells(u).length, 0);
    return{items,total,possible,yards:items.reduce((s,x)=>s+x.yards,0),stacked};
  },[shapes,bs,rows,cols,kitQty,isCoasterKit,activeCoaster,coasterRev]);

  const fw=cols*bs, fh=rows*bs;
  const backCalc=useMemo(()=>calcBacking(fw,fh,kitQty),[fw,fh,kitQty]);
  const bindCalc=useMemo(()=>calcBinding(fw,fh,kitQty),[fw,fh,kitQty]);
  const grandTotal=materials.yards+(backing?backCalc.yards:0)+(binding?bindCalc.yards:0);

  // "Your fabrics": every palette fabric (plus any fabric on the quilt that has
  // dropped out of the palette), most pieces first, unused ones last in
  // palette order. The selection toolbar shows the same list.
  const fabricRows = useMemo(() => {
    const used = new Map(materials.items.map(({ count, yards, cutSize, strips, ...fabric }) =>
      [quiltColorKey(fabric), { fabric, count, strips, yards }]));
    const seen = new Set();
    const rows = [];
    const add = (fabric, stats) => {
      const key = quiltColorKey(fabric);
      if (seen.has(key)) return;
      seen.add(key);
      rows.push(stats || used.get(key) || { fabric, count: 0, strips: 0, yards: 0 });
    };
    for (const c of pinned) if (c) add(c, used.has(quiltColorKey(c)) ? { ...used.get(quiltColorKey(c)), fabric: c } : null);
    for (const [, stats] of used) add(stats.fabric, stats);
    return rows.map((r, i) => [r, i]).sort((a, b) => b[0].count - a[0].count || a[1] - b[1]).map(([r]) => r);
  }, [pinned, materials.items]);
  const fabricOrder = useMemo(() => fabricRows.map(r => r.fabric), [fabricRows]);
  const canAddFabric = pinned.length < MAX_PALETTE_FABRICS;

  // Smallest allowed block size. Most quilts stop at 2" blocks, but Coasters
  // are small enough that 1" blocks are useful, so we relax the floor there.
  const minBsFor = name => (name === 'Coaster' ? 1 : 2);
  const minBs = useMemo(() => minBsFor(preset), [preset]);

  const maxBs = useMemo(() => {
    const p = PRESETS.find(x => x.name === preset);
    if (!p) return 12;
    return Math.max(minBs, Math.min(12, Math.floor(Math.min(p.w, p.h) / 2)));
  }, [preset, minBs]);

  const applyPreset = name => {
    const p = PRESETS.find(x => x.name === name);
    if (!p) return;
    if (isCoasterSize(name) && !coasterUnitsRef.current) {
      coasterUnitsRef.current = seedCoasterUnits(shapes);
      undoStacksRef.current = Array.from({ length: COASTER_COUNT }, () => []);
      historyRef.current = [];
      futureRef.current = [];
      setActiveCoaster(0);
      activeCoasterRef.current = 0;
    } else if (!isCoasterSize(name)) {
      if (coasterUnitsRef.current) coasterUnitsRef.current[activeCoaster] = shapes;
      coasterUnitsRef.current = null;
      setActiveCoaster(0);
      activeCoasterRef.current = 0;
    }
    setPreset(name);
    if (!p) return;
    const grid = quiltGridForPreset(p, bs);
    if (grid.bs !== bs) setBs(grid.bs);
    setCols(grid.cols);
    setRows(grid.rows);
  };

  const handleBsChange = newBs => {
    const v = Math.max(minBs, Math.min(maxBs, Math.round(newBs)));
    setBs(v);
    const p = PRESETS.find(x => x.name === preset);
    if (!p) return;
    setCols(Math.min(MAX, Math.max(2, Math.round(p.w / v))));
    setRows(Math.min(MAX, Math.max(2, Math.round(p.h / v))));
  };

  // Templates replace the canvas (the active coaster, for a set) and stay
  // undoable, so trying one costs nothing.
  // During the guided setup a coaster set takes the layout on every coaster.
  const applyTemplate = tpl => {
    const all = guide && !!coasterUnitsRef.current;
    if (all) pushStep();
    const built = layTemplate(tpl, { all, palette: pinned, cols, rows });
    if (all) _setShapes(built);
    else setShapes(built);
    setSelIds(new Set());
    showToast(tpl ? `${tpl.name} applied · undo to go back` : 'Canvas cleared · undo to go back');
    if (guide) guideCtl.advance('templates');
    else if (isMobile) setPanel(null);
  };

  // Guided setup's palette starters. An untouched template is laid again in the
  // new fabrics; anything else swaps fabric for fabric by palette position.
  const applyPalette = colors => {
    if (!colors || !colors.length) return;
    const t = templateFresh() ? templateRef.current : null;
    const map = new Map(pinnedRef.current.map((c, i) => [quiltColorKey(c), colors[i % colors.length]]));
    const remap = list => list.map(s => {
      const to = s.color && map.get(quiltColorKey(s.color));
      return to ? { ...s, color: to } : s;
    });
    pushStep();
    if (coasterUnitsRef.current && !(t && t.all)) {
      coasterUnitsRef.current = coasterUnitsRef.current.map((u, i) => i === activeCoaster ? u : remap(u));
      setCoasterRev(n => n + 1);
    }
    _setShapes(t ? layTemplate(t.tpl, { all: t.all, palette: colors, cols, rows }) : remap(shapesRef.current));
    setPinned(colors);
    setColor(colors[0]);
    setSelIds(new Set());
  };
  const activeStarter = useMemo(() => {
    const keys = pinned.map(quiltColorKey).join('|');
    const hit = STARTER_PALETTES.find(p => p.colors.map(quiltColorKey).join('|') === keys);
    return hit ? hit.name : null;
  }, [pinned]);

  const finishGuide = () => {
    guideCtl.end();
    setPanel(isMobile ? null : 'fabrics');
    setTool('paint');
    showToast('All set · happy quilting');
  };
  const guideStep = guideCtl.step;
  const guideFooter = guideStep >= 0 && (
    <EdGuideFooter steps={QUILT_GUIDE} step={guideStep}
      onBack={() => { guideCtl.cancel(); setPanel(QUILT_GUIDE[guideStep - 1].id); }}
      onNext={() => {
        guideCtl.cancel();
        if (guideStep < QUILT_GUIDE.length - 1) setPanel(QUILT_GUIDE[guideStep + 1].id);
        else finishGuide();
      }}/>
  );

  const toolDef = QUILT_TOOLS.find(t => t.id === tool) || QUILT_TOOLS[0];
  const toolHint = toolDef.hint(isMobile ? 'Tap' : 'Click');
  const [showTips, setShowTips] = useShowTips();
  const hintBubble = showTips && (
    <EdHintBubble text={toolHint} onHide={() => { setShowTips(false); showToast('Tips hidden. Turn them back on in Help.'); }}/>
  );
  const tools = QUILT_TOOLS.map(t => ({ ...t, icon: <t.Ic size={isMobile ? 20 : 18}/> }));
  const painting = QUILT_PAINT_TOOLS.has(tool);
  const isColorActive = c => !!color && color.name === c.name && color.hex === c.hex;
  const canUndo = historyRef.current.length > 0;
  const canRedo = futureRef.current.length > 0;
  const openSave = () => { setSaveName(''); setShowSave(true); };
  const openSaveAs = () => { setSaveName(((currentQuilt && currentQuilt.name) || '') + ' copy'); setShowSave(true); };
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

  const PANEL_TITLES = { templates: 'Templates', fabrics: 'Fabrics', quilting: 'Quilting', size: 'Size', help: 'Help', menu: 'More' };
  const panelTitle = guideStep >= 0 ? QUILT_GUIDE[guideStep].title : PANEL_TITLES[panel];
  const renderPanel = id => {
    if (id === 'templates') return (
      <QuiltTemplatesPanel templates={QUILT_TEMPLATES} palette={pinned} dims={{ w: fw, h: fh }}
        isCoaster={isCoasterKit} onApply={applyTemplate}/>
    );
    if (id === 'fabrics') return (
      <QuiltFabricsPanel rows={fabricRows} yards={materials.yards} isActive={isColorActive} onPick={pickColor}
        onAdd={ref => openLibrary(ref)} canAdd={canAddFabric}
        onSwap={openFabricSwap} onSelectAll={selectAllOfFabric} onRemove={removeFromKit}
        backing={backing} backCalc={backCalc} onBacking={() => setShowBackingPicker(true)}
        onBackingView={fabricFullSrc(backing) ? () => setInspectBacking(backing) : null}
        binding={binding} bindCalc={bindCalc}
        onBinding={ref => openColorPicker(ref, setBinding, binding ? () => setBinding(null) : null, 'Binding fabric')}
        stacked={materials.stacked}
        starters={guide ? <EdPaletteStarters palettes={STARTER_PALETTES} activeName={activeStarter} onApply={applyPalette}/> : null}/>
    );
    if (id === 'quilting') return (
      <QuiltQuiltingPanel qPattern={qPattern} setQPattern={setQPattern} qSpacing={qSpacing} setQSpacing={setQSpacing}
        qColor={qColor} setQColor={setQColor} showQ={showQ} setShowQ={setShowQ}
        onMoreThread={ref => openColorPicker(ref, setQColor, null, 'Thread color')}/>
    );
    if (id === 'size') return (
      <QuiltSizePanel preset={preset} bs={bs} minBs={minBs} maxBs={maxBs}
        onPreset={name => { applyPreset(name); if (guide) guideCtl.advance('size'); }}
        onBs={handleBsChange} cols={cols} rows={rows} fw={fw} fh={fh}/>
    );
    if (id === 'help') return <QuiltHelpPanel isMobile={isMobile} showTips={showTips} setShowTips={setShowTips}/>;
    if (id === 'menu') {
      const items = [
        ...(currentQuilt
          ? [{ id: 'save', label: justSaved ? 'Saved' : 'Save', icon: justSaved ? <IcCheck size={16}/> : <IcSave/>, onClick: updateCurrentQuilt },
             { id: 'save-as', label: 'Save as…', icon: <IcCopy size={16}/>, onClick: openSaveAs }]
          : [{ id: 'save', label: justSaved ? 'Saved' : 'Save quilt', icon: justSaved ? <IcCheck size={16}/> : <IcSave/>, onClick: openSave }]),
        ...(savedQuilts.length > 0
          ? [{ id: 'mine', label: 'My quilts', icon: <IcSaved size={18}/>, meta: savedQuilts.length, onClick: () => setShowMyQuilts(true) }]
          : []),
        { id: 'clear', label: isCoasterKit ? 'Clear this coaster' : 'Clear quilt', icon: <IcTrash size={16}/>,
          disabled: shapes.length === 0, onClick: () => setConfirmClear(true) },
        { id: 'help', label: 'Help', icon: <IcHelp size={16}/>, keepOpen: true, onClick: () => setPanel('help') },
      ];
      return <EdMenu items={items} onClose={() => setPanel(null)}/>;
    }
    return null;
  };

  // The Fabrics icon carries the current fabric, so the brush stays visible
  // while the panel is closed.
  const fabricsIcon = size => (
    <span className="ed-nav-badged">
      <EdNavIcon name="fabric" size={size}/>
      {color && <span className="ed-nav-badge" style={edSwatchStyle(color)} title={`Current fabric: ${color.name}`}/>}
    </span>
  );
  const railPanels = [
    { id: 'templates', label: 'Templates', icon: <EdNavIcon name="designs"/> },
    { id: 'fabrics', label: 'Fabrics', icon: fabricsIcon() },
    { id: 'quilting', label: 'Quilting', icon: <EdNavIcon name="quilting"/> },
    { id: 'size', label: 'Size', icon: <EdNavIcon name="size"/> },
  ];
  const tabPanels = [
    { id: 'templates', label: 'Templates', icon: <EdNavIcon name="designs" size={26}/> },
    { id: 'fabrics', label: 'Fabrics', icon: fabricsIcon(26) },
    { id: 'tools', label: 'Tools', icon: <EdNavIcon name="tools" size={26}/> },
    { id: 'size', label: 'Size', icon: <EdNavIcon name="size" size={26}/> },
    { id: 'quilting', label: 'Quilting', icon: <EdNavIcon name="quilting" size={26}/> },
  ];
  // Guided mode lists the panels in the order the setup walks them, Size first.
  const inGuideOrder = list => {
    const rank = id => { const i = QUILT_GUIDE.findIndex(g => g.id === id); return i < 0 ? QUILT_GUIDE.length : i; };
    return list.slice().sort((a, b) => rank(a.id) - rank(b.id));
  };
  const railItems = [
    ...(guided ? inGuideOrder(railPanels) : railPanels),
    { id: 'sp', spacer: true },
    { id: 'help', label: 'Help', icon: <IcHelp/> },
  ];
  const tabItems = guided ? inGuideOrder(tabPanels) : tabPanels;
  const paletteSwatches = fabricOrder.map((c, i) => (
    <EdSwatch key={`${c.name}-${i}`} color={c} active={isColorActive(c)} onClick={() => pickColor(c)}/>
  ));

  return (
    <div className="app ed-app" style={{ '--ed-tray-h': `${trayH}px` }}>

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
          {!isMobile && savedQuilts.length>0 && (
            <button type="button" className="ed-topbar-link is-tomato" onClick={()=>setShowMyQuilts(true)}>My quilts</button>
          )}
          {!isMobile && (currentQuilt ? (
            <>
              <button type="button" className="ed-topbar-link is-olive" title="Save as a new copy"
                onClick={()=>{setSaveName(((currentQuilt.name||'')+' copy').trim());setShowSave(true);}}>
                Save as…
              </button>
              <button className="btn" title={`Update “${currentQuilt.name}”`} onClick={updateCurrentQuilt}>
                {justSaved ? <>Saved <IcCheck size={12}/></> : 'Save'}
              </button>
            </>
          ) : (
            <button className="btn" onClick={openSave}>
              {justSaved ? <>Saved <IcCheck size={12}/></> : 'Save quilt'}
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
          {/* Buying needs no account and no prior save — the record is built from
              the canvas on click, so this is the shortest path to a kit. An empty
              quilt top is held back; the kit would be fabric with no layout. */}
          <div className="ed-buy">
            <BuyKitButton type="quilt" design={{ preset }} onReview={onReview}
              blockedReason={materials.total === 0 ? 'Place some patches first' : null}
              getDesign={()=>buildQuiltRecord(currentQuiltId ?? Date.now(), (currentQuilt && currentQuilt.name) || 'Untitled')}
              onSaved={id=>{ if (currentQuiltId != null) setSavedQuilts(p=>p.map(x=>x.id===currentQuiltId?{...x,apiId:id}:x)); }}/>
          </div>
        </div>
      </div>

      <div className="ed-main">
        <div className="ed-stage-col">
          {isCoasterKit && (
            <CoasterTabs active={activeCoaster} onSelect={selectCoaster} onCopyAll={copyCoasterToAll}/>
          )}
          <div className={`ed-stage${!isMobile && showTips ? ' has-hint' : ''}`}>
            <div className="ed-canvas">
              <GridCanvas cols={cols} rows={rows} shapes={shapes} setShapes={setShapes}
                selIds={selIds} setSelIds={setSelIds}
                tool={tool} selectedColor={color}
                quiltPattern={qPattern} quiltSpacing={qSpacing} quiltColor={qColor} showQuilting={showQ}
                zoom={zoom} onZoomChange={setZoom} pinned={fabricOrder} isMobile={isMobile}
                onReplaceColor={replaceEverywhere} onPickFabric={setColor}
                onAddFabric={canAddFabric ? ref => openLibrary(ref, 'bottom-start') : undefined}/>
            </div>

            {!isMobile && <EdTools className="ed-dock ed-float" tools={tools} tool={tool} onTool={setTool}/>}
            {!isMobile && hintBubble && <div className="ed-bottom-stack">{hintBubble}</div>}

            {isMobile && (
              <div className="ed-canvas-head">
                <EdZoomPill zoom={zoom} onStep={adjustZoom} onFit={resetZoom}/>
              </div>
            )}
            {isMobile && !panel && (
              <div className="ed-tray" ref={trayRef}>
                {hintBubble}
                {painting && (
                  <div className="ed-strip ed-float ed-keep-sel">
                    {paletteSwatches}
                  </div>
                )}
                <div className="ed-tray-card">
                  <div className="ed-handle"/>
                  <EdTools className="ed-tray-tools" tools={tools} tool={tool} onTool={setTool}/>
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
              <button type="button" className="btn btn-sm" onClick={() => setConfirmClear(true)} disabled={shapes.length === 0}
                title={isCoasterKit ? 'Clear this coaster' : 'Clear the quilt'}>Clear</button>
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
        <EdNav className="ed-tabbar" label="Panels" items={tabItems} active={panel && panel !== 'menu' && panel !== 'help' ? panel : (panel ? null : 'tools')}
          onSelect={id => id === 'tools' ? setPanel(null) : togglePanel(id)}/>
      )}

      {/* Library popover. Anchored to whatever invoked it (My palette + or a
          fabric row); doubles as a fabric picker when `picker.onPick` is set. */}
      {picker && libraryAnchorRef.current && (
        <LibraryPopover
          anchorRef={libraryAnchorRef}
          onClose={closePicker}
          search={search} setSearch={setSearch}
          grp={grp} setGrp={setGrp}
          filtered={filtered}
          color={picker.fromColor || color} setColor={setColor}
          selIds={selIds} setShapes={setShapes}
          customs={customs} setCustoms={setCustoms}
          setPinned={setPinned}
          allColors={allColors}
          pinned={pinned}
          showMyPalette={picker.showMyPalette}
          onPick={picker.onPick}
          onClear={picker.onClear}
          title={picker.title}
          isMobile={isMobile}
          placement={picker.placement || 'left-anchored'}/>
      )}

      {showBackingPicker && (
        <BackingPickerOverlay
          current={backing}
          onChoose={fab => { setBacking(fab); setShowBackingPicker(false); }}
          onClear={backing ? () => setBacking(null) : null}
          onClose={() => setShowBackingPicker(false)}/>
      )}
      {inspectBacking && (
        <FabricEnlargeOverlay
          fabric={inspectBacking}
          onClose={() => setInspectBacking(null)}/>
      )}

      {/* Clear confirm */}
      {confirmClear && (
        <div className="overlay" onClick={()=>setConfirmClear(false)}>
          <div onClick={e=>e.stopPropagation()}
            style={{background:'#FFFFFF',border:'1px solid #CCD6EB',borderRadius:8,padding:24,maxWidth:340,width:'100%',margin:16,boxShadow:'0 8px 32px rgba(0,0,0,0.14)'}}>
            <div style={{fontWeight:400,fontSize:24,marginBottom:8,fontFamily:"var(--font-display)",lineHeight:1.1}}>{isCoasterKit ? 'Clear this coaster?' : 'Clear the quilt?'}</div>
            <div style={{fontSize:13,color:'#3D4E70',marginBottom:20,lineHeight:1.5}}>{isCoasterKit ? 'This will remove all shapes from this coaster. The rest of the set is unchanged.' : 'This will remove all shapes from your design. You can undo it.'}</div>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button className="btn" onClick={()=>setConfirmClear(false)}>Cancel</button>
              <button className="btn btn-dark" onClick={()=>{setShapes([]);setSelIds(new Set());setConfirmClear(false);}}>{isCoasterKit ? 'Clear coaster' : 'Clear all'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Save dialog */}
      {showSave && (
        <div className="overlay" onClick={()=>setShowSave(false)}>
          <div onClick={e=>e.stopPropagation()}
            style={{background:'#FFFFFF',border:'1px solid #CCD6EB',borderRadius:8,padding:24,maxWidth:380,width:'100%',margin:16,boxShadow:'0 8px 32px rgba(0,0,0,0.14)'}}>
            <div style={{fontWeight:400,fontSize:24,marginBottom:16,fontFamily:"var(--font-display)",lineHeight:1.1}}>{currentQuilt?'Save a copy':'Save your quilt'}</div>
            <AccountsOfflineNote/>
            <input type="text" placeholder="Give your quilt a name…" value={saveName} onChange={e=>setSaveName(e.target.value)}
              autoFocus onKeyDown={e=>{if(e.key==='Enter')saveNewQuilt();}}
              style={{marginBottom:16}}/>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button className="btn" onClick={()=>setShowSave(false)}>Cancel</button>
              <button className="btn btn-dark" onClick={saveNewQuilt}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* My quilts list */}
      {showMyQuilts && (
        <div className="overlay" onClick={()=>setShowMyQuilts(false)}>
          <div onClick={e=>e.stopPropagation()}
            style={{background:'#FFFFFF',border:'1px solid #CCD6EB',borderRadius:8,padding:24,maxWidth:500,width:'100%',margin:16,boxShadow:'0 8px 32px rgba(0,0,0,0.14)',maxHeight:'80vh',overflowY:'auto'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
              <div style={{fontWeight:400,fontSize:24,fontFamily:"var(--font-display)",lineHeight:1.1}}>My quilts</div>
              <button onClick={()=>setShowMyQuilts(false)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--warm-muted)',display:'flex'}}><IcX/></button>
            </div>
            {saveError && (
              <div style={{fontSize:12,color:'var(--metime-tomato)',background:'#FBECE8',border:'1px solid #F3C9BF',borderRadius:6,padding:'8px 10px',marginBottom:12}}>{saveError}</div>
            )}
            {savedQuilts.length===0 ? (
              <div style={{fontSize:13,color:'var(--warm-muted)',fontStyle:'italic',padding:'20px 0',textAlign:'center'}}>No saved quilts yet</div>
            ) : (
              <div style={{display:'flex',flexDirection:'column',gap:12}}>
                {savedQuilts.map(q=>(
                  <div key={q.id} style={{display:'flex',gap:12,alignItems:'center',padding:12,border:'1px solid #CCD6EB',borderRadius:6,cursor:'pointer',transition:'background .1s'}}
                    onClick={()=>{setViewQuilt(q);setShowMyQuilts(false);}} title="Preview"
                    onMouseEnter={e=>e.currentTarget.style.background='#EDF2FC'}
                    onMouseLeave={e=>e.currentTarget.style.background='#FFFFFF'}>
                    <div style={{width:64,height:64,flexShrink:0,position:'relative',background:'#FFFFFF',borderRadius:4,overflow:'hidden'}}>
                      <svg viewBox={`0 0 ${q.cols} ${q.rows}`} width="64" height="64" preserveAspectRatio="xMidYMid meet">
                        {q.shapes.map((s,i)=>s.type==='tri'?(
                          <polygon key={i} points={s.dir==='/'?(s.half==='a'?`${s.c},${s.r} ${s.c+s.w},${s.r} ${s.c},${s.r+s.h}`:`${s.c+s.w},${s.r} ${s.c+s.w},${s.r+s.h} ${s.c},${s.r+s.h}`):(s.half==='a'?`${s.c},${s.r} ${s.c+s.w},${s.r} ${s.c+s.w},${s.r+s.h}`:`${s.c},${s.r} ${s.c},${s.r+s.h} ${s.c+s.w},${s.r+s.h}`)} fill={s.color.hex}/>
                        ):<rect key={i} x={s.c} y={s.r} width={s.w} height={s.h} fill={s.color.hex} stroke="rgba(0,0,0,0.08)" strokeWidth="0.05"/>)}
                      </svg>
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:500,fontSize:14,marginBottom:2}}>{q.name}</div>
                      <div style={{fontSize:12,color:'var(--warm-muted)'}}>{q.fw}" × {q.fh}" · {q.preset !== 'Custom' ? q.preset : 'Custom size'}</div>
                      <div style={{fontSize:12,color:'var(--warm-muted)'}}>{q.materials.items.length} color{q.materials.items.length!==1?'s':''} · {fmtY(q.grandTotal)} total</div>
                    </div>
                    {confirmDeleteId===q.id ? (
                      <div style={{display:'flex',gap:6,alignItems:'center'}} onClick={e=>e.stopPropagation()}>
                        <button className="btn btn-sm" onClick={()=>setConfirmDeleteId(null)}>Cancel</button>
                        <button className="btn btn-sm btn-dark" onClick={()=>{deleteCloudDesign(q.apiId);setSavedQuilts(p=>p.filter(x=>x.id!==q.id));setConfirmDeleteId(null);}}>Delete</button>
                      </div>
                    ) : (
                      <div style={{display:'flex',gap:2,alignItems:'center'}}>
                        <button title="Delete quilt"
                          onClick={e=>{e.stopPropagation();setConfirmDeleteId(q.id);}}
                          style={{background:'none',border:'none',cursor:'pointer',color:'var(--warm-muted)',display:'flex',padding:4}}
                          onMouseEnter={e=>e.currentTarget.style.color='var(--metime-tomato)'}
                          onMouseLeave={e=>e.currentTarget.style.color='var(--warm-muted)'}><IcTrash/></button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Quilt preview */}
      {viewQuilt && (()=>{
        const q = viewQuilt;
        const allItems = [
          ...q.materials.items.map(m=>({type:'Quilt top',name:m.name,hex:m.hex,detail:`${m.count} pcs · ${m.strips} strip${m.strips!==1?'s':''}`,yards:m.yards})),
          ...(q.backing ? [{type:'Backing',name:q.backing.name,hex:q.backing.hex,detail:`${q.backCalc.backingW}"×${q.backCalc.backingH}" · ${q.backCalc.widths}w`,yards:q.backCalc.yards}] : []),
          ...(q.binding ? [{type:'Binding',name:q.binding.name,hex:q.binding.hex,detail:`${q.bindCalc.strips} strips · ${q.bindCalc.perimeter}" perim.`,yards:q.bindCalc.yards}] : []),
        ];
        return (
          <div className="overlay" onClick={()=>setViewQuilt(null)}>
            <div onClick={e=>e.stopPropagation()}
              style={{background:'#FFFFFF',border:'1px solid #CCD6EB',borderRadius:8,maxWidth:720,width:'100%',margin:16,boxShadow:'0 8px 32px rgba(0,0,0,0.14)',maxHeight:'90vh',overflowY:'auto'}}>

              {/* Top bar */}
              <div style={{padding:'20px 24px 16px',borderBottom:'1px solid #EDF2FC',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                <div>
                  <div style={{fontWeight:400,fontSize:24,fontFamily:"var(--font-display)",lineHeight:1.1}}>{q.name}</div>
                  <div style={{fontSize:13,color:'var(--warm-muted)',marginTop:2}}>{q.fw}" × {q.fh}" · {q.preset !== 'Custom' ? q.preset : 'Custom size'} · {q.bs}" blocks</div>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <button className="btn" onClick={()=>loadQuilt(q)}>Open on canvas</button>
                  <button onClick={()=>setViewQuilt(null)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--warm-muted)',display:'flex'}}><IcX/></button>
                </div>
              </div>

              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:0}}>
                {/* Preview */}
                <div style={{padding:24,borderRight:'1px solid #EDF2FC',display:'flex',alignItems:'center',justifyContent:'center'}}>
                  <div style={{width:'100%',maxWidth:320,background:'#FFFFFF',borderRadius:4,overflow:'hidden',border:'1px solid #CCD6EB'}}>
                    <svg viewBox={`0 0 ${q.cols} ${q.rows}`} width="100%" preserveAspectRatio="xMidYMid meet" style={{display:'block'}}>
                      <rect width={q.cols} height={q.rows} fill="#FFFFFF"/>
                      {Array.from({length:q.cols+1},(_,i)=><line key={`v${i}`} x1={i} y1={0} x2={i} y2={q.rows} stroke="#EDF2FC" strokeWidth="0.04"/>)}
                      {Array.from({length:q.rows+1},(_,i)=><line key={`h${i}`} x1={0} y1={i} x2={q.cols} y2={i} stroke="#EDF2FC" strokeWidth="0.04"/>)}
                      {q.shapes.map((s,i)=>s.type==='tri'?(
                        <polygon key={i} points={s.dir==='/'?(s.half==='a'?`${s.c},${s.r} ${s.c+s.w},${s.r} ${s.c},${s.r+s.h}`:`${s.c+s.w},${s.r} ${s.c+s.w},${s.r+s.h} ${s.c},${s.r+s.h}`):(s.half==='a'?`${s.c},${s.r} ${s.c+s.w},${s.r} ${s.c+s.w},${s.r+s.h}`:`${s.c},${s.r} ${s.c},${s.r+s.h} ${s.c+s.w},${s.r+s.h}`)} fill={s.color.hex}/>
                      ):<rect key={i} x={s.c} y={s.r} width={s.w} height={s.h} fill={s.color.hex} stroke="rgba(0,0,0,0.08)" strokeWidth="0.05"/>)}
                    </svg>
                  </div>
                </div>

                {/* Supplies list */}
                <div style={{display:'flex',flexDirection:'column'}}>
                  <div style={{padding:'16px 20px 8px'}}>
                    <div className="label" style={{marginBottom:4}}>Supplies list</div>
                    <div style={{fontSize:12,color:'var(--warm-muted)'}}>{allItems.length} item{allItems.length!==1?'s':''}</div>
                  </div>
                  <div style={{flex:1,overflowY:'auto',maxHeight:320}}>
                    {allItems.map((item,i)=>(
                      <div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 20px',borderBottom:'1px solid #EDF2FC'}}>
                        <div style={{width:24,height:24,background:item.hex,border:'1px solid rgba(0,0,0,0.10)',borderRadius:3,flexShrink:0}}/>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:12,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.name}</div>
                          <div style={{fontSize:11,color:'var(--warm-muted)'}}>{item.type} · {item.detail}</div>
                        </div>
                        <div style={{fontSize:13,fontWeight:600,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{fmtY(item.yards)}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{padding:'12px 20px',borderTop:'1px solid #EDF2FC',display:'flex',flexDirection:'column',gap:12}}>
                    <QuiltPdfButtons design={q}/>
                    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                      <div>
                        <div style={{fontSize:11,color:'var(--warm-muted)'}}>Grand total</div>
                        <div style={{fontSize:20,fontWeight:600,fontVariantNumeric:'tabular-nums'}}>{fmtY(q.grandTotal)}</div>
                      </div>
                      <KitCheckoutButton type="quilt" design={q} savedId={q.apiId} onReview={onReview}
                        onSaved={id=>setSavedQuilts(p=>p.map(x=>x.id===q.id?{...x,apiId:id}:x))}/>
                    </div>
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
