/* =========================================================================
   THE ENCOUNTER FLOW — unit tests for what replaced the three quiz screens.

   Identity, tube selection and order of draw used to be multiple-choice
   screens asked before the learner reached the cart, and then asked again —
   physically — at it. The screens are gone and the three encounter-score
   categories now read what was actually done. These tests pin that mapping,
   because it is the one place where deleting a screen could quietly delete
   the thing it was measuring.
   ========================================================================= */
import test from "node:test";
import assert from "node:assert/strict";

import { ENC, setEnc } from "../src/game/gameState.js";
import { deriveChoices } from "../src/game/scoring.js";
import { DRAW_EVENTS } from "../src/config.js";
import { measureStaging } from "../src/venipuncture/staging/stagingScoring.js";
import { createStagingState, placeItem, ZONE } from "../src/venipuncture/staging/stagingState.js";
import { buildSupplyCatalog, CATEGORY } from "../src/venipuncture/staging/supplyCatalog.js";
import { evaluateStaging } from "../src/venipuncture/staging/stagingRules.js";

const ORDER = ["lightblue", "lavender"];

function encounterWith(collect){
  setEnc({
    p: { name: "A Patient", first: "A", dob: "01/01/1970", id: "AP1",
      reqSet: ORDER.slice(), orders: ["PT/INR", "CBC"], event: { type: "none" } },
    selected: [], ordered: [], idChoice: null, reqChoice: true,
    labelFields: {}, handlingChoice: null, respondChoice: null, scores: {},
    collect,
  });
  return ENC;
}

/* -------------------------------------------------------------------------
   IDENTITY — from the introduction step's own transcript
   ------------------------------------------------------------------------- */

test("two identifiers, asked openly, before touching anything, is a clean check", () => {
  encounterWith({ introductionMeasurements: {
    identifiersUsed: 2, identifiersRequired: 2,
    identifiedBeforeTouching: true, leadingQuestions: 0,
  } });
  deriveChoices();
  assert.equal(ENC.idChoice, true);
});

test("one identifier is not identification, however confidently it was obtained", () => {
  encounterWith({ introductionMeasurements: {
    identifiersUsed: 1, identifiersRequired: 2,
    identifiedBeforeTouching: true, leadingQuestions: 0,
  } });
  deriveChoices();
  assert.equal(ENC.idChoice, false);
});

test("a leading question produced the identifier and still fails the check", () => {
  encounterWith({ introductionMeasurements: {
    identifiersUsed: 2, identifiersRequired: 2,
    identifiedBeforeTouching: true, leadingQuestions: 1,
  } });
  deriveChoices();
  assert.equal(ENC.idChoice, false);
});

test("identifying after the patient has been touched fails it too", () => {
  encounterWith({ introductionMeasurements: {
    identifiersUsed: 2, identifiersRequired: 2,
    identifiedBeforeTouching: false, leadingQuestions: 0,
  } });
  deriveChoices();
  assert.equal(ENC.idChoice, false);
});

/* -------------------------------------------------------------------------
   TUBES — from the cart and from the draw
   ------------------------------------------------------------------------- */

test("the tubes staged at the cart are the learner's tube selection", () => {
  encounterWith({ stagingMeasurements: { stagedTubeKeys: ["lavender", "lightblue"], rackedTubeKeys: ["lightblue", "lavender"] } });
  deriveChoices();
  assert.deepEqual(ENC.selected.slice().sort(), ["lavender", "lightblue"]);
});

test("the order of draw is the order the tubes actually came off the holder", () => {
  encounterWith({
    stagingMeasurements: { stagedTubeKeys: ORDER.slice(), rackedTubeKeys: ["lightblue", "lavender"] },
    // racked correctly, but drawn in the wrong order — the draw is the truth
    collectionMeasurements: { drawnSequence: ["lavender", "lightblue"] },
  });
  deriveChoices();
  assert.deepEqual(ENC.ordered, ["lavender", "lightblue"]);
});

test("a draw that stopped before any tube falls back to the rack the learner built", () => {
  encounterWith({
    stagingMeasurements: { stagedTubeKeys: ORDER.slice(), rackedTubeKeys: ["lightblue", "lavender"] },
    collectionMeasurements: { drawnSequence: [] },
  });
  deriveChoices();
  assert.deepEqual(ENC.ordered, ["lightblue", "lavender"]);
});

test("an encounter abandoned before the cart derives nothing rather than guessing", () => {
  encounterWith({});
  deriveChoices();
  assert.equal(ENC.idChoice, null);
  assert.deepEqual(ENC.selected, []);
  assert.deepEqual(ENC.ordered, []);
});

/* -------------------------------------------------------------------------
   THE MEASUREMENT THOSE READS COME FROM
   ------------------------------------------------------------------------- */

function stagedCart(keys){
  const catalog = buildSupplyCatalog({ requiredTubes: ORDER, patientName: "A Patient", otherPatientName: "B Other" });
  const state = createStagingState({ catalog, requiredTubes: ORDER, handedness: "right", now: 0 });
  (keys || ORDER).forEach((key, i) => {
    const def = catalog.find(d => d.category === CATEGORY.TUBE && d.tubeKey === key && !(d.flaws || []).length);
    if(def) placeItem(state, def.id, ZONE.RACK, { slot: i, now: 1 });
  });
  return { state, catalog, m: measureStaging(state, catalog, evaluateStaging(state, catalog), 1000) };
}

test("staging reports the tubes it actually holds, in rack order", () => {
  const { m } = stagedCart(["lightblue", "lavender"]);
  assert.deepEqual(m.rackedTubeKeys, ["lightblue", "lavender"]);
  assert.deepEqual(m.stagedTubeKeys.slice().sort(), ["lavender", "lightblue"]);
  assert.equal(m.tubeSelectionCorrect, true);
  assert.equal(m.tubeOrderAccuracy, 1);
});

test("a cart missing a required tube is not a correct selection", () => {
  const { m } = stagedCart(["lightblue"]);
  assert.equal(m.tubeSelectionCorrect, false);
  assert.ok(m.tubeOrderAccuracy < 1);
});

/* -------------------------------------------------------------------------
   THE MID-DRAW QUIZ IS GONE
   ------------------------------------------------------------------------- */

test("no draw event interrupts the draw any more — the complications branch does that for real", () => {
  assert.ok(DRAW_EVENTS.length > 0);
  for(const e of DRAW_EVENTS){
    assert.equal(e.when, "post", `"${(e.lines||[])[0]}" still interrupts the draw`);
  }
});

test("every remaining draw event is still a complete, answerable moment", () => {
  for(const e of DRAW_EVENTS){
    assert.ok(e.options.some(o => o.ok), "no correct answer");
    assert.ok(e.options.some(o => !o.ok), "no wrong answer");
    assert.ok(e.learn && e.learn.length > 30, "no teaching");
  }
});
