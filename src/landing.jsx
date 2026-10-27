import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  deleteCloudDesign, formatKitPrice, loadSavedPunch, loadSavedQuilts, loadSavedStitches,
  persistSavedPunch, persistSavedQuilts, persistSavedStitches, upsertCloudDesign, useAuth,
  useKitPrices,
} from './services.jsx';
import { deserializeGrid } from './design-model.jsx';
import { IcArrowL, IcArrowR, IcChevD, IcSearch, IcSwap } from './icons.jsx';
import { IntroOverlay, IntroTitle, shouldPlayIntro, useLandingIntro } from './landing-intro.jsx';
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
// `tone="olive"` is the landing page's sticky colour bar; `children` sit
// before the account control.
export function BrandNav({ tone, children }) {
  return (
    <header className={`brand-nav brand-bleed${tone ? ` tone-${tone}` : ''}`}>
      <a className="brand-nav-logo" href="/" aria-label="metime home">
        <img src="assets/metime-logo.svg" alt="metime" width="104" height="35"/>
      </a>
      <div className="brand-nav-right">
        {children}
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

// Saved designs on the landing page: a collapsible library with craft tabs,
// search and sort, laid out as a grid of tiles.
const SAVED_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'quilt', label: 'Quilts' },
  { id: 'stitch', label: 'Cross-stitch' },
  { id: 'punch', label: 'Punch needle' },
];
const SAVED_META = { quilt: 'Quilt', stitch: 'Cross-stitch', punch: 'Punch needle' };
const SAVED_DRAWERS = {
  quilt: { type: 'quilt', load: loadSavedQuilts, persist: persistSavedQuilts },
  stitch: { type: 'cross-stitch', load: loadSavedStitches, persist: persistSavedStitches },
  punch: { type: 'punch-needle', load: loadSavedPunch, persist: persistSavedPunch },
};
const SAVED_SORT_LABEL = { recent: 'Last edited', name: 'Name A–Z' };
const SAVED_OPEN_KEY = 'metime.savedOpen';
function savedMetaLine(it) {
  if (it._type === 'quilt') return `Quilt · ${it.fw}" × ${it.fh}"`;
  const n = it.colorsUsed;
  return `${SAVED_META[it._type]} · ${n} color${n !== 1 ? 's' : ''}`;
}
function readSavedOpen() {
  try { return localStorage.getItem(SAVED_OPEN_KEY) !== '0'; } catch (e) { return true; }
}

// The design sits on a cream tile at its own aspect ratio, filling at most 72%
// of the tile either way.
function SavedArt({ it }) {
  const cells = useMemo(() => it._type === 'quilt' ? null : deserializeGrid(it.grid, it.w * it.h), [it]);
  const cols = it._type === 'quilt' ? it.cols : it.w, rows = it._type === 'quilt' ? it.rows : it.h;
  const ar = cols / rows;
  const size = { width: `${ar >= 1 ? 72 : 72 * ar}%`, height: `${ar >= 1 ? 72 / ar : 72}%` };
  return (
    <span className="saved-art" style={size}>
      {it._type === 'quilt'
        ? <SavedQuiltThumb q={it}/>
        : <StitchThumb w={it.w} h={it.h} cells={cells} size={260} bg={(it.fabric && it.fabric.hex) || '#FFFFFF'}/>}
    </span>
  );
}

function SavedTileMenu({ onOpen, onCopy, onDelete, onClose }) {
  const ref = useRef(null);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    const onDoc = e => { if (ref.current && !ref.current.parentNode.contains(e.target)) onClose(); };
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [onClose]);
  return (
    <div className="saved-menu" role="menu" ref={ref}>
      {confirming ? (
        <>
          <div className="saved-menu-note">Delete this design for good?</div>
          <button type="button" role="menuitem" className="saved-menu-item" onClick={() => setConfirming(false)}>Cancel</button>
          <button type="button" role="menuitem" className="saved-menu-item is-danger" onClick={onDelete}>Delete</button>
        </>
      ) : (
        <>
          <button type="button" role="menuitem" className="saved-menu-item" onClick={onOpen}>Open</button>
          <button type="button" role="menuitem" className="saved-menu-item" onClick={onCopy}>Make a copy</button>
          <button type="button" role="menuitem" className="saved-menu-item is-danger" onClick={() => setConfirming(true)}>Delete</button>
        </>
      )}
    </div>
  );
}

