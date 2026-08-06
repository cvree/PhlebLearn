/* =========================================================================
   COMPLICATIONS — unit tests for the pure layers.

   The point of these is that a complication is CAUSED by measurements the
   other branches already produce, and that what happens next depends on what
   the learner does about it. Every threshold asserted here is the threshold
   the learner meets in the browser. No DOM, no THREE.
   ========================================================================= */
import test from "node:test";
import assert from "node:assert/strict";

import {
  COMPLICATION, COMPLICATIONS, RESPONSE, RESPONSES,
  complicationFor, isCorrectResponse, harmOf, responseLabel,
  syncopeRiskFor, snapshotDraw, detectOnsets, nearHazard,
  evaluateComplications, nextAction,
  DRY_STICK_AFTER_S, HEMATOMA_VISIBLE_ML, HEMATOMA_LARGE_ML, BLOWN_SHEAR_M,
  SYNCOPE_FAINT_AFTER_S,
} from "../src/venipuncture/complications/complicationRules.js";

import {
  createComplicationState, onset, markShown, respond, miss,
  tickComplicationState, syncFromAftercare, allRecords, activeRecords, OUTCOME,
} from "../src/venipuncture/complications/complicationState.js";

import {
  measureComplications, applyComplicationOutcome,
} from "../src/venipuncture/complications/complicationScoring.js";

const T0 = 1000000;

/** A state with the dice already decided, so nothing here is flaky. */
function stateWith(o){
  const opt = o || {};
  const s = createComplicationState({
    patient: opt.patient || {},
    difficulty: opt.difficulty || 0,
    rng: () => (opt.roll == null ? 0.5 : opt.roll),
    now: T0,
  });
  if(opt.flinchRoll != null) s.flinchRoll = opt.flinchRoll;
  if(opt.syncopeThreshold != null) s.syncopeThreshold = opt.syncopeThreshold;
  return s;
}

/** A vein, a nerve and an artery in the same arm, as the real geometry has. */
function vessels(){
  return [
    { id: "median-cubital", kind: "vein", calibre: 0.0032, depth: 0.0035,
      path: [{ x: -0.02, z: 0 }, { x: 0.02, z: 0 }] },
    { id: "median-nerve", kind: "nerve", calibre: 0.0022, depth: 0.0072,
      path: [{ x: -0.02, z: 0.020 }, { x: 0.02, z: 0.020 }] },
    { id: "brachial-artery", kind: "artery", calibre: 0.0040, depth: 0.0090,
      path: [{ x: -0.02, z: 0.026 }, { x: 0.02, z: 0.026 }] },
  ];
}

/** A procedure state as the steps leave it, with only the fields read here. */
function draw(o){
  const opt = o || {};
  return Object.assign({
    armVessels: vessels(),
    insert: null, collection: null, postDraw: null, tourniquet: null,
    needleUnit: { warnedAt: T0 },
    encounter: { startedAt: T0 },
  }, opt);
}

function insertAt(o){
  const opt = o || {};
  return {
    chosenId: opt.chosenId || "median-cubital",
    markX: 0, markZ: 0,
    entryX: opt.entryX == null ? 0 : opt.entryX,
    entryZ: opt.entryZ == null ? 0 : opt.entryZ,
    angleDeg: opt.angleDeg == null ? 20 : opt.angleDeg,
    depthM: opt.depthM == null ? 0.0035 : opt.depthM,
    peakDepthM: opt.peakDepthM == null ? (opt.depthM == null ? 0.0035 : opt.depthM) : opt.peakDepthM,
    flashAt: opt.flashAt === undefined ? T0 : opt.flashAt,
    reapproaches: opt.reapproaches || 0,
    events: [{ t: opt.entryAt == null ? T0 : opt.entryAt, type: "entry", data: null }],
  };
}

/* =========================================================================
   THE CATALOGUE — every complication has a right answer and a wrong one
   ========================================================================= */

