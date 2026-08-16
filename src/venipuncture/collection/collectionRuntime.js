/* =========================================================================
   TUBE COLLECTION RUNTIME — the rack beside the arm, the holder still in the
   patient, and the tubes going on and off it.

   TWO GEOMETRIES, BOTH EXACT, NEITHER OF THEM A LIMB SOLVE:

     THE RACK   sits on the bench. A bench is a known horizontal plane, so a
                pointer ray crossing it gives one exact world point
                (pointerToPlane) — the same reason the assembly branch does
                its work down here. Picking a tube up and carrying it is
                measured in real metres with nothing inferred.

     THE HOLDER is a rigid body sticking out of the arm along a line that was
                fixed, once, when the skin was broken: the entry point, the
                locked insertion angle, and the along-arm direction the tip
                was travelling. A tube goes on and comes off ALONG THAT LINE.

                A tube being pushed onto it is a hand held CLEAR of the limb,
                which is exactly the case none of armScene's three limb
                readings handle — pointerToLimb and pointerToLimbSurface both
                re-seed their cross-section guess from the previous frame's
                own answer, and that self-consistency only converges near the
                skin. So this does what the insert branch's approach does:
                fix a small local basis ONCE by projecting three EXACTLY KNOWN
                world points through toScreen() — the holder's mouth, a 10mm
                step along the holder's axis, a 10mm step across it — because
                forward projection of a known point has no ambiguity to begin
                with. Every raw pointer position is then solved against that
                fixed basis by the same 2x2 inverse pointerToLimb uses
                internally. Nothing re-seeds, nothing diverges, and the seat
                depth stays exact however far from the arm the hand is.

                The basis is rebuilt on canvas resize and whenever a tube is
                picked up — never lazily, because a drag can carry straight
                from the rack into a push without letting go.

   WHERE THE HAND IS, IS THE TECHNIQUE. A push made from the holder's flange
   is a couple — fingers pulling back as the thumb pushes forward — and almost
   nothing reaches the patient. A push made by grabbing the tube's barrel has
   nothing to push against, so the holder travels with it and the needle
   travels with the holder. That distinction is decided by which of the two
   the pointer went down nearest, and it is the whole reason the needle moves.
   ========================================================================= */
import * as THREE from "three";
import {
  stopperPop, vacuumVoice, tubeRackClick, tubeChink, duckRoom,
} from "../../audio/procedural.js";
import { seatHaptic, tapHaptic } from "../../bench/haptics.js";
import { leaseBenchView } from "../../bench/benchSession.js";
import { veinDistension, distalPallor } from "../arm/armAnatomy.js";
import { TUBES } from "../../config.js";
import {
  evaluateCollection, GRIP, isRedrawable,
} from "./collectionRules.js";
import {
  createCollectionState, takeTube, returnTube, discardTube, current,
  seat, backOffToGuideline, pushOn, removeTube, flow,
} from "./collectionState.js";
import { measureObstruction, viewportAspect } from "../viewport.js";

/** The bench top, shared with the assembly branch so the room is one room. */
const BENCH_Y = -0.030;
/** Where the rack of this draw's tubes stands, in front of and below the arm. */
const RACK_Z = 0.150;
const RACK_X = -0.052;
const RACK_PITCH = 0.030;

/** Tube dimensions, in metres — a real 13x75mm collection tube. */
const TUBE_R = 0.0065;
const TUBE_LEN = 0.075;

/**
 * Metres out from the entry point to the holder's open mouth. The barrel runs
 * the whole of that length and the flange is the rim around the mouth, so a
 * tube pushed in visibly slides INTO the barrel rather than hovering past it.
 */
const HOLDER_LEN = 0.062;
const HOLDER_R = 0.0082;
/** Where along the holder the flange sits, as a fraction of its length. */
const FLANGE_AT = 0.97;

/** The local basis is built from a 10mm step in each direction. */
const BASIS_STEP = 0.010;
/** How close a carried tube's mouth has to get to the holder's to go in. */
const CAPTURE_R = 0.018;
/** Screen pixels within which a press counts as grabbing that thing. */
const GRAB_PX = 46;

