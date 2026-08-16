/* =========================================================================
   PRESSURE AND BANDAGE RUNTIME — the same arm, the same puncture, the same pad
   the withdrawal step left in the learner's hand.

   TWO MODES, ONE SCENE, as fill/switch and the four post-draw steps already
   are: on a real patient this is one continuous piece of work.

   THE GEOMETRY — pressure is the one thing in this whole procedure that is
   genuinely a FORCE, and a screen has no force. What it does have is the
   limb's silhouette, and `pointerToAxis` gives the one honest depth cue in
   this view: `|p|/pMax` is 1 at the skin and less than 1 inside it. Driving
   the pointer further toward the limb's axis is exactly the motion of leaning
   on a pad, and how far in it goes is how hard. That is the same reading the
   tourniquet's wrap and the gauze's early-press both use, and it is the only
   one that is honest here — a plane solve would measure a position, and
   position is not force.

   Nothing about the hold is a timer this screen started: the clot progresses
   in postDrawState from real seconds at a real force, so letting go and
   holding on are physically different, and the render loop simply feeds it
   dt.

   Owns interaction. It writes postDrawState and asks postDrawRules; it never
   decides correctness itself.
   ========================================================================= */
import * as THREE from "three";
import { skinTick, tubeChink, wince, breath, exhale, pressureVoice } from "../../audio/procedural.js";
import { tapHaptic, seatHaptic, winceHaptic, contactHaptic } from "../../bench/haptics.js";
import { leaseBenchView } from "../../bench/benchSession.js";
import { HAND_X, WRIST_X } from "../arm/armAnatomy.js";
import { ARM_Y } from "../arm/armMesh.js";
import { evaluatePostDraw, forceBandFor, PAD_ON_SITE_M } from "./postDrawRules.js";
import {
  createPostDrawState, pressSample, releasePressure, holdPressureFor,
  flexArm, checkSite, applyBandage, removeBandage, giveAftercare,
} from "./postDrawState.js";
import { measureObstruction, viewportAspect } from "../viewport.js";

/** The bench top, shared with every other branch so the room is one room. */
const BENCH_Y = -0.030;
/** Where the dressing waits until it is picked up. */
const BANDAGE_SPOT = { x: -0.110, z: 0.150 };

/** Screen pixels within which a press counts as grabbing that thing. */
const GRAB_PX = 52;

/**
 * How far inside the silhouette counts as full force. At the skin the ratio is
 * 1; driving it to this fraction of the way toward the axis is everything the
 * hand has. Deliberately shallow — a real pad depresses the tissue a few
 * millimetres, not to the bone.
 */
const FULL_PRESS_AT = 0.50;
/** And how far down onto the limb a dressing has to be pulled to be at full tension. */
const FULL_TIGHT_AT = 0.55;

/** Metres the forearm lifts when the elbow is flexed. */
const FLEX_LIFT = 0.055;
/** Pixels of upward drag on the hand that flexes the elbow. */
const FLEX_PX = 46;

let ctx = null;

/* ---------- lifecycle ------------------------------------------------------------- */

/**
 * @param {object} opts
 *   mode        "pressure" | "bandage"
 *   state       an existing postDrawState to resume, or null for a new one
 *   arm         {skin, build, armSide, scenarioKeys, vigour, shirt}
 *   site        where the puncture is — {x, z} in arm-local metres
 *   guided      teaching mode
 *   onChange(result)
 */
export async function startPostDraw(opts){
  const o = opts || {};
  const view = leaseBenchView({ mode: "postdraw", arm: o.arm || {} });
  const state = o.state || createPostDrawState({});

  const site = o.site || { x: 0, z: 0.004 };
  const siteX = site.x == null ? 0 : site.x;
  const siteZ = site.z == null ? 0.004 : site.z;

  const gauze = buildGauze();
  view.root.add(gauze.group);

  const bandage = buildBandage();
  view.root.add(bandage.group);

  const blood = buildBlood();
  view.root.add(blood.group);

  ctx = {
    ...o,
    mode: o.mode || "pressure",
    view, state,
    gauze, bandage, blood,
    siteX, siteZ,
    down: false,
    drag: null,          // {kind:"press"|"flex"|"bandage", ...}
    /** where the pad is resting, arm-local metres along the limb */
    padX: siteX,
    padLifted: false,
    bandageCarry: null,
    active: true,
    frame: 0,
    lastAspect: 0,
    /* The hold, as something felt. See holdFeel() below. */
    voice: null,
    beatPhase: 0,
    throb: 0,
    winced: false,
    /** latched, so the clot holding announces itself exactly once */
    haemostasis: (state.clotProgress || 0) >= 1,
  };

  if(view.body) view.body.setWatching(true);
  view.setSiteVisible(false);
  syncObjects();
  notify();
  return ctx;
}

