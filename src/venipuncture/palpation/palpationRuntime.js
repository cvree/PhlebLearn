/* =========================================================================
   PALPATION RUNTIME — finding a vein by feel.

   THE OLD MODEL, and why none of it survived. To feel anything you had to
   press, hold the fingertip inside 0.9 mm for 110 ms so `still` became true,
   then wait 0.85 s for pressure to reach CONTACT_PRESS — and any movement at
   all decayed that pressure at 2.6 per second. Searching an arm therefore
   meant: press, freeze, wait a second, learn about one point, move, repeat.
   It played like minesweeper. It was the worst interaction in the game, and
   it was a faithful implementation of exactly the wrong idea, because
   palpation is not sampling points. Moving IS the search.

   THE NEW MODEL is a continuous feel field:

     YOU FEEL WHILE YOU MOVE.  No hold timer, no stillness requirement. The
       finger reports on every frame it is on the arm.

     PRESSURE IS AN AXIS, NOT A WAIT.  It jumps to a real touch the instant
       the finger lands, then ramps with dwell and eases off when you sweep
       fast. So a quick sweep sits at a light-to-medium press — right for
       finding superficial veins — and lingering bears down, which reveals
       what is deeper and OCCLUDES what is shallow. Press too hard over the
       vein you were hunting and you flatten it and it disappears; ease off
       and it comes back. That mechanic was already modelled in the rules
       (OCCLUDE_PRESS) and was previously almost unreachable.

     THE PRIMARY CHANNEL IS AUDIO-VISUAL, NOT TEXTUAL.  A low procedural
       "give" under the pad whose timbre changes with the tissue; an audible
       heartbeat that grows as you near the artery; the vein visibly swelling
       and springing back; a roller sliding away under pressure. Nothing is
       named until it has been felt.

   Owns interaction. It writes palpationState and asks palpationRules; the
   rules are untouched, and they remain the only thing that decides anything.
   ========================================================================= */
import * as THREE from "three";
import { leaseBenchView } from "../../bench/benchSession.js";
import { VESSEL_KIND, veinDistension, distalPallor } from "../arm/armAnatomy.js";
import {
  FEEL, feelAt, rollOffset, evaluatePalpation, CONTACT_PRESS, OCCLUDE_PRESS,
} from "./palpationRules.js";
import {
  createPalpationState, recordFeel, chooseVessel, clearChoice, markArteryRecognised,
  traceNear,
} from "./palpationState.js";
import { measureObstruction, viewportAspect } from "../viewport.js";
import { feelVoice, veinPop } from "../../audio/procedural.js";
import { assistLevel } from "../../bench/assist.js";
import { tapHaptic, seatHaptic } from "../../bench/haptics.js";

/**
 * A real touch, the instant the pad lands. Above CONTACT_PRESS (0.12), so
 * there is sensation on the very first frame and never a wait for one.
 */
const TOUCH_PRESS = 0.30;
/** Seconds of dwell from a resting touch to bearing right down. */
const PRESS_RAMP = 0.75;
/**
 * How much a sweep UNDOES dwell, in seconds of dwell per metre of skin
 * travelled.
 *
 * Sweeping used to only offset the pressure target, which the dwell ramp then
 * out-climbed within a frame or two — so moving never actually lightened the
 * touch, which is half of what makes pressure an axis rather than a timer.
 * Taking it out of the dwell itself means a real sweep genuinely comes off the
 * arm's deep structures and settling back down genuinely bears in again. Thirty
 * millimetres of travel undoes about a second, so anything above a slow drag
 * (roughly 33 mm/s) holds the touch light for as long as it keeps moving —
 * which is the point. If you are moving, you are searching; if you have
 * stopped, you are bearing down.
 */
const DWELL_PER_METRE = 30;
/** Floor a fast sweep holds: enough to feel superficial veins clearly. */
const SWEEP_FLOOR = 0.22;

/**
 * Extra metres of feelable width the assist layer buys.
 *
 * The rules' own `reach` is unchanged and still discriminates the basilic
 * from the brachial artery a centimetre away — the distinction the whole step
 * exists to teach. This only widens the SEARCH, so sweeping finds the vein;
 * it never changes which vessel the finger is on.
 */
function reachBonus(){ return 0.0018 + assistLevel()*0.0032; }

function nowMs(){
  return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
}

