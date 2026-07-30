/* =========================================================================
   TUBE INVERSION — the rules.

   The old step was a row of buttons you tapped six times each, with a counter
   that went up. Tapping is not mixing, and six is not the answer for every
   tube. What actually decides whether an additive tube is a usable specimen:

     WHICH TUBE   a plain serum tube must NOT be mixed (it needs to clot
                  undisturbed); an EDTA tube needs eight to ten. The number is
                  a property of the additive, not a global six.
     THE ANGLE    an inversion is the tube going all the way over and back.
                  Rocking it thirty degrees does nothing to the additive at
                  the closed end, however many times you do it — and it is
                  what people actually do when they are counting to eight in a
                  hurry.
     THE SPEED    gentle end-over-end mixes. Shaking shears red cells open,
                  and a haemolysed sample is a rejected sample — potassium and
                  LDH come back wrong, not merely imprecise.
     THE DELAY    additive only works if the blood reaches it before it starts
                  to clot. A tube left on the bench for a minute and then
                  inverted beautifully is still full of micro-clots.

   Pure maths. tests/inversion.spec.js asserts every threshold.
   ========================================================================= */
import { TUBES } from "../../config.js";

/* ---------- how many, per tube ---------------------------------------------------- */

/**
 * The inversion count each tube's additive actually needs, as a range.
 *
 * Course data, deliberately kept as a table rather than buried in the runtime,
 * so a school whose protocol says "10 for EDTA" changes one number here. `min`
 * is what makes the specimen valid; `ideal` is what a manufacturer's insert
 * says. A plain serum tube is `{min:0, ideal:0, mustNotMix:true}` — mixing it
 * is a real error, not merely unnecessary.
 */
export const INVERSIONS = {
  bloodculture: { min: 8, ideal: 8 },
  lightblue:    { min: 3, ideal: 4 },
  red:          { min: 0, ideal: 0, mustNotMix: true },
  sst:          { min: 5, ideal: 5 },
  pst:          { min: 8, ideal: 8 },
  green:        { min: 8, ideal: 8 },
  lavender:     { min: 8, ideal: 8 },
  gray:         { min: 8, ideal: 8 },
};

export function inversionsFor(key){
  return INVERSIONS[key] || { min: 8, ideal: 8 };
}

export function requiresMixing(key){
  const spec = inversionsFor(key);
  return !spec.mustNotMix && spec.min > 0;
}

export function mustNotMix(key){
  return !!inversionsFor(key).mustNotMix;
}

export function tubeName(key){
  return TUBES[key] ? TUBES[key].name : key;
}

export function additiveOf(key){
  return TUBES[key] ? TUBES[key].additive : "";
}

/* ---------- what counts as one inversion ------------------------------------------ */

/**
 * Degrees of tilt from upright. A tube is "over" past `OVER_AT` and "back"
 * once it is under `UPRIGHT_AT` again; one inversion is that whole round trip.
 *
 * The gap between the two is deliberate: it means a hand that oscillates in
 * the middle of the range accumulates no inversions at all, which is exactly
 * what rocking a tube is.
 */
export const OVER_AT = 150;
export const UPRIGHT_AT = 30;

/** Degrees per second above which the tube is being shaken, not inverted. */
export const SHAKE_DEG_PER_S = 620;
/** And below which it is so slow the additive barely moves through the blood. */
export const SLUGGISH_DEG_PER_S = 45;

/* ---------- the delay ------------------------------------------------------------- */

/** Seconds after a tube comes off the holder within which mixing must begin. */
export const MIX_WITHIN_S = 60;
/** Past this, micro-clots have formed and the specimen is compromised. */
export const CLOTTED_AFTER_S = 120;

export function clottingFrom(delaySeconds, key){
  if(!requiresMixing(key)) return "none";
  const d = delaySeconds == null ? 0 : delaySeconds;
  if(d >= CLOTTED_AFTER_S) return "clotted";
  if(d > MIX_WITHIN_S) return "microclots";
  return "none";
}

/* ---------- haemolysis ------------------------------------------------------------ */

/**
 * How haemolysed a tube is, 0..1, from how much of its handling was violent.
 *
 * Cumulative and irreversible: cells that have burst do not un-burst, so
 * "shake it a bit then mix it properly" does not recover a specimen — which is
 * the whole reason shaking matters.
 */
export const HAEMOLYSIS_VISIBLE = 0.20;
export const HAEMOLYSIS_REJECT = 0.45;

export function haemolysisGrade(level){
  if(level >= HAEMOLYSIS_REJECT) return "rejected";
  if(level >= HAEMOLYSIS_VISIBLE) return "visible";
  return "none";
}

/** What one violent moment adds, scaled by how far past the threshold it was. */
export function haemolysisFrom(degPerS, dtS){
  if(degPerS <= SHAKE_DEG_PER_S) return 0;
  const excess = (degPerS - SHAKE_DEG_PER_S)/SHAKE_DEG_PER_S;
  return Math.min(0.5, excess*0.55)*Math.max(0, dtS || 0);
}

/* ---------- specimen verdict ------------------------------------------------------ */

/**
 * Whether a tube, as handled, is a usable specimen.
 * @returns {{usable:boolean, reason:string|null}}
 */
export function specimenVerdict(tube){
  if(!tube) return { usable: false, reason: "missing" };
  if(haemolysisGrade(tube.haemolysis) === "rejected") return { usable: false, reason: "haemolysed" };
  if(tube.clotting === "clotted") return { usable: false, reason: "clotted" };
  if(mustNotMix(tube.key) && tube.inversions > 0) return { usable: false, reason: "mixedWhenItShouldNot" };
  if(requiresMixing(tube.key) && tube.inversions < inversionsFor(tube.key).min){
    return { usable: false, reason: "underMixed" };
  }
  return { usable: true, reason: null };
}

