// ── Finished-product preview ───────────────────────────────────────────────
// Draws a design to a flat PNG for an image model to work from. The model needs
// to see the actual layout — a written description would produce a picture of
// some other person's quilt — and the browser already holds everything needed,
// so this is a local redraw rather than another server-side renderer.
//
// Deliberately plain: no quilting lines, no grid, no fabric texture, one cell or
// patch per block of flat colour. The prompt asks for the craft's texture to be
// added, and any that's baked in here gets reinterpreted rather than reproduced.
const MOCKUP_INPUT_PX = 1024;

function drawQuiltToCanvas(ctx, record, scale) {
  const tri = (s) => {
    const x = s.c * scale, y = s.r * scale, w = s.w * scale, h = s.h * scale;
    // Same two diagonals and two halves the saved-quilt thumbnails use.
    const pts = s.dir === '/'
      ? (s.half === 'a' ? [[x, y], [x + w, y], [x, y + h]] : [[x + w, y], [x + w, y + h], [x, y + h]])
      : (s.half === 'a' ? [[x, y], [x + w, y], [x + w, y + h]] : [[x, y], [x, y + h], [x + w, y + h]]);
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.closePath();
    ctx.fill();
  };
  for (const s of record.shapes || []) {
    ctx.fillStyle = (s.color && s.color.hex) || '#FFFFFF';
    if (s.type === 'tri') tri(s);
    // Rounded out by a pixel: at this scale, exact edges leave hairlines of
    // background between patches that the model reads as sashing.
    else ctx.fillRect(Math.floor(s.c * scale), Math.floor(s.r * scale),
      Math.ceil(s.w * scale) + 1, Math.ceil(s.h * scale) + 1);
  }
}

// A PNG data URL of the design, letterboxed into a square at its own proportions
// so a bookmark doesn't arrive stretched. Returns null for a record with nothing
// in it, which is what keeps a blank board from being sent off to be rendered.
function designToPng(type, record) {
  if (!record) return null;
  const cv = document.createElement('canvas');
  cv.width = MOCKUP_INPUT_PX;
  cv.height = MOCKUP_INPUT_PX;
  const ctx = cv.getContext('2d');
  if (!ctx) return null;

  if (type === 'quilt') {
    const cols = record.cols || 0, rows = record.rows || 0;
    if (!cols || !rows || !(record.shapes || []).length) return null;
    const scale = Math.min(MOCKUP_INPUT_PX / cols, MOCKUP_INPUT_PX / rows);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.save();
    ctx.translate((MOCKUP_INPUT_PX - cols * scale) / 2, (MOCKUP_INPUT_PX - rows * scale) / 2);
    drawQuiltToCanvas(ctx, record, scale);
    ctx.restore();
    return cv.toDataURL('image/png');
  }

  const w = record.w || 0, h = record.h || 0;
  if (!w || !h) return null;
  const cells = deserializeGrid(record.grid, w * h);
  if (!cells.some(Boolean)) return null;
  const scale = Math.min(MOCKUP_INPUT_PX / w, MOCKUP_INPUT_PX / h);
  // The cloth colour fills the whole square, not just the stitched area: the
  // model treats the surround as the fabric the piece is worked on.
  ctx.fillStyle = (record.fabric && record.fabric.hex) || '#FFFFFF';
  ctx.fillRect(0, 0, cv.width, cv.height);
  const ox = (MOCKUP_INPUT_PX - w * scale) / 2, oy = (MOCKUP_INPUT_PX - h * scale) / 2;
  for (let i = 0; i < cells.length; i++) {
    if (!cells[i]) continue;
    ctx.fillStyle = cells[i];
    ctx.fillRect(Math.floor(ox + (i % w) * scale), Math.floor(oy + Math.floor(i / w) * scale),
      Math.ceil(scale), Math.ceil(scale));
  }
  return cv.toDataURL('image/png');
}

// Asks the server to render the design as the finished object (POST /api/mockup).
// The prompt is built server-side from the craft and size — this sends only the
// picture and which kit it is, so nobody can spend the image budget on whatever
// they like.
// An image model can take the better part of a minute, so this is generous — but
// not unbounded, because a request that never answers would leave the button
// spinning for ever.
const MOCKUP_TIMEOUT_MS = 90000;

// `image` is the raster from designToPng. Taken as an argument rather than drawn
// here because the caller has already drawn it to work out the cache key, and the
// two must be the same picture for that key to mean anything.
async function generateKitMockup(type, record, image) {
  if (!image) throw new Error('nothing on the canvas to render');
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), MOCKUP_TIMEOUT_MS);
  let res;
  try {
    res = await fetch('/api/mockup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, presetName: kitPresetName(type, record), image }),
      signal: abort.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 422) throw new Error('blocked');
  if (!res.ok) throw new Error(`mockup failed (HTTP ${res.status})`);
  const body = await res.json();
  if (!body || !body.image) throw new Error('mockup response had no image');
  return body.image;
}

