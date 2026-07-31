/* =========================================================================
   RUBRIC — unit tests for the grading layer.

   Three kinds of test here, and the first is the important one:

     1. BINDING tests. The policy names measurement fields by string. A typo
        would silently block every Excellent rather than throwing, so these
        build each measurement object from the REAL step modules and assert
        every field the policy references actually exists on it.

     2. BEHAVIOUR tests, on synthetic measurements, for banding, the
        excellence gates, critical events, automatic failure, the pass rule,
        and the practice plan's ordering.

     3. The two guarantees the brief calls out by name: an honest 4 must be
        reachable through excellent technique, and above-and-beyond
        observations must never add score.

   No DOM, no THREE.
   ========================================================================= */
import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_POLICY, CATEGORIES, BANDS, MEASUREMENT_SOURCES, bandFor, criticalEventFor,
} from "../src/venipuncture/rubric/policy.js";
import {
  collectMeasurements, scoreCategory, scoreAllCategories,
  mistakesFor, criticalEventsFor, categoryMean, commendationsFor,
} from "../src/venipuncture/rubric/rubricRules.js";
import {
  buildRubricReport, describeProcedure, specimenResults, patientOutcomes, practicePlan,
} from "../src/venipuncture/rubric/rubricReport.js";

/* -------------------------------------------------------------------------
   1. BINDING — the policy's field names against the real measurements
   ------------------------------------------------------------------------- */

import { buildSupplyCatalog } from "../src/venipuncture/staging/supplyCatalog.js";
import { createStagingState } from "../src/venipuncture/staging/stagingState.js";
import { evaluateStaging } from "../src/venipuncture/staging/stagingRules.js";
import { measureStaging } from "../src/venipuncture/staging/stagingScoring.js";

import { buildVessels } from "../src/venipuncture/arm/armAnatomy.js";
import { createTourniquetState } from "../src/venipuncture/tourniquet/tourniquetState.js";
import { evaluateTourniquet } from "../src/venipuncture/tourniquet/tourniquetRules.js";
import { measureTourniquet } from "../src/venipuncture/tourniquet/tourniquetScoring.js";

import { createPalpationState } from "../src/venipuncture/palpation/palpationState.js";
import { evaluatePalpation } from "../src/venipuncture/palpation/palpationRules.js";
import { measurePalpation } from "../src/venipuncture/palpation/palpationScoring.js";

import { createCleaningState } from "../src/venipuncture/cleaning/cleaningState.js";
import { evaluateCleaning } from "../src/venipuncture/cleaning/cleaningRules.js";
import { measureCleaning } from "../src/venipuncture/cleaning/cleaningScoring.js";

import { createAssemblyState } from "../src/venipuncture/assembly/assemblyState.js";
import { evaluateAssembly, evaluateUncap } from "../src/venipuncture/assembly/assemblyRules.js";
import { measureAssembly, measureUncap } from "../src/venipuncture/assembly/assemblyScoring.js";

import { createInsertState } from "../src/venipuncture/insert/insertState.js";
import { evaluateInsert } from "../src/venipuncture/insert/insertRules.js";
import { measureInsert } from "../src/venipuncture/insert/insertScoring.js";

import { createCollectionState } from "../src/venipuncture/collection/collectionState.js";
import { evaluateCollection } from "../src/venipuncture/collection/collectionRules.js";
import { measureCollection } from "../src/venipuncture/collection/collectionScoring.js";

import { createWithdrawalState } from "../src/venipuncture/withdrawal/withdrawalState.js";
import { evaluateWithdrawal } from "../src/venipuncture/withdrawal/withdrawalRules.js";
import { measureWithdrawal } from "../src/venipuncture/withdrawal/withdrawalScoring.js";

import { createPostDrawState } from "../src/venipuncture/postdraw/postDrawState.js";
import { evaluatePostDraw } from "../src/venipuncture/postdraw/postDrawRules.js";
import { measurePostDraw } from "../src/venipuncture/postdraw/postDrawScoring.js";

