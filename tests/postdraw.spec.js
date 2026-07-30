/* =========================================================================
   PRESSURE AND BANDAGE — unit tests for the pure layers.

   Everything here is the same code the gestures and the accessible controls
   both call, so a threshold asserted here is the threshold the learner meets
   in either. No DOM, no THREE.
   ========================================================================= */
import test from "node:test";
import assert from "node:assert/strict";

import {
  SITE_KIND, forceBandFor, holdSecondsFor, clotRatePerSecond,
  bleedRateMlPerS, hematomaGrade, evaluatePostDraw, modeReady, nextAction,
  PAD_ON_SITE_M, REOPEN_LOSS, BRUISE_ML, HEMATOMA_ML,
  TIME_TO_PRESSURE_GOOD, TIME_TO_PRESSURE_WARN,
  BANDAGE_ALIGN_WARN, BANDAGE_TIGHT_WARN, BANDAGE_TIGHT_BLOCK, BANDAGE_LOOSE,
  HOLD_SECONDS, HOLD_SECONDS_ANTICOAGULATED,
} from "../src/venipuncture/postdraw/postDrawRules.js";

import {
  createPostDrawState, pressSample, releasePressure, holdPressureFor,
  flexArm, checkSite, applyBandage, removeBandage, giveAftercare,
  pressureConsistency, meanForce, secondsRemaining,
} from "../src/venipuncture/postdraw/postDrawState.js";

import {
  measurePostDraw, applyPostDrawOutcome,
} from "../src/venipuncture/postdraw/postDrawScoring.js";

const VEIN = { id: "median-cubital", calibre: 0.0032, depth: 0.0035 };
const HAND_VEIN = { id: "dorsal-metacarpal", calibre: 0.0020, depth: 0.0018 };

function stateWith(o){
  return createPostDrawState(Object.assign({
    siteKind: SITE_KIND.ANTECUBITAL, vessel: VEIN, gauge: 21,
    anticoagulated: false, withdrawnAt: 1000, tourniquetOnAtWithdraw: false,
    gauze: { itemId: "gauze_ok", clean: true },
    bandage: { itemId: "bandage_ok", clean: true },
    now: 1000,
  }, o || {}));
}

/** Pressure held properly until the clot holds, then checked. */
function haemostasis(s){
  holdPressureFor(s, s.holdSeconds + 2, { now: 1200 });
  checkSite(s);
  return s;
}

/* =========================================================================
   FORCE — the magnitude is the technique, not the duration
   ========================================================================= */

test("each site has its own adequacy band, and the hand's is lower", () => {
  const arm = forceBandFor(SITE_KIND.ANTECUBITAL);
  const hand = forceBandFor(SITE_KIND.HAND);
  assert.ok(hand.min < arm.min);
  assert.ok(hand.discomfort < arm.discomfort);
});

test("below the adequacy band the clot makes NO progress, however long it is held", () => {
  const s = stateWith();
  const band = forceBandFor(s.siteKind);
  holdPressureFor(s, 60, { force: band.min - 0.05, now: 1200 });
  assert.equal(s.clotProgress, 0);
  assert.equal(s.effectiveSeconds, 0);
  // and it is still bleeding into the tissue the whole time
  assert.ok(s.extravasatedMl > 0);
  assert.ok(evaluatePostDraw(s).issues.find(i => i.code === "tooLight"));
});

test("adequate force progresses the clot at a real rate and stops the leak", () => {
  const s = stateWith();
  holdPressureFor(s, 10, { now: 1200 });
  assert.ok(s.clotProgress > 0);
  assert.ok(s.clotProgress < 1);
  assert.ok(s.effectiveSeconds >= 9.5);
  assert.equal(s.extravasatedMl, 0);
});

