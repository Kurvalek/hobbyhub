import React from 'react';
import { createRoot } from 'react-dom/client';
import { canonicalPresetName, fetchDesignRecord } from './services.jsx';
import { App } from './quilt-studio.jsx';
import { AuthProvider, TweaksPanel } from './account.jsx';
import { CraftSelector, ProjectSelector } from './landing.jsx';
import { GRID_TEMPLATES, gridSeedFromTemplate, QUILT_TEMPLATES } from './templates.jsx';
import {
  CrossStitchPaletteSelector, CrossStitchSizeSelector, CrossStitchTemplateSelector,
  PaletteSelector, QuiltBackingSelector, TemplateSelector,
} from './setup-steps.jsx';
import { CRAFT_STUDIO, CrossStitchApp } from './stitch-studio.jsx';
import { KitReviewLoading, KitReviewPage } from './kit-review.jsx';

// Depth of each step in the setup flow, so the History integration can tell a
// forward move (push a new entry) from a backward move (reverse one step).
// The review page sits past every editor, so Back from it always returns to the
// canvas the design came from.
const STEP_DEPTH = {
  'craft': 0,
  'q-size': 1, 'q-backing': 2, 'q-palette': 3, 'q-template': 4, 'q-editor': 5,
  'xs-size': 1, 'xs-template': 2, 'xs-palette': 3, 'xs-editor': 4,
  'pn-size': 1, 'pn-template': 2, 'pn-palette': 3, 'pn-editor': 4,
  'saved': 1,
  'cart': 6,
};
// Crafts that run on the shared grid studio, and the prefix their setup steps
// use. Both walk the same size → template → palette → editor chain, so they
// share one set of flow state and one set of step components.
const GRID_CRAFTS = { 'cross-stitch': 'xs', 'punch-needle': 'pn' };

