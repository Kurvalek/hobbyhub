import { useId } from 'react';
import { quiltLines } from './design-model.jsx';

// A drawing of the finished quilt, built from the design itself: the pieced
// top with its quilting stitched through, the binding round the edge, and the
// bottom-right corner turned back to show the backing. Everything is in block
// units (one grid square = one unit), like the studio's canvas.
//
// Proportions that would vanish at true scale are nudged so they read: the
// binding is drawn a little wider than the ⅜" that shows on a real quilt, and
// the quilting stitches longer than real ones.

// Natural, undyed cotton: what the backing and binding are drawn in when the
// design hasn't picked them, since the kit leaves them to the maker.
const NATURAL = { name: 'Natural', hex: '#EAE3D4' };

const pale = hex => {
  const s = String(hex || '#fff').replace('#', '');
  const n = parseInt(s.length === 3 ? s.replace(/./g, c => c + c) : s, 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255 > 0.55;
};

const triPoints = s => (s.dir === '/'
  ? (s.half === 'a' ? `${s.c},${s.r} ${s.c + s.w},${s.r} ${s.c},${s.r + s.h}` : `${s.c + s.w},${s.r} ${s.c + s.w},${s.r + s.h} ${s.c},${s.r + s.h}`)
  : (s.half === 'a' ? `${s.c},${s.r} ${s.c + s.w},${s.r} ${s.c + s.w},${s.r + s.h}` : `${s.c},${s.r} ${s.c},${s.r + s.h} ${s.c + s.w},${s.r + s.h}`));

export function QuiltFinishedRender({ q }) {
  const uid = useId().replace(/:/g, '');
  const id = name => `${uid}-${name}`;
  const cols = q.cols, rows = q.rows;
  const bs = q.bs || 4;
  const shapes = q.shapes || [];
  const backing = q.backing || NATURAL;
  const binding = q.binding || NATURAL;
  const thread = (q.qColor && q.qColor.hex) || '#FFFFFF';
  const lines = q.qPattern && q.qPattern !== 'none' ? quiltLines(cols, rows, q.qPattern, q.qSpacing || 2) : [];

  const m = Math.min(cols, rows), M = Math.max(cols, rows);
  const bw = Math.max(0.375 / bs, m * 0.017);      // binding showing on the front
  const bwBack = bw * 1.2;                          // it wraps a touch wider on the back
  const f = m * 0.36;                               // how far up each edge the corner folds
  // The fold runs from A (bottom edge) to B (right edge). Folding mirrors the
  // corner across that line, x + y = k: (x, y) → (k − y, k − x).
  const k = cols + rows - f;
  const A = [cols - f, rows], B = [cols, rows - f], C = [cols, rows], Cf = [cols - f, rows - f];
  const mirror = `matrix(0,-1,-1,0,${k},${k})`;
  const frontPoly = `0,0 ${cols},0 ${B} ${A} 0,${rows}`;
  // The turned corner's tip is softly rounded, as cloth folds, not paper.
  const tip = m * 0.05;
  const cornerPath = `M${A} L${cols - tip},${rows} Q${C} ${cols},${rows - tip} L${B} Z`;
  const flapPath = `M${A} L${cols - f},${rows - f + tip} Q${Cf} ${cols - f + tip},${rows - f} L${B} Z`;

  // Stitch and texture sizes in block units, scaled so they land at a similar
  // size on screen whatever the quilt's size.
  const u = M / 24;
  const dash = `${(0.16 * u).toFixed(3)},${(0.11 * u).toFixed(3)}`;
  const grain = (0.55 * (360 / M)).toFixed(2);

  // Prints are tiled at roughly their real repeat; solids are plain fills.
  const patterns = [];
  const fillOf = (c, key) => {
    const src = c && (c.thumb || c.image);
    if (!src) return (c && c.hex) || '#ccc';
    const tile = 8 / bs;
    patterns.push(
      <pattern key={key} id={id(key)} patternUnits="userSpaceOnUse" width={tile} height={tile}>
        <rect width={tile} height={tile} fill={c.hex || '#ccc'}/>
        <image href={src} width={tile} height={tile} preserveAspectRatio="xMidYMid slice"/>
      </pattern>
    );
    return `url(#${id(key)})`;
  };
  const backFill = fillOf(backing, 'back');
  const bindFill = fillOf(binding, 'bind');

  const stitchRuns = (key, sw, color, opacity) => (
    <g stroke={color} strokeWidth={sw} strokeDasharray={dash} strokeLinecap="round" fill="none" opacity={opacity}>
      {lines.map(([x1, y1, x2, y2], i) => <line key={`${key}${i}`} x1={x1} y1={y1} x2={x2} y2={y2}/>)}
    </g>
  );
  // Quilting pulls the layers together along each run, so the batting puffs
  // up between runs: a soft valley under every line, lit from the top left.
  const gap = q.qPattern === 'ditch' ? 1 : Math.max(1, q.qSpacing || 1);
  // Kept softer than the seams, so a run crossing a patch doesn't read as one.
  const vw = Math.min(0.22, 0.1 + 0.04 * gap);
  const quilting = key => lines.length > 0 && (
    <g>
      <g filter={`url(#${id('valley')})`} fill="none">
        <g stroke="rgba(0,0,0,0.09)" strokeWidth={vw} transform="translate(0.02,0.03)">
          {lines.map(([x1, y1, x2, y2], i) => <line key={`${key}d${i}`} x1={x1} y1={y1} x2={x2} y2={y2}/>)}
        </g>
        <g stroke="rgba(255,255,255,0.16)" strokeWidth={vw * 0.4} transform={`translate(${-vw * 0.45},${-vw * 0.45})`}>
          {lines.map(([x1, y1, x2, y2], i) => <line key={`${key}h${i}`} x1={x1} y1={y1} x2={x2} y2={y2}/>)}
        </g>
      </g>
      {stitchRuns(`${key}t`, 0.05 * u, pale(thread) ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.3)', 1)}
      {stitchRuns(`${key}s`, 0.035 * u, thread, 0.95)}
    </g>
  );
  const texture = () => (
    <rect x={-1} y={-1} width={cols + 2} height={rows + 2} filter={`url(#${id('grain')})`} opacity="0.13"
      style={{ mixBlendMode: 'multiply' }}/>
  );

  const pad = M * 0.07;
  return (
    <svg viewBox={`${-pad} ${-pad} ${cols + 2 * pad} ${rows + 2 * pad}`} width="100%" height="100%"
      preserveAspectRatio="xMidYMid meet" role="img"
      aria-label={`${q.name || 'Quilt'}, finished: quilted, bound in ${binding.name}, with the corner turned back to show the ${backing.name} backing`}>
      <defs>
        {patterns}
        <clipPath id={id('front')}><polygon points={frontPoly}/></clipPath>
        <clipPath id={id('corner')}><path d={cornerPath}/></clipPath>
        <filter id={id('valley')} x="-5%" y="-5%" width="110%" height="110%">
          <feGaussianBlur stdDeviation={vw * 0.38}/>
        </filter>
        <filter id={id('shadow')} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation={0.45 * u}/>
        </filter>
        <filter id={id('grain')} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency={grain} numOctaves="2" seed="7"/>
          <feColorMatrix type="saturate" values="0"/>
        </filter>
        <linearGradient id={id('light')} x1="0" y1="0" x2={cols} y2={rows} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity="0.16"/>
          <stop offset="0.55" stopColor="#fff" stopOpacity="0"/>
          <stop offset="1" stopColor="#000" stopOpacity="0.12"/>
        </linearGradient>
        {/* Across the turned-back flap: shaded in the crease, catching the
            light toward its tip. In the flap's own (unmirrored) units. */}
        <linearGradient id={id('curl')} gradientUnits="userSpaceOnUse"
          x1={(A[0] + B[0]) / 2} y1={(A[1] + B[1]) / 2} x2={C[0]} y2={C[1]}>
          <stop offset="0" stopColor="#000" stopOpacity="0.26"/>
          <stop offset="0.4" stopColor="#000" stopOpacity="0.04"/>
          <stop offset="1" stopColor="#fff" stopOpacity="0.14"/>
        </linearGradient>
      </defs>

      {/* Resting on the surface. */}
      <polygon points={frontPoly} fill="rgba(0,0,0,0.28)" filter={`url(#${id('shadow')})`} transform={`translate(${0.15 * u},${0.35 * u})`}/>

      {/* The front: pieced top, quilting, binding. */}
      <g clipPath={`url(#${id('front')})`}>
        <rect width={cols} height={rows} fill="#F3EFE7"/>
        {shapes.map((s, i) => {
          const fill = fillOf(s.color, `p${i}`);
          return s.type === 'tri'
            ? <polygon key={i} points={triPoints(s)} fill={fill}/>
            : <rect key={i} x={s.c} y={s.r} width={s.w} height={s.h} fill={fill}/>;
        })}
        {/* Seams: a crease where the pieces meet, lit on one side. */}
        <g fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth={0.03 * u} transform={`translate(${0.035 * u},${0.035 * u})`}>
          {shapes.map((s, i) => (s.type === 'tri'
            ? <polygon key={i} points={triPoints(s)}/>
            : <rect key={i} x={s.c} y={s.r} width={s.w} height={s.h}/>))}
        </g>
        <g fill="none" stroke="rgba(0,0,0,0.26)" strokeWidth={0.04 * u}>
          {shapes.map((s, i) => (s.type === 'tri'
            ? <polygon key={i} points={triPoints(s)}/>
            : <rect key={i} x={s.c} y={s.r} width={s.w} height={s.h}/>))}
        </g>
        {texture()}
        {quilting('f')}
        <rect width={cols} height={rows} fill={`url(#${id('light')})`}/>
        {/* Binding: a rolled edge, shaded where it meets the top. */}
        <rect x={bw / 2} y={bw / 2} width={cols - bw} height={rows - bw} fill="none" stroke={bindFill} strokeWidth={bw}/>
        <rect x={bw / 2} y={bw / 2} width={cols - bw} height={rows - bw} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth={bw * 0.35}/>
        <rect x={bw} y={bw} width={cols - 2 * bw} height={rows - 2 * bw} fill="none" stroke="rgba(0,0,0,0.28)" strokeWidth={0.04 * u}/>
        <g stroke="rgba(0,0,0,0.22)" strokeWidth={0.03 * u}>
          <line x1={0} y1={0} x2={bw} y2={bw}/>
          <line x1={cols} y1={0} x2={cols - bw} y2={bw}/>
          <line x1={0} y1={rows} x2={bw} y2={rows - bw}/>
        </g>
        <rect width={cols} height={rows} fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth={0.04 * u}/>
      </g>

      {/* The flap lifts off the top, so it shades what's under its edges. */}
      <path d={flapPath} fill="rgba(0,0,0,0.32)" filter={`url(#${id('shadow')})`} transform={`translate(${-0.1 * u},${0.25 * u})`}/>

      {/* The back, seen on the turned corner: backing, the same quilting
          through it, and the binding folded round and hand-stitched down. */}
      <g transform={mirror}>
        <g clipPath={`url(#${id('corner')})`}>
          <rect width={cols} height={rows} fill={backFill}/>
          {texture()}
          {quilting('b')}
          <rect x={cols - bwBack} y={0} width={bwBack} height={rows} fill={bindFill}/>
          <rect x={0} y={rows - bwBack} width={cols} height={bwBack} fill={bindFill}/>
          <g stroke="rgba(0,0,0,0.3)" strokeWidth={0.035 * u} strokeDasharray={`${0.06 * u},${0.12 * u}`} fill="none">
            <polyline points={`${cols - bwBack},0 ${cols - bwBack},${rows - bwBack} 0,${rows - bwBack}`}/>
          </g>
          <line x1={cols} y1={rows} x2={cols - bwBack} y2={rows - bwBack} stroke="rgba(0,0,0,0.2)" strokeWidth={0.03 * u}/>
          <path d={cornerPath} fill={`url(#${id('curl')})`}/>
          <path d={cornerPath} fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth={0.04 * u}/>
        </g>
      </g>
      {/* The crease itself catches the light. */}
      <line x1={A[0]} y1={A[1]} x2={B[0]} y2={B[1]} stroke="rgba(255,255,255,0.55)" strokeWidth={0.05 * u} strokeLinecap="round"/>
    </svg>
  );
}
