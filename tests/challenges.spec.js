/* =========================================================================
   TECHNIQUE CHALLENGES — the replay axis.

   Two properties are load-bearing and both are easy to break by accident:

     1  A challenge NEVER makes a draw easier. Every entry removes help or
        narrows a window, which is what makes the bonus honest. A future
        modifier that quietly widened something would turn the whole system
        into a cheat menu with a multiplier attached.
     2  What is in force is what the player opted into, and it does not
        outlive the shift. A challenge leaking into an un-opted draw would
        silently punish somebody who never chose it.

   Everything below is over the pure functions and the one live cell — no
   DOM, no scene.
   ========================================================================= */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHALLENGES, challengeFor, applyChallenges, scoreChallenges } from "../src/game/challenges.js";
import {
  armChallenges, disarmChallenges, armedChallengeIds, challengeSetup, challengesArmed,
} from "../src/game/activeChallenges.js";

/* ---------- the data itself ------------------------------------------------- */

test("every challenge is worth more than an ordinary draw", ()=>{
  for(const c of CHALLENGES){
    assert.ok(c.bonus > 1, `${c.id} pays ${c.bonus}, which is not a bonus`);
    assert.ok(c.bonus <= 1.5, `${c.id} pays ${c.bonus} — a single modifier should not be half again`);
  }
});

test("every challenge has an id, a label, a blurb and both halves of its contract", ()=>{
  const seen = new Set();
  for(const c of CHALLENGES){
    assert.ok(c.id && !seen.has(c.id), `duplicate or missing id: ${c.id}`);
    seen.add(c.id);
    assert.equal(typeof c.label, "string");
    assert.ok(c.label.length, `${c.id} has no label`);
    assert.ok(c.blurb.length, `${c.id} has no blurb`);
    assert.equal(typeof c.apply, "function");
    assert.equal(typeof c.met, "function");
  }
});

test("no challenge can make a draw easier", ()=>{
  /* The setup starts from "everything as the player has it". A challenge may
     drop assist, silence the coach, remove kit, mirror the bench or add a
     scenario key — and nothing else. Assist may only go DOWN, and the vein
     finder may only be taken away. */
  for(const c of CHALLENGES){
    const setup = applyChallenges([c.id]);
    if(setup.assist !== null){
      assert.ok(setup.assist <= 0.45, `${c.id} raised assist to ${setup.assist}`);
    }
    assert.notEqual(setup.veinFinder, true, `${c.id} handed the player a vein finder`);
    assert.ok(Array.isArray(setup.extraKeys));
    // extraKeys are scenario keys, and every scenario key makes an arm harder
    assert.ok(setup.extraKeys.every(k => typeof k === "string"));
  }
});

test("challengeFor finds them by id, and refuses one that does not exist", ()=>{
  assert.equal(challengeFor("oneStick").id, "oneStick");
  assert.equal(challengeFor("free-money"), null);
});

/* ---------- folding a loadout ----------------------------------------------- */

test("an empty loadout leaves the draw exactly as it was", ()=>{
  const setup = applyChallenges([]);
  assert.equal(setup.assist, null);
  assert.equal(setup.silence, false);
  assert.equal(setup.veinFinder, null);
  assert.equal(setup.mirrorHandedness, false);
  assert.deepEqual(setup.extraKeys, []);
  assert.deepEqual(setup.active, []);
});

test("an unknown id is ignored rather than crashing a shift", ()=>{
  const setup = applyChallenges(["oneStick", "not-a-challenge"]);
  assert.equal(setup.active.length, 1);
  assert.equal(setup.active[0].id, "oneStick");
});

test("stacked modifiers all apply", ()=>{
  const setup = applyChallenges(["noAssist", "noCoach", "otherHand", "deepVein"]);
  assert.equal(setup.assist, 0);
  assert.equal(setup.silence, true);
  assert.equal(setup.mirrorHandedness, true);
  assert.ok(setup.extraKeys.includes("deep"));
});

/* ---------- scoring --------------------------------------------------------- */

