/* =========================================================================
   WITHDRAW, SAFETY AND SHARPS RUNTIME — the end of the draw, on the same arm,
   with the same objects every earlier branch left behind: the strap the
   tourniquet step secured, the holder-and-needle unit assembly built and
   insert put in, the gauze and the sharps container staged back at the cart.

   FOUR MODES, ONE SCENE. The four procedure ids (release, withdraw, safety,
   dispose) share this runtime exactly as fill/switch share collection's —
   in the patient's arm it is one continuous piece of work.

   THE GEOMETRY, all of it already proven elsewhere:

     THE TAIL     the secured band's tucked loop, drawn from the SAME state
                  the tourniquet branch wrote. Pulling it free is the same
                  gesture that step already used for error recovery.
     THE LINE     the holder is a rigid body on the line fixed when the skin
                  was broken (entry point, locked angle, depthDir) — the same
                  derivation collection used. Withdrawing is travelling OUT
                  along it, so the pointer is solved against a fixed basis
                  built by projecting three exactly-known world points
                  through toScreen() — the one reading that stays exact for
                  a hand held clear of the limb (see the arm-projection
                  notes; this is its third use).
     THE BENCH    gauze, the sharps container and the waste bin sit on a
                  known horizontal plane, so pointerToPlane gives one exact
                  world point for every carry — same as staging and assembly.

   Owns interaction. It writes withdrawalState and asks withdrawalRules; it
   never decides correctness itself.
   ========================================================================= */
import * as THREE from "three";
import { sfx } from "../../audio/audioManager.js";
import { buildArmScene } from "../arm/armScene.js";
import { veinDistension, distalPallor, SHOULDER_X, HAND_X } from "../arm/armAnatomy.js";
import { ARM_Y } from "../arm/armMesh.js";
import { buildStrap, contactArc, freeTail } from "../tourniquet/strapMesh.js";
import { markReleased, isSecured } from "../tourniquet/tourniquetState.js";
import { evaluateWithdrawal } from "./withdrawalRules.js";
import {
  createWithdrawalState, relaxFist, reachDisturbance, markBandReleased,
  takeGauze, placeGauze, sampleWithdraw, withdrawSmoothly, withdrawRoughly,
  slideSafety, activateSafetyCleanly, attemptRecap, setDownUnit,
  disposeUnit, markCrossedPatient,
} from "./withdrawalState.js";

/** The bench top, shared with the assembly and collection branches. */
const BENCH_Y = -0.030;
/** Where the props stand. The sharps container is on the near side, in reach. */
const GAUZE_SPOT = { x: -0.055, z: 0.140 };
const SHARPS_SPOT = { x: 0.092, z: 0.168 };
const TRASH_SPOT = { x: -0.165, z: 0.175 };

/** The unit's dimensions — the same numbers collection drew the holder with. */
const HOLDER_LEN = 0.062;
const HOLDER_R = 0.0082;
const FLANGE_AT = 0.97;
const NEEDLE_LEN = 0.030;
/** Metres of shield travel from parked to locked. */
const SHIELD_TRAVEL_M = 0.024;

/** The local basis is built from a 10mm step in each direction. */
const BASIS_STEP = 0.010;
/** Screen pixels within which a press counts as grabbing that thing. */
const GRAB_PX = 46;
/** Pixels of tail travel that pull the band free. */
const TAIL_RELEASE_PX = 56;
/** Metres around the site within which resting gauze is "over the site". */
const GAUZE_DROP_R = 0.055;
/** Metres from the aperture within which a released unit goes in. */
const BIN_CAPTURE_R = 0.030;
const TRASH_CAPTURE_R = 0.035;
/** Where the unit hovers once it is out of the arm. */
const HAND_HOVER = { x: 0.010, y: ARM_Y + 0.085, z: 0.085 };

let ctx = null;

/* ---------- lifecycle -------------------------------------------------------- */

/**
 * @param {object} opts
 *   mode        "release" | "withdraw" | "safety" | "dispose"
 *   state       an existing withdrawalState to resume, or null for a new one
 *   arm         {skin, build, armSide, scenarioKeys, vigour, shirt}
 *   insert      the insertState — the entry line the unit sits on
 *   collection  the collectionState — whether a tube is still engaged
 *   tourniquet  the same band, still on the arm until THIS branch takes it off
 *   guided      teaching mode
 *   onChange(result)
 */
