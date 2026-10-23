// Scratch check: load the studio as native, unbundled ES modules so the browser
// enforces the temporal dead zone. The esbuild bundle turns top-level const
// into var, so a module that reads another's binding before that module has
// run (an import cycle evaluated in the wrong order) gets `undefined` there
// instead of an error. Here it throws, and the check fails.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import * as esbuild from 'esbuild';
import puppeteer from 'puppeteer-core';
import { chromePath } from './_verify.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const VENDOR = { react: 'react', 'react/jsx-runtime': 'react/jsx-runtime', 'react-dom': 'react-dom', 'react-dom/client': 'react-dom/client' };
const slug = s => s.replace(/\//g, '__');

const all = (await esbuild.build({
  stdin: { contents: Object.keys(VENDOR).map((s, i) => `import * as m${i} from '${s}'; export { m${i} as ${slug(s).replace(/-/g, '_')} };`).join('\n'), resolveDir: ROOT },
  bundle: true, format: 'esm', write: false, define: { 'process.env.NODE_ENV': '"development"' },
})).outputFiles[0].text;
const vendorMods = {};
for (const s of Object.keys(VENDOR)) {
  const keys = Object.keys(require(s)).filter(k => /^[A-Za-z_$][\w$]*$/.test(k) && k !== 'default');
  const id = slug(s).replace(/-/g, '_');
  vendorMods[`/@vendor/${slug(s)}.js`] = `import { ${id} as ns } from '/@vendor/all.js';\nconst m = ns.default || ns;\nexport default m;\nexport const { ${keys.join(', ')} } = m;\n`;
}
vendorMods['/@vendor/all.js'] = all;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const server = http.createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  if (vendorMods[p]) { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(vendorMods[p]); return; }
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  if (p === '/index.html') {
    const map = Object.fromEntries(Object.keys(VENDOR).map(s => [s, `/@vendor/${slug(s)}.js`]));
    const html = fs.readFileSync(f, 'utf8').replace('<script type="module" src="dist/app.js"></script>',
      `<script type="importmap">${JSON.stringify({ imports: map })}</script><script type="module" src="/src/root.jsx"></script>`);
    res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); return;
  }
  if (p.startsWith('/src/') || p === '/assets/color-catalogs.js') {
    const out = await esbuild.transform(fs.readFileSync(f, 'utf8'), { loader: 'jsx', jsx: 'automatic', format: 'esm', sourcefile: p });
    res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(out.code); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await puppeteer.launch({ executablePath: chromePath(), headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
// React's development build is used here, so its warnings show up as console
// errors; only an uncaught exception counts as a failure.
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load', timeout: 40000 });
const ok = await page.waitForSelector('.land-craft', { timeout: 15000 }).then(() => true, () => false);
const modCount = await page.evaluate(() => performance.getEntriesByType('resource').filter(r => /\/src\/.*\.jsx$/.test(r.name)).length);
console.log(`${ok ? 'ok  ' : 'FAIL'} landing rendered from ${modCount} native modules`);
console.log(`${errors.length ? 'FAIL' : 'ok  '} no uncaught errors while the modules loaded${errors.length ? ' — ' + errors.join(' | ') : ''}`);
await browser.close(); server.close();
process.exit(ok && !errors.length ? 0 : 1);
