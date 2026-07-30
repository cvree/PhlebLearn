/* =========================================================================
   TUBE INVERSION — unit tests for the pure layers.

   Everything here is the same code the gesture and the accessible controls
   both call, so a threshold asserted here is the threshold the learner meets
   in either. No DOM, no THREE.
   ========================================================================= */
import test from "node:test";
import assert from "node:assert/strict";

import {
  INVERSIONS, inversionsFor, requiresMixing, mustNotMix, tubeName,
  OVER_AT, UPRIGHT_AT, SHAKE_DEG_PER_S, SLUGGISH_DEG_PER_S,
  MIX_WITHIN_S, CLOTTED_AFTER_S, clottingFrom,
  haemolysisFrom, haemolysisGrade, HAEMOLYSIS_REJECT,
  specimenVerdict, evaluateInversion, nextAction,
} from "../src/venipuncture/inversion/inversionRules.js";

import {
  createInversionState, current, pickUp, rack, turnTo,
  invertOnce, invertTimes, rockTimes, shakeTimes, inversionsOwed,
} from "../src/venipuncture/inversion/inversionState.js";

import {
  measureInversion, applyInversionOutcome,
} from "../src/venipuncture/inversion/inversionScoring.js";

const T0 = 100000;

function stateWith(o){
  const opt = o || {};
  const order = opt.order || ["lightblue", "lavender"];
  const collected = {};
  for(const key of order){
    collected[key] = Object.assign({
      drawnMl: 4, volumeMl: 4, removedAt: T0, carryoverFrom: null,
    }, (opt.collected && opt.collected[key]) || {});
  }
  return createInversionState({ order, collected, now: T0 });
}

/** Mixes one tube to its requirement, properly, and racks it. */
function mixProperly(s, key, now){
  pickUp(s, key, now == null ? T0 : now);
  if(requiresMixing(key)) invertTimes(s, inversionsFor(key).ideal, { now: now == null ? T0 : now });
  rack(s, now == null ? T0 : now);
  return s;
}

/* =========================================================================
   WHICH TUBE — the count is a property of the additive, not a global six
   ========================================================================= */

test("each additive has its own inversion count, and they differ", () => {
  assert.equal(inversionsFor("lavender").ideal, 8);
  assert.equal(inversionsFor("lightblue").ideal, 4);
  assert.equal(inversionsFor("sst").ideal, 5);
  assert.notEqual(inversionsFor("lavender").ideal, inversionsFor("lightblue").ideal);
});

test("a plain serum tube must NOT be mixed at all", () => {
  assert.equal(mustNotMix("red"), true);
  assert.equal(requiresMixing("red"), false);
  assert.equal(inversionsFor("red").min, 0);
  // and every additive tube does need it
  for(const key of ["lavender","lightblue","green","gray","pst","sst","bloodculture"]){
    assert.equal(requiresMixing(key), true, key);
  }
});

test("inverting a plain tube is a blocking error, not merely unnecessary", () => {
  const s = stateWith({ order: ["red"] });
  pickUp(s, "red", T0);
  invertOnce(s, { now: T0 });
  const r = evaluateInversion(s);
  assert.equal(r.blocking.find(i => i.code === "mixedPlainTube").severity, "block");
  assert.equal(specimenVerdict(s.tubes.red).usable, false);
  assert.equal(specimenVerdict(s.tubes.red).reason, "mixedWhenItShouldNot");
});

test("a plain tube left alone and racked is a perfectly good specimen", () => {
  const s = stateWith({ order: ["red"] });
  pickUp(s, "red", T0);
  rack(s, T0);
  assert.equal(specimenVerdict(s.tubes.red).usable, true);
  assert.equal(evaluateInversion(s).ready, true);
});

/* =========================================================================
   THE ANGLE — an inversion is over AND back; rocking is neither
   ========================================================================= */

test("one inversion requires going past the over gate and back under upright", () => {
  const s = stateWith();
  pickUp(s, "lavender", T0);
  const t = current(s);
  turnTo(s, OVER_AT - 5, 0.5);      // nearly over
  assert.equal(t.inversions, 0);
  turnTo(s, OVER_AT + 5, 0.2);      // over
  assert.equal(t.inversions, 0, "over is only half of it");
  turnTo(s, UPRIGHT_AT + 5, 0.5);   // not back yet
  assert.equal(t.inversions, 0);
  turnTo(s, UPRIGHT_AT - 5, 0.2);   // back
  assert.equal(t.inversions, 1);
});

