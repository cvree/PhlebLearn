/* =========================================================================
   WITHDRAW, SAFETY AND SHARPS — unit tests for the pure layers.

   Everything here is the same code the gestures and the accessible controls
   both call, so a threshold asserted here is the threshold the learner meets
   in either. No DOM, no THREE.
   ========================================================================= */
import test from "node:test";
import assert from "node:assert/strict";

import {
  DEVICE, safetyActionFor, evaluateWithdrawal, modeReady, nextAction,
  GAUZE_READY_M, EXIT_DEVIATION_WARN_DEG, EXIT_SPEED_WARN_MPS,
  SAFETY_IMMEDIATE_S, reachToleranceM,
} from "../src/venipuncture/withdrawal/withdrawalRules.js";

import {
  createWithdrawalState, relaxFist, reachDisturbance, markBandReleased,
  takeGauze, placeGauze, gauzeReady,
  beginWithdraw, sampleWithdraw, withdrawSmoothly, withdrawRoughly,
  slideSafety, activateSafetyCleanly, attemptRecap, setDownUnit,
  disposeUnit, markCrossedPatient, exposedSeconds, disposalDelaySeconds,
} from "../src/venipuncture/withdrawal/withdrawalState.js";

import {
  measureWithdrawal, applyWithdrawalOutcome,
} from "../src/venipuncture/withdrawal/withdrawalScoring.js";

const VEIN = { id: "median-cubital", calibre: 0.0034, depth: 0.0035 };

function stateWith(o){
  return createWithdrawalState(Object.assign({
    device: DEVICE.STRAIGHT, angleDeg: 20, depthM: 0.005, depthDir: 1,
    entryX: 0, entryZ: 0, vessel: VEIN, inVein: true,
    gauze: { itemId: "gauze_ok", clean: true },
    bin: { itemId: "sharps_ok", available: true },
  }, o || {}));
}

/** The whole sequence, done properly, up to (not including) `until`. */
function doneUpTo(s, until, t0){
  const t = t0 == null ? Date.now() : t0;
  relaxFist(s, t);
  markBandReleased(s, { at: t + 100, byTail: true, collectionDone: true, tourniquetSeconds: 44 });
  if(until === "release") return s;
  takeGauze(s, { at: t + 200 });
  placeGauze(s, { offsetM: 0.012, pressing: false, at: t + 300 });
  withdrawSmoothly(s, { tubeOn: false, tourniquetOn: false }, t + 400);
  if(until === "withdraw") return s;
  activateSafetyCleanly(s, t + 1600);
  if(until === "safety") return s;
  disposeUnit(s, { target: "sharps", fully: true }, t + 2600);
  return s;
}

const CTX_RELEASED = { tourniquetReleased: true, tourniquetOn: false, collectionDone: true, tubeOnHolder: false };
const CTX_ON = { tourniquetReleased: false, tourniquetOn: true, collectionDone: true, tubeOnHolder: false };

/* =========================================================================
   RELEASE — the band comes off first, by its tail, with the needle steady
   ========================================================================= */

test("the band still on is a note before withdrawal and a block after it", ()=>{
  const s = stateWith();
  let r = evaluateWithdrawal(s, CTX_ON);
  assert.equal(r.issues.find(i=>i.code==="bandStillOn").severity, "note");
  takeGauze(s, {}); placeGauze(s, { offsetM: 0.01 });
  withdrawSmoothly(s, { tubeOn: false, tourniquetOn: true });
  r = evaluateWithdrawal(s, CTX_ON);
  const bad = r.issues.find(i=>i.code==="withdrewUnderPressure");
  assert.equal(bad.severity, "block");
  assert.equal(r.ready, false);
});

test("releasing mid-draw is its own warning, not a generic one", ()=>{
  const s = stateWith();
  markBandReleased(s, { collectionDone: false, tourniquetSeconds: 30 });
  const r = evaluateWithdrawal(s, CTX_RELEASED);
  assert.ok(r.issues.find(i=>i.code==="releasedMidDraw" && i.severity==="warn"));
});

