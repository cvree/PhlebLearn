/* =========================================================================
   ANCHOR + INSERT RUNTIME — the same arm, the vein palpation found, the
   needle assembly built and uncap uncapped.

   Two sequential gestures, reading two DIFFERENT primitives from armScene on
   purpose, because they are honest about different things:

     ANCHOR   read through pointerToLimbSurface — the same skin-surface solve
              the swab and the fingertip already use, valid because a thumb
              anchoring skin is, by definition, on the skin the whole time.
              The pull is real metres of travel, exactly like the
              tourniquet's tension pull; how far off a rolling vein sits by
              the time the needle arrives is that same distance run back
              through palpation's own rollOffset().

     INSERT   the angle comes from the SAME trick pointerToLimb itself uses —
              a 2x2 inverse against two known basis directions — but solved
              once against a FIXED reference frame instead of a live,
              continuously re-seeded one. pointerToLimb's own `x` is only
              trustworthy near the surface it is re-seeded from (its
              "along" reading is a live guess that a held-clear pointer can
              defeat, same as pointerToLimbSurface's off-skin residual); a
              needle spends most of its approach far from any surface at
              all, where no live inverse solve on this arm stays accurate.
              What IS always exact is projecting a few KNOWN world points —
              a fixed ready pose, one 10mm step along the arm, one 10mm step
              up off it — through toScreen(), because forward projection has
              no ambiguity to begin with. Those three screen points fix a
              local basis once, at the moment the needle is picked up; every
              subsequent raw pointer position is solved against THAT fixed
              basis, in real metres, with no re-seeding and nothing to
              diverge. Once the closing height crosses near zero the angle is
              locked, one exact pointerToLimbSurface read (trustworthy here,
              because the tip truly is on the skin) fixes precisely where it
              landed, and further travel along the same line converts to
              depth by that same trigonometry — never invented, because
              nothing under the skin is something this camera could show
              anyway. The needle's mesh freezes at the entry pose once stuck:
              watching a tip sink through translucent skin isn't visible from
              a real bedside either, so it isn't shown here.
   ========================================================================= */
import * as THREE from "three";
import { sfx } from "../../audio/audioManager.js";
import { buildArmScene } from "../arm/armScene.js";
import { veinDistension, distalPallor, SITE } from "../arm/armAnatomy.js";
import { evaluateInsert, isInVein } from "./insertRules.js";
import {
  createInsertState,
  pressAnchor, pullAnchor, lockAnchor, resetAnchor,
  breakSkin, advance, markFlashIfInVein,
} from "./insertState.js";
import { measureObstruction, viewportAspect } from "../viewport.js";

/**
 * Where the needle starts: metres distal to the mark, metres above the skin.
 * Chosen so a natural, straight-line carry from ready pose to the mark
 * itself already lands in the 15-30 degree ideal window (atan(14/35) is
 * ~22 degrees) — the obvious way to play it is also the clean one.
 */
export const READY_DISTAL = 0.035;
export const READY_HEIGHT = 0.014;
/** The local basis is built from a 10mm step in each direction. */
const BASIS_STEP = 0.010;
/** Metres of remaining clearance that counts as "touching" — the approach locks here. */
const CONTACT_HEIGHT = 0.0020;
/** Metres of along-arm displacement too small to trust for an angle reading. */
const SAMPLE_MIN = 0.0004;

let ctx = null;

/* ---------- lifecycle -------------------------------------------------------- */

/**
 * @param {object} opts
 *   state       an existing insertState to resume, or null for a new one
 *   arm         {skin, build, armSide, scenarioKeys, vigour, shirt}
 *   tourniquet, cleaning   the same patient every step has worked on
 *   bevelDeg    the needle unit's bevel angle, read live each frame by the caller
 *   onChange(result)
 */
export function startInsert(opts){
  const o = opts || {};
  const view = buildArmScene(o.arm || {});
  const state = o.state || createInsertState({});

  const thumb = buildThumb();
  thumb.group.visible = false;
  view.root.add(thumb.group);

  const needle = buildNeedle();
  needle.group.visible = false;
  view.root.add(needle.group);

  // Which side of the arm the hover visual sits over. Not a measurement —
  // see readApproach()'s doc — just a plausible fixed position near the
  // marked vein so the needle reads as "over the site" while it closes in.
  const markR = view.arm.radiusAt(state.markX);
  const hoverTheta = Math.asin(Math.max(-1, Math.min(1, state.markZ/markR)));

  ctx = {
    ...o,
    view, state, thumb, needle,
    phase: state.anchorSet ? "insert" : "anchor",
    hoverTheta,
    approachBasis: null,
    down: false,
    anchorLast: null,
    angleEMA: null,
    depthDir: 1,
    lastAlong: null,
    active: true,
    frame: 0,
    lastAspect: 0,
    lastCanvas: null,
  };

  if(o.tourniquet) applyBandToArm(o.tourniquet);
  view.setSiteVisible(false);
  syncObjects();
  notify();
  return ctx;
}

