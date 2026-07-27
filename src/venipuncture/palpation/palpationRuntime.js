/* =========================================================================
   PALPATION RUNTIME — finding a vein with your fingers.

   Press a fingertip into the arm and move it about. What comes back depends
   on what is under it: a vein gives and springs back, a roller slides out
   sideways, the artery pushes back in time with the pulse, the tendon does
   not move at all. Nothing is labelled until it has been felt.

   Pressure is HOLD TIME, not a second axis of the pointer. That is a
   deliberate choice: this view cannot see depth (see armScene's pointerToLimb
   for why), so inventing a "push in" axis out of screen motion would be
   inventing information. Holding still and pressing is also what the hand
   actually does.

   Runs on the same arm scene the tourniquet used, with the same band still on
   it, because it is the same patient and the same limb.
   ========================================================================= */
import * as THREE from "three";
import { sfx } from "../../audio/audioManager.js";
import { buildArmScene } from "../arm/armScene.js";
import { ARM_Y } from "../arm/armMesh.js";
import { VESSEL_KIND, veinDistension, distalPallor } from "../arm/armAnatomy.js";
import {
  FEEL, feelAt, rollOffset, evaluatePalpation, CONTACT_PRESS, OCCLUDE_PRESS,
} from "./palpationRules.js";
import {
  createPalpationState, recordFeel, chooseVessel, clearChoice, markArteryRecognised,
} from "./palpationState.js";

/** Seconds of holding still to go from resting on the skin to full pressure. */
const PRESS_RAMP = 0.85;
/** ...and how fast it eases off once the finger lifts or slides. */
const PRESS_DECAY = 2.6;
/** The finger counts as still once it has not moved for this long, in ms. */
const STILL_MS = 110;

let ctx = null;

/* ---------- lifecycle -------------------------------------------------------- */

export async function startPalpation(opts){
  const o = opts || {};
  const view = buildArmScene(o.arm || {});
  const state = o.state || createPalpationState();

  const finger = buildFinger();
  view.root.add(finger.group);

  const marker = buildMarker();
  marker.visible = false;
  view.root.add(marker);

  ctx = {
    ...o,
    view, state, finger, marker,
    press: 0,
    finderPos: null,
    found: { feel: FEEL.NOTHING, vessel: null },
    down: false,
    lastMovedAt: 0,
    active: true,
    frame: 0,
    lastAspect: 0,
    pulsePhase: 0,
  };

  // the band from the previous step is still on this arm, and the veins it
  // raised are the veins being palpated
  if(o.tourniquet) applyBandToArm(o.tourniquet);
  view.setSiteVisible(false);
  notify();
  return ctx;
}

export function stopPalpation(){
  if(!ctx) return;
  ctx.view.dispose();
  ctx = null;
}

export function isPalpationActive(){ return !!(ctx && ctx.active); }
export function getPalpationContext(){ return ctx; }

/** The tourniquet's effect on the arm, carried into this step. */
function applyBandToArm(tq){
  const held = tq.heldTension || tq.tension || 0;
  const secs = (tq.accumulatedMs + (tq.securedAt ? (Date.now() - tq.securedAt) : 0))/1000;
  ctx.view.arm.setDistension(veinDistension(held, secs, ctx.state.vigour || 1));
  ctx.view.arm.setPallor(distalPallor(held));
}

function notify(){
  if(!ctx) return null;
  const result = evaluatePalpation(ctx.state, ctx.view.arm.vessels);
  if(ctx.onChange) ctx.onChange(result, ctx.found, ctx.press);
  return result;
}

/* ---------- the fingertip ---------------------------------------------------- */