export async function startWithdrawal(opts){
  const o = opts || {};
  const view = buildArmScene(o.arm || {});
  const state = o.state || createWithdrawalState({});

  const axis = holderAxisFrom(view, o.insert || {});

  const unit = buildUnit();
  view.root.add(unit.group);

  const gauze = buildGauze();
  gauze.group.position.set(GAUZE_SPOT.x, BENCH_Y + 0.0035, GAUZE_SPOT.z);
  view.root.add(gauze.group);

  const bin = buildSharps();
  bin.group.position.set(SHARPS_SPOT.x, BENCH_Y, SHARPS_SPOT.z);
  view.root.add(bin.group);

  const trash = buildTrash();
  trash.group.position.set(TRASH_SPOT.x, BENCH_Y, TRASH_SPOT.z);
  view.root.add(trash.group);

  const strap = buildStrap({});
  view.root.add(strap.group);

  ctx = {
    ...o,
    mode: o.mode || "release",
    view, state, axis, unit, gauze, bin, trash, strap,
    down: false,
    drag: null,           // {kind:"tail"|"gauze"|"withdraw"|"shield"|"unit", ...}
    basis: null,
    gauzeCarry: null,     // live carry position while the pad is in the hand
    unitCarry: null,      // live carry position while the unit is in the hand
    unitParked: null,     // where a set-down left it, or null
    lastT: null,
    active: true,
    frame: 0,
    lastAspect: 0,
  };

  applyBandToArm();
  refreshStrap();
  view.setSiteVisible(false);
  syncObjects();
  notify();
  return ctx;
}

export function stopWithdrawal(){
  if(!ctx) return;
  ctx.strap.dispose();
  ctx.view.dispose();
  ctx = null;
}

export function isWithdrawalActive(){ return !!(ctx && ctx.active); }
export function getWithdrawalContext(){ return ctx; }

/* ---------- shared context ---------------------------------------------------- */

function tourniquetReleased(){
  const tq = ctx && ctx.tourniquet;
  return !tq || !!tq.releasedAt || !isSecured(tq);
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
function tubeOnHolder(){
  return !!(ctx && ctx.collection && ctx.collection.currentKey);
}
function collectionDone(){
  const col = ctx && ctx.collection;
  if(!col) return true;
  return (col.order || []).every(k => col.tubes[k] && col.tubes[k].removedAt);
}

function evalCtx(){
  return {
    tourniquetReleased: tourniquetReleased(),
    tourniquetOn: tourniquetOn(),
    tourniquetSeconds: tourniquetSeconds(),
    collectionDone: collectionDone(),
    tubeOnHolder: tubeOnHolder(),
  };
}

function notify(){
  if(!ctx) return null;
  const result = evaluateWithdrawal(ctx.state, evalCtx());
  if(ctx.onChange) ctx.onChange(result);
  return result;
}

function applyBandToArm(){
  const tq = ctx.tourniquet;
  if(!tq || !tourniquetOn()){
    ctx.view.arm.setDistension(0);
    ctx.view.arm.setPallor(0);
    return;
  }
  const held = tq.heldTension || tq.tension || 0;
  const secs = tourniquetSeconds() || 0;
  ctx.view.arm.setDistension(veinDistension(held, secs, 1));
  ctx.view.arm.setPallor(distalPallor(held));
}

/* ---------- the band, drawn from the tourniquet branch's own state -------------- */

const END_GAP = 0.30*Math.PI;
const MAX_BITE = 0.008;

function limbRadius(x){ return ctx.view.arm.radiusAt(x); }

/** Where the tucked tail sits — the same point the tourniquet branch drew it at. */
function tailWorld(){
  const tq = ctx.tourniquet;
  if(!tq || tq.bandX == null) return null;
  const r = limbRadius(tq.bandX);
  const dir = tq.tuck === "distal" ? -1 : 1;
  return new THREE.Vector3(tq.bandX + dir*0.052, ARM_Y + r*0.86, 0.012);
}

function refreshStrap(){
  const tq = ctx.tourniquet;
  if(!tq || tq.bandX == null || !tourniquetOn()){
    // off the patient: coiled loosely on the bench, where a released band lands
    if(tq && tq.releasedAt){
      const pts = [];
      for(let i = 0; i < 22; i++){
        const t = i/21;
        pts.push(new THREE.Vector3(
          -0.02 + t*0.13,
          BENCH_Y + 0.004 + Math.sin(t*Math.PI)*0.002,
          0.115 + Math.sin(t*Math.PI*1.7)*0.009
        ));
      }
      ctx.strap.setCenterline(pts, { twist: 0 });
      ctx.strap.setStretch(0);
      ctx.strap.setVisible(true);
    }else{
      ctx.strap.setVisible(false);
    }
    return;
  }
  const r = limbRadius(tq.bandX);
  const under = tq.wrap !== "over";
  const from = under ? END_GAP : -(2*Math.PI - END_GAP);
  const to = under ? (2*Math.PI - END_GAP) : END_GAP;
  const bite = MAX_BITE*(tq.heldTension || 0);
  const arc = contactArc({
    bandX: tq.bandX, radius: r, armY: ARM_Y,
    from, to, skew: tq.skew*(under ? 1 : -1), bite, segments: 44,
  });
  const anchorEnd = new THREE.Vector3(tq.bandX, ARM_Y + Math.cos(END_GAP)*(r + 0.030), Math.sin(END_GAP)*(r + 0.030));
  const tail = tailWorld();
  const head = freeTail(arc[0], anchorEnd, 0.25, 8).reverse();
  const tailPts = freeTail(arc[arc.length - 1], ctx.drag && ctx.drag.kind === "tail" && ctx.drag.heldPoint
    ? ctx.drag.heldPoint : tail, 0.25, 10);
  ctx.strap.setCenterline(head.concat(arc, tailPts), { twist: 0 });
  ctx.strap.setStretch(tq.heldTension || 0);
  ctx.strap.setVisible(true);
}

/* ---------- the holder's line, fixed once — same derivation as collection ------- */

function holderAxisFrom(view, ins){
  const entryX = ins.entryX == null ? 0 : ins.entryX;
  const entryZ = ins.entryZ == null ? 0 : ins.entryZ;
  const angle = (ins.angleDeg == null ? 20 : ins.angleDeg)*Math.PI/180;
  const dir = ins.depthDir == null ? 1 : (ins.depthDir < 0 ? -1 : 1);

  const r = view.arm.radiusAt(entryX);
  const theta = Math.asin(Math.max(-1, Math.min(1, entryZ/Math.max(1e-4, r))));
  const origin = view.limbToWorld(entryX, theta, r);

  const n = new THREE.Vector3(0, Math.cos(theta), Math.sin(theta));
  const along = new THREE.Vector3(dir, 0, 0);
  const into = along.clone().multiplyScalar(Math.cos(angle))
    .addScaledVector(n, -Math.sin(angle)).normalize();
  const out = into.clone().negate();
  const side = new THREE.Vector3().crossVectors(into, n).normalize();
  if(side.lengthSq() < 1e-8) side.set(0, 0, 1);

  return { origin, into, out, side, entryX, sinAngle: Math.sin(Math.max(0.02, angle)) };
}

/* ---------- the props ------------------------------------------------------------ */

function mat(color, o){
  const m = new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.7 }, o || {}));
  m.userData.perInstance = true;
  return m;
}

