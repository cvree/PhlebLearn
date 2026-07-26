/* =========================================================================
   TINY VIALS — composition root.
   This is the only file allowed to import from every layer: it wires
   rendering + world + input + ui + game together and owns the two things
   that are inherently cross-cutting — startThree()'s build sequence and the
   animate() render loop — because both touch state owned by several layers
   at once (see docs/ARCHITECTURE.md "Application startup").
   ========================================================================= */
import * as THREE from "three";

import { createRenderer, getRenderer } from "./rendering/renderer.js";
import { createScene } from "./rendering/scene.js";
import { createLighting } from "./rendering/lighting.js";
import { createCamera, orbit, setDefaultOrbit, updateCamera, tickCamTween, wallOpacityForSide } from "./rendering/camera.js";
import { applyTheme } from "./rendering/materials.js";
import { registerModel, preloadModels } from "./rendering/modelRegistry.js";

import {
  buildRoom, setRoomScene, updateRoomUpgrades, updateRoomWallVisibility, tickWallFade,
  arrangeIsOpen, arrangeStop, arrangeClose, getArrangeGridGroup, upgradeGroup, stickerBookGroup
} from "./world/room.js";
import { buildFurniture } from "./world/furniture.js";
import { buildTubeRack, tubeMeshes } from "./world/tubeRack.js";
import { buildMascot, mascot, patientGroup, mascotReact, decayMascotReact, reactMascot } from "./world/patient.js";
import { isInteractableNow } from "./world/interactables.js";

import { pickAt } from "./input/raycasting.js";
import { createOrbitControls } from "./input/cameraControls.js";
import { createArrangeDragHandlers } from "./input/pointerInput.js";

import { SS, DARK, REDUCED, state } from "./game/gameState.js";
import { sfx } from "./audio/audioManager.js";
import { updateMusicBtn, setMusicVol, playLobby, armAudioUnlock } from "./audio/audioManager.js";
import { toast, confetti } from "./ui/notifications.js";
import {
  openSettings, closeSettings, toggleSettings, toggleReduced, toggleThemeAndSync, toggleMusicAndSync,
  renderUpgradeShop, closeUpgradeShop, openStickerBook, closeStickerBook, stickerBookOpen
} from "./ui/settings.js";
import { go, onTubePicked, syncTop } from "./ui/panels.js";
import { initReactBits, initLenis, initVanta, destroyVantaLoad } from "./ui/dynamicEffects.js";

/* ---------- Phase 0 model-registry scaffolding ----------------------------
   No real .glb assets exist yet (see docs/ASSET_PIPELINE.md) — this proves
   the load -> cache -> fallback -> instance pipeline end-to-end using a
   trivial procedural placeholder, without touching any visible gameplay.
   Phase 1 registers the real venipuncture props here. */
function createPlaceholderFallback(){
  const g = new THREE.Group();
  g.name = "model-registry-placeholder";
  return g;
}
registerModel({ id:"__phase0Probe", url:null, fallback:createPlaceholderFallback });

let scene, camera;
const DOT_LINES=["Dot: You've got this! 🩷","Dot: Tubes are ready when you are 🧪","Dot: Breathe — you're doing great ✨","Dot: I believe in you! 🌟","Dot: Order of draw? Easy for you 😎","Dot: Let's make it a cozy shift 🩷"];
function pickOne(a){ return a[Math.floor(Math.random()*a.length)]; }

function startThree(){
  scene = createScene();
  setRoomScene(scene);
  camera = createCamera();
  const renderer = createRenderer();
  const canvasEl = renderer.domElement;
  document.getElementById("app").insertBefore(canvasEl, document.getElementById("app").firstChild);
  createLighting(scene);

  buildRoom();
  buildFurniture(scene);
  buildTubeRack(scene);
  buildMascot(scene);
  updateRoomUpgrades();
  applyTheme(DARK);

  preloadModels(["__phase0Probe"]).catch(()=>{});

  setupInput(canvasEl);
  setDefaultOrbit();
  refreshCamera();
  animate();
}

