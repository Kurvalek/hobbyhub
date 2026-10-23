// Compact searchable thread picker (anchored popover). Used on the palette
// step to swap a suggested color for a different floss or yarn.
function DmcPicker({ anchorRef, onClose, onPick, craft = 'cross-stitch' }) {
  const cfg = CRAFT_STUDIO[craft];
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const base = s ? cfg.library.filter(c => c.code.toLowerCase().includes(s) || c.name.toLowerCase().includes(s)) : cfg.library;
    return base.slice(0, 240);
  }, [q, cfg]);
  return (
    <Popover anchorRef={anchorRef} onClose={onClose} placement="bottom-start" width={264}>
      <div className="popover-header">
        <span className="popover-title">Pick a {cfg.threadLabel.toLowerCase()}</span>
        <button onClick={onClose} className="icon-btn" style={{ width: 24, height: 24 }} title="Close"><IcX/></button>
      </div>
      <div className="popover-body" style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '60vh', overflowY: 'auto' }}>
        <input type="text" placeholder={`Search ${cfg.codePrefix} code or name…`} value={q} onChange={e => setQ(e.target.value)}/>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 4 }}>
          {list.map((c, i) => (
            <button key={`${c.code}${i}`} className="chip" onClick={() => { onPick(c); onClose(); }} style={{ background: c.hex }} title={`${cfg.codePrefix} ${c.code} · ${c.name}`}/>
          ))}
          {!list.length && <div style={{ gridColumn: '1/-1', fontSize: 12, color: 'var(--warm-muted)', padding: '12px 0', textAlign: 'center' }}>No matches</div>}
        </div>
      </div>
    </Popover>
  );
}

// Compact searchable Kona cotton picker (anchored popover). Quilt equivalent of
// DmcPicker — used on the quilt palette step to swap a suggested fabric color.
function KonaPicker({ anchorRef, onClose, onPick }) {
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const base = s ? KONA.filter(c => c.name.toLowerCase().includes(s)) : KONA;
    return base.slice(0, 240);
  }, [q]);
  return (
    <Popover anchorRef={anchorRef} onClose={onClose} placement="bottom-start" width={264}>
      <div className="popover-header">
        <span className="popover-title">Pick a fabric</span>
        <button onClick={onClose} className="icon-btn" style={{ width: 24, height: 24 }} title="Close"><IcX/></button>
      </div>
      <div className="popover-body" style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '60vh', overflowY: 'auto' }}>
        <input type="text" placeholder="Search Kona color name…" value={q} onChange={e => setQ(e.target.value)}/>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 4 }}>
          {list.map((c, i) => (
            <button key={`${c.name}${i}`} className="chip" onClick={() => { onPick(c); onClose(); }} style={{ background: c.hex }} title={c.name}/>
          ))}
          {!list.length && <div style={{ gridColumn: '1/-1', fontSize: 12, color: 'var(--warm-muted)', padding: '12px 0', textAlign: 'center' }}>No matches</div>}
        </div>
      </div>
    </Popover>
  );
}

// Thumbnails render the actual template output (built at a small size). When a
// palette is supplied it previews the template in those colors, matching what
// the studio will build when the template is selected.
function QuiltTemplateThumb({ tpl, preset, palette }) {
  const cols = 12, rows = Math.max(4, Math.round(12 * (preset.h / preset.w)));
  const shapes = useMemo(() => tpl.build({ cols, rows, palette }), [tpl, cols, rows, palette]);
  return (
    <svg viewBox={`0 0 ${cols} ${rows}`} width="100%" preserveAspectRatio="xMidYMid meet" style={{ display: 'block', background: 'var(--metime-cream)' }}>
      <rect width={cols} height={rows} fill="var(--metime-cream)"/>
      {shapes.map((s, i) => s.type === 'tri'
        ? <polygon key={i} points={tplTriPoints(s)} fill={s.color.hex}/>
        : <rect key={i} x={s.c} y={s.r} width={s.w} height={s.h} fill={s.color.hex}/>)}
      <rect width={cols} height={rows} fill="none" stroke="rgba(0,0,0,0.12)" strokeWidth="0.1"/>
    </svg>
  );
}
function StitchTemplateThumb({ tpl, preset }) {
  // Preview at (roughly) the real stitch resolution so detailed image-derived
  // charts stay legible — capped so huge canvases don't render 14k+ SVG rects.
  const w = Math.min(90, preset.w), h = Math.max(4, Math.round(w * (preset.h / preset.w)));
  const grid = useMemo(() => tpl.build({ w, h }), [tpl, w, h]);
  // A set template builds a mosaic of all four coasters, so the card is bigger
  // than the canvas that was asked for.
  const out = tpl.outSize ? tpl.outSize({ w, h }) : { w, h };
  return (
    <svg viewBox={`0 0 ${out.w} ${out.h}`} width="100%" preserveAspectRatio="xMidYMid meet" style={{ display: 'block' }}>
      {grid.map((hex, i) => hex ? <rect key={i} x={i % out.w} y={Math.floor(i / out.w)} width={1} height={1} fill={hex}/> : null)}
      <rect width={out.w} height={out.h} fill="none" stroke="rgba(0,0,0,0.12)" strokeWidth="0.08"/>
    </svg>
  );
}

