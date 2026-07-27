/* =========================================================================
   Unit tests for aseptic site cleaning. These assert the CLINICAL claims —
   cover the whole field, work outward, scrub rather than paint, let it dry,
   and do not touch it again — not the code that implements them.
   ========================================================================= */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FIELD_RADIUS, COVERAGE_TARGET, OUTWARD_GOOD, DRY_SECONDS, WET_SECONDS, GRID,
  cellFor, cellsInField, coverageOf, outwardFraction, dryness,
  evaluateCleaning, nextIssue, nextAction, secondsDrying,
} from "../src/venipuncture/cleaning/cleaningRules.js";
import {
  createCleaningState, openSwab, recordStroke, markRetouched, markBlotted, resetField,
} from "../src/venipuncture/cleaning/cleaningState.js";
import { measureCleaning, applyCleaningOutcome } from "../src/venipuncture/cleaning/cleaningScoring.js";

/* ---------- the field ------------------------------------------------------- */

test("the prep field is a real 5 cm circle around the puncture point", ()=>{
  assert.ok(Math.abs(FIELD_RADIUS*2 - 0.05) < 0.001);
  assert.equal(cellFor(0, 0) != null, true, "the centre is in the field");
  assert.equal(cellFor(FIELD_RADIUS*0.9, 0) != null, true);
  assert.equal(cellFor(FIELD_RADIUS*1.2, 0), null, "outside the circle is not");
});

test("coverage counts only cells inside the circle", ()=>{
  const total = cellsInField();
  assert.ok(total > 0 && total < GRID*GRID, "a circle inscribed in the grid");
  const s = createCleaningState();
  assert.equal(coverageOf(s.painted), 0);
});

/* ---------- scrubbing --------------------------------------------------------- */

/** Works an outward spiral covering `frac` of the field. */
function spiral(state, frac, friction){
  const f = frac == null ? 1 : frac;
  const fr = friction == null ? 1 : friction;
  let px = 0, pz = 0, pr = 0;
  for(let i = 1; i <= 400; i++){
    const a = (i/400)*Math.PI*2*6;
    const r = (i/400)*FIELD_RADIUS*f;
    const x = Math.cos(a)*r, z = Math.sin(a)*r;
    // paint the pad's whole contact patch, on the same conditions the runtime
    // applies: an open pad, worked with real friction
    if(state.swabOpen && fr >= 0.18){
      for(let ox = -0.006; ox <= 0.006; ox += 0.002){
        for(let oz = -0.006; oz <= 0.006; oz += 0.002){
          if(Math.hypot(ox, oz) > 0.006) continue;
          const c = cellFor(x + ox, z + oz);
          if(c != null) state.painted.add(c);
        }
      }
    }
    recordStroke(state, x, z, Math.hypot(x - px, z - pz), r - pr, fr);
    px = x; pz = z; pr = r;
  }
  return state;
}

test("a sealed pad cleans nothing", ()=>{
  const s = createCleaningState();
  spiral(s, 1);
  assert.equal(s.strokes, 0, "you cannot scrub with a pad still in its wrapper");
  assert.equal(coverageOf(s.painted), 0);
});

test("an outward spiral covers the field and reads as worked outward", ()=>{
  const s = openSwab(createCleaningState());
  spiral(s, 1);
  const r = evaluateCleaning(s);
  assert.ok(r.coverage >= COVERAGE_TARGET, `expected full coverage, got ${r.coverage}`);
  assert.ok(r.outward > OUTWARD_GOOD, `expected outward work, got ${r.outward}`);
});

test("scrubbing only the middle leaves the field short and is blocked", ()=>{
  const s = openSwab(createCleaningState());
  spiral(s, 0.45);
  const r = evaluateCleaning(s);
  assert.ok(r.coverage < COVERAGE_TARGET);
  assert.ok(r.blocking.some(i=>i.code === "underCovered"));
  assert.match(nextIssue(r).message, /whole area/i);
});

