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
import { SS, saveSS, guided } from "../game/gameState.js";
import { getRenderer } from "../rendering/renderer.js";
import { drawArmFor } from "../game/encounter.js";
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
import { buildVessels, mirrorForArm, applyPatientVariation } from "./arm/armAnatomy.js";
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
import { evaluateInsert } from "./insert/insertRules.js";
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
import { evaluateCleaning } from "./cleaning/cleaningRules.js";
import { measureCleaning, applyCleaningOutcome } from "./cleaning/cleaningScoring.js";
import { renderCleaningCoach } from "./cleaning/cleaningCoach.js";
import {
  startCleaning, stopCleaning, isCleaningActive,
  openSwabPack, scrubSpiral, scrubBackAndForth,
} from "./cleaning/cleaningRuntime.js";

const ZONE_BY_NAME = { tray:ZONE.TRAY, rack:ZONE.RACK, reach:ZONE.REACH, across:ZONE.ACROSS, counter:ZONE.COUNTER };

function handednessOf(){ return SS.handedness===HAND.LEFT ? HAND.LEFT : HAND.RIGHT; }
function viewportOrientation(){
  try{ return orientationForAspect(window.innerWidth/Math.max(1, window.innerHeight)); }
  catch(_){ return orientationForAspect(1.6); }
}

