/* =========================================================================
   ANCHOR + INSERT RUNTIME — the climax, built like one.

   Everything else in this game exists to make this moment land, and the old
   implementation skipped its entire payload: the approach locked at
   CONTACT_HEIGHT = 0.002, the needle mesh froze, `markFlashIfInVein` set a
   flag, and a sound played. Resistance-then-release is the most reliable
   satisfying pattern in game feel, and venipuncture is that pattern, twice,
   naturally — and neither one was there.

   FIVE PHASES, one continuous gesture, each with its own visual, audio and
   resistance signature:

     1 ALIGN        the ghost silhouette shows the entry angle against the
                    skin line; the needle biases toward the chosen vein's own
                    axis once it is close; the room goes quiet and the camera
                    stops breathing.
     2 CONTACT      the tip meets skin. It tents and dimples, a small shadow
                    pools under it, and there is a soft dry tick.
     3 RESISTANCE   THE KEY TRICK: hand travel is decoupled from tip travel.
                    The skin stretches, the cursor moves visibly further than
                    the needle does, and a creak tightens as it loads.
     4 PENETRATION  sudden release. The skin snaps back around the shaft, the
                    tip lurches forward the distance it had been held back,
                    the camera kicks, and there is a crisp wet pop.
     5 VEIN ENTRY   the same shape again, lower and softer: the wall tents,
                    then gives. You are in.

   Between 4 and 5 there is a genuine window where the skin is broken and the
   vein is not. That is a dry stick, it feels like one — no flash, no bloom,
   the room stays loud — and it is a DECISION rather than a dead run, because
   a limited, graded redirect is allowed, exactly as real practice allows and
   limits it.

   The geometry underneath is unchanged and was already right: a fixed local
   basis, built once from three KNOWN world points projected forward, solved
   against by every subsequent raw pointer position. Forward projection has no
   ambiguity, which is exactly what a needle held clear of the limb needs.
   ========================================================================= */
import * as THREE from "three";
import { leaseBenchView } from "../../bench/benchSession.js";
import { veinDistension, distalPallor } from "../arm/armAnatomy.js";
import { evaluateInsert, depthBand } from "./insertRules.js";
import {
  createInsertState,
  pressAnchor, pullAnchor, lockAnchor, resetAnchor,
  breakSkin, advance, markFlashIfInVein, redirect, MAX_REDIRECTS,
} from "./insertState.js";
import { measureObstruction, viewportAspect } from "../viewport.js";
import {
  skinTick, skinPop, veinPop, skinCreak, flashChord, duckRoom,
} from "../../audio/procedural.js";
import { biasToAxis, assistLevel } from "../../bench/assist.js";
import {
  contactHaptic, skinPopHaptic, veinPopHaptic, flashHaptic, tapHaptic,
} from "../../bench/haptics.js";

/**
 * Where the needle starts: metres distal to the mark, metres above the skin.
 * A straight-line carry from here to the mark is atan(14/35) ≈ 22 degrees,
 * inside the ideal window — the obvious way to play it is also the clean one.
 */
export const READY_DISTAL = 0.035;
export const READY_HEIGHT = 0.014;
/** The local basis is built from a 10mm step in each direction. */
const BASIS_STEP = 0.010;
/** Metres of remaining clearance at which the tip is touching skin. */
const CONTACT_HEIGHT = 0.0020;
/** Metres of along-arm displacement too small to trust for an angle reading. */
const SAMPLE_MIN = 0.0004;

/**
 * How much of the hand's continued travel the skin absorbs before it gives.
 *
 * This is the whole of phase 3. The hand moves BREAK_STRETCH; the tip moves
 * TIP_FOLLOW of it. The player can see and feel the difference, and that
 * difference is what "being pushed rather than sliding" means on a screen.
 */
const BREAK_STRETCH = 0.0072;
const TIP_FOLLOW = 0.30;
/**
 * How far the tip lurches when the skin finally gives — CAPPED so that it
 * always stops short of the vessel's own near wall.
 *
 * Without the cap the two gives collapse into one. A median cubital sits about
 * 2.9 mm down with a near wall at 1.5 mm, and an uncapped 1.9 mm lurch put the
 * tip inside the lumen on the same frame the skin broke, so phase 5 never
 * happened and the flashback fired off the back of the skin pop. Landing in
 * tissue between the two is what gives the moment its shape.
 */
const LURCH_DEPTH = 0.0019;
/** Metres of tissue always left between the skin pop and the vein wall. */
const WALL_STANDOFF = 0.0005;

/** The vein wall does the same thing, over a shorter distance. */
const WALL_STRETCH = 0.0034;
const WALL_BAND = 0.0011;

/** Time dilation at the flashback, and how long it lasts. */
const DILATE_SCALE = 0.85;
const DILATE_SECONDS = 0.30;

let ctx = null;

/* ---------- lifecycle -------------------------------------------------------- */

