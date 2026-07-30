/* =========================================================================
   PRESSURE AND BANDAGE SCORING — a real mean force against this site's own
   adequacy band, real seconds of effective pressure against what this
   puncture actually needed, real millilitres into the tissue, real
   millimetres of dressing misalignment. Not "held for 1.2 seconds". Pure maths.
   ========================================================================= */
import {
  forceBandFor, hematomaGrade, TIME_TO_PRESSURE_GOOD, TIME_TO_PRESSURE_WARN,
  BANDAGE_ALIGN_GOOD, BANDAGE_ALIGN_WARN, BANDAGE_TIGHT_WARN,
  BANDAGE_TIGHT_BLOCK, BANDAGE_LOOSE, HAEMOSTASIS_AT,
} from "./postDrawRules.js";
import { pressureConsistency, meanForce } from "./postDrawState.js";

function round(v, dp){ const m = Math.pow(10, dp || 0); return Math.round(v*m)/m; }

/**
 * @param {object} state   postDrawState
 * @param {object} result  evaluatePostDraw()'s return
 * @param {object} [o]     { now }
 */
export function measurePostDraw(state, result, o){
  const opt = o || {};
  const mistakes = [];
  const band = forceBandFor(state.siteKind);
  const haemostatic = state.clotProgress >= HAEMOSTASIS_AT;
  const grade = hematomaGrade(state.extravasatedMl);
  const mean = meanForce(state);
  const consistency = pressureConsistency(state);

  /* --- what went wrong, named ------------------------------------------------- */
  if(state.pressureStartedAt == null) mistakes.push({
    code: "noPressure", critical: true,
    message: "Pressure was never applied to the puncture.",
  });
  if(state.timeToPressureS != null && state.timeToPressureS > TIME_TO_PRESSURE_WARN) mistakes.push({
    code: "slowToPressure",
    message: `Pressure began ${round(state.timeToPressureS, 1)}s after the needle came out (target: within ${TIME_TO_PRESSURE_GOOD}s).`,
  });
  if(state.pressureStartedAt != null && mean > 0 && mean < band.min) mistakes.push({
    code: "tooLight",
    message: `Mean force was ${Math.round(mean*100)}% of full, below the ${Math.round(band.min*100)}% this site needs to actually occlude the vein.`,
  });
  if(state.discomfortSeconds > 3) mistakes.push({
    code: "excessiveForce",
    message: `Force stayed above the comfort threshold for ${round(state.discomfortSeconds, 0)}s, peaking at ${Math.round(state.peakForce*100)}%.`,
  });
  if(consistency < 0.6 && state.forceSamples.length > 10) mistakes.push({
    code: "inconsistent",
    message: `The pressure wandered rather than holding steady (consistency ${Math.round(consistency*100)}%).`,
  });
  if(state.armFlexedSeconds > 1) mistakes.push({
    code: "armFlexed",
    message: `The arm was bent for ${round(state.armFlexedSeconds, 0)}s of the hold — the fascia takes that pressure, not the vein.`,
  });
  if(state.releasedEarlyCount > 0) mistakes.push({
    code: "releasedEarly",
    message: `Pressure came off ${state.releasedEarlyCount} time(s) before the clot was holding.`,
  });
  if(state.checkedAt == null) mistakes.push({
    code: "neverChecked",
    message: "The site was never uncovered and looked at, so the bleeding was never actually confirmed stopped.",
  });
  if(grade === "hematoma") mistakes.push({
    code: "hematoma", critical: true,
    message: `A hematoma formed — ${round(state.extravasatedMl, 2)}mL of blood into the tissue.`,
  });
  else if(grade === "bruise") mistakes.push({
    code: "bruising",
    message: `The site bruised — ${round(state.extravasatedMl, 2)}mL leaked before the bleeding was controlled.`,
  });
  if(state.bandagedAt != null){
    if(state.bandagedWhileBleeding) mistakes.push({
      code: "bandagedBleeding", critical: true,
      message: "The dressing was applied over a puncture that was still bleeding.",
    });
    if(!state.bandageClean) mistakes.push({
      code: "bandageUnsterile", critical: true,
      message: "The dressing applied to the open puncture was not clean.",
    });
    if(state.bandageAlignM > BANDAGE_ALIGN_WARN) mistakes.push({
      code: "bandageOffSite",
      message: `The dressing sat ${Math.round(state.bandageAlignM*1000)}mm off the puncture.`,
    });
    if(state.bandageTightness >= BANDAGE_TIGHT_BLOCK) mistakes.push({
      code: "bandageTourniquet",
      message: `The dressing went on at ${Math.round(state.bandageTightness*100)}% tension — tight enough to restrict circulation.`,
    });
    else if(state.bandageTightness > BANDAGE_TIGHT_WARN) mistakes.push({
      code: "bandageTight",
      message: `The dressing was tighter than necessary (${Math.round(state.bandageTightness*100)}%).`,
    });
    else if(state.bandageTightness < BANDAGE_LOOSE) mistakes.push({
      code: "bandageLoose",
      message: "The dressing was too loose to stay put.",
    });
    if(state.gauzeShifted) mistakes.push({
      code: "gauzeShifted",
      message: "The gauze slid off the puncture while the dressing was applied.",
    });
  }else{
    mistakes.push({ code: "notBandaged", message: "The site was never dressed." });
  }
  if(state.bandagedAt != null && !state.aftercareGiven) mistakes.push({
    code: "noAftercare",
    message: "The patient was not told how long to keep the dressing on or what to watch for.",
  });

  /* --- the score --------------------------------------------------------------- */
  let score = 100;
  if(state.pressureStartedAt == null) score -= 40;
  if(state.timeToPressureS != null){
    score -= Math.min(12, Math.round(Math.max(0, state.timeToPressureS - TIME_TO_PRESSURE_GOOD)*2.5));
  }
  if(state.pressureStartedAt != null && mean > 0 && mean < band.min){
    score -= Math.min(18, Math.round((band.min - mean)*100));
  }
  score -= Math.min(10, Math.round(state.discomfortSeconds*2));
  if(state.forceSamples.length > 10) score -= Math.min(10, Math.round((1 - consistency)*22));
  score -= Math.min(12, Math.round(state.armFlexedSeconds*3));
  score -= Math.min(12, state.releasedEarlyCount*5);
  if(state.checkedAt == null) score -= 10;
  if(grade === "hematoma") score -= 25;
  else if(grade === "bruise") score -= 10;
  if(state.bandagedAt == null) score -= 20;
  else{
    if(state.bandagedWhileBleeding) score -= 25;
    if(!state.bandageClean) score -= 15;
    score -= Math.min(10, Math.round(Math.max(0, state.bandageAlignM - BANDAGE_ALIGN_GOOD)*1000*1.2));
    if(state.bandageTightness >= BANDAGE_TIGHT_BLOCK) score -= 15;
    else if(state.bandageTightness > BANDAGE_TIGHT_WARN) score -= 6;
    else if(state.bandageTightness < BANDAGE_LOOSE) score -= 6;
    if(state.gauzeShifted) score -= 6;
    if(!state.aftercareGiven) score -= 5;
  }
  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    score,
    siteKind: state.siteKind,
    anticoagulated: state.anticoagulated,

    timeToPressureS: state.timeToPressureS == null ? null : round(state.timeToPressureS, 1),
    meanForcePercent: Math.round(mean*100),
    peakForcePercent: Math.round(state.peakForce*100),
    requiredForcePercent: Math.round(band.min*100),
    idealForcePercent: Math.round(band.ideal*100),
    consistencyPercent: Math.round(consistency*100),
    discomfortSeconds: round(state.discomfortSeconds, 1),

    heldSeconds: round(state.heldSeconds, 1),
    effectiveSeconds: round(state.effectiveSeconds, 1),
    requiredSeconds: round(state.holdSeconds, 1),
    releasedEarlyCount: state.releasedEarlyCount,
    armFlexedSeconds: round(state.armFlexedSeconds, 1),

    haemostatic,
    checked: state.checkedAt != null,
    checkCount: state.checkCount,
    bleedingAtCheck: state.bleedingAtCheck,
    extravasatedMl: round(state.extravasatedMl, 2),
    hematomaGrade: grade,

    bandaged: state.bandagedAt != null,
    bandageClean: state.bandageClean,
    bandageAlignMm: round(state.bandageAlignM*1000, 1),
    bandageTightnessPercent: Math.round(state.bandageTightness*100),
    bandagedWhileBleeding: state.bandagedWhileBleeding,
    gauzeShifted: state.gauzeShifted,
    bandageAttempts: state.bandageAttempts,
    aftercareGiven: state.aftercareGiven,

    mistakes,
    criticalEvents: mistakes.filter(m => m.critical).map(m => m.code),
    narrative: narrate(state, mean, haemostatic, grade),
  };
}