test("scrubbing back and forth warns about dragging the dirty edge inward", ()=>{
  const s = openSwab(createCleaningState());
  let px = -FIELD_RADIUS, pz = 0, pr = FIELD_RADIUS;
  for(let i = 1; i <= 300; i++){
    const x = Math.cos(i*0.35)*FIELD_RADIUS*0.95;
    const z = ((i % 16) - 8)/8*FIELD_RADIUS*0.6;
    const r = Math.hypot(x, z);
    for(let ox = -0.006; ox <= 0.006; ox += 0.002){
      for(let oz = -0.006; oz <= 0.006; oz += 0.002){
        if(Math.hypot(ox, oz) > 0.006) continue;
        const c = cellFor(x + ox, z + oz);
        if(c != null) s.painted.add(c);
      }
    }
    recordStroke(s, x, z, Math.hypot(x - px, z - pz), r - pr, 1);
    px = x; pz = z; pr = r;
  }
  const r = evaluateCleaning(s);
  assert.ok(r.outward < OUTWARD_GOOD, `expected poor outward fraction, got ${r.outward}`);
  assert.ok(r.issues.some(i=>i.code === "scrubbedInward"));
});

test("painting without friction disinfects nothing", ()=>{
  const s = openSwab(createCleaningState());
  spiral(s, 1, 0.05);
  assert.equal(coverageOf(s.painted), 0, "no friction, no disinfection");
  const r = evaluateCleaning(s);
  assert.ok(r.blocking.some(i=>i.code === "underCovered"));
  assert.ok(r.issues.some(i=>i.code === "noFriction"));
});

test("outwardFraction is a plain ratio of travel", ()=>{
  assert.equal(outwardFraction(0, 0), 0);
  assert.equal(outwardFraction(5, 10), 0.5);
  assert.equal(outwardFraction(10, 10), 1);
});

/* ---------- drying ------------------------------------------------------------ */

test("a freshly scrubbed site is wet, and puncturing it is blocked", ()=>{
  const s = openSwab(createCleaningState());
  spiral(s, 1);
  const r = evaluateCleaning(s);
  assert.equal(r.ready, false);
  assert.ok(r.blocking.some(i=>i.code === "stillWet"));
  assert.match(nextIssue(r).message, /haemolyses|wet/i);
});

test("part-dried warns; fully dried passes", ()=>{
  const s = openSwab(createCleaningState());
  spiral(s, 1);
  const t0 = s.lastStrokeAt;

  const mid = evaluateCleaning(s, t0 + 15000);
  assert.ok(mid.issues.some(i=>i.code === "notDryYet"));
  assert.equal(mid.ready, false);

  const done = evaluateCleaning(s, t0 + (DRY_SECONDS + 1)*1000);
  assert.equal(done.ready, true);
  assert.equal(done.dryness, 1);
});

test("dryness ramps over the full drying time", ()=>{
  assert.equal(dryness(0), 0);
  assert.ok(dryness(DRY_SECONDS/2) > 0 && dryness(DRY_SECONDS/2) < 1);
  assert.equal(dryness(DRY_SECONDS), 1);
  assert.ok(WET_SECONDS < DRY_SECONDS);
});

test("fanning or blotting it dry is its own mistake", ()=>{
  const s = openSwab(createCleaningState());
  spiral(s, 1);
  markBlotted(s);
  const r = evaluateCleaning(s, s.lastStrokeAt + 40000);
  assert.ok(r.issues.some(i=>i.code === "blotted"));
});

/* ---------- re-contamination ---------------------------------------------------- */

test("touching the site after cleaning undoes it", ()=>{
  const s = openSwab(createCleaningState());
  spiral(s, 1);
  markRetouched(s);
  const r = evaluateCleaning(s, s.lastStrokeAt + 40000);
  assert.equal(r.ready, false);
  assert.ok(r.blocking.some(i=>i.code === "retouched"));
});

test("re-touching an uncleaned site is not a thing", ()=>{
  const s = openSwab(createCleaningState());
  markRetouched(s);
  assert.equal(s.retouchedAfterClean, false);
});

