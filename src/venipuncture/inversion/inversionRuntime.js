/* =========================================================================
   TUBE INVERSION RUNTIME — the tubes the collection step actually filled,
   standing in a rack on the same bench, picked up one at a time and turned
   end over end.

   THE GEOMETRY. Nothing here touches the limb, so none of armScene's limb
   solves are involved: the rack is on the bench, a known horizontal plane, so
   `pointerToPlane` gives one exact world point for picking a tube up and
   putting it back (the same reason staging, assembly and collection all work
   down here).

   THE TURN is the one genuinely new reading, and it is deliberately the
   simplest honest one available. A tube held in the hand and turned over
   rotates about a horizontal axis across the view, which on screen is just the
   tube's long axis swinging from pointing up to pointing down — a rotation
   IN the image plane, not out of it. So the tilt is the angle of the vector
   from the hand's pivot to the pointer, measured against straight up, and it
   needs no inference at all: the thing being rotated and the thing the pointer
   describes are the same rotation. Dragging in an arc round the pivot turns the
   tube exactly as far as the hand went.

   That also means rocking and shaking are physically distinct in the input, not
   just in the scoring: a small arc never reaches the far gate, and a fast arc
   is fast in degrees per second no matter how it is drawn.

   Owns interaction. It writes inversionState and asks inversionRules; it never
   decides correctness itself.
   ========================================================================= */
import * as THREE from "three";
import { tubeChink, tubeRackClick, wince } from "../../audio/procedural.js";
import { tapHaptic, seatHaptic, winceHaptic } from "../../bench/haptics.js";
import { leaseBenchView } from "../../bench/benchSession.js";
import { TUBES } from "../../config.js";
import { evaluateInversion, inversionsFor, mustNotMix } from "./inversionRules.js";
import {
  createInversionState, current, pickUp, rack, turnTo, seedTilt,
  invertOnce, invertTimes, rockTimes, shakeTimes,
} from "./inversionState.js";
import { measureObstruction, viewportAspect } from "../viewport.js";

/** The bench top, shared with every other branch so the room is one room. */
const BENCH_Y = -0.030;
/** Where the rack of collected tubes stands. */
const RACK_Z = 0.150;
const RACK_X = -0.052;
const RACK_PITCH = 0.030;

const TUBE_R = 0.0065;
const TUBE_LEN = 0.075;

/** Where a tube is held while it is being turned. */
const HAND = { x: 0.010, y: 0.105, z: 0.095 };

/** Screen pixels within which a press counts as grabbing a tube. */
const GRAB_PX = 46;
/** Pixels from the pivot below which the angle is too ill-conditioned to trust. */
const PIVOT_DEADZONE_PX = 26;

let ctx = null;

/* ---------- lifecycle ------------------------------------------------------------- */

/**
 * @param {object} opts
 *   state   an existing inversionState to resume, or null for a new one
 *   arm     {skin, build, armSide, scenarioKeys, vigour, shirt}
 *   guided  teaching mode
 *   onChange(result)
 */
export async function startInversion(opts){
  const o = opts || {};
  const view = leaseBenchView({ mode: "inversion", arm: o.arm || {} });
  const state = o.state || createInversionState({});

  const rackGroup = buildRack(state);
  view.root.add(rackGroup.group);

  const held = buildTube();
  held.group.visible = false;
  view.root.add(held.group);

  ctx = {
    ...o,
    view, state,
    rack: rackGroup, held,
    down: false,
    drag: null,        // {kind:"carry"|"turn", ...}
    carryPos: null,
    lastT: null,
    active: true,
    frame: 0,
    lastAspect: 0,
  };

  view.setSiteVisible(false);
  syncObjects();
  notify();
  return ctx;
}

export function stopInversion(){
  if(!ctx) return;
  ctx.view.dispose();
  ctx = null;
}

export function isInversionActive(){ return !!(ctx && ctx.active); }
export function getInversionContext(){ return ctx; }

function notify(){
  if(!ctx) return null;
  const result = evaluateInversion(ctx.state);
  if(ctx.onChange) ctx.onChange(result);
  return result;
}

/* ---------- the props -------------------------------------------------------------- */

function mat(color, o){
  const m = new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.7 }, o || {}));
  m.userData.perInstance = true;
  return m;
}

function tubeColour(key){
  return TUBES[key] ? TUBES[key].color : 0xbbbbbb;
}

/**
 * One tube: a body, the blood inside it, and a coloured cap. The blood is a
 * separate mesh so it can slump toward whichever end is DOWN as the tube turns
 * — which is the whole visual point of an inversion, and the only way the
 * learner can see that the additive at the closed end is actually being
 * reached.
 */