export function stopPostDraw(){
  if(!ctx) return;
  if(ctx.voice){ ctx.voice.stop(); ctx.voice = null; }
  ctx.view.dispose();
  ctx = null;
}

export function isPostDrawActive(){ return !!(ctx && ctx.active); }
export function getPostDrawContext(){ return ctx; }

function notify(){
  if(!ctx) return null;
  const result = evaluatePostDraw(ctx.state);
  if(ctx.onChange) ctx.onChange(result);
  return result;
}

/* ---------- the props -------------------------------------------------------------- */

function mat(color, o){
  const m = new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.7 }, o || {}));
  m.userData.perInstance = true;
  return m;
}

function buildGauze(){
  const group = new THREE.Group();
  group.name = "postDrawGauze";
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.006, 0.024), mat(0xf7f7f2, { roughness: 0.95 }));
  group.add(pad);
  // it soaks through if the puncture is still bleeding under it
  const stain = new THREE.Mesh(
    new THREE.CircleGeometry(0.0075, 18),
    new THREE.MeshBasicMaterial({ color: 0x8e1b1b, transparent: true, opacity: 0 })
  );
  stain.material.userData.perInstance = true;
  stain.rotation.x = -Math.PI/2;
  stain.position.y = 0.0032;
  group.add(stain);
  return { group, pad, stain };
}

function buildBandage(){
  const group = new THREE.Group();
  group.name = "postDrawBandage";
  const strip = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.0022, 0.019), mat(0xe8c9a0, { roughness: 0.85 }));
  group.add(strip);
  const padEl = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.0028, 0.015), mat(0xf9f9f4, { roughness: 0.95 }));
  padEl.position.y = -0.0012;
  group.add(padEl);
  group.position.set(BANDAGE_SPOT.x, BENCH_Y + 0.0022, BANDAGE_SPOT.z);
  return { group, strip, pad: padEl };
}

/** The bruise, painted on the skin as blood actually leaks into the tissue. */
function buildBlood(){
  const group = new THREE.Group();
  group.name = "postDrawBruise";
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(0.020, 24),
    new THREE.MeshBasicMaterial({ color: 0x6b2a4a, transparent: true, opacity: 0, depthWrite: false })
  );
  disc.material.userData.perInstance = true;
  disc.rotation.x = -Math.PI/2;
  group.add(disc);
  return { group, disc };
}

/* ---------- placement --------------------------------------------------------------- */

function limbRadius(x){ return ctx.view.arm.radiusAt(x); }

/** The skin's surface point above the limb at a position along the arm. */
function skinTop(x, z){
  const r = limbRadius(x);
  const theta = Math.asin(Math.max(-1, Math.min(1, (z || 0)/Math.max(1e-4, r))));
  return ctx.view.limbToWorld(x, theta, r);
}

/** How far the forearm is lifted right now — the flexed-elbow visual. */
function flexOffsetY(){
  return ctx.state.armFlexed ? FLEX_LIFT : 0;
}

