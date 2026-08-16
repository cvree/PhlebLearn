/* =========================================================================
   WHO GETS THE POINTER, AND FOR HOW LONG.

   Two rules, and the first one is a bug fix rather than a feature.

   1. A GESTURE BELONGS TO WHOEVER TOOK IT, UNTIL IT ENDS.

      The composition root used to ask "which step is active?" on every
      pointer event independently. That is fine while a step is a screen you
      leave by pressing a button, and it stops being fine the moment a step
      can end BY ITSELF — which is what implicit advancement does, on the
      up-stroke of the very action that completed it.

      The sequence is: down goes to the tourniquet; the band lands; the step
      completes and the runtime is torn down; the pointerup arrives, finds no
      active runtime, and is handed to the room's orbit controls. Nobody tells
      the hand camera the hand came up, so it holds every framing for the rest
      of the draw waiting for a finger that is already off the glass.

      So the down LATCHES an owner and the matching move/up/cancel go there,
      whatever the step machine has decided since. The release always happens.

   2. THE OFFER IS THE CLAIM.

      Every runtime's `down` already answers "was that mine?" — it hit-tests
      its own objects against its own scene and returns false on a miss. A
      separate `claims(pick)` would be a second copy of that hit test, living
      outside the runtime's own state, and the two would drift the first time
      one of them learned about a new object. So the pointer is OFFERED to the
      live runtimes in order and the first to answer takes it.

      With one runtime live — every draw today — this is exactly what happened
      before. With two, which the lease protocol permits and
      tests/bench.spec.js pins down, it is the dispatcher inversion:

          before:  active step      ->  runtime  ->  what you can touch
          after:   what you touched ->  runtime  ->  active step

      `reach` is the switch between them, and Learn passes it false
      permanently: the mode that teaches keeps one step at a time.

   Pure bookkeeping. No THREE, no DOM, no imports — the rows are passed in.
   ========================================================================= */

/**
 * @param {() => Array} liveRuntimes  the runtimes holding the canvas right
 *   now, in priority order. Called fresh on every down, because which
 *   runtimes are live is the step machine's business and changes underneath
 *   this.
 * @param {{onError?: (id, phase, err) => void}} [o]
 */
export function createGestureDispatch(liveRuntimes, o){
  const opts = o || {};
  let owner = null;
  /* The canvas has one pointer as far as the bench is concerned: every
     gesture here is one-handed, and runtimes capture the pointer they took.
     A second finger arriving mid-gesture is swallowed rather than delivered —
     it is a palm on the screen, not a second intention. */
  let ownedPointerId = null;

  function fail(id, phase, err){
    if(opts.onError) opts.onError(id, phase, err);
    else console.error(`[${id}] pointer${phase} failed`, err);
  }

  function mine(e){
    return ownedPointerId == null || !e || e.pointerId === undefined || e.pointerId === ownedPointerId;
  }

  return {
    /**
     * Offers a pointerdown and latches whoever takes it.
     *
     * @param {{reach?: boolean}} [dispatchOpts] `reach` offers the event to
     *   every live runtime; without it only the first is asked, which is
     *   Learn's permanent behaviour.
     * @returns the runtime now holding the gesture, or null if the bench is
     *   not up at all. A non-null answer means the canvas belongs to the
     *   bench and the room's camera must not see this event.
     */
    down(e, canvasEl, dispatchOpts){
      const live = liveRuntimes() || [];
      if(!live.length){ owner = null; ownedPointerId = null; return null; }

      const offerTo = (dispatchOpts && dispatchOpts.reach) ? live : live.slice(0, 1);
      let took = null;
      for(const r of offerTo){
        let claimed = false;
        try{ claimed = r.down(e, canvasEl) !== false; }
        catch(err){ fail(r.id, "down", err); claimed = false; }
        if(claimed){ took = r; break; }
      }

      /* Nobody wanted it. The bench still owns the canvas — a miss on the arm
         is a miss, not a request to orbit the room — so the first live
         runtime keeps the gesture and gets the up it is entitled to. */
      owner = took || live[0];
      ownedPointerId = e && e.pointerId !== undefined ? e.pointerId : null;
      return owner;
    },

    /** @returns true when the bench consumed the move. */
    move(e, canvasEl){
      if(!owner) return false;
      if(!mine(e)) return true;
      try{ owner.move(e, canvasEl); }
      catch(err){ fail(owner.id, "move", err); }
      return true;
    },

    /**
     * Ends the gesture at whoever took it, and releases the latch even if the
     * handler throws — a stuck owner would swallow every later pointerdown.
     *
     * @param {"up"|"cancel"} phase
     * @returns true when the bench consumed it.
     */
    end(phase, e, canvasEl){
      if(!owner) return false;
      if(!mine(e)) return true;
      const r = owner;
      owner = null;
      ownedPointerId = null;
      const which = phase === "cancel" ? "cancel" : "up";
      try{ r[which](e, canvasEl); }
      catch(err){ fail(r.id, which, err); }
      return true;
    },

    /** The runtime holding the gesture, or null between gestures. */
    get owner(){ return owner; },

    /**
     * Drops the latch without telling anybody — for a scene torn down out
     * from under a live gesture, where there is no runtime left to tell.
     */
    forget(){ owner = null; ownedPointerId = null; },
  };
}
