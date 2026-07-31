/* =========================================================================
   Unit tests for the arm geometry and the tourniquet's clinical rules.

   These assert the CLINICAL numbers, not the implementation: 3-4 inches above
   the site, the tension window that fills veins without stopping arterial
   inflow, the one-minute rule, and the four ways an application can be wrong.
   If a threshold here changes, a real teaching claim has changed with it.
   ========================================================================= */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  radiusAt, circumferenceAt, classifyBandPosition, distanceAboveSite,
  metresToInches, BAND_IDEAL, BAND_ACCEPTABLE, SITE,
  buildVessels, mirrorForArm, applyPatientVariation, nearestOnVessel,
  vesselsNear, isDrawableVein, VESSEL_KIND,
  veinDistension, distalPallor, hasRadialPulse, TENSION,
} from "../src/venipuncture/arm/armAnatomy.js";

import {
  createTourniquetState, markRouted, setTension, markCrossed, markSecured,
  markUnravelled, markReleased, secondsOn, isSecured, isOnPatient,
  heightAboveSite, PHASE, WRAP, TUCK,
} from "../src/venipuncture/tourniquet/tourniquetState.js";

import {
  evaluateTourniquet, checkPosition, checkWrap, checkTension, checkTuck,
  checkTime, checkSkew, nextIssue, nextAction, TIME, SKEW_LIMIT,
} from "../src/venipuncture/tourniquet/tourniquetRules.js";

import { measureTourniquet, applyTourniquetOutcome } from "../src/venipuncture/tourniquet/tourniquetScoring.js";

/* ---------- helpers --------------------------------------------------------- */

const ARM = { vessels: buildVessels(), vigour: 1 };

/** A textbook application, so each test can spoil exactly one thing. */
function goodBand(overrides){
  const o = overrides || {};
  const s = createTourniquetState({ armSide: "right" });
  markRouted(s, {
    bandX: o.bandX == null ? 0.089 : o.bandX,
    wrap: o.wrap || WRAP.UNDER,
    skew: o.skew == null ? 0 : o.skew,
  });
  setTension(s, o.tension == null ? 0.55 : o.tension);
  markCrossed(s);
  markSecured(s, {
    tuck: o.tuck || TUCK.PROXIMAL,
    tuckedUnder: o.tuckedUnder === undefined ? true : o.tuckedUnder,
    at: o.at == null ? Date.now() : o.at,
  });
  return s;
}

/* =========================================================================
   ARM GEOMETRY
   ========================================================================= */

test("the limb tapers from shoulder to wrist", ()=>{
  assert.ok(radiusAt(0.18) > radiusAt(0.0), "upper arm is thicker than the fossa");
  assert.ok(radiusAt(0.0) > radiusAt(-0.20), "the fossa is thicker than the wrist");
});

test("a larger build scales the limb", ()=>{
  assert.ok(radiusAt(0.089, 1.25) > radiusAt(0.089, 0.85));
  assert.ok(circumferenceAt(0.089, 1.25) > circumferenceAt(0.089, 1.0));
});

test("3-4 inches really is 3-4 inches", ()=>{
  assert.ok(Math.abs(metresToInches(BAND_IDEAL.min) - 3) < 0.05, "ideal min ≈ 3in");
  assert.ok(Math.abs(metresToInches(BAND_IDEAL.max) - 4) < 0.05, "ideal max ≈ 4in");
});

test("band position is classified by real distance from the site", ()=>{
  assert.equal(classifyBandPosition(0.089), "ideal");
  assert.equal(classifyBandPosition(0.070), "acceptableLow");
  assert.equal(classifyBandPosition(0.110), "acceptableHigh");
  assert.equal(classifyBandPosition(0.040), "tooLow");
  assert.equal(classifyBandPosition(0.160), "tooHigh");
  assert.equal(classifyBandPosition(0.004), "onSite");
  assert.equal(classifyBandPosition(-0.030), "distal");
});

test("distance above the site is signed from the fossa", ()=>{
  assert.equal(distanceAboveSite(0.089), 0.089 - SITE.x);
  assert.ok(distanceAboveSite(-0.02) < 0, "below the fossa is negative");
});

/* ---------- vessels --------------------------------------------------------- */