function buildFinger(){
  const group = new THREE.Group();
  group.name = "fingertip";
  const mat = new THREE.MeshStandardMaterial({ color: 0xf0d8c4, roughness: 0.75 });
  mat.userData.perInstance = true;
  const pad = new THREE.Mesh(new THREE.SphereGeometry(0.0092, 16, 12), mat);
  pad.scale.set(1, 0.78, 1.15);
  group.add(pad);
  const nail = new THREE.Mesh(
    new THREE.SphereGeometry(0.0062, 12, 8),
    new THREE.MeshStandardMaterial({ color: 0xf7ebe2, roughness: 0.4 })
  );
  nail.scale.set(0.9, 0.4, 1);
  nail.position.set(0, 0.006, -0.004);
  group.add(nail);
  group.visible = false;
  return { group, pad };
}

/** A small ring left on the skin where the learner committed to draw. */
function buildMarker(){
  const m = new THREE.Mesh(
    new THREE.RingGeometry(0.0055, 0.0080, 24),
    new THREE.MeshBasicMaterial({ color: 0x3f8f6d, transparent: true, opacity: 0.9, depthWrite: false })
  );
  m.rotation.x = -Math.PI/2;
  m.name = "siteMark";
  return m;
}

/* ---------- pointer ---------------------------------------------------------- */

function limbRadius(x){ return ctx.view.arm.radiusAt(x); }

function readSkin(e, canvasEl){
  const rect = canvasEl.getBoundingClientRect();
  return ctx.view.pointerToLimbSurface(
    { x: e.clientX, y: e.clientY }, rect,
    ctx.finderPos ? ctx.finderPos.x : null, limbRadius,
    // A ray meets the limb twice and both hits are on the skin, so the solve
    // needs telling which. Unlike the tourniquet — which is deliberately taken
    // round the hidden underside — a palpating finger is always on the face of
    // the arm turned toward the operator, so the near hit is the right one.
    // (An angle to continue from cannot settle this on its own: +theta and
    // -theta are the same distance from any reference, so a symmetric hint
    // leaves the two sides of the arm exactly tied.)
    ctx.finderPos ? ctx.finderPos.theta : null,
    true
  );
}

export function palpationPointerDown(e, canvasEl){
  if(!isPalpationActive()) return false;
  const s = readSkin(e, canvasEl);
  if(!s) return false;
  try{ canvasEl.setPointerCapture(e.pointerId); }catch(_){}
  ctx.down = true;
  ctx.press = 0;
  ctx.lastMovedAt = performance.now();
  placeFinger(s);
  sfx("tap");
  return true;
}

export function palpationPointerMove(e, canvasEl){
  if(!isPalpationActive()) return false;
  const s = readSkin(e, canvasEl);
  if(!s) return true;

  // Sliding the finger about eases the press off: you cannot lean on a vein
  // and sweep the arm at the same time. Recorded as WHEN the hand last moved
  // rather than how fast it was going — a speed sampled between two pointer
  // events is mostly a measure of how the events happened to land, and a
  // stationary finger is the thing actually being detected.
  if(ctx.finderPos){
    const moved = Math.hypot(s.x - ctx.finderPos.x, skinZ(s) - ctx.finderPos.z);
    if(moved > 0.0009) ctx.lastMovedAt = performance.now();
  }
  placeFinger(s);
  return true;
}

export function palpationPointerUp(e, canvasEl){
  if(!isPalpationActive()) return false;
  try{ canvasEl.releasePointerCapture(e.pointerId); }catch(_){}
  // Lifting off something pulsing, rather than committing to it, is the
  // recognition the step is really testing.
  if(ctx.found && ctx.found.feel === FEEL.ARTERY) markArteryRecognised(ctx.state);
  ctx.down = false;
  notify();
  return true;
}

export function palpationPointerCancel(){
  if(!isPalpationActive()) return false;
  ctx.down = false;
  return true;
}

function skinZ(s){ return Math.sin(s.theta)*limbRadius(s.x); }

function placeFinger(s){
  ctx.finderPos = { x: s.x, theta: s.theta, z: skinZ(s) };
  const p = ctx.view.limbToWorld(s.x, s.theta, limbRadius(s.x));
  ctx.finger.group.position.copy(p);
  ctx.finger.group.visible = true;
  // the fingertip lies along the arm, angled with the surface
  ctx.finger.group.rotation.set(0, 0, -s.theta);
}

