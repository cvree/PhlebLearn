/* =========================================================================
   THE DEBRIEF — everything the encounter withheld, arriving as an event.

   The old game graded you eleven times per draw. Every section boundary fired
   a banner reading "Clean · Tourniquet 92/100 +14 XP", plus two XP a step.
   That told you your score before you had finished the patient, broke
   immersion exactly where flow should have carried you, and turned a medical
   procedure into a score-attack minigame — and it made the results screen
   anticlimactic, because by the time you reached it you had already been told
   everything on it.

   So during the draw there are now no numbers at all, and everything is held
   back to here and paced as FOUR ACTS:

     1  THE PATIENT LEAVES   No numbers. One line of outcome, in plain words:
                             "Three tubes, one stick, no bruise. She said thank
                             you." The emotional verdict, alone, for a beat.
     2  THE LAB              Specimens accepted or rejected, one at a time,
                             with reasons and with sound. The existing
                             specimenQuality logic is excellent; it is staged
                             here rather than listed.
     3  TECHNIQUE            Now the numbers, in real units — entry angle 24°,
                             band on 47 s, 1.2 mL under draw. One line of what
                             to fix, the highest-value one only. Personal bests
                             lighting up as they are beaten.
     4  REWARDS              XP, coins, streak, mastery, stickers. Every payout
                             suppressed during the draw, arriving at once,
                             generous and loud, because it was earned over four
                             minutes of silence.

   This module BUILDS the acts. It renders nothing and decides no arithmetic:
   rewards.js still computes every payout exactly as it did, and the only thing
   that changed is when it is shown.
   ========================================================================= */
import { SECTIONS, sectionMeasurements } from "../venipuncture/sections.js";
import { sectionScore } from "./rewards.js";

/* ---------- act 1: the plain-words verdict ----------------------------------- */

/**
 * One sentence, no numbers, in the register a colleague would use.
 *
 * This is the hardest line in the game to write and the most important one to
 * get right, because it is the first thing the player reads after four minutes
 * of deliberate silence. It is assembled from facts rather than picked from a
 * list of praise, so it can be quietly damning when it should be.
 */
export function outcomeLine(o){
  const parts = [];
  const tubes = o.tubesFilled;
  if(tubes > 0) parts.push(`${numberWord(tubes)} tube${tubes === 1 ? "" : "s"}`);
  else parts.push("No sample");

  if(o.sticks <= 1 && o.flashed) parts.push("one stick");
  else if(o.sticks > 1) parts.push(`${numberWord(o.sticks)} attempts`);

  if(o.bruised) parts.push("a bruise coming up");
  else if(o.flashed) parts.push("no bruise");

  const facts = parts.join(", ");
  const they = o.pronoun || "They";
  let closing;
  if(o.fainted) closing = `${they} went grey on you and had to lie down.`;
  else if(!o.flashed) closing = `${they} are holding ${o.possessive || "their"} arm.`;
  else if(o.sticks > 1 || o.bruised) closing = `${they} were patient about it.`;
  else if(o.anxious) closing = `${they} said that was easier than last time.`;
  else closing = `${they} said thank you.`;

  return `${capitalise(facts)}. ${closing}`;
}

function numberWord(n){
  return ["no", "one", "two", "three", "four", "five", "six", "seven", "eight"][n] || String(n);
}
function capitalise(s){ return s ? s[0].toUpperCase() + s.slice(1) : s; }

/* ---------- act 3: technique, in real units ---------------------------------- */

/**
 * The readings worth showing, each already carrying its own unit.
 *
 * Every one is a real measurement the draw produced, not a derived score, and
 * absent readings are simply absent rather than shown as zero — a draw that
 * never reached collection has no fill to report, and reporting "0.0 mL" for
 * it would be a lie about something that did not happen.
 */