function buildTube(){
  const group = new THREE.Group();
  group.name = "inversionTube";
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(TUBE_R, TUBE_R, TUBE_LEN, 18),
    mat(0xdfe6ec, { roughness: 0.15, transparent: true, opacity: 0.40 })
  );
  group.add(body);
  const fluid = new THREE.Mesh(
    new THREE.CylinderGeometry(TUBE_R*0.9, TUBE_R*0.9, TUBE_LEN*0.62, 16),
    mat(0x8e1b1b, { roughness: 0.45 })
  );
  group.add(fluid);
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(TUBE_R*1.12, TUBE_R*1.12, 0.014, 18),
    mat(0xdc4b4b, { roughness: 0.55 })
  );
  cap.position.y = TUBE_LEN/2 + 0.005;
  group.add(cap);
  return { group, body, fluid, cap };
}

function buildRack(state){
  const group = new THREE.Group();
  group.name = "inversionRack";
  const n = Math.max(1, state.order.length);
  const w = RACK_PITCH*n + 0.016;
  const base = new THREE.Mesh(new THREE.BoxGeometry(w, 0.018, 0.040), mat(0xf0e9dc, { roughness: 0.8 }));
  base.position.set(RACK_X, BENCH_Y + 0.009, RACK_Z);
  group.add(base);

  const slots = {};
  state.order.forEach((key, i)=>{
    const x = RACK_X - w/2 + 0.008 + RACK_PITCH*(i + 0.5);
    const g = new THREE.Group();
    const t = buildTube();
    t.cap.material.color.setHex(tubeColour(key));
    t.group.position.y = TUBE_LEN/2;
    g.add(t.group);
    g.position.set(x, BENCH_Y + 0.012, RACK_Z);
    group.add(g);
    slots[key] = { key, group: g, tube: t, x, y: BENCH_Y + 0.012, z: RACK_Z };
  });
  return { group, slots };
}

/* ---------- placement --------------------------------------------------------------- */

function handWorld(){
  return new THREE.Vector3(HAND.x, HAND.y, HAND.z);
}

function syncObjects(){
  if(!ctx) return;
  const s = ctx.state;
  const held = current(s);

  for(const key of Object.keys(ctx.rack.slots)){
    ctx.rack.slots[key].group.visible = key !== s.heldKey;
  }

  if(!held){ ctx.held.group.visible = false; return; }
  ctx.held.cap.material.color.setHex(tubeColour(held.key));
  ctx.held.group.visible = true;
  ctx.held.group.position.copy(ctx.carryPos || handWorld());
  // the tube tips over about the axis across the view: its own long axis swings
  ctx.held.group.rotation.set(0, 0, held.tilt*Math.PI/180);

  // The blood slumps toward whichever end is now the bottom, so going all the
  // way over is visibly different from rocking — the additive at the closed end
  // is only reached when the blood actually travels the length of the tube.
  const frac = held.volumeMl ? Math.max(0.12, Math.min(1, held.drawnMl/held.volumeMl)) : 0.62;
  ctx.held.fluid.scale.y = frac;
  // +y is the capped end; as tilt passes 90° the closed end becomes the low one
  const toward = held.tilt > 90 ? 1 : -1;
  ctx.held.fluid.position.y = toward*(TUBE_LEN/2)*(1 - frac);
  // and it darkens as it haemolyses
  ctx.held.fluid.material.color.setHex(held.haemolysis > 0.2 ? 0x5e2230 : 0x8e1b1b);
}

/* ---------- the turn ---------------------------------------------------------------- */

/**
 * The pivot the tube turns about, in screen pixels: the hand holding it.
 * Projected forward from a known world point, so it is exact.
 */
function pivotScreen(rect){
  return ctx.view.toScreen(ctx.carryPos || handWorld(), rect, new THREE.Vector3());
}

/**
 * Degrees from upright, from the direction the pointer sits in relative to the
 * pivot. Straight above the pivot is 0; straight below is 180.
 *
 * Unsigned on purpose: which way round the tube is turned makes no clinical
 * difference, and folding both directions onto 0..180 means a learner turning
 * it "the other way" is not silently marked down for it.
 */
function tiltFromPointer(e, rect){
  const p = pivotScreen(rect);
  const dx = e.clientX - p.x;
  const dy = e.clientY - p.y;
  if(Math.hypot(dx, dy) < PIVOT_DEADZONE_PX) return null;
  // screen y grows downward, so "up" is -y
  return Math.acos(Math.max(-1, Math.min(1, -dy/Math.hypot(dx, dy))))*180/Math.PI;
}

