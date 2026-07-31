/* =========================================================================
   THE WINGED SET — clinical judgement for the parts a straight needle does
   not have.

   Three things make this a different procedure rather than a reskin, and
   all three are here:

   1. THE WINGS ARE THE GRIP AND THE ANGLE. A butterfly is held by its wings
      pinched together going in and laid FLAT once the vein is entered. Wings
      still pinched up while tubes are changed hold the tip at the angle it
      entered at, and a 10° tip in a 2mm vein that stays at 10° comes out of
      the lumen the moment anything tugs on it.

   2. THE TUBING IS A LEVER. Everything the other hand does — reaching for a
      tube, pushing one on, letting the holder hang off the edge of the
      chair — travels down 18cm of line to a needle sitting 2mm deep. Taping
      the wings down is what breaks that path, and it is worth about a
      factor of nine.

   3. A HAND VEIN INFILTRATES QUIETLY. The tip leaves the lumen, the flow
      slows rather than stops, and the fluid goes into the tissue. The
      learner has to notice — a swelling that is measured in millilitres and
      a flow that is measured against what this vein should give.

   Pure maths. No DOM, no THREE.
   ========================================================================= */
import { procedureFor, PROCEDURE } from "../procedure.js";

/* ---------- the wings ------------------------------------------------------- */

export const WINGS = {
  PINCHED: "pinched",   // held together, the carrying and inserting grip
  FLAT: "flat",         // laid on the skin, the grip everything after entry needs
  LOOSE: "loose",       // let go of entirely
};

/** Degrees the tip is held at by the wings, over and above the entry angle. */
export function angleHeldBy(wings, entryAngleDeg){
  if(wings === WINGS.FLAT) return Math.min(entryAngleDeg, 4);
  if(wings === WINGS.LOOSE) return entryAngleDeg;
  return entryAngleDeg;                     // pinched holds it where it went in
}

/* ---------- the tubing ------------------------------------------------------ */

/** Slack in metres: how much line is NOT taking any load. */
export function slackOf(tubing){
  return Math.max(0, (tubing.slackM == null ? 0 : tubing.slackM));
}

/** True when the line has no give left and every tug reaches the tip. */
export function isTaut(tubing, spec){
  return slackOf(tubing) <= spec.slackTautM;
}

/**
 * Metres the tip moves for a given disturbance of the line.
 *
 * `pullM` is how far the far end of the line was dragged; `swingDeg` is how
 * far the hanging set swung. Securing the wings is what makes the difference
 * — an unsecured line transfers roughly nine times as much.
 */
export function tipShiftFromTubing(tubing, spec, o){
  const opt = o || {};
  const pullM = Math.max(0, opt.pullM || 0);
  const swingDeg = Math.max(0, opt.swingDeg || 0);
  const secured = !!tubing.secured;
  const transfer = secured ? spec.pullTransferSecured : spec.pullTransferUnsecured;
  // slack absorbs the first part of any pull; a taut line absorbs nothing
  const absorbed = Math.min(pullM, secured ? slackOf(tubing) : slackOf(tubing)*0.5);
  const effective = Math.max(0, pullM - absorbed);
  const fromPull = effective * transfer;
  const fromSwing = swingDeg * spec.swingTransferPerDeg * (secured ? 0.15 : 1);
  return fromPull + fromSwing;
}

/* ---------- infiltration ----------------------------------------------------- */

/**
 * A dorsal hand vein does not stop dead when the tip leaves it. Flow drops
 * to a trickle and the difference goes into the tissue.
 *
 * @param {number} tipOffsetM  metres the tip is outside the lumen wall
 * @param {number} calibreM
 * @returns {{infiltrating:boolean, flowFraction:number, severity:string}}
 */
export function infiltrationFrom(tipOffsetM, calibreM){
  const wall = Math.max(0.0004, (calibreM || 0.0022)*0.5);
  const out = (tipOffsetM || 0) - wall;
  if(out <= 0) return { infiltrating: false, flowFraction: 1, severity: "none" };
  const f = Math.max(0, 1 - out/(wall*1.6));
  return {
    infiltrating: true,
    // it keeps drawing, slowly — which is exactly why it gets missed
    flowFraction: Math.max(0.08, f),
    severity: f > 0.45 ? "early" : "established",
  };
}

/** Millilitres into the tissue for a second of drawing while infiltrated. */
export const INFILTRATE_ML_PER_S = 0.09;
/** Above this the swelling is visible to the learner without being told. */
export const SWELLING_VISIBLE_ML = 0.25;
/** Seconds of infiltration after which "did not notice" is the finding. */
export const NOTICE_WITHIN_S = 6;

/* ---------- judgement --------------------------------------------------------- */

function issue(code, severity, message, data){
  return { code, severity, message, data: data == null ? null : data };
}

/**
 * @param {object} state  butterflyState
 * @param {object} [o]    { collectionDoneMl, requiredMl }
 */
export function evaluateButterfly(state, o){
  const opt = o || {};
  const spec = procedureFor(PROCEDURE.BUTTERFLY_HAND).tubing;
  const issues = [];

  if(!state.wingsHeld) issues.push(issue("wingsNotHeld", "block",
    "The set is not being held. A winged needle carried by its tubing goes in at whatever angle the line happens to hang at."));
  else if(state.entered && state.wings === WINGS.PINCHED) issues.push(issue("wingsStillPinched", "warn",
    "The wings are still pinched up. Once the vein is entered they lie flat on the skin, so the tip stops being held at its entry angle."));

  if(state.entered && !state.secured) issues.push(issue("tubingLoose", "warn",
    "The wings are not taped down. Everything the other hand does travels straight down the line to the tip."));

  if(state.entered && isTaut(state.tubing, spec)) issues.push(issue("tubingTaut", "block",
    "There is no slack left in the line — the set is being held in place by the needle."));

  if(state.infiltratedMl >= SWELLING_VISIBLE_ML && !state.infiltrationNoticed){
    issues.push(issue("infiltrationMissed", "block",
      `The site is swelling — ${Math.round(state.infiltratedMl*100)/100} mL has gone into the tissue and the tube is still on.`));
  }

  if(opt.collectionDoneMl != null && opt.requiredMl != null && opt.collectionDoneMl < opt.requiredMl){
    issues.push(issue("underDrawn", "warn",
      `${Math.round(opt.collectionDoneMl*100)/100} mL collected; this draw needs at least ${opt.requiredMl} mL in one tube to be a specimen at all.`));
  }

  const blocking = issues.filter(i => i.severity === "block");
  return {
    ready: blocking.length === 0 && state.entered,
    issues,
    blocking,
    taut: isTaut(state.tubing, spec),
    slackM: slackOf(state.tubing),
    infiltration: infiltrationFrom(state.tipOffsetM, state.calibreM),
  };
}

/** The single next thing worth doing — Learn mode's prompt. */
export function nextAction(state){
  if(!state.wingsHeld) return "Pinch the wings together and pick the set up by them.";
  if(!state.entered) return "Go in almost flat — 5–15° — with the bevel up.";
  if(state.wings === WINGS.PINCHED) return "Lay the wings flat on the skin.";
  if(!state.secured) return "Tape the wings down before you touch a tube.";
  if(state.infiltratedMl > 0 && !state.infiltrationNoticed) return "The site is swelling. Stop and look at it.";
  return "Hold the wings steady and change tubes with the other hand only.";
}
