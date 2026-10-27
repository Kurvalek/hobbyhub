import React from 'react';
import { createRoot } from 'react-dom/client';
import { canonicalPresetName, fetchDesignRecord } from './services.jsx';
import { resolvePalette, SUGGESTED_PALETTES } from './catalog.jsx';
import { App } from './quilt-studio.jsx';
import { AuthProvider, TweaksPanel } from './account.jsx';
import { CraftSelector } from './landing.jsx';
import { CRAFT_STUDIO, CrossStitchApp } from './stitch-studio.jsx';
import { KitReviewLoading, KitReviewPage } from './kit-review.jsx';

// Depth of each screen, so the History integration can tell a forward move
// (push a new entry) from a backward move (reverse one step). Picking a craft
// opens its studio, which runs the rest of the setup in its own panels. The
// review page sits past the studios, so Back from it always returns to the
// canvas the design came from.
const STEP_DEPTH = { 'craft': 0, 'studio': 1, 'saved': 1, 'cart': 2 };
// Crafts that run on the shared grid studio.
const GRID_CRAFTS = new Set(['cross-stitch', 'punch-needle']);

// What a new design starts from before the studio's guide has the maker choose.
const QUILT_START_PALETTE = resolvePalette(SUGGESTED_PALETTES[0]);
function startingGridPreset(craft) {
  const presets = CRAFT_STUDIO[craft].presets;
  return presets.find(p => p.name === 'Small Hoop') || presets[0];
}

// The review page an entry points at, as { type, designId }. The design itself is
// orders of magnitude too big for a history entry, so only its stored id travels
// and the record is read back from the API.
function snapshotCart(s) {
  return s && s.step === 'cart' && s.cartType && s.cartDesignId
    ? { type: s.cartType, designId: s.cartDesignId }
    : null;
}
// The snapshot this document loaded into, when the browser kept one for the
// entry. 'craft' needs nothing restored, and 'saved' can't be (it points at a
// library item this render knows nothing about), so both start clean. Entries
// from the old setup screens carry a craft too, so they reopen its studio.
function landedSnapshot() {
  if (typeof window === 'undefined') return null;
  const s = window.history.state;
  if (!s || !s.step || s.step === 'craft' || s.step === 'saved') return null;
  return s;
}

