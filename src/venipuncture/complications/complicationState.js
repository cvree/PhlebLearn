/* =========================================================================
   COMPLICATION STATE — what has gone wrong with this patient, when it
   started, how long it went unnoticed, what was done about it, and what that
   cost them.

   Carried on the encounter alongside every other branch's state, because a
   hematoma that started during the stick is still on the arm during the
   bandage and is still on the arm in the report. That persistence is the
   whole point: the consequence outlives the step that caused it.

   Every field is either something the patient's body did or something the
   learner did about it. `complicationRules.js` decides what starts and
   whether an answer was right; this file only records and progresses.

   Pure data — no THREE, no DOM, no clock of its own.
   ========================================================================= */
import {
  COMPLICATION, complicationFor, isCorrectResponse, harmOf,
  syncopeRiskFor, SYNCOPE_FAINT_AFTER_S, HEMATOMA_LARGE_ML,
} from "./complicationRules.js";

/** How the learner ended up dealing with one complication. */
export const OUTCOME = {
  MANAGED: "managed",     // recognised and answered correctly
  WORSENED: "worsened",   // answered, wrongly
  MISSED: "missed",       // never answered at all
};

/**
 * @param {object} o
 *   patient       the encounter's patient — read for explicit trigger data only
 *   procedureId   which draw this is
 *   rng           injectable 0..1 source, so tests are deterministic
 *   difficulty    0–4; raises the standing rate at which a body reacts at all
 */
export function createComplicationState(o){
  const opt = o || {};
  const rng = typeof opt.rng === "function" ? opt.rng : Math.random;
  const dl = opt.difficulty == null ? 0 : Math.max(0, Math.min(4, opt.difficulty));

  return {
    procedureId: opt.procedureId || null,
    difficulty: dl,

    /** id → live record, for the ones that are happening now */
    active: {},
    /** the ids in the order they started, so the coach shows the oldest first */
    order: [],
    /** ids that have finished, however they finished */
    resolved: [],
    /** every finished record, for the report and the replay */
    history: [],

    /* --- the two genuinely probabilistic bits, rolled ONCE, up front ------
       Rolled at creation rather than at trigger time so a complication cannot
       be re-rolled into existence by the watcher ticking again, and so a test
       can hand in an rng and know exactly what this patient will do. */
    syncopeRisk: syncopeRiskFor(opt.patient),
    /** the level the accumulated pressure has to reach for the prodrome */
    syncopeThreshold: 0.55 + rng()*0.35 - dl*0.03,
    flinchChance: 0.35 + dl*0.06,
    flinchRoll: rng(),

    /** rises as things go badly for the patient; feeds the syncope trigger */
    distress: 0,
    /** total harm actually done to this patient, 0..n */
    harm: 0,

    /* --- what the arm looks like now, 0..1 unless noted ------------------- */
    condition: {
      /** millilitres of blood in the tissue — the bruise's real size */
      hematomaMl: 0,
      swelling: 0,
      bruise: 0,
      pallor: 0,
      flush: 0,
      /** a one-off jerk; decays on its own */
      flinch: 0,
    },

    /** the patient actually lost consciousness */
    fainted: false,

    startedAt: opt.now == null ? Date.now() : opt.now,
    events: [],
  };
}

export function recordEvent(state, type, data){
  state.events.push({ t: Date.now(), type, data: data == null ? null : data });
  if(state.events.length > 200) state.events.shift();
  return state;
}

/* =========================================================================
   THE LIFECYCLE OF ONE COMPLICATION
   ========================================================================= */

/** Starts one. Idempotent: a complication already running is left alone. */
export function onset(state, id, data, now){
  if(state.active[id] || state.resolved.indexOf(id) >= 0) return state;
  const def = complicationFor(id);
  if(!def) return state;
  const t = now == null ? Date.now() : now;

  state.active[id] = {
    id,
    onsetAt: t,
    data: data || null,
    /** the learner has looked at it — set the moment the cue is shown to them */
    shownAt: null,
    respondedAt: null,
    responseId: null,
    correct: null,
    reactionS: null,
    /** how far it has been allowed to run, 0..1 */
    progress: 0,
  };
  state.order.push(id);
  applySign(state, def, 0.25, true);
  recordEvent(state, "onset", { id });
  return state;
}