/**
 * The holder-and-needle unit, with the needle's exposed shaft and the safety
 * shield that has to travel over it. Local +X runs OUT along the holder —
 * the same convention collection's holder used.
 */
function buildUnit(){
  const group = new THREE.Group();
  group.name = "withdrawalUnit";

  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(HOLDER_R, HOLDER_R, HOLDER_LEN*0.94, 18, 1, true),
    mat(0xe6ecf2, { roughness: 0.35, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
  );
  barrel.rotation.z = Math.PI/2;
  barrel.position.x = HOLDER_LEN*0.50;
  group.add(barrel);

  const flange = new THREE.Mesh(
    new THREE.CylinderGeometry(HOLDER_R*1.9, HOLDER_R*1.9, 0.0026, 20),
    mat(0xcdd8e4, { roughness: 0.5 })
  );
  flange.rotation.z = Math.PI/2;
  flange.position.x = HOLDER_LEN*FLANGE_AT;
  group.add(flange);

  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.0050, 0.0056, 0.010, 14), mat(0x2f8f5c, { roughness: 0.4 }));
  hub.rotation.z = Math.PI/2;
  hub.position.x = 0.004;
  group.add(hub);

  // the needle itself, pointing INTO the patient along local -X
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.00042, 0.00042, NEEDLE_LEN, 8),
    mat(0xd7dde3, { roughness: 0.2, metalness: 0.5 })
  );
  shaft.rotation.z = Math.PI/2;
  shaft.position.x = -NEEDLE_LEN/2;
  group.add(shaft);

  // The safety shield: parked back against the hub, slid out along the shaft
  // until it swallows the tip and locks. Its own mesh, because operating it
  // IS the safety step and the learner has to be able to see where it is.
  const shield = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0028, 0.0032, NEEDLE_LEN*0.9, 12, 1, true),
    mat(0xe8863a, { roughness: 0.5, side: THREE.DoubleSide })
  );
  shield.rotation.z = Math.PI/2;
  shield.name = "shield";
  group.add(shield);

  return { group, barrel, flange, hub, shaft, shield };
}

function buildGauze(){
  const group = new THREE.Group();
  group.name = "withdrawalGauze";
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.006, 0.024), mat(0xf7f7f2, { roughness: 0.95 }));
  group.add(pad);
  return { group, pad };
}

function buildSharps(){
  const group = new THREE.Group();
  group.name = "withdrawalSharps";
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.062, 0.045), mat(0xd8b12c, { roughness: 0.6 }));
  body.position.y = 0.031;
  group.add(body);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.056, 0.006, 0.049), mat(0xb4901e, { roughness: 0.6 }));
  lid.position.y = 0.065;
  group.add(lid);
  const aperture = new THREE.Mesh(
    new THREE.BoxGeometry(0.034, 0.004, 0.014),
    new THREE.MeshBasicMaterial({ color: 0x1c1c22 })
  );
  aperture.material.userData.perInstance = true;
  aperture.position.y = 0.069;
  aperture.name = "aperture";
  group.add(aperture);
  return { group, body, lid, aperture };
}

function buildTrash(){
  const group = new THREE.Group();
  group.name = "withdrawalTrash";
  const can = new THREE.Mesh(
    new THREE.CylinderGeometry(0.024, 0.020, 0.055, 16, 1, true),
    mat(0x9aa4ad, { roughness: 0.6, side: THREE.DoubleSide })
  );
  can.position.y = 0.0275;
  group.add(can);
  return { group, can };
}

