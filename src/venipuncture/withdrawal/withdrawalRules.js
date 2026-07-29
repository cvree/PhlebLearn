/* =========================================================================
   WITHDRAW, SAFETY AND SHARPS — the rules.

   The old four steps were: a "Release the tourniquet" button, a two-button
   remove-then-withdraw sequence, an "Activate the safety shield" button, and
   a div dragged onto a 🗑️. Between them they modelled none of what actually
   makes the end of a draw safe:

     RELEASE    the band comes off by its own tail, BEFORE the needle does —
                pulling a needle out of a vein that is still congested is how
                a puncture site keeps bleeding under the gauze. Reaching
                across the patient for the tail is done with a needle still
                in their arm, so how steady the holder stayed is a real
                measurement, not a given.
     GAUZE      laid over the site BEFORE the needle moves, held OFF the skin
                — pressing down on a needle that is still in the vein drags
                the bevel through the wall it entered. Ready gauze is what
                makes "pressure within a second of withdrawal" possible.
     WITHDRAW   back out along the line it went in. The entry line was fixed
                when the skin was broken; leaving it sideways cuts the vein
                on the way out, and yanking it out fast is what tears the
                exit. Neither is a boolean — both are measured.
     SAFETY     the device's own mechanism, operated in the hand, at once.
                Striking it against the bench, recapping by hand, or laying
                an exposed used sharp down are the three classic needlestick
                stories, and each is recorded as itself.
     DISPOSE    straight into the sharps container, whole, without crossing
                back over the patient. A used sharp on the table is a major
                safety event however briefly it rested there.

   Pure maths. tests/withdrawal.spec.js asserts every threshold.
   ========================================================================= */

/* ---------- devices ----------------------------------------------------------- */

/** The two families this procedure covers. The safety action is device-specific. */
export const DEVICE = { STRAIGHT: "straight", BUTTERFLY: "butterfly" };

/**
 * What operating the safety mechanism physically is, per device. A straight
 * multi-sample needle carries a hinged/sliding shield that travels forward
 * over the shaft until it locks; a butterfly set retracts the needle back
 * into its own body by sliding the wings' slider along the tubing end.
 */
export function safetyActionFor(device){
  return device === DEVICE.BUTTERFLY
    ? { travel: "retract", grip: "slider",
        description: "Slide the safety slider forward until the needle retracts and clicks" }
    : { travel: "shield", grip: "shield",
        description: "Push the shield forward over the needle until it locks" };
}

/* ---------- thresholds ---------------------------------------------------------- */

/** Metres from the puncture site within which laid gauze counts as ready. */
export const GAUZE_READY_M = 0.020;
/** Beyond this the pad is somewhere on the arm, not over the site at all. */
export const GAUZE_FAR_M = 0.045;

/** Exit-path deviation from the entry line, degrees: above this it is a drag. */
export const EXIT_DEVIATION_WARN_DEG = 12;
/** Sideways excursion during withdrawal that means the tip sawed the wall. */
export const EXIT_LATERAL_WARN_M = 0.0030;
/** Peak outward speed along the line before it counts as a yank, m/s. */
export const EXIT_SPEED_WARN_MPS = 0.24;

/** Seconds between the needle leaving the skin and the safety locking. */
export const SAFETY_IMMEDIATE_S = 4;
/** Seconds between the safety locking and the sharp entering the container. */
export const DISPOSE_IMMEDIATE_S = 8;

/**
 * How far the tip may be jostled while the other hand reaches for the band,
 * judged against the vessel it is in — the same physics collection uses.
 */
export function reachToleranceM(vessel){
  if(!vessel) return 0.0016;
  return Math.max(0.0010, vessel.calibre*0.85);
}

/* ---------- judgement ------------------------------------------------------------ */

function issue(code, severity, message, data){
  return { code, severity, message, data: data == null ? null : data };
}

/**
 * @param {object} state  withdrawalState
 * @param {object} o
 *   tourniquetReleased  the band is actually off the arm
 *   tourniquetOn        still secured and counting
 *   tourniquetSeconds   the band's own clock, for the timing judgement
 *   collectionDone      every required tube is off and none is redrawable
 *   tubeOnHolder        a tube is still engaged on the holder right now
 */