// Generic template-step shell (reused by quilt + cross-stitch). Optional
// uploadNode renders a photo bar above the template grid.
function TemplateStep({ title, eyebrow, sub, tone = 'blue', footNote, onBack, templates, renderThumb, onChoose, onSkip, uploadNode, metaOf }) {
  return (
    <div className="tmpl-page brand-shell">
      <BrandNav/>
      <BrandHead
        tone={tone}
        wide
        back={<BrandBack onBack={onBack}/>}
        actions={
          <button type="button" className="back-skip" onClick={onSkip}
            title="Start from a blank canvas">Skip for now</button>
        }
        eyebrow={eyebrow}
        title={title}
        sub={sub}/>
      {uploadNode}
      <div className="tmpl-grid">
        {templates.map((t, i) => {
          // Templates that carry their own grid size preview at that
          // proportion (see .tmpl-card-thumb.is-ratio); the rest keep the
          // fixed-height thumb box.
          const ar = t.w > 0 && t.h > 0 ? t.w / t.h : null;
          return (
            <button key={t.id} type="button" className="tmpl-card" onClick={() => onChoose(t)}
              title={`Use "${t.name}"`} aria-label={`${t.name}. ${t.desc}`}>
              <span className={ar ? 'tmpl-card-thumb is-ratio' : 'tmpl-card-thumb'}
                    style={ar ? { '--tmpl-ar': String(ar) } : undefined}>{renderThumb(t)}</span>
              <span className="tmpl-card-body">
                <span className="tmpl-card-head">
                  <span className="tmpl-card-text">
                    <span className="tmpl-card-name">{t.name}</span>
                    <span className="tmpl-card-desc">{t.desc}</span>
                  </span>
                  <span className="size-card-arrow" aria-hidden="true">
                    <IcArrowR size={26}/>
                  </span>
                </span>
                {metaOf && <BrandSpecs rows={metaOf(t)}/>}
              </span>
            </button>
          );
        })}
      </div>
      <BrandFooter note={footNote}/>
    </div>
  );
}

// Quilt template step (template-only; the photo uploader lives on the palette page).
function TemplateSelector({ preset, palette, onChoose, onSkip, onBack }) {
  const p = PRESETS.find(x => x.name === preset) || PRESETS[0];
  return (
    <TemplateStep
      title="Choose a starting point"
        eyebrow={<BrandEyebrow step={4} label={`Quilting · Step 4 of ${BRAND_STEPS.quilt}`}/>}
      sub="A layout to build on, or a blank canvas. Either way you can change every block once you're in the studio."
      footNote={`Quilting · ${p.label || p.name}`}
      onBack={onBack}
      templates={QUILT_TEMPLATES}
      renderThumb={t => <QuiltTemplateThumb tpl={t} preset={p} palette={palette}/>}
      metaOf={t => [{ k: 'Finished size', v: presetDims(p) }]}
      onChoose={onChoose} onSkip={onSkip}/>
  );
}

// Grid-craft template step: pick a template OR upload a photo. No color
// selection here — the photo is carried forward and all color work (suggested
// palette from the photo, sample palettes) happens on the next (palette) step.
function CrossStitchTemplateSelector({ preset, onChoose, onSkip, onBack, craft = 'cross-stitch' }) {
  const cfg = CRAFT_STUDIO[craft];
  const craftLabel = BRAND_CRAFT_LABEL[craft] || cfg.label;
  const uploadNode = (
    <PhotoDrop
      layout="utility"
      hint="JPG, PNG or WebP. We'll suggest a palette from it on the next step."
      onChoose={(imgSrc, extras) => onChoose({ template: null, photo: imgSrc, removeBg: !extras || extras.removeBg !== false })}/>
  );
  return (
    <TemplateStep
      title="Choose a starting point"
      eyebrow={<BrandEyebrow step={2} label={`${craftLabel} · Step 2 of ${BRAND_STEPS[craft] || 3}`}/>}
      sub={`A chart to build on, your own image, or a blank canvas. Every ${cfg.unit} stays editable in the studio.`}
      footNote={`${craftLabel} · ${preset.name}`}
      onBack={onBack}
      templates={stitchTemplatesFor(preset, craft)}
      renderThumb={t => <StitchTemplateThumb tpl={t} preset={preset}/>}
      metaOf={t => [
        // A set's w/h span the whole mosaic; what the maker stitches is one
        // panel, four times over, so that's what the card quotes.
        t.set
          ? { k: 'Chart', v: `${t.set.w} × ${t.set.h} ${cfg.unitPlural} · set of ${t.set.cols * t.set.rows}` }
          : { k: 'Chart', v: t.w > 0 && t.h > 0 ? `${t.w} × ${t.h} ${cfg.unitPlural}` : null },
      ]}
      uploadNode={uploadNode}
      onChoose={t => onChoose({ template: t, photo: null })}
      onSkip={onSkip}/>
  );
}