test("excessive force does not clot faster — it just hurts", () => {
  const band = forceBandFor(SITE_KIND.ANTECUBITAL);
  const ideal = stateWith();
  holdPressureFor(ideal, 10, { force: band.ideal, now: 1200 });
  const crushing = stateWith();
  holdPressureFor(crushing, 10, { force: 0.99, now: 1200 });
  assert.ok(Math.abs(crushing.clotProgress - ideal.clotProgress) < 1e-9);
  assert.ok(crushing.discomfortSeconds > 3);
  assert.equal(ideal.discomfortSeconds, 0);
  assert.ok(evaluatePostDraw(crushing).issues.find(i => i.code === "tooHard"));
});

test("the same force that is firm on an arm is painful on the back of a hand", () => {
  const s = stateWith({ siteKind: SITE_KIND.HAND, vessel: HAND_VEIN });
  holdPressureFor(s, 6, { force: 0.80, now: 1200 });
  assert.ok(s.discomfortSeconds > 3);
  const msg = evaluatePostDraw(s).issues.find(i => i.code === "tooHard").message;
  assert.match(msg, /bone/i);
});

test("pressure beside the puncture is not pressure on it", () => {
  const s = stateWith();
  holdPressureFor(s, 10, { offsetM: PAD_ON_SITE_M + 0.01, now: 1200 });
  assert.equal(s.padOffSite, true);
  assert.equal(s.force, 0);
  assert.equal(s.clotProgress, 0);
  assert.ok(s.extravasatedMl > 0);
  assert.equal(evaluatePostDraw(s).blocking.find(i => i.code === "padOffSite").severity, "block");
});

/* =========================================================================
   TIME — haemostasis is a process with a real length
   ========================================================================= */

test("this puncture's required hold comes from its own geometry", () => {
  const normal = holdSecondsFor({ vessel: VEIN, gauge: 21 });
  const thin = holdSecondsFor({ anticoagulated: true, vessel: VEIN, gauge: 21 });
  assert.ok(normal >= HOLD_SECONDS*0.9 && normal <= HOLD_SECONDS*1.3);
  assert.ok(thin > normal*1.5);
  assert.ok(thin >= HOLD_SECONDS_ANTICOAGULATED*0.9);
});

test("a patient on blood thinners genuinely needs longer, and the state knows it", () => {
  const normal = stateWith();
  const thin = stateWith({ anticoagulated: true });
  assert.ok(thin.holdSeconds > normal.holdSeconds);
  holdPressureFor(normal, normal.holdSeconds + 1, { now: 1200 });
  holdPressureFor(thin, normal.holdSeconds + 1, { now: 1200 });
  assert.ok(normal.clotProgress >= 1);
  assert.ok(thin.clotProgress < 1, "the same hold that works on a normal patient is not enough here");
});

test("holding through the full requirement reaches haemostasis exactly once", () => {
  const s = stateWith();
  holdPressureFor(s, s.holdSeconds + 5, { now: 1200 });
  assert.equal(s.clotProgress, 1);
  assert.equal(evaluatePostDraw(s).haemostatic, true);
  assert.ok(secondsRemaining(s) === 0);
});

test("time to pressure is measured from the moment the needle came out", () => {
  const s = stateWith({ withdrawnAt: 1000 });
  pressSample(s, 0.6, 0.004, 0.1, 1000 + TIME_TO_PRESSURE_WARN*1000 + 1500);
  assert.ok(s.timeToPressureS > TIME_TO_PRESSURE_WARN);
  assert.ok(evaluatePostDraw(s).issues.find(i => i.code === "slowToPressure"));

  const prompt = stateWith({ withdrawnAt: 1000 });
  pressSample(prompt, 0.6, 0.004, 0.1, 1900);
  assert.ok(prompt.timeToPressureS < TIME_TO_PRESSURE_GOOD);
  assert.equal(evaluatePostDraw(prompt).issues.find(i => i.code === "slowToPressure"), undefined);
});