test("a clenched fist at release is noticed; asking them to open it clears it", ()=>{
  const s = stateWith();
  markBandReleased(s, { collectionDone: true });
  assert.ok(evaluateWithdrawal(s, CTX_RELEASED).issues.find(i=>i.code==="fistStillClenched"));
  const s2 = stateWith();
  relaxFist(s2);
  markBandReleased(s2, { collectionDone: true });
  assert.equal(evaluateWithdrawal(s2, CTX_RELEASED).issues.find(i=>i.code==="fistStillClenched"), undefined);
});

test("jostling the needle while reaching for the band is measured against the vein", ()=>{
  const s = stateWith();
  reachDisturbance(s, 0.0008);           // well inside a 3.4mm vein's tolerance
  assert.equal(evaluateWithdrawal(s, CTX_ON).issues.find(i=>i.code==="disturbedReaching"), undefined);
  reachDisturbance(s, reachToleranceM(VEIN)*0.7);
  assert.ok(evaluateWithdrawal(s, CTX_ON).issues.find(i=>i.code==="disturbedReaching"));
  // a level, not a sum: a smaller later wobble must not shrink the record
  const worst = s.releaseShiftM;
  reachDisturbance(s, 0.0002);
  assert.equal(s.releaseShiftM, worst);
});

test("the reach stops being measured once the band is off or the needle is out", ()=>{
  const s = stateWith();
  markBandReleased(s, { collectionDone: true });
  reachDisturbance(s, 0.005);
  assert.equal(s.releaseShiftM, 0);
});

test("release is recorded once; the timing facts are stamped at that moment", ()=>{
  const s = stateWith();
  markBandReleased(s, { at: 1000, byTail: true, collectionDone: true, tourniquetSeconds: 48 });
  markBandReleased(s, { at: 9999, collectionDone: false, tourniquetSeconds: 99 });
  assert.equal(s.releasedAt, 1000);
  assert.equal(s.tourniquetSecondsAtRelease, 48);
  assert.equal(s.collectionDoneAtRelease, true);
});

/* =========================================================================
   GAUZE — ready above the site, clean, and not pressed while the needle is in
   ========================================================================= */

test("gauze resting within the ready distance counts as ready; further does not", ()=>{
  const s = stateWith();
  takeGauze(s, {});
  placeGauze(s, { offsetM: GAUZE_READY_M - 0.002 });
  assert.equal(gauzeReady(s), true);
  placeGauze(s, { offsetM: GAUZE_READY_M + 0.005 });
  assert.equal(gauzeReady(s), false);
});

test("unclean gauze headed for a fresh puncture is blocked", ()=>{
  const s = stateWith({ gauze: { itemId: "gauze_open", clean: false } });
  takeGauze(s, {});
  const r = evaluateWithdrawal(s, CTX_RELEASED);
  assert.equal(r.issues.find(i=>i.code==="gauzeUnsterile").severity, "block");
});

test("pressing down while the needle is still in is recorded; resting is not", ()=>{
  const s = stateWith();
  takeGauze(s, {});
  placeGauze(s, { offsetM: 0.01, pressing: false });
  assert.equal(s.gauzePressedEarly, false);
  placeGauze(s, { offsetM: 0.005, pressing: true });
  assert.equal(s.gauzePressedEarly, true);
  assert.ok(evaluateWithdrawal(s, CTX_RELEASED).issues.find(i=>i.code==="pressedTooSoon"));
});

test("pressing after the needle is out is what gauze is FOR — not a mistake", ()=>{
  const s = stateWith();
  doneUpTo(s, "withdraw");
  placeGauze(s, { offsetM: 0.001, pressing: true });
  assert.equal(s.gauzePressedEarly, false);
});

/* =========================================================================
   WITHDRAW — out along the line it went in, smoothly, with everything ready
   ========================================================================= */

test("a smooth withdrawal exits on the line at a controlled speed", ()=>{
  const s = stateWith();
  doneUpTo(s, "withdraw");
  assert.ok(s.withdrawnAt != null);
  assert.equal(s.depthM, 0);
  assert.ok(s.exitDeviationDeg < EXIT_DEVIATION_WARN_DEG);
  assert.ok(s.peakSpeedMps < EXIT_SPEED_WARN_MPS);
  assert.equal(s.gauzeReadyAtWithdraw, true);
  const r = evaluateWithdrawal(s, CTX_RELEASED);
  assert.equal(r.issues.find(i=>i.code==="exitOffLine"), undefined);
  assert.equal(r.issues.find(i=>i.code==="yanked"), undefined);
});

