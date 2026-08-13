/* =========================================================================
   PHYSICAL STEPS — the 3D, object-manipulation implementations of procedure
   steps. Where an id exists here, the driver uses it INSTEAD of the 2D
   fallback in steps.js.

   The contract is identical to VP_STEPS so the two are interchangeable:
     fn(c, stage, advance) -> optional cleanup()

   Branch 1 implements `gather`. Branches 2–9 add their ids to PHYSICAL_STEPS
   the same way; the driver, the clinical rules and the step sequence stay
   exactly as they are.
   ========================================================================= */
import { LAST } from "../config.js";
import { pick } from "../utils.js";
import { SS, saveSS, guided, reveal } from "../game/gameState.js";
import { difficultyLevel } from "../game/saveSystem.js";
import {
  vigourBonus, tubeVolumeScale, hasVeinFinder, canChooseProcedure, equipmentInEffect,
} from "../game/progression.js";
import { createComplicationState } from "./complications/complicationState.js";
import { VP_TIPS } from "./questions.js";
import { evaluateIntroduction } from "./introduction/introductionRules.js";
import {
  createIntroductionState, say, beginScrub, scrubFor, endScrub, scrubBout,
  dryFor, chooseGloves, reglove, finish as finishIntroduction,
} from "./introduction/introductionState.js";
import { measureIntroduction, applyIntroductionOutcome } from "./introduction/introductionScoring.js";
import { renderIntroductionCoach } from "./introduction/introductionCoach.js";
import { getRenderer } from "../rendering/renderer.js";
import { drawArmFor, difficultyVeinKeys } from "../game/encounter.js";
import { buildSupplyCatalog } from "./staging/supplyCatalog.js";
import { createStagingState, setHandedness, placeItem, inspectItem, HAND, ZONE } from "./staging/stagingState.js";
import { createLayout, orientationForAspect, applyTrayOffset } from "./staging/stagingLayout.js";
import { evaluateStaging } from "./staging/stagingRules.js";
import { measureStaging } from "./staging/stagingScoring.js";
import { renderStagingCoach } from "./staging/stagingCoach.js";
import {
  startStaging, stopStaging, isStagingActive, syncStagingFromState,
  stageItemTo, inspectItemById, returnItemToShelf,
} from "./staging/stagingRuntime.js";
import { stagedItemId, stagedSharpsId } from "./encounterState.js";
import { CATEGORY } from "./staging/supplyCatalog.js";
import {
  createTourniquetState, markRouted, setTension, markCrossed, markSecured, markUnravelled,
  markReleased, isSecured, isOnPatient, secondsOn as tqSecondsOn, WRAP, TUCK,
} from "./tourniquet/tourniquetState.js";
import { evaluateTourniquet } from "./tourniquet/tourniquetRules.js";
import { measureTourniquet, applyTourniquetOutcome } from "./tourniquet/tourniquetScoring.js";
import { renderTourniquetCoach } from "./tourniquet/tourniquetCoach.js";
import {
  startTourniquet, stopTourniquet, isTourniquetActive, currentGesture,
  applyBandProgrammatically, releaseBandProgrammatically, nudgeBand, adjustTension,
  clampBandPosition,
} from "./tourniquet/tourniquetRuntime.js";
import { createPalpationState, recordFeel, chooseVessel } from "./palpation/palpationState.js";
import { evaluatePalpation, feelAt } from "./palpation/palpationRules.js";
import { buildVessels, buildHandVessels, mirrorForArm, applyPatientVariation } from "./arm/armAnatomy.js";
import { procedureFor, indicatedProcedure, PROCEDURE } from "./procedure.js";
import {
  createButterflyState, pickUpByWings, pickUpByTubing, layWingsFlat, releaseWings,
  secureWings, unsecureWings, layTubing, disturb, enter as enterButterfly,
  drawFor as drawButterflyFor, noticeInfiltration, stopForInfiltration, WINGS,
} from "./butterfly/butterflyState.js";
import { evaluateButterfly, nextAction as nextButterflyAction } from "./butterfly/butterflyRules.js";
import { measureButterfly, applyButterflyOutcome } from "./butterfly/butterflyScoring.js";
import {
  wingStatusHTML, infiltrationBannerHTML, wingControlsHTML, postEntryControlsHTML, patchWingLive,
} from "./butterfly/butterflyCoach.js";
import { measurePalpation, applyPalpationOutcome } from "./palpation/palpationScoring.js";
import { renderPalpationCoach } from "./palpation/palpationCoach.js";
import {
  startPalpation, stopPalpation, isPalpationActive, currentTouch,
  markCurrentSite, unmarkSite, palpateVesselById, chooseVesselById,
} from "./palpation/palpationRuntime.js";
import { createCleaningState, openSwab, applySpiral, applyBackAndForth, markRetouched } from "./cleaning/cleaningState.js";
import { secondsDrying } from "./cleaning/cleaningRules.js";
import { FLAW } from "./staging/supplyCatalog.js";
import {
  createAssemblyState, CAP_PLACE,
  peelOpen, tearOpen, liftNeedle, threadIn, backOut, freshNeedle,
  pullCapStraight, wiggleCapOff, pullCap, placeCap, recap, touchNeedle,
  rollBevel, inspectBevel, discardUnit, warnPatient, beginUncap,
} from "./assembly/assemblyState.js";
import { evaluateAssembly, evaluateUncap, bevelFromTurns } from "./assembly/assemblyRules.js";
import {
  measureAssembly, measureUncap, applyAssemblyOutcome, applyUncapOutcome,
} from "./assembly/assemblyScoring.js";
import { renderAssemblyCoach, renderUncapCoach } from "./assembly/assemblyCoach.js";
import {
  startAssembly, stopAssembly, isAssemblyActive, currentUnit,
  peelPouchOpen, liftNeedleBy, threadNeedle, backOutNeedle, takeFreshNeedle,
  pullSheath, placeSheath, recapNeedle, setDownUnit, rollUnit, lookAtBevel,
  discardAndReplace, tellPatient,
} from "./assembly/assemblyRuntime.js";
import {
  createInsertState, resetAnchor, anchorAt, advance as advanceNeedle,
  markFlashIfInVein, insertInto, pullOutCompletely,
} from "./insert/insertState.js";
import { evaluateInsert, anglePresetsFor, anchorPresetsFor } from "./insert/insertRules.js";
import { measureInsert, applyInsertOutcome } from "./insert/insertScoring.js";
import { renderInsertCoach } from "./insert/insertCoach.js";
import {
  startInsert, stopInsert, isInsertActive, currentInsert,
  redoAnchor, anchorProgrammatically, insertProgrammatically,
  advanceProgrammatically, pullOutProgrammatically, getInsertContext,
} from "./insert/insertRuntime.js";
import {
  createCollectionState, takeTube, returnTube, discardTube,
  backOffToGuideline, pushOn, removeTube, flow as flowTube, GRIP,
  collectTubeCleanly,
} from "./collection/collectionState.js";
import { evaluateCollection } from "./collection/collectionRules.js";
import { measureCollection, applyCollectionOutcome } from "./collection/collectionScoring.js";
import { renderCollectionCoach } from "./collection/collectionCoach.js";
import {
  startCollection, stopCollection, isCollectionActive,
  takeTubeProgrammatically, pushOnProgrammatically, backOffProgrammatically,
  removeTubeProgrammatically, returnTubeProgrammatically, discardTubeProgrammatically,
  waitProgrammatically, getCollectionContext,
} from "./collection/collectionRuntime.js";
import { evaluateWithdrawal, modeReady as withdrawalModeReady, DEVICE } from "./withdrawal/withdrawalRules.js";
import {
  createWithdrawalState, relaxFist, markBandReleased,
  takeGauze, placeGauze, withdrawSmoothly, withdrawRoughly,
  slideSafety, activateSafetyCleanly, attemptRecap, setDownUnit as wdSetDownUnit,
  disposeUnit, markCrossedPatient,
} from "./withdrawal/withdrawalState.js";
import { measureWithdrawal, applyWithdrawalOutcome } from "./withdrawal/withdrawalScoring.js";
import { renderWithdrawalCoach } from "./withdrawal/withdrawalCoach.js";
import {
  startWithdrawal, stopWithdrawal, isWithdrawalActive,
  relaxFistProgrammatically, releaseBandProgrammatically as wdReleaseBand,
  takeGauzeProgrammatically, placeGauzeProgrammatically, withdrawProgrammatically,
  slideSafetyProgrammatically, recapProgrammatically, setDownProgrammatically,
  disposeProgrammatically,
} from "./withdrawal/withdrawalRuntime.js";
import {
  evaluatePostDraw, modeReady as postDrawModeReady, SITE_KIND,
} from "./postdraw/postDrawRules.js";
import {
  createPostDrawState, holdPressureFor, flexArm, checkSite,
  applyBandage, removeBandage, giveAftercare,
} from "./postdraw/postDrawState.js";
import { measurePostDraw, applyPostDrawOutcome } from "./postdraw/postDrawScoring.js";
import { renderPostDrawCoach } from "./postdraw/postDrawCoach.js";
import {
  startPostDraw, stopPostDraw, isPostDrawActive,
  pressProgrammatically, holdUntilHaemostasisProgrammatically,
  flexArmProgrammatically, checkSiteProgrammatically,
  bandageProgrammatically, removeBandageProgrammatically, aftercareProgrammatically,
} from "./postdraw/postDrawRuntime.js";
import { evaluateInversion } from "./inversion/inversionRules.js";
import {
  createInversionState, pickUp as pickUpTube, rack as rackTube,
  invertTimes, rockTimes, shakeTimes,
} from "./inversion/inversionState.js";
import { measureInversion, applyInversionOutcome } from "./inversion/inversionScoring.js";
import { renderInversionCoach } from "./inversion/inversionCoach.js";
import {
  startInversion, stopInversion, isInversionActive,
  pickUpProgrammatically, rackProgrammatically, invertProgrammatically,
  invertToRequirementProgrammatically, rockProgrammatically,
  shakeProgrammatically, invertSlowlyProgrammatically,
} from "./inversion/inversionRuntime.js";
import { inversionsFor, mustNotMix } from "./inversion/inversionRules.js";
import { evaluateCleaning } from "./cleaning/cleaningRules.js";
import { measureCleaning, applyCleaningOutcome } from "./cleaning/cleaningScoring.js";
import { renderCleaningCoach } from "./cleaning/cleaningCoach.js";
import {
  startCleaning, stopCleaning, isCleaningActive,
  openSwabPack, scrubSpiral, scrubBackAndForth,
} from "./cleaning/cleaningRuntime.js";

const ZONE_BY_NAME = { tray:ZONE.TRAY, rack:ZONE.RACK, reach:ZONE.REACH, across:ZONE.ACROSS, counter:ZONE.COUNTER };

function handednessOf(){ return SS.handedness===HAND.LEFT ? HAND.LEFT : HAND.RIGHT; }

/**
 * Practice mode's "limited hint": a standing reminder of what this step is
 * FOR. Deliberately the step's static tip and not `nextAction(state)` —
 * telling the learner what is currently wrong with their work is the
 * immediate answer Practice mode is defined by not giving.
 *
 * Learn mode gets the real coaching instead (reveal.instruction), and the
 * Final Practical gets nothing.
 */
function stepHint(c){
  const r = reveal();
  if(!r.hints || r.instruction) return null;
  const id = c && c.steps ? c.steps[c.step] : null;
  const tip = id ? VP_TIPS[id] : null;
  return tip ? `${tip.t}. ${tip.tip}` : null;
}
function viewportOrientation(){
  try{ return orientationForAspect(window.innerWidth/Math.max(1, window.innerHeight)); }
  catch(_){ return orientationForAspect(1.6); }
}

/**
 * Builds (once per encounter) the persistent supply session and keeps it on
 * the procedure state, so re-entering this step — or coming back from a
 * mid-draw interruption — finds the tray exactly as it was left.
 */
