/* =========================================================================
   TECHNIQUE CHALLENGES — the replay engine.

   The cheapest thing in this whole redesign and close to the highest-value.
   A challenge is an opt-in per-draw modifier that changes what "doing it
   well" means for that one patient, so the same clinical model produces a
   different game. Nothing here adds a mechanic; everything here re-aims one
   that already exists.

   Two rules keep them honest:

     1  A CHALLENGE NEVER MAKES THE DRAW EASIER. Every entry either removes
        help or narrows a window. That means a challenge run is always worth
        more, and never worth taking for the wrong reason.
     2  A CHALLENGE IS CHECKED AGAINST MEASUREMENTS THE DRAW ALREADY PRODUCES.
        If a challenge needed a new number, it would be a new mechanic wearing
        a modifier's clothes, and the two would drift.

   Pure data plus one pure evaluator.
   ========================================================================= */

/**
 * @typedef {object} Challenge
 *   id, label, blurb
 *   apply(setup)   mutates the draw's setup — coach level, assist, equipment
 *   met(c, ENC)    did the finished draw satisfy it? Pure, over measurements.
 *   bonus          multiplier on the draw's payout when it is met
 */
export const CHALLENGES = [
  {
    id: "oneStick",
    label: "One stick",
    blurb: "No second attempt, no redirect.",
    bonus: 1.35,
    apply(){},
    met(c){
      const ins = c.insertMeasurements;
      if(!ins || !ins.inVein) return false;
      return !ins.reapproaches && !(c.insert && c.insert.redirects);
    },
  },
  {
    id: "bandUnder60",
    label: "Band under 60 seconds",
    blurb: "From the moment it sets to the moment it comes off.",
    bonus: 1.25,
    apply(){},
    met(c){
      const tq = c.tourniquetMeasurements;
      return !!tq && tq.secondsOn > 0 && tq.secondsOn < 60;
    },
  },
  {
    id: "noCoach",
    label: "No coach",
    blurb: "Every hint off, whatever mode you are in.",
    bonus: 1.30,
    apply(setup){ setup.silence = true; },
    met(){ return true; },     // the modifier IS the challenge
  },
  {
    id: "noAssist",
    label: "No magnetism",
    blurb: "Assist to zero. Every snap radius at its floor.",
    bonus: 1.40,
    apply(setup){ setup.assist = 0; },
    met(){ return true; },
  },
  {
    id: "otherHand",
    label: "Wrong hand",
    blurb: "The whole bench mirrors. It is a genuinely different draw.",
    bonus: 1.30,
    apply(setup){ setup.mirrorHandedness = true; },
    met(){ return true; },
  },
  {
    id: "deepVein",
    label: "Deep vein",
    blurb: "Nothing visible. Find it by feel.",
    bonus: 1.30,
    apply(setup){ setup.extraKeys = [...(setup.extraKeys || []), "deep"]; },
    met(c){
      const ins = c.insertMeasurements;
      return !!(ins && ins.inVein);
    },
  },
  {
    id: "noFinder",
    label: "No transilluminator",
    blurb: "Even if you own one, it stays in the drawer.",
    bonus: 1.20,
    apply(setup){ setup.veinFinder = false; },
    met(){ return true; },
  },
  {
    id: "cleanSheet",
    label: "Clean sheet",
    blurb: "Every specimen accepted, nothing flagged.",
    bonus: 1.45,
    apply(){},
    met(c){
      const q = c.specimenQuality;
      return !!(q && q.total > 0 && q.acceptedCount === q.total && q.flaggedCount === 0);
    },
  },
];

const BY_ID = Object.fromEntries(CHALLENGES.map(ch => [ch.id, ch]));
export function challengeFor(id){ return BY_ID[id] || null; }

/**
 * Folds a set of chosen challenges into the setup a draw starts from.
 * @returns {object} the setup, plus `active` for the coach to name.
 */
export function applyChallenges(ids, base){
  const setup = Object.assign({ assist: null, silence: false, extraKeys: [], veinFinder: null,
    mirrorHandedness: false }, base || {});
  setup.active = [];
  for(const id of (ids || [])){
    const ch = BY_ID[id];
    if(!ch) continue;
    ch.apply(setup);
    setup.active.push(ch);
  }
  return setup;
}

/**
 * Which of the chosen challenges the finished draw actually satisfied, and
 * what the payout multiplier comes to.
 *
 * The multiplier is the PRODUCT of the ones met, so stacking two hard
 * modifiers is worth more than either — which is the point of an opt-in
 * difficulty system, and is safe because nothing here can ever make a draw
 * easier.
 */
export function scoreChallenges(ids, c){
  const met = [], missed = [];
  let multiplier = 1;
  for(const id of (ids || [])){
    const ch = BY_ID[id];
    if(!ch) continue;
    if(ch.met(c || {})){ met.push(ch); multiplier *= ch.bonus; }
    else missed.push(ch);
  }
  return { met, missed, multiplier: Math.round(multiplier*100)/100 };
}
