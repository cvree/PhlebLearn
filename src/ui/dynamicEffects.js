/* Progressive-enhancement wiring for the CDN-loaded GSAP/Lenis/Vanta
   libraries: click sparks on tap, smooth-scroll on the long overlay cards,
   and a living Vanta.fog backdrop behind the loading screen. Every one of
   these is optional — the game runs fine with plain CSS animations if a
   CDN is blocked. */
import * as THREE from "three";
import { $ } from "../dom.js";
import { REDUCED } from "../game/gameState.js";
import { clickSpark } from "./notifications.js";

export function initReactBits(){
  document.addEventListener("pointerdown",(e)=>{
    if(REDUCED) return;
    const t=e.target;
    if(t.closest && t.closest(".btn,.opt,.chk,.scorecell,.badgechip,.floatbtn,.vp-tap,.vp-vein,.sb-tile,.shop-tags button")){
      clickSpark(e.clientX,e.clientY, t.closest(".opt.bad,.btn.gold")?18: t.closest(".btn.mint,.opt.good")?150:265);
    }
  },{passive:true});
}

export function initLenis(){
  if(REDUCED || !window.Lenis) return;
  const targets=[document.querySelector(".shop-card"),document.querySelector(".sticker-card")].filter(Boolean);
  window.__lenisList=[];
  targets.forEach(node=>{
    try{
      const l=new window.Lenis({ wrapper:node, content:node.firstElementChild||node, duration:0.9,
        smoothWheel:true, syncTouch:true, easing:(t)=>Math.min(1,1.001-Math.pow(2,-10*t)) });
      window.__lenisList.push(l);
      function raf(t){ l.raf(t); requestAnimationFrame(raf); }
      requestAnimationFrame(raf);
    }catch(e){}
  });
}

export function initVanta(){
  if(REDUCED || !window.VANTA) return;
  const host=$("loading");
  if(host && !window.__vantaLoad){
    try{
      // Vanta needs its own THREE reference — the static import above resolves
      // to the same singleton module instance used everywhere else.
      window.__vantaLoad=window.VANTA.FOG({ el:host, THREE, highlightColor:0xff9cc0, midtoneColor:0x6b5bd2,
        lowlightColor:0x5aa9f0, baseColor:0xeaf3ff, blurFactor:0.55, speed:1.1, zoom:0.8 });
    }catch(e){}
  }
}
export function destroyVantaLoad(){ if(window.__vantaLoad){ try{ window.__vantaLoad.destroy(); }catch(e){} window.__vantaLoad=null; } }
