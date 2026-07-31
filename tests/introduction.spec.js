/* =========================================================================
   INTRODUCTION AND IDENTIFICATION — unit tests for the pure layers.

   The row the rubric had nothing to feed it. What matters here is not that
   the questions were asked but HOW and IN WHAT ORDER, so most of these are
   about the difference between asking and confirming, and about what was
   already touched by the time the identity was settled.

   No DOM, no THREE.
   ========================================================================= */
import test from "node:test";
import assert from "node:assert/strict";

import {
  ACT, ACT_DEFS, actDef, IDENTIFIER, evaluateIntroduction, nextAction, nextIssue,
  identifiersObtained, identified, historyOf, missedQuestions,
  HYGIENE_GOOD_S, HYGIENE_MIN_S, DRY_MIN_S, REQUIRED_IDENTIFIERS,
} from "../src/venipuncture/introduction/introductionRules.js";
import {
  createIntroductionState, say, beginScrub, scrubFor, endScrub, scrubBout,
  dryFor, chooseGloves, reglove, finish,
} from "../src/venipuncture/introduction/introductionState.js";
import {
  measureIntroduction, applyIntroductionOutcome,
} from "../src/venipuncture/introduction/introductionScoring.js";

const PATIENT = {
  name: "Jane Cooper", first: "Jane", dob: "04/11/1968", id: "CJ12345",
  orders: ["CBC"], history: {},
};
const LATEX = Object.assign({}, PATIENT, { history: { latexAllergy: true } });
const FAINTER = Object.assign({}, PATIENT, { history: { faintHistory: true } });

function fresh(patient, o){
  return createIntroductionState(Object.assign({ patient: patient || PATIENT, tests: ["CBC"], tubeCount: 1, now: 1000 }, o || {}));
}

/** Everything done properly, in the right order. */
function textbook(patient){
  const s = fresh(patient);
  say(s, ACT.GREET, { now: 1000 });
  say(s, ACT.ASK_NAME_OPEN, { now: 2000 });
  say(s, ACT.ASK_DOB_OPEN, { now: 3000 });
  say(s, ACT.CONFIRM_ORDER, { now: 4000 });
  say(s, ACT.EXPLAIN, { now: 5000 });
  say(s, ACT.ASK_ALLERGIES, { now: 6000 });
  say(s, ACT.ASK_FAINTING, { now: 7000 });
  say(s, ACT.POSITION, { now: 8000 });
  scrubBout(s, 24, { now: 9000 });
  dryFor(s, 8);
  say(s, ACT.GLOVE, { now: 20000 });
  return s;
}

/* -------------------------------------------------------------------------
   ASKING IS NOT CONFIRMING
   ------------------------------------------------------------------------- */

test("an open question obtains an identifier", () => {
  const s = fresh();
  say(s, ACT.ASK_NAME_OPEN);
  assert.deepEqual(identifiersObtained(s), [IDENTIFIER.NAME]);
  assert.equal(s.leadingAsks, 0);
});

test("a leading question also obtains it — the patient agrees, which is the hazard", () => {
  const s = fresh();
  say(s, ACT.ASK_NAME_LEADING);
  assert.deepEqual(identifiersObtained(s), [IDENTIFIER.NAME]);
  assert.equal(s.leadingAsks, 1);
  assert.equal(s.transcript[0].reply, "…yes, that's right.");
});

test("a leading question is recorded as a mistake, not refused", () => {
  const s = fresh();
  say(s, ACT.ASK_NAME_LEADING);
  say(s, ACT.ASK_DOB_LEADING);
  const m = measureIntroduction(s);
  assert.equal(m.identifiersUsed, 2);
  assert.equal(m.leadingQuestions, 2);
  assert.ok(m.mistakes.some(x => x.code === "leadingQuestion"));
});

test("one identifier is a critical event; two is the requirement", () => {
  const one = fresh();
  say(one, ACT.ASK_NAME_OPEN);
  assert.equal(identified(one), false);
  assert.ok(measureIntroduction(one).criticalEvents.includes("oneIdentifier"));

  const two = fresh();
  say(two, ACT.ASK_NAME_OPEN);
  say(two, ACT.ASK_DOB_OPEN);
  assert.equal(identified(two), true);
  assert.ok(!measureIntroduction(two).criticalEvents.includes("oneIdentifier"));
  assert.equal(REQUIRED_IDENTIFIERS, 2);
});

test("the wristband is a third identifier source, and reads back real data", () => {
  const s = fresh();
  say(s, ACT.ASK_NAME_OPEN);
  say(s, ACT.CHECK_WRISTBAND);
  assert.equal(identified(s), true);
  assert.match(s.transcript[1].reply, /CJ12345/);
});

test("asking the same thing twice does not manufacture a second identifier", () => {
  const s = fresh();
  say(s, ACT.ASK_NAME_OPEN);
  say(s, ACT.ASK_NAME_OPEN);
  assert.equal(identifiersObtained(s).length, 1);
  assert.equal(identified(s), false);
});

/* -------------------------------------------------------------------------
   ORDER: WHAT WAS TOUCHED BEFORE THE IDENTITY WAS SETTLED
   ------------------------------------------------------------------------- */