export function startInsert(opts){
  const o = opts || {};
  const view = leaseBenchView({ mode: "insert", arm: o.arm || {} });
  const state = o.state || createInsertState({});

  const thumb = buildThumb();
  thumb.group.visible = false;
  view.root.add(thumb.group);

  const needle = buildNeedle();
  needle.group.visible = false;
  view.root.add(needle.group);

  const ghost = buildGhost();
  ghost.group.visible = false;
  view.root.add(ghost.group);

  const tent = buildTent();
  tent.group.visible = false;
  view.root.add(tent.group);

  // Which side of the arm the hover visual sits over. Not a measurement —
  // just a plausible fixed position near the marked vein so the needle reads
  // as "over the site" while it closes in.
  const markR = view.arm.radiusAt(state.markX);
  const hoverTheta = Math.asin(Math.max(-1, Math.min(1, state.markZ/markR)));

  ctx = {
    ...o,
    view, state, thumb, needle, ghost, tent,
    phase: state.anchorSet ? "insert" : "anchor",
    /** which of the five the gesture is in right now, for the coach and audio */
    beat: "align",
    hoverTheta,
    hoverThetaLive: hoverTheta,
    approachBasis: null,
    down: false,
    anchorLast: null,
    angleEMA: null,
    depthDir: 1,
    lastAlong: null,
    /** phases 3 and 5: how far the hand has pushed past the surface */
    stretch: 0,
    wallStretch: 0,
    creak: null,
    dilate: 0,
    flashAnim: -1,
    active: true,
    frame: 0,
    lastAspect: 0,
  };

  if(o.tourniquet) applyBandToArm(o.tourniquet);
  view.setSiteVisible(false);
  if(view.body){
    view.body.setWatching(true);
    // They know what is coming. Their breathing has already changed.
    view.body.setTension(0.45);
  }
  syncObjects();
  notify();
  return ctx;
}

export function stopInsert(){
  if(!ctx) return;
  stopCreak();
  ctx.view.setSway(1);
  ctx.view.setLean(0);
  ctx.view.dispose();
  ctx = null;
}

export function isInsertActive(){ return !!(ctx && ctx.active); }
export function getInsertContext(){ return ctx; }

function applyBandToArm(tq){
  const held = tq.heldTension || tq.tension || 0;
  const secs = (tq.accumulatedMs + (tq.securedAt ? (Date.now() - tq.securedAt) : 0))/1000;
  ctx.view.arm.setDistension(veinDistension(held, secs, 1));
  ctx.view.arm.setPallor(distalPallor(held));
}

function notify(){
  if(!ctx) return null;
  const result = evaluateInsert(ctx.state, ctx.view.arm.vessels, ctx.bevelDeg == null ? null : ctx.bevelDeg());
  if(ctx.onChange) ctx.onChange(result);
  return result;
}

function chosenVessel(){
  if(!ctx) return null;
  return (ctx.view.arm.vessels || []).find(v => v.id === ctx.state.chosenId) || null;
}

/* ---------- the props ------------------------------------------------------------ */

function mat(color, o){
  const m = new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.7 }, o || {}));
  m.userData.perInstance = true;
  return m;
}
function basic(o){
  const m = new THREE.MeshBasicMaterial(o);
  m.userData.perInstance = true;
  return m;
}

/**
 * The off-hand's thumb, holding the anchor.
 *
 * A gloved thumb, not a sphere: it lies ALONG the arm pointing distally,
 * because that is the direction it is pulling the skin, and a shape that shows
 * its own direction is the difference between "something is touching the arm"
 * and "the skin is being held taut toward the wrist".
 */
function buildThumb(){
  const group = new THREE.Group();
  group.name = "anchorThumb";
  const glove = mat(0xd6e5f3, { roughness: 0.46 });
  const pad = new THREE.Mesh(new THREE.CapsuleGeometry(0.0092, 0.020, 5, 14), glove);
  pad.rotation.z = Math.PI/2;
  pad.scale.set(1, 0.78, 1.05);
  pad.position.set(-0.008, 0.0055, 0);
  group.add(pad);
  const knuckle = new THREE.Mesh(new THREE.SphereGeometry(0.0105, 14, 10), glove);
  knuckle.scale.set(1.1, 0.86, 1.0);
  knuckle.position.set(-0.028, 0.0085, 0.002);
  group.add(knuckle);
  // the skin bunching just proximal of the pad, which is what traction looks like
  const bunch = new THREE.Mesh(
    new THREE.SphereGeometry(0.0075, 12, 8),
    mat(0xffffff, { roughness: 0.8, transparent: true, opacity: 0.16 })
  );
  bunch.scale.set(1.6, 0.28, 1.2);
  bunch.position.set(0.009, 0.0008, 0);
  group.add(bunch);
  return { group, pad, bunch };
}

/**
 * The needle, with its TIP at the group's origin and its body extending
 * DISTALLY — back toward the hand that is holding it.
 *
 * It used to be built the other way round, body toward the shoulder, which
 * meant the operator was implicitly holding it from the far side of the
 * patient. Nobody could see that while the arm lay across a side-on frame; it
 * became obvious the moment the camera moved behind the hand, because the
 * needle then pointed straight into the screen and effectively vanished.
 */
