// Scratch check: the two lettering templates end to end — do they show up on
// Medium Hoop, and does picking one land in the studio with the text tool
// already loaded? Not part of the app.
import { open, clickText, texts } from './_verify.mjs';

const { page, errors, close, restart } = await open();

async function run(templateName) {
  await restart();

  await clickText(page, '.land-craft', 'Cross-stitch');
  await clickText(page, '.size-card', 'Medium Hoop');
  const offered = await texts(page, '.tmpl-card-name');
  await clickText(page, '.tmpl-card', templateName);
  await clickText(page, '.back-skip', 'Skip');
  await new Promise(r => setTimeout(r, 500));

  const state = await page.evaluate(() => {
    const ta = document.querySelector('#xs-detail-panel textarea');
    const activeTool = document.querySelector('.xs-tool.active');
    const activeFont = [...document.querySelectorAll('#xs-detail-panel button.btn-dark')].map(b => b.textContent.trim());
    const range = document.querySelector('#xs-detail-panel input[type=range]');
    return {
      inStudio: !!document.querySelector('.xs-app'),
      toolTitle: activeTool ? activeTool.title : null,
      seeded: ta ? JSON.stringify(ta.value) : null,
      font: activeFont,
      height: range ? range.value : null,
    };
  });
  return { offered, state };
}

for (const name of ['Perfect Match', 'Wreath Quote']) {
  const { offered, state } = await run(name);
  console.log(`\n── ${name} ──`);
  console.log('offered on Medium Hoop :', offered.join(' | '));
  console.log('in studio              :', state.inStudio);
  console.log('active tool            :', state.toolTitle);
  console.log('text tool preloaded    :', state.seeded);
  console.log('active font            :', state.font.join(', '));
  console.log('height                 :', state.height);
}

console.log('\nconsole errors:', errors.length ? errors : 'none');
await close();
