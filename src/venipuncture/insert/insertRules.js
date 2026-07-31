/* =========================================================================
   ANCHOR + INSERT — the rules.

   The old step was one drag: an angle read off screen pixels, dropped onto a
   target box. Two real skills are missing from that. What actually decides
   whether a stick is clean is:

     ANCHOR    the skin is pulled taut with the off hand, an inch or two below
               the site, BEFORE the needle goes anywhere near it. Skip this and
               a compliant vein slides clear of the approaching tip — the same
               roll the palpation branch already models under a fingertip.
     ANGLE     15-30 degrees off the skin. Flatter skates over the vein;
               steeper drives through the far wall into whatever is underneath.
     DEPTH     the tip has to stop INSIDE the vein — short of it is a miss,
               through it is a through-and-through.
     BEVEL     inherited from the uncap step. A bevel that was never rolled up
               cuts a flap instead of slicing, and that mistake becomes
               irreversible the moment the skin is broken.

   Pure maths. tests/insert.spec.js asserts every threshold.
   ========================================================================= */
import { nearestOnVessel } from "../arm/armAnatomy.js";
import { rollOffset } from "../palpation/palpationRules.js";

/* ---------- anchor ------------------------------------------------------------- */

/** Metres distal to the mark the traction has to land to actually help. */
export const ANCHOR_DISTAL_MIN = 0.020;         // ~0.8"
export const ANCHOR_DISTAL_MAX = 0.060;         // ~2.4"
/** Below this the pull never really tensioned the skin. */
export const ANCHOR_PULL_MIN = 0.007;
/** Full traction credit — beyond this a rolling vein is fully held still. */
export const ANCHOR_PULL_GOOD = 0.014;

/** Distal offset of the anchor from the marked site, signed +distal. */
export function anchorOffsetFromMark(anchorX, markX){ return markX - anchorX; }

/** The antecubital defaults, as one object — the shape `procedure.js`'s
    `anchor` field already uses, so a procedure's own band can be passed
    straight through without translation. */
export const DEFAULT_ANCHOR_BAND = {
  distalMin: ANCHOR_DISTAL_MIN, distalMax: ANCHOR_DISTAL_MAX,
  pullMin: ANCHOR_PULL_MIN, pullGood: ANCHOR_PULL_GOOD,
};

/** @returns {"wrongSide"|"tooClose"|"tooFar"|"ideal"} */
export function classifyAnchorPosition(offset, anchorBand){
  const b = anchorBand || DEFAULT_ANCHOR_BAND;
  if(offset <= 0) return "wrongSide";
  if(offset < b.distalMin) return "tooClose";
  if(offset > b.distalMax) return "tooFar";
  return "ideal";
}

/**
 * How far a compliant vein has drifted from its marked position by the time
 * the needle arrives, given how much traction is actually holding it.
 *
 * Reuses palpation's own rollOffset() — an approaching needle presses in
 * about as hard as a firm palpating finger, so the same displacement formula
 * applies. Full anchor pull cancels it out entirely; no traction at all
 * leaves the vein free to roll exactly as it did under a fingertip.
 */
export function unheldRollOffset(vessel, anchorPull, anchorBand){
  if(!vessel) return 0;
  const b = anchorBand || DEFAULT_ANCHOR_BAND;
  const held = Math.max(0, Math.min(1, (anchorPull || 0)/b.pullGood));
  return rollOffset(vessel, 0.65) * (1 - held);
}

/* ---------- angle --------------------------------------------------------------- */

export const ANGLE_IDEAL = { min: 15, max: 30 };
export const ANGLE_ACCEPTABLE = { min: 8, max: 42 };

/** The antecubital defaults, as one object — matches `procedure.js`'s
    `angle` field, so it can be passed straight through unmodified. */
export const DEFAULT_ANGLE_BAND = { ideal: ANGLE_IDEAL, acceptable: ANGLE_ACCEPTABLE };

/**
 * Concrete degrees for the accessible controls' three presets — "go in at
 * the ideal angle / nearly flat / steep" — derived from whichever band this
 * draw is actually judged against, so a hand draw's controls offer 10°/2°/25°
 * rather than the antecubital's 20°/5°/45° regardless of the vein underneath.
 */
