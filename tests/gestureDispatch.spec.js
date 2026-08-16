/* =========================================================================
   WHO GETS THE POINTER, AND FOR HOW LONG.

   The dispatcher decides two things: which runtime a gesture starts at, and
   which runtime the rest of that gesture goes to. The second question used to
   be answered afresh on every event, and these tests are mostly about why
   that was wrong even before two runtimes could be live at once.

   Stub rows throughout — the subject is the routing, not any runtime.
   ========================================================================= */
import test from "node:test";
import assert from "node:assert/strict";

import { createGestureDispatch } from "../src/bench/gestureDispatch.js";

/** A runtime that records what it was given, and takes what it is told to. */
function stub(id, takes){
  const log = [];
  return {
    id, log,
    takes: takes !== false,
    down(){ log.push("down"); return this.takes; },
    move(){ log.push("move"); },
    up(){ log.push("up"); },
    cancel(){ log.push("cancel"); },
  };
}

const E = { pointerId: 1 };
const CANVAS = {};

/* ---------- one runtime: exactly what happened before --------------------- */

test("with nothing live, the bench does not consume the pointer", () => {
  const d = createGestureDispatch(() => []);
  assert.equal(d.down(E, CANVAS), null, "a null answer is what lets the room orbit");
  assert.equal(d.move(E, CANVAS), false);
  assert.equal(d.end("up", E, CANVAS), false);
});

test("the live runtime gets the down, the move and the up", () => {
  const r = stub("tourniquet");
  const d = createGestureDispatch(() => [r]);
  assert.equal(d.down(E, CANVAS), r);
  assert.equal(d.move(E, CANVAS), true);
  assert.equal(d.end("up", E, CANVAS), true);
  assert.deepEqual(r.log, ["down", "move", "up"]);
});

test("a miss is still the bench's, not the room's", () => {
  // Pressing bare counter during a step is a miss, not a request to orbit the
  // room out from under the work.
  const r = stub("staging", false);
  const d = createGestureDispatch(() => [r]);
  assert.equal(d.down(E, CANVAS), r);
  assert.equal(d.end("up", E, CANVAS), true, "and the up still lands, so the hand is released");
});

/* ---------- the latch ------------------------------------------------------ */

test("the gesture goes to whoever took it, even after that step has ended", () => {
  /* THE BUG THIS EXISTS FOR. In Play a step ends by itself, on the up-stroke
     of the action that completed it. Re-asking "who is active?" at that
     moment finds the NEXT step, or nothing — and when it finds nothing the
     hand is never released and the camera holds every framing for the rest of
     the draw, waiting for a finger that is already off the glass. */
  const band = stub("tourniquet");
  let live = [band];
  const d = createGestureDispatch(() => live);

  d.down(E, CANVAS);
  live = [];                        // the step completed and tore itself down
  assert.equal(d.move(E, CANVAS), true);
  assert.equal(d.end("up", E, CANVAS), true);
  assert.deepEqual(band.log, ["down", "move", "up"], "the up went to the runtime that took the down");
});

test("…and the next step does not inherit half a gesture", () => {
  const band = stub("tourniquet");
  const swab = stub("cleaning");
  let live = [band];
  const d = createGestureDispatch(() => live);

  d.down(E, CANVAS);
  live = [swab];                    // the next step opened mid-gesture
  d.move(E, CANVAS);
  d.end("up", E, CANVAS);
  assert.deepEqual(swab.log, [], "a runtime that never saw the down must never see the up");
});

test("the latch is released even when the runtime throws on the way out", () => {
  const errs = [];
  const r = stub("insert");
  r.up = () => { throw new Error("boom"); };
  const d = createGestureDispatch(() => [r], { onError: (id, phase) => errs.push(`${id}:${phase}`) });
  d.down(E, CANVAS);
  d.end("up", E, CANVAS);
  assert.deepEqual(errs, ["insert:up"]);
  assert.equal(d.owner, null, "a stuck owner would swallow every later gesture");
});

test("a runtime that throws on the down does not get the gesture", () => {
  const errs = [];
  const bad = stub("assembly");
  bad.down = () => { throw new Error("boom"); };
  const good = stub("collection");
  const d = createGestureDispatch(() => [bad, good], { onError: (id, phase) => errs.push(`${id}:${phase}`) });
  assert.equal(d.down(E, CANVAS, { reach: true }), good);
  assert.deepEqual(errs, ["assembly:down"]);
});

test("cancel ends the gesture the same way up does", () => {
  // pointercancel is what a phone sends when a call arrives mid-stroke.
  const r = stub("palpation");
  const d = createGestureDispatch(() => [r]);
  d.down(E, CANVAS);
  assert.equal(d.end("cancel", E, CANVAS), true);
  assert.deepEqual(r.log, ["down", "cancel"]);
  assert.equal(d.owner, null);
});