function syncObjects(){
  if(!ctx) return;
  const s = ctx.state;

  // the arm itself lifts at the wrist end when the elbow is flexed
  ctx.view.arm.group.rotation.z = s.armFlexed ? -0.20 : 0;

  const top = skinTop(ctx.padX, ctx.siteZ);
  // the pad sinks INTO the tissue as it is pressed — the visible consequence
  // of the force, so the learner can see how hard they are leaning on it — and
  // lifts a little on each heartbeat, because a pad on an occluded vessel
  // genuinely moves
  const sink = 0.0075*s.force - 0.0011*ctx.throb*s.force;
  ctx.gauze.group.position.set(top.x, top.y + 0.004 + flexOffsetY() - sink, top.z);
  ctx.gauze.group.visible = !ctx.padLifted;
  // soaks through in proportion to what has actually leaked
  ctx.gauze.stain.material.opacity = Math.min(0.85, s.extravasatedMl*0.8);

  const siteTop = skinTop(ctx.siteX, ctx.siteZ);
  ctx.blood.group.position.set(siteTop.x, siteTop.y + 0.0012 + flexOffsetY(), siteTop.z);
  // the bruise spreads and darkens with the volume that actually extravasated
  const bruise = Math.min(1, s.extravasatedMl/1.1);
  ctx.blood.disc.material.opacity = bruise*0.55;
  ctx.blood.disc.scale.setScalar(0.35 + bruise*0.75);

  if(ctx.bandageCarry){
    ctx.bandage.group.position.copy(ctx.bandageCarry);
    ctx.bandage.group.visible = true;
  }else if(s.bandagedAt != null){
    const b = skinTop(ctx.siteX + s.bandageAlignM, ctx.siteZ);
    ctx.bandage.group.position.set(b.x, b.y + 0.003 + flexOffsetY(), b.z);
    ctx.bandage.group.visible = true;
    // a dressing pulled tight visibly narrows onto the limb
    ctx.bandage.strip.scale.z = 1 - 0.35*s.bandageTightness;
  }else{
    ctx.bandage.group.position.set(BANDAGE_SPOT.x, BENCH_Y + 0.0022, BANDAGE_SPOT.z);
    ctx.bandage.group.visible = true;
  }
}

/* ---------- the hold, as something FELT ------------------------------------------------
   Thirty seconds of holding still is the least promising interaction in the
   whole procedure, and it is also the last thing that happens to the patient —
   so if it reads as a wait, the encounter ends on a wait.

   Nothing here judges anything. It reports, continuously and on four channels
   at once, what the state already knows: how hard, whether that is enough, and
   whether it has gone past comfortable. Between them a learner can find the
   therapeutic band without looking at a readout, which is the point — on a
   real arm there is no readout.

     sound    a load that thickens in the band and rasps past it
     touch    the patient's own pulse, thudding through the pad
     the pad  sinks, and throbs on each beat
     the face tightens over the band, and lets go when the clot holds
*/

/**
 * Beats per second. The same rate armMesh pulses the brachial artery at
 * (`sin(clock*7.6)`, so 7.6/2π ≈ 1.21 Hz ≈ 73 bpm) and the same rate palpation
 * finds under the fingers — one patient, one heart.
 */
const PULSE_HZ = 7.6/(Math.PI*2);

/** How the current force sits against the band this site actually wants. */
function forceReading(){
  const band = forceBandFor(ctx.state.siteKind);
  const f = ctx.state.force;
  const inBand = f < band.min ? 0
    : f <= band.discomfort ? 1 - Math.min(1, Math.abs(f - band.ideal)/Math.max(0.01, band.discomfort - band.ideal))
    : 0;
  const over = f <= band.discomfort ? 0 : Math.min(1, (f - band.discomfort)/0.12);
  return { force: f, inBand, over };
}

/** Drives every feel channel from the state. Called every frame, pressing or not. */
function holdFeel(dt){
  const s = ctx.state;
  const pressing = ctx.down && ctx.drag && ctx.drag.kind === "press" && s.force > 0.02;
  const r = forceReading();

  if(pressing && !ctx.voice) ctx.voice = pressureVoice();
  if(!pressing && ctx.voice){ ctx.voice.stop(); ctx.voice = null; ctx.winced = false; }
  if(ctx.voice) ctx.voice.set(r);

  // The pulse. Felt harder the harder the pad is pressed, because that is what
  // occluding an artery's worth of tissue against your own thumb is like.
  ctx.throb = Math.max(0, ctx.throb - dt*4.5);
  if(pressing){
    ctx.beatPhase += dt*PULSE_HZ;
    if(ctx.beatPhase >= 1){
      ctx.beatPhase -= 1;
      ctx.throb = 1;
      if(ctx.voice) ctx.voice.pulse(r.force);
      contactHaptic();
    }
  }else{
    ctx.beatPhase = 0;
  }

  if(!ctx.view.body) return;
  if(pressing){
    // Leaning too hard shows on their face BEFORE it costs anything, so the
    // learner can back off — a punishment they never saw coming teaches
    // nothing.
    ctx.view.body.setTension(Math.min(1, 0.18 + r.over*0.82));
    if(r.over > 0.55 && !ctx.winced){
      ctx.winced = true;
      ctx.view.body.flinch(0.30);
      wince(); winceHaptic();
    }
    if(r.over < 0.30) ctx.winced = false;
  }else if(s.clotProgress >= 1){
    ctx.view.body.setTension(0);
  }else{
    ctx.view.body.setTension(0.12);
  }
}

