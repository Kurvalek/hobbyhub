import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AuthContext, claimLocalDesigns, fetchMe, flushPendingSave, hydrateLocalLibrary,
  listCloudDesigns, logoutUser, persistSavedPunch, persistSavedQuilts, persistSavedStitches,
  readPendingSave, requestAuthCode, sb, SUPABASE_LOAD_GRACE_MS, supabaseConfigured,
  supabaseKeysPresent, toStudioUser, useAuth, verifyAuthCode, warnSupabaseUnreachable,
} from './services.jsx';
import { IcCheck, IcLogout, IcMenu, IcProfile } from './icons.jsx';
import { Popover } from './editor-ui.jsx';

// ── Tweaks ────────────────────────────────────────────────────────────────
// These are applied as inline custom properties on :root at startup, so they beat
// the stylesheet — which makes them the real source of the app ground, the panel
// divider and the control radius, whatever the :root block above says. They carry
// the brand values for that reason.
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "borderColor": "rgba(23, 23, 23, 0.22)",
  "borderWidth": "1",
  "appBg": "#F9F7F2",
  "canvasBg": "#FFFFFF",
  "radius": "4"
}/*EDITMODE-END*/;

function applyTweaks(t) {
  const b = `${t.borderWidth}px solid ${t.borderColor}`;
  const root = document.documentElement;
  root.style.setProperty('--div-border', b);
  root.style.setProperty('--app-bg', t.appBg);
  root.style.setProperty('--canvas-bg', t.canvasBg);
  // Through the token, so the knob moves every button and not only .btn — the
  // stylesheet's other controls read the same property. Inputs and chips still
  // need the rule below: they aren't buttons and don't use the button token.
  root.style.setProperty('--btn-radius', `${t.radius}px`);
  let s = document.getElementById('_tweak_s');
  if (!s) { s = document.createElement('style'); s.id = '_tweak_s'; document.head.appendChild(s); }
  s.textContent = `input[type=text], input[type=email], select, .chip { border-radius: ${t.radius}px !important; } body { background: ${t.appBg}; }`;
}