/**
 * The introduction session. Built once per encounter and kept on the
 * procedure state, so leaving the step and coming back finds the same
 * conversation rather than starting it over.
 */
export function ensureIntroductionSession(c){
  if(c.introduction) return c.introduction;
  const p = c.patient || {};
  c.introduction = createIntroductionState({
    patient: p,
    tests: (p.orders || []).slice(),
    tubeCount: (c.tubes || []).length || 1,
    // Latex is what is on the tray. Switching to nitrile before gloving is a
    // real decision with a real consequence for the patient who tells you
    // they react to it — and they only tell you if you ask.
    gloveMaterial: "latex",
  });
  return c.introduction;
}

export function ensureSupplySession(c){
  if(c.supplies) return c.supplies;
  const patientName = c.patientName || "This patient";
  const otherPatientName = `${pick(["R.","J.","M.","A.","D."])} ${pick(LAST.filter(n=>!patientName.endsWith(n)))}`;
  const catalog = buildSupplyCatalog({ requiredTubes:c.tubes, patientName, otherPatientName });
  const state = createStagingState({ catalog, requiredTubes:c.tubes, handedness:handednessOf() });
  const layout = createLayout({
    handedness: state.handedness, tubeCount: c.tubes.length,
    shelfCount: catalog.length, orientation: viewportOrientation(),
  });
  c.supplies = { catalog, state, layout, measurements:null };
  return c.supplies;
}

/**
 * The arm this draw happens on, described as geometry rather than prose. Built
 * once per encounter so the tourniquet branch and every branch after it work
 * on the SAME limb — the vein the band raised is the vein that gets palpated,
 * cleaned and punctured.
 */
/**
 * What has gone wrong with this patient, created once per encounter.
 *
 * It has to exist before the arm does, because the arm is built holding a
 * live reference to its `condition` — that is what lets a hematoma raised
 * during the stick still be on the limb three scenes later.
 */
export function ensureComplicationSession(c){
  if(c.complications){
    if(c.encounter && !c.encounter.complications) c.encounter.complications = c.complications;
    return c.complications;
  }
  c.complications = createComplicationState({
    patient: c.patient || {},
    procedureId: c.procedureId || null,
    // The same 0–4 ladder the rest of the game runs on: a busier shift is a
    // shift where more bodies react, not one with a bigger multiplier.
    difficulty: difficultyLevel(),
  });
  if(c.encounter) c.encounter.complications = c.complications;
  return c.complications;
}

export function ensureArmSession(c){
  if(c.arm) return c.arm;
  const p = c.patient || {};
  const a = p.appearance || {};
  const chosen = drawArmFor(p);
  // Which draw this is, decided once and carried for the rest of the
  // encounter — everything from here on reads it rather than re-deciding.
  // `c.forcedProcedure` is the test-seam override; real play always derives
  // it from the arms this patient actually has.
  // Which draw this is. The test seam's override wins; then the learner's own
  // choice, which only exists once the winged-set kit is stocked; and
  // otherwise whatever this patient's arms actually indicate.
  const procedureId = c.forcedProcedure || c.chosenProcedure || indicatedProcedure(p);
  c.indicatedProcedure = indicatedProcedure(p);
  const procedure = procedureFor(procedureId);
  c.procedureId = procedureId;
  c.procedure = procedure;

  const complications = ensureComplicationSession(c);

  c.arm = {
    skin: a.skin,
    shirt: p.shirt,
    /* `appearance.hair` is a STYLE name ("ponytail"); `hairColor` is the hex.
       Passing the style where a colour was wanted made three.js fall back to
       black and log "Unknown color ponytail" on every patient. */
    hair: a.hairColor,
    build: a.width || 1,
    armSide: chosen.side,
    /* Which side of the bench the operator works from. This is the ONLY place
       it is read for the 3D bench: armScene turns it into a mirror of the
       whole scene root, so no individual system can forget to flip. Roughly
       one learner in ten is left-handed and used to be taught a mirrored-wrong
       motor pattern by this game. */
    handedness: handednessOf(),
    scenarioKeys: chosen.keys,
    // A LIVE reference, not a copy: every scene built from here on shows
    // whatever state this arm is currently in, including the damage done to
    // it in an earlier step. See armMesh.js's `condition` note.
    condition: complications.condition,
    conditionSite: { x: procedure.siteX, z: 0 },
    // A dehydrated patient's veins fill less well however good the technique
    // — and a site that was warmed first fills better, which is the whole
    // point of owning the pack.
    vigour: Math.min(1.2, (chosen.keys.indexOf("dry") >= 0 ? 0.72 : 1) * vigourBonus()),
    // The transilluminator does not palpate for the learner; it makes deep
    // veins visible, and `feltChosen` still decides the rubric row.
    veinFinder: hasVeinFinder(),
    // the tourniquet's own target window, in this procedure's terms
    site: {
      x: procedure.siteX, ideal: procedure.bandIdealM, acceptable: procedure.bandAcceptableM,
      label: procedure.siteKind === SITE_KIND.HAND ? "the back of the hand" : "the antecubital fossa",
      windowLabel: procedure.siteKind === SITE_KIND.HAND ? "2–3″" : "3–4″",
    },
  };
  // The vessel geometry is built here rather than only inside the 3D scene, so
  // the rules can be asked about this arm even when no scene is running — the
  // accessible path stops the renderer, and it still has to palpate the same
  // arm and be judged by the same measurements. Which vessel SET depends on
  // the procedure: a butterfly draw palpates, cleans and sticks the dorsal
  // hand network, not the antecubital fossa.
  const rawVessels = procedure.siteKind === SITE_KIND.HAND ? buildHandVessels() : buildVessels();
  // A busier shift is a harder LIMB, not a bigger multiplier: the difficulty
  // ladder adds real anatomy keys — rolling, small, deep, fragile — that the
  // variation function already understands. See encounter.js.
  const hardKeys = c.difficultyKeys || (c.difficultyKeys = difficultyVeinKeys(difficultyLevel()));
  c.arm.scenarioKeys = chosen.keys.concat(hardKeys);
  c.armVessels = applyPatientVariation(
    mirrorForArm(rawVessels, c.arm.armSide),
    { build: c.arm.build, scenarioKeys: c.arm.scenarioKeys, vigour: c.arm.vigour }
  );
  /* THE ARCHETYPE'S OWN OVERRIDES, applied last so they win.
     Every field here is one the rest of the game already reads — a dehydrated
     patient is a lower `vigour`, a child is a smaller `build` — so an
     archetype never becomes a special case anybody has to remember. */
  if(p.armOverrides){
    if(p.armOverrides.vigour != null) c.arm.vigour = Math.min(1.25, c.arm.vigour*p.armOverrides.vigour);
    if(p.armOverrides.build != null) c.arm.build = p.armOverrides.build;
    if(p.armOverrides.bleedFactor != null) c.bleedFactor = p.armOverrides.bleedFactor;
  }
  c.equipment = equipmentInEffect();
  return c.arm;
}

/**
 * The strap itself, created once and carried for the whole encounter. The
 * release step later in the procedure inherits THIS object — it is the same
 * band, not a second one drawn to look like it.
 */
export function ensureTourniquetSession(c){
  if(c.tourniquet) return c.tourniquet;
  c.tourniquet = createTourniquetState({
    itemId: c.encounter ? stagedItemId(c.encounter, CATEGORY.TOURNIQUET) : null,
    armSide: ensureArmSession(c).armSide,
    vigour: ensureArmSession(c).vigour,
  });
  if(c.encounter) c.encounter.tourniquet = c.tourniquet;
  return c.tourniquet;
}

/** The prepped field for this encounter — created once, carried onward. */
export function ensureCleaningSession(c){
  if(c.cleaning) return c.cleaning;
  c.cleaning = createCleaningState();
  return c.cleaning;
}

/** The catalog entry for whatever the learner actually staged in a category. */
function stagedDef(c, category){
  if(!c.supplies || !c.encounter) return null;
  const id = stagedItemId(c.encounter, category);
  if(!id) return null;
  return c.supplies.catalog.find(d=>d.id === id) || null;
}

/**
 * The needle + holder as one unit, created once and carried for the rest of
 * the encounter. The uncap step inherits THIS object — including where the
 * bevel ended up pointing when the threading stopped — and the insert step
 * after it inherits the same one again.
 *
 * The needle it is built from is the needle they actually staged: a split
 * pouch or a 25G chosen back at the cart turns up here, in the hand, rather
 * than as a line in a report afterwards.
 */
export function ensureAssemblySession(c){
  if(c.needleUnit) return c.needleUnit;
  const procedure = ensureArmSession(c) && c.procedure;
  const needle = stagedDef(c, CATEGORY.NEEDLE);
  const holder = stagedDef(c, CATEGORY.HOLDER);
  c.needleUnit = createAssemblyState({
    needleItemId: needle ? needle.id : null,
    holderItemId: holder ? holder.id : null,
    gauge: needle && needle.gauge ? needle.gauge : procedure.gauge,
    pouchCompromised: !!(needle && needle.flaws && needle.flaws.indexOf(FLAW.DAMAGED) >= 0),
    // how long the alcohol had already been evaporating when they started —
    // the whole reason this step happens here rather than earlier
    dryElapsedAtStart: c.cleaning && c.cleaning.strokes ? secondsDrying(c.cleaning) : null,
  });
  if(c.encounter) c.encounter.assembly = c.needleUnit;
  return c.needleUnit;
}

/**
 * The stick itself, created once and carried for the rest of the encounter.
 * It works on the vein palpation marked and the needle assembly/uncap built —
 * neither is re-chosen here, both are inherited exactly as they were left.
 */
export function ensureInsertSession(c){
  if(c.insert) return c.insert;
  ensureArmSession(c);
  const unit = ensureAssemblySession(c);
  // Reached directly (a resumed draw, or the test seam jumping straight in)
  // without ever finishing assembly/uncap: the same defensive fallback the
  // uncap step itself needs, so insertion never operates on a capped or
  // untested needle even when the earlier steps were skipped.
  if(!unit.engaged){ peelOpen(unit); liftNeedle(unit, "sheath"); threadIn(unit, 2.5, 0); }
  if(unit.capOn){
    pullCapStraight(unit);
    rollBevel(unit, -(unit.bevelDeg == null ? bevelFromTurns(unit.turns) : unit.bevelDeg));
    inspectBevel(unit);
    warnPatient(unit);
  }
  const site = c.site || {};
  // A palpation-less jump straight to insert (a resumed draw, or the test
  // seam) has to default to SOME vein — the procedure's own preferred one,
  // never a name hard-coded to the antecubital set.
  const preferredVessel = (c.armVessels || []).find(v => v.preferred) || (c.armVessels || [])[0];
  const chosenId = site.vesselId || (preferredVessel ? preferredVessel.id : "median-cubital");
  let mark = site.mark;
  if(!mark){
    const v = (c.armVessels || []).find(x => x.id === chosenId);
    const m = v ? v.path[Math.floor(v.path.length/2)] : { x: 0, z: 0 };
    mark = { x: m.x, z: m.z };
  }
  c.insert = createInsertState({ chosenId, markX: mark.x, markZ: mark.z });
  if(c.encounter) c.encounter.access = c.insert;
  return c.insert;
}

/**
 * The winged set as a physical object — created once, alongside the insert
 * session, and carried into the collection step: the wings are how it is
 * held going in, the tubing is what tube changes tug on afterward. Only
 * created for the butterfly/dorsal-hand procedure; every other draw simply
 * never has a `c.butterfly`.
 */
export function ensureButterflySession(c){
  if(c.butterfly) return c.butterfly;
  const procedure = ensureArmSession(c) && c.procedure;
  if(procedure.device !== DEVICE.BUTTERFLY) return null;
  const ins = ensureInsertSession(c);
  const vessel = (c.armVessels || []).find(v => v.id === ins.chosenId) || null;
  c.butterfly = createButterflyState({
    gauge: c.needleUnit ? c.needleUnit.gauge : procedure.gauge,
    calibreM: vessel ? vessel.calibre : 0.0020,
  });
  return c.butterfly;
}

