/* =========================================================================
   WHAT THE CAMERA IS LOOKING AT, AND WHEN IT IS ALLOWED TO MOVE.

   Two rules live here, and the second one is a correctness rule rather than
   an aesthetic one.

   1. THE CAMERA FOLLOWS THE HAND, NOT THE STEP.

      The framing used to be picked from the mode a lease was opened with —
      "this is the tourniquet step, so use the `access` framing". That is the
      same thing as saying the camera follows the SCREEN you are on, and it is
      wrong for the same reason a step counter is wrong: a draw is a
      continuous piece of work in which the thing worth looking at is whatever
      is in your hand.

      Picking up an alcohol pad should push in on the site. Picking up a tube
      should pull back far enough to see the rack. Putting it down should let
      the frame breathe again. None of that depends on which step the machine
      thinks it is on, and once several tools are reachable at once (the
      dispatcher inversion) the step cannot answer the question at all.

   2. A FRAMING NEVER MOVES UNDER A HAND THAT IS ALREADY DOWN.

      `armScene.js` re-solves the skin point under the pointer against the LIVE
      camera every frame. So a camera that eases while a finger is pressed
      drags that finger across the arm: the hand does not move, the world moves
      under it, and the learner's stroke is recorded somewhere they never
      touched. `cleaningRuntime.js` discovered this and defended against it
      locally with a two-framing rule; it is not a cleaning problem, it is a
      property of the pointer solve, and every gesture in the game has it.

      So a framing requested while a gesture is in progress is HELD and applied
      the moment the hand comes up. The camera is never yanked mid-stroke, and
      no runtime has to remember to think about it.

   Pure bookkeeping — no THREE, no DOM. The view is passed in.
   ========================================================================= */

/**
 * What is in the hand → which beat framing to hold.
 *
 * `null` means "this tool's framing is not a constant, and the runtime holding
 * it will say". The swab is the only one today: the prep field is 5 cm across
 * and sits wherever the learner marked the vein, so its framing is solved from
 * the site (see benchFramings' scrubFraming). Recording it here as null rather
 * than omitting it is the point — an omission would silently fall back to the
 * wide view and pull the camera OUT at the exact moment it should push in.
 */
export const FRAMING_FOR_HELD = {
  /* Nothing. The wide working view: the whole limb, the hand, and the
     patient, which is what you look at while deciding what to do next. */
  none: "access",

  band: "access",         // judging tension means watching the hand too
  finger: "access",       // palpating sweeps the whole fossa
  swab: null,             // site-specific — cleaningRuntime supplies it
  needle: "prep",         // built at the bench beside the arm
  holder: "prep",
  sharps: "prep",
  tip: "stick",           // the needle is at the skin: millimetre work
  tube: "collect",        // the holder, the rack and the arm at once
  gauze: "close",
  bandage: "close",
  filledTube: "bench",    // mixing happens off the patient
};

/**
 * The camera state for one encounter. One per bench, created with it.
 *
 * Deliberately a factory rather than a module-level singleton: two encounters
 * must never share a held-tool or a gesture flag, and a stale one is exactly
 * the kind of bug that only shows up on the second patient.
 */
export function createHandCamera(view){
  let held = "none";
  let handDown = false;
  let pending = null;      // a framing asked for while the hand was down

  /**
   * Applies a framing, or holds it until the hand comes up.
   *
   * Takes a named beat or a framing computed on the spot — the scrub's is
   * site-specific and cannot be a constant. The runtime decides WHAT to look
   * at; this decides WHEN it is safe to move there, which is the whole
   * division of labour.
   */
  function want(focus){
    if(!focus) return;
    if(handDown){ pending = focus; return; }
    pending = null;
    if(view && view.frameBeat) view.frameBeat(focus);
  }

  return {
    /**
     * What the learner has picked up, or `null`/`"none"` for an empty hand.
     * Idempotent: runtimes call it every frame without thinking about it.
     */
    hold(tool){
      const id = tool || "none";
      if(id === held) return;
      held = id;
      // A declared null means the runtime supplies its own framing; an
      // UNdeclared tool is a mistake, and falling back to the working view is
      // the least surprising thing to do about it.
      const known = Object.prototype.hasOwnProperty.call(FRAMING_FOR_HELD, id);
      if(known && FRAMING_FOR_HELD[id] == null) return;
      want(known ? FRAMING_FOR_HELD[id] : FRAMING_FOR_HELD.none);
    },

    /** Whatever is in the hand right now. */
    get held(){ return held; },

    /**
     * A gesture started. From here until `up()`, the camera holds still — see
     * rule 2. Called from the composition root's pointer wiring, so no runtime
     * can forget to.
     */
    down(){ handDown = true; },

    /** The gesture ended; anything that was waiting to move may move now. */
    up(){
      handDown = false;
      if(pending){ const n = pending; pending = null; want(n); }
    },

    /** True while a framing is waiting for the hand to come up. */
    get deferring(){ return !!pending; },
    get handDown(){ return handDown; },

    /**
     * A framing a runtime wants for a reason of its own — the scrub's
     * site-specific push-in, say — routed through the same hold so it cannot
     * yank the camera mid-stroke either.
     */
    request(name){ want(name); },
  };
}