import { createInversionState } from "../src/venipuncture/inversion/inversionState.js";
import { evaluateInversion } from "../src/venipuncture/inversion/inversionRules.js";
import { measureInversion } from "../src/venipuncture/inversion/inversionScoring.js";

import { createIntroductionState } from "../src/venipuncture/introduction/introductionState.js";
import { evaluateIntroduction } from "../src/venipuncture/introduction/introductionRules.js";
import { measureIntroduction } from "../src/venipuncture/introduction/introductionScoring.js";

import {
  createButterflyState, pickUpByWings, layWingsFlat, secureWings, enter as enterButterfly,
} from "../src/venipuncture/butterfly/butterflyState.js";
import { evaluateButterfly } from "../src/venipuncture/butterfly/butterflyRules.js";
import { measureButterfly } from "../src/venipuncture/butterfly/butterflyScoring.js";

const VESSELS = buildVessels();
const VEIN = { id: "median-cubital", calibre: 0.0034, depth: 0.0035 };
const ORDER = ["lightblue", "lavender"];

/** One real measurement object per key, built from an untouched state. */
function realMeasurements(){
  const catalog = buildSupplyCatalog({ requiredTubes: ORDER, patientName: "A Patient", otherPatientName: "B Other" });
  const staging = createStagingState({ catalog, requiredTubes: ORDER, handedness: "right", now: 0 });

  const tq = createTourniquetState({});
  const pal = createPalpationState();
  const cl = createCleaningState();
  const asm = createAssemblyState({});
  const ins = createInsertState({ chosenId: "median-cubital" });
  const col = createCollectionState({ order: ORDER, vessel: VEIN });
  const wd = createWithdrawalState({ vessel: VEIN });
  const pd = createPostDrawState({ vessel: VEIN, withdrawnAt: 1000, now: 1000 });
  const inv = createInversionState({ order: ORDER, now: 1000 });
  const intro = createIntroductionState({
    patient: { name: "A Patient", dob: "01/01/1970", id: "AP1", history: {} }, now: 1000,
  });
  const bf = createButterflyState({ calibreM: 0.0020, now: 1000 });
  pickUpByWings(bf); enterButterfly(bf, 10, { now: 1000 }); layWingsFlat(bf); secureWings(bf, { now: 1000 });

  return {
    introduction: measureIntroduction(intro, evaluateIntroduction(intro), { now: 1000 }),
    butterfly: measureButterfly(bf, evaluateButterfly(bf, {}), { now: 1000 }),
    supplyStaging: measureStaging(staging, catalog, evaluateStaging(staging, catalog), 1000),
    tourniquet: measureTourniquet(tq, evaluateTourniquet(tq, { vessels: VESSELS, vigour: 1 }, 1000), 1000),
    palpation: measurePalpation(pal, evaluatePalpation(pal, VESSELS), VESSELS),
    cleaning: measureCleaning(cl, evaluateCleaning(cl, 1000), 1000),
    assembly: measureAssembly(asm, evaluateAssembly(asm), 1000),
    uncap: measureUncap(asm, evaluateUncap(asm, 1000), 1000),
    insert: measureInsert(ins, evaluateInsert(ins, VESSELS, 0), 0, 1000),
    collection: measureCollection(col, evaluateCollection(col, {}), { now: 1000 }),
    withdrawal: measureWithdrawal(wd, evaluateWithdrawal(wd, {}), { now: 1000 }),
    postDraw: measurePostDraw(pd, evaluatePostDraw(pd, { now: 1000 }), { now: 1000 }),
    inversion: measureInversion(inv, evaluateInversion(inv), { now: 1000 }),
  };
}

test("every measurement key the policy feeds from has a real source and a real object", () => {
  const real = realMeasurements();
  for(const cat of CATEGORIES){
    for(const [key] of cat.feeds){
      assert.ok(MEASUREMENT_SOURCES[key], `${key} has no procedure-state source`);
      assert.ok(real[key], `${key} produced no measurement object`);
    }
  }
});

