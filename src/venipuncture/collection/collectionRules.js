/* =========================================================================
   TUBE COLLECTION — the rules.

   The old pair of steps were a CSS height animation with a "stop at the fill
   line" button, and a row of divs dragged onto another div. Between them they
   modelled none of what actually decides whether a specimen is any good:

     ORDER      the tubes come off the rack that was staged in phase 1a, and
                which one you pick up decides whether the last tube's additive
                ends up in this one. Carryover is a real, directional
                contamination between two specific additives, not a
                "wrong order" boolean.
     SEATING    a tube pushed into the holder passes a guideline BEFORE the
                stopper is pierced. Past the guideline the rear cannula is
                through the rubber and the vacuum is spent on whatever is at
                the needle's other end — blood if the tip is in the vein, air
                and nothing if it is not. That is why the guideline exists.
     BRACING    the force of seating and of pulling a tube off goes straight
                down the holder into the needle unless the hand that pushes
                also pulls back on the holder's flange. Where the hand is
                placed is the whole technique, and the needle moving in the
                vein is the consequence.
     VOLUME     a tube stops when its vacuum is exhausted, not when a timer
                says so. Pulling one off early leaves it underfilled, and an
                additive tube's additive-to-blood ratio is fixed at
                manufacture — a short citrate tube is a rejected PT/INR, not
                a slightly worse one.
     COLLAPSE   a big draw volume on a small vein pulls the wall shut and the
                flow stops early. The way out is to break the vacuum by
                backing the tube off to the guideline, let the vein refill,
                and re-engage — which is a technique, not a retry button.

   Pure maths. tests/collection.spec.js asserts every threshold.
   ========================================================================= */
import { TUBES } from "../../config.js";

/* ---------- seating geometry ------------------------------------------------------ */

/** The holder's guideline: held, positioned, stopper NOT yet pierced. */
export const SEAT_GUIDELINE = 0.006;
/** Where the rear cannula is through the stopper and the vacuum opens. */
export const SEAT_ENGAGE = 0.013;
/** Fully home against the back of the holder. Pushing past this is force into the arm. */
export const SEAT_BOTTOM = 0.019;

/** Sideways offset the holder's own barrel absorbs without moving the needle. */
export const LATERAL_SLACK = 0.0012;
/**
 * The most a tube can actually lever the holder. A tube inside the barrel is
 * constrained by it: past this the hand has simply left the tube's line and
 * is no longer applying torque to anything, so a pointer swinging wide must
 * not read as a bigger and bigger lever.
 */
export const LATERAL_MAX = 0.006;

/**
 * What fraction of the handling force reaches the needle.
 *
 * Held by the flange, the push and the pull are a couple: the fingers pulling
 * back on the flange cancel the thumb pushing the tube, and almost nothing
 * reaches the patient. Held only by the tube, there is nothing to push
 * AGAINST — the holder simply travels with the tube, and the needle travels
 * with the holder. Not all of it, because the stopper resists and some of the
 * push does seat the tube, but enough that a full seat drives the tip clear
 * out the far side of most veins.
 */
export const BRACED_TRANSMISSION = 0.08;
export const UNBRACED_TRANSMISSION = 0.45;

/** Where the hand was when the push started. */
export const GRIP = { FLANGE: "flange", BODY: "body" };

export function transmissionFor(grip){
  return grip === GRIP.FLANGE ? BRACED_TRANSMISSION : UNBRACED_TRANSMISSION;
}

/**
 * How far the needle moves in the vein for a given moment of tube handling.
 *
 * Axial push travels straight down the holder's own axis, which is the
 * needle's axis: it drives the tip DEEPER. Axial pull backs it out. Lateral
 * offset levers the tip across the lumen — taken as the tube's CURRENT
 * offset rather than a per-sample delta, so a slow steady lever counts as
 * much as a fast one and a jittery pointer does not accumulate a shift the
 * hand never made.
 *
 * @param {number} dAxialM        metres travelled along the axis this moment
 * @param {number} lateralOffsetM the tube's current offset from the axis
 * @returns {{deeperM:number, lateralM:number}} deeper is +; lateral is a
 *   magnitude, and is a level rather than an increment
 */
export function needleShiftFrom(dAxialM, lateralOffsetM, grip){
  const t = transmissionFor(grip);
  const capped = Math.min(LATERAL_MAX, Math.abs(lateralOffsetM || 0));
  const lat = Math.max(0, capped - LATERAL_SLACK);
  return {
    deeperM: (dAxialM || 0)*t,
    lateralM: lat*t,
  };
}

