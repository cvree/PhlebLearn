/* =========================================================================
   THREE MODES — unit tests for the pure parts.

   The mode itself lives on a module binding in game/gameState.js, which is
   browser state; what IS pure and worth pinning here is the reveal table
   (what each mode is allowed to show), the section grouping Practice's
   feedback and replay are built on, and the per-mode progress record.

   The rendering half is covered by tests/modes.e2e.spec.js.
   ========================================================================= */
import test from "node:test";
import assert from "node:assert/strict";

import { MODES, MODE_REVEAL, MODE_NAMES, normaliseMode } from "../src/game/gameState.js";
import {
  SECTIONS, sectionForStep, endsSection, firstStepIndex,
  resetFromSection, measurementField, sectionMeasurements,
  DRAW_MEASUREMENTS, isDrawMeasurement,
} from "../src/venipuncture/sections.js";
import {
  emptyModeRecord, recordFor, recordAttempt, weakestCategories, summaryLine,
} from "../src/game/modeProgress.js";
import { buildStepSequence } from "../src/venipuncture/procedureState.js";
import { MEASUREMENT_SOURCES, CATEGORIES } from "../src/venipuncture/rubric/policy.js";

/* -------------------------------------------------------------------------
   THE MODES THEMSELVES
   ------------------------------------------------------------------------- */

/**
 * The three ASSESSED modes, which is the set every claim below is about.
 * The Bench is deliberately not one of them: it is a rehearsal room, it
 * grades nothing and pays nothing, and holding it to the assessed modes'
 * rules would be asserting something the mode is not for.
 */
const ASSESSED = [MODES.LEARN, MODES.PRACTICE, MODES.FINAL];

test("there are three assessed modes plus the bench, each with a descriptor", () => {
  assert.deepEqual(Object.values(MODES).sort(), ["bench", "final", "learn", "practice"]);
  for(const m of Object.values(MODES)){
    assert.ok(MODE_REVEAL[m], `${m} has no reveal descriptor`);
    assert.ok(MODE_NAMES[m], `${m} has no display name`);
  }
});

test("the bench is a rehearsal room: hints on, nothing gated, replay allowed", () => {
  const b = MODE_REVEAL[MODES.BENCH];
  assert.equal(b.gateContinue, false, "nothing on the bench may block anything");
  assert.equal(b.repeatSections, true, "starting again is the entire mode");
  assert.equal(b.sectionFeedback, false, "the bench scores nothing, so it reports nothing");
  assert.equal(b.instruction, false, "it is rehearsal, not a lesson");
  assert.equal(b.liveNumbers, true, "you have to be able to see what your hands did");
});

test("the legacy mode names still map in, and anything unknown is the strictest", () => {
  assert.equal(normaliseMode("teach"), MODES.LEARN);
  assert.equal(normaliseMode("play"), MODES.FINAL);
  assert.equal(normaliseMode("practice"), MODES.PRACTICE);
  assert.equal(normaliseMode(undefined), MODES.FINAL);
  assert.equal(normaliseMode("nonsense"), MODES.FINAL);
});

test("the Final Practical reveals nothing: no coaching, no hints, no verdicts", () => {
  const f = MODE_REVEAL[MODES.FINAL];
  assert.equal(f.instruction, false);
  assert.equal(f.hints, false);
  assert.equal(f.verdicts, false);
  assert.equal(f.gateContinue, false);
  assert.equal(f.sectionFeedback, false);
  assert.equal(f.highlights, false);
});

test("Learn is the only ASSESSED mode that instructs, gates or highlights", () => {
  for(const m of ASSESSED){
    const r = MODE_REVEAL[m];
    const isLearn = m === MODES.LEARN;
    assert.equal(r.instruction, isLearn, `${m}.instruction`);
    assert.equal(r.gateContinue, isLearn, `${m}.gateContinue`);
    assert.equal(r.highlights, isLearn, `${m}.highlights`);
  }
  // and nothing anywhere may gate except Learn, bench included
  for(const m of Object.values(MODES)){
    if(m !== MODES.LEARN) assert.equal(MODE_REVEAL[m].gateContinue, false, `${m}.gateContinue`);
  }
});

test("Practice is the only ASSESSED mode that reports a section or replays one", () => {
  for(const m of ASSESSED){
    const isPractice = m === MODES.PRACTICE;
    assert.equal(MODE_REVEAL[m].sectionFeedback, isPractice, `${m}.sectionFeedback`);
    assert.equal(MODE_REVEAL[m].repeatSections, isPractice, `${m}.repeatSections`);
  }
  // No mode at all reports a section score except Practice — including the
  // bench, which reports nothing because it grades nothing.
  for(const m of Object.values(MODES)){
    if(m !== MODES.PRACTICE) assert.equal(MODE_REVEAL[m].sectionFeedback, false, `${m}.sectionFeedback`);
  }
});

test("Practice gives hints but no immediate answers — verdicts wait for the section", () => {
  const p = MODE_REVEAL[MODES.PRACTICE];
  assert.equal(p.hints, true);
  assert.equal(p.verdicts, false);
  assert.equal(p.instruction, false);
});

