import { useMemo, useState } from 'react';
import { loadSavedPunch, loadSavedQuilts, loadSavedStitches, useAuth } from './services.jsx';
import { deserializeGrid } from './design-model.jsx';
import { IcArrowL, IcArrowR, IcChevD } from './icons.jsx';
import { CRAFTS, LandingAuth } from './account.jsx';
import { StitchThumb } from './stitch-studio.jsx';

// ── Brand system ───────────────────────────────────────────────────────────
// Shared presentation furniture for the pages outside the studios (the craft
// picker and the kit review). All of it is styled by the `.brand-shell` layer at
// the end of the stylesheet, and a screen opts in by putting `brand-shell` on its
// page root. The two studios never do, which is what keeps the editor's type,
// density and controls out of reach of these styles.

const BRAND_NOTE = 'Craft design, made material';
export const BRAND_CRAFT_LABEL = { 'cross-stitch': 'Cross-stitch', 'punch-needle': 'Punch needle', quilt: 'Quilting' };
// metime's wiggle: the thread mark carried under the wordmark. Built from
// alternating quadratic arcs rather than shipped as a fixed file so one
// component covers any width — pass the cycle count and let CSS set the height.
function BrandWiggle({ cycles = 5, className = '' }) {
  const unit = 40, amp = 22, h = 30, mid = h / 2;
  let d = `M 0 ${mid}`;
  for (let i = 0; i < cycles * 2; i++) d += ` q ${unit / 4} ${i % 2 ? amp : -amp} ${unit / 2} 0`;
  return (
    <svg className={`brand-wiggle ${className}`.trim()} viewBox={`0 0 ${cycles * unit} ${h}`}
      width={cycles * unit} height={h} fill="none" aria-hidden="true" focusable="false">
      <path d={d} stroke="currentColor" strokeWidth="7" strokeLinecap="round"/>
    </svg>
  );
}

// Stitch X — a restrained separator and margin detail. Decoration only: always
// aria-hidden, and inert via CSS so it can't take a click. Deliberately only
// ever rendered in rules and footers, never on or beside a dismissable
// surface, so it can't be misread as a close button.
function BrandX({ size = 11 }) {
  return (
    <svg className="brand-x" viewBox="0 0 12 12" width={size} height={size} fill="none" aria-hidden="true" focusable="false">
      <path d="M2 2 10 10M10 2 2 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  );
}
function BrandXRule({ count = 3, size = 11 }) {
  return (
    <span className="brand-xrule" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => <BrandX key={i} size={size}/>)}
    </span>
  );
}

// Shared nav. The wordmark is the shipped asset used unmodified — its own
// tomato wiggle is the mark's thread, so no extra wiggle is added beside it.
export function BrandNav() {
  return (
    <header className="brand-nav brand-bleed">
      <a className="brand-nav-logo" href="/" aria-label="metime home">
        <img src="assets/metime-logo.svg" alt="metime" width="104" height="35"/>
      </a>
      <div className="brand-nav-right">
        <LandingAuth/>
      </div>
    </header>
  );
}

// "QUILTING · STEP 2 OF 4" — the small craft + step label above each heading.
// The numeric prefix (01/02) was dropped; the label already includes the step.
export function BrandEyebrow({ step, label, plain }) {
  return (
    <p className={`brand-eyebrow${plain ? ' is-plain' : ''}`}>
      <span>{label}</span>
    </p>
  );
}