test("every complication offers at least one correct and one harmful option", () => {
  for(const id of Object.keys(COMPLICATIONS)){
    const def = COMPLICATIONS[id];
    assert.ok(def.correct.length >= 1, `${id} has no correct response`);
    for(const r of def.correct) assert.ok(def.options.indexOf(r) >= 0, `${id}: correct response not offered`);
    const harmful = def.options.filter(r => harmOf(r) >= 0.5);
    assert.ok(harmful.length >= 1, `${id} has no genuinely wrong option`);
    assert.ok(def.teaching && def.teaching.length > 40, `${id} has no teaching text`);
  }
});

test("carrying on regardless and probing are the harmful answers everywhere", () => {
  assert.ok(harmOf(RESPONSE.PROBE_AROUND) > harmOf(RESPONSE.ADJUST_ONCE));
  assert.ok(harmOf(RESPONSE.CONTINUE_ANYWAY) > harmOf(RESPONSE.PAUSE_AND_REASSURE));
  assert.equal(harmOf(RESPONSE.STOP_AND_PRESSURE), 0);
});

test("one careful adjustment is right for a dry stick and wrong for a blown vein", () => {
  assert.ok(isCorrectResponse(COMPLICATION.DRY_STICK, RESPONSE.ADJUST_ONCE));
  assert.ok(!isCorrectResponse(COMPLICATION.BLOWN_VEIN, RESPONSE.ADJUST_ONCE));
  assert.ok(isCorrectResponse(COMPLICATION.BLOWN_VEIN, RESPONSE.STOP_AND_PRESSURE));
});

test("responseLabel falls back to the id rather than throwing", () => {
  assert.equal(responseLabel("nonsense"), "nonsense");
  assert.equal(responseLabel(RESPONSE.HAND_OFF), RESPONSES[RESPONSE.HAND_OFF].label);
});

/* =========================================================================
   TRIGGERS — caused by the work, not scheduled alongside it
   ========================================================================= */

test("a dry stick fires only once the needle has been in with no flash for long enough", () => {
  const c = draw({ insert: insertAt({ flashAt: null, entryAt: T0 }) });
  const s = stateWith({});
  const early = detectOnsets(snapshotDraw(c, T0 + (DRY_STICK_AFTER_S - 2)*1000), s);
  assert.equal(early.filter(x => x.id === COMPLICATION.DRY_STICK).length, 0);
  const late = detectOnsets(snapshotDraw(c, T0 + (DRY_STICK_AFTER_S + 1)*1000), s);
  assert.equal(late.filter(x => x.id === COMPLICATION.DRY_STICK).length, 1);
});

test("a stick that flashed never becomes a dry stick, however long it takes", () => {
  const c = draw({ insert: insertAt({ flashAt: T0 + 500, entryAt: T0 }) });
  const found = detectOnsets(snapshotDraw(c, T0 + 60000), stateWith({}));
  assert.equal(found.filter(x => x.id === COMPLICATION.DRY_STICK).length, 0);
});

test("shearing the tip sideways past the wall blows the vein", () => {
  const c = draw({
    insert: insertAt({}),
    collection: { order: ["lavender"], tubes: {}, currentKey: null,
      needleLateralM: BLOWN_SHEAR_M + 0.0002, needleOut: false, peakShiftM: 0.003 },
  });
  const found = detectOnsets(snapshotDraw(c, T0 + 1000), stateWith({}));
  assert.ok(found.some(x => x.id === COMPLICATION.BLOWN_VEIN));
});

test("a steady needle in the vein blows nothing", () => {
  const c = draw({
    insert: insertAt({}),
    collection: { order: ["lavender"], tubes: {}, currentKey: null,
      needleLateralM: 0.0004, needleOut: false, peakShiftM: 0.0004 },
  });
  const found = detectOnsets(snapshotDraw(c, T0 + 1000), stateWith({}));
  assert.ok(!found.some(x => x.id === COMPLICATION.BLOWN_VEIN));
});

test("a through-and-through under a tourniquet is a hematoma", () => {
  const c = draw({
    insert: insertAt({ depthM: 0.010, peakDepthM: 0.010 }),
    tourniquet: { securedAt: T0, releasedAt: null },
  });
  const found = detectOnsets(snapshotDraw(c, T0 + 500), stateWith({}));
  assert.ok(found.some(x => x.id === COMPLICATION.HEMATOMA));
});

