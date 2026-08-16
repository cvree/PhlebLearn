/* =========================================================================
   ASSEMBLY RUNTIME — building the unit, at the bench, beside the patient.

   Same scene as every step since the tourniquet: the arm is right there, the
   band is still on it, and the field that was just cleaned is visibly drying
   at the top of frame. That is not scenery — the whole reason this step exists
   HERE is that a needle gets assembled inside the thirty seconds the alcohol
   needs, and you cannot feel that pressure looking at a different screen.

   THE GEOMETRY IS DELIBERATELY NOT THE LIMB'S. Everything on the arm has to
   go through pointerToLimb()'s cross-section solve, with all the front/back
   ambiguity that carries (see armScene.js). The bench does not: it is a known
   horizontal plane, so a pointer ray crossing it gives one exact world point.
   Alignment angles, thread turns and cap travel are therefore measured in
   real metres and real degrees off pointerToPlane(), with nothing inferred.

   Two steps share this file because they share the object. The unit the
   `assemble` step threads together is the unit the `uncap` step takes the
   sheath off — including, crucially, where the bevel ended up pointing when
   the threading stopped.
   ========================================================================= */
import * as THREE from "three";
import { tubeChink, safetyClack, wince, strapDrag } from "../../audio/procedural.js";
import { tapHaptic, clackHaptic, winceHaptic, seatHaptic } from "../../bench/haptics.js";
import { leaseBenchView } from "../../bench/benchSession.js";
import { veinDistension, distalPallor, SITE } from "../arm/armAnatomy.js";
import { FIELD_RADIUS, dryness, secondsDrying } from "../cleaning/cleaningRules.js";
import {
  evaluateAssembly, evaluateUncap, bevelFromTurns,
  SECURE_TURNS, SNUG_TURNS, OVERTIGHT_TURNS, CAP_TRAVEL,
} from "./assemblyRules.js";
import {
  axialTravel, seatingDelta, threadSpec, crossed, tickedPast,
} from "../../bench/seating.js";
import {
  createAssemblyState, CAP_PLACE,
  peel, liftNeedle, contaminate, engage, turn, releaseNeedle, backOut,
  beginUncap, pullCap, placeCap, recap, touchNeedle, rollBevel, inspectBevel,
  freshNeedle, discardUnit, warnPatient, threadIn, peelOpen,
} from "./assemblyState.js";
import { measureObstruction, viewportAspect } from "../viewport.js";

/* ---------- the bench work area, in metres ------------------------------------ */

/** The bench top. armMesh's armrest pad reads 0; the bench itself sits below. */
const BENCH_Y = -0.030;
/** The prep pad the unit is built on, in front of the arm. */
const PAD_Z = 0.146;
const PAD_HALF_X = 0.080;
const PAD_HALF_Z = 0.050;

/** The holder lies along the arm's own axis, hub end toward the hand. */
const HOLDER_X = 0.030;
const HOLDER_Z = PAD_Z - 0.022;      // the far half of the pad
const HOLDER_R = 0.0068;
const HUB_MOUTH_DX = -0.040;         // hub mouth, in the holder's local frame
const HOLDER_Y = BENCH_Y + HOLDER_R + 0.001;

/** The pouch, lying nearer the operator with its seam running along it. */
const POUCH_X = -0.034, POUCH_Z = PAD_Z + 0.024;
const POUCH_HALF_X = 0.044, POUCH_HALF_Z = 0.014;
const SEAM_Z = POUCH_Z - POUCH_HALF_Z;   // the seam runs along the far edge

const NEEDLE_LEN = 0.052;
/** Local x of the needle's leading (threaded, sleeved) tip. */
const NEEDLE_TIP_DX = 0.026;
/** Local x of the needle's patient tip, under the sheath. */
const NEEDLE_POINT_DX = -0.026;

/** How close the leading tip has to get to the hub mouth to catch the threads. */
const ENGAGE_R = 0.011;

/* The holder lies along the arm's own axis with its hub toward the hand, so a
   needle threads IN along +X. One straight push, in the direction the object
   itself goes. */
const HUB_AXIS = { x: 1, z: 0 };
const THREAD = threadSpec({
  secure: SECURE_TURNS, snug: SNUG_TURNS, overtight: OVERTIGHT_TURNS,
});
/** Metres of travel before the carried needle's heading is trusted. */
const HEADING_MIN = 0.0022;
/** Metres of drag that rolls the holder a full half-turn. */
const ROLL_DEG_PER_M = 4000;
/** Milliseconds of stillness on the holder that counts as looking at the tip. */
const INSPECT_HOLD_MS = 650;
/** Metres of movement that turns a hold into a roll. */
const HOLD_SLOP = 0.003;

