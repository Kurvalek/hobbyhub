// Generate compact swatch thumbnails for the Ruby Star backing picker.
//
// Reads assets/fabrics-manifest.js and writes 256px JPEGs to
// assets/fabrics-thumbs/<slug>/<file>, mirroring the source tree. The app
// loads these for the grid, hex sampling, and palette extraction so mobile
// never has to decode multi‑MB full-res prints just to show a ~100px tile.
//
// Requires macOS `sips` (preinstalled). Skips thumbs that already exist and
// are newer than their source unless --force is passed.
//
//   node tools/gen-fabric-thumbs.mjs
//   node tools/gen-fabric-thumbs.mjs --force
//
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const MANIFEST = path.join(ROOT, 'assets', 'fabrics-manifest.js');
const SRC_ROOT = path.join(ROOT, 'assets', 'fabrics');
const OUT_ROOT = path.join(ROOT, 'assets', 'fabrics-thumbs');
const MAX_EDGE = 256;
const JPEG_QUALITY = 70;
const CONCURRENCY = 8;
const FORCE = process.argv.includes('--force');

function loadManifest() {
  const src = fs.readFileSync(MANIFEST, 'utf8');
  const m = src.match(/window\.RSS_COLLECTIONS\s*=\s*(\[[\s\S]*\]);?\s*$/m);
  if (!m) throw new Error('Could not parse window.RSS_COLLECTIONS from fabrics-manifest.js');
  return Function(`"use strict"; return (${m[1]});`)();
}

function sipsResize(src, dest) {
  return new Promise((resolve, reject) => {
    const child = spawn('sips', [
      '-Z', String(MAX_EDGE),
      '-s', 'format', 'jpeg',
      '-s', 'formatOptions', String(JPEG_QUALITY),
      src,
      '--out', dest,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', d => { err += d; });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`sips failed (${code}) for ${src}: ${err.trim()}`));
    });
  });
}

async function mapPool(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
}

const collections = loadManifest();
const jobs = [];
for (const c of collections) {
  for (const file of c.files) {
    jobs.push({
      slug: c.slug,
      file,
      src: path.join(SRC_ROOT, c.slug, file),
      dest: path.join(OUT_ROOT, c.slug, file),
    });
  }
}

let made = 0, skipped = 0, missing = 0, failed = 0;
const t0 = Date.now();

await mapPool(jobs, CONCURRENCY, async (job) => {
  if (!fs.existsSync(job.src)) {
    missing++;
    console.warn(`missing source: ${path.relative(ROOT, job.src)}`);
    return;
  }
  fs.mkdirSync(path.dirname(job.dest), { recursive: true });
  if (!FORCE && fs.existsSync(job.dest)) {
    const sStat = fs.statSync(job.src);
    const dStat = fs.statSync(job.dest);
    if (dStat.mtimeMs >= sStat.mtimeMs && dStat.size > 0) {
      skipped++;
      return;
    }
  }
  try {
    await sipsResize(job.src, job.dest);
    made++;
    if (made % 50 === 0) {
      console.log(`… ${made} written, ${skipped} skipped (${Math.round((Date.now() - t0) / 1000)}s)`);
    }
  } catch (e) {
    failed++;
    console.warn(e.message || e);
  }
});

const totalBytes = jobs.reduce((n, j) => n + (fs.existsSync(j.dest) ? fs.statSync(j.dest).size : 0), 0);
console.log(
  `Done: ${made} written, ${skipped} skipped, ${missing} missing, ${failed} failed · ` +
  `${jobs.length} thumbs · ${(totalBytes / 1e6).toFixed(1)} MB total · ` +
  `${Math.round((Date.now() - t0) / 1000)}s`
);
