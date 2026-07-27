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
import { preloadModels } from "./rendering/modelRegistry.js";
import { registerSupplyModels, SUPPLY_MODEL_IDS } from "./venipuncture/staging/supplyModels.js";

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
import {
  isStagingActive, renderStaging,
  stagingPointerDown, stagingPointerMove, stagingPointerUp, stagingPointerCancel,
} from "./venipuncture/staging/stagingRuntime.js";
import {
  isTourniquetActive, renderTourniquet,
  tourniquetPointerDown, tourniquetPointerMove, tourniquetPointerUp, tourniquetPointerCancel,
} from "./venipuncture/tourniquet/tourniquetRuntime.js";
import {
  isPalpationActive, renderPalpation,
  palpationPointerDown, palpationPointerMove, palpationPointerUp, palpationPointerCancel,
} from "./venipuncture/palpation/palpationRuntime.js";

import { SS, DARK, REDUCED, state } from "./game/gameState.js";
import { sfx } from "./audio/audioManager.js";
import { updateMusicBtn, setMusicVol, playLobby, armAudioUnlock } from "./audio/audioManager.js";
import { toast, confetti } from "./ui/notifications.js";
import {
  openSettings, closeSettings, toggleSettings, toggleReduced, toggleThemeAndSync, toggleMusicAndSync,
  toggleHandedness, toggleAssistedSnapping,
  renderUpgradeShop, closeUpgradeShop, openStickerBook, closeStickerBook, stickerBookOpen
} from "./ui/settings.js";
import { go, onTubePicked, syncTop } from "./ui/panels.js";
import { initReactBits, initLenis, initVanta, destroyVantaLoad } from "./ui/dynamicEffects.js";

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

  // Warm the supply-cart models during the menu so the first staging step
  // opens instantly instead of building 23 objects on the frame it appears.
  registerSupplyModels();
  preloadModels(SUPPLY_MODEL_IDS).catch(()=>{});

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

  // Physical supply staging owns the canvas outright while it is running:
  // its own scene, its own camera, its own drag semantics. Orbit and arrange
  // are suppressed so a pick-up gesture can never be read as a camera drag.
  canvasEl.addEventListener("pointerdown", e=>{
    if(isStagingActive()){ stagingPointerDown(e, canvasEl); return; }
    if(isTourniquetActive()){ tourniquetPointerDown(e, canvasEl); return; }
    if(isPalpationActive()){ palpationPointerDown(e, canvasEl); return; }
    if(arrangeIsOpen() && arrangeDrag.tryGrab(e)) return;
    orbitControls.onPointerDown(e);
  });
  canvasEl.addEventListener("pointermove", e=>{
    if(isStagingActive()){ stagingPointerMove(e, canvasEl); return; }
    if(isTourniquetActive()){ tourniquetPointerMove(e, canvasEl); return; }
    if(isPalpationActive()){ palpationPointerMove(e, canvasEl); return; }
    if(arrangeDrag.onMove(e)) return;
    orbitControls.onPointerMove(e);
  });
  canvasEl.addEventListener("pointerup", e=>{
    if(isStagingActive()){ stagingPointerUp(e, canvasEl); return; }
    if(isTourniquetActive()){ tourniquetPointerUp(e, canvasEl); return; }
    if(isPalpationActive()){ palpationPointerUp(e, canvasEl); return; }
    if(arrangeDrag.onUp(e)) return;
    const wasDragging = orbitControls.dragState.dragging;
    const moved = orbitControls.dragState.moved;
    orbitControls.onPointerUp(e);
    if(wasDragging && !moved && !arrangeIsOpen()) handlePick(e, canvasEl);
  });
  canvasEl.addEventListener("pointercancel", e=>{
    if(isStagingActive()) stagingPointerCancel(e, canvasEl);
    else if(isTourniquetActive()) tourniquetPointerCancel(e, canvasEl);
    else if(isPalpationActive()) palpationPointerCancel(e, canvasEl);
  });

  const pt=document.getElementById("panelToggle"); if(pt) pt.onclick=()=>togglePanel();
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
  const sha=document.getElementById("setHand"); if(sha) sha.onclick=()=>toggleHandedness();
  const snp=document.getElementById("setSnap"); if(snp) snp.onclick=()=>toggleAssistedSnapping();
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

/* Collapses the coach panel so the 3D work area has the whole canvas. Session-
   only on purpose: a hidden panel persisted across launches reads as a broken
   game. The staging camera re-frames itself automatically, since it measures
   the panel's real bounding box. */