test("outward travel shallows the tip by the entry angle's own trigonometry", ()=>{
  const s = stateWith({ angleDeg: 30, depthM: 0.005 });
  beginWithdraw(s);
  sampleWithdraw(s, 0.004, 0, 0.1);       // 4mm out at 30° = 2mm shallower
  assert.ok(Math.abs(s.depthM - 0.003) < 1e-6);
});

test("a yank is measured as speed; a sideways exit as degrees off the line", ()=>{
  const s = stateWith();
  markBandReleased(s, { collectionDone: true });
  takeGauze(s, {}); placeGauze(s, { offsetM: 0.01 });
  withdrawRoughly(s, { tubeOn: false, tourniquetOn: false });
  assert.ok(s.peakSpeedMps > EXIT_SPEED_WARN_MPS);
  assert.ok(s.exitDeviationDeg > EXIT_DEVIATION_WARN_DEG);
  const r = evaluateWithdrawal(s, CTX_RELEASED);
  assert.ok(r.issues.find(i=>i.code==="yanked"));
  assert.ok(r.issues.find(i=>i.code==="exitOffLine"));
});

test("what was true at the moment of exit is stamped onto the state", ()=>{
  const s = stateWith();
  withdrawSmoothly(s, { tubeOn: true, tourniquetOn: true });
  assert.equal(s.tubeOnAtWithdraw, true);
  assert.equal(s.tourniquetOnAtWithdraw, true);
  assert.equal(s.gauzeReadyAtWithdraw, false);
  const r = evaluateWithdrawal(s, CTX_ON);
  assert.ok(r.issues.find(i=>i.code==="withdrewWithTube" && i.severity==="block"));
});

test("a tube still engaged on the holder blocks the withdrawal beforehand too", ()=>{
  const s = stateWith();
  const r = evaluateWithdrawal(s, Object.assign({}, CTX_RELEASED, { tubeOnHolder: true }));
  assert.equal(r.issues.find(i=>i.code==="tubeStillOn").severity, "block");
});

test("withdrawal happens once — further samples do nothing", ()=>{
  const s = stateWith();
  withdrawSmoothly(s, {});
  const at = s.withdrawnAt;
  sampleWithdraw(s, 0.01, 0.01, 0.01);
  assert.equal(s.withdrawnAt, at);
  assert.equal(s.depthM, 0);
});

/* =========================================================================
   SAFETY — the device's own mechanism, in the hand, at once
   ========================================================================= */

test("the safety action is device-specific", ()=>{
  assert.equal(safetyActionFor(DEVICE.STRAIGHT).travel, "shield");
  assert.equal(safetyActionFor(DEVICE.BUTTERFLY).travel, "retract");
});

test("the shield cannot be operated while the needle is still in the patient", ()=>{
  const s = stateWith();
  slideSafety(s, 0.5);
  assert.equal(s.safetyTravel, 0);
});

test("partial travel does not lock; carrying it through does, once", ()=>{
  const s = stateWith();
  doneUpTo(s, "withdraw");
  slideSafety(s, 0.4);
  assert.equal(s.safetyLockedAt, null);
  slideSafety(s, 0.3);
  assert.equal(s.safetyLockedAt, null);
  slideSafety(s, 0.4, null, 5555);
  assert.equal(s.safetyLockedAt, 5555);
  assert.equal(s.safetyFullTravel, true);
  slideSafety(s, 1, null, 9999);
  assert.equal(s.safetyLockedAt, 5555);
});

test("activating against a surface locks the shield but is recorded as itself", ()=>{
  const s = stateWith();
  doneUpTo(s, "withdraw");
  slideSafety(s, 1.001, { surface: true });
  assert.equal(s.surfaceActivated, true);
  assert.ok(s.safetyLockedAt != null);
  const r = evaluateWithdrawal(s, CTX_RELEASED);
  assert.equal(r.issues.find(i=>i.code==="struckOnSurface").severity, "block");
});