/**
 * The tubes for this encounter — created once, carried through both the fill
 * and the switch step, because they are one continuous piece of work on one
 * holder that is already in the patient.
 *
 * Everything it needs is inherited, never re-chosen: the vein is the one
 * palpation marked and insert actually landed in, the gauge is the needle
 * they staged, the patient's filling is the same `vigour` the tourniquet
 * branch has been using, and whether there is any access at all is whatever
 * the insert step ended with.
 */
export function ensureCollectionSession(c){
  if(c.collection) return c.collection;
  const ins = ensureInsertSession(c);
  const unit = ensureAssemblySession(c);
  const arm = ensureArmSession(c);
  const vessel = (c.armVessels || []).find(v => v.id === ins.chosenId) || null;
  // Reached directly (a resumed draw, or the test seam jumping straight in)
  // without the insert step ever having run: the same defensive fallback
  // ensureInsertSession itself needs for assembly/uncap, so a tube is never
  // put on a holder that was never in a vein. A stick that DID happen and
  // missed is left exactly as it was — that is a real outcome, not a gap.
  if(ins.entryX == null && !ins.flashAt && vessel){
    const ap = anchorPresetsFor(c.procedure.anchor), gp = anglePresetsFor(c.procedure.angle);
    anchorAt(ins, ins.markX - ap.idealM, ap.pullGoodM);
    insertInto(ins, ins.markX, ins.markZ, gp.ideal, vessel.depth);
    markFlashIfInVein(ins, vessel, Date.now());
  }
  const m = c.insertMeasurements;
  c.collection = createCollectionState({
    order: c.tubes || [],
    vessel,
    gauge: unit.gauge,
    vigour: arm.vigour,
    // Paediatric stock, if the learner owns it: a smaller vacuum a narrow
    // vein can actually supply, rather than a smaller number on a report.
    volumeScale: tubeVolumeScale(),
    // a stick that never landed in the vein is a stick nothing will flow
    // through — the tube step inherits that rather than starting afresh
    inVein: m ? !!m.inVein && !m.throughAndThrough : !!ins.flashAt,
  });
  if(c.encounter) c.encounter.collection = c.collection;
  return c.collection;
}

/** Seconds the band has been on the arm, for this step's own measurements. */
function tourniquetSecondsFor(c){
  return c.tourniquet ? tqSecondsOn(c.tourniquet) : null;
}

/**
 * The end of the draw as one piece of work — created once and carried across
 * the release, withdraw, safety and dispose steps, exactly as the collection
 * state is carried across fill and switch.
 *
 * Everything it needs is inherited, never re-chosen: the band is the strap
 * the tourniquet step secured, the entry line is the one insert fixed when
 * the skin was broken, the gauze and the sharps container are the ones the
 * learner actually staged back at the cart.
 */
export function ensureWithdrawalSession(c){
  if(c.withdrawal) return c.withdrawal;
  ensureArmSession(c);
  const tq = ensureTourniquetSession(c);
  // Reached directly (a resumed draw, or the test seam jumping straight in)
  // with a band that was never applied at all: one was applied off-screen —
  // but a band the learner genuinely took off early stays off, because that
  // is a real state of the arm, not a gap.
  if(tq.attempts === 0 && !tq.releasedAt){
    const site = ensureArmSession(c).site;
    const bandX = site.x + (site.ideal.min + site.ideal.max)/2;
    markRouted(tq, { bandX, wrap: WRAP.UNDER, skew: 0 });
    setTension(tq, 0.55);
    markCrossed(tq);
    markSecured(tq, { tuck: TUCK.PROXIMAL, tuckedUnder: true });
  }
  const ins = ensureInsertSession(c);
  const col = ensureCollectionSession(c);
  // The same defensive fallback the earlier ensure* functions use, and with
  // the same strict condition: only when the collection step genuinely never
  // ran — no tube was ever so much as picked up — were the tubes filled
  // off-screen. A collection that DID happen keeps exactly what it produced.
  // That distinction matters: a learner who left a tube still engaged on the
  // holder must arrive here with it still engaged, because "there is a tube
  // on the holder" is precisely what the withdrawal rules have to catch. A
  // blanket "finish anything unfinished" would quietly do the work for them
  // and delete the mistake.
  if(col.takenSequence.length === 0){
    for(const key of col.order) collectTubeCleanly(col, key, { tourniquetOn: true });
  }
  const gauzeDef = stagedDef(c, CATEGORY.GAUZE);
  const binId = c.encounter ? stagedSharpsId(c.encounter) : null;
  c.withdrawal = createWithdrawalState({
    device: c.procedure.device,
    angleDeg: ins.angleDeg == null ? anglePresetsFor(c.procedure.angle).ideal : ins.angleDeg,
    depthDir: ins.depthDir,
    entryX: ins.entryX == null ? ins.markX : ins.entryX,
    entryZ: ins.entryZ == null ? ins.markZ : ins.entryZ,
    depthM: Math.max(0.002, (ins.depthM || 0) + (col.needleDeeperM || 0)),
    vessel: col.vessel,
    inVein: col.inVein && !col.needleOut,
    gauze: gauzeDef
      ? { itemId: gauzeDef.id, clean: !(gauzeDef.flaws && gauzeDef.flaws.length) }
      : { itemId: null, clean: true },
    bin: { itemId: binId, available: !!binId },
  });
  if(c.encounter) c.encounter.disposal = c.withdrawal;
  return c.withdrawal;
}

/**
 * Patient care after the sharp is gone — created once and carried across both
 * the pressure and the bandage step, as one continuous piece of work.
 *
 * Everything it needs is inherited: the puncture is the one insert made, the
 * vein is the one it went into, the pad is the gauze the withdrawal step put
 * in the learner's hand, and whether this patient bleeds more comes from
 * explicit trigger data on their own event rather than from any text.
 */
export function ensurePostDrawSession(c){
  if(c.postDraw) return c.postDraw;
  const wd = ensureWithdrawalSession(c);
  const col = ensureCollectionSession(c);
  const ins = ensureInsertSession(c);
  // Reached directly (a resumed draw, or the test seam jumping straight in)
  // with the needle still in the arm: it came out off-screen. A withdrawal
  // that DID happen keeps exactly what it produced, band still on and all.
  if(wd.withdrawnAt == null){
    if(c.tourniquet && isOnPatient(c.tourniquet)) markReleased(c.tourniquet, { byTail: true });
    markBandReleased(wd, { byTail: true, collectionDone: true });
    takeGauze(wd, { itemId: wd.gauzeItemId, clean: wd.gauzeClean });
    placeGauze(wd, { offsetM: 0.012, pressing: false });
    withdrawSmoothly(wd, { tubeOn: false, tourniquetOn: false });
    activateSafetyCleanly(wd);
    disposeUnit(wd, { target: "sharps", fully: true });
  }
  const bandageDef = stagedDef(c, CATEGORY.BANDAGE);
  const patientEvent = c.patient && c.patient.event;
  c.postDraw = createPostDrawState({
    // The butterfly/dorsal-hand procedure passes SITE_KIND.HAND here, with
    // its own lower force band; the straight-needle draw passes the fossa.
    siteKind: c.procedure.siteKind,
    vessel: col.vessel,
    gauge: c.needleUnit ? c.needleUnit.gauge : c.procedure.gauge,
    // explicit trigger data, never inferred from the words in the dialogue
    anticoagulated: !!(patientEvent && patientEvent.anticoagulated),
    withdrawnAt: wd.withdrawnAt,
    tourniquetOnAtWithdraw: !!wd.tourniquetOnAtWithdraw,
    gauze: { itemId: wd.gauzeItemId, clean: wd.gauzeClean },
    bandage: bandageDef
      ? { itemId: bandageDef.id, clean: !(bandageDef.flaws && bandageDef.flaws.length) }
      : { itemId: null, clean: true },
  });
  c.postDrawSite = {
    x: ins.entryX == null ? ins.markX : ins.entryX,
    z: ins.entryZ == null ? ins.markZ : ins.entryZ,
  };
  if(c.encounter) c.encounter.aftercare = c.postDraw;
  return c.postDraw;
}

/**
 * The specimens, once they are off the patient — created once from what the
 * collection step actually produced, so a short or contaminated tube arrives
 * here still short and still contaminated, and each tube's delay is measured
 * from the moment it genuinely came off the holder.
 */
export function ensureInversionSession(c){
  if(c.inversion) return c.inversion;
  const col = ensureCollectionSession(c);
  // The same defensive fallback the earlier ensure* functions use, with the
  // same strict condition: only when the collection step never ran at all.
  if(col.takenSequence.length === 0){
    for(const key of col.order) collectTubeCleanly(col, key, { tourniquetOn: true });
  }
  const collected = {};
  for(const key of col.order){
    const t = col.tubes[key];
    collected[key] = {
      drawnMl: t ? t.drawnMl : 0,
      volumeMl: t ? t.volumeMl : null,
      removedAt: t && t.removedAt ? t.removedAt : Date.now(),
      carryoverFrom: t && t.carryover ? t.carryover.from : null,
    };
  }
  c.inversion = createInversionState({ order: col.order, collected });
  if(c.encounter) c.encounter.specimens = c.inversion;
  return c.inversion;
}

/** The fingers' record for this encounter — created once, carried onward. */
export function ensurePalpationSession(c){
  if(c.palpation) return c.palpation;
  c.palpation = createPalpationState();
  return c.palpation;
}