function SavedDesigns({ onOpen, open, setOpen, sectionRef }) {
  const auth = useAuth();
  const libraryOn = !!(auth && auth.libraryOn);
  const cloudOn = !!(auth && auth.cloudEnabled && auth.user);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('recent');
  const [menuFor, setMenuFor] = useState(null);
  const [edits, setEdits] = useState(0);
  const [error, setError] = useState('');
  // A sync can leave the same design in a drawer twice, and old designs may
  // have no id, so tiles get their own unique _key: React reusing the wrong
  // tile is what made the tabs and sort leave stale designs behind.
  const items = useMemo(() => {
    if (!libraryOn) return [];
    const all = Object.entries(SAVED_DRAWERS)
      .flatMap(([type, d]) => d.load().map((it, i) => ({ ...it, _type: type, _index: i })))
      .sort((a, b) => (b.updatedAt || b.id || 0) - (a.updatedAt || a.id || 0));
    const seen = new Set();
    const out = [];
    for (const it of all) {
      const same = it.id == null ? null : `${it._type}-${it.id}-${it.apiId || ''}`;
      if (same && seen.has(same)) continue;
      if (same) seen.add(same);
      out.push({ ...it, _key: same || `${it._type}-${it._index}` });
    }
    return out;
  }, [libraryOn, auth && auth.libraryTick, edits]);
  if (!libraryOn || !items.length) return null;

  const q = query.trim().toLowerCase();
  let visible = items.filter(it => (filter === 'all' || it._type === filter) && (!q || (it.name || '').toLowerCase().includes(q)));
  if (sort === 'name') visible = visible.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const keyOf = it => it._key;
  // The tile's own entry, plus any hidden twin of it.
  const isDesign = (x, i, it) => i === it._index
    || (it.id != null && x.id === it.id && (x.apiId || '') === (it.apiId || ''));

  const remove = it => {
    const d = SAVED_DRAWERS[it._type];
    d.persist(d.load().filter((x, i) => !isDesign(x, i, it)));
    if (cloudOn && it.apiId) deleteCloudDesign(it.apiId).catch(e => console.warn('Could not delete from your account:', e));
    setMenuFor(null); setEdits(n => n + 1);
  };
  // A copy goes to the account first when there is one, the same order the
  // studios save in, so it never exists only on this device by accident.
  const copy = async it => {
    setMenuFor(null); setError('');
    const d = SAVED_DRAWERS[it._type];
    const { _type, _index, _key, apiId, ...rest } = it;
    const now = Date.now();
    let record = { ...rest, id: now, name: `${it.name || 'Untitled'} copy` };
    if (cloudOn) {
      try { record = { ...record, apiId: await upsertCloudDesign(d.type, record) }; }
      catch (e) {
        console.warn('Could not copy to your account:', e);
        setError("Couldn't make a copy in your account. Check your connection and try again.");
        return;
      }
    }
    d.persist([record, ...d.load()]);
    setEdits(n => n + 1);
  };

  return (
    <section className="saved-sec brand-bleed" id="saved" ref={sectionRef}>
      <button className="saved-head" type="button" onClick={() => setOpen(!open)} aria-expanded={open}>
        <h2 className="saved-head-title">Saved Designs</h2>
        <span className="saved-count">{items.length}</span>
        <span className={`saved-chev${open ? ' is-open' : ''}`} aria-hidden="true"><IcChevD size={16}/></span>
      </button>
      {open && (
        <>
          <div className="saved-toolbar">
            <div className="saved-tabs" role="tablist" aria-label="Filter saved designs">
              {SAVED_FILTERS.map(f => (
                <button key={f.id} type="button" role="tab" aria-selected={filter === f.id}
                  className={`saved-tab${filter === f.id ? ' is-on' : ''}`}
                  onClick={() => setFilter(f.id)}>{f.label}</button>
              ))}
            </div>
            <div className="saved-tools">
              <label className="saved-search">
                <IcSearch size={15}/>
                <input type="search" value={query} onChange={e => setQuery(e.target.value)}
                  placeholder="Search designs" aria-label="Search designs"/>
              </label>
              <button type="button" className="saved-sort" onClick={() => setSort(s => s === 'recent' ? 'name' : 'recent')}>
                <span className="saved-sort-icon" aria-hidden="true"><IcSwap size={15}/></span>
                {SAVED_SORT_LABEL[sort]}
              </button>
            </div>
          </div>
          {error && <div className="saved-error" role="alert">{error}</div>}
          <div className="saved-grid">
            {visible.map(it => (
              <div key={keyOf(it)} className="saved-item">
                <button className="saved-card" type="button" title="Open on canvas" onClick={() => onOpen(it._type, it)}>
                  <span className="saved-thumb"><SavedArt it={it}/></span>
                  <span className="saved-card-text">
                    <span className="saved-name">{it.name}</span>
                    <span className="saved-meta">{savedMetaLine(it)}</span>
                  </span>
                </button>
                <button type="button" className="saved-more" aria-label={`More options for ${it.name}`}
                  aria-haspopup="menu" aria-expanded={menuFor === keyOf(it)}
                  onClick={() => setMenuFor(m => m === keyOf(it) ? null : keyOf(it))}>
                  <span/><span/><span/>
                </button>
                {menuFor === keyOf(it) && (
                  <SavedTileMenu onOpen={() => onOpen(it._type, it)} onCopy={() => copy(it)}
                    onDelete={() => remove(it)} onClose={() => setMenuFor(null)}/>
                )}
              </div>
            ))}
          </div>
          {visible.length === 0 && (
            <div className="saved-empty">
              {q ? `No designs match “${query.trim()}”.` : `No ${SAVED_FILTERS.find(f => f.id === filter).label.toLowerCase()} saved yet.`}
            </div>
          )}
        </>
      )}
    </section>
  );
}