test("blood already in the tissue after the draw is a hematoma too", () => {
  const c = draw({ postDraw: { extravasatedMl: HEMATOMA_VISIBLE_ML + 0.05, force: 0, clotProgress: 0.2 } });
  const found = detectOnsets(snapshotDraw(c, T0 + 500), stateWith({}));
  assert.ok(found.some(x => x.id === COMPLICATION.HEMATOMA));
});

test("depth over the median nerve is nerve contact; the same depth over the vein is not", () => {
  const onNerve = draw({ insert: insertAt({ entryZ: 0.020, depthM: 0.0075, peakDepthM: 0.0075, chosenId: "median-cubital" }) });
  assert.ok(detectOnsets(snapshotDraw(onNerve, T0 + 100), stateWith({})).some(x => x.id === COMPLICATION.NERVE_CONTACT));

  const onVein = draw({ insert: insertAt({ entryZ: 0, depthM: 0.0075, peakDepthM: 0.0075 }) });
  assert.ok(!detectOnsets(snapshotDraw(onVein, T0 + 100), stateWith({})).some(x => x.id === COMPLICATION.NERVE_CONTACT));
});

test("a deep stick over the brachial artery with a flash is an arterial puncture", () => {
  const c = draw({ insert: insertAt({ entryZ: 0.026, depthM: 0.0092, peakDepthM: 0.0092 }) });
  assert.ok(detectOnsets(snapshotDraw(c, T0 + 100), stateWith({})).some(x => x.id === COMPLICATION.ARTERIAL));
});

test("nearHazard measures against the vessel's own path, not its name", () => {
  const snap = snapshotDraw(draw({ insert: insertAt({ entryZ: 0.020 }) }), T0);
  const nerve = nearHazard(snap, "nerve", 0.004);
  assert.ok(nerve);
  assert.equal(nerve.vessel.id, "median-nerve");
  assert.equal(nearHazard(snap, "artery", 0.001), null);
});

test("a patient who was warned does not flinch; one who was not, might", () => {
  const warned = draw({ insert: insertAt({}), needleUnit: { warnedAt: T0 } });
  assert.ok(!detectOnsets(snapshotDraw(warned, T0 + 100), stateWith({ flinchRoll: 0 })).some(x => x.id === COMPLICATION.FLINCH));

  const silent = draw({ insert: insertAt({}), needleUnit: { warnedAt: null } });
  assert.ok(detectOnsets(snapshotDraw(silent, T0 + 100), stateWith({ flinchRoll: 0 })).some(x => x.id === COMPLICATION.FLINCH));
  // and a patient who simply does not jump, does not
  assert.ok(!detectOnsets(snapshotDraw(silent, T0 + 100), stateWith({ flinchRoll: 0.99 })).some(x => x.id === COMPLICATION.FLINCH));
});

test("syncope risk is read off explicit trigger data, never from prose", () => {
  const plain = syncopeRiskFor({ mood: "Calm", ageCat: "Adult", history: {} });
  const fainter = syncopeRiskFor({ mood: "Calm", ageCat: "Adult", history: { faintHistory: true } });
  const nervous = syncopeRiskFor({ mood: "Nervous", ageCat: "Teen", history: {} });
  assert.ok(fainter > plain);
  assert.ok(nervous > plain);
  assert.ok(syncopeRiskFor(null) >= 0);
});

test("a complication that has already fired does not fire twice", () => {
  const c = draw({ insert: insertAt({ flashAt: null, entryAt: T0 }) });
  const s = stateWith({});
  const first = detectOnsets(snapshotDraw(c, T0 + 20000), s);
  assert.equal(first.length, 1);
  onset(s, first[0].id, first[0].data, T0 + 20000);
  assert.equal(detectOnsets(snapshotDraw(c, T0 + 21000), s).length, 0);
  respond(s, COMPLICATION.DRY_STICK, RESPONSE.ADJUST_ONCE, T0 + 22000);
  assert.equal(detectOnsets(snapshotDraw(c, T0 + 23000), s).length, 0);
});

/* =========================================================================
   RESPONSE — one answer, one consequence
   ========================================================================= */

