/* =========================================================================
   WINGED-SET SCORING — real millimetres of tip movement, real millilitres
   into the tissue, real seconds before anybody noticed.

   The straight-needle draw has nothing to compare with any of these: it has
   no wings to lay flat, no line to tape down, and a fossa vein that stops
   dead rather than leaking quietly. That is what "meaningfully different"
   means here — a different set of numbers, not a different sprite.

   Pure maths.
   ========================================================================= */
import {
  evaluateButterfly, infiltrationFrom, WINGS, isTaut, slackOf,
  SWELLING_VISIBLE_ML, NOTICE_WITHIN_S,
} from "./butterflyRules.js";
import { secondsToNotice } from "./butterflyState.js";
import { procedureFor, PROCEDURE } from "../procedure.js";

function round(v, dp){ const m = Math.pow(10, dp || 0); return Math.round(v*m)/m; }

export function measureButterfly(state, result, o){
  const opt = o || {};
  const spec = procedureFor(PROCEDURE.BUTTERFLY_HAND).tubing;
  const r = result || evaluateButterfly(state, opt);
  const mistakes = [];

  const noticeS = secondsToNotice(state, opt.now);
  const transmitted = state.disturbances.filter(d => d.shiftMm >= 0.2);
  const whileLoose = state.disturbances.filter(d => !d.secured && d.shiftMm >= 0.2);

  /* --- what went wrong, named ------------------------------------------------- */
  if(!state.entered) mistakes.push({
    code: "neverEntered",
    message: "The set never went into a vein.",
  });
  if(state.carriedByTubingAtEntry) mistakes.push({
    code: "carriedByTubing", critical: true,
    message: "The set was carried by its tubing rather than by the wings, so the needle went in at whatever angle the line happened to hang at.",
  });
  else if(!state.entered && !state.wingsHeld) mistakes.push({
    code: "notCarriedYet",
    message: "The set has not been picked up by its wings yet.",
  });
  if(state.entered && state.entryAngleDeg != null){
    const band = procedureFor(PROCEDURE.BUTTERFLY_HAND).angle.ideal;
    if(state.entryAngleDeg > band.max) mistakes.push({
      code: "tooSteepForHand",
      message: `Entered at ${Math.round(state.entryAngleDeg)}° — a dorsal hand vein is ${Math.round(state.calibreM*1000*10)/10}mm across with bone under it, and the window is ${band.min}–${band.max}°.`,
    });
    else if(state.entryAngleDeg < band.min) mistakes.push({
      code: "tooFlatForHand",
      message: `Entered at ${Math.round(state.entryAngleDeg)}°, flatter than the ${band.min}–${band.max}° window — the bevel skates along the top of the vein.`,
    });
  }
  if(state.entered && state.wings === WINGS.PINCHED) mistakes.push({
    code: "wingsNeverLaidFlat",
    message: "The wings were never laid flat, so the tip stayed at its entry angle through the whole collection.",
  });
  if(state.entered && !state.secured) mistakes.push({
    code: "tubingNeverSecured",
    message: `The wings were never taped down. ${whileLoose.length} disturbance${whileLoose.length === 1 ? "" : "s"} reached the tip through a loose line.`,
  });
  if(state.entered && isTaut(state.tubing, spec)) mistakes.push({
    code: "tubingTaut", critical: true,
    message: `Only ${Math.round(slackOf(state.tubing)*1000)}mm of slack was left in the line — the needle was holding the set up.`,
  });
  if(state.peakTipOffsetM > state.calibreM*0.5) mistakes.push({
    code: "tipOutOfLumen",
    message: `The tip was worked ${round(state.peakTipOffsetM*1000, 1)}mm off centre — past the wall of a ${round(state.calibreM*1000, 1)}mm vein.`,
  });
  if(state.infiltratedMl >= SWELLING_VISIBLE_ML && !state.infiltrationNoticed) mistakes.push({
    code: "infiltrationMissed", critical: true,
    message: `${round(state.infiltratedMl, 2)} mL went into the tissue and the swelling was never noticed.`,
  });
  else if(state.infiltrationNoticed && noticeS != null && noticeS > NOTICE_WITHIN_S) mistakes.push({
    code: "infiltrationLate",
    message: `The swelling was there for ${round(noticeS, 0)}s before it was noticed (target: within ${NOTICE_WITHIN_S}s).`,
  });
  if(state.infiltrationNoticed && !state.stoppedOnInfiltration) mistakes.push({
    code: "infiltrationNotActedOn", critical: true,
    message: "The infiltration was recognised and the draw carried on anyway.",
  });

  /* --- the score ---------------------------------------------------------------- */
  let score = 100;
  if(!state.entered) score -= 55;
  if(state.carriedByTubingAtEntry) score -= 20;
  else if(!state.entered && !state.wingsHeld) score -= 20;
  if(state.entered && state.entryAngleDeg != null){
    const band = procedureFor(PROCEDURE.BUTTERFLY_HAND).angle.ideal;
    if(state.entryAngleDeg > band.max) score -= Math.min(26, Math.round((state.entryAngleDeg - band.max)*2.2));
    else if(state.entryAngleDeg < band.min) score -= Math.min(14, Math.round((band.min - state.entryAngleDeg)*3));
  }
  if(state.entered && state.wings === WINGS.PINCHED) score -= 12;
  if(state.entered && !state.secured) score -= 14;
  if(state.entered && isTaut(state.tubing, spec)) score -= 18;
  score -= Math.min(18, Math.round(Math.max(0, state.peakTipOffsetM - state.calibreM*0.5)*1000*9));
  if(state.infiltratedMl >= SWELLING_VISIBLE_ML && !state.infiltrationNoticed) score -= 28;
  else if(state.infiltrationNoticed && noticeS != null && noticeS > NOTICE_WITHIN_S) score -= 10;
  if(state.infiltrationNoticed && !state.stoppedOnInfiltration) score -= 20;
  // recognising it early and stopping is the recovery, and it is worth marks
  if(state.infiltrationNoticed && state.stoppedOnInfiltration && noticeS != null && noticeS <= NOTICE_WITHIN_S) score += 6;
  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    score,
    device: "butterfly",
    gauge: state.gauge,

    entered: !!state.entered,
    entryAngleDeg: state.entryAngleDeg == null ? null : round(state.entryAngleDeg, 0),
    carriedByWings: state.entered ? !state.carriedByTubingAtEntry : !!state.wingsHeld,
    wingsLaidFlat: state.wings === WINGS.FLAT,
    wingsSecured: !!state.secured,

    tubingSlackMm: round(slackOf(state.tubing)*1000, 0),
    tubingTaut: isTaut(state.tubing, spec),
    disturbances: state.disturbances.length,
    disturbancesTransmitted: transmitted.length,
    disturbancesWhileLoose: whileLoose.length,
    peakTipOffsetMm: round(state.peakTipOffsetM*1000, 2),
    lumenRadiusMm: round(state.calibreM*500, 2),

    infiltratedMl: round(state.infiltratedMl, 2),
    infiltrationNoticed: !!state.infiltrationNoticed,
    secondsToNotice: noticeS == null ? null : round(noticeS, 1),
    stoppedOnInfiltration: !!state.stoppedOnInfiltration,

    ready: r.ready,
    mistakes,
    criticalEvents: mistakes.filter(m => m.critical).map(m => m.code),
    narrative: narrate(state, transmitted, whileLoose, noticeS),
  };
}