function Root() {
  // Seeded during the first render rather than in an effect, so a restored step
  // is what actually paints — an effect would flash the craft picker first.
  const landed = React.useRef(landedSnapshot()).current;

  const [craft, setCraft] = React.useState(landed ? landed.craft || null : null);
  // A saved item opened straight from the landing page: { type, item }.
  const [openSaved, setOpenSaved] = React.useState(null);
  // The kit review page, once a buy button has uploaded the design it's for:
  // { type, designId, record }. Sits over whichever editor opened it, so Back
  // returns to that canvas untouched.
  const [cartKit, setCartKit] = React.useState(null);
  // A review page this document landed on after being rebuilt from nothing. The
  // record arrives over the network, so unlike every other step it can't paint on
  // the first render — hence a separate pending state rather than seeding cartKit.
  const [cartPending, setCartPending] = React.useState(() => snapshotCart(landed));
  // The craft picker opens on the saved designs: "My designs" on the review page.
  const [landAtSaved, setLandAtSaved] = React.useState(false);

  const resetAll = () => {
    setCraft(null); setOpenSaved(null); setCartKit(null); setCartPending(null); setLandAtSaved(false);
  };
  const showSaved = () => { resetAll(); setLandAtSaved(true); };

  // Read the design back for a review page the browser rebuilt. On failure the
  // pending state simply clears, which drops the maker onto the studio the same
  // snapshot already restored — a canvas beats an error page.
  React.useEffect(() => {
    if (!cartPending) return;
    let alive = true;
    fetchDesignRecord(cartPending.designId)
      .then(({ type, record }) => {
        if (!alive) return;
        setCartKit({ type: type || cartPending.type, designId: cartPending.designId, record });
        setCartPending(null);
      })
      .catch((e) => {
        console.warn('Could not restore the kit review page:', e);
        if (alive) setCartPending(null);
      });
    return () => { alive = false; };
  }, [cartPending]);

  // ── Browser Back = previous screen ────────────────────────────────────────
  // The screens are a plain state machine with no URL, so the browser's Back
  // button used to leave the app entirely. We mirror the current screen into the
  // History API: push an entry when the maker moves forward, and put the screen
  // back from the entry's own snapshot on `popstate`.
  const stepKey = React.useMemo(() => {
    // Ahead of everything else: the review page is reached from inside a studio,
    // so the state that decides which studio is still set underneath it.
    if (cartKit || cartPending) return 'cart';
    if (openSaved) return 'saved';
    return craft ? 'studio' : 'craft';
  }, [cartKit, cartPending, openSaved, craft]);

  const prevStepRef = React.useRef(stepKey);

  // What goes into a history entry: only small things that survive being
  // serialized by the browser — never the design, only a stored id for it.
  const snapshot = () => {
    const cart = cartKit || cartPending;
    return {
      step: stepKey,
      craft,
      cartType: cart ? cart.type : null,
      cartDesignId: cart ? cart.designId : null,
    };
  };

  // Put the screen back from an entry's snapshot. Used for popstate, where the
  // document is still alive; a document that was thrown away and rebuilt seeds
  // the same values through useState above instead.
  const applySnapshot = (s) => {
    if (!s || !s.step || s.step === 'craft') { resetAll(); return; }
    // Going back past the review page clears it, revealing the studio still
    // mounted underneath. Arriving on it (forward, after a Back) re-fetches
    // unless the design in hand is already the right one.
    const cart = snapshotCart(s);
    if (!cart) {
      setCartKit(null);
      setCartPending(null);
    } else if (!cartKit || cartKit.designId !== cart.designId) {
      setCartKit(null);
      setCartPending(cart);
    }
    // A saved design can't be rebuilt from an entry, but one still open is
    // exactly the screen the entry means.
    if (openSaved && (s.step === 'saved' || cart)) return;
    if (s.step === 'saved') { resetAll(); return; }
    if (cart && craft) return;
    setOpenSaved(null);
    setCraft(s.craft || null);
  };

  const snapshotRef = React.useRef(snapshot); snapshotRef.current = snapshot;
  const applyRef = React.useRef(applySnapshot); applyRef.current = applySnapshot;

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    // Every entry describes its own screen, so a pop is applied directly rather
    // than reversed one step at a time. That keeps a multi-entry jump — a
    // long-press on Back, or several presses before React catches up — landing
    // exactly where the browser actually went.
    const onPop = (e) => applyRef.current(e.state);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const cur = window.history.state;
    // Already sitting on this screen's entry: we just popped onto it, or this is
    // the first render. Refresh its snapshot rather than adding a duplicate.
    if (cur && cur.step === stepKey) {
      window.history.replaceState(snapshotRef.current(), '');
      prevStepRef.current = stepKey;
      return;
    }
    const d = STEP_DEPTH[stepKey] ?? 0, pd = STEP_DEPTH[prevStepRef.current] ?? 0;
    if (d > pd) {
      // Forward: add an entry so Back returns here.
      window.history.pushState(snapshotRef.current(), '');
    } else {
      window.history.replaceState(snapshotRef.current(), '');
      // A jump backwards the browser didn't make itself — the studio's "Back to
      // projects". Rewind by as many entries as steps so the browser's position
      // matches the screen; left stacked up, they made Back a dead button for
      // the next few presses.
      if (pd > d) window.history.go(d - pd);
    }
    prevStepRef.current = stepKey;
  }, [stepKey]);

  // ── Analytics: one page view per screen ───────────────────────────────────
  // The URL never changes, so each screen reports under a made-up path that
  // reads well in Google Analytics' Pages report. gtag only exists on the live
  // domain with a Measurement ID set (see index.html).
  const cartType = (cartKit || cartPending)?.type;
  const screenPath =
    stepKey === 'cart' ? `/review/${cartType}` :
    stepKey === 'saved' ? `/my-designs/${openSaved.type}` :
    stepKey === 'studio' ? `/${craft}` :
    landAtSaved ? '/my-designs' : '/';
  React.useEffect(() => {
    if (typeof window.gtag !== 'function') return;
    window.gtag('event', 'page_view', {
      page_location: window.location.origin + screenPath,
      page_title: `metime · ${screenPath}`,
    });
  }, [screenPath]);

  // What a buy button does now: the design is uploaded, and the maker gets to see
  // what's in the box before Shopify takes over.
  const openCart = (kit) => setCartKit(kit);

  // The review page covers the studio rather than replacing it. Nothing autosaves
  // a canvas mid-edit, so unmounting the editor to show a cart would quietly throw
  // away the work someone is about to buy — and Back would hand them a blank one.
  return (
    <>
      {studioScreen()}
      {cartKit && (
        <div className="kit-layer">
          <KitReviewPage type={cartKit.type} record={cartKit.record} designId={cartKit.designId}
            onBack={() => window.history.back()} onMyDesigns={showSaved}/>
        </div>
      )}
      {!cartKit && cartPending && <div className="kit-layer"><KitReviewLoading type={cartPending.type}/></div>}
    </>
  );

  // Hoisted, so it can be called above while the screens themselves stay in the
  // reading order of the flow.
  function studioScreen() {
    // A saved design opens straight into editing, with that design loaded.
    if (openSaved) {
      if (openSaved.type === 'quilt') {
        return (
          <>
            <App initialPreset={openSaved.item.preset || 'Throw'}
              initialPalette={openSaved.item.pinned || null}
              initialQuilt={openSaved.item} onBack={resetAll} onReview={openCart}/>
            <TweaksPanel/>
          </>
        );
      }
      return (
        <CrossStitchApp
          craft={openSaved.type === 'punch' ? 'punch-needle' : 'cross-stitch'}
          preset={{ name: canonicalPresetName(openSaved.type === 'punch' ? 'punch-needle' : 'cross-stitch', openSaved.item.presetName) || 'Custom', w: openSaved.item.w, h: openSaved.item.h }}
          palette={openSaved.item.palette}
          initialDesign={openSaved.item} onBack={resetAll} onReview={openCart}/>
      );
    }

    if (!craft) {
      return <CraftSelector onSelect={setCraft} onOpenSaved={(type, item) => setOpenSaved({ type, item })}
        startAtSaved={landAtSaved}/>;
    }

    // A new design: the studio opens on its Size panel and guides the maker
    // through size, starting point, colors and fabric before free editing.
    if (GRID_CRAFTS.has(craft)) {
      return <CrossStitchApp key={craft} guided craft={craft} preset={startingGridPreset(craft)} palette={null}
        onBack={resetAll} onReview={openCart}/>;
    }
    return (
      <>
        <App guided initialPalette={QUILT_START_PALETTE} onBack={resetAll} onReview={openCart}/>
        <TweaksPanel/>
      </>
    );
  }
}

createRoot(document.getElementById("root")).render(<AuthProvider><Root/></AuthProvider>);