// Store policies live on the Shopify storefront, at Shopify's standard paths.
const FOOTER_LINKS = [
  { label: 'Terms', href: 'https://shop.makemetime.com/policies/terms-of-service' },
  { label: 'Privacy policy', href: 'https://shop.makemetime.com/policies/privacy-policy' },
  { label: 'Shipping and returns', href: 'https://shop.makemetime.com/policies/shipping-policy' },
  { label: 'Contact', href: 'https://shop.makemetime.com/pages/contact' },
];

export function LandFooter() {
  return (
    <footer className="land-footer brand-bleed">
      <div className="land-footer-top">
        <img className="land-footer-logo" src="assets/metime-logo.svg" alt="metime" width="72" height="24"/>
      </div>
      <div className="land-footer-bottom">
        <nav className="land-footer-links" aria-label="Store information">
          {FOOTER_LINKS.map(l => <a key={l.label} href={l.href}>{l.label}</a>)}
        </nav>
        <span className="land-footer-copy">© 2026 metime</span>
      </div>
    </footer>
  );
}

// Each craft card carries its own colour field: grapefruit, golden and ice.
const CRAFT_TONE = { 'cross-stitch': 'grapefruit', quilt: 'golden', 'punch-needle': 'ice' };

// "$26 – $52": the cheapest and dearest kit of a craft, or one price when
// they're the same. Null until the store answers, or when it can't.
function kitPriceRange(prices) {
  const kits = Object.values(prices).filter(k => k && Number.isFinite(k.amount));
  if (!kits.length) return null;
  const lo = kits.reduce((a, k) => (k.amount < a.amount ? k : a));
  const hi = kits.reduce((a, k) => (k.amount > a.amount ? k : a));
  return lo.amount === hi.amount ? formatKitPrice(lo) : `${formatKitPrice(lo)} – ${formatKitPrice(hi)}`;
}

