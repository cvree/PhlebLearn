/* =========================================================================
   WITHDRAW, SAFETY AND SHARPS STATE — what the hands actually did at the end
   of the draw: when the band came off and how steady the needle stayed while
   the other hand reached for it, where the gauze was resting when the needle
   moved, the path the needle actually left along, how the device's safety
   was operated, and where the sharp physically went.

   Carried on the encounter. The needle is the same unit assembly threaded,
   the entry line is the one insert fixed when the skin was broken, and the
   band is the same strap the tourniquet step put on — nothing here is a
   fresh object.

   Every field is something the learner physically did, recorded as a
   measurement. withdrawalRules.js does the judging. Pure data — no THREE,
   no DOM.
   ========================================================================= */
import { DEVICE, GAUZE_READY_M } from "./withdrawalRules.js";

/**
 * @param {object} o
 *   device        DEVICE.STRAIGHT | DEVICE.BUTTERFLY — decides the safety action
 *   angleDeg      the locked entry angle, from the insert state
 *   depthM        how deep the tip is right now (insert depth ± collection shift)
 *   depthDir      which way along the arm the tip was travelling, +1 proximal
 *   entryX,entryZ where the skin was broken, arm-local metres
 *   vessel        {id, calibre, depth} — displacement is judged against it
 *   inVein        whether there is anything to protect — a missed stick still
 *                 has to come out safely
 *   gauze         { itemId, clean } — the pad actually staged in phase 1
 *   bin           { itemId, available } — the sharps container staged in reach
 */
export function createWithdrawalState(o){
  const opt = o || {};
  return {
    device: opt.device === DEVICE.BUTTERFLY ? DEVICE.BUTTERFLY : DEVICE.STRAIGHT,
    angleDeg: opt.angleDeg == null ? 20 : opt.angleDeg,
    depthDir: opt.depthDir == null ? 1 : (opt.depthDir < 0 ? -1 : 1),
    entryX: opt.entryX == null ? 0 : opt.entryX,
    entryZ: opt.entryZ == null ? 0 : opt.entryZ,
    vessel: opt.vessel ? { id: opt.vessel.id, calibre: opt.vessel.calibre, depth: opt.vessel.depth } : null,
    inVein: opt.inVein !== false,

    /** metres of tip still below the skin — withdrawal is finished at 0 */
    depthM: Math.max(0.0005, opt.depthM == null ? 0.006 : opt.depthM),
    startDepthM: Math.max(0.0005, opt.depthM == null ? 0.006 : opt.depthM),

    /* --- the band coming off ------------------------------------------------ */
    fistRelaxed: false,
    fistRelaxedAt: null,
    /** stamped when the band is pulled free; the tourniquetState is the clock */
    releasedAt: null,
    releasedByTail: false,
    collectionDoneAtRelease: false,
    tourniquetSecondsAtRelease: null,
    /** worst tip displacement while the free hand reached for the tail */
    releaseShiftM: 0,

    /* --- gauze -------------------------------------------------------------- */
    gauzeItemId: opt.gauze ? (opt.gauze.itemId || null) : null,
    gauzeClean: opt.gauze ? opt.gauze.clean !== false : true,
    gauzeTakenAt: null,
    /** metres from the puncture site where the pad is resting; null = not placed */
    gauzeOffsetM: null,
    gauzePlacedAt: null,
    /** downward pressure applied while the needle was still in the patient */
    gauzePressedEarly: false,

    /* --- the withdrawal ------------------------------------------------------ */
    withdrawBeganAt: null,
    withdrawnAt: null,
    /** signed outward travel along the entry line, metres, this far */
    exitAxialM: 0,
    /** accumulated |sideways| travel while the tip was in tissue */
    exitLateralTravelM: 0,
    /** the worst sideways excursion level reached */
    exitLateralM: 0,
    /** the previous sample's sideways offset, so travel is a difference */
    lastLateralM: null,
    /** exit path deviation from the entry line, degrees, derived as it goes */
    exitDeviationDeg: 0,
    /** the fastest the tip moved outward along the line, m/s */
    peakSpeedMps: 0,
    /** total in-tissue travel — sawing shows up as more travel than depth */
    tipTravelM: 0,
    /** context stamped at the moment the tip left the skin */
    tubeOnAtWithdraw: false,
    tourniquetOnAtWithdraw: false,
    gauzeReadyAtWithdraw: false,

    /* --- the safety mechanism ------------------------------------------------- */
    /** 0..1 travel of the device's own mechanism */
    safetyTravel: 0,
    safetyStartedAt: null,
    safetyLockedAt: null,
    safetyFullTravel: false,
    /** the three classic stories, each recorded as itself */
    surfaceActivated: false,
    recapAttempted: false,
    exposedSetDown: false,

    /* --- disposal --------------------------------------------------------------- */
    binItemId: opt.bin ? (opt.bin.itemId || null) : null,
    binAvailable: opt.bin ? opt.bin.available !== false : false,
    disposedAt: null,
    disposedFully: false,
    safetyEngagedAtDispose: false,
    crossedPatient: false,
    trashAttempts: 0,
    setDownAfterSafety: false,

    startedAt: opt.now == null ? Date.now() : opt.now,
    events: [],
  };
}