let ctx = null;

/* ---------- lifecycle ------------------------------------------------------------ */

/**
 * @param {object} opts
 *   state       an existing collectionState to resume, or null for a new one
 *   arm         {skin, build, armSide, scenarioKeys, vigour, shirt}
 *   insert      the insertState — the entry point, angle and direction the
 *               holder's whole geometry is derived from
 *   tourniquet  the same band, still on the arm, still counting
 *   onChange(result)
 */
export async function startCollection(opts){
  const o = opts || {};
  const view = leaseBenchView({ mode: "collection", arm: o.arm || {} });
  const state = o.state || createCollectionState({});

  const axis = holderAxisFrom(view, o.insert || {});

  const holder = buildHolder();
  view.root.add(holder.group);

  const rack = buildRack(state, view);
  view.root.add(rack.group);

  const tube = buildTube();
  tube.group.visible = false;
  view.root.add(tube.group);

  ctx = {
    ...o,
    view, state, holder, rack, tube, axis,
    // the real dimensions, so the test seam projects the same points the
    // gesture reads rather than duplicating the numbers
    geom: { holderLen: HOLDER_LEN, flangeAt: FLANGE_AT, tubeLen: TUBE_LEN, captureR: CAPTURE_R },
    seatBasis: null,
    down: false,
    /** "carry" while a tube is being brought over, "seat" once it is in the mouth */
    mode: state.currentKey ? "seat" : "idle",
    carryKey: null,
    carryPos: null,
    lastAxial: null,
    /** net axial travel within the CURRENT gesture, so a pull is a pull */
    gestureAxial: 0,
    active: true,
    frame: 0,
    lastAspect: 0,
  };

  if(o.tourniquet) applyBandToArm(o.tourniquet);
  view.setSiteVisible(false);
  placeHolder();
  syncObjects();
  notify();
  return ctx;
}

export function stopCollection(){
  if(!ctx) return;
  if(ctx.vacuum) ctx.vacuum.stop();
  ctx.view.dispose();
  ctx = null;
}

export function isCollectionActive(){ return !!(ctx && ctx.active); }
export function getCollectionContext(){ return ctx; }

function applyBandToArm(tq){
  const held = tq.heldTension || tq.tension || 0;
  const secs = (tq.accumulatedMs + (tq.securedAt ? (Date.now() - tq.securedAt) : 0))/1000;
  ctx.view.arm.setDistension(veinDistension(held, secs, 1));
  ctx.view.arm.setPallor(distalPallor(held));
}

function tourniquetOn(){
  const tq = ctx && ctx.tourniquet;
  return !!(tq && tq.securedAt && !tq.releasedAt);
}

function tourniquetSeconds(){
  const tq = ctx && ctx.tourniquet;
  if(!tq) return null;
  return (tq.accumulatedMs + (tq.securedAt ? (Date.now() - tq.securedAt) : 0))/1000;
}

function notify(){
  if(!ctx) return null;
  const result = evaluateCollection(ctx.state, {
    vessel: ctx.state.vessel,
    inVein: ctx.state.inVein && !ctx.state.needleOut,
    tourniquetOn: tourniquetOn(),
  });
  if(ctx.onChange) ctx.onChange(result);
  return result;
}

/* ---------- the holder's line, fixed once ---------------------------------------- */

/**
 * The rigid line the needle left behind it. Derived from the insert step's
 * own record — the entry point on the skin, the angle the skin was broken at,
 * and which way along the arm the tip was travelling — never re-measured, so
 * a tube pushed on cannot drift the holder somewhere the needle never was.
 *
 * @returns {{origin, into, out, side, entryTheta}} world vectors, `out` being
 *   the direction a tube travels coming OFF.
 */
