import { useLayoutEffect, useRef } from 'react';
import { IcArrowR } from './icons.jsx';

// The landing intro. It opens on the metime logo on cream; scrolling gives the
// logo way to a colour field that states the promise one line at a time while
// it shifts golden → grapefruit → ice. When the field clears, "What are you
// making?" pops in letter by letter and settles as its own timed animation,
// with scrolling held until it's done; then scrolling brings in the nav,
// tagline and craft cards. Once the end is reached the scroll track is
// removed, so scrolling back up doesn't replay it.

// Scroll positions, in screens scrolled.
const T = {
  logoOut: [0, 0.25],
  hint: [0, 0.1],
  lines: [[0.14, 0.39], [0.49, 0.74], [0.84, 1.09]],
  skip: [1.19, 1.4],
  linesOut: [1.22, 1.44],
  field: [1.36, 1.58],
  head: 1.58,
  nav: [1.6, 1.8],
  copy: [1.65, 1.85],
  card: i => [1.7 + i * 0.15, 2 + i * 0.12],
  end: 2.3,
};
// The headline's own clock, in ms: the letters pop in, then it settles home.
const HEAD_POP_MS = 1000;
const HEAD_SETTLE_AT = 850;
const HEAD_SETTLE_MS = 550;
const HEAD_MS = HEAD_SETTLE_AT + HEAD_SETTLE_MS;

const STEPS = ['Design your craft.', 'We send the materials.', 'You make it.'];
// Cream, then one colour per line.
const FIELD = [[249, 247, 242], [251, 187, 63], [253, 161, 152], [204, 214, 235]];
const POP = [[253, 161, 152], [251, 187, 63], [187, 193, 63]];

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const ease = t => 1 - Math.pow(1 - t, 3);
const easeIO = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const seg = (p, a, b) => clamp((p - a) / (b - a));

