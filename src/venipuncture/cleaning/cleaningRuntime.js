/* =========================================================================
   CLEANING RUNTIME — scrubbing the site with an alcohol pad.

   Same arm, same band, same vein the fingers found. The swab is dragged over
   the skin and what it covers is painted into a real decal texture centred on
   the puncture point, so the learner can SEE which skin they have actually
   disinfected and which they have missed — rather than watching a progress
   bar fill from a distance travelled.

   Friction is hold-and-work, on the same reasoning as palpation's pressure:
   this view cannot see depth, so pressing "in" is measured as how the hand
   moves, not invented from a second pointer axis. Scrubbing (moving while in
   contact) is friction; resting the pad on the skin is not.
   ========================================================================= */
import * as THREE from "three";
import { sfx } from "../../audio/audioManager.js";
import { buildArmScene } from "../arm/armScene.js";
import { veinDistension, distalPallor, SITE } from "../arm/armAnatomy.js";
import {
  FIELD_RADIUS, GRID, evaluateCleaning, cellFor, secondsDrying,
} from "./cleaningRules.js";
import { createCleaningState, openSwab, recordStroke, markRetouched, applySpiral, applyBackAndForth } from "./cleaningState.js";
import { measureObstruction, viewportAspect } from "../viewport.js";

/** Metres of travel per sample that counts as full scrubbing friction. */
const FRICTION_FULL = 0.0025;
/** The swab's contact patch. */
const SWAB_RADIUS = 0.006;

let ctx = null;

/* ---------- lifecycle -------------------------------------------------------- */

export async function startCleaning(opts){
  const o = opts || {};
  const view = buildArmScene(o.arm || {});
  const state = o.state || createCleaningState();

  // where the learner marked the vein, or the fossa if they never did
  const site = o.site && o.site.mark ? o.site.mark : { x: SITE.x, z: SITE.z };

  const decal = buildFieldDecal(view, site);
  const swab = buildSwab();
  swab.group.visible = false;
  view.root.add(swab.group);

  ctx = {
    ...o,
    view, state, site, decal, swab,
    down: false,
    last: null,
    active: true,
    frame: 0,
    lastAspect: 0,
  };

  if(o.tourniquet) applyBandToArm(o.tourniquet);
  view.setSiteVisible(false);
  redrawDecal();
  notify();
  return ctx;
}

export function stopCleaning(){
  if(!ctx) return;
  if(ctx.decal) ctx.decal.dispose();
  ctx.view.dispose();
  ctx = null;
}

export function isCleaningActive(){ return !!(ctx && ctx.active); }
export function getCleaningContext(){ return ctx; }

function applyBandToArm(tq){
  const held = tq.heldTension || tq.tension || 0;
  const secs = (tq.accumulatedMs + (tq.securedAt ? (Date.now() - tq.securedAt) : 0))/1000;
  ctx.view.arm.setDistension(veinDistension(held, secs, 1));
  ctx.view.arm.setPallor(distalPallor(held));
}

function notify(){
  if(!ctx) return null;
  const result = evaluateCleaning(ctx.state);
  if(ctx.onChange) ctx.onChange(result);
  return result;
}

/* ---------- the prep field, painted for real ---------------------------------- */

/**
 * A canvas texture laid over the skin, centred on the puncture point. Each
 * scrubbed grid cell is drawn into it, so the visible wet patch IS the
 * coverage measurement rather than a decoration of it.
 */
function buildFieldDecal(view, site){
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const g = canvas.getContext("2d");
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;

  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, opacity: 0.62, depthWrite: false,
  });
  mat.userData.perInstance = true;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(FIELD_RADIUS*2, FIELD_RADIUS*2), mat);
  mesh.rotation.x = -Math.PI/2;
  const r = view.arm.radiusAt(site.x);
  const theta = Math.asin(Math.max(-1, Math.min(1, site.z/r)));
  const p = view.limbToWorld(site.x, theta, r + 0.0008);
  mesh.position.copy(p);
  view.root.add(mesh);

  return {
    mesh, canvas, ctx2d: g, tex,
    dispose(){ tex.dispose(); mat.dispose(); mesh.geometry.dispose(); },
  };
}