test("rocking it back and forth counts no inversions, however many times", () => {
  const s = stateWith();
  pickUp(s, "lavender", T0);
  rockTimes(s, 10, { now: T0 });
  const t = current(s);
  assert.equal(t.inversions, 0);
  assert.ok(t.rockCount >= 3, `rocks=${t.rockCount}`);
  assert.ok(t.travelDeg > 500, "it definitely moved a lot");
  const r = evaluateInversion(s);
  assert.ok(r.issues.find(i => i.code === "rocking"));
});

test("a proper inversion sequence counts exactly once per round trip", () => {
  const s = stateWith();
  pickUp(s, "lavender", T0);
  invertTimes(s, 8, { now: T0 });
  assert.equal(current(s).inversions, 8);
});

test("inversions owed shrinks to zero as the tube is actually mixed", () => {
  const s = stateWith();
  assert.equal(inversionsOwed(s, "lavender"), 8);
  pickUp(s, "lavender", T0);
  invertTimes(s, 3, { now: T0 });
  assert.equal(inversionsOwed(s, "lavender"), 5);
  invertTimes(s, 5, { now: T0 });
  assert.equal(inversionsOwed(s, "lavender"), 0);
  // a plain tube never owes any
  const p = stateWith({ order: ["red"] });
  assert.equal(inversionsOwed(p, "red"), 0);
});

/* =========================================================================
   THE SPEED — gentle mixes, shaking haemolyses, and it cannot be undone
   ========================================================================= */

test("haemolysis only accrues above the shake threshold", () => {
  assert.equal(haemolysisFrom(SHAKE_DEG_PER_S - 100, 1), 0);
  assert.equal(haemolysisFrom(SHAKE_DEG_PER_S, 1), 0);
  assert.ok(haemolysisFrom(SHAKE_DEG_PER_S*2, 1) > 0);
});

test("shaking a tube haemolyses it and rejects the specimen", () => {
  const s = stateWith();
  pickUp(s, "lavender", T0);
  shakeTimes(s, 8, { now: T0 });
  const t = current(s);
  assert.ok(t.peakDegPerS > SHAKE_DEG_PER_S);
  assert.ok(t.haemolysis >= HAEMOLYSIS_REJECT, `haemolysis=${t.haemolysis}`);
  assert.equal(haemolysisGrade(t.haemolysis), "rejected");
  assert.equal(specimenVerdict(t).usable, false);
  assert.equal(specimenVerdict(t).reason, "haemolysed");
  assert.equal(evaluateInversion(s).blocking.find(i => i.code === "haemolysed").severity, "block");
});

test("mixing it nicely afterwards does not give a shaken specimen back", () => {
  const s = stateWith();
  pickUp(s, "lavender", T0);
  shakeTimes(s, 8, { now: T0 });
  const level = current(s).haemolysis;
  invertTimes(s, 8, { now: T0 });
  assert.ok(current(s).haemolysis >= level, "haemolysis is cumulative, never reduced");
  assert.equal(specimenVerdict(current(s)).reason, "haemolysed");
});

test("gentle inversions never haemolyse", () => {
  const s = stateWith();
  pickUp(s, "lavender", T0);
  invertTimes(s, 10, { degPerS: 180, now: T0 });
  assert.equal(current(s).haemolysis, 0);
  assert.equal(haemolysisGrade(current(s).haemolysis), "none");
});

test("a very slow mix counts but is noted", () => {
  const s = stateWith();
  pickUp(s, "lavender", T0);
  invertTimes(s, 8, { degPerS: SLUGGISH_DEG_PER_S - 10, now: T0 });
  assert.equal(current(s).inversions, 8);
  assert.equal(current(s).sluggish, true);
  rack(s, T0);
  assert.ok(evaluateInversion(s).issues.find(i => i.code === "tooSlow"));
});

/* =========================================================================
   THE DELAY — additive only works if the blood gets to it in time
   ========================================================================= */

test("clotting depends on how long the tube sat, and plain tubes never clot from it", () => {
  assert.equal(clottingFrom(10, "lavender"), "none");
  assert.equal(clottingFrom(MIX_WITHIN_S + 10, "lavender"), "microclots");
  assert.equal(clottingFrom(CLOTTED_AFTER_S + 10, "lavender"), "clotted");
  assert.equal(clottingFrom(CLOTTED_AFTER_S + 10, "red"), "none");
});

