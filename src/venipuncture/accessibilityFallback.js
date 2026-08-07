/* =========================================================================
   PROCEDURE DRIVER: walks the step sequence from procedureState.js and picks
   an implementation for each step id.

     1. physicalSteps.js  — the real, object-manipulation gameplay (preferred)
     2. steps.js          — the 2D DOM fallback / accessibility path

   Both implementations share the identical signature, the identical
   procedure state and the identical clinicalRules.js gates, so swapping a
   step from (2) to (1) never changes sequencing or scoring semantics. Each
   later branch converts one more id from the fallback list to the physical
   list without touching this file.

   This module intentionally does NOT import ui/panels.js or game state's
   `go()` — the caller (ui/panels.js's renderCollect) supplies callbacks for
   the two moments that need to leave the venipuncture screen entirely:
   finishing the whole procedure, or a mid-draw complication interrupting it.
   ========================================================================= */
import { TUBES } from "../config.js";
import { buildStepSequence, canonicalTubeOrder } from "./procedureState.js";
import { VP_STEPS } from "./steps.js";
import { PHYSICAL_STEPS } from "./physicalSteps.js";
import { createEncounterState } from "./encounterState.js";
import { createComplicationState } from "./complications/complicationState.js";
import { difficultyLevel } from "../game/saveSystem.js";
import { VP_TIPS, VP_ICON } from "./questions.js";

// Fresh procedure state for one encounter's draw. `opts.patient` seeds the
// persistent encounter object every physical step reads and writes.
export function createProcedureState(tubeKeys, opts){
  const o = opts||{};
  const tubes = canonicalTubeOrder(tubeKeys, TUBES);
  const patient = o.patient || null;
  return {
    step: 0,
    steps: buildStepSequence(tubes.length),
    tubes,
    filled: [],
    patientName: patient ? patient.name : null,
    // The whole patient, because from Phase 1b onward the physical steps build
    // a real arm from their appearance and site scenario — skin tone, build,
    // which arm, and whether the veins are deep or flat.
    patient,
    encounter: createEncounterState({ tubes, patient, handedness:o.handedness }),
    // What the patient's body does back, for the whole draw rather than for
    // any one step. Created here, with the draw, because the watcher that
    // ticks it starts before the first step builds anything — see
    // complications/complicationRuntime.js.
    complications: createComplicationState({
      patient, difficulty: difficultyLevel(),
    }),
    // Real play never sets this — ensureArmSession() rolls indicatedProcedure()
    // from the patient's own arms. The test seam is the only caller that
    // forces a specific procedure, so a scenario can be exercised on demand
    // rather than waiting for the right arm condition to come up at random.
    forcedProcedure: o.forcedProcedure || null,
  };
}

/** True when the physical (3D) implementation of a step id exists. */
export function isPhysicalStep(id){
  return Object.prototype.hasOwnProperty.call(PHYSICAL_STEPS, id);
}

// Renders the current step into `stage`, wiring an `advance` callback that
// either re-renders the same step (stayOnStep truthy) or moves to the next
// one. Returns an optional cleanup function (steps with a rAF loop return
// one) that the caller should invoke before re-rendering.
export function renderCurrentStep(c, stage, hooks){
  const id = c.steps[c.step];
  const fn = PHYSICAL_STEPS[id] || VP_STEPS[id] || VP_STEPS.introduce;
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
    // Every finished step is worth acknowledging the moment it is finished.
    // What that acknowledgement IS belongs to the caller — this module knows
    // nothing about XP, streaks or sound; it knows a step just ended and
    // which one. See game/rewards.js.
    if(hooks.onStepFinished) hooks.onStepFinished(finishedId, c.step < c.steps.length ? c.steps[c.step] : null);

    // End of a section. Whether anything is SHOWN is the caller's decision —
    // this module knows nothing about modes. Practice mode returns a payload
    // and renders the section's own measurements; Learn and the Final
    // Practical return nothing and fall straight through.
    if(hooks.sectionFeedbackFor){
      const nextId = c.step < c.steps.length ? c.steps[c.step] : null;
      const payload = hooks.sectionFeedbackFor(finishedId, nextId);
      if(payload && hooks.onSectionFeedback){ hooks.onSectionFeedback(payload); return; }
    }
    if(c.step>=c.steps.length){ hooks.onComplete(); return; }
    hooks.rerender();
  };
  const cleanup = fn(c, stage, advance);
  if(hooks.setCleanup) hooks.setCleanup(cleanup||null);
  return { id, info: VP_TIPS[id], icon: VP_ICON[id] };
}