test("every sequence field the policy names exists on the real measurement", () => {
  const real = realMeasurements();
  for(const cat of CATEGORIES){
    for(const check of (cat.excellence.sequence || [])){
      assert.notEqual(real[check.key][check.field], undefined,
        `${cat.id}: ${check.key}.${check.field} does not exist on the measurement`);
    }
  }
});

test("every tolerance field the policy names exists on the real measurement", () => {
  const real = realMeasurements();
  for(const cat of CATEGORIES){
    for(const range of (cat.excellence.ranges || [])){
      assert.notEqual(real[range.key][range.field], undefined,
        `${cat.id}: ${range.key}.${range.field} does not exist on the measurement`);
      assert.ok(range.min <= range.max, `${range.key}.${range.field} has an inverted range`);
    }
  }
});

test("every commendation field the policy names exists on the real measurement", () => {
  const real = realMeasurements();
  for(const c of DEFAULT_POLICY.commendations){
    assert.notEqual(real[c.key][c.field], undefined, `${c.key}.${c.field} does not exist`);
  }
});

test("every measurement carries a score, a mistakes array and a narrative", () => {
  const real = realMeasurements();
  for(const [key, m] of Object.entries(real)){
    assert.equal(typeof m.score, "number", `${key}.score`);
    assert.ok(Array.isArray(m.mistakes), `${key}.mistakes`);
    assert.equal(typeof m.narrative, "string", `${key}.narrative`);
  }
});

test("collectMeasurements reads the same fields the step scorers write", () => {
  const c = { stagingMeasurements: { score: 50 }, insertMeasurements: { score: 90 } };
  const m = collectMeasurements(c);
  assert.equal(m.supplyStaging.score, 50);
  assert.equal(m.insert.score, 90);
  assert.equal(m.inversion, null);
});

/* -------------------------------------------------------------------------
   2. BEHAVIOUR — synthetic measurements, exact expectations
   ------------------------------------------------------------------------- */

/** A measurement that is flawless on every field the policy looks at. */
const PERFECT = {
  introduction: {
    score: 100, mistakes: [], narrative: "intro",
    identifiedBeforeTouching: true, gloveAfterHygiene: true, handHygieneSeconds: 24,
  },
  tourniquet: {
    score: 100, mistakes: [], narrative: "tq",
    secondsOn: 42, heightAboveSiteInches: 3.4,
  },
  palpation: {
    score: 100, mistakes: [], narrative: "palp",
    feltChosen: true, structuresFelt: 5, arteryRecognised: true, hurtPatient: false,
  },
  cleaning: {
    score: 100, mistakes: [], narrative: "clean",
    retouched: false, coveragePct: 96, dryingSeconds: 34,
  },
  supplyStaging: {
    score: 100, mistakes: [], narrative: "stage",
    ready: true, inspectionRate: 1, trayUsableWithoutCrossing: true,
  },
  assembly: { score: 100, mistakes: [], narrative: "asm", turns: 2.2 },
  uncap: {
    score: 100, mistakes: [], narrative: "uncap",
    recapped: false, axialPct: 98, bevelDeg: 2, bevelInspected: true,
  },
  insert: {
    score: 100, mistakes: [], narrative: "insert",
    anchored: true, angleDeg: 22, reapproaches: 0, throughAndThrough: false,
    patientWarned: true,
  },
  collection: {
    score: 100, mistakes: [], narrative: "collect",
    orderAccuracy: 1, peakNeedleShiftMm: 0.3,
    tubes: [{ key: "lavender", name: "Lavender", drawnMl: 4, volumeMl: 4, fillPercent: 100, requiredPercent: 90, collected: true, ratioValid: true, carryoverFrom: null }],
  },
  withdrawal: {
    score: 100, mistakes: [], narrative: "withdraw", device: "straight",
    exitDeviationDeg: 2, releasedBeforeWithdraw: true, exposedSeconds: 1.1,
  },
  postDraw: {
    score: 100, mistakes: [], narrative: "postdraw", siteKind: "antecubital",
    bandagedWhileBleeding: false, timeToPressureS: 1.2, consistencyPercent: 92,
    bandageAlignMm: 1.5, hematomaGrade: "none", extravasatedMl: 0.01,
    discomfortSeconds: 0, haemostatic: true, aftercareGiven: true,
  },
  inversion: {
    score: 100, mistakes: [], narrative: "invert", clottedCount: 0,
    tubes: [{ key: "lavender", name: "Lavender", inversions: 8, required: 8, haemolysisGrade: "none", delaySeconds: 2, racked: true, usable: true, reason: null }],
  },
  butterfly: {
    score: 100, mistakes: [], narrative: "butterfly", device: "butterfly",
    entryAngleDeg: 10, carriedByWings: true, wingsLaidFlat: true, wingsSecured: true,
    tubingSlackMm: 30, tubingTaut: false, disturbancesTransmitted: 0, disturbancesWhileLoose: 0,
    peakTipOffsetMm: 0, infiltratedMl: 0, infiltrationNoticed: false, secondsToNotice: null,
    stoppedOnInfiltration: false,
  },
};

