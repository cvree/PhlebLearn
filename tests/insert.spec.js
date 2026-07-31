/* =========================================================================
   Unit tests for anchor + insert. These assert the CLINICAL claims — anchor
   before you stick, 15-30 degrees, stop inside the vein not through it, a
   rolling vein needs traction to be hit reliably, bevel-up carries forward
   from uncap — not the code that implements them.
   ========================================================================= */
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildVessels, nearestOnVessel } from "../src/venipuncture/arm/armAnatomy.js";
import {
  ANCHOR_DISTAL_MIN, ANCHOR_DISTAL_MAX, ANCHOR_PULL_MIN, ANCHOR_PULL_GOOD,
  ANGLE_IDEAL, ANGLE_ACCEPTABLE, ENTRY_TOLERANCE, THROUGH_MARGIN, BEVEL_TOLERANCE_DEG,
  anchorOffsetFromMark, classifyAnchorPosition, unheldRollOffset,
  depthBand, isInVein, isThroughAndThrough,
  evaluateInsert, nextIssue, nextAction,
} from "../src/venipuncture/insert/insertRules.js";
import {
  createInsertState,
  pressAnchor, pullAnchor, lockAnchor, resetAnchor, anchorAt,
  breakSkin, advance, pullOutCompletely, markFlashIfInVein, insertInto,
} from "../src/venipuncture/insert/insertState.js";
import { measureInsert, applyInsertOutcome } from "../src/venipuncture/insert/insertScoring.js";

const V = buildVessels();
const byId = id => V.find(v => v.id === id);
function mid(id){
  const v = byId(id);
  return v.path[Math.floor(v.path.length/2)];
}

const MC = byId("median-cubital");                 // depth 2.6mm, calibre 4.0mm, compliance 0.10
const MCmid = mid("median-cubital");
const CEPH = byId("cephalic");                      // depth 3.2mm, calibre 3.4mm, compliance 0.55
const CEPHmid = mid("cephalic");

function state(o){
  return createInsertState(Object.assign({ chosenId: "median-cubital", markX: MCmid.x, markZ: MCmid.z }, o || {}));
}

/* ---------- anchor position and pull ----------------------------------------- */

test("distal is the correct side; toward the site is the wrong one", ()=>{
  assert.equal(classifyAnchorPosition(anchorOffsetFromMark(0.010, 0.040)), "ideal");
  assert.equal(classifyAnchorPosition(anchorOffsetFromMark(0.060, 0.040)), "wrongSide", "anchor proximal to the mark");
  assert.equal(classifyAnchorPosition(anchorOffsetFromMark(0.040, 0.040)), "wrongSide", "anchor on top of the mark");
});

test("too close is in the way; too far barely holds", ()=>{
  const markX = 0.040;
  assert.equal(classifyAnchorPosition(anchorOffsetFromMark(markX - (ANCHOR_DISTAL_MIN - 0.003), markX)), "tooClose");
  assert.equal(classifyAnchorPosition(anchorOffsetFromMark(markX - (ANCHOR_DISTAL_MAX + 0.010), markX)), "tooFar");
  assert.equal(classifyAnchorPosition(anchorOffsetFromMark(markX - (ANCHOR_DISTAL_MIN + 0.005), markX)), "ideal");
});

test("weak traction and full traction are different amounts of held", ()=>{
  assert.ok(ANCHOR_PULL_MIN < ANCHOR_PULL_GOOD);
  const noHold = unheldRollOffset(CEPH, 0);
  const halfHold = unheldRollOffset(CEPH, ANCHOR_PULL_GOOD/2);
  const fullHold = unheldRollOffset(CEPH, ANCHOR_PULL_GOOD);
  assert.ok(noHold > halfHold && halfHold > fullHold);
  assert.ok(fullHold < 1e-9, "full traction cancels the roll entirely");
  assert.ok(noHold > 0.002, "an uncorrected compliant vein really does drift a couple of millimetres");
});

test("a vein with almost no compliance barely rolls even unanchored", ()=>{
  assert.ok(unheldRollOffset(MC, 0) < unheldRollOffset(CEPH, 0), "median cubital is the first choice exactly because it doesn't roll");
});

/* ---------- depth window ------------------------------------------------------ */