// ── Quilt: backing fabric step ─────────────────────────────────────────────
// Ruby Star Society backing fabrics for the quilt "Pick a backing fabric" step.
// HOW IMAGES ARE SOURCED: full-res swatches live under
// assets/fabrics/<collection>/<file>.jpg. Compact 256px thumbs (used by the
// grid, hex sample, and palette extract) live under assets/fabrics-thumbs/ —
// regenerate with `npm run gen:fabric-thumbs`. The list of collections and files
// is generated into assets/fabrics-manifest.js (window.RSS_COLLECTIONS) — see the
// banner in that file for how to regenerate. Each collection carries `cats`
// (theme filters) which every flattened fabric inherits.
// Any card whose image fails to load hides itself (see FabricCard's onError), so
// a broken/missing asset never leaves a broken image or breaks the page.
// TO ADD OR EDIT FABRICS: drop images into assets/fabrics/<collection>/ and
// regenerate the manifest (do not hand-edit the flattened list below).
const FABRIC_CATEGORIES = [
  { id: 'top',      label: 'Top fabrics' },
  { id: 'simple',   label: 'Simple' },
  { id: 'florals',  label: 'Florals' },
  { id: 'animals',  label: 'Animals' },
  { id: 'food',     label: 'Food' },
  { id: 'nature',   label: 'Nature' },
  { id: 'holidays', label: 'Holidays' },
  { id: 'novelty',  label: 'Novelty' },
];
const TOP_FABRIC_LIMIT = 16;
const RUBY_STAR_FABRICS = (window.RSS_COLLECTIONS || []).flatMap(c =>
  c.files.map(f => ({
    name: c.label,
    collection: c.slug,
    cats: c.cats,
    // filenames contain spaces — encode so the URL resolves
    image: encodeURI(`assets/fabrics/${c.slug}/${f}`),
    // Compact 256px JPEG for the grid / hex sample / palette extract
    // (generated by tools/gen-fabric-thumbs.mjs). Falls back to full image
    // if a thumb is missing.
    thumb: encodeURI(`assets/fabrics-thumbs/${c.slug}/${f}`),
  }))
);
// Curated "Top fabrics" row: one swatch from each collection, first 16.
// Placeholder until we have a real featured list.
function pickTopFabrics(list, limit) {
  const seen = new Set(), picks = [];
  for (const f of list) {
    if (seen.has(f.collection)) continue;
    seen.add(f.collection);
    picks.push(f);
    if (picks.length === limit) return picks;
  }
  for (const f of list) {
    if (picks.includes(f)) continue;
    picks.push(f);
    if (picks.length === limit) break;
  }
  return picks;
}
const TOP_FABRICS = pickTopFabrics(RUBY_STAR_FABRICS, TOP_FABRIC_LIMIT);

// Compact 256px JPEG sibling of a full-res fabric URL, or null for uploads /
// data URLs. Lets older saved quilts (no `backing.thumb`) still hit the
// thumbnails generated by tools/gen-fabric-thumbs.mjs.
function fabricThumbFor(image) {
  if (!image || typeof image !== 'string' || image.startsWith('data:')) return null;
  const marker = 'assets/fabrics/';
  const i = image.indexOf(marker);
  if (i === -1 || image.indexOf('assets/fabrics-thumbs/') !== -1) return null;
  return image.slice(0, i) + 'assets/fabrics-thumbs/' + image.slice(i + marker.length);
}

// Average a representative hex color from a loaded image. Draws to a small
// offscreen canvas and averages the visible pixels; guards against canvas taint
// (cross-origin images without CORS headers) with try/catch, falling back to a
// neutral hex so a chosen backing always yields a usable color.
function sampleImageHex(img) {
  try {
    const maxDim = 48, scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 125) continue; r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
    if (!n) return '#C9BFB2';
    return rgbToHex(r / n, g / n, b / n);
  } catch (e) { return '#C9BFB2'; }
}

// Load a fabric image, sample a representative hex, and emit the backing
// record `{ name, hex, image, thumb }`. Prefer the compact thumb for sampling
// so we don't re-decode a multi‑MB print just to average a 48px canvas.
function chooseBackingFromImage(name, image, thumb, onChoose) {
  const src = thumb || image;
  const img = new Image();
  img.onload = () => onChoose({ name, hex: sampleImageHex(img), image, thumb: thumb || image });
  img.onerror = () => onChoose({ name, hex: '#C9BFB2', image, thumb: thumb || image });
  img.src = src;
}

function fabricFullSrc(fabric) {
  if (!fabric) return null;
  return fabric.image || fabric.thumb || fabricThumbFor(fabric.image) || null;
}

