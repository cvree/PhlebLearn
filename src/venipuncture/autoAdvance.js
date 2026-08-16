/* =========================================================================
   IMPLICIT ADVANCEMENT — how a draw stops being a slideshow.

   In Learn, a step ends when the learner presses a button that says so. That
   is right for a lesson: the confirmation is a beat, and the gate that comes
   with it is how Learn teaches.

   In Play there is no button. The step ends because the ACTION that ends it
   happened. You tie the band and the draw is on the band; you commit to a
   vein and the draw is on the vein; the last tube comes off and the draw is
   on the withdrawal. Nothing is pressed, nothing is announced, and there is
   no step counter to watch tick over — which is the whole point, because a
   trained phlebotomist counting down "step 9 of 16" is being reminded they
   are inside a piece of software.

   THREE THINGS THIS FILE IS CAREFUL ABOUT

   1. COMPLETION AND PERMISSION STAY SEPARATE. This asks "has the thing that
      ends this step happened?", never "was it done well?". `clinicalRules.js`
      still owns permission, the rubric still owns judgement, and a step done
      badly still advances — and is still graded badly. A mode that silently
      refused to move on until the learner got it right would be Learn with
      the instructions removed, which is the worst of both.

   2. IT SETTLES BEFORE IT AGREES. A band is "secured" the instant the loop
      goes under, while the strap is still springing into place; a tube is off
      the holder before the hand has finished moving away. Advancing on that
      frame cuts the animation in half and reads as the game snatching the
      scene away. So readiness has to HOLD for a moment first.

   3. IT NEVER FIRES ON THE FRAME A STEP OPENS. Several steps evaluate as
      ready the instant they are entered — post-draw is "done" before any
      pressure is applied if haemostasis was already reached, and the switch
      step is trivially complete for a one-tube draw. Advancing there would
      skip the step entirely without the learner seeing it. A step must be
      seen to become ready, not found ready.

   The two steps that DON'T auto-advance are the two where "done" is a
   judgement rather than an event: the introduction, and preparing the work
   area. Nothing happens that means "I have asked everything I need to" or
   "my tray is ready" — the learner decides, and so they still say so.
   ========================================================================= */
import { reveal } from "../game/gameState.js";

/**
 * How long readiness must hold before the draw agrees.
 *
 * Long enough that the band finishes landing and the hand finishes leaving,
 * short enough that it never feels like waiting for permission.
 */
export const SETTLE_MS = 420;

let watch = null;

/**
 * Called from a step's own `draw()`, every time it re-renders, with whether
 * that step's completing action has happened and what to call when it has.
 *
 * Steps report; this decides. Which is the same division every other layer in
 * this codebase runs on — the runtime writes state and asks the rules, and
 * decides nothing itself.
 */
export function reportStepReady(key, ready, finish){
  // Learn keeps its button. `stepChrome` is the mode's own description of
  // whether it shows the scaffolding of a lesson, and the confirm button is
  // part of that scaffolding.
  if(reveal().stepChrome){ watch = null; return; }

  if(!watch || watch.key !== key){
    /* A NEW STEP. If it is ALREADY ready on the frame it opens, this step has
       nothing for the learner to do — a one-tube draw has no tube to switch
       to, and post-draw can open with haemostasis already reached. Arm it
       anyway rather than firing: a step that is skipped without ever being
       seen is indistinguishable from a step that is broken. */
    watch = { key, ready: false, since: 0, armed: !ready, finish };
    return;
  }

  watch.finish = finish;
  if(!watch.armed){
    // it opened ready; wait for it to become NOT ready, or for a real change
    if(!ready) watch.armed = true;
    return;
  }

  if(!ready){ watch.ready = false; watch.since = 0; return; }
  if(!watch.ready){ watch.ready = true; watch.since = now(); }
}

/**
 * Ticked once a frame from the composition root, next to the complication
 * watcher — for the same reason that one is: what it is watching does not
 * belong to whichever screen happens to be up.
 */
export function tickAutoAdvance(){
  if(!watch || !watch.ready || !watch.armed) return false;
  if(now() - watch.since < SETTLE_MS) return false;
  const go = watch.finish;
  watch = null;
  if(typeof go === "function"){ go(); return true; }
  return false;
}

/** Forgotten when the step changes, the draw ends, or the scene is torn down. */
export function clearAutoAdvance(){ watch = null; }

/** What is being waited on, for the test seam. */
export function autoAdvanceState(){
  if(!watch) return null;
  return {
    key: watch.key, ready: watch.ready, armed: watch.armed,
    heldMs: watch.ready ? Math.round(now() - watch.since) : 0,
  };
}

function now(){
  return typeof performance !== "undefined" && performance.now
    ? performance.now() : Date.now();
}