/** The cue has been put in front of the learner. */
export function markShown(state, id, now){
  const rec = state.active[id];
  if(!rec || rec.shownAt != null) return state;
  rec.shownAt = now == null ? Date.now() : now;
  return state;
}

/**
 * The learner answers. One answer ends it, right or wrong — which is exactly
 * how it works at the chair: you do not get to try "carry on anyway" and then
 * take it back once the arm swells.
 */
export function respond(state, id, responseId, now){
  const rec = state.active[id];
  if(!rec || rec.respondedAt != null) return state;
  const t = now == null ? Date.now() : now;
  const correct = isCorrectResponse(id, responseId);

  rec.respondedAt = t;
  rec.responseId = responseId;
  rec.correct = correct;
  rec.reactionS = (t - rec.onsetAt)/1000;

  if(correct){
    finish(state, id, OUTCOME.MANAGED, t);
  }else{
    const harm = harmOf(responseId);
    state.harm += harm;
    state.distress += harm*0.5;
    worsen(state, id, harm);
    finish(state, id, OUTCOME.WORSENED, t);
  }
  recordEvent(state, "respond", { id, responseId, correct });
  return state;
}

/** Nobody ever answered. The body does not wait. */
export function miss(state, id, now){
  const rec = state.active[id];
  if(!rec || rec.respondedAt != null) return state;
  const t = now == null ? Date.now() : now;
  rec.respondedAt = t;
  rec.responseId = null;
  rec.correct = false;
  rec.reactionS = null;
  state.harm += 1;
  state.distress += 0.5;
  worsen(state, id, 1);
  finish(state, id, OUTCOME.MISSED, t);
  recordEvent(state, "missed", { id });
  return state;
}

function finish(state, id, outcome, t){
  const rec = state.active[id];
  if(!rec) return;
  rec.outcome = outcome;
  rec.endedAt = t;
  state.history.push(rec);
  state.resolved.push(id);
  delete state.active[id];
  const at = state.order.indexOf(id);
  if(at >= 0) state.order.splice(at, 1);
}

/**
 * What carrying on regardless actually does to the patient. Each of these is
 * the specific physical consequence of THAT complication, not a generic
 * penalty: a hematoma gets bigger, a faint becomes a faint.
 */
function worsen(state, id, severity){
  const k = Math.max(0, Math.min(1, severity));
  const cond = state.condition;
  if(id === COMPLICATION.HEMATOMA){
    cond.hematomaMl += 0.9*k;
    cond.swelling = Math.min(1, cond.swelling + 0.35*k);
    cond.bruise = Math.min(1, cond.bruise + 0.40*k);
  }else if(id === COMPLICATION.BLOWN_VEIN){
    cond.hematomaMl += 0.7*k;
    cond.swelling = Math.min(1, cond.swelling + 0.45*k);
    cond.bruise = Math.min(1, cond.bruise + 0.30*k);
  }else if(id === COMPLICATION.ARTERIAL){
    cond.hematomaMl += 1.6*k;
    cond.swelling = Math.min(1, cond.swelling + 0.55*k);
    cond.flush = Math.min(1, cond.flush + 0.5*k);
  }else if(id === COMPLICATION.NERVE_CONTACT){
    cond.flinch = 1;
  }else if(id === COMPLICATION.SYNCOPE){
    state.fainted = state.fainted || k >= 0.6;
    cond.pallor = Math.min(1, cond.pallor + 0.6*k);
  }else if(id === COMPLICATION.FLINCH){
    cond.flinch = 1;
  }
}