function buildNeedle(){
  const group = new THREE.Group();
  group.name = "insertNeedle";
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.00042, 0.00042, 0.030, 8), mat(0xd7dde3, { roughness: 0.2, metalness: 0.5 }));
  shaft.rotation.z = Math.PI/2;
  shaft.position.x = -0.014;
  group.add(shaft);

  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.0058, 0.0052, 0.011, 14), mat(0xdfe7ef, { roughness: 0.35, transparent: true, opacity: 0.85 }));
  hub.rotation.z = Math.PI/2;
  hub.position.x = -0.034;
  group.add(hub);

  /* THE BEVEL, made visible. It used to be inherited silently from wherever
     the assembly's thread happened to stop, four steps earlier, and shown
     nowhere — so a real, teachable property of the needle was effectively
     invisible. This is a facet that catches the key light when it is up, plus
     a printed orientation mark on the hub. */
  const bevel = new THREE.Mesh(
    new THREE.PlaneGeometry(0.0042, 0.0016),
    basic({ color: 0xfff0d0, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
  );
  bevel.rotation.x = -Math.PI/2;
  bevel.position.set(-0.0032, 0.00055, 0);
  group.add(bevel);
  const markMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.0016, 0.0020),
    basic({ color: 0x2f3a46, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })
  );
  markMesh.rotation.x = -Math.PI/2;
  markMesh.position.set(-0.0275, 0.0059, 0);
  group.add(markMesh);

  /* The flash chamber. Empty is a dull grey plug; the bloom fills it with real
     fluid volume rather than fading a colour up. */
  const chamber = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0030, 0.0030, 0.0092, 14),
    mat(0x9aa4b0, { roughness: 0.3, transparent: true, opacity: 0.45 })
  );
  chamber.rotation.z = Math.PI/2;
  chamber.position.x = -0.034;
  group.add(chamber);

  const blood = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0027, 0.0027, 0.0090, 14),
    mat(0x8c1420, { roughness: 0.28, metalness: 0.05 })
  );
  blood.rotation.z = Math.PI/2;
  blood.position.x = -0.0296;
  blood.scale.x = 0.001;
  group.add(blood);

  return { group, shaft, hub, bevel, mark: markMesh, chamber, blood };
}

/**
 * The angle readout: a silhouette, not a number.
 *
 * A thin coloured line against the skin's own line, drawn at the entry point.
 * The player learns to read the SHAPE — a sliver is too shallow, a wide wedge
 * too steep — which is how the angle is judged at a real bedside, and it
 * teaches something a "24°" label cannot.
 */
function buildGhost(){
  const group = new THREE.Group();
  group.name = "angleGhost";
  const skinLine = new THREE.Mesh(
    new THREE.PlaneGeometry(0.030, 0.00055),
    basic({ color: 0x2a3542, transparent: true, opacity: 0.30, depthWrite: false, side: THREE.DoubleSide })
  );
  skinLine.position.x = -0.013;
  group.add(skinLine);
  const wedge = new THREE.Mesh(
    new THREE.PlaneGeometry(0.026, 0.00075),
    basic({ color: 0x1d6b8c, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide })
  );
  wedge.position.x = -0.012;
  group.add(wedge);
  return { group, skinLine, wedge };
}

/** The skin tenting under the tip, and the shadow that pools with it. */
function buildTent(){
  const group = new THREE.Group();
  group.name = "skinTent";
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(0.0070, 16, 10),
    mat(0xffffff, { roughness: 0.72, transparent: true, opacity: 0 })
  );
  dome.scale.set(1.35, 0.42, 1.0);
  group.add(dome);
  const shade = new THREE.Mesh(
    new THREE.PlaneGeometry(0.016, 0.016),
    basic({ color: 0x1a1410, transparent: true, opacity: 0, depthWrite: false })
  );
  shade.rotation.x = -Math.PI/2;
  group.add(shade);
  return { group, dome, shade };
}

/* ---------- placement -------------------------------------------------------------- */

function limbRadius(x){ return ctx.view.arm.radiusAt(x); }
function skinZ(s){ return Math.sin(s.theta)*limbRadius(s.x); }

function syncObjects(){
  if(!ctx) return;
  const s = ctx.state;
  // The bevel mark reads the unit's LIVE angle, so what is on screen is what
  // the assembly step actually left, not a copy taken at some earlier moment.
  const deg = ctx.bevelDeg == null ? 0 : (ctx.bevelDeg() || 0);
  ctx.needle.bevel.rotation.y = deg*Math.PI/180;
  ctx.needle.mark.rotation.y = deg*Math.PI/180;
  ctx.needle.bevel.material.opacity = 0.35 + 0.55*Math.max(0, Math.cos(deg*Math.PI/180));
  if(!s.flashAt && ctx.flashAnim < 0) ctx.needle.blood.scale.x = 0.001;
}

/* ---------- pointer: anchor -------------------------------------------------------- */

function readSkin(e, canvasEl, xHint, thetaRef){
  const rect = canvasEl.getBoundingClientRect();
  return ctx.view.pointerToLimbSurface(
    { x: e.clientX, y: e.clientY }, rect, xHint, limbRadius, thetaRef,
    // both the thumb and the needle work the face of the arm turned toward
    // the operator, never round the hidden underside
    true
  );
}