test("a recap attempt and an exposed set-down are the two other classic stories", ()=>{
  const s = stateWith();
  doneUpTo(s, "withdraw");
  attemptRecap(s);
  setDownUnit(s);
  const r = evaluateWithdrawal(s, CTX_RELEASED);
  assert.equal(r.issues.find(i=>i.code==="recapAttempted").severity, "block");
  assert.equal(r.issues.find(i=>i.code==="exposedSetDown").severity, "block");
});

test("a set-down AFTER the safety locks is a lesser, different mistake", ()=>{
  const s = stateWith();
  doneUpTo(s, "safety");
  setDownUnit(s);
  assert.equal(s.exposedSetDown, false);
  assert.equal(s.setDownAfterSafety, true);
  assert.equal(evaluateWithdrawal(s, CTX_RELEASED).issues.find(i=>i.code==="shieldedSetDown").severity, "warn");
});

test("exposed time is a real clock from exit to lock", ()=>{
  const s = stateWith();
  doneUpTo(s, "withdraw", 1000);
  const withdrawnAt = s.withdrawnAt;
  slideSafety(s, 1.001, null, withdrawnAt + (SAFETY_IMMEDIATE_S + 3)*1000);
  assert.ok(exposedSeconds(s) > SAFETY_IMMEDIATE_S);
  const r = evaluateWithdrawal(s, CTX_RELEASED);
  assert.ok(r.issues.find(i=>i.code==="safetyDelayed"));
});

/* =========================================================================
   DISPOSE — straight in, whole, not over the patient, nowhere else
   ========================================================================= */

test("the whole sequence done properly is ready, with nothing to say against it", ()=>{
  const s = stateWith();
  doneUpTo(s, "all");
  const r = evaluateWithdrawal(s, CTX_RELEASED);
  assert.equal(r.ready, true);
  assert.equal(r.blocking.length, 0);
  assert.equal(r.issues.filter(i=>i.severity==="warn").length, 0);
});

test("normal waste is refused as a destination and counted", ()=>{
  const s = stateWith();
  doneUpTo(s, "safety");
  disposeUnit(s, { target: "trash" });
  assert.equal(s.disposedAt, null);
  assert.equal(s.trashAttempts, 1);
  const r = evaluateWithdrawal(s, CTX_RELEASED);
  assert.equal(r.issues.find(i=>i.code==="trashAttempted").severity, "block");
  // the recovery is still open: the sharps container still completes it
  disposeUnit(s, { target: "sharps", fully: true });
  assert.ok(s.disposedAt != null);
});

test("disposing with the safety never engaged is recorded as the carry it was", ()=>{
  const s = stateWith();
  doneUpTo(s, "withdraw");
  disposeUnit(s, { target: "sharps", fully: true });
  assert.equal(s.safetyEngagedAtDispose, false);
  const r = evaluateWithdrawal(s, CTX_RELEASED);
  assert.equal(r.issues.find(i=>i.code==="disposedExposed").severity, "block");
  assert.equal(r.ready, false);
});

test("crossing back over the patient and a half-in device are each their own finding", ()=>{
  const s = stateWith();
  doneUpTo(s, "safety");
  markCrossedPatient(s);
  disposeUnit(s, { target: "sharps", fully: false });
  const r = evaluateWithdrawal(s, CTX_RELEASED);
  assert.ok(r.issues.find(i=>i.code==="crossedPatient" && i.severity==="warn"));
  assert.ok(r.issues.find(i=>i.code==="notFullyIn" && i.severity==="warn"));
  assert.equal(r.ready, false);   // resting in the aperture is not disposed
});

test("a dawdled disposal is measured in seconds", ()=>{
  const s = stateWith();
  doneUpTo(s, "safety", 1000);
  disposeUnit(s, { target: "sharps", fully: true }, s.safetyLockedAt + 20000);
  assert.ok(disposalDelaySeconds(s) >= 20);
  assert.ok(evaluateWithdrawal(s, CTX_RELEASED).issues.find(i=>i.code==="disposeDelayed"));
});

