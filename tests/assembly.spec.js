/* =========================================================================
   Unit tests for the needle + holder unit. These assert the CLINICAL claims —
   peel don't tear, don't touch the sleeved end, meet the hub square, turn it
   to finger-tight, pull the sheath straight off, look at the bevel, roll it
   up, and never put the sheath back on — not the code that implements them.
   ========================================================================= */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ATTACH_TURNS, SECURE_TURNS, SNUG_TURNS, OVERTIGHT_TURNS,
  CROSS_THREAD_DEG, CROSS_BIND_TURNS, PEEL_OFF_SEAM, CAP_TRAVEL,
  AXIAL_GOOD, WOBBLE_MAX, BEVEL_TOLERANCE_DEG,
  bevelFromTurns, wrap180, axialFraction, isSecure,
  evaluateAssembly, evaluateUncap, nextAssemblyAction, nextUncapAction,
} from "../src/venipuncture/assembly/assemblyRules.js";
import {
  createAssemblyState, CAP_PLACE,
  peel, peelOpen, tearOpen, liftNeedle, engage, turn, backOut, threadIn,
  freshNeedle, beginUncap, pullCap, pullCapStraight, wiggleCapOff,
  placeCap, recap, touchNeedle, rollBevel, inspectBevel, discardUnit, warnPatient,
} from "../src/venipuncture/assembly/assemblyState.js";
import {
  measureAssembly, measureUncap, applyAssemblyOutcome, applyUncapOutcome,
} from "../src/venipuncture/assembly/assemblyScoring.js";

const codes = r=>r.issues.map(i=>i.code);
const blocking = r=>r.blocking.map(i=>i.code);

function fresh(o){ return createAssemblyState(o || {}); }

/** A correctly built unit: peeled, lifted by the sheath, threaded square. */
function built(o){
  const s = fresh(o);
  peelOpen(s);
  liftNeedle(s, "sheath");
  threadIn(s, SNUG_TURNS, 0);
  return s;
}

/* ---------- the pouch --------------------------------------------------------- */

test("a sealed pouch blocks everything, and nothing threads out of it", ()=>{
  const s = fresh();
  const r = evaluateAssembly(s);
  assert.ok(blocking(r).includes("pouchSealed"));
  assert.equal(r.ready, false);
  // the needle cannot be lifted out of a pouch that is not open
  liftNeedle(s, "sheath");
  assert.equal(s.needleInHand, false);
});

test("peeling along the seam opens it; wandering off the seam tears it", ()=>{
  const clean = fresh();
  peel(clean, 0.5, 0.001);
  assert.equal(clean.pouchOpen, false, "half a seam is not open yet");
  peel(clean, 0.5, 0.001);
  assert.equal(clean.pouchOpen, true);
  assert.equal(clean.pouchTorn, false);

  const torn = fresh();
  peel(torn, 1, PEEL_OFF_SEAM*1.5);
  assert.equal(torn.pouchOpen, true);
  assert.equal(torn.pouchTorn, true);
  assert.ok(codes(evaluateAssembly(torn)).includes("tornPouch"));
});

test("a pouch that was already split at the cart is not sterile here", ()=>{
  const s = built({ pouchCompromised: true });
  const r = evaluateAssembly(s);
  assert.ok(blocking(r).includes("compromisedPouch"));
  assert.equal(r.ready, false);
  // taking a fresh one is the recovery, and it is counted
  freshNeedle(s);
  peelOpen(s); liftNeedle(s, "sheath"); threadIn(s, SNUG_TURNS, 0);
  assert.equal(evaluateAssembly(s).ready, true);
  assert.equal(s.needlesUsed, 2);
});

/* ---------- handling ------------------------------------------------------------ */