/* ---------- placement -------------------------------------------------------------- */

/** How far out along the line the unit has travelled so far. */
function unitAxialOffset(){
  const s = ctx.state;
  return Math.max(0, (s.startDepthM - s.depthM))/ctx.axis.sinAngle;
}

function apertureWorld(){
  return new THREE.Vector3(SHARPS_SPOT.x, BENCH_Y + 0.069, SHARPS_SPOT.z);
}
function trashWorld(){
  return new THREE.Vector3(TRASH_SPOT.x, BENCH_Y + 0.055, TRASH_SPOT.z);
}

function syncObjects(){
  if(!ctx) return;
  const s = ctx.state;
  const g = ctx.unit.group;

  if(s.disposedAt != null && s.disposedFully){
    g.visible = false;
  }else if(ctx.unitCarry){
    g.visible = true;
    g.position.copy(ctx.unitCarry);
    g.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), ctx.axis.out);
  }else if(s.disposedAt != null && !s.disposedFully){
    g.visible = true;
    const a = apertureWorld();
    g.position.set(a.x, a.y + 0.008, a.z);
    g.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0));
  }else if(ctx.unitParked){
    g.visible = true;
    g.position.copy(ctx.unitParked);
    g.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0.96, 0.28, 0));
  }else if(s.withdrawnAt == null){
    // still on the line the insert step fixed, moved out by what has been withdrawn
    g.visible = true;
    g.position.copy(ctx.axis.origin).addScaledVector(ctx.axis.out, unitAxialOffset());
    g.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), ctx.axis.out);
  }else{
    // out of the arm, held in the hand
    g.visible = true;
    g.position.set(HAND_HOVER.x, HAND_HOVER.y, HAND_HOVER.z);
    g.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), ctx.axis.out);
  }

  // the shield rides its travel out along the shaft
  ctx.unit.shield.position.x = -NEEDLE_LEN*0.45*Math.max(0, Math.min(1, s.safetyTravel)) - 0.002;
  ctx.unit.shield.material.color.setHex(s.safetyLockedAt != null ? 0x3f8f6d : 0xe8863a);

  // gauze: on the bench, in the hand, or resting where it was placed
  if(ctx.gauzeCarry){
    ctx.gauze.group.position.copy(ctx.gauzeCarry);
  }else if(s.gauzePlacedAt != null && ctx.gauzePlacedWorld){
    ctx.gauze.group.position.copy(ctx.gauzePlacedWorld);
  }else if(s.gauzeTakenAt == null){
    ctx.gauze.group.position.set(GAUZE_SPOT.x, BENCH_Y + 0.0035, GAUZE_SPOT.z);
  }
}

/* ---------- fixed bases -------------------------------------------------------------- */

function toScreenOf(worldVec, rect){
  return ctx.view.toScreen(worldVec, rect, new THREE.Vector3());
}

/**
 * Fixes an (along-the-line, across-the-line) basis for the unit by projecting
 * three exactly-known world points through toScreen() — the third use of the
 * technique the insert approach and the tube seat both rely on. Origin is
 * wherever the unit's hub is RIGHT NOW, so the same solve serves the
 * withdrawal (line = the entry line) and the shield slide (line = the unit's
 * own axis wherever it is held).
 */
function buildLineBasis(canvasEl, origin, alongDir, sideDir){
  const rect = canvasEl.getBoundingClientRect();
  const p0 = toScreenOf(origin, rect);
  const pA = toScreenOf(origin.clone().addScaledVector(alongDir, BASIS_STEP), rect);
  const pS = toScreenOf(origin.clone().addScaledVector(sideDir, BASIS_STEP), rect);
  return {
    originX: p0.x, originY: p0.y,
    alongX: pA.x - p0.x, alongY: pA.y - p0.y,
    sideX: pS.x - p0.x, sideY: pS.y - p0.y,
  };
}

/** The same 2x2 inverse pointerToLimb uses, against the fixed references. */
function solveLine(basis, screenX, screenY){
  const Dx = screenX - basis.originX, Dy = screenY - basis.originY;
  const Ax = basis.alongX, Ay = basis.alongY;
  const Bx = basis.sideX, By = basis.sideY;
  const det = Ax*By - Ay*Bx;
  if(Math.abs(det) < 1e-6) return { alongM: 0, sideM: 0 };
  const a = (Dx*By - Dy*Bx)/det;
  const b = (Ax*Dy - Ay*Dx)/det;
  return { alongM: a*BASIS_STEP, sideM: b*BASIS_STEP };
}

/* ---------- picking ------------------------------------------------------------------- */

function screenDistTo(worldVec, e, rect){
  const p = toScreenOf(worldVec, rect);
  return Math.hypot(p.x - e.clientX, p.y - e.clientY);
}