/** Vacutainer hub colours, so the gauge is legible rather than labelled. */
const GAUGE_COLOUR = { 21: 0x2f8f5c, 22: 0x1a1a1a, 23: 0x2f6fbf, 25: 0xd07a2a };

let ctx = null;

/* ---------- lifecycle ---------------------------------------------------------- */

/**
 * @param {object} opts
 *   mode      "assemble" | "uncap"
 *   state     assemblyState, carried on the encounter
 *   arm, tourniquet, site, cleaning   the same patient every step has worked on
 *   onChange(result)
 */
export async function startAssembly(opts){
  const o = opts || {};
  const view = leaseBenchView({ mode: "assembly", arm: o.arm || {} });
  const state = o.state || createAssemblyState({});
  const mode = o.mode === "uncap" ? "uncap" : "assemble";
  if(mode === "uncap") beginUncap(state);

  const pad = buildPad();
  view.root.add(pad);

  const holder = buildHolder();
  view.root.add(holder.group);

  const needle = buildNeedle(state.gauge);
  view.root.add(needle.group);

  const pouch = buildPouch();
  view.root.add(pouch.group);

  const inspectCard = buildInspectCard();
  inspectCard.mesh.visible = false;
  view.root.add(inspectCard.mesh);

  ctx = {
    ...o,
    mode, view, state,
    pad, holder, needle, pouch, inspectCard,
    site: o.site && o.site.mark ? o.site.mark : { x: SITE.x, z: SITE.z },
    benchY: BENCH_Y,
    // the real positions of everything on the bench, so the accessible path
    // and the tests can reach for the same places a hand does
    anchors: {
      pad: { x: 0, z: PAD_Z, halfX: PAD_HALF_X, halfZ: PAD_HALF_Z },
      pouch: { x: POUCH_X, z: POUCH_Z, halfX: POUCH_HALF_X, halfZ: POUCH_HALF_Z },
      seam: { x0: POUCH_X - POUCH_HALF_X, x1: POUCH_X + POUCH_HALF_X, z: SEAM_Z },
      holder: { x: HOLDER_X, z: HOLDER_Z },
      hub: { x: HOLDER_X + HUB_MOUTH_DX, y: HOLDER_Y, z: HOLDER_Z },
      tipDx: NEEDLE_TIP_DX, engageRadius: ENGAGE_R,
    },
    grab: null,           // { kind, offset, ... }
    down: false,
    heading: null,
    headingFrom: null,
    holdFrom: null,
    holdAt: 0,
    active: true,
    frame: 0,
    lastAspect: 0,
  };

  if(o.tourniquet) applyBandToArm(o.tourniquet);
  if(o.cleaning && o.cleaning.strokes) ctx.prep = buildPrepDecal(view, ctx.site);
  view.setSiteVisible(false);

  syncObjects();
  notify();
  return ctx;
}

export function stopAssembly(){
  if(!ctx) return;
  if(ctx.prep) ctx.prep.dispose();
  if(ctx.inspectCard) ctx.inspectCard.dispose();
  ctx.view.dispose();
  ctx = null;
}

export function isAssemblyActive(){ return !!(ctx && ctx.active); }
export function getAssemblyContext(){ return ctx; }

function applyBandToArm(tq){
  const held = tq.heldTension || tq.tension || 0;
  const secs = (tq.accumulatedMs + (tq.securedAt ? (Date.now() - tq.securedAt) : 0))/1000;
  ctx.view.arm.setDistension(veinDistension(held, secs, 1));
  ctx.view.arm.setPallor(distalPallor(held));
}

function notify(){
  if(!ctx) return null;
  const result = ctx.mode === "uncap" ? evaluateUncap(ctx.state) : evaluateAssembly(ctx.state);
  if(ctx.onChange) ctx.onChange(result);
  return result;
}

/* ---------- the bench objects --------------------------------------------------- */

function mat(color, o){
  const m = new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.7 }, o || {}));
  m.userData.perInstance = true;
  return m;
}

function buildPad(){
  const g = new THREE.Group();
  g.name = "assemblyPad";
  const sheet = new THREE.Mesh(
    new THREE.BoxGeometry(PAD_HALF_X*2, 0.0016, PAD_HALF_Z*2),
    mat(0x9fb8cf, { roughness: 0.95 })
  );
  sheet.position.set(0, BENCH_Y + 0.0008, PAD_Z);
  g.add(sheet);
  return g;
}