function perfect(overrides){
  const out = {};
  for(const key of Object.keys(MEASUREMENT_SOURCES)){
    out[key] = PERFECT[key] ? Object.assign({}, PERFECT[key]) : null;
  }
  for(const [key, patch] of Object.entries(overrides || {})){
    out[key] = patch === null ? null : Object.assign({}, out[key], patch);
  }
  return out;
}

const catById = id => CATEGORIES.find(c => c.id === id);

test("bands are ordered high to low and bandFor picks the highest satisfied", () => {
  for(let i = 1; i < BANDS.length; i++) assert.ok(BANDS[i].min < BANDS[i - 1].min);
  assert.equal(bandFor(100).score, 4);
  assert.equal(bandFor(90).score, 4);
  assert.equal(bandFor(89.9).score, 3);
  assert.equal(bandFor(0).score, 0);
});

test("a flawless row scores 4 — an honest Excellent is reachable", () => {
  const r = scoreCategory(catById("technique"), perfect());
  assert.equal(r.score, 4);
  assert.equal(r.band.label, "Excellent");
  assert.deepEqual(r.preventedExcellence, []);
});

test("technically completed is not automatically 4 — one warning costs the top band", () => {
  const m = perfect({ insert: { mistakes: [{ code: "reapproached", message: "Re-approached once." }] } });
  const r = scoreCategory(catById("technique"), m);
  assert.equal(r.score, 3);
  assert.ok(r.preventedExcellence.some(g => g.reason === "warnings"));
});

test("a measured deviation is reported with the number and the configured range", () => {
  const m = perfect({ insert: { angleDeg: 34 } });
  const r = scoreCategory(catById("technique"), m);
  assert.equal(r.score, 3);
  const tol = r.preventedExcellence.find(g => g.reason === "tolerance");
  assert.ok(tol, "expected a tolerance gate");
  assert.equal(tol.value, 34);
  assert.match(tol.detail, /34°/);
  assert.match(tol.detail, /above/);
  assert.match(tol.detail, /15°–30°/);
  // never vague
  assert.doesNotMatch(tol.detail, /careful|try to|better/i);
});

test("out of sequence costs the top band and names the sequence", () => {
  const m = perfect({ withdrawal: { releasedBeforeWithdraw: false } });
  const r = scoreCategory(catById("postDraw"), m);
  assert.equal(r.score, 3);
  assert.ok(r.preventedExcellence.some(g => g.reason === "sequence" && /band came off before the needle/.test(g.detail)));
});

test("an incomplete row cannot be excellent and says which key is missing", () => {
  const m = perfect({ inversion: null });
  const r = scoreCategory(catById("postDraw"), m);
  assert.ok(r.score < 4);
  assert.deepEqual(r.missing, ["inversion"]);
  assert.ok(r.preventedExcellence.some(g => g.reason === "incomplete" && /inversion/.test(g.detail)));
});

test("a coached correction costs the top band — Excellent is unaided work", () => {
  const r = scoreCategory(catById("technique"), perfect(), DEFAULT_POLICY, { assists: { technique: 2 } });
  assert.equal(r.score, 3);
  assert.ok(r.preventedExcellence.some(g => g.reason === "assisted" && g.count === 2));
});

