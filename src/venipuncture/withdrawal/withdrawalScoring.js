/* =========================================================================
   WITHDRAW, SAFETY AND SHARPS SCORING — real seconds on the band, a real
   exit angle in degrees, real millimetres of sideways drag, real seconds of
   exposed needle. Not a row of booleans. Pure maths.
   ========================================================================= */
import {
  GAUZE_READY_M, EXIT_DEVIATION_WARN_DEG, EXIT_LATERAL_WARN_M,
  EXIT_SPEED_WARN_MPS, SAFETY_IMMEDIATE_S, DISPOSE_IMMEDIATE_S,
  reachToleranceM,
} from "./withdrawalRules.js";
import { gauzeReady, exposedSeconds, disposalDelaySeconds } from "./withdrawalState.js";

function round(v, dp){ const m = Math.pow(10, dp || 0); return Math.round(v*m)/m; }

/**
 * @param {object} state   withdrawalState
 * @param {object} result  evaluateWithdrawal()'s return
 * @param {object} [o]     { tourniquetSeconds, tourniquetReleased, now }
 */
export function measureWithdrawal(state, result, o){
  const opt = o || {};
  const mistakes = [];

  const released = state.releasedAt != null || !!opt.tourniquetReleased;
  const releasedBeforeWithdraw = released
    && (state.withdrawnAt == null || state.releasedAt == null || state.releasedAt <= state.withdrawnAt);
  const tourniquetSeconds = opt.tourniquetSeconds == null
    ? state.tourniquetSecondsAtRelease
    : round(opt.tourniquetSeconds, 1);

  const exposedS = round(exposedSeconds(state, opt.now), 1);
  const disposeDelayS = disposalDelaySeconds(state, opt.now);

  /* --- what went wrong, named ------------------------------------------------ */
  if(!released) mistakes.push({
    code: "bandNeverReleased",
    message: "The tourniquet was never released.",
  });
  else if(!releasedBeforeWithdraw) mistakes.push({
    code: "withdrewUnderPressure",
    message: "The needle came out before the band did — the site bled under pressure.",
  });
  if(released && !state.fistRelaxed) mistakes.push({
    code: "fistStillClenched",
    message: "The patient was never asked to open their hand.",
  });
  if(released && !state.collectionDoneAtRelease) mistakes.push({
    code: "releasedMidDraw",
    message: "The band came off while tubes were still to be filled.",
  });
  if(state.releaseShiftM > reachToleranceM(state.vessel)*0.55) mistakes.push({
    code: "disturbedReaching",
    message: `Reaching for the band moved the needle ${round(state.releaseShiftM*1000, 1)}mm in the vein.`,
  });
  if(state.gauzeTakenAt && !state.gauzeClean) mistakes.push({
    code: "gauzeUnsterile",
    message: "The pad laid on the fresh puncture was not sterile.",
  });
  if(state.gauzePressedEarly) mistakes.push({
    code: "pressedTooSoon",
    message: "Pressure went onto the gauze while the needle was still in the vein.",
  });
  if(state.withdrawnAt != null && !state.gauzeReadyAtWithdraw) mistakes.push({
    code: "gauzeNotReady",
    message: "The needle came out with no gauze resting ready above the site.",
  });
  if(state.tubeOnAtWithdraw) mistakes.push({
    code: "withdrewWithTube",
    message: "A tube was still engaged on the holder when the needle came out.",
  });
  if(state.withdrawnAt != null && state.exitDeviationDeg > EXIT_DEVIATION_WARN_DEG) mistakes.push({
    code: "exitOffLine",
    message: `The exit path ran ${round(state.exitDeviationDeg, 0)}° off the entry line.`,
  });
  if(state.withdrawnAt != null && state.exitLateralM > EXIT_LATERAL_WARN_M) mistakes.push({
    code: "exitSawed",
    message: `The tip was levered ${round(state.exitLateralM*1000, 1)}mm sideways on the way out.`,
  });
  if(state.withdrawnAt != null && state.peakSpeedMps > EXIT_SPEED_WARN_MPS) mistakes.push({
    code: "yanked",
    message: `Peak withdrawal speed hit ${round(state.peakSpeedMps*100, 0)}cm/s — a yank, not a draw.`,
  });
  if(state.recapAttempted) mistakes.push({
    code: "recapAttempted", critical: true,
    message: "A recap of the used needle was attempted by hand.",
  });
  if(state.surfaceActivated) mistakes.push({
    code: "struckOnSurface", critical: true,
    message: "The safety was activated by pressing the device against a surface.",
  });
  if(state.exposedSetDown) mistakes.push({
    code: "exposedSetDown", critical: true,
    message: "A used, exposed sharp was set down.",
  });
  if(state.safetyLockedAt != null && exposedS > SAFETY_IMMEDIATE_S) mistakes.push({
    code: "safetyDelayed",
    message: `The used needle was exposed for ${exposedS}s before the safety locked.`,
  });
  if(state.disposedAt != null && !state.safetyEngagedAtDispose) mistakes.push({
    code: "disposedExposed", critical: true,
    message: "The unit was carried to the container with the safety never engaged.",
  });
  if(state.trashAttempts > 0) mistakes.push({
    code: "trashAttempted", critical: true,
    message: `The sharp was ${state.trashAttempts > 1 ? state.trashAttempts + " times " : ""}offered to normal waste.`,
  });
  if(state.crossedPatient) mistakes.push({
    code: "crossedPatient",
    message: "The used sharp was carried back across the patient.",
  });
  if(state.disposedAt != null && !state.disposedFully) mistakes.push({
    code: "notFullyIn",
    message: "The device was left resting in the container's aperture rather than inside it.",
  });
  if(state.setDownAfterSafety) mistakes.push({
    code: "shieldedSetDown",
    message: "The shielded unit was parked instead of going straight into the container.",
  });
  if(disposeDelayS != null && state.disposedAt != null && disposeDelayS > DISPOSE_IMMEDIATE_S) mistakes.push({
    code: "disposeDelayed",
    message: `${round(disposeDelayS, 0)}s passed between the safety locking and disposal.`,
  });

  /* --- the score ---------------------------------------------------------------- */
  let score = 100;
  if(!released) score -= 25;
  else if(!releasedBeforeWithdraw) score -= 22;
  if(released && !state.fistRelaxed) score -= 4;
  if(released && !state.collectionDoneAtRelease) score -= 8;
  {
    const tol = reachToleranceM(state.vessel);
    const excess = Math.max(0, state.releaseShiftM - tol*0.35)/tol;
    score -= Math.min(10, Math.round(excess*16));
  }
  if(state.gauzeTakenAt && !state.gauzeClean) score -= 14;
  if(state.gauzePressedEarly) score -= 8;
  if(state.withdrawnAt != null && !state.gauzeReadyAtWithdraw) score -= 8;
  if(state.tubeOnAtWithdraw) score -= 14;
  if(state.withdrawnAt != null){
    score -= Math.min(12, Math.round(Math.max(0, state.exitDeviationDeg - 6)*1.2));
    score -= Math.min(8, Math.round(Math.max(0, (state.exitLateralM - 0.0012)*1000)*2.5));
    if(state.peakSpeedMps > EXIT_SPEED_WARN_MPS) score -= 8;
  }
  if(state.recapAttempted) score -= 25;
  if(state.surfaceActivated) score -= 18;
  if(state.exposedSetDown) score -= 25;
  if(state.safetyLockedAt != null) score -= Math.min(10, Math.round(Math.max(0, exposedS - SAFETY_IMMEDIATE_S)*2));
  if(state.disposedAt != null && !state.safetyEngagedAtDispose) score -= 25;
  score -= Math.min(25, state.trashAttempts*15);
  if(state.crossedPatient) score -= 6;
  if(state.disposedAt != null && !state.disposedFully) score -= 8;
  if(state.setDownAfterSafety) score -= 6;
  if(disposeDelayS != null && state.disposedAt != null && disposeDelayS > DISPOSE_IMMEDIATE_S) score -= 5;
  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    score,
    device: state.device,

    released,
    releasedBeforeWithdraw,
    releasedByTail: state.releasedByTail,
    fistRelaxed: state.fistRelaxed,
    collectionDoneAtRelease: state.collectionDoneAtRelease,
    tourniquetSeconds,
    releaseShiftMm: round(state.releaseShiftM*1000, 1),

    gauzeClean: state.gauzeClean,
    gauzeReadyAtWithdraw: state.gauzeReadyAtWithdraw,
    gauzeOffsetMm: state.gauzeOffsetM == null ? null : round(state.gauzeOffsetM*1000, 0),
    gauzeReadyM: GAUZE_READY_M,
    pressedEarly: state.gauzePressedEarly,

    withdrawn: state.withdrawnAt != null,
    tubeOnAtWithdraw: state.tubeOnAtWithdraw,
    tourniquetOnAtWithdraw: state.tourniquetOnAtWithdraw,
    exitDeviationDeg: round(state.exitDeviationDeg, 1),
    exitLateralMm: round(state.exitLateralM*1000, 1),
    peakSpeedCmps: round(state.peakSpeedMps*100, 1),
    tipTravelMm: round(state.tipTravelM*1000, 1),

    safetyEngaged: state.safetyLockedAt != null,
    safetyInHand: state.safetyLockedAt != null && !state.surfaceActivated,
    surfaceActivated: state.surfaceActivated,
    recapAttempted: state.recapAttempted,
    exposedSetDown: state.exposedSetDown,
    exposedSeconds: exposedS,

    disposed: state.disposedAt != null,
    disposedFully: state.disposedFully,
    safetyEngagedAtDispose: state.safetyEngagedAtDispose,
    crossedPatient: state.crossedPatient,
    trashAttempts: state.trashAttempts,
    setDownAfterSafety: state.setDownAfterSafety,
    disposeDelaySeconds: disposeDelayS == null ? null : round(disposeDelayS, 1),

    mistakes,
    criticalEvents: mistakes.filter(m => m.critical).map(m => m.code),
    narrative: narrate(state, released, releasedBeforeWithdraw, exposedS),
  };
}