/**
 * How far the tip can wander from where it entered before it is no longer in
 * the lumen. A vessel's own calibre, not a constant — a big median cubital
 * tolerates a shove that would lose a narrow cephalic.
 */
export function lumenToleranceM(vessel){
  if(!vessel) return 0.0016;
  return Math.max(0.0010, vessel.calibre*0.85);
}

/* ---------- vacuum, volume and flow ------------------------------------------------ */

/** Nominal draw volume in millilitres, by tube. */
export const TUBE_VOLUME_ML = {
  bloodculture: 8.0,
  lightblue:    2.7,
  red:          6.0,
  sst:          5.0,
  pst:          4.5,
  green:        4.0,
  lavender:     4.0,
  gray:         4.0,
};

/**
 * Nominal draw volume, scaled by whichever tube stock is on the cart.
 *
 * A paediatric tube is not "the same tube with less blood in it": its vacuum
 * is smaller, so a small or fragile vein can actually supply it, and its
 * additive is measured for that volume so the ratio rule still applies at the
 * smaller fill. `scale` is 1 for standard stock and 0.45 for the paediatric
 * kit — see progression.js's `tubeVolumeScale()`.
 */
export function tubeVolumeMl(key, scale){
  const base = TUBE_VOLUME_ML[key] == null ? 4.0 : TUBE_VOLUME_ML[key];
  return base * (scale == null ? 1 : scale);
}

/**
 * The fill fraction a tube must reach for its additive ratio to be valid.
 *
 * Sodium citrate is the strict one and the reason the rule exists at all: the
 * 9:1 blood-to-citrate ratio is fixed when the tube is manufactured, so a
 * short draw over-anticoagulates the sample and the PT/INR comes back wrong
 * rather than merely imprecise. Other additive tubes want a full draw; a
 * plain serum tube genuinely does not care.
 */
export const RATIO_REQUIRED = {
  lightblue:    0.90,
  bloodculture: 0.85,
  lavender:     0.75,
  green:        0.75,
  pst:          0.75,
  gray:         0.75,
  sst:          0.50,
  red:          0.30,
};

export function requiredFraction(key){
  return RATIO_REQUIRED[key] == null ? 0.75 : RATIO_REQUIRED[key];
}

/** Whether a short draw on this tube invalidates the test outright. */
export function ratioCritical(key){
  return key === "lightblue" || key === "bloodculture";
}

/** Gauge changes flow a lot — it is the fourth power of the radius in theory. */
export function gaugeFactor(gauge){
  const g = gauge == null ? 21 : gauge;
  if(g <= 20) return 1.20;
  if(g <= 21) return 1.00;
  if(g <= 22) return 0.72;
  if(g <= 23) return 0.52;
  return 0.32;
}

/**
 * Millilitres per second into an engaged tube.
 *
 * @param {object} o
 *   vessel        the vessel the needle is actually in
 *   gauge         the needle they staged
 *   vigour        the patient's own filling (a dehydrated arm is 0.72)
 *   tourniquetOn  a band still on fills the vein better while it is there
 *   collapsed     the wall has been pulled shut against the bevel
 */
export function drawRateMlPerS(o){
  const opt = o || {};
  if(opt.collapsed) return 0.02;
  const vessel = opt.vessel;
  if(!vessel) return 0;
  const calibre = Math.max(0.0008, vessel.calibre);
  // a 3.2mm median cubital is the reference; flow scales with cross-section
  const calibreFactor = Math.min(1.6, Math.pow(calibre/0.0032, 2));
  const base = 0.62;
  return base
    * calibreFactor
    * gaugeFactor(opt.gauge)
    * (opt.vigour == null ? 1 : opt.vigour)
    * (opt.tourniquetOn ? 1.12 : 1);
}

/**
 * Whether this tube's vacuum is strong enough, against this vein, to pull the
 * wall shut. A full-draw tube on a narrow vein is the classic; the same tube
 * on a good median cubital is fine.
 */
export function collapsesVein(vessel, tubeKey, scale){
  if(!vessel) return false;
  const vol = tubeVolumeMl(tubeKey, scale);
  if(vol < 4.5) return false;
  return vessel.calibre < 0.0030;
}