test("gates never push a row below what its measurements already scored", () => {
  const m = perfect({
    insert: { score: 40, mistakes: [{ code: "missed", message: "Missed." }] },
    collection: { score: 40 }, withdrawal: { score: 40 },
  });
  const r = scoreCategory(catById("technique"), m);
  assert.equal(r.ceiling, 1);
  assert.equal(r.score, 1);
});

test("a missing measurement scores zero for the row rather than being skipped", () => {
  const m = perfect({ cleaning: null });
  const mean = categoryMean(catById("preparation"), m);
  assert.equal(Math.round(mean), 67);
});

test("weights are relative within a row, not absolute", () => {
  const m = perfect({ insert: { score: 0 }, collection: { score: 100 }, withdrawal: { score: 100 } });
  const mean = categoryMean(catById("technique"), m);
  // insert carries 1.25 of the 3.0 total weight
  assert.equal(Math.round(mean), Math.round(175 / 3 * 100 / 100));
});

/* ---------- critical events and automatic failure ---------------------------- */

test("a policy-listed code is a critical event even when the step did not flag it", () => {
  const m = perfect({ insert: { mistakes: [{ code: "throughAndThrough", message: "Through the far wall." }] } });
  const events = criticalEventsFor(catById("technique"), m);
  assert.equal(events.length, 1);
  assert.equal(events[0].qualified, "insert.throughAndThrough");
  assert.equal(events[0].automaticFailure, false);
  assert.equal(events[0].unclassified, false);
});

test("a step-flagged critical code the policy has not classified is still surfaced", () => {
  const m = perfect({ postDraw: { mistakes: [{ code: "someNewHazard", message: "New.", critical: true }] } });
  const events = criticalEventsFor(catById("postDraw"), m);
  assert.equal(events.length, 1);
  assert.equal(events[0].unclassified, true);
  assert.equal(events[0].automaticFailure, false);
});

test("codes are qualified by measurement key, so two modules can share a code", () => {
  assert.equal(criticalEventFor("withdrawal", "recapAttempted").automaticFailure, true);
  assert.equal(criticalEventFor("uncap", "recapAttempted"), null);
});

test("an automatic-failure event fails the practical whatever the points say", () => {
  const c = {};
  for(const [key, field] of Object.entries(MEASUREMENT_SOURCES)) c[field] = perfect()[key];
  c.withdrawalMeasurements = Object.assign({}, PERFECT.withdrawal, {
    mistakes: [{ code: "recapAttempted", critical: true, message: "Recapped by hand." }],
  });
  const report = buildRubricReport(c);
  assert.equal(report.passed, false);
  assert.equal(report.automaticFailures.length, 1);
  assert.ok(report.failedBy.some(f => f.reason === "automaticFailure"));
});

test("a flawless attempt passes with full marks — the top of the rubric is reachable", () => {
  const c = {};
  for(const [key, field] of Object.entries(MEASUREMENT_SOURCES)) c[field] = perfect()[key];
  const report = buildRubricReport(c);
  assert.equal(report.total, report.maxTotal);
  assert.equal(report.passed, true);
  assert.deepEqual(report.failedBy, []);
  assert.ok(report.categories.every(x => x.score === 4));
});

test("one abandoned row fails the practical even when the average would pass", () => {
  const c = {};
  const m = perfect({ introduction: null });
  for(const [key, field] of Object.entries(MEASUREMENT_SOURCES)) c[field] = m[key];
  const report = buildRubricReport(c);
  assert.equal(report.categories.find(x => x.id === "introduction").score, 0);
  // 16/20 is 80% — exactly the pass mark — so only the per-row floor fails it
  assert.equal(report.percent, 0.8);
  assert.ok(report.failedBy.some(f => f.reason === "categoryFloor"));
  assert.ok(!report.failedBy.some(f => f.reason === "belowPassMark"));
  assert.equal(report.passed, false);
});

/* ---------- no hidden bonus points -------------------------------------------- */

