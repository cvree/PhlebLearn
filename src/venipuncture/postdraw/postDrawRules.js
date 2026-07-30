/* =========================================================================
   PRESSURE AND BANDAGE — the rules.

   The old two steps were a "hold to apply pressure" button wired to a 1.2s
   timer, and an "Apply bandage" button. Between them they modelled none of
   what actually decides whether a patient leaves with a clean puncture or a
   bruise the size of a plum:

     FORCE      pressure is a MAGNITUDE, not a duration. Too light and the
                vein keeps leaking under the pad while the clock runs — the
                learner is holding a dressing on, not stopping a bleed. Too
                hard and it hurts, and on the dorsal hand it hurts a lot,
                because there is nothing between the vein and the bone.
     DIRECTION  it has to be straight down onto the puncture. A pad resting
                beside the site does nothing at all.
     TIME       haemostasis is a real process. The clot forms while adequate
                pressure holds and it is NOT finished when the bleeding
                merely looks stopped — lift too early and it reopens.
     POSITION   a flexed elbow is the classic. It feels like it helps, it is
                what patients do by themselves, and it holds the puncture
                open while the fascia takes the pressure instead of the vein.
     OBSERVE    "is it still bleeding" is a question you answer by lifting
                the gauze and LOOKING, not by assuming. That check is the
                only honest way to know a bandage is safe to apply.
     BANDAGE    over the puncture, not near it; firm enough to stay, not
                tight enough to be a tourniquet.

   Pure maths. tests/postdraw.spec.js asserts every threshold.
   ========================================================================= */

/* ---------- sites ------------------------------------------------------------- */

/**
 * The two procedures this covers. They are NOT the same dressing job: a
 * dorsal hand vein is superficial with bone directly beneath it, so the same
 * force that is right for the antecubital fossa is painful there, and the
 * whole hand has to be supported rather than pressed against.
 */
export const SITE_KIND = { ANTECUBITAL: "antecubital", HAND: "hand" };

/* ---------- pressure force ---------------------------------------------------- */

/**
 * The adequacy band, as a fraction of full force.
 *
 * Below `min` the vein is not actually occluded and the clot never forms,
 * however long the pad is held. Above `discomfort` it hurts. Configurable per
 * site because the tissue underneath genuinely differs.
 */
export const FORCE_BAND = {
  [SITE_KIND.ANTECUBITAL]: { min: 0.42, ideal: 0.62, discomfort: 0.88 },
  [SITE_KIND.HAND]:        { min: 0.34, ideal: 0.50, discomfort: 0.68 },
};

export function forceBandFor(siteKind){
  return FORCE_BAND[siteKind] || FORCE_BAND[SITE_KIND.ANTECUBITAL];
}

/** Metres from the puncture within which the pad is actually ON the site. */
export const PAD_ON_SITE_M = 0.014;

/* ---------- haemostasis ------------------------------------------------------- */

/**
 * Seconds of ADEQUATE pressure a normal puncture needs before the clot will
 * hold on its own. A patient on anticoagulants needs materially longer, which
 * is the entire clinical point of asking.
 */
export const HOLD_SECONDS = 30;
export const HOLD_SECONDS_ANTICOAGULATED = 55;

export function holdSecondsFor(o){
  const opt = o || {};
  const base = opt.anticoagulated ? HOLD_SECONDS_ANTICOAGULATED : HOLD_SECONDS;
  // a bigger vein and a wider needle leave a bigger hole
  const calibre = opt.vessel ? Math.max(0.0008, opt.vessel.calibre) : 0.0032;
  const gaugeFactor = (opt.gauge == null ? 21 : opt.gauge) <= 21 ? 1.08 : 0.94;
  return base*Math.min(1.35, Math.max(0.8, calibre/0.0032))*gaugeFactor;
}

