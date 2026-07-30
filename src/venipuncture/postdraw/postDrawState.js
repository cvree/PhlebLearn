/* =========================================================================
   PRESSURE AND BANDAGE STATE — how hard the pad was actually pressed, for how
   long, whether the arm was straight, how much blood went into the tissue
   while all that was happening, and where the dressing ended up.

   Carried on the encounter. The gauze is the pad the withdrawal step already
   put in the learner's hand, the puncture is the one the insert step made, and
   the clock starts from the moment that step's needle left the skin.

   Every field is something the learner physically did. postDrawRules.js does
   the judging. Pure data — no THREE, no DOM.
   ========================================================================= */
import {
  SITE_KIND, forceBandFor, holdSecondsFor, clotRatePerSecond,
  bleedRateMlPerS, REOPEN_LOSS, HAEMOSTASIS_AT, PAD_ON_SITE_M,
} from "./postDrawRules.js";

/**
 * @param {object} o
 *   siteKind          SITE_KIND.ANTECUBITAL | SITE_KIND.HAND
 *   vessel            {id, calibre, depth} — the vein that was punctured
 *   gauge             the needle they staged
 *   anticoagulated    explicit trigger data off the patient's own event
 *   withdrawnAt       when the needle left the skin, so time-to-pressure is real
 *   tourniquetOnAtWithdraw  a congested vein bleeds harder
 *   gauze             { itemId, clean } — the pad the withdrawal step used
 *   bandage           { itemId, clean } — the dressing staged in phase 1
 */