test("above-and-beyond observations justify a 4 but never add score", () => {
  const bare = perfect({ palpation: { structuresFelt: 1, arteryRecognised: false } });
  const rich = perfect();   // 5 structures felt, artery recognised
  const a = scoreCategory(catById("preparation"), bare);
  const b = scoreCategory(catById("preparation"), rich);
  assert.equal(a.score, b.score);
  assert.equal(a.mean, b.mean);
  assert.equal(a.commendations.length, 0);
  assert.ok(b.commendations.length >= 2);
});

test("commendations only report on measurements that are present", () => {
  assert.deepEqual(commendationsFor(catById("preparation"), perfect({ palpation: null })), []);
});

test("the total is exactly the sum of the category scores — nothing else contributes", () => {
  const c = {};
  for(const [key, field] of Object.entries(MEASUREMENT_SOURCES)) c[field] = perfect()[key];
  const report = buildRubricReport(c);
  assert.equal(report.total, report.categories.reduce((s, x) => s + x.score, 0));
  assert.equal(report.maxTotal, report.categories.length * 4);
});

/* -------------------------------------------------------------------------
   3. THE REPORT
   ------------------------------------------------------------------------- */

function reportFrom(overrides){
  const m = perfect(overrides);
  const c = {};
  for(const [key, field] of Object.entries(MEASUREMENT_SOURCES)) c[field] = m[key];
  return buildRubricReport(c);
}

test("the procedure is described from what was used, not from a flag", () => {
  assert.match(describeProcedure(perfect()).label, /Straight multisample needle, antecubital fossa/);
  const butterfly = describeProcedure(perfect({
    withdrawal: { device: "butterfly" }, postDraw: { siteKind: "hand" },
  }));
  assert.match(butterfly.label, /Butterfly \(winged\) set, dorsal hand/);
});

test("specimen results merge what collection drew with what mixing did to it", () => {
  const s = specimenResults(perfect({
    inversion: { tubes: [{ key: "lavender", name: "Lavender", inversions: 2, required: 8, haemolysisGrade: "none", delaySeconds: 3, racked: true, usable: false, reason: "underMixed" }] },
  }));
  assert.equal(s.total, 1);
  assert.equal(s.usableCount, 0);
  assert.equal(s.redrawRequired, true);
  assert.equal(s.tubes[0].drawnMl, 4);        // from collection
  assert.equal(s.tubes[0].inversions, 2);     // from inversion
  assert.equal(s.rejectedReasons[0].reason, "underMixed");
});

test("a tube never collected can never be rescued by the mixing verdict", () => {
  const s = specimenResults(perfect({
    collection: { tubes: [{ key: "lavender", name: "Lavender", drawnMl: 0, volumeMl: 4, fillPercent: 0, requiredPercent: 90, collected: false, ratioValid: false, carryoverFrom: null }] },
    inversion: { tubes: [{ key: "lavender", name: "Lavender", inversions: 8, required: 8, haemolysisGrade: "none", usable: true, reason: null }] },
  }));
  assert.equal(s.tubes[0].usable, false);
});

test("patient outcomes are reported separately from the score", () => {
  const out = patientOutcomes(perfect({
    insert: { reapproaches: 2 },
    postDraw: { hematomaGrade: "hematoma", extravasatedMl: 1.4 },
  }));
  assert.ok(out.some(o => o.code === "sticks" && /3 skin punctures/.test(o.text)));
  assert.ok(out.some(o => o.code === "hematoma" && /1.4 mL/.test(o.text)));
});

test("the practice plan puts automatic failures first and tolerances last", () => {
  const report = reportFrom({
    withdrawal: { mistakes: [{ code: "trashAttempted", critical: true, message: "Sharp into the bin." }] },
    insert: { angleDeg: 34 },
  });
  const plan = report.practicePlan;
  assert.equal(plan[0].priority, 1);
  assert.match(plan[0].action, /normal waste/);
  assert.ok(plan.every((p, i) => i === 0 || p.priority >= plan[i - 1].priority));
  assert.ok(plan.some(p => p.priority === 4 && /34°/.test(p.why)));
});