/* ---------- reading the pointer as a FORCE ------------------------------------------- */

/**
 * WHERE ALONG THE ARM the pad is, established once when it is put down.
 *
 * NOT from `pointerToAxis`: that reports where the pointer's ray crosses the
 * limb's AXIS height, and a pad sits on the limb's TOP, ~4cm above it. With
 * the camera pitched and yawed, a ray through a point on the skin reaches axis
 * height a couple of centimetres further along the arm — the exact bias
 * armScene's own pointerToLimb has to refine away. Unrefined it read a pad
 * pressed squarely on the puncture as sitting 24mm off it.
 *
 * The pad rests ON TOP of the limb, so the horizontal plane through the skin's
 * top genuinely contains it, and a known plane is the one thing this view can
 * solve exactly (`pointerToPlane`). One refinement pass handles the limb's
 * taper, since the plane's own height depends on where along the arm it is.
 */
function alongArmAt(e, rect){
  const flex = flexOffsetY();
  const y0 = skinTop(ctx.siteX, ctx.siteZ).y + flex;
  const p = ctx.view.pointerToPlane({ x: e.clientX, y: e.clientY }, rect, y0);
  if(!p) return ctx.siteX;
  const y1 = skinTop(p.x, ctx.siteZ).y + flex;
  if(Math.abs(y1 - y0) > 1e-4){
    const p1 = ctx.view.pointerToPlane({ x: e.clientX, y: e.clientY }, rect, y1);
    if(p1) return p1.x;
  }
  return p.x;
}

/**
 * HOW HARD it is being pressed, as the fraction of the way from the skin
 * toward the limb's axis that the pointer has been driven, at a cross-section
 * that is FIXED for the whole press.
 *
 * Fixed on purpose, and it is not a shortcut: a finger leaning on a pad does
 * not slide along the arm, and letting the position float would mean the
 * downward press motion re-solved the position it was pressing at — the same
 * self-contaminating loop the arm-projection notes warn about. To move the
 * pad, the learner lifts it and puts it down again, which is also what they
 * would do in life.
 *
 * Both reference points are exactly known world points projected FORWARD
 * through toScreen(), which is never ambiguous — the pointer is then resolved
 * along that screen segment. 0 at the surface, 1 at the axis.
 *
 * Shared by the pad's force and the dressing's tightness, because both are the
 * same physical motion: something being pushed down onto the limb.
 */
function buildPressBasis(x, canvasEl){
  const rect = canvasEl.getBoundingClientRect();
  const flex = flexOffsetY();
  const skin = skinTop(x, ctx.siteZ);
  skin.y += flex;
  const axisPt = new THREE.Vector3(x, ARM_Y + flex, 0);
  const pSkin = ctx.view.toScreen(skin, rect, new THREE.Vector3());
  const pAxis = ctx.view.toScreen(axisPt, rect, new THREE.Vector3());
  return {
    sx: pSkin.x, sy: pSkin.y,
    dx: pAxis.x - pSkin.x, dy: pAxis.y - pSkin.y,
  };
}

/**
 * Resolves the pointer along that frozen segment.
 *
 * Frozen rather than re-projected per move, because fitCamera re-frames when
 * the coach panel's size changes — which it does the moment pressure starts —
 * and a live basis would silently re-scale the force under a stationary hand.
 * renderPostDraw also declines to re-frame at all while a hand is down, so the
 * view cannot shift mid-press either.
 */
function depthFrom(basis, e){
  if(!basis) return 0;
  const len = Math.hypot(basis.dx, basis.dy);
  if(len < 1e-6) return 0;
  const along = ((e.clientX - basis.sx)*basis.dx + (e.clientY - basis.sy)*basis.dy)/len;
  return Math.max(0, Math.min(1, along/len));
}

function screenDistTo(worldVec, e, rect){
  const p = ctx.view.toScreen(worldVec, rect, new THREE.Vector3());
  return Math.hypot(p.x - e.clientX, p.y - e.clientY);
}

