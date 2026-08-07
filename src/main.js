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
import {
  isCleaningActive, renderCleaning,
  cleaningPointerDown, cleaningPointerMove, cleaningPointerUp, cleaningPointerCancel,
} from "./venipuncture/cleaning/cleaningRuntime.js";
import {
  isAssemblyActive, renderAssembly,
  assemblyPointerDown, assemblyPointerMove, assemblyPointerUp, assemblyPointerCancel,
} from "./venipuncture/assembly/assemblyRuntime.js";
import {
  isInsertActive, renderInsert,
  insertPointerDown, insertPointerMove, insertPointerUp, insertPointerCancel,
} from "./venipuncture/insert/insertRuntime.js";
import {
  isCollectionActive, renderCollection,
  collectionPointerDown, collectionPointerMove, collectionPointerUp, collectionPointerCancel,
} from "./venipuncture/collection/collectionRuntime.js";
import {
  isWithdrawalActive, renderWithdrawal,
  withdrawalPointerDown, withdrawalPointerMove, withdrawalPointerUp, withdrawalPointerCancel,
} from "./venipuncture/withdrawal/withdrawalRuntime.js";
import {
  isPostDrawActive, renderPostDraw,
  postDrawPointerDown, postDrawPointerMove, postDrawPointerUp, postDrawPointerCancel,
} from "./venipuncture/postdraw/postDrawRuntime.js";
import {
  isInversionActive, renderInversion,
  inversionPointerDown, inversionPointerMove, inversionPointerUp, inversionPointerCancel,
} from "./venipuncture/inversion/inversionRuntime.js";
// The one branch that is not a step: it runs across all of them, ticked here
// because the composition root owns the frame. See complicationRuntime.js.
import { tickComplications } from "./venipuncture/complications/complicationRuntime.js";