export function anglePresetsFor(angleBand){
  const b = angleBand || DEFAULT_ANGLE_BAND;
  return {
    ideal: Math.round((b.ideal.min + b.ideal.max)/2),
    shallow: Math.max(0, Math.round(b.acceptable.min - 3)),
    steep: Math.round(b.acceptable.max + 3),
  };
}

/**
 * Concrete metres for the accessible anchor presets, derived the same way.
 */
export function anchorPresetsFor(anchorBand){
  const b = anchorBand || DEFAULT_ANCHOR_BAND;
  return {
    idealM: (b.distalMin + b.distalMax)/2,
    closeM: Math.max(0.002, b.distalMin*0.4),
    farM: b.distalMax*1.4,
    pullGoodM: b.pullGood,
    pullWeakM: b.pullMin*0.4,
  };
}

/* ---------- entry and depth ------------------------------------------------------ */

/** Metres of slack allowed beyond the vessel's own calibre before it's a miss. */
export const ENTRY_TOLERANCE = 0.0022;
/** Metres past the vessel's far wall before it counts as through-and-through. */
export const THROUGH_MARGIN = 0.0018;
export const BEVEL_TOLERANCE_DEG = 25;

/** The real depth window a vessel occupies, near wall to far wall. */
export function depthBand(vessel){
  return { near: vessel.depth - vessel.calibre*0.35, far: vessel.depth + vessel.calibre };
}
export function isInVein(vessel, depthM){
  const b = depthBand(vessel);
  return depthM >= b.near && depthM <= b.far;
}
export function isThroughAndThrough(vessel, depthM){
  return depthM > depthBand(vessel).far + THROUGH_MARGIN;
}

/** Whether the entry point sits laterally close enough to the vessel to count. */
export function isLateralHit(vessel, entryX, entryZ, anchorPull){
  if(!vessel) return false;
  const rolled = unheldRollOffset(vessel, anchorPull || 0);
  const hit = nearestOnVessel(vessel, entryX, entryZ);
  return (hit.d + rolled) <= vessel.calibre + ENTRY_TOLERANCE;
}

/**
 * A real flash needs the tip to be laterally ON the vessel AND at a depth
 * inside it — depth alone is not enough. A needle stuck three centimetres
 * from the marked vein at a plausible depth for THAT vessel is not "in" it
 * just because the numbers happen to line up.
 */
export function isTrueFlash(state, vessel){
  if(!vessel || state.entryX == null) return false;
  return isLateralHit(vessel, state.entryX, state.entryZ, state.anchorSet ? state.anchorPull : 0)
    && isInVein(vessel, state.depthM);
}

/* ---------- judgement ------------------------------------------------------------ */

function issue(code, severity, message, data){ return { code, severity, message, data: data == null ? null : data }; }

/**
 * @param {object} state    insertState
 * @param {Array}  vessels  the arm's vessels
 * @param {number} [bevelDeg]  the needle unit's bevel angle, from the assembly branch
 * @param {object} [angleBand]   {ideal:{min,max}, acceptable:{min,max}} — defaults to the antecubital window
 * @param {object} [anchorBand]  {distalMin,distalMax,pullMin,pullGood} — defaults to the antecubital window
 */