/**
 * The holder: a barrel you drop tubes into, and a threaded hub at the far end
 * that the needle screws into. The hub is what everything in this step is
 * measured against, so it is real geometry at a real position.
 */
function buildHolder(){
  const group = new THREE.Group();
  group.name = "tubeHolder";
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(HOLDER_R, HOLDER_R, 0.070, 20, 1, true),
    new THREE.MeshStandardMaterial({
      color: 0xdfe7ef, roughness: 0.35, transparent: true, opacity: 0.62, side: THREE.DoubleSide,
    })
  );
  barrel.material.userData.perInstance = true;
  barrel.rotation.z = Math.PI/2;
  barrel.position.x = 0.005;
  group.add(barrel);

  const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.0105, 0.0105, 0.0035, 20), mat(0xcfd8e2));
  flange.rotation.z = Math.PI/2;
  flange.position.x = 0.040;
  group.add(flange);

  // the threaded hub — the thing the needle has to meet square on
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.0058, 0.0062, 0.010, 16), mat(0xb9c4d1));
  hub.rotation.z = Math.PI/2;
  hub.position.x = HUB_MOUTH_DX + 0.005;
  group.add(hub);

  group.position.set(HOLDER_X, HOLDER_Y, HOLDER_Z);
  return { group, barrel, hub };
}

/**
 * The needle. Three parts that matter and are told apart by eye: the coloured
 * sheath over the patient end, the gauge-coloured hub, and the grey rubber
 * sleeve over the end that goes inside the holder. Which of them the learner
 * takes hold of is the sterility lesson.
 */
function buildNeedle(gauge){
  const group = new THREE.Group();
  group.name = "multisampleNeedle";
  const colour = GAUGE_COLOUR[gauge] || GAUGE_COLOUR[21];

  const sheath = new THREE.Mesh(new THREE.CylinderGeometry(0.0046, 0.0040, 0.030, 14), mat(colour, { roughness: 0.5 }));
  sheath.rotation.z = Math.PI/2;
  sheath.position.x = -0.011;
  group.add(sheath);

  const hubBand = new THREE.Mesh(new THREE.CylinderGeometry(0.0058, 0.0058, 0.009, 16), mat(colour));
  hubBand.rotation.z = Math.PI/2;
  hubBand.position.x = 0.008;
  group.add(hubBand);

  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.0034, 0.0030, 0.014, 12), mat(0x8d8f93, { roughness: 0.9 }));
  sleeve.rotation.z = Math.PI/2;
  sleeve.position.x = 0.019;
  group.add(sleeve);

  // the bare shaft, hidden under the sheath until it comes off
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.00042, 0.00042, 0.026, 8), mat(0xd7dde3, { roughness: 0.2, metalness: 0.6 }));
  shaft.rotation.z = Math.PI/2;
  shaft.position.x = -0.013;
  shaft.visible = false;
  group.add(shaft);

  // the bevel: a real angled face at the tip, which is what gets rolled up
  const bevel = new THREE.Mesh(
    new THREE.CircleGeometry(0.00075, 12),
    new THREE.MeshStandardMaterial({ color: 0x6b7480, roughness: 0.25, metalness: 0.5, side: THREE.DoubleSide })
  );
  bevel.material.userData.perInstance = true;
  bevel.scale.set(1, 2.6, 1);
  bevel.rotation.y = -Math.PI/2;
  bevel.rotation.x = 0.55;
  bevel.position.set(NEEDLE_POINT_DX, 0, 0);
  bevel.visible = false;
  group.add(bevel);

  return { group, sheath, hubBand, sleeve, shaft, bevel };
}

function buildPouch(){
  const group = new THREE.Group();
  group.name = "needlePouch";
  const film = new THREE.Mesh(
    new THREE.BoxGeometry(POUCH_HALF_X*2, 0.0035, POUCH_HALF_Z*2),
    mat(0xf6f4ee, { roughness: 0.85 })
  );
  group.add(film);
  // the peelable backing, which retreats along the seam as it is peeled
  const lid = new THREE.Mesh(
    new THREE.BoxGeometry(POUCH_HALF_X*2, 0.0008, POUCH_HALF_Z*2),
    mat(0xe4ddcb, { roughness: 0.8 })
  );
  lid.position.y = 0.0022;
  group.add(lid);
  group.position.set(POUCH_X, BENCH_Y + 0.0035, POUCH_Z);
  return { group, film, lid };
}

