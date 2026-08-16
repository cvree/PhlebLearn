/* =========================================================================
   THE CAMERA: WHAT IT FOLLOWS, AND WHEN IT IS ALLOWED TO MOVE.

   The second rule is the one that matters, and it is correctness rather than
   polish. `armScene.js` re-solves the skin point under the pointer against the
   LIVE camera every frame, so a camera that eases while a finger is pressed
   drags that finger across the arm: the hand does not move, the world moves
   under it, and the learner's stroke is recorded somewhere they never touched.

   `cleaningRuntime.js` found this the hard way and defended against it locally.
   It is not a cleaning problem — it is a property of the pointer solve — so it
   is enforced once here, for every gesture, and asserted here rather than
   rediscovered by whoever writes the eleventh runtime.
   ========================================================================= */
import test from "node:test";
import assert from "node:assert/strict";

import { createHandCamera, FRAMING_FOR_HELD } from "../src/bench/handFraming.js";
import { FRAMINGS } from "../src/venipuncture/arm/benchFramings.js";

/** A view that records what it was asked to frame, and nothing else. */
function spyView(){
  const asked = [];
  return { asked, frameBeat(f){ asked.push(f); } };
}

/* ---------- the camera follows the hand ---------------------------------- */

test("every tool the hand can hold names a framing that exists, or declares it has none", () => {
  for(const [tool, name] of Object.entries(FRAMING_FOR_HELD)){
    if(name === null) continue;   // site-specific; the runtime supplies it
    assert.ok(FRAMINGS[name], `${tool} asks for a framing "${name}" that is not declared`);
  }
});

test("a tool whose framing is site-specific leaves the camera to its runtime", () => {
  // The prep field is 5 cm across and sits wherever the learner marked the
  // vein, so the swab's framing is solved from the site. Omitting it from the
  // table instead of recording it as null would fall back to the WIDE view —
  // pulling the camera out at the exact moment it should push in.
  assert.ok("swab" in FRAMING_FOR_HELD);
  assert.equal(FRAMING_FOR_HELD.swab, null);

  const v = spyView();
  const cam = createHandCamera(v);
  cam.hold("swab");
  assert.deepEqual(v.asked, [], "the table must not guess at a framing it cannot know");
  assert.equal(cam.held, "swab", "…but it still knows what is in the hand");
});

test("an empty hand is the wide working view", () => {
  // What you look at while deciding what to do next is the whole limb, the
  // hand, and the patient — which is `access`.
  assert.equal(FRAMING_FOR_HELD.none, "access");
});

test("picking something up moves the camera to what that thing is for", () => {
  const v = spyView();
  const cam = createHandCamera(v);
  cam.hold("tube");
  assert.deepEqual(v.asked, ["collect"]);
  cam.hold("gauze");
  assert.deepEqual(v.asked, ["collect", "close"]);
});

test("putting it down lets the frame breathe again", () => {
  const v = spyView();
  const cam = createHandCamera(v);
  cam.hold("tip");
  cam.hold(null);
  assert.deepEqual(v.asked, ["stick", "access"]);
  assert.equal(cam.held, "none");
});

test("holding the same thing again asks for nothing", () => {
  // Runtimes call this every frame without thinking about it, so a repeat has
  // to be free — otherwise the camera re-fits sixty times a second.
  const v = spyView();
  const cam = createHandCamera(v);
  for(let i = 0; i < 30; i++) cam.hold("band");
  assert.equal(v.asked.length, 1);
});

test("an unknown tool falls back to the working view rather than nothing", () => {
  const v = spyView();
  const cam = createHandCamera(v);
  cam.hold("something-nobody-declared");
  assert.deepEqual(v.asked, ["access"]);
});

/* ---------- the camera never moves under a hand -------------------------- */

test("a framing asked for while the hand is down does not move the camera", () => {
  const v = spyView();
  const cam = createHandCamera(v);
  cam.down();
  cam.hold("tube");
  assert.deepEqual(v.asked, [], "the camera moved while a finger was on the arm");
  assert.equal(cam.deferring, true);
});

test("…and lands the moment the hand comes up", () => {
  const v = spyView();
  const cam = createHandCamera(v);
  cam.down();
  cam.hold("tube");
  cam.up();
  assert.deepEqual(v.asked, ["collect"]);
  assert.equal(cam.deferring, false);
});

test("only the LAST thing asked for during a gesture is applied", () => {
  // Picking a tool up and putting it down again mid-gesture must not queue two
  // camera moves to play out back to back the instant the hand lifts.
  const v = spyView();
  const cam = createHandCamera(v);
  cam.down();
  cam.hold("tube");
  cam.hold("gauze");
  cam.hold("tip");
  cam.up();
  assert.deepEqual(v.asked, ["stick"]);
});

test("a gesture that changes nothing leaves the camera alone", () => {
  const v = spyView();
  const cam = createHandCamera(v);
  cam.down();
  cam.up();
  assert.deepEqual(v.asked, []);
});

test("a cancelled gesture releases the camera as an ended one does", () => {
  // pointercancel is what a phone sends when a call arrives mid-stroke. If it
  // did not release, the camera would stay frozen for the rest of the draw.
  const v = spyView();
  const cam = createHandCamera(v);
  cam.down();
  cam.hold("tube");
  cam.up();                       // main.js calls this on cancel too
  assert.deepEqual(v.asked, ["collect"]);
  assert.equal(cam.handDown, false);
});

test("a computed framing is held by the same rule as a named one", () => {
  // The scrub's framing is site-specific and cannot be a constant, so it
  // arrives as an object. It must not be exempt from the hold — it is the
  // framing that discovered the problem in the first place.
  const v = spyView();
  const cam = createHandCamera(v);
  const computed = { look: [0, 0, 0], frame: [[0, 0, 0]] };
  cam.down();
  cam.request(computed);
  assert.deepEqual(v.asked, []);
  cam.up();
  assert.deepEqual(v.asked, [computed]);
});

test("two encounters never share a hand", () => {
  // A module-level singleton here would carry the last patient's held tool and
  // gesture flag into the next draw, which is the kind of bug that only shows
  // up on the second patient.
  const a = createHandCamera(spyView());
  const b = createHandCamera(spyView());
  a.down();
  a.hold("tube");
  assert.equal(b.handDown, false);
  assert.equal(b.held, "none");
  assert.equal(b.deferring, false);
});
