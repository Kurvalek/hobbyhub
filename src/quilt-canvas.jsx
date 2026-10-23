// ── Quilting overlay ──────────────────────────────────────────────────────
function QuiltOverlay({ cols, rows, pattern, spacing, color }) {
  if (pattern==="none") return null;
  const lines=[], s=Math.max(1,spacing);
  if (pattern==="ditch") {
    for(let i=1;i<cols;i++) lines.push([i,0,i,rows]);
    for(let i=1;i<rows;i++) lines.push([0,i,cols,i]);
  }
  if (pattern==="horizontal"||pattern==="crosshatch") for(let i=s;i<rows;i+=s) lines.push([0,i,cols,i]);
  if (pattern==="vertical"||pattern==="crosshatch") for(let i=s;i<cols;i+=s) lines.push([i,0,i,rows]);
  if (pattern==="diagonal"||pattern==="cross_diagonal") {
    for(let k=-rows;k<=cols;k+=s){const x1=Math.max(0,k),y1=Math.max(0,-k),x2=Math.min(cols,k+rows),y2=Math.min(rows,cols-k);if(x2>x1&&y2>y1)lines.push([x1,y1,x2,y2]);}
  }
  if (pattern==="cross_diagonal") {
    for(let k=0;k<=cols+rows;k+=s){const x1=Math.max(0,k-rows),y1=Math.min(rows,k),x2=Math.min(cols,k),y2=Math.max(0,k-cols);if(x2>x1&&y1>y2)lines.push([x1,y1,x2,y2]);}
  }
  // Stroked in screen pixels via non-scaling-stroke, the way the grid lines
  // beside them already are. Authored in cell units the same stitch renders
  // ~8px wide with a 33px dash on a wall hanging — a rope, not a stitch — and
  // grows thicker still as you zoom in.
  const DASH = "3,4.5";
  // The thread color is the user's, and defaults to white, so the contrast halo
  // underneath has to flip with it: a light thread needs a dark halo to read on
  // pale fabric, a dark one needs a light halo to read on a dark patch.
  const n = (h => { const s = h.replace('#',''); return parseInt(s.length===3 ? s.replace(/./g,c=>c+c) : s, 16); })(color);
  const pale = (0.2126*((n>>16)&255) + 0.7152*((n>>8)&255) + 0.0722*(n&255)) / 255 > 0.55;
  const stitches = key => lines.map(([x1,y1,x2,y2],i)=>(
    <line key={`${key}${i}`} x1={x1} y1={y1} x2={x2} y2={y2} vectorEffect="non-scaling-stroke"/>
  ));
  return (
    <svg style={{position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none"}} viewBox={`0 0 ${cols} ${rows}`} preserveAspectRatio="none">
      <g stroke={pale ? "#000000" : "#FFFFFF"} strokeWidth="2.5" strokeDasharray={DASH} strokeLinecap="round"
        fill="none" opacity={pale ? 0.3 : 0.42}>
        {stitches('h')}
      </g>
      <g stroke={color} strokeWidth="1.25" strokeDasharray={DASH} strokeLinecap="round" fill="none" opacity="0.95">
        {stitches('s')}
      </g>
    </svg>
  );
}

// ── GridCanvas ────────────────────────────────────────────────────────────
// Shape: { id, r, c, h, w, color }
// selIds: Set<id> — lifted to App for cross-component access
// Tools: select (move / resize / marquee), pan, paint (drag on empty blocks to
// add a patch, tap or drag over patches to recolor), hst (tap a block to make a
// triangle pair, tap a pair to turn it) and replace (tap a patch to swap its
// fabric everywhere via onReplaceColor). One drag is one undo step: follow-up
// updates in the same gesture pass { merge: true } to setShapes.
function GridCanvas({ cols, rows, shapes, setShapes, selIds, setSelIds, tool, selectedColor, quiltPattern, quiltSpacing, quiltColor, showQuilting, zoom = 1, onZoomChange, pinned = [], isMobile = false, onReplaceColor, onPickFabric, onAddFabric }) {
  const ref = useRef(null);
  const scrollRef = useRef(null);
  const toolbarRef = useRef(null);
  const dragRef = useRef(null);
  const [ghost, setGhost] = useState(null);
  const [marquee, setMarquee] = useState(null);
  const [cur, setCur] = useState('default');
  const [tbPos, setTbPos] = useState(null);
  const [triSlot, setTriSlot] = useState('a');
  const sRef = useRef(shapes); useEffect(()=>{sRef.current=shapes;},[shapes]);
  const selRef = useRef(selIds); useEffect(()=>{selRef.current=selIds;},[selIds]);

  const cancelPointerInteraction = useCallback(() => {
    dragRef.current = null;
    setGhost(null);
    setMarquee(null);
  }, []);
  const { isGestureActive } = useCanvasPinchZoom(scrollRef, zoom, onZoomChange, cancelPointerInteraction, tool === 'pan');

  const H=9;
  const toCell = e => {
    const r=ref.current.getBoundingClientRect(), px=e.clientX-r.left, py=e.clientY-r.top;
    return { px,py,rect:r, r:Math.max(0,Math.min(rows-1,Math.floor((py/r.height)*rows))), c:Math.max(0,Math.min(cols-1,Math.floor((px/r.width)*cols))) };
  };
  const getSelBounds = (list, sids) => {
    const sel = list.filter(s => sids.has(s.id));
    if (sel.length === 0) return null;
    let minR=Infinity, minC=Infinity, maxR=-Infinity, maxC=-Infinity;
    for (const s of sel) { minR=Math.min(minR,s.r); minC=Math.min(minC,s.c); maxR=Math.max(maxR,s.r+s.h); maxC=Math.max(maxC,s.c+s.w); }
    return { minR, minC, maxR, maxC };
  };
  const findHandle = (px, py, bounds, rect) => {
    if (!bounds || selRef.current.size === 0) return null;
    const cw=rect.width/cols, ch=rect.height/rows;
    const l=bounds.minC*cw, t=bounds.minR*ch, ri=bounds.maxC*cw, b=bounds.maxR*ch;
    const oL=Math.abs(px-l)<=H, oR=Math.abs(px-ri)<=H, oT=Math.abs(py-t)<=H, oB=Math.abs(py-b)<=H;
    const iX=px>=l-H&&px<=ri+H, iY=py>=t-H&&py<=b+H;
    if(oL&&oT) return'nw'; if(oR&&oT) return'ne'; if(oR&&oB) return'se'; if(oL&&oB) return'sw';
    if(oT&&iX) return'n'; if(oB&&iX) return's'; if(oL&&iY) return'w'; if(oR&&iY) return'e';
    return null;
  };
  const shapeAt=(r,c,list,px,py,rect)=>{
    const sl=list||sRef.current;
    for(let i=sl.length-1;i>=0;i--){
      const s=sl[i];
      if(r>=s.r&&r<s.r+s.h&&c>=s.c&&c<s.c+s.w){
        if(s.type==='tri'&&px!==undefined&&rect){
          const cw=rect.width/cols,ch=rect.height/rows;
          const fx=(px-s.c*cw)/(s.w*cw),fy=(py-s.r*ch)/(s.h*ch);
          const inside=s.dir==='/'
            ?(s.half==='a'?fx+fy<=1:fx+fy>1)
            :(s.half==='a'?fy<=fx:fy>fx);
          if(!inside) continue;
        }
        return s;
      }
    }
    return null;
  };
  const expandPairs=(ids,list)=>{
    const out=new Set(ids);const pids=new Set();
    for(const s of list)if(ids.has(s.id)&&s.pairId)pids.add(s.pairId);
    for(const s of list)if(s.pairId&&pids.has(s.pairId))out.add(s.id);
    return out;
  };
  const sameColor=(a,b)=>!!a&&!!b&&a.hex===b.hex&&a.name===b.name;
  // The other half of a new triangle: White, unless that's the fabric in hand.
  const pairFabric=()=>{
    const white=KONA.find(c=>c.name==="White")||KONA[0];
    if(!sameColor(white,selectedColor)) return white;
    return pinned.find(c=>!sameColor(c,selectedColor))||KONA.find(c=>c.name==="Black")||white;
  };
  const paintShape=(s,d)=>{
    if(!s||sameColor(s.color,selectedColor)) return;
    setShapes(p=>p.map(x=>x.id===s.id?{...x,color:selectedColor}:x), d.pushed?{merge:true}:undefined);
    d.pushed=true;
  };
  // A quarter turn: '/' → '\' keeps each half's fabric; '\' → '/' trades them,
  // which walks the darker half through all four corners.
  const rotatePairs=pids=>{
    setShapes(p=>{
      const colors=new Map();
      for(const x of p)if(x.pairId&&pids.has(x.pairId)){
        if(!colors.has(x.pairId))colors.set(x.pairId,{});
        colors.get(x.pairId)[x.half]=x.color;
      }
      return p.map(x=>{
        if(x.type!=='tri'||!x.pairId||!pids.has(x.pairId)) return x;
        if(x.dir==='/') return {...x,dir:'\\'};
        const c=colors.get(x.pairId);
        return {...x,dir:'/',color:(x.half==='a'?c.b:c.a)||x.color};
      });
    });
  };
  const turnOrSplit=s=>{
    if(s.type==='tri'){
      if(s.pairId) rotatePairs(new Set([s.pairId]));
      else setShapes(p=>p.map(x=>x.id===s.id?{...x,dir:x.dir==='/'?'\\':'/'}:x));
      return;
    }
    const under=sameColor(s.color,selectedColor)?pairFabric():s.color;
    const base={r:s.r,c:s.c,h:s.h,w:s.w,type:'tri',dir:'/',pairId:nextShapeId()};
    setShapes(p=>{
      const i=p.findIndex(x=>x.id===s.id); if(i<0) return p;
      const out=p.slice();
      out.splice(i,1,{...base,id:nextShapeId(),half:'a',color:selectedColor},{...base,id:nextShapeId(),half:'b',color:under});
      return out;
    });
  };

  const onDown = useCallback(e=>{
    if(e.button!==0) return;
    if(tool==='pan') return;
    // Second finger / active pinch owns the gesture — don't start a draw/select.
    if(isGestureActive() || !e.isPrimary) {
      cancelPointerInteraction();
      return;
    }
    e.preventDefault();
    ref.current.setPointerCapture(e.pointerId);
    const {px,py,rect,r,c}=toCell(e);
    const cur=sRef.current, sids=selRef.current;
    const shift=e.shiftKey;
    const hit=shapeAt(r,c,cur,px,py,rect);

    if(tool==='replace'){
      if(hit) onReplaceColor?.(hit.color);
      dragRef.current={type:'noop'};
      return;
    }
    if(tool==='paint'||tool==='hst'){
      if(hit&&tool==='paint'){
        dragRef.current={type:'paint',painted:new Set([hit.id]),pushed:false};
        paintShape(hit,dragRef.current);
      } else if(hit){
        turnOrSplit(hit);
        dragRef.current={type:'noop'};
      } else {
        dragRef.current={type:'create',aR:r,aC:c};
        setGhost({r,c,h:1,w:1});
      }
      return;
    }

    if(sids.size>0){
      const expanded=expandPairs(sids,cur);
      const bounds=getSelBounds(cur,expanded);
      const h=findHandle(px,py,bounds,rect);
      if(h){
        const relevant=cur.filter(x=>expanded.has(x.id));
        const origs=Object.fromEntries(relevant.map(x=>[x.id,{r:x.r,c:x.c,h:x.h,w:x.w}]));
        dragRef.current={type:'resize',handle:h,origBounds:bounds,origs,startR:r,startC:c};
        return;
      }
    }

    const s=hit;
    if(s){
      // Triangle pairs are treated as a single selectable item — clicking either
      // half selects both, shift-click toggles them together.
      const pairSet = expandPairs(new Set([s.id]), cur);
      const pairIds = [...pairSet];
      if(shift){
        setSelIds(prev=>{
          const n=new Set(prev);
          const allIn=pairIds.every(id=>n.has(id));
          if(allIn) pairIds.forEach(id=>n.delete(id));
          else pairIds.forEach(id=>n.add(id));
          return n;
        });
        dragRef.current={type:'noop'};
      } else {
        const alreadySelected=pairIds.every(id=>sids.has(id));
        const newSids = alreadySelected ? sids : pairSet;
        setSelIds(newSids);
        const moveIds=expandPairs(newSids,cur);
        const relevant=cur.filter(x=>moveIds.has(x.id));
        const origs=Object.fromEntries(relevant.map(x=>[x.id,{r:x.r,c:x.c,h:x.h,w:x.w}]));
        dragRef.current={type:'move',startR:r,startC:c,origs,pushed:false};
      }
    } else {
      if(!shift) setSelIds(new Set());
      dragRef.current={type:'marquee',aR:r,aC:c};
      setMarquee({r,c,h:1,w:1});
    }
  },[tool,rows,cols,setShapes,setSelIds,isGestureActive,cancelPointerInteraction,selectedColor,pinned,onReplaceColor]);

  const onMove = useCallback(e=>{
    if(isGestureActive()) return;
    const {px,py,rect,r,c}=toCell(e); const d=dragRef.current; const sids=selRef.current;
    if(!d){
      if(tool==='select'&&sids.size>0){
        const bounds=getSelBounds(sRef.current,sids);
        if(bounds){
          const h=findHandle(px,py,bounds,rect);
          if(h){const m={nw:'nw-resize',ne:'ne-resize',se:'se-resize',sw:'sw-resize',n:'n-resize',s:'s-resize',e:'e-resize',w:'w-resize'};setCur(m[h]);return;}
          const cw=rect.width/cols,ch=rect.height/rows;
          const overSel=sRef.current.some(s=>sids.has(s.id)&&px>=s.c*cw&&px<=(s.c+s.w)*cw&&py>=s.r*ch&&py<=(s.r+s.h)*ch);
          if(overSel){setCur('grab');return;}
        }
      }
      setCur(tool==='pan'?'grab':tool==='select'?'default':'crosshair'); return;
    }
    if(d.type==='noop') return;
    if(d.type==='paint'){
      const s=shapeAt(r,c,sRef.current,px,py,rect);
      if(s&&!d.painted.has(s.id)){d.painted.add(s.id);paintShape(s,d);}
      return;
    }
    if(d.type==='marquee'){const mr=Math.min(d.aR,r),mc=Math.min(d.aC,c);setMarquee({r:mr,c:mc,h:Math.abs(r-d.aR)+1,w:Math.abs(c-d.aC)+1});}
    else if(d.type==='create'){const gr=Math.min(d.aR,r),gc=Math.min(d.aC,c);setGhost({r:gr,c:gc,h:Math.abs(r-d.aR)+1,w:Math.abs(c-d.aC)+1});}
    else if(d.type==='move'){
      const dr=r-d.startR, dc=c-d.startC;
      if(!d.pushed&&dr===0&&dc===0) return;
      setShapes(p=>p.map(s=>{
        const orig=d.origs[s.id]; if(!orig) return s;
        return {...s,r:Math.max(0,Math.min(rows-orig.h,orig.r+dr)),c:Math.max(0,Math.min(cols-orig.w,orig.c+dc))};
      }), d.pushed?{merge:true}:undefined);
      d.pushed=true;
    }
    else if(d.type==='resize'){
      const dr=r-d.startR, dc=c-d.startC;
      if(!d.pushed&&dr===0&&dc===0) return;
      const ob=d.origBounds;
      let nMinR=ob.minR, nMinC=ob.minC, nMaxR=ob.maxR, nMaxC=ob.maxC;
      if(d.handle.includes('n')) nMinR=ob.minR+dr;
      if(d.handle.includes('s')) nMaxR=ob.maxR+dr;
      if(d.handle.includes('w')) nMinC=ob.minC+dc;
      if(d.handle.includes('e')) nMaxC=ob.maxC+dc;
      nMinR=Math.max(0,nMinR); nMinC=Math.max(0,nMinC);
      nMaxR=Math.min(rows,Math.max(nMinR+1,nMaxR)); nMaxC=Math.min(cols,Math.max(nMinC+1,nMaxC));
      const oW=ob.maxC-ob.minC, oH=ob.maxR-ob.minR, nW=nMaxC-nMinC, nH=nMaxR-nMinR;
      if(oW>0&&oH>0) setShapes(p=>p.map(s=>{
        const orig=d.origs[s.id]; if(!orig) return s;
        const nr=Math.max(0,Math.round(nMinR+((orig.r-ob.minR)/oH)*nH));
        const nc=Math.max(0,Math.round(nMinC+((orig.c-ob.minC)/oW)*nW));
        const nh=Math.max(1,Math.round((orig.h/oH)*nH));
        const nw=Math.max(1,Math.round((orig.w/oW)*nW));
        return {...s,r:nr,c:nc,h:Math.min(nh,rows-nr),w:Math.min(nw,cols-nc)};
      }), d.pushed?{merge:true}:undefined);
      d.pushed=true;
    }
  },[tool,rows,cols,setShapes,setSelIds,isGestureActive,selectedColor]);

  const onUp = useCallback(e=>{
    if(isGestureActive()) {
      cancelPointerInteraction();
      return;
    }
    const d=dragRef.current;
    if(d?.type==='create'&&ghost){
      if(tool==='hst'){
        const white=pairFabric();
        const pid=Date.now()+Math.random();
        const a={id:Date.now()+Math.random(),r:ghost.r,c:ghost.c,h:ghost.h,w:ghost.w,type:'tri',color:selectedColor,dir:'/',half:'a',pairId:pid};
        const b={id:Date.now()+Math.random(),r:ghost.r,c:ghost.c,h:ghost.h,w:ghost.w,type:'tri',color:white,dir:'/',half:'b',pairId:pid};
        setShapes(p=>[...p,a,b]);
      } else {
        const ns={id:Date.now(),...ghost,color:selectedColor};
        setShapes(p=>[...p,ns]);
      }
    }
    if(d?.type==='marquee'&&marquee){
      const minR=marquee.r, maxR=marquee.r+marquee.h, minC=marquee.c, maxC=marquee.c+marquee.w;
      const hits=sRef.current.filter(s=>s.r<maxR&&s.r+s.h>minR&&s.c<maxC&&s.c+s.w>minC);
      if(hits.length>0){
        setSelIds(prev=>{
          if(e.shiftKey){const n=new Set(prev);hits.forEach(s=>n.add(s.id));return n;}
          return new Set(hits.map(s=>s.id));
        });
      }
    }
    dragRef.current=null; setGhost(null); setMarquee(null);
  },[ghost,marquee,selectedColor,pinned,tool,setShapes,setSelIds,isGestureActive,cancelPointerInteraction]);

  useEffect(()=>{
    const handleKey = e => {
      if(studioCovered()) return;
      if(e.target.tagName==='INPUT'||e.target.tagName==='SELECT'||e.target.tagName==='TEXTAREA') return;
      const sids=selRef.current;
      if(sids.size===0) return;
      if(e.key==='Delete'||e.key==='Backspace'){
        e.preventDefault();
        const del=expandPairs(sids,sRef.current);
        setShapes(p=>p.filter(s=>!del.has(s.id)));
        setSelIds(new Set());
      }
      if(e.key==='f'||e.key==='F'){
        const pids=new Set();
        for(const s of sRef.current)if(sids.has(s.id)&&s.pairId)pids.add(s.pairId);
        setShapes(p=>p.map(s=>{
          if(s.type!=='tri'||!s.pairId||!pids.has(s.pairId)) return s;
          return {...s,dir:s.dir==='/'?'\\':'/'};
        }));
      }
      const arrow={ArrowUp:[-1,0],ArrowDown:[1,0],ArrowLeft:[0,-1],ArrowRight:[0,1]}[e.key];
      if(arrow){
        e.preventDefault();
        const [dr,dc]=arrow;
        const move=expandPairs(sids,sRef.current);
        setShapes(p=>p.map(s=>{
          if(!move.has(s.id)) return s;
          return {...s,r:Math.max(0,Math.min(rows-s.h,s.r+dr)),c:Math.max(0,Math.min(cols-s.w,s.c+dc))};
        }));
      }
    };
    window.addEventListener('keydown',handleKey);
    return ()=>window.removeEventListener('keydown',handleKey);
  },[rows,cols,setShapes,setSelIds]);

  const selShapes = shapes.filter(s=>selIds.has(s.id));
  const singleSel = selIds.size===1 ? selShapes[0] : null;
  const cw=100/cols, ch=100/rows;

  const expandedSelIds = useMemo(()=>expandPairs(selIds,shapes),[selIds,shapes]);
  const expandedSelShapes = shapes.filter(s=>expandedSelIds.has(s.id));
  const selBounds = useMemo(()=>{
    if(expandedSelShapes.length===0) return null;
    let minR=Infinity,minC=Infinity,maxR=-Infinity,maxC=-Infinity;
    for(const s of expandedSelShapes){minR=Math.min(minR,s.r);minC=Math.min(minC,s.c);maxR=Math.max(maxR,s.r+s.h);maxC=Math.max(maxC,s.c+s.w);}
    return {minR,minC,maxR,maxC};
  },[expandedSelShapes]);

  const hDots = selBounds ? [
    [selBounds.minC,selBounds.minR],[(selBounds.minC+selBounds.maxC)/2,selBounds.minR],[selBounds.maxC,selBounds.minR],
    [selBounds.maxC,(selBounds.minR+selBounds.maxR)/2],[selBounds.maxC,selBounds.maxR],
    [(selBounds.minC+selBounds.maxC)/2,selBounds.maxR],[selBounds.minC,selBounds.maxR],[selBounds.minC,(selBounds.minR+selBounds.maxR)/2],
  ] : [];

  // Triangle pairs whose halves are both selected — used to suppress the
  // diagonal hypotenuse stroke so the pair reads as a single highlighted square.
  const fullySelectedPairs = useMemo(() => {
    const counts = new Map();
    for (const s of shapes) {
      if (!s.pairId) continue;
      const e = counts.get(s.pairId) || { sel: 0, total: 0 };
      e.total++;
      if (selIds.has(s.id)) e.sel++;
      counts.set(s.pairId, e);
    }
    const set = new Set();
    for (const [pid, e] of counts) if (e.total === 2 && e.sel === 2) set.add(pid);
    return set;
  }, [shapes, selIds]);

  const handleDuplicate = () => {
    const dupIds=expandPairs(selIds,shapes);
    const toDup=shapes.filter(s=>dupIds.has(s.id));
    const off=quiltDuplicateOffset(toDup,rows,cols);
    if(!off) return;
    const pairMap=new Map();
    const toAdd=toDup.map(s=>{
      let np=s.pairId;
      if(np){if(!pairMap.has(np))pairMap.set(np,nextShapeId());np=pairMap.get(np);}
      return {...s,id:nextShapeId(),pairId:np||undefined,r:s.r+off.dr,c:s.c+off.dc};
    });
    setShapes(p=>[...p,...toAdd]);
    setSelIds(new Set(toAdd.map(s=>s.id)));
  };
  const canDuplicate = !!quiltDuplicateOffset(expandedSelShapes, rows, cols);
  const overlapCells = useMemo(() => quiltOverlapCells(shapes), [shapes]);
  const handleDelete = () => {
    const del=expandPairs(selIds,shapes);
    setShapes(p=>p.filter(s=>!del.has(s.id)));
    setSelIds(new Set());
  };
  const handleRecolor = (c = selectedColor, ids = selIds) => {
    setShapes(p=>p.map(s=>ids.has(s.id)?{...s,color:c}:s));
  };
  const handleRotateTri = () => {
    const pids=new Set();
    for(const s of selShapes)if(s.pairId)pids.add(s.pairId);
    if(pids.size) rotatePairs(pids);
  };
  const handleSwapTriColors = () => {
    const pids=new Set();
    for(const s of selShapes)if(s.pairId)pids.add(s.pairId);
    const colorByPair=new Map();
    for(const s of shapes)if(s.pairId&&pids.has(s.pairId)){
      if(!colorByPair.has(s.pairId))colorByPair.set(s.pairId,{});
      colorByPair.get(s.pairId)[s.half]=s.color;
    }
    setShapes(p=>p.map(s=>{
      if(!s.pairId||!pids.has(s.pairId)) return s;
      const c=colorByPair.get(s.pairId);
      return {...s,color:s.half==='a'?c.b:c.a};
    }));
  };

  const hasTri = selShapes.some(s=>s.type==='tri');

  // Color shown on the toolbar swatch: shape color when single-select; common
  // color across the selection when all match; otherwise null (mixed).
  const selectionSwatchColor = useMemo(() => {
    if (selShapes.length === 0) return null;
    const first = selShapes[0].color;
    return selShapes.every(s => s.color?.hex === first?.hex) ? first : null;
  }, [selShapes]);

  // Half-square triangle (HST) view: when the selection is exactly one tri pair,
  // treat it as a single item with two color dropdowns + the swap/flip switcher.
  const singleTriPair = useMemo(() => {
    if (selShapes.length !== 2 || !selShapes.every(s => s.type === 'tri')) return null;
    const [s1, s2] = selShapes;
    if (!s1.pairId || s1.pairId !== s2.pairId) return null;
    const a = s1.half === 'a' ? s1 : s2;
    const b = s1.half === 'a' ? s2 : s1;
    return { a, b };
  }, [selShapes]);

  // The toolbar's swatches recolor the whole selection, or just the chosen
  // half when the selection is one triangle pair.
  const paletteTargetIds = singleTriPair ? new Set([singleTriPair[triSlot].id]) : selIds;
  const paletteCurrentColor = singleTriPair ? singleTriPair[triSlot].color : selectionSwatchColor;
  // A mixed selection shows its fabrics as slices of one swatch.
  const mixedSwatchStyle = useMemo(() => {
    const hexes = [...new Set(selShapes.map(s => s.color?.hex).filter(Boolean))].slice(0, 4);
    if (hexes.length < 2) return undefined;
    const step = 360 / hexes.length;
    return { background: `conic-gradient(${hexes.map((h, i) => `${h} ${i * step}deg ${(i + 1) * step}deg`).join(', ')})` };
  }, [selShapes]);
  const fabricMenuRef = useRef(null);

  useEffect(() => { setTriSlot('a'); }, [selIds]);

  // Position the floating selection toolbar in viewport coords, FigJam-style:
  // - Default: hover above the bbox, anchored to the canvas frame.
  // - When the bbox sits at the top of the canvas (or off-screen above), flip below.
  // - When neither above nor below fits in the canvas-scroll viewport, clamp to the
  //   visible top of the viewport (no arrow).
  useLayoutEffect(() => {
    if (!selBounds || selIds.size === 0) {
      if (tbPos) setTbPos(null);
      return undefined;
    }
    const recompute = () => {
      const surface = ref.current;
      const scroll = scrollRef.current;
      const tb = toolbarRef.current;
      if (!surface || !scroll || !tb) return;
      const sRect = surface.getBoundingClientRect();
      const cRect = scroll.getBoundingClientRect();
      const tbRect = tb.getBoundingClientRect();
      const cellW = sRect.width / cols;
      const cellH = sRect.height / rows;
      const bboxLeft = sRect.left + selBounds.minC * cellW;
      const bboxRight = sRect.left + selBounds.maxC * cellW;
      const bboxTop = sRect.top + selBounds.minR * cellH;
      const bboxBottom = sRect.top + selBounds.maxR * cellH;
      const bboxCx = (bboxLeft + bboxRight) / 2;
      const GAP = 8;
      const PAD = 8;
      const tbH = tbRect.height || 36;
      const tbW = tbRect.width || 240;
      let mode, top;
      const aboveY = bboxTop - GAP - tbH;
      const belowY = bboxBottom + GAP;
      if (aboveY >= cRect.top + PAD) {
        mode = 'above'; top = aboveY;
      } else if (belowY + tbH <= cRect.bottom - PAD) {
        mode = 'below'; top = belowY;
      } else {
        mode = 'clamped'; top = cRect.top + PAD;
      }
      let left = bboxCx - tbW / 2;
      const minLeft = cRect.left + PAD;
      const maxLeft = cRect.right - PAD - tbW;
      left = Math.max(minLeft, Math.min(left, maxLeft));
      setTbPos(prev => {
        if (prev && prev.mode === mode && Math.abs(prev.left - left) < 0.5 && Math.abs(prev.top - top) < 0.5) return prev;
        return { left, top, mode };
      });
    };
    recompute();
    const scrollEl = scrollRef.current;
    const onScroll = () => recompute();
    const onResize = () => recompute();
    scrollEl?.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    return () => {
      scrollEl?.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, { capture: true });
    };
  }, [
    selBounds?.minR, selBounds?.minC, selBounds?.maxR, selBounds?.maxC,
    selIds.size, cols, rows, zoom,
  ]);

  return (
    <div style={{position:'relative',width:'100%',height:'100%'}}>
      <div className={`canvas-scroll${tool === 'pan' ? ' is-panning' : ''}`} ref={scrollRef}>
        {/* Zoom 1 fits the whole quilt in the stage (.ed-app sizes the frame
            from these vars); higher zooms scroll. */}
        <div className="canvas-frame" style={{
          '--ed-zoom': zoom,
          '--ed-ar': cols / rows,
          aspectRatio: `${cols}/${rows}`,
        }}>
          <div ref={ref} className="canvas-surface"
            style={{cursor:cur}}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>

            {/* Grid lines (1pt regardless of zoom via non-scaling-stroke) */}
            <svg style={{position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:'none'}}
              viewBox={`0 0 ${cols} ${rows}`} preserveAspectRatio="none">
              {Array.from({length:cols+1},(_,i)=>(
                <line key={`v${i}`} x1={i} y1={0} x2={i} y2={rows}
                  stroke={i===0||i===cols?"rgba(23,23,23,0.22)":"rgba(23,23,23,0.08)"}
                  strokeWidth="1" vectorEffect="non-scaling-stroke"/>
              ))}
              {Array.from({length:rows+1},(_,i)=>(
                <line key={`h${i}`} x1={0} y1={i} x2={cols} y2={i}
                  stroke={i===0||i===rows?"rgba(23,23,23,0.22)":"rgba(23,23,23,0.08)"}
                  strokeWidth="1" vectorEffect="non-scaling-stroke"/>
              ))}
            </svg>

            {/* Shapes */}
            {shapes.map(s=>{
              const isSel=selIds.has(s.id);
              const pos={position:'absolute',left:`${s.c*cw}%`,top:`${s.r*ch}%`,width:`${s.w*cw}%`,height:`${s.h*ch}%`,
                boxSizing:'border-box',pointerEvents:'none',borderRadius:1,overflow:'hidden'};
              if(s.type==='tri'){
                const pts=s.dir==='/'?(s.half==='a'?'0,0 1,0 0,1':'1,0 1,1 0,1'):(s.half==='a'?'0,0 1,0 1,1':'0,0 0,1 1,1');
                // Suppress the polygon's stroke (which would draw the diagonal
                // hypotenuse) when the whole pair is selected — the pair gets a
                // single outline around its bounding box instead.
                const pairFully = s.pairId && fullySelectedPairs.has(s.pairId);
                const showSelStroke = isSel && !pairFully;
                return (
                  <div key={s.id} style={pos}>
                    <svg viewBox="0 0 1 1" width="100%" height="100%" preserveAspectRatio="none" style={{display:'block'}}>
                      <polygon points={pts} fill={s.color.hex} stroke={showSelStroke?'#171717':'rgba(0,0,0,0.10)'} strokeWidth={showSelStroke?'0.06':'0.02'}/>
                    </svg>
                  </div>
                );
              }
              return (
                <div key={s.id} style={{...pos,background:s.color.hex,
                  outline:isSel?'2px solid #171717':'1px solid rgba(0,0,0,0.10)',outlineOffset:isSel?'-2px':'0',
                  boxShadow:isSel?'inset 0 0 0 3px rgba(255,255,255,0.85)':undefined}}/>
              );
            })}

            {/* Stacked cells — a hatch so a buried patch is visible as a stack,
                not as a single piece sitting flush on the one underneath. */}
            {overlapCells.map(({r,c})=>(
              <div key={`ov-${r}-${c}`}
                title="Overlapping patches"
                style={{
                  position:'absolute',
                  left:`${c*cw}%`,top:`${r*ch}%`,
                  width:`${cw}%`,height:`${ch}%`,
                  boxSizing:'border-box',pointerEvents:'none',
                  background:'repeating-linear-gradient(-45deg, rgba(26,26,26,0.28) 0 2px, transparent 2px 5px)',
                }}/>
            ))}

            {/* Ghost */}
            {ghost && (
              <div style={{
                position:'absolute',
                left:`${ghost.c*cw}%`,top:`${ghost.r*ch}%`,
                width:`${ghost.w*cw}%`,height:`${ghost.h*ch}%`,
                background:selectedColor.hex,opacity:0.5,
                outline:'2px dashed #000000',outlineOffset:'-1px',
                boxSizing:'border-box',pointerEvents:'none',borderRadius:1,
              }}/>
            )}

            {/* Marquee */}
            {marquee && (
              <div style={{
                position:'absolute',
                left:`${marquee.c*cw}%`,top:`${marquee.r*ch}%`,
                width:`${marquee.w*cw}%`,height:`${marquee.h*ch}%`,
                background:'rgba(23,23,23,0.06)',
                outline:'1.5px dashed #171717',outlineOffset:'-1px',
                boxSizing:'border-box',pointerEvents:'none',borderRadius:1,
              }}/>
            )}

            {/* Bounding box outline for multi-selection or a fully-selected
                tri pair (so HSTs read as a single highlighted square). */}
            {selBounds && (selIds.size>1) && (
              <div style={{
                position:'absolute',
                left:`${selBounds.minC*cw}%`,top:`${selBounds.minR*ch}%`,
                width:`${(selBounds.maxC-selBounds.minC)*cw}%`,height:`${(selBounds.maxR-selBounds.minR)*ch}%`,
                outline: singleTriPair ? '2px solid #171717' : '1.5px dashed #171717',
                outlineOffset:'-1px',
                boxSizing:'border-box',pointerEvents:'none',
              }}/>
            )}

            {/* Resize handles */}
            {hDots.map(([hc,hr],i)=>(
              <div key={i} style={{
                position:'absolute',
                left:`calc(${hc*cw}% - 4px)`,top:`calc(${hr*ch}% - 4px)`,
                width:8,height:8,
                background:'#FFFFFF',border:'1.5px solid #171717',borderRadius:2,
                pointerEvents:'none',zIndex:5,
              }}/>
            ))}

            {/* Quilting */}
            {showQuilting && <QuiltOverlay cols={cols} rows={rows} pattern={quiltPattern} spacing={quiltSpacing} color={quiltColor?.hex||'#000000'}/>}
          </div>

        </div>
      </div>

      {/* Floating selection toolbar (FigJam-style: anchored to bbox, clamps to viewport) */}
      {selBounds && selIds.size > 0 && (
        <div
          ref={toolbarRef}
          className={`selection-toolbar ${isMobile ? 'mobile-selbar' : (tbPos ? tbPos.mode : 'above')}`}
          style={isMobile
            ? undefined
            : (tbPos
              ? { position:'fixed', left: tbPos.left, top: tbPos.top }
              : { position:'fixed', left: 0, top: 0, visibility:'hidden' })}>
          {singleTriPair ? <>
            {['a', 'b'].map(k => {
              const half = singleTriPair[k];
              const pts = half.dir === '/'
                ? (k === 'a' ? '0,0 1,0 0,1' : '1,0 1,1 0,1')
                : (k === 'a' ? '0,0 1,0 1,1' : '0,0 0,1 1,1');
              return (
                <button key={k} type="button" className={`ed-sel-slot${triSlot === k ? ' is-active' : ''}`}
                  aria-pressed={triSlot === k} onClick={() => setTriSlot(k)}
                  title={k === 'a' ? 'Recolor the first triangle' : 'Recolor the second triangle'}>
                  <svg width="20" height="20" viewBox="0 0 1 1">
                    <rect width="1" height="1" fill="#FFFFFF"/>
                    <polygon points={pts} fill={half.color.hex}/>
                  </svg>
                </button>
              );
            })}
            <span className="selection-toolbar-divider"/>
          </> : (
            <span className="selection-swatch-meta">
              {selIds.size === 1 && singleSel ? `${singleSel.w}×${singleSel.h}` : `${selIds.size} selected`}
            </span>
          )}
          <EdMenuButton btnRef={fabricMenuRef} menuLabel="Fabrics" width={256}
            label={paletteCurrentColor ? `Fabric: ${paletteCurrentColor.name}` : 'Fabric: mixed'}
            trigger={<span className="ed-menu-swatch" style={paletteCurrentColor ? edSwatchStyle(paletteCurrentColor) : mixedSwatchStyle}/>}>
            <div className="ed-menu-swatches">
              {pinned.map((c, i) => (
                <EdSwatch key={`${c.name}-${i}`} color={c}
                  active={!!paletteCurrentColor && paletteCurrentColor.hex === c.hex && paletteCurrentColor.name === c.name}
                  onClick={() => { handleRecolor(c, paletteTargetIds); onPickFabric?.(c); }}/>
              ))}
              {onAddFabric && (
                <button type="button" className="ed-swatch ed-swatch-add" onClick={() => onAddFabric(fabricMenuRef)}
                  title="Add a fabric" aria-label="Add a fabric">
                  <IcPlus size={12}/>
                </button>
              )}
            </div>
          </EdMenuButton>
          <span className="selection-toolbar-divider"/>
          {hasTri && <>
            <button className="icon-btn" onClick={handleRotateTri} title="Turn triangle" aria-label="Turn triangle"><IcRotate/></button>
            <button className="icon-btn" onClick={handleSwapTriColors} title="Swap triangle colors" aria-label="Swap triangle colors"><IcSwap/></button>
          </>}
          <button className="icon-btn" onClick={handleDuplicate} title={canDuplicate ? 'Duplicate' : 'No room to duplicate'} aria-label="Duplicate" disabled={!canDuplicate}><IcCopy/></button>
          <button className="icon-btn" onClick={handleDelete} title="Delete" aria-label="Delete"><IcTrash/></button>
        </div>
      )}
    </div>
  );
}