function narrate(state, released, beforeWithdraw, exposedS){
  const bits = [];
  bits.push(released
    ? (beforeWithdraw ? "band released before the needle moved" : "band released AFTER the needle was out")
    : "band never released");
  if(state.withdrawnAt != null){
    bits.push(`needle out at ${Math.round(state.exitDeviationDeg)}° off its entry line`);
    bits.push(state.gauzeReadyAtWithdraw ? "gauze ready" : "gauze not ready");
  }else{
    bits.push("needle still in");
  }
  if(state.safetyLockedAt != null){
    bits.push(state.surfaceActivated
      ? "safety struck against a surface"
      : `safety locked in the hand after ${exposedS}s`);
  }
  if(state.disposedAt != null){
    bits.push(state.disposedFully ? "disposed whole into the sharps container" : "left in the container's mouth");
  }
  return bits.join(", ") + ".";
}

/**
 * Fold into the encounter's existing chips, exactly the fields the recap and
 * the later steps already read. Called at each of the four steps' ends —
 * idempotent, the values simply firm up as the state does.
 */
export function applyWithdrawalOutcome(procedureState, measurements){
  if(!procedureState || !measurements) return procedureState;
  const c = procedureState, m = measurements;

  if(m.released){
    c.tqSeconds = m.tourniquetSeconds;
    // A good tourniquet was applied well AND released in time AND before the
    // withdrawal. The application half was measured when the band went on;
    // do not overwrite that verdict with a timing-only one.
    const appliedWell = c.tourniquetMeasurements
      ? (c.tourniquetMeasurements.positionOk && c.tourniquetMeasurements.tensionSafe && c.tourniquetMeasurements.wrappedUnder)
      : true;
    const inTime = m.tourniquetSeconds == null || m.tourniquetSeconds <= 60;
    c.tqGood = appliedWell && inTime && m.releasedBeforeWithdraw;
  }
  if(m.withdrawn){
    c.lastTubeRemoved = !m.tubeOnAtWithdraw;
    c.withdrawOk = m.releasedBeforeWithdraw && !m.tubeOnAtWithdraw;
  }
  if(m.safetyEngaged){
    c.safetyOk = m.safetyInHand && !m.recapAttempted && !m.exposedSetDown;
  }
  if(m.disposed){
    c.disposeOk = m.disposedFully && m.safetyEngagedAtDispose && m.trashAttempts === 0;
  }
  c.withdrawalMeasurements = m;
  return c;
}
