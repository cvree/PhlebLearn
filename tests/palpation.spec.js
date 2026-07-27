/* =========================================================================
   Unit tests for palpation: what a fingertip finds, and whether committing
   to it was right. These assert the CLINICAL claims — an artery pulses back,
   a tendon does not give, a vein you never felt is a guess — not the code.
   ========================================================================= */
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildVessels, applyPatientVariation, VESSEL_KIND } from "../src/venipuncture/arm/armAnatomy.js";
import {
  FEEL, feelAt, rollOffset, evaluatePalpation, nextIssue, nextAction,
  pressNeededFor, CONTACT_PRESS, OCCLUDE_PRESS,
} from "../src/venipuncture/palpation/palpationRules.js";
import {
  createPalpationState, recordFeel, chooseVessel, clearChoice,
  markArteryRecognised, hasFelt, feltCount,
} from "../src/venipuncture/palpation/palpationState.js";
import { measurePalpation, applyPalpationOutcome } from "../src/venipuncture/palpation/palpationScoring.js";

const V = buildVessels();
const byId = id=>V.find(v=>v.id === id);
/** A point in the middle of a vessel's run. */
function mid(id){
  const v = byId(id);
  return v.path[Math.floor(v.path.length/2)];
}
const FIRM = 0.62;

/* ---------- what the finger finds ------------------------------------------- */

test("a resting finger finds nothing at all", ()=>{
  const p = mid("median-cubital");
  assert.equal(feelAt(V, p.x, p.z, CONTACT_PRESS/2).feel, FEEL.NOTHING);
});

test("pressing over the median cubital finds a vein that springs back", ()=>{
  const p = mid("median-cubital");
  const f = feelAt(V, p.x, p.z, FIRM);
  assert.equal(f.feel, FEEL.VEIN);
  assert.equal(f.vessel.id, "median-cubital");
});

test("pressing over the artery finds something pulsing, not a vein", ()=>{
  const p = mid("brachial-artery");
  const f = feelAt(V, p.x, p.z, 0.95);
  assert.equal(f.feel, FEEL.ARTERY);
  assert.equal(f.vessel.kind, VESSEL_KIND.ARTERY);
});

test("pressing over the tendon finds something hard that does not give", ()=>{
  const p = mid("biceps-tendon");
  const f = feelAt(V, p.x, p.z, 0.9);
  assert.equal(f.feel, FEEL.TENDON);
});

test("a compliant vein rolls out from under the finger", ()=>{
  const p = mid("cephalic");                       // compliance 0.55
  assert.equal(feelAt(V, p.x, p.z, 0.35).feel, FEEL.VEIN, "gentle pressure, it stays put");
  assert.equal(feelAt(V, p.x, p.z, 0.75).feel, FEEL.ROLLING, "press harder and it slides");
});

test("the median cubital does NOT roll — that is why it is first choice", ()=>{
  const p = mid("median-cubital");
  assert.equal(feelAt(V, p.x, p.z, 0.85).feel, FEEL.VEIN);
});

test("a rolling vein is displaced by a real distance", ()=>{
  const ceph = byId("cephalic"), med = byId("median-cubital");
  assert.ok(rollOffset(ceph, 0.8) > rollOffset(med, 0.8), "the roller moves further");
  assert.ok(rollOffset(ceph, 0.8) > 0.002, "and by enough to have to chase");
  assert.equal(rollOffset(ceph, 0.1), 0, "a light touch does not move it");
});

test("pressing too hard flattens the vein and you feel nothing useful", ()=>{
  const p = mid("median-cubital");
  const f = feelAt(V, p.x, p.z, OCCLUDE_PRESS + 0.08);
  assert.equal(f.feel, FEEL.FLATTENED);
});

test("deeper structures need a firmer press to find at all", ()=>{
  assert.ok(pressNeededFor(byId("brachial-artery").depth) > pressNeededFor(byId("median-cubital").depth));
  const a = mid("brachial-artery");
  assert.equal(feelAt(V, a.x, a.z, 0.20).feel, FEEL.SOFT, "a light touch misses it");
  assert.equal(feelAt(V, a.x, a.z, 0.95).feel, FEEL.ARTERY, "a firm one finds it");
});

test("the nerve is only ever felt as the patient hurting, and only when leaned on", ()=>{
  const p = mid("median-nerve");
  assert.notEqual(feelAt(V, p.x, p.z, 0.4).feel, FEEL.NERVE);
  const hard = feelAt(V, p.x, p.z, 0.95);
  assert.ok(hard.feel === FEEL.NERVE || hard.vessel.kind !== VESSEL_KIND.NERVE);
});

