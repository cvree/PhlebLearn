/* =========================================================================
   TUBE COLLECTION STATE — which tube is on the holder right now, how far it
   is pushed on, how much has actually gone into it, and how far the needle
   has been moved in the vein doing it.

   Carried on the encounter, so the tubes that come off here are the tubes the
   invert step later turns over, and the needle whose position this step
   disturbs is the needle the insert step put in.

   Every field is something the learner physically did. collectionRules.js
   does the judging. Pure data — no THREE, no DOM.
   ========================================================================= */
import {
  SEAT_GUIDELINE, SEAT_ENGAGE, SEAT_BOTTOM,
  GRIP, needleShiftFrom, lumenToleranceM,
  tubeVolumeMl, drawRateMlPerS, collapsesVein, carryoverInto,
  expectedOrder, REFILL_SECONDS, isRedrawable,
} from "./collectionRules.js";

/**
 * @param {object} o
 *   order    the tube keys this draw needs, in whatever order they arrive —
 *            sorted into canonical order of draw here, because that is what
 *            "next expected" means everywhere else
 *   vessel   {id, calibre, depth} — the vessel the needle is actually in
 *   gauge    the needle they staged
 *   vigour   the patient's own venous filling
 *   inVein   whether the insert step ended with the tip in the lumen
 */
export function createCollectionState(o){
  const opt = o || {};
  const order = expectedOrder(opt.order || []);
  return {
    order,
    vessel: opt.vessel ? { id: opt.vessel.id, calibre: opt.vessel.calibre, depth: opt.vessel.depth } : null,
    gauge: opt.gauge == null ? 21 : opt.gauge,
    vigour: opt.vigour == null ? 1 : opt.vigour,
    inVein: opt.inVein !== false,

    /** every tube that has been on the holder, by key */
    tubes: {},
    /** the keys in the sequence they were actually taken off the rack */
    takenSequence: [],
    /** the last tube whose stopper was pierced — the source of any carryover */
    lastDrawnKey: null,

    currentKey: null,
    /** metres the current tube is pushed into the holder */
    seatDepth: 0,
    /** where the hand was when the current push started */
    grip: GRIP.BODY,

    /* --- the needle, which is still in the patient --------------------------- */
    /** how far the tip is from where it entered, right now */
    needleShiftM: 0,
    /** the worst it has ever been */
    peakShiftM: 0,
    /** net axial displacement, +ve deeper. Pushing then pulling back undoes it. */
    needleDeeperM: 0,
    /** sideways excursion, which does NOT undo — the tip has been levered across */
    needleLateralM: 0,
    needleOut: false,

    /* --- counts ---------------------------------------------------------------- */
    tubesWasted: 0,
    reseats: 0,
    startedAt: opt.now == null ? Date.now() : opt.now,

    events: [],
  };
}

export function recordEvent(state, type, data){
  state.events.push({ t: Date.now(), type, data: data == null ? null : data });
  if(state.events.length > 200) state.events.shift();
  return state;
}

function newTubeRecord(key, now){
  return {
    key,
    volumeMl: tubeVolumeMl(key),
    drawnMl: 0,
    pierced: false,
    piercedAt: null,
    removedAt: null,
    takenAt: now,
    /** the stopper was pierced while nothing was coming out of the needle */
    deadOnAir: false,
    collapsed: false,
    /** how much of its volume this vacuum cycle is good for before the wall shuts */
    collapseAllowance: 0.28,
    vacuumCycles: 1,
    refillUntil: null,
    carryover: null,
    /** worst needle displacement recorded while this tube was being handled */
    shiftDuringM: 0,
  };
}

/* =========================================================================
   WHOLE TECHNIQUES, AS PURE STATE CHANGES

   Shared by the drag path, the accessible controls and the tests, so all
   three produce identical seat depths, fill volumes and needle shifts. The
   controls path tears the 3D scene down, so it cannot go through the runtime
   — but it must not get an easier or different rule set either.
   ========================================================================= */