test("the depth window sits between the near and far walls, with margin", ()=>{
  const b = depthBand(MC);
  assert.ok(Math.abs(b.near - (MC.depth - MC.calibre*0.35)) < 1e-9);
  assert.ok(Math.abs(b.far - (MC.depth + MC.calibre)) < 1e-9);
  assert.equal(isInVein(MC, b.near), true);
  assert.equal(isInVein(MC, b.far), true);
  assert.equal(isInVein(MC, b.near - 0.0005), false, "short of the vein");
  assert.equal(isInVein(MC, b.far + 0.0005), false, "already past the far wall");
  assert.equal(isThroughAndThrough(MC, b.far + THROUGH_MARGIN + 0.0002), true);
  assert.equal(isThroughAndThrough(MC, b.far + THROUGH_MARGIN - 0.0002), false, "just past the wall is not through-and-through yet");
});

/* ---------- evaluateInsert: anchor -------------------------------------------- */

test("nothing about the stick is assessed until the vein is anchored", ()=>{
  const s = state();
  const r = evaluateInsert(s, V, 0);
  assert.deepEqual(r.blocking.map(i=>i.code), ["notAnchored"]);
  assert.equal(r.ready, false);
});

test("a good anchor clears the block; a poor one warns instead", ()=>{
  const good = state();
  anchorAt(good, good.markX - 0.035, ANCHOR_PULL_GOOD);
  let r = evaluateInsert(good, V, 0);
  assert.equal(r.issues.some(i=>i.code==="notAnchored"), false);
  assert.equal(r.issues.length, 0);

  const weak = state();
  anchorAt(weak, weak.markX - 0.035, ANCHOR_PULL_MIN - 0.002);
  r = evaluateInsert(weak, V, 0);
  assert.ok(r.issues.some(i=>i.code==="weakTraction" && i.severity==="warn"));
  assert.equal(r.blocking.length, 0, "weak traction warns, it doesn't block");

  const wrongSide = state();
  anchorAt(wrongSide, wrongSide.markX + 0.020, ANCHOR_PULL_GOOD);
  r = evaluateInsert(wrongSide, V, 0);
  assert.ok(r.issues.some(i=>i.code==="anchorWrongSide"));
});

test("anchoring can be redone right up until the skin is broken", ()=>{
  const s = state();
  anchorAt(s, s.markX - 0.010, ANCHOR_PULL_GOOD);   // too close
  assert.equal(classifyAnchorPosition(anchorOffsetFromMark(s.anchorX, s.markX)), "tooClose");
  resetAnchor(s);
  assert.equal(s.anchorSet, false);
  anchorAt(s, s.markX - 0.035, ANCHOR_PULL_GOOD);   // now ideal
  assert.equal(classifyAnchorPosition(anchorOffsetFromMark(s.anchorX, s.markX)), "ideal");
});

test("once the skin is broken, the anchor is fixed — no more re-anchoring", ()=>{
  const s = state();
  anchorAt(s, s.markX - 0.035, ANCHOR_PULL_GOOD);
  breakSkin(s, s.markX, s.markZ, 20);
  resetAnchor(s);
  assert.equal(s.anchorSet, true, "resetAnchor is a no-op once you're in the skin");
  pressAnchor(s, s.markX - 0.010);
  assert.equal(s.anchorDownX, s.anchorX, "a fresh anchor press is refused too");
});

/* ---------- evaluateInsert: angle ---------------------------------------------- */

function anchoredState(o){
  const s = state(o);
  anchorAt(s, s.markX - 0.035, ANCHOR_PULL_GOOD);
  return s;
}