/**
 * How fast the clot progresses this instant, as a fraction of the hold per
 * second. Adequate force progresses it; too little does nothing at all
 * (the point being that a light pad is not slow progress, it is no progress);
 * excessive force does not speed it up, because the vein is already occluded.
 */
export function clotRatePerSecond(force, siteKind, holdSeconds){
  const band = forceBandFor(siteKind);
  if(force < band.min) return 0;
  return 1/Math.max(1, holdSeconds);
}

/**
 * How much of the clot's progress a premature release undoes.
 *
 * Not all of it — the platelets that are there are there — but enough that
 * repeatedly peeking costs real time, which is exactly the lesson.
 */
export const REOPEN_LOSS = 0.35;

/** Below this the puncture is still open enough to bleed when uncovered. */
export const HAEMOSTASIS_AT = 1;

/* ---------- bleeding and its consequence -------------------------------------- */

/**
 * Millilitres per second out of an uncovered fresh puncture. Small numbers —
 * this is oozing, not haemorrhage — but it accumulates into a visible bruise.
 */
export function bleedRateMlPerS(o){
  const opt = o || {};
  const calibre = opt.vessel ? Math.max(0.0008, opt.vessel.calibre) : 0.0032;
  const base = 0.022*Math.pow(calibre/0.0032, 2);
  return base
    * (opt.anticoagulated ? 2.4 : 1)
    // a band left on through the withdrawal leaves the vein congested
    * (opt.tourniquetOnAtWithdraw ? 1.6 : 1)
    // a flexed elbow holds the puncture open and does not compress the vein
    * (opt.armFlexed ? 1.45 : 1);
}

/**
 * Millilitres of extravasated blood at which the bruise is visible, and at
 * which it is a genuine hematoma the patient will complain about.
 */
export const BRUISE_ML = 0.35;
export const HEMATOMA_ML = 1.1;

export function hematomaGrade(ml){
  if(ml >= HEMATOMA_ML) return "hematoma";
  if(ml >= BRUISE_ML) return "bruise";
  return "none";
}

/* ---------- time to pressure --------------------------------------------------- */

/** Seconds after the needle is out within which pressure should have started. */
export const TIME_TO_PRESSURE_GOOD = 2;
export const TIME_TO_PRESSURE_WARN = 5;

/* ---------- bandage ------------------------------------------------------------ */

/** Metres of misalignment from the puncture before the dressing misses it. */
export const BANDAGE_ALIGN_GOOD = 0.006;
export const BANDAGE_ALIGN_WARN = 0.014;

/** Above this the dressing is acting as a tourniquet. */
export const BANDAGE_TIGHT_WARN = 0.72;
export const BANDAGE_TIGHT_BLOCK = 0.88;
/** Below this it will not stay on. */
export const BANDAGE_LOOSE = 0.20;

/* ---------- judgement ----------------------------------------------------------- */

function issue(code, severity, message, data){
  return { code, severity, message, data: data == null ? null : data };
}

function round(v, dp){ const m = Math.pow(10, dp || 0); return Math.round(v*m)/m; }

/**
 * @param {object} state  postDrawState
 * @param {object} [o]    { now }
 */