test("the median cubital is the shallowest, best-anchored vein", ()=>{
  const v = buildVessels();
  const median = v.find(x=>x.id === "median-cubital");
  const basilic = v.find(x=>x.id === "basilic");
  const cephalic = v.find(x=>x.id === "cephalic");
  assert.ok(median.depth < basilic.depth, "median cubital is shallower than basilic");
  assert.ok(median.compliance < cephalic.compliance, "median cubital rolls less");
  assert.equal(median.preferred, true);
});

test("the artery and the nerve are deeper than every drawable vein", ()=>{
  const v = buildVessels();
  const artery = v.find(x=>x.kind === VESSEL_KIND.ARTERY);
  const nerve = v.find(x=>x.kind === VESSEL_KIND.NERVE);
  v.filter(isDrawableVein).forEach(vein=>{
    assert.ok(vein.depth < artery.depth, `${vein.id} is shallower than the artery`);
    assert.ok(vein.depth < nerve.depth, `${vein.id} is shallower than the nerve`);
  });
});

test("the basilic is flagged as sitting near the hazards", ()=>{
  const basilic = buildVessels().find(x=>x.id === "basilic");
  assert.deepEqual(basilic.hazardNear, ["brachial-artery", "median-nerve"]);
});

test("a left arm is the mirror image of the geometry, not a label", ()=>{
  const right = buildVessels();
  const left = mirrorForArm(buildVessels(), "left");
  const rc = right.find(v=>v.id === "cephalic");
  const lc = left.find(v=>v.id === "cephalic");
  rc.path.forEach((p, i)=>{
    assert.equal(lc.path[i].z, -p.z, "z is mirrored");
    assert.equal(lc.path[i].x, p.x, "x is unchanged");
  });
});

test("a deep-vein scenario physically moves the veins deeper", ()=>{
  const plain = applyPatientVariation(buildVessels(), { build: 1, scenarioKeys: [] });
  const deep = applyPatientVariation(buildVessels(), { build: 1, scenarioKeys: ["deep"] });
  const a = plain.find(v=>v.id === "median-cubital");
  const b = deep.find(v=>v.id === "median-cubital");
  assert.ok(b.depth > a.depth*1.4, "a deep scenario is deeper geometry, not a label");
});

test("a dehydrated scenario narrows the veins", ()=>{
  const plain = applyPatientVariation(buildVessels(), { build: 1, scenarioKeys: [] });
  const dry = applyPatientVariation(buildVessels(), { build: 1, scenarioKeys: ["dry"] });
  assert.ok(dry.find(v=>v.id === "cephalic").calibre < plain.find(v=>v.id === "cephalic").calibre);
});

test("hazards are not affected by vein scenarios", ()=>{
  const varied = applyPatientVariation(buildVessels(), { build: 1.2, scenarioKeys: ["deep"] });
  const plainArtery = buildVessels().find(v=>v.kind === VESSEL_KIND.ARTERY);
  const artery = varied.find(v=>v.kind === VESSEL_KIND.ARTERY);
  assert.equal(artery.depth, plainArtery.depth);
});

test("nearestOnVessel finds the point on the polyline, not just a node", ()=>{
  const median = buildVessels().find(v=>v.id === "median-cubital");
  const hit = nearestOnVessel(median, -0.026, -0.010);
  assert.ok(hit.d < 0.004, "a point beside the vein is close to it");
  const far = nearestOnVessel(median, -0.026, 0.060);
  assert.ok(far.d > 0.04, "a point across the arm is not");
});

test("vesselsNear returns hazards as well as veins, nearest first", ()=>{
  const vessels = buildVessels();
  const near = vesselsNear(vessels, 0.02, 0.026, 0.010);
  assert.ok(near.length >= 2, "the basilic and the artery run together here");
  for(let i=1;i<near.length;i++){
    assert.ok(near[i].hit.d >= near[i-1].hit.d, "sorted by distance");
  }
});

/* ---------- the physiology --------------------------------------------------- */

test("veins fill as tension rises, then collapse again when it is too tight", ()=>{
  const slack = veinDistension(0.15, 5, 1);
  const good = veinDistension(0.55, 5, 1);
  const crushing = veinDistension(0.97, 5, 1);
  assert.ok(slack < 0.1, "a loose band does nothing");
  assert.ok(good > 0.7, "a correct band fills the veins");
  assert.ok(crushing < good*0.4, "stopping arterial inflow empties them again");
});

