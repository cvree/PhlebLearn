/* =========================================================================
   TUBE COLLECTION SCORING — real millilitres, real percentages of each
   tube's own draw volume, real millimetres of needle displacement. Not a
   "filled to the line" boolean. Pure maths.
   ========================================================================= */
import {
  requiredFraction, ratioCritical, tubeName, expectedOrder, tubeVolumeMl,
  lumenToleranceM,
} from "./collectionRules.js";
import { secondsCollecting } from "./collectionState.js";

function round(v, dp){ const m = Math.pow(10, dp || 0); return Math.round(v*m)/m; }

/**
 * How much of the intended order of draw was actually followed, as the
 * fraction of consecutive pairs that were in the right order — so one tube
 * out of place in a five-tube draw is not scored the same as reversing the
 * lot.
 */
export function orderAccuracy(drawnSequence, required){
  const want = expectedOrder(required || []);
  const got = (drawnSequence || []).filter(k => want.indexOf(k) >= 0);
  if(got.length < 2) return 1;
  let ok = 0, pairs = 0;
  for(let i = 1; i < got.length; i++){
    pairs++;
    if(want.indexOf(got[i]) >= want.indexOf(got[i-1])) ok++;
  }
  return pairs ? ok/pairs : 1;
}

/**
 * @param {object} state   collectionState
 * @param {object} result  evaluateCollection()'s return
 * @param {object} [o]     { tourniquetSeconds, now }
 */
export function measureCollection(state, result, o){
  const opt = o || {};
  const mistakes = [];

  const drawnSequence = state.order
    .filter(k => state.tubes[k] && state.tubes[k].removedAt)
    .sort((a, b)=>state.tubes[a].removedAt - state.tubes[b].removedAt);

  const tubes = state.order.map(key=>{
    const t = state.tubes[key];
    const volumeMl = tubeVolumeMl(key);
    const drawnMl = t ? t.drawnMl : 0;
    const fraction = volumeMl > 0 ? drawnMl/volumeMl : 0;
    const need = requiredFraction(key);
    return {
      key, name: tubeName(key),
      volumeMl: round(volumeMl, 1),
      drawnMl: round(drawnMl, 2),
      fillPercent: Math.round(fraction*100),
      requiredPercent: Math.round(need*100),
      collected: !!(t && t.removedAt),
      ratioValid: fraction >= need,
      ratioCritical: ratioCritical(key),
      carryoverFrom: t && t.carryover ? t.carryover.from : null,
      deadOnAir: !!(t && t.deadOnAir),
      shiftDuringMm: round((t ? t.shiftDuringM : 0)*1000, 1),
      vacuumCycles: t ? t.vacuumCycles : 0,
    };
  });

  const collected = tubes.filter(t => t.collected);
  const uncollected = tubes.filter(t => !t.collected);
  const shortDraws = collected.filter(t => !t.ratioValid);
  const invalidated = collected.filter(t => !t.ratioValid && t.ratioCritical);
  const contaminated = collected.filter(t => t.carryoverFrom);

  for(const t of uncollected) mistakes.push({
    code: "notCollected", item: t.name,
    message: `The ${t.name} tube was never collected.`,
  });
  for(const t of invalidated) mistakes.push({
    code: "ratioInvalid", item: t.name,
    message: `${t.name} came off at ${t.fillPercent}% — its additive ratio is fixed, so the result is wrong, not merely imprecise. Needs a redraw.`,
  });
  for(const t of shortDraws.filter(x => !x.ratioCritical)) mistakes.push({
    code: "underfilled", item: t.name,
    message: `${t.name} came off at ${t.fillPercent}% of its ${t.volumeMl}mL draw volume.`,
  });
  for(const t of contaminated) mistakes.push({
    code: "carryover", item: t.name,
    message: `${t.name} was drawn after ${tubeName(t.carryoverFrom)} — additive carried through the needle into it.`,
  });
  if(state.tubesWasted > 0) mistakes.push({
    code: "wasted",
    message: `${state.tubesWasted} tube(s) had a stopper pierced with nothing flowing and had to be binned.`,
  });
  if(state.needleOut) mistakes.push({
    code: "needleDislodged",
    message: `The needle was pushed ${round(state.peakShiftM*1000, 1)}mm out of the lumen while tubes were being handled.`,
  });

  const accuracy = orderAccuracy(drawnSequence, state.order);
  if(accuracy < 1) mistakes.push({
    code: "orderOfDraw",
    message: `Tubes came off in the order ${drawnSequence.map(tubeName).join(" → ")}; the order of draw is ${expectedOrder(state.order).map(tubeName).join(" → ")}.`,
  });

  const tourniquetSeconds = opt.tourniquetSeconds == null ? null : round(opt.tourniquetSeconds, 1);
  if(tourniquetSeconds != null && tourniquetSeconds > 60) mistakes.push({
    code: "tourniquetLong",
    message: `The band was still on at ${Math.round(tourniquetSeconds)}s during collection — past a minute the sample hemoconcentrates.`,
  });

  let score = 100;
  score -= uncollected.length*25;
  score -= invalidated.length*22;
  score -= shortDraws.filter(t => !t.ratioCritical).length*10;
  score -= contaminated.length*20;
  score -= state.tubesWasted*8;
  if(state.needleOut){
    score -= 30;
  }else{
    // A braced seat still transmits a fraction of the push — that is physics,
    // not carelessness, so the first half of the lumen's own tolerance is
    // free. Beyond that the tip is being moved about, and it is scored
    // against the vein it is in rather than a fixed millimetre count.
    const tolerance = lumenToleranceM(state.vessel);
    const excess = Math.max(0, state.peakShiftM - tolerance*0.5)/tolerance;
    score -= Math.min(12, Math.round(excess*24));
  }
  score -= Math.round((1 - accuracy)*25);
  if(tourniquetSeconds != null && tourniquetSeconds > 60) score -= 8;
  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    score,
    tubes,
    tubesRequired: state.order.length,
    tubesCollected: collected.length,
    orderAccuracy: round(accuracy, 2),
    drawnSequence,
    carryoverCount: contaminated.length,
    shortDraws: shortDraws.length,
    invalidatedTubes: invalidated.length,
    tubesWasted: state.tubesWasted,
    peakNeedleShiftMm: round(state.peakShiftM*1000, 1),
    needleDislodged: !!state.needleOut,
    vacuumBreaks: state.reseats,
    totalDrawnMl: round(tubes.reduce((s, t)=>s + t.drawnMl, 0), 2),
    tourniquetSeconds,
    secondsElapsed: round(secondsCollecting(state, opt.now), 1),
    mistakes,
    narrative: narrate(state, tubes, accuracy),
  };
}

