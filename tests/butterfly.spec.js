/* =========================================================================
   THE WINGED SET, AND WHICH DRAW THIS IS — unit tests.

   Three things make the butterfly/dorsal-hand draw a genuinely different
   procedure rather than the same animation with a different model, and each
   gets its own section here:

     1. procedure.js — the numbers themselves differ, and every consumer
        reads them through procedureFor() rather than a hard-coded constant.
     2. the dorsal-hand vessel geometry — real veins, real depths, sitting
        on the SAME limb surface every other step already projects against.
     3. the wings-and-tubing physics — a real grip that determines the entry
        angle, a real line whose slack absorbs a pull and whose tautness
        transmits one, and a real, quiet, missable infiltration.

   No DOM, no THREE.
   ========================================================================= */
import test from "node:test";
import assert from "node:assert/strict";

import {
  PROCEDURE, PROCEDURES, DEFAULT_PROCEDURE, procedureFor, isButterfly, indicatedProcedure,
} from "../src/venipuncture/procedure.js";
import {
  radiusAt, buildHandVessels, HAND_SITE, HAND_X, WRIST_X, isDrawableVein, VESSEL_KIND,
} from "../src/venipuncture/arm/armAnatomy.js";
import {
  WINGS, angleHeldBy, tipShiftFromTubing, infiltrationFrom, isTaut, slackOf,
  evaluateButterfly, nextAction, SWELLING_VISIBLE_ML, NOTICE_WITHIN_S,
} from "../src/venipuncture/butterfly/butterflyRules.js";
import {
  createButterflyState, pickUpByWings, pickUpByTubing, layWingsFlat, releaseWings,
  secureWings, unsecureWings, layTubing, disturb, enter, drawFor, noticeInfiltration,
  stopForInfiltration, secondsToNotice,
} from "../src/venipuncture/butterfly/butterflyState.js";
import { measureButterfly, applyButterflyOutcome } from "../src/venipuncture/butterfly/butterflyScoring.js";

/* -------------------------------------------------------------------------
   1. THE PROCEDURE MODEL
   ------------------------------------------------------------------------- */

test("the two procedures differ in device, site, gauge and angle window", () => {
  const straight = procedureFor(PROCEDURE.STRAIGHT_ANTECUBITAL);
  const butterfly = procedureFor(PROCEDURE.BUTTERFLY_HAND);
  assert.notEqual(straight.device, butterfly.device);
  assert.notEqual(straight.siteKind, butterfly.siteKind);
  assert.notEqual(straight.gauge, butterfly.gauge);
  assert.notDeepEqual(straight.angle, butterfly.angle);
  assert.equal(straight.tubing, null);
  assert.ok(butterfly.tubing);
});

test("the butterfly's angle window sits entirely below the antecubital's", () => {
  const straight = procedureFor(PROCEDURE.STRAIGHT_ANTECUBITAL).angle;
  const butterfly = procedureFor(PROCEDURE.BUTTERFLY_HAND).angle;
  assert.ok(butterfly.ideal.max <= straight.ideal.min);
});

test("procedureFor defaults to the straight draw for an unknown id", () => {
  assert.equal(procedureFor("not-a-real-procedure").id, DEFAULT_PROCEDURE);
  assert.equal(procedureFor(undefined).id, DEFAULT_PROCEDURE);
});

test("isButterfly reads the device, not the id string", () => {
  assert.equal(isButterfly(PROCEDURE.BUTTERFLY_HAND), true);
  assert.equal(isButterfly(PROCEDURE.STRAIGHT_ANTECUBITAL), false);
});

test("indicatedProcedure reads the patient's own arms, from trigger data — never guesses", () => {
  const flatArmed = { site: { arms: { left: { key: "dry" }, right: { key: "clear" } } } };
  const clear = { site: { arms: { left: { key: "clear" }, right: { key: "clear" } } } };
  const child = { ageCat: "Child", site: { arms: { left: { key: "clear" }, right: { key: "clear" } } } };
  const noSite = {};
  assert.equal(indicatedProcedure(flatArmed), PROCEDURE.BUTTERFLY_HAND);
  assert.equal(indicatedProcedure(clear), PROCEDURE.STRAIGHT_ANTECUBITAL);
  assert.equal(indicatedProcedure(child), PROCEDURE.BUTTERFLY_HAND);
  assert.equal(indicatedProcedure(noSite), PROCEDURE.STRAIGHT_ANTECUBITAL);
});

