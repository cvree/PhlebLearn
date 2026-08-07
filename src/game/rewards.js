/* =========================================================================
   REWARDS — what the learner gets, and when.

   Until now the whole draw paid out once, at the end: a lump of XP computed
   from a dozen booleans on a screen the learner reached several minutes after
   the work that earned it. Seventeen real interactions with no acknowledgement
   until the credits is a strange way to teach and a worse way to feel.

   So the payout is broken up. Every finished step pays a little, every
   finished SECTION pays properly and pays according to what was measured, and
   a run of good sections builds a streak that is worth something.

   The rule that keeps this honest: **nothing here rewards completion alone.**
   A step pays its small tick for being done, because doing it is progress. The
   real money is at the section boundary and it is scaled by the section's own
   0–100 measurement — the same number the rubric grades from. A section
   scraped through at 40 pays almost nothing and breaks the streak, and no
   amount of clicking gets that back.

   Pure arithmetic. No DOM, no game state, no clock.
   ========================================================================= */

/** XP for finishing one step of the procedure. Small on purpose. */
export const STEP_XP = 2;

/** A section has to reach this to pay a bonus at all. */
export const SECTION_GOOD = 78;
/** ...and this to be a clean one, which is what keeps a streak alive. */
export const SECTION_CLEAN = 88;
/** Below this the streak breaks. */
export const SECTION_POOR = 60;

/** The escalating tiers a streak passes through. */
export const STREAK_TIERS = [
  { at: 3,  label: "3 clean",  emoji: "✨", blurb: "Three sections clean in a row." },
  { at: 5,  label: "5 clean",  emoji: "🔥", blurb: "Five in a row. This is what competent looks like." },
  { at: 8,  label: "8 clean",  emoji: "⚡", blurb: "Eight in a row — a whole draw without a stumble." },
  { at: 11, label: "flawless", emoji: "🏆", blurb: "Every section of this draw, clean." },
];

/** The tier a streak of n has reached, or null below the first. */
export function streakTier(n){
  let found = null;
  for(const t of STREAK_TIERS){ if(n >= t.at) found = t; }
  return found;
}

/**
 * The 0–100 a finished section is worth, as the mean of the measurements it
 * produced. Sections that produced nothing return null — "not attempted" is
 * not the same as "attempted badly", and neither pays.
 */
export function sectionScore(readings){
  const scores = (readings || [])
    .map(r => (r && r.measurement && typeof r.measurement.score === "number") ? r.measurement.score : null)
    .filter(v => v != null);
  if(!scores.length) return null;
  return Math.round(scores.reduce((a, b) => a + b, 0)/scores.length);
}

/**
 * What finishing a section is worth.
 *
 * @param {number|null} score  the section's own 0–100
 * @param {number} streak      how many clean sections came before it
 * @returns {{xp:number, coins:number, clean:boolean, broke:boolean, label:string|null}}
 */
export function sectionReward(score, streak){
  if(score == null) return { xp: 0, coins: 0, clean: false, broke: false, label: null };

  const clean = score >= SECTION_CLEAN;
  const good = score >= SECTION_GOOD;
  const broke = score < SECTION_POOR;

  // The bonus scales with the score above the bar rather than switching on at
  // it, so 78 and 87 are not worth the same and the learner can feel the
  // difference between "got through it" and "did it well".
  let xp = 0;
  if(good) xp = 6 + Math.round((score - SECTION_GOOD)/(100 - SECTION_GOOD)*10);
  else if(!broke) xp = 2;

  // A streak multiplies the section bonus, never the base — so a long streak
  // is worth having and is still only ever paid for good work.
  const tier = streakTier(clean ? streak + 1 : 0);
  if(tier && xp) xp = Math.round(xp*(1 + STREAK_TIERS.indexOf(tier)*0.25));

  return {
    xp,
    coins: clean ? 1 : 0,
    clean, broke,
    label: clean ? "Clean" : good ? "Good" : broke ? null : "Complete",
  };
}

/** The streak after a section scoring `score`. */
export function nextStreak(streak, score){
  if(score == null) return streak;              // nothing was measured
  if(score >= SECTION_CLEAN) return streak + 1;
  if(score < SECTION_POOR) return 0;            // a poor section breaks it
  return streak;                                // a middling one holds it
}

/**
 * The end-of-draw payout, now that the steps have been paying as they went.
 *
 * Deliberately smaller than it used to be and weighted toward the things a
 * lump sum is actually good at recognising: finishing at all, finishing
 * cleanly, and not hurting anyone.
 *
 * @param {object} o
 *   stepsDone, stepsTotal
 *   cleanSections, sectionsDone
 *   specimensAccepted, specimensTotal
 *   complicationsHandled  true when nothing was missed or made worse
 */
export function drawReward(o){
  const opt = o || {};
  const steps = Math.max(0, opt.stepsDone || 0);
  const total = Math.max(1, opt.stepsTotal || 1);
  const completion = steps/total;

  let xp = Math.round(completion*20);
  let coins = Math.round(completion*4);
  const notes = [];

  if(opt.sectionsDone && opt.cleanSections === opt.sectionsDone){
    xp += 15; coins += 3; notes.push("every section clean");
  }
  if(opt.specimensTotal && opt.specimensAccepted === opt.specimensTotal){
    xp += 10; coins += 2; notes.push("every specimen accepted");
  }
  if(opt.complicationsHandled){ xp += 8; notes.push("nothing missed"); }

  return { xp, coins, notes, completion: Math.round(completion*100) };
}