/* ---------- off the rack ------------------------------------------------------- */

/**
 * Picks a tube up off the rack. Any tube — being the wrong one is the lesson.
 *
 * A tube that has already come off can be taken again only if drawing it
 * again would actually help: short of its ratio, or killed on air. One ruined
 * by carryover cannot, because the additive is in the needle and a second
 * tube through the same needle would be ruined the same way.
 */
export function takeTube(state, key, now){
  if(state.currentKey) return state;
  if(!key) return state;
  const t = state.tubes[key];
  if(t && t.removedAt){
    if(!isRedrawable(t)) return state;
    state.tubesWasted += 1;
    state.tubes[key] = newTubeRecord(key, now == null ? Date.now() : now);
    state.currentKey = key;
    state.seatDepth = 0;
    state.takenSequence.push(key);
    recordEvent(state, "redrawTube", { key });
    return state;
  }
  state.tubes[key] = t || newTubeRecord(key, now == null ? Date.now() : now);
  state.currentKey = key;
  state.seatDepth = 0;
  state.takenSequence.push(key);
  recordEvent(state, "takeTube", { key });
  return state;
}

/** Puts the current tube back on the rack untouched — free while unpierced. */
export function returnTube(state){
  const cur = current(state);
  if(!cur) return state;
  if(cur.pierced) return state;
  delete state.tubes[cur.key];
  const i = state.takenSequence.lastIndexOf(cur.key);
  if(i >= 0) state.takenSequence.splice(i, 1);
  state.currentKey = null;
  state.seatDepth = 0;
  recordEvent(state, "returnTube", { key: cur.key });
  return state;
}

/** Bins a tube that can no longer fill and takes a fresh one of the same kind. */
export function discardTube(state, now){
  const cur = current(state);
  if(!cur) return state;
  const key = cur.key;
  state.tubesWasted += 1;
  state.tubes[key] = newTubeRecord(key, now == null ? Date.now() : now);
  state.currentKey = key;
  state.seatDepth = 0;
  recordEvent(state, "discardTube", { key });
  return state;
}

export function current(state){
  return state.currentKey ? state.tubes[state.currentKey] : null;
}

/* ---------- seating ------------------------------------------------------------- */

/**
 * One moment of pushing or pulling the tube along the holder's axis.
 *
 * @param {number} dAxialM         metres toward the holder (+) or away from it (-)
 * @param {number} lateralOffsetM  the tube's CURRENT sideways offset from the
 *   holder's axis, not a delta — see needleShiftFrom()
 * @param {string} grip            GRIP.FLANGE if the flange was being held
 */
export function seat(state, dAxialM, lateralOffsetM, grip, now){
  const cur = current(state);
  if(!cur) return state;
  if(grip) state.grip = grip;

  const before = state.seatDepth;
  state.seatDepth = Math.max(0, Math.min(SEAT_BOTTOM + 0.004, before + (dAxialM || 0)));

  // Only travel PAST THE GUIDELINE puts any force on the needle. Short of it
  // the tube is sliding freely inside the barrel and has not met the rubber
  // yet — which is a third reason the guideline is where it is, and it means
  // simply bringing a tube up to the holder can never disturb the patient.
  const loaded = Math.max(0, state.seatDepth - SEAT_GUIDELINE)
    - Math.max(0, before - SEAT_GUIDELINE);
  const engagedAtAll = state.seatDepth > SEAT_GUIDELINE || before > SEAT_GUIDELINE;
  applyNeedleShift(state, loaded, engagedAtAll ? lateralOffsetM : 0, state.grip, cur);

  if(!cur.pierced && state.seatDepth >= SEAT_ENGAGE) pierce(state, now);
  // Backing off to (or past) the guideline breaks the vacuum. That is the only
  // way out of a collapsed vein, and it costs the wait for it to refill.
  if(cur.pierced && state.seatDepth <= SEAT_GUIDELINE && cur.collapsed){
    breakVacuum(state, now);
  }
  return state;
}