let ctx = null;

/* ---------- lifecycle -------------------------------------------------------- */

export async function startPalpation(opts){
  const o = opts || {};
  const view = leaseBenchView({ mode: "palpation", arm: o.arm || {} });
  const state = o.state || createPalpationState();

  const finger = buildFinger();
  view.root.add(finger.group);

  const halo = buildHalo();
  view.root.add(halo.group);

  const marker = buildMarker();
  marker.group.visible = false;
  view.root.add(marker.group);

  /* Everywhere the learner has pressed, drawn on the skin. Its own group so
     the whole map goes with the lease and nothing else does. */
  const traceGroup = new THREE.Group();
  traceGroup.name = "palpationTraces";
  view.root.add(traceGroup);

  ctx = {
    ...o,
    view, state, finger, marker, halo, traceGroup,
    traceSprites: new Map(),
    holdOn: null,
    tracePulse: 0,
    press: 0,
    finderPos: null,
    lastPos: null,
    sweep: 0,
    found: { feel: FEEL.NOTHING, vessel: null },
    down: false,
    active: true,
    frame: 0,
    lastAspect: 0,
    pulsePhase: 0,
    lastBeat: 0,
    downAt: 0,
    lastTickAt: 0,
    offArm: false,
    voice: null,
    /** how near the artery is, for the heartbeat's volume */
    arteryProximity: 0,
    dwell: 0,
  };

  // the band from the previous step is still on this arm, and the veins it
  // raised are the veins being palpated
  if(o.tourniquet) applyBandToArm(o.tourniquet);
  view.setSiteVisible(false);
  if(view.body) view.body.setWatching(true);
  notify();
  return ctx;
}

export function stopPalpation(){
  if(!ctx) return;
  if(ctx.voice) ctx.voice.stop();
  restoreVessels();
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
  const mat = new THREE.MeshStandardMaterial({ color: 0xd6e5f3, roughness: 0.44 });
  mat.userData.perInstance = true;
  // TWO fingers, because two fingers is how an arm is actually palpated — and
  // because a single sphere reads as a cursor rather than as a hand.
  const pad = new THREE.Mesh(new THREE.CapsuleGeometry(0.0082, 0.020, 4, 12), mat);
  pad.rotation.z = Math.PI/2;
  pad.position.set(-0.006, 0.0068, 0.007);
  group.add(pad);
  const pad2 = new THREE.Mesh(new THREE.CapsuleGeometry(0.0076, 0.018, 4, 12), mat);
  pad2.rotation.z = Math.PI/2;
  pad2.position.set(-0.007, 0.0072, -0.013);
  group.add(pad2);
  group.visible = false;
  return { group, pad, pad2 };
}

/**
 * The feel halo: what the pad is sensing, rendered as a FIELD rather than
 * spelled out as a label.
 *
 * Colour carries the QUALITY of the sensation, not the name of the structure:
 * a warm glow for something that gives, a hard pale wash for a cord that does
 * not, a beating one for something pushing back. The learner still has to
 * decide what that means, which is the actual clinical skill — and the halo
 * only ever exists where the hand has actually been, so it cannot be used to
 * scan the arm from a distance.
 */
function buildHalo(){
  const group = new THREE.Group();
  group.name = "feelHalo";
  const tex = softDot();
  const mat = new THREE.MeshBasicMaterial({
    map: tex, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false,
  });
  mat.userData.perInstance = true;
  const disc = new THREE.Mesh(new THREE.PlaneGeometry(0.048, 0.048), mat);
  disc.rotation.x = -Math.PI/2;
  group.add(disc);
  // a dimple: the skin actually depressing under the pad
  const dimpleMat = new THREE.MeshBasicMaterial({
    map: tex, color: 0x000000, transparent: true, opacity: 0, depthWrite: false,
  });
  dimpleMat.userData.perInstance = true;
  const dimple = new THREE.Mesh(new THREE.PlaneGeometry(0.026, 0.026), dimpleMat);
  dimple.rotation.x = -Math.PI/2;
  dimple.position.y = 0.0002;
  group.add(dimple);
  group.visible = false;
  return { group, disc, dimple, mat, dimpleMat };
}

