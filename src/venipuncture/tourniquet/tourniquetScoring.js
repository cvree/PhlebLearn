/* =========================================================================
   TOURNIQUET SCORING — what the learner actually did, in numbers.

   Same contract as stagingScoring.js: measurements first, score derived from
   them. A recap that says "Tourniquet timing ✓" teaches nothing; one that says
   "2.4 inches above the site, on for 71 seconds, tail tucked toward the
   field" tells the learner exactly which habit to change.

   Pure maths.
   ========================================================================= */
import { metresToInches, TENSION, BAND_IDEAL, BAND_ACCEPTABLE } from "../arm/armAnatomy.js";
import { WRAP, TUCK, secondsOn } from "./tourniquetState.js";
import { TIME, SKEW_LIMIT } from "./tourniquetRules.js";

function round(v, dp){ const m = Math.pow(10, dp || 0); return Math.round(v*m)/m; }
function clamp01(v){ return Math.max(0, Math.min(1, v)); }

/**
 * @param {object} state   tourniquetState
 * @param {object} result  the final evaluateTourniquet() result
 * @param {number} [now]
 */
export function measureTourniquet(state, result, now){
  const heightM = state.bandX == null ? null : state.bandX;
  const inches = heightM == null ? null : round(metresToInches(heightM), 2);
  const seconds = round(secondsOn(state, now), 1);
  const tension = state.heldTension || state.tension || 0;

  const positionOk = heightM != null &&
    heightM >= BAND_ACCEPTABLE.min && heightM <= BAND_ACCEPTABLE.max;
  const positionIdeal = heightM != null &&
    heightM >= BAND_IDEAL.min && heightM <= BAND_IDEAL.max;
  const tensionOk = tension >= TENSION.GOOD_MIN && tension <= TENSION.GOOD_MAX;
  const tensionSafe = tension >= TENSION.VENOUS_ONSET && tension <= TENSION.ARTERIAL_ONSET;
  const wrappedUnder = state.wrap === WRAP.UNDER;
  const tuckedClear = state.tuckedUnder && state.tuck === TUCK.PROXIMAL;
  const flatOnSkin = state.skew <= SKEW_LIMIT;
  const withinMinute = seconds <= TIME.LIMIT_S;

  const mistakes = [];
  if(!wrappedUnder && state.wrap) mistakes.push({ code:"wrappedOver", message:"The band was laid across the top of the arm instead of being passed underneath." });
  if(heightM != null && !positionOk){
    mistakes.push({ code:"position", message: heightM < BAND_ACCEPTABLE.min
      ? `The band sat ${inches}″ above the site — inside the field you had to clean and puncture.`
      : `The band sat ${inches}″ above the site — too far up to fill the antecubital veins properly.` });
  }
  if(tension < TENSION.VENOUS_ONSET) mistakes.push({ code:"tooLoose", message:"It was never tight enough to stop venous return, so the veins never filled." });
  else if(tension > TENSION.ARTERIAL_ONSET) mistakes.push({ code:"tooTight", message:"It was tight enough to cut off arterial inflow — the hand blanched and the veins collapsed again." });
  if(state.tuckedUnder && state.tuck === TUCK.DISTAL) mistakes.push({ code:"tailInField", message:"The tail was tucked pointing down toward the draw site, laying it across the field." });
  if(!flatOnSkin) mistakes.push({ code:"skewed", message:"The wrap spiralled round the arm rather than sitting square to it, rolling the band into a pinching cord." });
  if(!withinMinute) mistakes.push({ code:"overTime", message:`The band was on for ${seconds}s. Past sixty seconds the sample starts to hemoconcentrate.` });
  if(state.restarts > 0) mistakes.push({ code:"restarts", message:`The band came off and had to be re-applied ${state.restarts}×, which is ${state.restarts > 1 ? "a lot of" : "extra"} time with the patient's arm tied off.` });

  /* --- score ---------------------------------------------------------------
     Weighted toward the two errors that actually harm someone: a band that
     occludes the artery, and a band left on long enough to spoil the result. */
  let score = 100;
  if(!wrappedUnder && state.wrap) score -= 18;
  if(heightM == null) score -= 40;
  else if(!positionOk) score -= 20;
  else if(!positionIdeal) score -= 6;
  if(tension > TENSION.ARTERIAL_ONSET) score -= 26;
  else if(tension < TENSION.VENOUS_ONSET) score -= 22;
  else if(!tensionOk) score -= 8;
  if(!state.tuckedUnder) score -= 15;
  else if(state.tuck === TUCK.DISTAL) score -= 12;
  if(!flatOnSkin) score -= 7;
  if(seconds > TIME.SPOILED_S) score -= 24;
  else if(!withinMinute) score -= 12;
  score -= Math.min(12, state.restarts*5);
  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    score,
    /* --- the numbers -------------------------------------------------- */
    heightAboveSiteM: heightM == null ? null : round(heightM, 4),
    heightAboveSiteInches: inches,
    tension: round(tension, 3),
    peakTension: round(state.peakTension, 3),
    skewM: round(state.skew, 4),
    secondsOn: seconds,
    veinDistension: round(result ? result.distension : 0, 3),
    restarts: state.restarts,
    attempts: state.attempts,
    /* --- the judgements ----------------------------------------------- */
    wrappedUnder,
    positionOk, positionIdeal,
    tensionOk, tensionSafe,
    tuckedClear,
    flatOnSkin,
    withinMinute,
    radialPulseKept: result ? result.pulse : true,
    mistakes,
    narrative: narrate({
      inches, seconds, tension, wrappedUnder, positionIdeal, positionOk,
      tensionOk, tuckedClear, withinMinute, restarts: state.restarts,
      distension: result ? result.distension : 0,
    }),
  };
}

function narrate(m){
  if(m.inches == null) return "The tourniquet never went on.";
  const bits = [];

  if(m.positionIdeal) bits.push(`Band at ${m.inches}″ above the site — textbook`);
  else if(m.positionOk) bits.push(`Band at ${m.inches}″ above the site — usable`);
  else bits.push(`Band at ${m.inches}″ above the site`);

  if(!m.wrappedUnder) bits.push("laid over the arm rather than passed under it");
  if(m.tensionOk) bits.push(`tension judged well (${Math.round(m.distension*100)}% vein fill)`);
  else if(m.tension > TENSION.ARTERIAL_ONSET) bits.push("pulled tight enough to blanch the hand");
  else if(m.tension < TENSION.VENOUS_ONSET) bits.push("too slack to fill the veins");
  else bits.push("tension a little off");

  if(m.tuckedClear) bits.push("tail tucked clear of the field");
  else bits.push("tail left across the field");

  if(m.withinMinute) bits.push(`released inside the minute (${m.seconds}s)`);
  else bits.push(`left on ${m.seconds}s`);

  if(m.restarts) bits.push(`${m.restarts} re-application${m.restarts > 1 ? "s" : ""}`);

  return bits.join(", ") + ".";
}

/** Fold this branch's verdict into the encounter's existing boolean chips. */
export function applyTourniquetOutcome(procedureState, measurements){
  if(!procedureState || !measurements) return procedureState;
  procedureState.tourniquetOn = measurements.heightAboveSiteM != null;
  // `tqGood` already feeds vpFinish()'s recap and the encounter score; it now
  // means "applied AND released well" rather than "the timer bar was short".
  procedureState.tqGood = measurements.positionOk && measurements.tensionSafe &&
    measurements.wrappedUnder && measurements.withinMinute;
  procedureState.tourniquetMeasurements = measurements;
  return procedureState;
}

export { clamp01 };
