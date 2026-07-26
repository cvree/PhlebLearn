/* =========================================================================
   The 2D DOM fallback driver: walks the step sequence from procedureState.js,
   rendering each one via steps.js. This is the "temporary gameplay fallback /
   accessibility mode / regression reference" the Phase 0 requirements ask to
   preserve — a future 3D procedure driver would implement the same shape
   (advance through buildStepSequence(), rendering each step id) and can
   consume the exact same clinicalRules.js + questions.js.

   This module intentionally does NOT import ui/panels.js or game state's
   `go()` — the caller (ui/panels.js's renderCollect) supplies callbacks for
   the two moments that need to leave the venipuncture screen entirely:
   finishing the whole procedure, or a mid-draw complication interrupting it.
   ========================================================================= */
import { buildStepSequence } from "./procedureState.js";
import { VP_STEPS } from "./steps.js";
import { VP_TIPS, VP_ICON } from "./questions.js";

// Fresh procedure state for one encounter's draw.
export function createProcedureState(tubeKeys){
  const tubes=[...new Set(tubeKeys)];
  return {
    step: 0,
    steps: buildStepSequence(tubes.length),
    tubes,
    filled: [],
  };
}

// Renders the current step into `stage`, wiring an `advance` callback that
// either re-renders the same step (stayOnStep truthy) or moves to the next
// one. Returns an optional cleanup function (steps with a rAF loop return
// one) that the caller should invoke before re-rendering.
export function renderCurrentStep(c, stage, hooks){
  const id = c.steps[c.step];
  const fn = VP_STEPS[id] || VP_STEPS.hygiene;
  const advance = (stayOnStep)=>{
    if(hooks.onCleanup) hooks.onCleanup();
    if(stayOnStep){ hooks.rerender(); return; }
    const finishedId = c.steps[c.step];
    c.step++;
    // a "mid" draw complication (needle in the vein, blood flowing) interrupts
    // right after insertion — gated on an explicit trigger field, not on the
    // step's id string.
    if(finishedId==="insert" && hooks.hasMidDrawEvent && hooks.hasMidDrawEvent() && hooks.onMidDrawEvent){
      hooks.onMidDrawEvent(c.step);
      return;
    }
    if(c.step>=c.steps.length){ hooks.onComplete(); return; }
    hooks.rerender();
  };
  const cleanup = fn(c, stage, advance);
  if(hooks.setCleanup) hooks.setCleanup(cleanup||null);
  return { id, info: VP_TIPS[id], icon: VP_ICON[id] };
}