test("starting the field over clears it completely", ()=>{
  const s = openSwab(createCleaningState());
  spiral(s, 1);
  markRetouched(s);
  resetField(s);
  assert.equal(coverageOf(s.painted), 0);
  assert.equal(s.retouchedAfterClean, false);
  assert.equal(s.swabOpen, true, "the pad is still open");
});

/* ---------- prompts -------------------------------------------------------------- */

test("the prompt names the next physical action at each stage", ()=>{
  const s = createCleaningState();
  assert.match(nextAction(s, evaluateCleaning(s)), /open the alcohol pad/i);
  openSwab(s);
  assert.match(nextAction(s, evaluateCleaning(s)), /scrub/i);
  spiral(s, 0.4);
  assert.match(nextAction(s, evaluateCleaning(s)), /widen/i);
  spiral(s, 1);
  assert.match(nextAction(s, evaluateCleaning(s)), /air-dry/i);
});

/* ---------- measurement ----------------------------------------------------------- */

test("measurements report coverage, direction and seconds", ()=>{
  const s = openSwab(createCleaningState());
  spiral(s, 1);
  const at = s.lastStrokeAt + (DRY_SECONDS + 2)*1000;
  const m = measureCleaning(s, evaluateCleaning(s, at), at);
  assert.ok(m.coveragePct >= 80);
  assert.ok(m.outwardPct > 60);
  assert.equal(m.driedFully, true);
  assert.ok(m.dryingSeconds >= DRY_SECONDS);
  assert.equal(m.fieldRadiusMm, 25);
  assert.ok(m.score >= 90, `a clean prep should score high, got ${m.score}`);
});

test("re-touching is the heaviest single deduction", ()=>{
  const s = openSwab(createCleaningState());
  spiral(s, 1);
  const at = s.lastStrokeAt + 40000;
  const clean = measureCleaning(s, evaluateCleaning(s, at), at).score;
  markRetouched(s);
  const dirty = measureCleaning(s, evaluateCleaning(s, at), at).score;
  assert.ok(dirty < clean - 25, "touching it again undoes the whole prep");
});

test("puncturing wet costs, and is named", ()=>{
  const s = openSwab(createCleaningState());
  spiral(s, 1);
  const at = s.lastStrokeAt + 2000;
  const m = measureCleaning(s, evaluateCleaning(s, at), at);
  assert.equal(m.driedFully, false);
  assert.ok(m.mistakes.some(x=>x.code === "notDry"));
  m.mistakes.forEach(x=>assert.ok(x.message.length > 20));
});

test("the narrative reads as technique feedback, not a score", ()=>{
  const s = openSwab(createCleaningState());
  spiral(s, 1);
  const at = s.lastStrokeAt + 40000;
  const m = measureCleaning(s, evaluateCleaning(s, at), at);
  assert.match(m.narrative, /% of the prep field/);
  assert.match(m.narrative, /outward/);
  assert.doesNotMatch(m.narrative, /\d+\/100/);
});

test("a site never cleaned says so and scores accordingly", ()=>{
  const s = createCleaningState();
  const m = measureCleaning(s, evaluateCleaning(s), s.lastStrokeAt);
  assert.equal(m.coveragePct, 0);
  assert.match(m.narrative, /never cleaned/i);
  assert.ok(m.score <= 40);
});

test("the outcome feeds the encounter's clean chip honestly", ()=>{
  const good = openSwab(createCleaningState());
  spiral(good, 1);
  const at = good.lastStrokeAt + 40000;
  const c1 = {};
  applyCleaningOutcome(c1, measureCleaning(good, evaluateCleaning(good, at), at));
  assert.equal(c1.cleanOk, true);

  const wet = openSwab(createCleaningState());
  spiral(wet, 1);
  const soon = wet.lastStrokeAt + 3000;
  const c2 = {};
  applyCleaningOutcome(c2, measureCleaning(wet, evaluateCleaning(wet, soon), soon));
  assert.equal(c2.cleanOk, false, "covered, but punctured through wet alcohol");
});
