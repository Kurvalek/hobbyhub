import { useEffect, useMemo, useState } from 'react';
import {
  apiSafeDesign, canonicalPresetName, formatKitPrice, KIT_INFO, kitInchBox, kitIncludes,
  kitSupplyRows, kitSupplyRowsLocal, useDesignBom, useKitPrice,
} from './services.jsx';
import {
  cachedMockup, cacheMockup, designToPng, generateKitMockup, mockupCacheKey, startKitCheckout,
} from './kit-checkout.jsx';
import { deserializeGrid } from './design-model.jsx';
import { fmtY } from './catalog.jsx';
import {
  BRAND_CRAFT_LABEL, BrandBack, BrandEyebrow, BrandFooter, BrandHead, BrandNav, BrandSpecs,
  SavedQuiltThumb,
} from './landing.jsx';
import { CRAFT_STUDIO, StitchThumb } from './stitch-studio.jsx';

// The finished-product preview for one design: whether the service is up, the
// image once there is one, and the one call that makes it.
//
// Generating is a button rather than something that happens on arrival. Each press
// costs a real image-model call and takes tens of seconds, and the review page is
// reachable by anyone who clicks Buy kit — spending that on every visit, including
// the ones that never buy, is a bill with no purchase behind it. Once generated the
// result is kept on the device, so coming back to the same design is free.
function useKitMockup(type, record, designId) {
  const [available, setAvailable] = useState(null); // null until the probe answers
  // Drawn once per design rather than per render. The stringified record is only a
  // memo dependency, so its instability across a history rebuild costs at worst a
  // redraw — the cache key comes from the raster itself.
  const recordKey = record ? JSON.stringify(apiSafeDesign(record)) : null;
  const raster = useMemo(
    () => (record ? designToPng(type, record) : null),
    [type, recordKey]
  );
  const key = mockupCacheKey(designId, raster);
  const [state, setState] = useState(() => {
    const hit = cachedMockup(key);
    return hit ? { status: 'done', image: hit } : { status: 'idle' };
  });

  useEffect(() => {
    let alive = true;
    fetch('/api/mockup')
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => { if (alive) setAvailable(!!(b && b.configured)); })
      .catch(() => { if (alive) setAvailable(false); });
    return () => { alive = false; };
  }, []);

  // A design swapped underneath (the library's preview, re-ordering something
  // else), or the same one edited, has its own preview or none.
  useEffect(() => {
    const hit = cachedMockup(key);
    setState(hit ? { status: 'done', image: hit } : { status: 'idle' });
  }, [key]);

  const generate = async () => {
    if (state.status === 'working') return;
    setState({ status: 'working' });
    try {
      const image = await generateKitMockup(type, record, raster);
      cacheMockup(key, image);
      setState({ status: 'done', image });
    } catch (e) {
      console.warn('Mockup failed:', e);
      setState({
        status: 'error',
        message: e.message === 'blocked'
          ? "That design couldn't be rendered — it's still fine to order"
          : "Couldn't make the preview just now. Your kit is unaffected",
      });
    }
  };

  return { available, status: state.status, image: state.image, message: state.message, generate };
}

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
  const mockup = useKitMockup(type, record, designId);
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
              <figure className="kit-tile">
                <div className="kit-tile-art">
                  {isQuilt
                    ? <SavedQuiltThumb q={record}/>
                    : <StitchThumb w={record.w} h={record.h} cells={deserializeGrid(record.grid, record.w * record.h)}
                        size={320} bg={(record.fabric && record.fabric.hex) || "#FFFFFF"}/>}
                </div>
                <figcaption className="kit-tile-cap">Your design</figcaption>
              </figure>
              {/* The same design as the finished object. Left out entirely unless the
                  image service is configured, so there's never a button here that
                  can't do anything. */}
              {mockup.available && (
                <figure className="kit-tile">
                  <div className="kit-tile-art">
                    {mockup.status === 'done'
                      ? <img src={mockup.image} alt={`${name} made up as a finished ${(BRAND_CRAFT_LABEL[type] || 'piece').toLowerCase()} piece`}/>
                      : (
                        <div className="kit-tile-blank">
                          {mockup.status === 'working'
                            ? <p className="kit-tile-msg">Making a picture of it finished. This takes up to a minute.</p>
                            : (
                              <>
                                <button type="button" className="brand-btn" onClick={mockup.generate}>
                                  See it finished
                                </button>
                                {mockup.status === 'error'
                                  ? <p className="kit-tile-msg is-err">{mockup.message}</p>
                                  : <p className="kit-tile-msg">An impression of your design made up in real materials.</p>}
                              </>
                            )}
                        </div>
                      )}
                  </div>
                  <figcaption className="kit-tile-cap">
                    {mockup.status === 'done' ? 'Illustration, not a photo of your kit' : 'Finished piece'}
                  </figcaption>
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
