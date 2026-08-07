/* =========================================================================
   COMPLICATION WATCHER — the one thing in this game that runs while the
   learner is doing something else.

   Every other branch is a step: it starts when its screen opens and stops
   when the learner moves on. A complication cannot work that way. The
   hematoma that starts while the tubes are being changed has to still be
   growing while the band comes off, and the patient who is going pale does it
   across four screens without waiting for any of them.

   So this is a single session, opened when the draw starts and closed when it
   ends, ticked once a frame from `main.js`'s animate loop — the composition
   root's usual job — and reading the SAME live state objects every step is
   writing. It owns no scene: what it changes is the arm's `condition` object,
   which `armMesh.js` reads every frame in whichever scene happens to be up.

   It decides nothing either. `complicationRules.js` says what has started and
   what the right answer is; `complicationState.js` records it; this file is
   the clock and the wiring.
   ========================================================================= */
import { shuffle } from "../../utils.js";
import { snapshotDraw, detectOnsets, complicationFor, haltsDraw, isCorrectResponse } from "./complicationRules.js";
import {
  createComplicationState, onset, markShown, respond, tickComplicationState,
  syncFromAftercare, activeRecords,
} from "./complicationState.js";
import { measureComplications, applyComplicationOutcome } from "./complicationScoring.js";
import { showComplicationAlert, showComplicationVerdict, clearComplicationAlert } from "./complicationCoach.js";

let session = null;

/**
 * Opens the watch for one draw.
 *
 * @param {object} c   the procedure state (ENC.collect)
 * @param {object} o
 *   reveal()   a function returning the current mode descriptor — a function
 *              rather than a value because the mode outlives no single frame
 *              and the learner can be in any of the three
 *   onHalt(info)  called when the learner's (correct) answer ends the draw
 *   onChange()    called after anything happens, so the panel can re-render
 *   sfx(name)     optional sound hook
 */
export function startComplicationWatch(c, o){
  const opt = o || {};
  if(session && session.c === c) return session;
  stopComplicationWatch();
  if(!c.complications) return null;   // no session on this procedure state
  session = {
    c,
    state: c.complications,
    reveal: typeof opt.reveal === "function" ? opt.reveal : (() => ({})),
    onHalt: opt.onHalt || null,
    onChange: opt.onChange || null,
    sfx: opt.sfx || null,
    showing: null,
    halted: false,
    lastSnapshot: null,
  };
  return session;
}

export function stopComplicationWatch(){
  clearComplicationAlert();
  session = null;
}

export function isWatchingComplications(){ return !!session; }

/** The live session's state, for tests and for the panels layer. */
export function currentComplications(){ return session ? session.state : null; }

/**
 * One frame. Cheap when nothing is happening: a snapshot of a dozen numbers
 * and a table of thresholds.
 */
/* How often the draw is actually examined for new complications.
   Nothing here changes in a sixtieth of a second — the fastest threshold in
   the rules is measured in whole seconds — and the snapshot walks the arm's
   vessel set, so doing it every frame was sixty times the work for none of
   the resolution. The elapsed time still accumulates exactly; only the
   inspection is throttled. */
const WATCH_HZ = 1/8;
let sinceLook = 0;

export function tickComplications(dt){
  if(!session) return;
  const { c, state } = session;
  const now = Date.now();
  sinceLook += dt || 0;
  const look = sinceLook >= WATCH_HZ;
  if(!look){
    // still progress what is already running — that is a clock, not a search
    tickComplicationState(state, dt, session.lastSnapshot || {}, now);
    presentNext(now);
    return;
  }
  sinceLook = 0;

  // The post-draw branch owns the volume of blood in the tissue; the bruise
  // on the arm is that number rather than a second one drawn beside it.
  if(c.postDraw) syncFromAftercare(state, c.postDraw.extravasatedMl);

  const snapshot = snapshotDraw(c, now);
  session.lastSnapshot = snapshot;
  for(const found of detectOnsets(snapshot, state)){
    onset(state, found.id, found.data, now);
    if(session.sfx) session.sfx(complicationFor(found.id).severity === "urgent" ? "bad" : "click");
  }

  tickComplicationState(state, dt, snapshot, now);
  presentNext(now);
}

/** Puts the oldest unanswered complication in front of the learner. */
function presentNext(now){
  const { state } = session;
  const pending = activeRecords(state);
  if(!pending.length){
    if(session.showing){ session.showing = null; clearComplicationAlert(); }
    return;
  }
  const rec = pending[0];
  if(session.showing === rec.id) return;
  session.showing = rec.id;
  markShown(state, rec.id, now);

  const def = complicationFor(rec.id);
  showComplicationAlert({
    id: rec.id,
    reveal: session.reveal(),
    // Shuffled, so the right answer is never in the same place twice and the
    // learner cannot pattern-match position instead of reading.
    options: shuffle(def.options.slice()),
    onRespond: (responseId) => answer(rec.id, responseId),
  });
}

/** The learner's answer, and everything that follows from it. */
function answer(id, responseId){
  if(!session) return;
  const { state, c } = session;
  const now = Date.now();
  const correct = isCorrectResponse(id, responseId);
  respond(state, id, responseId, now);
  session.showing = null;
  if(session.sfx) session.sfx(correct ? "win" : "bad");

  const halts = correct && haltsDraw(responseId);
  showComplicationVerdict({
    id, responseId, correct,
    reveal: session.reveal(),
    consequence: consequenceLine(state, id, correct, halts),
    onDismiss: () => {
      if(halts) halt(id, responseId);
      else if(session && session.onChange) session.onChange();
    },
  });

  // The Final Practical's verdict card dismisses itself, so the halt has to
  // be scheduled rather than waiting on a button nobody is shown.
  const r = session.reveal();
  if(halts && !r.verdicts && !r.sectionFeedback){
    setTimeout(() => { if(session) halt(id, responseId); }, 1500);
  }
  if(c) c.complicationMeasurements = measureComplications(state, { now });
}

function halt(id, responseId){
  if(!session || session.halted) return;
  session.halted = true;
  const { c, state, onHalt } = session;
  c.complicationHalt = { id, responseId, at: Date.now() };
  applyComplicationOutcome(c, measureComplications(state));
  clearComplicationAlert();
  if(onHalt) onHalt(c.complicationHalt);
}

function consequenceLine(state, id, correct, halts){
  if(halts) return "This draw ends here. The report is built from what was actually collected.";
  if(correct) return null;
  const bits = [];
  if(state.condition.hematomaMl > 0.3) bits.push(`${Math.round(state.condition.hematomaMl*100)/100} mL of blood is now in the tissue`);
  if(state.fainted) bits.push("the patient has fainted");
  return bits.length ? `The patient's arm now shows it: ${bits.join(", ")}.` : null;
}

/**
 * Closes the watch and writes the measurement. Idempotent — `vpFinish()` is
 * reachable more than once, and a second visit must not re-measure a draw
 * that is already over.
 */
export function finishComplications(c, now){
  const state = c && c.complications;
  if(!state) return null;
  if(!c.complicationMeasurements || !c.complicationMeasurements.final){
    const m = measureComplications(state, { now });
    m.final = true;
    applyComplicationOutcome(c, m);
  }
  stopComplicationWatch();
  return c.complicationMeasurements;
}

export { createComplicationState };
