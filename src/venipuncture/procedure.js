/* =========================================================================
   WHICH DRAW THIS IS.

   Until now there was one procedure, and its numbers lived as module
   constants in the step that used them: `ANGLE_IDEAL` in insertRules,
   `SITE_KIND.ANTECUBITAL` hard-coded in physicalSteps, `DEVICE.STRAIGHT`
   assumed by withdrawal. This file is what makes the second procedure a
   different procedure rather than the same animation with a different model.

   The brief is explicit about what has to differ, and every one of these is
   a number the steps already measure against:

     the device        a winged set retracts; a straight needle shields
     the site          a dorsal hand vein, not the antecubital fossa
     the gauge         23G, because a hand vein will not take a 21
     the angle         5-15°, because there is 1.5-2.5mm of skin over that
                       vein and 30° puts the tip in the metacarpal
     the anchor        distal, firm, and much closer — a hand is small
     the tubing        a butterfly has one, and it has consequences
     the minimum draw  at least one tube with >= 1 mL

   Pure data. Every consumer reads it through `procedureFor()`; nothing
   branches on a string comparison spread through the runtimes.
   ========================================================================= */
import { DEVICE } from "./withdrawal/withdrawalRules.js";
import { SITE_KIND } from "./postdraw/postDrawRules.js";
import { SITE, HAND_SITE, BAND_IDEAL, BAND_ACCEPTABLE } from "./arm/armAnatomy.js";

export const PROCEDURE = {
  STRAIGHT_ANTECUBITAL: "straight-antecubital",
  BUTTERFLY_HAND: "butterfly-hand",
};

export const PROCEDURES = {
  [PROCEDURE.STRAIGHT_ANTECUBITAL]: {
    id: PROCEDURE.STRAIGHT_ANTECUBITAL,
    label: "Straight multisample needle, antecubital fossa",
    short: "Antecubital",
    device: DEVICE.STRAIGHT,
    siteKind: SITE_KIND.ANTECUBITAL,
    siteX: SITE.x,
    gauge: 21,
    /* the window the insert step judges the entry against */
    angle: { ideal: { min: 15, max: 30 }, acceptable: { min: 8, max: 42 } },
    /* where the off-hand thumb belongs, and how hard it has to pull */
    anchor: { distalMin: 0.020, distalMax: 0.060, pullMin: 0.007, pullGood: 0.014 },
    /* no tubing between the needle and the holder */
    tubing: null,
    /* no per-tube floor beyond each tube's own additive ratio */
    minDrawMl: null,
    /* the tourniquet goes on the upper arm, 3-4" above the fossa — these are
       literally BAND_IDEAL/BAND_ACCEPTABLE, named here so both procedures
       are read the same way rather than one being a constant and one a
       config value. */
    bandIdealM: BAND_IDEAL,
    bandAcceptableM: BAND_ACCEPTABLE,
  },

  [PROCEDURE.BUTTERFLY_HAND]: {
    id: PROCEDURE.BUTTERFLY_HAND,
    label: "Butterfly (winged) set, dorsal hand",
    short: "Dorsal hand",
    device: DEVICE.BUTTERFLY,
    siteKind: SITE_KIND.HAND,
    siteX: HAND_SITE.x,
    gauge: 23,
    // A dorsal metacarpal vein sits 1.5-2.5mm down with bone directly under
    // it. The antecubital window would drive the tip straight through.
    angle: { ideal: { min: 5, max: 15 }, acceptable: { min: 3, max: 22 } },
    // The anchor is the thumb pulling the skin over the knuckles taut, and
    // the hand is a tenth the length of a forearm.
    anchor: { distalMin: 0.008, distalMax: 0.030, pullMin: 0.004, pullGood: 0.008 },
    tubing: {
      lengthM: 0.18,
      /* slack the set needs to sit without dragging on the needle */
      slackGoodM: 0.030,
      /* beyond this the line is taut and every tube change reaches the tip */
      slackTautM: 0.008,
      /* metres of tip movement per metre of pull on an unsecured line */
      pullTransferUnsecured: 0.055,
      /* ...and per metre once the wings are taped down */
      pullTransferSecured: 0.006,
      /* metres of tip movement per degree of swing on an unsecured line */
      swingTransferPerDeg: 0.00012,
    },
    // A short-draw hand collection is still a specimen if a tube has a
    // millilitre in it; nothing in it is a specimen if none has.
    minDrawMl: 1.0,
    // The band goes on the forearm above the wrist, not the upper arm —
    // measured from HAND_SITE, a shorter reach than the fossa's.
    bandIdealM: { min: 0.050, max: 0.076 },
    bandAcceptableM: { min: 0.038, max: 0.090 },
  },
};

export const DEFAULT_PROCEDURE = PROCEDURE.STRAIGHT_ANTECUBITAL;

/** The procedure definition, defaulted rather than thrown. */
export function procedureFor(id){
  return PROCEDURES[id] || PROCEDURES[DEFAULT_PROCEDURE];
}

/** True when this draw uses a winged set on the back of the hand. */
export function isButterfly(id){
  return procedureFor(id).device === DEVICE.BUTTERFLY;
}

/**
 * Which procedure this patient's arms actually allow.
 *
 * This is data, not prose: a patient whose usable arm is flagged `dry`
 * (flat veins) or who is a child has a fossa that will not give a straight
 * 21G a target, and the winged set on the back of the hand is the answer.
 * The learner still chooses; this is what the requisition and the arms
 * support, so the report can say whether the choice was right.
 */
export function indicatedProcedure(patient){
  const p = patient || {};
  const arms = (p.site && p.site.arms) || null;
  const keys = arms ? [arms.left && arms.left.key, arms.right && arms.right.key] : [];
  const flat = keys.indexOf("dry") >= 0;
  const child = p.ageCat === "Child";
  return (flat || child) ? PROCEDURE.BUTTERFLY_HAND : PROCEDURE.STRAIGHT_ANTECUBITAL;
}

export { DEVICE, SITE_KIND };
