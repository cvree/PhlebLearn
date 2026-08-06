/* =========================================================================
   SPECIMEN QUALITY — unit tests.

   These assert the thing no single step can assert: that the tube arriving at
   the laboratory is judged on everything that happened to it, from the gauge
   it was drawn through to how it was mixed, and that a rejection names what
   the patient has lost.
   ========================================================================= */
import test from "node:test";
import assert from "node:assert/strict";

import {
  VERDICT, assessTube, assessSpecimens, summariseSpecimens,
  drawHaemolysis, haemoconcentration, testsOnTube,
  HAEMOCONCENTRATION_AFTER_S, HAEMOCONCENTRATION_BAD_S, applySpecimenOutcome,
} from "../src/venipuncture/specimen/specimenQuality.js";
import { requiredFraction } from "../src/venipuncture/collection/collectionRules.js";
import { inversionsFor } from "../src/venipuncture/inversion/inversionRules.js";

/** A tube that was drawn and mixed perfectly, so each test changes one thing. */
function perfect(key, o){
  return Object.assign({
    key,
    drawnMl: 4, volumeMl: 4,
    inversions: inversionsFor(key).ideal,
    mixHaemolysis: 0,
    clotting: "none",
    gauge: 21,
    needleShiftM: 0,
    wetAlcohol: false,
    tourniquetSeconds: 35,
    orders: [],
  }, o || {});
}

/* =========================================================================
   THE THREE CAUSES OF HAEMOLYSIS CONVERGE HERE
   ========================================================================= */

test("a narrow gauge under a big vacuum shears; the same gauge into a small tube does not", () => {
  const bigTube = drawHaemolysis({ gauge: 25, volumeMl: 8 });
  const smallTube = drawHaemolysis({ gauge: 25, volumeMl: 2 });
  assert.ok(bigTube > smallTube);
  assert.equal(smallTube, 0);
  assert.equal(drawHaemolysis({ gauge: 21, volumeMl: 8 }), 0);
});

test("a needle worried about in the vein haemolyses, and wet alcohol does too", () => {
  assert.ok(drawHaemolysis({ gauge: 21, volumeMl: 4, needleShiftM: 0.0018 }) > 0);
  assert.ok(drawHaemolysis({ gauge: 21, volumeMl: 4, wetAlcohol: true }) > 0.2);
});

test("draw haemolysis and mixing haemolysis add up — burst cells do not un-burst", () => {
  const shaken = assessTube(perfect("lavender", { gauge: 25, volumeMl: 8, drawnMl: 8, mixHaemolysis: 0.25 }));
  assert.ok(shaken.haemolysis > shaken.haemolysisFromMixing);
  assert.ok(shaken.haemolysisFromDraw > 0);
});

test("a grossly haemolysed tube is rejected and says which analytes go wrong", () => {
  const t = assessTube(perfect("green", { mixHaemolysis: 0.6 }));
  assert.equal(t.verdict, VERDICT.REJECTED);
  assert.match(t.headline, /Potassium and LDH/);
});

/* =========================================================================
   FILL RATIO — fixed at manufacture, so short is WRONG not approximate
   ========================================================================= */

test("a short citrate tube is rejected outright; a short serum tube is only flagged", () => {
  const citrate = assessTube(perfect("lightblue", { drawnMl: 1.5, volumeMl: 2.7, inversions: 4 }));
  assert.equal(citrate.verdict, VERDICT.REJECTED);
  assert.match(citrate.headline, /ratio/i);

  const serum = assessTube(perfect("sst", { drawnMl: 2.0, volumeMl: 5, inversions: 5 }));
  assert.equal(serum.verdict, VERDICT.FLAGGED);
});

test("a tube that never filled at all is rejected as no specimen", () => {
  const t = assessTube(perfect("lavender", { drawnMl: 0 }));
  assert.equal(t.verdict, VERDICT.REJECTED);
  assert.match(t.headline, /never filled/);
});

test("the required fraction is the collection branch's, not a second opinion", () => {
  const need = requiredFraction("lightblue");
  const justUnder = assessTube(perfect("lightblue", { drawnMl: 2.7*(need - 0.05), volumeMl: 2.7, inversions: 4 }));
  const justOver = assessTube(perfect("lightblue", { drawnMl: 2.7*(need + 0.05), volumeMl: 2.7, inversions: 4 }));
  assert.equal(justUnder.verdict, VERDICT.REJECTED);
  assert.equal(justOver.verdict, VERDICT.ACCEPTED);
});

/* =========================================================================
   CARRYOVER, MIXING, CLOTTING
   ========================================================================= */

test("a tube drawn after one that contaminates it is rejected, naming the additive", () => {
  const t = assessTube(perfect("red", { carryoverFrom: "lavender", inversions: 0 }));
  assert.equal(t.verdict, VERDICT.REJECTED);
  assert.match(t.headline, /EDTA/);
});

test("an under-mixed additive tube is rejected; a disturbed plain tube is flagged", () => {
  const under = assessTube(perfect("lavender", { inversions: 2 }));
  assert.equal(under.verdict, VERDICT.REJECTED);

  const plain = assessTube(perfect("red", { inversions: 3 }));
  assert.equal(plain.verdict, VERDICT.FLAGGED);
});