test("a move or an up with no gesture in progress is nobody's", () => {
  const r = stub("fill");
  const d = createGestureDispatch(() => [r]);
  assert.equal(d.move(E, CANVAS), false);
  assert.equal(d.end("up", E, CANVAS), false);
  assert.deepEqual(r.log, []);
});

test("a second finger is swallowed, not delivered", () => {
  // A palm resting on the screen during a one-handed gesture is not a second
  // intention, and must not reach the runtime as one.
  const r = stub("cleaning");
  const d = createGestureDispatch(() => [r]);
  d.down({ pointerId: 1 }, CANVAS);
  assert.equal(d.move({ pointerId: 2 }, CANVAS), true, "still the bench's event");
  assert.equal(d.end("up", { pointerId: 2 }, CANVAS), true);
  assert.deepEqual(r.log, ["down"], "…but the runtime never sees the other finger");
  assert.equal(d.owner, r, "and the real gesture is still live");
  d.end("up", { pointerId: 1 }, CANVAS);
  assert.deepEqual(r.log, ["down", "up"]);
});

test("forgetting drops the latch silently, for a scene torn down under a hand", () => {
  const r = stub("withdrawal");
  const d = createGestureDispatch(() => [r]);
  d.down(E, CANVAS);
  d.forget();
  assert.equal(d.owner, null);
  assert.equal(d.end("up", E, CANVAS), false);
  assert.deepEqual(r.log, ["down"], "there was no runtime left to tell");
});

/* ---------- reaching: the inversion ---------------------------------------- */

test("without reach, only the first live runtime is ever asked", () => {
  // Learn's behaviour, permanently: one step at a time, offered nothing it
  // did not ask for.
  const band = stub("tourniquet", false);
  const tube = stub("collection");
  const d = createGestureDispatch(() => [band, tube]);
  const took = d.down(E, CANVAS);
  assert.deepEqual(tube.log, [], "the second runtime was not offered the pointer");
  assert.equal(took, band, "and the miss stays with the step that is running");
});

test("with reach, the pointer goes to whichever runtime claims it", () => {
  /* The inversion, in one assertion: the band's step is running and did not
     want this pointer, the learner reached for a tube, and the tube answers.
     No step machine was consulted. */
  const band = stub("tourniquet", false);
  const tube = stub("collection");
  const d = createGestureDispatch(() => [band, tube]);
  assert.equal(d.down(E, CANVAS, { reach: true }), tube);
  assert.deepEqual(band.log, ["down"], "it was asked first, in table order");
  assert.deepEqual(tube.log, ["down"]);
});

test("the first to claim wins, and nobody after it is asked", () => {
  const a = stub("a"), b = stub("b"), c = stub("c");
  const d = createGestureDispatch(() => [a, b, c]);
  assert.equal(d.down(E, CANVAS, { reach: true }), a);
  assert.deepEqual(b.log, []);
  assert.deepEqual(c.log, []);
});

test("a reached gesture stays with the runtime that reached for it", () => {
  const band = stub("tourniquet", false);
  const tube = stub("collection");
  const d = createGestureDispatch(() => [band, tube]);
  d.down(E, CANVAS, { reach: true });
  d.move(E, CANVAS);
  d.end("up", E, CANVAS);
  assert.deepEqual(tube.log, ["down", "move", "up"]);
  assert.deepEqual(band.log, ["down"], "the running step sees the offer and nothing else");
});

test("when nobody claims a reached pointer, the running step still gets its up", () => {
  const band = stub("tourniquet", false);
  const tube = stub("collection", false);
  const d = createGestureDispatch(() => [band, tube]);
  assert.equal(d.down(E, CANVAS, { reach: true }), band);
  d.end("up", E, CANVAS);
  assert.deepEqual(band.log, ["down", "up"]);
  assert.deepEqual(tube.log, ["down"]);
});

test("who is live is re-read on every down, never cached", () => {
  // The step machine changes what is live between gestures, and a dispatcher
  // holding a list from three steps ago would route to a disposed runtime.
  const first = stub("staging");
  const second = stub("tourniquet");
  let live = [first];
  const d = createGestureDispatch(() => live);
  d.down(E, CANVAS);
  d.end("up", E, CANVAS);
  live = [second];
  d.down(E, CANVAS);
  d.end("up", E, CANVAS);
  assert.deepEqual(first.log, ["down", "up"]);
  assert.deepEqual(second.log, ["down", "up"]);
});
