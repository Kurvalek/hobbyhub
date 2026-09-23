// Scratch: prove out the photo → chart reveal on the palette step.
//
//   node tools/_check-reveal.mjs [size] [craft] [photo]
//
// Captures a filmstrip of the reveal, then checks the three rules that matter:
// the first arrival animates, it settles, and every later change to the chart
// (detail level, background, palette) repaints on the spot instead of replaying.
// Also runs the whole thing again under prefers-reduced-motion.
import fs from 'node:fs';
import path from 'node:path';
import { open, clickText } from './_verify.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const size = process.argv[2] || 'Small Hoop';
const craft = process.argv[3] || 'Cross-stitch';
const photo = process.argv[4] || 'assets/landing/542b0afe07059a37d2ff90786ad70029.jpg';
const tag = size.split(' ')[0].toLowerCase();

const { page, errors, close, restart } = await open({ width: 1440, height: 1000 });

// THROTTLE=4 stands in for a mid-range phone: the reveal repaints every cell of
// the chart each frame, so it has to be checked somewhere slower than a laptop.
const throttle = Number(process.env.THROTTLE || 0);
if (throttle > 1) {
  const cdp = await page.target().createCDPSession();
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  console.log(`cpu throttled ${throttle}x`);
}

async function toPalette() {
  await clickText(page, '.land-craft', craft);
  await clickText(page, '.size-card, .proj-card', size);
  const input = await page.$('input[type=file]');
  await input.uploadFile(path.join(ROOT, photo));
  await new Promise(r => setTimeout(r, 900));
  await clickText(page, 'button', 'Use this photo');
}

// Copy the live preview into a filmstrip at fixed times, so the frames come
// from the same paint the user would see rather than from a re-render.
const FILMSTRIP = page => page.evaluate(async () => {
  const marks = [0, 220, 460, 700, 950, 1250, 1600];
  const t0 = performance.now();
  const shots = [];
  const swatchAlpha = [];
  const deltas = [];
  let prev = t0;
  await new Promise(done => {
    let next = 0;
    const tick = () => {
      const el = performance.now() - t0;
      if (el < 1400) deltas.push(performance.now() - prev);
      prev = performance.now();
      const cv = document.querySelector('.xs-flatten-preview canvas');
      if (cv && next < marks.length && el >= marks[next]) {
        const c = document.createElement('canvas');
        c.width = cv.width; c.height = cv.height;
        c.getContext('2d').drawImage(cv, 0, 0);
        shots.push({ t: Math.round(el), c });
        // How many suggested colors have landed by this point in the run.
        const sw = [...document.querySelectorAll('.pal-from-image-swatch')];
        swatchAlpha.push(sw.filter(s => !s.classList.contains('rising')).length + '/' + sw.length);
        next++;
      }
      if (next >= marks.length) return done();
      if (el > 6000) return done();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  if (!shots.length) return null;
  const w = shots[0].c.width, h = shots[0].c.height, GAP = 10, LABEL = 20;
  const sheet = document.createElement('canvas');
  sheet.width = GAP + shots.length * (w + GAP);
  sheet.height = LABEL + GAP + h + GAP;
  const sc = sheet.getContext('2d');
  sc.fillStyle = '#F5F3EE'; sc.fillRect(0, 0, sheet.width, sheet.height);
  sc.fillStyle = '#2E2925'; sc.font = '600 12px system-ui, sans-serif';
  shots.forEach((s, i) => {
    const ox = GAP + i * (w + GAP);
    sc.fillText(`${s.t}ms  ${swatchAlpha[i]}`, ox, LABEL - 5);
    sc.drawImage(s.c, ox, LABEL + GAP);
    sc.strokeStyle = '#2E2925'; sc.lineWidth = 1;
    sc.strokeRect(ox - 0.5, LABEL + GAP - 0.5, w + 1, h + 1);
  });
  const d = deltas.slice(1).sort((a, b) => a - b);
  const frames = d.length
    ? { n: d.length, median: +d[d.length >> 1].toFixed(1), p95: +d[Math.floor(d.length * 0.95)].toFixed(1), worst: +d[d.length - 1].toFixed(1) }
    : null;
  return { png: sheet.toDataURL('image/png'), swatchAlpha, frames };
});

const sig = () => page.evaluate(() => {
  const cv = document.querySelector('.xs-flatten-preview canvas');
  return cv ? cv.toDataURL().slice(-64) : null;
});

// ── first arrival ─────────────────────────────────────────────────────────
await toPalette();
const strip = await FILMSTRIP(page);
if (!strip) throw new Error('no preview canvas appeared');
fs.writeFileSync(path.join(ROOT, `tools/_shot-reveal-${tag}.png`), Buffer.from(strip.png.split(',')[1], 'base64'));
console.log('swatches landed per frame', strip.swatchAlpha.join('  '));
console.log('frame ms during reveal', JSON.stringify(strip.frames));

// It has to stop moving.
const settled = await sig();
await new Promise(r => setTimeout(r, 400));
console.log('settles', settled === await sig());

// ── later changes land finished ────────────────────────────────────────────
// Sample as soon as we can after the click and again once a reveal would have
// finished. Identical means the repaint was instant.
async function instant(label, act) {
  const before = await sig();
  await act();
  await new Promise(r => setTimeout(r, 120));
  const early = await sig();
  await new Promise(r => setTimeout(r, 1500));
  const late = await sig();
  console.log(`${label}: changed ${before !== early} | instant ${early === late}`);
}
await instant('detail level', () => clickText(page, '.xs-flatten-btn', 'Flat'));
await instant('background   ', () => page.click('.xs-flatten-check input'));
await instant('remove color ', () => page.click('.pal-from-image-swatch'));

// ── reduced motion ────────────────────────────────────────────────────────
await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
await restart();
await toPalette();
await page.waitForSelector('.xs-flatten-preview canvas', { timeout: 15000 });
const first = await sig();
await new Promise(r => setTimeout(r, 900));
console.log('reduced motion: first paint is final', first === await sig());
console.log('reduced motion: swatches all present', await page.$$eval('.pal-from-image-swatch',
  els => els.every(e => !e.classList.contains('rising'))));

// ── mobile ────────────────────────────────────────────────────────────────
// The preview box grew, so make sure it still sits inside a phone width and
// the reveal is not being clipped by the canvas cap.
await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
await page.setViewport({ width: 430, height: 900, isMobile: true, hasTouch: true });
await restart();
await toPalette();
await page.waitForSelector('.xs-flatten-preview canvas', { timeout: 15000 });
await new Promise(r => setTimeout(r, 1800));
console.log('mobile', await page.evaluate(() => {
  const box = document.querySelector('.xs-flatten-preview').getBoundingClientRect();
  const cv = document.querySelector('.xs-flatten-preview canvas').getBoundingClientRect();
  return {
    fits: box.right <= window.innerWidth + 0.5 && cv.width <= box.width,
    box: Math.round(box.width) + '×' + Math.round(box.height),
    canvas: Math.round(cv.width) + '×' + Math.round(cv.height),
  };
}));
await page.screenshot({ path: path.join(ROOT, `tools/_shot-reveal-${tag}-mobile.png`), fullPage: false });

console.log('errors', errors);
await close();