export function techniqueLines(c){
  const out = [];
  const push = (label, value, ok) => { if(value != null) out.push({ label, value, ok }); };

  const tq = c.tourniquetMeasurements;
  if(tq){
    push("band on", `${Math.round(tq.secondsOn)} s`, tq.withinMinute);
    if(tq.heightAboveSiteInches != null){
      push("band height", `${tq.heightAboveSiteInches.toFixed(1)}″`, tq.positionOk);
    }
  }

  const cl = c.cleaningMeasurements;
  if(cl){
    push("coverage", `${cl.coveragePct}%`, cl.coveragePct >= 85);
    push("dry time", `${cl.dryingSeconds.toFixed(0)} s`, cl.driedFully);
  }

  const ins = c.insertMeasurements;
  if(ins){
    if(ins.angleDeg != null) push("entry angle", `${ins.angleDeg}°`, ins.angleDeg >= 15 && ins.angleDeg <= 30);
    if(ins.bevelUp != null) push("bevel", ins.bevelUp ? "up" : "rolled", ins.bevelUp);
    if(ins.reapproaches) push("re-sticks", String(ins.reapproaches), false);
    if(c.insertState && c.insertState.redirects) push("redirects", String(c.insertState.redirects), c.insertState.redirects <= 1);
  }

  const col = c.collectionMeasurements;
  if(col){
    push("blood collected", `${col.totalDrawnMl.toFixed(1)} mL`, !col.anyUnderfilled);
    if(col.peakNeedleShiftMm != null){
      push("needle movement", `${col.peakNeedleShiftMm.toFixed(1)} mm`, col.peakNeedleShiftMm <= 1);
    }
  }

  const wd = c.withdrawalMeasurements;
  if(wd) push("sharp exposed", `${wd.exposedSeconds.toFixed(1)} s`, wd.exposedSeconds < 3);

  const pd = c.postDrawMeasurements;
  if(pd) push("pressure held", `${Math.round(pd.effectiveSeconds)} s`, pd.effectiveSeconds >= pd.requiredSeconds);

  const inv = c.inversionMeasurements;
  if(inv) push("tubes mixed", `${inv.tubesUsable}/${inv.tubesRequired}`, inv.tubesUsable >= inv.tubesRequired);

  return out;
}

/**
 * The ONE thing to fix. Not a list.
 *
 * A learner given seven corrections fixes none of them. The mistakes each
 * scoring module already produces carry their own severity, so the highest-
 * value one is a question the data can answer — and a draw with nothing wrong
 * gets nothing, rather than a manufactured nitpick.
 */
export function headlineFix(c){
  const pools = [
    c.insertMeasurements, c.tourniquetMeasurements, c.collectionMeasurements,
    c.cleaningMeasurements, c.withdrawalMeasurements, c.postDrawMeasurements,
    c.palpationMeasurements, c.inversionMeasurements, c.stagingMeasurements,
  ].filter(Boolean);

  const RANK = { block: 0, major: 0, warn: 1, minor: 2, note: 3 };
  let best = null;
  for(const m of pools){
    for(const mistake of (m.mistakes || [])){
      const rank = RANK[mistake.severity] == null ? 2 : RANK[mistake.severity];
      if(!best || rank < best.rank) best = { rank, text: mistake.message || mistake.text };
    }
  }
  return best ? best.text : null;
}

/* ---------- section scores, for mastery and for the rubric ------------------- */

/**
 * Every section this draw actually produced a measurement for, scored on the
 * same 0–100 the rubric grades from.
 *
 * Sections the draw never reached are ABSENT rather than zero, which is what
 * lets mastery decline to punish a track that was never tested.
 */
export function sectionScores(c){
  const out = {};
  for(const section of SECTIONS){
    const readings = sectionMeasurements(c, section);
    if(!readings.length) continue;
    out[section.id] = sectionScore(readings);
  }
  return out;
}

/* ---------- the whole thing --------------------------------------------------- */

/**
 * Assembles the four acts.
 *
 * @param {object} o
 *   collect    the procedure state
 *   patient    the patient
 *   held       what was withheld during the draw: {xp, coins, streak,
 *              cleanSections, sectionsDone}
 *   specimens  the laboratory's verdict (specimenQuality)
 *   bests      personal bests beaten this draw
 *   mastery    tracks that gained a star this draw
 *   elapsedMs  how long the patient took
 */
export function buildDebrief(o){
  const c = o.collect || {};
  const p = o.patient || {};
  const q = o.specimens || null;
  const cx = c.complicationMeasurements || null;
  const ins = c.insertMeasurements || null;

  const sticks = 1 + (ins ? (ins.reapproaches || 0) : 0);
  const bruised = !!(cx && cx.hematomaMl > 0.4);

  const verdict = outcomeLine({
    tubesFilled: q ? q.total - q.rejectedCount : 0,
    sticks,
    flashed: !!(ins && ins.inVein),
    bruised,
    fainted: !!(cx && cx.fainted),
    anxious: !!(p.archetype === "anxious"),
    pronoun: p.pronoun || "They",
    possessive: p.possessive || "their",
  });

  return {
    acts: [
      { id: "patient", line: verdict, holdMs: 2000 },
      {
        id: "lab",
        specimens: q ? q.tubes.map(t => ({
          key: t.key, verdict: t.verdict, why: t.headline,
          fill: t.fillFraction,
        })) : [],
        accepted: q ? q.acceptedCount : 0,
        total: q ? q.total : 0,
        stepMs: 620,
      },
      {
        id: "technique",
        lines: techniqueLines(c),
        fix: headlineFix(c),
        bests: o.bests || [],
        mastery: o.mastery || [],
        elapsedMs: o.elapsedMs || 0,
      },
      { id: "rewards", held: o.held || { xp: 0, coins: 0 } },
    ],
  };
}