export const PHYSICAL_STEPS = {
  /* -----------------------------------------------------------------------
     INTRODUCE — the one step conducted in speech rather than in objects.

     There is no `introductionRuntime.js` and no scene: what the learner
     manipulates is a conversation and a sink, and there is nothing to
     raycast against. The rule that matters is unchanged — every technique
     is a pure helper in `introductionState.js`, and both the held rub and
     the "rub for 20 seconds" control call the same ones.
     ----------------------------------------------------------------------- */
  introduce(c, stage, advance){
    const session = ensureIntroductionSession(c);
    let disposed = false, raf = 0, last = 0, rubbing = false;

    const evaluate = ()=>evaluateIntroduction(session);

    function draw(){
      if(disposed) return;
      renderIntroductionCoach(stage, {
        state: session,
        result: evaluate(),
        guided: guided(), reveal: reveal(), hint: stepHint(c),
        gate: reveal().gateContinue,
        handlers: {
          onAct: (id)=>{ say(session, id); draw(); },
          onScrub: (secs)=>{ scrubBout(session, secs); draw(); },
          onGloveMaterial: (m)=>{ chooseGloves(session, m); draw(); },
          onReglove: ()=>{ reglove(session); draw(); },
          onRubStart: ()=>{ if(rubbing) return; rubbing = true; beginScrub(session); },
          onRubEnd: ()=>{ if(!rubbing) return; rubbing = false; endScrub(session); draw(); },
          onReady: finish,
        },
      });
    }

    /* The two clocks that only run while this step is on screen: the rub
       itself, and the drying that has to happen before gloves go on. Driven
       from `performance.now()`, not `e.timeStamp` — the latter is not the
       wall clock for synthesised events, and here the interval IS the
       measurement. The coach's signature gate turns these frame-by-frame
       draws into a `[data-live]` patch, so the held button is never
       destroyed under the hand holding it. */
    function tick(){
      if(disposed) return;
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      const dt = Math.min(0.25, (now - last)/1000);
      last = now;
      if(rubbing) scrubFor(session, dt);
      else dryFor(session, dt);
      draw();
    }

    function finish(){
      const result = evaluate();
      if(reveal().gateContinue && !result.ready) return;
      finishIntroduction(session);
      applyIntroductionOutcome(c, measureIntroduction(session, result));
      advance();
    }

    draw();
    last = performance.now();
    raf = requestAnimationFrame(tick);
    return ()=>{ disposed = true; if(raf) cancelAnimationFrame(raf); };
  },

  gather(c, stage, advance){
    const session = ensureSupplySession(c);
    const canRender3d = !!getRenderer();
    let listView = !canRender3d || !!SS.stagingListView;
    let inspecting = null;
    let disposed = false;

    const evaluate = ()=>evaluateStaging(session.state, session.catalog);

    function draw(result){
      if(disposed) return;
      renderStagingCoach(stage, {
        state: session.state,
        catalog: session.catalog,
        result: result || evaluate(),
        inspecting, listView, canRender3d,
        guided: guided(), reveal: reveal(), hint: stepHint(c),
        handlers: {
          onReady: finish,
          onToggleHandedness: toggleHandedness,
          onToggleView: toggleView,
          onInspect: (id)=>draw(doInspect(id)),
          onStage: (id, zone, slot)=>draw(doStage(id, ZONE_BY_NAME[zone] || ZONE.TRAY, slot)),
          onReturn: (id)=>draw(doReturn(id)),
        },
      });
    }

    /* --- one write path, whichever input the learner is using ------------- */
    function doInspect(id){
      if(isStagingActive()) return inspectItemById(id);
      inspectItem(session.state, id);
      return evaluate();
    }
    function doStage(id, zone, slot){
      if(isStagingActive()) return stageItemTo(id, zone, slot);
      placeItem(session.state, id, zone, slot!=null ? { slot } : {});
      return evaluate();
    }
    function doReturn(id){
      if(isStagingActive()) return returnItemToShelf(id);
      placeItem(session.state, id, ZONE.SHELF, {});
      return evaluate();
    }

    function relayout(handedness, orientation){
      session.layout = createLayout({
        handedness, tubeCount:c.tubes.length,
        shelfCount:session.catalog.length, orientation,
      });
      applyTrayOffset(session.layout, session.state.trayOffset);
      if(isStagingActive()){
        stopStaging();                       // rebuild the cart around the new layout
        launch3d().then(()=>draw());
      }else draw();
    }

    function toggleHandedness(){
      const next = session.state.handedness===HAND.LEFT ? HAND.RIGHT : HAND.LEFT;
      setHandedness(session.state, next);
      SS.handedness = next; saveSS();
      relayout(next, session.layout.orientation);
    }

    function toggleView(){
      listView = !listView;
      SS.stagingListView = listView; saveSS();
      if(listView){ stopStaging(); draw(); }
      else launch3d().then(()=>draw());
    }

    async function launch3d(){
      if(!canRender3d || listView || disposed) return;
      await startStaging({
        catalog: session.catalog,
        state: session.state,
        layout: session.layout,
        requiredTubes: c.tubes,
        assistedSnapping: !!SS.assistedSnapping,
        onChange: (result)=>draw(result),
        onInspect: (def, revealed)=>{ inspecting = def ? { def, revealed } : null; draw(); },
        onOrientationChange: (orientation)=>relayout(session.state.handedness, orientation),
      });
      if(disposed){ stopStaging(); return; }
      syncStagingFromState();
    }

    function finish(){
      const result = evaluate();
      // Teaching mode walks the learner to a correct tray before the draw can
      // start. A scored shift lets them commit to whatever they prepared — the
      // consequences and the assessment come after the patient, not before.
      if(reveal().gateContinue && !result.ready) return;
      session.state.completedAt = Date.now();
      session.measurements = measureStaging(session.state, session.catalog, result);
      c.gatherOk = result.ready;   // honest on the recap chips, even when the learner chose to proceed anyway
      c.stagingMeasurements = session.measurements;
      if(c.encounter){
        c.encounter.supplies = session;
        c.encounter.measurements.supplyStaging = session.measurements;
      }
      cleanup();
      advance();
    }

    function cleanup(){
      disposed = true;
      stopStaging();
      try{ delete document.body.dataset.staging; }catch(_){}
    }

    // On a phone the coach panel is a bottom sheet that can claim 62% of the
    // screen. During staging the cart needs that room more than the prose does.
    try{ document.body.dataset.staging = "on"; }catch(_){}
    draw();
    launch3d();
    return cleanup;
  },

  /* ---------------------------------------------------------------------------
     TOURNIQUET — the band is routed under the arm, tensioned, crossed and
     tucked as one continuous gesture, and then it STAYS THERE. There is no
     "tourniquet screen" to leave: the strap is on the patient from here until
     the release step pulls it off, and the clock it starts is the same clock
     that step reads.
     ------------------------------------------------------------------------ */
  tourniquet(c, stage, advance){
    const arm = ensureArmSession(c);
    const tqState = ensureTourniquetSession(c);
    // The 3D scene always builds the forearm vessel set (armMesh.js has no
    // dorsal-hand geometry) and, on the straight-needle draw, feeds it back
    // onto `c.armVessels` as a harmless no-op — the two are numerically
    // identical there. For a hand draw that overwrite would silently clobber
    // the hand vessel set ensureArmSession() already put there, corrupting
    // what palpation sees next. Controls-only sidesteps it entirely.
    const isHandDraw = c.procedure.siteKind === SITE_KIND.HAND;
    const canRender3d = !isHandDraw && !!getRenderer();
    let listView = !canRender3d || !!SS.tourniquetListView;
    let disposed = false;

    const evaluate = ()=>evaluateTourniquet(tqState, { vessels:(c.armVessels||[]), vigour:arm.vigour, site:arm.site });

    function draw(result){
      if(disposed) return;
      renderTourniquetCoach(stage, {
        state: tqState,
        result: result || liveResult(),
        gesture: isTourniquetActive() ? currentGesture() : null,
        site: arm.site,
        guided: guided(), reveal: reveal(), hint: stepHint(c),
        listView, canRender3d,
        handlers: {
          onReady: finish,
          onToggleView: toggleView,
          onApply: (spec)=>draw(doApply(spec)),
          onRemove: ()=>draw(doRemove()),
          onNudge: (m)=>draw(doNudge(m)),
          onTension: (d)=>draw(doTension(d)),
        },
      });
    }

    // Off the 3D path there are no vessel objects to measure against, so the
    // rules get the same arm description either way.
    function liveResult(){
      return isTourniquetActive() ? evaluateTourniquet(tqState, currentArm()) : evaluate();
    }
    function currentArm(){
      return { vessels: c.armVessels || [], vigour: arm.vigour, site: arm.site };
    }

    function doApply(spec){
      if(isTourniquetActive()) return applyBandProgrammatically(spec);
      // list-view-only path (no renderer at all): the same state transitions,
      // in the same order, so the same measurements come out the other end
      markRouted(tqState, { bandX:spec.bandX, wrap:spec.wrap, skew:spec.skew||0 });
      setTension(tqState, spec.tension);
      markCrossed(tqState);
      markSecured(tqState, { tuck:spec.tuck, tuckedUnder:true });
      return evaluate();
    }
    function doRemove(){
      if(isTourniquetActive()) return releaseBandProgrammatically();
      markUnravelled(tqState);
      return evaluate();
    }
    // Switching to the controls tears the 3D scene down, so these cannot go
    // through the runtime — without a state-side path the accessible route
    // could apply a band but never adjust one, which is precisely the fine
    // correction ("a bit higher", "not so tight") it exists to allow.
    function doNudge(metres){
      if(isTourniquetActive()) return nudgeBand(metres) || liveResult();
      if(tqState.bandX == null) return evaluate();
      tqState.bandX = clampBandPosition(tqState.bandX + metres);
      return evaluate();
    }
    function doTension(delta){
      if(isTourniquetActive()) return adjustTension(delta) || liveResult();
      if(!isSecured(tqState)) return evaluate();
      setTension(tqState, tqState.heldTension + delta);
      tqState.heldTension = tqState.tension;
      return evaluate();
    }

    async function launch3d(){
      if(!canRender3d || listView || disposed) return;
      const ctx = await startTourniquet({
        state: tqState,
        arm,
        guided: guided(), reveal: reveal(), hint: stepHint(c),
        onChange: (result)=>draw(result),
      });
      if(disposed){ stopTourniquet(); return; }
      // hand the real vessel geometry to the rules, so clearance checks are
      // measured against the arm actually on screen
      if(ctx && ctx.view) c.armVessels = ctx.view.arm.vessels;
      draw();
    }

    function toggleView(){
      listView = !listView;
      SS.tourniquetListView = listView; saveSS();
      if(listView){ stopTourniquet(); draw(); }
      else launch3d().then(()=>draw());
    }

    function finish(){
      const result = liveResult();
      // Teaching mode will not start a draw on a band that is wrong. A scored
      // shift lets the learner commit — and the arm, the sample and the recap
      // all carry the consequence.
      if(reveal().gateContinue && !result.ready) return;
      const measurements = measureTourniquet(tqState, result, undefined, arm.site);
      applyTourniquetOutcome(c, measurements);
      // The clock the release step reads is this band's, not a fresh timer.
      c.tqStart = tqState.securedAt || performance.now();
      if(c.encounter){
        c.encounter.tourniquet = tqState;
        c.encounter.measurements.tourniquet = measurements;
      }
      cleanupOnly();
      advance();
    }

    // Leaving the step must NOT take the band off the patient — that is the
    // whole point of the branch. Only the scene is torn down.
    function cleanupOnly(){
      disposed = true;
      stopTourniquet();
      try{ delete document.body.dataset.staging; }catch(_){}
    }

    try{ document.body.dataset.staging = "on"; }catch(_){}
    draw();
    launch3d();
    return cleanupOnly;
  },

  /* ---------------------------------------------------------------------------
     PALPATE — find the vein with your fingers, on the same arm, with the same
     band still on it. Nothing is labelled: press, and what comes back depends
     on what is under the finger and how hard you are leaning on it.
     ------------------------------------------------------------------------ */
  palpate(c, stage, advance){
    const arm = ensureArmSession(c);
    const palp = ensurePalpationSession(c);
    // Choosing a vein means feeling the vessels that are actually on this
    // draw's arm. The 3D scene only ever renders the forearm set, so for the
    // hand procedure it would show the wrong anatomy entirely rather than a
    // merely imperfect one — controls-only avoids that, the same call as
    // the tourniquet step just above.
    const isHandDraw = c.procedure.siteKind === SITE_KIND.HAND;
    const canRender3d = !isHandDraw && !!getRenderer();
    let listView = !canRender3d || !!SS.palpationListView;
    let disposed = false;
    let touch = null;

    const evaluate = ()=>evaluatePalpation(palp, c.armVessels || []);

    function draw(result, live){
      if(disposed) return;
      if(live !== undefined) touch = live;
      renderPalpationCoach(stage, {
        state: palp,
        result: result || evaluate(),
        touch: touch || (isPalpationActive() ? currentTouch() : null),
        vessels: c.armVessels,
        guided: guided(), reveal: reveal(), hint: stepHint(c),
        listView, canRender3d,
        handlers: {
          onReady: finish,
          onToggleView: toggleView,
          onMark: ()=>draw(markCurrentSite() || evaluate()),
          onUnmark: ()=>draw(unmarkSite() || evaluate()),
          onPress: (id, press)=>draw(doPress(id, press)),
          onChoose: (id)=>draw(doChoose(id)),
        },
      });
    }

    // Switching to the controls tears the 3D scene down, so these cannot go
    // through the runtime. They press the SAME vessels through the SAME
    // feelAt(), so the same things get recorded and the same rules judge them
    // — the accessible path is another way in, not an easier game.
    function vesselMid(id){
      const v = (c.armVessels || []).find(x=>x.id === id);
      return v ? { v, m: v.path[Math.floor(v.path.length/2)] } : null;
    }
    function doPress(id, press){
      if(isPalpationActive()) return palpateVesselById(id, press) || evaluate();
      const hit = vesselMid(id);
      if(!hit) return evaluate();
      const p = press == null ? 0.62 : press;
      recordFeel(palp, feelAt(c.armVessels, hit.m.x, hit.m.z, p), p, 260);
      return evaluate();
    }
    function doChoose(id){
      if(isPalpationActive()) return chooseVesselById(id) || evaluate();
      const hit = vesselMid(id);
      if(!hit) return evaluate();
      chooseVessel(palp, id, { x: hit.m.x, z: hit.m.z });
      return evaluate();
    }

    async function launch3d(){
      if(!canRender3d || listView || disposed) return;
      const ctx = await startPalpation({
        state: palp,
        arm,
        // the band applied in the previous step is still on this arm, and the
        // veins it raised are the veins being felt for
        tourniquet: c.tourniquet,
        onChange: (result, found, press)=>draw(result, currentTouch()),
      });
      if(disposed){ stopPalpation(); return; }
      if(ctx && ctx.view) c.armVessels = ctx.view.arm.vessels;
      draw();
    }

    function toggleView(){
      listView = !listView;
      SS.palpationListView = listView; saveSS();
      if(listView){ stopPalpation(); draw(); }
      else launch3d().then(()=>draw());
    }

    function finish(){
      const result = evaluate();
      if(reveal().gateContinue && !result.ready) return;
      const measurements = measurePalpation(palp, result, c.armVessels || []);
      applyPalpationOutcome(c, measurements);
      // The vein found here is the vein every later step works on.
      c.site = { vesselId: palp.chosenId, mark: palp.mark };
      if(c.encounter){
        c.encounter.site = c.site;
        c.encounter.measurements.palpation = measurements;
      }
      cleanupOnly();
      advance();
    }

    function cleanupOnly(){
      disposed = true;
      stopPalpation();
      try{ delete document.body.dataset.staging; }catch(_){}
    }

    try{ document.body.dataset.staging = "on"; }catch(_){}
    draw();
    launch3d();
    return cleanupOnly;
  },

  /* ---------------------------------------------------------------------------
     CLEAN — scrub the site the fingers just found, on the same arm. Coverage
     is painted onto the skin as it happens, so what has actually been
     disinfected is visible rather than inferred from a distance travelled.
     ------------------------------------------------------------------------ */
  clean(c, stage, advance){
    const arm = ensureArmSession(c);
    const clean = ensureCleaningSession(c);
    const canRender3d = !!getRenderer();
    let listView = !canRender3d || !!SS.cleaningListView;
    let disposed = false;

    const evaluate = ()=>evaluateCleaning(clean);

    function draw(result){
      if(disposed) return;
      renderCleaningCoach(stage, {
        state: clean,
        result: result || evaluate(),
        guided: guided(), reveal: reveal(), hint: stepHint(c),
        listView, canRender3d,
        handlers: {
          onReady: finish,
          onToggleView: toggleView,
          onOpen: ()=>draw(doOpen()),
          onScrub: (kind)=>draw(doScrub(kind)),
        },
      });
    }

    function doOpen(){
      if(isCleaningActive()) return openSwabPack() || evaluate();
      openSwab(clean);
      return evaluate();
    }
    // The controls tear the 3D scene down, so these cannot go through the
    // runtime — but they run the SAME pure technique helpers it does, so the
    // coverage, direction and friction that come out are identical.
    function doScrub(kind){
      const spec = kind === "backforth" ? null
                 : kind === "spiral-small" ? { turns:3, frac:0.55 }
                 : { turns:5, frac:1 };
      if(isCleaningActive()){
        return (spec ? scrubSpiral(spec.turns, spec.frac) : scrubBackAndForth(1)) || evaluate();
      }
      if(spec) applySpiral(clean, spec.turns, spec.frac);
      else applyBackAndForth(clean, 1);
      return evaluate();
    }

    async function launch3d(){
      if(!canRender3d || listView || disposed) return;
      await startCleaning({
        state: clean,
        arm,
        tourniquet: c.tourniquet,
        // the field is centred on the vein the fingers actually marked
        site: c.site,
        onChange: (result)=>draw(result),
      });
      if(disposed){ stopCleaning(); return; }
      draw();
    }

    function toggleView(){
      listView = !listView;
      SS.cleaningListView = listView; saveSS();
      if(listView){ stopCleaning(); draw(); }
      else launch3d().then(()=>draw());
    }

    function finish(){
      const result = evaluate();
      if(reveal().gateContinue && !result.ready) return;
      const measurements = measureCleaning(clean, result);
      applyCleaningOutcome(c, measurements);
      if(c.encounter) c.encounter.measurements.cleaning = measurements;
      cleanupOnly();
      advance();
    }

    function cleanupOnly(){
      disposed = true;
      stopCleaning();
      try{ delete document.body.dataset.staging; }catch(_){}
    }

    try{ document.body.dataset.staging = "on"; }catch(_){}
    draw();
    launch3d();
    return cleanupOnly;
  },

  /* ---------------------------------------------------------------------------
     ASSEMBLE — thread the needle they staged into the holder they staged, at
     the bench, while the site they just cleaned air-dries in the same frame.
     The unit built here is carried onward: uncap takes the sheath off THIS
     needle, and where its bevel points was decided by where this threading
     stopped.
     ------------------------------------------------------------------------ */
  assemble(c, stage, advance){
    const arm = ensureArmSession(c);
    const unit = ensureAssemblySession(c);
    const canRender3d = !!getRenderer();
    let listView = !canRender3d || !!SS.assemblyListView;
    let disposed = false;

    const evaluate = ()=>evaluateAssembly(unit);

    function draw(result){
      if(disposed) return;
      renderAssemblyCoach(stage, {
        state: unit,
        result: result || evaluate(),
        unit: isAssemblyActive() ? currentUnit() : null,
        guided: guided(), reveal: reveal(), hint: stepHint(c),
        listView, canRender3d,
        handlers: {
          onReady: finish,
          onToggleView: toggleView,
          onAction: (kind)=>draw(doAction(kind)),
        },
      });
    }

    // The controls tear the 3D scene down, so these cannot go through the
    // runtime — but they run the SAME pure technique helpers it does, so the
    // turns, the alignment and the sterility that come out are identical.
    function doAction(kind){
      if(isAssemblyActive()){
        switch(kind){
          case "peel": return peelPouchOpen(false) || evaluate();
          case "tear": return peelPouchOpen(true) || evaluate();
          case "lift-sheath": return liftNeedleBy("sheath") || evaluate();
          case "lift-thread": return liftNeedleBy("threadEnd") || evaluate();
          case "thread-snug": return threadNeedle(2.5, 0) || evaluate();
          case "thread-light": return threadNeedle(1.5, 0) || evaluate();
          case "thread-hard": return threadNeedle(5.2, 0) || evaluate();
          case "thread-cross": return threadNeedle(2.5, 22) || evaluate();
          case "backout": return backOutNeedle() || evaluate();
          case "fresh": return takeFreshNeedle() || evaluate();
          default: return evaluate();
        }
      }
      switch(kind){
        case "peel": peelOpen(unit); break;
        case "tear": tearOpen(unit); break;
        case "lift-sheath": liftNeedle(unit, "sheath"); break;
        case "lift-thread": liftNeedle(unit, "threadEnd"); break;
        case "thread-snug": threadIn(unit, 2.5, 0); break;
        case "thread-light": threadIn(unit, 1.5, 0); break;
        case "thread-hard": threadIn(unit, 5.2, 0); break;
        case "thread-cross": threadIn(unit, 2.5, 22); break;
        case "backout": backOut(unit); break;
        case "fresh": freshNeedle(unit); break;
        default: break;
      }
      return evaluate();
    }

    async function launch3d(){
      if(!canRender3d || listView || disposed) return;
      await startAssembly({
        mode: "assemble",
        state: unit,
        arm,
        tourniquet: c.tourniquet,
        cleaning: c.cleaning,
        site: c.site,
        onChange: (result)=>draw(result),
      });
      if(disposed){ stopAssembly(); return; }
      draw();
    }

    function toggleView(){
      listView = !listView;
      SS.assemblyListView = listView; saveSS();
      if(listView){ stopAssembly(); draw(); }
      else launch3d().then(()=>draw());
    }

    function finish(){
      const result = evaluate();
      if(reveal().gateContinue && !result.ready) return;
      const measurements = measureAssembly(unit, result);
      applyAssemblyOutcome(c, measurements);
      if(c.encounter){
        c.encounter.assembly = unit;
        c.encounter.measurements.assembly = measurements;
      }
      cleanupOnly();
      advance();
    }

    // Leaving the step must not un-build the unit — it is on the bench from
    // here until it goes in the sharps container. Only the scene is torn down.
    function cleanupOnly(){
      disposed = true;
      stopAssembly();
      try{ delete document.body.dataset.staging; }catch(_){}
    }

    try{ document.body.dataset.staging = "on"; }catch(_){}
    draw();
    launch3d();
    return cleanupOnly;
  },

  /* ---------------------------------------------------------------------------
     UNCAP — the sheath comes off the unit that was just built, along the
     needle's own axis, and then the bevel has to be found and rolled up.
     Nothing here is a fresh object: this is the same needle, at the angle the
     threading left it.
     ------------------------------------------------------------------------ */
  uncap(c, stage, advance){
    const arm = ensureArmSession(c);
    const unit = ensureAssemblySession(c);
    // Arriving here without an assembled unit at all (a resumed draw, or the
    // test seam jumping straight in) means one was built off-screen — but a
    // unit that WAS assembled keeps whatever the learner did to it, loose or
    // cross-threaded included.
    if(!unit.engaged){ peelOpen(unit); liftNeedle(unit, "sheath"); threadIn(unit, 2.5, 0); }
    beginUncap(unit);

    const canRender3d = !!getRenderer();
    let listView = !canRender3d || !!SS.uncapListView;
    let disposed = false;

    const evaluate = ()=>evaluateUncap(unit);

    function draw(result){
      if(disposed) return;
      renderUncapCoach(stage, {
        state: unit,
        result: result || evaluate(),
        unit: isAssemblyActive() ? currentUnit() : null,
        guided: guided(), reveal: reveal(), hint: stepHint(c),
        listView, canRender3d,
        handlers: {
          onReady: finish,
          onToggleView: toggleView,
          onAction: (kind)=>draw(doAction(kind)),
        },
      });
    }

    /** Putting the sheath down on the prepped field re-contaminates it. */
    function retouchSite(){
      if(c.cleaning) markRetouched(c.cleaning);
    }

    function doAction(kind){
      const roll = /^roll([+-])(\d+)$/.exec(kind);
      if(isAssemblyActive()){
        if(roll) return rollUnit((roll[1] === "-" ? -1 : 1)*(+roll[2])) || evaluate();
        switch(kind){
          case "pull": return pullSheath("straight") || evaluate();
          case "wiggle": return pullSheath("wiggle") || evaluate();
          case "twist": return pullSheath("twist") || evaluate();
          case "look": return lookAtBevel() || evaluate();
          case "cap-tray": return placeSheath(CAP_PLACE.TRAY) || evaluate();
          case "cap-site": { const r = placeSheath(CAP_PLACE.SITE); retouchSite(); return r || evaluate(); }
          case "recap": return recapNeedle() || evaluate();
          case "setdown": return setDownUnit() || evaluate();
          case "discard": return discardAndReplace() || evaluate();
          case "warn": return tellPatient() || evaluate();
          default: return evaluate();
        }
      }
      if(roll){ rollBevel(unit, (roll[1] === "-" ? -1 : 1)*(+roll[2])); return evaluate(); }
      switch(kind){
        case "pull": pullCapStraight(unit); break;
        case "wiggle": wiggleCapOff(unit); break;
        case "twist": pullCap(unit, 0.032, 0, 0, 40); break;
        case "look": inspectBevel(unit); break;
        case "cap-tray": placeCap(unit, CAP_PLACE.TRAY); break;
        case "cap-site": placeCap(unit, CAP_PLACE.SITE); retouchSite(); break;
        case "recap": recap(unit); break;
        case "setdown": touchNeedle(unit, "the bench"); break;
        case "discard": discardUnit(unit); break;
        case "warn": warnPatient(unit); break;
        default: break;
      }
      return evaluate();
    }

    async function launch3d(){
      if(!canRender3d || listView || disposed) return;
      await startAssembly({
        mode: "uncap",
        state: unit,
        arm,
        tourniquet: c.tourniquet,
        cleaning: c.cleaning,
        site: c.site,
        onChange: (result)=>draw(result),
        onSiteRetouched: retouchSite,
      });
      if(disposed){ stopAssembly(); return; }
      draw();
    }

    function toggleView(){
      listView = !listView;
      SS.uncapListView = listView; saveSS();
      if(listView){ stopAssembly(); draw(); }
      else launch3d().then(()=>draw());
    }

    function finish(){
      const result = evaluate();
      if(reveal().gateContinue && !result.ready) return;
      const measurements = measureUncap(unit, result);
      applyUncapOutcome(c, measurements);
      if(c.encounter){
        c.encounter.assembly = unit;
        c.encounter.measurements.uncap = measurements;
      }
      cleanupOnly();
      advance();
    }

    function cleanupOnly(){
      disposed = true;
      stopAssembly();
      try{ delete document.body.dataset.staging; }catch(_){}
    }

    try{ document.body.dataset.staging = "on"; }catch(_){}
    draw();
    launch3d();
    return cleanupOnly;
  },

  /* ---------------------------------------------------------------------------
     ANCHOR + INSERT — the vein palpation marked, the needle assembly built and
     uncap uncapped, going in for real. Two sequential techniques: anchor the
     skin with the off hand first, then carry the needle in at a real angle and
     advance it by feel until the flash confirms the tip is in the vein.
     ------------------------------------------------------------------------ */
  insert(c, stage, advance){
    const arm = ensureArmSession(c);
    const ins = ensureInsertSession(c);
    const procedure = c.procedure;
    const isButterfly = procedure.device === DEVICE.BUTTERFLY;
    const bf = isButterfly ? ensureButterflySession(c) : null;
    // The winged set's wing/tubing physics are only wired through the
    // accessible controls, not the live 3D drag — deriving correct pull and
    // swing magnitudes from arbitrary pointer gestures is a separate,
    // high-risk piece of work this branch does not attempt. Forcing controls
    // here is honest: it means the mechanic is always exactly what it claims
    // to be, rather than a live path that would silently ignore it.
    const canRender3d = !isButterfly && !!getRenderer();
    let listView = !canRender3d || !!SS.insertListView;
    let disposed = false;

    const bevelDeg = ()=> c.needleUnit
      ? (c.needleUnit.bevelDeg == null ? bevelFromTurns(c.needleUnit.turns) : c.needleUnit.bevelDeg)
      : null;
    const evaluate = ()=>evaluateInsert(ins, c.armVessels || [], bevelDeg(), procedure.angle, procedure.anchor);

    function draw(result){
      if(disposed) return;
      renderInsertCoach(stage, {
        state: ins,
        result: result || evaluate(),
        bevelDeg: bevelDeg(),
        angleBand: procedure.angle, anchorBand: procedure.anchor,
        device: procedure.device, butterfly: bf,
        guided: guided(), reveal: reveal(), hint: stepHint(c),
        listView, canRender3d,
        handlers: {
          onReady: finish,
          onToggleView: toggleView,
          onAction: (kind)=>draw(doAction(kind)),
          onWing: (kind)=>draw(doWing(kind)),
        },
      });
    }

    function checkFlash(){
      const v = (c.armVessels || []).find(x => x.id === ins.chosenId);
      if(v) markFlashIfInVein(ins, v, Date.now());
      // The wings' grip becomes fixed the instant the skin is broken — that
      // is the angle everything after entry has to hold.
      if(bf && !bf.entered && ins.entryX != null) enterButterfly(bf, ins.angleDeg, {});
    }

    function doWing(kind){
      if(!bf) return evaluate();
      switch(kind){
        case "pinch": pickUpByWings(bf); break;
        case "tubing": pickUpByTubing(bf); break;
        case "flat": layWingsFlat(bf); break;
        case "secure": secureWings(bf, {}); layTubing(bf, procedure.tubing.slackGoodM); break;
        case "notice": noticeInfiltration(bf, {}); break;
        case "stop": stopForInfiltration(bf); break;
        default: break;
      }
      return evaluate();
    }

    // The vessel's own centre depth, not a flat 6mm — a hand vein sits at
    // 2mm, and 6mm would drive every "insert" preset through the far wall
    // before the learner ever touched the angle it's meant to be testing.
    const presetDepthM = ()=>{
      const chosen = (c.armVessels || []).find(v => v.id === ins.chosenId);
      return chosen ? chosen.depth : 0.006;
    };
    const presets = ()=>({ angle: anglePresetsFor(procedure.angle), anchor: anchorPresetsFor(procedure.anchor) });

    // The controls tear the 3D scene down, so these cannot go through the
    // runtime — but they run the SAME pure technique helpers it does, so the
    // anchor offsets, angles and depths that come out are identical.
    function doAction(kind){
      const p = presets();
      const d = presetDepthM();
      if(isInsertActive()){
        switch(kind){
          case "anchor-ideal": return anchorProgrammatically(p.anchor.idealM, p.anchor.pullGoodM) || evaluate();
          case "anchor-close": return anchorProgrammatically(p.anchor.closeM, p.anchor.pullGoodM) || evaluate();
          case "anchor-far": return anchorProgrammatically(p.anchor.farM, p.anchor.pullGoodM) || evaluate();
          case "anchor-wrongside": return anchorProgrammatically(-p.anchor.closeM, p.anchor.pullGoodM) || evaluate();
          case "anchor-weak": return anchorProgrammatically(p.anchor.idealM, p.anchor.pullWeakM) || evaluate();
          case "redo-anchor": return redoAnchor() || evaluate();
          case "insert-ideal": { const r = insertProgrammatically(p.angle.ideal, d); checkFlash(); return r || evaluate(); }
          case "insert-shallow": { const r = insertProgrammatically(p.angle.shallow, d); checkFlash(); return r || evaluate(); }
          case "insert-steep": { const r = insertProgrammatically(p.angle.steep, d); checkFlash(); return r || evaluate(); }
          case "advance": return advanceProgrammatically(0.0012) || evaluate();
          case "retreat": return advanceProgrammatically(-0.0008) || evaluate();
          case "pullout": return pullOutProgrammatically() || evaluate();
          default: return evaluate();
        }
      }
      switch(kind){
        case "anchor-ideal": anchorAt(ins, ins.markX - p.anchor.idealM, p.anchor.pullGoodM); break;
        case "anchor-close": anchorAt(ins, ins.markX - p.anchor.closeM, p.anchor.pullGoodM); break;
        case "anchor-far": anchorAt(ins, ins.markX - p.anchor.farM, p.anchor.pullGoodM); break;
        case "anchor-wrongside": anchorAt(ins, ins.markX + p.anchor.closeM, p.anchor.pullGoodM); break;
        case "anchor-weak": anchorAt(ins, ins.markX - p.anchor.idealM, p.anchor.pullWeakM); break;
        case "redo-anchor": resetAnchor(ins); break;
        case "insert-ideal": insertInto(ins, ins.markX, ins.markZ, p.angle.ideal, d); checkFlash(); break;
        case "insert-shallow": insertInto(ins, ins.markX, ins.markZ, p.angle.shallow, d); checkFlash(); break;
        case "insert-steep": insertInto(ins, ins.markX, ins.markZ, p.angle.steep, d); checkFlash(); break;
        case "advance": advanceNeedle(ins, 0.0012); checkFlash(); break;
        case "retreat": advanceNeedle(ins, -0.0008); checkFlash(); break;
        case "pullout": pullOutCompletely(ins); break;
        default: break;
      }
      return evaluate();
    }

    async function launch3d(){
      if(!canRender3d || listView || disposed) return;
      await startInsert({
        state: ins,
        arm,
        tourniquet: c.tourniquet,
        bevelDeg,
        onChange: (result)=>draw(result),
      });
      if(disposed){ stopInsert(); return; }
      const ctx = getInsertContext();
      if(ctx && ctx.view) c.armVessels = ctx.view.arm.vessels;
      draw();
    }

    function toggleView(){
      listView = !listView;
      SS.insertListView = listView; saveSS();
      if(listView){ stopInsert(); draw(); }
      else launch3d().then(()=>draw());
    }

    function finish(){
      const result = evaluate();
      // Teaching mode will not let a bad stick proceed. A scored shift lets
      // the learner commit — the tube fill and the recap both carry whatever
      // this step actually produced.
      if(reveal().gateContinue && !result.ready) return;
      const measurements = measureInsert(ins, result, bevelDeg(), undefined, procedure.angle);
      applyInsertOutcome(c, measurements);
      if(c.encounter){
        c.encounter.access = ins;
        c.encounter.measurements.insert = measurements;
      }
      // The wing measurement firms up again once collection finishes — this
      // is the first, partial read, so a draw abandoned right here still has
      // something in the report rather than nothing.
      if(bf){
        const bm = measureButterfly(bf, evaluateButterfly(bf, {}));
        applyButterflyOutcome(c, bm);
      }
      cleanupOnly();
      advance();
    }

    // Leaving the step must not pull the needle back out — it stays exactly
    // where it landed for the fill step that follows. Only the scene disposes.
    function cleanupOnly(){
      disposed = true;
      stopInsert();
      try{ delete document.body.dataset.staging; }catch(_){}
    }

    try{ document.body.dataset.staging = "on"; }catch(_){}
    draw();
    launch3d();
    return cleanupOnly;
  },

  /* ---------------------------------------------------------------------------
     FILL — the first tube onto the holder that is already in the patient.
     ------------------------------------------------------------------------ */
  fill(c, stage, advance){
    return runCollection(c, stage, advance, "fill");
  },

  /* ---------------------------------------------------------------------------
     SWITCH — every tube after the first, off the same rack, onto the same
     holder, in the order of draw. Same state, same rules, same runtime: a
     tube change is not a different activity from filling one.
     ------------------------------------------------------------------------ */
  switch(c, stage, advance){
    return runCollection(c, stage, advance, "switch");
  },

  /* ---------------------------------------------------------------------------
     RELEASE — the band comes off by its own tail, before the needle moves,
     with the free hand steadied so the holder stays still. The strap being
     pulled is the SAME strap the tourniquet step secured; the clock being
     stopped is the clock that step started.
     ------------------------------------------------------------------------ */
  release(c, stage, advance){
    return runWithdrawal(c, stage, advance, "release");
  },

  /* ---------------------------------------------------------------------------
     WITHDRAW — gauze rested above the site first, then the needle drawn back
     out along the very line the insert step fixed when the skin was broken.
     The exit path, its speed and its sideways drift are all measured.
     ------------------------------------------------------------------------ */
  withdraw(c, stage, advance){
    return runWithdrawal(c, stage, advance, "withdraw");
  },

  /* ---------------------------------------------------------------------------
     SAFETY — the device's own mechanism, operated in the hand, immediately.
     Striking it on the bench, recapping, or laying an exposed used sharp
     down are each recorded as themselves.
     ------------------------------------------------------------------------ */
  safety(c, stage, advance){
    return runWithdrawal(c, stage, advance, "safety");
  },

  /* ---------------------------------------------------------------------------
     DISPOSE — the whole unit carried straight into the sharps container the
     learner staged within reach, without crossing back over the patient.
     ------------------------------------------------------------------------ */
  dispose(c, stage, advance){
    return runWithdrawal(c, stage, advance, "dispose");
  },

  /* ---------------------------------------------------------------------------
     PRESSURE — the pad pressed straight down onto the puncture, hard enough to
     actually close the vein, for as long as this puncture and this patient
     genuinely need, with the arm kept straight.
     ------------------------------------------------------------------------ */
  pressure(c, stage, advance){
    return runPostDraw(c, stage, advance, "pressure");
  },

  /* ---------------------------------------------------------------------------
     BANDAGE — over the puncture, firm but not a tourniquet, and only once the
     learner has actually looked and seen it stop.
     ------------------------------------------------------------------------ */
  bandage(c, stage, advance){
    return runPostDraw(c, stage, advance, "bandage");
  },

  /* ---------------------------------------------------------------------------
     INVERT — the tubes the collection step filled, picked up one at a time and
     turned end over end as many times as each additive actually needs. The
     last of the sixteen steps to stop being a 2D widget.
     ------------------------------------------------------------------------ */
  invert(c, stage, advance){
    const arm = ensureArmSession(c);
    const inv = ensureInversionSession(c);
    const canRender3d = !!getRenderer();
    let listView = !canRender3d || !!SS.inversionListView;
    let disposed = false;

    const evaluate = ()=>evaluateInversion(inv);

    function draw(result){
      if(disposed) return;
      renderInversionCoach(stage, {
        state: inv,
        result: result || evaluate(),
        guided: guided(), reveal: reveal(), hint: stepHint(c),
        listView, canRender3d,
        handlers: {
          onReady: finish,
          onToggleView: toggleView,
          onAction: (kind)=>draw(doAction(kind)),
        },
      });
    }

    // The controls tear the 3D scene down, so these cannot go through the
    // runtime — but they run the SAME pure technique helpers it does, so the
    // counts, angles, speeds and haemolysis that come out are identical.
    function doAction(kind){
      const live = isInversionActive();
      if(kind.indexOf("pick:") === 0){
        const key = kind.slice(5);
        if(live) return pickUpProgrammatically(key) || evaluate();
        pickUpTube(inv, key);
        return evaluate();
      }
      switch(kind){
        case "mix": {
          if(live) return invertToRequirementProgrammatically() || evaluate();
          const t = inv.heldKey ? inv.tubes[inv.heldKey] : null;
          if(t && !mustNotMix(t.key)){
            invertTimes(inv, Math.max(0, inversionsFor(t.key).ideal - t.inversions), {});
          }
          break;
        }
        case "one":
          if(live) return invertProgrammatically(1) || evaluate();
          invertTimes(inv, 1, {}); break;
        case "rock":
          if(live) return rockProgrammatically(4) || evaluate();
          rockTimes(inv, 4, {}); break;
        case "slow":
          if(live) return invertSlowlyProgrammatically(1) || evaluate();
          invertTimes(inv, 1, { degPerS: 30 }); break;
        case "shake":
          if(live) return shakeProgrammatically(6) || evaluate();
          shakeTimes(inv, 6, {}); break;
        case "rack":
          if(live) return rackProgrammatically() || evaluate();
          rackTube(inv); break;
        default: break;
      }
      return evaluate();
    }

    async function launch3d(){
      if(!canRender3d || listView || disposed) return;
      await startInversion({
        state: inv,
        arm,
        guided: guided(), reveal: reveal(), hint: stepHint(c),
        onChange: (result)=>draw(result),
      });
      if(disposed){ stopInversion(); return; }
      draw();
    }

    function toggleView(){
      listView = !listView;
      SS.inversionListView = listView; saveSS();
      if(listView){ stopInversion(); draw(); }
      else launch3d().then(()=>draw());
    }

    function finish(){
      const result = evaluate();
      // Teaching mode will not leave tubes unmixed that CAN still be mixed. A
      // specimen already ruined does not hold the step open, because nothing
      // the learner does now would put it right.
      if(reveal().gateContinue && !result.allHandled) return;
      const measurements = measureInversion(inv, result);
      applyInversionOutcome(c, measurements);
      if(c.encounter){
        c.encounter.specimens = inv;
        c.encounter.measurements.inversion = measurements;
      }
      cleanupOnly();
      advance();
    }

    function cleanupOnly(){
      disposed = true;
      stopInversion();
      try{ delete document.body.dataset.staging; }catch(_){}
    }

    try{ document.body.dataset.staging = "on"; }catch(_){}
    draw();
    launch3d();
    return cleanupOnly;
  },
};

