// ── Icons ─────────────────────────────────────────────────────────────────
// Line icons on a 24px grid, drawn in currentColor. The quilt-editor set comes
// from the redesign files in design updates/; the rest are drawn to match.
// Stroke thickens at small sizes so a 12px chevron reads like a 22px tab icon.
const ICONS = {
  close: <path d="M6 6l12 12M18 6 6 18"/>,
  plus: <path d="M12 5v14M5 12h14"/>,
  minus: <path d="M5 12h14"/>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5"/>,
  search: <><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></>,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>,
  copy: <><rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2"/><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/></>,
  paste: <><path d="M9 4.5H7a2 2 0 0 0-2 2V19a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6.5a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="3.5" rx="1"/></>,
  save: <><path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/></>,
  undo: <><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></>,
  redo: <><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></>,
  rotate: <><path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/></>,
  shuffle: <><path d="M4 17h2.5c1.6 0 2.6-.7 3.5-2l4-6c.9-1.3 1.9-2 3.5-2H20"/><path d="M4 7h2.5c1.3 0 2.2.5 3 1.4M20 17h-2.5c-1.3 0-2.2-.5-3-1.4"/><path d="m17 4 3 3-3 3M17 14l3 3-3 3"/></>,
  swap: <path d="M20 8H4m3-3L4 8l3 3M4 16h16m-3-3 3 3-3 3"/>,
  chevronLeft: <path d="m15 6-6 6 6 6"/>,
  chevronRight: <path d="m9 6 6 6-6 6"/>,
  chevronDown: <path d="m6 9 6 6 6-6"/>,
  arrowLeft: <path d="M20 12H4M10 6l-6 6 6 6"/>,
  arrowRight: <path d="M4 12h16M14 6l6 6-6 6"/>,
  menu: <path d="M4 7h16M4 12h16M4 17h16"/>,
  paneOpen: <><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M15 4.5v15M10.5 9.5 8 12l2.5 2.5"/></>,
  paneClose: <><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M15 4.5v15M8 9.5l2.5 2.5L8 14.5"/></>,
  profile: <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="10" r="3"/><path d="M6.6 18.2c1.3-1.8 3.2-2.7 5.4-2.7s4.1.9 5.4 2.7"/></>,
  logout: <><circle cx="12" cy="12" r="9"/><path d="M9 12h7M13 9l3 3-3 3"/></>,
  cart: <><path d="M3 4h2.2l2.1 10.5h10.2L19.5 7H6.2"/><circle cx="9" cy="19" r="1.4"/><circle cx="16.5" cy="19" r="1.4"/></>,
  tiles: <><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></>,
  templates: <><rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M12 3.5v17M12 12h8.5"/></>,
  fabrics: <><circle cx="12" cy="8" r="4.5"/><circle cx="8" cy="15" r="4.5"/><circle cx="16" cy="15" r="4.5"/></>,
  quilting: <g strokeDasharray="2.5 2"><rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M3.5 3.5l17 17M20.5 3.5l-17 17"/></g>,
  help: <><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5V14M12 17.2v.1"/></>,
  image: <><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="9.5" r="1.5"/><path d="m4 17 4.5-4.5 4 4 2.5-2.5L20 19"/></>,
  camera: <><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2L9 4.5h6L16.5 7h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="13" r="3.5"/></>,
  link: <><path d="M10 13.5a4 4 0 0 0 5.7.4l2.8-2.8a4 4 0 0 0-5.7-5.7l-1.3 1.3"/><path d="M14 10.5a4 4 0 0 0-5.7-.4l-2.8 2.8a4 4 0 0 0 5.7 5.7l1.3-1.3"/></>,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></>,
  eyeOff: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path d="M4 4l16 16"/></>,
  pointer: <path d="M5 3.5 19 10l-6 2-2.5 6.5z"/>,
  marquee: <rect x="4" y="4" width="16" height="16" rx="1.5" strokeDasharray="3 2.6"/>,
  spool: <><rect x="6" y="3.5" width="12" height="3" rx="1"/><rect x="6" y="17.5" width="12" height="3" rx="1"/><path d="M8.5 6.5v11M15.5 6.5v11M8.5 10h7M8.5 14h7"/></>,
  move: <path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>,
  patch: <rect x="4" y="4" width="16" height="16" rx="4.5"/>,
  triangle: <><rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M4 20 20 4v16z" fill="currentColor"/></>,
  pen: <><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13 7 4 4"/></>,
  eraser: <><path d="m9 19.5-4.6-4.6a1.5 1.5 0 0 1 0-2.1l8.4-8.4a1.5 1.5 0 0 1 2.1 0l4.3 4.3a1.5 1.5 0 0 1 0 2.1L11 19.5z"/><path d="M11 19.5h9M8.5 9.5l6 6"/></>,
  fill: <><path d="m4.5 11.5 7-7 7 7-6 6a2 2 0 0 1-2.8 0l-4.2-4.2a2 2 0 0 1 0-2.8z"/><path d="M4.5 11.5h14"/><path d="M20.5 15.5s1.5 1.8 1.5 3a1.5 1.5 0 0 1-3 0c0-1.2 1.5-3 1.5-3z"/></>,
  drop: <path d="M12 3s-6 7-6 11a6 6 0 0 0 12 0c0-4-6-11-6-11z"/>,
  line: <path d="M5 19 19 5"/>,
  circle: <circle cx="12" cy="12" r="8"/>,
  text: <path d="M5 7V5h14v2M12 5v14M9.5 19h5"/>,
  grid: <><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9.33 4v16M14.67 4v16M4 9.33h16M4 14.67h16"/></>,
  list: <path d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01"/>,
  ruler: <><rect x="2.5" y="8" width="19" height="8" rx="1.5"/><path d="M6.5 8v3M10.5 8v4M14.5 8v3M18 8v4"/></>,
};
const Icon = ({ name, size = 16 }) => (
  <svg className="ic" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={size <= 16 ? 2.2 : size <= 20 ? 1.9 : 1.8} strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true" focusable="false">
    {ICONS[name]}
  </svg>
);
export const IcSearch  = ({ size=14 }) => <Icon name="search" size={size}/>;
export const IcX       = ({ size=14 }) => <Icon name="close" size={size}/>;
export const IcPlus    = ({ size=14 }) => <Icon name="plus" size={size}/>;
export const IcCaretL  = ({ size=14 }) => <Icon name="chevronLeft" size={size}/>;
export const IcCaretR  = ({ size=14 }) => <Icon name="chevronRight" size={size}/>;
export const IcTrash   = ({ size=14 }) => <Icon name="trash" size={size}/>;
export const IcCopy    = ({ size=14 }) => <Icon name="copy" size={size}/>;
export const IcPaste   = ({ size=16 }) => <Icon name="paste" size={size}/>;
export const IcErase   = ({ size=18 }) => <Icon name="eraser" size={size}/>;
const IcEye     = ({ off, size=14 }) => <Icon name={off ? 'eyeOff' : 'eye'} size={size}/>;
export const IcGrid    = ({ size=14 }) => <Icon name="grid" size={size}/>;
export const IcCursor  = ({ size=18 }) => <Icon name="pointer" size={size}/>;
export const IcMarquee = ({ size=18 }) => <Icon name="marquee" size={size}/>;
const IcSpool   = ({ size=18 }) => <Icon name="spool" size={size}/>;
export const IcHand    = ({ size=18 }) => <Icon name="move" size={size}/>;
export const IcSquare  = ({ size=18 }) => <Icon name="patch" size={size}/>;
export const IcTri     = ({ size=18 }) => <Icon name="triangle" size={size}/>;
export const IcHelp    = ({ size=18 }) => <Icon name="help" size={size}/>;
export const IcUndo    = ({ size=18 }) => <Icon name="undo" size={size}/>;
export const IcRedo    = ({ size=18 }) => <Icon name="redo" size={size}/>;
export const IcRotate  = ({ size=16 }) => <Icon name="rotate" size={size}/>;
export const IcSaved   = ({ size=16 }) => <Icon name="tiles" size={size}/>;
const IcPanel   = ({ open, size=18 }) => <Icon name={open ? 'paneClose' : 'paneOpen'} size={size}/>;
export const IcChevR   = ({ size=12 }) => <Icon name="chevronRight" size={size}/>;
export const IcChevD   = ({ size=12 }) => <Icon name="chevronDown" size={size}/>;
export const IcSwap    = ({ size=14 }) => <Icon name="swap" size={size}/>;
const IcFlip    = ({ size=14 }) => <Icon name="line" size={size}/>;
export const IcShuffle = ({ size=14 }) => <Icon name="shuffle" size={size}/>;
export const IcPen     = ({ size=18 }) => <Icon name="pen" size={size}/>;
export const IcLineTool= ({ size=18 }) => <Icon name="line" size={size}/>;
export const IcCircle  = ({ size=18 }) => <Icon name="circle" size={size}/>;
export const IcImage   = ({ size=16 }) => <Icon name="image" size={size}/>;
export const IcCamera  = ({ size=16 }) => <Icon name="camera" size={size}/>;
export const IcLink    = ({ size=16 }) => <Icon name="link" size={size}/>;
export const IcText    = ({ size=18 }) => <Icon name="text" size={size}/>;
const IcFill    = ({ size=18 }) => <Icon name="fill" size={size}/>;
export const IcDrop    = ({ size=18 }) => <Icon name="drop" size={size}/>;
const IcRuler   = ({ size=18 }) => <Icon name="ruler" size={size}/>;
const IcList    = ({ size=18 }) => <Icon name="list" size={size}/>;
export const IcMinus   = ({ size=14 }) => <Icon name="minus" size={size}/>;
export const IcCheck   = ({ size=14 }) => <Icon name="check" size={size}/>;
export const IcSave    = ({ size=16 }) => <Icon name="save" size={size}/>;
export const IcCart    = ({ size=16 }) => <Icon name="cart" size={size}/>;
export const IcMenu    = ({ size=20 }) => <Icon name="menu" size={size}/>;
export const IcProfile = ({ size=22 }) => <Icon name="profile" size={size}/>;
export const IcLogout  = ({ size=16 }) => <Icon name="logout" size={size}/>;
export const IcArrowL  = ({ size=18 }) => <Icon name="arrowLeft" size={size}/>;
export const IcArrowR  = ({ size=22 }) => <Icon name="arrowRight" size={size}/>;
const IcTiles   = ({ size=18 }) => <Icon name="tiles" size={size}/>;
const IcTemplates = ({ size=18 }) => <Icon name="templates" size={size}/>;
const IcFabrics = ({ size=18 }) => <Icon name="fabrics" size={size}/>;
const IcQuilting = ({ size=18 }) => <Icon name="quilting" size={size}/>;

// ── Brand: metime wordmark (+ compact icon on canvas headers) ─────────────
// Logotype set in "Sundae" by Taylor Penton. On quilt/cross-stitch canvas
// pages the wide wordmark swaps for the favicon mark so Save keeps padding;
// setup pages always show the full wordmark.
export const MetimeLogo = () => (
  <>
    <img className="brand-mark" src="assets/metime-logo.png" alt="metime"/>
    <img className="brand-icon" src="assets/metime-icon.png" alt=""/>
  </>
);