test("the delay is measured from when the tube came off the holder", () => {
  const s = stateWith();
  pickUp(s, "lavender", T0 + 5000);
  invertOnce(s, { now: T0 + (MIX_WITHIN_S + 20)*1000 });
  const t = current(s);
  assert.ok(t.delaySeconds > MIX_WITHIN_S);
  assert.equal(t.clotting, "microclots");
  assert.ok(evaluateInversion(s).issues.find(i => i.code === "mixedLate"));
});

test("a tube left far too long clots and blocks, and more mixing cannot fix it", () => {
  const s = stateWith();
  pickUp(s, "lavender", T0);
  invertTimes(s, 8, { now: T0 + (CLOTTED_AFTER_S + 30)*1000 });
  const t = current(s);
  assert.equal(t.clotting, "clotted");
  assert.equal(t.inversions, 8, "it was mixed properly — and it is still no good");
  assert.equal(specimenVerdict(t).usable, false);
  assert.equal(specimenVerdict(t).reason, "clotted");
  assert.equal(evaluateInversion(s).blocking.find(i => i.code === "clotted").severity, "block");
});

test("a clotted tube does not hold the step open, because nothing can fix it", () => {
  const s = stateWith({ order: ["lavender"] });
  pickUp(s, "lavender", T0);
  invertTimes(s, 8, { now: T0 + (CLOTTED_AFTER_S + 30)*1000 });
  rack(s, T0);
  const r = evaluateInversion(s);
  assert.equal(r.allHandled, true);
  assert.equal(r.ready, false, "handled, but the specimen is still reported as bad");
});

/* =========================================================================
   PICKING UP AND RACKING
   ========================================================================= */

test("only one tube is in the hand at a time", () => {
  const s = stateWith();
  pickUp(s, "lavender", T0);
  pickUp(s, "lightblue", T0);
  assert.equal(s.heldKey, "lavender");
  rack(s, T0);
  assert.equal(s.heldKey, null);
  pickUp(s, "lightblue", T0);
  assert.equal(s.heldKey, "lightblue");
});

test("racking a tube keeps its count and stands it upright", () => {
  const s = stateWith();
  pickUp(s, "lavender", T0);
  invertTimes(s, 8, { now: T0 });
  rack(s, T0);
  assert.equal(s.tubes.lavender.inversions, 8);
  assert.equal(s.tubes.lavender.tilt, 0);
  assert.ok(s.tubes.lavender.rackedAt != null);
});

test("the step is finished only when every tube is mixed to its own count and racked", () => {
  const s = stateWith();
  assert.equal(evaluateInversion(s).ready, false);
  mixProperly(s, "lightblue");
  assert.equal(evaluateInversion(s).ready, false, "lavender still outstanding");
  mixProperly(s, "lavender");
  const r = evaluateInversion(s);
  assert.equal(r.allHandled, true);
  assert.equal(r.ready, true);
  assert.equal(r.pending.length, 0);
});

test("nextAction speaks to where the learner actually is", () => {
  const s = stateWith();
  let r = evaluateInversion(s);
  assert.match(nextAction(s, r), /Pick up/i);
  pickUp(s, "lavender", T0);
  r = evaluateInversion(s);
  assert.match(nextAction(s, r), /over and back/i);
  invertTimes(s, 8, { now: T0 });
  r = evaluateInversion(s);
  assert.match(nextAction(s, r), /rack/i);
  // a plain tube says something different
  const p = stateWith({ order: ["red"] });
  pickUp(p, "red", T0);
  assert.match(nextAction(p, evaluateInversion(p)), /does not get inverted/i);
});

/* =========================================================================
   WHAT COLLECTION LEFT BEHIND
   ========================================================================= */

test("a short or contaminated tube arrives here still short and still contaminated", () => {
  const s = stateWith({ collected: { lightblue: { drawnMl: 1.2, volumeMl: 2.7, carryoverFrom: "lavender" } } });
  assert.equal(s.tubes.lightblue.drawnMl, 1.2);
  assert.equal(s.tubes.lightblue.carryoverFrom, "lavender");
  mixProperly(s, "lightblue");
  mixProperly(s, "lavender");
  const m = measureInversion(s, evaluateInversion(s));
  const lb = m.tubes.find(t => t.key === "lightblue");
  assert.equal(lb.carryoverFrom, "lavender");
  assert.equal(lb.drawnMl, 1.2);
  // mixing does not pretend to fix a collection problem
  assert.equal(lb.usable, true, "this step judges MIXING; collection judged the draw");
});

/* =========================================================================
   SCORING
   ========================================================================= */

