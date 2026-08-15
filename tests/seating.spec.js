/* =========================================================================
   THE SEATING GESTURE — the one motion every "this goes into that"
   interaction in the game is made of.

   Pick it up. Bring it to where it goes. Push it home along its own axis.

   These tests are about FEEL, which is usually the thing nobody can assert.
   They can be asserted here because the resistance is authored rather than
   simulated — bench/motion.js's rule is that there is no dynamic rigid-body
   simulation anywhere in this game and there must never be one — so the whole
   character of the gesture is a curve over pure numbers.
   ========================================================================= */
import test from "node:test";
import assert from "node:assert/strict";

import {
  axialTravel, seatingResistance, seatingDelta, threadSpec,
  crossed, tickedPast, axisFromYaw, approachMisalignDeg,
  TURN_TRAVEL_M, DEAD_ZONE_M, MAX_FRAME_TRAVEL_M,
} from "../src/bench/seating.js";

import {
  SECURE_TURNS, SNUG_TURNS, OVERTIGHT_TURNS,
} from "../src/venipuncture/assembly/assemblyRules.js";

const THREAD = threadSpec({
  secure: SECURE_TURNS, snug: SNUG_TURNS, overtight: OVERTIGHT_TURNS,
});
const AXIS = { x: 1, z: 0 };

/** Drags `metres` along the axis in `steps` frames and returns the total. */
function push(metres, from, steps = 24){
  let at = from, last = { x: 0, z: 0 };
  for(let i = 1; i <= steps; i++){
    const p = { x: metres*i/steps, z: 0 };
    at += seatingDelta(axialTravel(last, p, AXIS), at, THREAD);
    last = p;
  }
  return at;
}

/* ---------- the axis ---------------------------------------------------- */

test("only motion ALONG the axis counts; the wobble across it is discarded", () => {
  // A hand pushing a needle onto a hub does not travel in a straight line.
  // Treating that as error would make the gesture feel like it fought back.
  assert.equal(axialTravel({x:0,z:0}, {x:0.01,z:0}, AXIS), 0.01);
  assert.equal(axialTravel({x:0,z:0}, {x:0.01,z:0.05}, AXIS), 0.01);
  assert.equal(axialTravel({x:0,z:0}, {x:0,z:0.05}, AXIS), 0);
});

test("pushing the other way is negative travel, which is how you back out", () => {
  assert.equal(axialTravel({x:0.02,z:0}, {x:0,z:0}, AXIS), -0.02);
});

test("an axis can point any way on the bench, and the maths does not care", () => {
  const a = axisFromYaw(Math.PI/2);           // straight along -Z
  assert.ok(Math.abs(a.x) < 1e-9);
  assert.ok(Math.abs(a.z + 1) < 1e-9);
  assert.ok(Math.abs(axialTravel({x:0,z:0}, {x:0,z:-0.01}, a) - 0.01) < 1e-9);
});

/* ---------- the feel ---------------------------------------------------- */

test("it spins on freely until it is nearly secure", () => {
  assert.equal(seatingResistance(0, THREAD), 1);
  assert.equal(seatingResistance(SECURE_TURNS - 0.01, THREAD), 1);
});

test("resistance builds continuously — no step the hand would feel as a glitch", () => {
  let last = 1;
  for(let t = 0; t <= OVERTIGHT_TURNS + 1; t += 0.05){
    const r = seatingResistance(t, THREAD);
    assert.ok(r <= last + 1e-9, `resistance rose again at ${t.toFixed(2)} turns`);
    assert.ok(r > 0, "a gesture that stops responding reads as a bug, not as resistance");
    last = r;
  }
});

test("finger-tight is a wall: past it, the same push barely moves", () => {
  const easy = seatingResistance(0, THREAD);
  const wall = seatingResistance(SNUG_TURNS + 0.01, THREAD);
  assert.ok(easy/wall > 5,
    `finger-tight should take several times the travel, got ${(easy/wall).toFixed(1)}×`);
});

test("but the wall can be forced past, because over-torquing has to be possible", () => {
  // Reaching finger-tight is the ordinary gesture...
  const normal = push(SNUG_TURNS*TURN_TRAVEL_M*1.3, 0);
  assert.ok(normal >= SNUG_TURNS, `a normal push should reach finger-tight, got ${normal.toFixed(2)}`);
  assert.ok(normal < OVERTIGHT_TURNS, "and should not sail past it by accident");

  // ...and a learner leaning on it can still crack the hub, which is a real
  // error the rules already grade. A stop that cannot be passed would delete it.
  const forced = push(0.30, 0);
  assert.ok(forced > OVERTIGHT_TURNS,
    `it must be possible to over-torque deliberately, reached ${forced.toFixed(2)}`);
});