function hubWorld(){
  return ctx.unit.group.visible
    ? ctx.unit.group.localToWorld(new THREE.Vector3(HOLDER_LEN*0.5, 0, 0))
    : null;
}
function shieldWorld(){
  return ctx.unit.group.visible
    ? ctx.unit.group.localToWorld(ctx.unit.shield.position.clone())
    : null;
}
function gauzeWorld(){
  return ctx.gauze.group.position.clone();
}

/* ---------- pointer ---------------------------------------------------------------------- */

/**
 * What the press landed on, decided by the STATE of the arm rather than by
 * which of the four step ids is running.
 *
 * This is the same principle the earlier branches settled on: the four ids are
 * one continuous piece of work, so a band still on the patient stays grabbable
 * in the withdraw step, and a needle still in the vein stays withdrawable in
 * the safety step. Gating on mode instead would mean a learner who reached the
 * safety step with the band still on had no way left to take it off — which is
 * both wrong clinically and a dead end in the interaction.
 *
 * @returns {{kind:string, world:THREE.Vector3}|null} the nearest live candidate
 */
function grabCandidate(e, rect){
  const s = ctx.state;
  const cands = [];

  const tail = tailWorld();
  if(tail && tourniquetOn()) cands.push({ kind: "tail", world: tail });

  // the gauze: on the bench to be picked up, or resting to be re-placed
  if(s.withdrawnAt == null) cands.push({ kind: "gauze", world: gauzeWorld() });

  const hub = hubWorld();
  const shield = shieldWorld();
  if(hub && s.withdrawnAt == null && s.depthM > 0){
    cands.push({ kind: "withdraw", world: hub });
  }
  if(shield && s.withdrawnAt != null && s.safetyLockedAt == null){
    cands.push({ kind: "shield", world: shield });
  }
  if(hub && s.withdrawnAt != null && s.disposedAt == null){
    // Once the shield is locked, taking hold of the unit means carrying it to
    // the container. While the sharp is still exposed, dragging it down onto
    // the bench and pushing is the against-a-surface activation — the
    // shortcut, available exactly when someone would actually reach for it.
    cands.push({ kind: s.safetyLockedAt != null ? "unit" : "unit-press", world: hub });
  }

  let best = null, bestD = GRAB_PX;
  for(const c of cands){
    const d = screenDistTo(c.world, e, rect);
    if(d < bestD){ bestD = d; best = c; }
  }
  return best;
}

export function withdrawalPointerDown(e, canvasEl){
  if(!isWithdrawalActive()) return false;
  const rect = canvasEl.getBoundingClientRect();
  const s = ctx.state;

  const hit = grabCandidate(e, rect);
  if(!hit) return false;

  try{ canvasEl.setPointerCapture(e.pointerId); }catch(_){}
  ctx.down = true;
  ctx.lastT = e.timeStamp || performance.now();

  const start = (extra)=>{
    ctx.drag = Object.assign({ kind: hit.kind, downX: e.clientX, downY: e.clientY }, extra || {});
    sfx("tap");
    return true;
  };

  switch(hit.kind){
    case "tail":
      return start({ travel: 0, lastX: e.clientX, lastY: e.clientY, heldPoint: hit.world.clone() });
    case "gauze":
      takeGauze(s, { itemId: s.gauzeItemId, clean: s.gauzeClean });
      ctx.gauzeCarry = hit.world.clone();
      syncObjects();
      notify();
      return start();
    case "withdraw":
      return start({ basis: buildLineBasis(canvasEl, hit.world, ctx.axis.out, ctx.axis.side), lastAlong: 0 });
    case "shield":
      return start({ basis: buildLineBasis(canvasEl, hit.world, ctx.axis.into, ctx.axis.side), lastAlong: 0, surface: false });
    case "unit-press":
      return start({ lastY: e.clientY });
    case "unit":
      ctx.unitParked = null;
      ctx.unitCarry = hit.world.clone();
      syncObjects();
      return start({ crossed: false, clear: false });
    default:
      ctx.down = false;
      return false;
  }
}