/* ---------- per-frame -------------------------------------------------------- */

export function renderPalpation(renderer, dt){
  if(!ctx) return false;
  const step = dt || 0.016;
  const size = renderer.getSize(new THREE.Vector2());
  const aspect = size.x/Math.max(1, size.y);
  ctx.frame++;

  if(Math.abs(aspect - ctx.lastAspect) > 0.01 || ctx.frame % 30 === 0){
    const ob = measureObstruction(renderer);
    ctx.view.fitCamera(aspect, ob);
    ctx.lastAspect = aspect;
  }

  tickPress(step);
  ctx.view.tick(step);
  renderer.render(ctx.view.scene, ctx.view.camera);
  return true;
}

function tickPress(dt){
  const wasFeel = ctx.found ? ctx.found.feel : FEEL.NOTHING;

  // Pressure builds only while the finger is down AND held still.
  const still = (performance.now() - ctx.lastMovedAt) > STILL_MS;
  if(ctx.down && still) ctx.press = Math.min(1, ctx.press + dt/PRESS_RAMP);
  else ctx.press = Math.max(0, ctx.press - dt*PRESS_DECAY);

  if(!ctx.finderPos){ ctx.found = { feel: FEEL.NOTHING, vessel: null }; return; }

  const found = feelAt(ctx.view.arm.vessels, ctx.finderPos.x, ctx.finderPos.z, ctx.press);
  ctx.found = found;
  if(ctx.press > CONTACT_PRESS) recordFeel(ctx.state, found, ctx.press, dt*1000);

  // Remember the last thing actually felt, and where. You cannot hold a
  // fingertip on the arm and reach for a control at the same time — so
  // marking a site works the way it does in life: feel it, take the hand off,
  // then mark the spot you just had under your finger.
  if(found.vessel && ctx.press > CONTACT_PRESS){
    ctx.lastFound = found;
    ctx.lastPos = { x: ctx.finderPos.x, theta: ctx.finderPos.theta, z: ctx.finderPos.z };
  }

  // the fingertip sinks into the skin as it presses
  if(ctx.finderPos){
    const sink = ctx.press*0.006;
    const p = ctx.view.limbToWorld(
      ctx.finderPos.x, ctx.finderPos.theta, limbRadius(ctx.finderPos.x) - sink
    );
    ctx.finger.group.position.copy(p);
  }

  // and the arm answers back
  animateResponse(found, dt);

  if(found.feel !== wasFeel){
    if(found.feel === FEEL.ARTERY) sfx("click");
    else if(found.feel === FEEL.VEIN || found.feel === FEEL.ROLLING) sfx("good");
    else if(found.feel === FEEL.NERVE) sfx("bad");
    notify();
  }
}

/**
 * The visible half of the sensation. A vein dips under the finger and comes
 * back; a roller slides sideways; the artery lifts in time with the pulse;
 * the tendon does nothing, which is itself the answer.
 */
function animateResponse(found, dt){
  ctx.pulsePhase += dt*7.6;
  const vessels = ctx.view.arm.vesselMeshes;
  if(!found.vessel) return;
  const mesh = vessels.get(found.vessel.id);
  if(!mesh) return;

  if(found.feel === FEEL.ROLLING){
    // real lateral displacement — the vein is genuinely somewhere else now
    const off = rollOffset(found.vessel, ctx.press);
    mesh.position.z = off * (ctx.finderPos.z >= 0 ? 1 : -1);
  }else if(found.feel === FEEL.VEIN || found.feel === FEEL.FLATTENED){
    mesh.position.z = 0;
    mesh.position.y = -ctx.press*0.0016;
  }else{
    mesh.position.z = 0;
    mesh.position.y = 0;
  }
}