// Central place that keeps the camera and the room's wall-fade in sync —
// see rendering/camera.js and world/room.js for why this can't live in either.
function refreshCamera(){ updateCamera(); updateRoomWallVisibility(); }

function setupInput(canvasEl){
  const orbitControls = createOrbitControls(canvasEl, refreshCamera);
  const arrangeDrag = createArrangeDragHandlers(canvasEl, ()=>upgradeGroup);

  canvasEl.addEventListener("pointerdown", e=>{
    if(arrangeIsOpen() && arrangeDrag.tryGrab(e)) return;
    orbitControls.onPointerDown(e);
  });
  canvasEl.addEventListener("pointermove", e=>{
    if(arrangeDrag.onMove(e)) return;
    orbitControls.onPointerMove(e);
  });
  canvasEl.addEventListener("pointerup", e=>{
    if(arrangeDrag.onUp(e)) return;
    const wasDragging = orbitControls.dragState.dragging;
    const moved = orbitControls.dragState.moved;
    orbitControls.onPointerUp(e);
    if(wasDragging && !moved && !arrangeIsOpen()) handlePick(e, canvasEl);
  });

  const rc=document.getElementById("resetCam"); if(rc) rc.onclick=()=>{ setDefaultOrbit(); refreshCamera(); sfx("tap"); };
  const tb=document.getElementById("themeBtn"); if(tb) tb.onclick=()=>toggleThemeAndSync();
  const mo=document.getElementById("motionBtn"); if(mo) mo.onclick=()=>toggleReduced();
  const mb=document.getElementById("musicBtn"); if(mb) mb.onclick=()=>toggleMusicAndSync();
  const sb=document.getElementById("settingsBtn"); if(sb) sb.onclick=()=>{ sfx("tap"); openSettings(); };
  const sh=document.getElementById("shopBtn"); if(sh) sh.onclick=()=>{ sfx("tap"); renderUpgradeShop(); };
  const skb=document.getElementById("stickerBtn"); if(skb) skb.onclick=()=>{ sfx("coin"); openStickerBook(); };
  const chip=document.getElementById("coinChip"); if(chip) chip.onclick=()=>{ sfx("tap"); renderUpgradeShop(); };
  const st=document.getElementById("setTheme"); if(st) st.onclick=()=>toggleThemeAndSync();
  const sm=document.getElementById("setMotion"); if(sm) sm.onclick=()=>toggleReduced();
  const su=document.getElementById("setMusic"); if(su) su.onclick=()=>toggleMusicAndSync();
  const sv=document.getElementById("setMusicVol"); if(sv) sv.oninput=()=>{ setMusicVol((+sv.value||0)/100); };
  const ss=document.getElementById("openShopSettings"); if(ss) ss.onclick=()=>{ sfx("tap"); closeSettings(); renderUpgradeShop(); };
  const sc=document.getElementById("setClose"); if(sc) sc.onclick=()=>{ sfx("tap"); closeSettings(); };
  const ov=document.getElementById("settings"); if(ov) ov.addEventListener("click",e=>{ if(e.target===ov) closeSettings(); });
  const shopOv=document.getElementById("shopOverlay"); if(shopOv) shopOv.addEventListener("click",e=>{ if(e.target===shopOv) closeUpgradeShop(); });
  const stickOv=document.getElementById("stickerOverlay"); if(stickOv) stickOv.addEventListener("click",e=>{ if(e.target===stickOv) closeStickerBook(); });
  const arrDone=document.getElementById("arrangeDone"); if(arrDone) arrDone.onclick=()=>{ sfx("tap"); arrangeStop(); };
  updateMusicBtn();

  const kick=()=>{ if(state==="idle") playLobby(); };
  addEventListener("pointerdown",kick);
  addEventListener("keydown",e=>{
    kick();
    if(e.key==="Escape"){
      if(stickerBookOpen()){ closeStickerBook(); }
      else if(arrangeIsOpen()) arrangeClose();
      else { const shop=document.getElementById("shopOverlay"); if(shop&&shop.classList.contains("show")) closeUpgradeShop(); else toggleSettings(); }
    }
  });
}