import { SS, DARK, REDUCED, state } from "./game/gameState.js";
import { sfx } from "./audio/audioManager.js";
import { updateMusicBtn, setMusicVol, playLobby, armAudioUnlock } from "./audio/audioManager.js";
import { toast, confetti } from "./ui/notifications.js";
import {
  openSettings, closeSettings, toggleSettings, toggleReduced, toggleThemeAndSync, toggleMusicAndSync,
  toggleHandedness, toggleAssistedSnapping,
  renderUpgradeShop, closeUpgradeShop, openStickerBook, closeStickerBook, stickerBookOpen
} from "./ui/settings.js";
import { go, syncTop } from "./ui/panels.js";
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
    if(isCleaningActive()){ cleaningPointerDown(e, canvasEl); return; }
    if(isAssemblyActive()){ assemblyPointerDown(e, canvasEl); return; }
    if(isInsertActive()){ insertPointerDown(e, canvasEl); return; }
    if(isCollectionActive()){ collectionPointerDown(e, canvasEl); return; }
    if(isWithdrawalActive()){ withdrawalPointerDown(e, canvasEl); return; }
    if(isPostDrawActive()){ postDrawPointerDown(e, canvasEl); return; }
    if(isInversionActive()){ inversionPointerDown(e, canvasEl); return; }
    if(arrangeIsOpen() && arrangeDrag.tryGrab(e)) return;
    orbitControls.onPointerDown(e);
  });
  canvasEl.addEventListener("pointermove", e=>{
    if(isStagingActive()){ stagingPointerMove(e, canvasEl); return; }
    if(isTourniquetActive()){ tourniquetPointerMove(e, canvasEl); return; }
    if(isPalpationActive()){ palpationPointerMove(e, canvasEl); return; }
    if(isCleaningActive()){ cleaningPointerMove(e, canvasEl); return; }
    if(isAssemblyActive()){ assemblyPointerMove(e, canvasEl); return; }
    if(isInsertActive()){ insertPointerMove(e, canvasEl); return; }
    if(isCollectionActive()){ collectionPointerMove(e, canvasEl); return; }
    if(isWithdrawalActive()){ withdrawalPointerMove(e, canvasEl); return; }
    if(isPostDrawActive()){ postDrawPointerMove(e, canvasEl); return; }
    if(isInversionActive()){ inversionPointerMove(e, canvasEl); return; }
    if(arrangeDrag.onMove(e)) return;
    orbitControls.onPointerMove(e);
  });
  canvasEl.addEventListener("pointerup", e=>{
    if(isStagingActive()){ stagingPointerUp(e, canvasEl); return; }
    if(isTourniquetActive()){ tourniquetPointerUp(e, canvasEl); return; }
    if(isPalpationActive()){ palpationPointerUp(e, canvasEl); return; }
    if(isCleaningActive()){ cleaningPointerUp(e, canvasEl); return; }
    if(isAssemblyActive()){ assemblyPointerUp(e, canvasEl); return; }
    if(isInsertActive()){ insertPointerUp(e, canvasEl); return; }
    if(isCollectionActive()){ collectionPointerUp(e, canvasEl); return; }
    if(isWithdrawalActive()){ withdrawalPointerUp(e, canvasEl); return; }
    if(isPostDrawActive()){ postDrawPointerUp(e, canvasEl); return; }
    if(isInversionActive()){ inversionPointerUp(e, canvasEl); return; }
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
    else if(isCleaningActive()) cleaningPointerCancel(e, canvasEl);
    else if(isAssemblyActive()) assemblyPointerCancel(e, canvasEl);
    else if(isInsertActive()) insertPointerCancel(e, canvasEl);
    else if(isCollectionActive()) collectionPointerCancel(e, canvasEl);
    else if(isWithdrawalActive()) withdrawalPointerCancel(e, canvasEl);
    else if(isPostDrawActive()) postDrawPointerCancel(e, canvasEl);
    else if(isInversionActive()) inversionPointerCancel(e, canvasEl);
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
  if(data.pickType==="patient"){ sfx("tap"); if(state==="review") flashPanel(); return; }
  if(data.pickType==="mascot"){ sfx("coin"); reactMascot("good"); toast(pickOne(DOT_LINES)); return; }
  if(data.pickType==="screen" && state==="review"){ sfx("tap"); flashPanel(); return; }
  if(data.pickType==="bin" && state==="label"){ sfx("tap"); flashPanel(); return; }
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

  // The patient's body carries on regardless of which screen is up, so the
  // complication watch is ticked before any of the early returns below.
  tickComplications(dt);

  // While the learner is working a close-up — the supply cart, or the
  // patient's arm — the canvas shows that instead of the room. Same renderer,
  // different scene, so there is only ever one WebGL context.
  if(isStagingActive()){ renderStaging(getRenderer(), dt); return; }
  if(isTourniquetActive()){ renderTourniquet(getRenderer(), dt); return; }
  if(isPalpationActive()){ renderPalpation(getRenderer(), dt); return; }
  if(isCleaningActive()){ renderCleaning(getRenderer(), dt); return; }
  if(isAssemblyActive()){ renderAssembly(getRenderer(), dt); return; }
  if(isInsertActive()){ renderInsert(getRenderer(), dt); return; }
  if(isCollectionActive()){ renderCollection(getRenderer(), dt); return; }
  if(isWithdrawalActive()){ renderWithdrawal(getRenderer(), dt); return; }
  if(isPostDrawActive()){ renderPostDraw(getRenderer(), dt); return; }
  if(isInversionActive()){ renderInversion(getRenderer(), dt); return; }

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
    /**
     * @param {string} stepId
     * @param {string[]} [tubes]
     * @param {string} [mode]
     * @param {string} [procedureId]  "straight-antecubital" (default, matches
     *   normal play's own indicatedProcedure() roll) or "butterfly-hand" — a
     *   forced override, because a real patient only rolls the winged-set
     *   draw for specific arm conditions, and a test needs it on demand.
     */
    async gotoProcedureStep(stepId, tubes, mode, procedureId){
      const [{ setEnc, SS, setMode }, { makePatient }, { go }, { createProcedureState }] = await Promise.all([
        import("./game/gameState.js"), import("./game/encounter.js"), import("./ui/panels.js"),
        import("./venipuncture/accessibilityFallback.js"),
      ]);
      // setMode normalises: "teach"/"play" are the legacy names, and
      // "learn"/"practice"/"final" the three the game now has.
      setMode(mode);
      const { setShift } = await import("./game/gameState.js");
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
      const { ENC } = await import("./game/gameState.js");
      if(procedureId){
        // Built directly, with the override already on it, rather than
        // letting renderCollect() build the default one on first render —
        // ensureArmSession() reads `forcedProcedure` the first time ANY step
        // runs, which is before this function would get a second chance.
        ENC.collect = createProcedureState(selected, { patient: p, handedness: SS.handedness, forcedProcedure: procedureId });
      }
      go("collect");
      const idx = ENC.collect ? ENC.collect.steps.indexOf(stepId) : -1;
      if(idx > 0){ ENC.collect.step = idx; go("collect"); }
      return true;
    },
    /**
     * Pins the patient's clinical history. The history is rolled at random
     * per patient, which is right for play and wrong for a test that has to
     * assert what an allergy does — this is the same reason the seam already
     * pins the patient's build.
     */
    async setPatientHistory(history){
      const { ENC } = await import("./game/gameState.js");
      if(!ENC || !ENC.p) return false;
      ENC.p.history = Object.assign({ latexAllergy:false, adhesiveAllergy:false, faintHistory:false }, history || {});
      const s = ENC.collect && ENC.collect.introduction;
      if(s) s.patient = ENC.p;
      return true;
    },
    /* ---------------------------------------------------------------------
       COMPLICATIONS. The watcher is the one branch with no screen of its own,
       so the seam exposes what it is watching, lets a test start one without
       having to physically produce it first, and reports what the arm looks
       like as a result — which is the only way to assert that a consequence
       reached the 3D limb rather than only the report.
       --------------------------------------------------------------------- */
    async complicationSnapshot(){
      const { ENC } = await import("./game/gameState.js");
      const c = ENC && ENC.collect;
      const s = c && c.complications;
      if(!s) return null;
      const { evaluateComplications } = await import("./venipuncture/complications/complicationRules.js");
      const { measureComplications } = await import("./venipuncture/complications/complicationScoring.js");
      const r = evaluateComplications(s);
      const m = measureComplications(s);
      return {
        active: s.order.slice(),
        resolved: s.resolved.slice(),
        condition: Object.assign({}, s.condition),
        fainted: s.fainted,
        harm: Math.round(s.harm*100)/100,
        halted: c.complicationHalt ? c.complicationHalt.id : null,
        pending: r.pending.map(p=>p.id),
        measurements: { total: m.total, managedCount: m.managedCount,
          worsenedCount: m.worsenedCount, missedCount: m.missedCount,
          hematomaMl: m.hematomaMl, score: m.score },
        // whether the arm on screen is actually showing it
        armShowsBruise: !!(window.__phlebArm && window.__phlebArm.bruise
          && window.__phlebArm.bruise.group.visible),
      };
    },
    /** Starts one deliberately, so a test can assert the response, not the cause. */
    async triggerComplication(id){
      const { ENC } = await import("./game/gameState.js");
      const s = ENC && ENC.collect && ENC.collect.complications;
      if(!s) return false;
      const { onset } = await import("./venipuncture/complications/complicationState.js");
      onset(s, id, null, Date.now());
      return true;
    },
    /** The tubes as the laboratory receives them. */
    async specimenSnapshot(){
      const { ENC } = await import("./game/gameState.js");
      const c = ENC && ENC.collect;
      if(!c) return null;
      const { assessSpecimens } = await import("./venipuncture/specimen/specimenQuality.js");
      const q = c.specimenQuality || assessSpecimens(c, { orders: ENC.p ? ENC.p.orders : [] });
      return {
        score: q.score, total: q.total, accepted: q.acceptedCount,
        flagged: q.flaggedCount, rejected: q.rejectedCount,
        redrawRequired: q.redrawRequired, lostTests: q.lostTests,
        tubes: q.tubes.map(t=>({ key:t.key, verdict:t.verdict, fill:t.fillFraction, why:t.headline })),
      };
    },

    /** Which procedure the current draw actually is, and the arm it built. */
    async procedureSnapshot(){
      const { ENC } = await import("./game/gameState.js");
      const c = ENC && ENC.collect;
      if(!c || !c.procedure) return null;
      return {
        procedureId: c.procedureId, device: c.procedure.device, siteKind: c.procedure.siteKind,
        gauge: c.procedure.gauge, angle: c.procedure.angle,
        armVessels: (c.armVessels || []).map(v => v.id),
      };
    },
    /** The winged set as the rules see it, once the butterfly draw has one. */
    async butterflySnapshot(){
      const { ENC } = await import("./game/gameState.js");
      const bf = ENC && ENC.collect && ENC.collect.butterfly;
      if(!bf) return null;
      const { evaluateButterfly } = await import("./venipuncture/butterfly/butterflyRules.js");
      const r = evaluateButterfly(bf, {});
      return {
        wingsHeld: bf.wingsHeld, wings: bf.wings, secured: bf.secured,
        entered: bf.entered, entryAngleDeg: bf.entryAngleDeg,
        tubingSlackM: bf.tubing.slackM, tipOffsetMm: Math.round(bf.tipOffsetM*10000)/10,
        infiltratedMl: Math.round(bf.infiltratedMl*100)/100,
        infiltrationNoticed: bf.infiltrationNoticed, stoppedOnInfiltration: bf.stoppedOnInfiltration,
        ready: r.ready, blocking: r.blocking.map(i => i.code), issues: r.issues.map(i => i.code),
      };
    },
    /** The introduction as the rules see it: who has been identified, how. */
    async introductionSnapshot(){
      const { ENC } = await import("./game/gameState.js");
      const s = ENC && ENC.collect && ENC.collect.introduction;
      if(!s) return null;
      const { evaluateIntroduction, identifiersObtained } =
        await import("./venipuncture/introduction/introductionRules.js");
      const r = evaluateIntroduction(s);
      return {
        greeted: s.greeted,
        identifiers: identifiersObtained(s),
        leadingAsks: s.leadingAsks,
        orderConfirmed: s.orderConfirmed, explained: s.explained,
        asked: { allergies: s.asked.allergies, fainting: s.asked.fainting },
        positioned: s.positioned,
        hygieneSeconds: Math.round(s.hygieneSeconds*10)/10,
        dryingSeconds: Math.round(s.dryingSeconds*10)/10,
        gloved: s.gloved, gloveMaterial: s.gloveMaterial,
        gloveContaminated: s.gloveContaminated,
        transcript: s.transcript.map(t=>({ act:t.act, reply:t.reply })),
        history: (s.patient && s.patient.history) || {},
        ready: r.ready,
        blocking: r.blocking.map(i=>i.code),
        issues: r.issues.map(i=>i.code),
      };
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
      const site = ENC.collect.arm && ENC.collect.arm.site;
      const arm = { vessels: ctx ? ctx.view.arm.vessels : (ENC.collect.armVessels || []), vigour: s.vigour, site };
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
    /** The prep field's state, as the rules see it. */
    async cleaningSnapshot(){
      const { ENC } = await import("./game/gameState.js");
      const st = ENC && ENC.collect && ENC.collect.cleaning;
      if(!st) return null;
      const { evaluateCleaning } = await import("./venipuncture/cleaning/cleaningRules.js");
      const r = evaluateCleaning(st);
      return {
        swabOpen: st.swabOpen, strokes: st.strokes, lightStrokes: st.lightStrokes,
        coverage: r.coverage, outward: r.outward,
        dryness: r.dryness, seconds: r.secondsDrying,
        retouched: st.retouchedAfterClean,
        ready: r.ready,
        blocking: r.blocking.map(i=>i.code), issues: r.issues.map(i=>i.code),
      };
    },
    /** Screen point at an offset from the puncture point, in metres. */
    async screenPointOnField(dx, dz){
      const { getCleaningContext } = await import("./venipuncture/cleaning/cleaningRuntime.js");
      const ctx = getCleaningContext();
      if(!ctx) return null;
      const x = ctx.site.x + dx, z = ctx.site.z + dz;
      const r = ctx.view.arm.radiusAt(x);
      const theta = Math.asin(Math.max(-1, Math.min(1, z/r)));
      const p = ctx.view.limbToWorld(x, theta, r);
      p.project(ctx.view.camera);
      const canvas = document.querySelector("canvas");
      const rect = canvas.getBoundingClientRect();
      return { x: rect.left + (p.x*0.5+0.5)*rect.width, y: rect.top + (-p.y*0.5+0.5)*rect.height };
    },
    /**
     * Skips the drying wait. Tests only — never reachable in play.
     * Works on the procedure state rather than the runtime, because the
     * controls path stops the scene and the clock still has to be skippable.
     */
    async fastForwardDrying(seconds){
      const { ENC } = await import("./game/gameState.js");
      const st = ENC && ENC.collect && ENC.collect.cleaning;
      if(!st || !st.lastStrokeAt) return null;
      st.lastStrokeAt -= (seconds || 0)*1000;
      return true;
    },
    /** The needle + holder unit, as the rules see it. */
    async assemblySnapshot(){
      const { ENC } = await import("./game/gameState.js");
      const s = ENC && ENC.collect && ENC.collect.needleUnit;
      if(!s) return null;
      const { evaluateAssembly, evaluateUncap, bevelFromTurns } = await import("./venipuncture/assembly/assemblyRules.js");
      const { getAssemblyContext } = await import("./venipuncture/assembly/assemblyRuntime.js");
      const ctx = getAssemblyContext();
      const mode = ctx ? ctx.mode : "assemble";
      const r = mode === "uncap" ? evaluateUncap(s) : evaluateAssembly(s);
      return {
        mode,
        peel: s.peel, pouchOpen: s.pouchOpen, pouchTorn: s.pouchTorn,
        needleInHand: s.needleInHand, contaminated: s.contaminated, contaminatedBy: s.contaminatedBy,
        engaged: s.engaged, engageMisalignDeg: s.engageMisalignDeg, crossThreaded: s.crossThreaded,
        turns: s.turns, reverseTurns: s.reverseTurns, needlesUsed: s.needlesUsed, gauge: s.gauge,
        capOn: s.capOn, capAxialFraction: s.capAxialFraction, maxLateral: s.maxLateral,
        needleDamaged: s.needleDamaged, needleContaminated: s.needleContaminated,
        recapped: s.recapped, capPlacedOn: s.capPlacedOn,
        bevelDeg: s.bevelDeg == null ? bevelFromTurns(s.turns) : s.bevelDeg,
        bevelInspected: s.bevelInspected, warned: !!s.warnedAt,
        ready: r.ready,
        blocking: r.blocking.map(i=>i.code), issues: r.issues.map(i=>i.code),
      };
    },
    /**
     * The bench objects' real positions, in the metres the runtime measures
     * in. A test drives the assembly the way a hand does — from the pouch's
     * seam to the holder's hub — so it needs those two places, not pixels it
     * guessed at.
     */
    async benchAnchors(){
      const { getAssemblyContext } = await import("./venipuncture/assembly/assemblyRuntime.js");
      const ctx = getAssemblyContext();
      if(!ctx) return null;
      const n = ctx.needle.group.position;
      return {
        benchY: ctx.benchY,
        pouch: ctx.anchors.pouch,
        seam: ctx.anchors.seam,
        hub: ctx.anchors.hub,
        holder: ctx.anchors.holder,
        pad: ctx.anchors.pad,
        tipDx: ctx.anchors.tipDx,
        engageRadius: ctx.anchors.engageRadius,
        site: { x: ctx.site.x, z: ctx.site.z },
        needle: { x: n.x, z: n.z },
        capGrip: { x: n.x - 0.011, z: n.z },
      };
    },
    /** Batched bench-plane points, for driving a continuous drag. */
    async screenPointsOnBench(list){
      const { getAssemblyContext } = await import("./venipuncture/assembly/assemblyRuntime.js");
      const ctx = getAssemblyContext();
      if(!ctx) return null;
      const THREE = await import("three");
      const canvas = document.querySelector("canvas");
      const rect = canvas.getBoundingClientRect();
      return list.map(([x, z])=>{
        const v = new THREE.Vector3(x, ctx.benchY + 0.006, z);
        v.project(ctx.view.camera);
        return { x: rect.left + (v.x*0.5+0.5)*rect.width, y: rect.top + (-v.y*0.5+0.5)*rect.height };
      });
    },
    /**
     * Where the holder's hub is ON SCREEN. Threading is measured as the
     * pointer's angle about this point (see assemblyRuntime), so a test has to
     * circle this exact centre — computing one from the bench plane would be
     * measuring a different thing.
     */
    async hubScreenPoint(){
      const { getAssemblyContext } = await import("./venipuncture/assembly/assemblyRuntime.js");
      const ctx = getAssemblyContext();
      if(!ctx) return null;
      const THREE = await import("three");
      const v = new THREE.Vector3(ctx.anchors.hub.x, ctx.anchors.hub.y, ctx.anchors.hub.z);
      v.project(ctx.view.camera);
      const canvas = document.querySelector("canvas");
      const rect = canvas.getBoundingClientRect();
      return { x: rect.left + (v.x*0.5+0.5)*rect.width, y: rect.top + (-v.y*0.5+0.5)*rect.height };
    },
    /** The anchor, the stick, and the arm's own verdict on both. */
    async insertSnapshot(){
      const { ENC } = await import("./game/gameState.js");
      const s = ENC && ENC.collect && ENC.collect.insert;
      if(!s) return null;
      const { evaluateInsert, ANGLE_IDEAL, BEVEL_TOLERANCE_DEG } = await import("./venipuncture/insert/insertRules.js");
      const { bevelFromTurns } = await import("./venipuncture/assembly/assemblyRules.js");
      const unit = ENC.collect.needleUnit;
      const bevelDeg = unit ? (unit.bevelDeg == null ? bevelFromTurns(unit.turns) : unit.bevelDeg) : null;
      const vessels = ENC.collect.armVessels || [];
      const procedure = ENC.collect.procedure;
      const r = evaluateInsert(s, vessels, bevelDeg, procedure && procedure.angle, procedure && procedure.anchor);
      return {
        chosenId: s.chosenId, markX: s.markX, markZ: s.markZ,
        anchorSet: s.anchorSet, anchorX: s.anchorX, anchorPull: s.anchorPull,
        anchorOffset: r.anchorOffset,
        entryX: s.entryX, entryZ: s.entryZ, angleDeg: s.angleDeg,
        depthM: s.depthM, peakDepthM: s.peakDepthM,
        vesselDepthM: r.chosen ? r.chosen.depth : null,
        vesselCalibreM: r.chosen ? r.chosen.calibre : null,
        reapproaches: s.reapproaches, withdrawnBeforeFlash: s.withdrawnBeforeFlash,
        flashAt: s.flashAt, bevelDeg,
        inVein: r.inVein, through: r.through, ready: r.ready,
        blocking: r.blocking.map(i=>i.code), issues: r.issues.map(i=>i.code),
        angleIdeal: (procedure && procedure.angle && procedure.angle.ideal) || ANGLE_IDEAL,
        bevelToleranceDeg: BEVEL_TOLERANCE_DEG,
      };
    },
    /**
     * Forces the inherited needle unit's bevel angle — tests only, for
     * exercising the case where uncap never got rolled up before insert
     * inherits it. Never reachable in play.
     */
    async setNeedleBevelDeg(deg){
      const { ENC } = await import("./game/gameState.js");
      if(!ENC || !ENC.collect || !ENC.collect.needleUnit) return false;
      ENC.collect.needleUnit.bevelDeg = deg;
      return true;
    },
    /** The runtime's own live gesture state — diagnostic, mid-drag only. */
    async insertDebug(){
      const { getInsertContext } = await import("./venipuncture/insert/insertRuntime.js");
      const ctx = getInsertContext();
      if(!ctx) return null;
      return {
        phase: ctx.phase, down: ctx.down,
        approachBasis: ctx.approachBasis, angleEMA: ctx.angleEMA, depthDir: ctx.depthDir,
        lastAlong: ctx.lastAlong,
      };
    },
    /** The real geometry a test needs to drive the anchor and the stick. */
    async insertAnchors(){
      const { getInsertContext, READY_DISTAL, READY_HEIGHT } = await import("./venipuncture/insert/insertRuntime.js");
      const ctx = getInsertContext();
      if(!ctx) return null;
      return {
        markX: ctx.state.markX, markZ: ctx.state.markZ,
        chosenId: ctx.state.chosenId,
        theta0: Math.asin(Math.max(-1, Math.min(1,
          ctx.state.markZ/ctx.view.arm.radiusAt(ctx.state.markX)))),
        readyDistal: READY_DISTAL, readyHeight: READY_HEIGHT,
      };
    },
    /** The limb's real radius at a position, for computing an approach path. */
    async insertLimbRadiusAt(x){
      const { getInsertContext } = await import("./venipuncture/insert/insertRuntime.js");
      const ctx = getInsertContext();
      if(!ctx) return null;
      return ctx.view.arm.radiusAt(x);
    },
    /**
     * Batched cylindrical points (x, theta, r) → screen pixels on the insert
     * scene, for driving the anchor pull and the needle's approach as one
     * continuous gesture at the resolution a real drag has.
     */
    async screenPointsOnInsertLimb(list){
      const { getInsertContext } = await import("./venipuncture/insert/insertRuntime.js");
      const ctx = getInsertContext();
      if(!ctx) return null;
      const canvas = document.querySelector("canvas");
      const rect = canvas.getBoundingClientRect();
      return list.map(([x, theta, r])=>{
        const p = ctx.view.limbToWorld(x, theta, r);
        p.project(ctx.view.camera);
        return { x: rect.left + (p.x*0.5+0.5)*rect.width, y: rect.top + (-p.y*0.5+0.5)*rect.height };
      });
    },
    /** Every tube's real volume, ratio and state, plus the arm's verdict. */
    async collectionSnapshot(){
      const { ENC } = await import("./game/gameState.js");
      const s = ENC && ENC.collect && ENC.collect.collection;
      if(!s) return null;
      const { evaluateCollection, requiredFraction, lumenToleranceM } =
        await import("./venipuncture/collection/collectionRules.js");
      const tq = ENC.collect.tourniquet;
      const r = evaluateCollection(s, {
        vessel: s.vessel,
        inVein: s.inVein && !s.needleOut,
        tourniquetOn: !!(tq && tq.securedAt && !tq.releasedAt),
      });
      return {
        order: s.order.slice(),
        takenSequence: s.takenSequence.slice(),
        currentKey: s.currentKey,
        seatDepth: s.seatDepth,
        grip: s.grip,
        inVein: s.inVein,
        needleOut: s.needleOut,
        needleShiftM: s.needleShiftM,
        peakShiftM: s.peakShiftM,
        needleDeeperM: s.needleDeeperM,
        needleLateralM: s.needleLateralM,
        lumenToleranceM: lumenToleranceM(s.vessel),
        tubesWasted: s.tubesWasted,
        reseats: s.reseats,
        tubes: s.order.map(k=>{
          const t = s.tubes[k];
          return {
            key: k,
            taken: !!t,
            pierced: !!(t && t.pierced),
            removed: !!(t && t.removedAt),
            deadOnAir: !!(t && t.deadOnAir),
            collapsed: !!(t && t.collapsed),
            carryoverFrom: t && t.carryover ? t.carryover.from : null,
            drawnMl: t ? t.drawnMl : 0,
            volumeMl: t ? t.volumeMl : null,
            fraction: t && t.volumeMl ? t.drawnMl/t.volumeMl : 0,
            requiredFraction: requiredFraction(k),
            vacuumCycles: t ? t.vacuumCycles : 0,
          };
        }),
        ready: r.ready, allDone: r.allDone,
        blocking: r.blocking.map(i=>i.code), issues: r.issues.map(i=>i.code),
      };
    },
    /**
     * The real geometry a test needs to drive a tube on and off: where the
     * rack tubes stand, where the holder's mouth and flange are, and the axis
     * a tube travels along. All projected through the SAME toScreen() the
     * runtime's own fixed basis is built from, so a test drags exactly where
     * the gesture reads.
     */
    async collectionAnchors(){
      const { getCollectionContext } = await import("./venipuncture/collection/collectionRuntime.js");
      const ctx = getCollectionContext();
      if(!ctx) return null;
      const canvas = document.querySelector("canvas");
      const rect = canvas.getBoundingClientRect();
      const at = (v)=>{
        const p = ctx.view.toScreen(v.clone(), rect, v.clone());
        return { x: p.x, y: p.y };
      };
      const THREE = await import("three");
      const g = ctx.geom;
      const mouth = ctx.axis.origin.clone().addScaledVector(ctx.axis.out, g.holderLen);
      const flange = ctx.axis.origin.clone().addScaledVector(ctx.axis.out, g.holderLen*g.flangeAt);
      const rack = {};
      for(const key of Object.keys(ctx.rack.slots)){
        const s = ctx.rack.slots[key];
        rack[key] = at(new THREE.Vector3(s.x, s.y + g.tubeLen*0.6, s.z));
      }
      return {
        mode: ctx.mode,
        rack,
        mouth: at(mouth),
        flange: at(flange),
        /** screen pixels per 10mm along the seat axis, and across it */
        alongPx: (()=>{
          const a = at(mouth.clone().addScaledVector(ctx.axis.into, 0.010));
          const m = at(mouth);
          return { dx: a.x - m.x, dy: a.y - m.y };
        })(),
        sidePx: (()=>{
          const a = at(mouth.clone().addScaledVector(ctx.axis.side, 0.010));
          const m = at(mouth);
          return { dx: a.x - m.x, dy: a.y - m.y };
        })(),
      };
    },
    /** Runs the vacuum forward without waiting in real time. */
    async fastForwardFill(seconds){
      const { ENC } = await import("./game/gameState.js");
      const s = ENC && ENC.collect && ENC.collect.collection;
      if(!s) return false;
      const rt = await import("./venipuncture/collection/collectionRuntime.js");
      // While the scene is up this has to go THROUGH the runtime, or the state
      // moves on without the coach ever being told and the panel freezes on
      // the last volume a rendered frame happened to report. The controls path
      // tears the scene down, so there it calls the same pure helper the
      // render loop itself does.
      if(rt.isCollectionActive()){ rt.waitProgrammatically(seconds || 10); return true; }
      const { flow } = await import("./venipuncture/collection/collectionState.js");
      const tq = ENC.collect.tourniquet;
      const on = !!(tq && tq.securedAt && !tq.releasedAt);
      for(let t = 0; t < (seconds || 10); t += 0.1) flow(s, 0.1, on);
      return true;
    },
    /** The end-of-draw state and the rules' view of it, for the four post-draw steps. */
    async withdrawalSnapshot(){
      const { ENC } = await import("./game/gameState.js");
      const c = ENC && ENC.collect;
      const s = c && c.withdrawal;
      if(!s) return null;
      const { evaluateWithdrawal } = await import("./venipuncture/withdrawal/withdrawalRules.js");
      const { isOnPatient, secondsOn } = await import("./venipuncture/tourniquet/tourniquetState.js");
      const tq = c.tourniquet;
      const col = c.collection;
      const r = evaluateWithdrawal(s, {
        tourniquetReleased: !tq || !isOnPatient(tq),
        tourniquetOn: !!(tq && tq.securedAt && !tq.releasedAt),
        tourniquetSeconds: tq ? secondsOn(tq) : null,
        collectionDone: !col || (col.order || []).every(k => col.tubes[k] && col.tubes[k].removedAt),
        tubeOnHolder: !!(col && col.currentKey),
      });
      return {
        device: s.device,
        bandOnPatient: !!(tq && isOnPatient(tq)),
        bandReleasedAt: s.releasedAt,
        fistRelaxed: s.fistRelaxed,
        collectionDoneAtRelease: s.collectionDoneAtRelease,
        tourniquetSecondsAtRelease: s.tourniquetSecondsAtRelease,
        releaseShiftM: s.releaseShiftM,
        gauzeTaken: s.gauzeTakenAt != null,
        gauzePlaced: s.gauzePlacedAt != null,
        gauzeOffsetM: s.gauzeOffsetM,
        gauzeClean: s.gauzeClean,
        gauzePressedEarly: s.gauzePressedEarly,
        depthM: s.depthM,
        withdrawn: s.withdrawnAt != null,
        exitDeviationDeg: s.exitDeviationDeg,
        exitLateralM: s.exitLateralM,
        peakSpeedMps: s.peakSpeedMps,
        gauzeReadyAtWithdraw: s.gauzeReadyAtWithdraw,
        tourniquetOnAtWithdraw: s.tourniquetOnAtWithdraw,
        safetyTravel: s.safetyTravel,
        safetyLocked: s.safetyLockedAt != null,
        surfaceActivated: s.surfaceActivated,
        recapAttempted: s.recapAttempted,
        exposedSetDown: s.exposedSetDown,
        disposed: s.disposedAt != null,
        disposedFully: s.disposedFully,
        safetyEngagedAtDispose: s.safetyEngagedAtDispose,
        crossedPatient: s.crossedPatient,
        trashAttempts: s.trashAttempts,
        setDownAfterSafety: s.setDownAfterSafety,
        ready: r.ready,
        blocking: r.blocking.map(i=>i.code),
        issues: r.issues.map(i=>i.code),
      };
    },
    /**
     * Exact screen points for the things the withdrawal gestures grab — the
     * band's tail, the holder's hub, the shield, the gauze, the containers —
     * projected through the SAME toScreen() the runtime's own bases use.
     */
    async withdrawalAnchor(kind){
      const { withdrawalScreenPoint } = await import("./venipuncture/withdrawal/withdrawalRuntime.js");
      return withdrawalScreenPoint(kind);
    },
    async withdrawalAnchors(){
      const { withdrawalAnchors } = await import("./venipuncture/withdrawal/withdrawalRuntime.js");
      return withdrawalAnchors();
    },
    /** The bleeding, the clot and the dressing, as the rules see them. */
    async postDrawSnapshot(){
      const { ENC } = await import("./game/gameState.js");
      const s = ENC && ENC.collect && ENC.collect.postDraw;
      if(!s) return null;
      const { evaluatePostDraw, forceBandFor, modeReady } =
        await import("./venipuncture/postdraw/postDrawRules.js");
      const { pressureConsistency, meanForce, secondsRemaining } =
        await import("./venipuncture/postdraw/postDrawState.js");
      const r = evaluatePostDraw(s);
      const band = forceBandFor(s.siteKind);
      return {
        siteKind: s.siteKind,
        anticoagulated: s.anticoagulated,
        requiredForce: band.min,
        idealForce: band.ideal,
        discomfortForce: band.discomfort,
        force: s.force,
        peakForce: s.peakForce,
        meanForce: meanForce(s),
        consistency: pressureConsistency(s),
        padOffSite: s.padOffSite,
        padOffsetM: s.padOffsetM,
        pressureStarted: s.pressureStartedAt != null,
        timeToPressureS: s.timeToPressureS,
        heldSeconds: s.heldSeconds,
        effectiveSeconds: s.effectiveSeconds,
        holdSeconds: s.holdSeconds,
        secondsRemaining: secondsRemaining(s),
        discomfortSeconds: s.discomfortSeconds,
        armFlexed: s.armFlexed,
        armFlexedSeconds: s.armFlexedSeconds,
        clotProgress: s.clotProgress,
        haemostatic: r.haemostatic,
        releasedEarlyCount: s.releasedEarlyCount,
        extravasatedMl: s.extravasatedMl,
        hematomaGrade: r.hematomaGrade,
        checked: s.checkedAt != null,
        checkCount: s.checkCount,
        bleedingAtCheck: s.bleedingAtCheck,
        bandaged: s.bandagedAt != null,
        bandageAlignM: s.bandageAlignM,
        bandageTightness: s.bandageTightness,
        bandagedWhileBleeding: s.bandagedWhileBleeding,
        gauzeShifted: s.gauzeShifted,
        bandageAttempts: s.bandageAttempts,
        aftercareGiven: s.aftercareGiven,
        pressureReady: modeReady(s, "pressure"),
        bandageReady: modeReady(s, "bandage"),
        blocking: r.blocking.map(i=>i.code),
        issues: r.issues.map(i=>i.code),
      };
    },
    async postDrawAnchors(){
      const { postDrawAnchors } = await import("./venipuncture/postdraw/postDrawRuntime.js");
      return postDrawAnchors();
    },
    /** Each tube's inversion count, angles, speed and specimen verdict. */
    async inversionSnapshot(){
      const { ENC } = await import("./game/gameState.js");
      const s = ENC && ENC.collect && ENC.collect.inversion;
      if(!s) return null;
      const { evaluateInversion, inversionsFor, specimenVerdict, SHAKE_DEG_PER_S, OVER_AT } =
        await import("./venipuncture/inversion/inversionRules.js");
      const r = evaluateInversion(s);
      return {
        order: s.order.slice(),
        heldKey: s.heldKey,
        shakeThreshold: SHAKE_DEG_PER_S,
        overAt: OVER_AT,
        tubes: s.order.map(k=>{
          const t = s.tubes[k];
          const spec = inversionsFor(k);
          const v = specimenVerdict(t);
          return {
            key: k,
            required: spec.min,
            ideal: spec.ideal,
            mustNotMix: !!spec.mustNotMix,
            inversions: t ? t.inversions : 0,
            rockCount: t ? t.rockCount : 0,
            tilt: t ? t.tilt : 0,
            peakTilt: t ? t.peakTilt : 0,
            peakDegPerS: t ? t.peakDegPerS : 0,
            travelDeg: t ? t.travelDeg : 0,
            haemolysis: t ? t.haemolysis : 0,
            clotting: t ? t.clotting : "none",
            delaySeconds: t ? t.delaySeconds : 0,
            racked: !!(t && t.rackedAt != null),
            sluggish: !!(t && t.sluggish),
            usable: v.usable,
            reason: v.reason,
          };
        }),
        pending: r.pending.slice(),
        allHandled: r.allHandled,
        ready: r.ready,
        blocking: r.blocking.map(i=>i.code),
        issues: r.issues.map(i=>i.code),
      };
    },
    async inversionAnchors(){
      const { inversionAnchors } = await import("./venipuncture/inversion/inversionRuntime.js");
      return inversionAnchors();
    },
    /** Runs the bleed/clot clock forward without waiting in real time. */
    async fastForwardPressure(seconds){
      const { ENC } = await import("./game/gameState.js");
      const s = ENC && ENC.collect && ENC.collect.postDraw;
      if(!s) return false;
      const rt = await import("./venipuncture/postdraw/postDrawRuntime.js");
      // While the scene is up this has to go THROUGH the runtime, or the state
      // moves on without the coach ever being told and the panel freezes on
      // whatever a rendered frame last reported. The controls path tears the
      // scene down, so there it calls the same pure helper directly.
      if(rt.isPostDrawActive()){ rt.fastForwardPressure(seconds || 10); return true; }
      const { pressSample } = await import("./venipuncture/postdraw/postDrawState.js");
      for(let t = 0; t < (seconds || 10); t += 0.1){
        pressSample(s, s.force, s.padOffsetM == null ? 0 : s.padOffsetM, 0.1);
      }
      return true;
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
    /**
     * The graded practical, as the rubric layer built it. Present only once
     * the draw has finished; the same object the report screen renders, so a
     * test can assert on the grade rather than on the wording.
     */
    async practicalReport(){
      const { ENC } = await import("./game/gameState.js");
      return (ENC && ENC.collect && ENC.collect.report) || null;
    },
    /** The merged session replay for the finished draw. */
    async sessionReplay(){
      const { ENC } = await import("./game/gameState.js");
      const r = ENC && ENC.collect && ENC.collect.replay;
      if(!r) return null;
      return {
        count: r.count, durationMs: r.durationMs,
        groups: r.groups.map(g=>({ id:g.id, score:g.score, events:g.events.length })),
        sections: r.events.map(e=>e.section),
      };
    },
    /** Per-mode bests, so a test can prove they are kept apart. */
    async modeProgress(){
      const { SS } = await import("./game/gameState.js");
      return SS.modeProgress || {};
    },
    /** Walks the remaining steps of the current draw to its end. */
    async finishDraw(){
      const { ENC } = await import("./game/gameState.js");
      const { go } = await import("./ui/panels.js");
      if(!ENC || !ENC.collect) return false;
      ENC.collect.step = ENC.collect.steps.length;
      go("collect");
      return true;
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