test("15 to 30 degrees is the clean window; outside 8-42 blocks outright", ()=>{
  const shallow = anchoredState();
  breakSkin(shallow, MCmid.x, MCmid.z, ANGLE_ACCEPTABLE.min - 2);
  assert.ok(evaluateInsert(shallow, V, 0).blocking.some(i=>i.code==="tooShallow"));

  const steep = anchoredState();
  breakSkin(steep, MCmid.x, MCmid.z, ANGLE_ACCEPTABLE.max + 3);
  assert.ok(evaluateInsert(steep, V, 0).blocking.some(i=>i.code==="tooSteep"));

  const offIdeal = anchoredState();
  breakSkin(offIdeal, MCmid.x, MCmid.z, ANGLE_IDEAL.max + 2);
  const r = evaluateInsert(offIdeal, V, 0);
  assert.equal(r.blocking.length, 0);
  assert.ok(r.issues.some(i=>i.code==="angleOffIdeal" && i.severity==="warn"));

  const ideal = anchoredState();
  breakSkin(ideal, MCmid.x, MCmid.z, 20);
  advance(ideal, depthBand(MC).near + 0.0008);
  markFlashIfInVein(ideal, MC, 1000);
  const ri = evaluateInsert(ideal, V, 0);
  assert.equal(ri.issues.some(i=>i.code==="angleOffIdeal"), false);
  assert.equal(ri.ready, true);
});

/* ---------- evaluateInsert: entry position and the roll ------------------------ */

test("dead-centre on the vein hits, whether anchored or not", ()=>{
  const s = anchoredState({ chosenId: "median-cubital" });
  breakSkin(s, MCmid.x, MCmid.z, 20);
  const r = evaluateInsert(s, V, 0);
  assert.equal(r.issues.some(i=>i.code==="missedVein"), false);
});

test("a marginal aim hits when anchored and misses when it isn't — the unheld roll is why", ()=>{
  const dz = 0.004;   // 4mm off the cephalic's centre line; verified against nearestOnVessel below
  assert.ok(Math.abs(nearestOnVessel(CEPH, CEPHmid.x, CEPHmid.z + dz).d - dz) < 1e-9);

  const anchored = state({ chosenId: "cephalic", markX: CEPHmid.x, markZ: CEPHmid.z });
  anchorAt(anchored, anchored.markX - 0.035, ANCHOR_PULL_GOOD);
  breakSkin(anchored, CEPHmid.x, CEPHmid.z + dz, 20);
  const ra = evaluateInsert(anchored, V, 0);
  assert.equal(ra.issues.some(i=>i.code==="missedVein"), false, "held still, the marginal aim still lands");

  const unanchored = state({ chosenId: "cephalic", markX: CEPHmid.x, markZ: CEPHmid.z });
  // never anchor at all
  breakSkin(unanchored, CEPHmid.x, CEPHmid.z + dz, 20);
  const ru = evaluateInsert(unanchored, V, 0);
  assert.ok(ru.blocking.some(i=>i.code==="missedVein"), "unanchored, the same aim misses because the vein rolled clear");
  assert.match(ru.issues.find(i=>i.code==="missedVein").message, /rolls clear/);
});

/* ---------- evaluateInsert: depth and flash ------------------------------------ */

test("short of the vein is a note, not a block — it's still in progress", ()=>{
  const s = anchoredState();
  breakSkin(s, MCmid.x, MCmid.z, 20);
  advance(s, 0.0004);
  const r = evaluateInsert(s, V, 0);
  assert.equal(r.blocking.length, 0);
  assert.ok(r.issues.some(i=>i.code==="notInVeinYet"));
  assert.equal(r.ready, false);
});

test("inside the vessel's own depth band, the flash is real and the step is ready", ()=>{
  const s = anchoredState();
  breakSkin(s, MCmid.x, MCmid.z, 20);
  advance(s, depthBand(MC).near + 0.0006);
  markFlashIfInVein(s, MC, 1000);
  assert.ok(s.flashAt != null);
  const r = evaluateInsert(s, V, 0);
  assert.equal(r.inVein, true);
  assert.equal(r.ready, true);
});

test("through the far wall is a block, not just a worse hit", ()=>{
  const s = anchoredState();
  breakSkin(s, MCmid.x, MCmid.z, 20);
  advance(s, depthBand(MC).far + THROUGH_MARGIN + 0.0005);
  const r = evaluateInsert(s, V, 0);
  assert.ok(r.blocking.some(i=>i.code==="throughAndThrough"));
  assert.equal(r.ready, false);
});

test("pulling back out of a through-and-through recovers it", ()=>{
  const s = anchoredState();
  breakSkin(s, MCmid.x, MCmid.z, 20);
  advance(s, depthBand(MC).far + THROUGH_MARGIN + 0.0005);
  assert.ok(evaluateInsert(s, V, 0).through);
  advance(s, -(depthBand(MC).far + THROUGH_MARGIN - depthBand(MC).near));
  markFlashIfInVein(s, MC, 1000);
  const r = evaluateInsert(s, V, 0);
  assert.equal(r.through, false);
});