/* ===========================================================================
   WITHDRAW, SAFETY AND SHARPS — shared by the release, withdraw, safety and
   dispose steps.

   They differ in exactly one thing: when they are finished. The rules, the
   measurements and the gestures are one continuous piece of work on the same
   arm, exactly as fill and switch are.
   ======================================================================== */
function runWithdrawal(c, stage, advance, mode){
  const arm = ensureArmSession(c);
  const wd = ensureWithdrawalSession(c);
  const canRender3d = !!getRenderer();
  let listView = !canRender3d || !!SS.withdrawalListView;
  let disposed = false;

  const liveCtx = ()=>({
    tourniquetReleased: !c.tourniquet || !isOnPatient(c.tourniquet),
    tourniquetOn: !!(c.tourniquet && c.tourniquet.securedAt && !c.tourniquet.releasedAt),
    tourniquetSeconds: tourniquetSecondsFor(c),
    collectionDone: !c.collection
      || (c.collection.order || []).every(k => c.collection.tubes[k] && c.collection.tubes[k].removedAt),
    tubeOnHolder: !!(c.collection && c.collection.currentKey),
  });
  const evaluate = ()=>evaluateWithdrawal(wd, liveCtx());

  function draw(result){
    if(disposed) return;
    const lc = liveCtx();
    renderWithdrawalCoach(stage, {
      state: wd,
      result: result || evaluate(),
      mode,
      ready: withdrawalModeReady(wd, lc, mode),
      live: lc,
      guided: guided(), reveal: reveal(), hint: stepHint(c),
      listView, canRender3d,
      handlers: {
        onReady: finish,
        onToggleView: toggleView,
        onAction: (kind)=>draw(doAction(kind)),
      },
    });
  }

  /** The release itself: the same state change on the same strap, both paths. */
  function releaseNow(){
    if(isWithdrawalActive()) return wdReleaseBand() || evaluate();
    const lc = liveCtx();
    markBandReleased(wd, {
      byTail: true,
      collectionDone: lc.collectionDone,
      tourniquetSeconds: lc.tourniquetSeconds == null ? null : Math.round(lc.tourniquetSeconds*10)/10,
    });
    if(c.tourniquet && isOnPatient(c.tourniquet)) markReleased(c.tourniquet, { byTail: true });
    return evaluate();
  }

  // The controls tear the 3D scene down, so these cannot go through the
  // runtime — but they run the SAME pure technique helpers it does, so the
  // timings, angles and destinations that come out are identical.
  function doAction(kind){
    const live = isWithdrawalActive();
    const wdCtx = ()=>({ tubeOn: liveCtx().tubeOnHolder, tourniquetOn: liveCtx().tourniquetOn });
    switch(kind){
      case "fist":
        if(live) return relaxFistProgrammatically() || evaluate();
        relaxFist(wd); break;
      case "release":
        return releaseNow();
      case "gauze-take":
        if(live) return takeGauzeProgrammatically() || evaluate();
        takeGauze(wd, { itemId: wd.gauzeItemId, clean: wd.gauzeClean }); break;
      case "gauze-place":
        if(live) return placeGauzeProgrammatically(0.012, false) || evaluate();
        placeGauze(wd, { offsetM: 0.012, pressing: false }); break;
      case "gauze-press":
        if(live) return placeGauzeProgrammatically(0.004, true) || evaluate();
        placeGauze(wd, { offsetM: 0.004, pressing: true }); break;
      case "withdraw-smooth":
        if(live) return withdrawProgrammatically("smooth") || evaluate();
        withdrawSmoothly(wd, wdCtx()); break;
      case "withdraw-rough":
        if(live) return withdrawProgrammatically("rough") || evaluate();
        withdrawRoughly(wd, wdCtx()); break;
      case "safety-hand":
        if(live) return slideSafetyProgrammatically("hand") || evaluate();
        activateSafetyCleanly(wd); break;
      case "safety-partial":
        if(live) return slideSafetyProgrammatically("partial") || evaluate();
        slideSafety(wd, 0.5); break;
      case "safety-surface":
        if(live) return slideSafetyProgrammatically("surface") || evaluate();
        slideSafety(wd, 1.001, { surface: true }); break;
      case "recap":
        if(live) return recapProgrammatically() || evaluate();
        attemptRecap(wd); break;
      case "setdown":
        if(live) return setDownProgrammatically() || evaluate();
        wdSetDownUnit(wd); break;
      case "dispose-sharps":
        if(live) return disposeProgrammatically("sharps") || evaluate();
        disposeUnit(wd, { target: "sharps", fully: true }); break;
      case "dispose-crossed":
        if(live) return disposeProgrammatically("sharps", { crossed: true }) || evaluate();
        markCrossedPatient(wd);
        disposeUnit(wd, { target: "sharps", fully: true, crossedPatient: true }); break;
      case "dispose-trash":
        if(live) return disposeProgrammatically("trash") || evaluate();
        disposeUnit(wd, { target: "trash" }); break;
      default: break;
    }
    return evaluate();
  }

  async function launch3d(){
    if(!canRender3d || listView || disposed) return;
    await startWithdrawal({
      mode,
      state: wd,
      arm,
      insert: c.insert,
      collection: c.collection,
      tourniquet: c.tourniquet,
      guided: guided(), reveal: reveal(), hint: stepHint(c),
      onChange: (result)=>draw(result),
    });
    if(disposed){ stopWithdrawal(); return; }
    draw();
  }

  function toggleView(){
    listView = !listView;
    SS.withdrawalListView = listView; saveSS();
    if(listView){ stopWithdrawal(); draw(); }
    else launch3d().then(()=>draw());
  }

  function finish(){
    const lc = liveCtx();
    if(reveal().gateContinue && !withdrawalModeReady(wd, lc, mode)) return;
    const measurements = measureWithdrawal(wd, evaluate(), {
      tourniquetSeconds: wd.tourniquetSecondsAtRelease == null
        ? lc.tourniquetSeconds : wd.tourniquetSecondsAtRelease,
      tourniquetReleased: lc.tourniquetReleased,
    });
    applyWithdrawalOutcome(c, measurements);
    if(c.encounter){
      c.encounter.disposal = wd;
      c.encounter.measurements.withdrawal = measurements;
    }
    cleanupOnly();
    advance();
  }

  // Leaving a step must not undo the arm: the band stays off once pulled, the
  // unit stays wherever it physically is. Only the scene is torn down — the
  // next step of the same sequence rebuilds it around the same state.
  function cleanupOnly(){
    disposed = true;
    stopWithdrawal();
    try{ delete document.body.dataset.staging; }catch(_){}
  }

  try{ document.body.dataset.staging = "on"; }catch(_){}
  draw();
  launch3d();
  return cleanupOnly;
}