function holderAxisFrom(view, ins){
  const entryX = ins.entryX == null ? 0 : ins.entryX;
  const entryZ = ins.entryZ == null ? 0 : ins.entryZ;
  const angle = (ins.angleDeg == null ? 20 : ins.angleDeg)*Math.PI/180;
  const dir = ins.depthDir == null ? 1 : (ins.depthDir < 0 ? -1 : 1);

  const r = view.arm.radiusAt(entryX);
  const theta = Math.asin(Math.max(-1, Math.min(1, entryZ/Math.max(1e-4, r))));
  const origin = view.limbToWorld(entryX, theta, r);

  // the skin's own outward normal at the entry point
  const n = new THREE.Vector3(0, Math.cos(theta), Math.sin(theta));
  const along = new THREE.Vector3(dir, 0, 0);

  // the needle went in travelling along the arm and descending into it
  const into = along.clone().multiplyScalar(Math.cos(angle))
    .addScaledVector(n, -Math.sin(angle)).normalize();
  const out = into.clone().negate();
  // across the axis, staying in the plane the camera can actually show
  const side = new THREE.Vector3().crossVectors(into, n).normalize();
  if(side.lengthSq() < 1e-8) side.set(0, 0, 1);

  return { origin, into, out, side, entryTheta: theta, entryX };
}

/** World position of the holder's mouth — where a tube goes in. */
function mouthWorld(){
  return ctx.axis.origin.clone().addScaledVector(ctx.axis.out, HOLDER_LEN);
}

/** Where the current tube's own mouth sits at a given seat depth. */
function tubeWorldAt(depth){
  return ctx.axis.origin.clone()
    .addScaledVector(ctx.axis.out, HOLDER_LEN - depth + TUBE_LEN*0.5);
}

/* ---------- the props ------------------------------------------------------------ */

function mat(color, o){
  const m = new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.7 }, o || {}));
  m.userData.perInstance = true;
  return m;
}

function tubeColour(key){
  return TUBES[key] ? TUBES[key].color : 0xbbbbbb;
}

function buildHolder(){
  const group = new THREE.Group();
  group.name = "collectionHolder";

  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(HOLDER_R, HOLDER_R, HOLDER_LEN*0.94, 18, 1, true),
    mat(0xe6ecf2, { roughness: 0.35, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
  );
  barrel.rotation.z = Math.PI/2;
  barrel.position.x = HOLDER_LEN*0.50;
  barrel.name = "barrel";
  group.add(barrel);

  // The flange: the two wings the fingers hook to push against. Its own mesh,
  // because grabbing it rather than the tube IS the braced technique and the
  // learner has to be able to see where it is.
  const flange = new THREE.Group();
  flange.name = "flange";
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(HOLDER_R*1.9, HOLDER_R*1.9, 0.0026, 20),
    mat(0xcdd8e4, { roughness: 0.5 })
  );
  disc.rotation.z = Math.PI/2;
  flange.add(disc);
  flange.position.x = HOLDER_LEN*FLANGE_AT;
  group.add(flange);

  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.0050, 0.0056, 0.010, 14), mat(0x2f8f5c, { roughness: 0.4 }));
  hub.rotation.z = Math.PI/2;
  hub.position.x = 0.006;
  group.add(hub);

  return { group, barrel, flange, hub };
}

function buildTube(){
  const group = new THREE.Group();
  group.name = "collectionTube";
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(TUBE_R, TUBE_R, TUBE_LEN, 18),
    mat(0xdfe6ec, { roughness: 0.15, transparent: true, opacity: 0.42 })
  );
  body.rotation.z = Math.PI/2;
  group.add(body);

  // the blood itself, scaled along the tube by how much has actually gone in
  const fluid = new THREE.Mesh(
    new THREE.CylinderGeometry(TUBE_R*0.92, TUBE_R*0.92, TUBE_LEN, 16),
    mat(0x8e1b1b, { roughness: 0.45 })
  );
  fluid.rotation.z = Math.PI/2;
  fluid.scale.x = 0.0001;
  group.add(fluid);

  const cap = new THREE.Mesh(new THREE.CylinderGeometry(TUBE_R*1.1, TUBE_R*1.1, 0.014, 18), mat(0xdc4b4b, { roughness: 0.55 }));
  cap.rotation.z = Math.PI/2;
  cap.position.x = -(TUBE_LEN/2) - 0.005;
  cap.name = "cap";
  group.add(cap);

  return { group, body, fluid, cap };
}