test("letting go early costs real progress, so peeking repeatedly is slower", () => {
  const patient = stateWith();
  holdPressureFor(patient, patient.holdSeconds*0.8, { now: 1200 });
  const before = patient.clotProgress;
  releasePressure(patient);
  assert.equal(patient.releasedEarlyCount, 1);
  assert.ok(Math.abs(patient.clotProgress - (before - REOPEN_LOSS)) < 1e-9);
  assert.ok(evaluatePostDraw(patient).issues.find(i => i.code === "releasedEarly"));
});

test("releasing after haemostasis costs nothing — the clot is holding", () => {
  const s = stateWith();
  holdPressureFor(s, s.holdSeconds + 2, { now: 1200 });
  releasePressure(s);
  assert.equal(s.releasedEarlyCount, 0);
  assert.equal(s.clotProgress, 1);
});

/* =========================================================================
   POSITION — the flexed elbow, which is the classic
   ========================================================================= */

test("a bent arm stops the clot progressing at all and bleeds faster", () => {
  const s = stateWith();
  flexArm(s, true);
  holdPressureFor(s, 20, { now: 1200 });
  assert.equal(s.clotProgress, 0);
  assert.ok(s.armFlexedSeconds >= 19);
  assert.ok(s.extravasatedMl > 0);
  assert.ok(evaluatePostDraw(s).issues.find(i => i.code === "armFlexed"));

  const straight = stateWith();
  holdPressureFor(straight, 20, { now: 1200 });
  assert.ok(straight.extravasatedMl === 0);
});

test("straightening the arm again recovers the step", () => {
  const s = stateWith();
  flexArm(s, true);
  holdPressureFor(s, 10, { now: 1200 });
  flexArm(s, false);
  holdPressureFor(s, s.holdSeconds + 2, { now: 20000 });
  assert.equal(s.clotProgress, 1);
  assert.equal(evaluatePostDraw(s).haemostatic, true);
});

/* =========================================================================
   BLEEDING AND ITS CONSEQUENCE
   ========================================================================= */

test("a congested vein and a thinned patient both bleed faster", () => {
  const base = bleedRateMlPerS({ vessel: VEIN });
  assert.ok(bleedRateMlPerS({ vessel: VEIN, anticoagulated: true }) > base*2);
  assert.ok(bleedRateMlPerS({ vessel: VEIN, tourniquetOnAtWithdraw: true }) > base);
  assert.ok(bleedRateMlPerS({ vessel: VEIN, armFlexed: true }) > base);
});

test("leaked blood becomes a bruise, then a hematoma, at real volumes", () => {
  assert.equal(hematomaGrade(0), "none");
  assert.equal(hematomaGrade(BRUISE_ML + 0.01), "bruise");
  assert.equal(hematomaGrade(HEMATOMA_ML + 0.01), "hematoma");
});

test("doing nothing at all produces a hematoma, and it blocks", () => {
  const s = stateWith();
  // the pad resting off the site, for a long time
  holdPressureFor(s, 90, { offsetM: 0.03, now: 1200 });
  assert.equal(s.extravasatedMl > HEMATOMA_ML, true);
  const r = evaluatePostDraw(s);
  assert.equal(r.hematomaGrade, "hematoma");
  assert.equal(r.blocking.find(i => i.code === "hematoma").severity, "block");
});

/* =========================================================================
   THE CHECK — you find out by looking
   ========================================================================= */

test("looking early shows blood AND costs progress, because the pad came off", () => {
  const s = stateWith();
  holdPressureFor(s, s.holdSeconds*0.5, { now: 1200 });
  const before = s.clotProgress;
  checkSite(s);
  assert.equal(s.bleedingAtCheck, true);
  assert.equal(s.releasedEarlyCount, 1);
  assert.ok(s.clotProgress < before);
  assert.ok(evaluatePostDraw(s).issues.find(i => i.code === "stillBleeding"));
});