export function evaluateWithdrawal(state, o){
  const opt = o || {};
  const issues = [];
  const withdrawn = state.withdrawnAt != null;
  const locked = state.safetyLockedAt != null;
  const disposed = state.disposedAt != null;

  /* --- the band ------------------------------------------------------------ */
  if(!opt.tourniquetReleased){
    if(withdrawn){
      issues.push(issue("withdrewUnderPressure", "block",
        "The needle came out with the band still on — the vein was still congested, and the site will keep bleeding under the gauze. The tourniquet comes off FIRST."));
    }else{
      issues.push(issue("bandStillOn", "note",
        "The band is still on. Pull its tail free before the needle comes out — a congested vein bleeds hard through a fresh puncture."));
    }
  }else{
    if(!state.collectionDoneAtRelease){
      issues.push(issue("releasedMidDraw", "warn",
        "The band came off while tubes were still to fill — the veins fall back and the rest of the draw slows or stops."));
    }
    if(!state.fistRelaxed){
      issues.push(issue("fistStillClenched", "warn",
        "The patient's hand is still clenched. Ask them to open it before the needle comes out — a working fist keeps the vein pressurised."));
    }
  }
  if(state.releaseShiftM > reachToleranceM(state.vessel)*0.55){
    issues.push(issue("disturbedReaching", "warn",
      `Reaching for the band moved the needle ${Math.round(state.releaseShiftM*1000*10)/10}mm in the vein. Steady the holder with the other hand while you pull the tail.`,
      { shiftM: state.releaseShiftM }));
  }

  /* --- the tube ------------------------------------------------------------ */
  if(opt.tubeOnHolder && !withdrawn){
    issues.push(issue("tubeStillOn", "block",
      "There is still a tube engaged on the holder — its vacuum is open onto the needle. Take it off before the needle moves."));
  }
  if(state.tubeOnAtWithdraw){
    issues.push(issue("withdrewWithTube", "block",
      "The needle came out with a tube still engaged — its vacuum pulled blood across the exit the whole way."));
  }

  /* --- gauze ---------------------------------------------------------------- */
  if(!withdrawn){
    if(!state.gauzeTakenAt){
      issues.push(issue("gauzeNotReady", "note",
        "Pick up the clean gauze and lay it just above the site, ready — pressure has to start the moment the needle is out."));
    }else if(state.gauzePlacedAt == null){
      issues.push(issue("gauzeNotPlaced", "note",
        "Bring the gauze to rest just above the puncture site — close enough to press the instant the needle is out."));
    }
  }
  if(state.gauzeTakenAt && !state.gauzeClean){
    issues.push(issue("gauzeUnsterile", "block",
      "That gauze is not clean — it is about to sit on a fresh puncture. Take a sterile pad."));
  }
  if(state.gauzePlacedAt != null && state.gauzeOffsetM > GAUZE_FAR_M){
    issues.push(issue("gauzeOffSite", "warn",
      `The pad is ${Math.round(state.gauzeOffsetM*1000)}mm from the puncture — too far to press the moment the needle is out.`,
      { offsetM: state.gauzeOffsetM }));
  }
  if(state.gauzePressedEarly){
    issues.push(issue("pressedTooSoon", "warn",
      "The gauze was pressed down while the needle was still in the vein — that drags the bevel through the wall on the way out. Rest it above the site; press AFTER."));
  }

  /* --- the withdrawal itself -------------------------------------------------- */
  if(withdrawn){
    if(state.exitDeviationDeg > EXIT_DEVIATION_WARN_DEG){
      issues.push(issue("exitOffLine", "warn",
        `The needle left at ${Math.round(state.exitDeviationDeg)}° off the line it entered on — that drags the shaft across the wall it came through.`,
        { deviationDeg: state.exitDeviationDeg }));
    }
    if(state.exitLateralM > EXIT_LATERAL_WARN_M){
      issues.push(issue("exitSawed", "warn",
        `The tip was levered ${Math.round(state.exitLateralM*1000*10)/10}mm sideways on the way out.`,
        { lateralM: state.exitLateralM }));
    }
    if(state.peakSpeedMps > EXIT_SPEED_WARN_MPS){
      issues.push(issue("yanked", "warn",
        "The needle was yanked rather than drawn — a fast exit tears the puncture instead of leaving a clean track."));
    }
  }

  /* --- the safety mechanism ---------------------------------------------------- */
  if(state.recapAttempted){
    issues.push(issue("recapAttempted", "block",
      "Never recap a used needle by hand — the cap is smaller than the wobble in anyone's aim. The device has its own mechanism."));
  }
  if(state.exposedSetDown){
    issues.push(issue("exposedSetDown", "block",
      "A used, exposed sharp was set down. It is nobody else's job to find it — the safety locks IN THE HAND, then the whole unit goes straight in the container."));
  }
  if(state.surfaceActivated){
    issues.push(issue("struckOnSurface", "block",
      "The safety was pressed against the bench — one slip and the bench is what the needle misses. It operates one-handed, in the air."));
  }
  if(withdrawn && !locked && !disposed){
    issues.push(issue("safetyNotEngaged", "note",
      safetyActionFor(state.device).description + " — now, before anything else."));
  }
  if(locked && state.withdrawnAt != null){
    const gap = (state.safetyLockedAt - state.withdrawnAt)/1000;
    if(gap > SAFETY_IMMEDIATE_S){
      issues.push(issue("safetyDelayed", "warn",
        `${Math.round(gap)}s passed with the used needle exposed before the safety went on. Immediately means immediately.`,
        { seconds: gap }));
    }
  }
  if(locked && !state.safetyFullTravel){
    issues.push(issue("safetyPartial", "warn",
      "The mechanism was not carried through its full travel — a shield that has not clicked is a shield that slides back."));
  }

  /* --- disposal ------------------------------------------------------------------ */
  if(state.trashAttempts > 0){
    issues.push(issue("trashAttempted", "block",
      "A needle in normal waste finds a hand further down the line — housekeeping's, usually. Sharps go in the sharps container, nothing else."));
  }
  if(disposed && !state.safetyEngagedAtDispose){
    issues.push(issue("disposedExposed", "block",
      "The unit went into the container with the safety never engaged — every centimetre of that carry was an exposed used sharp in a moving hand."));
  }
  if(disposed && state.crossedPatient){
    issues.push(issue("crossedPatient", "warn",
      "The used sharp was carried back across the patient on its way to the container. Route around them, not over them."));
  }
  if(disposed && !state.disposedFully){
    issues.push(issue("notFullyIn", "warn",
      "The device is resting in the aperture rather than inside the container. It goes all the way in."));
  }
  if(disposed && state.safetyLockedAt != null){
    const gap = (state.disposedAt - state.safetyLockedAt)/1000;
    if(gap > DISPOSE_IMMEDIATE_S){
      issues.push(issue("disposeDelayed", "warn",
        `${Math.round(gap)}s passed between the safety locking and the sharp reaching the container.`,
        { seconds: gap }));
    }
  }
  if(state.setDownAfterSafety){
    issues.push(issue("shieldedSetDown", "warn",
      "The shielded unit was set down instead of going straight in — a parked sharp is a sharp someone has to pick up twice."));
  }
  if(!disposed && locked && !state.binAvailable){
    issues.push(issue("noBinInReach", "warn",
      "No working sharps container is within reach — that placement decision was made back at the supply cart, and this is where it bites."));
  }

  const order = ["block", "warn", "note"];
  issues.sort((a, b)=>order.indexOf(a.severity) - order.indexOf(b.severity));
  const blocking = issues.filter(i => i.severity === "block");

  return {
    ready: !!(opt.tourniquetReleased && withdrawn && locked && disposed
      && state.disposedFully && blocking.length === 0),
    issues, blocking,
    withdrawn, locked, disposed,
  };
}