/** Seconds of broken vacuum before a collapsed vein has refilled. */
export const REFILL_SECONDS = 2.5;

/* ---------- order of draw and carryover ------------------------------------------- */

export function tubeOrder(key){
  return TUBES[key] ? TUBES[key].order : 99;
}

export function tubeName(key){
  return TUBES[key] ? TUBES[key].name : key;
}

/**
 * The additive a tube carries into the NEXT tube through the shared needle,
 * and what that additive ruins. Directional and specific: this is why the
 * order exists, and it is not the same as "these two are swapped".
 */
const CARRYOVER = {
  lavender: { additive: "EDTA", ruins: ["red","sst","pst","green","gray","lightblue"],
    why: "EDTA binds calcium and raises potassium — it wrecks a chemistry panel and any calcium or potassium result drawn after it." },
  gray:     { additive: "fluoride/oxalate", ruins: ["red","sst","pst","green","lightblue"],
    why: "Fluoride and oxalate inhibit enzymes and chelate calcium — a chemistry or coagulation sample after one is not the patient's blood chemistry." },
  green:    { additive: "heparin", ruins: ["red","sst","lightblue"],
    why: "Heparin interferes with clotting and with a serum tube's ability to clot at all." },
  pst:      { additive: "lithium heparin", ruins: ["red","sst","lightblue"],
    why: "Heparin interferes with clotting and with a serum tube's ability to clot at all." },
  lightblue:{ additive: "sodium citrate", ruins: [],
    why: "" },
};

/**
 * What the previously drawn tube did to this one, if anything.
 * @returns {{from:string, additive:string, why:string}|null}
 */
export function carryoverInto(previousKey, thisKey){
  if(!previousKey || previousKey === thisKey) return null;
  const src = CARRYOVER[previousKey];
  if(!src || src.ruins.indexOf(thisKey) < 0) return null;
  // Drawing in the correct order is exactly the arrangement in which no tube
  // is ever preceded by one that ruins it, so an in-order pair never gets here
  // — but check it explicitly rather than relying on the table staying in step
  // with the order column.
  if(tubeOrder(previousKey) < tubeOrder(thisKey)) return null;
  return { from: previousKey, additive: src.additive, why: src.why };
}

/** The canonical order this draw's tubes should come off the rack in. */
export function expectedOrder(keys){
  return [...new Set(keys || [])].sort((a, b)=>tubeOrder(a) - tubeOrder(b));
}

/* ---------- what can still be put right ------------------------------------------- */

/**
 * Whether a tube that has already come off can be drawn again.
 *
 * A short draw can: you take another of the same tube and fill it properly,
 * at the cost of the one you wasted. Carryover cannot — the additive is in
 * the needle, so every tube drawn through it after the offending one is
 * affected too, and a "redraw" would simply produce another contaminated
 * tube. That asymmetry is the lesson, and pretending both are recoverable
 * would teach the wrong one.
 */
export function isRedrawable(tube){
  if(!tube || !tube.removedAt) return false;
  if(tube.carryover) return false;
  if(tube.deadOnAir) return true;
  const frac = tube.volumeMl > 0 ? tube.drawnMl/tube.volumeMl : 0;
  return frac < requiredFraction(tube.key);
}

/* ---------- judgement -------------------------------------------------------------- */

function issue(code, severity, message, data){
  return { code, severity, message, data: data == null ? null : data };
}

/**
 * @param {object} state  collectionState
 * @param {object} o
 *   vessel        the vessel the needle went into
 *   inVein        whether the insert step ever got a flash
 *   tourniquetOn
 */