/**
 * The close-up of the bevel. Held still on the holder, the learner "leans in"
 * and this card shows the tip large enough to see whether the edge is intact —
 * which is the only way a barbed needle is ever caught in real life.
 */
function buildInspectCard(){
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 192;
  const g = canvas.getContext("2d");
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false });
  material.userData.perInstance = true;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.055, 0.055), material);
  mesh.renderOrder = 20;
  return {
    mesh, canvas, g, tex,
    dispose(){ tex.dispose(); material.dispose(); mesh.geometry.dispose(); },
  };
}

function drawInspectCard(){
  const c = ctx.inspectCard;
  const g = c.g, W = c.canvas.width;
  g.clearRect(0, 0, W, W);
  g.fillStyle = "rgba(255,255,255,0.94)";
  g.beginPath(); g.arc(W/2, W/2, W/2 - 3, 0, Math.PI*2); g.fill();
  g.strokeStyle = "rgba(60,72,90,0.85)"; g.lineWidth = 3; g.stroke();

  const deg = ctx.state.bevelDeg == null ? bevelFromTurns(ctx.state.turns) : ctx.state.bevelDeg;
  g.save();
  g.translate(W/2, W/2 + 10);
  g.rotate(deg*Math.PI/180);

  // the shaft, seen end-on-ish, with the bevel's opening as an ellipse
  g.fillStyle = "#c9d2dc";
  g.fillRect(-9, 0, 18, 66);
  g.beginPath();
  g.ellipse(0, 0, 9, 26, 0, 0, Math.PI*2);
  g.fillStyle = "#5b6675";
  g.fill();
  g.beginPath();
  g.ellipse(0, -1, 6.5, 22, 0, 0, Math.PI*2);
  g.fillStyle = "#2c333d";
  g.fill();

  if(ctx.state.needleDamaged){
    // the turned-over edge, drawn as what it is: a hook on the cutting edge
    g.strokeStyle = "#b3352f";
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(-8, -24);
    g.quadraticCurveTo(-19, -30, -13, -40);
    g.stroke();
  }
  g.restore();

  g.fillStyle = ctx.state.needleDamaged ? "#b3352f" : "#2f7d5b";
  g.font = "bold 20px system-ui, sans-serif";
  g.textAlign = "center";
  g.fillText(ctx.state.needleDamaged ? "barbed" : `${Math.round(Math.abs(deg))}°`, W/2, 34);
  c.tex.needsUpdate = true;
}

/** The prep field, still visibly evaporating while the unit is built. */
function buildPrepDecal(view, site){
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const g = canvas.getContext("2d");
  g.fillStyle = "rgba(150,205,235,0.9)";
  g.beginPath(); g.arc(32, 32, 30, 0, Math.PI*2); g.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.5, depthWrite: false });
  material.userData.perInstance = true;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(FIELD_RADIUS*2, FIELD_RADIUS*2), material);
  mesh.rotation.x = -Math.PI/2;
  const r = view.arm.radiusAt(site.x);
  const theta = Math.asin(Math.max(-1, Math.min(1, site.z/r)));
  mesh.position.copy(view.limbToWorld(site.x, theta, r + 0.0008));
  view.root.add(mesh);
  return { mesh, dispose(){ tex.dispose(); material.dispose(); mesh.geometry.dispose(); } };
}

/* ---------- placing the objects from state -------------------------------------- */

/** World position of the holder's hub mouth — the target everything aims at. */
function hubMouth(){
  return new THREE.Vector3(HOLDER_X + HUB_MOUTH_DX, HOLDER_Y, HOLDER_Z);
}