// Full-res (or hex) enlarge overlay. `onUse` turns it into a confirm step when
// choosing; omit it for inspect-only (current backing in the studio). Pass
// `fabrics` (the visible category) to page through neighbors without closing.
function FabricEnlargeOverlay({ fabric, fabrics, onClose, onUse, useLabel = 'Use this fabric' }) {
  const list = (fabrics && fabrics.length) ? fabrics : (fabric ? [fabric] : []);
  const start = Math.max(0, list.findIndex(f => fabric && (f.image === fabric.image || f === fabric)));
  const [idx, setIdx] = useState(start);
  useEffect(() => { setIdx(start); }, [start]);
  const current = list[idx] || fabric;
  const canSlide = list.length > 1;
  const step = dir => setIdx(i => (i + dir + list.length) % list.length);

  useEffect(() => {
    if (!canSlide) return undefined;
    const onKey = e => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [canSlide, list.length]);

  useEffect(() => {
    if (!canSlide) return;
    [list[(idx + 1) % list.length], list[(idx - 1 + list.length) % list.length]].forEach(f => {
      const preload = fabricFullSrc(f);
      if (preload) { const img = new Image(); img.src = preload; }
    });
  }, [idx, canSlide, list]);

  if (!current) return null;
  const src = fabricFullSrc(current);
  return (
    <div className="overlay overlay-lift" onClick={onClose}>
      <div className="fabric-enlarge" onClick={e => e.stopPropagation()}>
        <div className="fabric-enlarge-head">
          <div className="fabric-enlarge-name">{current.name}</div>
          {canSlide && <div className="fabric-enlarge-count">{idx + 1} of {list.length}</div>}
          <button type="button" onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',color:'var(--warm-muted)',display:'flex'}} aria-label="Close"><IcX/></button>
        </div>
        <div className="fabric-enlarge-stage">
          {canSlide && (
            <button type="button" className="fabric-enlarge-nav is-prev" onClick={() => step(-1)} aria-label="Previous fabric">
              <IcCaretL/>
            </button>
          )}
          {src
            ? <img className="fabric-enlarge-img" src={src} alt={current.name}/>
            : <div className="fabric-enlarge-swatch" style={{ background: current.hex || '#C9BFB2' }}/>}
          {canSlide && (
            <button type="button" className="fabric-enlarge-nav is-next" onClick={() => step(1)} aria-label="Next fabric">
              <IcCaretR/>
            </button>
          )}
        </div>
        {onUse && (
          <div className="fabric-enlarge-actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="button" className="btn btn-dark" onClick={() => onUse(current)}>{useLabel}</button>
          </div>
        )}
      </div>
    </div>
  );
}

// A single fabric swatch card. Compact (image-only, name in tooltip) so the grid
// can stay dense. Hides itself if its image can't load so a broken/missing asset
// never leaves an empty broken-image box on the page.
function FabricCard({ fab, onChoose, selected, eager }) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  return (
    <button className={`fabric-card${selected ? ' selected' : ''}`} onClick={() => onChoose(fab)} title={`Use "${fab.name}"`}>
      <img className="fabric-thumb" src={fab.thumb || fab.image} alt={fab.name}
        loading={eager ? "eager" : "lazy"} decoding="async" fetchPriority={eager ? "high" : "low"}
        onError={e => {
          // Prefer thumb; if it's missing, fall back to the full image once.
          if (fab.thumb && e.currentTarget.src.indexOf('fabrics-thumbs') !== -1) {
            e.currentTarget.src = fab.image;
            return;
          }
          setHidden(true);
        }}/>
    </button>
  );
}

// Shared catalog: filters + Ruby Star grid + optional upload. Used by the setup
// step and the in-studio backing overlay so there's only one picker UI.
function BackingFabricPicker({ onPickFab, onPickUpload, current, uploadHint, uploadResultHint, layout = 'compact', showUpload = true }) {
  const [cat, setCat] = useState('top');
  const cats = useMemo(() => FABRIC_CATEGORIES.filter(c =>
    c.id === 'top' || RUBY_STAR_FABRICS.some(f => f.cats.includes(c.id))
  ), []);
  const shown = useMemo(() => {
    if (cat === 'top') return TOP_FABRICS;
    return RUBY_STAR_FABRICS.filter(f => f.cats.includes(cat));
  }, [cat]);
  const page = layout === 'page';
  return (
    <>
      <div className={page ? 'back-filters' : 'fabric-filters'} role="tablist" aria-label="Fabric category">
        {cats.map(c => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={cat === c.id}
            className={`fabric-filter filter-pill${cat === c.id ? ' active' : ''}`}
            onClick={() => setCat(c.id)}>
            {c.label}
          </button>
        ))}
      </div>
      <div className={page ? 'back-grid' : 'fabric-grid'}>
        {shown.map((f, i) => (
          <FabricCard
            key={`${f.image}-${i}`}
            fab={f}
            eager={i < 8}
            selected={!!(current && current.image === f.image)}
            onChoose={fab => onPickFab(fab, shown)}/>
        ))}
      </div>
      {showUpload && (
        <PhotoDrop
          hint={uploadHint}
          resultHint={uploadResultHint}
          onChoose={onPickUpload}/>
      )}
    </>
  );
}

// Quilt backing-fabric step: pick a Ruby Star print or upload your own fabric.
// Whatever is chosen is loaded, a representative hex is sampled, and we emit
// { name, hex, image } — the palette step then pulls a Kona palette from it.
function QuiltBackingSelector({ preset, onChoose, onSkip, onBack }) {
  // Local swatches are same-origin, so no crossOrigin needed — sampleImageHex
  // can read the pixels and the palette step gets a real auto-suggestion.
  const [inspect, setInspect] = useState(null);
  const apply = (name, image, thumb) => chooseBackingFromImage(name, image, thumb, onChoose);
  return (
    <div className="back-page brand-shell">
      <BrandNav/>
      <BrandHead
        tone="cream"
        back={<BrandBack onBack={onBack}/>}
        actions={<button type="button" className="back-skip" onClick={onSkip}>Skip for now</button>}
        eyebrow={<BrandEyebrow step={2} label={`Quilting · Step 2 of ${BRAND_STEPS.quilt}`}/>}
        title="Pick a backing fabric"
        wide
        sub="It also seeds the palette we suggest on the next step, so pick something you like the colors of."/>
      <BackingFabricPicker
        layout="page"
        showUpload={false}
        onPickFab={(fab, list) => setInspect({ fabric: fab, fabrics: list })}
        onPickUpload={imgSrc => apply('Your fabric', imgSrc)}/>
      <BrandFooter note="Quilting · backing fabric"/>
      {inspect && (
        <FabricEnlargeOverlay
          fabric={inspect.fabric}
          fabrics={inspect.fabrics}
          onClose={() => setInspect(null)}
          onUse={fab => apply(fab.name, fab.image, fab.thumb)}/>
      )}
    </div>
  );
}