test("the report never says 'be more careful' — every plan entry cites a measurement", () => {
  const report = reportFrom({ insert: { angleDeg: 34 }, cleaning: { coveragePct: 71, score: 62 } });
  for(const item of report.practicePlan){
    assert.equal(typeof item.why, "string");
    assert.ok(item.why.length > 0);
    assert.doesNotMatch(item.why, /\bbe more careful\b|\btry harder\b/i);
  }
});

test("strongest actions name the row and quote its own narrative", () => {
  const report = reportFrom({
    introduction: { score: 85 }, tourniquet: { score: 70 },
    supplyStaging: { score: 70 }, inversion: { score: 70 },
  });
  assert.ok(report.strongest.length > 0);
  assert.equal(report.strongest[0].category, "technique");
  const row = report.strongest.find(s => s.category === "technique" && !s.commendation);
  assert.ok(row, "expected the technique row among the strongest");
  assert.match(row.text, /Excellent/);
  // commendations ride alongside the rows; they are labelled, not scored
  assert.ok(report.strongest.some(s => s.commendation && s.score === null));
});

test("the report is serialisable — it is data, not a view", () => {
  const report = reportFrom();
  const round = JSON.parse(JSON.stringify(report));
  assert.equal(round.total, report.total);
  assert.equal(round.categories.length, CATEGORIES.length);
});

test("a policy passed in is the one used — nothing reads the module binding", () => {
  const strict = JSON.parse(JSON.stringify(DEFAULT_POLICY));
  strict.bands = strict.bands.map(b => (b.score === 4 ? Object.assign({}, b, { min: 101 }) : b));
  const r = scoreCategory(catById("technique"), perfect(), strict);
  assert.equal(r.score, 3);
  assert.ok(r.preventedExcellence.some(g => g.reason === "measured" && /101/.test(g.detail)));
});

test("scoreAllCategories returns one row per policy category, in policy order", () => {
  const rows = scoreAllCategories(perfect());
  assert.deepEqual(rows.map(r => r.id), CATEGORIES.map(c => c.id));
});

test("mistakesFor tags each mistake with the measurement it came from", () => {
  const m = perfect({
    tourniquet: { mistakes: [{ code: "overTime", message: "70s." }] },
    cleaning: { mistakes: [{ code: "notDry", message: "Wet." }] },
  });
  const all = mistakesFor(catById("preparation"), m);
  assert.deepEqual(all.map(x => x.key), ["tourniquet", "cleaning"]);
});

/* =========================================================================
   PROCEDURE-AWARE FEEDS — the winged set's `butterfly` feed only applies to
   a butterfly-hand attempt, and the antecubital angle window only applies
   to attempts that are NOT one. Two independent, deliberately asymmetric
   knobs: `proceduresOnly` (opt IN, excluded when the procedure is unknown)
   for anything brand new, `excludeProcedures` (opt OUT, included when the
   procedure is unknown) for anything that used to be unconditional.
   ========================================================================= */
import { activeFeeds } from "../src/venipuncture/rubric/rubricRules.js";

const BUTTERFLY_CTX = { procedureId: "butterfly-hand" };
const STRAIGHT_CTX = { procedureId: "straight-antecubital" };

test("activeFeeds excludes a proceduresOnly feed when the procedure is unknown", () => {
  const feeds = activeFeeds(catById("technique"), undefined);
  assert.ok(!feeds.some(([k]) => k === "butterfly"));
});

test("activeFeeds includes the butterfly feed only for a butterfly-hand context", () => {
  assert.ok(activeFeeds(catById("technique"), BUTTERFLY_CTX).some(([k]) => k === "butterfly"));
  assert.ok(!activeFeeds(catById("technique"), STRAIGHT_CTX).some(([k]) => k === "butterfly"));
});

test("a straight attempt's technique mean is identical with or without a context", () => {
  const m = perfect();
  const noContext = scoreCategory(catById("technique"), m);
  const withContext = scoreCategory(catById("technique"), m, DEFAULT_POLICY, STRAIGHT_CTX);
  assert.equal(noContext.mean, withContext.mean);
  assert.deepEqual(noContext.present, withContext.present);
});

