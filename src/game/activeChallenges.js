/* =========================================================================
   THE CHALLENGE SETUP THAT IS CURRENTLY IN FORCE.

   challenges.js is pure data and one pure evaluator; it deliberately knows
   nothing about who is playing. This is the one mutable cell that says which
   of those modifiers is live right now, so the five systems a challenge can
   re-aim — assistance, the coach, the patient roll, the kit, handedness —
   each read one place instead of reaching into the shift.

   Deliberately tiny, and deliberately in the `game` layer: assist.js, the
   physical-steps builder and the encounter roll all sit above it, and none of
   them may import each other.

   Cleared when a shift ends, so a challenge can never leak into a draw the
   player did not opt in to.
   ========================================================================= */
import { applyChallenges } from "./challenges.js";

/** @type {{active: object[], assist: number|null, silence: boolean, extraKeys: string[], veinFinder: boolean|null, mirrorHandedness: boolean}} */
let SETUP = applyChallenges([]);
let IDS = [];

/** Puts a set of challenge ids in force for the shift about to start. */
export function armChallenges(ids){
  IDS = Array.isArray(ids) ? ids.slice() : [];
  SETUP = applyChallenges(IDS);
  return SETUP;
}

/** Back to an unmodified draw. Called when a shift ends. */
export function disarmChallenges(){ return armChallenges([]); }

/** The ids in force, for scoreChallenges() at the end of the draw. */
export function armedChallengeIds(){ return IDS.slice(); }

/** The folded setup. Never null. */
export function challengeSetup(){ return SETUP; }

/** Is anything at all in force? Lets callers skip the lookups entirely. */
export function challengesArmed(){ return IDS.length > 0; }