function measureObstruction(renderer){
  const canvas = renderer.domElement;
  const panel = typeof document !== "undefined" ? document.getElementById("panel") : null;
  if(!canvas || !panel) return { rightFrac: 0, bottomFrac: 0 };
  const c = canvas.getBoundingClientRect();
  const p = panel.getBoundingClientRect();
  if(!c.width || !c.height || !p.width) return { rightFrac: 0, bottomFrac: 0 };
  const sideSheet = p.width < c.width*0.75;
  if(sideSheet) return { rightFrac: Math.min(0.45, (c.right - p.left)/c.width), bottomFrac: 0 };
  return { rightFrac: 0, bottomFrac: Math.min(0.6, (c.bottom - p.top)/c.height) };
}

/* ---------- committing ------------------------------------------------------- */

/** Marks the spot the finger last actually felt something at. */
export function markCurrentSite(){
  if(!ctx) return null;
  const found = (ctx.found && ctx.found.vessel) ? ctx.found : ctx.lastFound;
  const pos = (ctx.found && ctx.found.vessel) ? ctx.finderPos : ctx.lastPos;
  if(!found || !found.vessel || !pos) return null;
  const v = found.vessel;
  chooseVessel(ctx.state, v.id, { x: pos.x, z: pos.z });
  ctx.marker.position.copy(
    ctx.view.limbToWorld(pos.x, pos.theta, limbRadius(pos.x) + 0.0012)
  );
  ctx.marker.visible = true;
  sfx(v.kind === VESSEL_KIND.VEIN ? "good" : "bad");
  return notify();
}

export function unmarkSite(){
  if(!ctx) return null;
  clearChoice(ctx.state);
  ctx.marker.visible = false;
  return notify();
}

/**
 * The accessible path and the tests palpate through this: it presses a named
 * vessel at a given pressure for real, through the same feelAt() the finger
 * uses, so the same things get recorded and the same rules judge them.
 */
export function palpateVesselById(id, press){
  if(!ctx) return null;
  const v = ctx.view.arm.vessels.find(x=>x.id === id);
  if(!v) return null;
  const mid = v.path[Math.floor(v.path.length/2)];
  ctx.finderPos = { x: mid.x, theta: Math.asin(Math.max(-1, Math.min(1, mid.z/limbRadius(mid.x)))), z: mid.z };
  ctx.press = press == null ? 0.62 : press;
  const found = feelAt(ctx.view.arm.vessels, mid.x, mid.z, ctx.press);
  ctx.found = found;
  recordFeel(ctx.state, found, ctx.press, 260);
  placeFinger({ x: mid.x, theta: ctx.finderPos.theta });
  return notify();
}

export function chooseVesselById(id){
  if(!ctx) return null;
  const v = ctx.view.arm.vessels.find(x=>x.id === id);
  if(!v) return null;
  const mid = v.path[Math.floor(v.path.length/2)];
  chooseVessel(ctx.state, id, { x: mid.x, z: mid.z });
  const theta = Math.asin(Math.max(-1, Math.min(1, mid.z/limbRadius(mid.x))));
  ctx.marker.position.copy(ctx.view.limbToWorld(mid.x, theta, limbRadius(mid.x) + 0.0012));
  ctx.marker.visible = true;
  return notify();
}

/** Live readings for the coach panel. */
export function currentTouch(){
  if(!ctx) return null;
  const live = ctx.found && ctx.found.vessel ? ctx.found : null;
  return {
    press: ctx.press,
    feel: ctx.found ? ctx.found.feel : FEEL.NOTHING,
    vesselId: live ? live.vessel.id : null,
    down: ctx.down,
    occluding: ctx.press > OCCLUDE_PRESS,
    /** something has been felt that could be marked, hand on the arm or not */
    markable: !!(live || ctx.lastFound),
    lastVesselId: ctx.lastFound ? ctx.lastFound.vessel.id : null,
  };
}

export { FEEL };