export function evaluateInsert(state, vessels, bevelDeg, angleBand, anchorBand){
  const issues = [];
  const chosen = (vessels || []).find(v => v.id === state.chosenId) || null;
  const angle = angleBand || DEFAULT_ANGLE_BAND;
  const anchor = anchorBand || DEFAULT_ANCHOR_BAND;

  /* --- anchor --- */
  let anchorOffset = null;
  if(!state.anchorSet){
    issues.push(issue("notAnchored", "block",
      "Anchor the vein first — pull the skin taut with your thumb before you go in."));
  }else{
    anchorOffset = anchorOffsetFromMark(state.anchorX, state.markX);
    const cls = classifyAnchorPosition(anchorOffset, anchor);
    if(cls === "wrongSide") issues.push(issue("anchorWrongSide", "warn",
      "The traction pulled toward the site instead of away from it — that doesn't hold the vein still, and now your thumb is in the needle's path."));
    else if(cls === "tooClose") issues.push(issue("anchorTooClose", "warn",
      "The thumb landed right on top of where you're aiming. Move it back a little so it isn't in the way."));
    else if(cls === "tooFar") issues.push(issue("anchorTooFar", "warn",
      "That far below the site, the traction barely reaches the vein. A little closer holds it firmer."));
    if(state.anchorPull < anchor.pullMin) issues.push(issue("weakTraction", "warn",
      "That pull was too light to actually tension the skin — drag further before you let go."));
  }

  /* --- entry, angle, depth --- */
  let inVein = false, through = false;
  if(state.entryX != null && chosen){
    const rolled = unheldRollOffset(chosen, state.anchorSet ? state.anchorPull : 0, anchor);
    const hit = nearestOnVessel(chosen, state.entryX, state.entryZ);
    const tolerance = chosen.calibre + ENTRY_TOLERANCE;
    const lateralOk = (hit.d + rolled) <= tolerance;

    if(!lateralOk){
      issues.push(issue("missedVein", "block",
        rolled > 0.0008
          ? "The needle went in beside the vein — unanchored, a vein this compliant rolls clear of the approaching tip."
          : "The needle went in beside the vein, not into it.",
        { distance: hit.d, rolled }));
    }

    if(state.angleDeg < angle.acceptable.min){
      issues.push(issue("tooShallow", "block",
        `${Math.round(state.angleDeg)}° is nearly flat against the skin — it will skate over the vein instead of into it. ${angle.ideal.min}–${angle.ideal.max}° is the window.`));
    }else if(state.angleDeg > angle.acceptable.max){
      issues.push(issue("tooSteep", "block",
        `${Math.round(state.angleDeg)}° is too steep — you'll drive through the vein into what's underneath it. ${angle.ideal.min}–${angle.ideal.max}° is the window.`));
    }else if(state.angleDeg < angle.ideal.min || state.angleDeg > angle.ideal.max){
      issues.push(issue("angleOffIdeal", "warn",
        `${Math.round(state.angleDeg)}° will work, but ${angle.ideal.min}–${angle.ideal.max}° is the cleaner stick.`));
    }

    // A flash needs BOTH: lateral position and depth cannot be judged
    // separately, or a stick nowhere near the vein could still read as "in"
    // it purely because the depth happened to line up.
    const depthOk = isInVein(chosen, state.depthM);
    inVein = lateralOk && depthOk;
    through = isThroughAndThrough(chosen, state.depthM);
    if(through){
      issues.push(issue("throughAndThrough", "block",
        "The tip has gone through the far wall of the vein. Pull back to just inside it — advancing further tears through into what's underneath."));
    }else if(lateralOk && !depthOk && state.depthM > 0){
      issues.push(issue("notInVeinYet", "note",
        state.depthM < depthBand(chosen).near
          ? "Not deep enough yet — ease the needle further in along the same line."
          : "Past the vein already — back off slightly."));
    }
  }

  if(bevelDeg != null && Math.abs(bevelDeg) > BEVEL_TOLERANCE_DEG){
    issues.push(issue("bevelDown", "block",
      `The bevel is ${Math.round(Math.abs(bevelDeg))}° off vertical. Bevel-down cuts a flap instead of slicing cleanly and won't fill well — that should have been caught uncapping.`));
  }

  if(state.withdrawnBeforeFlash && !inVein){
    issues.push(issue("pulledOut", "note",
      "The needle came back out before a flash ever showed. Re-approach along the same line."));
  }

  const order = ["block", "warn", "note"];
  issues.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
  const blocking = issues.filter(i => i.severity === "block");

  return {
    ready: inVein && !through && blocking.length === 0,
    issues, blocking,
    inVein, through, chosen, anchorOffset,
  };
}

export function nextIssue(result){ return result && result.issues.length ? result.issues[0] : null; }

export function nextAction(state, result){
  if(!state.anchorSet) return "Press below the site and pull the skin taut to anchor the vein.";
  if(state.entryX == null) return "Bring the needle in at a shallow angle and break the skin over the vein.";
  if(result && result.through) return "Pull back — you've gone through the vein.";
  if(result && !result.inVein) return "Ease the needle further in along the same line.";
  return "Flash. Hold it steady.";
}