test("the radial pulse disappears only once arterial inflow is compromised", ()=>{
  assert.equal(hasRadialPulse(0.55), true);
  assert.equal(hasRadialPulse(0.70), true);
  assert.equal(hasRadialPulse(0.92), false);
});

test("the hand blanches in step with arterial occlusion", ()=>{
  assert.equal(distalPallor(0.5), 0);
  assert.ok(distalPallor(0.90) > 0.3);
  assert.ok(distalPallor(0.98) > distalPallor(0.90));
});

test("distension decays the longer the band stays on", ()=>{
  const fresh = veinDistension(0.55, 10, 1);
  const stale = veinDistension(0.55, 150, 1);
  assert.ok(stale < fresh, "a band left on hemoconcentrates the sample");
});

test("a dehydrated patient's veins fill less well however good the technique", ()=>{
  assert.ok(veinDistension(0.55, 5, 0.72) < veinDistension(0.55, 5, 1));
});

/* =========================================================================
   STATE TRANSITIONS
   ========================================================================= */

test("a fresh strap is not on the patient", ()=>{
  const s = createTourniquetState({});
  assert.equal(s.phase, PHASE.LOOSE);
  assert.equal(isOnPatient(s), false);
  assert.equal(heightAboveSite(s), null);
});

test("routing records where and which way round, and counts as an attempt", ()=>{
  const s = createTourniquetState({});
  markRouted(s, { bandX: 0.089, wrap: WRAP.UNDER, skew: 0.004 });
  assert.equal(s.phase, PHASE.ROUTED);
  assert.equal(s.bandX, 0.089);
  assert.equal(s.wrap, WRAP.UNDER);
  assert.equal(s.attempts, 1);
  assert.ok(Math.abs(heightAboveSite(s) - 0.089) < 1e-9);
});

test("peak tension is remembered even after easing off", ()=>{
  const s = createTourniquetState({});
  markRouted(s, { bandX: 0.089, wrap: WRAP.UNDER, skew: 0 });
  setTension(s, 0.92);
  setTension(s, 0.50);
  assert.equal(s.tension, 0.50);
  assert.equal(s.peakTension, 0.92, "overshoot is not erased by easing off");
});

test("letting go before the tuck unravels the band and costs a restart", ()=>{
  const s = createTourniquetState({});
  markRouted(s, { bandX: 0.089, wrap: WRAP.UNDER, skew: 0 });
  setTension(s, 0.6);
  markUnravelled(s);
  assert.equal(s.phase, PHASE.LOOSE);
  assert.equal(s.bandX, null);
  assert.equal(s.restarts, 1);
  assert.equal(isOnPatient(s), false);
});

test("securing locks in the tension that was being held", ()=>{
  const s = goodBand({ tension: 0.61 });
  assert.equal(isSecured(s), true);
  assert.equal(s.heldTension, 0.61);
  assert.ok(s.securedAt);
});

test("time on the arm accumulates across re-applications", ()=>{
  const t0 = Date.now() - 30000;
  const s = goodBand({ at: t0 });
  markUnravelled(s);                       // 30s banked
  assert.ok(s.accumulatedMs >= 29000, "the first 30 seconds still counted");
  markRouted(s, { bandX: 0.089, wrap: WRAP.UNDER, skew: 0 });
  setTension(s, 0.55);
  markCrossed(s);
  markSecured(s, { tuck: TUCK.PROXIMAL, tuckedUnder: true, at: Date.now() - 20000 });
  assert.ok(secondsOn(s) >= 49, "a second application does not reset the patient's clock");
});

test("releasing by the tail ends the application and stops the clock", ()=>{
  const s = goodBand({ at: Date.now() - 15000 });
  markReleased(s, { byTail: true });
  assert.equal(s.phase, PHASE.RELEASED);
  assert.equal(s.tension, 0);
  assert.ok(s.releasedAt);
  const settled = secondsOn(s);
  assert.ok(settled >= 14 && settled < 17);
});

/* =========================================================================
   CLINICAL RULES
   ========================================================================= */