// The heading band: one colour field per screen, left-aligned, wiggle beneath
// the title. Height is content-driven so long titles wrap instead of spilling.
//
// `compact` folds the whole thing onto one line, for a screen where the heading
// is orientation rather than the point and every pixel it takes is a pixel off
// the content below.
export function BrandHead({ eyebrow, title, xl, sub, aside, tone = 'cream', back, actions, cycles = 5, wide, compact }) {
  return (
    <section className={`brand-head brand-bleed tone-${tone}${compact ? ' is-compact' : ''}`}>
      {(back || actions) && (
        <div className="brand-head-top">
          {back}
          {actions && <div className="brand-head-top-end">{actions}</div>}
        </div>
      )}
      <div className="brand-head-main">
        <div className={`brand-head-text${wide ? ' is-wide' : ''}`}>
          {!compact && eyebrow}
          <h1 className={`size-title brand-title${xl ? ' is-xl' : ''}`}>{title}</h1>
          {/* On one line the craft reads as an aside after the title rather than
              a label above it, so it moves in the markup too — the eye and the
              screen reader get the same order. */}
          {compact && eyebrow}
          {!compact && <BrandWiggle cycles={cycles} className={`brand-head-wiggle${xl ? ' is-lg' : ''}`}/>}
          {sub && <p className="brand-head-sub">{sub}</p>}
        </div>
        {aside && <div className="brand-head-aside">{aside}</div>}
      </div>
    </section>
  );
}

// Standard back control for the heading band.
export function BrandBack({ onBack }) {
  if (!onBack) return null;
  return (
    <button className="size-back" type="button" onClick={onBack}>
      <span className="size-back-icon" aria-hidden="true">
        <IcArrowL size={14}/>
      </span>
      <span className="size-back-label">Back</span>
    </button>
  );
}

// Label / value rows under hairlines. Rows whose value is missing are dropped
// rather than rendered as an em dash, so a card only ever states real data.
export function BrandSpecs({ rows }) {
  const real = (rows || []).filter(r => r && r.v !== null && r.v !== undefined && r.v !== '');
  if (!real.length) return null;
  // Spans, not divs: these rows render inside <button> product cards, whose
  // content model is phrasing content. CSS gives them their block layout.
  return (
    <span className="brand-specs">
      {real.map(r => (
        <span className="brand-spec" key={r.k}>
          <span className="brand-spec-k">{r.k}</span>
          <span className="brand-spec-v">{r.v}</span>
        </span>
      ))}
    </span>
  );
}

// Flexible paper spacer plus the footer rule. The spacer takes over the job the
// golden band used to do — absorbing leftover viewport height — without
// pretending to be content.
export function BrandFooter() {
  return <div className="brand-spacer" aria-hidden="true"/>;
}