/**
 * The force of handling a tube goes down the holder into the needle unless
 * the flange is being held. Deeper is deeper; sideways is sideways; the tip
 * leaving the lumen is the sum of both against the vessel's own calibre.
 */
function applyNeedleShift(state, dAxialM, dLateralM, grip, cur){
  if(!state.inVein || state.needleOut) return;
  const shift = needleShiftFrom(dAxialM, dLateralM, grip);
  // Axial displacement is net: push the tube on and the tip goes deeper, pull
  // it off again and the tip comes back. Sideways excursion is not — once the
  // tip has been levered across the lumen, taking the hand away does not put
  // it back.
  state.needleDeeperM += shift.deeperM;
  if(shift.lateralM > state.needleLateralM) state.needleLateralM = shift.lateralM;
  state.needleShiftM = Math.hypot(state.needleDeeperM, state.needleLateralM);
  if(state.needleShiftM > state.peakShiftM) state.peakShiftM = state.needleShiftM;
  if(cur && state.peakShiftM > cur.shiftDuringM) cur.shiftDuringM = state.peakShiftM;
  if(state.needleShiftM > lumenToleranceM(state.vessel)){
    state.needleOut = true;
    recordEvent(state, "needleOut", { shiftM: state.needleShiftM });
  }
}

/**
 * The rear cannula goes through the stopper and the vacuum opens — onto
 * whatever is at the needle's other end. Blood, if the tip is in the vein.
 * Air and nothing at all, if it is not, and the tube is then finished.
 */
function pierce(state, now){
  const cur = current(state);
  if(!cur || cur.pierced) return state;
  cur.pierced = true;
  cur.piercedAt = now == null ? Date.now() : now;
  cur.carryover = carryoverInto(state.lastDrawnKey, cur.key);
  state.lastDrawnKey = cur.key;
  if(!state.inVein || state.needleOut){
    cur.deadOnAir = true;
    recordEvent(state, "deadOnAir", { key: cur.key });
  }else{
    recordEvent(state, "pierce", { key: cur.key, carryover: !!cur.carryover });
  }
  return state;
}

function breakVacuum(state, now){
  const cur = current(state);
  if(!cur) return state;
  cur.collapsed = false;
  cur.vacuumCycles += 1;
  // Not a retry button: the wall was pulled shut because the vacuum was
  // pulling harder than the vein could supply. Letting it refill gives the
  // next cycle more before the same thing happens again.
  cur.collapseAllowance = Math.min(1, cur.collapseAllowance + 0.30);
  cur.refillUntil = (now == null ? Date.now() : now) + REFILL_SECONDS*1000;
  state.reseats += 1;
  recordEvent(state, "breakVacuum", { key: cur.key, cycle: cur.vacuumCycles });
  return state;
}

/** Backs the tube off to the guideline in one motion — the collapse recovery. */
export function backOffToGuideline(state, now){
  const cur = current(state);
  if(!cur) return state;
  return seat(state, SEAT_GUIDELINE - state.seatDepth - 0.0001, 0, GRIP.FLANGE, now);
}

/**
 * Pushes the tube fully home, in one motion.
 *
 * Home, not merely as far as the stopper — "push the tube on" means seating
 * it against the back of the holder. The guideline is a place you stop on
 * purpose, not where a push naturally ends, and treating it as the end of the
 * travel would make this path quietly gentler on the needle than the same
 * push made with a finger on the screen.
 */
export function pushOn(state, grip, now){
  const cur = current(state);
  if(!cur) return state;
  return seat(state, SEAT_BOTTOM - state.seatDepth, 0, grip || GRIP.FLANGE, now);
}

