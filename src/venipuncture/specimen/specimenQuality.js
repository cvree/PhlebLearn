/* =========================================================================
   SPECIMEN QUALITY — what the laboratory does with the tubes when they get
   there.

   Everything before this file judges the learner's HANDS. This one judges the
   thing their hands produced, which is the only part of the job the patient
   ever finds out about: a rejected specimen is a second needle in the same
   arm tomorrow.

   Nothing here invents a new measurement. Every input is already recorded by
   an earlier branch, and this module's whole job is to put them together the
   way a receiving technologist does, because no single branch can:

     FILL RATIO      collection knows how many millilitres actually went in;
                     the additive's ratio is fixed at manufacture, so an
                     under-drawn citrate tube is WRONG, not approximate.
     CARRYOVER       collection knows which tube preceded which through the
                     same needle, and which additive that carries.
     HAEMOLYSIS      three separate causes converge here and only here — the
                     shear of a narrow gauge under a full vacuum (collection +
                     assembly), a vein worried at by a moving needle
                     (collection), and shaking during mixing (inversion).
                     Cells burst for all three reasons and the analyser
                     cannot tell them apart, which is exactly why the
                     learner has to know all three.
     HAEMOCONCENTRATION  the tourniquet branch knows how long the band was on.
                     Past a minute the plasma has left the vessel and the
                     analytes left behind read high — a result that is wrong
                     while looking perfectly normal.
     CLOTTING        inversion knows when each tube was actually mixed.
     MIXING          inversion knows the counts, and whether a plain tube was
                     disturbed when it should have been left to clot.

   The output is a receiving verdict per tube, with the reason stated the way
   a lab states it, and one overall quality score.

   Pure maths. tests/specimen.spec.js asserts every threshold.
   ========================================================================= */
import { TUBES, TESTS } from "../../config.js";
import { requiredFraction, ratioCritical, tubeName } from "../collection/collectionRules.js";
import {
  inversionsFor, requiresMixing, mustNotMix, haemolysisGrade,
  HAEMOLYSIS_VISIBLE, HAEMOLYSIS_REJECT,
} from "../inversion/inversionRules.js";

/* ---------- the verdicts ---------------------------------------------------------- */

export const VERDICT = {
  ACCEPTED: "accepted",
  /** usable, but the lab will comment on it and the result carries a caveat */
  FLAGGED: "flagged",
  REJECTED: "rejected",
};

/* ---------- haemolysis from the draw itself --------------------------------------- */

/**
 * Seconds of tourniquet after which the specimen is haemoconcentrated.
 * The teaching number everywhere is one minute; the effect is graded rather
 * than a cliff, because it is.
 */
export const HAEMOCONCENTRATION_AFTER_S = 60;
export const HAEMOCONCENTRATION_BAD_S = 120;

/**
 * How much haemolysis the DRAW caused, 0..1, before anything was mixed.
 *
 * Three real mechanisms, each scaled by how far past its own threshold the
 * technique went:
 *
 *   gauge     blood forced through a narrow lumen by a full-draw vacuum
 *             shears. A 23G into a 10 mL tube is the classic; a 23G on a
 *             winged set into a 2 mL paediatric tube is fine, which is why
 *             this is per-tube and not per-needle.
 *   movement  a tip levered about in the lumen draws blood past a partly
 *             occluded bevel.
 *   dryness   alcohol not allowed to dry is carried into the tube on the
 *             needle and lyses cells directly.
 */
export function drawHaemolysis(o){
  const opt = o || {};
  const gauge = opt.gauge == null ? 21 : opt.gauge;
  const volumeMl = opt.volumeMl == null ? 4 : opt.volumeMl;
  const shiftM = opt.needleShiftM == null ? 0 : opt.needleShiftM;

  // 21G is the reference; every step narrower shears more, and a big vacuum
  // behind it multiplies that rather than adding to it.
  const narrowness = Math.max(0, gauge - 21)/4;                 // 21→0, 25→1
  const vacuum = Math.max(0, Math.min(1, (volumeMl - 2)/6));    // 2mL→0, 8mL→1
  const fromGauge = narrowness*vacuum*0.55;

  const fromMovement = Math.max(0, Math.min(0.30, (shiftM - 0.0008)*140));
  const fromWetAlcohol = opt.wetAlcohol ? 0.22 : 0;

  return Math.max(0, Math.min(1, fromGauge + fromMovement + fromWetAlcohol));
}

/** 0..1 of how hemoconcentrated a specimen is, from the band's own seconds. */
export function haemoconcentration(tourniquetSeconds){
  const s = tourniquetSeconds == null ? 0 : tourniquetSeconds;
  if(s <= HAEMOCONCENTRATION_AFTER_S) return 0;
  return Math.max(0, Math.min(1,
    (s - HAEMOCONCENTRATION_AFTER_S)/(HAEMOCONCENTRATION_BAD_S - HAEMOCONCENTRATION_AFTER_S)));
}

/* ---------- which tests each tube was for ------------------------------------------ */