test("a plausible depth far from the vein is not a flash — both have to be true together", ()=>{
  const s = anchoredState();
  // an entry point nowhere near the median cubital's path, but at a depth
  // that would be "inside" it if the depth number were judged alone
  breakSkin(s, MCmid.x + 0.05, MCmid.z + 0.05, 20);
  advance(s, depthBand(MC).near + 0.0006);
  markFlashIfInVein(s, MC, 1000);
  assert.equal(s.flashAt, null, "no flash — the tip was never over the vessel");
  const r = evaluateInsert(s, V, 0);
  assert.equal(r.inVein, false);
  assert.ok(r.blocking.some(i=>i.code==="missedVein"));
});

/* ---------- withdrawing all the way out and trying again ------------------------ */

test("backing all the way out clears the entry so a fresh line can be tried", ()=>{
  const s = anchoredState();
  breakSkin(s, MCmid.x, MCmid.z, 20);
  advance(s, 0.002);
  pullOutCompletely(s);
  assert.equal(s.entryX, null);
  assert.equal(s.depthM, 0);
  assert.equal(s.reapproaches, 1);
  assert.equal(s.withdrawnBeforeFlash, true, "it came out before ever flashing");

  // and the anchor is still there — only the needle line resets
  assert.equal(s.anchorSet, true);

  breakSkin(s, MCmid.x, MCmid.z, 20);
  advance(s, depthBand(MC).near + 0.0006);
  markFlashIfInVein(s, MC, 1000);
  assert.equal(evaluateInsert(s, V, 0).ready, true);
});

test("a flash that already happened is not un-recorded by a later withdrawal", ()=>{
  const s = anchoredState();
  breakSkin(s, MCmid.x, MCmid.z, 20);
  advance(s, depthBand(MC).near + 0.0006);
  markFlashIfInVein(s, MC, 1000);
  const flashAt = s.flashAt;
  advance(s, -(depthBand(MC).near + 0.002));
  assert.equal(s.flashAt, flashAt);
  assert.equal(s.withdrawnBeforeFlash, false, "it flashed before it came out");
});

/* ---------- bevel, inherited from uncap ----------------------------------------- */

test("a bevel that never got rolled up blocks the stick outright", ()=>{
  const s = anchoredState();
  breakSkin(s, MCmid.x, MCmid.z, 20);
  advance(s, depthBand(MC).near + 0.0006);
  const r = evaluateInsert(s, V, 180);   // upside down, as an un-rolled uncap would leave it
  assert.ok(r.blocking.some(i=>i.code==="bevelDown"));
  assert.equal(r.ready, false);

  const ok = evaluateInsert(s, V, 5);
  assert.equal(ok.blocking.some(i=>i.code==="bevelDown"), false);
});

test("bevel tolerance matches the angle within which uncap already calls it up", ()=>{
  assert.equal(BEVEL_TOLERANCE_DEG, 25);
});

/* ---------- one continuous insert, for the accessible path and tests ------------ */

test("insertInto() is the same technique the drag uses, in one call", ()=>{
  const s = anchoredState();
  insertInto(s, MCmid.x, MCmid.z, 20, depthBand(MC).near + 0.0006);
  markFlashIfInVein(s, MC, 1000);
  const r = evaluateInsert(s, V, 0);
  assert.equal(r.ready, true);
});

/* ---------- scoring -------------------------------------------------------------- */

test("a clean anchored stick, in range, in the vein, scores high", ()=>{
  const s = anchoredState();
  insertInto(s, MCmid.x, MCmid.z, 20, depthBand(MC).near + 0.0006);
  markFlashIfInVein(s, MC, 1000);
  const r = evaluateInsert(s, V, 5);
  const m = measureInsert(s, r, 5, 2000);
  assert.ok(m.score > 85);
  assert.equal(m.inVein, true);
  assert.equal(m.anchored, true);
  assert.equal(m.bevelUp, true);
  assert.equal(m.angleDeg, 20);
  assert.ok(m.secondsToFlash != null);
});