/** Pulls the tube off the holder. */
export function removeTube(state, grip, now){
  const cur = current(state);
  if(!cur) return state;
  seat(state, -state.seatDepth, 0, grip || GRIP.FLANGE, now);
  if(!cur.pierced){
    // never engaged — it goes back on the rack unused rather than counting
    return returnTube(state);
  }
  cur.removedAt = now == null ? Date.now() : now;
  state.currentKey = null;
  state.seatDepth = 0;
  recordEvent(state, "removeTube", { key: cur.key, drawnMl: cur.drawnMl });
  return state;
}

/* ---------- the vacuum doing its work --------------------------------------------- */

/**
 * Advances the fill by real seconds. Nothing here is a timer the UI started:
 * the rate comes from this vein, this gauge and this patient, and it stops
 * when the vacuum is exhausted — which is the thing the learner has to wait
 * for rather than guess at.
 *
 * @param {number} dtS            seconds elapsed
 * @param {boolean} tourniquetOn  the band is still on the arm
 */
export function flow(state, dtS, tourniquetOn, now){
  const cur = current(state);
  if(!cur || !cur.pierced || cur.removedAt) return state;
  if(cur.deadOnAir || !state.inVein || state.needleOut) return state;
  if(state.seatDepth < SEAT_ENGAGE) return state;      // backed off: vacuum broken
  const t = now == null ? Date.now() : now;
  if(cur.refillUntil && t < cur.refillUntil) return state;
  if(cur.refillUntil && t >= cur.refillUntil) cur.refillUntil = null;
  if(cur.collapsed) return state;

  const rate = drawRateMlPerS({
    vessel: state.vessel, gauge: state.gauge, vigour: state.vigour,
    tourniquetOn: !!tourniquetOn, collapsed: false,
  });
  cur.drawnMl = Math.min(cur.volumeMl, cur.drawnMl + rate*Math.max(0, dtS || 0));

  if(collapsesVein(state.vessel, cur.key) && cur.drawnMl >= cur.volumeMl*cur.collapseAllowance
     && cur.drawnMl < cur.volumeMl){
    cur.collapsed = true;
    recordEvent(state, "collapsed", { key: cur.key, at: cur.drawnMl });
  }
  return state;
}

/** Whether the vacuum has finished with the current tube by itself. */
export function isFull(state){
  const cur = current(state);
  return !!cur && cur.drawnMl >= cur.volumeMl - 1e-6;
}

/** Runs the fill forward as if the learner had simply waited. */
export function fillFor(state, seconds, tourniquetOn, now){
  const step = 0.1;
  let t = now == null ? Date.now() : now;
  for(let s = 0; s < seconds; s += step){
    flow(state, step, tourniquetOn, t);
    t += step*1000;
  }
  return state;
}

/**
 * One whole tube, done properly: take it, push it on braced, wait for the
 * vacuum to exhaust, pull it off braced. For the accessible path and tests.
 */
export function collectTubeCleanly(state, key, o){
  const opt = o || {};
  takeTube(state, key, opt.now);
  pushOn(state, GRIP.FLANGE, opt.now);
  // generous enough to exhaust any tube on any vein, including the cycles a
  // collapsing vein needs — waiting is exactly what the technique is
  for(let i = 0; i < 12 && !isFull(state); i++){
    fillFor(state, 20, opt.tourniquetOn, Date.now());
    if(current(state) && current(state).collapsed) backOffToGuideline(state, Date.now());
    if(state.seatDepth < SEAT_ENGAGE) pushOn(state, GRIP.FLANGE, Date.now());
  }
  removeTube(state, GRIP.FLANGE, opt.now);
  return state;
}

/** The fraction of its draw volume a tube came off at. */
export function fillFraction(state, key){
  const t = state.tubes[key];
  if(!t || t.volumeMl <= 0) return 0;
  return t.drawnMl/t.volumeMl;
}

/** Seconds since the first tube was picked up. */
export function secondsCollecting(state, now){
  return ((now == null ? Date.now() : now) - state.startedAt)/1000;
}

export { GRIP, SEAT_GUIDELINE, SEAT_ENGAGE, SEAT_BOTTOM };