/* ---------- picking ------------------------------------------------------------------ */

function screenDistTo(worldVec, e, rect){
  const p = ctx.view.toScreen(worldVec, rect, new THREE.Vector3());
  return Math.hypot(p.x - e.clientX, p.y - e.clientY);
}

/**
 * The wall clock, deliberately NOT the event's own `timeStamp`.
 *
 * This is the first step where the interval between pointer samples is itself a
 * measurement — degrees per second is what separates mixing from shaking — and
 * a synthesised event's timeStamp does not advance like real elapsed time. A
 * genuinely gentle turn read as ~900°/s against it.
 */
function nowMs(){
  return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
}

function rackTubeAt(e, rect){
  let best = null, bestD = GRAB_PX;
  for(const key of Object.keys(ctx.rack.slots)){
    const slot = ctx.rack.slots[key];
    if(!slot.group.visible) continue;
    const w = new THREE.Vector3(slot.x, slot.y + TUBE_LEN*0.6, slot.z);
    const d = screenDistTo(w, e, rect);
    if(d < bestD){ bestD = d; best = key; }
  }
  return best;
}

/* ---------- pointer ------------------------------------------------------------------ */

export function inversionPointerDown(e, canvasEl){
  if(!isInversionActive()) return false;
  const rect = canvasEl.getBoundingClientRect();
  const s = ctx.state;

  const grab = (kind, extra)=>{
    try{ canvasEl.setPointerCapture(e.pointerId); }catch(_){}
    ctx.down = true;
    ctx.lastT = nowMs();
    ctx.drag = Object.assign({ kind, downX: e.clientX, downY: e.clientY }, extra || {});
    tapHaptic();
    return true;
  };

  if(!s.heldKey){
    const key = rackTubeAt(e, rect);
    if(!key) return false;
    const slot = ctx.rack.slots[key];
    pickUp(s, key);
    ctx.carryPos = new THREE.Vector3(slot.x, slot.y + TUBE_LEN*0.5, slot.z);
    syncObjects();
    notify();
    return grab("carry");
  }

  // A tube already in the hand: this is a turn. Seeded, not accumulated —
  // taking hold of it at an angle is not a rotation anybody performed.
  const tilt0 = tiltFromPointer(e, rect);
  seedTilt(s, tilt0);
  syncObjects();
  return grab("turn", { lastTilt: tilt0 });
}

export function inversionPointerMove(e, canvasEl){
  if(!isInversionActive() || !ctx.down || !ctx.drag) return isInversionActive();
  const rect = canvasEl.getBoundingClientRect();
  const s = ctx.state;
  const d = ctx.drag;
  const now = nowMs();
  const dtS = Math.max(0, (now - (ctx.lastT || now))/1000);
  ctx.lastT = now;

  if(d.kind === "carry"){
    // lifting it out of the rack and up to the hand: a known plane, exact
    const p = ctx.view.pointerToPlane({ x: e.clientX, y: e.clientY }, rect, HAND.y);
    if(p) ctx.carryPos.copy(p);
    // The gesture becomes a turn only once the pointer is actually AT the hand
    // on screen — judged in pixels, not in metres. Switching on a world
    // distance let the pointer still be a long way across the canvas when the
    // pivot became fixed, and every remaining moment of the carry was then read
    // as rotation: a tube arrived in the hand already 140° over, having
    // "travelled" 280° at 970°/s. Carrying a tube is not turning it.
    const handPx = ctx.view.toScreen(handWorld(), rect, new THREE.Vector3());
    if(Math.hypot(handPx.x - e.clientX, handPx.y - e.clientY) <= PIVOT_DEADZONE_PX){
      ctx.carryPos = null;
      d.kind = "turn";
      // and even then, seed rather than accumulate
      seedTilt(s, tiltFromPointer(e, rect));
      d.lastTilt = tiltFromPointer(e, rect);
      tubeRackClick();
    }
    syncObjects();
    return true;
  }

  if(d.kind === "turn"){
    const tilt = tiltFromPointer(e, rect);
    if(tilt == null) return true;          // too near the pivot to read an angle
    const before = current(s);
    const wasN = before ? before.inversions : 0;
    const wasRocks = before ? before.rockCount : 0;
    turnTo(s, tilt, dtS);
    d.lastTilt = tilt;
    const after = current(s);
    if(after){
      // a full end-over-end turn is a soft roll of fluid; a rock is the
      // shake that ruins the sample, and it should sound wrong
      if(after.inversions > wasN){ tubeChink(); seatHaptic(); }
      else if(after.rockCount > wasRocks){ wince(); winceHaptic(); }
    }
    syncObjects();
    notify();
    return true;
  }

  return true;
}