function placeThumb(s){
  // sinks into the skin as it presses, exactly as the palpating pad does
  const p = ctx.view.limbToWorld(s.x, s.theta, limbRadius(s.x) - 0.0022);
  ctx.thumb.group.position.copy(p);
  ctx.thumb.group.rotation.set(0, 0, -s.theta);
  // the bunched skin grows with the traction actually being applied
  const pull = Math.max(0, Math.min(1, (ctx.state.anchorPull || 0)/0.020));
  ctx.thumb.bunch.material.opacity = 0.06 + pull*0.20;
  ctx.thumb.bunch.scale.set(1.6 + pull*0.6, 0.28 + pull*0.22, 1.2);
  ctx.thumb.group.visible = true;
}

/* ---------- pointer: the approach -------------------------------------------------- */

/**
 * Fixes a local (along-arm, up-off-skin) basis by projecting three KNOWN world
 * points — never by inverse-solving a live one. Forward projection has no
 * ambiguity to begin with, which is what a needle held clear of the limb
 * needs: nothing here degrades with distance from the surface.
 */
function buildApproachBasis(canvasEl){
  const rect = canvasEl.getBoundingClientRect();
  const readyX = ctx.state.markX - READY_DISTAL;
  const theta = ctx.hoverTheta;
  const readyR = limbRadius(readyX) + READY_HEIGHT;
  const readyWorld = ctx.view.limbToWorld(readyX, theta, readyR);
  const alongWorld = ctx.view.limbToWorld(readyX + BASIS_STEP, theta, limbRadius(readyX + BASIS_STEP) + READY_HEIGHT);
  const upWorld = ctx.view.limbToWorld(readyX, theta, readyR + BASIS_STEP);
  const p0 = ctx.view.toScreen(readyWorld, rect, new THREE.Vector3());
  const pA = ctx.view.toScreen(alongWorld, rect, new THREE.Vector3());
  const pU = ctx.view.toScreen(upWorld, rect, new THREE.Vector3());
  return {
    readyX,
    originX: p0.x, originY: p0.y,
    alongX: pA.x - p0.x, alongY: pA.y - p0.y,
    upX: pU.x - p0.x, upY: pU.y - p0.y,
  };
}

/**
 * Solves the raw pointer against the fixed basis — the same 2x2 inverse
 * pointerToLimb uses, evaluated once against exact reference points.
 * @returns {{alongM, heightM}} heightM: 0 at the ready pose, negative as it
 *   descends toward the skin, positive if pulled back further away
 */
function solveApproach(basis, screenX, screenY){
  const Dx = screenX - basis.originX, Dy = screenY - basis.originY;
  const Ax = basis.alongX, Ay = basis.alongY;
  const Bx = basis.upX, By = basis.upY;
  const det = Ax*By - Ay*Bx;
  if(Math.abs(det) < 1e-6) return { alongM: 0, heightM: 0 };
  const a = (Dx*By - Dy*Bx)/det;
  const b = (Ax*Dy - Ay*Dx)/det;
  return { alongM: a*BASIS_STEP, heightM: b*BASIS_STEP };
}

/** How far below the ready height the approach has closed, as a real angle. */
function approachAngleDeg(alongM, heightM){
  if(Math.abs(alongM) < SAMPLE_MIN) return null;
  const closed = Math.max(0, -heightM);
  return Math.atan2(closed, Math.abs(alongM))*180/Math.PI;
}

/**
 * Hovers the needle above an along-arm position at a given clearance.
 *
 * The theta it hovers at is biased toward the CHOSEN vein's own line as the
 * tip closes in. That is assistance in the sense the assist layer defines: it
 * helps the shaft lie along the vein the player picked, and does nothing
 * whatever about which vein that was.
 */
function hoverNeedle(x, height){
  let theta = ctx.hoverTheta;
  const v = chosenVessel();
  if(v){
    const target = veinThetaAt(v, x);
    if(target != null){
      const closeness = 1 - Math.min(1, Math.max(0, height)/READY_HEIGHT);
      theta = biasToAxis(theta, target, closeness);
    }
  }
  ctx.hoverThetaLive = theta;
  const p = ctx.view.limbToWorld(x, theta, limbRadius(x) + Math.max(0, height));
  ctx.needle.group.position.copy(p);
  aimAlongVein(ctx.needle.group, x, theta);
  ctx.needle.group.visible = true;
  showGhost(x, theta, height);
}

/**
 * Points the needle along the CHOSEN VEIN'S OWN AXIS rather than straight
 * along the limb.
 *
 * Clinically this is the requirement — you approach along the vein, not across
 * it — and it is also what makes the needle legible from a viewpoint that
 * looks down the arm: the median cubital crosses the fossa diagonally, so a
 * needle following it reads across the frame instead of end-on.
 */
