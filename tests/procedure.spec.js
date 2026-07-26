/* Unit tests for the venipuncture sequencing rules — pure logic, no browser
   needed (run via `npm test`, node's built-in test runner). These are the
   regression tests for the "urgent sequencing bugs" fixed in Phase 0:
   canonical rule is checked via explicit named state fields, never via
   matching words in question text. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  canReleaseTourniquet, canWithdrawNeedle, canActivateSafety,
  canDisposeSharps, canApplyPressure, canApplyBandage, canInvertTube,
} from "../src/venipuncture/clinicalRules.js";
import { buildStepSequence, VP_STEP_DEFS, getStepDef } from "../src/venipuncture/procedureState.js";

test("tourniquet release is gated behind confirmed blood flash, not a timer alone", () => {
  assert.equal(canReleaseTourniquet({ insertOk: false }), false, "must block release before blood flash");
  assert.equal(canReleaseTourniquet({}), false, "must block release when insertOk is unset");
  assert.equal(canReleaseTourniquet({ insertOk: true }), true, "must allow release once blood flash is confirmed");
});

test("needle withdrawal is gated behind the last tube being removed", () => {
  assert.equal(canWithdrawNeedle({ lastTubeRemoved: false }), false);
  assert.equal(canWithdrawNeedle({}), false);
  assert.equal(canWithdrawNeedle({ lastTubeRemoved: true }), true);
});

test("safety-device activation is gated behind the needle actually being withdrawn", () => {
  assert.equal(canActivateSafety({ withdrawOk: false }), false);
  assert.equal(canActivateSafety({ withdrawOk: true }), true);
});

test("sharps disposal is gated behind the safety device being engaged, and comes before pressure/bandage", () => {
  assert.equal(canDisposeSharps({ safetyOk: false }), false);
  assert.equal(canDisposeSharps({ safetyOk: true }), true);
});

test("pressure may only be applied after the sharps unit is disposed of", () => {
  assert.equal(canApplyPressure({ disposeOk: false }), false, "pressure before disposal must be blocked");
  assert.equal(canApplyPressure({ disposeOk: true }), true);
});

test("bandaging may only happen after pressure has been held", () => {
  assert.equal(canApplyBandage({ pressureOk: false }), false);
  assert.equal(canApplyBandage({ pressureOk: true }), true);
});

test("a tube can only be inverted once it is both filled and off the patient", () => {
  assert.equal(canInvertTube({ filled: [], withdrawOk: true }, "red"), false, "unfilled tube must never be invertible");
  assert.equal(canInvertTube({ filled: ["red"], withdrawOk: false }, "red"), false, "must block inversion while draw is still in progress");
  assert.equal(canInvertTube({ filled: ["red"], withdrawOk: true }, "red"), true);
  assert.equal(canInvertTube({ filled: ["lavender"], withdrawOk: true }, "red"), false, "must check the SPECIFIC tube, not just that something is filled");
});

test("the canonical step order disposes sharps before pressure and bandage (point-of-use disposal)", () => {
  const order = VP_STEP_DEFS.map(d => d.id);
  const iSafety = order.indexOf("safety");
  const iDispose = order.indexOf("dispose");
  const iPressure = order.indexOf("pressure");
  const iBandage = order.indexOf("bandage");
  assert.ok(iSafety < iDispose, "safety must come before dispose");
  assert.ok(iDispose < iPressure, "dispose must come before pressure — point-of-use disposal");
  assert.ok(iPressure < iBandage, "pressure must come before bandage");
});

test("the canonical step order withdraws the needle only after it's gated, and inverts last", () => {
  const order = VP_STEP_DEFS.map(d => d.id);
  assert.ok(order.indexOf("withdraw") < order.indexOf("safety"));
  assert.equal(order[order.length - 1], "invert");
});

test("every step def has a stable id, a phase, and a trigger (typed procedure-state interface)", () => {
  for(const def of VP_STEP_DEFS){
    assert.equal(typeof def.id, "string");
    assert.equal(typeof def.phase, "string");
    assert.equal(typeof def.trigger, "string");
    assert.equal(typeof def.requiredState, "object");
  }
});

test("buildStepSequence excludes the tube-switch step for single-tube draws", () => {
  const seq = buildStepSequence(1);
  assert.ok(!seq.includes("switch"), "single-tube draws never need to switch tubes");
});

test("buildStepSequence includes the tube-switch step for multi-tube draws", () => {
  const seq = buildStepSequence(3);
  assert.ok(seq.includes("switch"), "multi-tube draws must switch tubes in order of draw");
});

test("getStepDef resolves a known id and returns null for an unknown one", () => {
  assert.equal(getStepDef("invert").phase, "postDraw");
  assert.equal(getStepDef("not-a-real-step"), null);
});
