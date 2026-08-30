/* =========================================================================
   IMPLICIT ADVANCEMENT — how a draw stops being a slideshow.

   A step ends because the action that ends it happened: you tie the band and
   the draw is on the band, the last tube comes off and the draw is on the
   withdrawal. Both modes work this way now. Learn used to keep a confirm
   button, which gated nothing — a step becomes ready when it is RIGHT, so the
   button was only ever pressable once the gate had already opened. What Learn
   keeps is the BEAT: it holds a finished step, and the line saying what was
   good about it, roughly three times as long before moving on.

   Three properties matter more than the mechanism, and each has cost a real
   bug in a game that tried this:

     it must not fire on the frame a step OPENS, or a step that was already
     complete is skipped without the learner ever seeing it;

     it must SETTLE, or it cuts the band's own landing animation in half and
     reads as the game snatching the scene away;

     it must never gate. Completion is not permission. A step done badly
     still advances and is still graded badly, because a mode that refused to
     move on until you got it right would be Learn with the teaching removed.
   ========================================================================= */
import test from "node:test";
import assert from "node:assert/strict";

import { setMode, MODES } from "../src/game/gameState.js";
import {
  reportStepReady, tickAutoAdvance, clearAutoAdvance, autoAdvanceState,
  SETTLE_MS, LEARN_SETTLE_MS, settleMs,
} from "../src/venipuncture/autoAdvance.js";

/** Reports readiness and lets `ms` of wall time pass, then ticks. */
function hold(key, ready, finish, ms){
  reportStepReady(key, ready, finish);
  const until = Date.now() + ms;
  while(Date.now() < until){ /* real time, because the watcher reads a clock */ }
  return tickAutoAdvance();
}

function fresh(mode){
  clearAutoAdvance();
  setMode(mode);
}

test("Learn advances on the action too, but holds the beat first", () => {
  fresh(MODES.LEARN);
  let fired = 0;
  const finish = ()=>fired++;
  assert.equal(settleMs(), LEARN_SETTLE_MS);

  reportStepReady("tourniquet", false, finish);      // the step opens, not done
  reportStepReady("tourniquet", true, finish);        // the band goes on

  // Play's settle is not enough here: the learner is being told what was good
  // about that band, and that sentence is the thing the button used to buy.
  assert.equal(hold("tourniquet", true, finish, SETTLE_MS + 60), false);
  assert.equal(fired, 0);

  assert.equal(hold("tourniquet", true, finish, LEARN_SETTLE_MS - SETTLE_MS + 60), true);
  assert.equal(fired, 1);
});

test("Learn's beat is longer than Play's, and Play's is unchanged", () => {
  fresh(MODES.LEARN);
  assert.equal(settleMs(), LEARN_SETTLE_MS);
  fresh(MODES.PLAY);
  assert.equal(settleMs(), SETTLE_MS);
  assert.ok(LEARN_SETTLE_MS > SETTLE_MS);
});

test("Play advances once the completing action has held for a moment", () => {
  fresh(MODES.PLAY);
  let fired = 0;
  const finish = ()=>fired++;

  reportStepReady("tourniquet", false, finish);      // the step opens, not done
  assert.equal(tickAutoAdvance(), false);

  reportStepReady("tourniquet", true, finish);        // the band goes on
  assert.equal(tickAutoAdvance(), false, "not on the very frame it happened");

  assert.equal(hold("tourniquet", true, finish, SETTLE_MS + 60), true);
  assert.equal(fired, 1);
});

test("it waits for the scene to settle rather than cutting it off", () => {
  fresh(MODES.PLAY);
  let fired = 0;
  const finish = ()=>fired++;
  reportStepReady("tourniquet", false, finish);
  // A band is "secured" the instant the loop goes under, while the strap is
  // still springing into place. Advancing there halves its own animation.
  assert.equal(hold("tourniquet", true, finish, Math.round(SETTLE_MS*0.4)), false);
  assert.equal(fired, 0);
});

test("a step that opens already complete is not skipped unseen", () => {
  // A one-tube draw has no tube to switch to; post-draw can open with
  // haemostasis already reached. Advancing there would skip the step without
  // the learner ever seeing it, which is indistinguishable from a bug.
  fresh(MODES.PLAY);
  let fired = 0;
  const finish = ()=>fired++;
  assert.equal(hold("collection:switch", true, finish, SETTLE_MS + 60), false);
  assert.equal(fired, 0);
  assert.equal(autoAdvanceState().armed, false, "armed only once it has been not-ready");
});

test("undoing the completing action calls it off", () => {
  fresh(MODES.PLAY);
  let fired = 0;
  const finish = ()=>fired++;
  reportStepReady("tourniquet", false, finish);
  reportStepReady("tourniquet", true, finish);
  // …and then the band is taken back off before the settle elapsed
  assert.equal(hold("tourniquet", false, finish, SETTLE_MS + 60), false);
  assert.equal(fired, 0);
  // and the clock restarts from the next time it becomes ready
  reportStepReady("tourniquet", true, finish);
  assert.equal(tickAutoAdvance(), false);
});

test("moving to a different step forgets what the last one was waiting on", () => {
  fresh(MODES.PLAY);
  let fired = 0;
  const finish = ()=>fired++;
  reportStepReady("tourniquet", false, finish);
  reportStepReady("tourniquet", true, finish);
  // the learner leaves the draw, or a complication interrupts
  reportStepReady("palpate", false, finish);
  assert.equal(hold("palpate", false, finish, SETTLE_MS + 60), false);
  assert.equal(fired, 0);
});

test("clearing stops it dead, however ready it was", () => {
  fresh(MODES.PLAY);
  let fired = 0;
  const finish = ()=>fired++;
  reportStepReady("insert", false, finish);
  reportStepReady("insert", true, finish);
  const until = Date.now() + SETTLE_MS + 60;
  while(Date.now() < until){ /* wait */ }
  clearAutoAdvance();
  assert.equal(tickAutoAdvance(), false);
  assert.equal(fired, 0);
});

test("it fires exactly once, not every frame after", () => {
  fresh(MODES.PLAY);
  let fired = 0;
  const finish = ()=>fired++;
  reportStepReady("insert", false, finish);
  assert.equal(hold("insert", true, finish, SETTLE_MS + 60), true);
  assert.equal(tickAutoAdvance(), false);
  assert.equal(tickAutoAdvance(), false);
  assert.equal(fired, 1);
});

test("it reports what it is waiting on, for anyone debugging a stuck draw", () => {
  fresh(MODES.PLAY);
  reportStepReady("clean", false, ()=>{});
  reportStepReady("clean", true, ()=>{});
  const s = autoAdvanceState();
  assert.equal(s.key, "clean");
  assert.equal(s.ready, true);
  assert.equal(s.armed, true);
  assert.ok(s.heldMs >= 0);
});

test("switching to Learn mid-draw lengthens the beat rather than cancelling it", () => {
  fresh(MODES.PLAY);
  let fired = 0;
  const finish = ()=>fired++;
  reportStepReady("clean", false, finish);
  reportStepReady("clean", true, finish);
  setMode(MODES.LEARN);
  // Play's settle would have fired by now; Learn's has not elapsed yet.
  assert.equal(hold("clean", true, finish, SETTLE_MS + 60), false);
  assert.equal(fired, 0);
  // …and it still lands, on Learn's clock.
  assert.equal(hold("clean", true, finish, LEARN_SETTLE_MS - SETTLE_MS + 60), true);
  assert.equal(fired, 1);
});