// In-studio backing editor: same catalog as setup, plus a large current-fabric
// preview (click to enlarge) and Clear.
function BackingPickerOverlay({ current, onChoose, onClear, onClose }) {
  const [inspect, setInspect] = useState(null);
  const apply = (name, image, thumb) => {
    chooseBackingFromImage(name, image, thumb, fab => {
      onChoose(fab);
      setInspect(null);
    });
  };
  const currentSrc = fabricFullSrc(current);
  return (
    <>
      <div className="overlay overlay-lift" onClick={onClose}>
        <div className="backing-picker-dialog" onClick={e => e.stopPropagation()}>
          <div className="backing-picker-head">
            <div className="backing-picker-title">Backing fabric</div>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              {current && onClear && (
                <button type="button" className="btn" onClick={() => { onClear(); onClose(); }}>Clear</button>
              )}
              <button type="button" onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',color:'var(--warm-muted)',display:'flex'}} aria-label="Close"><IcX/></button>
            </div>
          </div>
          <div className="backing-picker-body">
            {current && currentSrc && (
              <button type="button" className="backing-current" onClick={() => setInspect({ fabric: { ...current, viewOnly: true } })} title="View fabric large">
                <img className="backing-current-img" src={current.image || currentSrc} alt={current.name}/>
                <div className="backing-current-caption">{current.name}. Tap to view large</div>
              </button>
            )}
            <BackingFabricPicker
              current={current}
              onPickFab={(fab, list) => setInspect({ fabric: fab, fabrics: list })}
              onPickUpload={imgSrc => apply('Your fabric', imgSrc)}
              uploadHint="Use a photo of your own fabric as the backing."
              uploadResultHint="We'll use this photo as your quilt backing."
              gridSub="Tap a fabric to preview it large, then use it as your backing."/>
          </div>
        </div>
      </div>
      {inspect && (
        <FabricEnlargeOverlay
          fabric={inspect.fabric}
          fabrics={inspect.fabrics}
          onClose={() => setInspect(null)}
          onUse={inspect.fabric?.viewOnly ? undefined : fab => apply(fab.name, fab.image, fab.thumb)}/>
      )}
    </>
  );
}

// Suggested palettes extracted from a fabric swatch / photo cap out here.
const SUGGESTED_PALETTE_MAX = 6;
// Cross stitch shades with more flosses, so it keeps its own (larger) cap.
const CROSS_STITCH_PALETTE_MAX = 10;

// Suggested palette from an image (Figma 2138:2019). Circles remove on click;
// on touch, first tap arms (shows ×) and second tap deletes. + opens the picker.
function ImagePaletteEditor({ photo, alt, colors, colorKey, titleOf, onRemove, onAdd, onUse, onPreviewClick, useLabel = 'Use this palette', maxColors = SUGGESTED_PALETTE_MAX, layout = 'card' }) {
  const isMobile = useIsMobile();
  const [armedIdx, setArmedIdx] = useState(null);
  const addRef = useRef(null);
  const bar = layout === 'bar';
  const reduced = usePrefersReducedMotion();

  // The suggested colors are all known at once, but they land one after another
  // so the palette reads as something lifted out of the photo. A single shot:
  // once the row is up, `risen` sits at Infinity and every swatch is simply
  // present — otherwise removing one would send the rest away and bring them
  // back, and a swatch added later would never arrive at all.
  const [risen, setRisen] = useState(0);
  useEffect(() => {
    const n = colors.length;
    if (reduced || !n) { setRisen(Infinity); return undefined; }
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setRisen(i >= n ? Infinity : i);
      if (i >= n) clearInterval(id);
    }, XS_SWATCH_STAGGER_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => { setArmedIdx(null); }, [colors.length]);
  useEffect(() => {
    if (armedIdx === null) return undefined;
    const onDoc = e => {
      if (e.target.closest && e.target.closest('.pal-from-image-swatch')) return;
      setArmedIdx(null);
    };
    document.addEventListener('pointerdown', onDoc);
    return () => document.removeEventListener('pointerdown', onDoc);
  }, [armedIdx]);

  const onSwatchClick = i => {
    if (isMobile) {
      if (armedIdx === i) { onRemove(i); setArmedIdx(null); }
      else setArmedIdx(i);
      return;
    }
    onRemove(i);
  };

  const preview = <img className="pal-from-image-preview" src={photo} alt={alt}/>;

  return (
    <div className="pal-from-image">
      {onPreviewClick
        ? <button type="button" className="pal-from-image-preview-btn" onClick={onPreviewClick} title="View fabric large" aria-label={`View ${alt} large`}>{preview}</button>
        : preview}
      <div className="pal-from-image-main">
        <div className="pal-from-image-swatches">
          {colors.map((c, i) => (
            <button
              key={`${colorKey(c)}-${i}`}
              type="button"
              className={`pal-from-image-swatch${armedIdx === i ? ' armed' : ''}${i < risen ? '' : ' rising'}`}
              style={{ background: c.hex }}
              title={titleOf(c)}
              aria-label={isMobile && armedIdx === i ? `Remove ${titleOf(c)}` : titleOf(c)}
              onClick={() => onSwatchClick(i)}>
              <span className="pal-from-image-x" aria-hidden="true"><IcX/></span>
            </button>
          ))}
          {colors.length < maxColors && (
            <button
              ref={addRef}
              type="button"
              className="pal-from-image-add"
              title="Add a color"
              aria-label="Add a color"
              onClick={() => onAdd(addRef)}>
              {bar ? <IcPlus size={24}/> : '+'}
            </button>
          )}
        </div>
        <button type="button" className={bar ? 'pal-from-image-use' : 'btn btn-dark pal-from-image-use'} disabled={!colors.length} onClick={onUse}>
          {useLabel}
        </button>
      </div>
    </div>
  );
}