function aimAlongVein(obj, x, theta){
  obj.rotation.set(0, 0, -theta);
  const v = chosenVessel();
  if(v){
    const yaw = veinYawAt(v, x);
    if(yaw != null) obj.rotation.y = yaw;
  }
  // pitches down as it closes on the skin: a visual cue of the same angle
  // estimate the gesture is deriving
  obj.rotation.x = -(ctx.angleEMA || 0)*Math.PI/180;
}

/** The vein's heading in the arm's own XZ plane, at a position along it. */
function veinYawAt(v, x){
  const path = v.path;
  if(!path || path.length < 2) return null;
  let best = 0, bestD = Infinity;
  for(let i = 0; i < path.length; i++){
    const d = Math.abs(path[i].x - x);
    if(d < bestD){ bestD = d; best = i; }
  }
  const a = path[Math.max(0, best - 1)], b = path[Math.min(path.length - 1, best + 1)];
  const dx = b.x - a.x, dz = b.z - a.z;
  if(!dx && !dz) return null;
  // clamped: the needle follows the vein, it does not swing round to chase a
  // sharp bend in a polyline
  return Math.max(-0.7, Math.min(0.7, -Math.atan2(dz, dx)));
}

/** The chosen vein's angle round the limb where the needle currently is. */
function veinThetaAt(v, x){
  let best = null, bestD = Infinity;
  for(const p of v.path){
    const d = Math.abs(p.x - x);
    if(d < bestD){ bestD = d; best = p; }
  }
  if(!best) return null;
  const r = limbRadius(x);
  return Math.asin(Math.max(-1, Math.min(1, best.z/r)));
}

function showGhost(x, theta, height){
  const g = ctx.ghost;
  const p = ctx.view.limbToWorld(x, theta, limbRadius(x) + 0.0004);
  g.group.position.copy(p);
  g.group.rotation.set(0, 0, -theta);
  g.wedge.rotation.z = (ctx.angleEMA || 0)*Math.PI/180;
  // fades in as the tip gets close enough for the angle to matter
  const near = 1 - Math.min(1, Math.max(0, height)/(READY_HEIGHT*1.2));
  g.skinLine.material.opacity = 0.30*near;
  g.wedge.material.opacity = 0.55*near;
  g.group.visible = near > 0.02;
}

function freezeNeedleAtEntry(s){
  const theta = ctx.hoverThetaLive == null ? ctx.hoverTheta : ctx.hoverThetaLive;
  const p = ctx.view.limbToWorld(s.x, theta, limbRadius(s.x) + 0.0004);
  ctx.needle.group.position.copy(p);
  const held = ctx.angleEMA;
  ctx.angleEMA = ctx.state.angleDeg || 0;
  aimAlongVein(ctx.needle.group, s.x, theta);
  ctx.angleEMA = held;
  ctx.needle.group.visible = true;
  ctx.ghost.group.visible = false;
}

/* ---------- gesture dispatch -------------------------------------------------------- */

export function insertPointerDown(e, canvasEl){
  if(!isInsertActive()) return false;

  if(ctx.phase === "anchor"){
    const s = readSkin(e, canvasEl, null, null);
    if(!s) return false;
    try{ canvasEl.setPointerCapture(e.pointerId); }catch(_){}
    ctx.down = true;
    pressAnchor(ctx.state, s.x);
    ctx.anchorLast = { x: s.x };
    placeThumb(s);
    tapHaptic();
    notify();
    return true;
  }

  try{ canvasEl.setPointerCapture(e.pointerId); }catch(_){}
  ctx.down = true;

  /* PHASE 1, ALIGN. The room goes quiet and the camera stops breathing, so
     the player's own hand is the only thing moving when precision matters. */
  ctx.view.setSway(0);
  duckRoom(0.35, 1.2);

  if(ctx.state.entryX == null){
    ctx.approachBasis = buildApproachBasis(canvasEl);
    ctx.angleEMA = null;
    ctx.stretch = 0;
    ctx.beat = "align";
    hoverNeedle(ctx.approachBasis.readyX, READY_HEIGHT);
  }else{
    const s = readSkin(e, canvasEl, ctx.lastAlong, null);
    ctx.lastAlong = s ? s.x : ctx.lastAlong;
  }
  notify();
  return true;
}

export function insertPointerMove(e, canvasEl){
  if(!isInsertActive()) return false;
  if(!ctx.down){
    // hover feedback even before a grab, matching the swab/finger precedent
    if(ctx.phase === "insert" && ctx.state.entryX == null){
      if(!ctx.approachBasis) ctx.approachBasis = buildApproachBasis(canvasEl);
      const r = solveApproach(ctx.approachBasis, e.clientX, e.clientY);
      hoverNeedle(ctx.approachBasis.readyX + r.alongM, READY_HEIGHT + r.heightM);
    }
    return true;
  }

  if(ctx.phase === "anchor"){
    const s = readSkin(e, canvasEl, ctx.anchorLast ? ctx.anchorLast.x : null, null);
    if(!s) return true;
    // distal is -X, so a step further from the site (more negative x) is
    // positive traction
    const delta = -(s.x - (ctx.anchorLast ? ctx.anchorLast.x : s.x));
    pullAnchor(ctx.state, delta);
    ctx.anchorLast = { x: s.x };
    placeThumb(s);
    notify();
    return true;
  }

  if(ctx.state.entryX == null) return moveApproach(e, canvasEl);
  return moveDepth(e, canvasEl);
}