function handlePick(e, canvasEl){
  const hit = pickAt(e, canvasEl, scene);
  if(!hit) return;
  const { data, obj } = hit;
  const alwaysOn = data.pickType==="mascot" || data.pickType==="stickerbook" || data.pickType==="shop";
  if(!alwaysOn && !isInteractableNow(data.pickType, state)) return;
  if(data.pickType==="tube" && state==="select"){ onTubePicked(obj); return; }
  if(data.pickType==="patient"){ sfx("tap"); if(state==="arrive") flashPanel(); return; }
  if(data.pickType==="mascot"){ sfx("coin"); reactMascot("good"); toast(pickOne(DOT_LINES)); return; }
  if(data.pickType==="screen" && state==="review"){ sfx("tap"); flashPanel(); return; }
  if(data.pickType==="bin" && state==="handle"){ sfx("tap"); flashPanel(); return; }
  if(data.pickType==="shop"){ sfx("tap"); renderUpgradeShop(); return; }
  if(data.pickType==="stickerbook"){ sfx("coin"); confetti(14); openStickerBook(); return; }
}
function flashPanel(){ const p=document.getElementById("panel"); p.style.transform="scale(1.01)"; setTimeout(()=>p.style.transform="",120); }

let clock;
function animate(){
  requestAnimationFrame(animate);
  updateRoomWallVisibility();
  tickWallFade();
  if(arrangeIsOpen()){
    const grid=getArrangeGridGroup();
    if(grid){
      const th=orbit?orbit.theta:0;
      grid.children.forEach(c=>{ if(c.userData&&c.userData.wallGuide) c.visible = wallOpacityForSide(c.userData.wallSide,th) >= 0.45; });
    }
  }
  if(!clock) clock=new THREE.Clock();
  const t=clock.getElapsedTime();
  const dt=Math.min(0.05, t-(animate._last||t)); animate._last=t;
  tickCamTween(dt);
  const onMenu=(state==="idle"||state==="summary") && !arrangeIsOpen();
  const renderer=getRenderer();
  if(REDUCED){
    if(mascot){ mascot.visible=onMenu; mascot.rotation.set(0,0,0); mascot.scale.set(0.52,0.52,0.52); if(mascot.userData.eyes) mascot.userData.eyes.forEach(e=>e.scale.y=1); }
    if(patientGroup){patientGroup.position.y=0;patientGroup.rotation.y=0;const pb=patientGroup.userData.body||patientGroup.children[0];if(pb)pb.scale.y=1;}
    tubeMeshes.forEach(g=>{ g.scale.y=1; g.rotation.y=0; g.position.y=g.userData.baseY+(g.userData.selected?0.35:0); });
    renderer.render(scene,camera); return;
  }
  if(mascot){
    mascot.visible=onMenu;
    if(mascot.visible){
      const ud=mascot.userData;
      if(ud.ax===undefined){ ud.ax=mascot.position.x; ud.ay=mascot.position.y; ud.az=mascot.position.z; ud.spot=0; ud.pauseT=0.8; ud.face=0; }
      const DOT_SPOTS=[{x:-2.3,y:1.7,z:2.7},{x:0.0,y:2.1,z:1.5},{x:2.2,y:1.6,z:0.8},{x:1.1,y:1.9,z:-1.3},{x:-1.9,y:2.3,z:-0.9},{x:-0.4,y:1.5,z:3.3}];
      if(ud.pauseT>0){ ud.pauseT-=dt; }
      else {
        const tp=DOT_SPOTS[ud.spot%DOT_SPOTS.length];
        const dx=tp.x-ud.ax, dy=tp.y-ud.ay, dz=tp.z-ud.az, dist=Math.hypot(dx,dy,dz);
        if(dist<0.2){ ud.pauseT=1.0+Math.random()*1.8; ud.spot=(ud.spot+1)%DOT_SPOTS.length; }
        else { const sp=Math.min(1,dt*0.7); ud.ax+=dx*sp; ud.ay+=dy*sp; ud.az+=dz*sp; ud.face=Math.atan2(dx,dz); }
      }
      const bob=Math.sin(t*2)*0.07, sway=Math.sin(t*1.4)*0.03;
      mascot.position.set(ud.ax+sway, ud.ay+bob, ud.az);
      let df=((ud.face-mascot.rotation.y+Math.PI)%(2*Math.PI))-Math.PI; mascot.rotation.y+=df*0.06;
      mascot.rotation.z=Math.sin(t*1.6)*0.06;
      let s=0.52*(1+Math.sin(t*2.4)*0.035), r=mascotReact;
      mascot.scale.set(s*(1+0.20*r), s*(1-0.12*r), s*(1+0.20*r));
      if(r>0) mascot.position.y+=0.12*r;
      decayMascotReact();
      if(ud.eyes){ const blink=(Math.sin(t*1.6)>0.97)?0.12:1; ud.eyes.forEach(e=>e.scale.y=blink); }
      if(ud.arms){ ud.arms[0].position.y=-0.05+Math.sin(t*3)*0.03; ud.arms[1].position.y=-0.05-Math.sin(t*3)*0.03; }
    }
  }
  if(patientGroup){
    const pb=patientGroup.userData.body||patientGroup.children[0];
    if(pb) pb.scale.y=1+Math.sin(t*2.2)*0.025;
    patientGroup.position.y=Math.sin(t*1.6)*0.025;
    patientGroup.rotation.y=Math.sin(t*0.6)*0.05;
  }
  if(stickerBookGroup && stickerBookGroup.userData.bookStar){
    const star=stickerBookGroup.userData.bookStar;
    star.rotation.y=t*0.8;
    const tw=0.6+Math.abs(Math.sin(t*1.6))*0.5;
    if(star.material) star.material.emissiveIntensity=(DARK?0.5:0.22)*tw;
  }
  tubeMeshes.forEach(g=>{
    if(g.userData.selected){
      g.rotation.y+=0.05;
      g.position.y=g.userData.baseY+0.35+Math.sin(t*4+g.position.x)*0.05;
      g.scale.y=1;
    } else if(state==="select"){
      g.scale.y=1; g.rotation.y=0;
      g.position.y=g.userData.baseY+Math.max(0,Math.sin(t*3+g.position.x))*0.05;
    } else { g.scale.y=1; g.rotation.y=0; g.position.y=g.userData.baseY; }
  });
  renderer.render(scene,camera);
}