test("a butterfly attempt's technique row includes the winged-set feed and scores it", () => {
  const m = perfect({
    withdrawal: { device: "butterfly" }, postDraw: { siteKind: "hand" },
    insert: { angleDeg: 10 },   // inside the hand window, outside the antecubital one
  });
  const row = scoreCategory(catById("technique"), m, DEFAULT_POLICY, BUTTERFLY_CTX);
  assert.ok(row.present.includes("butterfly"));
  assert.equal(row.score, 4);
});

test("the antecubital angle range fires for an unlabelled attempt but not for a butterfly one", () => {
  const m = perfect({ insert: { angleDeg: 10 } });   // wrong for antecubital, right for a hand draw
  const straight = scoreCategory(catById("technique"), m);
  const butterfly = scoreCategory(catById("technique"), m, DEFAULT_POLICY, BUTTERFLY_CTX);
  assert.ok(straight.score < 4);
  assert.ok(straight.preventedExcellence.some(g => g.reason === "tolerance" && /entry angle/i.test(g.detail)));
  assert.equal(butterfly.score, 4);
});

test("a straight attempt is never docked for missing the butterfly measurement", () => {
  const m = perfect();       // m.butterfly is populated by the fixture, but no context names the procedure
  assert.equal(m.butterfly.score, 100);
  const row = scoreCategory(catById("technique"), m);   // no context: butterfly feed excluded
  assert.equal(row.score, 4);
  assert.ok(!row.missing.includes("butterfly"));
});

test("a butterfly attempt IS docked for a missing butterfly measurement, requireAll included", () => {
  const m = perfect({ butterfly: null, withdrawal: { device: "butterfly" }, postDraw: { siteKind: "hand" } });
  const row = scoreCategory(catById("technique"), m, DEFAULT_POLICY, BUTTERFLY_CTX);
  assert.ok(row.missing.includes("butterfly"));
  assert.ok(row.score < 4);
});

test("carrying the set by tubing, or leaving the wings pinched, blocks a butterfly Excellent", () => {
  const pinched = perfect({
    withdrawal: { device: "butterfly" }, postDraw: { siteKind: "hand" },
    insert: { angleDeg: 10 },
    butterfly: { carriedByWings: false },
  });
  const row = scoreCategory(catById("technique"), pinched, DEFAULT_POLICY, BUTTERFLY_CTX);
  assert.ok(row.score < 4);
  assert.ok(row.preventedExcellence.some(g => g.reason === "sequence" && /wings, not its tubing/.test(g.detail)));
});

test("buildRubricReport derives the procedure straight off the attempt — no context needed", () => {
  const c = {};
  for(const [key, field] of Object.entries(MEASUREMENT_SOURCES)) c[field] = perfect({
    withdrawal: { device: "butterfly" }, postDraw: { siteKind: "hand" }, insert: { angleDeg: 10 },
  })[key];
  c.procedureId = "butterfly-hand";
  const report = buildRubricReport(c);
  const technique = report.categories.find(x => x.id === "technique");
  assert.ok(technique.present.includes("butterfly"));
  assert.match(report.procedure.label, /Butterfly/);
});

test("an explicit context.procedureId overrides the one read off the attempt", () => {
  const c = {};
  for(const [key, field] of Object.entries(MEASUREMENT_SOURCES)) c[field] = perfect()[key];
  c.procedureId = "butterfly-hand";
  const report = buildRubricReport(c, { context: { procedureId: "straight-antecubital" } });
  const technique = report.categories.find(x => x.id === "technique");
  assert.ok(!technique.present.includes("butterfly"));
});

test("the butterfly critical-event codes are wired into the policy", () => {
  for(const code of ["carriedByTubing", "tubingTaut", "infiltrationMissed", "infiltrationNotActedOn"]){
    assert.ok(criticalEventFor("butterfly", code), `butterfly.${code} is not in CRITICAL_EVENTS`);
  }
  assert.equal(criticalEventFor("butterfly", "carriedByTubing").automaticFailure, true);
  assert.equal(criticalEventFor("butterfly", "infiltrationMissed").automaticFailure, true);
});