export function createPostDrawState(o){
  const opt = o || {};
  const siteKind = opt.siteKind === SITE_KIND.HAND ? SITE_KIND.HAND : SITE_KIND.ANTECUBITAL;
  return {
    siteKind,
    vessel: opt.vessel ? { id: opt.vessel.id, calibre: opt.vessel.calibre, depth: opt.vessel.depth } : null,
    gauge: opt.gauge == null ? 21 : opt.gauge,
    anticoagulated: !!opt.anticoagulated,
    tourniquetOnAtWithdraw: !!opt.tourniquetOnAtWithdraw,
    withdrawnAt: opt.withdrawnAt == null ? null : opt.withdrawnAt,

    gauzeItemId: opt.gauze ? (opt.gauze.itemId || null) : null,
    gauzeClean: opt.gauze ? opt.gauze.clean !== false : true,
    bandageItemId: opt.bandage ? (opt.bandage.itemId || null) : null,
    bandageClean: opt.bandage ? opt.bandage.clean !== false : true,

    /** seconds of adequate pressure this puncture needs, from its own geometry */
    holdSeconds: holdSecondsFor({
      anticoagulated: !!opt.anticoagulated, vessel: opt.vessel, gauge: opt.gauge,
    }),

    /* --- pressure, live ------------------------------------------------------ */
    /** 0..1 right now */
    force: 0,
    peakForce: 0,
    /** the pad is somewhere other than on the puncture */
    padOffSite: false,
    padOffsetM: null,

    pressureStartedAt: null,
    timeToPressureS: null,
    /** seconds the pad has been held at ANY force */
    heldSeconds: 0,
    /** seconds it has been held at an ADEQUATE force — the ones that count */
    effectiveSeconds: 0,
    /** every force sample while pressing, for the consistency measurement */
    forceSamples: [],
    /** seconds spent above the discomfort threshold */
    discomfortSeconds: 0,

    /* --- the arm ------------------------------------------------------------- */
    armFlexed: false,
    armFlexedSeconds: 0,

    /* --- haemostasis --------------------------------------------------------- */
    /** 0..1; 1 is a clot that will hold on its own */
    clotProgress: 0,
    /** taking the pad off before that costs some of it */
    releasedEarlyCount: 0,
    /** millilitres that leaked into the tissue while uncovered or under-pressed */
    extravasatedMl: 0,

    /* --- the check ----------------------------------------------------------- */
    checkedAt: null,
    checkCount: 0,
    bleedingAtCheck: false,

    /* --- the dressing -------------------------------------------------------- */
    bandagedAt: null,
    bandageAlignM: 0,
    bandageTightness: 0,
    bandagedWhileBleeding: false,
    gauzeShifted: false,
    bandageAttempts: 0,
    aftercareGiven: false,

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

   Shared by the gestures, the accessible controls and the tests, so all three
   produce identical forces, seconds and volumes. The controls path tears the
   3D scene down, so it cannot go through the runtime — but it must not get an
   easier or different rule set either.
   ========================================================================= */

/* ---------- pressure -------------------------------------------------------------- */

/**
 * One moment of holding the pad against the site.
 *
 * @param {number} force      0..1 — how hard, right now
 * @param {number} offsetM    metres from the puncture the pad is centred
 * @param {number} dtS        seconds since the previous sample
 */
export function pressSample(state, force, offsetM, dtS, now){
  const f = Math.max(0, Math.min(1, force || 0));
  const dt = Math.max(0, dtS || 0);
  const off = offsetM == null ? 0 : Math.abs(offsetM);
  const band = forceBandFor(state.siteKind);
  const t = now == null ? Date.now() : now;

  state.padOffsetM = off;
  state.padOffSite = off > PAD_ON_SITE_M;

  // pressure beside a puncture is not pressure on it
  const effectiveForce = state.padOffSite ? 0 : f;
  state.force = effectiveForce;
  if(effectiveForce > state.peakForce) state.peakForce = effectiveForce;

  if(effectiveForce > 0.02){
    if(state.pressureStartedAt == null){
      state.pressureStartedAt = t;
      state.timeToPressureS = state.withdrawnAt == null
        ? 0 : Math.max(0, (t - state.withdrawnAt)/1000);
      recordEvent(state, "pressureStarted", { afterS: state.timeToPressureS });
    }
    state.heldSeconds += dt;
    state.forceSamples.push(Math.round(effectiveForce*100)/100);
    if(state.forceSamples.length > 400) state.forceSamples.shift();
    if(effectiveForce > band.discomfort) state.discomfortSeconds += dt;
  }

  if(state.armFlexed) state.armFlexedSeconds += dt;

  // The clot only progresses under adequate force — and a flexed elbow means
  // the fascia is taking it, so it does not progress at all either.
  const adequate = effectiveForce >= band.min && !state.armFlexed;
  if(adequate){
    state.effectiveSeconds += dt;
    state.clotProgress = Math.min(1, state.clotProgress
      + clotRatePerSecond(effectiveForce, state.siteKind, state.holdSeconds)*dt);
  }

  // Uncovered or under-pressed, the puncture is still leaking into the tissue.
  if(state.clotProgress < HAEMOSTASIS_AT && !adequate){
    state.extravasatedMl += bleedRateMlPerS({
      vessel: state.vessel,
      anticoagulated: state.anticoagulated,
      tourniquetOnAtWithdraw: state.tourniquetOnAtWithdraw,
      armFlexed: state.armFlexed,
    })*dt;
  }
  return state;
}

/**
 * The pad comes off the site. Before the clot is holding, that costs some of
 * the progress made — not all of it, but enough that peeking repeatedly is
 * slower than simply holding on.
 */
export function releasePressure(state, now){
  const wasPressing = state.force > 0.02;
  state.force = 0;
  if(!wasPressing) return state;
  if(state.clotProgress < HAEMOSTASIS_AT){
    state.releasedEarlyCount += 1;
    state.clotProgress = Math.max(0, state.clotProgress - REOPEN_LOSS);
    recordEvent(state, "releasedEarly", { clotProgress: state.clotProgress });
  }
  return state;
}

/** Holds adequate pressure for real seconds — accessible path and tests. */
export function holdPressureFor(state, seconds, o){
  const opt = o || {};
  const band = forceBandFor(state.siteKind);
  const force = opt.force == null ? band.ideal : opt.force;
  const step = 0.1;
  let t = opt.now == null ? Date.now() : opt.now;
  for(let s = 0; s < (seconds || 0); s += step){
    pressSample(state, force, opt.offsetM == null ? 0.004 : opt.offsetM, step, t);
    t += step*1000;
  }
  return state;
}

/* ---------- the patient's arm ------------------------------------------------------ */

/**
 * Bending the elbow up over the site. It is what patients do unprompted and
 * what a lot of learners suggest, and it holds the puncture open.
 */
export function flexArm(state, on){
  const want = !!on;
  if(state.armFlexed === want) return state;
  state.armFlexed = want;
  recordEvent(state, want ? "armFlexed" : "armStraightened", null);
  return state;
}

/* ---------- the check ------------------------------------------------------------- */

/**
 * Lifting the gauze and looking. What is seen is whatever is actually true —
 * this does not decide it, it reports it — and looking before the clot holds
 * both shows blood AND costs progress, because the pad came off to do it.
 */
export function checkSite(state, now){
  const t = now == null ? Date.now() : now;
  const holding = state.clotProgress >= HAEMOSTASIS_AT;
  if(!holding) releasePressure(state, t);
  else state.force = 0;
  state.checkedAt = t;
  state.checkCount += 1;
  state.bleedingAtCheck = !holding;
  recordEvent(state, "checked", { bleeding: state.bleedingAtCheck });
  return state;
}

/* ---------- the dressing ---------------------------------------------------------- */

/**
 * The dressing going on.
 *
 * @param {object} o
 *   alignM     metres from the puncture the dressing's pad is centred
 *   tightness  0..1 — how hard the ends were pulled down
 *   shifted    whether the gauze slid off the puncture as it went on
 */
export function applyBandage(state, o, now){
  const opt = o || {};
  const t = now == null ? Date.now() : now;
  state.bandageAttempts += 1;
  state.bandagedAt = t;
  state.bandageAlignM = Math.abs(opt.alignM == null ? 0 : opt.alignM);
  state.bandageTightness = Math.max(0, Math.min(1, opt.tightness == null ? 0.45 : opt.tightness));
  state.gauzeShifted = !!opt.shifted;
  // Whether it went on over a bleeding puncture is not a judgement made here,
  // it is simply what was true at the moment it was applied.
  state.bandagedWhileBleeding = state.clotProgress < HAEMOSTASIS_AT;
  recordEvent(state, "bandaged", {
    alignM: state.bandageAlignM,
    tightness: state.bandageTightness,
    bleeding: state.bandagedWhileBleeding,
  });
  return state;
}

/** Taking a badly applied dressing off again — the recovery, and it is counted. */
export function removeBandage(state){
  if(state.bandagedAt == null) return state;
  state.bandagedAt = null;
  state.bandageTightness = 0;
  state.bandageAlignM = 0;
  state.bandagedWhileBleeding = false;
  state.gauzeShifted = false;
  recordEvent(state, "bandageRemoved", null);
  return state;
}

/** "Keep it on about fifteen minutes; tell us about swelling or numbness." */
export function giveAftercare(state){
  if(state.aftercareGiven) return state;
  state.aftercareGiven = true;
  recordEvent(state, "aftercare", null);
  return state;
}

/* ---------- derived ---------------------------------------------------------------- */

/**
 * How steady the pressure was, 0..1, as 1 minus the coefficient of variation
 * of the samples. A hand that wanders between barely-on and grinding is a
 * different technique from one that holds still, even if the mean matches.
 */
export function pressureConsistency(state){
  const n = state.forceSamples.length;
  if(n < 3) return 1;
  const mean = state.forceSamples.reduce((a, b)=>a + b, 0)/n;
  if(mean <= 0) return 0;
  const varsum = state.forceSamples.reduce((a, b)=>a + (b - mean)*(b - mean), 0)/n;
  return Math.max(0, Math.min(1, 1 - Math.sqrt(varsum)/mean));
}

export function meanForce(state){
  const n = state.forceSamples.length;
  if(!n) return 0;
  return state.forceSamples.reduce((a, b)=>a + b, 0)/n;
}

/** Seconds of adequate pressure still owed before the clot will hold. */
export function secondsRemaining(state){
  return Math.max(0, state.holdSeconds*(1 - state.clotProgress));
}
