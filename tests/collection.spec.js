/* =========================================================================
   TUBE COLLECTION — unit tests for the pure layers.

   Everything here is the same code the drag path and the accessible controls
   both call, so a threshold asserted here is the threshold the learner meets
   in either. No DOM, no THREE.
   ========================================================================= */
import test from "node:test";
import assert from "node:assert/strict";

import {
  SEAT_GUIDELINE, SEAT_ENGAGE, SEAT_BOTTOM,
  GRIP, transmissionFor, needleShiftFrom, lumenToleranceM, LATERAL_MAX,
  tubeVolumeMl, requiredFraction, ratioCritical, gaugeFactor,
  drawRateMlPerS, collapsesVein, carryoverInto, expectedOrder,
  evaluateCollection, nextAction,
} from "../src/venipuncture/collection/collectionRules.js";

import {
  createCollectionState, takeTube, returnTube, discardTube, current,
  seat, backOffToGuideline, pushOn, removeTube,
  flow, fillFor, isFull, collectTubeCleanly, fillFraction,
} from "../src/venipuncture/collection/collectionState.js";

import {
  measureCollection, orderAccuracy, applyCollectionOutcome,
} from "../src/venipuncture/collection/collectionScoring.js";

/* A good median cubital, and a narrow one that a full-draw tube will collapse. */
const GOOD_VEIN = { id:"median-cubital", calibre:0.0034, depth:0.0035 };
const NARROW_VEIN = { id:"cephalic", calibre:0.0022, depth:0.0040 };

function stateWith(o){
  return createCollectionState(Object.assign({
    order:["lightblue","lavender"], vessel:GOOD_VEIN, gauge:21, vigour:1, inVein:true,
  }, o || {}));
}

/* ========================================================================
   SEATING GEOMETRY — the guideline exists so a stopper is not pierced
   before you know blood is coming.
   ===================================================================== */

test("the guideline is short of the engage depth, which is short of home", ()=>{
  assert.ok(SEAT_GUIDELINE < SEAT_ENGAGE, "guideline must be before the stopper is pierced");
  assert.ok(SEAT_ENGAGE < SEAT_BOTTOM, "engaging must happen before bottoming out");
});

test("a tube parked at the guideline is held but not pierced", ()=>{
  const s = stateWith();
  takeTube(s, "lightblue");
  seat(s, SEAT_GUIDELINE, 0, GRIP.FLANGE);
  assert.equal(current(s).pierced, false);
  assert.equal(current(s).drawnMl, 0);
});

test("pushing past the engage depth pierces the stopper", ()=>{
  const s = stateWith();
  takeTube(s, "lightblue");
  seat(s, SEAT_ENGAGE + 0.0005, 0, GRIP.FLANGE);
  assert.equal(current(s).pierced, true);
});

/* ========================================================================
   BRACING — where the hand is decides whether the needle moves.
   ===================================================================== */

test("holding the flange transmits far less than holding the tube", ()=>{
  assert.ok(transmissionFor(GRIP.FLANGE) < transmissionFor(GRIP.BODY));
});

test("small sideways offsets are absorbed by the holder, large ones are not", ()=>{
  const small = needleShiftFrom(0, 0.0005, GRIP.BODY);
  const large = needleShiftFrom(0, 0.0060, GRIP.BODY);
  assert.equal(small.lateralM, 0);
  assert.ok(large.lateralM > 0.002);
});

test("a braced seat leaves the needle where it was", ()=>{
  const s = stateWith();
  takeTube(s, "lightblue");
  pushOn(s, GRIP.FLANGE);
  assert.equal(s.needleOut, false);
  assert.ok(s.needleShiftM < lumenToleranceM(GOOD_VEIN),
    `braced shift ${s.needleShiftM} should stay inside the lumen tolerance`);
});

test("seating a tube with no countertraction drives the needle out of the lumen", ()=>{
  const s = stateWith();
  takeTube(s, "lightblue");
  pushOn(s, GRIP.BODY);
  assert.equal(s.needleOut, true);
});