/**
 * The tubes this draw needs, standing in a rack on the bench in the canonical
 * order of draw. They are numbered, but the numbers are on the RACK — which
 * tube you reach for is still a decision, and reaching for the wrong one is
 * what carries additive through the needle.
 */
function buildRack(state, view){
  const group = new THREE.Group();
  group.name = "collectionRack";
  const n = Math.max(1, state.order.length);
  const w = RACK_PITCH*n + 0.016;

  const base = new THREE.Mesh(new THREE.BoxGeometry(w, 0.018, 0.040), mat(0xf0e9dc, { roughness: 0.8 }));
  base.position.set(RACK_X, BENCH_Y + 0.009, RACK_Z);
  group.add(base);

  const slots = {};
  state.order.forEach((key, i)=>{
    const x = RACK_X - w/2 + 0.008 + RACK_PITCH*(i + 0.5);
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(TUBE_R, TUBE_R, TUBE_LEN, 16),
      mat(0xdfe6ec, { roughness: 0.15, transparent: true, opacity: 0.42 })
    );
    body.position.y = TUBE_LEN/2;
    g.add(body);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(TUBE_R*1.1, TUBE_R*1.1, 0.014, 16), mat(tubeColour(key), { roughness: 0.55 }));
    cap.position.y = TUBE_LEN + 0.004;
    g.add(cap);
    g.position.set(x, BENCH_Y + 0.012, RACK_Z);
    group.add(g);
    slots[key] = { key, group: g, x, z: RACK_Z, y: BENCH_Y + 0.012 };
  });

  return { group, slots, benchY: BENCH_Y };
}

/* ---------- placement ------------------------------------------------------------ */

function placeHolder(){
  const g = ctx.holder.group;
  g.position.copy(ctx.axis.origin);
  // point the holder's local +X down its own outward axis
  g.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), ctx.axis.out);
}

function syncObjects(){
  if(!ctx) return;
  const cur = current(ctx.state);

  for(const key of Object.keys(ctx.rack.slots)){
    const t = ctx.state.tubes[key];
    // A tube in the hand is not also standing in the rack, and one that is
    // finished with is gone for good. One that came off short is NOT finished
    // with: another of the same kind is still there to be drawn again, and it
    // has to be reachable by hand as well as through the controls.
    const inHand = key === ctx.state.currentKey;
    const finished = !!(t && t.removedAt && !isRedrawable(t));
    ctx.rack.slots[key].group.visible = !inHand && !finished;
  }

  if(!cur && !ctx.carryKey){ ctx.tube.group.visible = false; return; }
  const key = ctx.carryKey || cur.key;
  ctx.tube.cap.material.color.setHex(tubeColour(key));

  const filled = cur ? Math.max(0.0001, cur.drawnMl/Math.max(1e-6, cur.volumeMl)) : 0.0001;
  ctx.tube.fluid.scale.x = filled;
  // the blood sits at the closed end, so the fluid grows away from the stopper
  ctx.tube.fluid.position.x = (TUBE_LEN/2)*(1 - filled);

  if(ctx.mode === "carry" && ctx.carryPos){
    ctx.tube.group.position.copy(ctx.carryPos);
    ctx.tube.group.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), ctx.axis.out);
  }else if(cur){
    ctx.tube.group.position.copy(tubeWorldAt(ctx.state.seatDepth));
    ctx.tube.group.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), ctx.axis.out);
  }
  ctx.tube.group.visible = true;
}

/* ---------- the seat axis, solved against a fixed basis ---------------------------- */

/**
 * Fixes the (along-the-holder, across-the-holder) basis by projecting three
 * KNOWN world points — never by inverse-solving a live one. See the header:
 * this is the only reading that stays exact for a hand held clear of the limb.
 */
