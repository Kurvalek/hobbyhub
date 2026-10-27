import { useId } from 'react';
import { quiltLines } from './design-model.jsx';

// A drawing of the finished quilt, built from the design itself. `side="front"`
// is the pieced top with its quilting stitched through and the binding round
// the edge; `side="back"` is the quilt turned over: the backing, the same
// quilting showing through it, and the binding folded round and hand-stitched
// down. Everything is in block units (one grid square = one unit), like the
// studio's canvas.
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

export function QuiltFinishedRender({ q, side = 'front' }) {
  const uid = useId().replace(/:/g, '');
  const id = name => `${uid}-${name}`;
  const cols = q.cols, rows = q.rows;
  const bs = q.bs || 4;
  const shapes = q.shapes || [];
  const backing = q.backing || NATURAL;
  const binding = q.binding || NATURAL;
  const thread = (q.qColor && q.qColor.hex) || '#FFFFFF';
  const lines = q.qPattern && q.qPattern !== 'none' ? quiltLines(cols, rows, q.qPattern, q.qSpacing || 2) : [];
  const back = side === 'back';

  const m = Math.min(cols, rows), M = Math.max(cols, rows);
  const bw = Math.max(0.375 / bs, m * 0.017) * (back ? 1.2 : 1);   // it wraps a touch wider on the back

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
  const bindFill = fillOf(binding, 'bind');

  const stitchRuns = (key, sw, color, opacity) => (
    <g stroke={color} strokeWidth={sw} strokeDasharray={dash} strokeLinecap="round" fill="none" opacity={opacity}>
      {lines.map(([x1, y1, x2, y2], i) => <line key={`${key}${i}`} x1={x1} y1={y1} x2={x2} y2={y2}/>)}
    </g>
  );
  // Quilting pulls the layers together along each run, so the batting puffs
  // up between runs: a soft valley under every line, lit from the top left.
  // Kept softer than the seams, so a run crossing a patch doesn't read as one.
  const gap = q.qPattern === 'ditch' ? 1 : Math.max(1, q.qSpacing || 1);
  const vw = Math.min(0.22, 0.1 + 0.04 * gap);
  // Turned over, the quilt is mirrored left to right, and so is its quilting.
  const quilting = lines.length > 0 && (
    <g transform={back ? `matrix(-1,0,0,1,${cols},0)` : undefined}>
      <g filter={`url(#${id('valley')})`} fill="none">
        <g stroke="rgba(0,0,0,0.09)" strokeWidth={vw} transform="translate(0.02,0.03)">
          {lines.map(([x1, y1, x2, y2], i) => <line key={`d${i}`} x1={x1} y1={y1} x2={x2} y2={y2}/>)}
        </g>
        <g stroke="rgba(255,255,255,0.16)" strokeWidth={vw * 0.4} transform={`translate(${-vw * 0.45},${-vw * 0.45})`}>
          {lines.map(([x1, y1, x2, y2], i) => <line key={`h${i}`} x1={x1} y1={y1} x2={x2} y2={y2}/>)}
        </g>
      </g>
      {stitchRuns('t', 0.05 * u, pale(thread) ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.3)', 1)}
      {stitchRuns('s', 0.035 * u, thread, 0.95)}
    </g>
  );

  const pad = M * 0.07;
  return (
    <svg viewBox={`${-pad} ${-pad} ${cols + 2 * pad} ${rows + 2 * pad}`} width="100%" height="100%"
      preserveAspectRatio="xMidYMid meet" role="img"
      aria-label={back
        ? `${q.name || 'Quilt'}, back: ${backing.name} backing, with the ${binding.name} binding folded round`
        : `${q.name || 'Quilt'}, front: quilted and bound in ${binding.name}`}>
      <defs>
        {patterns}
        <clipPath id={id('edge')}><rect width={cols} height={rows}/></clipPath>
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
      </defs>

      {/* Resting on the surface. */}
      <rect width={cols} height={rows} fill="rgba(0,0,0,0.28)" filter={`url(#${id('shadow')})`} transform={`translate(${0.15 * u},${0.35 * u})`}/>

      <g clipPath={`url(#${id('edge')})`}>
        {back ? (
          <rect width={cols} height={rows} fill={fillOf(backing, 'back')}/>
        ) : (
          <>
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
          </>
        )}
        <rect x={-1} y={-1} width={cols + 2} height={rows + 2} filter={`url(#${id('grain')})`} opacity="0.13"
          style={{ mixBlendMode: 'multiply' }}/>
        {quilting}
        <rect width={cols} height={rows} fill={`url(#${id('light')})`}/>
        {/* Binding: a rolled edge, shaded where it meets the quilt. */}
        <rect x={bw / 2} y={bw / 2} width={cols - bw} height={rows - bw} fill="none" stroke={bindFill} strokeWidth={bw}/>
        <rect x={bw / 2} y={bw / 2} width={cols - bw} height={rows - bw} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth={bw * 0.35}/>
        <rect x={bw} y={bw} width={cols - 2 * bw} height={rows - 2 * bw} fill="none" stroke="rgba(0,0,0,0.28)" strokeWidth={0.04 * u}/>
        {/* On the back the folded edge is slip-stitched down by hand. */}
        {back && (
          <rect x={bw} y={bw} width={cols - 2 * bw} height={rows - 2 * bw} fill="none"
            stroke="rgba(0,0,0,0.3)" strokeWidth={0.035 * u} strokeDasharray={`${0.06 * u},${0.12 * u}`}/>
        )}
        <g stroke="rgba(0,0,0,0.22)" strokeWidth={0.03 * u}>
          <line x1={0} y1={0} x2={bw} y2={bw}/>
          <line x1={cols} y1={0} x2={cols - bw} y2={bw}/>
          <line x1={0} y1={rows} x2={bw} y2={rows - bw}/>
          <line x1={cols} y1={rows} x2={cols - bw} y2={rows - bw}/>
        </g>
        <rect width={cols} height={rows} fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth={0.04 * u}/>
      </g>
    </svg>
  );
}