/* ---------- pointer ------------------------------------------------------------------ */

export function postDrawPointerDown(e, canvasEl){
  if(!isPostDrawActive()) return false;
  const rect = canvasEl.getBoundingClientRect();
  const s = ctx.state;

  const grab = (kind, extra)=>{
    try{ canvasEl.setPointerCapture(e.pointerId); }catch(_){}
    ctx.down = true;
    ctx.drag = Object.assign({ kind, downX: e.clientX, downY: e.clientY }, extra || {});
    tapHaptic();
    return true;
  };

  // The dressing, once it is the thing being carried. Offered whenever the
  // bleeding has actually stopped — state, not step id, exactly as the
  // withdrawal branch settled on.
  const dressingLive = s.clotProgress >= 1 || s.bandagedAt != null || ctx.mode === "bandage";
  if(dressingLive && screenDistTo(ctx.bandage.group.position, e, rect) <= GRAB_PX){
    if(s.bandagedAt != null) removeBandage(s);
    ctx.bandageCarry = ctx.bandage.group.position.clone();
    syncObjects();
    return grab("bandage", {
      pull: 0, minDepth: null, placedX: null,
      basis: buildPressBasis(ctx.siteX, canvasEl),
    });
  }

  // The patient's hand: dragging it up bends the elbow, which is the classic
  // mistake and has to be available as a real action rather than a warning.
  const handWorld = skinTop((HAND_X + WRIST_X)/2, 0);
  handWorld.y += flexOffsetY();
  if(screenDistTo(handWorld, e, rect) <= GRAB_PX*1.3){
    return grab("flex", { startY: e.clientY });
  }

  // Otherwise: pressing the pad. Anywhere on the arm — pressing the wrong
  // place is a thing the learner can do, and it does nothing. Where it lands
  // is fixed here, for this press, and the drag that follows is pure force.
  ctx.padX = alongArmAt(e, rect);
  ctx.padLifted = false;
  return grab("press", {
    lastT: e.timeStamp || performance.now(),
    basis: buildPressBasis(ctx.padX, canvasEl),
  });
}

export function postDrawPointerMove(e, canvasEl){
  if(!isPostDrawActive()) return isPostDrawActive();
  const rect = canvasEl.getBoundingClientRect();
  const s = ctx.state;
  if(!ctx.down || !ctx.drag) return true;
  const d = ctx.drag;

  if(d.kind === "press"){
    const depth = depthFrom(d.basis, e);
    const force = Math.max(0, Math.min(1, depth/FULL_PRESS_AT));
    const now = e.timeStamp || performance.now();
    const dtS = Math.max(0, (now - (d.lastT || now))/1000);
    d.lastT = now;
    // the sample itself is what the state judges; the runtime only converts
    pressSample(s, force, ctx.padX - ctx.siteX, dtS);
    syncObjects();
    notify();
    return true;
  }

  if(d.kind === "flex"){
    const lifted = d.startY - e.clientY;
    const want = lifted > FLEX_PX;
    if(want !== s.armFlexed){
      flexArm(s, want);
      if(want) tubeChink(); else tapHaptic();
      syncObjects();
      notify();
    }
    return true;
  }

  if(d.kind === "bandage"){
    const p = ctx.view.pointerToPlane({ x: e.clientX, y: e.clientY }, rect,
      ARM_Y + limbRadius(ctx.siteX) + 0.006 + flexOffsetY());
    if(p) ctx.bandageCarry = p;
    // Once it is over the site, further downward travel is the ends being
    // pulled onto the limb. It is the SAME physical motion as pressing the pad
    // — something being pushed down onto the arm — so it uses the same depth
    // reading, and tightness is a real pull rather than a slider.
    if(ctx.bandageCarry && Math.abs(ctx.bandageCarry.x - ctx.siteX) < 0.030){
      // Measured from the SHALLOWEST point of the approach, which is where the
      // dressing touched down. The carry starts over the bench, well below the
      // arm on screen, so an absolute depth reading would count the whole
      // approach as tension and every dressing would go on as a tourniquet.
      const depth = depthFrom(d.basis, e);
      d.minDepth = d.minDepth == null ? depth : Math.min(d.minDepth, depth);
      d.pull = Math.max(d.pull, depth - d.minDepth);
      d.placedX = ctx.bandageCarry.x;
    }
    syncObjects();
    return true;
  }

  return true;
}