export function evaluatePostDraw(state, o){
  const opt = o || {};
  const issues = [];
  const band = forceBandFor(state.siteKind);
  const haemostatic = state.clotProgress >= HAEMOSTASIS_AT;
  const grade = hematomaGrade(state.extravasatedMl);

  /* --- getting onto the site at all ------------------------------------------ */
  if(state.pressureStartedAt == null){
    issues.push(issue("noPressureYet", "note",
      "Press the gauze straight down onto the puncture — firmly, and start now: every second uncovered is blood going into the tissue."));
  }else if(state.timeToPressureS > TIME_TO_PRESSURE_WARN){
    issues.push(issue("slowToPressure", "warn",
      `Pressure started ${round(state.timeToPressureS, 1)}s after the needle came out. It wants to be within ${TIME_TO_PRESSURE_GOOD}s — that gap is what a bruise is made of.`,
      { seconds: state.timeToPressureS }));
  }else if(state.timeToPressureS > TIME_TO_PRESSURE_GOOD){
    issues.push(issue("timeToPressure", "note",
      `Pressure started ${round(state.timeToPressureS, 1)}s after withdrawal.`,
      { seconds: state.timeToPressureS }));
  }

  if(state.padOffSite){
    issues.push(issue("padOffSite", "block",
      "The pad is not over the puncture. Pressure beside a puncture does nothing at all — it has to be straight down on it."));
  }

  /* --- force ------------------------------------------------------------------- */
  if(state.pressureStartedAt != null && !haemostatic){
    if(state.force > 0 && state.force < band.min){
      issues.push(issue("tooLight", "warn",
        "That is resting the gauze on, not pressing. Under this much force the vein is not closed, so the clock is running without anything actually happening.",
        { force: state.force, needed: band.min }));
    }
    if(state.force > band.discomfort){
      issues.push(issue("tooHard", "warn",
        state.siteKind === SITE_KIND.HAND
          ? "That is too hard for the back of a hand — there is nothing under that vein but bone, and it hurts. Ease off; firm is enough."
          : "That is harder than it needs to be, and the patient can feel it. Firm and steady stops a bleed; grinding does not stop it faster.",
        { force: state.force }));
    }
  }
  if(state.discomfortSeconds > 3){
    issues.push(issue("hurtingPatient", "warn",
      `The patient has been wincing for ${round(state.discomfortSeconds, 0)}s. Pressure should be firm, not painful.`));
  }

  /* --- position ---------------------------------------------------------------- */
  if(state.armFlexed){
    issues.push(issue("armFlexed", "warn",
      "Bending the elbow up over the site is the thing everyone does and it does not work: the flexed fascia takes the pressure instead of the vein, and the puncture stays open underneath. Keep the arm straight and press."));
  }

  /* --- the clock and the peeking ------------------------------------------------ */
  if(state.pressureStartedAt != null && !haemostatic && state.releasedEarlyCount > 0){
    issues.push(issue("releasedEarly", "warn",
      `The pad has come off ${state.releasedEarlyCount} time(s) before the clot was holding, and each time cost some of the progress. Hold it, then check once.`,
      { count: state.releasedEarlyCount }));
  }

  /* --- what the site is actually doing ------------------------------------------ */
  if(state.checkedAt == null && haemostatic){
    issues.push(issue("notChecked", "note",
      "Lift the gauze and look at the site before you dress it — that is the only way you actually know it has stopped."));
  }
  if(state.checkedAt != null && state.bleedingAtCheck){
    issues.push(issue("stillBleeding", "warn",
      "It was still bleeding when you looked. Back on with the pressure — that is what the check is for."));
  }
  if(grade === "hematoma"){
    issues.push(issue("hematoma", "block",
      `A hematoma has formed — ${round(state.extravasatedMl, 1)}mL into the tissue. The patient needs to be told, the site needs elevation and this needs documenting.`,
      { ml: state.extravasatedMl }));
  }else if(grade === "bruise"){
    issues.push(issue("bruising", "warn",
      "The site has bruised. That is blood that leaked while it was uncovered or under-pressed.",
      { ml: state.extravasatedMl }));
  }

  /* --- the bandage -------------------------------------------------------------- */
  if(state.bandagedAt != null){
    if(!state.bandageClean){
      issues.push(issue("bandageUnsterile", "block",
        "That dressing is not clean and it is going onto an open puncture."));
    }
    if(state.bandagedWhileBleeding){
      issues.push(issue("bandagedBleeding", "block",
        "The dressing went on over a site that was still bleeding. It will soak through, and the bleeding carries on underneath where nobody is watching it."));
    }
    if(state.bandageAlignM > BANDAGE_ALIGN_WARN){
      issues.push(issue("bandageOffSite", "warn",
        `The dressing is ${Math.round(state.bandageAlignM*1000)}mm off the puncture — the pad is not over the hole it is meant to cover.`,
        { offsetM: state.bandageAlignM }));
    }
    if(state.bandageTightness >= BANDAGE_TIGHT_BLOCK){
      issues.push(issue("bandageTourniquet", "block",
        "That is tight enough to be a tourniquet. It will throb, the hand will tingle, and it has to come off and go back on.",
        { tightness: state.bandageTightness }));
    }else if(state.bandageTightness > BANDAGE_TIGHT_WARN){
      issues.push(issue("bandageTight", "warn",
        "Tighter than it needs to be — check it is not uncomfortable and that you can still feel a pulse below it.",
        { tightness: state.bandageTightness }));
    }else if(state.bandageTightness < BANDAGE_LOOSE){
      issues.push(issue("bandageLoose", "warn",
        "That will not stay on as soon as the sleeve moves over it."));
    }
    if(state.gauzeShifted){
      issues.push(issue("gauzeShifted", "warn",
        "The gauze slid off the puncture as the dressing went on, so the dressing is holding nothing in place."));
    }
  }else if(haemostatic && state.checkedAt != null && !state.bleedingAtCheck){
    issues.push(issue("readyToDress", "note",
      "Bleeding has stopped. Put the dressing straight over the puncture — firm, not tight."));
  }

  if(!state.aftercareGiven && state.bandagedAt != null){
    issues.push(issue("noAftercare", "note",
      "Tell them how long to leave it on and what to watch for."));
  }

  const order = ["block", "warn", "note"];
  issues.sort((a, b)=>order.indexOf(a.severity) - order.indexOf(b.severity));
  const blocking = issues.filter(i => i.severity === "block");

  return {
    issues, blocking,
    haemostatic,
    hematomaGrade: grade,
    forceBand: band,
    holdSeconds: state.holdSeconds,
    clotProgress: state.clotProgress,
    bleeding: !haemostatic,
  };
}

