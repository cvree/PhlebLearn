/* =========================================================================
   ASSEMBLY SCORING — real turns, real degrees, real millimetres.

   Two categories, because they are two different failures: an assembly that
   leaks is a specimen problem, and a barbed needle put into a patient who was
   never warned is a patient problem. Pure maths.
   ========================================================================= */
import {
  evaluateAssembly, evaluateUncap, bevelFromTurns,
  SECURE_TURNS, SNUG_TURNS, OVERTIGHT_TURNS, AXIAL_GOOD, BEVEL_TOLERANCE_DEG,
} from "./assemblyRules.js";
import { secondsAssembling } from "./assemblyState.js";

function round(v, dp){ const m = Math.pow(10, dp || 0); return Math.round(v*m)/m; }

export function measureAssembly(state, result, now){
  const r = result || evaluateAssembly(state);
  const secs = secondsAssembling(state, now);

  const mistakes = [];
  if(!state.pouchOpen) mistakes.push({ code:"pouchSealed", message:"The needle was never taken out of its pouch." });
  if(state.pouchTorn) mistakes.push({ code:"tornPouch", message:"The pouch was torn open across the film instead of peeled at the seam." });
  if(state.contaminated) mistakes.push({ code:"contaminated", message:`The needle was contaminated (${state.contaminatedBy}) and used anyway.` });
  if(state.crossThreaded) mistakes.push({ code:"crossThreaded", message:`The needle was started ${round(state.engageMisalignDeg,0)}° off the hub's axis and cross-threaded — it never seated.` });
  else if(state.turns < SECURE_TURNS) mistakes.push({ code:"loose", message:`Only ${round(state.turns,1)} turns — the unit was not finger-tight and would leak vacuum.` });
  else if(state.turns < SNUG_TURNS) mistakes.push({ code:"notSnug", message:`${round(state.turns,1)} turns is holding but short of finger-tight.` });
  if(state.turns > OVERTIGHT_TURNS) mistakes.push({ code:"overTightened", message:`${round(state.turns,1)} turns over-torqued the hub.` });
  if(state.gauge !== 21) mistakes.push({ code:"gauge", message:`Assembled with the ${state.gauge}G needle rather than a 21G.` });

  let score = 100;
  if(!state.pouchOpen) score -= 60;
  if(state.pouchTorn) score -= 8;
  if(state.contaminated) score -= 35;
  if(state.crossThreaded) score -= 30;
  else if(state.turns < SECURE_TURNS) score -= Math.round((SECURE_TURNS - Math.max(0, state.turns))*18);
  else if(state.turns < SNUG_TURNS) score -= 6;
  if(state.turns > OVERTIGHT_TURNS) score -= 10;
  if(state.gauge !== 21) score -= 10;
  if(state.reverseTurns > 0.25) score -= 4;
  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    score,
    turns: round(state.turns, 2),
    reverseTurns: round(state.reverseTurns, 2),
    engageMisalignDeg: round(state.engageMisalignDeg, 1),
    crossThreaded: !!state.crossThreaded,
    fingerTight: !state.crossThreaded && state.turns >= SNUG_TURNS,
    pouchPeeled: !!state.pouchOpen && !state.pouchTorn,
    contaminated: !!state.contaminated,
    contaminatedBy: state.contaminatedBy,
    needlesUsed: state.needlesUsed,
    gauge: state.gauge,
    engagements: state.engagements,
    secondsToAssemble: round(secs, 1),
    /** whether the whole assembly fitted inside the site's air-drying time */
    insideDryTime: state.dryElapsedAtStart != null && state.dryElapsedAtStart < 30,
    mistakes,
    narrative: narrateAssembly(state, r),
  };
}

function narrateAssembly(state, r){
  if(!state.pouchOpen) return "The needle never came out of its pouch.";
  const bits = [];
  bits.push(state.pouchTorn ? "Tore the pouch open" : "Peeled the pouch at the seam");
  if(state.contaminated) bits.push(`contaminated the needle (${state.contaminatedBy})`);
  if(state.crossThreaded) bits.push(`cross-threaded it at ${Math.round(state.engageMisalignDeg)}°`);
  else bits.push(`threaded it ${state.turns.toFixed(1)} turns${r.ready ? " — finger-tight" : ""}`);
  if(state.needlesUsed > 1) bits.push(`through ${state.needlesUsed} needles`);
  return bits.join(", ") + ".";
}