export function withdrawalPointerMove(e, canvasEl){
  if(!isWithdrawalActive()) return false;
  if(!ctx.down || !ctx.drag) return isWithdrawalActive();
  const rect = canvasEl.getBoundingClientRect();
  const d = ctx.drag;
  const s = ctx.state;
  const now = e.timeStamp || performance.now();
  const dtS = Math.max(0.008, (now - (ctx.lastT || now))/1000);
  ctx.lastT = now;

  if(d.kind === "tail"){
    d.travel += Math.hypot(e.clientX - d.lastX, e.clientY - d.lastY);
    d.lastX = e.clientX; d.lastY = e.clientY;
    // the tail follows the hand
    const p = ctx.view.pointerToPlane({ x: e.clientX, y: e.clientY }, rect, ARM_Y + 0.05);
    if(p) d.heldPoint = p;
    // a reach that strays over the holder jostles the needle it is attached to
    const hub = hubWorld();
    if(hub && s.withdrawnAt == null){
      const prox = screenDistTo(hub, e, rect);
      if(prox < GRAB_PX*1.2){
        reachDisturbance(s, (1 - prox/(GRAB_PX*1.2))*0.0022);
      }
    }
    if(d.travel > TAIL_RELEASE_PX) doRelease();
    refreshStrap();
    notify();
    return true;
  }

  if(d.kind === "gauze"){
    // carried at skin-top height, so a drop lands where the pointer points
    const p = ctx.view.pointerToPlane({ x: e.clientX, y: e.clientY }, rect,
      ARM_Y + limbRadius(ctx.axis.entryX) + 0.004);
    if(p) ctx.gauzeCarry = p;
    // Pressing down early is a deliberate second push on a pad that is
    // already resting by the site — never inferred from the first carry,
    // which legitimately passes over the arm on its way in. The push is
    // judged by the one honest depth cue this view has: the pointer driven
    // well inside the limb's silhouette, toward its axis.
    if(s.gauzePlacedAt != null && s.withdrawnAt == null){
      const ax = ctx.view.pointerToAxis({ x: e.clientX, y: e.clientY }, rect, ctx.axis.entryX, limbRadius(ctx.axis.entryX));
      if(ax){
        const overSite = Math.abs(ax.x - ctx.axis.entryX) < GAUZE_DROP_R;
        const pressing = Math.abs(ax.p)/ax.pMax <= 0.72;
        if(overSite && pressing){
          placeGauze(s, { offsetM: Math.abs(ax.x - ctx.axis.entryX), pressing: true });
          notify();
        }
      }
    }
    syncObjects();
    return true;
  }

  if(d.kind === "withdraw"){
    const r = solveLine(d.basis, e.clientX, e.clientY);
    const dAlong = r.alongM - (d.lastAlong == null ? r.alongM : d.lastAlong);
    d.lastAlong = r.alongM;
    const wasIn = s.withdrawnAt == null;
    sampleWithdraw(s, dAlong, r.sideM, dtS, { tubeOn: tubeOnHolder(), tourniquetOn: tourniquetOn() });
    if(wasIn && s.withdrawnAt != null){
      sfx("good");
      ctx.drag = null;
      ctx.down = false;
    }
    syncObjects();
    notify();
    return true;
  }

  if(d.kind === "shield"){
    const r = solveLine(d.basis, e.clientX, e.clientY);
    const dAlong = r.alongM - (d.lastAlong == null ? r.alongM : d.lastAlong);
    d.lastAlong = r.alongM;
    const wasLocked = s.safetyLockedAt != null;
    slideSafety(s, dAlong/SHIELD_TRAVEL_M, d.surface ? { surface: true } : null);
    if(!wasLocked && s.safetyLockedAt != null){
      sfx("good");
      ctx.drag = null;
      ctx.down = false;
    }
    syncObjects();
    notify();
    return true;
  }

  if(d.kind === "unit-press"){
    // carried down toward the bench: once the tip is at the surface, further
    // downward push operates the mechanism against it — the classic shortcut
    const p = ctx.view.pointerToPlane({ x: e.clientX, y: e.clientY }, rect, BENCH_Y + 0.012);
    if(p){
      ctx.unitCarry = new THREE.Vector3(p.x, Math.max(BENCH_Y + 0.010, ARM_Y + 0.02 - (e.clientY - d.lastY)*0.0006), p.z);
      const atBench = ctx.unitCarry.y <= BENCH_Y + 0.014;
      if(atBench && s.safetyLockedAt == null){
        const wasLocked = s.safetyLockedAt != null;
        slideSafety(s, Math.max(0, (e.clientY - d.lastY))*0.0009, { surface: true });
        if(!wasLocked && s.safetyLockedAt != null) sfx("click");
      }
      d.lastY = e.clientY;
    }
    syncObjects();
    notify();
    return true;
  }

  if(d.kind === "unit"){
    const p = ctx.view.pointerToPlane({ x: e.clientX, y: e.clientY }, rect, BENCH_Y + 0.075);
    if(p) ctx.unitCarry = p;
    // Carrying the sharp BACK across the patient's limb is a routing
    // decision. The carry necessarily starts over the arm — the needle was
    // just in it — so only re-entering the limb's region after having got
    // clear of it counts as crossing the patient.
    if(ctx.unitCarry){
      const overArm = ctx.unitCarry.x > HAND_X && ctx.unitCarry.x < SHOULDER_X
        && Math.abs(ctx.unitCarry.z) < limbRadius(ctx.unitCarry.x)*1.4;
      if(!overArm) d.clear = true;
      else if(d.clear && !d.crossed){
        d.crossed = true;
        markCrossedPatient(s);
      }
    }
    syncObjects();
    notify();
    return true;
  }

  return true;
}