// ── Restoring a step from its history entry ────────────────────────────────
// Each entry carries a snapshot of the choices that identify its step (see
// `snapshot` in Root). These rebuild the parts that aren't themselves
// serializable: templates are stored by id and their chart is rebuilt.
function findQuiltTemplate(id) {
  return id ? QUILT_TEMPLATES.find(t => t.id === id) || null : null;
}
function findGridTemplate(craft, id) {
  return id ? (GRID_TEMPLATES[craft] || []).find(t => t.id === id) || null : null;
}
// An uploaded photo only ever lived in memory, so a traced design can't come
// back. Those steps hand the maker back to the template picker instead of a
// palette step with nothing to trace.
function gridStepsRestorable(s) {
  return !s.hadPhoto || !!s.gridTemplateId;
}
// Re-dress the template's own chart exactly as the palette step does, so a
// restored grid craft opens on its design rather than an empty board.
function restoredGridOpts(s) {
  const t = findGridTemplate(s.craft, s.gridTemplateId);
  if (!t || !s.gridPreset) return {};
  return { bgImage: null, ...gridSeedFromTemplate(t, s.gridPreset, s.gridPalette || null) };
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
// library item this render knows nothing about), so both start clean.
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
  const gridOk = !!landed && gridStepsRestorable(landed);

  const [craft, setCraft] = React.useState(landed ? landed.craft || null : null);
  const [selectedPreset, setSelectedPreset] = React.useState(landed ? landed.preset || null : null);
  const [templateDone, setTemplateDone] = React.useState(!!landed && !!landed.templateDone);
  const [quiltTemplate, setQuiltTemplate] = React.useState(landed ? findQuiltTemplate(landed.quiltTemplateId) : null);
  const [paletteDone, setPaletteDone] = React.useState(!!landed && !!landed.paletteDone);
  const [palette, setPalette] = React.useState(landed ? landed.palette || null : null);
  const [backingFabric, setBackingFabric] = React.useState(landed ? landed.backingFabric || null : null);
  const [quiltBackingDone, setQuiltBackingDone] = React.useState(!!landed && !!landed.quiltBackingDone);
  // Grid-craft flow state, shared by cross-stitch and punch needle — only one
  // craft is ever mid-flow, and their steps are the same shape.
  const [gridPreset, setGridPreset] = React.useState(landed ? landed.gridPreset || null : null);
  const [gridTemplateDone, setGridTemplateDone] = React.useState(gridOk && !!landed.gridTemplateDone);
  const [gridTemplate, setGridTemplate] = React.useState(landed ? findGridTemplate(landed.craft, landed.gridTemplateId) : null);
  const [gridPhoto, setGridPhoto] = React.useState(null);
  const [gridRemoveBg, setGridRemoveBg] = React.useState(landed ? landed.gridRemoveBg !== false : true);
  const [gridDone, setGridDone] = React.useState(gridOk && !!landed.gridDone);
  const [gridPalette, setGridPalette] = React.useState(landed ? landed.gridPalette || null : null);
  const [gridOpts, setGridOpts] = React.useState(landed ? restoredGridOpts(landed) : {});
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

  const resetAll = () => {
    setCraft(null); setSelectedPreset(null); setTemplateDone(false); setQuiltTemplate(null);
    setPaletteDone(false); setPalette(null); setBackingFabric(null); setQuiltBackingDone(false);
    setGridPreset(null); setGridTemplateDone(false); setGridTemplate(null); setGridPhoto(null);
    setGridRemoveBg(true); setGridDone(false); setGridPalette(null); setGridOpts({});
    setOpenSaved(null); setCartKit(null); setCartPending(null);
  };

  // Read the design back for a review page the browser rebuilt. On failure the
  // pending state simply clears, which drops the maker onto the editor step the
  // same snapshot already restored — a canvas beats an error page.
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

  // ── Browser Back = previous step ──────────────────────────────────────────
  // The screens above are a plain state machine with no URL, so the browser's
  // Back button used to leave the app entirely. We mirror the current step into
  // the History API: push an entry when the maker moves forward, and put the
  // screen back from the entry's own snapshot on `popstate`. The in-app "Back"
  // links route through history.back() too, so both paths behave identically.
  const stepKey = React.useMemo(() => {
    // Ahead of everything else: the review page is reached from inside an editor,
    // so the state that decides which editor is still set underneath it.
    if (cartKit || cartPending) return 'cart';
    if (openSaved) return 'saved';
    if (!craft) return 'craft';
    const p = GRID_CRAFTS[craft];
    if (p) {
      if (!gridPreset) return `${p}-size`;
      if (!gridTemplateDone) return `${p}-template`;
      if (!gridDone) return `${p}-palette`;
      return `${p}-editor`;
    }
    if (!selectedPreset) return 'q-size';
    if (!quiltBackingDone) return 'q-backing';
    if (!paletteDone) return 'q-palette';
    if (!templateDone) return 'q-template';
    return 'q-editor';
  }, [cartKit, cartPending, openSaved, craft, gridPreset, gridTemplateDone, gridDone, selectedPreset, quiltBackingDone, paletteDone, templateDone]);

  const prevStepRef = React.useRef(stepKey);

  // What goes into a history entry. Everything here has to survive being
  // serialized by the browser and stored for the life of the entry, so it holds
  // only small, rebuildable things: templates by id, never the uploaded photo or
  // the built chart. `hadPhoto` is kept so a restore knows the difference between
  // "no template" and "traced from a photo we can no longer produce".
  const snapshot = () => {
    // Only the stored id, never the record. The rest of the flow state still goes
    // in, so an entry that can't produce its design falls back to the editor it
    // was bought from rather than the craft picker.
    const cart = cartKit || cartPending;
    return {
      step: stepKey,
      craft,
      preset: selectedPreset,
      backingFabric,
      palette,
      quiltTemplateId: quiltTemplate ? quiltTemplate.id : null,
      quiltBackingDone, paletteDone, templateDone,
      gridPreset,
      gridPalette,
      gridRemoveBg,
      gridTemplateId: gridTemplate ? gridTemplate.id : null,
      gridTemplateDone, gridDone,
      hadPhoto: !!gridPhoto,
      cartType: cart ? cart.type : null,
      cartDesignId: cart ? cart.designId : null,
    };
  };

  // Put the screen back from an entry's snapshot. Used for popstate, where the
  // document is still alive; a document that was thrown away and rebuilt seeds
  // the same values through useState above instead.
  const applySnapshot = (s) => {
    if (!s || !s.step || s.step === 'craft' || s.step === 'saved') { resetAll(); return; }
    const ok = gridStepsRestorable(s);
    setOpenSaved(null);
    setCraft(s.craft || null);
    setSelectedPreset(s.preset || null);
    setBackingFabric(s.backingFabric || null);
    setPalette(s.palette || null);
    setQuiltTemplate(findQuiltTemplate(s.quiltTemplateId));
    setQuiltBackingDone(!!s.quiltBackingDone);
    setPaletteDone(!!s.paletteDone);
    setTemplateDone(!!s.templateDone);
    setGridPreset(s.gridPreset || null);
    setGridPalette(s.gridPalette || null);
    setGridRemoveBg(s.gridRemoveBg !== false);
    setGridTemplate(findGridTemplate(s.craft, s.gridTemplateId));
    setGridPhoto(null);
    setGridOpts(restoredGridOpts(s));
    setGridTemplateDone(ok && !!s.gridTemplateDone);
    setGridDone(ok && !!s.gridDone);
    // Going back past the review page clears it, revealing the editor restored
    // above. Arriving on it (forward, after a Back) re-fetches unless the design
    // in hand is already the right one.
    const cart = snapshotCart(s);
    if (!cart) {
      setCartKit(null);
      setCartPending(null);
    } else if (!cartKit || cartKit.designId !== cart.designId) {
      setCartKit(null);
      setCartPending(cart);
    }
  };

  const snapshotRef = React.useRef(snapshot); snapshotRef.current = snapshot;
  const applyRef = React.useRef(applySnapshot); applyRef.current = applySnapshot;

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    // Every entry describes its own step, so a pop is applied directly rather
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
    // Already sitting on this step's entry: we just popped onto it, or this is
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
            onBack={() => window.history.back()}/>
        </div>
      )}
      {!cartKit && cartPending && <div className="kit-layer"><KitReviewLoading/></div>}
    </>
  );

  // Hoisted, so it can be called above while the screens themselves stay in the
  // reading order of the flow.
  function studioScreen() {
    // Opening a saved design bypasses the craft/size/palette steps and drops the
    // user straight onto the matching editor with that design loaded.
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
      return <CraftSelector onSelect={setCraft} onOpenSaved={(type, item) => setOpenSaved({ type, item })}/>;
    }

    if (GRID_CRAFTS[craft]) {
      const cfg = CRAFT_STUDIO[craft];
      if (!gridPreset) {
        return <CrossStitchSizeSelector craft={craft} onBack={() => window.history.back()}
          onSelect={name => setGridPreset(cfg.presets.find(p => p.name === name))}/>;
      }
      if (!gridTemplateDone) {
        return (
          <CrossStitchTemplateSelector
            preset={gridPreset}
            craft={craft}
            onBack={() => window.history.back()}
            onChoose={({ template, photo, removeBg }) => {
              setGridTemplate(template);
              setGridPhoto(photo || null);
              setGridRemoveBg(removeBg !== false);
              if (template) {
                // Seed the design from the template chart; color work is next.
                setGridOpts({ bgImage: null, ...gridSeedFromTemplate(template, gridPreset, null) });
              } else {
                // Photo (or nothing yet): the design + trace are built on the palette step.
                setGridOpts({});
              }
              setGridTemplateDone(true);
            }}
            onSkip={() => { setGridTemplate(null); setGridPhoto(null); setGridRemoveBg(true); setGridOpts({}); setGridTemplateDone(true); }}/>
        );
      }
      if (!gridDone) {
        return (
          <CrossStitchPaletteSelector
            preset={gridPreset}
            photo={gridPhoto}
            template={gridTemplate}
            removeBgDefault={gridRemoveBg}
            craft={craft}
            onBack={() => window.history.back()}
            onChoose={(pal, extra) => {
              const colors = pal && pal.length ? pal : null;
              setGridPalette(colors);
              setGridOpts(o => {
                const next = { ...o, ...(extra || null) };
                // A chosen palette overrides the template's default brand colors.
                // (A photo-traced design is already built from the palette.)
                if (gridTemplate) Object.assign(next, gridSeedFromTemplate(gridTemplate, gridPreset, colors));
                return next;
              });
              setGridDone(true);
            }}
            onSkip={() => {
              setGridPalette(null);
              setGridOpts(o => {
                const next = { ...o };
                if (gridPhoto) next.bgImage = gridPhoto;
                // No palette — back to the template's brand colors.
                if (gridTemplate) Object.assign(next, gridSeedFromTemplate(gridTemplate, gridPreset, null));
                return next;
              });
              setGridDone(true);
            }}/>
        );
      }
      return (
        <CrossStitchApp preset={gridPreset} palette={gridPalette} craft={craft}
          bgImage={gridOpts.bgImage} autoGrid={gridOpts.autoGrid} autoPages={gridOpts.autoPages}
          seedText={gridTemplate && gridTemplate.seedText} onBack={resetAll} onReview={openCart}/>
      );
    }

    if (!selectedPreset) {
      return <ProjectSelector onSelect={setSelectedPreset} onBack={() => window.history.back()}/>;
    }
    if (!quiltBackingDone) {
      return (
        <QuiltBackingSelector
          preset={selectedPreset}
          onBack={() => window.history.back()}
          onChoose={b => { setBackingFabric(b); setQuiltBackingDone(true); }}
          onSkip={() => { setBackingFabric(null); setQuiltBackingDone(true); }}/>
      );
    }
    if (!paletteDone) {
      return (
        <PaletteSelector
          presetName={selectedPreset}
          backing={backingFabric}
          onBack={() => window.history.back()}
          onChoose={pal => { setPalette(pal); setPaletteDone(true); }}
          onSkip={() => { setPalette(null); setPaletteDone(true); }}/>
      );
    }
    if (!templateDone) {
      return (
        <TemplateSelector
          preset={selectedPreset}
          palette={palette}
          onBack={() => window.history.back()}
          onChoose={t => { setQuiltTemplate(t); setTemplateDone(true); }}
          onSkip={() => { setQuiltTemplate(null); setTemplateDone(true); }}/>
      );
    }
    return (
      <>
        <App initialPreset={selectedPreset} initialPalette={palette} initialBacking={backingFabric} initialTemplate={quiltTemplate} onBack={resetAll} onReview={openCart}/>
        <TweaksPanel/>
      </>
    );
  }
}

createRoot(document.getElementById("root")).render(<AuthProvider><Root/></AuthProvider>);