test("axial displacement undoes itself when the tube comes back off", ()=>{
  const s = stateWith();
  takeTube(s, "lightblue");
  seat(s, 0.010, 0, GRIP.FLANGE);
  const pushedIn = s.needleDeeperM;
  assert.ok(pushedIn > 0);
  seat(s, -0.010, 0, GRIP.FLANGE);
  assert.ok(Math.abs(s.needleDeeperM) < 1e-9, "pulling the tube back off returns the tip");
});

test("a sideways lever does NOT undo itself", ()=>{
  const s = stateWith();
  takeTube(s, "lightblue");
  seat(s, SEAT_ENGAGE, 0, GRIP.FLANGE);          // past the guideline first
  seat(s, 0.001, 0.006, GRIP.FLANGE);
  const levered = s.needleLateralM;
  assert.ok(levered > 0);
  seat(s, 0.001, 0, GRIP.FLANGE);
  assert.equal(s.needleLateralM, levered, "taking the hand away does not un-lever the tip");
});

test("bringing a tube up to the guideline cannot disturb the needle at all", ()=>{
  const s = stateWith();
  takeTube(s, "lightblue");
  // the worst possible handling, short of the guideline: no brace, wide lever
  seat(s, SEAT_GUIDELINE, 0.020, GRIP.BODY);
  assert.equal(s.needleShiftM, 0, "the tube has not met the rubber yet");
  assert.equal(s.needleOut, false);
});

test("a wildly off-axis hand levers no harder than the barrel allows", ()=>{
  const near = needleShiftFrom(0, 0.006, GRIP.BODY);
  const far = needleShiftFrom(0, 0.200, GRIP.BODY);
  assert.equal(far.lateralM, near.lateralM,
    "past the barrel's clearance the hand is off the tube, not levering harder");
});

test("a narrower vein tolerates less displacement than a wide one", ()=>{
  assert.ok(lumenToleranceM(NARROW_VEIN) < lumenToleranceM(GOOD_VEIN));
});

/* ========================================================================
   THE STOPPER, PIERCED WITH NOTHING COMING — the reason the guideline is
   a technique and not a decoration.
   ===================================================================== */

test("piercing a stopper with the needle out of the vein kills the tube", ()=>{
  const s = stateWith();
  s.inVein = false;
  takeTube(s, "lightblue");
  pushOn(s, GRIP.FLANGE);
  assert.equal(current(s).deadOnAir, true);
  fillFor(s, 30, true);
  assert.equal(current(s).drawnMl, 0, "a spent vacuum draws nothing afterwards");
});

test("a dead tube parked at the guideline instead is still usable", ()=>{
  const s = stateWith();
  s.inVein = false;
  takeTube(s, "lightblue");
  seat(s, SEAT_GUIDELINE, 0, GRIP.FLANGE);
  assert.equal(current(s).pierced, false);
  assert.equal(current(s).deadOnAir, false);
  s.inVein = true;                       // the access is sorted out
  pushOn(s, GRIP.FLANGE);
  fillFor(s, 30, true);
  assert.ok(current(s).drawnMl > 0, "the tube kept its vacuum and still fills");
});

test("binning a dead tube gives a fresh one of the same kind", ()=>{
  const s = stateWith();
  s.inVein = false;
  takeTube(s, "lightblue");
  pushOn(s, GRIP.FLANGE);
  assert.equal(current(s).deadOnAir, true);
  s.inVein = true;
  discardTube(s);
  assert.equal(current(s).key, "lightblue");
  assert.equal(current(s).deadOnAir, false);
  assert.equal(s.tubesWasted, 1);
});

/* ========================================================================
   FLOW AND VOLUME — a tube stops when its vacuum is exhausted.
   ===================================================================== */

test("each tube has its own real draw volume", ()=>{
  assert.equal(tubeVolumeMl("lightblue"), 2.7);
  assert.ok(tubeVolumeMl("red") > tubeVolumeMl("lightblue"));
});