export function postDrawPointerUp(e, canvasEl){
  if(!isPostDrawActive()) return false;
  try{ canvasEl.releasePointerCapture(e.pointerId); }catch(_){}
  const d = ctx.drag;
  ctx.drag = null;
  ctx.down = false;
  if(!d) return false;
  const s = ctx.state;

  if(d.kind === "press"){
    // Taking the hand off the site IS lifting the gauze to look — which is
    // the check, and which costs progress if the clot is not holding yet.
    const wasPressing = s.force > 0.02;
    if(wasPressing){
      ctx.padLifted = true;
      checkSite(s);
      if(s.bleedingAtCheck){ wince(); winceHaptic(); } else { breath(0.1, true); seatHaptic(); }
    }else{
      releasePressure(s);
    }
    syncObjects();
    notify();
    return true;
  }

  if(d.kind === "bandage"){
    const dropped = ctx.bandageCarry;
    ctx.bandageCarry = null;
    if(dropped && Math.abs(dropped.x - ctx.siteX) < 0.040){
      applyBandage(s, {
        alignM: Math.abs(dropped.x - ctx.siteX),
        tightness: Math.max(0, Math.min(1, d.pull/FULL_TIGHT_AT)),
        // the pad slides off if it is dressed while the gauze is lifted clear
        shifted: ctx.padLifted && Math.abs(ctx.padX - ctx.siteX) > PAD_ON_SITE_M,
      });
      seatHaptic();
    }
    syncObjects();
    notify();
    return true;
  }

  syncObjects();
  notify();
  return true;
}

export function postDrawPointerCancel(){
  if(!isPostDrawActive()) return false;
  if(ctx.drag && ctx.drag.kind === "press") releasePressure(ctx.state);
  ctx.down = false;
  ctx.drag = null;
  ctx.bandageCarry = null;
  syncObjects();
  return true;
}

/* ---------- per-frame ----------------------------------------------------------------- */