function togglePanel(){
  const hidden = document.body.dataset.panel === "hidden";
  if(hidden) delete document.body.dataset.panel;
  else document.body.dataset.panel = "hidden";
  const b = document.getElementById("panelToggle");
  if(b){
    b.textContent = hidden ? "🗔 Hide panel" : "🗔 Show panel";
    b.setAttribute("aria-expanded", hidden ? "true" : "false");
  }
  sfx("tap");
}

let clock;
function animate(){
  requestAnimationFrame(animate);
  if(!clock) clock=new THREE.Clock();
  const t=clock.getElapsedTime();
  const dt=Math.min(0.05, t-(animate._last||t)); animate._last=t;

  // While the learner is working a close-up — the supply cart, or the
  // patient's arm — the canvas shows that instead of the room. Same renderer,
  // different scene, so there is only ever one WebGL context.
  if(isStagingActive()){ renderStaging(getRenderer(), dt); return; }
  if(isTourniquetActive()){ renderTourniquet(getRenderer(), dt); return; }
  if(isPalpationActive()){ renderPalpation(getRenderer(), dt); return; }

  updateRoomWallVisibility();
  tickWallFade();
  if(arrangeIsOpen()){
    const grid=getArrangeGridGroup();
    if(grid){
      const th=orbit?orbit.theta:0;
      grid.children.forEach(c=>{ if(c.userData&&c.userData.wallGuide) c.visible = wallOpacityForSide(c.userData.wallSide,th) >= 0.45; });
    }
  }
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
  installTestSeam();
  go("idle");
}
/* ---------- test seam ------------------------------------------------------
   Opt-in via ?e2e=1 only. Playwright uses this to jump straight to a step
   with a fixed patient instead of clicking a 15-screen path whose content is
   randomised per run — the alternative is a flaky test that spends most of
   its time not testing the thing it is named after. Nothing here is reachable
   in normal play, and the flag is absent from every link the game itself
   renders. */