export function withdrawalPointerUp(e, canvasEl){
  if(!isWithdrawalActive()) return false;
  try{ canvasEl.releasePointerCapture(e.pointerId); }catch(_){}
  const d = ctx.drag;
  ctx.drag = null;
  ctx.down = false;
  if(!d) return false;
  const rect = canvasEl.getBoundingClientRect();
  const s = ctx.state;

  if(d.kind === "tail"){
    refreshStrap();
    notify();
    return true;
  }

  if(d.kind === "gauze" && ctx.gauzeCarry){
    // wherever it was let go is where it rests
    const dx = ctx.gauzeCarry.x - ctx.axis.entryX;
    const dz = ctx.gauzeCarry.z - ctx.axis.origin.z;
    const offset = Math.hypot(dx, dz);
    if(offset <= GAUZE_DROP_R*1.6){
      ctx.gauzePlacedWorld = new THREE.Vector3(
        ctx.gauzeCarry.x,
        ctx.view.limbToWorld(ctx.gauzeCarry.x, 0, limbRadius(ctx.gauzeCarry.x)).y + 0.006,
        Math.max(0.012, ctx.gauzeCarry.z)
      );
      placeGauze(s, { offsetM: offset, pressing: false });
      sfx("click");
    }else{
      // let go somewhere on the bench: it rests there, not ready
      ctx.gauzePlacedWorld = new THREE.Vector3(ctx.gauzeCarry.x, BENCH_Y + 0.0035, Math.max(0.09, ctx.gauzeCarry.z));
      placeGauze(s, { offsetM: offset, pressing: false });
    }
    ctx.gauzeCarry = null;
    syncObjects();
    notify();
    return true;
  }

  if(d.kind === "unit-press"){
    ctx.unitCarry = null;
    syncObjects();
    notify();
    return true;
  }

  if(d.kind === "unit" && ctx.unitCarry){
    const dropped = ctx.unitCarry.clone();
    ctx.unitCarry = null;
    const dBin = dropped.distanceTo(apertureWorld());
    const dTrash = dropped.distanceTo(trashWorld());
    if(dBin <= BIN_CAPTURE_R){
      disposeUnit(s, { target: "sharps", fully: true, crossedPatient: d.crossed });
      sfx("good");
    }else if(dTrash <= TRASH_CAPTURE_R){
      disposeUnit(s, { target: "trash" });
      ctx.unitParked = new THREE.Vector3(TRASH_SPOT.x + 0.05, BENCH_Y + 0.008, TRASH_SPOT.z);
      sfx("bad");
    }else{
      // let go anywhere else: the sharp is now resting there
      disposeUnit(s, { target: "bench" });
      ctx.unitParked = new THREE.Vector3(dropped.x, BENCH_Y + 0.008, Math.max(0.06, dropped.z));
      sfx("click");
    }
    syncObjects();
    notify();
    return true;
  }

  notify();
  return true;
}

export function withdrawalPointerCancel(){
  if(!isWithdrawalActive()) return false;
  ctx.down = false;
  ctx.drag = null;
  ctx.gauzeCarry = null;
  ctx.unitCarry = null;
  syncObjects();
  refreshStrap();
  return true;
}

/* ---------- the release itself --------------------------------------------------------- */

function doRelease(){
  const s = ctx.state;
  if(s.releasedAt != null) return;
  const secs = tourniquetSeconds();
  markBandReleased(s, {
    byTail: true,
    collectionDone: collectionDone(),
    tourniquetSeconds: secs == null ? null : Math.round(secs*10)/10,
  });
  if(ctx.tourniquet) markReleased(ctx.tourniquet, { byTail: true });
  ctx.drag = null;
  ctx.down = false;
  applyBandToArm();
  refreshStrap();
  sfx("good");
}

/* ---------- per-frame ---------------------------------------------------------------------- */

