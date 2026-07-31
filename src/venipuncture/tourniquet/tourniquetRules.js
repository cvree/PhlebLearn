/* =========================================================================
   TOURNIQUET RULES — the clinical judgement, as pure functions.

   Same contract as stagingRules.js: this module is handed the state and the
   arm, and returns issues. It never touches meshes, never renders, never
   decides what the coach panel says. Teaching mode and a scored shift read
   the SAME result — the difference is only which parts get shown, and when.

   Severities:
     block  the application is not clinically acceptable and teaching mode
            will not let the draw start on it
     warn   it will work, but it is worse practice and it is measured
     note   worth knowing, costs nothing

   Pure maths. tests/tourniquet.spec.js asserts every threshold here.
   ========================================================================= */
import {
  BAND_IDEAL, BAND_ACCEPTABLE, TENSION, SITE,
  classifyBandPosition, metresToInches, distanceAboveSite,
  veinDistension, hasRadialPulse, nearestOnVessel, VESSEL_KIND,
} from "../arm/armAnatomy.js";
import { PHASE, WRAP, TUCK, secondsOn, isSecured } from "./tourniquetState.js";

/** The one-minute rule, and the point at which the sample is compromised. */
export const TIME = {
  /** past this the sample begins to hemoconcentrate */
  LIMIT_S: 60,
  /** a soft warning band before the limit, so the learner can still act */
  WARN_S: 45,
  /** past this, results for potassium/calcium/lactate are not usable */
  SPOILED_S: 120,
};

/** How far off perpendicular the band may sit before it pinches. */
export const SKEW_LIMIT = 0.022;   // metres of drift across the wrap

function issue(code, severity, message, data){
  return { code, severity, message, data: data || null };
}

function inches(m){ return Math.round(metresToInches(m)*10)/10; }

/**
 * The antecubital defaults, generalised so a second procedure can pass its
 * own site, its own window, and its own name for what is at x=0 — a hand
 * draw's band sits closer, on the forearm above the wrist, not the fossa.
 */
export const DEFAULT_SITE = {
  x: SITE.x, ideal: BAND_IDEAL, acceptable: BAND_ACCEPTABLE,
  label: "the antecubital fossa", windowLabel: "3–4″",
};

/* ---------- the individual judgements --------------------------------------- */

/**
 * Position: proximal to the site, inside the procedure's window. Everything
 * about this check is a real distance — there is no "correct zone" rectangle
 * to drop a sprite in.
 */
export function checkPosition(state, site){
  if(state.bandX == null) return null;
  const s = site || DEFAULT_SITE;
  const d = distanceAboveSite(state.bandX, s.x);
  const kind = classifyBandPosition(state.bandX, s.x, s.ideal, s.acceptable);
  const above = `${inches(Math.abs(d))}″`;
  const win = s.windowLabel || DEFAULT_SITE.windowLabel;
  const label = s.label || DEFAULT_SITE.label;

  if(kind === "distal"){
    return issue("bandDistal", "block",
      `The band is below the draw site, between the site and the hand. It has to sit proximal — between the site and the shoulder — or it does nothing for the veins you are about to use.`,
      { d, kind });
  }
  if(kind === "onSite"){
    return issue("bandOnSite", "block",
      `The band is sitting on ${label} itself. That is the skin you are about to clean and puncture — move it up the arm.`,
      { d, kind });
  }
  if(kind === "tooLow"){
    return issue("bandTooLow", "block",
      `Only ${above} above the site. That is inside the field you are about to clean, and the hub will foul on it. Aim for ${win}.`,
      { d, kind });
  }
  if(kind === "tooHigh"){
    return issue("bandTooHigh", "warn",
      `${above} above the site — too far up to fill the veins well, and easier to cut off the pulse. ${win} is the window.`,
      { d, kind });
  }
  if(kind === "acceptableLow" || kind === "acceptableHigh"){
    return issue("bandAcceptable", "note",
      `${above} above the site — usable. ${win} is the sweet spot.`, { d, kind });
  }
  return null;   // ideal
}