test("clotted is a rejection; micro-clots are a comment", () => {
  assert.equal(assessTube(perfect("lavender", { clotting: "clotted" })).verdict, VERDICT.REJECTED);
  assert.equal(assessTube(perfect("lavender", { clotting: "microclots" })).verdict, VERDICT.FLAGGED);
});

/* =========================================================================
   HAEMOCONCENTRATION — the wrong result that looks perfectly normal
   ========================================================================= */

test("a band under a minute concentrates nothing; a long one flags the specimen", () => {
  assert.equal(haemoconcentration(HAEMOCONCENTRATION_AFTER_S), 0);
  assert.ok(haemoconcentration(HAEMOCONCENTRATION_BAD_S) >= 1);
  const t = assessTube(perfect("green", { tourniquetSeconds: 150 }));
  assert.equal(t.verdict, VERDICT.FLAGGED);
  assert.match(t.reasons.map(r => r.text).join(" "), /potassium, calcium and protein/i);
});

/* =========================================================================
   THE DELIVERY AS A WHOLE
   ========================================================================= */

test("a clean delivery scores 100 and every ordered test gets a result", () => {
  const tubes = [assessTube(perfect("lavender", { orders: ["CBC"] }))];
  const s = summariseSpecimens(tubes, ["CBC"]);
  assert.equal(s.score, 100);
  assert.equal(s.rejectedCount, 0);
  assert.equal(s.redrawRequired, false);
  assert.deepEqual(s.resultsDelivered, ["CBC"]);
});

test("a rejected tube names the tests the patient now has to be redrawn for", () => {
  const tubes = [
    assessTube(perfect("lavender", { orders: ["CBC"], inversions: 0 })),
    assessTube(perfect("sst", { drawnMl: 5, volumeMl: 5, inversions: 5, orders: ["Chemistry panel"] })),
  ];
  const s = summariseSpecimens(tubes, ["CBC", "Chemistry panel"]);
  assert.equal(s.rejectedCount, 1);
  assert.equal(s.redrawRequired, true);
  assert.deepEqual(s.lostTests, ["CBC"]);
  assert.deepEqual(s.resultsDelivered, ["Chemistry panel"]);
  assert.match(s.narrative, /drawn again/);
  assert.ok(s.score < 100);
});

test("testsOnTube maps a tube back to the orders it carries", () => {
  assert.deepEqual(testsOnTube("lavender", ["CBC", "Glucose"]), ["CBC"]);
  assert.deepEqual(testsOnTube("gray", ["CBC", "Glucose"]), ["Glucose"]);
});

/* =========================================================================
   READING IT OFF A REAL PROCEDURE STATE
   ========================================================================= */

test("assessSpecimens reads what the collection and inversion branches recorded", () => {
  const c = {
    tubes: ["lightblue", "lavender"],
    patient: { orders: ["PT/INR", "CBC"] },
    needleUnit: { gauge: 21 },
    tourniquetMeasurements: { secondsOn: 40 },
    cleaningMeasurements: { dryingSeconds: 45 },
    collection: {
      order: ["lightblue", "lavender"],
      peakShiftM: 0.0002,
      tubes: {
        lightblue: { key: "lightblue", drawnMl: 2.7, volumeMl: 2.7, carryover: null },
        // came off at a third of its volume: short, and a lavender is only flagged
        lavender: { key: "lavender", drawnMl: 1.2, volumeMl: 4, carryover: null },
      },
    },
    inversion: {
      order: ["lightblue", "lavender"],
      tubes: {
        lightblue: { inversions: 4, haemolysis: 0, clotting: "none", drawnMl: 2.7 },
        lavender: { inversions: 8, haemolysis: 0, clotting: "none", drawnMl: 1.2 },
      },
    },
  };
  const s = assessSpecimens(c);
  assert.equal(s.total, 2);
  const blue = s.tubes.find(t => t.key === "lightblue");
  const lav = s.tubes.find(t => t.key === "lavender");
  assert.equal(blue.verdict, VERDICT.ACCEPTED);
  assert.equal(lav.verdict, VERDICT.FLAGGED);
  assert.deepEqual(blue.tests, ["PT/INR"]);
  assert.equal(s.redrawRequired, false);
});

test("a wet prep field turns up as haemolysis on every tube drawn through it", () => {
  const c = {
    tubes: ["green"],
    patient: { orders: ["Ammonia"] },
    needleUnit: { gauge: 23 },
    tourniquetMeasurements: { secondsOn: 30 },
    cleaningMeasurements: { dryingSeconds: 3 },
    collection: {
      order: ["green"], peakShiftM: 0,
      tubes: { green: { key: "green", drawnMl: 4, volumeMl: 4, carryover: null } },
    },
    inversion: { order: ["green"], tubes: { green: { inversions: 8, haemolysis: 0.15, clotting: "none" } } },
  };
  const s = assessSpecimens(c);
  assert.ok(s.tubes[0].haemolysisFromDraw > 0);
  assert.notEqual(s.tubes[0].verdict, VERDICT.ACCEPTED);
});

test("the outcome folds into the procedure state's chips", () => {
  const c = {};
  applySpecimenOutcome(c, summariseSpecimens([assessTube(perfect("lavender"))], ["CBC"]));
  assert.equal(c.specimenOk, true);
  assert.ok(c.specimenQuality);
});