function installTestSeam(){
  let e2e = false;
  try{ e2e = new URLSearchParams(location.search).get("e2e")==="1"; }catch(_){}
  if(!e2e) return;
  window.__phlebTest = {
    /** Jumps into the venipuncture procedure at a given step id. */
    async gotoProcedureStep(stepId, tubes, mode){
      const [{ setEnc, SHIFT, setShift, setMode }, { makePatient }, { go }] = await Promise.all([
        import("./game/gameState.js"), import("./game/encounter.js"), import("./ui/panels.js"),
      ]);
      setMode(mode==="teach" ? "teach" : "play");
      setShift({ len:1, index:0, patients:[], ratings:[], orderAllOk:true, safetyAllOk:true, coins:0, startMs:Date.now(), patientTimes:[], missed:[] });
      const p = makePatient();
      const selected = tubes || ["lightblue","lavender"];
      setEnc({ p, selected, ordered:selected.slice(), idChoice:true, reqChoice:true, siteChoice:true,
        labelFields:{name:false,iddob:false,datetime:false,initials:false},
        handlingChoice:null, respondChoice:null, scores:{}, startedAt:Date.now() });
      p.site = null; p.drawEvent = null;
      // Pin the physique too. From Phase 1b the arm is real geometry built
      // from the patient's build, so a randomised one changes the limb's
      // radius — and with it where a wrap lands and how far a pull travels —
      // between runs. Fixing it here keeps a failure meaning "the mechanic
      // broke" rather than "a bigger patient got rolled".
      if(p.appearance){ p.appearance.width = 1; p.appearance.height = 1; }
      go("collect");
      const { ENC } = await import("./game/gameState.js");
      const idx = ENC.collect ? ENC.collect.steps.indexOf(stepId) : -1;
      if(idx > 0){ ENC.collect.step = idx; go("collect"); }
      return true;
    },
    async stagingSnapshot(){
      const { ENC } = await import("./game/gameState.js");
      const s = ENC && ENC.collect && ENC.collect.supplies;
      if(!s) return null;
      const { evaluateStaging } = await import("./venipuncture/staging/stagingRules.js");
      const r = evaluateStaging(s.state, s.catalog);
      return {
        ready: r.ready,
        blocking: r.issues.filter(i=>i.severity==="block").map(i=>i.code),
        zones: Object.fromEntries(Object.keys(s.state.items).map(k=>[k, s.state.items[k].zone])),
        positions: Object.fromEntries(Object.entries(s.state.items).filter(([,v])=>v.pos).map(([k,v])=>[k, v.pos])),
        handedness: s.state.handedness,
        catalog: s.catalog.map(d=>({ id:d.id, category:d.category, tubeKey:d.tubeKey, flaws:d.flaws })),
        requiredTubes: s.state.requiredTubes,
        trayOffset: s.state.trayOffset,
      };
    },
    async screenPointFor(itemId){
      const { getStagingContext } = await import("./venipuncture/staging/stagingRuntime.js");
      const ctx = getStagingContext();
      if(!ctx) return null;
      const mesh = ctx.view.itemMeshes.get(itemId);
      if(!mesh) return null;
      const THREE = await import("three");
      const v = new THREE.Vector3();
      mesh.getWorldPosition(v);
      v.project(ctx.view.camera);
      const canvas = document.querySelector("canvas");
      const r = canvas.getBoundingClientRect();
      return { x: r.left + (v.x*0.5+0.5)*r.width, y: r.top + (-v.y*0.5+0.5)*r.height };
    },
    /** The tourniquet's state and the arm's response, as the rules see them. */
    async tourniquetSnapshot(){
      const { ENC } = await import("./game/gameState.js");
      const s = ENC && ENC.collect && ENC.collect.tourniquet;
      if(!s) return null;
      const { getTourniquetContext } = await import("./venipuncture/tourniquet/tourniquetRuntime.js");
      const { evaluateTourniquet } = await import("./venipuncture/tourniquet/tourniquetRules.js");
      const ctx = getTourniquetContext();
      const arm = { vessels: ctx ? ctx.view.arm.vessels : [], vigour: s.vigour };
      const r = evaluateTourniquet(s, arm);
      return {
        phase: s.phase, wrap: s.wrap, tuck: s.tuck, tuckedUnder: s.tuckedUnder,
        bandX: s.bandX, skew: s.skew,
        tension: s.tension, heldTension: s.heldTension, peakTension: s.peakTension,
        attempts: s.attempts, restarts: s.restarts,
        ready: r.ready, distension: r.distension, pulse: r.pulse,
        seconds: r.seconds, heightAboveSite: r.heightAboveSite,
        blocking: r.blocking.map(i=>i.code),
        issues: r.issues.map(i=>i.code),
        armDistension: ctx ? ctx.view.arm.distension : null,
      };
    },
    /**
     * The strap end's exact cylindrical angle right now — see armScene.js's
     * pointerToLimb doc: this is the same exact reading tourniquetRuntime.js
     * seeds a drag with, so a test can start a sweep continuously from where
     * the pointer actually grabbed the object instead of jumping to an
     * arbitrary angle on the first move.
     */
    async strapEndTheta(index){
      const { getTourniquetContext } = await import("./venipuncture/tourniquet/tourniquetRuntime.js");
      const ctx = getTourniquetContext();
      if(!ctx) return null;
      const end = ctx.strap.ends[index];
      if(!end) return null;
      return Math.atan2(end.position.z, end.position.y - ctx.view.ARM_Y);
    },
    /**
     * Where a strap end actually is on screen right now — needed because a
     * LOOSE tourniquet sits coiled on the bench, not on the arm's cylinder, so
     * a test cannot compute a pick point for it from cylindrical coordinates
     * the way it can once the band is routed.
     */
    async screenPointForStrapEnd(index){
      const { getTourniquetContext } = await import("./venipuncture/tourniquet/tourniquetRuntime.js");
      const ctx = getTourniquetContext();
      if(!ctx) return null;
      const end = ctx.strap.ends[index];
      if(!end) return null;
      const p = end.position.clone();
      p.project(ctx.view.camera);
      const canvas = document.querySelector("canvas");
      const rect = canvas.getBoundingClientRect();
      return { x: rect.left + (p.x*0.5+0.5)*rect.width, y: rect.top + (-p.y*0.5+0.5)*rect.height };
    },
    /**
     * Projects a point in the arm's own cylindrical coordinates to the screen,
     * so a test can drive the wrap gesture in the same terms the runtime
     * measures it: where along the arm, how far round it, how far off it.
     */
    /**
     * Batched form of screenPointOnLimb. A wrap gesture is driven at the
     * resolution a real continuous drag has (~90 samples); asking for those
     * one per round trip costs more than the whole test budget, so the points
     * are computed in a single call and replayed locally.
     * @param {Array<[number,number,number]>} list  [x, theta, r] triples
     */
    async screenPointsOnLimb(list){
      const { getTourniquetContext } = await import("./venipuncture/tourniquet/tourniquetRuntime.js");
      const ctx = getTourniquetContext();
      if(!ctx) return null;
      const canvas = document.querySelector("canvas");
      const rect = canvas.getBoundingClientRect();
      return list.map(([x, theta, r])=>{
        const p = ctx.view.limbToWorld(x, theta, r);
        p.project(ctx.view.camera);
        return { x: rect.left + (p.x*0.5+0.5)*rect.width, y: rect.top + (-p.y*0.5+0.5)*rect.height };
      });
    },
    async screenPointOnLimb(x, theta, r){
      const { getTourniquetContext } = await import("./venipuncture/tourniquet/tourniquetRuntime.js");
      const ctx = getTourniquetContext();
      if(!ctx) return null;
      const p = ctx.view.limbToWorld(x, theta, r);
      p.project(ctx.view.camera);
      const canvas = document.querySelector("canvas");
      const rect = canvas.getBoundingClientRect();
      return { x: rect.left + (p.x*0.5+0.5)*rect.width, y: rect.top + (-p.y*0.5+0.5)*rect.height };
    },
    /**
     * The exact radius the wrap gesture is measured against. A test has to
     * drive the pointer at this radius, not the bare limb radius, or the
     * offset saturates at the silhouette and the sweep is never recovered.
     */
    async limbRadiusAt(x){
      const { trackRadiusAt } = await import("./venipuncture/tourniquet/tourniquetRuntime.js");
      return trackRadiusAt(x);
    },
    /** The fingers' record and what they are finding right now. */
    async palpationSnapshot(){
      const { ENC } = await import("./game/gameState.js");
      const s = ENC && ENC.collect && ENC.collect.palpation;
      if(!s) return null;
      const { getPalpationContext, currentTouch } = await import("./venipuncture/palpation/palpationRuntime.js");
      const { evaluatePalpation } = await import("./venipuncture/palpation/palpationRules.js");
      const ctx = getPalpationContext();
      // The controls path stops the 3D scene, but the arm is still the arm —
      // the procedure state carries its vessels so the rules can be asked
      // about it either way.
      const vessels = ctx ? ctx.view.arm.vessels : (ENC.collect.armVessels || []);
      const r = evaluatePalpation(s, vessels);
      const t = ctx ? currentTouch() : null;
      return {
        felt: Object.keys(s.felt), chosenId: s.chosenId, mark: s.mark,
        everPressed: s.everPressed, peakPress: s.peakPress,
        arteryPressed: s.arteryPressed, arteryRecognised: s.arteryRecognised,
        nerveHurt: s.nerveHurt,
        ready: r.ready, ideal: r.ideal,
        blocking: r.blocking.map(i=>i.code), issues: r.issues.map(i=>i.code),
        feel: t ? t.feel : null, press: t ? t.press : 0,
        touching: t ? t.vesselId : null,
        finger: ctx && ctx.finderPos ? { x:ctx.finderPos.x, z:ctx.finderPos.z, theta:ctx.finderPos.theta } : null,
      };
    },
    /** Where a vessel actually is, to compare against where the finger landed. */
    async vesselMidpoint(id){
      const { getPalpationContext } = await import("./venipuncture/palpation/palpationRuntime.js");
      const ctx = getPalpationContext();
      if(!ctx) return null;
      const v = ctx.view.arm.vessels.find(x=>x.id === id);
      if(!v) return null;
      const m = v.path[Math.floor(v.path.length/2)];
      return { x:m.x, z:m.z, calibre:v.calibre, depth:v.depth };
    },
    /** Screen point over the middle of a named vessel, for driving a finger. */
    async screenPointOverVessel(id){
      const { getPalpationContext } = await import("./venipuncture/palpation/palpationRuntime.js");
      const ctx = getPalpationContext();
      if(!ctx) return null;
      const v = ctx.view.arm.vessels.find(x=>x.id === id);
      if(!v) return null;
      const m = v.path[Math.floor(v.path.length/2)];
      const r = ctx.view.arm.radiusAt(m.x);
      const theta = Math.asin(Math.max(-1, Math.min(1, m.z/r)));
      const p = ctx.view.limbToWorld(m.x, theta, r);
      p.project(ctx.view.camera);
      const canvas = document.querySelector("canvas");
      const rect = canvas.getBoundingClientRect();
      return { x: rect.left + (p.x*0.5+0.5)*rect.width, y: rect.top + (-p.y*0.5+0.5)*rect.height };
    },
    async screenPointForZone(zone){
      const { getStagingContext } = await import("./venipuncture/staging/stagingRuntime.js");
      const ctx = getStagingContext();
      if(!ctx) return null;
      const target = zone==="rack0"
        ? (await import("./venipuncture/staging/stagingLayout.js")).rackSlotPosition(ctx.layout, 0, ctx.requiredTubes.length)
        : { x: ctx.layout[zone].cx, z: ctx.layout[zone].cz };
      const THREE = await import("three");
      // project on the drop plane itself (y=0); a point above it maps to a
      // different world position once the ray is cast back down
      const v = new THREE.Vector3(target.x, 0, target.z);
      v.project(ctx.view.camera);
      const canvas = document.querySelector("canvas");
      const r = canvas.getBoundingClientRect();
      return { x: r.left + (v.x*0.5+0.5)*r.width, y: r.top + (-v.y*0.5+0.5)*r.height };
    },
  };
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