function syncObjects(){
  if(!ctx) return;
  const s = ctx.state;

  // the pouch retreats as it is peeled, so the peel is visible progress
  const openFrac = s.pouchOpen ? 1 : s.peel;
  ctx.pouch.lid.scale.x = Math.max(0.02, 1 - openFrac);
  ctx.pouch.lid.position.x = POUCH_HALF_X*openFrac;
  ctx.pouch.group.visible = !s.needleInHand || !s.engaged;

  ctx.needle.group.visible = true;   // the film is clear — you can see what you are opening
  ctx.needle.sheath.visible = s.capOn;
  ctx.needle.shaft.visible = !s.capOn;
  ctx.needle.bevel.visible = !s.capOn;

  if(s.engaged || s.turns > 0 || ctx.mode === "uncap"){
    // seated on the holder: how far in is how far it has been turned
    const depth = Math.min(1, s.turns/SNUG_TURNS)*0.007;
    const m = hubMouth();
    ctx.needle.group.position.set(m.x - NEEDLE_TIP_DX + depth, m.y, m.z);
    ctx.needle.group.rotation.set(0, 0, 0);
    // a cross-threaded needle sits visibly canted, because it is
    ctx.needle.group.rotation.y = s.crossThreaded ? (s.engageMisalignDeg*Math.PI/180)*0.6 : 0;
    ctx.needle.group.rotation.x = (s.bevelDeg == null ? bevelFromTurns(s.turns) : s.bevelDeg)*Math.PI/180;
    ctx.holder.group.rotation.x = ctx.needle.group.rotation.x;
  }else if(s.needleInHand && ctx.carry){
    ctx.needle.group.position.copy(ctx.carry.pos);
    ctx.needle.group.rotation.set(0, ctx.carry.yaw, 0);
  }else{
    ctx.needle.group.position.set(POUCH_X, BENCH_Y + 0.0058, POUCH_Z);
    ctx.needle.group.rotation.set(0, 0, 0);
  }

  if(ctx.cap){
    ctx.needle.sheath.visible = false;
    ctx.cap.mesh.visible = true;
    ctx.cap.mesh.position.copy(ctx.cap.pos);
  }
}

/* ---------- pointer ------------------------------------------------------------- */

function benchPoint(e, canvasEl){
  const rect = canvasEl.getBoundingClientRect();
  return ctx.view.pointerToPlane({ x: e.clientX, y: e.clientY }, rect, BENCH_Y + 0.006);
}

function withinPouchSeam(p){
  return Math.abs(p.x - POUCH_X) <= POUCH_HALF_X + 0.008
      && Math.abs(p.z - SEAM_Z) <= 0.022;
}
function onNeedle(p){
  const n = ctx.needle.group.position;
  return Math.abs(p.x - n.x) <= NEEDLE_LEN/2 + 0.004 && Math.abs(p.z - n.z) <= 0.010;
}
function onHolder(p){
  return p.x >= HOLDER_X - 0.014 && p.x <= HOLDER_X + 0.046 && Math.abs(p.z - HOLDER_Z) <= 0.015;
}
function onCap(p){
  const n = ctx.needle.group.position;
  return Math.abs(p.x - (n.x - 0.011)) <= 0.020 && Math.abs(p.z - n.z) <= 0.010;
}

/**
 * Which part of the needle the fingers closed on. Sterility lives here: the
 * grey sleeve starts about 12 mm along from the middle, and it is the end that
 * goes inside the holder and into every tube drawn through it.
 */
function gripAt(p){
  const dx = p.x - ctx.needle.group.position.x;
  if(dx > 0.010) return "threadEnd";
  return "sheath";
}

export function assemblyPointerDown(e, canvasEl){
  if(!isAssemblyActive()) return false;
  const p = benchPoint(e, canvasEl);
  if(!p) return false;
  try{ canvasEl.setPointerCapture(e.pointerId); }catch(_){}
  ctx.down = true;
  const s = ctx.state;

  if(ctx.mode === "uncap"){
    // A sheath already off is a loose object on the bench: it can be picked up
    // again, but only by reaching for it. Grabbing it from anywhere would put
    // it in the hand every time the learner went to touch the holder.
    if(ctx.cap && p.distanceTo(ctx.cap.pos) < 0.016){
      ctx.grab = { kind: "carryCap" };
      return true;
    }
    if(s.capOn && onCap(p)){
      ctx.grab = { kind: "pullCap", from: p.clone(), z0: p.z };
      tapHaptic();
      return true;
    }
    if(onHolder(p)){
      ctx.grab = { kind: "holder", from: p.clone() };
      ctx.holdFrom = p.clone();
      ctx.holdAt = performance.now();
      return true;
    }
    ctx.grab = null;
    return true;
  }

  // assemble
  if(!s.pouchOpen){
    if(withinPouchSeam(p)){ ctx.grab = { kind: "peel", last: p.clone() }; strapDrag(); }
    else ctx.grab = null;
    return true;
  }
  if(s.engaged){
    ctx.grab = { kind: "thread", last: p.clone() };
    return true;
  }
  if(onNeedle(p)){
    const grip = gripAt(p);
    if(!s.needleInHand) liftNeedle(s, grip);
    else if(grip === "threadEnd") contaminate(s, "threadEnd");
    // carried from where it was actually picked up, so holding it by the
    // sheath really does present the other end to the hub
    const offset = ctx.needle.group.position.clone().sub(p).setY(0);
    ctx.carry = {
      pos: new THREE.Vector3(p.x + offset.x, BENCH_Y + 0.0058, p.z + offset.z),
      yaw: 0,
    };
    ctx.grab = { kind: "carry", offset };
    ctx.headingFrom = p.clone();
    if(grip === "sheath") tapHaptic(); else { wince(); winceHaptic(); }
    syncObjects();
    notify();
    return true;
  }
  ctx.grab = null;
  return true;
}

