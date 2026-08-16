/* =========================================================================
   INTRODUCTION AND IDENTIFICATION — clinical judgement only.

   This is the one rubric row that had no instrumentation at all, and the
   brief is explicit about what it must not be: an "Introduction complete"
   button. What the learner does here is CHOOSE WHAT TO SAY AND IN WHAT
   ORDER, and the order is most of the judgement.

   Two things drive everything below.

   1. ASKING IS NOT THE SAME AS CONFIRMING. "You're Jane Cooper, aren't you?"
      gets a yes from anybody. An identifier only counts when the learner
      asked OPEN and the patient supplied it. A leading question still
      produces the answer — patients are agreeable — which is exactly why it
      is dangerous and why it is recorded rather than blocked.

   2. CLINICAL FACTS ARE TRIGGER DATA, NEVER TEXT. Whether this patient has a
      latex allergy or a history of fainting is `patient.history.latexAllergy`
      and `patient.history.faintHistory` — booleans on the encounter, decided
      when the patient was generated. Nothing here reads a sentence to find
      out. The same rule the anticoagulated patient already follows.

   Pure: named state in, plain data out. No DOM, no THREE.
   ========================================================================= */

/** Everything the learner can do in this step. */
export const ACT = {
  GREET:            "greet",
  ASK_NAME_OPEN:    "askNameOpen",
  ASK_NAME_LEADING: "askNameLeading",
  ASK_DOB_OPEN:     "askDobOpen",
  ASK_DOB_LEADING:  "askDobLeading",
  CHECK_WRISTBAND:  "checkWristband",
  CONFIRM_ORDER:    "confirmOrder",
  EXPLAIN:          "explain",
  ASK_ALLERGIES:    "askAllergies",
  ASK_FAINTING:     "askFainting",
  POSITION:         "position",
  HAND_HYGIENE:     "handHygiene",
  GLOVE:            "glove",
  TOUCH_PHONE:      "touchPhone",
  TOUCH_DOOR:       "touchDoor",
};

/** The three identifier sources, and which acts obtain each. */
export const IDENTIFIER = { NAME:"name", DOB:"dob", ID:"id" };

export const ACT_DEFS = [
  { id:ACT.GREET, label:"Introduce yourself and say what you're here for",
    say:"Hello, I'm your phlebotomist. I'm here to collect a blood sample for your doctor." },

  { id:ACT.ASK_NAME_OPEN, label:"Ask them to state their full name", open:true, identifier:IDENTIFIER.NAME,
    say:"Could you tell me your full name, please?" },
  { id:ACT.ASK_NAME_LEADING, label:"Confirm the name off the requisition", open:false, identifier:IDENTIFIER.NAME,
    leading:true, say:"You're {name}, is that right?" },

  { id:ACT.ASK_DOB_OPEN, label:"Ask them to state their date of birth", open:true, identifier:IDENTIFIER.DOB,
    say:"And your date of birth?" },
  { id:ACT.ASK_DOB_LEADING, label:"Read the date of birth out for them to agree with", open:false,
    identifier:IDENTIFIER.DOB, leading:true, say:"Date of birth {dob}, yes?" },

  { id:ACT.CHECK_WRISTBAND, label:"Read the wristband and match it to the requisition", open:true,
    identifier:IDENTIFIER.ID, say:"Let me just check your band against the order." },

  { id:ACT.CONFIRM_ORDER, label:"Confirm what has been ordered and by whom",
    say:"Your doctor has asked for {tests}. Does that match what you were told?" },
  { id:ACT.EXPLAIN, label:"Explain what is about to happen",
    say:"I'll put a band on your arm, clean the skin, and take {tubeCount}. It takes about a minute." },
  { id:ACT.ASK_ALLERGIES, label:"Ask about allergies", asks:"allergies",
    say:"Any allergies I should know about — latex, adhesive, anything like that?" },
  { id:ACT.ASK_FAINTING, label:"Ask whether they have ever felt faint during a blood draw", asks:"fainting",
    say:"Have you ever felt faint or lightheaded having blood taken?" },

  { id:ACT.POSITION, label:"Seat them properly and support the arm", touches:true,
    say:"Let's get you comfortable — sit right back, and rest your arm on this." },

  { id:ACT.HAND_HYGIENE, label:"Wash and rub your hands", hygiene:true,
    say:"(washing hands)" },
  { id:ACT.GLOVE, label:"Put gloves on", gloves:true, touches:true,
    say:"(gloving)" },

  { id:ACT.TOUCH_PHONE, label:"Answer your phone", contaminates:"a phone",
    say:"(picks up the phone)" },
  { id:ACT.TOUCH_DOOR, label:"Pull the curtain across", contaminates:"the curtain",
    say:"(pulls the curtain)" },
];

export function actDef(id){ return ACT_DEFS.find(a => a.id === id) || null; }

/* ---------- thresholds ------------------------------------------------------
   These are the step's own clinical constants. The RUBRIC's excellent band for
   hand-hygiene duration lives in rubric/policy.js and is configurable there;
   these are the point at which the technique itself is wrong rather than
   merely short of excellent. */