export function stopInsert(){
  if(!ctx) return;
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

/* ---------- the props ------------------------------------------------------------ */

function mat(color, o){
  const m = new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.7 }, o || {}));
  m.userData.perInstance = true;
  return m;
}

function buildThumb(){
  const group = new THREE.Group();
  group.name = "anchorThumb";
  const pad = new THREE.Mesh(new THREE.SphereGeometry(0.0088, 14, 10), mat(0xf0d8c4, { roughness: 0.8 }));
  pad.scale.set(1.05, 0.72, 1.15);
  group.add(pad);
  return { group, pad };
}

function buildNeedle(){
  const group = new THREE.Group();
  group.name = "insertNeedle";
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.00042, 0.00042, 0.030, 8), mat(0xd7dde3, { roughness: 0.2, metalness: 0.5 }));
  shaft.rotation.z = Math.PI/2;
  shaft.position.x = 0.010;
  group.add(shaft);

  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.0052, 0.0058, 0.011, 14), mat(0xdfe7ef, { roughness: 0.35, transparent: true, opacity: 0.85 }));
  hub.rotation.z = Math.PI/2;
  hub.position.x = 0.028;
  group.add(hub);

  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(0.0026, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0x9aa4b0, transparent: true, opacity: 0.55 })
  );
  flash.material.userData.perInstance = true;
  flash.position.x = 0.028;
  group.add(flash);

  return { group, shaft, hub, flash };
}

/* ---------- placement -------------------------------------------------------------- */

function limbRadius(x){ return ctx.view.arm.radiusAt(x); }
function skinZ(s){ return Math.sin(s.theta)*limbRadius(s.x); }

function syncObjects(){
  if(!ctx) return;
  const s = ctx.state;
  const flashColor = s.flashAt ? 0xc0392b : 0x9aa4b0;
  ctx.needle.flash.material.color.setHex(flashColor);
  ctx.needle.flash.material.opacity = s.flashAt ? 0.95 : 0.5;
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
  const p = ctx.view.limbToWorld(s.x, s.theta, limbRadius(s.x) + 0.0012);
  ctx.thumb.group.position.copy(p);
  ctx.thumb.group.rotation.set(0, 0, -s.theta);
  ctx.thumb.group.visible = true;
}

/* ---------- pointer: needle, while still clear of the skin ------------------------- */

/**
 * Fixes a local (along-arm, up-off-skin) basis by projecting three KNOWN
 * world points — never by inverse-solving a live one. Forward projection has
 * no ambiguity to begin with, which is exactly what a needle held clear of
 * the limb needs: nothing here degrades with distance from the surface, the
 * way pointerToLimb's or pointerToLimbSurface's live solves both do.
 * Rebuilt on every grab (and whenever the canvas resizes) so a reframed
 * viewport cannot leave it stale.
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
 * Solves the raw pointer position against the fixed basis — the same 2x2
 * inverse pointerToLimb uses, evaluated once against exact reference points
 * instead of a continuously re-seeded live one.
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
 * Hovers the needle above an along-arm position at a given clearance. Which
 * side of the arm it is over is not something a held-clear pointer can say
 * (see armScene's own docs on the limb's cross-section being edge-on) —
 * theta is fixed near the marked vein's own side, honest about being a
 * placeholder rather than a measurement, and it affects nothing scored.
 */
function hoverNeedle(x, height){
  const theta = ctx.hoverTheta;
  const p = ctx.view.limbToWorld(x, theta, limbRadius(x) + Math.max(0, height));
  ctx.needle.group.position.copy(p);
  ctx.needle.group.rotation.set(0, 0, -theta);
  // pitches down as it closes on the skin, purely a visual cue of the same
  // angle estimate the gesture is deriving
  ctx.needle.group.rotation.x = -(ctx.angleEMA || 0)*Math.PI/180;
  ctx.needle.group.visible = true;
}

function freezeNeedleAtEntry(s){
  const p = ctx.view.limbToWorld(s.x, s.theta, limbRadius(s.x) + 0.0004);
  ctx.needle.group.position.copy(p);
  ctx.needle.group.rotation.set(0, 0, -s.theta);
  ctx.needle.group.rotation.x = -(ctx.state.angleDeg || 0)*Math.PI/180;
  ctx.needle.group.visible = true;
}

/* ---------- gesture dispatch -------------------------------------------------------- */