let _dot = null;
function softDot(){
  if(_dot) return _dot;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 1, 32, 32, 31);
  grad.addColorStop(0, "rgba(255,255,255,0.95)");
  grad.addColorStop(0.42, "rgba(255,255,255,0.42)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  _dot = new THREE.CanvasTexture(c);
  return _dot;
}

/** The pen marks left where the learner committed. */
function buildMarker(){
  const group = new THREE.Group();
  group.name = "siteMark";
  const ink = new THREE.MeshBasicMaterial({ color: 0x2e4a86, transparent: true, opacity: 0.62, depthWrite: false });
  ink.userData.perInstance = true;
  // Two short strokes either side of the site, the way a real one is marked —
  // never ON the puncture point, which would carry ink into the puncture.
  const a = new THREE.Mesh(new THREE.PlaneGeometry(0.0018, 0.010), ink);
  a.rotation.x = -Math.PI/2; a.position.set(0, 0, 0.0085);
  group.add(a);
  const b = new THREE.Mesh(new THREE.PlaneGeometry(0.0018, 0.010), ink);
  b.rotation.x = -Math.PI/2; b.position.set(0, 0, -0.0085);
  group.add(b);
  return { group, ink };
}

/* =========================================================================
   THE TRACES ON THE SKIN

   One sprite per spot the learner has actually pressed, coloured by what was
   under the finger there. Two seconds of holding on one commits to it.

   The colours are not decoration and they are not a verdict: they are what
   the FINGER reported, which the learner already knows because they just felt
   it. Withholding them in Play would be withholding the sense of touch, not
   withholding a judgement — modes.css suppresses judgement colour, and these
   are deliberately outside that system.
   ========================================================================= */
const TRACE_INK = {
  [FEEL.VEIN]:      0x3f7f6d,   // gave, and came back
  [FEEL.ROLLING]:   0x6f9a5e,   // slid away under the finger
  [FEEL.ARTERY]:    0xb2543f,   // pushed back, rhythmically
  [FEEL.TENDON]:    0x7a7469,   // hard, and did not move
  [FEEL.NERVE]:     0xa8446e,   // that hurt
  [FEEL.FLATTENED]: 0x4c6f88,   // pressed flat
  [FEEL.SOFT]:      0x9aa3ac,   // nothing under here
  [FEEL.NOTHING]:   0x9aa3ac,
};

/** Two seconds on a spot you have already felt is a decision. */
const COMMIT_HOLD_S = 2.0;

/**
 * Anything the finger identified as a STRUCTURE can be committed to —
 * including the artery, and including the tendon.
 *
 * The first version of this gated commitment to veins only, which quietly
 * deleted the most important lesson in the step: `palpationRules.js` has a
 * blocking `choseArtery` issue precisely so that a learner who marks a pulsing
 * vessel is told, in words, why that is the one thing you must never do. An
 * interaction that makes the mistake unreachable never delivers it.
 *
 * It is also the rule the whole game runs on. The unsafe action is equally
 * available and equally easy; nothing is blocked, everything is recorded.
 */
function isChoosable(feel){
  return feel !== FEEL.NOTHING && feel !== FEEL.SOFT;
}

/** Drops a mark where a press happened, or brightens the one already there. */
function paintTrace(trace){
  if(!ctx) return;
  let sprite = ctx.traceSprites.get(trace);
  if(!sprite){
    const m = new THREE.MeshBasicMaterial({
      map: softDot(), color: TRACE_INK[trace.feel] || TRACE_INK[FEEL.SOFT],
      transparent: true, opacity: 0.0, depthWrite: false,
    });
    m.userData.perInstance = true;
    sprite = new THREE.Mesh(new THREE.PlaneGeometry(0.0105, 0.0105), m);
    sprite.renderOrder = 3;
    ctx.traceGroup.add(sprite);
    ctx.traceSprites.set(trace, sprite);
  }
  sprite.material.color.setHex(TRACE_INK[trace.feel] || TRACE_INK[FEEL.SOFT]);
  // Deeper and more repeated presses read stronger, so a spot the learner
  // really interrogated looks different from one they brushed past.
  sprite.material.opacity = Math.min(0.85, 0.38 + trace.presses*0.02 + trace.peakPress*0.30);
  const r = limbRadius(trace.x) + 0.0007;
  sprite.position.copy(ctx.view.limbToWorld(trace.x, trace.theta, r));
  sprite.rotation.set(0, 0, -trace.theta);
  sprite.rotateX(-Math.PI/2);
}