/**
 * Direction: the strap is passed UNDER the limb and brought up, so both ends
 * come off the top where you can reach them and the flat of the band lies
 * against the skin. Laid over the top it cannot be tensioned evenly and the
 * ends end up under the arm.
 */
export function checkWrap(state){
  if(!state.wrap) return null;
  if(state.wrap === WRAP.OVER){
    return issue("wrappedOver", "block",
      `You laid the band across the top of the arm. Pass it underneath the limb first and bring both ends up — otherwise you are pulling against the armrest and the ends finish where you cannot reach them.`,
      { wrap: state.wrap });
  }
  return null;
}

/** Flat and perpendicular, or spiralled and pinching. */
export function checkSkew(state){
  if(state.bandX == null) return null;
  if(state.skew > SKEW_LIMIT*2){
    return issue("bandTwisted", "warn",
      `The band went on at an angle and has rolled into a cord. A twisted band pinches a narrow line of skin instead of spreading the pressure, which hurts and bruises. Wrap it square to the arm.`,
      { skew: state.skew });
  }
  if(state.skew > SKEW_LIMIT){
    return issue("bandSkewed", "note",
      `Slightly off square — keep the wrap perpendicular to the arm so the band lies flat.`,
      { skew: state.skew });
  }
  return null;
}

/**
 * Tension: tight enough to stop venous return, loose enough that arterial
 * inflow continues. Too tight is the more dangerous error, and it is the one
 * that feels like "doing it properly".
 */
export function checkTension(state){
  const t = isSecured(state) ? state.heldTension : state.tension;
  if(state.bandX == null) return null;

  if(t < TENSION.VENOUS_ONSET){
    return issue("tooLoose", "block",
      `Barely snug — the veins are not filling. It has to be tight enough to stop the blood leaving the arm.`,
      { tension: t });
  }
  if(t < TENSION.GOOD_MIN){
    return issue("slightlyLoose", "warn",
      `A little slack. The veins are only part-filled, which is how a good vein turns into a difficult stick.`,
      { tension: t });
  }
  if(t > TENSION.ARTERIAL_ONSET){
    return issue("tooTight", "block",
      `Too tight — the hand is blanching and you cannot find a radial pulse. You have stopped the blood getting in, so the veins collapse again and the patient is in real pain. Two fingers should slide under the band.`,
      { tension: t });
  }
  if(t > TENSION.GOOD_MAX){
    return issue("slightlyTight", "warn",
      `Tighter than it needs to be. It will bruise, and it pushes the sample toward hemoconcentration faster.`,
      { tension: t });
  }
  return null;
}

/**
 * The tuck: a loop, tucked under the band, pointing away from the site. This
 * is what makes the band a quick-release — one pull on the tail and it is off,
 * one-handed, without disturbing a needle that is already in a vein.
 */
export function checkTuck(state){
  if(state.phase !== PHASE.SECURED) return null;
  if(!state.tuckedUnder){
    return issue("notTucked", "block",
      `The ends are crossed but nothing is tucked under the band, so it is only being held by your hand. It has to hold itself.`,
      null);
  }
  if(state.tuck === TUCK.DISTAL){
    return issue("tailInField", "block",
      `The loop is tucked pointing down toward the draw site. The tail now lies across the skin you are about to clean, and you will drag it through the field reaching for the tube. Tuck it pointing up the arm.`,
      { tuck: state.tuck });
  }
  return null;
}