/**
 * When each STEP of the sequence is finished — the four procedure ids share
 * this one module exactly as fill/switch share collection, and they differ
 * only in what "done" means. The RULES above stay the same throughout.
 */
export function modeReady(state, o, mode){
  const opt = o || {};
  switch(mode){
    case "release": return !!opt.tourniquetReleased;
    case "withdraw": return state.withdrawnAt != null;
    case "safety": return state.safetyLockedAt != null;
    case "dispose": return state.disposedAt != null && !!state.disposedFully;
    default: return false;
  }
}

export function nextIssue(result){ return result && result.issues.length ? result.issues[0] : null; }

export function nextAction(state, o, mode){
  const opt = o || {};
  if(mode === "release"){
    if(opt.tourniquetReleased) return "The band is off. The needle comes out next.";
    if(!state.fistRelaxed) return "Ask the patient to open their hand, then pull the band's tail free.";
    return "Pull the band's tail free — steady the holder with your other hand.";
  }
  if(mode === "withdraw"){
    if(state.withdrawnAt != null) return "The needle is out. The safety goes on now.";
    if(!state.gauzeTakenAt) return "Pick up the clean gauze first.";
    if(state.gauzePlacedAt == null) return "Rest the gauze just above the site — don't press down yet.";
    return "Draw the needle back out along the line it went in — smooth and unhurried.";
  }
  if(mode === "safety"){
    if(state.safetyLockedAt != null) return "Locked. Straight into the sharps container.";
    return safetyActionFor(state.device).description + ".";
  }
  if(mode === "dispose"){
    if(state.disposedAt != null && state.disposedFully) return "Disposed at point of use. Pressure on the site comes next.";
    return "Carry the whole unit to the sharps container and drop it in — don't cross back over the patient.";
  }
  return "";
}
