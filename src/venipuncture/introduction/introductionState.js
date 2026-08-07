/* =========================================================================
   INTRODUCTION STATE — pure data and pure transitions.

   The transcript is the interaction. `say()` is the one write path both the
   pointer and the accessible controls call, so there is no way to reach a
   state through one input that the other cannot reach.

   Hand hygiene is a duration, not a flag: `scrubFor()` accumulates real
   seconds, and `dryFor()` accumulates the seconds between finishing and
   gloving. Both are injected rather than read from a clock, so the tests
   assert the same numbers the gesture produces.
   ========================================================================= */
import { ACT, actDef, IDENTIFIER, identified, historyOf } from "./introductionRules.js";

export function createIntroductionState(o){
  const opt = o || {};
  const now = opt.now == null ? Date.now() : opt.now;
  return {
    patient: opt.patient || null,
    tests: (opt.tests || []).slice(),
    tubeCount: opt.tubeCount == null ? 1 : opt.tubeCount,
    gloveMaterial: opt.gloveMaterial === "latex" ? "latex" : "nitrile",

    startedAt: now,
    finishedAt: null,

    /** everything said or done, in order — this is the session's own log */
    transcript: [],
    events: [],

    greeted: false,
    /** identifier source -> true once genuinely obtained */
    identifiers: { [IDENTIFIER.NAME]:false, [IDENTIFIER.DOB]:false, [IDENTIFIER.ID]:false },
    /** identifiers read out for the patient to agree with rather than asked for */
    leadingAsks: 0,
    identifiedAt: null,

    orderConfirmed: false,
    explained: false,
    asked: { allergies:false, fainting:false },
    /** what the patient disclosed, from trigger data — never from text */
    disclosed: [],

    positioned: false,
    /** the first time the learner handled the patient or their equipment */
    firstTouchAt: null,
    touchedBeforeIdAt: null,

    scrubbing: false,
    scrubBout: 0,
    hygieneStartedAt: null,
    hygieneEndedAt: null,
    hygieneSeconds: 0,
    dryingSeconds: 0,
    regloves: 0,

    gloved: false,
    glovedAt: null,
    gloveContaminated: false,
    contaminatedBy: null,

    /** acts already performed, so the UI can grey them without asking twice */
    done: {},
  };
}

function recordEvent(state, type, data){
  state.events.push({ t: Date.now(), type, data: data == null ? null : data });
  if(state.events.length > 200) state.events.shift();
}

function line(def, state){
  const p = state.patient || {};
  return String(def.say || "")
    .replace("{name}", p.name || "you")
    .replace("{dob}", p.dob || "that date")
    .replace("{tests}", state.tests.length ? state.tests.join(", ") : "some blood work")
    .replace("{tubeCount}", state.tubeCount === 1 ? "one tube" : `${state.tubeCount} tubes`);
}

/**
 * Some patients answer "what's your name?" with what they are called rather
 * than what they are registered as — which is not an identifier, and is the
 * one identification trap this step could not previously express.
 *
 * Explicit trigger data, like every other disclosure here: the patient's own
 * event object says so. The first open ask gets the nickname and confirms
 * nothing; asking again gets the legal name.
 */
function givesNicknameFirst(state){
  const ev = state.patient && state.patient.event;
  return !!(ev && ev.type === "verify" && ev.nickname)
    && !state.done[ACT.ASK_NAME_OPEN];
}

export function nicknameOf(patient){
  const first = (patient && patient.first) || "";
  return first[0] === "A" ? "AJ" : first.slice(0, 3);
}

/**
 * The patient's reply, decided from trigger DATA on the patient object.
 * A leading question still gets an answer — that is the whole hazard.
 */
function replyTo(def, state){
  const p = state.patient || {};
  const h = historyOf(p);
  switch(def.id){
    case ACT.GREET: return "Hello.";
    case ACT.ASK_NAME_OPEN:
      return givesNicknameFirst(state)
        ? `Oh — everyone just calls me ${nicknameOf(p)}.`
        : `${p.name || "…"}.`;
    case ACT.ASK_NAME_LEADING: return "…yes, that's right.";
    case ACT.ASK_DOB_OPEN: return `${p.dob || "…"}.`;
    case ACT.ASK_DOB_LEADING: return "Yes, that's me.";
    case ACT.CHECK_WRISTBAND: return `(band reads ${p.name || "—"} · ${p.id || "—"})`;
    case ACT.CONFIRM_ORDER: return "That's what they said, yes.";
    case ACT.EXPLAIN: return "Okay. Thank you for telling me.";
    case ACT.ASK_ALLERGIES:
      if(h.latexAllergy) return "Latex, yes — my skin comes up in a rash.";
      if(h.adhesiveAllergy) return "Just sticking plasters, they bring me out in a rash.";
      return "None that I know of.";
    case ACT.ASK_FAINTING:
      return h.faintHistory ? "I have, actually. Last time I went right out." : "No, I'm fine with needles.";
    case ACT.POSITION: return "That's comfortable, thanks.";
    case ACT.HAND_HYGIENE: return null;
    case ACT.GLOVE: return null;
    default: return null;
  }
}

