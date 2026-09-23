// Scratch check: which templates each cross-stitch size offers, so swapping the
// Medium Hoop lineup can't quietly strand another size. Not part of the app.
import { open, clickText } from './_verify.mjs';

const { page, errors, close, restart } = await open();

const sizes = await page.evaluate(() => {
  const el = [...document.querySelectorAll('.land-craft')].find(e => e.textContent.includes('Cross-stitch'));
  el.click(); return true;
});
await new Promise(r => setTimeout(r, 500));
const names = await page.$$eval('.size-card-name', els => els.map(e => e.textContent.trim()));
console.log('cross-stitch sizes:', names.join(' | '), '\n');

for (const size of names) {
  await restart();
  await clickText(page, '.land-craft', 'Cross-stitch');
  await clickText(page, '.size-card', size);
  const tmpl = await page.$$eval('.tmpl-card-name', els => els.map(e => e.textContent.trim()));
  console.log(`${size.padEnd(12)} ${tmpl.length ? tmpl.join(' | ') : '(none)'}`);
  if (size === 'Medium Hoop') await page.screenshot({ path: 'tools/_shot-xs-medium-templates.png' });
}
console.log('\nconsole errors:', errors.length ? errors : 'none');
await close();
