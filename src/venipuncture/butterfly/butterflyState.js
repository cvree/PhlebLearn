/* =========================================================================
   THE WINGED SET AS A PHYSICAL OBJECT — pure data and pure transitions.

   The set has three parts the learner can touch and one they cannot: the
   wings, the tubing, the tape, and the needle at the end of all of it. Every
   transition here is the one write path both the pointer and the accessible
   controls call.

   The tubing is the point of this module. `disturb()` is what a tube change,
   a reach, or a set left hanging off the chair does to a needle 2mm inside a
   2mm vein, and it is the same function whichever input caused it.
   ========================================================================= */
import {
  WINGS, tipShiftFromTubing, infiltrationFrom, slackOf,
  INFILTRATE_ML_PER_S, NOTICE_WITHIN_S,
} from "./butterflyRules.js";
import { procedureFor, PROCEDURE } from "../procedure.js";

const SPEC = () => procedureFor(PROCEDURE.BUTTERFLY_HAND).tubing;

export function createButterflyState(o){
  const opt = o || {};
  const spec = SPEC();
  return {
    gauge: opt.gauge == null ? 23 : opt.gauge,
    calibreM: opt.calibreM == null ? 0.0022 : opt.calibreM,

    /* --- the wings ---------------------------------------------------------- */
    wingsHeld: false,
    wings: WINGS.LOOSE,
    /** laid flat and taped to the skin — the thing that breaks the lever */
    secured: false,
    securedAt: null,

    /* --- the tubing --------------------------------------------------------- */
    tubing: {
      lengthM: spec.lengthM,
      slackM: spec.slackGoodM,
      secured: false,
    },

    /* --- the needle at the end of it ---------------------------------------- */
    entered: false,
    enteredAt: null,
    entryAngleDeg: null,
    carriedByTubingAtEntry: false,
    /** metres the tip is from the centre of the lumen */
    tipOffsetM: 0,
    peakTipOffsetM: 0,
    /** every disturbance that reached the tip, so the report can name them */
    disturbances: [],

    /* --- what leaked while nobody was looking -------------------------------- */
    infiltratedMl: 0,
    infiltrationStartedAt: null,
    infiltrationNoticed: false,
    infiltrationNoticedAt: null,
    stoppedOnInfiltration: false,

    events: [],
    startedAt: opt.now == null ? Date.now() : opt.now,
  };
}

function recordEvent(state, type, data){
  state.events.push({ t: Date.now(), type, data: data == null ? null : data });
  if(state.events.length > 200) state.events.shift();
}

/* ---------- the wings -------------------------------------------------------- */

export function pickUpByWings(state){
  state.wingsHeld = true;
  state.wings = WINGS.PINCHED;
  recordEvent(state, "wingsPinched", null);
  return state;
}

export function pickUpByTubing(state){
  // Physically possible, and the reason the angle is then whatever the line
  // happens to hang at rather than whatever the learner intended.
  state.wingsHeld = false;
  state.wings = WINGS.LOOSE;
  recordEvent(state, "carriedByTubing", null);
  return state;
}

export function layWingsFlat(state){
  if(!state.wingsHeld) return state;
  state.wings = WINGS.FLAT;
  recordEvent(state, "wingsFlat", null);
  return state;
}

export function releaseWings(state){
  state.wingsHeld = false;
  state.wings = WINGS.LOOSE;
  recordEvent(state, "wingsReleased", null);
  return state;
}

/** Tape over the wings. The single most useful thing in the whole procedure. */
export function secureWings(state, o){
  if(!state.entered) return state;
  const now = (o && o.now != null) ? o.now : Date.now();
  state.secured = true;
  state.securedAt = now;
  state.tubing.secured = true;
  recordEvent(state, "wingsTaped", null);
  return state;
}

export function unsecureWings(state){
  state.secured = false;
  state.tubing.secured = false;
  recordEvent(state, "tapeRemoved", null);
  return state;
}