/**
 * The one write path. Returns the state.
 *
 * @param {object} state
 * @param {string} actId
 * @param {object} [o]  { now }
 */
export function say(state, actId, o){
  const def = actDef(actId);
  if(!def || state.finishedAt != null) return state;
  const now = (o && o.now != null) ? o.now : Date.now();

  const wasIdentified = identified(state);

  if(def.id === ACT.GREET) state.greeted = true;

  // Read BEFORE the transcript entry is written, because whether this ask
  // produced an identifier and what the patient said are the same moment.
  const nicknameOnly = def.id === ACT.ASK_NAME_OPEN && givesNicknameFirst(state);
  if(def.identifier && !nicknameOnly){
    // A leading question still produces the identifier: the patient agrees.
    // That is exactly why it is unsafe, so it is recorded, not refused.
    state.identifiers[def.identifier] = true;
    if(def.leading) state.leadingAsks++;
  }
  if(def.id === ACT.CONFIRM_ORDER) state.orderConfirmed = true;
  if(def.id === ACT.EXPLAIN) state.explained = true;
  if(def.asks) state.asked[def.asks] = true;

  if(def.id === ACT.POSITION) state.positioned = true;

  if(def.hygiene){
    if(state.hygieneStartedAt == null) state.hygieneStartedAt = now;
  }
  if(def.gloves){
    state.gloved = true;
    state.glovedAt = now;
  }
  if(def.contaminates && state.gloved){
    state.gloveContaminated = true;
    state.contaminatedBy = def.contaminates;
  }

  if(def.touches){
    if(state.firstTouchAt == null) state.firstTouchAt = now;
    if(!wasIdentified && state.touchedBeforeIdAt == null) state.touchedBeforeIdAt = now;
  }

  const reply = replyTo(def, state);
  if(def.asks && reply) state.disclosed.push({ about: def.asks, said: reply });

  state.transcript.push({ t: now, act: def.id, said: line(def, state), reply });
  state.done[def.id] = (state.done[def.id] || 0) + 1;
  recordEvent(state, def.id, def.identifier ? { identifier: def.identifier, leading: !!def.leading } : null);

  if(!wasIdentified && identified(state)) state.identifiedAt = now;
  return state;
}

/* ---------- hand hygiene, as a duration ------------------------------------
   Three calls rather than one, because the pointer holds a button down for a
   real length of time and the display has to move while it does. Accumulating
   through `scrubFor()` sixty times a second would put sixty entries in the
   event log and reset the drying clock on every frame, so the log entry and
   the phase changes belong to begin/end and only the arithmetic to the tick.
   The accessible "rub for 5 seconds" control calls all three in order, so
   both paths land in exactly the same state. */

export function beginScrub(state, o){
  const now = (o && o.now != null) ? o.now : Date.now();
  if(state.scrubbing) return state;
  state.scrubbing = true;
  state.scrubBout = 0;
  if(state.hygieneStartedAt == null) state.hygieneStartedAt = now;
  // rubbing again after starting to dry restarts the drying clock
  state.dryingSeconds = 0;
  return state;
}

/** Accumulates real seconds of hand rubbing. Silent: called every frame. */
export function scrubFor(state, seconds){
  const s = Math.max(0, seconds || 0);
  if(!s) return state;
  state.hygieneSeconds += s;
  state.scrubBout = (state.scrubBout || 0) + s;
  state.dryingSeconds = 0;
  return state;
}

export function endScrub(state, o){
  const now = (o && o.now != null) ? o.now : Date.now();
  if(!state.scrubbing) return state;
  state.scrubbing = false;
  state.hygieneEndedAt = now;
  recordEvent(state, "scrub", { seconds: Math.round((state.scrubBout || 0)*10)/10 });
  state.scrubBout = 0;
  return state;
}

/** The whole rub in one call — what the accessible control uses. */
export function scrubBout(state, seconds, o){
  beginScrub(state, o);
  scrubFor(state, seconds);
  return endScrub(state, o);
}

/** Accumulates the seconds between finishing the rub and gloving. */
export function dryFor(state, seconds){
  if(state.hygieneEndedAt == null || state.gloved || state.scrubbing) return state;
  state.dryingSeconds += Math.max(0, seconds || 0);
  return state;
}

/** Changes which gloves are on the tray, before they go on. */
export function chooseGloves(state, material){
  if(state.gloved) return state;
  state.gloveMaterial = material === "latex" ? "latex" : "nitrile";
  recordEvent(state, "chooseGloves", { material: state.gloveMaterial });
  return state;
}

/** Fresh gloves after a contamination — the recoverable error. */
export function reglove(state, o){
  if(!state.gloved) return state;
  const now = (o && o.now != null) ? o.now : Date.now();
  state.gloveContaminated = false;
  state.contaminatedBy = null;
  state.glovedAt = now;
  state.regloves = (state.regloves || 0) + 1;
  recordEvent(state, "reglove", null);
  return state;
}

export function finish(state, o){
  const now = (o && o.now != null) ? o.now : Date.now();
  if(state.finishedAt == null) state.finishedAt = now;
  return state;
}

export function secondsSince(state, now){
  const t = now == null ? Date.now() : now;
  return Math.max(0, ((state.finishedAt || t) - state.startedAt) / 1000);
}