/** Repaints the decal from the set of scrubbed cells. */
function redrawDecal(){
  const d = ctx.decal;
  if(!d) return;
  const g = d.ctx2d, W = d.canvas.width;
  g.clearRect(0, 0, W, W);

  // the outline of the field the learner is aiming to cover
  g.strokeStyle = "rgba(70,120,160,0.55)";
  g.lineWidth = 2;
  g.beginPath();
  g.arc(W/2, W/2, W/2 - 2, 0, Math.PI*2);
  g.stroke();

  const cell = W/GRID;
  g.fillStyle = "rgba(150,205,235,0.92)";
  ctx.state.painted.forEach(idx=>{
    const gx = idx % GRID, gz = Math.floor(idx/GRID);
    g.fillRect(gx*cell, gz*cell, cell + 0.6, cell + 0.6);
  });

  // the puncture point itself, so "start here and work out" has a here
  g.fillStyle = "rgba(60,140,110,0.9)";
  g.beginPath();
  g.arc(W/2, W/2, 3, 0, Math.PI*2);
  g.fill();

  d.tex.needsUpdate = true;
}

/** How wet the field still looks. */
function updateWetness(){
  if(!ctx.decal) return;
  const secs = secondsDrying(ctx.state);
  // fades as the alcohol evaporates, which is the learner's cue to wait
  ctx.decal.mesh.material.opacity = 0.62*(1 - Math.min(1, secs/30)*0.72);
}

/* ---------- the swab ----------------------------------------------------------- */

function buildSwab(){
  const group = new THREE.Group();
  group.name = "alcoholSwab";
  const padMat = new THREE.MeshStandardMaterial({ color: 0xf4f7fa, roughness: 0.9 });
  padMat.userData.perInstance = true;
  const pad = new THREE.Mesh(new THREE.BoxGeometry(SWAB_RADIUS*2, 0.0022, SWAB_RADIUS*2), padMat);
  group.add(pad);
  const fingers = new THREE.Mesh(
    new THREE.SphereGeometry(0.0085, 12, 9),
    new THREE.MeshStandardMaterial({ color: 0xf0d8c4, roughness: 0.8 })
  );
  fingers.scale.set(1, 0.7, 1.1);
  fingers.position.y = 0.008;
  group.add(fingers);
  return { group, pad };
}

/* ---------- pointer ------------------------------------------------------------- */

function limbRadius(x){ return ctx.view.arm.radiusAt(x); }

function readSkin(e, canvasEl){
  const rect = canvasEl.getBoundingClientRect();
  return ctx.view.pointerToLimbSurface(
    { x: e.clientX, y: e.clientY }, rect,
    ctx.last ? ctx.last.x : null, limbRadius,
    ctx.last ? ctx.last.theta : null,
    // a swab is worked on the face of the arm turned toward you, never round
    // the hidden underside
    true
  );
}

function skinZ(s){ return Math.sin(s.theta)*limbRadius(s.x); }

export function cleaningPointerDown(e, canvasEl){
  if(!isCleaningActive()) return false;
  const s = readSkin(e, canvasEl);
  if(!s) return false;
  try{ canvasEl.setPointerCapture(e.pointerId); }catch(_){}
  ctx.down = true;
  ctx.last = { x: s.x, theta: s.theta, z: skinZ(s) };
  placeSwab(s);

  // Touching the site again once it is clean undoes it — including with the
  // swab, if the learner has already let it dry.
  const r = evaluateCleaning(ctx.state);
  if(r.ready) { markRetouched(ctx.state); sfx("bad"); }
  else sfx("tap");
  notify();
  return true;
}