test("backing out is free — undoing a mistake is never harder than making it", () => {
  // The recovery from a cross-thread is unscrewing it right off. If backing
  // out were damped like screwing in, a recoverable error would be a dead end.
  const inAt = 3.0;
  const back = seatingDelta(-TURN_TRAVEL_M, inAt, THREAD);
  assert.ok(Math.abs(back + 1) < 1e-9, "one turn of travel backwards is one turn out");
});

test("a tremor is not a push", () => {
  assert.equal(seatingDelta(DEAD_ZONE_M*0.5, 0, THREAD), 0);
  assert.notEqual(seatingDelta(DEAD_ZONE_M*3, 0, THREAD), 0);
});

test("the whole gesture is one comfortable thumb-drag on a phone", () => {
  // 2.5 turns to finger-tight. If this needs much more than 4 cm of travel it
  // stops being one motion on a small screen and becomes several.
  const travel = SNUG_TURNS*TURN_TRAVEL_M;
  assert.ok(travel > 0.015 && travel < 0.045,
    `finger-tight takes ${(travel*1000).toFixed(0)}mm of drag`);
});

/* ---------- the moments that get a sound ---------------------------------- */

test("a threshold fires exactly once, on the frame it is crossed", () => {
  assert.equal(crossed(1.9, 2.1, 2), true);
  assert.equal(crossed(2.1, 2.4, 2), false, "it must not fire again every frame after");
  assert.equal(crossed(2.4, 1.9, 2), false, "and not on the way back down");
});

test("a click every half turn — the thread you can hear is the thread you can feel", () => {
  assert.equal(tickedPast(0.4, 0.6, 0.5), true);
  assert.equal(tickedPast(0.6, 0.9, 0.5), false);
  assert.equal(tickedPast(0.9, 1.1, 0.5), true);
});

/* ---------- the angle stays the learner's -------------------------------- */

test("misalignment is measured, not smoothed — the angle is what is graded", () => {
  assert.equal(approachMisalignDeg(0, 0), 0);
  assert.ok(Math.abs(approachMisalignDeg(Math.PI/18, 0) - 10) < 1e-6);
  // and it is a magnitude: off by ten degrees either way is off by ten degrees
  assert.ok(Math.abs(approachMisalignDeg(-Math.PI/18, 0) - 10) < 1e-6);
});

test("misalignment never exceeds 180°, however the angles wrap", () => {
  for(let d = -720; d <= 720; d += 7){
    const v = approachMisalignDeg(d*Math.PI/180, 0);
    assert.ok(v >= 0 && v <= 180, `${d}° produced ${v}`);
  }
});

/* ---------- the property the whole rebuild rests on ----------------------- */

test("the gesture produces the same turns the old model took — only the input changed", () => {
  // The point of this module is that assemblyRules.js's thresholds, the bevel
  // derivation and the cross-thread bind are all untouched: turn() still takes
  // turns. A straight push of the right length lands in the right band.
  const bands = [
    [1.0*TURN_TRAVEL_M, "attached but not secure"],
    [2.2*TURN_TRAVEL_M, "secure"],
  ];
  for(const [travel, label] of bands){
    const at = push(travel, 0);
    assert.ok(Math.abs(at - travel/TURN_TRAVEL_M) < 0.01,
      `${label}: below finger-tight the mapping is exactly one turn per ${(TURN_TRAVEL_M*1000).toFixed(1)}mm`);
  }
});

test("a pointer that teleports cannot over-torque the needle in one frame", () => {
  // A touch lifted and re-landed, a pointer capture re-acquired, or a camera
  // finishing its ease under a finger that is already down all deliver one
  // enormous delta. Being graded for damage you did not do is worse than the
  // gesture being slightly damped.
  const jump = seatingDelta(0.40, 0, THREAD);
  assert.ok(jump < 1.5, `a 40cm jump added ${jump.toFixed(2)} turns at once`);
  // …and no real drag, however fast, is throttled by it
  const fast = seatingDelta(MAX_FRAME_TRAVEL_M*0.9, 0, THREAD);
  assert.ok(Math.abs(fast - MAX_FRAME_TRAVEL_M*0.9/TURN_TRAVEL_M) < 1e-9,
    "a fast but real drag must pass through untouched");
});