/** The one-minute rule. */
export function checkTime(state, now){
  if(!isSecured(state)) return null;
  const s = secondsOn(state, now);
  if(s > TIME.SPOILED_S){
    return issue("timeSpoiled", "block",
      `The band has been on for ${Math.round(s)} seconds. Past two minutes the sample is hemoconcentrated — potassium, calcium and lactate will all read falsely high. Release it, let the arm recover, and re-apply.`,
      { seconds: s });
  }
  if(s > TIME.LIMIT_S){
    return issue("timeOver", "warn",
      `Over a minute (${Math.round(s)}s). Release it now — every extra second concentrates the sample.`,
      { seconds: s });
  }
  if(s > TIME.WARN_S){
    return issue("timeWarn", "note",
      `${Math.round(s)}s on. You have under fifteen seconds before it starts affecting the results.`,
      { seconds: s });
  }
  return null;
}

/** Applying a band across a vessel or a hazard it should not sit on. */
export function checkClearance(state, vessels){
  if(state.bandX == null || !vessels) return null;
  const artery = vessels.find(v=>v.kind === VESSEL_KIND.ARTERY);
  if(!artery) return null;
  // the band is a 25 mm strip; does it sit over the point where the brachial
  // artery is at its most superficial?
  const near = nearestOnVessel(artery, state.bandX, artery.path[0].z);
  const overArtery = Math.abs(near.x - state.bandX) < 0.0125 && artery.depth < 0.008;
  if(overArtery){
    return issue("overArtery", "note",
      `The band crosses the brachial artery where it runs shallow. Keep the pressure moderate here.`, null);
  }
  return null;
}

/* ---------- the whole picture ------------------------------------------------ */

const ORDER = ["block", "warn", "note"];

/**
 * Evaluates one tourniquet application against one arm.
 *
 * @param {object} state   tourniquetState
 * @param {object} arm     {vessels, vigour}
 * @param {number} [now]   injectable clock, so tests are not time-dependent
 * @returns {{ready:boolean, issues:Array, distension:number, pulse:boolean, seconds:number}}
 */
export function evaluateTourniquet(state, arm, now){
  const vessels = (arm && arm.vessels) || [];
  const site = (arm && arm.site) || DEFAULT_SITE;
  const issues = [
    checkWrap(state),
    checkPosition(state, site),
    checkSkew(state),
    checkTension(state),
    checkTuck(state),
    checkTime(state, now),
    checkClearance(state, vessels),
  ].filter(Boolean);

  issues.sort((a,b)=>ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity));

  const seconds = secondsOn(state, now);
  const heldT = isSecured(state) ? state.heldTension : state.tension;
  const distension = veinDistension(heldT, seconds, (arm && arm.vigour) || 1);

  // "Ready" means: it is holding itself, in the right place, the right way
  // round, at a tension that fills the veins without choking the arm.
  const blocking = issues.filter(i=>i.severity === "block");
  const ready = isSecured(state) && blocking.length === 0;

  return {
    ready,
    issues,
    blocking,
    distension,
    pulse: hasRadialPulse(heldT),
    seconds,
    tension: heldT,
    heightAboveSite: state.bandX == null ? null : distanceAboveSite(state.bandX, site.x),
  };
}

/** The single most important thing to say right now. */
export function nextIssue(result){
  if(!result || !result.issues.length) return null;
  return result.issues[0];
}

/**
 * What the learner should physically do next, for the coach panel. Phrased as
 * an action on an object, never as "tap the button".
 */
export function nextAction(state){
  switch(state.phase){
    case PHASE.LOOSE:
      return "Take the tourniquet and pass it under the arm, about a hand's width above the bend.";
    case PHASE.ROUTED:
      return "Both ends are up. Take one and pull it across to tighten the band.";
    case PHASE.TENSIONING:
      return "Keep the tension and sweep that end across the other one.";
    case PHASE.CROSSED:
      return "Now tuck a loop under the band, pointing up the arm — then let go.";
    case PHASE.SECURED:
      return "Holding on its own. Check the veins have filled, then get on with it — the clock is running.";
    case PHASE.RELEASED:
      return "Band off.";
    default:
      return "";
  }
}