export function assemblyPointerMove(e, canvasEl){
  if(!isAssemblyActive()) return false;
  const p = benchPoint(e, canvasEl);
  if(!p) return true;
  const s = ctx.state;
  const g = ctx.grab;

  if(g && g.kind === "peel"){
    const dFrac = Math.max(0, (p.x - g.last.x)/(POUCH_HALF_X*2));
    peel(s, dFrac, p.z - SEAM_Z);
    g.last.copy(p);
    syncObjects(); notify();
    return true;
  }

  if(g && g.kind === "carry"){
    const off = g.offset || new THREE.Vector3();
    ctx.carry.pos.set(p.x + off.x, BENCH_Y + 0.0058, p.z + off.z);
    // The needle points the way it is being carried — which is exactly what
    // decides whether it meets the hub square. Below a threshold the heading
    // is held, so a jitter at rest does not spin it.
    const d = p.clone().sub(ctx.headingFrom);
    if(Math.hypot(d.x, d.z) > HEADING_MIN){
      ctx.carry.yaw = Math.atan2(-d.z, d.x);
      ctx.headingFrom = p.clone();
    }
    const tip = tipOf(ctx.carry.pos, ctx.carry.yaw);
    if(tip.distanceTo(hubMouth()) < ENGAGE_R){
      // the angle between the needle's own axis and the hub's (+X)
      const misalign = Math.abs(ctx.carry.yaw*180/Math.PI);
      engage(s, misalign > 180 ? 360 - misalign : misalign);
      ctx.grab = { kind: "thread", last: p.clone() };
      if(s.crossThreaded){ wince(); winceHaptic(); } else tubeChink();
    }
    syncObjects(); notify();
    return true;
  }

  if(g && g.kind === "thread"){
    /* ONE STRAIGHT PUSH, along the hub's own axis.

       This used to ask the learner to circle the pointer around the hub two
       and a half times. It corresponds to nothing a hand does — in life,
       pushing a needle onto a hub and turning it are ONE motion — and on a
       phone it was genuinely hard to perform at all.

       The model is untouched: turn() still takes turns, ATTACH/SECURE/SNUG/
       OVERTIGHT are the same numbers, the bevel still comes from wherever the
       threading stopped. Only what feeds turn() changed, from radians of
       pointer rotation to metres of axial drag. */
    const travel = axialTravel(g.last, p, HUB_AXIS);
    const before = s.turns;
    const d = seatingDelta(travel, s.turns, THREAD);
    if(d !== 0){
      turn(s, d);
      g.last.copy(p);
    }

    /* The stop is FELT. A click every half turn while it spins on freely, and
       a single thunk at finger-tight — which is a wall you can force past
       rather than a number to compare a caption against. */
    if(tickedPast(before, s.turns, 0.5)){ tubeChink(); tapHaptic(); }
    if(crossed(before, s.turns, SNUG_TURNS)){ safetyClack(); seatHaptic(); }
    if(crossed(before, s.turns, OVERTIGHT_TURNS)){ wince(); winceHaptic(); }

    // unscrewed right off: the only way back from a cross-thread, and backing
    // out is deliberately free — undoing a mistake is never harder than making
    // it, or a recoverable error becomes a dead end.
    if(s.crossThreaded && s.turns <= 0 && before > 0){
      backOut(s);
      ctx.grab = { kind: "carry" };
      ctx.carry = { pos: hubMouth().clone().setX(hubMouth().x - 0.02), yaw: 0 };
      ctx.headingFrom = p.clone();
      tapHaptic();
    }
    syncObjects(); notify();
    return true;
  }

  if(g && g.kind === "pullCap"){
    const dx = p.x - g.from.x, dz = p.z - g.from.z;
    // the needle's axis is +X; the sheath comes off in -X, away from the hub
    pullCap(s, -dx, dz, p.z - g.z0, 0);
    g.from.copy(p);
    if(!s.capOn && !ctx.cap){
      detachCap(p);
      if(s.needleDamaged){ wince(); winceHaptic(); } else { safetyClack(); clackHaptic(); }
    }
    syncObjects(); notify();
    return true;
  }

  if(g && g.kind === "carryCap"){
    ctx.cap.pos.set(p.x, BENCH_Y + 0.010, p.z);
    syncObjects();
    return true;
  }

  if(g && g.kind === "holder"){
    const moved = Math.hypot(p.x - ctx.holdFrom.x, p.z - ctx.holdFrom.z);
    if(moved > HOLD_SLOP){
      rollBevel(s, (p.z - g.from.z)*ROLL_DEG_PER_M);
      g.from.copy(p);
      ctx.holdAt = 0;               // it is a roll, not a look
      syncObjects(); notify();
    }
    return true;
  }
  return true;
}

