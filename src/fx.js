/* GSAP motion wrapper with graceful no-GSAP / reduced-motion fallbacks.
   Used by both venipuncture/steps.js and ui/panels.js, so it lives here as
   a leaf (like dom.js/utils.js) rather than under ui/, avoiding a cycle. */
import { $, panel } from "./dom.js";
import { REDUCED } from "./game/gameState.js";

export const FX = {
  get gsap(){ return (!REDUCED && window.gsap) ? window.gsap : null; },
  get lenis(){ return window.__lenis || null; },
  hasVanta(){ return !!window.VANTA; }
};

export function fxFrom(el, vars){ const g=FX.gsap; if(!el) return; if(g) g.from(el, vars); }
export function fxTo(el, vars){ const g=FX.gsap; if(!el){ if(vars&&vars.onComplete) vars.onComplete(); return; }
  if(g) g.to(el, vars); else { // graceful fallback: jump to end + fire callback
    try{ if(vars){ if("x" in vars) el.style.transform=`translateX(${vars.x}px)`; if("opacity" in vars) el.style.opacity=vars.opacity; } }catch(e){}
    if(vars&&vars.onComplete) setTimeout(vars.onComplete, 0);
  }
}
export function fxStagger(sel, vars){ const g=FX.gsap; if(!g) return; const els=(typeof sel==="string")?panel.querySelectorAll(sel):sel; if(els&&els.length) g.from(els, vars); }
// richer panel entrance: stagger the children in when GSAP is present
export function fxPanelIn(){
  const g=FX.gsap; if(!g||!panel) return;
  const kids=[...panel.children].filter(n=>n.nodeType===1);
  if(!kids.length) return;
  g.killTweensOf(kids);
  g.from(kids,{opacity:0,y:14,duration:.34,ease:"power3.out",stagger:0.045,clearProps:"transform,opacity"});
}
export function countUp(el, to, opts){
  if(!el) return; to=Math.round(to); opts=opts||{};
  const from=parseInt(el.dataset.cuVal||el.textContent||"0",10)||0;
  el.dataset.cuVal=to;
  if(from===to){ el.textContent=to; return; }
  const g=FX.gsap;
  if(!g||REDUCED){ el.textContent=to; return; }
  const o={v:from};
  g.to(o,{v:to,duration:.7,ease:"power2.out",onUpdate:()=>{ el.textContent=Math.round(o.v); },
    onComplete:()=>{ el.textContent=to; if(opts.pop) fxTo(el,{scale:1,duration:.2,ease:"back.out(3)"}); }});
  if(opts.pop && g){ g.fromTo(el,{scale:1.35},{scale:1,duration:.4,ease:"back.out(2.4)"}); }
}
export function shiny(el){ if(el) el.classList.add("shiny-text"); }
export function blurText(el){
  if(!el||REDUCED||!FX.gsap) return;
  const txt=el.textContent; if(!txt||el.dataset.blurred) return;
  el.dataset.blurred="1";
  el.innerHTML=txt.split(" ").map(w=>`<span class="bt-w">${w}</span>`).join(" ");
  FX.gsap.from(el.querySelectorAll(".bt-w"),{opacity:0,filter:"blur(8px)",y:8,duration:.5,ease:"power2.out",stagger:0.06,
    clearProps:"filter,transform,opacity"});
}