test("an unanchored through-and-through with the bevel down scores far worse", ()=>{
  const s = state();   // never anchored
  breakSkin(s, MCmid.x, MCmid.z, 20);
  advance(s, depthBand(MC).far + THROUGH_MARGIN + 0.0006);
  const r = evaluateInsert(s, V, 170);
  const m = measureInsert(s, r, 170, 3000);
  assert.ok(m.score < 30);
  assert.equal(m.throughAndThrough, true);
  assert.equal(m.anchored, false);
  assert.equal(m.bevelUp, false);
  assert.ok(m.mistakes.some(x=>x.code==="throughAndThrough"));
  assert.ok(m.mistakes.some(x=>x.code==="notAnchored"));
  assert.ok(m.mistakes.some(x=>x.code==="bevelDown"));
});

test("re-approaching costs something, but landing it still recovers most of the score", ()=>{
  const s = anchoredState();
  breakSkin(s, MCmid.x, MCmid.z, 5);   // too shallow, misses
  advance(s, 0.001);
  pullOutCompletely(s);
  insertInto(s, MCmid.x, MCmid.z, 20, depthBand(MC).near + 0.0006);
  markFlashIfInVein(s, MC, 1000);
  const r = evaluateInsert(s, V, 0);
  const m = measureInsert(s, r, 0);
  assert.equal(r.ready, true);
  assert.equal(m.reapproaches, 1);
  assert.ok(m.score > 70);
});

test("the outcome folds onto the procedure's own chip honestly", ()=>{
  const good = {};
  const s1 = anchoredState();
  insertInto(s1, MCmid.x, MCmid.z, 20, depthBand(MC).near + 0.0006);
  markFlashIfInVein(s1, MC, 1000);
  applyInsertOutcome(good, measureInsert(s1, evaluateInsert(s1, V, 0), 0));
  assert.equal(good.insertOk, true);

  const bad = {};
  const s2 = anchoredState();
  insertInto(s2, MCmid.x, MCmid.z, 20, depthBand(MC).near + 0.0006);
  markFlashIfInVein(s2, MC, 1000);
  // in the vein, but the bevel was never rolled up — still not a clean stick
  applyInsertOutcome(bad, measureInsert(s2, evaluateInsert(s2, V, 170), 170));
  assert.equal(bad.insertOk, false);
});

/* ---------- next-action copy tracks the actual state ---------------------------- */

test("nextAction names the next physical thing to do", ()=>{
  const s0 = state();
  assert.match(nextAction(s0), /[Aa]nchor/);
  const s1 = anchoredState();
  assert.match(nextAction(s1), /needle|angle/i);
  breakSkin(s1, MCmid.x, MCmid.z, 20);
  advance(s1, 0.0004);
  assert.match(nextAction(s1, evaluateInsert(s1, V, 0)), /further in/);
  advance(s1, depthBand(MC).near + 0.0006 - 0.0004);
  markFlashIfInVein(s1, MC, 1000);
  assert.match(nextAction(s1, evaluateInsert(s1, V, 0)), /[Ff]lash/);
});

test("nextIssue surfaces the most severe issue first", ()=>{
  const s = state();
  const r = evaluateInsert(s, V, 0);
  assert.equal(nextIssue(r).code, "notAnchored");
});

/* =========================================================================
   THE ANGLE AND ANCHOR WINDOWS ARE PARAMETERS — the butterfly/dorsal-hand
   procedure enters at 5-15 degrees with a much closer anchor, not the
   antecubital's 15-30 degrees and inch-and-a-half. Every call defaults to
   the antecubital numbers, so the tests above are untouched; these assert
   the override path.
   ========================================================================= */
import { DEFAULT_ANGLE_BAND, DEFAULT_ANCHOR_BAND, anglePresetsFor, anchorPresetsFor } from "../src/venipuncture/insert/insertRules.js";

const HAND_ANGLE = { ideal: { min: 5, max: 15 }, acceptable: { min: 3, max: 22 } };
const HAND_ANCHOR = { distalMin: 0.008, distalMax: 0.030, pullMin: 0.004, pullGood: 0.008 };