test("taking hold of the sleeved end contaminates the needle; the sheath does not", ()=>{
  const bySheath = fresh(); peelOpen(bySheath); liftNeedle(bySheath, "sheath");
  assert.equal(bySheath.contaminated, false);

  const byEnd = fresh(); peelOpen(byEnd); liftNeedle(byEnd, "threadEnd");
  assert.equal(byEnd.contaminated, true);
  assert.equal(byEnd.contaminatedBy, "threadEnd");
  threadIn(byEnd, SNUG_TURNS, 0);
  const r = evaluateAssembly(byEnd);
  assert.ok(blocking(r).includes("contaminated"), "a perfectly threaded contaminated needle is still blocked");
  assert.equal(r.ready, false);
});

/* ---------- alignment ----------------------------------------------------------- */

test("meeting the hub square threads; meeting it off-axis cross-threads and binds", ()=>{
  const square = fresh(); peelOpen(square); liftNeedle(square, "sheath");
  engage(square, CROSS_THREAD_DEG - 2);
  assert.equal(square.crossThreaded, false);
  turn(square, 3);
  assert.equal(square.turns, 3);

  const cross = fresh(); peelOpen(cross); liftNeedle(cross, "sheath");
  engage(cross, CROSS_THREAD_DEG + 6);
  assert.equal(cross.crossThreaded, true);
  turn(cross, 5);
  assert.equal(cross.turns, CROSS_BIND_TURNS, "forcing a cross-threaded needle gets it no further");
  const r = evaluateAssembly(cross);
  assert.ok(blocking(r).includes("crossThreaded"));
  assert.equal(r.ready, false);
});

test("backing a cross-threaded needle right off is the way out", ()=>{
  const s = fresh(); peelOpen(s); liftNeedle(s, "sheath");
  engage(s, 25); turn(s, 5);
  backOut(s);
  assert.equal(s.crossThreaded, false);
  assert.equal(s.turns, 0);
  assert.equal(s.engaged, false);
  engage(s, 2); turn(s, SNUG_TURNS);
  assert.equal(evaluateAssembly(s).ready, true);
});

/* ---------- turns ---------------------------------------------------------------- */

test("finger-tight is a real amount of turning, and short of it the unit leaks", ()=>{
  assert.ok(ATTACH_TURNS < SECURE_TURNS && SECURE_TURNS <= SNUG_TURNS && SNUG_TURNS < OVERTIGHT_TURNS);

  const barely = fresh(); peelOpen(barely); liftNeedle(barely, "sheath"); threadIn(barely, 1.2, 0);
  const rb = evaluateAssembly(barely);
  assert.ok(blocking(rb).includes("loose"));
  assert.equal(rb.ready, false);

  const notQuite = fresh(); peelOpen(notQuite); liftNeedle(notQuite, "sheath"); threadIn(notQuite, 2.1, 0);
  const rn = evaluateAssembly(notQuite);
  assert.equal(rn.ready, true, "past secure it is usable");
  assert.ok(codes(rn).includes("notSnug"), "...but it is still worth saying it is not finger-tight");

  const snug = built();
  assert.equal(evaluateAssembly(snug).ready, true);
  assert.equal(codes(evaluateAssembly(snug)).includes("notSnug"), false);
});

test("not attached at all is a different failure from loose", ()=>{
  const s = fresh(); peelOpen(s); liftNeedle(s, "sheath");
  engage(s, 0); turn(s, 0.4);
  assert.ok(blocking(evaluateAssembly(s)).includes("notThreaded"));
  assert.equal(codes(evaluateAssembly(s)).includes("loose"), false);
});

test("forcing it past finger-tight over-torques the hub", ()=>{
  const s = fresh(); peelOpen(s); liftNeedle(s, "sheath"); threadIn(s, OVERTIGHT_TURNS + 1, 0);
  const r = evaluateAssembly(s);
  assert.ok(codes(r).includes("overTightened"));
  assert.equal(r.ready, true, "over-tight still works — it just will not come apart nicely");
});

test("turning the wrong way is recorded as turning the wrong way", ()=>{
  const s = fresh(); peelOpen(s); liftNeedle(s, "sheath");
  engage(s, 0); turn(s, 3); turn(s, -0.6); turn(s, 0.6);
  assert.ok(Math.abs(s.reverseTurns - 0.6) < 1e-9);
  assert.ok(codes(evaluateAssembly(s)).includes("unscrewed"));
});