export function assemblyPointerUp(e, canvasEl){
  if(!isAssemblyActive()) return false;
  try{ canvasEl.releasePointerCapture(e.pointerId); }catch(_){}
  const g = ctx.grab;
  const s = ctx.state;

  if(g && g.kind === "thread"){ releaseNeedle(s); }
  if(g && g.kind === "carryCap"){
    const p = benchPoint(e, canvasEl) || ctx.cap.pos;
    settleCap(p);
  }
  ctx.down = false;
  ctx.grab = null;
  syncObjects();
  notify();
  return true;
}

export function assemblyPointerCancel(){
  if(!isAssemblyActive()) return false;
  ctx.down = false;
  ctx.grab = null;
  return true;
}

/** The needle's leading tip, for a given centre and heading, in world metres. */
function tipOf(pos, yaw){
  return new THREE.Vector3(
    pos.x + Math.cos(yaw)*NEEDLE_TIP_DX,
    pos.y,
    pos.z - Math.sin(yaw)*NEEDLE_TIP_DX
  );
}

/**
 * The pointer's angle about the hub AS DRAWN. Screwing something in is a
 * wrist rotation; on a pointer the honest equivalent is a circular drag round
 * the thing being turned. Screen y runs downward, so a rising atan2 is
 * clockwise on screen — which is the direction that tightens.
 */
function detachCap(p){
  const colour = GAUGE_COLOUR[ctx.state.gauge] || GAUGE_COLOUR[21];
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.0046, 0.0040, 0.030, 14), mat(colour, { roughness: 0.5 }));
  m.rotation.z = Math.PI/2;
  ctx.view.root.add(m);
  ctx.cap = { mesh: m, pos: new THREE.Vector3(p.x, BENCH_Y + 0.010, p.z) };
  ctx.grab = { kind: "carryCap" };
}

/** Where the sheath was let go decides what it did. */
function settleCap(p){
  const s = ctx.state;
  const tip = new THREE.Vector3(ctx.needle.group.position.x + NEEDLE_POINT_DX, ctx.needle.group.position.y, ctx.needle.group.position.z);
  if(p.distanceTo(tip) < 0.014){
    recap(s);
    wince(); winceHaptic();
  }else if(Math.hypot(p.x - ctx.site.x, p.z - ctx.site.z) < FIELD_RADIUS + 0.012){
    placeCap(s, CAP_PLACE.SITE);
    if(ctx.onSiteRetouched) ctx.onSiteRetouched();
    wince(); winceHaptic();
  }else if(Math.abs(p.x) > 0.62 || p.z < -0.24 || p.z > 0.36){
    placeCap(s, CAP_PLACE.FLOOR);
    wince(); winceHaptic();
  }else if(Math.abs(p.x) <= PAD_HALF_X && Math.abs(p.z - PAD_Z) <= PAD_HALF_Z){
    placeCap(s, CAP_PLACE.TRAY);
    tapHaptic();
  }else{
    placeCap(s, CAP_PLACE.BENCH);
    tapHaptic();
  }
  if(ctx.cap){
    ctx.cap.pos.set(p.x, BENCH_Y + 0.005, p.z);
    if(s.recapped){ ctx.view.root.remove(ctx.cap.mesh); ctx.cap = null; }
  }
}

/* ---------- per-frame ------------------------------------------------------------ */

