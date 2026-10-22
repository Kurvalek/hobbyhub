// Inlines the Icons8 "Tiny" set from icons/metime/ into index.html as the
// ICONS table used by <Icon>. Re-run after re-exporting the collection:
//
//   node tools/build-icons.mjs
//
// Icons8 exports each icon as a plain file and, where one exists, a colored
// duotone twin ("pencil" / "pencil-1"; which suffix is colored varies). The
// colored file is the plain outline plus pastel fill layers, so we keep only
// that one: the fills render as .ic-duo, hidden until hover.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'icons/metime');
const HTML = path.join(ROOT, 'index.html');
const START = '// <icons:generated>';
const END = '// </icons:generated>';

// name used in code → Icons8 base filename, plus an optional flip/rotation
// for icons the collection only has facing the other way.
const MAP = {
  close: 'close', plus: 'plus-math', minus: 'minus', check: 'done',
  search: 'search', trash: 'trash-can', copy: 'copy', paste: 'clipboard', save: 'save',
  undo: ['redo', { flip: true }], shuffle: 'refresh', swap: 'data-transfer',
  chevronLeft: 'back', chevronRight: 'forward', chevronDown: 'drop-down-arrow',
  arrowLeft: ['right-arrow', { flip: true }], arrowRight: 'right-arrow',
  menu: 'menu', paneOpen: 'open-pane', paneClose: 'close-pane',
  profile: 'profile', logout: 'logout-rounded', cart: 'shopping-cart', book: 'copybook', help: 'help',
  image: 'image', camera: 'camera', folder: 'folder', link: 'link', eye: 'eye', eyeOff: 'hide',
  pointer: 'cursor', hand: 'hand', square: 'unchecked-checkbox', triangle: ['play', { rotate: -90 }],
  pen: 'pencil', eraser: 'erase', fill: 'paint-bucket', line: 'line-1', circle: 'circle',
  text: 'text', grid: 'grid', list: 'list', ruler: 'ruler',
};

const read = base => {
  const f = path.join(SRC, `icons8-${base}-100.svg`);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
};
const isColored = svg => /fill="#(?!212121)[0-9a-f]{3,6}"/i.test(svg);

function parse(svg, base) {
  const vb = svg.match(/viewBox="([^"]+)"/)[1];
  const evenodd = /fill-rule="evenodd"/.test(svg);
  const layers = [];
  for (const m of svg.matchAll(/<(path|rect)\b([^>]*)\/?>/g)) {
    const attr = k => (m[2].match(new RegExp(`\\s${k}="([^"]*)"`)) || [])[1];
    let d = attr('d');
    if (m[1] === 'rect') {
      const [x, y, w, h] = ['x', 'y', 'width', 'height'].map(k => +(attr(k) || 0));
      d = `M${x} ${y}h${w}v${h}h${-w}z`;
    }
    const fill = attr('fill');
    const duo = fill && !/^#212121$/i.test(fill) && fill !== 'none' ? fill.toLowerCase() : null;
    layers.push(duo ? [d.replace(/\s+/g, ' ').trim(), duo] : [d.replace(/\s+/g, ' ').trim()]);
  }
  if (!layers.length) throw new Error(`no shapes in ${base}`);
  return { vb, evenodd, layers };
}

const out = {};
const report = { colored: [], plain: [] };
for (const [name, spec] of Object.entries(MAP)) {
  const [base, xf = {}] = Array.isArray(spec) ? spec : [spec];
  const a = read(base), b = read(`${base}-1`);
  const svg = [a, b].find(s => s && isColored(s)) || a || b;
  if (!svg) throw new Error(`missing icons8-${base}-100.svg for "${name}"`);
  const ic = parse(svg, base);
  const [, , w, h] = ic.vb.split(/\s+/).map(Number);
  if (xf.flip) ic.g = `matrix(-1 0 0 1 ${w} 0)`;
  if (xf.rotate) ic.g = `rotate(${xf.rotate} ${w / 2} ${h / 2})`;
  out[name] = ic;
  (isColored(svg) ? report.colored : report.plain).push(name);
}

const lines = Object.entries(out).map(([name, ic]) => {
  const parts = [`vb:'${ic.vb}'`];
  if (ic.evenodd) parts.push('eo:1');
  if (ic.g) parts.push(`g:'${ic.g}'`);
  parts.push(`p:${JSON.stringify(ic.layers)}`);
  return `  ${name}: { ${parts.join(', ')} },`;
});
const block = `${START}  (tools/build-icons.mjs — don't edit by hand)
const ICONS = {
${lines.join('\n')}
};
${END}`;

const html = fs.readFileSync(HTML, 'utf8');
const s = html.indexOf(START), e = html.indexOf(END);
if (s < 0 || e < 0) throw new Error(`index.html needs the ${START} … ${END} markers`);
fs.writeFileSync(HTML, html.slice(0, s) + block + html.slice(e + END.length));

console.log(`${Object.keys(out).length} icons inlined (${report.colored.length} with hover color)`);
console.log('plain only:', report.plain.join(', '));