// Generated previews already paid for. An image model call costs real money and
// takes the better part of a minute, so coming back to a design — which happens on
// every abandoned checkout — must not spend it again. localStorage rather than
// sessionStorage, because the gap between abandoning a checkout and reconsidering
// is usually longer than a tab lives.
const MOCKUP_CACHE_PREFIX = 'metime.mockup.';
// Roughly 150KB an image against a ~5MB budget shared with everything else the
// origin stores. Ten is a couple of shopping trips' worth, well short of trouble.
const MOCKUP_CACHE_MAX = 10;

// FNV-1a. Not a security boundary — it only has to change when its input does.
function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

// Keyed on the design id plus a fingerprint of the raster that would be sent, and
// the fingerprint is the part that matters. A design already in someone's library
// keeps its id when they edit it — ensureSaved returns early on savedId and the save
// PUTs to the same row — so keying on the id alone would show a picture of the
// layout they just changed. A miss costs one generation; a stale hit misinforms a
// purchase.
//
// The raster rather than the design record, because the record is not stable: Back
// rebuilds it from its history snapshot and the result stringifies differently while
// describing the same piece. Hashing the image we would send makes the key mean what
// we actually want it to mean — same picture, same entry.
function mockupCacheKey(designId, raster) {
  if (!designId || !raster) return null;
  return MOCKUP_CACHE_PREFIX + designId + '.' + fnv1a(raster);
}

function mockupCacheEntries() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(MOCKUP_CACHE_PREFIX)) keys.push(k);
  }
  return keys;
}

function cachedMockup(key) {
  if (!key || typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(key) || null;
  } catch {
    return null;
  }
}

function cacheMockup(key, image) {
  if (!key || typeof localStorage === 'undefined') return;
  // Written youngest-first with the oldest dropped, because the alternative is a
  // full store that silently refuses every write — which would look like working
  // software while quietly paying for the same picture on every visit.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const existing = mockupCacheEntries().filter((k) => k !== key);
      while (existing.length >= MOCKUP_CACHE_MAX) localStorage.removeItem(existing.shift());
      localStorage.setItem(key, image);
      return;
    } catch {
      // Over quota: drop the oldest preview we hold and try once more. If there's
      // nothing left to drop, storage is blocked outright and we stop trying.
      const held = mockupCacheEntries().filter((k) => k !== key);
      if (!held.length) return;
      try { localStorage.removeItem(held[0]); } catch { return; }
    }
  }
}

// Resolve the kit for a design's size, create the cart, and hand off to Shopify's
// hosted checkout. Split out of the save step so the review page can run just
// this half for a design that's already uploaded.
async function startKitCheckout(type, design, designId) {
  // Each kit is a single-variant product, so resolving the handle its size maps
  // to gives us the exact variant to buy.
  const { variantId } = await resolveKit(kitHandle(type, design));
  const checkoutUrl = await addKitToShopifyCart({ variantId, designId });
  window.location.href = checkoutUrl;
}

// What every buy button does: send the design to the design-store API, then hand
// the maker to the kit review page, which is where the Shopify half happens (see
// startKitCheckout). No account is needed anywhere in here — a guest's design
// lands unowned, which is the whole reason the API allows it.
//
// The upload has to happen before the review page rather than at checkout,
// because the review page is a history entry a browser can rebuild from nothing.
// A stored id is the only thing small enough to put in that entry and the only
// thing that survives the document being thrown away.
//
// `design` is read while rendering, to price the kit and decide whether it can
// be sold at all. `getDesign` is called on click instead, which is what lets the
// editor sell a canvas that was never saved: the record is built from live state
// at the moment someone buys. Local-only fields and embedded photos are stripped
// by apiSafeDesign so the upload stays under the API's payload cap.
function useKitPurchase({ type, design, getDesign, savedId, onSaved, onReview }) {
  // Always starts idle, including for a design already in the library. Seeding
  // "done" from savedId used to leave the library's button reading "Saved for
  // checkout ✓" with nowhere to go — an already-uploaded design still needs to
  // be buyable, it just skips the upload.
  const [state, setState] = useState({ status: "idle" });
  const busy = state.status === "saving" || state.status === "redirecting";
  const kit = useKitPrice(type, design);
  const price = formatKitPrice(kit);
  const sellable = !!kitHandle(type, design);
  // Remembers the last upload so buying twice doesn't park a second copy. Keyed
  // on the payload rather than a flag, because the editor's canvas keeps moving
  // — an edited design has to upload fresh, an untouched one shouldn't.
  const lastUpload = useRef(null);

  const ensureSaved = async (record) => {
    if (savedId) return savedId;
    const data = apiSafeDesign(record);
    const key = JSON.stringify(data);
    if (lastUpload.current && lastUpload.current.key === key) return lastUpload.current.id;
    const id = await saveDesignToApi(type, data);
    lastUpload.current = { key, id };
    if (onSaved) onSaved(id);
    return id;
  };

  const submit = async () => {
    if (busy) return;
    const record = getDesign ? getDesign() : design;
    if (!record) return;
    setState({ status: "saving" });
    let designId;
    try {
      designId = await ensureSaved(record);
    } catch (e) {
      console.warn("Design save failed:", e);
      setState({ status: "error", message: "Couldn't reach the kit service. Try again." });
      return;
    }
    // Either Shopify isn't wired up or this size has no kit product. The design
    // is safely stored either way, so stop quietly instead of erroring.
    if (!shopifyConfigured(type, record)) {
      setState({ status: "done", id: designId });
      return;
    }
    if (onReview) {
      // Back to idle, not "done": Back from the review page comes straight to
      // this button, and it has to be ready to send them forward again.
      setState({ status: "idle" });
      onReview({ type, designId, record });
      return;
    }
    setState({ status: "redirecting", id: designId });
    try {
      await startKitCheckout(type, record, designId);
    } catch (e) {
      console.warn("Shopify checkout failed:", e);
      setState({ status: "error", message: "Couldn't reach checkout. Your design is safe. Try again in a moment." });
    }
  };

  return { status: state.status, message: state.message, busy, kit, price, sellable, submit };
}