test("looking once it is holding shows a dry site and costs nothing", () => {
  const s = stateWith();
  haemostasis(s);
  assert.equal(s.bleedingAtCheck, false);
  assert.equal(s.releasedEarlyCount, 0);
  assert.equal(s.checkCount, 1);
});

test("the pressure step is not finished until it has been looked at", () => {
  const s = stateWith();
  holdPressureFor(s, s.holdSeconds + 2, { now: 1200 });
  assert.equal(evaluatePostDraw(s).haemostatic, true);
  assert.equal(modeReady(s, "pressure"), false, "haemostatic but never checked");
  assert.ok(evaluatePostDraw(s).issues.find(i => i.code === "notChecked"));
  checkSite(s);
  assert.equal(modeReady(s, "pressure"), true);
});

/* =========================================================================
   THE DRESSING
   ========================================================================= */

test("a dressing over a bleeding puncture is blocked, and knows it was bleeding", () => {
  const s = stateWith();
  holdPressureFor(s, 4, { now: 1200 });
  applyBandage(s, { alignM: 0.002, tightness: 0.45 });
  assert.equal(s.bandagedWhileBleeding, true);
  assert.equal(evaluatePostDraw(s).blocking.find(i => i.code === "bandagedBleeding").severity, "block");
  assert.equal(modeReady(s, "bandage"), false);
});

test("alignment and tightness are real quantities with their own findings", () => {
  const off = stateWith();
  haemostasis(off);
  applyBandage(off, { alignM: BANDAGE_ALIGN_WARN + 0.005, tightness: 0.45 });
  assert.ok(evaluatePostDraw(off).issues.find(i => i.code === "bandageOffSite"));

  const tight = stateWith();
  haemostasis(tight);
  applyBandage(tight, { alignM: 0.002, tightness: BANDAGE_TIGHT_BLOCK + 0.05 });
  assert.equal(evaluatePostDraw(tight).blocking.find(i => i.code === "bandageTourniquet").severity, "block");
  assert.equal(modeReady(tight, "bandage"), false);

  const firm = stateWith();
  haemostasis(firm);
  applyBandage(firm, { alignM: 0.002, tightness: BANDAGE_TIGHT_WARN + 0.05 });
  assert.ok(evaluatePostDraw(firm).issues.find(i => i.code === "bandageTight"));

  const loose = stateWith();
  haemostasis(loose);
  applyBandage(loose, { alignM: 0.002, tightness: BANDAGE_LOOSE - 0.05 });
  assert.ok(evaluatePostDraw(loose).issues.find(i => i.code === "bandageLoose"));
});

test("a dressing that was too tight can be taken off and redone, and it is counted", () => {
  const s = stateWith();
  haemostasis(s);
  applyBandage(s, { alignM: 0.002, tightness: 0.95 });
  assert.equal(modeReady(s, "bandage"), false);
  removeBandage(s);
  assert.equal(s.bandagedAt, null);
  applyBandage(s, { alignM: 0.002, tightness: 0.45 });
  assert.equal(modeReady(s, "bandage"), true);
  assert.equal(s.bandageAttempts, 2);
});

test("an unclean dressing on an open puncture is blocked", () => {
  const s = stateWith({ bandage: { itemId: "bandage_open", clean: false } });
  haemostasis(s);
  applyBandage(s, { alignM: 0.002, tightness: 0.45 });
  assert.equal(evaluatePostDraw(s).blocking.find(i => i.code === "bandageUnsterile").severity, "block");
});

test("gauze sliding off as the dressing goes on is its own finding", () => {
  const s = stateWith();
  haemostasis(s);
  applyBandage(s, { alignM: 0.002, tightness: 0.45, shifted: true });
  assert.ok(evaluatePostDraw(s).issues.find(i => i.code === "gauzeShifted"));
});