// ── Quilt: palette selector ────────────────────────────────────────────────
// Mirrors CrossStitchPaletteSelector. Backing was chosen on the previous step;
// if it carries an image we extract an editable suggested Kona palette from it
// (remove/add via KonaPicker). Sample palettes remain available. Returns
// ONLY the palette (backing is already set upstream).
function PaletteSelector({ presetName, backing, onChoose, onSkip, onBack }) {
  const samples = useMemo(() => SUGGESTED_PALETTES.map(p => ({ name: p.name, colors: resolvePalette(p) })), []);
  // Prefer the compact thumb for extract + preview (full-res only for uploads
  // that have no thumb, or older saves without one).
  const photo = backing && (backing.thumb || fabricThumbFor(backing.image) || backing.image);
  const [sugg, setSugg] = useState([]);
  const [ready, setReady] = useState(!photo);
  const [swapIdx, setSwapIdx] = useState(null);
  const [inspect, setInspect] = useState(false);
  const swapAnchor = useRef(null);

  useEffect(() => {
    if (!photo) { setSugg([]); setReady(true); return; }
    let cancelled = false;
    setReady(false);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (cancelled) return;
      const maxDim = 160, scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0, w, h);
      let pixels; try { pixels = ctx.getImageData(0, 0, w, h); } catch (e) { setReady(true); return; }
      const raw = extractColors(pixels, 24), seen = new Set(), colors = [];
      for (const c of raw) { const k = nearestKona(c); if (k && !seen.has(k.name)) { seen.add(k.name); colors.push(k); } }
      setSugg(colors.slice(0, SUGGESTED_PALETTE_MAX));
      setReady(true);
    };
    img.onerror = () => setReady(true);
    img.src = photo;
    return () => { cancelled = true; };
  }, [photo]);

  const pickSwap = c => setSugg(prev => { const n = [...prev]; if (swapIdx >= n.length) n.push(c); else n[swapIdx] = c; return n; });
  const removeAt = i => setSugg(prev => prev.filter((_, j) => j !== i));

  return (
    <div className="pal-page brand-shell">
      <BrandNav/>
      <BrandHead
        tone="lilac"
        wide
        back={<BrandBack onBack={onBack}/>}
        actions={<button type="button" className="back-skip" onClick={onSkip}>Skip for now</button>}
        eyebrow={<BrandEyebrow step={3} label={`Quilting · Step 3 of ${BRAND_STEPS.quilt}`}/>}
        title="Find your palette."
        sub="Every swatch here is a real Kona cotton we can cut for you."/>
      {photo && (
        <BrandSection
          title="Your backing"
          note="Lifted from the fabric you picked. Tap a color to drop it.">
          {!ready ? (
            <div className="pal-busy">Reading colors from your fabric…</div>
          ) : (
            <div className="pal-suggest-bar">
              <ImagePaletteEditor
                layout="bar"
                photo={photo}
                alt="Your backing fabric"
                colors={sugg}
                colorKey={c => c.name}
                titleOf={c => c.name}
                onRemove={removeAt}
                onAdd={ref => { swapAnchor.current = ref.current; setSwapIdx(sugg.length); }}
                onUse={() => onChoose(sugg)}
                onPreviewClick={fabricFullSrc(backing) ? () => setInspect(true) : undefined}/>
            </div>
          )}
        </BrandSection>
      )}
      <BrandSection
        title={photo ? 'Or start from a suggested palette' : 'Suggested palettes'}
        note="Curated Kona cottons that work together. You can change any of them in the studio."/>
      <div className="pal-grid">
        {samples.map((s, i) => (
          <button key={s.name} className="pal-card" onClick={() => onChoose(s.colors)}>
            <div className="pal-swatches">
              {s.colors.map((c, i) => (
                <span key={i} className="pal-swatch" style={{ background: c.hex, zIndex: i + 1 }} title={c.name}/>
              ))}
            </div>
            <div className="pal-card-body">
              <div className="pal-card-head">
                <div className="pal-card-text">
                  <div className="pal-card-name">{s.name}</div>
                  <div className="pal-card-meta">{s.colors.length} fabrics</div>
                </div>
                <span className="size-card-arrow" aria-hidden="true">
                  <IcArrowR size={26}/>
                </span>
              </div>
            </div>
          </button>
        ))}
      </div>
      <BrandFooter note="Quilting · palette"/>
      {swapIdx !== null && (
        <KonaPicker anchorRef={swapAnchor} onClose={() => setSwapIdx(null)} onPick={pickSwap}/>
      )}
      {inspect && (
        <FabricEnlargeOverlay
          fabric={backing}
          onClose={() => setInspect(false)}/>
      )}
    </div>
  );
}

// ── Grid crafts: size selector (cross-stitch + punch needle) ───────────────
const GRID_SIZE_THEMES = { 'cross-stitch': STITCH_THEMES, 'punch-needle': PUNCH_THEMES };
const GRID_SIZE_IMAGES = { 'cross-stitch': STITCH_IMAGES, 'punch-needle': PUNCH_IMAGES };