test("a textbook application passes with no blocking issues", ()=>{
  const r = evaluateTourniquet(goodBand(), ARM);
  assert.equal(r.ready, true);
  assert.equal(r.blocking.length, 0);
  assert.ok(r.distension > 0.7, "and the veins are actually up");
  assert.equal(r.pulse, true);
});

test("a band below the site is blocked", ()=>{
  const r = evaluateTourniquet(goodBand({ bandX: -0.03 }), ARM);
  assert.equal(r.ready, false);
  assert.ok(r.blocking.some(i=>i.code === "bandDistal"));
});

test("a band on the fossa itself is blocked", ()=>{
  const issue = checkPosition(goodBand({ bandX: 0.004 }));
  assert.equal(issue.code, "bandOnSite");
  assert.equal(issue.severity, "block");
});

test("a band too close to the site is blocked, too far up is only a warning", ()=>{
  assert.equal(checkPosition(goodBand({ bandX: 0.040 })).severity, "block");
  assert.equal(checkPosition(goodBand({ bandX: 0.160 })).severity, "warn");
});

test("an ideal position raises no position issue at all", ()=>{
  assert.equal(checkPosition(goodBand({ bandX: 0.089 })), null);
});

test("laying the band over the top of the arm is blocked", ()=>{
  const issue = checkWrap(goodBand({ wrap: WRAP.OVER }));
  assert.equal(issue.code, "wrappedOver");
  assert.equal(issue.severity, "block");
});

test("tension is judged on the physiological window, both ends", ()=>{
  assert.equal(checkTension(goodBand({ tension: 0.10 })).code, "tooLoose");
  assert.equal(checkTension(goodBand({ tension: 0.36 })).code, "slightlyLoose");
  assert.equal(checkTension(goodBand({ tension: 0.55 })), null);
  assert.equal(checkTension(goodBand({ tension: 0.76 })).code, "slightlyTight");
  assert.equal(checkTension(goodBand({ tension: 0.90 })).code, "tooTight");
});

test("too tight blocks, and it is the error the message treats as dangerous", ()=>{
  const issue = checkTension(goodBand({ tension: 0.90 }));
  assert.equal(issue.severity, "block");
  assert.match(issue.message, /radial pulse/i);
});

test("a tail tucked toward the site is blocked as a contamination error", ()=>{
  const issue = checkTuck(goodBand({ tuck: TUCK.DISTAL }));
  assert.equal(issue.code, "tailInField");
  assert.equal(issue.severity, "block");
});

test("crossed but never tucked is blocked", ()=>{
  const issue = checkTuck(goodBand({ tuckedUnder: false }));
  assert.equal(issue.code, "notTucked");
  assert.equal(issue.severity, "block");
});

test("a spiralled wrap warns, a slightly off-square one only notes", ()=>{
  assert.equal(checkSkew(goodBand({ skew: 0.002 })), null);
  assert.equal(checkSkew(goodBand({ skew: SKEW_LIMIT + 0.002 })).code, "bandSkewed");
  assert.equal(checkSkew(goodBand({ skew: SKEW_LIMIT*2 + 0.002 })).code, "bandTwisted");
});

test("the one-minute rule escalates note -> warn -> block", ()=>{
  const at = ms=>goodBand({ at: Date.now() - ms });
  assert.equal(checkTime(at(20000)), null);
  assert.equal(checkTime(at(50000)).code, "timeWarn");
  assert.equal(checkTime(at(70000)).code, "timeOver");
  assert.equal(checkTime(at(130000)).code, "timeSpoiled");
  assert.equal(checkTime(at(130000)).severity, "block");
});

test("the clock does not run before the band is secured", ()=>{
  const s = createTourniquetState({});
  markRouted(s, { bandX: 0.089, wrap: WRAP.UNDER, skew: 0 });
  assert.equal(checkTime(s), null);
});

test("blocking issues are reported before warnings and notes", ()=>{
  const s = goodBand({ bandX: 0.160, tension: 0.90 });   // one warn, one block
  const r = evaluateTourniquet(s, ARM);
  assert.equal(nextIssue(r).severity, "block");
});

