/* =========================================================================
   TUBE INVERSION SCORING — real inversion counts against each tube's own
   requirement, real peak angles, real degrees per second, real seconds of
   delay. Not "six taps per tube". Pure maths.
   ========================================================================= */
import {
  inversionsFor, requiresMixing, mustNotMix, tubeName, additiveOf,
  haemolysisGrade, specimenVerdict, OVER_AT, SHAKE_DEG_PER_S, MIX_WITHIN_S,
} from "./inversionRules.js";
import { secondsSince } from "./inversionState.js";

function round(v, dp){ const m = Math.pow(10, dp || 0); return Math.round(v*m)/m; }

/**
 * @param {object} state   inversionState
 * @param {object} result  evaluateInversion()'s return
 * @param {object} [o]     { now }
 */
export function measureInversion(state, result, o){
  const opt = o || {};
  const mistakes = [];

  const tubes = state.order.map(key=>{
    const t = state.tubes[key];
    const spec = inversionsFor(key);
    const verdict = specimenVerdict(t);
    return {
      key,
      name: tubeName(key),
      additive: additiveOf(key),
      required: spec.min,
      ideal: spec.ideal,
      mustNotMix: !!spec.mustNotMix,
      inversions: t ? t.inversions : 0,
      rockCount: t ? t.rockCount : 0,
      peakDegPerS: t ? Math.round(t.peakDegPerS) : 0,
      travelDeg: t ? Math.round(t.travelDeg) : 0,
      haemolysis: t ? round(t.haemolysis, 2) : 0,
      haemolysisGrade: haemolysisGrade(t ? t.haemolysis : 0),
      delaySeconds: t ? round(t.delaySeconds, 1) : null,
      clotting: t ? t.clotting : "none",
      racked: !!(t && t.rackedAt != null),
      sluggish: !!(t && t.sluggish),
      // carried through from collection rather than re-decided here
      carryoverFrom: t ? t.carryoverFrom : null,
      drawnMl: t ? round(t.drawnMl, 2) : 0,
      usable: verdict.usable,
      reason: verdict.reason,
    };
  });

  const mixable = tubes.filter(t => requiresMixing(t.key));
  const underMixed = mixable.filter(t => t.inversions < t.required);
  const haemolysed = tubes.filter(t => t.haemolysisGrade === "rejected");
  const bruised = tubes.filter(t => t.haemolysisGrade === "visible");
  const clotted = tubes.filter(t => t.clotting === "clotted");
  const late = tubes.filter(t => t.clotting === "microclots");
  const wronglyMixed = tubes.filter(t => t.mustNotMix && t.inversions > 0);
  const unracked = tubes.filter(t => !t.racked);
  const rocked = mixable.filter(t => t.rockCount >= 3 && t.inversions < t.required);

  for(const t of underMixed) mistakes.push({
    code: "underMixed", item: t.name, critical: true,
    message: `${t.name} got ${t.inversions} inversion(s); ${t.additive} needs ${t.ideal}. Under-mixed additive means the specimen is not properly anticoagulated.`,
  });
  for(const t of rocked) mistakes.push({
    code: "rocked", item: t.name,
    message: `${t.name} was rocked ${t.rockCount} time(s) without ever going all the way over — the additive sits at the closed end and never travelled.`,
  });
  for(const t of wronglyMixed) mistakes.push({
    code: "mixedPlainTube", item: t.name, critical: true,
    message: `${t.name} has no additive and must clot undisturbed — inverting it ${t.inversions} time(s) breaks up the forming clot.`,
  });
  for(const t of haemolysed) mistakes.push({
    code: "haemolysed", item: t.name, critical: true,
    message: `${t.name} was shaken at up to ${t.peakDegPerS}°/s and is haemolysed — a false potassium and a false LDH. Rejected specimen.`,
  });
  for(const t of bruised) mistakes.push({
    code: "haemolysing", item: t.name,
    message: `${t.name} was handled roughly enough (${t.peakDegPerS}°/s) to start haemolysing.`,
  });
  for(const t of clotted) mistakes.push({
    code: "clotted", item: t.name, critical: true,
    message: `${t.name} sat ${t.delaySeconds}s before it was mixed and has clotted. Needs a redraw.`,
  });
  for(const t of late) mistakes.push({
    code: "mixedLate", item: t.name,
    message: `${t.name} was not mixed until ${t.delaySeconds}s after it came off the holder (target: within ${MIX_WITHIN_S}s).`,
  });
  for(const t of unracked) mistakes.push({
    code: "notRacked", item: t.name,
    message: `${t.name} was never stood back in the rack.`,
  });

  let score = 100;
  score -= underMixed.length*22;
  score -= rocked.length*6;
  score -= wronglyMixed.length*20;
  score -= haemolysed.length*28;
  score -= bruised.length*10;
  score -= clotted.length*25;
  score -= late.length*8;
  score -= unracked.length*6;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const usable = tubes.filter(t => t.usable);

  return {
    score,
    tubes,
    tubesRequired: state.order.length,
    tubesUsable: usable.length,
    underMixedCount: underMixed.length,
    rockedCount: rocked.length,
    haemolysedCount: haemolysed.length,
    clottedCount: clotted.length,
    mixedLateCount: late.length,
    wronglyMixedCount: wronglyMixed.length,
    notRackedCount: unracked.length,
    /** the worst speed any tube saw, and the threshold it is judged against */
    peakDegPerS: tubes.reduce((m, t)=>Math.max(m, t.peakDegPerS), 0),
    shakeThresholdDegPerS: SHAKE_DEG_PER_S,
    overAtDeg: OVER_AT,
    secondsElapsed: round(secondsSince(state, opt.now), 1),
    mistakes,
    criticalEvents: mistakes.filter(m => m.critical).map(m => m.code),
    narrative: narrate(tubes, usable),
  };
}

function narrate(tubes, usable){
  if(!tubes.length) return "No tubes to mix.";
  const bits = [];
  bits.push(`${usable.length} of ${tubes.length} tube${tubes.length === 1 ? "" : "s"} usable`);
  const mixable = tubes.filter(t => !t.mustNotMix && t.required > 0);
  if(mixable.length){
    const done = mixable.filter(t => t.inversions >= t.required).length;
    bits.push(`${done} of ${mixable.length} mixed to their required count`);
  }
  const bad = tubes.filter(t => t.haemolysisGrade !== "none");
  if(bad.length) bits.push(`${bad.length} shaken hard enough to haemolyse`);
  const clot = tubes.filter(t => t.clotting !== "none");
  if(clot.length) bits.push(`${clot.length} mixed too late`);
  return bits.join(", ") + ".";
}

/** Fold into the encounter's existing chips. */
export function applyInversionOutcome(procedureState, measurements){
  if(!procedureState || !measurements) return procedureState;
  const m = measurements;
  // `mixOk` already feeds vpFinish()'s recap; it now means every tube that
  // needed mixing got its own required count without being shaken, clotted, or
  // mixed when it should not have been — rather than "a counter reached six".
  procedureState.mixOk = m.underMixedCount === 0
    && m.haemolysedCount === 0
    && m.clottedCount === 0
    && m.wronglyMixedCount === 0;
  procedureState.invCounts = Object.fromEntries(m.tubes.map(t => [t.key, t.inversions]));
  procedureState.inversionMeasurements = m;
  return procedureState;
}
