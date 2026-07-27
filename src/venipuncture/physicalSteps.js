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
import { stagedItemId } from "./encounterState.js";
import { CATEGORY } from "./staging/supplyCatalog.js";
import {
  createTourniquetState, markRouted, setTension, markCrossed, markSecured, markUnravelled,
  isSecured,
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
import { evaluateAssembly, evaluateUncap } from "./assembly/assemblyRules.js";
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
};

export function hasPhysicalStep(id){ return Object.prototype.hasOwnProperty.call(PHYSICAL_STEPS, id); }