test("empty skin between the vessels feels of nothing in particular", ()=>{
  const f = feelAt(V, -0.20, -0.005, 0.8);
  assert.equal(f.feel, FEEL.SOFT);
  assert.equal(f.vessel, null);
});

test("a deep-veined patient's veins need a firmer press than a normal one", ()=>{
  const deep = applyPatientVariation(buildVessels(), { build:1, scenarioKeys:["deep"] });
  const p = mid("median-cubital");
  assert.equal(feelAt(deep, p.x, p.z, 0.16).feel, FEEL.SOFT, "the light touch that worked before now misses");
  assert.equal(feelAt(deep, p.x, p.z, 0.85).feel, FEEL.VEIN, "it is still there, further down");
});

/* ---------- what the fingers remember ---------------------------------------- */

test("feeling a vein records it; hovering does not", ()=>{
  const s = createPalpationState();
  const p = mid("median-cubital");
  recordFeel(s, feelAt(V, p.x, p.z, 0.05), 0.05, 100);
  assert.equal(hasFelt(s, "median-cubital"), false);
  recordFeel(s, feelAt(V, p.x, p.z, FIRM), FIRM, 100);
  assert.equal(hasFelt(s, "median-cubital"), true);
});

test("pressing the artery is remembered, and so is moving off it", ()=>{
  const s = createPalpationState();
  const a = mid("brachial-artery");
  recordFeel(s, feelAt(V, a.x, a.z, 0.95), 0.95, 200);
  assert.equal(s.arteryPressed, true);
  assert.equal(s.arteryRecognised, false);
  markArteryRecognised(s);
  assert.equal(s.arteryRecognised, true);
});

test("contact time and peak pressure are accumulated", ()=>{
  const s = createPalpationState();
  const p = mid("median-cubital");
  recordFeel(s, feelAt(V, p.x, p.z, 0.4), 0.4, 300);
  recordFeel(s, feelAt(V, p.x, p.z, 0.8), 0.8, 300);
  assert.equal(s.peakPress, 0.8);
  assert.equal(s.contactMs, 600);
});

/* ---------- judging the choice ------------------------------------------------ */

function felt(id, press){
  const s = createPalpationState();
  const p = mid(id);
  recordFeel(s, feelAt(V, p.x, p.z, press == null ? FIRM : press), press == null ? FIRM : press, 400);
  return s;
}

test("feeling the median cubital and choosing it is a clean pass", ()=>{
  const s = felt("median-cubital");
  chooseVessel(s, "median-cubital", mid("median-cubital"));
  const r = evaluatePalpation(s, V);
  assert.equal(r.ready, true);
  assert.equal(r.ideal, true);
  assert.equal(r.blocking.length, 0);
});

test("choosing the artery is blocked, and the message says why it pulsed", ()=>{
  const s = felt("brachial-artery", 0.95);
  chooseVessel(s, "brachial-artery", mid("brachial-artery"));
  const r = evaluatePalpation(s, V);
  assert.equal(r.ready, false);
  assert.ok(r.blocking.some(i=>i.code === "choseArtery"));
  assert.match(nextIssue(r).message, /pulse|artery/i);
});

test("choosing the tendon is blocked and explains what a vein feels like instead", ()=>{
  const s = felt("biceps-tendon", 0.9);
  chooseVessel(s, "biceps-tendon", mid("biceps-tendon"));
  const r = evaluatePalpation(s, V);
  assert.ok(r.blocking.some(i=>i.code === "choseTendon"));
  assert.match(nextIssue(r).message, /gives under the finger/i);
});

test("committing to a vein you never palpated is blocked as a guess", ()=>{
  const s = createPalpationState();
  chooseVessel(s, "median-cubital", mid("median-cubital"));
  const r = evaluatePalpation(s, V);
  assert.equal(r.ready, false);
  assert.ok(r.blocking.some(i=>i.code === "neverFelt"));
});

test("the cephalic is allowed, with a note; the basilic warns about its neighbours", ()=>{
  const c = felt("cephalic");
  chooseVessel(c, "cephalic", mid("cephalic"));
  const rc = evaluatePalpation(c, V);
  assert.equal(rc.ready, true);
  assert.ok(rc.issues.some(i=>i.code === "choseCephalic" && i.severity === "note"));

  const b = felt("basilic");
  chooseVessel(b, "basilic", mid("basilic"));
  const rb = evaluatePalpation(b, V);
  assert.equal(rb.ready, true, "usable, but not without comment");
  const warn = rb.issues.find(i=>i.code === "choseBasilic");
  assert.equal(warn.severity, "warn");
  assert.match(warn.message, /artery|nerve/i);
});