/**
 * Builds (once per encounter) the persistent supply session and keeps it on
 * the procedure state, so re-entering this step — or coming back from a
 * mid-draw interruption — finds the tray exactly as it was left.
 */
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
export function ensureArmSession(c){
  if(c.arm) return c.arm;
  const p = c.patient || {};
  const a = p.appearance || {};
  const chosen = drawArmFor(p);
  c.arm = {
    skin: a.skin,
    shirt: p.shirt,
    build: a.width || 1,
    armSide: chosen.side,
    scenarioKeys: chosen.keys,
    // a dehydrated patient's veins fill less well however good the technique
    vigour: chosen.keys.indexOf("dry") >= 0 ? 0.72 : 1,
  };
  // The vessel geometry is built here rather than only inside the 3D scene, so
  // the rules can be asked about this arm even when no scene is running — the
  // accessible path stops the renderer, and it still has to palpate the same
  // arm and be judged by the same measurements.
  c.armVessels = applyPatientVariation(
    mirrorForArm(buildVessels(), c.arm.armSide),
    { build: c.arm.build, scenarioKeys: c.arm.scenarioKeys, vigour: c.arm.vigour }
  );
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
  const needle = stagedDef(c, CATEGORY.NEEDLE);
  const holder = stagedDef(c, CATEGORY.HOLDER);
  c.needleUnit = createAssemblyState({
    needleItemId: needle ? needle.id : null,
    holderItemId: holder ? holder.id : null,
    gauge: needle && needle.gauge ? needle.gauge : 21,
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
  const chosenId = site.vesselId || "median-cubital";
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
    anchorAt(ins, ins.markX - 0.035, 0.016);
    insertInto(ins, ins.markX, ins.markZ, 20, vessel.depth);
    markFlashIfInVein(ins, vessel, Date.now());
  }
  const m = c.insertMeasurements;
  c.collection = createCollectionState({
    order: c.tubes || [],
    vessel,
    gauge: unit.gauge,
    vigour: arm.vigour,
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
    markRouted(tq, { bandX: 0.089, wrap: WRAP.UNDER, skew: 0 });
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
    device: DEVICE.STRAIGHT,
    angleDeg: ins.angleDeg == null ? 20 : ins.angleDeg,
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

/** The fingers' record for this encounter — created once, carried onward. */
export function ensurePalpationSession(c){
  if(c.palpation) return c.palpation;
  c.palpation = createPalpationState();
  return c.palpation;
}

export const PHYSICAL_STEPS = {
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
        guided: guided(),
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
      if(guided() && !result.ready) return;
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
    const canRender3d = !!getRenderer();
    let listView = !canRender3d || !!SS.tourniquetListView;
    let disposed = false;

    const evaluate = ()=>evaluateTourniquet(tqState, { vessels:(c.armVessels||[]), vigour:arm.vigour });

    function draw(result){
      if(disposed) return;
      renderTourniquetCoach(stage, {
        state: tqState,
        result: result || liveResult(),
        gesture: isTourniquetActive() ? currentGesture() : null,
        guided: guided(),
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
      return { vessels: c.armVessels || [], vigour: arm.vigour };
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
        guided: guided(),
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
      if(guided() && !result.ready) return;
      const measurements = measureTourniquet(tqState, result);
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
    const canRender3d = !!getRenderer();
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
        guided: guided(),
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
      if(guided() && !result.ready) return;
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
        guided: guided(),
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
      if(guided() && !result.ready) return;
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
        guided: guided(),
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
      if(guided() && !result.ready) return;
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
        guided: guided(),
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
      if(guided() && !result.ready) return;
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
    const canRender3d = !!getRenderer();
    let listView = !canRender3d || !!SS.insertListView;
    let disposed = false;

    const bevelDeg = ()=> c.needleUnit
      ? (c.needleUnit.bevelDeg == null ? bevelFromTurns(c.needleUnit.turns) : c.needleUnit.bevelDeg)
      : null;
    const evaluate = ()=>evaluateInsert(ins, c.armVessels || [], bevelDeg());

    function draw(result){
      if(disposed) return;
      renderInsertCoach(stage, {
        state: ins,
        result: result || evaluate(),
        bevelDeg: bevelDeg(),
        guided: guided(),
        listView, canRender3d,
        handlers: {
          onReady: finish,
          onToggleView: toggleView,
          onAction: (kind)=>draw(doAction(kind)),
        },
      });
    }

    function checkFlash(){
      const v = (c.armVessels || []).find(x => x.id === ins.chosenId);
      if(v) markFlashIfInVein(ins, v, Date.now());
    }

    // The controls tear the 3D scene down, so these cannot go through the
    // runtime — but they run the SAME pure technique helpers it does, so the
    // anchor offsets, angles and depths that come out are identical.
    function doAction(kind){
      if(isInsertActive()){
        switch(kind){
          case "anchor-ideal": return anchorProgrammatically(0.035, 0.016) || evaluate();
          case "anchor-close": return anchorProgrammatically(0.010, 0.016) || evaluate();
          case "anchor-far": return anchorProgrammatically(0.090, 0.016) || evaluate();
          case "anchor-wrongside": return anchorProgrammatically(-0.020, 0.016) || evaluate();
          case "anchor-weak": return anchorProgrammatically(0.035, 0.003) || evaluate();
          case "redo-anchor": return redoAnchor() || evaluate();
          case "insert-ideal": return insertProgrammatically(20, 0.006) || evaluate();
          case "insert-shallow": return insertProgrammatically(5, 0.006) || evaluate();
          case "insert-steep": return insertProgrammatically(45, 0.006) || evaluate();
          case "advance": return advanceProgrammatically(0.0012) || evaluate();
          case "retreat": return advanceProgrammatically(-0.0008) || evaluate();
          case "pullout": return pullOutProgrammatically() || evaluate();
          default: return evaluate();
        }
      }
      switch(kind){
        case "anchor-ideal": anchorAt(ins, ins.markX - 0.035, 0.016); break;
        case "anchor-close": anchorAt(ins, ins.markX - 0.010, 0.016); break;
        case "anchor-far": anchorAt(ins, ins.markX - 0.090, 0.016); break;
        case "anchor-wrongside": anchorAt(ins, ins.markX + 0.020, 0.016); break;
        case "anchor-weak": anchorAt(ins, ins.markX - 0.035, 0.003); break;
        case "redo-anchor": resetAnchor(ins); break;
        case "insert-ideal": insertInto(ins, ins.markX, ins.markZ, 20, 0.006); checkFlash(); break;
        case "insert-shallow": insertInto(ins, ins.markX, ins.markZ, 5, 0.006); checkFlash(); break;
        case "insert-steep": insertInto(ins, ins.markX, ins.markZ, 45, 0.006); checkFlash(); break;
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
      if(guided() && !result.ready) return;
      const measurements = measureInsert(ins, result, bevelDeg());
      applyInsertOutcome(c, measurements);
      if(c.encounter){
        c.encounter.access = ins;
        c.encounter.measurements.insert = measurements;
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
      guided: guided(),
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
      guided: guided(),
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
    if(guided() && !withdrawalModeReady(wd, lc, mode)) return;
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
function runCollection(c, stage, advance, mode){
  const arm = ensureArmSession(c);
  const ins = ensureInsertSession(c);
  const col = ensureCollectionSession(c);
  const canRender3d = !!getRenderer();
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
      guided: guided(),
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
  // seat depths, fill volumes and needle shifts that come out are identical.
  function doAction(kind){
    const live = isCollectionActive();
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
    if(guided() && !stepReady(result)) return;
    const measurements = measureCollection(col, result, {
      tourniquetSeconds: tourniquetSecondsFor(c),
    });
    applyCollectionOutcome(c, measurements);
    if(c.encounter){
      c.encounter.collection = col;
      c.encounter.measurements.collection = measurements;
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

export function hasPhysicalStep(id){ return Object.prototype.hasOwnProperty.call(PHYSICAL_STEPS, id); }