export const HYGIENE_MIN_S = 15;     // below this the rub has not been done
export const HYGIENE_GOOD_S = 20;    // the widely taught minimum
export const DRY_MIN_S = 5;          // gloves over wet hands tear and slip
export const REQUIRED_IDENTIFIERS = 2;

/** The identifiers this attempt has actually obtained. */
export function identifiersObtained(state){
  return Object.keys(state.identifiers).filter(k => state.identifiers[k]);
}

/** True once enough identifiers are in hand to say who this is. */
export function identified(state){
  return identifiersObtained(state).length >= REQUIRED_IDENTIFIERS;
}

/**
 * The disclosures this patient WOULD make, from explicit trigger data. Never
 * inferred from any sentence.
 */
export function historyOf(patient){
  const h = (patient && patient.history) || {};
  return {
    latexAllergy: !!h.latexAllergy,
    adhesiveAllergy: !!h.adhesiveAllergy,
    faintHistory: !!h.faintHistory,
  };
}

/** Anything the learner has not covered that this patient needed. */
export function missedQuestions(state){
  const out = [];
  if(!state.asked.allergies) out.push("allergies");
  if(!state.asked.fainting) out.push("fainting");
  if(!state.orderConfirmed) out.push("order");
  if(!state.explained) out.push("explanation");
  return out;
}

function issue(code, severity, message, data){
  return { code, severity, message, data: data == null ? null : data };
}

/**
 * @param {object} state  introductionState
 * @returns {{ready, issues, blocking, checks}}
 */
export function evaluateIntroduction(state){
  const issues = [];
  const ids = identifiersObtained(state);

  if(!state.greeted) issues.push(issue("noGreeting", "warn",
    "You have not introduced yourself or said what you are here to do."));

  if(ids.length === 0) issues.push(issue("noIdentifiers", "block",
    "Nobody has been identified yet. Ask them to state their name."));
  else if(ids.length < REQUIRED_IDENTIFIERS) issues.push(issue("oneIdentifier", "block",
    `Only one identifier (${ids[0]}) has been obtained. Two are needed before anything is collected.`));

  if(state.leadingAsks > 0) issues.push(issue("leadingQuestion", "warn",
    `${state.leadingAsks} identifier${state.leadingAsks === 1 ? " was" : "s were"} read out for the patient to agree with rather than asked for.`));

  if(state.touchedBeforeIdAt != null) issues.push(issue("touchedBeforeId", "warn",
    "You started handling the patient before their identity was settled."));

  if(!state.orderConfirmed) issues.push(issue("orderNotConfirmed", "warn",
    "The order has not been confirmed with the patient."));
  if(!state.explained) issues.push(issue("notExplained", "warn",
    "The patient has not been told what is about to happen."));
  if(!state.asked.allergies) issues.push(issue("allergiesNotAsked", "warn",
    "Allergies have not been asked about."));
  if(!state.asked.fainting) issues.push(issue("faintingNotAsked", "warn",
    "You have not asked whether they have ever felt faint during a draw."));

  if(!state.positioned) issues.push(issue("notPositioned", "warn",
    "The patient is not seated with the arm supported."));

  if(state.hygieneSeconds < HYGIENE_MIN_S) issues.push(issue("handsNotWashed", "block",
    state.hygieneSeconds === 0
      ? "Your hands have not been washed."
      : `Only ${Math.round(state.hygieneSeconds)}s of hand hygiene — ${HYGIENE_GOOD_S}s is the taught minimum.`));

  if(state.gloved && state.dryingSeconds < DRY_MIN_S && state.hygieneSeconds > 0){
    issues.push(issue("glovedWet", "warn",
      "Gloves went on before your hands were dry."));
  }
  if(state.gloved && state.hygieneEndedAt == null) issues.push(issue("glovedBeforeHygiene", "block",
    "Gloves went on before your hands were washed at all."));
  if(!state.gloved) issues.push(issue("notGloved", "block", "You are not gloved."));
  if(state.gloveContaminated) issues.push(issue("gloveContaminated", "block",
    `Your gloves touched ${state.contaminatedBy} after you put them on.`));

  const h = historyOf(state.patient);
  if(h.latexAllergy && state.gloved && state.gloveMaterial === "latex"){
    issues.push(issue("latexOnAllergicPatient", "block",
      "This patient told you they react to latex, and you are wearing latex gloves."));
  }
  if(h.latexAllergy && !state.asked.allergies) issues.push(issue("allergyMissed", "warn",
    "This patient has an allergy that would have changed what you used, and you did not ask."));
  if(h.faintHistory && !state.asked.fainting) issues.push(issue("faintRiskMissed", "warn",
    "This patient has fainted during a draw before, and you did not ask."));

  const blocking = issues.filter(i => i.severity === "block");
  return {
    ready: blocking.length === 0,
    issues,
    blocking,
    checks: {
      identified: identified(state),
      identifiers: ids,
      greeted: state.greeted,
      orderConfirmed: state.orderConfirmed,
      explained: state.explained,
      allergies: state.asked.allergies,
      fainting: state.asked.fainting,
      positioned: state.positioned,
      handsWashed: state.hygieneSeconds >= HYGIENE_MIN_S,
      handsDry: state.dryingSeconds >= DRY_MIN_S,
      gloved: state.gloved && !state.gloveContaminated,
    },
  };
}