test("turns never go negative", ()=>{
  const s = fresh(); peelOpen(s); liftNeedle(s, "sheath");
  engage(s, 0); turn(s, 1); turn(s, -5);
  assert.equal(s.turns, 0);
});

/* ---------- the gauge they staged turns up in the hand -------------------------- */

test("the needle assembled is the needle that was staged", ()=>{
  const s = built({ gauge: 25 });
  const r = evaluateAssembly(s);
  assert.ok(codes(r).includes("gauge"));
  assert.equal(r.ready, true, "a 25G still assembles — it was already scored at the cart");
  assert.equal(measureAssembly(s, r).gauge, 25);
});

/* ---------- assembling inside the drying time ----------------------------------- */

test("assembling after the site has already dried is dead time, and is noticed", ()=>{
  const inside = built({ dryElapsedAtStart: 3 });
  assert.equal(codes(evaluateAssembly(inside)).includes("dryTimeWasted"), false);
  assert.equal(measureAssembly(inside).insideDryTime, true);

  const wasted = built({ dryElapsedAtStart: 40 });
  assert.ok(codes(evaluateAssembly(wasted)).includes("dryTimeWasted"));
  assert.equal(measureAssembly(wasted).insideDryTime, false);
});

/* =========================================================================
   UNCAP
   ========================================================================= */

/** A built unit, entered into the uncap step. */
function uncapReady(turns){
  const s = built();
  if(turns != null){ s.turns = turns; }
  beginUncap(s, 1000);
  return s;
}

test("where the bevel ends up is decided by where the threading stopped", ()=>{
  assert.equal(bevelFromTurns(2), 0, "a whole number of turns lands bevel-up");
  assert.equal(bevelFromTurns(2.5), 180, "half a turn past lands it upside down");
  assert.ok(Math.abs(bevelFromTurns(2.25) - 90) < 1e-9);
  assert.equal(wrap180(370), 10);

  const s = uncapReady(2.5);
  assert.equal(s.bevelDeg, 180, "the unit remembers the angle its own threading left");
});

test("a sheath still on blocks the step", ()=>{
  const s = uncapReady(2);
  const r = evaluateUncap(s, 1000);
  assert.ok(blocking(r).includes("stillCapped"));
  assert.equal(r.ready, false);
});

test("pulling the sheath straight off leaves the needle intact", ()=>{
  const s = uncapReady(2);
  pullCapStraight(s);
  assert.equal(s.capOn, false);
  assert.equal(s.needleDamaged, false);
  assert.equal(s.capAxialFraction, 1);
  assert.ok(axialFraction(s.capAxialTravel, s.capTotalTravel) >= AXIAL_GOOD);
});

test("levering the sheath off sideways bends the shaft and barbs the bevel", ()=>{
  const s = uncapReady(2);
  wiggleCapOff(s);
  assert.equal(s.capOn, false);
  assert.ok(s.maxLateral > WOBBLE_MAX);
  assert.equal(s.needleDamaged, true);
  const r = evaluateUncap(s, 1000);
  assert.ok(blocking(r).includes("barbedNeedle"));
  assert.ok(codes(r).includes("wiggledOff"));
  assert.equal(r.ready, false);
});

test("a twisted pull rolls a burr onto the edge", ()=>{
  const s = uncapReady(2);
  pullCap(s, CAP_TRAVEL, 0, 0, 40);
  assert.equal(s.capOn, false);
  assert.equal(s.needleDamaged, true);
  assert.ok(codes(evaluateUncap(s, 1000)).includes("twistedOff"));
});

test("pushing the sheath back on counts against the pull, not for it", ()=>{
  const s = uncapReady(2);
  pullCap(s, 0.010, 0, 0, 0);
  pullCap(s, -0.010, 0, 0, 0);
  assert.ok(s.capAxialFraction < AXIAL_GOOD);
  assert.equal(s.capOn, true, "it has not come off — it went back where it started");
});

