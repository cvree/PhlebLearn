/* =========================================================================
   PALPATION STATE — what the learner's fingers have actually done.

   Carried on the encounter, because the vein found here is the vein the next
   four steps clean, puncture and draw from. It is not re-chosen later.

   Pure data.
   ========================================================================= */
import { FEEL } from "./palpationRules.js";

export function createPalpationState(){
  return {
    /** vessel id -> true once it has genuinely been felt under the finger */
    felt: {},
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

/**
 * Records one moment of contact. Called continuously while a finger is down,
 * so it must stay cheap and must not double-count.
 */
export function recordFeel(state, found, press, dtMs){
  state.everPressed = state.everPressed || press > 0;
  if(press > state.peakPress) state.peakPress = press;
  state.contactMs += dtMs || 0;

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