test("both procedures' band windows are real, ordered ranges", () => {
  for(const id of Object.keys(PROCEDURES)){
    const p = PROCEDURES[id];
    assert.ok(p.bandIdealM.min < p.bandIdealM.max, `${id} ideal band`);
    assert.ok(p.bandAcceptableM.min <= p.bandIdealM.min, `${id} acceptable band`);
    assert.ok(p.bandAcceptableM.max >= p.bandIdealM.max, `${id} acceptable band`);
  }
});

/* -------------------------------------------------------------------------
   2. THE DORSAL-HAND GEOMETRY
   ------------------------------------------------------------------------- */

test("every dorsal-hand vessel sits inside the limb it is drawn on", () => {
  for(const v of buildHandVessels()){
    for(const p of v.path){
      const r = radiusAt(p.x, 1);
      assert.ok(r > v.depth + v.calibre, `${v.id} at x=${p.x} does not fit: r=${r}`);
      // and within the mesh's actual addressable range — HAND_X..WRIST_X —
      // not off the end of the geometry buildLimbGeometry() actually builds
      assert.ok(p.x > HAND_X && p.x < WRIST_X, `${v.id} at x=${p.x} is outside HAND_X..WRIST_X`);
    }
  }
});

test("the dorsal-hand veins are shallower, narrower and roll more than the forearm's", () => {
  const hand = buildHandVessels().filter(v => v.kind === VESSEL_KIND.VEIN);
  for(const v of hand){
    assert.ok(v.depth < 0.0026, `${v.id} is as deep as the median cubital`);
    assert.ok(v.calibre < 0.0034, `${v.id} is as wide as the cephalic`);
    assert.ok(v.compliance >= 0.5, `${v.id} rolls as little as the median cubital`);
  }
});

test("three hand veins are drawable and the tendon is not", () => {
  const vessels = buildHandVessels();
  const veins = vessels.filter(v => v.kind === VESSEL_KIND.VEIN);
  assert.equal(veins.length, 3);
  assert.ok(veins.every(isDrawableVein));
  assert.ok(!isDrawableVein(vessels.find(v => v.kind === VESSEL_KIND.TENDON)));
});

test("exactly one hand vein is marked preferred, and HAND_SITE sits on it", () => {
  const vessels = buildHandVessels();
  const preferred = vessels.filter(v => v.preferred);
  assert.equal(preferred.length, 1);
  const near = preferred[0].path.some(p => Math.abs(p.x - HAND_SITE.x) < 0.005 && Math.abs(p.z - HAND_SITE.z) < 0.01);
  assert.ok(near, "HAND_SITE is not near the preferred vein's path");
});

/* -------------------------------------------------------------------------
   3. THE WINGS
   ------------------------------------------------------------------------- */

test("pinched wings hold the tip at its entry angle; flat wings hold it near level", () => {
  assert.equal(angleHeldBy(WINGS.PINCHED, 12), 12);
  assert.ok(angleHeldBy(WINGS.FLAT, 12) < 12);
});

test("carrying the set by the wings vs. by the tubing is a real, opposite choice", () => {
  const byWings = createButterflyState({});
  pickUpByWings(byWings);
  assert.equal(byWings.wingsHeld, true);
  assert.equal(byWings.wings, WINGS.PINCHED);

  const byTubing = createButterflyState({});
  pickUpByTubing(byTubing);
  assert.equal(byTubing.wingsHeld, false);
  assert.equal(byTubing.wings, WINGS.LOOSE);
});

test("the wings cannot be laid flat before the set has been picked up", () => {
  const s = createButterflyState({});
  layWingsFlat(s);
  assert.notEqual(s.wings, WINGS.FLAT);
});

test("wings held then laid flat after entry is the correct sequence", () => {
  const s = createButterflyState({});
  pickUpByWings(s);
  enter(s, 10, { now: 1000 });
  layWingsFlat(s);
  assert.equal(s.wings, WINGS.FLAT);
  assert.equal(s.entryAngleDeg, 10);
});

/* -------------------------------------------------------------------------
   THE TUBING IS A LEVER
   ------------------------------------------------------------------------- */

test("slack absorbs the first part of a pull; a taut line absorbs none of it", () => {
  const spec = procedureFor(PROCEDURE.BUTTERFLY_HAND).tubing;
  const loose = { slackM: spec.slackGoodM, secured: false };
  const taut = { slackM: 0, secured: false };
  assert.equal(tipShiftFromTubing(loose, spec, { pullM: 0.01 }) <
               tipShiftFromTubing(taut, spec, { pullM: 0.01 }), true);
});