test("a finer needle draws more slowly", ()=>{
  assert.ok(gaugeFactor(23) < gaugeFactor(21));
  const fast = drawRateMlPerS({ vessel:GOOD_VEIN, gauge:21, vigour:1 });
  const slow = drawRateMlPerS({ vessel:GOOD_VEIN, gauge:23, vigour:1 });
  assert.ok(slow < fast);
});

test("a dehydrated patient's vein fills more slowly", ()=>{
  const normal = drawRateMlPerS({ vessel:GOOD_VEIN, gauge:21, vigour:1 });
  const dry = drawRateMlPerS({ vessel:GOOD_VEIN, gauge:21, vigour:0.72 });
  assert.ok(dry < normal);
});

test("the flow stops by itself at the tube's draw volume", ()=>{
  const s = stateWith();
  takeTube(s, "lightblue");
  pushOn(s, GRIP.FLANGE);
  fillFor(s, 60, true);
  assert.equal(isFull(s), true);
  assert.equal(current(s).drawnMl, tubeVolumeMl("lightblue"));
});

test("pulling a tube off early leaves it short, and the shortfall is measured", ()=>{
  const s = stateWith();
  takeTube(s, "lightblue");
  pushOn(s, GRIP.FLANGE);
  fillFor(s, 1.0, true);
  removeTube(s, GRIP.FLANGE);
  const frac = fillFraction(s, "lightblue");
  assert.ok(frac > 0 && frac < 1, `expected a partial fill, got ${frac}`);
});

test("backing a tube off past the guideline stops the flow", ()=>{
  const s = stateWith();
  takeTube(s, "red");
  pushOn(s, GRIP.FLANGE);
  fillFor(s, 1, true);
  const drawn = current(s).drawnMl;
  seat(s, SEAT_GUIDELINE - s.seatDepth, 0, GRIP.FLANGE);
  fillFor(s, 5, true);
  assert.equal(current(s).drawnMl, drawn, "a broken vacuum draws nothing");
});

/* ========================================================================
   RATIO — a short citrate tube is wrong, not approximate.
   ===================================================================== */

test("citrate demands the strictest fill and is invalidated by a short draw", ()=>{
  assert.ok(requiredFraction("lightblue") > requiredFraction("lavender"));
  assert.equal(ratioCritical("lightblue"), true);
  assert.equal(ratioCritical("red"), false);
});

test("a short citrate tube blocks; a short serum tube only warns", ()=>{
  const short = (key)=>{
    const s = createCollectionState({ order:[key], vessel:GOOD_VEIN, gauge:21, inVein:true });
    takeTube(s, key);
    pushOn(s, GRIP.FLANGE);
    fillFor(s, 0.6, true);
    removeTube(s, GRIP.FLANGE);
    return evaluateCollection(s, { vessel:GOOD_VEIN, inVein:true, tourniquetOn:true });
  };
  const citrate = short("lightblue");
  assert.ok(citrate.blocking.some(i => i.code === "ratioInvalid"));
  const serum = short("red");
  assert.equal(serum.blocking.some(i => i.code === "ratioInvalid"), false);
});

/* ========================================================================
   VEIN COLLAPSE — a real technique to get out of, not a retry button.
   ===================================================================== */

test("a full-draw tube collapses a narrow vein but not a good one", ()=>{
  assert.equal(collapsesVein(NARROW_VEIN, "red"), true);
  assert.equal(collapsesVein(GOOD_VEIN, "red"), false);
  assert.equal(collapsesVein(NARROW_VEIN, "lightblue"), false, "a small-volume tube does not");
});

test("the flow stops early on a collapsing vein", ()=>{
  const s = createCollectionState({ order:["red"], vessel:NARROW_VEIN, gauge:21, inVein:true });
  takeTube(s, "red");
  pushOn(s, GRIP.FLANGE);
  fillFor(s, 60, true);
  assert.equal(current(s).collapsed, true);
  assert.ok(current(s).drawnMl < current(s).volumeMl);
});

