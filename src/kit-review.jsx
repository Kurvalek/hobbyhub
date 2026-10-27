import { useState } from 'react';
import {
  canonicalPresetName, formatKitPrice, KIT_INFO, kitInchBox, kitIncludes,
  kitSupplyRows, kitSupplyRowsLocal, useDesignBom, useKitPrice,
} from './services.jsx';
import { startKitCheckout } from './kit-checkout.jsx';
import { deserializeGrid } from './design-model.jsx';
import { fmtY } from './catalog.jsx';
import {
  BRAND_CRAFT_LABEL, BrandBack, BrandEyebrow, BrandFooter, BrandHead, BrandNav, BrandSpecs,
} from './landing.jsx';
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

// The last screen before Shopify: the design at a size worth looking at, beside
// everything that comes in the box and everything that doesn't. Reached from Buy
// kit in either editor and from the library's re-order button, both of which
// upload the design first — so `designId` is always a real stored id by the time
// this renders, and Checkout only has to do the Shopify half.
//
// The supply list comes from /api/bom, the same function that builds the packer's
// pick-list. Until it answers (or if it never does) the list falls back to what
// the design already carries, which is the same colours minus the skein counts.
// Nothing here blocks Checkout.
export function KitReviewPage({ type, record, designId, onBack }) {
  const bom = useDesignBom(type, record);
  const price = formatKitPrice(useKitPrice(type, record));
  const [state, setState] = useState({ status: "idle" });
  const cfg = CRAFT_STUDIO[type];
  const isQuilt = type === "quilt";

  const supplies = kitSupplyRows(type, bom) || kitSupplyRowsLocal(type, record);
  const included = kitIncludes(type, record);
  const yourOwn = (KIT_INFO[type] && KIT_INFO[type].yourOwn) || [];

  const name = record.name || "Untitled";
  const sub = isQuilt
    ? `${name} · ${record.fw}" × ${record.fh}" · ${record.preset}`
    : `${name} · ${record.w} × ${record.h} ${cfg.unitPlural} · ${canonicalPresetName(type, record.presetName)}`;
  const specs = isQuilt
    ? [
        { k: "Finished size", v: record.fw && record.fh ? `${record.fw}" × ${record.fh}"` : null },
        { k: "Block size", v: record.bs ? `${record.bs}"` : null },
        { k: "Fabric total", v: bom ? bom.totalYardsLabel : fmtY(record.grandTotal || 0) },
      ]
    : [
        { k: "Finished size", v: bom && bom.finishedInches ? kitInchBox(bom.finishedInches) : null },
        { k: cfg.unitTitle, v: record.stitches != null ? String(record.stitches) : null },
        { k: "Colors", v: String((record.colors || []).length) },
        { k: "Skeins", v: bom ? String(bom.totalSkeins) : null },
      ];

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

  const row = (r, i) => (
    <li className="kit-row" key={`${r.label}-${i}`}>
      {r.hex && <span className="kit-sw" style={{ background: r.hex }} aria-hidden="true"/>}
      <span className="kit-row-label">{r.label}</span>
      {r.qty && <span className="kit-row-qty">{r.qty}</span>}
    </li>
  );

  return (
    <div className="kit-page brand-shell">
      <BrandNav/>
      <BrandHead
        tone="butter"
        wide
        compact
        back={<BrandBack onBack={onBack}/>}
        eyebrow={<BrandEyebrow plain label={BRAND_CRAFT_LABEL[type] || "Kit"}/>}
        title="Review your kit"
        sub={sub}/>
      <div className="kit-band">
        <div className="kit-col">
          <div className="kit-scroll">
            <div className="kit-tiles">
              {isQuilt ? (
                <figure className="kit-tile">
                  <div className="kit-tile-art"><QuiltFinishedRender q={record}/></div>
                  <figcaption className="kit-tile-cap">
                    Finished · front and back{!record.binding || !record.backing ? ' · natural where not chosen' : ''}
                  </figcaption>
                </figure>
              ) : (
                <figure className="kit-tile">
                  <div className="kit-tile-art">
                    <StitchThumb w={record.w} h={record.h} cells={deserializeGrid(record.grid, record.w * record.h)}
                      size={320} bg={(record.fabric && record.fabric.hex) || "#FFFFFF"}/>
                  </div>
                  <figcaption className="kit-tile-cap">Your design</figcaption>
                </figure>
              )}
            </div>
            <BrandSpecs rows={specs}/>
          </div>
        </div>
        <div className="kit-col">
          <div className="kit-scroll">
            <section className="kit-group">
              <h2 className="kit-group-title">In your kit</h2>
              <ul className="kit-list">
                {supplies.map(row)}
                {included.map((label, i) => row({ label }, `inc${i}`))}
              </ul>
              {!bom && (
                <p className="kit-note">Calculating exact quantities. The colors are final.</p>
              )}
            </section>
            {yourOwn.length > 0 && (
              <section className="kit-group">
                <h2 className="kit-group-title">You'll need</h2>
                <ul className="kit-list is-own">
                  {yourOwn.map((label, i) => row({ label }, `own${i}`))}
                </ul>
              </section>
            )}
          </div>
          {/* Outside the scrolling list on purpose, so it stays on screen however
              many colours the design turned out to need. */}
          <div className="kit-foot">
            <div className="kit-buy">
              <div>
                <span className="kit-buy-k">Kit price</span>
                <span className="kit-buy-v">{price || ""}</span>
              </div>
              <button type="button" className="brand-btn is-primary kit-buy-go"
                disabled={state.status === "redirecting"} onClick={go}>
                {state.status === "redirecting" ? "Opening checkout…" : "Checkout"}
              </button>
            </div>
            {state.status === "error"
              ? <p className="kit-err">{state.message}</p>
              : <p className="kit-note">Shipping and tax are calculated on the next screen. Made to order. Your kit is cut and packed for this design.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

// The wait while a design is read back from the store, after the browser rebuilt
// the document on the review step. Not the review page with empty rows: a kit
// list that's still filling in reads like a kit that's missing things.
export function KitReviewLoading() {
  return (
    <div className="kit-page brand-shell">
      <BrandNav/>
      {/* Compact to match the page it turns into, so the band doesn't change
          height under the reader the moment the design arrives. */}
      <BrandHead tone="butter" wide compact
        eyebrow={<BrandEyebrow plain label="Your kit"/>}
        title="Fetching your design…"/>
      <BrandFooter/>
    </div>
  );
}
