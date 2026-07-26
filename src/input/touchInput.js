/* Generic pointer-drag primitive shared by every 2D venipuncture interaction
   (drag the tourniquet, drag the swab, drag a tube onto the holder, ...).
   Works uniformly for mouse and touch since it's built on Pointer Events. */

// generic pointer-drag: moves an element by transform and reports drop offset
export function makeDraggable(el, opts){
  if(!el) return;
  let sx=0,sy=0,drag=false;
  const down=e=>{ e.preventDefault(); drag=true; sx=e.clientX; sy=e.clientY;
    try{el.setPointerCapture(e.pointerId);}catch(_){}; el.classList.add("vp-grab"); opts.onStart&&opts.onStart(e); };
  const move=e=>{ if(!drag) return; opts.onMove&&opts.onMove(e.clientX-sx,e.clientY-sy,e); };
  const up=e=>{ if(!drag) return; drag=false; el.classList.remove("vp-grab"); opts.onDrop&&opts.onDrop(e.clientX-sx,e.clientY-sy,e); };
  el.addEventListener("pointerdown",down);
  el.addEventListener("pointermove",move);
  el.addEventListener("pointerup",up);
  el.addEventListener("pointercancel",up);
}

export function elementCenter(el){ const r=el.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2,r}; }
export function isNear(a,b,tol){ const ca=elementCenter(a),cb=elementCenter(b); return Math.hypot(ca.x-cb.x,ca.y-cb.y)<=(tol||60); }