test("nextAction names a physical action on the object at every phase", ()=>{
  const s = createTourniquetState({});
  assert.match(nextAction(s), /pass it under/i);
  markRouted(s, { bandX: 0.089, wrap: WRAP.UNDER, skew: 0 });
  assert.match(nextAction(s), /pull/i);
  setTension(s, 0.5);
  assert.match(nextAction(s), /sweep/i);
  markCrossed(s);
  assert.match(nextAction(s), /tuck/i);
  markSecured(s, { tuck: TUCK.PROXIMAL, tuckedUnder: true });
  assert.match(nextAction(s), /clock/i);
});

test("an unsecured band is never ready, however well placed", ()=>{
  const s = createTourniquetState({});
  markRouted(s, { bandX: 0.089, wrap: WRAP.UNDER, skew: 0 });
  setTension(s, 0.55);
  assert.equal(evaluateTourniquet(s, ARM).ready, false);
});

/* =========================================================================
   MEASUREMENT AND SCORING
   ========================================================================= */

test("measurements report real distances and seconds, not verdicts", ()=>{
  const s = goodBand({ bandX: 0.089, at: Date.now() - 25000 });
  const m = measureTourniquet(s, evaluateTourniquet(s, ARM));
  assert.ok(Math.abs(m.heightAboveSiteInches - 3.5) < 0.05);
  assert.ok(m.secondsOn >= 24 && m.secondsOn < 27);
  assert.equal(m.wrappedUnder, true);
  assert.equal(m.tuckedClear, true);
  assert.equal(m.withinMinute, true);
  assert.ok(m.score >= 90, `textbook application should score high, got ${m.score}`);
});

test("the two dangerous errors cost the most", ()=>{
  const base = measureTourniquet(goodBand(), evaluateTourniquet(goodBand(), ARM)).score;

  const tight = goodBand({ tension: 0.92 });
  const tightScore = measureTourniquet(tight, evaluateTourniquet(tight, ARM)).score;

  const late = goodBand({ at: Date.now() - 140000 });
  const lateScore = measureTourniquet(late, evaluateTourniquet(late, ARM)).score;

  const skew = goodBand({ skew: 0.05 });
  const skewScore = measureTourniquet(skew, evaluateTourniquet(skew, ARM)).score;

  assert.ok(tightScore < base - 20, "occluding the artery is a major deduction");
  assert.ok(lateScore < base - 20, "spoiling the sample is a major deduction");
  assert.ok(skewScore > tightScore, "a pinching band is worse practice, not dangerous");
});

test("every mistake is named in words a learner can act on", ()=>{
  const s = goodBand({ wrap: WRAP.OVER, bandX: 0.030, tension: 0.95, tuck: TUCK.DISTAL, skew: 0.06 });
  const m = measureTourniquet(s, evaluateTourniquet(s, ARM));
  const codes = m.mistakes.map(x=>x.code);
  ["wrappedOver", "position", "tooTight", "tailInField", "skewed"].forEach(c=>{
    assert.ok(codes.includes(c), `expected a ${c} mistake`);
  });
  m.mistakes.forEach(x=>assert.ok(x.message.length > 20, "every mistake explains itself"));
});

test("restarts are counted and reported", ()=>{
  const s = goodBand();
  markUnravelled(s);
  markRouted(s, { bandX: 0.089, wrap: WRAP.UNDER, skew: 0 });
  setTension(s, 0.55);
  markCrossed(s);
  markSecured(s, { tuck: TUCK.PROXIMAL, tuckedUnder: true });
  const m = measureTourniquet(s, evaluateTourniquet(s, ARM));
  assert.equal(m.restarts, 1);
  assert.ok(m.mistakes.some(x=>x.code === "restarts"));
});

test("the narrative reads as technique feedback, not a score", ()=>{
  const s = goodBand();
  const m = measureTourniquet(s, evaluateTourniquet(s, ARM));
  assert.match(m.narrative, /3\.5″ above the site/);
  assert.match(m.narrative, /tail tucked clear/);
  assert.doesNotMatch(m.narrative, /\d+\/100/);
});

test("a band that never went on says so", ()=>{
  const s = createTourniquetState({});
  const m = measureTourniquet(s, evaluateTourniquet(s, ARM));
  assert.equal(m.heightAboveSiteInches, null);
  assert.match(m.narrative, /never went on/i);
});