/** The ordered tests this tube carries, so a rejection names what is lost. */
export function testsOnTube(key, orders){
  return (orders || []).filter(o => TESTS[o] && TESTS[o].tube === key);
}

/* ---------- one tube ---------------------------------------------------------------- */

/**
 * @param {object} o
 *   key, drawnMl, volumeMl, carryoverFrom
 *   inversions, mustNotMixed, mixHaemolysis, clotting
 *   gauge, needleShiftM, wetAlcohol, tourniquetSeconds
 *   orders   the encounter's ordered tests, for naming what is lost
 */
export function assessTube(o){
  const opt = o || {};
  const key = opt.key;
  const volumeMl = opt.volumeMl == null ? 4 : opt.volumeMl;
  const drawnMl = opt.drawnMl == null ? 0 : opt.drawnMl;
  const fraction = volumeMl > 0 ? Math.max(0, Math.min(1.2, drawnMl/volumeMl)) : 0;
  const need = requiredFraction(key);

  const fromDraw = drawHaemolysis({
    gauge: opt.gauge, volumeMl, needleShiftM: opt.needleShiftM, wetAlcohol: opt.wetAlcohol,
  });
  const fromMixing = opt.mixHaemolysis == null ? 0 : opt.mixHaemolysis;
  // Burst cells do not un-burst, and the analyser sees the total.
  const haemolysis = Math.max(0, Math.min(1, fromDraw + fromMixing));
  const concentration = haemoconcentration(opt.tourniquetSeconds);

  const reasons = [];
  let verdict = VERDICT.ACCEPTED;
  const reject = (code, text) => { verdict = VERDICT.REJECTED; reasons.push({ code, severity: "reject", text }); };
  const flag = (code, text) => {
    if(verdict !== VERDICT.REJECTED) verdict = VERDICT.FLAGGED;
    reasons.push({ code, severity: "flag", text });
  };

  if(drawnMl <= 0.01){
    reject("empty", `No specimen: the ${tubeName(key)} tube never filled.`);
  }else if(fraction < need){
    if(ratioCritical(key)){
      reject("ratio", `Filled to ${Math.round(fraction*100)}% — a ${tubeName(key)} tube's blood-to-additive ratio is fixed at manufacture, so this result would be wrong rather than imprecise. Redraw required.`);
    }else{
      flag("shortDraw", `Filled to ${Math.round(fraction*100)}% of draw volume (needs ${Math.round(need*100)}%).`);
    }
  }

  if(opt.carryoverFrom){
    reject("carryover", `Drawn after the ${tubeName(opt.carryoverFrom)} tube through the same needle: ${TUBES[opt.carryoverFrom] ? TUBES[opt.carryoverFrom].additive : "additive"} carryover. Out of order of draw.`);
  }

  const grade = haemolysisGrade(haemolysis);
  if(grade === "rejected"){
    reject("haemolysis", `Grossly haemolysed (index ${Math.round(haemolysis*100)}). Potassium and LDH would come back falsely high.`);
  }else if(grade === "visible"){
    flag("haemolysing", `Slight haemolysis visible (index ${Math.round(haemolysis*100)}).`);
  }

  if(opt.clotting === "clotted"){
    reject("clotted", `Clotted before it was mixed — an unmixed additive tube is not anticoagulated.`);
  }else if(opt.clotting === "microclots"){
    flag("microclots", `Mixed late; micro-clots present.`);
  }

  if(requiresMixing(key) && (opt.inversions || 0) < inversionsFor(key).min){
    reject("underMixed", `Inverted ${opt.inversions || 0} time(s); ${TUBES[key] ? TUBES[key].additive : "the additive"} needs ${inversionsFor(key).ideal}.`);
  }
  if(mustNotMix(key) && (opt.inversions || 0) > 0){
    flag("mixedPlain", `A plain serum tube was inverted ${opt.inversions} time(s) — it needs to clot undisturbed.`);
  }

  if(concentration >= 0.5){
    flag("haemoconcentrated", `The tourniquet was on ${Math.round(opt.tourniquetSeconds)}s. Plasma has left the vessel, so potassium, calcium and protein read high.`);
  }else if(concentration > 0){
    flag("bandLong", `The tourniquet was on ${Math.round(opt.tourniquetSeconds)}s — over the one-minute limit.`);
  }

  return {
    key,
    name: tubeName(key),
    additive: TUBES[key] ? TUBES[key].additive : "",
    tests: testsOnTube(key, opt.orders),
    drawnMl: Math.round(drawnMl*100)/100,
    volumeMl,
    fillFraction: Math.round(fraction*100)/100,
    requiredFraction: need,
    haemolysis: Math.round(haemolysis*100)/100,
    haemolysisFromDraw: Math.round(fromDraw*100)/100,
    haemolysisFromMixing: Math.round(fromMixing*100)/100,
    haemolysisGrade: grade,
    haemoconcentration: Math.round(concentration*100)/100,
    carryoverFrom: opt.carryoverFrom || null,
    inversions: opt.inversions || 0,
    clotting: opt.clotting || "none",
    verdict,
    reasons,
    /** the one-line reason a rejected tube is rejected */
    headline: reasons.length ? reasons[0].text : "Accepted for testing.",
  };
}