/* =========================================================================
   THE FOUR STEP IDS — one module, four finish lines
   ========================================================================= */

test("each step id has its own finish line and they arrive in order", ()=>{
  const s = stateWith();
  const on = { tourniquetReleased: false };
  const off = { tourniquetReleased: true };
  assert.equal(modeReady(s, on, "release"), false);
  doneUpTo(s, "release");
  assert.equal(modeReady(s, off, "release"), true);
  assert.equal(modeReady(s, off, "withdraw"), false);
  doneUpTo(s, "withdraw");
  assert.equal(modeReady(s, off, "withdraw"), true);
  assert.equal(modeReady(s, off, "safety"), false);
  doneUpTo(s, "safety");
  assert.equal(modeReady(s, off, "safety"), true);
  assert.equal(modeReady(s, off, "dispose"), false);
  doneUpTo(s, "all");
  assert.equal(modeReady(s, off, "dispose"), true);
});

test("nextAction speaks to where the learner actually is", ()=>{
  const s = stateWith();
  assert.match(nextAction(s, { tourniquetReleased: false }, "release"), /open their hand/i);
  relaxFist(s);
  assert.match(nextAction(s, { tourniquetReleased: false }, "release"), /tail/i);
  markBandReleased(s, { collectionDone: true });
  assert.match(nextAction(s, { tourniquetReleased: true }, "withdraw"), /gauze/i);
  takeGauze(s, {}); placeGauze(s, { offsetM: 0.01 });
  assert.match(nextAction(s, { tourniquetReleased: true }, "withdraw"), /line it went in/i);
  withdrawSmoothly(s, {});
  assert.match(nextAction(s, { tourniquetReleased: true }, "safety"), /shield/i);
  activateSafetyCleanly(s);
  assert.match(nextAction(s, { tourniquetReleased: true }, "dispose"), /sharps container/i);
});

/* =========================================================================
   SCORING — real numbers, and the encounter fields the recap already reads
   ========================================================================= */

test("an excellent sequence scores at the top with no mistakes named", ()=>{
  const s = stateWith();
  doneUpTo(s, "all");
  const m = measureWithdrawal(s, evaluateWithdrawal(s, CTX_RELEASED), { tourniquetSeconds: 44, tourniquetReleased: true });
  assert.equal(m.mistakes.length, 0);
  assert.ok(m.score >= 95);
  assert.equal(m.criticalEvents.length, 0);
  assert.equal(m.releasedBeforeWithdraw, true);
  assert.equal(m.tourniquetSeconds, 44);
});

test("warning-level technique lands in the middle; unsafe handling near the floor", ()=>{
  const warn = stateWith();
  markBandReleased(warn, { collectionDone: false });   // early, fist never relaxed
  takeGauze(warn, {});                                 // never placed
  withdrawRoughly(warn, {});                           // yanked, off line
  activateSafetyCleanly(warn, warn.withdrawnAt + 1000);
  disposeUnit(warn, { target: "sharps", fully: true });
  const mWarn = measureWithdrawal(warn, evaluateWithdrawal(warn, CTX_RELEASED), { tourniquetReleased: true });
  assert.ok(mWarn.score < 80 && mWarn.score > 35, `got ${mWarn.score}`);
  assert.equal(mWarn.criticalEvents.length, 0);

  const bad = stateWith();
  withdrawSmoothly(bad, { tubeOn: false, tourniquetOn: true });  // band never off
  attemptRecap(bad);
  setDownUnit(bad);                                    // exposed
  disposeUnit(bad, { target: "trash" });
  disposeUnit(bad, { target: "sharps", fully: true }); // still exposed
  const mBad = measureWithdrawal(bad, evaluateWithdrawal(bad, CTX_ON), { tourniquetReleased: false });
  assert.ok(mBad.score < 20, `got ${mBad.score}`);
  assert.ok(mBad.criticalEvents.indexOf("recapAttempted") >= 0);
  assert.ok(mBad.criticalEvents.indexOf("exposedSetDown") >= 0);
  assert.ok(mBad.criticalEvents.indexOf("trashAttempted") >= 0);
  assert.ok(mBad.criticalEvents.indexOf("disposedExposed") >= 0);
});