function buildSeatBasis(canvasEl){
  const rect = canvasEl.getBoundingClientRect();
  const mouth = mouthWorld();
  const inStep = mouth.clone().addScaledVector(ctx.axis.into, BASIS_STEP);
  const sideStep = mouth.clone().addScaledVector(ctx.axis.side, BASIS_STEP);
  const p0 = ctx.view.toScreen(mouth, rect, new THREE.Vector3());
  const pI = ctx.view.toScreen(inStep, rect, new THREE.Vector3());
  const pS = ctx.view.toScreen(sideStep, rect, new THREE.Vector3());
  return {
    originX: p0.x, originY: p0.y,
    inX: pI.x - p0.x, inY: pI.y - p0.y,
    sideX: pS.x - p0.x, sideY: pS.y - p0.y,
  };
}

/**
 * The same 2x2 inverse pointerToLimb uses, evaluated once against exact
 * reference points instead of a continuously re-seeded live one.
 * @returns {{axialM, lateralM}} axialM: 0 at the holder's mouth, +ve pushed in
 */
function solveSeat(basis, screenX, screenY){
  const Dx = screenX - basis.originX, Dy = screenY - basis.originY;
  const Ax = basis.inX, Ay = basis.inY;
  const Bx = basis.sideX, By = basis.sideY;
  const det = Ax*By - Ay*Bx;
  if(Math.abs(det) < 1e-6) return { axialM: 0, lateralM: 0 };
  const a = (Dx*By - Dy*Bx)/det;
  const b = (Ax*Dy - Ay*Dx)/det;
  return { axialM: a*BASIS_STEP, lateralM: b*BASIS_STEP };
}

/* ---------- pointer --------------------------------------------------------------- */

function screenOf(worldVec, rect){
  return ctx.view.toScreen(worldVec, rect, new THREE.Vector3());
}

/** Which rack tube, if any, the pointer went down on. */
function rackTubeAt(e, rect){
  let best = null, bestD = GRAB_PX;
  for(const key of Object.keys(ctx.rack.slots)){
    const slot = ctx.rack.slots[key];
    if(!slot.group.visible) continue;
    const p = screenOf(new THREE.Vector3(slot.x, slot.y + TUBE_LEN*0.6, slot.z), rect);
    const d = Math.hypot(p.x - e.clientX, p.y - e.clientY);
    if(d < bestD){ bestD = d; best = key; }
  }
  return best;
}

/**
 * Whether the press landed on the holder's flange or on the tube's barrel.
 * This is not a cosmetic distinction — it decides how much of the push
 * reaches the patient, which is the whole technique.
 */
function gripAt(e, rect){
  const flange = screenOf(
    ctx.axis.origin.clone().addScaledVector(ctx.axis.out, HOLDER_LEN*FLANGE_AT), rect);
  const barrel = screenOf(tubeWorldAt(ctx.state.seatDepth), rect);
  const dF = Math.hypot(flange.x - e.clientX, flange.y - e.clientY);
  const dB = Math.hypot(barrel.x - e.clientX, barrel.y - e.clientY);
  return dF <= dB ? GRIP.FLANGE : GRIP.BODY;
}

export function collectionPointerDown(e, canvasEl){
  if(!isCollectionActive()) return false;
  const rect = canvasEl.getBoundingClientRect();

  if(!ctx.state.currentKey){
    const key = rackTubeAt(e, rect);
    if(!key) return false;
    try{ canvasEl.setPointerCapture(e.pointerId); }catch(_){}
    ctx.down = true;
    ctx.mode = "carry";
    ctx.carryKey = key;
    const slot = ctx.rack.slots[key];
    ctx.carryPos = new THREE.Vector3(slot.x, slot.y + TUBE_LEN*0.5, slot.z);
    // Rebuilt here rather than lazily: a real drag carries straight from the
    // rack into a push without ever letting go, and the very next move event
    // in that same gesture needs a basis to solve against.
    ctx.seatBasis = buildSeatBasis(canvasEl);
    syncObjects();
    tubeChink();
    tapHaptic();
    notify();
    return true;
  }

  try{ canvasEl.setPointerCapture(e.pointerId); }catch(_){}
  ctx.down = true;
  ctx.mode = "seat";
  ctx.state.grip = gripAt(e, rect);
  ctx.seatBasis = buildSeatBasis(canvasEl);
  const r = solveSeat(ctx.seatBasis, e.clientX, e.clientY);
  ctx.lastAxial = r.axialM;
  ctx.gestureAxial = 0;
  tapHaptic();
  notify();
  return true;
}