/** The artery keeps pulsing under the finger that found it. */
function tickTraces(dt){
  if(!ctx) return;
  ctx.tracePulse = (ctx.tracePulse || 0) + dt;
  ctx.traceSprites.forEach((sprite, trace)=>{
    if(trace.feel !== FEEL.ARTERY) return;
    const beat = 0.5 + 0.5*Math.sin(ctx.tracePulse*7.2);
    sprite.scale.setScalar(1 + beat*0.22);
  });
}

/** Commits to a trace as the draw site. The only way a site gets chosen. */
function commitTrace(trace){
  // the chosen mark brightens and holds, so the site reads at a glance among
  // everywhere else the learner looked
  const sprite = ctx.traceSprites.get(trace);
  if(sprite){ sprite.material.opacity = 0.9; sprite.scale.setScalar(1.3); }
  chooseVessel(ctx.state, trace.vesselId, { x: trace.x, z: trace.z });
  showMark({ x: trace.x, theta: trace.theta, z: trace.z });
  seatHaptic();
  veinPop();
  notify();
}

/* ---------- pointer ---------------------------------------------------------- */

function limbRadius(x){ return ctx.view.arm.radiusAt(x); }

function readSkin(e, canvasEl){
  const rect = canvasEl.getBoundingClientRect();
  return ctx.view.pointerToLimbSurface(
    { x: e.clientX, y: e.clientY }, rect,
    ctx.finderPos ? ctx.finderPos.x : null, limbRadius,
    // A ray meets the limb twice and both hits are on the skin, so the solve
    // needs telling which. A palpating finger is always on the face of the arm
    // turned toward the operator, so the near hit is the right one.
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
  // A real touch, immediately. There is sensation on this very frame.
  ctx.press = TOUCH_PRESS;
  ctx.dwell = 0;
  ctx.offArm = false;
  ctx.downAt = nowMs();
  ctx.lastTickAt = nowMs();
  ctx.sweep = 0;
  placeFinger(s);
  if(!ctx.voice) ctx.voice = feelVoice();
  tapHaptic();
  return true;
}

export function palpationPointerMove(e, canvasEl){
  if(!isPalpationActive()) return false;
  const s = readSkin(e, canvasEl);
  /* THE POINTER HAS LEFT THE ARM. The hand comes off with it: it does not
     freeze where it last was while the pressure quietly keeps building, which
     is what used to happen and which made a sweep that ran off the edge of the
     limb bear down harder than one that stayed on it. */
  if(!s){
    ctx.offArm = true;
    return true;
  }
  ctx.offArm = false;
  if(ctx.finderPos){
    // consumed and cleared by tickFeel, so speed is measured per FRAME rather
    // than per pointer event — a rate sampled between two raw events is mostly
    // a measure of how the events happened to land
    ctx.sweep += Math.hypot(s.x - ctx.finderPos.x, skinZ(s) - ctx.finderPos.z);
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
  if(ctx.voice) ctx.voice.set({ press: 0, moving: 0, resonance: 0 });
  notify();
  return true;
}

export function palpationPointerCancel(){
  if(!isPalpationActive()) return false;
  ctx.down = false;
  if(ctx.voice) ctx.voice.set({ press: 0, moving: 0, resonance: 0 });
  return true;
}

function skinZ(s){ return Math.sin(s.theta)*limbRadius(s.x); }

function placeFinger(s){
  ctx.finderPos = { x: s.x, theta: s.theta, z: skinZ(s) };
  const sink = ctx.press*0.0065;
  const p = ctx.view.limbToWorld(s.x, s.theta, limbRadius(s.x) - sink);
  ctx.finger.group.position.copy(p);
  ctx.finger.group.visible = true;
  ctx.finger.group.rotation.set(0, 0, -s.theta);

  const hp = ctx.view.limbToWorld(s.x, s.theta, limbRadius(s.x) + 0.0008);
  ctx.halo.group.position.copy(hp);
  ctx.halo.group.rotation.set(0, 0, -s.theta);
}

/* ---------- per-frame -------------------------------------------------------- */

export function renderPalpation(renderer, dt){
  if(!ctx) return false;
  // What the camera is following: the fingertips, while they are on the arm.
  // See bench/handFraming.js — idempotent, so this is free per frame.
  ctx.view.hold(ctx.down ? "finger" : "none");
  const step = dt || 0.016;
  const aspect = viewportAspect(renderer);
  ctx.frame++;

  if(Math.abs(aspect - ctx.lastAspect) > 0.01 || ctx.frame % 30 === 0){
    ctx.view.fitCamera(aspect, measureObstruction(renderer));
    ctx.lastAspect = aspect;
  }

  tickFeel(step);
  tickTraces(step);
  // Holding the hand on the arm eases the camera in and narrows the frame.
  // The cheapest way to make examining feel like examining.
  ctx.view.setLean(ctx.down ? Math.min(1, ctx.dwell/0.9) : 0);
  ctx.view.tick(step);
  renderer.render(ctx.view.scene, ctx.view.camera);
  return true;
}

function tickFeel(dt){
  const wasFeel = ctx.found ? ctx.found.feel : FEEL.NOTHING;
  ctx.pulsePhase += dt*7.6;

  /* PRESSURE. Dwell bears down; sweeping lightens. Neither is a gate — the
     finger is reporting on every one of these frames either way.

     Dwell is WALL-CLOCK, not the render delta. "How long has the finger been
     there" is a question about the player, not about the simulation, and the
     render delta is deliberately clamped per frame so a stalled tab cannot
     make the scene jump. On a machine running at 3 fps that clamp made the
     pressure axis climb at a fifth of real speed — the mechanic silently got
     worse the weaker your hardware was, which is exactly backwards. */
  const swept = ctx.sweep;
  ctx.sweptLast = swept;
  const sweepSpeed = swept/Math.max(dt, 0.001);
  ctx.sweep = 0;
  const nowT = nowMs();
  const realDt = ctx.lastTickAt ? Math.min(0.5, (nowT - ctx.lastTickAt)/1000) : 0;
  ctx.lastTickAt = nowT;
  if(ctx.down && !ctx.offArm){
    // Wall-clock, not the render delta — see the note above — and reduced by
    // however far the pad actually travelled, so a sweep is a lighter touch
    // and settling is a deeper one.
    ctx.dwell = Math.max(0, ctx.dwell + realDt - swept*DWELL_PER_METRE);
    const target = Math.max(SWEEP_FLOOR,
      Math.min(1, TOUCH_PRESS + (ctx.dwell/PRESS_RAMP)*0.85));
    ctx.press += (target - ctx.press)*(1 - Math.exp(-dt/0.25));
  }else{
    ctx.dwell = 0;
    ctx.press = Math.max(0, ctx.press - dt*4.5);
  }

  if(ctx.offArm || !ctx.finderPos){
    ctx.found = { feel: FEEL.NOTHING, vessel: null };
    ctx.halo.group.visible = false;
    return;
  }

  const found = feelAt(
    ctx.view.arm.vessels, ctx.finderPos.x, ctx.finderPos.z, ctx.press, reachBonus()
  );
  ctx.found = found;
  if(ctx.press > CONTACT_PRESS){
    /* EVERY PRESS LEAVES A MARK. The learner's own vein map builds up under
       their hand as they search, and it is what they choose from afterwards.
       Nothing is remembered for them and nothing needs a button. */
    recordFeel(ctx.state, found, ctx.press, dt*1000, ctx.finderPos);
    if(ctx.state.lastTrace) paintTrace(ctx.state.lastTrace);
  }

  // Where the finger last was, for the press-and-hold that commits a site.
  if(found.vessel && ctx.press > CONTACT_PRESS){
    ctx.lastFound = found;
    ctx.lastPos = { x: ctx.finderPos.x, theta: ctx.finderPos.theta, z: ctx.finderPos.z };
  }

  /* PRESS AND HOLD ON A TRACE TO COMMIT TO IT. Two seconds on a spot you have
     already felt is a decision, and it is the only way a site gets chosen —
     there is no Mark button any more, in either input path. Holding on a
     different trace moves the site to it. */
  if(ctx.down && ctx.press > CONTACT_PRESS && ctx.finderPos){
    const on = traceNear(ctx.state, ctx.finderPos);
    if(on && on.vesselId && isChoosable(on.feel)){
      ctx.holdOn = (ctx.holdOn && ctx.holdOn.trace === on)
        ? { trace: on, secs: ctx.holdOn.secs + dt }
        : { trace: on, secs: dt };
      if(ctx.holdOn.secs >= COMMIT_HOLD_S && ctx.state.chosenId !== on.vesselId){
        commitTrace(on);
      }
    }else{
      ctx.holdOn = null;
    }
  }else if(!ctx.down){
    ctx.holdOn = null;
  }

  ctx.arteryProximity = arteryProximity();
  animateResponse(found, dt);
  paintHalo(found);
  speak(found, sweepSpeed);

  if(found.feel !== wasFeel) notify();
}

/**
 * How close the pad is to the artery, 0…1, regardless of whether it is close
 * enough for the rules to call it a find.
 *
 * This drives the heartbeat's volume, and it is the single change that makes
 * the artery findable by ear: you hear it coming before you are on it, which
 * is exactly what a real pulse does under a hand.
 */
function arteryProximity(){
  const art = ctx.view.arm.vessels.find(v => v.kind === VESSEL_KIND.ARTERY);
  if(!art || !ctx.finderPos) return 0;
  let best = Infinity;
  for(const p of art.path){
    best = Math.min(best, Math.hypot(p.x - ctx.finderPos.x, p.z - ctx.finderPos.z));
  }
  return Math.max(0, 1 - best/0.034);
}

/** The audio half of the sensation. */
function speak(found, sweepSpeed){
  if(!ctx.voice) return;
  const press = ctx.press;
  const moving = Math.min(1, sweepSpeed*7);
  let resonance = 0, pitch = 92;

  switch(found.feel){
    case FEEL.VEIN:      resonance = 0.90; pitch = 74;  break;
    case FEEL.ROLLING:   resonance = 0.72; pitch = 88;  break;
    case FEEL.FLATTENED: resonance = 0.14; pitch = 150; break;
    // A cord: hard, dead, no resonance at all. The absence IS the answer.
    case FEEL.TENDON:    resonance = 0.10; pitch = 240; break;
    case FEEL.NERVE:     resonance = 0.30; pitch = 300; break;
    case FEEL.ARTERY:    resonance = 0.55; pitch = 66;  break;
    case FEEL.SOFT:      resonance = 0.20; pitch = 120; break;
    default:             resonance = 0;                 break;
  }
  ctx.voice.set({ press, moving, resonance, pitch });

  // The heartbeat, in time with the artery's own pulse in armMesh.
  const beat = Math.sin(ctx.pulsePhase);
  if(beat > 0.985 && ctx.pulsePhase - ctx.lastBeat > 0.5){
    ctx.lastBeat = ctx.pulsePhase;
    const near = ctx.arteryProximity*(press > CONTACT_PRESS ? 1 : 0.35);
    if(near > 0.05) ctx.voice.pulse(near);
  }
}

const HALO_COLOUR = {
  [FEEL.VEIN]:      0x6ec0a0,
  [FEEL.ROLLING]:   0x9fc86e,
  [FEEL.FLATTENED]: 0x8f96a2,
  [FEEL.TENDON]:    0xe8e0cf,
  [FEEL.NERVE]:     0xe6d06a,
  [FEEL.ARTERY]:    0xd4726a,
  [FEEL.SOFT]:      0xc9bfae,
};

/** The visual half. A field under the pad, never a word. */
function paintHalo(found){
  const h = ctx.halo;
  const on = ctx.press > 0.02;
  h.group.visible = on;
  if(!on) return;
  h.mat.color.setHex(HALO_COLOUR[found.feel] || 0xc9bfae);
  let strength = ctx.press*0.42;
  if(found.feel === FEEL.ARTERY){
    // beats, so the halo itself carries the rhythm
    strength *= 0.55 + 0.85*Math.max(0, Math.sin(ctx.pulsePhase));
  }else if(found.feel === FEEL.NOTHING || found.feel === FEEL.SOFT){
    strength *= 0.42;
  }
  h.mat.opacity = Math.min(0.68, strength);
  const spread = 1 + ctx.press*0.35 + (found.vessel ? 0.18 : 0);
  h.disc.scale.set(spread, spread, 1);
  h.dimpleMat.opacity = Math.min(0.20, ctx.press*0.22);
  const ds = 0.7 + ctx.press*0.55;
  h.dimple.scale.set(ds, ds, 1);
}

/**
 * The tissue's own response. A vein dips under the finger and comes back; a
 * roller slides sideways; the tendon does nothing, which is itself the answer;
 * and a vein pressed past OCCLUDE_PRESS flattens out and DISAPPEARS — the
 * mechanic that makes the pressure axis worth having.
 */
const _touched = new Set();
function animateResponse(found, dt){
  const meshes = ctx.view.arm.vesselMeshes;
  // anything touched last frame and not this one springs back
  _touched.forEach(id => {
    if(found.vessel && found.vessel.id === id) return;
    const m = meshes.get(id);
    if(!m){ _touched.delete(id); return; }
    const k = 1 - Math.exp(-dt/0.12);
    m.position.z += (0 - m.position.z)*k;
    m.position.y += (0 - m.position.y)*k;
    m.scale.y += (1 - m.scale.y)*k;
    if(Math.abs(m.position.z) < 1e-5 && Math.abs(m.position.y) < 1e-5 && Math.abs(m.scale.y - 1) < 1e-3){
      m.position.set(0, 0, 0); m.scale.set(1, 1, 1);
      _touched.delete(id);
    }
  });
  if(!found.vessel) return;
  const mesh = meshes.get(found.vessel.id);
  if(!mesh) return;
  _touched.add(found.vessel.id);

  const k = 1 - Math.exp(-dt/0.07);
  if(found.feel === FEEL.ROLLING){
    // real lateral displacement — the vein is genuinely somewhere else now
    const off = rollOffset(found.vessel, ctx.press) * (ctx.finderPos.z >= 0 ? 1 : -1);
    mesh.position.z += (off - mesh.position.z)*k;
    mesh.scale.y += (1 - mesh.scale.y)*k;
  }else if(found.feel === FEEL.FLATTENED){
    // squashed out of existence under the pad, and back when you ease off
    mesh.position.z += (0 - mesh.position.z)*k;
    mesh.position.y += (-0.0028 - mesh.position.y)*k;
    mesh.scale.y += (0.22 - mesh.scale.y)*k;
  }else if(found.feel === FEEL.VEIN){
    mesh.position.z += (0 - mesh.position.z)*k;
    mesh.position.y += (-ctx.press*0.0018 - mesh.position.y)*k;
    mesh.scale.y += ((1 - ctx.press*0.30) - mesh.scale.y)*k;
  }
}

function restoreVessels(){
  if(!ctx) return;
  ctx.view.arm.vesselMeshes.forEach(m => { m.position.set(0, 0, 0); m.scale.set(1, 1, 1); });
  _touched.clear();
}

/* ---------- committing ------------------------------------------------------- */

/**
 * Commits to one of the learner's own traces, by index.
 *
 * The 3D path reaches this by pressing and holding on a mark; the accessible
 * path reaches it from the same map rendered as a list. There is no way in
 * either to commit to a spot that was never felt, which is what the old
 * "Mark this spot" button allowed — it marked wherever the finger happened to
 * have been last, whether the learner had assessed it or not.
 */
export function chooseTraceById(i){
  if(!ctx) return null;
  const t = (ctx.state.traces || [])[i];
  if(!t || !t.vesselId) return null;
  commitTrace(t);
  return notify();
}

function showMark(pos){
  ctx.marker.group.position.copy(
    ctx.view.limbToWorld(pos.x, pos.theta, limbRadius(pos.x) + 0.0009)
  );
  ctx.marker.group.rotation.set(0, 0, -pos.theta);
  ctx.marker.group.visible = true;
}

export function unmarkSite(){
  if(!ctx) return null;
  clearChoice(ctx.state);
  ctx.marker.group.visible = false;
  ctx.holdOn = null;
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
  if(found.vessel){ ctx.lastFound = found; ctx.lastPos = Object.assign({}, ctx.finderPos); }
  recordFeel(ctx.state, found, ctx.press, 260, ctx.finderPos);
  if(ctx.state.lastTrace) paintTrace(ctx.state.lastTrace);
  placeFinger({ x: mid.x, theta: ctx.finderPos.theta });
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
    /** how near the artery is, whether or not it has been identified */
    arteryProximity: ctx.arteryProximity,
    /** seconds of settled dwell, net of how far the pad has swept */
    dwell: ctx.dwell,
    /** metres of skin travelled since the last frame */
    sweptM: ctx.sweptLast || 0,
  };
}

export { FEEL };