test("the outcome feeds the encounter's existing chips honestly", ()=>{
  const good = goodBand();
  const c1 = {};
  applyTourniquetOutcome(c1, measureTourniquet(good, evaluateTourniquet(good, ARM)));
  assert.equal(c1.tourniquetOn, true);
  assert.equal(c1.tqGood, true);

  const bad = goodBand({ tension: 0.95, bandX: 0.030 });
  const c2 = {};
  applyTourniquetOutcome(c2, measureTourniquet(bad, evaluateTourniquet(bad, ARM)));
  assert.equal(c2.tourniquetOn, true, "it did go on");
  assert.equal(c2.tqGood, false, "but it was not a good tourniquet");
});

test("an over-time band cannot be scored as good even if perfectly placed", ()=>{
  const s = goodBand({ at: Date.now() - 90000 });
  const c = {};
  applyTourniquetOutcome(c, measureTourniquet(s, evaluateTourniquet(s, ARM)));
  assert.equal(c.tqGood, false);
});

/* =========================================================================
   THE SITE IS A PARAMETER — the butterfly/dorsal-hand procedure's band
   sits closer, on the forearm above the wrist, not the fossa. Every number
   here has an antecubital default so the tests above are untouched; these
   assert the override path itself.
   ========================================================================= */

const HAND_SITE_LIKE = {
  x: -0.287, ideal: { min: 0.050, max: 0.076 }, acceptable: { min: 0.038, max: 0.090 },
  label: "the back of the hand", windowLabel: "2–3″",
};

test("distanceAboveSite defaults to the fossa, and accepts any other site", () => {
  assert.equal(distanceAboveSite(0.089), 0.089);              // SITE.x === 0
  assert.equal(distanceAboveSite(0.089, 0), 0.089);
  assert.equal(Math.round(distanceAboveSite(-0.225, HAND_SITE_LIKE.x) * 1000), 62);
});

test("classifyBandPosition judges a hand-sized band against its own window, not the fossa's", () => {
  // -0.225 is 62mm above HAND_SITE_LIKE.x — inside its ideal band
  assert.equal(
    classifyBandPosition(-0.225, HAND_SITE_LIKE.x, HAND_SITE_LIKE.ideal, HAND_SITE_LIKE.acceptable),
    "ideal");
  // the SAME absolute position is nowhere near the fossa's own window
  assert.notEqual(classifyBandPosition(-0.225), "ideal");
});

test("evaluateTourniquet judges heightAboveSite against arm.site when one is given", () => {
  const s = goodBand({ bandX: -0.225 });
  const withoutSite = evaluateTourniquet(s, ARM);
  const withSite = evaluateTourniquet(s, Object.assign({}, ARM, { site: HAND_SITE_LIKE }));
  assert.notEqual(withoutSite.heightAboveSite, withSite.heightAboveSite);
  assert.equal(Math.round(withSite.heightAboveSite * 1000), 62);
});

test("checkPosition's band-on-site message names the procedure's own site label", () => {
  const s = goodBand({ bandX: HAND_SITE_LIKE.x + 0.005 });
  const issue = checkPosition(s, HAND_SITE_LIKE);
  assert.equal(issue.code, "bandOnSite");
  assert.match(issue.message, /the back of the hand/);
  assert.doesNotMatch(issue.message, /antecubital fossa/);
});

test("measureTourniquet scores heightAboveSiteM against arm.site, not raw bandX", () => {
  const s = goodBand({ bandX: -0.225 });
  const antecubital = measureTourniquet(s, evaluateTourniquet(s, ARM), undefined, undefined);
  const hand = measureTourniquet(s, evaluateTourniquet(s, Object.assign({}, ARM, { site: HAND_SITE_LIKE })),
    undefined, HAND_SITE_LIKE);
  assert.equal(antecubital.positionOk, false);   // -0.225 is nowhere near the fossa
  assert.equal(hand.positionIdeal, true);        // but it is exactly where a hand draw's band belongs
  assert.equal(Math.round(hand.heightAboveSiteM * 1000), 62);
});

test("an antecubital measurement taken with no site override is unchanged from before", () => {
  const s = goodBand({});
  const m = measureTourniquet(s, evaluateTourniquet(s, ARM));
  assert.equal(m.positionIdeal, true);
  assert.equal(m.heightAboveSiteM, 0.089);
});