test("the right answer manages it and does the patient no harm", () => {
  const s = stateWith({});
  onset(s, COMPLICATION.HEMATOMA, null, T0);
  respond(s, COMPLICATION.HEMATOMA, RESPONSE.RELEASE_BAND_FIRST, T0 + 3000);
  const rec = allRecords(s)[0];
  assert.equal(rec.outcome, OUTCOME.MANAGED);
  assert.equal(rec.correct, true);
  assert.equal(rec.reactionS, 3);
  assert.equal(s.harm, 0);
});

test("carrying on through a hematoma physically enlarges it", () => {
  const s = stateWith({});
  onset(s, COMPLICATION.HEMATOMA, null, T0);
  const before = s.condition.hematomaMl;
  respond(s, COMPLICATION.HEMATOMA, RESPONSE.CONTINUE_ANYWAY, T0 + 1000);
  assert.ok(s.condition.hematomaMl > before);
  assert.ok(s.condition.bruise > 0);
  assert.equal(allRecords(s)[0].outcome, OUTCOME.WORSENED);
  assert.ok(s.harm > 0);
});

test("an answer cannot be taken back once it has been given", () => {
  const s = stateWith({});
  onset(s, COMPLICATION.BLOWN_VEIN, null, T0);
  respond(s, COMPLICATION.BLOWN_VEIN, RESPONSE.PROBE_AROUND, T0 + 500);
  respond(s, COMPLICATION.BLOWN_VEIN, RESPONSE.STOP_AND_PRESSURE, T0 + 900);
  const recs = allRecords(s);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].correct, false);
});

test("an unanswered complication is missed once its window has gone twice by", () => {
  const s = stateWith({});
  onset(s, COMPLICATION.NERVE_CONTACT, null, T0);
  const def = complicationFor(COMPLICATION.NERVE_CONTACT);
  tickComplicationState(s, 0.5, {}, T0 + def.noticeWindowS*1000);
  assert.equal(activeRecords(s).length, 1);
  tickComplicationState(s, 0.5, {}, T0 + def.noticeWindowS*2000 + 10);
  assert.equal(activeRecords(s).length, 0);
  assert.equal(allRecords(s)[0].outcome, OUTCOME.MISSED);
});

test("an unaddressed prodrome ends in an actual faint", () => {
  const s = stateWith({});
  onset(s, COMPLICATION.SYNCOPE, null, T0);
  tickComplicationState(s, 1, {}, T0 + (SYNCOPE_FAINT_AFTER_S - 2)*1000);
  assert.equal(s.fainted, false);
  tickComplicationState(s, 1, {}, T0 + (SYNCOPE_FAINT_AFTER_S + 1)*1000);
  assert.equal(s.fainted, true);
});

test("stopping and lying them back prevents the faint", () => {
  const s = stateWith({});
  onset(s, COMPLICATION.SYNCOPE, null, T0);
  respond(s, COMPLICATION.SYNCOPE, RESPONSE.RECLINE_AND_STAY, T0 + 4000);
  tickComplicationState(s, 1, {}, T0 + 60000);
  assert.equal(s.fainted, false);
});

test("a hematoma keeps growing only while its cause is still there", () => {
  const s = stateWith({});
  onset(s, COMPLICATION.HEMATOMA, null, T0);
  const start = s.condition.hematomaMl;
  tickComplicationState(s, 2, { inSkin: true, bandOn: true }, T0 + 2000);
  const leaking = s.condition.hematomaMl;
  assert.ok(leaking > start);
  respond(s, COMPLICATION.HEMATOMA, RESPONSE.STOP_AND_PRESSURE, T0 + 2100);
  tickComplicationState(s, 5, { inSkin: false, bandOn: false, pressureForce: 0.5, clotProgress: 0.5 }, T0 + 7000);
  assert.equal(Math.round(s.condition.hematomaMl*1000), Math.round(leaking*1000));
});

test("the post-draw branch's own extravasation is the bruise, not a second number", () => {
  const s = stateWith({});
  syncFromAftercare(s, 0.8);
  assert.equal(s.condition.hematomaMl, 0.8);
  syncFromAftercare(s, 0.3);   // never shrinks
  assert.equal(s.condition.hematomaMl, 0.8);
});