/** Phases 1 to 4. Everything below the surface happens in moveDepth. */
function moveApproach(e, canvasEl){
  const r = solveApproach(ctx.approachBasis, e.clientX, e.clientY);
  const angle = approachAngleDeg(r.alongM, r.heightM);
  if(angle != null){
    ctx.angleEMA = angle;
    // the direction the tip was travelling as it closed on the skin is what
    // "forward" means once it is under the skin
    ctx.depthDir = Math.sign(r.alongM) || ctx.depthDir || 1;
  }
  const x = ctx.approachBasis.readyX + r.alongM;
  const remaining = READY_HEIGHT + r.heightM;

  if(remaining > CONTACT_HEIGHT){
    // PHASE 1: still in the air.
    if(ctx.beat !== "align"){ ctx.beat = "align"; ctx.stretch = 0; stopCreak(); }
    hoverNeedle(x, Math.max(0, remaining));
    hideTent();
    notify();
    return true;
  }

  /* PHASES 2 AND 3. The tip is on the skin. From here the hand's continued
     travel does NOT move the tip: it loads the skin. That decoupling is the
     single most important thing in this file — it is what makes the give at
     the end of it feel like a give rather than like a state change. */
  if(ctx.beat === "align"){
    ctx.beat = "contact";
    ctx.stretch = 0;
    skinTick();
    contactHaptic();
    ctx.creak = skinCreak();
    if(ctx.view.body) ctx.view.body.setTension(0.72);
  }

  const push = Math.max(0, CONTACT_HEIGHT - remaining);
  ctx.stretch = Math.max(ctx.stretch, push);
  if(ctx.stretch > 0.0006 && ctx.beat === "contact") ctx.beat = "resistance";

  const load = Math.min(1, ctx.stretch/BREAK_STRETCH);
  if(ctx.creak) ctx.creak.set(load);
  // the tip follows only a fraction of the hand — visibly
  hoverNeedle(x, -ctx.stretch*TIP_FOLLOW);
  showTent(x, load);

  if(ctx.stretch >= BREAK_STRETCH) penetrate(e, canvasEl, x);
  notify();
  return true;
}

/** PHASE 4. The skin gives, all at once. */
function penetrate(e, canvasEl, xSeed){
  const s = readSkin(e, canvasEl, xSeed, null);
  if(!s) return;
  breakSkin(ctx.state, s.x, skinZ(s), ctx.angleEMA || 0, ctx.depthDir);
  ctx.lastAlong = s.x;
  ctx.beat = "penetrated";
  ctx.stretch = 0;
  ctx.wallStretch = 0;
  stopCreak();

  // The tip lurches forward the distance it had been held back — but never
  // so far that it arrives in the vein on the same frame. See LURCH_DEPTH.
  advance(ctx.state, lurchDepth());
  freezeNeedleAtEntry(s);
  hideTent();

  skinPop();
  skinPopHaptic();
  ctx.view.kickCamera(0.0018, 0.35, -1);
  if(ctx.view.body){ ctx.view.body.setTension(0.62); ctx.view.body.flinch(0.35); }
  checkVein();
}

/**
 * PHASE 5 and everything after it. The needle is in the skin; along-arm travel
 * in the direction it entered advances it, the opposite direction withdraws.
 */
function moveDepth(e, canvasEl){
  const s = readSkin(e, canvasEl, ctx.lastAlong, null);
  if(!s) return true;
  const dAlong = s.x - (ctx.lastAlong == null ? s.x : ctx.lastAlong);
  ctx.lastAlong = s.x;
  const forward = dAlong*ctx.depthDir;
  let dDepth = forward*Math.sin((ctx.state.angleDeg || 0)*Math.PI/180);

  /* THE VEIN WALL. The same resistance-then-release shape as the skin, over
     half the distance and with half the drama. Approaching it, the wall tents
     and holds the tip back; past WALL_STRETCH it gives. */
  const v = chosenVessel();
  if(v && !ctx.state.flashAt && dDepth > 0){
    // The rules' OWN near wall, so the felt event and the graded event are
    // the same event. Deriving a second one here is how they drift apart.
    const wallTop = depthBand(v).near;
    const gap = wallTop - ctx.state.depthM;
    if(gap <= WALL_BAND && gap > -v.calibre){
      ctx.wallStretch += dDepth;
      if(ctx.beat !== "wall"){
        ctx.beat = "wall";
        if(!ctx.creak) ctx.creak = skinCreak();
      }
      if(ctx.creak) ctx.creak.set(Math.min(1, ctx.wallStretch/WALL_STRETCH)*0.7);
      if(ctx.wallStretch < WALL_STRETCH){
        // held at the wall: the hand moves, the tip does not
        notify();
        return true;
      }
      // it gives
      stopCreak();
      ctx.beat = "in";
      veinPop();
      veinPopHaptic();
      ctx.view.kickCamera(0.0009, 0.2, -1);
      dDepth = Math.max(dDepth, gap + v.calibre*0.55);
      ctx.wallStretch = 0;
    }
  }

  advance(ctx.state, dDepth);
  if(ctx.state.entryX != null){
    checkVein();
  }else{
    /* Backed all the way out. Rebuilt immediately rather than left null: a
       real drag can carry straight on past a full withdrawal in one motion. */
    ctx.approachBasis = buildApproachBasis(canvasEl);
    ctx.angleEMA = null;
    ctx.beat = "align";
    ctx.stretch = 0;
    stopCreak();
  }
  notify();
  return true;
}