export function recordEvent(state, type, data){
  state.events.push({ t: Date.now(), type, data: data == null ? null : data });
  if(state.events.length > 200) state.events.shift();
  return state;
}

/* =========================================================================
   WHOLE TECHNIQUES, AS PURE STATE CHANGES

   Shared by the gestures, the accessible controls and the tests, so all
   three produce identical measurements. The controls path tears the 3D scene
   down, so it cannot go through the runtime — but it must not get an easier
   or different rule set either.
   ========================================================================= */

/* ---------- the band ------------------------------------------------------------- */

/** "You can open your hand now" — spoken to the patient, before the release. */
export function relaxFist(state, now){
  if(state.fistRelaxed) return state;
  state.fistRelaxed = true;
  state.fistRelaxedAt = now == null ? Date.now() : now;
  recordEvent(state, "fistRelaxed", null);
  return state;
}

/**
 * The free hand is over near the band while the needle hand holds still —
 * or fails to. The runtime feeds in how far the tip was actually jostled;
 * the level (not a running sum) is kept, exactly as collection judges a
 * lever, so a wobbly reach cannot accumulate a shift the hand never made.
 */
export function reachDisturbance(state, shiftM){
  if(state.releasedAt != null || state.withdrawnAt != null) return state;
  const s = Math.abs(shiftM || 0);
  if(s > state.releaseShiftM) state.releaseShiftM = s;
  return state;
}

/**
 * The band pulled free by its tail. The tourniquetState itself is released by
 * the caller (both input paths do it through tourniquetState.markReleased on
 * the SAME strap object) — this records what the release meant for THIS step:
 * when it happened relative to the withdrawal, and what was true at the time.
 */
export function markBandReleased(state, o){
  const opt = o || {};
  if(state.releasedAt != null) return state;
  state.releasedAt = opt.at == null ? Date.now() : opt.at;
  state.releasedByTail = opt.byTail !== false;
  state.collectionDoneAtRelease = !!opt.collectionDone;
  state.tourniquetSecondsAtRelease = opt.tourniquetSeconds == null ? null : opt.tourniquetSeconds;
  recordEvent(state, "bandReleased", {
    byTail: state.releasedByTail,
    seconds: state.tourniquetSecondsAtRelease,
    collectionDone: state.collectionDoneAtRelease,
  });
  return state;
}

/* ---------- gauze ------------------------------------------------------------------ */

/** Picks the pad up. Whether it is the CLEAN one was decided at the cart. */
export function takeGauze(state, o){
  const opt = o || {};
  if(state.gauzeTakenAt != null) return state;
  state.gauzeTakenAt = opt.at == null ? Date.now() : opt.at;
  if(opt.itemId !== undefined) state.gauzeItemId = opt.itemId;
  if(opt.clean !== undefined) state.gauzeClean = opt.clean !== false;
  recordEvent(state, "gauzeTaken", { itemId: state.gauzeItemId, clean: state.gauzeClean });
  return state;
}

/**
 * Rests the pad near the site — or presses it down. Pressing while the
 * needle is still in the patient is its own recorded mistake; the offset is
 * a real distance from the puncture, and it can be re-placed until the
 * needle moves.
 */
export function placeGauze(state, o){
  const opt = o || {};
  if(state.gauzeTakenAt == null) return state;
  state.gauzeOffsetM = Math.abs(opt.offsetM || 0);
  if(state.gauzePlacedAt == null) state.gauzePlacedAt = opt.at == null ? Date.now() : opt.at;
  if(opt.pressing && state.depthM > 0 && state.withdrawnAt == null){
    if(!state.gauzePressedEarly){
      state.gauzePressedEarly = true;
      recordEvent(state, "pressedEarly", null);
    }
  }
  recordEvent(state, "gauzePlaced", { offsetM: state.gauzeOffsetM, pressing: !!opt.pressing });
  return state;
}