/* ===========================================================================
   TUBE COLLECTION — shared by the fill and switch steps.

   They differ in exactly one thing: when they are finished. `fill` is done
   once the first tube is off the holder; `switch` is done once they all are.
   The rules, the measurements and the gestures are identical, because in the
   patient's arm it is one continuous piece of work.
   ======================================================================== */
/**
 * Metres of pull and degrees of swing a given tube action puts through the
 * winged set's tubing — a hand reaching across to the rack disturbs the line
 * far more than easing a braced tube onto the holder does. Only meaningful
 * for the butterfly procedure; the straight needle has no tubing to move.
 */
function butterflyImpactFor(kind){
  if(kind.indexOf("take:") === 0) return { pullM: 0.030, swingDeg: 18, cause: "takeTube" };
  switch(kind){
    case "push-braced": return { pullM: 0.006, swingDeg: 4, cause: "pushOn" };
    case "push-unbraced": return { pullM: 0.018, swingDeg: 10, cause: "pushOn" };
    case "backoff": return { pullM: 0.004, swingDeg: 3, cause: "backOff" };
    case "remove-braced": return { pullM: 0.006, swingDeg: 4, cause: "removeTube" };
    case "remove-unbraced": return { pullM: 0.018, swingDeg: 10, cause: "removeTube" };
    case "return": return { pullM: 0.010, swingDeg: 6, cause: "returnTube" };
    case "discard": return { pullM: 0.014, swingDeg: 8, cause: "discardTube" };
    default: return null;
  }
}

