/* =========================================================================
   PALPATION STATE — what the learner's fingers have actually done.

   Carried on the encounter, because the vein found here is the vein the next
   four steps clean, puncture and draw from. It is not re-chosen later.

   Pure data.
   ========================================================================= */
import { FEEL } from "./palpationRules.js";

/**
 * Two traces closer together than this are the same spot being felt, not two
 * spots being compared. About a fingertip's width, which is the resolution
 * the hand actually has.
 */
export const TRACE_MERGE_M = 0.009;

export function createPalpationState(){
  return {
    /** vessel id -> true once it has genuinely been felt under the finger */
    felt: {},

    /* =====================================================================
       THE TRACES — everywhere the learner has actually pressed.

       This is the whole redesign of the step. Palpating used to leave nothing
       behind: the runtime held the LAST thing felt, and a separate "Mark this
       spot" button committed to wherever that happened to be. The marking was
       divorced from the palpating, the button was the only thing that made
       any of it real, and the arm looked identical after a thorough search
       and after no search at all.

       Now every press leaves a mark on the skin, styled by what was felt
       there, and the learner's own vein map builds up under their hand.
       Choosing a site is pressing and holding on one of their own traces.
       There is no Mark button, in either input path.

       It is also strictly better evidence: how many distinct spots were
       assessed, whether the artery was found AND moved away from, and whether
       the site chosen was one they had actually palpated or one they picked
       blind — none of which the old model could answer.
       ===================================================================== */
    traces: [],

    /** id the learner committed to */
    chosenId: null,
    /** where on the skin they marked, in arm-local metres */
    mark: null,

    everPressed: false,
    /** highest press reached, so "pressed hard enough to hurt" is recorded */
    peakPress: 0,
    /** the learner pressed over the artery at all */
    arteryPressed: false,
    /** ...and moved off it rather than committing to it */
    arteryRecognised: false,
    /** pressed hard enough over the nerve that the patient felt it */
    nerveHurt: false,
    /** how long the fingers were actually on the arm, ms */
    contactMs: 0,

    events: [],
  };
}

export function recordEvent(state, type, data){
  state.events.push({ t: Date.now(), type, data: data || null });
  if(state.events.length > 200) state.events.shift();
  return state;
}

/* =========================================================================
   TRACES

   `recordTrace` is called from the same place `recordFeel` is — one press,
   one write path — so the 3D fingertip and the accessible spot list build the
   same map and the grader cannot tell them apart. Which is the rule the whole
   codebase runs on: every technique is a pure helper, and both input paths
   call it.
   ========================================================================= */

/**
 * Leaves a mark where a press actually happened, or deepens the one already
 * there. Returns the trace, so the runtime can drop or brighten a sprite.
 */
export function recordTrace(state, at, found, press){
  if(!at || !(press > 0)) return null;
  const feel = found && found.feel ? found.feel : FEEL.NOTHING;
  const vesselId = found && found.vessel ? found.vessel.id : null;

  // Pressing around one spot is one spot. Without this, a slow drag across
  // three centimetres of skin would leave forty marks and the map would be a
  // smear rather than a record of where the learner chose to look.
  const near = state.traces.find(t =>
    Math.hypot(t.x - at.x, t.z - at.z) < TRACE_MERGE_M);

  if(near){
    near.presses++;
    near.peakPress = Math.max(near.peakPress, press);
    // What is felt at a spot can CHANGE as the press deepens: a vein two
    // millimetres down gives nothing under a feather touch. The deepest press
    // is the honest reading, so it wins.
    if(press >= near.peakPress){ near.feel = feel; near.vesselId = vesselId; }
    near.t = Date.now();
    return near;
  }

  const trace = {
    x: at.x, z: at.z, theta: at.theta == null ? 0 : at.theta,
    feel, vesselId, presses: 1, peakPress: press, t: Date.now(),
  };
  state.traces.push(trace);
  recordEvent(state, "trace", { feel, id: vesselId });
  return trace;
}

/** The trace nearest a point, within a fingertip's reach, or null. */
export function traceNear(state, at, radius){
  if(!at) return null;
  const r = radius == null ? TRACE_MERGE_M*1.6 : radius;
  let best = null, bestD = Infinity;
  for(const t of state.traces){
    const d = Math.hypot(t.x - at.x, t.z - at.z);
    if(d < r && d < bestD){ best = t; bestD = d; }
  }
  return best;
}

/** How many genuinely distinct spots were assessed. One is not palpation. */
export function distinctSpots(state){ return state.traces.length; }

/** True when the committed site is somewhere they actually felt. */
export function choseWhatTheyFelt(state){
  if(!state.chosenId || !state.mark) return false;
  return !!traceNear(state, state.mark, TRACE_MERGE_M*1.6);
}

/**
 * Records one moment of contact. Called continuously while a finger is down,
 * so it must stay cheap and must not double-count.
 *
 * ONE WRITE PATH. `at` — where on the skin this press happened, in arm-local
 * metres — also leaves the trace. It is the same call because they are the
 * same event: a press that is recorded but leaves no mark, or a mark with no
 * press behind it, are both states the model should not be able to reach. A
 * caller with no position (there is currently none) simply records no trace.
 *
 * Returns the trace this press landed on, so a runtime can paint it.
 */
export function recordFeel(state, found, press, dtMs, at){
  state.everPressed = state.everPressed || press > 0;
  if(press > state.peakPress) state.peakPress = press;
  state.contactMs += dtMs || 0;

  const trace = at ? recordTrace(state, at, found, press) : null;
  state.lastTrace = trace;

  if(!found || !found.vessel) return state;
  const id = found.vessel.id;

  switch(found.feel){
    case FEEL.VEIN:
    case FEEL.ROLLING:
      if(!state.felt[id]){ state.felt[id] = true; recordEvent(state, "felt", { id, feel: found.feel }); }
      break;
    case FEEL.ARTERY:
      state.arteryPressed = true;
      if(!state.felt[id]){ state.felt[id] = true; recordEvent(state, "felt", { id, feel: found.feel }); }
      break;
    case FEEL.TENDON:
      if(!state.felt[id]){ state.felt[id] = true; recordEvent(state, "felt", { id, feel: found.feel }); }
      break;
    case FEEL.NERVE:
      state.nerveHurt = true;
      recordEvent(state, "nerveHurt", { id });
      break;
    default: break;
  }
  return state;
}

/** The learner moved off the artery instead of choosing it. */
export function markArteryRecognised(state){
  if(state.arteryPressed) state.arteryRecognised = true;
  return state;
}

/** Commits to a vessel as the draw site. */
export function chooseVessel(state, vesselId, mark){
  state.chosenId = vesselId;
  state.mark = mark ? { x: mark.x, z: mark.z } : null;
  recordEvent(state, "choose", { id: vesselId, mark: state.mark });
  return state;
}

export function clearChoice(state){
  state.chosenId = null;
  state.mark = null;
  recordEvent(state, "clearChoice", null);
  return state;
}

export function hasFelt(state, vesselId){ return !!state.felt[vesselId]; }
export function feltCount(state){ return Object.keys(state.felt).length; }