/** Whether the pad is resting close enough to press the moment the tip is out. */
export function gauzeReady(state){
  return state.gauzeTakenAt != null && state.gauzePlacedAt != null
    && state.gauzeOffsetM != null && state.gauzeOffsetM <= GAUZE_READY_M;
}

/* ---------- the withdrawal ----------------------------------------------------------- */

export function beginWithdraw(state, now){
  if(state.withdrawBeganAt == null) state.withdrawBeganAt = now == null ? Date.now() : now;
  return state;
}

/**
 * One moment of the needle moving along (and off) its own entry line.
 *
 * @param {number} dAxialM         metres travelled along the line, +ve OUTWARD
 * @param {number} lateralOffsetM  the hand's CURRENT sideways offset from the
 *                                 line — a level, not a delta, same as collection
 * @param {number} dtS             seconds since the previous sample
 * @param {object} [ctx]           {tubeOn, tourniquetOn} — what is true right now,
 *                                 stamped onto the state at the moment of exit
 */
export function sampleWithdraw(state, dAxialM, lateralOffsetM, dtS, ctx, now){
  if(state.withdrawnAt != null || state.depthM <= 0) return state;
  beginWithdraw(state, now);

  const dAxial = dAxialM || 0;
  const lat = Math.abs(lateralOffsetM || 0);

  // outward travel along the line shallows the tip by the entry angle's own
  // trigonometry — the same conversion insert used going the other way
  const sin = Math.sin(Math.max(1, state.angleDeg)*Math.PI/180);
  const before = state.depthM;
  state.depthM = Math.max(0, state.depthM - dAxial*sin);

  state.tipTravelM += Math.abs(dAxial);
  if(dAxial > 0) state.exitAxialM += dAxial;
  if(lat > state.exitLateralM) state.exitLateralM = lat;
  state.exitLateralTravelM += Math.abs(lat - (state.lastLateralM == null ? lat : state.lastLateralM));
  state.lastLateralM = lat;

  // the exit path's deviation from the entry line: how much of the leaving
  // motion was sideways, as an angle — never a boolean
  if(state.exitAxialM > 0.0015){
    state.exitDeviationDeg = Math.atan2(state.exitLateralM, state.exitAxialM)*180/Math.PI;
  }

  if(dtS > 0 && dAxial > 0){
    const speed = dAxial/dtS;
    if(speed > state.peakSpeedMps) state.peakSpeedMps = speed;
  }

  if(before > 0 && state.depthM <= 0){
    completeWithdraw(state, ctx, now);
  }
  return state;
}

/** The tip has left the skin. What was true at that instant is stamped here. */
function completeWithdraw(state, ctx, now){
  const c = ctx || {};
  state.depthM = 0;
  state.withdrawnAt = now == null ? Date.now() : now;
  state.tubeOnAtWithdraw = !!c.tubeOn;
  state.tourniquetOnAtWithdraw = !!c.tourniquetOn;
  state.gauzeReadyAtWithdraw = gauzeReady(state);
  recordEvent(state, "withdrawn", {
    deviationDeg: Math.round(state.exitDeviationDeg*10)/10,
    peakSpeedMps: Math.round(state.peakSpeedMps*100)/100,
    tourniquetOn: state.tourniquetOnAtWithdraw,
    gauzeReady: state.gauzeReadyAtWithdraw,
  });
  return state;
}

/**
 * One smooth, controlled withdrawal — for the accessible path and tests.
 * The same samples the drag produces, at the same conversion, so the same
 * measurements come out the other end.
 */
export function withdrawSmoothly(state, ctx, now){
  if(state.withdrawnAt != null) return state;
  const t0 = now == null ? Date.now() : now;
  beginWithdraw(state, t0);
  const sin = Math.sin(Math.max(1, state.angleDeg)*Math.PI/180);
  const lineLen = state.depthM/sin;
  const steps = 8;
  for(let i = 0; i < steps && state.withdrawnAt == null; i++){
    sampleWithdraw(state, lineLen/steps + 0.0002, 0, 0.09, ctx, t0 + (i + 1)*90);
  }
  return state;
}

/** The mistake version: one fast yank, off the line — also a real technique. */
export function withdrawRoughly(state, ctx, now){
  if(state.withdrawnAt != null) return state;
  const t0 = now == null ? Date.now() : now;
  beginWithdraw(state, t0);
  const sin = Math.sin(Math.max(1, state.angleDeg)*Math.PI/180);
  const lineLen = state.depthM/sin;
  sampleWithdraw(state, lineLen + 0.002, 0.004, 0.05, ctx, t0 + 50);
  return state;
}