/* ---------- judgement ------------------------------------------------------------- */

function issue(code, severity, message, data){
  return { code, severity, message, data: data == null ? null : data };
}

function round(v, dp){ const m = Math.pow(10, dp || 0); return Math.round(v*m)/m; }

/**
 * @param {object} state  inversionState
 */
export function evaluateInversion(state){
  const issues = [];
  const held = state.heldKey ? state.tubes[state.heldKey] : null;

  /* --- the tube in the hand right now --- */
  if(held){
    const spec = inversionsFor(held.key);
    if(mustNotMix(held.key)){
      if(held.inversions > 0){
        issues.push(issue("mixedPlainTube", "block",
          `${tubeName(held.key)} has no additive — it has to sit still and clot. Inverting it breaks up the forming clot and the serum comes back with fibrin in it.`,
          { key: held.key }));
      }else{
        issues.push(issue("plainTubeNoMix", "note",
          `${tubeName(held.key)} is a plain serum tube. Put it straight in the rack — this one does NOT get inverted.`,
          { key: held.key }));
      }
    }else if(held.inversions < spec.min){
      issues.push(issue("mixing", "note",
        `${held.inversions} of ${spec.ideal} — turn it all the way over and back, gently.`,
        { key: held.key, done: held.inversions, need: spec.ideal }));
    }
    if(held.rockCount >= 3 && held.inversions === 0){
      issues.push(issue("rocking", "warn",
        "That is rocking it, not inverting it. The additive is in the bottom of the tube — it has to travel the whole length and back, which means all the way over.",
        { rocks: held.rockCount }));
    }
    if(haemolysisGrade(held.haemolysis) !== "none"){
      issues.push(issue(
        haemolysisGrade(held.haemolysis) === "rejected" ? "haemolysed" : "haemolysing",
        haemolysisGrade(held.haemolysis) === "rejected" ? "block" : "warn",
        haemolysisGrade(held.haemolysis) === "rejected"
          ? `${tubeName(held.key)} has been shaken hard enough to burst red cells. A haemolysed sample gives a false potassium and a false LDH — it is rejected, and it has to be redrawn.`
          : "Gentler. That is fast enough to be shaking it, and shearing red cells open cannot be undone.",
        { level: held.haemolysis }));
    }
  }

  /* --- every tube, as it stands --- */
  for(const key of state.order){
    const t = state.tubes[key];
    if(!t) continue;
    if(t.clotting === "microclots"){
      issues.push(issue("mixedLate", "warn",
        `${tubeName(key)} sat for ${round(t.delaySeconds, 0)}s before it was mixed — long enough for micro-clots to start forming in it.`,
        { key, seconds: t.delaySeconds }));
    }else if(t.clotting === "clotted"){
      issues.push(issue("clotted", "block",
        `${tubeName(key)} sat for ${round(t.delaySeconds, 0)}s before being mixed. The blood has clotted around the additive and the specimen is no good — it needs a redraw.`,
        { key, seconds: t.delaySeconds }));
    }
    if(t.sluggish && requiresMixing(key) && t.inversions >= inversionsFor(key).min){
      issues.push(issue("tooSlow", "note",
        `${tubeName(key)} was turned very slowly. It counts, but the additive mixes better with a steady end-over-end.`,
        { key }));
    }
  }

  /* --- what is still outstanding --- */
  const pending = state.order.filter(k => {
    const t = state.tubes[k];
    if(!t) return false;
    return requiresMixing(k) && t.inversions < inversionsFor(k).min
      && specimenVerdict(t).reason !== "clotted";
  });
  const racked = state.order.filter(k => state.tubes[k] && state.tubes[k].rackedAt != null);

  if(!held && pending.length){
    issues.push(issue("takeNext", "note",
      `Pick up the ${tubeName(pending[0])} tube and mix it.`, { key: pending[0] }));
  }

  const verdicts = {};
  for(const key of state.order){
    verdicts[key] = specimenVerdict(state.tubes[key]);
  }
  const unusable = state.order.filter(k => state.tubes[k] && !verdicts[k].usable);

  // Everything that CAN be put right has been, and everything is in the rack.
  // A clotted or haemolysed tube cannot be fixed by more mixing, so it does not
  // hold the step open — it is reported instead.
  const allHandled = state.order.every(k => {
    const t = state.tubes[k];
    if(!t) return false;
    if(t.rackedAt == null) return false;
    const v = verdicts[k];
    return v.usable || v.reason === "haemolysed" || v.reason === "clotted";
  });

  const order = ["block", "warn", "note"];
  issues.sort((a, b)=>order.indexOf(a.severity) - order.indexOf(b.severity));
  const blocking = issues.filter(i => i.severity === "block");

  return {
    issues, blocking,
    held,
    pending,
    racked,
    verdicts,
    unusable,
    allHandled,
    ready: allHandled && blocking.length === 0,
  };
}

export function nextIssue(result){ return result && result.issues.length ? result.issues[0] : null; }

export function nextAction(state, result){
  const held = result ? result.held : null;
  if(held){
    if(mustNotMix(held.key)) return `${tubeName(held.key)} does not get inverted — put it in the rack.`;
    const spec = inversionsFor(held.key);
    if(held.inversions < spec.min) return `Turn it over and back — ${held.inversions} of ${spec.ideal} so far.`;
    return "That one is mixed. Stand it in the rack.";
  }
  if(result && result.pending.length) return `Pick up the ${tubeName(result.pending[0])} tube.`;
  if(result && result.allHandled) return "Every tube is mixed and racked.";
  return "Stand the mixed tubes in the rack.";
}