test("securing the wings cuts the transmitted pull by roughly the documented factor", () => {
  const spec = procedureFor(PROCEDURE.BUTTERFLY_HAND).tubing;
  const unsecured = { slackM: 0, secured: false };
  const secured = { slackM: 0, secured: true };
  const a = tipShiftFromTubing(unsecured, spec, { pullM: 0.05 });
  const b = tipShiftFromTubing(secured, spec, { pullM: 0.05 });
  assert.ok(a > 0 && b > 0);
  assert.ok(a / b > 5, `expected roughly a 9x factor, got ${a / b}x`);
});

test("isTaut reflects the line's own slackTautM threshold, not a fixed number", () => {
  const spec = procedureFor(PROCEDURE.BUTTERFLY_HAND).tubing;
  assert.equal(isTaut({ slackM: spec.slackTautM * 0.5 }, spec), true);
  assert.equal(isTaut({ slackM: spec.slackGoodM }, spec), false);
});

test("disturb() moves the tip and logs the disturbance with its cause", () => {
  const s = createButterflyState({ calibreM: 0.002 });
  pickUpByWings(s); enter(s, 10, {}); layWingsFlat(s);
  layTubing(s, 0.03);
  const shift = disturb(s, { pullM: 0.05, swingDeg: 20, cause: "takeTube" });
  assert.ok(shift > 0);
  assert.equal(s.tipOffsetM, shift);
  assert.equal(s.peakTipOffsetM, shift);
  assert.equal(s.disturbances[0].cause, "takeTube");
});

test("a fully-absorbed disturbance (well inside slack, taped down) does not move the tip", () => {
  const s = createButterflyState({});
  pickUpByWings(s); enter(s, 10, {}); layWingsFlat(s);
  secureWings(s, {});
  layTubing(s, 0.03);
  const shift = disturb(s, { pullM: 0.01 });
  assert.equal(shift, 0);
  assert.equal(s.tipOffsetM, 0);
});

/* -------------------------------------------------------------------------
   INFILTRATION IS QUIET
   ------------------------------------------------------------------------- */

test("infiltration only starts once the tip is genuinely outside the lumen wall", () => {
  const inside = infiltrationFrom(0.0002, 0.002);
  const outside = infiltrationFrom(0.0025, 0.002);
  assert.equal(inside.infiltrating, false);
  assert.equal(outside.infiltrating, true);
});

test("flow drops but does not stop while infiltrating — that is why it gets missed", () => {
  const r = infiltrationFrom(0.003, 0.002);
  assert.ok(r.flowFraction > 0 && r.flowFraction < 1);
});

test("drawFor() accrues real millilitres into the tissue while the tip is out of the lumen", () => {
  const s = createButterflyState({ calibreM: 0.002 });
  pickUpByWings(s); enter(s, 10, { now: 1000 });
  s.tipOffsetM = 0.003;
  // the swelling clock starts the moment infiltrating time is first
  // accrued, not the moment the needle went in — those can be far apart
  drawFor(s, 5, { now: 6000 });
  assert.ok(s.infiltratedMl > 0);
  assert.equal(s.infiltrationStartedAt, 6000);
});

test("noticing infiltration and stopping are two separate, sequential actions", () => {
  const s = createButterflyState({ calibreM: 0.002 });
  pickUpByWings(s); enter(s, 10, { now: 1000 });
  s.tipOffsetM = 0.003;
  drawFor(s, 3, { now: 4000 });                  // infiltrationStartedAt = 4000
  assert.equal(s.infiltrationNoticed, false);
  stopForInfiltration(s);                       // cannot stop for something not yet noticed
  assert.equal(s.stoppedOnInfiltration, false);
  noticeInfiltration(s, { now: 5000 });
  assert.equal(s.infiltrationNoticed, true);
  assert.equal(secondsToNotice(s, 5000), 1);
  stopForInfiltration(s);
  assert.equal(s.stoppedOnInfiltration, true);
});

/* -------------------------------------------------------------------------
   MEASUREMENT AND SCORING
   ------------------------------------------------------------------------- */

function textbook(){
  const s = createButterflyState({ calibreM: 0.002 });
  pickUpByWings(s);
  enter(s, 10, { now: 1000 });
  layWingsFlat(s);
  secureWings(s, { now: 1500 });
  layTubing(s, procedureFor(PROCEDURE.BUTTERFLY_HAND).tubing.slackGoodM);
  return s;
}

test("a textbook handling of the set is ready and scores at the top", () => {
  const s = textbook();
  const r = evaluateButterfly(s, {});
  assert.equal(r.ready, true, r.issues.map(i => i.code).join(","));
  const m = measureButterfly(s, r, { now: 2000 });
  assert.equal(m.criticalEvents.length, 0);
  assert.ok(m.score >= 90, `scored ${m.score}`);
});