test("the three modes are genuinely distinct — no two share a reveal descriptor", () => {
  const seen = new Map();
  for(const m of Object.values(MODES)){
    const key = JSON.stringify(MODE_REVEAL[m]);
    assert.ok(!seen.has(key), `${m} reveals exactly what ${seen.get(key)} does`);
    seen.set(key, m);
  }
});

/* -------------------------------------------------------------------------
   SECTIONS
   ------------------------------------------------------------------------- */

test("every step in the procedure belongs to exactly one section", () => {
  const steps = buildStepSequence(3);
  for(const id of steps){
    const owning = SECTIONS.filter(s => s.steps.indexOf(id) >= 0);
    assert.equal(owning.length, 1, `${id} is in ${owning.length} sections`);
  }
});

test("every section's measurement keys are keys the rubric policy knows", () => {
  for(const s of SECTIONS){
    for(const key of s.measurements){
      assert.ok(MEASUREMENT_SOURCES[key], `${s.id} feeds unknown measurement ${key}`);
    }
  }
});

test("every rubric-fed measurement is produced by some section, or by the draw", () => {
  const produced = new Set(SECTIONS.flatMap(s => s.measurements));
  for(const cat of CATEGORIES){
    for(const [key] of cat.feeds){
      assert.ok(produced.has(key) || isDrawMeasurement(key),
        `${key} is graded but nothing produces it`);
    }
  }
});

test("the draw-scoped measurements are exactly the ones no section can own", () => {
  const produced = new Set(SECTIONS.flatMap(s => s.measurements));
  for(const key of DRAW_MEASUREMENTS){
    assert.ok(!produced.has(key), `${key} is claimed by a section as well as by the draw`);
  }
});

test("measurementField agrees with the rubric policy's own mapping", () => {
  for(const [key, field] of Object.entries(MEASUREMENT_SOURCES)){
    assert.equal(measurementField(key), field);
  }
});

test("a section ends when the next step belongs to a different section", () => {
  assert.equal(endsSection("introduce", "gather"), true);
  assert.equal(endsSection("gather", "tourniquet"), true);
  assert.equal(endsSection("release", "withdraw"), false);
  assert.equal(endsSection("dispose", "pressure"), true);
});

test("the last step of the draw ends its section", () => {
  assert.equal(endsSection("invert", null), true);
});

test("a one-tube draw has no switch step, and collection still ends correctly", () => {
  const steps = buildStepSequence(1);
  assert.equal(steps.indexOf("switch"), -1);
  const after = steps[steps.indexOf("fill") + 1];
  assert.equal(sectionForStep(after).id, "withdrawal");
  assert.equal(endsSection("fill", after), true);
  // ...and with two tubes the same call is NOT the end of the section
  assert.equal(endsSection("fill", "switch"), false);
});

function procedureState(tubeCount){
  const c = { step: 0, steps: buildStepSequence(tubeCount || 2) };
  for(const s of SECTIONS){
    for(const field of s.sessions) c[field] = { built: s.id };
    for(const key of s.measurements) c[measurementField(key)] = { score: 50, mistakes: [], narrative: s.id };
    for(const chip of s.chips) c[chip] = true;
  }
  c.arm = { armSide: "right" };
  return c;
}

test("repeating a section clears it and everything downstream, and rewinds", () => {
  const c = procedureState(2);
  const index = resetFromSection(c, "insert");

  assert.equal(c.steps[index], "insert");
  assert.equal(c.insert, null);
  assert.equal(c.insertMeasurements, null);
  assert.equal(c.collection, null, "downstream session survived");
  assert.equal(c.withdrawal, null);
  assert.equal(c.postDraw, null);
  assert.equal(c.inversion, null);
  assert.equal(c.insertOk, undefined, "downstream chip survived");
  assert.equal(c.mixOk, undefined);
});

test("repeating a section leaves everything upstream of it alone", () => {
  const c = procedureState(2);
  resetFromSection(c, "insert");
  assert.ok(c.supplies);
  assert.ok(c.tourniquet);
  assert.ok(c.palpation);
  assert.ok(c.cleaning);
  assert.ok(c.needleUnit);
  assert.equal(c.cleanOk, true);
});

test("repeating never rebuilds the arm — it is the same patient's limb", () => {
  const c = procedureState(2);
  const arm = c.arm;
  resetFromSection(c, "prep");
  assert.equal(c.arm, arm);
});

test("the winged set replays with insert, not with collection", () => {
  const insertSection = SECTIONS.find(s => s.id === "insert");
  assert.ok(insertSection.sessions.includes("butterfly"));
  assert.ok(insertSection.measurements.includes("butterfly"));
  assert.ok(!SECTIONS.find(s => s.id === "collection").sessions.includes("butterfly"));

  const c = procedureState(2);
  const index = resetFromSection(c, "insert");
  assert.equal(c.steps[index], "insert");
  assert.equal(c.butterfly, null);
  assert.equal(c.butterflyMeasurements, null);
  assert.equal(c.butterflyOk, undefined);
});