test("the bevel has to be rolled up, and the step blocks until it is", ()=>{
  const s = uncapReady(2.5);          // threading stopped bevel-down
  pullCapStraight(s);
  let r = evaluateUncap(s, 1000);
  assert.ok(blocking(r).includes("bevelOff"));
  assert.ok(r.issues.find(i=>i.code === "bevelOff").message.includes("facing down"));

  rollBevel(s, -180);
  assert.ok(Math.abs(s.bevelDeg) <= BEVEL_TOLERANCE_DEG);
  r = evaluateUncap(s, 1000);
  assert.equal(blocking(r).includes("bevelOff"), false);
});

test("a bevel just inside tolerance passes; just outside does not", ()=>{
  const inside = uncapReady(2); pullCapStraight(inside);
  rollBevel(inside, BEVEL_TOLERANCE_DEG - 2);
  assert.equal(blocking(evaluateUncap(inside, 1000)).includes("bevelOff"), false);

  const outside = uncapReady(2); pullCapStraight(outside);
  rollBevel(outside, BEVEL_TOLERANCE_DEG + 4);
  assert.ok(blocking(evaluateUncap(outside, 1000)).includes("bevelOff"));
});

test("not looking at the bevel is a real omission, and looking is how a barb is found", ()=>{
  const s = uncapReady(2);
  pullCapStraight(s);
  assert.ok(codes(evaluateUncap(s, 1000)).includes("notInspected"));
  inspectBevel(s);
  assert.equal(codes(evaluateUncap(s, 1000)).includes("notInspected"), false);
  assert.equal(measureUncap(s, null, 1000).bevelInspected, true);
});

test("the sheath never goes back on the needle by hand", ()=>{
  const s = uncapReady(2);
  pullCapStraight(s);
  recap(s);
  const r = evaluateUncap(s, 1000);
  assert.ok(blocking(r).includes("recapped"));
  assert.equal(r.ready, false);
});

test("putting the sheath down on the cleaned field is a blocking mistake", ()=>{
  const s = uncapReady(2);
  pullCapStraight(s);
  placeCap(s, CAP_PLACE.SITE);
  assert.ok(blocking(evaluateUncap(s, 1000)).includes("capOnSite"));

  const tray = uncapReady(2);
  pullCapStraight(tray);
  placeCap(tray, CAP_PLACE.TRAY);
  assert.equal(blocking(evaluateUncap(tray, 1000)).includes("capOnSite"), false);

  const floor = uncapReady(2);
  pullCapStraight(floor);
  placeCap(floor, CAP_PLACE.FLOOR);
  assert.ok(codes(evaluateUncap(floor, 1000)).includes("capDropped"));
  assert.equal(blocking(evaluateUncap(floor, 1000)).includes("capDropped"), false);
});

test("a bare needle that touches anything is finished", ()=>{
  const s = uncapReady(2);
  pullCapStraight(s);
  touchNeedle(s, "the bench");
  assert.ok(blocking(evaluateUncap(s, 1000)).includes("needleTouched"));
});

test("a capped needle set down is not contaminated — the sheath is doing its job", ()=>{
  const s = uncapReady(2);
  touchNeedle(s, "the bench");
  assert.equal(s.needleContaminated, false);
});

test("recognising a damaged unit and replacing it recovers the step, and is counted", ()=>{
  const s = uncapReady(2);
  wiggleCapOff(s);
  inspectBevel(s);
  assert.equal(s.needleDamaged, true);

  discardUnit(s);
  assert.equal(s.needleDamaged, false);
  assert.equal(s.capOn, true, "the replacement arrives capped");
  assert.equal(s.unitsDiscarded, 1);
  assert.ok(isSecure(s), "and assembled");

  pullCapStraight(s);
  rollBevel(s, -s.bevelDeg);
  inspectBevel(s);
  warnPatient(s, 1000);
  const r = evaluateUncap(s, 1000);
  assert.equal(r.ready, true);
  assert.ok(codes(r).includes("unitsDiscarded"));
});