export function evaluateCollection(state, o){
  const opt = o || {};
  const issues = [];
  const cur = state.currentKey ? state.tubes[state.currentKey] : null;
  const remaining = state.order.filter(k => !state.tubes[k] || !state.tubes[k].removedAt);
  const redrawable = state.order.filter(k => isRedrawable(state.tubes[k]));
  const nextExpected = remaining.length ? remaining[0] : null;

  if(!opt.inVein){
    issues.push(issue("noAccess", "block",
      "There is no flash — nothing will come out of the vein however the tube is handled. Sort the needle out before piercing a stopper."));
  }

  if(state.needleOut){
    issues.push(issue("needleOut", "block",
      `The needle has been shoved ${Math.round(state.needleShiftM*1000)}mm out of the lumen — that is what an unbraced push does. Nothing more will flow into any tube.`,
      { shiftM: state.needleShiftM }));
  }else if(state.needleShiftM > lumenToleranceM(opt.vessel)*0.55){
    issues.push(issue("needleMoving", "warn",
      "The needle is being moved about in the vein. Hold the holder's flange while you push and pull, or the tip will come out of it."));
  }

  if(cur && !cur.removedAt){
    if(state.seatDepth > SEAT_BOTTOM){
      issues.push(issue("bottomedOut", "warn",
        "The tube is already home — pushing further is going straight into the patient's arm, not into the tube."));
    }
    if(cur.deadOnAir){
      issues.push(issue("deadTube", "block",
        `That ${tubeName(cur.key)} tube's stopper was pierced with no blood coming — its vacuum went on air and it will never fill. Take a fresh one.`));
    }
    if(cur.carryover){
      issues.push(issue("carryover", "block",
        `${tubeName(cur.carryover.from)} was drawn before this one, so ${cur.carryover.additive} has been carried through the needle into it. ${cur.carryover.why}`,
        cur.carryover));
    }
    if(cur.collapsed){
      issues.push(issue("collapsed", "note",
        "The flow has stopped early — this tube's vacuum has pulled the vein shut against the bevel. Back the tube off to the guideline to break the vacuum, let the vein refill, then push it back on."));
    }
    if(cur.pierced && !cur.collapsed && cur.drawnMl < cur.volumeMl && !state.needleOut && opt.inVein){
      issues.push(issue("filling", "note",
        `${tubeName(cur.key)} is filling. Let the vacuum exhaust itself — it stops on its own when the tube is full.`));
    }
  }

  if(!cur && nextExpected){
    issues.push(issue("takeNext", "note",
      `Take the ${tubeName(nextExpected)} tube off the rack next.`, { key: nextExpected }));
  }

  /* --- what has already been collected --- */
  for(const key of state.order){
    const t = state.tubes[key];
    if(!t || !t.removedAt) continue;
    const frac = t.volumeMl > 0 ? t.drawnMl/t.volumeMl : 0;
    const need = requiredFraction(key);
    if(frac < need){
      issues.push(issue(ratioCritical(key) ? "ratioInvalid" : "underfilled",
        ratioCritical(key) ? "block" : "warn",
        ratioCritical(key)
          ? `The ${tubeName(key)} tube came off at ${Math.round(frac*100)}% — its additive-to-blood ratio is fixed, so a short draw makes the result wrong rather than approximate. It has to be redrawn.`
          : `The ${tubeName(key)} tube came off at ${Math.round(frac*100)}% of its draw volume.`,
        { key, fraction: frac, required: need }));
    }
    if(t.carryover){
      issues.push(issue("carryoverDone", "block",
        `The ${tubeName(key)} tube was drawn after ${tubeName(t.carryover.from)}, carrying ${t.carryover.additive} into it. ${t.carryover.why}`,
        t.carryover));
    }
  }

  // Not finished while something can still be put right: a tube that came off
  // short is a tube you can draw again, and the step should not be reporting
  // itself done while that is still true.
  const allDone = state.order.every(k => state.tubes[k] && state.tubes[k].removedAt)
    && redrawable.length === 0;
  const order = ["block", "warn", "note"];
  issues.sort((a, b)=>order.indexOf(a.severity) - order.indexOf(b.severity));
  const blocking = issues.filter(i => i.severity === "block");

  return {
    ready: allDone && blocking.length === 0,
    allDone,
    issues, blocking,
    current: cur,
    nextExpected,
    remaining,
    redrawable,
  };
}

export function nextIssue(result){ return result && result.issues.length ? result.issues[0] : null; }

export function nextAction(state, result){
  if(result && result.allDone) return "Every tube is off. The band comes off next.";
  const cur = result ? result.current : null;
  if(!cur && result && result.redrawable.length){
    return `Take another ${tubeName(result.redrawable[0])} tube — the first one came off short.`;
  }
  if(!cur) return result && result.nextExpected
    ? `Take the ${tubeName(result.nextExpected)} tube off the rack.`
    : "Take the next tube off the rack.";
  if(!cur.pierced) return "Push the tube onto the holder — hold the flange as you do it.";
  if(cur.collapsed) return "Back the tube off to the guideline to break the vacuum, then push it back on.";
  if(cur.drawnMl < cur.volumeMl) return "Let it fill until the flow stops by itself.";
  return "Full. Pull it straight off, flange held.";
}
