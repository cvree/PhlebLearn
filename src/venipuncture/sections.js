/* =========================================================================
   SECTIONS — the procedure's steps grouped by the technique they belong to.

   A "step" is one screen. A SECTION is one piece of technique, which may
   take several steps to perform (release → withdraw → safety → dispose is
   one continuous handling of a used sharp) and which produces one or two
   measurement objects when it ends.

   Two features need this grouping and nothing else does:

     Practice mode's feedback, which the brief places "at the end of each
     section" rather than after every screen, and

     Practice mode's repeatable weak sections, which need to know which
     session objects to clear so the section genuinely starts again.

   Sequencing still comes from procedureState.js — this file never decides
   what runs next, only which steps belong together.

   Pure data plus pure helpers. No DOM, no THREE, no game state.
   ========================================================================= */
import { MEASUREMENT_SOURCES } from "./rubric/policy.js";

export const SECTIONS = [
  {
    id: "introduction", label: "Introduction and identification",
    steps: ["introduce"],
    measurements: ["introduction"],
    sessions: ["introduction"],
    chips: ["introOk"],
  },
  {
    id: "prep", label: "Work-area preparation",
    steps: ["gather"],
    measurements: ["supplyStaging"],
    sessions: ["supplies"],
    chips: ["gatherOk"],
  },
  {
    id: "tourniquet", label: "Tourniquet",
    steps: ["tourniquet"],
    measurements: ["tourniquet"],
    sessions: ["tourniquet"],
    chips: ["tourniquetOn", "tqGood", "tqSeconds"],
  },
  {
    id: "palpation", label: "Vein selection",
    steps: ["palpate"],
    measurements: ["palpation"],
    sessions: ["palpation"],
    chips: ["veinOk"],
  },
  {
    id: "cleaning", label: "Site antisepsis",
    steps: ["clean"],
    measurements: ["cleaning"],
    sessions: ["cleaning"],
    chips: ["cleanOk"],
  },
  {
    // Assembly and uncapping share one needle unit, so they share one
    // session and have to be replayed together — you cannot re-uncap a
    // needle that was never threaded on.
    id: "equipment", label: "Needle assembly and uncapping",
    steps: ["assemble", "uncap"],
    measurements: ["assembly", "uncap"],
    sessions: ["needleUnit"],
    chips: ["assembleOk", "uncapOk"],
  },
  {
    id: "insert", label: "Anchor and insertion",
    steps: ["insert"],
    measurements: ["insert"],
    sessions: ["insert"],
    chips: ["insertOk"],
  },
  {
    id: "collection", label: "Tube collection",
    steps: ["fill", "switch"],
    measurements: ["collection"],
    sessions: ["collection"],
    chips: ["fillGood", "tubeOrderOk", "filled", "fillFinal"],
  },
  {
    id: "withdrawal", label: "Withdrawal, safety and sharps",
    steps: ["release", "withdraw", "safety", "dispose"],
    measurements: ["withdrawal"],
    sessions: ["withdrawal"],
    chips: ["withdrawOk", "safetyOk", "disposeOk", "lastTubeRemoved"],
  },
  {
    id: "postDraw", label: "Pressure and bandaging",
    steps: ["pressure", "bandage"],
    measurements: ["postDraw"],
    sessions: ["postDraw"],
    chips: ["pressureOk", "bandageOk"],
  },
  {
    id: "inversion", label: "Specimen mixing",
    steps: ["invert"],
    measurements: ["inversion"],
    sessions: ["inversion"],
    chips: ["mixOk", "invCounts"],
  },
];

/** The section a step id belongs to, or null for an unsectioned step. */
export function sectionForStep(stepId){
  return SECTIONS.find(s => s.steps.indexOf(stepId) >= 0) || null;
}

/**
 * True when finishing `finishedId` ends its section — either the next step
 * belongs to a different section, or there is no next step.
 *
 * Deliberately compares SECTIONS, not step ids: a draw with one tube has no
 * `switch` step, so "did the collection section just end?" cannot be
 * answered by asking whether the id was the last one in the list.
 */
export function endsSection(finishedId, nextId){
  const from = sectionForStep(finishedId);
  if(!from) return false;
  if(!nextId) return true;
  const to = sectionForStep(nextId);
  return !to || to.id !== from.id;
}

/** Index in `steps` of the first step of `section` that this draw contains. */
export function firstStepIndex(section, steps){
  for(let i = 0; i < steps.length; i++){
    if(section.steps.indexOf(steps[i]) >= 0) return i;
  }
  return -1;
}

/**
 * Clears one section AND everything downstream of it, then returns the step
 * index to rewind to (or -1 if this draw does not contain the section).
 *
 * Downstream sessions go too, because they are built FROM the upstream ones:
 * `ensureCollectionSession()` reads the insert session's vessel and entry
 * point, so a re-done insertion with a stale collection session would
 * collect from a puncture that no longer exists.
 *
 * Clearing a session is also exactly what the `ensure*Session()` gating rule
 * wants — those fallbacks are gated on "that step never ran at all", and
 * after this it genuinely never did.
 *
 * @param {object} c        the procedure state (ENC.collect)
 * @param {string} sectionId
 * @returns {number} the step index to set, or -1
 */
export function resetFromSection(c, sectionId){
  const at = SECTIONS.findIndex(s => s.id === sectionId);
  if(at < 0 || !c) return -1;
  const target = SECTIONS[at];
  const index = firstStepIndex(target, c.steps || []);
  if(index < 0) return -1;

  for(let i = at; i < SECTIONS.length; i++){
    const s = SECTIONS[i];
    for(const field of s.sessions) c[field] = null;
    for(const key of s.measurements) c[measurementField(key)] = null;
    for(const chip of s.chips) delete c[chip];
  }
  // The arm itself survives: it is the same patient, and rebuilding it would
  // silently re-roll the vein geometry the learner already palpated.
  return index;
}

/** measurement key → the procedure-state field its scorer writes.
    One source of truth: the rubric policy already owns this mapping. */
export function measurementField(key){
  return MEASUREMENT_SOURCES[key] || `${key}Measurements`;
}

/** The measurement objects a finished section produced, for its feedback. */
export function sectionMeasurements(c, section){
  return section.measurements
    .map(key => ({ key, measurement: c ? c[measurementField(key)] : null }))
    .filter(x => !!x.measurement);
}