test("the patient gets told, and told at the right moment", ()=>{
  const s = uncapReady(2);
  pullCapStraight(s); inspectBevel(s);
  assert.ok(codes(evaluateUncap(s, 1000)).includes("patientNotWarned"));

  warnPatient(s, 1000);
  assert.equal(codes(evaluateUncap(s, 2000)).includes("patientNotWarned"), false);
  assert.ok(codes(evaluateUncap(s, 1000 + 60000)).includes("warnedTooEarly"));
});

test("a unit that is not finger-tight must not be uncapped", ()=>{
  const s = fresh();
  peelOpen(s); liftNeedle(s, "sheath"); threadIn(s, 1.2, 0);
  beginUncap(s, 1000);
  assert.ok(blocking(evaluateUncap(s, 1000)).includes("notAssembled"));
});

test("a clean uncap is ready", ()=>{
  const s = uncapReady(2);
  pullCapStraight(s);
  inspectBevel(s);
  placeCap(s, CAP_PLACE.TRAY);
  warnPatient(s, 1000);
  const r = evaluateUncap(s, 1000);
  assert.deepEqual(blocking(r), []);
  assert.equal(r.ready, true);
});

/* ---------- measurements are measurements --------------------------------------- */

test("assembly is measured in turns and degrees, not in booleans", ()=>{
  const s = built();
  const m = measureAssembly(s, evaluateAssembly(s));
  assert.equal(m.turns, SNUG_TURNS);
  assert.equal(m.fingerTight, true);
  assert.equal(m.crossThreaded, false);
  assert.equal(m.pouchPeeled, true);
  assert.equal(m.needlesUsed, 1);
  assert.ok(m.score > 90);
  assert.ok(typeof m.narrative === "string" && m.narrative.includes("2.5 turns"));
});

test("uncapping is measured in percent axial, millimetres and degrees", ()=>{
  const s = uncapReady(2.5);
  wiggleCapOff(s);
  const m = measureUncap(s, null, 1000);
  assert.ok(m.axialPct < 100);
  assert.ok(m.lateralMm > 0);
  assert.equal(m.bevelDeg, 180);
  assert.equal(m.bevelUp, false);
  assert.equal(m.needleDamaged, true);
  assert.ok(m.score < 60);
  assert.ok(m.mistakes.some(x=>x.code === "barbedNeedle"));
});

test("a cross-threaded assembly scores far below a loose one", ()=>{
  const cross = fresh(); peelOpen(cross); liftNeedle(cross, "sheath"); threadIn(cross, 3, 25);
  const loose = fresh(); peelOpen(loose); liftNeedle(loose, "sheath"); threadIn(loose, 1.6, 0);
  assert.ok(measureAssembly(cross).score < measureAssembly(loose).score);
});

test("the outcomes fold onto the procedure's own chips honestly", ()=>{
  const good = {};
  applyAssemblyOutcome(good, measureAssembly(built()));
  assert.equal(good.assembleOk, true);

  const bad = {};
  const s = fresh(); peelOpen(s); liftNeedle(s, "threadEnd"); threadIn(s, SNUG_TURNS, 0);
  applyAssemblyOutcome(bad, measureAssembly(s));
  assert.equal(bad.assembleOk, false, "a contaminated needle is not a completed step");

  const u = {};
  const done = uncapReady(2);
  pullCapStraight(done); inspectBevel(done); placeCap(done, CAP_PLACE.TRAY); warnPatient(done, 1000);
  applyUncapOutcome(u, measureUncap(done, null, 1000));
  assert.equal(u.uncapOk, true);
});

/* ---------- the coach's next action tracks the state ----------------------------- */

test("the next action names the next physical thing to do", ()=>{
  const s = fresh();
  assert.match(nextAssemblyAction(s), /[Pp]eel/);
  peelOpen(s);
  assert.match(nextAssemblyAction(s), /sheath/);
  liftNeedle(s, "sheath");
  assert.match(nextAssemblyAction(s), /hub/);
  engage(s, 30); turn(s, 1);
  assert.match(nextAssemblyAction(s), /line it up|Back it/i);

  const u = uncapReady(2);
  assert.match(nextUncapAction(u), /straight off/);
  pullCapStraight(u);
  assert.match(nextUncapAction(u), /bevel/i);
});
