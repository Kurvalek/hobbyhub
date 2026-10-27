import { useRef, useState } from 'react';
import {
  canonicalPresetName, formatKitPrice, KIT_INFO, kitInchBox, kitIncludes,
  kitSupplyRows, kitSupplyRowsLocal, useDesignBom, useKitPrice,
} from './services.jsx';
import { startKitCheckout } from './kit-checkout.jsx';
import { deserializeGrid } from './design-model.jsx';
import { fmtY } from './catalog.jsx';
import { BRAND_CRAFT_LABEL, BrandNav, LandFooter, useHasSavedDesigns } from './landing.jsx';
import { IcArrowL, IcArrowR } from './icons.jsx';
import { CRAFT_STUDIO, StitchThumb } from './stitch-studio.jsx';
import { QuiltFinishedRender } from './quilt-render.jsx';

// True while the kit review page is covering the studio. The editors stay mounted
// underneath on purpose, so a Back returns an unsaved canvas untouched — which
// also means their window-level key handlers are still listening. Those have to
// sit out while something else owns the screen: Cmd+Z would otherwise undo work
// the maker can't currently see.
export function studioCovered() {
  return typeof document !== "undefined" && !!document.querySelector(".kit-layer");
}

// Each craft's colour field, as on its landing card.
const KIT_TONE = { quilt: "golden", "cross-stitch": "grapefruit", "punch-needle": "ice" };
// Who already owns the tools in "You'll need".
const KIT_MAKER = { quilt: "sewers", "cross-stitch": "stitchers", "punch-needle": "makers" };
// The pieces of a set sit at alternating angles, and tip the other way turned over.
const TILTS = [-3, 2, -2, 3];