/** The lurch, clamped to stop in the tissue short of the chosen vein's wall. */
function lurchDepth(){
  const v = chosenVessel();
  if(!v) return LURCH_DEPTH;
  const near = depthBand(v).near;
  return Math.max(0.0006, Math.min(LURCH_DEPTH, near - WALL_STANDOFF));
}

function checkVein(){
  const before = ctx.state.flashAt;
  markFlashIfInVein(ctx.state, chosenVessel(), Date.now());
  if(!before && ctx.state.flashAt) fireFlashback();
  syncObjects();
}

/* =========================================================================
   THE FLASHBACK

   Six channels inside 250 ms, and not one word of text. The world tells you.
   Failure is the exact mirror and is deliberately FLAT: nothing blooms, the
   room stays loud, the patient stays tense. The absence is the feedback.
   ========================================================================= */
function fireFlashback(){
  ctx.beat = "flash";
  ctx.flashAnim = 0;                            // 1: dark red fills the chamber
  flashChord();                                 // 2+3: room ducks, one low note
  if(ctx.view.body) ctx.view.body.relieve();    // 4: their shoulder drops
  ctx.view.setLean(1);                          // 5: the camera drifts closer
  ctx.dilate = DILATE_SECONDS;                  // 6: time opens up, briefly
  flashHaptic();
}

/* ---------- the skin's own response ------------------------------------------------ */

function showTent(x, load){
  const t = ctx.tent;
  const theta = ctx.hoverThetaLive == null ? ctx.hoverTheta : ctx.hoverThetaLive;
  const p = ctx.view.limbToWorld(x, theta, limbRadius(x) - 0.0016 + load*0.0022);
  t.group.position.copy(p);
  t.group.rotation.set(0, 0, -theta);
  t.dome.material.opacity = 0.34*load;
  t.dome.scale.set(1.35 - load*0.35, 0.42 + load*0.55, 1.0 - load*0.22);
  t.shade.material.opacity = 0.20*load;
  t.shade.scale.setScalar(0.7 + load*0.5);
  t.group.visible = load > 0.02;
}

function hideTent(){ if(ctx) ctx.tent.group.visible = false; }

function stopCreak(){
  if(ctx && ctx.creak){ ctx.creak.stop(); ctx.creak = null; }
}

export function insertPointerUp(e, canvasEl){
  if(!isInsertActive()) return false;
  try{ canvasEl.releasePointerCapture(e.pointerId); }catch(_){}

  if(ctx.phase === "anchor" && ctx.state.anchorDownX != null){
    lockAnchor(ctx.state);
    if(ctx.state.anchorSet) ctx.phase = "insert";
    tapHaptic();
  }
  // Letting go part-way through the resistance is letting the skin go: it
  // springs back and nothing has happened.
  if(ctx.state.entryX == null && ctx.stretch > 0){
    ctx.stretch = 0;
    ctx.beat = "align";
    hideTent();
  }
  stopCreak();
  ctx.down = false;
  ctx.view.setSway(1);
  notify();
  return true;
}

export function insertPointerCancel(){
  if(!isInsertActive()) return false;
  ctx.down = false;
  ctx.stretch = 0;
  stopCreak();
  hideTent();
  ctx.view.setSway(1);
  return true;
}

/* =========================================================================
   REDIRECT, DON'T RESTART

   A missed stick used to be very close to terminal. Real practice allows a
   limited redirect — partial withdrawal without leaving the skin, and a small
   change of angle — and limits it, and that limit is what makes it a decision.
   "Do I adjust, or pull out and start again" is genuine tension and a genuine
   clinical judgement, and it turns the game's most punishing failure into its
   most interesting one.

   Each redirect is measured and costs technique. Probing beyond the limit is
   recorded as exactly that, and the complication model already knows what
   lateral probing does to an arm.
   ========================================================================= */

/** @param {number} deltaDeg  the angle change being asked for */
export function redirectNeedle(deltaDeg){
  if(!ctx || ctx.state.entryX == null || ctx.state.flashAt) return null;
  const before = ctx.state.redirects || 0;
  redirect(ctx.state, (ctx.state.angleDeg || 0) + (deltaDeg || 0));
  if((ctx.state.redirects || 0) > before){
    // withdraw a little, without leaving the skin, then re-aim
    advance(ctx.state, -Math.min(ctx.state.depthM*0.55, 0.0022));
    skinTick();
    if(ctx.view.body) ctx.view.body.flinch(0.45);
    ctx.beat = "align";
    ctx.wallStretch = 0;
  }
  return notify();
}