test("a modifier challenge is met by taking it — the constraint IS the run", ()=>{
  // "No coach" cannot be failed: the game withheld the coaching, so the draw
  // was made under the constraint whatever else happened.
  const r = scoreChallenges(["noCoach"], {});
  assert.equal(r.met.length, 1);
  assert.equal(r.multiplier, 1.30);
});

test("an outcome challenge is met only by the outcome", ()=>{
  const clean = { insertMeasurements: { inVein: true, reapproaches: 0 }, insert: { redirects: 0 } };
  assert.equal(scoreChallenges(["oneStick"], clean).met.length, 1);

  const redirected = { insertMeasurements: { inVein: true, reapproaches: 0 }, insert: { redirects: 1 } };
  assert.equal(scoreChallenges(["oneStick"], redirected).met.length, 0);

  const missed = { insertMeasurements: { inVein: false, reapproaches: 2 }, insert: { redirects: 0 } };
  assert.equal(scoreChallenges(["oneStick"], missed).met.length, 0);
});

test("a missed challenge costs nothing — it just does not pay", ()=>{
  const r = scoreChallenges(["oneStick"], { insertMeasurements: { inVein: false } });
  assert.equal(r.multiplier, 1, "a failed challenge must never be a penalty");
  assert.equal(r.missed.length, 1);
});

test("stacking multiplies, so two hard runs beat either alone", ()=>{
  const c = {
    insertMeasurements: { inVein: true, reapproaches: 0 }, insert: { redirects: 0 },
    tourniquetMeasurements: { secondsOn: 42 },
  };
  const one = scoreChallenges(["oneStick"], c).multiplier;
  const two = scoreChallenges(["oneStick", "bandUnder60"], c).multiplier;
  assert.ok(two > one);
  assert.equal(two, Math.round(1.35*1.25*100)/100);
});

test("the band challenge needs a band that was actually on", ()=>{
  assert.equal(scoreChallenges(["bandUnder60"], { tourniquetMeasurements: { secondsOn: 0 } }).met.length, 0);
  assert.equal(scoreChallenges(["bandUnder60"], { tourniquetMeasurements: { secondsOn: 59 } }).met.length, 1);
  assert.equal(scoreChallenges(["bandUnder60"], { tourniquetMeasurements: { secondsOn: 61 } }).met.length, 0);
});

test("a clean sheet means every specimen, with nothing flagged", ()=>{
  const met = id => scoreChallenges(["cleanSheet"], { specimenQuality: id }).met.length;
  assert.equal(met({ total: 3, acceptedCount: 3, flaggedCount: 0 }), 1);
  assert.equal(met({ total: 3, acceptedCount: 3, flaggedCount: 1 }), 0);
  assert.equal(met({ total: 3, acceptedCount: 2, flaggedCount: 0 }), 0);
  assert.equal(met({ total: 0, acceptedCount: 0, flaggedCount: 0 }), 0, "no specimens is not a clean sheet");
});

/* ---------- what is in force ------------------------------------------------ */

test("nothing is in force until a shift arms it", ()=>{
  disarmChallenges();
  assert.equal(challengesArmed(), false);
  assert.deepEqual(armedChallengeIds(), []);
  assert.equal(challengeSetup().assist, null);
});

test("arming a loadout puts exactly it in force", ()=>{
  armChallenges(["noAssist", "otherHand"]);
  assert.equal(challengesArmed(), true);
  assert.deepEqual(armedChallengeIds(), ["noAssist", "otherHand"]);
  assert.equal(challengeSetup().assist, 0);
  assert.equal(challengeSetup().mirrorHandedness, true);
  disarmChallenges();
});

test("a loadout does not outlive the shift it was chosen for", ()=>{
  armChallenges(["noCoach"]);
  assert.equal(challengeSetup().silence, true);
  disarmChallenges();
  assert.equal(challengeSetup().silence, false, "a challenge leaked into an un-opted draw");
  assert.deepEqual(armedChallengeIds(), []);
});

test("the armed ids are a copy — a caller cannot reach in and change them", ()=>{
  armChallenges(["oneStick"]);
  armedChallengeIds().push("noAssist");
  assert.deepEqual(armedChallengeIds(), ["oneStick"]);
  disarmChallenges();
});
