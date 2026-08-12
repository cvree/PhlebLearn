/* =========================================================================
   MASTERY — the axis that measures skill, not time spent.

   XP and coins measure how long you have played. That is a real thing to
   measure and the game should keep doing it, but it is not what a learner
   wants to know about themselves, and it is not what a training tool should
   be certifying. So there is a second, parallel axis, and the rule that makes
   it worth anything is:

       MASTERY CANNOT BE BOUGHT AND CANNOT BE GROUND.
       It only moves when quality is SUSTAINED.

   A star needs three CONSECUTIVE draws at or above the threshold. One lucky
   run does nothing. A bad run does not merely fail to advance — it resets the
   streak for that technique, so the third good draw in a row genuinely means
   the last three were all good.

   Seven tracks, one per piece of technique the rubric already grades, so the
   thing being certified is the thing being measured and there is no second
   scoring system to keep in sync.

   Pure functions over a plain save-shaped object. tests/mastery.spec.js
   asserts the properties that matter.
   ========================================================================= */

/** The tracks, in the order a learner meets them during a draw. */
export const TRACKS = [
  { id: "tourniquet", label: "Tourniquet",  sections: ["tourniquet"] },
  { id: "palpation",  label: "Palpation",   sections: ["palpation"] },
  { id: "antisepsis", label: "Antisepsis",  sections: ["cleaning"] },
  { id: "insertion",  label: "Insertion",   sections: ["equipment", "insert"] },
  { id: "collection", label: "Collection",  sections: ["collection"] },
  { id: "safety",     label: "Safety",      sections: ["prep", "withdrawal"] },
  { id: "aftercare",  label: "Aftercare",   sections: ["postDraw", "inversion"] },
];

/**
 * What each star costs, as a section score that must be held.
 *
 * The steps are deliberately uneven at the top: getting from four stars to
 * five is meant to be a different order of difficulty from getting from one to
 * two, because five stars is supposed to mean something.
 */
export const STAR_THRESHOLDS = [55, 68, 80, 90, 96];
/** Consecutive draws at the threshold that a star costs. */
export const STAR_RUN = 3;
export const MAX_STARS = 5;

/** A fresh, empty mastery record. */
export function createMastery(){
  const m = {};
  TRACKS.forEach(t => { m[t.id] = { stars: 0, run: 0, best: 0, draws: 0 }; });
  return m;
}

/** Fills in any track a save predates, without disturbing the others. */
export function normaliseMastery(saved){
  const m = createMastery();
  if(!saved) return m;
  TRACKS.forEach(t => {
    const s = saved[t.id];
    if(!s) return;
    m[t.id] = {
      stars: clampInt(s.stars, 0, MAX_STARS),
      run: Math.max(0, s.run | 0),
      best: clampInt(s.best, 0, 100),
      draws: Math.max(0, s.draws | 0),
    };
  });
  return m;
}

function clampInt(v, lo, hi){
  const n = Math.round(Number(v) || 0);
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Applies one finished draw.
 *
 * @param {object} mastery     the save's mastery record — MUTATED
 * @param {object} scores      {sectionId: 0..100} for the sections this draw
 *                             actually produced. Sections the draw never
 *                             reached are absent, and absent is not zero: a
 *                             draw that stopped early must not punish a track
 *                             it never tested.
 * @returns {Array} the tracks that gained a star, for the debrief to announce
 */
export function applyDraw(mastery, scores){
  const gained = [];
  for(const t of TRACKS){
    const readings = t.sections
      .map(id => scores[id])
      .filter(v => typeof v === "number");
    if(!readings.length) continue;                 // untested this draw

    const score = Math.round(readings.reduce((a, b) => a + b, 0)/readings.length);
    const rec = mastery[t.id] || (mastery[t.id] = { stars: 0, run: 0, best: 0, draws: 0 });
    rec.draws += 1;
    rec.best = Math.max(rec.best, score);

    if(rec.stars >= MAX_STARS) continue;
    const need = STAR_THRESHOLDS[rec.stars];
    if(score >= need){
      rec.run += 1;
      if(rec.run >= STAR_RUN){
        rec.stars += 1;
        rec.run = 0;
        gained.push({ id: t.id, label: t.label, stars: rec.stars });
      }
    }else{
      // Not a failure to advance — a reset. Three in a row has to mean three.
      rec.run = 0;
    }
  }
  return gained;
}

/** How close a track is to its next star, 0…1, for a progress ring. */
export function progressToNext(rec){
  if(!rec || rec.stars >= MAX_STARS) return 1;
  return Math.min(1, (rec.run || 0)/STAR_RUN);
}

/** The overall level, for one number on a profile. Deliberately a mean. */
export function masteryLevel(mastery){
  const rows = TRACKS.map(t => (mastery && mastery[t.id] ? mastery[t.id].stars : 0));
  return rows.reduce((a, b) => a + b, 0)/(rows.length*MAX_STARS);
}

/** Which track is furthest behind — the honest answer to "what should I practise". */
export function weakestTrack(mastery){
  let worst = null;
  for(const t of TRACKS){
    const rec = (mastery && mastery[t.id]) || { stars: 0, draws: 0 };
    if(!worst || rec.stars < worst.rec.stars) worst = { track: t, rec };
  }
  return worst;
}
