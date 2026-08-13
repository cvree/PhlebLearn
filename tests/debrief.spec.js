/* =========================================================================
   THE DEBRIEF — the acceptance criteria that can be asserted without a
   browser.

   The two that matter most here are the ones a screenshot would never catch:

     * the outcome line contains NO NUMBERS, because act one is supposed to be
       an emotional verdict and a digit in it turns it back into a score;
     * every technique reading carries a REAL UNIT, because "24" teaches
       nothing and "24 degrees" teaches an entry angle.
   ========================================================================= */
import { test } from "node:test";
import assert from "node:assert/strict";
import { outcomeLine, techniqueLines, headlineFix, sectionScores, buildDebrief } from "../src/game/debrief.js";

const HAS_DIGIT = /\d/;

test("act one is words, never numbers", () => {
  const cases = [
    { tubesFilled: 3, sticks: 1, flashed: true, bruised: false },
    { tubesFilled: 0, sticks: 3, flashed: false, bruised: true },
    { tubesFilled: 2, sticks: 2, flashed: true, bruised: true, fainted: true },
    { tubesFilled: 1, sticks: 1, flashed: true, bruised: false, anxious: true },
    { tubesFilled: 8, sticks: 1, flashed: true, bruised: false },
  ];
  for(const c of cases){
    const line = outcomeLine(c);
    assert.ok(!HAS_DIGIT.test(line), `act one contained a number: "${line}"`);
    assert.ok(line.length > 20 && line.endsWith("."), `not a sentence: "${line}"`);
  }
});

test("the verdict actually reflects what happened", () => {
  assert.match(outcomeLine({ tubesFilled: 3, sticks: 1, flashed: true, bruised: false }), /thank you/);
  assert.match(outcomeLine({ tubesFilled: 0, sticks: 2, flashed: false, bruised: false }), /No sample/);
  assert.match(outcomeLine({ tubesFilled: 2, sticks: 1, flashed: true, bruised: true }), /bruise coming up/);
  assert.match(outcomeLine({ tubesFilled: 1, sticks: 1, flashed: true, fainted: true }), /went grey/);
  assert.match(outcomeLine({ tubesFilled: 2, sticks: 3, flashed: true }), /three attempts/);
});

test("every technique reading carries its own unit", () => {
  const c = {
    tourniquetMeasurements: { secondsOn: 47, withinMinute: true, heightAboveSiteInches: 3.4, positionOk: true },
    cleaningMeasurements: { coveragePct: 96, dryingSeconds: 31, driedFully: true },
    insertMeasurements: { angleDeg: 24, bevelUp: true, reapproaches: 0 },
    collectionMeasurements: { totalDrawnMl: 8.2, anyUnderfilled: false, peakNeedleShiftMm: 0.4 },
    withdrawalMeasurements: { exposedSeconds: 1.2 },
    postDrawMeasurements: { effectiveSeconds: 97, requiredSeconds: 60 },
    inversionMeasurements: { tubesUsable: 3, tubesRequired: 3 },
  };
  const lines = techniqueLines(c);
  assert.ok(lines.length >= 8, `only ${lines.length} readings`);
  const UNIT = /(s|°|%|mm|mL|″|up|rolled|\d\/\d)$/;
  for(const l of lines){
    assert.ok(UNIT.test(String(l.value)), `"${l.label}: ${l.value}" has no unit`);
  }
  assert.ok(lines.some(l => l.label === "entry angle" && l.value === "24°"));
});

test("a step that never happened is absent, not reported as zero", () => {
  const lines = techniqueLines({ tourniquetMeasurements: { secondsOn: 12, withinMinute: true } });
  assert.equal(lines.length, 1);
  assert.ok(!lines.some(l => l.label === "blood collected"),
    "a draw that never collected must not report 0.0 mL as though it had");
});

test("the fix is ONE line, and it is the most severe one", () => {
  const c = {
    insertMeasurements: { mistakes: [{ severity: "note", message: "minor thing" }] },
    tourniquetMeasurements: { mistakes: [{ severity: "block", message: "the important thing" }] },
    cleaningMeasurements: { mistakes: [{ severity: "warn", message: "middling thing" }] },
  };
  assert.equal(headlineFix(c), "the important thing");
  assert.equal(headlineFix({}), null, "a clean draw gets no manufactured nitpick");
});

test("section scores omit sections the draw never produced", () => {
  const scores = sectionScores({ tourniquetMeasurements: { score: 90 } });
  assert.deepEqual(Object.keys(scores), ["tourniquet"]);
  assert.equal(scores.tourniquet, 90);
});

test("the debrief is four acts, in order, with the payout last", () => {
  const d = buildDebrief({
    collect: { insertMeasurements: { inVein: true, reapproaches: 0 } },
    patient: { archetype: "textbook" },
    specimens: { total: 3, acceptedCount: 3, rejectedCount: 0, tubes: [
      { key: "lavender", verdict: "accepted", headline: "fine", fillFraction: 1 },
    ] },
    held: { xp: 42, coins: 5 },
    elapsedMs: 240000,
  });
  assert.deepEqual(d.acts.map(a => a.id), ["patient", "lab", "technique", "rewards"]);
  assert.ok(!HAS_DIGIT.test(d.acts[0].line));
  assert.equal(d.acts[3].held.xp, 42);
  assert.equal(d.acts[1].specimens.length, 1);
});