test("positioning the patient before identifying them is recorded", () => {
  const s = fresh();
  say(s, ACT.POSITION, { now: 1000 });
  say(s, ACT.ASK_NAME_OPEN, { now: 2000 });
  say(s, ACT.ASK_DOB_OPEN, { now: 3000 });
  const m = measureIntroduction(s);
  assert.equal(m.identifiedBeforeTouching, false);
  assert.ok(m.mistakes.some(x => x.code === "touchedBeforeId"));
});

test("identifying first clears that gate", () => {
  const m = measureIntroduction(textbook());
  assert.equal(m.identifiedBeforeTouching, true);
  assert.ok(!m.mistakes.some(x => x.code === "touchedBeforeId"));
});

/* -------------------------------------------------------------------------
   HAND HYGIENE IS A DURATION
   ------------------------------------------------------------------------- */

test("the held rub and the accessible control land in the same state", () => {
  const held = fresh();
  beginScrub(held, { now: 1000 });
  for(let i = 0; i < 40; i++) scrubFor(held, 0.5);
  endScrub(held, { now: 21000 });

  const clicked = fresh();
  scrubBout(clicked, 20, { now: 1000 });

  assert.equal(held.hygieneSeconds, clicked.hygieneSeconds);
  assert.equal(held.hygieneEndedAt != null, clicked.hygieneEndedAt != null);
});

test("a bout of rubbing logs one event, not one per frame", () => {
  const s = fresh();
  beginScrub(s, { now: 1000 });
  for(let i = 0; i < 60; i++) scrubFor(s, 1/60);
  endScrub(s, { now: 2000 });
  assert.equal(s.events.filter(e => e.type === "scrub").length, 1);
});

test("a short rub is a mistake with the real number in it", () => {
  const s = textbook();
  s.hygieneSeconds = 8;
  const m = measureIntroduction(s);
  const short = m.mistakes.find(x => x.code === "shortHandHygiene");
  assert.ok(short);
  assert.match(short.message, /8s/);
  assert.match(short.message, new RegExp(`${HYGIENE_GOOD_S}s`));
});

test("no hand hygiene at all is critical, and blocks", () => {
  const s = fresh();
  say(s, ACT.ASK_NAME_OPEN);
  say(s, ACT.ASK_DOB_OPEN);
  say(s, ACT.GLOVE);
  const r = evaluateIntroduction(s);
  assert.equal(r.ready, false);
  assert.ok(r.blocking.some(i => i.code === "handsNotWashed"));
  assert.ok(measureIntroduction(s, r).criticalEvents.includes("noHandHygiene"));
});

test("rubbing again restarts the drying clock", () => {
  const s = fresh();
  scrubBout(s, 20, { now: 1000 });
  dryFor(s, 6);
  assert.equal(s.dryingSeconds, 6);
  scrubBout(s, 5, { now: 2000 });
  assert.equal(s.dryingSeconds, 0);
});

test("gloves over wet hands is measured, not assumed", () => {
  const s = fresh();
  scrubBout(s, 22, { now: 1000 });
  dryFor(s, 1);
  say(s, ACT.GLOVE, { now: 2000 });
  const m = measureIntroduction(s);
  assert.equal(m.dryingSeconds, 1);
  assert.ok(m.mistakes.some(x => x.code === "glovedWet"));
  assert.ok(DRY_MIN_S > 1);
});

test("gloving before washing at all is its own critical event", () => {
  const s = fresh();
  say(s, ACT.GLOVE, { now: 1000 });
  scrubBout(s, 25, { now: 2000 });
  const m = measureIntroduction(s);
  assert.equal(m.gloveAfterHygiene, false);
  assert.ok(m.criticalEvents.includes("glovedBeforeHygiene"));
});

/* -------------------------------------------------------------------------
   GLOVES AFTER GLOVING
   ------------------------------------------------------------------------- */

test("touching something after gloving contaminates the gloves", () => {
  const s = textbook();
  say(s, ACT.TOUCH_PHONE, { now: 21000 });
  const m = measureIntroduction(s);
  assert.equal(m.gloveContaminated, true);
  assert.ok(m.criticalEvents.includes("gloveContaminated"));
});

test("touching something BEFORE gloving does not", () => {
  const s = fresh();
  say(s, ACT.TOUCH_PHONE, { now: 1000 });
  say(s, ACT.GLOVE, { now: 2000 });
  assert.equal(s.gloveContaminated, false);
});

test("changing gloves is a real recovery from a recoverable error", () => {
  const s = textbook();
  say(s, ACT.TOUCH_PHONE, { now: 21000 });
  reglove(s, { now: 22000 });
  const m = measureIntroduction(s);
  assert.equal(m.gloveContaminated, false);
  assert.equal(m.regloves, 1);
  assert.ok(!m.criticalEvents.includes("gloveContaminated"));
});

/* -------------------------------------------------------------------------
   CLINICAL FACTS ARE TRIGGER DATA
   ------------------------------------------------------------------------- */

