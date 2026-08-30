/* =========================================================================
   IMPLICIT ADVANCEMENT — how a draw stops being a slideshow.

   A step ends because the ACTION that ends it happened. You tie the band and
   the draw is on the band; you commit to a vein and the draw is on the vein;
   the last tube comes off and the draw is on the withdrawal. Nothing is
   pressed and nothing is announced.

   THIS USED TO BE PLAY-ONLY, AND LEARN KEPT A BUTTON.

   The argument was that the confirmation is a beat and the gate that comes
   with it is how Learn teaches. Neither half survived contact with the
   screen. The gate is not the button's: a step becomes ready when it is
   RIGHT, so the button was only ever pressable at the moment the gate had
   already opened — it gated nothing. And the beat it bought cost sixteen
   clicks a draw on a full-width primary button that, for all the time before
   that moment, read "Not ready yet": the loudest control on the panel,
   permanently disabled, saying nothing the guidance line was not already
   saying better.

   So Learn advances on the action too. What it keeps is the BEAT — it holds
   the finished step, and its "that is a good tourniquet" line, on screen
   about three times as long as Play does, which is what the button was
   actually providing. See settleMs().

   Two steps still end on a press in every mode, because there is no action
   in them that means "done": the arrival room ("I have asked everything I
   need to") and the supply cart ("my tray is ready"). Those are judgements,
   and the learner makes them.

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
   ========================================================================= */
import { reveal } from "../game/gameState.js";

/**
 * How long readiness must hold before the draw agrees.
 *
 * Long enough that the band finishes landing and the hand finishes leaving,
 * short enough that it never feels like waiting for permission.
 */
export const SETTLE_MS = 420;

/**
 * Learn's settle: the same mechanism, held long enough to read.
 *
 * This is what the confirm button was really for. A learner who has just
 * tied a good band is told so — "veins filled, pulse intact, tail clear of
 * the field" — and that sentence is worth about a second of standing still
 * before the draw moves on. A trained phlebotomist does not need the second,
 * which is why Play does not spend it.
 */
export const LEARN_SETTLE_MS = 1250;

/** The settle this mode uses. `stepChrome` is the mode's own "this is a lesson". */
export function settleMs(){
  return reveal().stepChrome ? LEARN_SETTLE_MS : SETTLE_MS;
}

let watch = null;

/* ---------- the browser tests' handle on all of this --------------------------
   A step that ends itself a beat after it becomes ready is exactly what this
   file is for, and it is also a race for any test that wants to ASSERT the
   step became ready: by the time the assertion runs, the draw has moved on and
   the readiness it was reading belongs to the next step.

   So the ?e2e=1 seam can hold the draw on the current step and end it on
   demand — the same two things the confirm button used to give a test, without
   putting the button back in the game. Nothing outside the seam calls either:
   `installTestSeam()` is the only importer, and it only runs under ?e2e=1.
   ---------------------------------------------------------------------------- */
let held = false;

/** Freezes (or unfreezes) implicit advancement. Test seam only. */
export function holdAutoAdvance(on){ held = !!on; }

/** Ends the current step now, if its completing action has happened. Test seam only. */
export function fireAutoAdvance(){
  if(!watch || !watch.ready || !watch.armed) return false;
  const go = watch.finish;
  watch = null;
  if(typeof go === "function"){ go(); return true; }
  return false;
}

/**
 * Called from a step's own `draw()`, every time it re-renders, with whether
 * that step's completing action has happened and what to call when it has.
 *
 * Steps report; this decides. Which is the same division every other layer in
 * this codebase runs on — the runtime writes state and asks the rules, and
 * decides nothing itself.
 */
export function reportStepReady(key, ready, finish){
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
  if(held) return false;
  if(!watch || !watch.ready || !watch.armed) return false;
  if(now() - watch.since < settleMs()) return false;
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
