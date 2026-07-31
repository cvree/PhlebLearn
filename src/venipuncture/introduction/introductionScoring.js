/* =========================================================================
   INTRODUCTION SCORING — real identifiers, real seconds, real omissions.

   The field names here are the ones rubric/policy.js grades this row on:
   `identifiedBeforeTouching`, `gloveAfterHygiene`, `handHygieneSeconds`. They
   are not invented for the rubric; they are what this step measures.

   Two mistake codes are classified in the policy as critical events:
   `oneIdentifier` (an automatic failure by default) and `leadingQuestion`.

   Pure maths.
   ========================================================================= */
import {
  evaluateIntroduction, identifiersObtained, identified, historyOf,
  missedQuestions, HYGIENE_GOOD_S, DRY_MIN_S, REQUIRED_IDENTIFIERS,
} from "./introductionRules.js";
import { secondsSince } from "./introductionState.js";

function round(v, dp){ const m = Math.pow(10, dp || 0); return Math.round(v*m)/m; }

export function measureIntroduction(state, result, o){
  const opt = o || {};
  const r = result || evaluateIntroduction(state);
  const ids = identifiersObtained(state);
  const h = historyOf(state.patient);
  const missed = missedQuestions(state);
  const mistakes = [];

  const identifiedBeforeTouching = identified(state) &&
    (state.firstTouchAt == null || (state.identifiedAt != null && state.identifiedAt <= state.firstTouchAt));

  const gloveAfterHygiene = !!state.gloved &&
    state.hygieneEndedAt != null &&
    state.glovedAt != null && state.glovedAt >= state.hygieneEndedAt;

  /* --- what went wrong, named ------------------------------------------------- */
  if(ids.length < REQUIRED_IDENTIFIERS) mistakes.push({
    code: "oneIdentifier", critical: true,
    message: ids.length === 0
      ? "The patient was never identified."
      : `Only one identifier (${ids[0]}) was obtained; two are required before collection.`,
  });
  if(state.leadingAsks > 0) mistakes.push({
    code: "leadingQuestion",
    message: `${state.leadingAsks} identifier${state.leadingAsks === 1 ? " was" : "s were"} read out for the patient to agree with. A patient will agree with a name that is not theirs.`,
  });
  if(!state.greeted) mistakes.push({
    code: "noGreeting",
    message: "You never introduced yourself or said what you were there to do.",
  });
  if(!identifiedBeforeTouching && state.firstTouchAt != null) mistakes.push({
    code: "touchedBeforeId",
    message: "You began handling the patient before their identity was settled.",
  });
  if(!state.orderConfirmed) mistakes.push({
    code: "orderNotConfirmed",
    message: "The order was never confirmed with the patient.",
  });
  if(!state.explained) mistakes.push({
    code: "notExplained",
    message: "The patient was not told what was about to happen.",
  });
  if(!state.asked.allergies) mistakes.push({
    code: "allergiesNotAsked",
    message: h.latexAllergy || h.adhesiveAllergy
      ? "Allergies were never asked about — and this patient had one that would have changed what you used."
      : "Allergies were never asked about.",
  });
  if(!state.asked.fainting) mistakes.push({
    code: "faintingNotAsked",
    message: h.faintHistory
      ? "You never asked about fainting — and this patient has gone out during a draw before."
      : "You never asked whether they had ever felt faint during a draw.",
  });
  if(!state.positioned) mistakes.push({
    code: "notPositioned",
    message: "The patient was never seated properly with the arm supported.",
  });
  if(state.hygieneSeconds <= 0) mistakes.push({
    code: "noHandHygiene", critical: true,
    message: "Hand hygiene was never performed.",
  });
  else if(state.hygieneSeconds < HYGIENE_GOOD_S) mistakes.push({
    code: "shortHandHygiene",
    message: `Hands were rubbed for ${round(state.hygieneSeconds, 1)}s; ${HYGIENE_GOOD_S}s is the taught minimum.`,
  });
  if(state.gloved && state.dryingSeconds < DRY_MIN_S && state.hygieneSeconds > 0) mistakes.push({
    code: "glovedWet",
    message: `Gloves went on after only ${round(state.dryingSeconds, 1)}s of drying.`,
  });
  if(!gloveAfterHygiene && state.gloved) mistakes.push({
    code: "glovedBeforeHygiene", critical: true,
    message: "Gloves went on before hand hygiene, which puts whatever was on your hands inside them.",
  });
  if(!state.gloved) mistakes.push({
    code: "notGloved", critical: true,
    message: "The draw was started ungloved.",
  });
  if(state.gloveContaminated) mistakes.push({
    code: "gloveContaminated", critical: true,
    message: `Gloved hands touched ${state.contaminatedBy} and were not changed.`,
  });
  if(h.latexAllergy && state.gloved && state.gloveMaterial === "latex") mistakes.push({
    code: "latexOnAllergicPatient", critical: true,
    message: "Latex gloves were used on a patient who reacts to latex.",
  });

  /* --- the score ---------------------------------------------------------------- */
  let score = 100;
  if(ids.length === 0) score -= 55;
  else if(ids.length < REQUIRED_IDENTIFIERS) score -= 35;
  score -= Math.min(20, state.leadingAsks*12);
  if(!state.greeted) score -= 6;
  if(!identifiedBeforeTouching && state.firstTouchAt != null) score -= 10;
  if(!state.orderConfirmed) score -= 8;
  if(!state.explained) score -= 8;
  if(!state.asked.allergies) score -= (h.latexAllergy || h.adhesiveAllergy) ? 16 : 8;
  if(!state.asked.fainting) score -= h.faintHistory ? 16 : 8;
  if(!state.positioned) score -= 6;
  if(state.hygieneSeconds <= 0) score -= 30;
  else if(state.hygieneSeconds < HYGIENE_GOOD_S) score -= Math.min(16, Math.round((HYGIENE_GOOD_S - state.hygieneSeconds)*1.2));
  if(state.gloved && state.dryingSeconds < DRY_MIN_S && state.hygieneSeconds > 0) score -= 6;
  if(!state.gloved) score -= 25;
  if(state.gloved && !gloveAfterHygiene) score -= 20;
  if(state.gloveContaminated) score -= 22;
  if(h.latexAllergy && state.gloveMaterial === "latex" && state.gloved) score -= 25;
  if(state.regloves > 0 && !state.gloveContaminated) score += 4;   // caught and corrected
  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    score,
    /* --- the numbers -------------------------------------------------- */
    identifiersUsed: ids.length,
    identifiers: ids,
    identifiersRequired: REQUIRED_IDENTIFIERS,
    leadingQuestions: state.leadingAsks,
    handHygieneSeconds: round(state.hygieneSeconds, 1),
    dryingSeconds: round(state.dryingSeconds, 1),
    questionsMissed: missed.length,
    missedQuestions: missed,
    transcriptLength: state.transcript.length,
    secondsElapsed: round(secondsSince(state, opt.now), 1),
    /* --- the judgements ----------------------------------------------- */
    greeted: !!state.greeted,
    identifiedBeforeTouching,
    gloveAfterHygiene,
    orderConfirmed: !!state.orderConfirmed,
    explained: !!state.explained,
    askedAllergies: !!state.asked.allergies,
    askedFainting: !!state.asked.fainting,
    positioned: !!state.positioned,
    gloved: !!state.gloved,
    gloveMaterial: state.gloveMaterial,
    gloveContaminated: !!state.gloveContaminated,
    regloves: state.regloves || 0,
    disclosures: state.disclosed.slice(),
    ready: r.ready,
    mistakes,
    criticalEvents: mistakes.filter(m => m.critical).map(m => m.code),
    narrative: narrate(state, ids, identifiedBeforeTouching, missed),
  };
}