export function cleaningPointerMove(e, canvasEl){
  if(!isCleaningActive()) return false;
  const s = readSkin(e, canvasEl);
  if(!s) return true;
  placeSwab(s);
  if(!ctx.down || !ctx.last){ ctx.last = { x: s.x, theta: s.theta, z: skinZ(s) }; return true; }

  const z = skinZ(s);
  const moved = Math.hypot(s.x - ctx.last.x, z - ctx.last.z);
  const dx = s.x - ctx.site.x, dz = z - ctx.site.z;
  const rNow = Math.hypot(dx, dz);
  const rWas = Math.hypot(ctx.last.x - ctx.site.x, ctx.last.z - ctx.site.z);

  // Friction is how much the pad is being WORKED, not how long it rests.
  const friction = Math.min(1, moved/FRICTION_FULL);

  // Paint the whole contact patch, not a single point — the pad has width.
  // Gated on the pad being open: recordStroke already refuses to count a
  // sealed one, but painting happens here, so without this the skin would
  // come up clean under a pad still in its wrapper.
  if(ctx.state.swabOpen && friction >= 0.18){
    const step = (2*FIELD_RADIUS)/GRID;
    for(let ox = -SWAB_RADIUS; ox <= SWAB_RADIUS; ox += step){
      for(let oz = -SWAB_RADIUS; oz <= SWAB_RADIUS; oz += step){
        if(Math.hypot(ox, oz) > SWAB_RADIUS) continue;
        const c = cellFor(dx + ox, dz + oz);
        if(c != null) ctx.state.painted.add(c);
      }
    }
  }
  recordStroke(ctx.state, dx, dz, moved, rNow - rWas, friction);

  ctx.last = { x: s.x, theta: s.theta, z };
  redrawDecal();
  notify();
  return true;
}

export function cleaningPointerUp(e, canvasEl){
  if(!isCleaningActive()) return false;
  try{ canvasEl.releasePointerCapture(e.pointerId); }catch(_){}
  ctx.down = false;
  notify();
  return true;
}

export function cleaningPointerCancel(){
  if(!isCleaningActive()) return false;
  ctx.down = false;
  return true;
}

function placeSwab(s){
  const p = ctx.view.limbToWorld(s.x, s.theta, limbRadius(s.x) + 0.0015);
  ctx.swab.group.position.copy(p);
  ctx.swab.group.rotation.set(0, 0, -s.theta);
  ctx.swab.group.visible = ctx.state.swabOpen;
}

/* ---------- per-frame ------------------------------------------------------------ */

export function renderCleaning(renderer, dt){
  if(!ctx) return false;
  const aspect = viewportAspect(renderer);
  ctx.frame++;
  if(Math.abs(aspect - ctx.lastAspect) > 0.01 || ctx.frame % 30 === 0){
    ctx.view.fitCamera(aspect, measureObstruction(renderer));
    ctx.lastAspect = aspect;
  }
  updateWetness();
  // the drying clock is the only thing that moves on its own
  if(ctx.frame % 15 === 0 && ctx.state.strokes && !ctx.down) notify();
  ctx.view.tick(dt || 0.016);
  renderer.render(ctx.view.scene, ctx.view.camera);
  return true;
}

/* ---------- programmatic (accessible path + tests) -------------------------------- */

export function openSwabPack(){
  if(!ctx) return null;
  openSwab(ctx.state);
  if(ctx.swab) ctx.swab.group.visible = true;
  sfx("click");
  return notify();
}

/**
 * Scrubs an outward spiral for real — the same recordStroke() the drag uses,
 * so the same coverage, direction and friction come out.
 * @param {number} turns   how far out to work
 * @param {number} frac    0..1 of the field to cover
 */
export function scrubSpiral(turns, frac){
  if(!ctx) return null;
  applySpiral(ctx.state, turns, frac);
  redrawDecal();
  return notify();
}

/** A dab in the middle, or a scrub back and forth — the wrong techniques. */
export function scrubBackAndForth(frac){
  if(!ctx) return null;
  applyBackAndForth(ctx.state, frac);
  redrawDecal();
  return notify();
}

/** Pretends the drying time has already passed — tests only, never in play. */
export function fastForwardDrying(seconds){
  if(!ctx || !ctx.state.lastStrokeAt) return null;
  ctx.state.lastStrokeAt -= (seconds || 0)*1000;
  return notify();
}

export function currentField(){
  if(!ctx) return null;
  const r = evaluateCleaning(ctx.state);
  return {
    swabOpen: ctx.state.swabOpen,
    coverage: r.coverage, outward: r.outward,
    dryness: r.dryness, seconds: r.secondsDrying,
    scrubbing: ctx.down,
  };
}