// Tiny SVG preview of a saved quilt (same shape rendering as the "My quilts" list).
export function SavedQuiltThumb({ q }) {
  return (
    <svg viewBox={`0 0 ${q.cols} ${q.rows}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
      {(q.shapes || []).map((s, i) => s.type === 'tri' ? (
        <polygon key={i} points={s.dir === '/' ? (s.half === 'a' ? `${s.c},${s.r} ${s.c+s.w},${s.r} ${s.c},${s.r+s.h}` : `${s.c+s.w},${s.r} ${s.c+s.w},${s.r+s.h} ${s.c},${s.r+s.h}`) : (s.half === 'a' ? `${s.c},${s.r} ${s.c+s.w},${s.r} ${s.c+s.w},${s.r+s.h}` : `${s.c},${s.r} ${s.c},${s.r+s.h} ${s.c+s.w},${s.r+s.h}`)} fill={s.color.hex}/>
      ) : <rect key={i} x={s.c} y={s.r} width={s.w} height={s.h} fill={s.color.hex} stroke="rgba(0,0,0,0.08)" strokeWidth="0.05"/>)}
    </svg>
  );
}

// Collapsible saved-designs band on the landing page (Figma 7:1111).
const SAVED_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'quilt', label: 'Quilts' },
  { id: 'stitch', label: 'Cross-stitch' },
  { id: 'punch', label: 'Punch needle' },
];
const SAVED_META = { quilt: 'Quilt', stitch: 'Cross-stitch', punch: 'Punch needle' };
function savedMetaLine(it) {
  if (it._type === 'quilt') return `Quilt · ${it.fw}" × ${it.fh}"`;
  const n = it.colorsUsed;
  return `${SAVED_META[it._type]} · ${n} color${n !== 1 ? 's' : ''}`;
}
function SavedDesigns({ onOpen }) {
  const auth = useAuth();
  const libraryOn = !!(auth && auth.libraryOn);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('all');
  const items = useMemo(() => {
    if (!libraryOn) return [];
    const quilts = loadSavedQuilts().map(q => ({ ...q, _type: 'quilt' }));
    const stitches = loadSavedStitches().map(d => ({ ...d, _type: 'stitch' }));
    const punch = loadSavedPunch().map(d => ({ ...d, _type: 'punch' }));
    return [...quilts, ...stitches, ...punch].sort((a, b) => (b.updatedAt || b.id || 0) - (a.updatedAt || a.id || 0));
  }, [libraryOn, auth && auth.libraryTick]);
  const visible = filter === 'all' ? items : items.filter(it => it._type === filter);
  if (!libraryOn || !items.length) return null;
  return (
    <div className="saved-sec">
      <div className="saved-toolbar">
        <button className="saved-head" type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}>
          <span className="saved-head-title">Saved Designs <span className="saved-count">{items.length}</span></span>
          <span className={`saved-chev${open ? ' is-open' : ''}`} aria-hidden="true"><IcChevD size={14}/></span>
        </button>
        {open && (
          <div className="saved-filters" role="tablist" aria-label="Filter saved designs">
            {SAVED_FILTERS.map(f => (
              <button key={f.id} type="button" role="tab" aria-selected={filter === f.id}
                className={`saved-filter filter-pill${filter === f.id ? ' is-on' : ''}`}
                onClick={() => setFilter(f.id)}>{f.label}</button>
            ))}
          </div>
        )}
      </div>
      {open && (
        <div className="saved-grid">
          {visible.length === 0 && (
            <div className="saved-empty">No {SAVED_FILTERS.find(f => f.id === filter).label.toLowerCase()} saved yet.</div>
          )}
          {visible.map(it => (
            <button key={it._type + '-' + it.id} className="saved-card" type="button"
              title="Open on canvas"
              onClick={() => onOpen(it._type, it)}>
              <div className="saved-thumb">
                {it._type === 'quilt'
                  ? <SavedQuiltThumb q={it}/>
                  : <StitchThumb w={it.w} h={it.h} cells={deserializeGrid(it.grid, it.w * it.h)} size={260} bg={(it.fabric && it.fabric.hex) || '#FFFFFF'}/>}
              </div>
              <div className="saved-copy">
                <div className="saved-card-text">
                  <div className="saved-name">{it.name}</div>
                  <div className="saved-meta">{savedMetaLine(it)}</div>
                </div>
                <span className="saved-card-arrow" aria-hidden="true">
                  <IcArrowR/>
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function CraftSelector({ onSelect, onOpenSaved }) {
  return (
    <div className="land-page brand-shell">
      <div className="land-fill">
      <BrandNav/>
      <BrandHead
        tone="olive"
        xl
        wide
        cycles={6}
        eyebrow={<BrandEyebrow plain label="Design your craft. We send the materials. You make it."/>}
        title="What are you making?"
        sub="Pick a craft and design it on screen. metime works out the colors, counts and materials, so you can get straight to making."/>
      <div className="land-main">
        <div className="land-crafts">
          {CRAFTS.map((c, i) => (
            <div key={c.id}
              className={c.ready ? "land-craft" : "land-craft is-soon"}
              role="button" tabIndex={c.ready ? 0 : -1} aria-disabled={!c.ready}
              aria-label={c.ready ? `Start ${c.name}` : `${c.name}, coming soon`}
              onClick={() => c.ready && onSelect(c.id)}
              onKeyDown={e => e.key === "Enter" && c.ready && onSelect(c.id)}>
              <div className="land-craft-visual">
                <img src={c.image} alt="" width={c.imgW} height={c.imgH} loading="eager" decoding="async" fetchPriority="high"/>
              </div>
              <div className="land-craft-copy">
                <div className="land-craft-name">{c.name}</div>
                <div className="land-craft-desc-row">
                  <span className="land-craft-desc">{c.ready ? c.desc : "Coming soon"}</span>
                  {c.ready && (
                    <span className="land-craft-arrow" aria-hidden="true">
                      <IcArrowR size={26}/>
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <SavedDesigns onOpen={onOpenSaved}/>
      <BrandFooter/>
      </div>
    </div>
  );
}