test("the outcome flags firm up step by step and match what actually happened", ()=>{
  const s = stateWith();
  const c = { tourniquetMeasurements: { positionOk: true, tensionSafe: true, wrappedUnder: true } };
  doneUpTo(s, "release");
  applyWithdrawalOutcome(c, measureWithdrawal(s, evaluateWithdrawal(s, CTX_RELEASED), { tourniquetSeconds: 44, tourniquetReleased: true }));
  assert.equal(c.tqGood, true);
  assert.equal(c.tqSeconds, 44);
  assert.equal(c.withdrawOk, undefined);
  doneUpTo(s, "withdraw");
  applyWithdrawalOutcome(c, measureWithdrawal(s, evaluateWithdrawal(s, CTX_RELEASED), { tourniquetSeconds: 44, tourniquetReleased: true }));
  assert.equal(c.withdrawOk, true);
  assert.equal(c.lastTubeRemoved, true);
  doneUpTo(s, "safety");
  doneUpTo(s, "all");
  applyWithdrawalOutcome(c, measureWithdrawal(s, evaluateWithdrawal(s, CTX_RELEASED), { tourniquetSeconds: 44, tourniquetReleased: true }));
  assert.equal(c.safetyOk, true);
  assert.equal(c.disposeOk, true);
});

test("a band on past the minute mark costs the tourniquet verdict, not the withdrawal's", ()=>{
  const s = stateWith();
  doneUpTo(s, "all");
  const c = {};
  applyWithdrawalOutcome(c, measureWithdrawal(s, evaluateWithdrawal(s, CTX_RELEASED), { tourniquetSeconds: 75, tourniquetReleased: true }));
  assert.equal(c.tqGood, false);
  assert.equal(c.withdrawOk, true);
});

test("a surface activation costs safetyOk even though the shield IS locked", ()=>{
  const s = stateWith();
  doneUpTo(s, "withdraw");
  slideSafety(s, 1.001, { surface: true });
  disposeUnit(s, { target: "sharps", fully: true });
  const c = {};
  applyWithdrawalOutcome(c, measureWithdrawal(s, evaluateWithdrawal(s, CTX_RELEASED), { tourniquetReleased: true }));
  assert.equal(c.safetyOk, false);
  assert.equal(c.disposeOk, true);
});

/* =========================================================================
   SERIALIZATION AND RESET — the state is data and survives a round trip
   ========================================================================= */

test("the state serializes and a round trip judges identically", ()=>{
  const s = stateWith();
  doneUpTo(s, "safety");
  markCrossedPatient(s);
  const back = JSON.parse(JSON.stringify(s));
  const a = evaluateWithdrawal(s, CTX_RELEASED);
  const b = evaluateWithdrawal(back, CTX_RELEASED);
  assert.deepEqual(b.issues.map(i=>i.code), a.issues.map(i=>i.code));
  assert.equal(b.ready, a.ready);
  const ma = measureWithdrawal(s, a, { tourniquetSeconds: 44, tourniquetReleased: true });
  const mb = measureWithdrawal(back, b, { tourniquetSeconds: 44, tourniquetReleased: true });
  assert.equal(mb.score, ma.score);
});

test("a fresh state is a fresh attempt — nothing carries over by accident", ()=>{
  const a = stateWith();
  doneUpTo(a, "all");
  const b = stateWith();
  assert.equal(b.releasedAt, null);
  assert.equal(b.withdrawnAt, null);
  assert.equal(b.safetyTravel, 0);
  assert.equal(b.disposedAt, null);
  assert.equal(b.events.length, 0);
});

/* =========================================================================
   BUTTERFLY — the state carries the device, and the rules speak its language
   ========================================================================= */

test("a butterfly's safety is a retraction, and the rules say so", ()=>{
  const s = stateWith({ device: DEVICE.BUTTERFLY });
  doneUpTo(s, "withdraw");
  const r = evaluateWithdrawal(s, CTX_RELEASED);
  const note = r.issues.find(i=>i.code==="safetyNotEngaged");
  assert.match(note.message, /retract/i);
  slideSafety(s, 1.001);
  assert.ok(s.safetyLockedAt != null);
});