/**
 * When each STEP of the pair is finished. Both share this one module exactly
 * as fill/switch share collection; only the finish line differs.
 */
export function modeReady(state, mode){
  const haemostatic = state.clotProgress >= HAEMOSTASIS_AT;
  if(mode === "pressure"){
    // Checking is part of the step: a learner who never looked does not know
    // it stopped, and the bandage step is the one that would pay for it.
    return haemostatic && state.checkedAt != null && !state.bleedingAtCheck;
  }
  if(mode === "bandage"){
    return state.bandagedAt != null
      && state.bandageTightness < BANDAGE_TIGHT_BLOCK
      && !state.bandagedWhileBleeding;
  }
  return false;
}

export function nextIssue(result){ return result && result.issues.length ? result.issues[0] : null; }

export function nextAction(state, mode){
  const haemostatic = state.clotProgress >= HAEMOSTASIS_AT;
  if(mode === "pressure"){
    if(state.pressureStartedAt == null) return "Press the gauze down onto the puncture now.";
    if(state.armFlexed) return "Straighten the arm — a bent elbow does not compress the vein.";
    if(!haemostatic){
      const band = forceBandFor(state.siteKind);
      if(state.force < band.min) return "Press harder — at this force the vein is not closed.";
      return "Hold it. The clot is forming — keep the pressure steady.";
    }
    if(state.checkedAt == null || state.bleedingAtCheck) return "Lift the gauze and look at the site.";
    return "Bleeding has stopped. The dressing goes on next.";
  }
  if(mode === "bandage"){
    if(state.bandagedAt == null) return "Put the dressing squarely over the puncture.";
    if(state.bandageTightness >= BANDAGE_TIGHT_BLOCK) return "Too tight — take it off and reapply it.";
    if(!state.aftercareGiven) return "Tell them how long to keep it on.";
    return "Dressed, and the patient knows what to watch for.";
  }
  return "";
}
