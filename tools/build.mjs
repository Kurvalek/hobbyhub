// Bundles src/ into dist/app.js, which index.html loads. Vercel runs this on
// every deploy (buildCommand in vercel.json); dist/ is not committed.
//
//   node tools/build.mjs           one production build
//   node tools/build.mjs --watch   rebuild on every save (for `vercel dev`)
import * as esbuild from 'esbuild';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');

export const BUILD_OPTIONS = {
  absWorkingDir: ROOT,
  entryPoints: ['src/root.jsx'],
  outfile: 'dist/app.js',
  bundle: true,
  format: 'esm',
  target: ['es2020', 'safari15'],
  jsx: 'automatic',
  minify: true,
  sourcemap: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning',
};

export function build() {
  return esbuild.build(BUILD_OPTIONS);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--watch')) {
    const ctx = await esbuild.context({
      ...BUILD_OPTIONS,
      plugins: [{
        name: 'log',
        setup(b) { b.onEnd(r => console.log(`[build] dist/app.js ${r.errors.length ? 'FAILED' : 'rebuilt'}`)); },
      }],
    });
    await ctx.watch();
  } else {
    await build();
  }
}
