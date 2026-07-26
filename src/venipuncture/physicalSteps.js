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
import { SS, saveSS } from "../game/gameState.js";
import { getRenderer } from "../rendering/renderer.js";
import { buildSupplyCatalog } from "./staging/supplyCatalog.js";
import { createStagingState, setHandedness, placeItem, inspectItem, HAND, ZONE } from "./staging/stagingState.js";
import { createLayout, orientationForAspect } from "./staging/stagingLayout.js";
import { evaluateStaging } from "./staging/stagingRules.js";
import { measureStaging } from "./staging/stagingScoring.js";
import { renderStagingCoach } from "./staging/stagingCoach.js";
import {
  startStaging, stopStaging, isStagingActive, syncStagingFromState,
  stageItemTo, inspectItemById, returnItemToShelf,
} from "./staging/stagingRuntime.js";

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
      if(!result.ready) return;
      session.state.completedAt = Date.now();
      session.measurements = measureStaging(session.state, session.catalog, result);
      c.gatherOk = true;
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
};

export function hasPhysicalStep(id){ return Object.prototype.hasOwnProperty.call(PHYSICAL_STEPS, id); }