/**
 * The visible sign a complication puts on the arm.
 *
 * `impulse` separates the two kinds of sign there are. Swelling, bruising and
 * pallor are STATES: they are there for as long as the cause is, and they
 * deepen while it goes unaddressed. A flinch is an EVENT — the arm jerks once
 * — so it is applied when something happens and then left to decay, rather
 * than being re-asserted every frame the complication is still open.
 */
function applySign(state, def, scale, impulse){
  const sign = def.sign || {};
  const cond = state.condition;
  const s = scale == null ? 1 : scale;
  if(sign.swelling) cond.swelling = Math.max(cond.swelling, sign.swelling*s);
  if(sign.bruise) cond.bruise = Math.max(cond.bruise, sign.bruise*s);
  if(sign.pallor) cond.pallor = Math.max(cond.pallor, sign.pallor*s);
  if(sign.flush) cond.flush = Math.max(cond.flush, sign.flush*s);
  if(sign.flinch && impulse) cond.flinch = 1;
}

/* =========================================================================
   TIME PASSING

   Called once a frame by the watcher, and directly by the tests with whatever
   dt they like. Everything here is a rate per second, so a 60fps browser and
   a test that steps two seconds at once agree.
   ========================================================================= */

/**
 * @param {object} state
 * @param {number} dtS      seconds since the last tick
 * @param {object} snapshot snapshotDraw()'s return, for the things that keep
 *                          getting worse only while the cause is still there
 */
export function tickComplicationState(state, dtS, snapshot, now){
  const dt = Math.max(0, Math.min(1, dtS || 0));
  const t = now == null ? Date.now() : now;
  const snap = snapshot || {};
  const cond = state.condition;

  // the jerk itself is over in a moment; the reason for it is not
  cond.flinch = Math.max(0, cond.flinch - dt*2.2);

  for(const id of state.order.slice()){
    const rec = state.active[id];
    if(!rec) continue;
    const def = complicationFor(id);
    const waited = (t - rec.onsetAt)/1000;
    rec.progress = Math.max(0, Math.min(1, waited/(def.noticeWindowS*2)));
    applySign(state, def, 0.25 + rec.progress*0.75, false);

    if(id === COMPLICATION.HEMATOMA){
      // Still leaking, for exactly as long as the cause is still in place.
      const leaking = snap.inSkin || snap.bandOn || (snap.clotProgress != null && snap.clotProgress < 1 && snap.pressureForce < 0.05);
      if(leaking) cond.hematomaMl += 0.10*dt;
    }
    if(id === COMPLICATION.SYNCOPE && waited >= SYNCOPE_FAINT_AFTER_S && !rec.respondedAt){
      state.fainted = true;
    }
    // Unanswered past twice its window, the moment to act on it has gone.
    if(!rec.respondedAt && waited >= def.noticeWindowS*2) miss(state, id, t);
  }

  // the bruise keeps up with the blood that is actually in the tissue
  cond.bruise = Math.max(cond.bruise, Math.min(1, cond.hematomaMl/HEMATOMA_LARGE_ML));
  cond.swelling = Math.max(cond.swelling, Math.min(1, cond.hematomaMl/(HEMATOMA_LARGE_ML*1.4)));
  state.distress = Math.min(3, state.distress + (state.order.length ? 0.05*dt : 0));
  return state;
}

/**
 * Folds the post-draw branch's own extravasation into the arm's condition, so
 * the bruise on screen is the blood that branch says went into the tissue
 * rather than a second, parallel number.
 */
export function syncFromAftercare(state, extravasatedMl){
  if(extravasatedMl == null) return state;
  state.condition.hematomaMl = Math.max(state.condition.hematomaMl, extravasatedMl);
  return state;
}

/* ---------- derived ---------------------------------------------------------- */

export function activeRecords(state){
  return state.order.map(id => state.active[id]).filter(Boolean);
}

export function everHappened(state){
  return state.history.length + state.order.length;
}

/** Everything that happened, finished or not, for the report. */
export function allRecords(state){
  return state.history.concat(activeRecords(state));
}