export function TweaksPanel() {
  const [open, setOpen] = React.useState(false);
  const [t, setT] = React.useState(TWEAK_DEFAULTS);

  React.useEffect(() => {
    applyTweaks(TWEAK_DEFAULTS);
    const handler = (e) => {
      if (e.data && e.data.type === '__activate_edit_mode') setOpen(true);
      if (e.data && e.data.type === '__deactivate_edit_mode') setOpen(false);
    };
    window.addEventListener('message', handler);
    window.parent.postMessage({ type: '__edit_mode_available' }, '*');
    return () => window.removeEventListener('message', handler);
  }, []);

  const set = (key, val) => {
    const next = { ...t, [key]: val };
    setT(next);
    applyTweaks(next);
    window.parent.postMessage({ type: '__edit_mode_set_keys', edits: { [key]: val } }, '*');
  };

  if (!open) return null;

  const Row = ({ label, children }) => (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
      <span style={{ fontSize:11, color:'#3D4E70' }}>{label}</span>
      {children}
    </div>
  );

  return (
    <div style={{
      position:'fixed', bottom:16, right:16, zIndex:200,
      background:'#FFFFFF', border:'1px solid #000000', borderRadius:4,
      padding:'14px 16px', width:230,
      boxShadow:'0 4px 20px rgba(0,0,0,0.12)',
      fontFamily:"var(--font-sans)",
    }}>
      <div style={{ fontSize:11, fontWeight:600, marginBottom:14, letterSpacing:'0.08em', textTransform:'uppercase', color:'#000000' }}>Tweaks</div>

      <Row label="Border color">
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <input type="color" value={t.borderColor} onChange={e=>set('borderColor',e.target.value)}
            style={{ width:28, height:24, padding:2, border:'1px solid #CCD6EB', borderRadius:3, cursor:'pointer', background:'none' }}/>
          <span style={{ fontSize:10, fontFamily:"var(--font-sans)", color:'var(--warm-muted)' }}>{t.borderColor}</span>
        </div>
      </Row>

      <Row label="Border width">
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <input type="range" min={0} max={4} step={0.5} value={t.borderWidth} onChange={e=>set('borderWidth',e.target.value)}
            style={{ width:80, accentColor:'#000000' }}/>
          <span style={{ fontSize:10, fontFamily:"var(--font-sans)", color:'var(--warm-muted)', minWidth:28 }}>{t.borderWidth}px</span>
        </div>
      </Row>

      <Row label="Corner radius">
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <input type="range" min={0} max={12} step={1} value={t.radius} onChange={e=>set('radius',e.target.value)}
            style={{ width:80, accentColor:'#000000' }}/>
          <span style={{ fontSize:10, fontFamily:"var(--font-sans)", color:'var(--warm-muted)', minWidth:28 }}>{t.radius}px</span>
        </div>
      </Row>

      <Row label="Background">
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <input type="color" value={t.appBg} onChange={e=>set('appBg',e.target.value)}
            style={{ width:28, height:24, padding:2, border:'1px solid #CCD6EB', borderRadius:3, cursor:'pointer', background:'none' }}/>
          <span style={{ fontSize:10, fontFamily:"var(--font-sans)", color:'var(--warm-muted)' }}>{t.appBg}</span>
        </div>
      </Row>

      <Row label="Canvas bg">
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <input type="color" value={t.canvasBg} onChange={e=>set('canvasBg',e.target.value)}
            style={{ width:28, height:24, padding:2, border:'1px solid #CCD6EB', borderRadius:3, cursor:'pointer', background:'none' }}/>
          <span style={{ fontSize:10, fontFamily:"var(--font-sans)", color:'var(--warm-muted)' }}>{t.canvasBg}</span>
        </div>
      </Row>

      <button onClick={()=>{ setT(TWEAK_DEFAULTS); applyTweaks(TWEAK_DEFAULTS); }}
        style={{ marginTop:6, width:'100%', padding:'5px 0', fontSize:11, background:'none', border:'1px solid #CCD6EB', borderRadius:4, cursor:'pointer', color:'var(--warm-muted)', fontFamily:"var(--font-sans)" }}>
        Reset defaults
      </button>
    </div>
  );
}

export const CRAFTS = [
  { id: "cross-stitch", name: "Cross-stitch", ready: true,
    desc: "Turn an image into a stitchable grid, with thread counts included.",
    image: "assets/landing/craft-cross-stitch.png", imgW: 256, imgH: 256 },
  { id: "quilt", name: "Quilt", ready: true,
    desc: "Compose with squares and half-square triangles, then get the yardage.",
    image: "assets/landing/craft-quilt.png", imgW: 208, imgH: 260 },
  { id: "punch-needle", name: "Punch Needle", ready: true,
    desc: "Punch a design in loops, with yarn quantities listed for the kit.",
    image: "assets/landing/craft-punch-needle-wall.png", imgW: 246, imgH: 269 },
];