export function inversionPointerUp(e, canvasEl){
  if(!isInversionActive()) return false;
  try{ canvasEl.releasePointerCapture(e.pointerId); }catch(_){}
  const d = ctx.drag;
  ctx.drag = null;
  ctx.down = false;
  if(!d) return false;
  const s = ctx.state;
  const rect = canvasEl.getBoundingClientRect();

  // Let go over the rack and the tube is stood back in it. Let go anywhere else
  // and it stays in the hand — mixing is a two-handed job you do not put down
  // half way through.
  const held = current(s);
  if(held){
    const slot = ctx.rack.slots[held.key];
    if(slot && screenDistTo(new THREE.Vector3(slot.x, slot.y + TUBE_LEN*0.6, slot.z), e, rect) <= GRAB_PX*1.6){
      rack(s);
      ctx.carryPos = null;
      tubeRackClick();
    }
  }
  syncObjects();
  notify();
  return true;
}

export function inversionPointerCancel(){
  if(!isInversionActive()) return false;
  ctx.down = false;
  ctx.drag = null;
  syncObjects();
  return true;
}

/* ---------- per-frame ----------------------------------------------------------------- */

export function renderInversion(renderer, dt){
  if(!ctx) return false;
  // What the camera is following: a filled tube, while it is being turned end over end.
  // See bench/handFraming.js — idempotent, so this is free per frame.
  ctx.view.hold(ctx.state.heldKey ? "filledTube" : "none");
  const aspect = viewportAspect(renderer);
  ctx.frame++;
  // Not while a hand is turning a tube: the tilt is read against the pivot's
  // projected position, and moving the camera under a stationary hand would
  // change the angle it is holding.
  if(!ctx.down && (Math.abs(aspect - ctx.lastAspect) > 0.01 || ctx.frame % 30 === 0)){
    ctx.view.fitCamera(aspect, measureObstruction(renderer), {
      lookX: -0.030, lookZ: 0.120, lookY: 0.055,
      spanX: 0.34, spanZ: 0.26,
    });
    ctx.lastAspect = aspect;
  }
  ctx.view.tick(dt || 0.016);
  renderer.render(ctx.view.scene, ctx.view.camera);
  return true;
}

/* ---------- programmatic (accessible path + tests) ------------------------------------- */

function after(fn){
  if(!ctx) return null;
  fn(ctx.state);
  syncObjects();
  return notify();
}

export function pickUpProgrammatically(key){
  return after(s => { pickUp(s, key); ctx.carryPos = null; });
}
export function rackProgrammatically(){
  return after(s => { rack(s); ctx.carryPos = null; });
}
export function invertProgrammatically(n){
  return after(s => invertTimes(s, n == null ? 1 : n, {}));
}
export function invertToRequirementProgrammatically(){
  return after(s => {
    const t = current(s);
    if(!t || mustNotMix(t.key)) return;
    const owed = Math.max(0, inversionsFor(t.key).ideal - t.inversions);
    invertTimes(s, owed, {});
  });
}
export function rockProgrammatically(n){
  return after(s => rockTimes(s, n == null ? 4 : n, {}));
}
export function shakeProgrammatically(n){
  return after(s => shakeTimes(s, n == null ? 6 : n, {}));
}
export function invertSlowlyProgrammatically(n){
  return after(s => invertTimes(s, n == null ? 1 : n, { degPerS: 30 }));
}

/** What the bench looks like right now, for the coach. */
export function currentInversion(){
  if(!ctx) return null;
  const held = current(ctx.state);
  return {
    heldKey: ctx.state.heldKey,
    turning: !!(ctx.down && ctx.drag && ctx.drag.kind === "turn"),
    tilt: held ? held.tilt : 0,
  };
}

/** Exact screen points and the pivot a test needs to drive the turn. */
export function inversionAnchors(){
  if(!ctx) return null;
  const canvas = typeof document !== "undefined" ? document.querySelector("canvas") : null;
  if(!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const at = (w)=>{ const p = ctx.view.toScreen(w, rect, new THREE.Vector3()); return { x: p.x, y: p.y }; };
  const slots = {};
  for(const key of Object.keys(ctx.rack.slots)){
    const s = ctx.rack.slots[key];
    slots[key] = at(new THREE.Vector3(s.x, s.y + TUBE_LEN*0.6, s.z));
  }
  return {
    frame: ctx.frame,
    heldKey: ctx.state.heldKey,
    rack: slots,
    hand: at(handWorld()),
    pivot: at(ctx.carryPos || handWorld()),
    deadzonePx: PIVOT_DEADZONE_PX,
  };
}