export function redirectsLeft(){
  if(!ctx) return 0;
  return Math.max(0, MAX_REDIRECTS - (ctx.state.redirects || 0));
}

/* ---------- per-frame ------------------------------------------------------------ */

export function renderInsert(renderer, dt){
  if(!ctx) return false;
  // What the camera is following: the needle at the skin — this whole step is millimetre work.
  // See bench/handFraming.js — idempotent, so this is free per frame.
  ctx.view.hold("tip");
  let step = dt || 0.016;
  ctx.frame++;

  /* TIME DILATION. 0.85x for 300 ms at the flashback, then back. Applied to
     the scene's own clock rather than to a global, so it slows the arm, the
     patient's breathing and the camera together and nothing drifts out of
     phase with anything else. */
  if(ctx.dilate > 0){
    ctx.dilate = Math.max(0, ctx.dilate - step);
    step *= DILATE_SCALE;
  }

  const aspect = viewportAspect(renderer);
  if(Math.abs(aspect - ctx.lastAspect) > 0.01 || ctx.frame % 30 === 0){
    ctx.view.fitCamera(aspect, measureObstruction(renderer));
    ctx.lastAspect = aspect;
    // the reframe moves every screen projection, so a basis fixed against the
    // old frame would silently misread the pointer from here on
    if(ctx.state.entryX == null) ctx.approachBasis = buildApproachBasis(renderer.domElement);
  }

  tickFlash(step);
  ctx.view.tick(step);
  renderer.render(ctx.view.scene, ctx.view.camera);
  return true;
}

/**
 * The bloom. Real fluid motion filling the chamber in about 200 ms — a column
 * of blood growing along the hub's own axis, not a colour fading up.
 */
function tickFlash(dt){
  if(ctx.flashAnim < 0) return;
  ctx.flashAnim += dt;
  const k = Math.min(1, ctx.flashAnim/0.20);
  // fast at first and easing at the end, the way a vacuum column actually fills
  const fill = 1 - Math.pow(1 - k, 2.2);
  ctx.needle.blood.scale.x = Math.max(0.001, fill);
  // the column grows from the hub end toward the tip, which is the direction
  // blood actually travels up a flash chamber
  ctx.needle.blood.position.x = -0.0296 - (1 - fill)*0.0045;
  ctx.needle.chamber.material.opacity = 0.45 - fill*0.22;
  if(ctx.flashAnim > 0.55){
    // the camera drifts back out of its push-in rather than snapping
    ctx.view.setLean(Math.max(0, 1 - (ctx.flashAnim - 0.55)/1.4));
  }
  if(ctx.flashAnim > 2.2) ctx.flashAnim = -1;
}

/* ---------- programmatic (accessible path + tests) -------------------------------- */

function after(fn){
  if(!ctx) return null;
  fn(ctx.state);
  syncObjects();
  return notify();
}

export function redoAnchor(){
  if(!ctx) return null;
  resetAnchor(ctx.state);
  ctx.phase = "anchor";
  ctx.thumb.group.visible = false;
  return notify();
}
export function anchorProgrammatically(offsetFromMark, pullM){
  return after(s => {
    pressAnchor(s, s.markX - (offsetFromMark == null ? 0.035 : offsetFromMark));
    pullAnchor(s, pullM == null ? 0.016 : pullM);
    lockAnchor(s);
    if(s.anchorSet && ctx) ctx.phase = "insert";
  });
}
export function insertProgrammatically(angleDeg, depthM){
  return after(s => {
    breakSkin(s, s.markX, s.markZ, angleDeg == null ? 20 : angleDeg);
    advance(s, depthM == null ? 0.006 : depthM);
    if(s.entryX != null){
      const before = s.flashAt;
      markFlashIfInVein(s, chosenVessel(), Date.now());
      if(!before && s.flashAt) fireFlashback();
    }
  });
}
export function advanceProgrammatically(deltaDepthM){
  return after(s => {
    advance(s, deltaDepthM);
    if(s.entryX != null){
      const before = s.flashAt;
      markFlashIfInVein(s, chosenVessel(), Date.now());
      if(!before && s.flashAt) fireFlashback();
    }
  });
}
export function pullOutProgrammatically(){
  return after(s => advance(s, -(s.depthM + 0.001)));
}

/** What the arm looks like right now, for the coach. */
export function currentInsert(){
  if(!ctx) return null;
  return {
    phase: ctx.phase,
    /** which of the five phases the gesture is in */
    beat: ctx.beat,
    anchoring: ctx.down && ctx.phase === "anchor",
    approaching: ctx.down && ctx.phase === "insert" && ctx.state.entryX == null,
    liveAngle: ctx.angleEMA,
    /** 0…1 how loaded the skin is, for a coach that wants to say "keep going" */
    load: Math.min(1, ctx.stretch/BREAK_STRETCH),
    redirectsLeft: redirectsLeft(),
    assist: assistLevel(),
  };
}