function narrate(state, mean, haemostatic, grade){
  const bits = [];
  if(state.pressureStartedAt == null) return "Pressure was never applied to the site.";
  bits.push(`held at ${Math.round(mean*100)}% force for ${Math.round(state.effectiveSeconds)}s of the ${Math.round(state.holdSeconds)}s this puncture needed`);
  if(state.armFlexedSeconds > 1) bits.push("with the arm bent for part of it");
  bits.push(haemostatic ? "bleeding stopped" : "bleeding NOT controlled");
  if(grade !== "none") bits.push(grade === "hematoma" ? "a hematoma formed" : "the site bruised");
  if(state.bandagedAt != null){
    bits.push(`dressed ${Math.round(state.bandageAlignM*1000)}mm off centre at ${Math.round(state.bandageTightness*100)}% tension`);
  }else bits.push("never dressed");
  return bits.join(", ") + ".";
}

/** Fold into the encounter's existing chips. */
export function applyPostDrawOutcome(procedureState, measurements){
  if(!procedureState || !measurements) return procedureState;
  const c = procedureState, m = measurements;
  // `pressureOk` and `bandageOk` already feed vpFinish()'s recap and the
  // encounter score; they now mean what they say rather than "a button was
  // pressed". Pressure is only OK if the bleeding actually stopped without
  // a hematoma; a dressing is only OK if it went onto a site that had.
  if(m.timeToPressureS != null || m.haemostatic){
    c.pressureOk = m.haemostatic && m.hematomaGrade !== "hematoma";
  }
  if(m.bandaged){
    c.bandageOk = !m.bandagedWhileBleeding
      && m.bandageTightnessPercent < 88
      && m.bandageClean;
  }
  c.postDrawMeasurements = m;
  return c;
}