function runCollection(c, stage, advance, mode){
  const arm = ensureArmSession(c);
  const ins = ensureInsertSession(c);
  const col = ensureCollectionSession(c);
  const isButterfly = c.procedure.device === DEVICE.BUTTERFLY;
  const bf = isButterfly ? ensureButterflySession(c) : null;
  // Same reasoning as the insert step: the winged set's tubing physics are
  // only wired through the accessible controls.
  const canRender3d = !isButterfly && !!getRenderer();
  let listView = !canRender3d || !!SS.collectionListView;
  let disposed = false;

  const evaluate = ()=>evaluateCollection(col, {
    vessel: col.vessel,
    inVein: col.inVein && !col.needleOut,
    tourniquetOn: !!(c.tourniquet && c.tourniquet.securedAt && !c.tourniquet.releasedAt),
  });

  /**
   * A tube that will never fill does not stop being finished with. Without
   * this, a dead-on-air or dislodged draw would leave the learner unable to
   * leave the step at all — including in teaching mode, where the button is
   * the only way forward.
   */
  const stepReady = (result)=>{
    if(col.needleOut || !col.inVein) return true;
    if(mode === "fill"){
      const first = col.order[0];
      if(!first) return true;
      const t = col.tubes[first];
      // off the holder, and not something a second attempt would still fix
      return !!(t && t.removedAt) && result.redrawable.indexOf(first) < 0;
    }
    return result.allDone;
  };

  function draw(result){
    if(disposed) return;
    const r = result || evaluate();
    renderCollectionCoach(stage, {
      state: col,
      result: r,
      ready: stepReady(r),
      readyMessage: mode === "fill"
        ? "That tube is off and filled to its draw volume."
        : "Every tube is filled to its draw volume, in order. The band comes off next.",
      readyLabel: mode === "fill" ? "Next tube ▶" : "All tubes collected ▶",
      guided: guided(), reveal: reveal(), hint: stepHint(c),
      listView, canRender3d, butterfly: bf,
      handlers: {
        onReady: finish,
        onToggleView: toggleView,
        onAction: (kind)=>draw(doAction(kind)),
        onWing: (kind)=>draw(doWing(kind)),
      },
    });
  }

  function doWing(kind){
    if(!bf) return evaluate();
    switch(kind){
      case "notice": noticeInfiltration(bf, {}); break;
      case "stop": stopForInfiltration(bf); break;
      case "flat": layWingsFlat(bf); break;
      case "secure": secureWings(bf, {}); layTubing(bf, c.procedure.tubing.slackGoodM); break;
      default: break;
    }
    return evaluate();
  }

  // Whatever the tube action was, if a winged set is in play it also travels
  // down the tubing to the tip — taped-down wings absorb almost all of it,
  // a loose line almost none. `wait` is when infiltration actually accrues:
  // it is real seconds passing with the tip wherever it currently is.
  function applyButterflySideEffect(kind){
    if(!bf) return;
    if(kind === "wait"){ drawButterflyFor(bf, 5, {}); return; }
    const impact = butterflyImpactFor(kind);
    if(impact) disturb(bf, impact);
  }

  // The controls tear the 3D scene down, so these cannot go through the
  // runtime — but they run the SAME pure technique helpers it does, so the
  // seat depths, fill volumes and needle shifts that come out are identical.
  function doAction(kind){
    const live = isCollectionActive();
    applyButterflySideEffect(kind);
    if(kind.indexOf("take:") === 0){
      const key = kind.slice(5);
      if(live) return takeTubeProgrammatically(key) || evaluate();
      takeTube(col, key);
      return evaluate();
    }
    switch(kind){
      case "push-braced":
        if(live) return pushOnProgrammatically(GRIP.FLANGE) || evaluate();
        pushOn(col, GRIP.FLANGE); break;
      case "push-unbraced":
        if(live) return pushOnProgrammatically(GRIP.BODY) || evaluate();
        pushOn(col, GRIP.BODY); break;
      case "backoff":
        if(live) return backOffProgrammatically() || evaluate();
        backOffToGuideline(col); break;
      case "remove-braced":
        if(live) return removeTubeProgrammatically(GRIP.FLANGE) || evaluate();
        removeTube(col, GRIP.FLANGE); break;
      case "remove-unbraced":
        if(live) return removeTubeProgrammatically(GRIP.BODY) || evaluate();
        removeTube(col, GRIP.BODY); break;
      case "return":
        if(live) return returnTubeProgrammatically() || evaluate();
        returnTube(col); break;
      case "discard":
        if(live) return discardTubeProgrammatically() || evaluate();
        discardTube(col); break;
      case "wait":
        if(live) return waitProgrammatically(5) || evaluate();
        // the same vacuum, the same rate, just without a render loop to tick it
        for(let t = 0; t < 5; t += 0.1){
          flowTube(col, 0.1, !!(c.tourniquet && c.tourniquet.securedAt && !c.tourniquet.releasedAt));
        }
        break;
      default: break;
    }
    return evaluate();
  }

  async function launch3d(){
    if(!canRender3d || listView || disposed) return;
    await startCollection({
      state: col,
      arm,
      insert: ins,
      tourniquet: c.tourniquet,
      onChange: (result)=>draw(result),
    });
    if(disposed){ stopCollection(); return; }
    draw();
  }

  function toggleView(){
    listView = !listView;
    SS.collectionListView = listView; saveSS();
    if(listView){ stopCollection(); draw(); }
    else launch3d().then(()=>draw());
  }

  function finish(){
    const result = evaluate();
    if(reveal().gateContinue && !stepReady(result)) return;
    const measurements = measureCollection(col, result, {
      tourniquetSeconds: tourniquetSecondsFor(c),
    });
    applyCollectionOutcome(c, measurements);
    if(c.encounter){
      c.encounter.collection = col;
      c.encounter.measurements.collection = measurements;
    }
    // The authoritative wing/tubing measurement: it now includes whatever
    // the tube changes actually did to the tip, not just how the set went in.
    if(bf){
      const totalMl = (measurements.tubes || []).reduce((s, t) => s + (t.drawnMl || 0), 0);
      const bo = { collectionDoneMl: totalMl, requiredMl: c.procedure.minDrawMl };
      const bm = measureButterfly(bf, evaluateButterfly(bf, bo), bo);
      applyButterflyOutcome(c, bm);
    }
    cleanupOnly();
    advance();
  }

  // Leaving the step must not pull the needle out or empty the holder: the
  // switch step that follows works on exactly what this one left behind.
  function cleanupOnly(){
    disposed = true;
    stopCollection();
    try{ delete document.body.dataset.staging; }catch(_){}
  }

  try{ document.body.dataset.staging = "on"; }catch(_){}
  draw();
  launch3d();
  return cleanupOnly;
}