/* ========================================================================= */
/*  BOOT                                                                      */
/* ========================================================================= */
function boot(){
  if(window.__tinyVialsBooted) return;
  window.__tinyVialsBooted=true;
  try{ startThree(); }
  catch(e){ const m=document.getElementById("loadingMsg"); if(m) m.innerHTML='<span class="err">3D failed to start: '+(e.message||e)+'</span>'; return; }
  document.getElementById("loading").style.display="none";
  try{ if(!localStorage.getItem("phleb_shift_3d_v1") && prefersReduced()) SS.reduceMotion=true; }catch(e){}
  applyReducedFlag();
  syncTop();
  try{ initReactBits(); }catch(e){}
  try{ initLenis(); }catch(e){}
  try{ destroyVantaLoad(); }catch(e){}
  armAudioUnlock();
  go("idle");
}
function prefersReduced(){ try{return matchMedia("(prefers-reduced-motion: reduce)").matches;}catch(e){return false;} }
function applyReducedFlag(){
  const b=document.getElementById("motionBtn"); if(b)b.textContent=REDUCED?"🎬 Motion: off":"🎬 Motion: on";
  if(document.body) document.body.dataset.reduced=REDUCED?"on":"off";
}

try{ initVanta(); }catch(e){}
function scheduleBoot(){ setTimeout(boot,60); }
if(document.readyState==="complete") scheduleBoot();
else addEventListener("load",scheduleBoot);
let tinyBootTries=0;
const tinyBootPoll=setInterval(()=>{
  if(window.__tinyVialsBooted || tinyBootTries++>30){ clearInterval(tinyBootPoll); return; }
  boot();
},500);