test("a flinch is over in a moment", () => {
  const s = stateWith({});
  onset(s, COMPLICATION.FLINCH, null, T0);
  assert.equal(s.condition.flinch, 1);
  tickComplicationState(s, 1, {}, T0 + 1000);
  assert.ok(s.condition.flinch < 0.2);
});

/* =========================================================================
   EVALUATION AND MEASUREMENT
   ========================================================================= */

test("an outstanding urgent complication blocks; nothing outstanding is clear", () => {
  const s = stateWith({});
  assert.equal(evaluateComplications(s, T0).clear, true);
  onset(s, COMPLICATION.ARTERIAL, null, T0);
  const r = evaluateComplications(s, T0 + 1000);
  assert.equal(r.clear, false);
  assert.equal(r.blocking.length, 1);
  assert.match(nextAction(s), /Arterial/);
});

test("a draw with nothing wrong scores 100 and says nothing had to be recognised", () => {
  const m = measureComplications(stateWith({}), { now: T0 + 1000 });
  assert.equal(m.score, 100);
  assert.equal(m.total, 0);
  assert.equal(m.recognitionRate, 1);
  assert.match(m.narrative, /Nothing went wrong/);
  assert.equal(m.mistakes.length, 0);
});

test("recognising and handling a complication is not punished", () => {
  const s = stateWith({});
  onset(s, COMPLICATION.VEIN_COLLAPSE, null, T0);
  respond(s, COMPLICATION.VEIN_COLLAPSE, RESPONSE.BREAK_VACUUM, T0 + 2000);
  const m = measureComplications(s, { now: T0 + 3000 });
  assert.equal(m.score, 100);
  assert.equal(m.managedCount, 1);
  assert.equal(m.mistakes.length, 0);
});

test("the wrong action and the missed one are both critical, and named", () => {
  const s = stateWith({});
  onset(s, COMPLICATION.BLOWN_VEIN, null, T0);
  respond(s, COMPLICATION.BLOWN_VEIN, RESPONSE.PROBE_AROUND, T0 + 1000);
  onset(s, COMPLICATION.SYNCOPE, null, T0 + 2000);
  miss(s, COMPLICATION.SYNCOPE, T0 + 40000);
  const m = measureComplications(s, { now: T0 + 41000 });
  assert.ok(m.criticalEvents.indexOf("probed") >= 0);
  assert.ok(m.criticalEvents.indexOf("missed") >= 0);
  assert.ok(m.score < 50);
  assert.equal(m.worsenedCount, 1);
  assert.equal(m.missedCount, 1);
});

test("a slow but correct answer costs less than a wrong one", () => {
  const def = complicationFor(COMPLICATION.DRY_STICK);
  const slow = stateWith({});
  onset(slow, COMPLICATION.DRY_STICK, null, T0);
  respond(slow, COMPLICATION.DRY_STICK, RESPONSE.ADJUST_ONCE, T0 + (def.noticeWindowS + 4)*1000);

  const wrong = stateWith({});
  onset(wrong, COMPLICATION.DRY_STICK, null, T0);
  respond(wrong, COMPLICATION.DRY_STICK, RESPONSE.PROBE_AROUND, T0 + 1000);

  assert.ok(measureComplications(slow).score > measureComplications(wrong).score);
  assert.equal(measureComplications(slow).slowCount, 1);
});

test("the size of the bruise is reported in millilitres and graded", () => {
  const s = stateWith({});
  s.condition.hematomaMl = HEMATOMA_LARGE_ML + 0.2;
  const m = measureComplications(s);
  assert.equal(m.hematomaGrade, "large");
  assert.ok(m.criticalEvents.indexOf("largeHematoma") >= 0);
});

test("the outcome folds into the procedure state's chips", () => {
  const c = {};
  const s = stateWith({});
  onset(s, COMPLICATION.FLINCH, null, T0);
  respond(s, COMPLICATION.FLINCH, RESPONSE.PAUSE_AND_REASSURE, T0 + 1000);
  applyComplicationOutcome(c, measureComplications(s));
  assert.equal(c.complicationsOk, true);
  assert.equal(c.complicationCount, 1);
  assert.ok(c.complicationMeasurements);
});