/** Locks the entry: one trustworthy pointerToLimbSurface read, seeded by the along-arm position pointerToAxis already established. */
function tryBreakSkin(e, canvasEl, xSeed){
  const s = readSkin(e, canvasEl, xSeed, null);
  if(!s) return false;
  breakSkin(ctx.state, s.x, skinZ(s), ctx.angleEMA || 0, ctx.depthDir);
  ctx.lastAlong = s.x;
  freezeNeedleAtEntry(s);
  sfx("click");
  return true;
}

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
    sfx("tap");
    notify();
    return true;
  }

  try{ canvasEl.setPointerCapture(e.pointerId); }catch(_){}
  ctx.down = true;

  if(ctx.state.entryX == null){
    ctx.approachBasis = buildApproachBasis(canvasEl);
    ctx.angleEMA = null;
    hoverNeedle(ctx.approachBasis.readyX, READY_HEIGHT);
    sfx("tap");
  }else{
    const s = readSkin(e, canvasEl, ctx.lastAlong, null);
    ctx.lastAlong = s ? s.x : ctx.lastAlong;
    sfx("tap");
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

  if(ctx.state.entryX == null){
    const r = solveApproach(ctx.approachBasis, e.clientX, e.clientY);
    const angle = approachAngleDeg(r.alongM, r.heightM);
    if(angle != null){
      ctx.angleEMA = angle;
      // the direction the tip was travelling as it closed on the skin is
      // what "forward" means once it's under the skin — advancing further
      // in that same along-arm direction is what deepens the stick
      ctx.depthDir = Math.sign(r.alongM) || ctx.depthDir || 1;
    }
    const x = ctx.approachBasis.readyX + r.alongM;
    const remaining = READY_HEIGHT + r.heightM;
    if(remaining <= CONTACT_HEIGHT) tryBreakSkin(e, canvasEl, x);
    else hoverNeedle(x, Math.max(0, remaining));
    notify();
    return true;
  }

  // depth phase — the needle is stuck; further along-arm travel in the
  // direction it entered advances it, the opposite direction withdraws it
  const s = readSkin(e, canvasEl, ctx.lastAlong, null);
  if(!s) return true;
  const dAlong = s.x - (ctx.lastAlong == null ? s.x : ctx.lastAlong);
  ctx.lastAlong = s.x;
  const forward = dAlong*ctx.depthDir;
  const dDepth = forward*Math.sin((ctx.state.angleDeg || 0)*Math.PI/180);
  advance(ctx.state, dDepth);
  if(ctx.state.entryX != null){
    const chosen = (ctx.view.arm.vessels || []).find(v => v.id === ctx.state.chosenId);
    markFlashIfInVein(ctx.state, chosen, Date.now());
    syncObjects();
  }else{
    // Backed all the way out — the needle is hovering again, free to
    // re-approach. Rebuilt immediately rather than left null: a real drag
    // can carry straight on past a full withdrawal in one continuous motion,
    // and the very next move event in THIS SAME gesture needs a basis to
    // solve against.
    ctx.approachBasis = buildApproachBasis(canvasEl);
    ctx.angleEMA = null;
  }
  notify();
  return true;
}

export function insertPointerUp(e, canvasEl){
  if(!isInsertActive()) return false;
  try{ canvasEl.releasePointerCapture(e.pointerId); }catch(_){}

  if(ctx.phase === "anchor" && ctx.state.anchorDownX != null){
    lockAnchor(ctx.state);
    if(ctx.state.anchorSet) ctx.phase = "insert";
    sfx(ctx.state.anchorSet ? "good" : "tap");
  }
  ctx.down = false;
  notify();
  return true;
}

export function insertPointerCancel(){
  if(!isInsertActive()) return false;
  ctx.down = false;
  return true;
}

/* ---------- per-frame ------------------------------------------------------------ */

export function renderInsert(renderer, dt){
  if(!ctx) return false;
  const aspect = viewportAspect(renderer);
  ctx.frame++;
  if(Math.abs(aspect - ctx.lastAspect) > 0.01 || ctx.frame % 30 === 0){
    ctx.view.fitCamera(aspect, measureObstruction(renderer));
    ctx.lastAspect = aspect;
    // the reframe moves every screen projection, so a basis fixed against the
    // old frame would silently misread the pointer from here on
    if(ctx.state.entryX == null) ctx.approachBasis = buildApproachBasis(renderer.domElement);
  }
  ctx.view.tick(dt || 0.016);
  renderer.render(ctx.view.scene, ctx.view.camera);
  return true;
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
      const chosen = (ctx.view.arm.vessels || []).find(v => v.id === s.chosenId);
      markFlashIfInVein(s, chosen, Date.now());
    }
  });
}
export function advanceProgrammatically(deltaDepthM){
  return after(s => {
    advance(s, deltaDepthM);
    if(s.entryX != null){
      const chosen = (ctx.view.arm.vessels || []).find(v => v.id === s.chosenId);
      markFlashIfInVein(s, chosen, Date.now());
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
    anchoring: ctx.down && ctx.phase === "anchor",
    approaching: ctx.down && ctx.phase === "insert" && ctx.state.entryX == null,
    liveAngle: ctx.angleEMA,
  };
}