/** The single next thing worth doing — Learn mode's prompt. */
export function nextAction(state){
  const r = evaluateIntroduction(state);
  if(!state.greeted) return "Introduce yourself and say what you are here to do.";
  if(!identified(state)) return "Ask them to state their name and date of birth — ask, do not read it out for them.";
  if(!state.orderConfirmed) return "Confirm what has been ordered.";
  if(!state.explained) return "Tell them what is about to happen.";
  if(!state.asked.allergies) return "Ask about allergies before you pick your gloves.";
  if(!state.asked.fainting) return "Ask whether they have ever felt faint having blood taken.";
  if(!state.positioned) return "Seat them properly and support the arm.";
  if(state.hygieneSeconds < HYGIENE_GOOD_S) return `Wash your hands — keep rubbing for ${HYGIENE_GOOD_S}s.`;
  if(!state.gloved) return "Let your hands dry, then glove.";
  if(state.gloveContaminated) return "Change those gloves — they have touched something since you put them on.";
  return r.ready ? "Ready to prepare your work area." : r.blocking[0].message;
}

/** The most useful issue to show, most serious first. */
export function nextIssue(result){
  if(!result || !result.issues.length) return null;
  return result.blocking[0] || result.issues[0];
}

/* =========================================================================
   WHAT IS LIVE RIGHT NOW — the few things worth saying at this moment.

   The introduction used to render as five fieldsets holding thirteen written
   sentences, and the learner clicked one. That is a multiple-choice question
   about a conversation, not a conversation, and it is the single largest
   reason the step read as a form.

   A real introduction has two or three live moves at any moment: you have not
   said hello yet, so say hello; you have their name but not their date of
   birth, so ask for it. This returns exactly those, in the order the step's
   own `nextAction()` already ranks them.

   ONE RULE IS LOAD-BEARING. Where an act has a LEADING variant — reading the
   name off the requisition for the patient to agree with, rather than asking
   them to state it — the two are returned TOGETHER, always. Choosing wrongly
   has to be as easy as choosing rightly, or the trap teaches nothing; a
   patient will agree to a name that is not theirs, and that is the entire
   lesson. Hiding the leading variant would be the game refusing to let the
   learner make the mistake it exists to warn them about.

   Pure. The arrival room renders what this returns; it decides nothing.
   ========================================================================= */

/** Acts that are never "next" — they are objects in the room, not moves. */
const NOT_A_MOVE = [ACT.HAND_HYGIENE, ACT.GLOVE, ACT.TOUCH_PHONE, ACT.TOUCH_DOOR];

export function liveActs(state, limit){
  const n = limit == null ? 3 : limit;
  const s = state || {};
  const done = s.done || {};
  const ids = s.identifiers || {};
  const asked = s.asked || {};

  /* Ranked the way the work actually runs. Each entry is a group, and a group
     is kept whole — which is how an open ask and its leading twin stay side
     by side however few slots are left. */
  const groups = [];
  if(!s.greeted) groups.push([ACT.GREET]);
  if(!ids[IDENTIFIER.NAME]) groups.push([ACT.ASK_NAME_OPEN, ACT.ASK_NAME_LEADING]);
  if(!ids[IDENTIFIER.DOB]) groups.push([ACT.ASK_DOB_OPEN, ACT.ASK_DOB_LEADING]);
  if(!ids[IDENTIFIER.ID]) groups.push([ACT.CHECK_WRISTBAND]);
  if(!s.orderConfirmed) groups.push([ACT.CONFIRM_ORDER]);
  if(!s.explained) groups.push([ACT.EXPLAIN]);
  if(!asked.allergies) groups.push([ACT.ASK_ALLERGIES]);
  if(!asked.fainting) groups.push([ACT.ASK_FAINTING]);
  if(!s.positioned) groups.push([ACT.POSITION]);

  const out = [];
  for(const g of groups){
    const fresh = g.filter(id => !done[id] && NOT_A_MOVE.indexOf(id) < 0);
    if(!fresh.length) continue;
    // A group is taken whole or not at all, so the pair never splits.
    if(out.length && out.length + fresh.length > n) break;
    out.push(...fresh);
    if(out.length >= n) break;
  }
  return out;
}

/**
 * True once the learner has everything they need to start touching the
 * patient: two identifiers, from the patient's own mouth or their band.
 *
 * This is the ONE gate the arrival room enforces. Everything else it measures
 * — the leading question, the missing allergy ask, the ungloved hands — is
 * recorded and reported rather than blocked, because the draw has to be able
 * to go wrong for the report to mean anything.
 */
export function mayStartDraw(state){ return identified(state); }