function narrate(state, ids, beforeTouching, missed){
  const bits = [];
  bits.push(ids.length === 0
    ? "The patient was never identified"
    : `Identified by ${ids.join(" and ")}${state.leadingAsks ? `, ${state.leadingAsks} of which ${state.leadingAsks === 1 ? "was" : "were"} read out rather than asked for` : ""}`);
  if(state.firstTouchAt != null) bits.push(beforeTouching ? "before touching them" : "AFTER starting to handle them");
  bits.push(missed.length
    ? `${missed.length} of the interview missed (${missed.join(", ")})`
    : "the whole interview covered");
  bits.push(state.hygieneSeconds > 0
    ? `${Math.round(state.hygieneSeconds)}s of hand hygiene`
    : "no hand hygiene");
  if(state.gloved) bits.push(state.gloveContaminated ? "gloves contaminated after donning" : `${state.gloveMaterial} gloves on`);
  else bits.push("ungloved");
  return bits.join(", ") + ".";
}

/** Fold into the encounter's existing chips. */
export function applyIntroductionOutcome(procedureState, measurements){
  if(!procedureState || !measurements) return procedureState;
  const m = measurements;
  // `introOk` gates the `gather` step, and now means the patient was actually
  // identified and the phlebotomist is actually clean — not that a sequence of
  // taps was completed.
  procedureState.introOk = m.identifiersUsed >= m.identifiersRequired
    && m.gloved && !m.gloveContaminated && m.gloveAfterHygiene;
  procedureState.introductionMeasurements = m;
  return procedureState;
}