test("assembly and uncapping replay together, because they share one needle unit", () => {
  const equipment = SECTIONS.find(s => s.id === "equipment");
  assert.deepEqual(equipment.steps, ["assemble", "uncap"]);
  assert.deepEqual(equipment.sessions, ["needleUnit"]);
  const c = procedureState(2);
  const index = resetFromSection(c, "equipment");
  assert.equal(c.steps[index], "assemble");
  assert.equal(c.needleUnit, null);
  assert.equal(c.assemblyMeasurements, null);
  assert.equal(c.uncapMeasurements, null);
});

test("a section this draw does not contain cannot be rewound to", () => {
  const c = { step: 0, steps: ["fill"] };
  assert.equal(firstStepIndex(SECTIONS.find(s => s.id === "inversion"), c.steps), -1);
  assert.equal(resetFromSection(c, "inversion"), -1);
});

test("sectionMeasurements returns only the readings that exist", () => {
  const c = procedureState(2);
  c.uncapMeasurements = null;
  const readings = sectionMeasurements(c, SECTIONS.find(s => s.id === "equipment"));
  assert.deepEqual(readings.map(r => r.key), ["assembly"]);
});

/* -------------------------------------------------------------------------
   PER-MODE PROGRESS
   ------------------------------------------------------------------------- */

const REPORT = (total, passed) => ({
  total, maxTotal: 20, percent: total / 20, passed: !!passed,
  categories: CATEGORIES.map((c, i) => ({ id: c.id, label: c.label, score: Math.min(4, i) })),
});

test("an empty record reads safely before anything has been attempted", () => {
  const r = recordFor(undefined, MODES.FINAL);
  assert.deepEqual(r, emptyModeRecord());
  assert.equal(summaryLine(undefined, MODES.FINAL), "not attempted yet");
});

test("modes never pool: a Learn attempt does not touch the Final record", () => {
  const { progress } = recordAttempt({}, MODES.LEARN, REPORT(20, true), 1000);
  assert.equal(recordFor(progress, MODES.LEARN).attempts, 1);
  assert.equal(recordFor(progress, MODES.FINAL).attempts, 0);
  assert.equal(recordFor(progress, MODES.FINAL).bestTotal, null);
});

test("the best is kept, the last is tracked, and improvement is the delta", () => {
  let p = {};
  ({ progress: p } = recordAttempt(p, MODES.FINAL, REPORT(12, false), 1000));
  const second = recordAttempt(p, MODES.FINAL, REPORT(17, true), 2000);
  p = second.progress;
  assert.equal(second.newBest, true);
  assert.equal(second.improved, true);
  assert.equal(second.delta, 5);

  const third = recordAttempt(p, MODES.FINAL, REPORT(15, false), 3000);
  assert.equal(third.newBest, false);
  assert.equal(third.improved, false);
  assert.equal(third.delta, -2);
  const rec = recordFor(third.progress, MODES.FINAL);
  assert.equal(rec.bestTotal, 17);
  assert.equal(rec.lastTotal, 15);
  assert.equal(rec.attempts, 3);
  assert.equal(rec.passes, 1);
});

test("per-category bests are kept per row, not overwritten by a worse attempt", () => {
  let p = {};
  const strong = REPORT(20, true);
  strong.categories = [{ id: "technique", label: "T", score: 4 }, { id: "postDraw", label: "P", score: 1 }];
  ({ progress: p } = recordAttempt(p, MODES.PRACTICE, strong, 1000));
  const weak = REPORT(10, false);
  weak.categories = [{ id: "technique", label: "T", score: 2 }, { id: "postDraw", label: "P", score: 3 }];
  ({ progress: p } = recordAttempt(p, MODES.PRACTICE, weak, 2000));
  const best = recordFor(p, MODES.PRACTICE).bestByCategory;
  assert.equal(best.technique, 4);
  assert.equal(best.postDraw, 3);
});

test("history is capped, so a long-running save cannot grow without bound", () => {
  let p = {};
  for(let i = 0; i < 25; i++) ({ progress: p } = recordAttempt(p, MODES.PRACTICE, REPORT(i % 21, false), 1000 + i));
  assert.equal(recordFor(p, MODES.PRACTICE).history.length, 10);
  assert.equal(recordFor(p, MODES.PRACTICE).attempts, 25);
});

test("the weakest rows are what Practice offers to replay, weakest first", () => {
  const report = REPORT(10, false);
  report.categories = [
    { id: "a", label: "A", score: 4 }, { id: "b", label: "B", score: 1 },
    { id: "c", label: "C", score: 3 }, { id: "d", label: "D", score: 0 },
  ];
  const weak = weakestCategories({}, MODES.PRACTICE, report, 3);
  assert.deepEqual(weak.map(w => w.id), ["d", "b", "c"]);
  assert.ok(weak.every(w => w.score < 4), "a perfect row is not a weak one");
});

test("recordAttempt does not mutate the progress object it was given", () => {
  const before = {};
  const { progress } = recordAttempt(before, MODES.FINAL, REPORT(11, false), 1000);
  assert.deepEqual(before, {});
  assert.notEqual(progress, before);
});