export function collectionPointerMove(e, canvasEl){
  if(!isCollectionActive() || !ctx.down) return isCollectionActive();
  const rect = canvasEl.getBoundingClientRect();

  if(ctx.mode === "carry"){
    // Carried at the holder's own working height, not the bench's: the tube
    // has been LIFTED out of the rack, and a plane down at bench level could
    // never bring it within reach of a mouth sitting ~10cm above it.
    const p = ctx.view.pointerToPlane({ x: e.clientX, y: e.clientY }, rect, mouthWorld().y);
    if(p) ctx.carryPos.copy(p);
    // close enough to the mouth and the tube goes in, and the same gesture
    // carries straight on as a push
    if(ctx.carryPos.distanceTo(mouthWorld()) <= CAPTURE_R){
      takeTube(ctx.state, ctx.carryKey);
      // takeTube refuses a tube that is finished with, and the gesture must
      // not silently become a push on nothing when it does
      if(!ctx.state.currentKey){ syncObjects(); notify(); return true; }
      ctx.carryKey = null;
      ctx.mode = "seat";
      // carried in by the barrel: there is nothing bracing the holder, which
      // is exactly the mistake a one-motion shove makes
      ctx.state.grip = GRIP.BODY;
      ctx.seatBasis = buildSeatBasis(canvasEl);
      ctx.lastAxial = solveSeat(ctx.seatBasis, e.clientX, e.clientY).axialM;
      ctx.gestureAxial = 0;
      tubeChink();
    }
    syncObjects();
    notify();
    return true;
  }

  if(!ctx.state.currentKey) return true;
  const r = solveSeat(ctx.seatBasis, e.clientX, e.clientY);
  const dAxial = r.axialM - (ctx.lastAxial == null ? r.axialM : ctx.lastAxial);
  ctx.lastAxial = r.axialM;
  ctx.gestureAxial += dAxial;
  const before = current(ctx.state);
  const wasPierced = before ? before.pierced : false;
  seat(ctx.state, dAxial, r.lateralM, ctx.state.grip);
  const after = current(ctx.state);
  if(after && after.pierced && !wasPierced){
    /* THE POP. Resistance, then a wet give — deliberately the same profile as
       the needle's own skin pop, because it is the same event: a stopper being
       pierced by a bevel. Then the vacuum takes over and its DECAY is the fill
       gauge; there is no bar and no timer, and when the hiss dies the flow has
       stopped and the player knows it without being told. */
    stopperPop();
    seatHaptic();
    if(!after.deadOnAir){
      if(!ctx.vacuum) ctx.vacuum = vacuumVoice();
      ctx.vacuum.set(1);
      duckRoom(0.2, 0.5);
    }
  }

  // Pulled clear of the mouth entirely — the tube is off. Judged on travel
  // WITHIN this gesture, never on where the pointer happens to be: a tube not
  // yet pushed on is grabbed well outside the mouth, and an absolute test
  // would read the very first frame of pushing it in as taking it off again.
  if(after && ctx.state.seatDepth <= 0 && ctx.gestureAxial < -0.004){
    removeTube(ctx.state, ctx.state.grip);
    ctx.mode = "idle";
    if(ctx.vacuum){ ctx.vacuum.stop(); ctx.vacuum = null; }
    // a small twist and a click, then the full tube goes back in the rack
    tubeRackClick();
    seatHaptic();
  }
  syncObjects();
  notify();
  return true;
}

export function collectionPointerUp(e, canvasEl){
  if(!isCollectionActive()) return false;
  try{ canvasEl.releasePointerCapture(e.pointerId); }catch(_){}

  if(ctx.mode === "carry" && ctx.carryKey){
    // let go short of the holder: it goes back in the rack, unused
    ctx.carryKey = null;
    ctx.mode = "idle";
    syncObjects();
  }
  ctx.down = false;
  ctx.lastAxial = null;
  ctx.gestureAxial = 0;
  notify();
  return true;
}