test("aftercare is prompted and recorded", () => {
  const s = stateWith();
  haemostasis(s);
  applyBandage(s, { alignM: 0.002, tightness: 0.45 });
  assert.ok(evaluatePostDraw(s).issues.find(i => i.code === "noAftercare"));
  giveAftercare(s);
  assert.equal(evaluatePostDraw(s).issues.find(i => i.code === "noAftercare"), undefined);
});

/* =========================================================================
   CONSISTENCY — a wandering hand is a different technique
   ========================================================================= */

test("a steady hold scores consistent; a wandering one does not", () => {
  const steady = stateWith();
  holdPressureFor(steady, 12, { now: 1200 });
  assert.ok(pressureConsistency(steady) > 0.97);

  const wobbly = stateWith();
  const band = forceBandFor(wobbly.siteKind);
  for(let i = 0; i < 120; i++){
    pressSample(wobbly, i % 2 ? band.min + 0.02 : 0.98, 0.004, 0.1, 1200 + i*100);
  }
  assert.ok(pressureConsistency(wobbly) < 0.75);
  assert.ok(meanForce(wobbly) > band.min);
});

/* =========================================================================
   THE TWO STEP IDS
   ========================================================================= */

test("each step id has its own finish line, and they arrive in order", () => {
  const s = stateWith();
  assert.equal(modeReady(s, "pressure"), false);
  assert.equal(modeReady(s, "bandage"), false);
  haemostasis(s);
  assert.equal(modeReady(s, "pressure"), true);
  assert.equal(modeReady(s, "bandage"), false);
  applyBandage(s, { alignM: 0.002, tightness: 0.45 });
  assert.equal(modeReady(s, "bandage"), true);
});

test("nextAction speaks to where the learner actually is", () => {
  const s = stateWith();
  assert.match(nextAction(s, "pressure"), /press/i);
  flexArm(s, true);
  holdPressureFor(s, 1, { now: 1200 });
  assert.match(nextAction(s, "pressure"), /straighten/i);
  flexArm(s, false);
  holdPressureFor(s, 1, { force: 0.1, now: 3000 });
  assert.match(nextAction(s, "pressure"), /harder/i);
  holdPressureFor(s, s.holdSeconds + 2, { now: 5000 });
  assert.match(nextAction(s, "pressure"), /lift the gauze/i);
  checkSite(s);
  assert.match(nextAction(s, "bandage"), /over the puncture/i);
});

/* =========================================================================
   SCORING
   ========================================================================= */

test("excellent post-draw care scores at the top with nothing named", () => {
  const s = stateWith();
  pressSample(s, 0.62, 0.003, 0.1, 1500);         // prompt: 0.5s after withdrawal
  holdPressureFor(s, s.holdSeconds + 2, { now: 1600 });
  checkSite(s);
  applyBandage(s, { alignM: 0.003, tightness: 0.45 });
  giveAftercare(s);
  const m = measurePostDraw(s, evaluatePostDraw(s));
  assert.deepEqual(m.mistakes.map(x => x.code), []);
  assert.ok(m.score >= 95, `got ${m.score}`);
  assert.equal(m.criticalEvents.length, 0);
  assert.equal(m.haemostatic, true);
  assert.equal(m.hematomaGrade, "none");
  assert.ok(m.effectiveSeconds >= m.requiredSeconds);
});

test("warning-level care lands mid-range; abandoning the site lands near the floor", () => {
  const warn = stateWith();
  pressSample(warn, 0.6, 0.004, 0.1, 1000 + 4000);   // 4s late
  holdPressureFor(warn, warn.holdSeconds*0.6, { now: 6000 });
  checkSite(warn);                                    // early peek
  holdPressureFor(warn, warn.holdSeconds + 4, { now: 30000 });
  checkSite(warn);
  applyBandage(warn, { alignM: 0.010, tightness: 0.78 });
  const mWarn = measurePostDraw(warn, evaluatePostDraw(warn));
  assert.ok(mWarn.score < 92 && mWarn.score > 45, `got ${mWarn.score}`);
  assert.equal(mWarn.criticalEvents.length, 0);
  assert.equal(mWarn.haemostatic, true);

  const bad = stateWith();
  holdPressureFor(bad, 90, { offsetM: 0.03, now: 1200 });   // never on the site
  applyBandage(bad, { alignM: 0.02, tightness: 0.95 });
  const mBad = measurePostDraw(bad, evaluatePostDraw(bad));
  assert.ok(mBad.score < 25, `got ${mBad.score}`);
  assert.ok(mBad.criticalEvents.indexOf("hematoma") >= 0);
  assert.ok(mBad.criticalEvents.indexOf("bandagedBleeding") >= 0);
});