test("mixing every tube correctly scores at the top with nothing named", () => {
  const s = stateWith();
  mixProperly(s, "lightblue");
  mixProperly(s, "lavender");
  const m = measureInversion(s, evaluateInversion(s));
  assert.deepEqual(m.mistakes.map(x => x.code), []);
  assert.equal(m.score, 100);
  assert.equal(m.criticalEvents.length, 0);
  assert.equal(m.tubesUsable, 2);
  assert.equal(m.underMixedCount, 0);
});

test("under-mixing is critical; rocking and lateness are warnings", () => {
  const under = stateWith();
  pickUp(under, "lavender", T0);
  invertTimes(under, 3, { now: T0 });     // 3 of 8
  rack(under, T0);
  mixProperly(under, "lightblue");
  const mUnder = measureInversion(under, evaluateInversion(under));
  assert.equal(mUnder.underMixedCount, 1);
  assert.ok(mUnder.criticalEvents.indexOf("underMixed") >= 0);
  assert.ok(mUnder.score < 85, `got ${mUnder.score}`);

  const rocked = stateWith();
  pickUp(rocked, "lavender", T0);
  rockTimes(rocked, 8, { now: T0 });
  rack(rocked, T0);
  mixProperly(rocked, "lightblue");
  const mRocked = measureInversion(rocked, evaluateInversion(rocked));
  assert.ok(mRocked.rockedCount >= 1);
  assert.ok(mRocked.mistakes.some(x => x.code === "rocked"));
});

test("shaking every tube lands near the floor and names each specimen", () => {
  const s = stateWith();
  pickUp(s, "lightblue", T0);
  // 6 rather than the citrate tube's own 4: shaking exactly 4 times lands
  // within a rounding error of the rejection threshold, and a test balanced on
  // that boundary would flap without telling anyone anything useful
  shakeTimes(s, 6, { now: T0 });
  rack(s, T0);
  pickUp(s, "lavender", T0);
  shakeTimes(s, 8, { now: T0 });
  rack(s, T0);
  const m = measureInversion(s, evaluateInversion(s));
  assert.equal(m.haemolysedCount, 2);
  assert.equal(m.tubesUsable, 0);
  assert.ok(m.score < 45, `got ${m.score}`);
  assert.ok(m.peakDegPerS > m.shakeThresholdDegPerS);
});

test("the outcome flag means every tube was actually mixed properly", () => {
  const good = stateWith();
  mixProperly(good, "lightblue");
  mixProperly(good, "lavender");
  const c1 = {};
  applyInversionOutcome(c1, measureInversion(good, evaluateInversion(good)));
  assert.equal(c1.mixOk, true);
  assert.deepEqual(c1.invCounts, { lightblue: 4, lavender: 8 });

  const shaken = stateWith();
  pickUp(shaken, "lavender", T0);
  shakeTimes(shaken, 8, { now: T0 });
  rack(shaken, T0);
  mixProperly(shaken, "lightblue");
  const c2 = {};
  applyInversionOutcome(c2, measureInversion(shaken, evaluateInversion(shaken)));
  assert.equal(c2.mixOk, false, "counted to eight, but haemolysed");
});

/* =========================================================================
   SERIALIZATION AND RESET
   ========================================================================= */

test("the state serializes and a round trip judges identically", () => {
  const s = stateWith();
  mixProperly(s, "lightblue");
  pickUp(s, "lavender", T0);
  invertTimes(s, 5, { now: T0 });
  const back = JSON.parse(JSON.stringify(s));
  const a = evaluateInversion(s);
  const b = evaluateInversion(back);
  assert.deepEqual(b.issues.map(i => i.code), a.issues.map(i => i.code));
  assert.equal(measureInversion(back, b).score, measureInversion(s, a).score);
});

test("a fresh state is a fresh attempt", () => {
  const a = stateWith();
  mixProperly(a, "lavender");
  const b = stateWith();
  assert.equal(b.heldKey, null);
  assert.equal(b.tubes.lavender.inversions, 0);
  assert.equal(b.tubes.lavender.haemolysis, 0);
  assert.equal(b.events.length, 0);
});

/* =========================================================================
   A SINGLE-TUBE DRAW — the butterfly case
   ========================================================================= */

test("a one-tube draw is mixed and finished on its own terms", () => {
  const s = stateWith({ order: ["lavender"] });
  assert.equal(evaluateInversion(s).pending.length, 1);
  mixProperly(s, "lavender");
  const r = evaluateInversion(s);
  assert.equal(r.ready, true);
  const m = measureInversion(s, r);
  assert.equal(m.tubesRequired, 1);
  assert.equal(m.tubesUsable, 1);
  assert.equal(m.score, 100);
});