// Checkout button in the saved-design preview modals — the re-order path for
// something already in the library. The editor header is where a design is
// bought the first time (see BuyKitButton). Both land on the same review page.
function KitCheckoutButton({ type, design, savedId, onSaved, onReview }) {
  const { status, message, busy, price, sellable, submit } =
    useKitPurchase({ type, design, savedId, onSaved, onReview });
  const label = status === "saving" ? "Saving…"
    : status === "redirecting" ? "Opening checkout…"
    : status === "done" ? "Saved for checkout"
    : sellable ? (price ? `Review kit · ${price}` : "Review kit")
    : "Save for checkout";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
      <button className="btn btn-dark" disabled={busy}
        style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 20px", fontSize: 13, opacity: busy ? 0.7 : 1 }}
        onClick={submit}>
        {status === "done" ? <IcCheck size={16}/> : <IcCart/>}
        {label}
      </button>
      {status === "idle" && !sellable && (
        <div style={{ fontSize: 11, color: "var(--warm-muted)" }}>
          This size isn't sold as a kit yet
        </div>
      )}
      {status === "error" && (
        <div className="err-msg" style={{ fontSize: 11 }}>{message || "Couldn't reach the kit service. Try again."}</div>
      )}
    </div>
  );
}

// The primary call to action in both studio editors: buy the kit for whatever is
// on the canvas right now, without saving or signing in first. `getDesign` builds
// the record on click, so there's nothing to persist beforehand.
//
// `blockedReason`, when set, disables the button and explains itself on hover —
// used for a canvas with nothing stitched on it yet. A size with no kit product
// behind it disables the same way rather than disappearing, so the header
// doesn't reflow between sizes.
function BuyKitButton({ type, design, getDesign, blockedReason, onSaved, onReview }) {
  const { status, message, busy, price, sellable, submit } =
    useKitPurchase({ type, design, getDesign, onSaved, onReview });
  // Not being sold outranks an empty canvas: telling someone to add stitches
  // first would imply the kit exists once they do.
  const blocked = (!sellable ? "This size isn't sold as a kit yet" : null) || blockedReason;
  const label = status === "saving" ? "Saving…"
    : status === "redirecting" ? "Opening checkout…"
    : price ? <>Buy kit<span className="buy-kit-price"> · {price}</span></>
    : "Buy kit";
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
      <button className="btn btn-dark" disabled={busy || !!blocked}
        title={blocked || "Buy the kit for this design"}
        style={{ display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap", opacity: busy || blocked ? 0.55 : 1 }}
        onClick={submit}>
        <IcCart size={15}/>
        {label}
      </button>
      {status === "error" && (
        <div className="err-msg" style={{ position: "absolute", top: "100%", right: 0, marginTop: 6, fontSize: 11, whiteSpace: "nowrap", zIndex: 5 }}>
          {message || "Couldn't reach the kit service. Try again."}
        </div>
      )}
    </div>
  );
}

// Two "Download PDF" buttons for a quilt: the cut list & template, and the
// assembly instructions. Both hit /api/render (server-side HTML → PDF); each
// manages its own busy state so a slow render doesn't block the other.
function QuiltPdfButtons({ design }) {
  const [busy, setBusy] = useState(null); // "chart" | "instructions" | null
  const [error, setError] = useState(null);
  const go = async (doc) => {
    if (busy) return;
    setBusy(doc); setError(null);
    try {
      await downloadDesignPdf("quilt", design, doc);
    } catch (e) {
      console.warn("PDF download failed:", e);
      setError("Couldn't generate the PDF. Please try again in a moment.");
    } finally {
      setBusy(null);
    }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div className="label" style={{ fontSize: 11 }}>Download for making</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn btn-sm" disabled={!!busy} style={{ opacity: busy && busy !== "chart" ? 0.6 : 1 }}
          onClick={() => go("chart")}>
          {busy === "chart" ? "Preparing…" : "Cut list & template"}
        </button>
        <button className="btn btn-sm" disabled={!!busy} style={{ opacity: busy && busy !== "instructions" ? 0.6 : 1 }}
          onClick={() => go("instructions")}>
          {busy === "instructions" ? "Preparing…" : "Instructions"}
        </button>
      </div>
      {error && <div className="err-msg" style={{ fontSize: 11 }}>{error}</div>}
    </div>
  );
}