test("carrying the set by the tubing is a critical event", () => {
  const s = createButterflyState({});
  pickUpByTubing(s);
  enter(s, 10, { now: 1000 });
  const m = measureButterfly(s, evaluateButterfly(s, {}));
  assert.ok(m.criticalEvents.includes("carriedByTubing"));
});

test("a taut, unsecured line is a critical event and blocks readiness", () => {
  const s = textbook();
  unsecureWings(s);
  layTubing(s, 0.002);   // well inside slackTautM
  const r = evaluateButterfly(s, {});
  assert.equal(r.ready, false);
  const m = measureButterfly(s, r);
  assert.ok(m.criticalEvents.includes("tubingTaut"));
});

test("a swelling that was never noticed is a critical event named for what it is", () => {
  const s = textbook();
  s.tipOffsetM = 0.003;
  drawFor(s, 10, { now: 11500 });
  assert.ok(s.infiltratedMl >= SWELLING_VISIBLE_ML);
  const m = measureButterfly(s, evaluateButterfly(s, {}), { now: 11500 });
  assert.ok(m.criticalEvents.includes("infiltrationMissed"));
});

test("noticing late is a lesser mistake than never noticing at all", () => {
  const s = textbook();
  s.tipOffsetM = 0.003;
  drawFor(s, 10, { now: 11500 });
  noticeInfiltration(s, { now: 11500 + (NOTICE_WITHIN_S + 5) * 1000 });
  stopForInfiltration(s);
  const m = measureButterfly(s, evaluateButterfly(s, {}), { now: 11500 + (NOTICE_WITHIN_S + 5) * 1000 });
  assert.ok(!m.criticalEvents.includes("infiltrationMissed"));
  assert.ok(m.mistakes.some(x => x.code === "infiltrationLate"));
});

test("recognising infiltration and continuing anyway is its own critical event", () => {
  const s = textbook();
  s.tipOffsetM = 0.003;
  drawFor(s, 2, { now: 3500 });
  noticeInfiltration(s, { now: 3500 });
  const m = measureButterfly(s, evaluateButterfly(s, {}), { now: 3500 });
  assert.ok(m.criticalEvents.includes("infiltrationNotActedOn"));
});

test("evaluateButterfly reports underDrawn against the procedure's own minimum", () => {
  const s = textbook();
  const short = evaluateButterfly(s, { collectionDoneMl: 0.4, requiredMl: 1.0 });
  assert.ok(short.issues.some(i => i.code === "underDrawn"));
  const enough = evaluateButterfly(s, { collectionDoneMl: 1.2, requiredMl: 1.0 });
  assert.ok(!enough.issues.some(i => i.code === "underDrawn"));
});

test("the measurement carries every field the rubric row needs", () => {
  const m = measureButterfly(textbook(), evaluateButterfly(textbook(), {}));
  for(const field of ["entryAngleDeg", "carriedByWings", "wingsLaidFlat", "wingsSecured",
    "tubingSlackMm", "tubingTaut", "disturbancesTransmitted", "disturbancesWhileLoose",
    "peakTipOffsetMm", "infiltratedMl", "infiltrationNoticed", "secondsToNotice",
    "stoppedOnInfiltration", "score", "mistakes", "criticalEvents", "narrative"]){
    assert.notEqual(m[field], undefined, `missing field ${field}`);
  }
});

test("applyButterflyOutcome sets butterflyOk only when the whole handling was clean", () => {
  const good = {};
  applyButterflyOutcome(good, measureButterfly(textbook(), evaluateButterfly(textbook(), {})));
  assert.equal(good.butterflyOk, true);

  const bad = {};
  const s = createButterflyState({});
  pickUpByTubing(s);
  enter(s, 10, { now: 1000 });
  applyButterflyOutcome(bad, measureButterfly(s, evaluateButterfly(s, {})));
  assert.equal(bad.butterflyOk, false);
});

test("nextAction moves through pick-up, entry, wings-flat and taping in order", () => {
  const s = createButterflyState({});
  assert.match(nextAction(s), /pinch the wings/i);
  pickUpByWings(s);
  assert.match(nextAction(s), /go in/i);
  enter(s, 10, {});
  assert.match(nextAction(s), /lay the wings flat/i);
  layWingsFlat(s);
  assert.match(nextAction(s), /tape/i);
});

test("the whole trio is idempotent-safe: re-measuring after collection only firms up the reading", () => {
  const s = textbook();
  const partial = measureButterfly(s, evaluateButterfly(s, {}));
  disturb(s, { pullM: 0.05, cause: "takeTube" });
  const final = measureButterfly(s, evaluateButterfly(s, {}));
  assert.ok(final.disturbances >= partial.disturbances);
  assert.ok(final.peakTipOffsetMm >= partial.peakTipOffsetMm);
});