export function renderWithdrawal(renderer, dt){
  if(!ctx) return false;
  const size = renderer.getSize(new THREE.Vector2());
  const aspect = size.x/Math.max(1, size.y);
  ctx.frame++;
  if(Math.abs(aspect - ctx.lastAspect) > 0.01 || ctx.frame % 30 === 0){
    // Framed to hold the arm, the unit and the containers on the bench in the
    // same shot — the whole point of point-of-use disposal is that the
    // container is already within the same reach as the arm.
    ctx.view.fitCamera(aspect, measureObstruction(renderer), {
      lookX: ctx.axis.entryX - 0.030, lookZ: 0.090, lookY: ctx.view.ARM_Y + 0.040,
      spanX: 0.46, spanZ: 0.31,
    });
    ctx.lastAspect = aspect;
    // the reframe moves every screen projection, so any basis fixed against
    // the old frame would silently misread the pointer from here on
    if(ctx.drag && ctx.drag.basis){
      const origin = ctx.drag.kind === "shield" ? shieldWorld() : hubWorld();
      if(origin){
        ctx.drag.basis = buildLineBasis(renderer.domElement, origin,
          ctx.drag.kind === "shield" ? ctx.axis.into : ctx.axis.out, ctx.axis.side);
        ctx.drag.lastAlong = null;
      }
    }
  }

  // the band's clock is the only thing that changes on its own, and it
  // changes the arm — distension decays as the sample hemoconcentrates
  if(tourniquetOn() && ctx.frame % 12 === 0){
    applyBandToArm();
    notify();
  }

  ctx.view.tick(dt || 0.016);
  renderer.render(ctx.view.scene, ctx.view.camera);
  return true;
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

/* ---------- programmatic (accessible path + tests) ------------------------------------------ */

function after(fn){
  if(!ctx) return null;
  fn(ctx.state);
  syncObjects();
  refreshStrap();
  return notify();
}

export function relaxFistProgrammatically(){
  return after(s => relaxFist(s));
}

/** The same release, through the same state, on the same strap. */
export function releaseBandProgrammatically(){
  if(!ctx) return null;
  doRelease();
  syncObjects();
  return notify();
}

export function takeGauzeProgrammatically(){
  return after(s => takeGauze(s, { itemId: s.gauzeItemId, clean: s.gauzeClean }));
}
export function placeGauzeProgrammatically(offsetM, pressing){
  return after(s => {
    placeGauze(s, { offsetM: offsetM == null ? 0.012 : offsetM, pressing: !!pressing });
    ctx.gauzePlacedWorld = new THREE.Vector3(
      ctx.axis.entryX - (offsetM == null ? 0.012 : offsetM), ARM_Y + limbRadius(ctx.axis.entryX) + 0.006, 0.02);
  });
}
export function withdrawProgrammatically(kind){
  return after(s => {
    const c = { tubeOn: tubeOnHolder(), tourniquetOn: tourniquetOn() };
    if(kind === "rough") withdrawRoughly(s, c);
    else withdrawSmoothly(s, c);
  });
}
export function slideSafetyProgrammatically(kind){
  return after(s => {
    if(kind === "surface") slideSafety(s, 1.001, { surface: true });
    else if(kind === "partial") slideSafety(s, 0.5);
    else activateSafetyCleanly(s);
  });
}
export function recapProgrammatically(){
  return after(s => attemptRecap(s));
}
export function setDownProgrammatically(){
  return after(s => {
    setDownUnit(s);
    ctx.unitParked = new THREE.Vector3(0.02, BENCH_Y + 0.008, 0.12);
  });
}
export function disposeProgrammatically(target, o){
  const opt = o || {};
  return after(s => {
    if(opt.crossed) markCrossedPatient(s);
    disposeUnit(s, { target: target || "sharps", fully: opt.fully !== false, crossedPatient: !!opt.crossed });
  });
}

/** What the bench looks like right now, for the coach and the test seam. */
export function currentWithdrawal(){
  if(!ctx) return null;
  return {
    mode: ctx.mode,
    tourniquetOn: tourniquetOn(),
    tourniquetSeconds: tourniquetSeconds(),
    tubeOnHolder: tubeOnHolder(),
    collectionDone: collectionDone(),
    carryingGauze: !!ctx.gauzeCarry,
    carryingUnit: !!ctx.unitCarry,
  };
}

/**
 * The real geometry a test needs to drive the whole sequence: where the
 * tail, the hub, the shield, the gauze and the containers are on screen, and
 * screen pixels per 10mm along and across the unit's own axis. All projected
 * through the SAME toScreen() the runtime's fixed bases are built from, so a
 * test drags exactly where the gesture reads.
 */
export function withdrawalAnchors(){
  if(!ctx) return null;
  const canvas = typeof document !== "undefined" ? document.querySelector("canvas") : null;
  if(!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const at = (w)=>{ const p = toScreenOf(w, rect); return { x: p.x, y: p.y }; };
  const hub = hubWorld();
  const shield = shieldWorld();
  const tail = tailWorld();
  const step = (origin, dir)=>{
    const a = at(origin.clone().addScaledVector(dir, 0.010));
    const o = at(origin);
    return { dx: a.x - o.x, dy: a.y - o.y };
  };
  return {
    mode: ctx.mode,
    tail: tail && tourniquetOn() ? at(tail) : null,
    hub: hub ? at(hub) : null,
    shield: shield ? at(shield) : null,
    gauze: at(gauzeWorld()),
    sharps: at(apertureWorld()),
    trash: at(trashWorld()),
    site: at(ctx.axis.origin.clone()),
    /** screen pixels per 10mm OUT along the unit's line, and across it */
    outPx: hub ? step(hub, ctx.axis.out) : null,
    sidePx: hub ? step(hub, ctx.axis.side) : null,
    /** per 10mm of shield travel (forward, toward the tip) */
    inPx: shield ? step(shield, ctx.axis.into) : null,
  };
}

/** Exact screen points for the things the gestures grab — for the test seam. */
export function withdrawalScreenPoint(kind){
  if(!ctx) return null;
  const canvas = typeof document !== "undefined" ? document.querySelector("canvas") : null;
  if(!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  let w = null;
  switch(kind){
    case "tail": w = tailWorld(); break;
    case "hub": w = hubWorld(); break;
    case "shield": w = shieldWorld(); break;
    case "gauze": w = gauzeWorld(); break;
    case "sharps": w = apertureWorld(); break;
    case "trash": w = trashWorld(); break;
    case "site": w = ctx.axis.origin.clone(); break;
    default: break;
  }
  if(!w) return null;
  const p = toScreenOf(w, rect);
  return { x: p.x, y: p.y };
}