/* ===========================================================================
   PRESSURE AND BANDAGE — shared by both steps.

   They differ in exactly one thing: when they are finished. `pressure` is done
   once the bleeding has actually stopped AND the learner has looked and seen
   it; `bandage` is done once a dressing is on that is neither a tourniquet nor
   over a bleeding puncture. Same state, same rules, same gestures.
   ======================================================================== */
function runPostDraw(c, stage, advance, mode){
  const arm = ensureArmSession(c);
  const pd = ensurePostDrawSession(c);
  const canRender3d = !!getRenderer();
  let listView = !canRender3d || !!SS.postDrawListView;
  let disposed = false;

  const evaluate = ()=>evaluatePostDraw(pd);

  function draw(result){
    if(disposed) return;
    renderPostDrawCoach(stage, {
      state: pd,
      result: result || evaluate(),
      mode,
      ready: postDrawModeReady(pd, mode),
      guided: guided(), reveal: reveal(), hint: stepHint(c),
      listView, canRender3d,
      handlers: {
        onReady: finish,
        onToggleView: toggleView,
        onAction: (kind)=>draw(doAction(kind)),
      },
    });
  }

  // The controls tear the 3D scene down, so these cannot go through the
  // runtime — but they run the SAME pure technique helpers it does, so the
  // forces, seconds, volumes and tightness that come out are identical.
  function doAction(kind){
    const live = isPostDrawActive();
    switch(kind){
      case "hold":
        if(live) return holdUntilHaemostasisProgrammatically() || evaluate();
        holdPressureFor(pd, pd.holdSeconds + 2, { offsetM: 0.003 }); break;
      case "press":
        if(live) return pressProgrammatically("firm", 5) || evaluate();
        holdPressureFor(pd, 5, { offsetM: 0.004 }); break;
      case "light":
        if(live) return pressProgrammatically("light", 5) || evaluate();
        holdPressureFor(pd, 5, { force: 0.20, offsetM: 0.004 }); break;
      case "hard":
        if(live) return pressProgrammatically("hard", 5) || evaluate();
        holdPressureFor(pd, 5, { force: 0.98, offsetM: 0.004 }); break;
      case "beside":
        if(live) return pressProgrammatically("beside", 5) || evaluate();
        holdPressureFor(pd, 5, { offsetM: 0.026 }); break;
      case "flex":
        if(live) return flexArmProgrammatically(true) || evaluate();
        flexArm(pd, true); break;
      case "straighten":
        if(live) return flexArmProgrammatically(false) || evaluate();
        flexArm(pd, false); break;
      case "check":
        if(live) return checkSiteProgrammatically() || evaluate();
        checkSite(pd); break;
      case "bandage":
        if(live) return bandageProgrammatically("square") || evaluate();
        applyBandage(pd, { alignM: 0.003, tightness: 0.45 }); break;
      case "bandage-off":
        if(live) return bandageProgrammatically("off-site") || evaluate();
        applyBandage(pd, { alignM: 0.020, tightness: 0.45 }); break;
      case "bandage-tight":
        if(live) return bandageProgrammatically("tight") || evaluate();
        applyBandage(pd, { alignM: 0.003, tightness: 0.95 }); break;
      case "bandage-loose":
        if(live) return bandageProgrammatically("loose") || evaluate();
        applyBandage(pd, { alignM: 0.003, tightness: 0.10 }); break;
      case "bandage-remove":
        if(live) return removeBandageProgrammatically() || evaluate();
        removeBandage(pd); break;
      case "aftercare":
        if(live) return aftercareProgrammatically() || evaluate();
        giveAftercare(pd); break;
      default: break;
    }
    return evaluate();
  }

  async function launch3d(){
    if(!canRender3d || listView || disposed) return;
    await startPostDraw({
      mode,
      state: pd,
      arm,
      site: c.postDrawSite,
      guided: guided(), reveal: reveal(), hint: stepHint(c),
      onChange: (result)=>draw(result),
    });
    if(disposed){ stopPostDraw(); return; }
    draw();
  }

  function toggleView(){
    listView = !listView;
    SS.postDrawListView = listView; saveSS();
    if(listView){ stopPostDraw(); draw(); }
    else launch3d().then(()=>draw());
  }

  function finish(){
    if(reveal().gateContinue && !postDrawModeReady(pd, mode)) return;
    const measurements = measurePostDraw(pd, evaluate());
    applyPostDrawOutcome(c, measurements);
    if(c.encounter){
      c.encounter.aftercare = pd;
      c.encounter.measurements.postDraw = measurements;
    }
    cleanupOnly();
    advance();
  }

  // Leaving a step must not undo the patient: a clot that is holding stays
  // holding, a bruise stays, a dressing stays on. Only the scene is torn down.
  function cleanupOnly(){
    disposed = true;
    stopPostDraw();
    try{ delete document.body.dataset.staging; }catch(_){}
  }

  try{ document.body.dataset.staging = "on"; }catch(_){}
  draw();
  launch3d();
  return cleanupOnly;
}

export function hasPhysicalStep(id){ return Object.prototype.hasOwnProperty.call(PHYSICAL_STEPS, id); }
