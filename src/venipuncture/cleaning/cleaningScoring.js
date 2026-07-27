/* =========================================================================
   CLEANING SCORING — real coverage, real seconds. Pure maths.
   ========================================================================= */
import {
  coverageOf, outwardFraction, secondsDrying, dryness,
  COVERAGE_TARGET, OUTWARD_GOOD, DRY_SECONDS, FIELD_RADIUS,
} from "./cleaningRules.js";

function round(v, dp){ const m = Math.pow(10, dp || 0); return Math.round(v*m)/m; }

export function measureCleaning(state, result, now){
  const coverage = result ? result.coverage : coverageOf(state.painted);
  const outward = outwardFraction(state.outwardTravel, state.totalTravel);
  const secs = secondsDrying(state, now);
  const dry = dryness(secs);

  const mistakes = [];
  if(!state.strokes) mistakes.push({ code:"notCleaned", message:"The site was never cleaned." });
  else{
    if(coverage < COVERAGE_TARGET) mistakes.push({ code:"underCovered", message:`Only ${Math.round(coverage*100)}% of the prep field was scrubbed — the needle passes through skin that was never disinfected.` });
    if(state.totalTravel > 0 && outward < OUTWARD_GOOD) mistakes.push({ code:"scrubbedInward", message:"The swab was worked back over skin already cleaned, dragging the dirty edge inward." });
    if(state.lightStrokes > state.strokes*0.5) mistakes.push({ code:"noFriction", message:"The alcohol was painted on rather than scrubbed in — friction is what disinfects." });
  }
  if(state.retouchedAfterClean) mistakes.push({ code:"retouched", message:"The site was touched again after cleaning, which undoes it entirely." });
  if(state.blottedOrFanned) mistakes.push({ code:"blotted", message:"The site was fanned or blotted dry instead of being left to air-dry." });
  if(state.strokes && dry < 1) mistakes.push({ code:"notDry", message:`Only ${round(secs,1)}s of drying — wet alcohol stings and haemolyses the sample.` });

  let score = 100;
  if(!state.strokes) score -= 60;
  else{
    if(coverage < COVERAGE_TARGET) score -= Math.round((COVERAGE_TARGET - coverage)*100);
    if(outward < OUTWARD_GOOD) score -= 12;
    if(state.lightStrokes > state.strokes*0.5) score -= 10;
  }
  if(state.retouchedAfterClean) score -= 30;
  if(state.blottedOrFanned) score -= 10;
  if(state.strokes && dry < 1) score -= Math.round((1 - dry)*22);
  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    score,
    coveragePct: Math.round(coverage*100),
    fieldRadiusMm: round(FIELD_RADIUS*1000, 1),
    outwardPct: Math.round(outward*100),
    dryingSeconds: round(secs, 1),
    driedFully: dry >= 1,
    strokes: state.strokes,
    lightStrokes: state.lightStrokes,
    scrubTravelMm: round(state.totalTravel*1000, 1),
    retouched: !!state.retouchedAfterClean,
    blotted: !!state.blottedOrFanned,
    mistakes,
    narrative: narrate({ coverage, outward, secs, dry, state }),
  };
}

function narrate(m){
  if(!m.state.strokes) return "The site was never cleaned.";
  const bits = [`Scrubbed ${Math.round(m.coverage*100)}% of the prep field`];
  bits.push(m.outward >= OUTWARD_GOOD ? "working outward from the puncture point" : "working back over cleaned skin");
  if(m.state.lightStrokes > m.state.strokes*0.5) bits.push("with too little friction");
  bits.push(m.dry >= 1 ? `air-dried the full ${DRY_SECONDS}s` : `punctured after ${Math.round(m.secs)}s of drying`);
  if(m.state.retouchedAfterClean) bits.push("then touched the site again");
  return bits.join(", ") + ".";
}

/** Fold into the encounter's existing chips. */
export function applyCleaningOutcome(procedureState, measurements){
  if(!procedureState || !measurements) return procedureState;
  procedureState.cleanOk = measurements.coveragePct >= Math.round(COVERAGE_TARGET*100)
    && measurements.driedFully && !measurements.retouched;
  procedureState.cleaningMeasurements = measurements;
  return procedureState;
}