/* ---------- the whole delivery ------------------------------------------------------ */

/**
 * Every tube this encounter produced, as the lab receives them.
 *
 * @param {object} c   the procedure state (ENC.collect)
 * @param {object} [o] { orders } the tests the requisition asked for
 */
export function assessSpecimens(c, o){
  const opt = o || {};
  const col = c && c.collection;
  const inv = c && c.inversion;
  const invM = c && c.inversionMeasurements;
  const tqSeconds = c && c.tourniquetMeasurements ? c.tourniquetMeasurements.secondsOn : null;
  const gauge = c && c.needleUnit ? c.needleUnit.gauge : 21;
  // A prep field that never dried is alcohol carried in on the needle.
  const cleanM = c && c.cleaningMeasurements;
  const wetAlcohol = !!(cleanM && cleanM.dryingSeconds != null && cleanM.dryingSeconds < 15);
  const shiftM = col ? col.peakShiftM : 0;
  const orders = opt.orders || (c && c.patient ? c.patient.orders : []) || [];

  const keys = col ? col.order : (c && c.tubes) || [];
  const tubes = keys.map(key => {
    const ct = col && col.tubes ? col.tubes[key] : null;
    const it = inv && inv.tubes ? inv.tubes[key] : null;
    const im = invM && invM.tubes ? invM.tubes.find(t => t.key === key) : null;
    return assessTube({
      key,
      drawnMl: ct ? ct.drawnMl : (it ? it.drawnMl : 0),
      volumeMl: ct ? ct.volumeMl : null,
      carryoverFrom: ct && ct.carryover ? ct.carryover.from : (it ? it.carryoverFrom : null),
      inversions: it ? it.inversions : (im ? im.inversions : 0),
      mixHaemolysis: it ? it.haemolysis : (im ? im.haemolysis : 0),
      clotting: it ? it.clotting : (im ? im.clotting : "none"),
      gauge,
      needleShiftM: shiftM,
      wetAlcohol,
      tourniquetSeconds: tqSeconds,
      orders,
    });
  });

  return summariseSpecimens(tubes, orders);
}

/** The receiving summary over an already-assessed set of tubes. */
export function summariseSpecimens(tubes, orders){
  const accepted = tubes.filter(t => t.verdict === VERDICT.ACCEPTED);
  const flagged = tubes.filter(t => t.verdict === VERDICT.FLAGGED);
  const rejected = tubes.filter(t => t.verdict === VERDICT.REJECTED);

  // Which ordered tests actually get a result out of this delivery.
  const lostTests = [];
  for(const t of rejected) for(const name of t.tests) if(lostTests.indexOf(name) < 0) lostTests.push(name);
  const allTests = (orders || []).slice();

  let score = 100;
  score -= rejected.length*34;
  score -= flagged.length*11;
  score = Math.max(0, Math.min(100, Math.round(score)));

  // The same `mistakes` shape every other branch produces, so this feeds the
  // rubric as a measurement rather than needing a special case in it.
  const mistakes = [];
  for(const t of rejected) mistakes.push({
    code: "rejected", item: t.name, critical: true, message: `${t.name} rejected: ${t.headline}`,
  });
  for(const t of flagged) mistakes.push({
    code: "flagged", item: t.name, message: `${t.name} accepted with a comment: ${t.headline}`,
  });
  if(rejected.length) mistakes.push({
    code: "redraw", critical: true,
    message: lostTests.length
      ? `The patient has to be drawn again for ${lostTests.join(", ")}.`
      : "The patient has to be drawn again.",
  });

  const redraw = rejected.length > 0;
  return {
    score,
    mistakes,
    criticalEvents: mistakes.filter(m => m.critical).map(m => m.code),
    tubes,
    total: tubes.length,
    acceptedCount: accepted.length,
    flaggedCount: flagged.length,
    rejectedCount: rejected.length,
    /** the sentence that matters to the patient */
    redrawRequired: redraw,
    lostTests,
    testsOrdered: allTests,
    resultsDelivered: allTests.filter(n => lostTests.indexOf(n) < 0),
    narrative: narrate(tubes, accepted, flagged, rejected, lostTests),
  };
}

function narrate(tubes, accepted, flagged, rejected, lostTests){
  if(!tubes.length) return "No specimens reached the laboratory.";
  const bits = [`${accepted.length} of ${tubes.length} tube${tubes.length === 1 ? "" : "s"} accepted as drawn`];
  if(flagged.length) bits.push(`${flagged.length} accepted with a comment`);
  if(rejected.length) bits.push(`${rejected.length} rejected`);
  let s = bits.join(", ") + ".";
  if(lostTests.length){
    s += ` ${lostTests.join(", ")} cannot be reported from this collection — the patient has to be drawn again.`;
  }
  return s;
}

/** Fold into the encounter's chips, the way every branch does. */
export function applySpecimenOutcome(procedureState, quality){
  if(!procedureState || !quality) return procedureState;
  procedureState.specimenOk = quality.rejectedCount === 0;
  procedureState.specimenQuality = quality;
  return procedureState;
}