function AccountMenu() {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = e => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!auth || !auth.user) return null;
  return (
    <div className="account-menu" ref={wrapRef}>
      <button type="button" className="account-menu-btn" aria-expanded={open} aria-haspopup="menu"
        aria-label="Account" onClick={() => setOpen(o => !o)}>
        <IcProfile size={24}/>
      </button>
      {open && (
        <div className="account-menu-pop" role="menu">
          <div className="account-menu-email" title={auth.user.email}>{auth.user.email}</div>
          <button type="button" className="account-menu-out" role="menuitem"
            onClick={() => { setOpen(false); auth.signOut(); }}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function AccountChip() {
  return <AccountMenu/>;
}

// Mobile studio header: the secondary actions collapse behind one button so
// Buy kit keeps its room. `items` are { id, label, icon, meta, onClick };
// `children` render above them for controls that shouldn't close the menu.
// Signed-in account details sit at the bottom, replacing the separate chip.
function StudioMenu({ items, saved = false, children }) {
  const auth = useAuth();
  const btnRef = useRef(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const user = auth && auth.user;
  return (
    <>
      <button ref={btnRef} type="button" className="icon-btn studio-menu-btn"
        aria-haspopup="menu" aria-expanded={open}
        aria-label={saved ? 'Saved. More actions' : 'More actions'} title="More actions"
        onClick={() => setOpen(o => !o)}>
        {saved ? <IcCheck size={20}/> : <IcMenu/>}
      </button>
      {open && (
        <Popover anchorRef={btnRef} onClose={close} placement="bottom-end" width={260}>
          <div className="studio-menu" role="menu">
            {children && <div className="studio-menu-controls">{children}</div>}
            {items.map(it => (
              <button key={it.id} type="button" className="studio-menu-item" role="menuitem"
                onClick={() => { close(); it.onClick(); }}>
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
                  onClick={() => { close(); auth.signOut(); }}>
                  <span className="studio-menu-icon" aria-hidden="true"><IcLogout/></span>
                  <span className="studio-menu-label">Sign out</span>
                </button>
              </>
            )}
          </div>
        </Popover>
      )}
    </>
  );
}

export function LandingAuth() {
  const auth = useAuth();
  if (!auth || !auth.cloudEnabled) return null;
  if (auth.user) return <AccountMenu/>;
  return <button className="land-login" type="button" onClick={auth.openAuth}>Log In</button>;
}

// Supabase throttles OTP emails per address (one a minute by default), so the
// Resend button counts down rather than letting someone earn a 429.
const RESEND_COOLDOWN_SEC = 60;

// Copy for every failure the OTP flow can actually produce. Split by step
// because the same normalized code means different things when sending vs
// verifying ("too many codes sent" / "too many tries").
const AUTH_ERROR_COPY = {
  send: {
    rate_limited: "Too many codes requested. Wait a minute and try again.",
    signups_disabled: "New accounts are turned off for this studio right now.",
    email_send_failed: "We couldn't send the email. The studio's email delivery isn't set up yet. Your design stays on this device.",
    network: "Couldn't reach the network. Check your connection and try again.",
    not_configured: "Accounts aren't set up yet. Your design stays on this device.",
    unknown: "Couldn't send a code. Try again.",
  },
  verify: {
    invalid_code: "That code didn't match. Check the digits and try again.",
    expired: "That code has expired. Send a fresh one.",
    rate_limited: "Too many tries. Wait a minute and try again.",
    network: "Couldn't reach the network. Check your connection and try again.",
    not_configured: "Accounts aren't set up yet. Your design stays on this device.",
    unknown: "That code didn't work. Try again.",
  },
};

function AuthOverlay() {
  const auth = useAuth();
  const [step, setStep] = useState("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (auth && auth.authOpen) {
      setStep("email");
      setCode("");
      setError("");
      setNotice("");
      setBusy(false);
      setCooldown(0);
    }
  }, [auth && auth.authOpen]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  if (!auth || !auth.authOpen) return null;

  const sendCode = async (isResend) => {
    const trimmed = email.trim();
    if (!trimmed || (isResend && cooldown > 0)) return;
    setBusy(true); setError(""); setNotice("");
    const result = await requestAuthCode(trimmed);
    setBusy(false);
    if (!result.ok) {
      setError(AUTH_ERROR_COPY.send[result.error] || AUTH_ERROR_COPY.send.unknown);
      // A 429 means Supabase already sent one recently, so still start the
      // countdown — retrying sooner can only fail again.
      if (result.error === "rate_limited") setCooldown(RESEND_COOLDOWN_SEC);
      return;
    }
    setEmail(trimmed);
    setStep("code");
    setCode("");
    setCooldown(RESEND_COOLDOWN_SEC);
    if (isResend) setNotice("New code sent.");
  };

  const submitCode = async () => {
    if (code.replace(/\D/g, "").length !== 6) return;
    setBusy(true); setError(""); setNotice("");
    const result = await verifyAuthCode(email, code);
    if (!result.ok) {
      setBusy(false);
      setError(AUTH_ERROR_COPY.verify[result.error] || AUTH_ERROR_COPY.verify.unknown);
      if (result.error === "expired") setCooldown(0);
      setCode("");
      return;
    }
    // completeAuth uploads the pending design and pulls the library down, so the
    // button stays busy until the save has actually landed.
    await auth.completeAuth(result.user);
  };

  const resendLabel = cooldown > 0 ? `Resend in ${cooldown}s` : "Resend";

  return (
    <div className="overlay" onClick={auth.closeAuth}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: "#FFFFFF", border: "1px solid #CCD6EB", borderRadius: 8, padding: 24, maxWidth: 400, width: "100%", margin: 16, boxShadow: "0 8px 32px rgba(0,0,0,0.14)" }}>
        <div style={{ fontWeight: 400, fontSize: 24, marginBottom: 8, fontFamily: "var(--font-display)", lineHeight: 1.1 }}>
          {step === "email" ? "Save to your account" : "Enter your code"}
        </div>
        <div style={{ fontSize: 13, color: "#3D4E70", marginBottom: 16, lineHeight: 1.5 }}>
          {step === "email"
            ? "We'll email a 6-digit code so you can reopen this design on any device. No password."
            : `We sent a code to ${email}. Check your inbox. It expires shortly.`}
        </div>
        {step === "email" ? (
          <input type="email" placeholder="you@email.com" value={email} autoFocus
            onChange={e => setEmail(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") sendCode(false); }}
            style={{ marginBottom: 16 }}/>
        ) : (
          <input className="auth-code" type="text" inputMode="numeric" autoComplete="one-time-code"
            placeholder="000000" maxLength={6} value={code} autoFocus
            onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            onKeyDown={e => { if (e.key === "Enter") submitCode(); }}
            style={{ marginBottom: 16 }}/>
        )}
        {error && (
          <div className="err-msg" style={{ fontSize: 12, marginBottom: 12 }}>{error}</div>
        )}
        {!error && notice && (
          <div style={{ fontSize: 12, color: "#3D4E70", marginBottom: 12 }}>{notice}</div>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
          {step === "code" && (
            <button className="btn" type="button" disabled={busy || cooldown > 0} onClick={() => sendCode(true)}>{resendLabel}</button>
          )}
          <button className="btn" type="button" onClick={auth.closeAuth}>Cancel</button>
          {step === "email" ? (
            <button className="btn btn-dark" type="button" disabled={busy || !email.trim()} onClick={() => sendCode(false)}>
              {busy ? "Sending…" : "Send code"}
            </button>
          ) : (
            <button className="btn btn-dark" type="button" disabled={busy || code.length !== 6} onClick={submitCode}>
              {busy ? "Saving…" : "Verify"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Sits at the top of the Save overlays, and only when the config is real but
// the client never loaded. Nothing to say when Supabase was never set up: that
// studio is local-only on purpose and shouldn't be pestered about it.
export function AccountsOfflineNote() {
  const auth = useAuth();
  if (!auth || !auth.cloudBlocked) return null;
  return (
    <div style={{fontSize:12,color:'var(--metime-tomato)',background:'#FBECE8',border:'1px solid #F3C9BF',borderRadius:6,padding:'8px 10px',marginBottom:16}}>
      Accounts couldn't load, so this saves to this device only. Check your
      connection or a script blocker, then reload to sign in.
    </div>
  );
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined);
  const [authOpen, setAuthOpen] = useState(false);
  const [libraryTick, setLibraryTick] = useState(0);
  const [lastSaved, setLastSaved] = useState(null);
  // Normally settled on the first render, since supabase-js is a synchronous
  // <script> in <head>. It's state rather than a constant so that a slow or
  // late-arriving client can still switch accounts on instead of disabling
  // them for the rest of the page's life.
  const [cloudEnabled, setCloudEnabled] = useState(supabaseConfigured);
  // The one case worth complaining about: real keys, no client.
  const [cloudBlocked, setCloudBlocked] = useState(false);

  const bumpLibrary = useCallback(() => setLibraryTick(t => t + 1), []);

  // Keys are filled in but the global isn't here. Look again for a few seconds,
  // then give up and let the UI say so — falling back to local-only saves in
  // silence is what makes a correctly configured studio look broken. A studio
  // with no keys at all never gets here and is never nagged.
  useEffect(() => {
    if (cloudEnabled || !supabaseKeysPresent()) return;
    const recheck = () => {
      if (!supabaseConfigured()) return false;
      setCloudEnabled(true);
      setCloudBlocked(false);
      return true;
    };
    const poll = setInterval(() => { if (recheck()) clearInterval(poll); }, 250);
    const giveUp = setTimeout(() => {
      clearInterval(poll);
      if (!recheck()) { setCloudBlocked(true); warnSupabaseUnreachable(); }
    }, SUPABASE_LOAD_GRACE_MS);
    return () => { clearInterval(poll); clearTimeout(giveUp); };
  }, [cloudEnabled]);

  const hydrate = useCallback(async (keep) => {
    if (!cloudEnabled) { bumpLibrary(); return; }
    const records = await listCloudDesigns();
    hydrateLocalLibrary(records, keep);
    bumpLibrary();
  }, [bumpLibrary, cloudEnabled]);

  // Everything that has to happen the moment a session exists, in order:
  // claim this device's local designs, finish the save that triggered sign-in,
  // then rebuild the on-device cache from the account. Claiming has to come
  // before hydrating, which overwrites that cache.
  const syncAccount = useCallback(async (account) => {
    if (!account || !cloudEnabled) return;
    let keep = [];
    try {
      const pending = readPendingSave();
      const claim = await claimLocalDesigns(account.id, pending && pending.record && pending.record.id);
      keep = claim.keep;
    } catch (e) {
      console.warn("Could not claim this device's designs:", e);
    }
    try {
      const flushed = await flushPendingSave();
      if (flushed) setLastSaved(flushed);
    } catch (e) {
      console.warn("Could not finish saving after sign-in:", e);
    }
    try {
      await hydrate(keep);
    } catch (e) {
      console.warn("Could not load saved designs:", e);
    }
  }, [hydrate, cloudEnabled]);

  const completeAuth = useCallback(async (nextUser) => {
    setUser(nextUser);
    setAuthOpen(false);
    await syncAccount(nextUser);
  }, [syncAccount]);

  const signOut = useCallback(async () => {
    await logoutUser();
    setUser(null);
    setLastSaved(null);
    // The cache belongs to the account that just left; the designs themselves
    // are safe in Supabase and come back on the next sign-in, anywhere.
    persistSavedQuilts([]);
    persistSavedStitches([]);
    persistSavedPunch([]);
    bumpLibrary();
  }, [bumpLibrary]);

  useEffect(() => {
    if (!cloudEnabled) { setUser(null); return; }
    let cancelled = false;
    (async () => {
      // supabase-js restores (and refreshes) the stored session, which is what
      // makes a returning visit already signed in.
      const me = await fetchMe();
      if (cancelled) return;
      setUser(me);
      if (me) await syncAccount(me);
    })();
    return () => { cancelled = true; };
  }, [syncAccount, cloudEnabled]);

  // Keeps the chip honest if the session ends outside this tab — signing out in
  // another tab, or a refresh token that can no longer be renewed.
  useEffect(() => {
    const client = sb();
    if (!client) return;
    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") setUser(null);
      else if (session && session.user) setUser(toStudioUser(session.user));
    });
    return () => { if (data && data.subscription) data.subscription.unsubscribe(); };
  }, [cloudEnabled]);

  const value = {
    user: user === undefined ? null : user,
    userReady: user !== undefined,
    // False when Supabase isn't configured: no account wall, no cloud sync, and
    // the on-device library behaves the way it did before accounts existed.
    cloudEnabled,
    // Configured, but the client never showed up — the save UI explains itself
    // instead of pretending nothing happened.
    cloudBlocked,
    // Whether the saved-design drawers should be readable/writable right now.
    libraryOn: !cloudEnabled || !!user,
    authOpen,
    openAuth: () => setAuthOpen(true),
    closeAuth: () => setAuthOpen(false),
    completeAuth,
    signOut,
    libraryTick,
    lastSaved,
    consumeLastSaved: () => setLastSaved(null),
    hydrate,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
      <AuthOverlay/>
    </AuthContext.Provider>
  );
}