function narrate(state, transmitted, whileLoose, noticeS){
  if(!state.entered) return "The winged set never entered a vein.";
  const bits = [];
  bits.push(`In at ${Math.round(state.entryAngleDeg)}°${state.carriedByTubingAtEntry ? " carried by the tubing" : " holding the wings"}`);
  bits.push(state.wings === WINGS.FLAT ? "wings laid flat" : "wings never laid flat");
  bits.push(state.secured ? "line taped down" : "line left loose");
  if(transmitted.length){
    bits.push(`${transmitted.length} disturbance${transmitted.length === 1 ? "" : "s"} reached the tip${whileLoose.length ? ` (${whileLoose.length} of them through a loose line)` : ""}`);
  }else{
    bits.push("nothing reached the tip");
  }
  if(state.infiltratedMl > 0){
    bits.push(state.infiltrationNoticed
      ? `${Math.round(state.infiltratedMl*100)/100} mL into the tissue, noticed after ${Math.round(noticeS || 0)}s`
      : `${Math.round(state.infiltratedMl*100)/100} mL into the tissue, never noticed`);
  }
  return bits.join(", ") + ".";
}

/** Fold into the encounter's existing chips. */
export function applyButterflyOutcome(procedureState, measurements){
  if(!procedureState || !measurements) return procedureState;
  const m = measurements;
  procedureState.butterflyOk = m.entered && m.carriedByWings && m.wingsSecured
    && !m.tubingTaut && (!m.infiltratedMl || m.stoppedOnInfiltration);
  procedureState.butterflyMeasurements = m;
  return procedureState;
}
