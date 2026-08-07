/* =========================================================================
   REWARDS — unit tests.

   The one property worth defending here: **the payout tracks the
   measurements, not the clicking.** A learner who gets through every step
   badly must end up materially worse off than one who does them well, and no
   amount of finishing things can substitute for doing them properly.
   ========================================================================= */
import test from "node:test";
import assert from "node:assert/strict";

import {
  STEP_XP, SECTION_GOOD, SECTION_CLEAN, SECTION_POOR,
  STREAK_TIERS, streakTier, sectionScore, sectionReward, nextStreak, drawReward,
} from "../src/game/rewards.js";

const readings = (...scores) => scores.map((score, i) => ({ key: `k${i}`, measurement: { score } }));

/* -------------------------------------------------------------------------
   THE SECTION IS WHERE THE MONEY IS
   ------------------------------------------------------------------------- */

test("a section is worth the mean of the measurements it actually produced", () => {
  assert.equal(sectionScore(readings(90, 80)), 85);
  assert.equal(sectionScore(readings(100)), 100);
  // a section that measured nothing is not a section that scored zero
  assert.equal(sectionScore([]), null);
  assert.equal(sectionScore([{ key: "x", measurement: null }]), null);
});

test("nothing measured pays nothing, and does not break the streak either", () => {
  const r = sectionReward(null, 4);
  assert.equal(r.xp, 0);
  assert.equal(r.broke, false);
  assert.equal(nextStreak(4, null), 4);
});

test("a clean section pays more than a merely good one, which pays more than a scrape", () => {
  const clean = sectionReward(95, 0).xp;
  const good = sectionReward(80, 0).xp;
  const scrape = sectionReward(65, 0).xp;
  assert.ok(clean > good, `clean ${clean} should beat good ${good}`);
  assert.ok(good > scrape, `good ${good} should beat scrape ${scrape}`);
  assert.ok(scrape > 0);
});

test("the bonus scales inside the band rather than switching on at it", () => {
  assert.ok(sectionReward(SECTION_GOOD + 12, 0).xp > sectionReward(SECTION_GOOD, 0).xp);
});

test("a poor section pays nothing at all and breaks the streak", () => {
  const r = sectionReward(SECTION_POOR - 1, 6);
  assert.equal(r.xp, 0);
  assert.equal(r.broke, true);
  assert.equal(nextStreak(6, SECTION_POOR - 1), 0);
});

test("a middling section holds the streak without extending it", () => {
  assert.equal(nextStreak(3, 70), 3);
  assert.equal(nextStreak(3, SECTION_CLEAN), 4);
});

/* -------------------------------------------------------------------------
   THE STREAK MULTIPLIES GOOD WORK AND ONLY GOOD WORK
   ------------------------------------------------------------------------- */

test("the tiers are ordered, and a streak reaches the highest one it has earned", () => {
  for(let i = 1; i < STREAK_TIERS.length; i++){
    assert.ok(STREAK_TIERS[i].at > STREAK_TIERS[i - 1].at);
  }
  assert.equal(streakTier(0), null);
  assert.equal(streakTier(2), null);
  assert.equal(streakTier(3).label, "3 clean");
  assert.equal(streakTier(50).label, STREAK_TIERS[STREAK_TIERS.length - 1].label);
});

test("a streak is worth more, but only on a section that earned a bonus", () => {
  assert.ok(sectionReward(95, 10).xp > sectionReward(95, 0).xp);
  // a poor section pays zero however long the streak was
  assert.equal(sectionReward(30, 10).xp, 0);
});

/* -------------------------------------------------------------------------
   THE END-OF-DRAW LUMP IS THE SMALL PART NOW
   ------------------------------------------------------------------------- */

test("finishing pays for how much was finished", () => {
  const half = drawReward({ stepsDone: 8, stepsTotal: 16 });
  const whole = drawReward({ stepsDone: 16, stepsTotal: 16 });
  assert.ok(whole.xp > half.xp);
  assert.equal(whole.completion, 100);
  assert.equal(half.completion, 50);
});

test("the end-of-draw bonuses are for outcomes, and each one says what it was for", () => {
  const perfect = drawReward({
    stepsDone: 16, stepsTotal: 16,
    cleanSections: 11, sectionsDone: 11,
    specimensAccepted: 2, specimensTotal: 2,
    complicationsHandled: true,
  });
  const ordinary = drawReward({
    stepsDone: 16, stepsTotal: 16,
    cleanSections: 4, sectionsDone: 11,
    specimensAccepted: 1, specimensTotal: 2,
    complicationsHandled: false,
  });
  assert.ok(perfect.xp > ordinary.xp);
  assert.equal(perfect.notes.length, 3);
  assert.equal(ordinary.notes.length, 0);
});

test("a draw with no specimens does not claim a specimen bonus", () => {
  const r = drawReward({ stepsDone: 4, stepsTotal: 16, specimensAccepted: 0, specimensTotal: 0 });
  assert.equal(r.notes.length, 0);
});

/* -------------------------------------------------------------------------
   THE PROPERTY THAT MATTERS
   ------------------------------------------------------------------------- */

test("a whole draw done badly pays far less than the same draw done well", () => {
  const sections = 11;
  let goodXp = 0, badXp = 0, goodStreak = 0, badStreak = 0;
  for(let i = 0; i < sections; i++){
    goodXp += sectionReward(94, goodStreak).xp; goodStreak = nextStreak(goodStreak, 94);
    badXp += sectionReward(52, badStreak).xp;   badStreak = nextStreak(badStreak, 52);
  }
  goodXp += drawReward({ stepsDone: 16, stepsTotal: 16, cleanSections: sections, sectionsDone: sections,
    specimensAccepted: 2, specimensTotal: 2, complicationsHandled: true }).xp;
  badXp += drawReward({ stepsDone: 16, stepsTotal: 16, cleanSections: 0, sectionsDone: sections,
    specimensAccepted: 0, specimensTotal: 2, complicationsHandled: false }).xp;

  assert.equal(badStreak, 0);
  assert.ok(goodXp > badXp*2, `good ${goodXp} should be far above bad ${badXp}`);
  // ...and clicking through every step still pays something, because progress
  // is progress — just nothing like the same
  assert.ok(badXp > 0);
});

test("step ticks are small enough that clicking cannot out-earn technique", () => {
  const allSteps = STEP_XP*17;
  const oneCleanSection = sectionReward(96, 3).xp;
  assert.ok(allSteps < oneCleanSection*4, "step ticks are too generous");
});