/* ---------- the tubing ------------------------------------------------------- */

/** Lays the line out with a chosen amount of slack. */
export function layTubing(state, slackM){
  state.tubing.slackM = Math.max(0, Math.min(state.tubing.lengthM, slackM || 0));
  recordEvent(state, "tubingLaid", { slackM: Math.round(state.tubing.slackM*1000) });
  return state;
}

/**
 * Something moved the far end of the line. Returns the metres the TIP moved,
 * which the caller folds into whatever it is measuring — this module does not
 * decide whether that is a mistake.
 */
export function disturb(state, o){
  const opt = o || {};
  const shift = tipShiftFromTubing(state.tubing, SPEC(), opt);
  if(shift <= 0) return 0;
  state.tipOffsetM += shift;
  if(state.tipOffsetM > state.peakTipOffsetM) state.peakTipOffsetM = state.tipOffsetM;
  state.disturbances.push({
    cause: opt.cause || "unknown",
    pullM: Math.round((opt.pullM || 0)*1000)/1000,
    swingDeg: Math.round(opt.swingDeg || 0),
    shiftMm: Math.round(shift*10000)/10,
    secured: !!state.secured,
  });
  recordEvent(state, "tipDisturbed", { cause: opt.cause || "unknown", shiftMm: Math.round(shift*10000)/10 });
  return shift;
}

/* ---------- the needle -------------------------------------------------------- */

export function enter(state, angleDeg, o){
  const now = (o && o.now != null) ? o.now : Date.now();
  state.entered = true;
  state.enteredAt = now;
  state.entryAngleDeg = angleDeg;
  state.tipOffsetM = 0;
  // Fixed at the moment of entry, not read live off `wingsHeld` afterward —
  // scoring runs once the draw has moved on, by which point `wingsHeld` may
  // have changed for other reasons and would no longer describe how the
  // needle actually went in.
  state.carriedByTubingAtEntry = !state.wingsHeld;
  recordEvent(state, "entered", { angleDeg: Math.round(angleDeg) });
  return state;
}

/**
 * A second of drawing. Infiltration is not an event — it is what happens
 * while the learner is doing something else, so it accrues on the clock.
 */
export function drawFor(state, seconds, o){
  const now = (o && o.now != null) ? o.now : Date.now();
  const s = Math.max(0, seconds || 0);
  if(!state.entered || !s) return state;
  const inf = infiltrationFrom(state.tipOffsetM, state.calibreM);
  if(!inf.infiltrating) return state;
  if(state.infiltrationStartedAt == null) state.infiltrationStartedAt = now;
  state.infiltratedMl += s * INFILTRATE_ML_PER_S * (1 - inf.flowFraction + 0.35);
  return state;
}

/** The learner looked at the site and saw the swelling. */
export function noticeInfiltration(state, o){
  const now = (o && o.now != null) ? o.now : Date.now();
  if(state.infiltrationStartedAt == null) return state;
  if(state.infiltrationNoticed) return state;
  state.infiltrationNoticed = true;
  state.infiltrationNoticedAt = now;
  recordEvent(state, "infiltrationNoticed", null);
  return state;
}

/** Recognising it and stopping is the recoverable half of the error. */
export function stopForInfiltration(state){
  if(!state.infiltrationNoticed) return state;
  state.stoppedOnInfiltration = true;
  recordEvent(state, "stoppedForInfiltration", null);
  return state;
}

/** Seconds between the swelling starting and the learner seeing it. */
export function secondsToNotice(state, now){
  if(state.infiltrationStartedAt == null) return null;
  const end = state.infiltrationNoticedAt == null
    ? (now == null ? Date.now() : now)
    : state.infiltrationNoticedAt;
  return Math.max(0, (end - state.infiltrationStartedAt)/1000);
}

export { WINGS, slackOf, NOTICE_WITHIN_S };