/* ---------- the safety mechanism ------------------------------------------------------ */

/**
 * One moment of operating the device's own mechanism — the shield sliding
 * forward on a straight needle, the slider retracting a butterfly. Travel is
 * cumulative and clamps at the lock.
 *
 * @param {number} delta      fraction of the full travel moved this moment
 * @param {object} [o]        {surface:true} when the device is being pressed
 *                            against the bench instead of operated in the hand
 */
export function slideSafety(state, delta, o, now){
  const opt = o || {};
  if(state.withdrawnAt == null) return state;   // nothing to shield yet
  if(state.safetyLockedAt != null) return state;
  if(state.safetyStartedAt == null) state.safetyStartedAt = now == null ? Date.now() : now;
  if(opt.surface && !state.surfaceActivated){
    state.surfaceActivated = true;
    recordEvent(state, "surfaceActivation", null);
  }
  state.safetyTravel = Math.max(0, Math.min(1, state.safetyTravel + (delta || 0)));
  if(state.safetyTravel >= 1){
    state.safetyLockedAt = now == null ? Date.now() : now;
    state.safetyFullTravel = true;
    recordEvent(state, "safetyLocked", {
      sinceWithdrawS: Math.round((state.safetyLockedAt - state.withdrawnAt)/100)/10,
      surface: state.surfaceActivated,
    });
  }
  return state;
}

/** The whole activation, done properly in the hand — accessible path and tests. */
export function activateSafetyCleanly(state, now){
  return slideSafety(state, 1.001, null, now);
}

/** Trying to put the cap back on a used needle — recorded, never rewarded. */
export function attemptRecap(state){
  if(state.recapAttempted) return state;
  state.recapAttempted = true;
  recordEvent(state, "recapAttempted", null);
  return state;
}

/**
 * The unit put down somewhere that is not the sharps container. Which
 * mistake it is depends on whether the safety was locked first.
 */
export function setDownUnit(state, now){
  if(state.disposedAt != null) return state;
  if(state.safetyLockedAt == null){
    if(!state.exposedSetDown){
      state.exposedSetDown = true;
      recordEvent(state, "exposedSetDown", null);
    }
  }else if(!state.setDownAfterSafety){
    state.setDownAfterSafety = true;
    recordEvent(state, "shieldedSetDown", null);
  }
  return state;
}

/* ---------- disposal --------------------------------------------------------------------- */

/**
 * The unit physically arriving somewhere final.
 *
 * @param {object} o
 *   target          "sharps" | "trash" | "bench"
 *   fully           whether the whole device passed the aperture
 *   crossedPatient  whether the carry path went back over the patient
 */
export function disposeUnit(state, o, now){
  const opt = o || {};
  if(state.disposedAt != null) return state;
  const at = now == null ? Date.now() : now;

  if(opt.target === "trash"){
    state.trashAttempts += 1;
    recordEvent(state, "trashAttempted", null);
    return state;
  }
  if(opt.target !== "sharps"){
    return setDownUnit(state, at);
  }

  state.disposedAt = at;
  state.disposedFully = opt.fully !== false;
  state.safetyEngagedAtDispose = state.safetyLockedAt != null;
  if(opt.crossedPatient) state.crossedPatient = true;
  recordEvent(state, "disposed", {
    fully: state.disposedFully,
    safetyEngaged: state.safetyEngagedAtDispose,
    crossedPatient: state.crossedPatient,
  });
  return state;
}

/** Marks that the carry path went back over the patient — set live by either path. */
export function markCrossedPatient(state){
  if(state.disposedAt != null) return state;
  if(!state.crossedPatient){
    state.crossedPatient = true;
    recordEvent(state, "crossedPatient", null);
  }
  return state;
}

/* ---------- derived ------------------------------------------------------------------------ */

/** Seconds the used needle spent exposed after leaving the skin. */
export function exposedSeconds(state, now){
  if(state.withdrawnAt == null) return 0;
  const end = state.safetyLockedAt != null ? state.safetyLockedAt : (now == null ? Date.now() : now);
  return Math.max(0, (end - state.withdrawnAt)/1000);
}

/** Seconds between the safety locking and the sharp entering the container. */
export function disposalDelaySeconds(state, now){
  if(state.safetyLockedAt == null) return null;
  const end = state.disposedAt != null ? state.disposedAt : (now == null ? Date.now() : now);
  return Math.max(0, (end - state.safetyLockedAt)/1000);
}