export function collectionPointerCancel(){
  if(!isCollectionActive()) return false;
  ctx.down = false;
  ctx.carryKey = null;
  if(!ctx.state.currentKey) ctx.mode = "idle";
  ctx.lastAxial = null;
  ctx.gestureAxial = 0;
  syncObjects();
  return true;
}

/* ---------- per-frame -------------------------------------------------------------- */

export function renderCollection(renderer, dt){
  if(!ctx) return false;
  // What the camera is following: a tube, from the moment it comes off the rack until it goes back.
  // See bench/handFraming.js — idempotent, so this is free per frame.
  ctx.view.hold(ctx.state.currentKey ? "tube" : "none");
  const aspect = viewportAspect(renderer);
  ctx.frame++;
  if(Math.abs(aspect - ctx.lastAspect) > 0.01 || ctx.frame % 30 === 0){
    // Framed to hold BOTH the holder standing out of the arm and the rack on
    // the bench in the same shot — the whole point of the step is that
    // reaching for the next tube and keeping the needle still are the same
    // piece of work, and a frame that shows only one of them hides that.
    ctx.view.fitCamera(aspect, measureObstruction(renderer), {
      lookX: ctx.axis.entryX - 0.020, lookZ: 0.086, lookY: ctx.view.ARM_Y + 0.045,
      spanX: 0.42, spanZ: 0.30,
    });
    ctx.lastAspect = aspect;
    // the reframe moves every screen projection, so a basis fixed against the
    // old frame would silently misread the pointer from here on
    if(ctx.mode !== "idle") ctx.seatBasis = buildSeatBasis(renderer.domElement);
  }

  // The vacuum does its work whether or not anything is being dragged — that
  // is the point of it. The learner's job is to watch and wait.
  const before = current(ctx.state);
  const drawnBefore = before ? before.drawnMl : 0;
  flow(ctx.state, dt || 0.016, tourniquetOn());
  const after = current(ctx.state);
  if(after && after.drawnMl !== drawnBefore){
    syncObjects();
    notify();
  }
  /* The hiss tracks how much vacuum is LEFT, so it starts strong and tails
     away as the tube fills. That decay is the player's cue to change tubes —
     the one piece of feedback in this step that has to be audible, because
     watching a meniscus climb a wall is not something a screen does well. */
  if(ctx.vacuum){
    if(after && after.pierced && !after.removedAt && after.volumeMl){
      ctx.vacuum.set(Math.max(0, 1 - after.drawnMl/after.volumeMl));
    }else{
      ctx.vacuum.stop(); ctx.vacuum = null;
    }
  }

  ctx.view.tick(dt || 0.016);
  renderer.render(ctx.view.scene, ctx.view.camera);
  return true;
}

/* ---------- programmatic (accessible path + tests) --------------------------------- */

function after(fn){
  if(!ctx) return null;
  fn(ctx.state);
  ctx.mode = ctx.state.currentKey ? "seat" : "idle";
  syncObjects();
  return notify();
}

export function takeTubeProgrammatically(key){
  return after(s => takeTube(s, key));
}
export function pushOnProgrammatically(grip){
  return after(s => pushOn(s, grip || GRIP.FLANGE));
}
export function backOffProgrammatically(){
  return after(s => backOffToGuideline(s));
}
export function removeTubeProgrammatically(grip){
  return after(s => removeTube(s, grip || GRIP.FLANGE));
}
export function returnTubeProgrammatically(){
  return after(s => returnTube(s));
}
export function discardTubeProgrammatically(){
  return after(s => discardTube(s));
}
export function waitProgrammatically(seconds){
  return after(s => {
    const step = 0.1;
    for(let t = 0; t < (seconds || 1); t += step) flow(s, step, tourniquetOn());
  });
}

/** What the bench looks like right now, for the coach. */
export function currentCollection(){
  if(!ctx) return null;
  return {
    mode: ctx.mode,
    carrying: !!ctx.carryKey,
    grip: ctx.state.grip,
    tourniquetOn: tourniquetOn(),
    tourniquetSeconds: tourniquetSeconds(),
  };
}