test("the outcome flags mean what they say, not that a button was pressed", () => {
  const good = stateWith();
  haemostasis(good);
  applyBandage(good, { alignM: 0.002, tightness: 0.45 });
  const c1 = {};
  applyPostDrawOutcome(c1, measurePostDraw(good, evaluatePostDraw(good)));
  assert.equal(c1.pressureOk, true);
  assert.equal(c1.bandageOk, true);

  // held the pad on for ages, but never hard enough: bleeding never stopped
  const weak = stateWith();
  const band = forceBandFor(weak.siteKind);
  holdPressureFor(weak, 90, { force: band.min - 0.06, now: 1200 });
  applyBandage(weak, { alignM: 0.002, tightness: 0.45 });
  const c2 = {};
  applyPostDrawOutcome(c2, measurePostDraw(weak, evaluatePostDraw(weak)));
  assert.equal(c2.pressureOk, false);
  assert.equal(c2.bandageOk, false);
});

/* =========================================================================
   SERIALIZATION AND RESET
   ========================================================================= */

test("the state serializes and a round trip judges identically", () => {
  const s = stateWith();
  haemostasis(s);
  applyBandage(s, { alignM: 0.004, tightness: 0.5 });
  const back = JSON.parse(JSON.stringify(s));
  const a = evaluatePostDraw(s);
  const b = evaluatePostDraw(back);
  assert.deepEqual(b.issues.map(i => i.code), a.issues.map(i => i.code));
  assert.equal(
    measurePostDraw(back, b).score,
    measurePostDraw(s, a).score
  );
});

test("a fresh state is a fresh attempt", () => {
  const a = stateWith();
  haemostasis(a);
  applyBandage(a, { alignM: 0.002, tightness: 0.45 });
  const b = stateWith();
  assert.equal(b.clotProgress, 0);
  assert.equal(b.pressureStartedAt, null);
  assert.equal(b.bandagedAt, null);
  assert.equal(b.extravasatedMl, 0);
  assert.equal(b.events.length, 0);
});

/* =========================================================================
   BUTTERFLY / DORSAL HAND — a different dressing job, not the same one
   ========================================================================= */

test("the hand site needs less force but is easier to hurt, and both are scored", () => {
  const band = forceBandFor(SITE_KIND.HAND);
  const s = createPostDrawState({
    siteKind: SITE_KIND.HAND, vessel: HAND_VEIN, gauge: 23,
    withdrawnAt: 1000, bandage: { itemId: "bandage_ok", clean: true }, now: 1000,
  });
  pressSample(s, band.ideal, 0.002, 0.1, 1400);
  holdPressureFor(s, s.holdSeconds + 2, { force: band.ideal, offsetM: 0.002, now: 1500 });
  checkSite(s);
  applyBandage(s, { alignM: 0.002, tightness: 0.4 });
  giveAftercare(s);
  const m = measurePostDraw(s, evaluatePostDraw(s));
  assert.equal(m.siteKind, SITE_KIND.HAND);
  assert.equal(m.haemostatic, true);
  assert.equal(m.discomfortSeconds, 0);
  assert.ok(m.requiredForcePercent < 42);
  assert.ok(m.score >= 95, `got ${m.score}`);
});