test("breaking the vacuum and re-engaging gets more, and eventually fills it", ()=>{
  const s = createCollectionState({ order:["red"], vessel:NARROW_VEIN, gauge:21, inVein:true });
  takeTube(s, "red");
  pushOn(s, GRIP.FLANGE);
  fillFor(s, 60, true);
  const afterFirstCycle = current(s).drawnMl;
  backOffToGuideline(s);
  assert.equal(current(s).collapsed, false, "backing off breaks the vacuum");
  pushOn(s, GRIP.FLANGE);
  fillFor(s, 60, true);
  assert.ok(current(s).drawnMl > afterFirstCycle, "the second cycle gets more");
  assert.ok(s.reseats >= 1);
});

test("collectTubeCleanly fills even a collapsing vein, by doing the technique", ()=>{
  const s = createCollectionState({ order:["red"], vessel:NARROW_VEIN, gauge:21, inVein:true });
  collectTubeCleanly(s, "red", { tourniquetOn:true });
  assert.equal(fillFraction(s, "red"), 1);
  assert.equal(s.needleOut, false);
});

/* ========================================================================
   ORDER OF DRAW — a directional contamination between two specific
   additives, not a "swapped" boolean.
   ===================================================================== */

test("the canonical order is the CLSI order, whatever order the keys arrive in", ()=>{
  assert.deepEqual(expectedOrder(["lavender","lightblue","red"]), ["lightblue","red","lavender"]);
});

test("EDTA carries into a citrate tube drawn after it; the reverse does not", ()=>{
  assert.ok(carryoverInto("lavender", "lightblue"));
  assert.equal(carryoverInto("lightblue", "lavender"), null);
});

test("carryover is only between additives that actually interfere", ()=>{
  assert.equal(carryoverInto("red", "sst"), null, "a plain serum tube carries nothing");
});

test("drawing lavender before light blue contaminates the light blue tube", ()=>{
  const s = stateWith();
  collectTubeCleanly(s, "lavender", { tourniquetOn:true });
  collectTubeCleanly(s, "lightblue", { tourniquetOn:true });
  assert.ok(s.tubes.lightblue.carryover, "the citrate tube picked up EDTA");
  assert.equal(s.tubes.lightblue.carryover.from, "lavender");
  const r = evaluateCollection(s, { vessel:GOOD_VEIN, inVein:true, tourniquetOn:true });
  assert.ok(r.blocking.some(i => i.code === "carryoverDone"));
  assert.equal(r.ready, false);
});

test("drawing in order contaminates nothing and is ready", ()=>{
  const s = stateWith();
  collectTubeCleanly(s, "lightblue", { tourniquetOn:true });
  collectTubeCleanly(s, "lavender", { tourniquetOn:true });
  assert.equal(s.tubes.lightblue.carryover, null);
  assert.equal(s.tubes.lavender.carryover, null);
  const r = evaluateCollection(s, { vessel:GOOD_VEIN, inVein:true, tourniquetOn:true });
  assert.equal(r.ready, true, r.issues.map(i=>i.code).join(","));
});

test("order accuracy degrades by pair, not all-or-nothing", ()=>{
  assert.equal(orderAccuracy(["lightblue","red","lavender"], ["lightblue","red","lavender"]), 1);
  const partial = orderAccuracy(["lightblue","lavender","red"], ["lightblue","red","lavender"]);
  assert.ok(partial > 0 && partial < 1, `expected a partial score, got ${partial}`);
  assert.ok(orderAccuracy(["lavender","red","lightblue"], ["lightblue","red","lavender"])
    < partial, "reversing the lot scores worse than one tube out of place");
});

/* ========================================================================
   JUDGEMENT
   ===================================================================== */

test("no flash blocks before any stopper is pierced", ()=>{
  const s = stateWith();
  const r = evaluateCollection(s, { vessel:GOOD_VEIN, inVein:false, tourniquetOn:true });
  assert.ok(r.blocking.some(i => i.code === "noAccess"));
});