// The finished piece, or each piece of a set, on a swipeable stage. Quilts can
// be turned over to see the backing and binding.
function KitPreview({ type, record }) {
  const isQuilt = type === "quilt";
  const [side, setSide] = useState("front");
  const [idx, setIdx] = useState(0);
  const swipe = useRef(null);

  const pieces = isQuilt
    ? (record.units && record.units.length > 1 ? record.units.map(u => ({ ...record, shapes: u.shapes })) : [record])
    : (record.pages && record.pages.length > 1 ? record.pages : [record]).map(p => deserializeGrid(p.grid, record.w * record.h));
  const n = pieces.length;
  const go = i => setIdx(Math.max(0, Math.min(n - 1, i)));
  const flip = side === "back" ? -1 : 1;

  return (
    <div className="kit-stage">
      <div className="kit-track" style={{ transform: `translateX(${-idx * 100}%)` }}
        onPointerDown={e => { swipe.current = e.clientX; }}
        onPointerUp={e => {
          const d = e.clientX - (swipe.current ?? e.clientX);
          swipe.current = null;
          if (Math.abs(d) > 40) go(idx + (d < 0 ? 1 : -1));
        }}>
        {pieces.map((p, i) => (
          <div className="kit-slide" key={i} aria-hidden={i !== idx}>
            <div className={`kit-piece${isQuilt ? "" : " is-stitch"}`} style={{ "--tilt": `${TILTS[i % 4] * flip}deg` }}>
              {isQuilt
                ? <QuiltFinishedRender q={p} side={side}/>
                : <StitchThumb w={record.w} h={record.h} cells={p} size={420} bg={(record.fabric && record.fabric.hex) || "#FFFFFF"}/>}
            </div>
          </div>
        ))}
      </div>
      {isQuilt && (
        <div className="kit-sides" role="group" aria-label="Side">
          {[["front", "Front"], ["back", "Back"]].map(([k, label]) => (
            <button key={k} type="button" className={side === k ? "is-on" : ""} aria-pressed={side === k}
              onClick={() => setSide(k)}>{label}</button>
          ))}
        </div>
      )}
      {n > 1 && (
        <>
          <span className="kit-count">{idx + 1} of {n}</span>
          <button type="button" className="kit-nav is-prev" aria-label="Previous piece" disabled={idx === 0} onClick={() => go(idx - 1)}>
            <IcArrowL size={18}/>
          </button>
          <button type="button" className="kit-nav is-next" aria-label="Next piece" disabled={idx === n - 1} onClick={() => go(idx + 1)}>
            <IcArrowR size={18}/>
          </button>
          <div className="kit-dots">
            {pieces.map((_, i) => (
              <button key={i} type="button" className={i === idx ? "is-on" : ""} aria-label={`Piece ${i + 1}`}
                aria-current={i === idx} onClick={() => go(i)}/>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// The heading band: back to the canvas, the title with its craft, and the
// design's name, size and preset as chips. The band ends in a wavy edge.
function KitHero({ type, onBack, title, chips = [] }) {
  return (
    <>
      <section className="kit-hero">
        <div className="kit-wrap">
          {onBack && (
            <button type="button" className="kit-back" onClick={onBack}>
              <IcArrowL size={18}/> Back to editor
            </button>
          )}
          <div className="kit-hero-row">
            <div className="kit-hero-title">
              <h1>{title}</h1>
              <span className="kit-hero-craft">{BRAND_CRAFT_LABEL[type] || "Kit"}</span>
            </div>
            {chips.length > 0 && (
              <div className="kit-chips">
                {chips.map((c, i) => <span key={i} className={`kit-chip${i === 0 ? " is-name" : ""}`}>{c}</span>)}
              </div>
            )}
          </div>
        </div>
      </section>
      <div className="kit-hero-wave" aria-hidden="true"/>
    </>
  );
}

function KitNav({ onMyDesigns }) {
  const hasSaved = useHasSavedDesigns();
  return (
    <BrandNav tone="olive">
      {hasSaved && onMyDesigns && <button type="button" className="land-nav-link" onClick={onMyDesigns}>My designs</button>}
    </BrandNav>
  );
}

// The last screen before Shopify: the finished piece at a size worth looking at,
// beside everything that comes in the box and everything that doesn't. Reached
// from Buy kit in either editor and from the library's re-order button, both of
// which upload the design first — so `designId` is always a real stored id by
// the time this renders, and Checkout only has to do the Shopify half.
//
// The supply list comes from /api/bom, the same function that builds the packer's
// pick-list. Until it answers (or if it never does) the list falls back to what
// the design already carries, which is the same colours minus the skein counts.
// Nothing here blocks Checkout.
export function KitReviewPage({ type, record, designId, onBack, onMyDesigns }) {
  const bom = useDesignBom(type, record);
  const price = formatKitPrice(useKitPrice(type, record));
  const [state, setState] = useState({ status: "idle" });
  const cfg = CRAFT_STUDIO[type];
  const isQuilt = type === "quilt";

  const supplies = kitSupplyRows(type, bom, record) || kitSupplyRowsLocal(type, record);
  const included = kitIncludes(type, record);
  const yourOwn = (KIT_INFO[type] && KIT_INFO[type].yourOwn) || [];

  const chips = isQuilt
    ? [record.name || "Untitled", record.fw && record.fh ? `${record.fw}″ × ${record.fh}″` : null, record.preset]
    : [record.name || "Untitled",
        bom && bom.finishedInches ? kitInchBox(bom.finishedInches).replace(/"/g, "″") : `${record.w} × ${record.h} ${cfg.unitPlural}`,
        canonicalPresetName(type, record.presetName)];
  const specs = (isQuilt
    ? [
        { k: "Finished size", v: record.fw && record.fh ? `${record.fw}″ × ${record.fh}″` : null },
        { k: "Block size", v: record.bs ? `${record.bs}″` : null },
        { k: "Fabric total", v: bom ? bom.totalYardsLabel : fmtY(record.grandTotal || 0) },
      ]
    : [
        { k: "Finished size", v: bom && bom.finishedInches ? kitInchBox(bom.finishedInches).replace(/"/g, "″") : null },
        { k: cfg.unitTitle, v: record.stitches != null ? String(record.stitches) : null },
        { k: "Colors", v: String((record.colors || []).length) },
        { k: "Skeins", v: bom ? String(bom.totalSkeins) : null },
      ]).filter(s => s.v);

  const setSize = isQuilt ? (record.units || []).length : (record.pages || []).length;
  const caption = [
    setSize > 1 ? `Set of ${setSize} finished coasters.` : null,
    isQuilt && (!record.binding || !record.backing) ? "Shown in natural cotton where you haven't picked a backing or binding." : null,
  ].filter(Boolean).join(" ");

  const go = async () => {
    if (state.status === "redirecting") return;
    setState({ status: "redirecting" });
    try {
      await startKitCheckout(type, record, designId);
    } catch (e) {
      console.warn("Shopify checkout failed:", e);
      setState({ status: "error", message: "Couldn't reach checkout. Your design is safe. Try again in a moment." });
    }
  };

  const row = (r, key) => (
    <li className="kit-row" key={key}>
      <span className="kit-sw" style={r.hex ? { background: r.hex } : undefined} aria-hidden="true"/>
      <span className="kit-row-text">
        <span className="kit-row-label">{r.label}</span>
        {r.sub && <span className="kit-row-sub">{r.sub}</span>}
      </span>
      {r.qty && <span className="kit-row-qty">{r.qty}</span>}
    </li>
  );

  return (
    <div className={`kit-page brand-shell tone-${KIT_TONE[type] || "golden"}`}>
      <KitNav onMyDesigns={onMyDesigns}/>
      <KitHero type={type} onBack={onBack} title="Review your kit" chips={chips.filter(Boolean)}/>
      <main className="kit-wrap kit-main">
        <div className="kit-look">
          <KitPreview type={type} record={record}/>
          {caption && <p className="kit-caption">{caption}</p>}
          {specs.length > 0 && (
            <dl className={`kit-stats${specs.length > 3 ? " is-wide" : ""}`} style={{ "--n": specs.length }}>
              {specs.map(s => (
                <div className="kit-stat" key={s.k}><dt>{s.k}</dt><dd>{s.v}</dd></div>
              ))}
            </dl>
          )}
        </div>
        <div className="kit-info">
          <section>
            <h2 className="kit-h2">In your kit</h2>
            <ul className="kit-list">
              {supplies.map((r, i) => row(r, `s${i}`))}
              {included.map((label, i) => row({ label }, `inc${i}`))}
            </ul>
            {!bom && <p className="kit-note">Calculating exact quantities. The colors are final.</p>}
          </section>
          {yourOwn.length > 0 && (
            <section>
              <h2 className="kit-h2">You'll need</h2>
              <p className="kit-h2-note">Not included. Most {KIT_MAKER[type] || "makers"} have these already.</p>
              <ul className="kit-needs">
                {yourOwn.map(label => <li key={label}>{label}</li>)}
              </ul>
            </section>
          )}
          {/* Sticky, so the price and the way forward stay on screen however
              long the supply list turns out to be. */}
          <div className="kit-buy">
            <div className="kit-buy-top">
              <div>
                <span className="kit-buy-k">Kit price</span>
                <span className="kit-buy-v">{price || ""}</span>
              </div>
              {state.status === "error"
                ? <p className="kit-err" role="alert">{state.message}</p>
                : <p className="kit-buy-note">Made to order. Cut and packed for this design. Shipping and tax on the next screen.</p>}
            </div>
            <button type="button" className="kit-buy-go" disabled={state.status === "redirecting"} onClick={go}>
              {state.status === "redirecting" ? "Opening checkout…" : "Checkout"}
              <IcArrowR size={20}/>
            </button>
          </div>
        </div>
      </main>
      <LandFooter/>
    </div>
  );
}

// The wait while a design is read back from the store, after the browser rebuilt
// the document on the review step. Not the review page with empty rows: a kit
// list that's still filling in reads like a kit that's missing things.
export function KitReviewLoading({ type }) {
  return (
    <div className={`kit-page brand-shell tone-${KIT_TONE[type] || "golden"}`}>
      <KitNav/>
      <KitHero type={type} title="Fetching your design…"/>
      <div className="kit-main-spacer"/>
      <LandFooter/>
    </div>
  );
}