export function measureUncap(state, result, now){
  const r = result || evaluateUncap(state, now);
  const bevel = Math.abs(state.bevelDeg == null ? bevelFromTurns(state.turns) : state.bevelDeg);
  const t = now == null ? Date.now() : now;

  const mistakes = [];
  if(state.capOn) mistakes.push({ code:"stillCapped", message:"The sheath never came off." });
  else{
    if(state.capAxialFraction < AXIAL_GOOD) mistakes.push({ code:"wiggledOff", message:`Only ${Math.round(state.capAxialFraction*100)}% of the pull was along the needle — the sheath was levered off sideways.` });
    if(state.maxLateral > 0.004) mistakes.push({ code:"bentShaft", message:`The shaft was levered ${round(state.maxLateral*1000,1)} mm off its axis.` });
  }
  if(state.needleDamaged) mistakes.push({ code:"barbedNeedle", message:"The bevel was turned over, and a barbed needle drags going in and haemolyses the sample." });
  if(state.needleContaminated) mistakes.push({ code:"needleTouched", message:"The bare needle touched something before it touched the vein." });
  if(state.recapped) mistakes.push({ code:"recapped", message:"A sheath was put back on the needle by hand." });
  if(state.capPlacedOn === "site") mistakes.push({ code:"capOnSite", message:"The sheath was put down on the field that had just been disinfected." });
  if(state.capPlacedOn === "floor") mistakes.push({ code:"capDropped", message:"The sheath ended up on the floor." });
  if(bevel > BEVEL_TOLERANCE_DEG) mistakes.push({ code:"bevelOff", message:`The bevel went in ${Math.round(bevel)}° off vertical.` });
  if(!state.bevelInspected) mistakes.push({ code:"notInspected", message:"The bevel was never looked at after uncapping." });
  if(!state.warnedAt) mistakes.push({ code:"patientNotWarned", message:"The patient was not told before the needle went in." });

  let score = 100;
  if(state.capOn) score -= 55;
  else{
    if(state.capAxialFraction < AXIAL_GOOD) score -= Math.round((AXIAL_GOOD - state.capAxialFraction)*60);
    if(state.maxLateral > 0.004) score -= 8;
  }
  if(state.needleDamaged) score -= 30;
  if(state.needleContaminated) score -= 30;
  if(state.recapped) score -= 35;
  if(state.capPlacedOn === "site") score -= 25;
  if(state.capPlacedOn === "floor") score -= 8;
  if(bevel > BEVEL_TOLERANCE_DEG) score -= Math.min(25, Math.round(bevel/6));
  if(!state.bevelInspected) score -= 8;
  if(!state.warnedAt) score -= 12;
  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    score,
    uncapped: !state.capOn,
    axialPct: Math.round(state.capAxialFraction*100),
    lateralMm: round(state.maxLateral*1000, 1),
    twistDeg: round(state.capTwistDeg, 0),
    bevelDeg: round(bevel, 0),
    bevelUp: bevel <= BEVEL_TOLERANCE_DEG,
    bevelInspected: !!state.bevelInspected,
    needleDamaged: !!state.needleDamaged,
    needleContaminated: !!state.needleContaminated,
    recapped: !!state.recapped,
    capPlacedOn: state.capPlacedOn,
    unitsDiscarded: state.unitsDiscarded,
    patientWarned: !!state.warnedAt,
    warnLeadSeconds: state.warnedAt ? round((t - state.warnedAt)/1000, 1) : null,
    ready: r.ready,
    mistakes,
    narrative: narrateUncap(state, bevel),
  };
}

function narrateUncap(state, bevel){
  if(state.capOn) return "The sheath was never taken off.";
  const bits = [state.capAxialFraction >= AXIAL_GOOD
    ? "Pulled the sheath straight off"
    : `Levered the sheath off (${Math.round(state.capAxialFraction*100)}% axial)`];
  if(state.needleDamaged) bits.push("barbing the bevel");
  bits.push(state.bevelInspected ? "checked the bevel" : "without checking it");
  bits.push(bevel <= BEVEL_TOLERANCE_DEG ? "bevel up" : `bevel ${Math.round(bevel)}° off`);
  if(state.capPlacedOn) bits.push(`sheath on the ${state.capPlacedOn}`);
  if(state.recapped) bits.push("then recapped it by hand");
  bits.push(state.warnedAt ? "patient warned" : "patient not warned");
  return bits.join(", ") + ".";
}

/* ---------- fold into the encounter's existing chips ------------------------- */

export function applyAssemblyOutcome(procedureState, measurements){
  if(!procedureState || !measurements) return procedureState;
  procedureState.assembleOk = measurements.fingerTight && !measurements.crossThreaded
    && !measurements.contaminated && measurements.pouchPeeled;
  procedureState.assemblyMeasurements = measurements;
  return procedureState;
}

export function applyUncapOutcome(procedureState, measurements){
  if(!procedureState || !measurements) return procedureState;
  procedureState.uncapOk = measurements.uncapped && measurements.bevelUp
    && !measurements.needleDamaged && !measurements.needleContaminated && !measurements.recapped;
  procedureState.uncapMeasurements = measurements;
  return procedureState;
}