function GridSizeThumb({ preset, craft }) {
  const theme = (GRID_SIZE_THEMES[craft] || {})[preset.name] || { c1:"#2C3E50", c2:"#EDF2FC" };
  if (/hoop/i.test(preset.name)) {
    return (
      <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
        <circle cx="100" cy="100" r="92" fill={theme.c2} stroke={theme.c1} strokeWidth="12"/>
      </svg>
    );
  }
  const aspect = preset.h / preset.w;
  const W = 200, H = Math.max(40, Math.round(W * aspect));
  const cellSize = W / 5;
  const cols = Math.ceil(W / cellSize);
  const rows = Math.ceil(H / cellSize);
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push(
        <rect key={`${r}-${c}`}
          x={c * cellSize} y={r * cellSize}
          width={cellSize} height={cellSize}
          fill={(r + c) % 2 === 0 ? theme.c1 : theme.c2}/>
      );
    }
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} xmlns="http://www.w3.org/2000/svg">
      {cells}
      <rect width={W} height={H} fill="none" stroke="rgba(0,0,0,0.15)" strokeWidth="1"/>
    </svg>
  );
}

function StitchSizeCard({ preset, onSelect, craft = 'cross-stitch', price }) {
  const cfg = CRAFT_STUDIO[craft];
  const image = (GRID_SIZE_IMAGES[craft] || {})[preset.name];
  const dims = isCoasterSize(preset.name)
    ? `${preset.w} × ${preset.h} ${cfg.unitPlural} · set of 4`
    : `${preset.w} × ${preset.h} ${cfg.unitPlural}`;
  return (
    <button type="button" className="size-card" onClick={() => onSelect(preset.name)}
      aria-label={[preset.name, dims, price && `kit ${price}`].filter(Boolean).join(", ")}>
      <span className="size-card-visual">
        {image
          ? <img src={image} alt="" loading="eager" decoding="async" fetchPriority="high"/>
          : <GridSizeThumb preset={preset} craft={craft}/>}
      </span>
      <span className="size-card-copy">
        <span className="size-card-text">
          <span className="size-card-name">{preset.name}</span>
          <span className="size-card-dims">{dims}</span>
          {price && <span className="size-card-price">Kit {price}</span>}
        </span>
        <span className="size-card-arrow" aria-hidden="true">
          <IcArrowR size={26}/>
        </span>
      </span>
    </button>
  );
}

function CrossStitchSizeSelector({ onSelect, onBack, craft = 'cross-stitch' }) {
  const cfg = CRAFT_STUDIO[craft];
  const prices = useKitPrices(cfg.checkoutType);
  return (
    <div className="size-page brand-shell">
      <BrandNav/>
      <BrandHead
        tone="butter"
        back={<BrandBack onBack={onBack}/>}
        eyebrow={<BrandEyebrow step={1} label={`${BRAND_CRAFT_LABEL[craft] || cfg.label} · Step 1 of ${BRAND_STEPS[craft] || 3}`}/>}
        title="What size?"
        sub={`Every size is a real finished piece, so we calculate the ${cfg.unitPlural} and materials from here.`}/>
      <div className="size-row">
        {cfg.presets.map(p => (
          <StitchSizeCard key={p.name} preset={p} craft={craft} onSelect={onSelect}
            price={formatKitPrice(prices[p.name])}/>
        ))}
      </div>
      <BrandFooter note={`${BRAND_CRAFT_LABEL[craft] || cfg.label} · choose a finished size`}/>
    </div>
  );
}