export function renderPostDraw(renderer, dt){
  if(!ctx) return false;
  // What the camera is following: the gauze held on the puncture, until the dressing goes on.
  // See bench/handFraming.js — idempotent, so this is free per frame.
  ctx.view.hold((ctx.state.bandagedAt ? "none" : "gauze"));
  const aspect = viewportAspect(renderer);
  ctx.frame++;
  // Never re-frame while a hand is on the arm: the force is read against a
  // basis fixed when the press began, and moving the camera under a stationary
  // hand would change what it is holding. The coach panel resizes the instant
  // pressure starts, so this is not hypothetical.
  if(!ctx.down && (Math.abs(aspect - ctx.lastAspect) > 0.01 || ctx.frame % 30 === 0)){
    // framed to hold the puncture, the patient's hand (so a flexed elbow is
    // visible) and the dressing on the bench in one shot
    ctx.view.fitCamera(aspect, measureObstruction(renderer), {
      lookX: ctx.siteX - 0.060, lookZ: 0.055, lookY: ctx.view.ARM_Y + 0.020,
      spanX: 0.50, spanZ: 0.30,
    });
    ctx.lastAspect = aspect;
  }

  // The site goes on bleeding whether or not anything is being dragged — that
  // is the whole point of it. A hand off the pad is a puncture leaking.
  const s = ctx.state;
  if(!ctx.down && s.clotProgress < 1){
    const before = s.extravasatedMl;
    pressSample(s, 0, s.padOffsetM == null ? 0 : s.padOffsetM, dt || 0.016);
    if(s.extravasatedMl !== before && ctx.frame % 8 === 0){
      syncObjects();
      notify();
    }
  }

  /* The clot holding is the moment this step is FOR, and it used to arrive as
     a number quietly reaching 1. It gets the same treatment as the flashback
     does: the patient lets go of a breath, the pad settles, and the hand can
     come off. Fired once, from the crossing rather than from a check. */
  if(!ctx.haemostasis && s.clotProgress >= 1){
    ctx.haemostasis = true;
    exhale();
    seatHaptic();
    if(ctx.view.body){ ctx.view.body.relieve(); ctx.view.body.setTension(0); }
    ctx.view.kickCamera(0.0009, 0.2, -1);
  }

  holdFeel(dt || 0.016);
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

export function pressProgrammatically(kind, seconds){
  return after(s => {
    const band = forceBandFor(s.siteKind);
    const force = kind === "light" ? band.min - 0.08
      : kind === "hard" ? Math.min(1, band.discomfort + 0.10)
      : band.ideal;
    const offsetM = kind === "beside" ? PAD_ON_SITE_M + 0.012 : 0.004;
    ctx.padLifted = false;
    ctx.padX = ctx.siteX + offsetM;
    holdPressureFor(s, seconds == null ? 5 : seconds, { force, offsetM });
  });
}

/** Holds until the clot is actually holding — the accessible "keep going". */
export function holdUntilHaemostasisProgrammatically(){
  return after(s => {
    const band = forceBandFor(s.siteKind);
    ctx.padLifted = false;
    ctx.padX = ctx.siteX;
    holdPressureFor(s, s.holdSeconds + 2, { force: band.ideal, offsetM: 0.003 });
  });
}

export function flexArmProgrammatically(on){
  return after(s => flexArm(s, !!on));
}

export function checkSiteProgrammatically(){
  return after(s => {
    ctx.padLifted = true;
    checkSite(s);
  });
}

export function bandageProgrammatically(kind){
  return after(s => {
    const spec = kind === "off-site" ? { alignM: 0.020, tightness: 0.45 }
      : kind === "tight" ? { alignM: 0.003, tightness: 0.95 }
      : kind === "loose" ? { alignM: 0.003, tightness: 0.10 }
      : { alignM: 0.003, tightness: 0.45 };
    applyBandage(s, spec);
  });
}
export function removeBandageProgrammatically(){
  return after(s => removeBandage(s));
}
export function aftercareProgrammatically(){
  return after(s => giveAftercare(s));
}

/** Runs the bleed/clot clock forward without waiting in real time. */
export function fastForwardPressure(seconds){
  return after(s => {
    const step = 0.1;
    for(let t = 0; t < (seconds || 1); t += step){
      pressSample(s, s.force, s.padOffsetM == null ? 0 : s.padOffsetM, step);
    }
  });
}

/** What the arm looks like right now, for the coach. */
export function currentPostDraw(){
  if(!ctx) return null;
  return {
    mode: ctx.mode,
    pressing: !!(ctx.down && ctx.drag && ctx.drag.kind === "press"),
    padLifted: ctx.padLifted,
    carryingBandage: !!ctx.bandageCarry,
    force: ctx.state.force,
  };
}

/**
 * Exact screen points and scales a test needs to drive the gestures, projected
 * through the SAME toScreen() the runtime reads from.
 */
export function postDrawAnchors(){
  if(!ctx) return null;
  const canvas = typeof document !== "undefined" ? document.querySelector("canvas") : null;
  if(!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const at = (w)=>{ const p = ctx.view.toScreen(w, rect, new THREE.Vector3()); return { x: p.x, y: p.y }; };
  const siteTop = skinTop(ctx.siteX, ctx.siteZ);
  siteTop.y += flexOffsetY();
  const hand = skinTop((HAND_X + WRIST_X)/2, 0);
  hand.y += flexOffsetY();
  // a point at the limb's own axis height under the site: pressing toward it
  // is pressing INTO the tissue, which is what the force reading measures
  const axisUnderSite = new THREE.Vector3(ctx.siteX, ARM_Y + flexOffsetY(), 0);
  return {
    mode: ctx.mode,
    /**
     * Rendered frames so far. The camera is re-framed on the first one, so a
     * test that reads anchors before any frame has rendered gets values
     * projected against a camera that is about to move — and two such reads
     * agree with each other, which makes a naive "has it stopped moving?"
     * check pass on stale numbers.
     */
    frame: ctx.frame,
    site: at(siteTop),
    axisUnderSite: at(axisUnderSite),
    hand: at(hand),
    bandage: at(ctx.bandage.group.position.clone()),
    /** screen pixels per 10mm along the arm, for placing the pad off-site */
    alongPx: (()=>{
      const a = at(skinTop(ctx.siteX + 0.010, ctx.siteZ));
      const m = at(skinTop(ctx.siteX, ctx.siteZ));
      return { dx: a.x - m.x, dy: a.y - m.y };
    })(),
    fullPressAt: FULL_PRESS_AT,
  };
}
