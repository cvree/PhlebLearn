/* =========================================================================
   COMPLICATION SCORING — real reaction times, the real size of the bruise
   that formed, and which of the professional responses was actually chosen.

   Deliberately NOT "did a complication happen". Some complications are the
   learner's doing and some are the patient's body, and a rubric that punishes
   the second teaches people to hope nothing happens rather than to watch for
   it. What is measured here is: was it noticed, how quickly, was the right
   thing done, and what did the patient end up with.

   A draw with no complications scores 100 and says so — the row is "there was
   nothing to recognise", not a free four.

   Pure maths.
   ========================================================================= */
import {
  complicationFor, responseLabel, HEMATOMA_LARGE_ML, HEMATOMA_VISIBLE_ML,
} from "./complicationRules.js";
import { OUTCOME, allRecords } from "./complicationState.js";

function round(v, dp){ const m = Math.pow(10, dp || 0); return Math.round(v*m)/m; }

/**
 * @param {object} state   complicationState
 * @param {object} [o]     { now }
 */
export function measureComplications(state, o){
  const opt = o || {};
  const now = opt.now == null ? Date.now() : opt.now;
  const mistakes = [];
  const records = allRecords(state);

  const events = records.map(rec => {
    const def = complicationFor(rec.id);
    const outcome = rec.outcome || (rec.respondedAt ? (rec.correct ? OUTCOME.MANAGED : OUTCOME.WORSENED) : null);
    return {
      id: rec.id,
      label: def ? def.label : rec.id,
      emoji: def ? def.emoji : "⚠️",
      severity: def ? def.severity : "manage",
      onsetAt: rec.onsetAt,
      /** seconds between the first sign and the learner doing something */
      reactionS: rec.reactionS == null ? null : round(rec.reactionS, 1),
      responseId: rec.responseId,
      response: rec.responseId ? responseLabel(rec.responseId) : null,
      correct: rec.correct === true,
      outcome,
      /** still running when the draw ended */
      unresolved: !rec.respondedAt,
      teaching: def ? def.teaching : "",
    };
  });

  const managed = events.filter(e => e.outcome === OUTCOME.MANAGED);
  const worsened = events.filter(e => e.outcome === OUTCOME.WORSENED);
  const missed = events.filter(e => e.outcome === OUTCOME.MISSED || e.unresolved);
  const urgent = events.filter(e => e.severity === "urgent");

  for(const e of missed) mistakes.push({
    code: "missed", item: e.label, critical: true,
    message: `${e.label} was never acted on. ${e.teaching}`,
  });
  for(const e of worsened) mistakes.push({
    code: e.responseId === "probeAround" ? "probed"
      : (e.responseId === "continueAnyway" || e.responseId === "ignore") ? "continuedAnyway"
      : "wrongResponse",
    item: e.label, critical: true,
    message: `${e.label}: "${e.response}" was the wrong call. ${e.teaching}`,
  });
  const slow = managed.filter(e => {
    const def = complicationFor(e.id);
    return def && e.reactionS != null && e.reactionS > def.noticeWindowS;
  });
  for(const e of slow) mistakes.push({
    code: "slowResponse", item: e.label,
    message: `${e.label} was answered correctly, but ${e.reactionS}s after the first sign.`,
  });

  const hematomaMl = round(state.condition.hematomaMl, 2);
  if(hematomaMl >= HEMATOMA_LARGE_ML) mistakes.push({
    code: "largeHematoma", item: "Hematoma", critical: true,
    message: `${hematomaMl} mL of blood went into the tissue — that is the bruise the patient rings the lab about tomorrow.`,
  });
  else if(hematomaMl >= HEMATOMA_VISIBLE_ML) mistakes.push({
    code: "hematoma", item: "Hematoma",
    message: `${hematomaMl} mL of blood went into the tissue: a visible bruise at the site.`,
  });
  if(state.fainted) mistakes.push({
    code: "patientFainted", item: "Syncope", critical: true,
    message: "The patient lost consciousness. The signs were there for seconds beforehand.",
  });

  /* --- the score -------------------------------------------------------------
     A clean draw with nothing to recognise is a 100 and says so; every point
     lost below is tied to a named event, so the report can always answer
     "which of these cost me that". */
  let score = 100;
  score -= missed.length*30;
  score -= worsened.length*26;
  score -= slow.length*8;
  score -= Math.min(24, Math.round(hematomaMl*16));
  if(state.fainted) score -= 22;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const reactions = managed.map(e => e.reactionS).filter(v => v != null);
  const meanReactionS = reactions.length
    ? round(reactions.reduce((a, b)=>a + b, 0)/reactions.length, 1) : null;

  return {
    score,
    events,
    total: events.length,
    managedCount: managed.length,
    worsenedCount: worsened.length,
    missedCount: missed.length,
    urgentCount: urgent.length,
    slowCount: slow.length,
    meanReactionS,
    /** the one number that says what the patient actually left with */
    hematomaMl,
    hematomaGrade: hematomaMl >= HEMATOMA_LARGE_ML ? "large"
      : hematomaMl >= HEMATOMA_VISIBLE_ML ? "visible" : "none",
    fainted: !!state.fainted,
    /** 1 when every complication that arose was recognised and answered right */
    recognitionRate: events.length ? round(managed.length/events.length, 2) : 1,
    harm: round(state.harm, 2),
    secondsElapsed: round((now - state.startedAt)/1000, 1),
    mistakes,
    criticalEvents: mistakes.filter(m => m.critical).map(m => m.code),
    narrative: narrate(events, managed, worsened, missed, hematomaMl, state.fainted),
  };
}

function narrate(events, managed, worsened, missed, hematomaMl, fainted){
  if(!events.length){
    return "Nothing went wrong with this patient — and nothing had to be recognised.";
  }
  const bits = [];
  bits.push(`${events.length} complication${events.length === 1 ? "" : "s"} arose`);
  if(managed.length) bits.push(`${managed.length} recognised and handled correctly`);
  if(worsened.length) bits.push(`${worsened.length} answered with the wrong action`);
  if(missed.length) bits.push(`${missed.length} never acted on`);
  if(hematomaMl >= HEMATOMA_VISIBLE_ML) bits.push(`${hematomaMl} mL into the tissue`);
  if(fainted) bits.push("the patient fainted");
  return bits.join(", ") + ".";
}

/** Fold into the encounter's existing chips, the way every branch does. */
export function applyComplicationOutcome(procedureState, measurements){
  if(!procedureState || !measurements) return procedureState;
  const m = measurements;
  procedureState.complicationsOk = m.missedCount === 0 && m.worsenedCount === 0 && !m.fainted;
  procedureState.complicationCount = m.total;
  procedureState.hematomaMl = m.hematomaMl;
  procedureState.complicationMeasurements = m;
  return procedureState;
}