// ── Grid crafts: palette selector ──────────────────────────────────────────
// All color selection happens here. If a photo was uploaded on the previous
// step, we extract a suggested palette from it (editable — remove/add via
// the thread picker). Choosing a palette (suggested or sample) auto-generates
// the design from the photo + that palette and enables the trace overlay.
function CrossStitchPaletteSelector({ preset, photo, template, onChoose, onSkip, onBack, craft = 'cross-stitch', removeBgDefault = true }) {
  const cfg = CRAFT_STUDIO[craft];
  const samples = useMemo(() => cfg.palettes.map(p => ({ name: p.name, colors: cfg.resolvePalette(p) })), [cfg]);
  const imgElRef = useRef(null);
  const [sugg, setSugg] = useState([]);
  const [ready, setReady] = useState(!photo);
  const [swapIdx, setSwapIdx] = useState(null);       // index being swapped/added
  const [simplify, setSimplify] = useState(XS_SIMPLIFY_DEFAULT);
  const [removeBg, setRemoveBg] = useState(removeBgDefault !== false);
  const swapAnchor = useRef(null);

  useEffect(() => {
    if (!photo) { setSugg([]); setReady(true); return; }
    let cancelled = false;
    setReady(false);
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      imgElRef.current = img;
      const maxDim = 160, scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0, w, h);
      let pixels; try { pixels = ctx.getImageData(0, 0, w, h); } catch (e) { setReady(true); return; }
      const raw = extractColors(pixels, 24), seen = new Set(), colors = [];
      for (const c of raw) { const k = cfg.nearest(c); if (k && !seen.has(k.code)) { seen.add(k.code); colors.push(k); } }
      setSugg(colors.slice(0, cfg.paletteMax));
      setReady(true);
    };
    img.onerror = () => setReady(true);
    img.src = photo;
    return () => { cancelled = true; };
  }, [photo, cfg]);

  // Build the opts (auto-generated design + trace overlay) for a chosen palette.
  const optsFor = colors => {
    if (!photo) return {};
    const autoGrid = imgElRef.current
      ? buildGridFromImage(imgElRef.current, colors, preset.w, preset.h, { simplify, removeBg })
      : null;
    return { autoGrid, bgImage: photo };
  };
  // What the suggested colors would actually stitch out as. Cheap enough to
  // rebuild whenever a color or a setting changes, and it's the only way to
  // judge the flattening — or whether the background came off cleanly — without
  // committing to it.
  const previewGrid = useMemo(() => {
    if (!photo || !ready || !imgElRef.current || !sugg.length) return null;
    return buildGridFromImage(imgElRef.current, sugg, preset.w, preset.h, { simplify, removeBg });
  }, [photo, ready, sugg, simplify, removeBg, preset.w, preset.h]);
  const pickSwap = c => {
    setSugg(prev => {
      const n = [...prev];
      if (swapIdx >= n.length) n.push(c); else n[swapIdx] = c;
      return n;
    });
  };
  const removeAt = i => setSugg(prev => prev.filter((_, j) => j !== i));

  const craftLabel = BRAND_CRAFT_LABEL[craft] || cfg.label;
  return (
    <div className="pal-page brand-shell">
      <BrandNav/>
      <BrandHead
        tone="lilac"
        wide
        back={<BrandBack onBack={onBack}/>}
        actions={<button type="button" className="back-skip" onClick={onSkip}>Skip for now</button>}
        eyebrow={<BrandEyebrow step={3} label={`${craftLabel} · Step 3 of ${BRAND_STEPS[craft] || 3}`}/>}
        title="Find your palette."
        sub={`Every ${cfg.threadLabel.toLowerCase()} here is a real ${cfg.codePrefix} shade we can send you.`}/>
      {/* Primary focus: what it will actually stitch out as, beside the colours
          it will use. The live chart lives here rather than next to the detail
          controls so the project — not the setting — is the thing on show. */}
      {photo && (
        <BrandSection
          title="Your project"
          note={`${preset.w} × ${preset.h} ${cfg.unitPlural} · ${cfg.gaugeLabel}. Tap a color to drop it.`}>
          {!ready ? (
            <div className="pal-busy">Reading colors from your photo…</div>
          ) : (
            <div className="brand-project">
              <div className="xs-flatten-preview">
                {previewGrid
                  ? <StitchReveal w={preset.w} h={preset.h} cells={previewGrid} size={248}
                      img={imgElRef.current} majorGrid={cfg.majorGrid}/>
                  : <div className="xs-flatten-empty">Keep at least one color to preview</div>}
              </div>
              <div className="pal-suggest-bar">
                <ImagePaletteEditor
                  layout="bar"
                  photo={photo}
                  alt="Your uploaded photo"
                  colors={sugg}
                  colorKey={c => c.code}
                  titleOf={c => `${cfg.codePrefix} ${c.code} ${c.name}`}
                  onRemove={removeAt}
                  onAdd={ref => { swapAnchor.current = ref.current; setSwapIdx(sugg.length); }}
                  onUse={() => onChoose(sugg, optsFor(sugg))}
                  maxColors={cfg.paletteMax}/>
              </div>
            </div>
          )}
        </BrandSection>
      )}
      {/* Conversion controls, kept in their own band so they never read as
          another row of palettes to choose from. */}
      {photo && ready && (
        <BrandSection
          quiet
          title="How much detail?"
          note={`A photo holds more shading than ${cfg.unitPlural} can show. Flattening trades that detail for broad blocks of color, fewer stray ${cfg.unitPlural}, and a chart you can follow.`}>
          <section className="xs-flatten">
            <div className="xs-flatten-main">
              <div className="xs-flatten-row" role="group" aria-label="Detail level">
                {XS_SIMPLIFY.map(s => (
                  <button key={s.id} type="button" title={s.note}
                    className={`xs-flatten-btn${simplify === s.id ? ' active' : ''}`}
                    aria-pressed={simplify === s.id}
                    onClick={() => setSimplify(s.id)}>{s.label}</button>
                ))}
              </div>
              <div className="xs-flatten-note">{xsSimplifySpec(simplify).note}</div>
              <label className="xs-flatten-check">
                <input type="checkbox" checked={removeBg} onChange={e => setRemoveBg(e.target.checked)}/>
                Remove image background
                <span className="xs-flatten-check-note">
                  {removeBg
                    ? `Whatever surrounds your subject is left as bare ${cfg.fabricLabel}.`
                    : `The whole photo is filled in, background and all.`}
                </span>
              </label>
            </div>
          </section>
        </BrandSection>
      )}
      <BrandSection
        title={photo ? 'Or start from a suggested palette' : 'Suggested palettes'}
        note={`Curated ${cfg.threadPlural} that work together. You can change any of them in the studio.`}/>
      <div className="pal-grid">
        {samples.map((s, i) => (
          <button key={s.name} className="pal-card" onClick={() => onChoose(s.colors, optsFor(s.colors))}>
            <div className="pal-swatches">
              {s.colors.map((c, i) => (
                <span key={i} className="pal-swatch" style={{ background: c.hex, zIndex: i + 1 }}
                  title={`${cfg.codePrefix} ${c.code} ${c.name}`}/>
              ))}
            </div>
            <div className="pal-card-body">
              <div className="pal-card-head">
                <div className="pal-card-text">
                  <div className="pal-card-name">{s.name}</div>
                  <div className="pal-card-meta">{s.colors.length} {cfg.threadPlural}</div>
                </div>
                <span className="size-card-arrow" aria-hidden="true">
                  <IcArrowR size={26}/>
                </span>
              </div>
            </div>
          </button>
        ))}
      </div>
      <BrandFooter note={`${craftLabel} · ${preset.name}`}/>
      {swapIdx !== null && (
        <DmcPicker anchorRef={swapAnchor} craft={craft} onClose={() => setSwapIdx(null)} onPick={pickSwap}/>
      )}
    </div>
  );
}