test("a dislodged needle blocks and says how far it moved", ()=>{
  const s = stateWith();
  takeTube(s, "lightblue");
  pushOn(s, GRIP.BODY);
  const r = evaluateCollection(s, { vessel:GOOD_VEIN, inVein:true, tourniquetOn:true });
  const issue = r.blocking.find(i => i.code === "needleOut");
  assert.ok(issue);
  assert.ok(issue.data.shiftM > 0);
});

test("the needle moving warns before it fails", ()=>{
  const s = stateWith();
  takeTube(s, "lightblue");
  seat(s, SEAT_GUIDELINE + 0.004, 0, GRIP.BODY);   // 4mm of loaded travel, unbraced
  const r = evaluateCollection(s, { vessel:GOOD_VEIN, inVein:true, tourniquetOn:true });
  assert.equal(s.needleOut, false);
  assert.ok(r.issues.some(i => i.code === "needleMoving"));
});

test("nextAction walks the technique in order", ()=>{
  const s = stateWith();
  let r = evaluateCollection(s, { vessel:GOOD_VEIN, inVein:true });
  assert.match(nextAction(s, r), /off the rack/i);
  takeTube(s, "lightblue");
  r = evaluateCollection(s, { vessel:GOOD_VEIN, inVein:true });
  assert.match(nextAction(s, r), /flange/i);
  pushOn(s, GRIP.FLANGE);
  r = evaluateCollection(s, { vessel:GOOD_VEIN, inVein:true });
  assert.match(nextAction(s, r), /fill/i);
  fillFor(s, 60, true);
  r = evaluateCollection(s, { vessel:GOOD_VEIN, inVein:true });
  assert.match(nextAction(s, r), /pull it straight off/i);
});

test("an unpierced tube can be put back on the rack for free", ()=>{
  const s = stateWith();
  takeTube(s, "lavender");
  returnTube(s);
  assert.equal(s.currentKey, null);
  assert.equal(s.tubes.lavender, undefined);
  assert.equal(s.takenSequence.length, 0);
});

/* ========================================================================
   SCORING — real millilitres and real percentages.
   ===================================================================== */

test("a clean two-tube collection scores full marks and reports real volumes", ()=>{
  const s = stateWith();
  collectTubeCleanly(s, "lightblue", { tourniquetOn:true });
  collectTubeCleanly(s, "lavender", { tourniquetOn:true });
  const r = evaluateCollection(s, { vessel:GOOD_VEIN, inVein:true });
  const m = measureCollection(s, r, { tourniquetSeconds: 40 });
  assert.equal(m.score, 100, m.mistakes.map(x=>x.code).join(","));
  assert.equal(m.tubesCollected, 2);
  assert.equal(m.orderAccuracy, 1);
  assert.equal(m.tubes.find(t=>t.key==="lightblue").fillPercent, 100);
  assert.equal(m.totalDrawnMl, 2.7 + 4.0);
  assert.equal(m.mistakes.length, 0);
});

test("a short citrate tube is reported as invalidated, not merely underfilled", ()=>{
  const s = createCollectionState({ order:["lightblue"], vessel:GOOD_VEIN, gauge:21, inVein:true });
  takeTube(s, "lightblue");
  pushOn(s, GRIP.FLANGE);
  fillFor(s, 0.8, true);
  removeTube(s, GRIP.FLANGE);
  const r = evaluateCollection(s, { vessel:GOOD_VEIN, inVein:true });
  const m = measureCollection(s, r, {});
  assert.equal(m.invalidatedTubes, 1);
  assert.ok(m.score < 90);
  assert.ok(m.tubes[0].fillPercent < m.tubes[0].requiredPercent);
});