function narrate(state, tubes, accuracy){
  const collected = tubes.filter(t => t.collected);
  if(!collected.length) return "No tube was ever filled.";
  const bits = [];
  bits.push(`${collected.length} of ${tubes.length} tube${tubes.length === 1 ? "" : "s"} collected`);
  const short = collected.filter(t => !t.ratioValid);
  bits.push(short.length ? `${short.length} short of its ratio` : "all filled to their draw volume");
  bits.push(accuracy >= 1 ? "in order of draw" : "out of order");
  if(state.needleOut) bits.push("but the needle was dislodged during a tube change");
  else if(state.peakShiftM > 0.0008) bits.push(`with the needle moving ${Math.round(state.peakShiftM*1000)}mm in the vein`);
  return bits.join(", ") + ".";
}

/** Fold into the encounter's existing chips. */
export function applyCollectionOutcome(procedureState, measurements){
  if(!procedureState || !measurements) return procedureState;
  procedureState.fillGood = measurements.tubesCollected === measurements.tubesRequired
    && measurements.invalidatedTubes === 0 && measurements.shortDraws === 0;
  procedureState.tubeOrderOk = measurements.orderAccuracy >= 1 && measurements.carryoverCount === 0;
  procedureState.collectionMeasurements = measurements;
  // the old 2D steps kept these two; downstream screens still read them
  procedureState.filled = measurements.tubes.filter(t => t.collected).map(t => t.key);
  procedureState.fillFinal = measurements.tubes.length ? measurements.tubes[0].fillPercent : 0;
  return procedureState;
}