// Once per page load: coming back from a studio, or with reduced motion on,
// the craft picker shows straight away. ?intro=0 turns it off (the layout
// checks use it) and ?intro=1 always plays it.
let introPlayed = false;
export function shouldPlayIntro() {
  if (typeof window === 'undefined') return false;
  const q = new URLSearchParams(window.location.search).get('intro');
  if (q === '0') return false;
  if (q === '1') return true;
  if (introPlayed) return false;
  return !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

// The headline split into letters for the pop-in. Words stay unbreakable and
// the real text is the accessible name.
export function IntroTitle({ text }) {
  let i = 0;
  return (
    <h1 className="land-title" aria-label={text}>
      {text.split(' ').map((w, wi) => (
        <span key={wi}>
          {wi > 0 && ' '}
          <span className="land-title-word" aria-hidden="true">
            {[...w].map(ch => <span key={i} className="land-title-letter" data-i={i++}>{ch}</span>)}
          </span>
        </span>
      ))}
    </h1>
  );
}

export function IntroOverlay({ onSkip }) {
  return (
    <>
      <div className="land-intro">
        <button type="button" className="land-intro-skip" onClick={onSkip}>Skip intro</button>
        <div className="land-intro-lines" aria-hidden="true">
          {STEPS.map(s => <p key={s} className="land-intro-line">{s}</p>)}
        </div>
        <img className="land-intro-logo" src="assets/metime-logo.svg" alt="metime" width="104" height="35"/>
        <div className="land-intro-hint" aria-hidden="true">
          Scroll
          <span className="land-intro-hint-arrow"><IcArrowR size={20}/></span>
        </div>
      </div>
    </>
  );
}

// Drives the intro from the landing page's own scroll. `onDone(excess)` fires
// once the end is reached, with how far past it the page had scrolled. Returns
// a skip function that scrolls smoothly to the end.
export function useLandingIntro({ active, pageRef, trackRef, stageRef, onDone }) {
  const skipRef = useRef(() => {});
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useLayoutEffect(() => {
    if (!active) return undefined;
    const page = pageRef.current, track = trackRef.current, stage = stageRef.current;
    const nav = page.querySelector('.brand-nav');
    const overlay = page.querySelector('.land-intro');
    const lines = overlay.querySelector('.land-intro-lines');
    const rows = [...lines.children];
    const hint = overlay.querySelector('.land-intro-hint');
    const skip = overlay.querySelector('.land-intro-skip');
    const logo = overlay.querySelector('.land-intro-logo');
    const heroCopy = [...stage.querySelectorAll('.land-hero .brand-eyebrow, .land-hero .land-sub')];
    const head = stage.querySelector('.land-title');
    const letters = [...head.querySelectorAll('.land-title-letter')];
    const cards = [...stage.querySelectorAll('.land-craft')];
    const tilts = cards.map(c => parseFloat(getComputedStyle(c).getPropertyValue('--tilt')) || 0);
    const styled = [nav, head, ...heroCopy, ...letters, ...cards];

    let raf = 0, finished = false, skipping = false;
    let hm = { dx: 0, dy: 0, s: 1 };
    // 'idle' until the field clears, 'playing' while the headline runs on its
    // own clock (scroll held), then 'done'.
    let headState = 'idle', headRaf = 0;

    const set = (n, o, tf) => {
      n.style.opacity = o;
      n.style.visibility = o <= 0 ? 'hidden' : '';
      if (tf != null) n.style.transform = tf;
    };
    const screen = () => page.clientHeight;
    const layout = () => {
      const H = screen(), navH = nav.offsetHeight;
      stage.style.top = navH + 'px';
      stage.style.minHeight = (H - navH) + 'px';
      track.style.height = (stage.offsetHeight + T.end * H) + 'px';
    };
    // Where the headline sits at rest, so it can start centred and large and
    // travel home.
    const measure = () => {
      const keep = head.style.transform;
      head.style.transform = 'none';
      const r = head.getBoundingClientRect();
      head.style.transform = keep;
      const vw = page.clientWidth, vh = screen();
      hm = { dx: vw / 2 - (r.left + r.width / 2), dy: vh / 2 - (r.top + r.height / 2), s: clamp(Math.min(vw * 0.86 / r.width, vh * 0.5 / r.height), 1, 2.4) };
    };

    const drawHead = t => {
      const ht = clamp(t / HEAD_POP_MS), hmove = easeIO(clamp((t - HEAD_SETTLE_AT) / HEAD_SETTLE_MS));
      const scale = hm.s + (1 - hm.s) * hmove;
      set(head, 1, `translate(${hm.dx * (1 - hmove)}px, ${hm.dy * (1 - hmove)}px) scale(${scale})`);
      letters.forEach((l, i) => {
        const st = i / letters.length * 0.6;
        const e = seg(ht, st, st + 0.22);
        const bounce = e === 0 ? 0 : 1 + 2.4 * Math.pow(e - 1, 3) + 1.4 * Math.pow(e - 1, 2);
        const k = seg(ht, st + 0.2, st + 0.4), c = POP[i % 3];
        l.style.opacity = e > 0 ? 1 : 0;
        l.style.transform = `scale(${bounce}) translateY(${(1 - e) * 0.3}em)`;
        l.style.color = k >= 1 ? '' : `rgb(${c.map(v => Math.round(v * (1 - k))).join(',')})`;
      });
    };
    const stopHead = () => {
      cancelAnimationFrame(headRaf);
      headRaf = 0;
      page.style.overflow = '';
    };
    const playHead = () => {
      headState = 'playing';
      page.scrollTop = T.head * screen();
      page.style.overflow = 'hidden';
      const t0 = performance.now();
      const step = now => {
        const t = now - t0;
        drawHead(t);
        if (t < HEAD_MS) { headRaf = requestAnimationFrame(step); return; }
        headState = 'done';
        stopHead();
      };
      headRaf = requestAnimationFrame(step);
    };

    const update = () => {
      raf = 0;
      if (finished) return;
      const H = screen(), s = page.scrollTop / H;

      const gone = easeIO(seg(s, ...T.logoOut));
      set(logo, 1 - gone, `translate(-50%, -50%) translateY(${-gone * 40}px) scale(${1 - gone * 0.15})`);
      const ks = T.lines.map(([a, b]) => easeIO(seg(s, a, b)));
      overlay.style.background = `rgb(${FIELD[0].map((v, j) => Math.round(v + ks.reduce((acc, k, i) => acc + (FIELD[i + 1][j] - FIELD[i][j]) * k, 0))).join(',')})`;
      rows.forEach((row, i) => {
        const fi = ease(seg(s, ...T.lines[i]));
        set(row, fi, `translateY(${(1 - fi) * 60}px)`);
      });
      const out = easeIO(seg(s, ...T.linesOut));
      set(lines, 1 - out, `translateY(${-out * 80}px)`);
      set(overlay, 1 - seg(s, ...T.field));
      set(hint, 1 - seg(s, ...T.hint));
      const skipO = 1 - seg(s, ...T.skip);
      set(skip, skipO);
      skip.style.pointerEvents = skipO < 0.05 ? 'none' : '';

      if (s < T.head - 0.01) {
        if (headState !== 'idle') { stopHead(); headState = 'idle'; }
        set(head, 0);
      } else if (headState === 'idle') {
        if (skipping) { headState = 'done'; drawHead(HEAD_MS); } else playHead();
      }

      const hd = ease(seg(s, ...T.nav));
      set(nav, hd, `translateY(${(hd - 1) * 100}%)`);
      const tg = ease(seg(s, ...T.copy));
      heroCopy.forEach(n => set(n, tg, `translateY(${(1 - tg) * 12}px)`));
      cards.forEach((c, i) => {
        const e = ease(seg(s, ...T.card(i)));
        set(c, clamp(e * 3), `translateY(${(1 - e) * H * 0.85}px) rotate(${(1 - e) * tilts[i] * 4}deg)`);
      });

      if (s >= T.end && headState === 'done') {
        finished = true;
        doneRef.current(Math.max(0, page.scrollTop - T.end * H));
      }
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    const refresh = () => { layout(); measure(); update(); };

    refresh();
    page.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', refresh);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { layout(); update(); }) : null;
    if (ro) ro.observe(stage);
    if (document.fonts) document.fonts.ready.then(() => { if (!finished) refresh(); });
    skipRef.current = () => {
      skipping = true;
      page.scrollTo({ top: T.end * screen(), behavior: 'smooth' });
    };

    return () => {
      finished = true;
      introPlayed = true;
      cancelAnimationFrame(raf);
      stopHead();
      page.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', refresh);
      if (ro) ro.disconnect();
      for (const n of styled) {
        n.style.opacity = n.style.visibility = n.style.transform = n.style.color = '';
      }
      stage.style.top = stage.style.minHeight = track.style.height = '';
    };
  }, [active]);

  return () => skipRef.current();
}