test("the tourniquet's own clock is carried into this step's measurements", ()=>{
  const s = stateWith();
  collectTubeCleanly(s, "lightblue", { tourniquetOn:true });
  collectTubeCleanly(s, "lavender", { tourniquetOn:true });
  const r = evaluateCollection(s, { vessel:GOOD_VEIN, inVein:true });
  const m = measureCollection(s, r, { tourniquetSeconds: 95 });
  assert.equal(m.tourniquetSeconds, 95);
  assert.ok(m.mistakes.some(x => x.code === "tourniquetLong"));
});

test("the outcome folds into the chips the rest of the game already reads", ()=>{
  const s = stateWith();
  collectTubeCleanly(s, "lightblue", { tourniquetOn:true });
  collectTubeCleanly(s, "lavender", { tourniquetOn:true });
  const r = evaluateCollection(s, { vessel:GOOD_VEIN, inVein:true });
  const m = measureCollection(s, r, {});
  const c = {};
  applyCollectionOutcome(c, m);
  assert.equal(c.fillGood, true);
  assert.equal(c.tubeOrderOk, true);
  assert.deepEqual(c.filled, ["lightblue","lavender"]);
});

test("an out-of-order draw clears the order chip but not the fill chip", ()=>{
  const s = stateWith();
  collectTubeCleanly(s, "lavender", { tourniquetOn:true });
  collectTubeCleanly(s, "lightblue", { tourniquetOn:true });
  const r = evaluateCollection(s, { vessel:GOOD_VEIN, inVein:true });
  const m = measureCollection(s, r, {});
  const c = {};
  applyCollectionOutcome(c, m);
  assert.equal(c.fillGood, true, "both tubes did fill to volume");
  assert.equal(c.tubeOrderOk, false);
});

/* ========================================================================
   PUTTING IT RIGHT — what a second attempt can and cannot fix.
   ===================================================================== */

test("a tube that came off short can be drawn again, at the cost of the wasted one", ()=>{
  const s = stateWith();
  takeTube(s, "lightblue");
  pushOn(s, GRIP.FLANGE);
  fillFor(s, 0.6, true);
  removeTube(s, GRIP.FLANGE);
  assert.ok(fillFraction(s, "lightblue") < 0.9);

  takeTube(s, "lightblue");
  assert.equal(current(s).key, "lightblue", "another tube of the same kind comes off the rack");
  assert.equal(s.tubesWasted, 1);
  fillFor(s, 60, true);
  assert.equal(current(s).drawnMl, 0, "the fresh one is not pierced yet");
  pushOn(s, GRIP.FLANGE);
  fillFor(s, 60, true);
  removeTube(s, GRIP.FLANGE);
  assert.equal(fillFraction(s, "lightblue"), 1);
});

test("a tube ruined by carryover cannot be redrawn — the additive is in the needle", ()=>{
  const s = stateWith();
  collectTubeCleanly(s, "lavender", { tourniquetOn:true });
  collectTubeCleanly(s, "lightblue", { tourniquetOn:true });
  assert.ok(s.tubes.lightblue.carryover);
  const before = s.takenSequence.length;
  takeTube(s, "lightblue");
  assert.equal(s.currentKey, null, "a second tube through the same needle is ruined the same way");
  assert.equal(s.takenSequence.length, before);
});

test("a full, valid tube cannot be drawn again for a second go", ()=>{
  const s = stateWith();
  collectTubeCleanly(s, "lightblue", { tourniquetOn:true });
  takeTube(s, "lightblue");
  assert.equal(s.currentKey, null);
});

test("the collection is not finished while a short tube could still be redrawn", ()=>{
  const s = createCollectionState({ order:["lightblue"], vessel:GOOD_VEIN, gauge:21, inVein:true });
  takeTube(s, "lightblue");
  pushOn(s, GRIP.FLANGE);
  fillFor(s, 0.6, true);
  removeTube(s, GRIP.FLANGE);
  const r = evaluateCollection(s, { vessel:GOOD_VEIN, inVein:true });
  assert.equal(r.allDone, false, "every tube is off, but one of them can still be put right");
  assert.deepEqual(r.redrawable, ["lightblue"]);
});
