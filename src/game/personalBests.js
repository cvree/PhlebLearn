/* =========================================================================
   PERSONAL BESTS — the numbers a learner competes with themselves over.

   Deliberately small, and deliberately about TECHNIQUE rather than speed
   alone. A phlebotomy game whose only record is "fastest draw" teaches the
   wrong lesson, so every timed record here is gated on the draw being clean:
   the fastest CLEAN draw, the longest FLAWLESS streak. A fast bad draw sets
   no record at all.

   Each entry declares whether higher or lower is better, and whether it has a
   precondition, so the debrief can compare and announce without knowing
   anything about any individual measurement.

   Pure. Stored on the save under `bests`.
   ========================================================================= */

export const BESTS = [
  {
    id: "cleanDrawMs", label: "Fastest clean draw", unit: "duration", lower: true,
    /* Clean means: one stick, every specimen accepted, no complication missed.
       Without that gate this record would reward stabbing. */
    requires: r => r.oneStick && r.allAccepted && r.noMissedComplications,
  },
  {
    id: "entryAngleErr", label: "Best entry angle", unit: "degrees", lower: true,
    requires: r => r.flashed,
    format: v => `${Math.round(v)}° off ideal`,
  },
  {
    id: "coverage", label: "Best site coverage", unit: "percent", lower: false,
    format: v => `${Math.round(v)}%`,
  },
  {
    id: "flawlessStreak", label: "Longest flawless streak", unit: "count", lower: false,
    format: v => `${v} draw${v === 1 ? "" : "s"}`,
  },
  {
    id: "acceptedStreak", label: "Most consecutive accepted specimens", unit: "count", lower: false,
    format: v => `${v}`,
  },
  {
    id: "bandSeconds", label: "Shortest tourniquet time", unit: "seconds", lower: true,
    requires: r => r.flashed && r.allAccepted,
    format: v => `${v.toFixed(0)} s`,
  },
];

const BY_ID = Object.fromEntries(BESTS.map(b => [b.id, b]));

export function createBests(){ return {}; }

/**
 * Offers a set of readings and reports which of them are new records.
 *
 * @param {object} bests    the save's record object — MUTATED
 * @param {object} readings {id: value}. A missing id is simply not offered.
 * @param {object} context  the preconditions, e.g. {oneStick, allAccepted}
 * @returns {Array<{id,label,value,previous,format}>} beaten records, in the
 *   order they are declared, so the debrief can light them up one at a time.
 */
export function offerBests(bests, readings, context){
  const beaten = [];
  const ctx = context || {};
  for(const b of BESTS){
    const v = readings[b.id];
    if(typeof v !== "number" || !isFinite(v)) continue;
    if(b.requires && !b.requires(ctx)) continue;
    /* A HIGHER-IS-BETTER RECORD OF ZERO IS NOT A RECORD.

       Every reading beat an unset record, and on a first draw every record is
       unset — so a learner whose first attempt had a tube rejected was
       congratulated, at the payout, with "🥇 Longest flawless streak — new
       personal best" for a streak of nought, and "🥇 Most consecutive accepted
       specimens" for none. The debrief is where this game says what the draw
       was worth; a medal for the worst available outcome is the one thing it
       must not say. Zero coverage, zero streak and zero accepted specimens are
       all the absence of the thing being recorded rather than a low score at
       it. Nothing is stored either, so the first real one still announces. */
    if(!b.lower && v <= 0) continue;
    const prev = bests[b.id];
    const better = prev == null || (b.lower ? v < prev : v > prev);
    if(!better) continue;
    beaten.push({ id: b.id, label: b.label, value: v, previous: prev == null ? null : prev, format: b.format });
    bests[b.id] = v;
  }
  return beaten;
}

/** Renders a record's value the way its own entry says it should read. */
export function formatBest(id, value){
  const b = BY_ID[id];
  if(!b || value == null) return "—";
  if(b.format) return b.format(value);
  if(b.unit === "duration"){
    const s = Math.round(value/1000);
    return `${Math.floor(s/60)}:${String(s%60).padStart(2, "0")}`;
  }
  return String(Math.round(value));
}

export { BY_ID as BEST_BY_ID };