test("DEFAULT_ANGLE_BAND and DEFAULT_ANCHOR_BAND are exactly the antecubital constants", () => {
  assert.deepEqual(DEFAULT_ANGLE_BAND, { ideal: ANGLE_IDEAL, acceptable: ANGLE_ACCEPTABLE });
  assert.deepEqual(DEFAULT_ANCHOR_BAND, {
    distalMin: ANCHOR_DISTAL_MIN, distalMax: ANCHOR_DISTAL_MAX,
    pullMin: ANCHOR_PULL_MIN, pullGood: ANCHOR_PULL_GOOD,
  });
});

function anchoredAt10Deg(){
  const s = state({});
  anchorAt(s, MCmid.x - 0.035, ANCHOR_PULL_GOOD);
  insertInto(s, MCmid.x, MCmid.z, 10, MC.depth);
  return s;
}

test("a 10 degree entry is outside the antecubital window and inside the hand-draw one", () => {
  const s = anchoredAt10Deg();
  const antecubital = evaluateInsert(s, V, 0);
  const hand = evaluateInsert(s, V, 0, HAND_ANGLE);
  assert.ok(antecubital.issues.some(i => i.code === "angleOffIdeal" || i.code === "tooShallow"));
  assert.ok(!hand.issues.some(i => i.code === "angleOffIdeal" || i.code === "tooShallow"));
});

test("measureInsert's angle mistake and score use the SAME band evaluateInsert was judged against", () => {
  const s = anchoredAt10Deg();
  const antecubital = measureInsert(s, evaluateInsert(s, V, 0), 0, 1000);
  const hand = measureInsert(s, evaluateInsert(s, V, 0, HAND_ANGLE), 0, 1000, HAND_ANGLE);
  assert.ok(antecubital.mistakes.some(m => m.code === "angle"));
  assert.ok(!hand.mistakes.some(m => m.code === "angle"));
  assert.ok(hand.score > antecubital.score);
});

test("a close, firm anchor is ideal for a hand draw and too close for the antecubital", () => {
  // 15mm distal — inside the hand window (8-30mm), below the antecubital one (20-60mm)
  const offset = 0.015;
  assert.equal(classifyAnchorPosition(offset), "tooClose");
  assert.equal(classifyAnchorPosition(offset, HAND_ANCHOR), "ideal");
});

test("anglePresetsFor and anchorPresetsFor derive concrete numbers from whatever band they are given", () => {
  const straight = anglePresetsFor();
  assert.equal(straight.ideal, 23);   // (15+30)/2, rounded
  assert.equal(straight.shallow, 5);  // 8-3
  assert.equal(straight.steep, 45);   // 42+3
  const hand = anglePresetsFor(HAND_ANGLE);
  assert.equal(hand.ideal, 10);
  assert.equal(hand.shallow, 0);
  assert.equal(hand.steep, 25);

  const anchorHand = anchorPresetsFor(HAND_ANCHOR);
  assert.ok(anchorHand.idealM > HAND_ANCHOR.distalMin && anchorHand.idealM < HAND_ANCHOR.distalMax);
  assert.equal(anchorHand.pullGoodM, HAND_ANCHOR.pullGood);
});

test("unheldRollOffset's roll-cancelling pull threshold moves with the band it is given", () => {
  const rolling = byId("cephalic");
  const antecubitalFullyHeld = unheldRollOffset(rolling, ANCHOR_PULL_GOOD);
  const handFullyHeld = unheldRollOffset(rolling, HAND_ANCHOR.pullGood, HAND_ANCHOR);
  assert.equal(antecubitalFullyHeld, 0);
  assert.equal(handFullyHeld, 0);
  // the antecubital's own pullGood is nowhere near enough to fully hold
  // still under the hand band's (much smaller) threshold's assumptions
  assert.ok(unheldRollOffset(rolling, HAND_ANCHOR.pullGood) > 0);
});

test("an insert measurement taken with no band override is unchanged from before", () => {
  const s = state({});
  anchorAt(s, MCmid.x - 0.035, ANCHOR_PULL_GOOD);
  insertInto(s, MCmid.x, MCmid.z, 20, MC.depth);
  const m = measureInsert(s, evaluateInsert(s, V, 0), 0, 1000);
  assert.equal(m.angleDeg, 20);
  assert.ok(!m.mistakes.some(x => x.code === "angle"));
});