test("pressing the artery and never recognising it is a warning even on a good choice", ()=>{
  const s = felt("median-cubital");
  const a = mid("brachial-artery");
  recordFeel(s, feelAt(V, a.x, a.z, 0.95), 0.95, 200);
  chooseVessel(s, "median-cubital", mid("median-cubital"));
  const r = evaluatePalpation(s, V);
  assert.equal(r.ready, true, "the vein chosen was still right");
  assert.ok(r.issues.some(i=>i.code === "missedArtery" && i.severity === "warn"));
});

test("no choice at all blocks, and the prompt says to feel first", ()=>{
  const s = createPalpationState();
  const r = evaluatePalpation(s, V);
  assert.equal(r.ready, false);
  assert.equal(nextIssue(r).code, "noChoice");
  assert.match(nextAction(s), /press/i);
});

test("un-marking a site puts the decision back", ()=>{
  const s = felt("median-cubital");
  chooseVessel(s, "median-cubital", mid("median-cubital"));
  assert.equal(evaluatePalpation(s, V).ready, true);
  clearChoice(s);
  assert.equal(evaluatePalpation(s, V).ready, false);
  assert.equal(hasFelt(s, "median-cubital"), true, "but you still know what it felt like");
});

/* ---------- measurement -------------------------------------------------------- */

test("measurements report what was felt, not just what was picked", ()=>{
  const s = felt("median-cubital");
  const a = mid("brachial-artery");
  recordFeel(s, feelAt(V, a.x, a.z, 0.95), 0.95, 200);
  markArteryRecognised(s);
  chooseVessel(s, "median-cubital", mid("median-cubital"));
  const m = measurePalpation(s, evaluatePalpation(s, V), V);
  assert.equal(m.chosenId, "median-cubital");
  assert.equal(m.choseIdeal, true);
  assert.equal(m.feltChosen, true);
  assert.equal(m.arteryRecognised, true);
  assert.ok(m.structuresFelt >= 2);
  assert.ok(m.score >= 90, `a clean palpation should score high, got ${m.score}`);
});

test("guessing scores far worse than feeling, even for the same vein", ()=>{
  const guessed = createPalpationState();
  chooseVessel(guessed, "median-cubital", mid("median-cubital"));
  const g = measurePalpation(guessed, evaluatePalpation(guessed, V), V);

  const s = felt("median-cubital");
  chooseVessel(s, "median-cubital", mid("median-cubital"));
  const f = measurePalpation(s, evaluatePalpation(s, V), V);

  assert.ok(g.score < f.score - 15, "picking by eye is the thing being penalised");
  assert.ok(g.mistakes.some(x=>x.code === "neverFelt"));
});

test("choosing the artery is the worst outcome and says so in words", ()=>{
  const s = felt("brachial-artery", 0.95);
  chooseVessel(s, "brachial-artery", mid("brachial-artery"));
  const m = measurePalpation(s, evaluatePalpation(s, V), V);
  assert.equal(m.choseVein, false);
  assert.ok(m.score < 50);
  assert.ok(m.mistakes.some(x=>x.code === "notAVein"));
  m.mistakes.forEach(x=>assert.ok(x.message.length > 20));
});

test("the narrative reads as technique feedback, not a score", ()=>{
  const s = felt("median-cubital");
  chooseVessel(s, "median-cubital", mid("median-cubital"));
  const m = measurePalpation(s, evaluatePalpation(s, V), V);
  assert.match(m.narrative, /median cubital/);
  assert.match(m.narrative, /palpated it/);
  assert.doesNotMatch(m.narrative, /\d+\/100/);
});

test("the outcome feeds the encounter's vein chip honestly", ()=>{
  const good = felt("median-cubital");
  chooseVessel(good, "median-cubital", mid("median-cubital"));
  const c1 = {};
  applyPalpationOutcome(c1, measurePalpation(good, evaluatePalpation(good, V), V));
  assert.equal(c1.veinOk, true);

  const guessed = createPalpationState();
  chooseVessel(guessed, "median-cubital", mid("median-cubital"));
  const c2 = {};
  applyPalpationOutcome(c2, measurePalpation(guessed, evaluatePalpation(guessed, V), V));
  assert.equal(c2.veinOk, false, "right vein, but never felt — not a pass");
});