// The range shows as a pill under the description, and on phones moves into
// the Start designing band so the horizontal cards don't grow taller.
function CraftCard({ c, onSelect }) {
  const range = kitPriceRange(useKitPrices(c.ready ? c.id : null));
  return (
    <div
      className={`land-craft tone-${CRAFT_TONE[c.id] || 'cream'}${c.ready ? '' : ' is-soon'}`}
      role="button" tabIndex={c.ready ? 0 : -1} aria-disabled={!c.ready}
      aria-label={c.ready ? `Start ${c.name}${range ? `, kits ${range}` : ''}` : `${c.name}, coming soon`}
      onClick={() => c.ready && onSelect(c.id)}
      onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && c.ready) { e.preventDefault(); onSelect(c.id); } }}>
      <div className="land-craft-visual">
        <img src={c.image} alt="" width={c.imgW} height={c.imgH} loading="eager" decoding="async" fetchpriority="high"/>
      </div>
      <div className="land-craft-name">{c.name}</div>
      <div className="land-craft-desc">{c.ready ? c.desc : 'Coming soon'}</div>
      {range && <div className="land-craft-price">{range}</div>}
      {c.ready && (
        <div className="land-craft-cta">
          <span className="land-craft-wave" aria-hidden="true"/>
          <span className="land-craft-cta-bar">
            Start designing
            {range && <span className="land-craft-cta-price">{range}</span>}
            <span className="land-craft-arrow" aria-hidden="true"><IcArrowR size={20}/></span>
          </span>
        </div>
      )}
    </div>
  );
}

// Whether the nav should offer "My designs": the library is on and holds something.
export function useHasSavedDesigns() {
  const auth = useAuth();
  return useMemo(() => !!(auth && auth.libraryOn)
    && Object.values(SAVED_DRAWERS).some(d => d.load().length > 0),
  [auth && auth.libraryOn, auth && auth.libraryTick]);
}

// `startAtSaved` opens the page on the saved designs, for "My designs" pressed
// on another screen.
export function CraftSelector({ onSelect, onOpenSaved, startAtSaved }) {
  const [intro, setIntro] = useState(() => !startAtSaved && shouldPlayIntro());
  const pageRef = useRef(null), trackRef = useRef(null), stageRef = useRef(null);
  const afterIntro = useRef(null);
  const skipIntro = useLandingIntro({
    active: intro, pageRef, trackRef, stageRef,
    onDone: excess => { afterIntro.current = excess; setIntro(false); },
  });
  // The track is gone now, so take its height back off the scroll position and
  // the craft picker stays exactly where it was.
  useLayoutEffect(() => {
    if (intro || afterIntro.current == null) return;
    pageRef.current.scrollTop = afterIntro.current;
    afterIntro.current = null;
  }, [intro]);
  const [savedOpen, setSavedOpenState] = useState(() => !!startAtSaved || readSavedOpen());
  const savedRef = useRef(null);
  const setSavedOpen = v => {
    setSavedOpenState(v);
    try { localStorage.setItem(SAVED_OPEN_KEY, v ? '1' : '0'); } catch (e) { /* ignore */ }
  };
  useLayoutEffect(() => {
    if (startAtSaved && savedRef.current) savedRef.current.scrollIntoView({ block: 'start' });
  }, []);
  const hasSaved = useHasSavedDesigns();
  const goToSaved = e => {
    e.preventDefault();
    setSavedOpen(true);
    requestAnimationFrame(() => savedRef.current && savedRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  return (
    <div className={`land-page brand-shell${intro ? ' is-intro' : ''}`} ref={pageRef}>
      {intro && <IntroOverlay onSkip={skipIntro}/>}
      <div className="land-fill">
      <BrandNav tone="olive">
        {hasSaved && <a className="land-nav-link" href="#saved" onClick={goToSaved}>My designs</a>}
      </BrandNav>
      <div className="land-track" ref={trackRef}>
        <main className="land-main brand-bleed" ref={stageRef}>
          <div className="land-hero">
            <BrandEyebrow plain label="Design your craft. We send the materials. You make it."/>
            {intro ? <IntroTitle text="What are you making?"/> : <h1 className="land-title">What are you making?</h1>}
            <p className="land-sub">Pick a craft and design it on screen. metime works out the colors, counts and materials, so you can get straight to making.</p>
          </div>
          <div className="land-crafts">
            {CRAFTS.map(c => <CraftCard key={c.id} c={c} onSelect={onSelect}/>)}
          </div>
        </main>
      </div>
      <SavedDesigns onOpen={onOpenSaved} open={savedOpen} setOpen={setSavedOpen} sectionRef={savedRef}/>
      <LandFooter/>
      </div>
    </div>
  );
}