export function renderAssembly(renderer, dt){
  if(!ctx) return false;
  // What the camera is following: the needle while it is being carried, the unit once it is threaded.
  // See bench/handFraming.js — idempotent, so this is free per frame.
  ctx.view.hold((ctx.mode === "uncap" ? "holder" : (ctx.state.needleInHand && !ctx.state.engaged ? "needle" : "holder")));
  const aspect = viewportAspect(renderer);
  ctx.frame++;
  if(Math.abs(aspect - ctx.lastAspect) > 0.01 || ctx.frame % 30 === 0){
    ctx.view.fitCamera(aspect, measureObstruction(renderer), {
      lookX: -0.012, lookZ: 0.088, lookY: BENCH_Y + 0.050,
      spanX: 0.40, spanZ: 0.30,
    });
    ctx.lastAspect = aspect;
  }

  // holding still on the holder is leaning in to look at the tip
  const now = performance.now();
  if(ctx.down && ctx.grab && ctx.grab.kind === "holder" && ctx.holdAt
     && now - ctx.holdAt > INSPECT_HOLD_MS && !ctx.state.capOn){
    if(!ctx.state.bevelInspected){ inspectBevel(ctx.state); tubeChink(); notify(); }
    // re-armed every frame the hand stays put, so it lasts exactly as long as
    // the learner keeps looking
    ctx.inspectUntil = now + 300;
  }
  if(ctx.inspectCard){
    const on = now < (ctx.inspectUntil || 0) && !ctx.state.capOn;
    if(on){
      drawInspectCard();
      const n = ctx.needle.group.position;
      ctx.inspectCard.mesh.position.set(n.x + NEEDLE_POINT_DX, BENCH_Y + 0.072, HOLDER_Z - 0.012);
      ctx.inspectCard.mesh.quaternion.copy(ctx.view.camera.quaternion);
    }
    ctx.inspectCard.mesh.visible = on;
  }

  if(ctx.prep && ctx.cleaning){
    ctx.prep.mesh.material.opacity = 0.5*(1 - dryness(secondsDrying(ctx.cleaning))*0.85);
    if(ctx.frame % 30 === 0) notify();     // the drying clock is the one thing that ticks
  }

  ctx.view.tick(dt || 0.016);
  renderer.render(ctx.view.scene, ctx.view.camera);
  return true;
}

/* ---------- programmatic (accessible path + tests) -------------------------------- */
/* Every one of these runs the SAME pure helper the drag runs, so the turns,
   the alignment and the travel that come out are identical. */

function after(fn){
  if(!ctx) return null;
  fn(ctx.state);
  syncObjects();
  return notify();
}

export function peelPouchOpen(torn){
  return after(s=>{ if(torn) peel(s, 1, 0.02); else peelOpen(s); });
}
export function liftNeedleBy(grip){ return after(s=>liftNeedle(s, grip)); }
export function threadNeedle(turns, misalignDeg){ return after(s=>threadIn(s, turns, misalignDeg)); }
export function backOutNeedle(){ return after(s=>backOut(s)); }
export function takeFreshNeedle(){ return after(s=>freshNeedle(s)); }
export function pullSheath(kind){
  return after(s=>{
    if(kind === "wiggle"){
      for(let i = 0; i < 8; i++) pullCap(s, CAP_TRAVEL/8, 0.007, i % 2 ? 0.007 : -0.007, 0);
    }else if(kind === "twist"){
      pullCap(s, CAP_TRAVEL, 0, 0, 40);
    }else{
      pullCap(s, CAP_TRAVEL, 0, 0, 0);
    }
  });
}
export function placeSheath(where){
  const r = after(s=>placeCap(s, where));
  if(where === CAP_PLACE.SITE && ctx && ctx.onSiteRetouched) ctx.onSiteRetouched();
  return r;
}
export function recapNeedle(){ return after(s=>recap(s)); }
export function setDownUnit(){ return after(s=>touchNeedle(s, "the bench")); }
export function rollUnit(deg){ return after(s=>rollBevel(s, deg)); }
export function lookAtBevel(){
  const r = after(s=>inspectBevel(s));
  if(ctx) ctx.inspectUntil = performance.now() + 1600;
  return r;
}
export function discardAndReplace(){ return after(s=>discardUnit(s)); }
export function tellPatient(){ return after(s=>warnPatient(s)); }

/** What the bench looks like right now, for the coach. */
export function currentUnit(){
  if(!ctx) return null;
  const s = ctx.state;
  return {
    mode: ctx.mode,
    grabbing: ctx.grab ? ctx.grab.kind : null,
    peel: s.peel,
    turns: s.turns,
    crossThreaded: s.crossThreaded,
    engageMisalignDeg: s.engageMisalignDeg,
    capOn: s.capOn,
    capInHand: !!ctx.cap && !s.capPlacedOn,
    bevelDeg: s.bevelDeg == null ? bevelFromTurns(s.turns) : s.bevelDeg,
    inspecting: performance.now() < (ctx.inspectUntil || 0),
    dryingSeconds: ctx.cleaning ? secondsDrying(ctx.cleaning) : null,
  };
}
