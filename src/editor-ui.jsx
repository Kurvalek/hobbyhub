import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GROUPS, KONA } from '../assets/color-catalogs.js';
import { useAuth } from './services.jsx';
import { IcChevD, IcChevR, IcHelp, IcLogout, IcMinus, IcPlus, IcSearch, IcX } from './icons.jsx';
import { PRESETS, SUGGESTED_PALETTES, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from './catalog.jsx';
import { fabricThumbFor } from './setup-steps.jsx';
import { studioCovered } from './kit-review.jsx';

// ── SuggestedPalettes ─────────────────────────────────────────────────────
function SuggestedPalettes({ onLoad, onSelect }) {
  const lookup = name => KONA.find(c => c.name === name);
  const [open, setOpen] = React.useState(false);
  const [showAll, setShowAll] = React.useState(false);
  const visible = showAll ? SUGGESTED_PALETTES : SUGGESTED_PALETTES.slice(0, 4);

  return (
    <div>
      <button onClick={()=>setOpen(v=>!v)}
        style={{ background:'none', border:'none', cursor:'pointer', fontSize:11, color:'var(--warm-muted)', padding:0, fontFamily:"var(--font-sans)", display:'flex', alignItems:'center', gap:4 }}>
        <span style={{transition:'transform .15s',transform:open?'rotate(90deg)':'rotate(0)',display:'inline-flex'}}><IcChevR size={10}/></span>
        Suggested palettes
      </button>
      {open && (
        <div style={{ marginTop:8 }}>
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {visible.map(pal => {
              const cols = pal.colors.map(lookup).filter(Boolean);
              return (
                <div key={pal.name}
                  style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', padding:'4px 0' }}
                  onClick={() => { onLoad(cols); if (cols[0]) onSelect(cols[0]); }}
                  title={`Load "${pal.name}" palette`}>
                  <div style={{ display:'flex', flex:1, borderRadius:3, overflow:'hidden', height:22, border:'1px solid rgba(0,0,0,0.10)' }}>
                    {cols.map((c,i) => (
                      <div key={i} style={{ flex:1, background:c.hex }} title={c.name}/>
                    ))}
                  </div>
                  <span style={{ fontSize:11, color:'#3D4E70', whiteSpace:'nowrap', minWidth:60, textAlign:'right' }}>{pal.name}</span>
                </div>
              );
            })}
          </div>
          {SUGGESTED_PALETTES.length > 4 && (
            <button onClick={()=>setShowAll(v=>!v)}
              style={{ marginTop:8, background:'none', border:'none', cursor:'pointer', fontSize:11, color:'var(--warm-muted)', padding:0, fontFamily:"var(--font-sans)" }}>
              {showAll ? '↑ Show less' : `+ ${SUGGESTED_PALETTES.length - 4} more`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Generic "suggested palettes" list that works with any pre-resolved color
// objects ({name, colors:[{hex,...}]}). Used by the DMC (cross-stitch) library.
function SimpleSuggested({ palettes, onLoad, onSelect }) {
  const [open, setOpen] = React.useState(false);
  const [showAll, setShowAll] = React.useState(false);
  const visible = showAll ? palettes : palettes.slice(0, 4);
  return (
    <div>
      <button onClick={()=>setOpen(v=>!v)}
        style={{ background:'none', border:'none', cursor:'pointer', fontSize:11, color:'var(--warm-muted)', padding:0, fontFamily:"var(--font-sans)", display:'flex', alignItems:'center', gap:4 }}>
        <span style={{transition:'transform .15s',transform:open?'rotate(90deg)':'rotate(0)',display:'inline-flex'}}><IcChevR size={10}/></span>
        Suggested palettes
      </button>
      {open && (
        <div style={{ marginTop:8 }}>
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {visible.map(pal => (
              <div key={pal.name}
                style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', padding:'4px 0' }}
                onClick={() => { onLoad(pal.colors); if (pal.colors[0]) onSelect(pal.colors[0]); }}
                title={`Load "${pal.name}" palette`}>
                <div style={{ display:'flex', flex:1, borderRadius:3, overflow:'hidden', height:22, border:'1px solid rgba(0,0,0,0.10)' }}>
                  {pal.colors.map((c,i) => (
                    <div key={i} style={{ flex:1, background:c.hex }} title={c.name}/>
                  ))}
                </div>
                <span style={{ fontSize:11, color:'#3D4E70', whiteSpace:'nowrap', minWidth:60, textAlign:'right' }}>{pal.name}</span>
              </div>
            ))}
          </div>
          {palettes.length > 4 && (
            <button onClick={()=>setShowAll(v=>!v)}
              style={{ marginTop:8, background:'none', border:'none', cursor:'pointer', fontSize:11, color:'var(--warm-muted)', padding:0, fontFamily:"var(--font-sans)" }}>
              {showAll ? '↑ Show less' : `+ ${palettes.length - 4} more`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Floating popover (positions to anchor element) ────────────────────────
export function Popover({ anchorRef, onClose, placement = 'right-bottom', children, width = 280 }) {
  const [pos, setPos] = useState(null);
  const popRef = useRef(null);
  const calcRef = useRef(null);
  const measuredH = useRef(0);
  // The first placement guesses the height; once the popover has rendered,
  // place it again with its real height so a flip lands next to the anchor.
  useLayoutEffect(() => {
    const h = popRef.current?.offsetHeight || 0;
    if (pos && h && h !== measuredH.current) { measuredH.current = h; calcRef.current?.(); }
  });

  useEffect(() => {
    if (!anchorRef?.current) return;
    const calc = calcRef.current = () => {
      const a = anchorRef.current.getBoundingClientRect();
      const popH = popRef.current?.offsetHeight || 320;
      let top, left;
      if (placement === 'right-bottom') { top = a.top; left = a.right + 8; }
      else if (placement === 'right-top') { top = a.bottom - 1; left = a.right + 8; }
      else if (placement === 'bottom-start') { top = a.bottom + 6; left = a.left; }
      else if (placement === 'bottom-center') { top = a.bottom + 6; left = a.left + a.width/2 - width/2; }
      else if (placement === 'bottom-end') { top = a.bottom + 6; left = a.right - width; }
      else if (placement === 'left-anchored') { top = a.top; left = a.left - width - 8; }
      else { top = a.bottom + 6; left = a.left; }
      // Flip upward if the popover would overflow the bottom of the viewport:
      // menus below their anchor open above it instead; side popovers line up
      // with the anchor's bottom edge.
      const maxLeft = window.innerWidth - width - 8;
      const maxTop = window.innerHeight - popH - 8;
      if (top > maxTop) top = Math.max(8, placement.startsWith('bottom') ? a.top - popH - 6 : a.bottom - popH);
      left = Math.max(8, Math.min(left, maxLeft));
      top = Math.max(8, Math.min(top, maxTop));
      setPos({ top, left });
    };
    calc();
    // Recalc once after first render so we know popover height for flipping
    const id = requestAnimationFrame(calc);
    window.addEventListener('resize', calc);
    window.addEventListener('scroll', calc, true);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener('resize', calc);
      window.removeEventListener('scroll', calc, true);
    };
  }, [anchorRef, placement, width]);

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!pos) return null;
  return (
    <>
      <div className="popover-backdrop" onMouseDown={onClose}/>
      <div ref={popRef} className="popover" style={{ top: pos.top, left: pos.left, width }} onMouseDown={e=>e.stopPropagation()}>
        {children}
      </div>
    </>
  );
}

// ── Mobile helpers (Canva-style bottom toolbar + bottom sheets) ───────────
// All mobile-only; desktop keeps the existing rails/drawer/popovers untouched.
function useMediaQuery(query) {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = e => setM(e.matches);
    mq.addEventListener('change', on);
    setM(mq.matches);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return m;
}
export function useIsMobile(query = '(max-width: 900px)') { return useMediaQuery(query); }
// The stylesheet honours reduced motion for its transitions and keyframes, but
// the photo-to-chart reveal is driven frame by frame in JS, so it has to ask
// the same question itself.
export function usePrefersReducedMotion() { return useMediaQuery('(prefers-reduced-motion: reduce)'); }

// A sheet that slides up from the bottom. Reuses the app's card/panel styling
// so its contents look identical to the desktop panel/popover.
export function BottomSheet({ onClose, title, showClose = true, children, maxHeightVh = 85, sheetClassName, elevated = false }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const lift = elevated ? ' is-lift' : '';
  return (
    <>
      <div className={`bottom-sheet-backdrop${lift}`} onClick={onClose}/>
      <div className={`bottom-sheet${lift}${sheetClassName ? ` ${sheetClassName}` : ''}`} style={{ maxHeight: `${maxHeightVh}vh` }} role="dialog" aria-modal="true">
        <div className="bottom-sheet-handle"/>
        {(title || showClose) && (
          <div className="bottom-sheet-head">
            <span className="popover-title">{title}</span>
            {showClose && (
              <button className="icon-btn" style={{ width: 28, height: 28 }} onClick={onClose} title="Close" aria-label="Close">
                <IcX/>
              </button>
            )}
          </div>
        )}
        <div className="bottom-sheet-body">{children}</div>
      </div>
    </>
  );
}

// Fixed bottom toolbar. `items` is a flat list of tool/extras buttons; an item
// with { divider:true } renders a hairline separator. Icon-only, reusing .icon-btn.
function MobileToolbar({ items }) {
  return (
    <div className="mobile-toolbar" role="toolbar">
      {items.map(it => it.divider
        ? <span key={it.id} className="mobile-toolbar-divider" aria-hidden="true"/>
        : (
          <button
            key={it.id}
            className={`icon-btn${it.active ? ' active' : ''}`}
            aria-pressed={it.active || undefined}
            title={it.label}
            aria-label={it.label}
            onClick={it.onClick}>
            {it.icon}
          </button>
        )
      )}
    </div>
  );
}

// ── PresetPill (studio header size dropdown) ──────────────────────────────
// `dimsOf` formats a preset's finished size; `fallbackDims` covers a board
// that isn't one of the presets (a saved custom size).
export const inchDims = (w, h) => `${w}" × ${h}"`;
function PresetPill({ preset, presets = PRESETS, label = 'Quilt size', dimsOf = p => inchDims(p.w, p.h), fallbackDims, onApply }) {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const current = presets.find(p => p.name === preset);
  return (
    <>
      <button
        ref={ref}
        className="preset-pill"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={()=>setOpen(v=>!v)}
        title={`Change ${label.toLowerCase()}`}>
        <span>{preset}</span>
        <span className="preset-dim">{current && current.w ? dimsOf(current) : fallbackDims}</span>
        <IcChevD size={10}/>
      </button>
      {open && (
        <Popover anchorRef={ref} onClose={()=>setOpen(false)} placement="bottom-center" width={260}>
          <div className="popover-header"><span className="popover-title">{label}</span></div>
          <div className="popover-body" style={{ padding: '4px 6px 10px' }}>
            {presets.map(p => (
              <button
                key={p.name}
                onClick={() => { onApply(p.name); setOpen(false); }}
                style={{
                  display:'flex', justifyContent:'space-between', alignItems:'center',
                  width:'100%', padding:'8px 10px', borderRadius:6, border:'none',
                  background: preset === p.name ? 'var(--warm-hover)' : 'transparent',
                  cursor:'pointer', fontFamily:'var(--font-sans)', fontSize:13,
                  color:'var(--warm-fg)', textAlign:'left',
                }}
                onMouseEnter={e => { if (preset !== p.name) e.currentTarget.style.background = 'var(--warm-hover)'; }}
                onMouseLeave={e => { if (preset !== p.name) e.currentTarget.style.background = 'transparent'; }}>
                <span style={{ fontWeight: preset === p.name ? 500 : 400 }}>{p.name}</span>
                <span style={{ fontFamily:'var(--font-sans)', fontSize:11, color:'var(--warm-muted)' }}>{dimsOf(p)}</span>
              </button>
            ))}
          </div>
        </Popover>
      )}
    </>
  );
}

// ── LibraryPopover (anchored to + button on My Palette) ───────────────────
export function LibraryPopover({ anchorRef, onClose, search, setSearch, grp, setGrp,
  filtered, color, setColor, selIds, setShapes,
  customs, setCustoms, setPinned, allColors,
  pinned, showMyPalette, onPick, onClear, title,
  groups = GROUPS, suggested, isMobile = false, afterPick, placement = 'left-anchored' }) {
  const [showCF, setShowCF] = useState(false);
  const [cName, setCName] = useState("");
  const [cHex, setCHex] = useState("#000000");
  // When `onPick` is provided (e.g. picking a fabric), the chip click delegates
  // there and closes the popover instead of doing the default paint behaviour.
  const finishPick = (c) => { afterPick?.(c); onClose(); };
  const handleChip = (c) => {
    if (onPick) {
      onPick(c);
      finishPick(c);
      return;
    }
    setColor(c);
    setPinned(p => p.find(x => x.name === c.name) ? p : [...p, c]);
    if (selIds.size > 0) setShapes(p => p.map(s => selIds.has(s.id) ? { ...s, color: c } : s));
    finishPick(c);
  };
  const body = (
    <>
      <div className="popover-header">
        <span className="popover-title">{title || 'Color library'}</span>
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          {onClear && <button onClick={() => { onClear(); onClose(); }} className="btn btn-xs">Clear</button>}
          <button onClick={onClose} className="icon-btn" style={{ width:24, height:24 }} title="Close"><IcX/></button>
        </div>
      </div>
      <div className="popover-body" style={{ display:'flex', flexDirection:'column', gap:10, maxHeight:'70vh', overflowY:'auto' }}>
        {showMyPalette && (
          <div>
            <div className="label" style={{ marginBottom:6 }}>My palette</div>
            {pinned && pinned.length > 0 ? (
              <div style={{ display:'grid', gridTemplateColumns:'repeat(8,1fr)', gap:4 }}>
                {pinned.map((c,i) => (
                  <button key={`p${i}`}
                    className={`chip ${color?.name===c.name && color?.hex===c.hex ? 'selected' : ''}`}
                    onClick={() => handleChip(c)}
                    style={{ background: c.hex }}
                    title={`${c.name}${c.code && !c.custom ? ` · ${c.code}` : ''}`}/>
                ))}
              </div>
            ) : (
              <div style={{ fontSize:12, color:'var(--warm-muted)', fontStyle:'italic' }}>Your palette is empty.</div>
            )}
          </div>
        )}
        <div style={{ position:'relative', ...(showMyPalette ? { borderTop:'1px solid var(--warm-divider-soft)', paddingTop:10 } : {}) }}>
          <span style={{ position:'absolute', left:9, top: showMyPalette ? 'calc(50% + 5px)' : '50%', transform:'translateY(-50%)', color:'var(--warm-placeholder)', pointerEvents:'none', display:'flex' }}>
            <IcSearch/>
          </span>
          <input type="text" placeholder="Search colors…" value={search} onChange={e=>setSearch(e.target.value)} style={{ paddingLeft:30 }}/>
        </div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
          {groups.map(g => (
            <button key={g} type="button" className={`filter-pill is-compact${grp===g?' active':''}`}
              aria-pressed={grp===g} onClick={()=>setGrp(g)}>{g}</button>
          ))}
        </div>
        <div>
          <div className="label" style={{ marginBottom:6 }}>All colors ({filtered.length})</div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(8,1fr)', gap:3 }}>
            {filtered.map((c,i) => (
              <button key={`${c.name}${i}`}
                className={`chip ${color?.name===c.name && color?.hex===c.hex ? 'selected' : ''}`}
                onClick={() => handleChip(c)}
                style={{ background: c.hex }}
                title={`${c.name}${c.code && !c.custom ? ` · ${c.code}` : ''}`}/>
            ))}
            {!filtered.length && <div style={{ gridColumn:'1/-1', fontSize:12, color:'var(--warm-muted)', padding:'12px 0', textAlign:'center' }}>No matches</div>}
          </div>
        </div>
        <div style={{ borderTop:'1px solid var(--warm-divider-soft)', paddingTop:10 }}>
          {suggested ? (
            <SimpleSuggested palettes={suggested} onLoad={setPinned} onSelect={c => { setColor(c); finishPick(c); }}/>
          ) : (
            <SuggestedPalettes onLoad={setPinned} onSelect={c => { setColor(c); finishPick(c); }}/>
          )}
        </div>
        <div style={{ borderTop:'1px solid var(--warm-divider-soft)', paddingTop:10 }}>
          {!showCF ? (
            <button onClick={()=>setShowCF(true)}
              style={{ background:'none', border:'none', cursor:'pointer', fontSize:12, color:'var(--warm-muted)', display:'flex', alignItems:'center', gap:4, width:'100%', justifyContent:'center', padding:'2px 0' }}>
              <IcPlus/> Add custom color
            </button>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              <input type="text" placeholder="Color name" value={cName} onChange={e=>setCName(e.target.value)}/>
              <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                <input type="color" value={cHex} onChange={e=>setCHex(e.target.value)} style={{ width:36, flexShrink:0 }}/>
                <input type="text" value={cHex} onChange={e=>setCHex(e.target.value)} style={{ fontFamily:"var(--font-sans)", fontSize:12 }}/>
              </div>
              <div style={{ display:'flex', gap:6 }}>
                <button className="btn btn-dark btn-sm" style={{ flex:1 }} onClick={() => {
                  if (!cName.trim() || !/^#[0-9A-Fa-f]{6}$/.test(cHex)) return;
                  const c = { name: cName.trim(), hex: cHex.toUpperCase(), group: 'Custom', custom: true };
                  setCustoms(p => [c, ...p]);
                  if (onPick) { onPick(c); finishPick(c); return; }
                  setColor(c);
                  setPinned(p => [...p, c]);
                  setCName(''); setCHex('#000000'); setShowCF(false);
                  finishPick(c);
                }}>Add</button>
                <button className="btn btn-sm" onClick={()=>setShowCF(false)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
  // Mobile: the color library slides up as a bottom sheet (its own header
  // carries the title + close, so the sheet chrome stays minimal).
  if (isMobile) return <BottomSheet onClose={onClose} showClose={false}>{body}</BottomSheet>;
  return (
    <Popover anchorRef={anchorRef} onClose={onClose} placement={placement} width={320}>
      {body}
    </Popover>
  );
}

// ── Right-column blocks ───────────────────────────────────────────────────
function MyPaletteCard({ color, pinned, setPinned, setColor, onOpenLibrary, selIds, setShapes, onRecolor, onAfterPick }) {
  const plusRef = useRef(null);
  // Clicking a palette chip sets the active paint color, and—if objects are
  // selected—recolors that selection. Two selection models are supported:
  // the quilt's shape ids (selIds/setShapes) and, when `onRecolor` is given,
  // a caller-provided recolor (e.g. the cross-stitch cell selection).
  const handleChip = (c) => {
    setColor(c);
    if (onRecolor) { onRecolor(c); onAfterPick?.(); return; }
    if (selIds && selIds.size > 0 && setShapes) {
      setShapes(p => p.map(s => selIds.has(s.id) ? { ...s, color: c } : s));
    }
    onAfterPick?.();
  };
  return (
    <div className="card my-palette">
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
        <div className="label" style={{ marginBottom:0 }}>My palette</div>
        <button
          ref={plusRef}
          className="icon-btn"
          style={{ width:24, height:24 }}
          onClick={() => onOpenLibrary(plusRef)}
          title="Open color library">
          <IcPlus/>
        </button>
      </div>

      {pinned.length > 0 ? (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:8 }}>
          {pinned.map((c,i) => (
            <div key={i} style={{ position:'relative' }}
              onMouseEnter={e => { const b = e.currentTarget.querySelector('.rm'); if (b) b.style.opacity = 1; }}
              onMouseLeave={e => { const b = e.currentTarget.querySelector('.rm'); if (b) b.style.opacity = 0; }}>
              <button className={`chip ${color?.name===c.name?"selected":""}`} onClick={()=>handleChip(c)} style={{ background: c.hex }} title={c.name}/>
              <button className="rm" onClick={()=>setPinned(p => p.filter((_,j) => j !== i))}
                style={{ position:'absolute', top:-3, right:-3, width:13, height:13, borderRadius:'50%', background:'var(--metime-black)', border:'none', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--metime-white)', opacity:0, transition:'opacity .15s', zIndex:5 }}>
                <IcX/>
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize:12, color:'var(--warm-muted)', fontStyle:'italic' }}>Pin colors or tap + to open the library.</div>
      )}
    </div>
  );
}

const FabricRow = React.forwardRef(function FabricRow({ label, fabric, detail, onClick, onSwatchClick }, ref) {
  const swatchSrc = fabric && (fabric.thumb || fabricThumbFor(fabric.image) || fabric.image);
  const canEnlarge = typeof onSwatchClick === 'function' && !!(fabric && (fabric.image || swatchSrc));
  return (
    <button ref={ref} type="button" className="fabric-row" onClick={onClick}
      title={fabric ? `${label} · ${fabric.name}. Tap to change` : `Choose ${label.toLowerCase()} fabric`}>
      <div
        className={`fabric-row-swatch${fabric ? '' : ' empty'}${canEnlarge ? ' can-enlarge' : ''}`}
        style={fabric ? (swatchSrc
          ? { background: `center/cover no-repeat url(${swatchSrc})` }
          : { background: fabric.hex }) : undefined}
        title={canEnlarge ? 'View fabric large' : undefined}
        onClick={canEnlarge ? e => { e.stopPropagation(); onSwatchClick(); } : undefined}/>
      <div className="fabric-row-main">
        <div className="fabric-row-title">
          {label}
          {fabric && <span className="fabric-row-name"> · {fabric.name}</span>}
        </div>
        {fabric && detail && <div className="fabric-row-detail">{detail}</div>}
      </div>
    </button>
  );
});

export function quiltColorKey(c) {
  return c ? (c.name || c.hex || '') : '';
}

// ── Canvas pinch / ctrl-wheel zoom (shared by quilt + cross-stitch) ───────
// Zoom is applied by resizing content; pan is the scroll container. Pinch and
// ctrl/cmd+wheel update zoom while anchoring the focal point under the fingers
// (or cursor). Two-finger drag also pans. The Move-canvas tool enables one-
// finger pan. Drawing tools must bail while a multi-touch gesture is active —
// call isGestureActive() from pointer handlers.
function clampZoom(z) {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, +(+z).toFixed(3)));
}
export function useCanvasPinchZoom(scrollRef, zoom, onZoomChange, onGestureStart, panMode = false) {
  const zoomRef = useRef(zoom);
  const pointersRef = useRef(new Map());
  const pinchRef = useRef(null);
  const panRef = useRef(null);
  const pendingScrollRef = useRef(null);
  const activeRef = useRef(false);
  const onZoomChangeRef = useRef(onZoomChange);
  const onGestureStartRef = useRef(onGestureStart);
  const panModeRef = useRef(panMode);

  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { onZoomChangeRef.current = onZoomChange; }, [onZoomChange]);
  useEffect(() => { onGestureStartRef.current = onGestureStart; }, [onGestureStart]);
  useEffect(() => { panModeRef.current = panMode; }, [panMode]);

  useLayoutEffect(() => {
    const p = pendingScrollRef.current;
    if (!p) return;
    pendingScrollRef.current = null;
    p.el.scrollLeft = p.left;
    p.el.scrollTop = p.top;
  }, [zoom]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !onZoomChange) return undefined;

    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

    const setZoomAnchored = (nextZoom, clientX, clientY) => {
      const prev = zoomRef.current;
      const z = clampZoom(nextZoom);
      if (Math.abs(z - prev) < 0.001) return;
      const rect = el.getBoundingClientRect();
      const vx = clientX - rect.left;
      const vy = clientY - rect.top;
      pendingScrollRef.current = {
        el,
        left: (el.scrollLeft + vx) * (z / prev) - vx,
        top: (el.scrollTop + vy) * (z / prev) - vy,
      };
      zoomRef.current = z;
      onZoomChangeRef.current(z);
    };

    const beginPinch = () => {
      const pts = [...pointersRef.current.values()];
      if (pts.length < 2) return;
      pinchRef.current = {
        startDist: Math.max(1, dist(pts[0], pts[1])),
        startZoom: zoomRef.current,
        lastMid: mid(pts[0], pts[1]),
      };
      if (!activeRef.current) {
        activeRef.current = true;
        onGestureStartRef.current?.();
      }
    };

    const onPointerDown = (e) => {
      if (e.pointerType === 'mouse' && !panModeRef.current) return;
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointersRef.current.size >= 2) {
        panRef.current = null;
        beginPinch();
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (panModeRef.current && e.isPrimary) {
        panRef.current = { x: e.clientX, y: e.clientY };
        if (!activeRef.current) {
          activeRef.current = true;
          onGestureStartRef.current?.();
        }
        try { el.setPointerCapture(e.pointerId); } catch (_) {}
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const onPointerMove = (e) => {
      if (!pointersRef.current.has(e.pointerId)) return;
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointersRef.current.size >= 2 && pinchRef.current) {
        e.preventDefault();
        const pts = [...pointersRef.current.values()];
        const m = mid(pts[0], pts[1]);
        const p = pinchRef.current;
        el.scrollLeft += p.lastMid.x - m.x;
        el.scrollTop += p.lastMid.y - m.y;
        p.lastMid = m;
        setZoomAnchored(p.startZoom * (dist(pts[0], pts[1]) / p.startDist), m.x, m.y);
        return;
      }
      if (panRef.current && pointersRef.current.size <= 1) {
        e.preventDefault();
        el.scrollLeft += panRef.current.x - e.clientX;
        el.scrollTop += panRef.current.y - e.clientY;
        panRef.current = { x: e.clientX, y: e.clientY };
      }
    };

    const endPointer = (e) => {
      if (!pointersRef.current.has(e.pointerId)) return;
      pointersRef.current.delete(e.pointerId);
      panRef.current = null;
      if (pointersRef.current.size >= 2) {
        beginPinch();
      } else {
        pinchRef.current = null;
        if (pointersRef.current.size === 0) activeRef.current = false;
      }
    };

    const onWheel = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.01);
      setZoomAnchored(zoomRef.current * factor, e.clientX, e.clientY);
    };

    // Safari page-zoom gesture — keep it from hijacking the canvas.
    const onGesture = (e) => { e.preventDefault(); };

    el.addEventListener('pointerdown', onPointerDown, true);
    el.addEventListener('pointermove', onPointerMove, true);
    el.addEventListener('pointerup', endPointer, true);
    el.addEventListener('pointercancel', endPointer, true);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGesture, { passive: false });
    el.addEventListener('gesturechange', onGesture, { passive: false });

    return () => {
      el.removeEventListener('pointerdown', onPointerDown, true);
      el.removeEventListener('pointermove', onPointerMove, true);
      el.removeEventListener('pointerup', endPointer, true);
      el.removeEventListener('pointercancel', endPointer, true);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGesture);
      el.removeEventListener('gesturechange', onGesture);
    };
  }, [scrollRef, onZoomChange, panMode]);

  const isGestureActive = useCallback(() => activeRef.current, []);
  return { isGestureActive };
}

// ── ZoomBar (bottom of center canvas panel) ───────────────────────────────
function ZoomBar({ zoom, onZoomChange, onReset, onStep }) {
  const pct = Math.round(zoom * 100);
  return (
    <div className="zoom-bar">
      <button
        className="icon-btn"
        style={{ width:24, height:24 }}
        onClick={()=>onStep(-ZOOM_STEP)}
        disabled={zoom <= ZOOM_MIN}
        title="Zoom out (Ctrl/Cmd -)"><IcMinus size={12}/></button>
      <input
        type="range"
        min={ZOOM_MIN}
        max={ZOOM_MAX}
        step={ZOOM_STEP}
        value={zoom}
        onChange={e => onZoomChange(+e.target.value)}/>
      <button
        className="icon-btn"
        style={{ width:24, height:24 }}
        onClick={()=>onStep(+ZOOM_STEP)}
        disabled={zoom >= ZOOM_MAX}
        title="Zoom in (Ctrl/Cmd +)"><IcPlus size={12}/></button>
      <span className="zoom-bar-value">{pct}%</span>
      <button
        className="btn btn-xs"
        onClick={onReset}
        disabled={zoom === 1}
        title="Reset zoom (Ctrl/Cmd 0)">1:1</button>
    </div>
  );
}

// ── Switch (reusable pill on/off toggle) ──────────────────────────────────
export function Switch({ checked, onChange, label, title }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className="switch"
      title={title}
      onClick={() => onChange(!checked)}>
      <span className="switch-track"><span className="switch-knob"/></span>
      {label && <span className="switch-label">{label}</span>}
    </button>
  );
}

// ── Editor shell ──────────────────────────────────────────────────────────
// The studio layout pieces (.ed-* in the stylesheet). None of them know what
// craft they're editing: each studio hands in its own tools, panels and stats.
export function edSwatchStyle(c) {
  if (!c) return undefined;
  const src = c.thumb || (c.image && (fabricThumbFor(c.image) || c.image));
  return src ? { backgroundImage: `url(${src})`, backgroundColor: c.hex } : { background: c.hex };
}

export function EdSwatch({ color, active = false, onClick, title, className = '' }) {
  const name = title ?? color?.name;
  return (
    <button type="button" className={`ed-swatch${active ? ' is-active' : ''}${className ? ` ${className}` : ''}`}
      style={edSwatchStyle(color)} title={name} aria-label={name} aria-pressed={active}
      onClick={onClick}/>
  );
}

// Full-color panel icons for the rail and tab bar, drawn on a 32 grid in icons/.
export function EdNavIcon({ name, size = 28 }) {
  return <img className="ed-nav-img" src={`icons/${name}.svg`} alt="" width={size} height={size} draggable="false"/>;
}

// Icon + label buttons: the desktop rail and the mobile tab bar. `{ spacer }`
// items push the rest to the far end.
export function EdNav({ className, label, items, active, onSelect }) {
  return (
    <nav className={className} aria-label={label}>
      {items.map(it => it.spacer ? <div key={it.id} className="ed-rail-spacer"/> : (
        <button key={it.id} type="button" className={`ed-nav-btn${active === it.id ? ' is-active' : ''}`}
          aria-pressed={active === it.id} data-ed-nav={it.id} title={it.title || it.label}
          onClick={() => onSelect(it.id)}>
          <span className="ed-nav-ic">{it.icon}</span>
          <span>{it.label}</span>
        </button>
      ))}
    </nav>
  );
}

export function EdTools({ className, tools, tool, onTool }) {
  return (
    <div className={className} role="toolbar" aria-label="Tools">
      {tools.map(t => (
        <button key={t.id} type="button" className="icon-btn" aria-pressed={tool === t.id}
          data-ed-tool={t.id} title={t.key ? `${t.label} (${t.key})` : t.label} aria-label={t.label}
          onClick={() => onTool(t.id)}>
          {t.icon}
        </button>
      ))}
    </div>
  );
}

function EdPanelHead({ title, onClose }) {
  return (
    <div className="ed-panel-head">
      <div className="ed-panel-title">{title}</div>
      {onClose && (
        <button type="button" className="icon-btn" onClick={onClose} title="Close" aria-label="Close">
          <IcX/>
        </button>
      )}
    </div>
  );
}

// Matches the longest exit animation on .ed-panel / .ed-sheet.
const ED_PANEL_EXIT_MS = 220;

// Keeps a panel mounted through its exit animation, showing what it last held.
function useLingeringPanel(open, props) {
  const reduced = usePrefersReducedMotion();
  const last = useRef(props);
  if (open) last.current = props;
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) { setMounted(true); return; }
    if (reduced) { setMounted(false); return; }
    const t = setTimeout(() => setMounted(false), ED_PANEL_EXIT_MS);
    return () => clearTimeout(t);
  }, [open, reduced]);
  return { shown: open || mounted, closing: !open && mounted, ...last.current };
}

// Desktop: a column between the canvas and the rail.
// `footer` sits under the scrolling body, so it stays in view however long the panel is.
export function EdPanel({ open, id, title, onClose, footer, children }) {
  const p = useLingeringPanel(open, { id, title, onClose, footer, children });
  if (!p.shown) return null;
  return (
    <aside className={`ed-panel${p.closing ? ' is-closing' : ''}`} aria-label={p.title}
      data-ed-panel={p.closing ? undefined : p.id} aria-hidden={p.closing || undefined}>
      <EdPanelHead title={p.title} onClose={p.onClose}/>
      <div className="ed-panel-body" key={p.id}>{p.children}</div>
      {p.footer}
    </aside>
  );
}

// Mobile: the same panel content as a sheet over the stage, above the tab bar.
export function EdSheet({ open, id, title, onClose, footer, children }) {
  const p = useLingeringPanel(open, { id, title, onClose, footer, children });
  useEffect(() => {
    if (!open) return;
    const onKey = e => { if (e.key === 'Escape' && !studioCovered()) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!p.shown) return null;
  const cls = p.closing ? ' is-closing' : '';
  return (
    <>
      <div className={`ed-scrim${cls}`} onClick={p.onClose}/>
      <div className={`ed-sheet${cls}`} role="dialog" aria-label={p.title}
        data-ed-panel={p.closing ? undefined : p.id} aria-hidden={p.closing || undefined}>
        <div className="ed-handle"/>
        {p.title && <EdPanelHead title={p.title} onClose={p.onClose}/>}
        <div className="ed-panel-body" key={p.id}>{p.children}</div>
        {p.footer}
      </div>
    </>
  );
}

// ── Guided setup ──────────────────────────────────────────────────────────
// The studio opens on the first step's panel and walks `steps` in order
// ({ id, title, next } each, `id` being a panel id). Closing the panel, or
// opening one outside the guide other than Help, hands over to free editing.
// `steps` must keep its identity between renders.
const ED_GUIDE_ADVANCE_MS = 380;
export function useEdGuide({ steps, enabled, panel, setPanel }) {
  const [on, setOn] = useState(enabled);
  useEffect(() => {
    if (on && panel !== 'help' && !steps.some(s => s.id === panel)) setOn(false);
  }, [on, panel, steps]);
  const timerRef = useRef(null);
  useEffect(() => () => clearTimeout(timerRef.current), []);
  const cancel = useCallback(() => clearTimeout(timerRef.current), []);
  // After a step's main choice, move on a beat later (long enough to see the
  // choice land), unless the maker has already gone elsewhere.
  const advance = useCallback(from => {
    const next = steps[steps.findIndex(s => s.id === from) + 1];
    if (!next) return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setPanel(p => p === from ? next.id : p), ED_GUIDE_ADVANCE_MS);
  }, [steps, setPanel]);
  const end = useCallback(() => { clearTimeout(timerRef.current); setOn(false); }, []);
  const step = on ? steps.findIndex(s => s.id === panel) : -1;
  return { on, step, advance, cancel, end };
}

export function EdGuideFooter({ steps, step, onBack, onNext }) {
  return (
    <div className="ed-guide">
      <div className="ed-guide-progress" aria-hidden="true">
        {steps.map((s, i) => <span key={s.id} className={`ed-guide-seg${i <= step ? ' is-on' : ''}`}/>)}
      </div>
      <div className="ed-guide-row">
        <span className="ed-guide-count">Step {step + 1} of {steps.length}</span>
        {step > 0 && <button type="button" className="btn" onClick={onBack}>Back</button>}
        <button type="button" className="btn btn-dark" data-ed-guide-next onClick={onNext}>{steps[step].next}</button>
      </div>
    </div>
  );
}

// Named palettes ({ name, colors }) as strips, for the guide's color step.
export function EdPaletteStarters({ palettes, activeName, onApply, shownAtFirst = 6 }) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? palettes : palettes.slice(0, shownAtFirst);
  return (
    <>
      <div className="ed-label">Start from a palette</div>
      <div className="ed-pal-grid ed-keep-sel">
        {shown.map(p => (
          <button key={p.name} type="button" className={`ed-pal${activeName === p.name ? ' is-active' : ''}`}
            aria-pressed={activeName === p.name} data-ed-palette={p.name} onClick={() => onApply(p.colors)}>
            <span className="ed-pal-strip">
              {p.colors.map((c, i) => <span key={`${c.code || c.name}-${i}`} style={{ background: c.hex }}/>)}
            </span>
            <span className="ed-pal-name">{p.name}</span>
          </button>
        ))}
      </div>
      {palettes.length > shownAtFirst && (
        <button type="button" className="ed-link ed-pal-more" onClick={() => setShowAll(v => !v)}>
          {showAll ? 'Show fewer' : `Show all ${palettes.length}`}
        </button>
      )}
      <div className="ed-hr"/>
    </>
  );
}

// Whether the studios show the current tool's tip under the design. One setting
// for every studio, remembered on this device.
const SHOW_TIPS_KEY = 'metime.studio.showTips';
export function useShowTips() {
  const [show, setShow] = useState(() => {
    try { return localStorage.getItem(SHOW_TIPS_KEY) !== 'off'; } catch { return true; }
  });
  const update = useCallback(v => {
    setShow(v);
    try { localStorage.setItem(SHOW_TIPS_KEY, v ? 'on' : 'off'); } catch { /* private mode */ }
  }, []);
  return [show, update];
}

export function EdHintBubble({ text, onHide }) {
  return (
    <div className="ed-hint-bubble ed-float" role="status">
      <span className="ed-hint-ic" aria-hidden="true"><IcHelp size={14}/></span>
      <span className="ed-hint-text">{text}</span>
      <button type="button" className="ed-hint-x" onClick={onHide}
        title="Hide tips (turn them back on in Help)" aria-label="Hide tips"><IcX size={10}/></button>
    </div>
  );
}

// A compact trigger in the palette bar that opens its choices in a menu below.
// Any button picked in the menu closes it. The menu goes to <body> because the
// bar is centered with a transform, which would throw off fixed positioning.
export function EdMenuButton({ trigger, label, title, menuLabel, width = 240, btnRef, children }) {
  const ownRef = useRef(null);
  const ref = btnRef || ownRef;
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button ref={ref} type="button" className={`ed-menu-btn${open ? ' is-open' : ''}`}
        aria-haspopup="true" aria-expanded={open} aria-label={label} title={title || label}
        onClick={() => setOpen(v => !v)}>
        {trigger}
        <IcChevD size={10}/>
      </button>
      {open && createPortal(
        <Popover anchorRef={ref} onClose={close} placement="bottom-center" width={width}>
          <div className="ed-menu-body" onClick={e => { if (e.target.closest('button')) close(); }}>
            {menuLabel && <div className="ed-menu-label">{menuLabel}</div>}
            {children}
          </div>
        </Popover>,
        ref.current?.closest('.ed-app') || document.body)}
    </>
  );
}

export function EdTipsSwitch({ checked, onChange }) {
  return (
    <div className="ed-tips-switch">
      <Switch checked={checked} onChange={onChange} label="Show tips under the design"/>
    </div>
  );
}

// Zoom 1 means "fit": the whole design in view.
export function EdZoomPill({ zoom, onStep, onFit }) {
  return (
    <div className="ed-zoom-pill">
      <button type="button" onClick={() => onStep(-ZOOM_STEP)} disabled={zoom <= ZOOM_MIN} aria-label="Zoom out" title="Zoom out"><IcMinus/></button>
      <button type="button" className="ed-zoom-val" onClick={onFit} title="Fit to screen">{Math.round(zoom * 100)}%</button>
      <button type="button" onClick={() => onStep(+ZOOM_STEP)} disabled={zoom >= ZOOM_MAX} aria-label="Zoom in" title="Zoom in"><IcPlus/></button>
    </div>
  );
}

export function EdZoomControls({ zoom, onZoom, onStep, onFit }) {
  return (
    <div className="ed-zoom">
      <button type="button" className="icon-btn" onClick={() => onStep(-ZOOM_STEP)} disabled={zoom <= ZOOM_MIN}
        title="Zoom out (⌘−)" aria-label="Zoom out"><IcMinus size={12}/></button>
      <input type="range" min={ZOOM_MIN} max={ZOOM_MAX} step={ZOOM_STEP} value={zoom} aria-label="Zoom"
        onChange={e => onZoom(+e.target.value)}/>
      <button type="button" className="icon-btn" onClick={() => onStep(+ZOOM_STEP)} disabled={zoom >= ZOOM_MAX}
        title="Zoom in (⌘+)" aria-label="Zoom in"><IcPlus size={12}/></button>
      <span className="ed-zoom-val">{Math.round(zoom * 100)}%</span>
      <button type="button" className="btn btn-xs" onClick={onFit} disabled={zoom === 1} title="Fit the whole design (⌘0)">Fit</button>
    </div>
  );
}

// A tappable list row: swatch, title, detail line, value on the right.
export const EdRow = React.forwardRef(function EdRow({ swatch, title, name, sub, value, action, onClick, onSwatchClick, expanded }, ref) {
  return (
    <button ref={ref} type="button" className="ed-row" onClick={onClick} aria-expanded={expanded}>
      <span className={`ed-row-sw${swatch ? '' : ' is-empty'}`} style={edSwatchStyle(swatch)}
        title={onSwatchClick ? 'View fabric large' : undefined}
        onClick={onSwatchClick ? e => { e.stopPropagation(); onSwatchClick(); } : undefined}/>
      <span className="ed-row-main">
        <span className="ed-row-title">{title}{name && <span className="ed-row-name"> · {name}</span>}</span>
        {sub && <span className="ed-row-sub">{sub}</span>}
      </span>
      {value != null && <span className="ed-row-value">{value}</span>}
      {action && <span className="ed-row-action">{action}</span>}
    </button>
  );
});

export function EdSlider({ label, display, value, min, max, step = 1, onChange }) {
  return (
    <div>
      <div className="ed-slider-head">
        <span className="ed-label">{label}</span>
        <span className="ed-slider-val">{display}</span>
      </div>
      <input type="range" className="ed-range" min={min} max={max} step={step} value={value} aria-label={label}
        onChange={e => onChange(+e.target.value)}/>
    </div>
  );
}

// The mobile ⋯ sheet: studio actions, then the account. Items close the sheet
// unless they set `keepOpen` (Help swaps the sheet's content instead).
export function EdMenu({ items, onClose }) {
  const auth = useAuth();
  const user = auth && auth.user;
  return (
    <div className="studio-menu" role="menu">
      {items.map(it => (
        <button key={it.id} type="button" className="studio-menu-item" role="menuitem" disabled={it.disabled}
          style={it.disabled ? { opacity: 0.45, cursor: 'default' } : undefined}
          onClick={() => { if (!it.keepOpen) onClose(); it.onClick(); }}>
          <span className="studio-menu-icon" aria-hidden="true">{it.icon}</span>
          <span className="studio-menu-label">{it.label}</span>
          {it.meta != null && <span className="studio-menu-meta">{it.meta}</span>}
        </button>
      ))}
      {user && (
        <>
          <div className="studio-menu-sep" role="separator"/>
          <div className="studio-menu-email" title={user.email}>{user.email}</div>
          <button type="button" className="studio-menu-item" role="menuitem"
            onClick={() => { onClose(); auth.signOut(); }}>
            <span className="studio-menu-icon" aria-hidden="true"><IcLogout/></span>
            <span className="studio-menu-label">Sign out</span>
          </button>
        </>
      )}
    </div>
  );
}

// Palette swatches with an Edit mode for removing them, and a + into the library.
export function EdPaletteEditor({ pinned, setPinned, isActive, onPick, onAdd, addLabel }) {
  const [editing, setEditing] = useState(false);
  const addRef = useRef(null);
  useEffect(() => { if (!pinned.length) setEditing(false); }, [pinned.length]);
  const remove = i => setPinned(p => p.filter((_, j) => j !== i));
  return (
    <>
      <div className="ed-label">
        <span>My palette</span>
        {pinned.length > 0 && (
          <button type="button" className="ed-link" onClick={() => setEditing(v => !v)}>{editing ? 'Done' : 'Edit'}</button>
        )}
      </div>
      <div className="ed-swatch-grid ed-keep-sel">
        {pinned.map((c, i) => (
          <div key={`${c.code || c.name}-${i}`} style={{ position: 'relative' }}>
            <EdSwatch color={c} active={!editing && isActive(c)}
              title={c.code ? `${c.code} · ${c.name}` : c.name}
              onClick={() => editing ? remove(i) : onPick(c)}/>
            {editing && (
              <button type="button" className="ed-swatch-rm" aria-label={`Remove ${c.name}`}
                onClick={() => remove(i)}><IcX size={8}/></button>
            )}
          </div>
        ))}
        <button ref={addRef} type="button" className="ed-swatch ed-swatch-add"
          onClick={() => onAdd(addRef)} title={addLabel} aria-label={addLabel}>
          <IcPlus/>
        </button>
      </div>
    </>
  );
}

export function EdStatCards({ items }) {
  return (
    <div className="ed-statcards">
      {items.map(it => (
        <div key={it.k} className="ed-statcard">
          <div className="ed-statcard-k">{it.k}</div>
          <div className="ed-statcard-v">{it.v}</div>
        </div>
      ))}
    </div>
  );
}
