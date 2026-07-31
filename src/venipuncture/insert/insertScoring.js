/* =========================================================================
   ANCHOR + INSERT SCORING — real degrees, real millimetres, not a hit/miss
   boolean. Pure maths.
   ========================================================================= */
import { DEFAULT_ANGLE_BAND, BEVEL_TOLERANCE_DEG } from "./insertRules.js";
import { secondsSoFar } from "./insertState.js";

function round(v, dp){ const m = Math.pow(10, dp || 0); return Math.round(v*m)/m; }

/**
 * @param {object} state       insertState
 * @param {object} result      evaluateInsert(state, vessels, bevelDeg, angleBand, anchorBand)'s return
 * @param {number} [bevelDeg]  the needle unit's bevel angle
 * @param {number} [now]       injectable clock
 * @param {object} [angleBand] {ideal,acceptable} — defaults to the antecubital window; the
 *   SAME band must be passed here as was passed to `evaluateInsert`, or the
 *   score will judge one procedure's entry against another's window.
 */
export function measureInsert(state, result, bevelDeg, now, angleBand){
  const r = result;
  const chosen = r.chosen;
  const angle = angleBand || DEFAULT_ANGLE_BAND;
  const secs = state.flashAt != null ? (state.flashAt - state.startedAt)/1000 : null;

  const mistakes = [];
  if(!state.anchorSet) mistakes.push({ code:"notAnchored", message:"The vein was never anchored before the stick." });
  if(state.entryX == null && !state.flashAt) mistakes.push({ code:"neverInserted", message:"The needle never broke the skin." });
  else if(!r.inVein) mistakes.push({
    code: r.through ? "throughAndThrough" : "missed",
    message: r.through ? "The needle passed through the far wall of the vein." : "The needle did not land in the chosen vein.",
  });
  if(state.angleDeg != null && (state.angleDeg < angle.ideal.min || state.angleDeg > angle.ideal.max)){
    mistakes.push({ code:"angle", message:`Entered at ${Math.round(state.angleDeg)}°, outside the ${angle.ideal.min}-${angle.ideal.max}° window.` });
  }
  if(bevelDeg != null && Math.abs(bevelDeg) > BEVEL_TOLERANCE_DEG) mistakes.push({ code:"bevelDown", message:"The bevel was not facing up on entry." });
  if(state.withdrawnBeforeFlash) mistakes.push({ code:"withdrawn", message:"Pulled back out before ever getting a flash." });
  if(state.reapproaches > 0) mistakes.push({ code:"reapproached", message:`Re-approached ${state.reapproaches} time(s) before landing in the vein.` });

  let score = 100;
  if(!state.anchorSet) score -= 15;
  if(state.entryX == null && !state.flashAt){
    score = Math.min(score, 10);
  }else{
    if(!r.inVein) score -= r.through ? 45 : 55;
    if(state.angleDeg != null){
      if(state.angleDeg < angle.ideal.min - 3 || state.angleDeg > angle.ideal.max + 3) score -= 18;
      else if(state.angleDeg < angle.ideal.min || state.angleDeg > angle.ideal.max) score -= 8;
    }
  }
  if(bevelDeg != null && Math.abs(bevelDeg) > BEVEL_TOLERANCE_DEG) score -= 20;
  if(state.withdrawnBeforeFlash) score -= 10;
  score -= Math.min(20, state.reapproaches*8);
  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    score,
    anchored: !!state.anchorSet,
    anchorPullMm: round(state.anchorPull*1000, 1),
    anchorOffsetMm: r.anchorOffset == null ? null : round(r.anchorOffset*1000, 1),
    entered: state.entryX != null || !!state.flashAt,
    angleDeg: state.angleDeg == null ? null : round(state.angleDeg, 0),
    depthMm: round(state.depthM*1000, 1),
    peakDepthMm: round(state.peakDepthM*1000, 1),
    vesselDepthMm: chosen ? round(chosen.depth*1000, 1) : null,
    inVein: !!r.inVein,
    throughAndThrough: !!r.through,
    bevelUp: bevelDeg == null ? null : Math.abs(bevelDeg) <= BEVEL_TOLERANCE_DEG,
    reapproaches: state.reapproaches,
    secondsToFlash: secs == null ? null : round(secs, 1),
    secondsElapsed: round(secondsSoFar(state, now), 1),
    mistakes,
    narrative: narrate(state, r),
  };
}

function narrate(state, r){
  if(state.entryX == null && !state.flashAt) return "The needle never went in.";
  const bits = [];
  bits.push(state.anchorSet ? "anchored the vein" : "went in without anchoring");
  if(state.angleDeg != null) bits.push(`entered at ${Math.round(state.angleDeg)}°`);
  bits.push(r.inVein ? "flash confirmed" : (r.through ? "went through the vein" : "missed the vein"));
  if(state.reapproaches > 0) bits.push(`after ${state.reapproaches} re-approach${state.reapproaches>1?"es":""}`);
  return bits.join(", ") + ".";
}

/** Fold into the encounter's existing chips. */
export function applyInsertOutcome(procedureState, measurements){
  if(!procedureState || !measurements) return procedureState;
  procedureState.insertOk = measurements.inVein && !measurements.throughAndThrough
    && measurements.bevelUp !== false;
  procedureState.insertMeasurements = measurements;
  return procedureState;
}