test("what the patient discloses comes from data on the patient, not from text", () => {
  assert.deepEqual(historyOf(LATEX), { latexAllergy: true, adhesiveAllergy: false, faintHistory: false });
  const s = fresh(LATEX);
  say(s, ACT.ASK_ALLERGIES);
  assert.match(s.transcript[0].reply, /Latex/);
  const plain = fresh(PATIENT);
  say(plain, ACT.ASK_ALLERGIES);
  assert.match(plain.transcript[0].reply, /None/);
});

test("latex gloves on a latex-allergic patient is a critical event", () => {
  const s = textbook(LATEX);
  assert.equal(s.gloveMaterial, "nitrile");   // default in these tests
  const latexed = fresh(LATEX);
  say(latexed, ACT.ASK_NAME_OPEN); say(latexed, ACT.ASK_DOB_OPEN);
  chooseGloves(latexed, "latex");
  scrubBout(latexed, 25, { now: 1000 });
  dryFor(latexed, 8);
  say(latexed, ACT.GLOVE, { now: 2000 });
  const m = measureIntroduction(latexed);
  assert.ok(m.criticalEvents.includes("latexOnAllergicPatient"));
});

test("gloves cannot be changed once they are on — you have to take them off", () => {
  const s = fresh();
  say(s, ACT.GLOVE);
  chooseGloves(s, "latex");
  assert.equal(s.gloveMaterial, "nitrile");
});

test("not asking a patient who had something to disclose costs more than not asking one who did not", () => {
  const asked = textbook(FAINTER);
  const notAsked = textbook(FAINTER);
  notAsked.asked.fainting = false;
  const plain = textbook(PATIENT);
  plain.asked.fainting = false;
  assert.ok(measureIntroduction(notAsked).score < measureIntroduction(plain).score);
  assert.ok(measureIntroduction(asked).score > measureIntroduction(notAsked).score);
  assert.match(measureIntroduction(notAsked).mistakes.find(m => m.code === "faintingNotAsked").message, /gone out/);
});

/* -------------------------------------------------------------------------
   THE MEASUREMENT THE RUBRIC READS
   ------------------------------------------------------------------------- */

test("a textbook introduction is ready, scores well and names no critical event", () => {
  const s = textbook();
  const r = evaluateIntroduction(s);
  assert.equal(r.ready, true, r.blocking.map(i => i.code).join(","));
  const m = measureIntroduction(s, r);
  assert.equal(m.criticalEvents.length, 0);
  assert.equal(m.mistakes.length, 0);
  assert.ok(m.score >= 90, `scored ${m.score}`);
});

test("the measurement carries the three fields the rubric policy grades on", () => {
  const m = measureIntroduction(textbook());
  assert.equal(typeof m.identifiedBeforeTouching, "boolean");
  assert.equal(typeof m.gloveAfterHygiene, "boolean");
  assert.equal(typeof m.handHygieneSeconds, "number");
  assert.equal(typeof m.score, "number");
  assert.ok(Array.isArray(m.mistakes));
  assert.equal(typeof m.narrative, "string");
});

test("the narrative cites what was actually done", () => {
  const s = textbook();
  const m = measureIntroduction(s);
  assert.match(m.narrative, /name and dob|dob and name/i);
  assert.match(m.narrative, /24s of hand hygiene/);
  assert.match(m.narrative, /gloves on/);
});

test("missed questions are listed by name", () => {
  const s = fresh();
  say(s, ACT.ASK_NAME_OPEN); say(s, ACT.ASK_DOB_OPEN);
  assert.deepEqual(missedQuestions(s).sort(), ["allergies", "explanation", "fainting", "order"]);
  assert.equal(measureIntroduction(s).questionsMissed, 4);
});

test("the outcome gates the next step on being identified AND clean", () => {
  const good = {};
  applyIntroductionOutcome(good, measureIntroduction(textbook()));
  assert.equal(good.introOk, true);

  const bad = {};
  const s = textbook();
  s.identifiers.dob = false;
  applyIntroductionOutcome(bad, measureIntroduction(s));
  assert.equal(bad.introOk, false);
});

test("every act in the catalog is reachable and has something to say", () => {
  for(const def of ACT_DEFS){
    assert.equal(actDef(def.id), def);
    assert.ok(def.label && def.label.length > 3, `${def.id} has no label`);
    assert.ok(typeof def.say === "string", `${def.id} has nothing to say`);
  }
});

test("nextAction moves through the interview and stops asking for what is done", () => {
  const s = fresh();
  assert.match(nextAction(s), /Introduce yourself/);
  say(s, ACT.GREET);
  assert.match(nextAction(s), /state their name/);
  say(s, ACT.ASK_NAME_OPEN); say(s, ACT.ASK_DOB_OPEN);
  assert.match(nextAction(s), /ordered/);
});

test("nextIssue reports the most serious thing first", () => {
  const s = fresh();
  const r = evaluateIntroduction(s);
  assert.equal(nextIssue(r).severity, "block");
});

test("finishing stops the transcript accepting more", () => {
  const s = textbook();
  finish(s, { now: 30000 });
  const before = s.transcript.length;
  say(s, ACT.EXPLAIN, { now: 31000 });
  assert.equal(s.transcript.length, before);
});
