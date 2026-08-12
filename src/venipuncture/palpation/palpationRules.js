/* =========================================================================
   PALPATION RULES — what a fingertip finds, and whether it was the right
   thing to draw from.

   The old step listed four buttons, one of them labelled "(pulsing)", and
   asked the learner to pick. That is a reading-comprehension question. Here
   nothing is labelled: the learner presses the arm, and what they feel back
   depends on what is actually underneath the finger, how deep it is, and how
   hard they are pressing.

   The three sensations are the three real ones:

     a vein     gives, then springs back — and if it is a roller it slides
                sideways out from under the finger as you press
     an artery  pushes back rhythmically, whether you press or not
     a tendon   is hard and does not give at all

   Pure maths. tests/palpation.spec.js asserts every threshold.
   ========================================================================= */
import {
  VESSEL_KIND, vesselsNear, nearestOnVessel, isDrawableVein, SITE,
  clamp01, smoothstep,
} from "../arm/armAnatomy.js";

export const FEEL = {
  NOTHING:   "nothing",
  SOFT:      "soft",        // tissue, no structure under the finger
  VEIN:      "vein",
  ROLLING:   "rolling",     // a vein that slid away as it was pressed
  ARTERY:    "artery",
  TENDON:    "tendon",
  NERVE:     "nerve",       // felt as a shooting pain, never as a target
  FLATTENED: "flattened",   // pressed so hard the vein under it is occluded
};

/** How hard you have to press to feel a vessel at a given depth. */
export function pressNeededFor(depth){
  return clamp01(depth/0.0085);
}

/** Past this, a vein under the fingertip is squashed flat and cannot be felt. */
export const OCCLUDE_PRESS = 0.86;
/** Below this the finger is resting on the skin, not palpating. */
export const CONTACT_PRESS = 0.12;

/**
 * What the fingertip finds at a point on the skin.
 *
 * @param {Array} vessels   the arm's vessels
 * @param {number} x        along the arm, metres
 * @param {number} z        across the arm, metres
 * @param {number} press    0..1, how hard the finger is pressing
 * @param {number} [reachBonus]  extra metres of feelable width, from the
 *   global assist layer. Defaults to zero, so every existing caller and every
 *   existing test measures exactly what it always did.
 *
 *   This is assistance in the sense the assist layer defines: it widens the
 *   SEARCH so that sweeping an arm finds the vein, and it changes nothing
 *   about which vessel the finger is then on, or about what that vessel is.
 *   It is deliberately capped well below the ~1 cm that separates the basilic
 *   from the brachial artery, because telling those two apart is the one
 *   distinction this whole step exists to teach.
 * @returns {{feel, vessel, depth, distance}}
 */
export function feelAt(vessels, x, z, press, reachBonus){
  if(press < CONTACT_PRESS) return { feel: FEEL.NOTHING, vessel: null };

  // A pressing finger flattens a wider patch of skin, so it finds things a
  // light touch would miss — which is why you palpate rather than stroke.
  const reach = 0.0035 + press*0.0025 + Math.max(0, Math.min(0.005, reachBonus || 0));
  const near = vesselsNear(vessels, x, z, reach);
  if(!near.length) return { feel: FEEL.SOFT, vessel: null };

  const { vessel, hit } = near[0];
  const needed = pressNeededFor(vessel.depth);
  if(press < needed*0.6) return { feel: FEEL.SOFT, vessel: null };

  if(vessel.kind === VESSEL_KIND.ARTERY){
    return { feel: FEEL.ARTERY, vessel, depth: vessel.depth, distance: hit.d };
  }
  if(vessel.kind === VESSEL_KIND.TENDON){
    return { feel: FEEL.TENDON, vessel, depth: vessel.depth, distance: hit.d };
  }
  if(vessel.kind === VESSEL_KIND.NERVE){
    // only reached by pressing hard over it, and the patient says so
    return press > 0.7
      ? { feel: FEEL.NERVE, vessel, depth: vessel.depth, distance: hit.d }
      : { feel: FEEL.SOFT, vessel: null };
  }

  // a vein
  if(press > OCCLUDE_PRESS){
    return { feel: FEEL.FLATTENED, vessel, depth: vessel.depth, distance: hit.d };
  }
  // a compliant vein rolls out from under the finger instead of springing back
  const rolls = vessel.compliance >= 0.45 && press > 0.4;
  return {
    feel: rolls ? FEEL.ROLLING : FEEL.VEIN,
    vessel, depth: vessel.depth, distance: hit.d,
  };
}

/**
 * How far a rolling vein has slid sideways out from under the finger. Real
 * displacement, so the learner has to chase it — and so the insertion branch
 * can anchor against the same number.
 */
export function rollOffset(vessel, press){
  if(!vessel || vessel.kind !== VESSEL_KIND.VEIN) return 0;
  return vessel.compliance * smoothstep(0.30, 0.90, press) * 0.0075;
}

/* ---------- judging the choice ---------------------------------------------- */

function issue(code, severity, message, data){
  return { code, severity, message, data: data || null };
}

/**
 * Was this a sensible vessel to commit to?
 * @param {object} state palpationState
 * @param {Array} vessels
 */
export function evaluatePalpation(state, vessels){
  const issues = [];
  const chosen = state.chosenId ? vessels.find(v=>v.id === state.chosenId) : null;

  if(!chosen){
    issues.push(issue("noChoice", "block",
      "Palpate the arm and find a vein before you commit to a site."));
  }else if(chosen.kind === VESSEL_KIND.ARTERY){
    issues.push(issue("choseArtery", "block",
      "That pushed back against your finger with a pulse. It is the brachial artery — never a target. Move away from it and find a vein that springs back instead."));
  }else if(chosen.kind === VESSEL_KIND.TENDON){
    issues.push(issue("choseTendon", "block",
      "That was hard and did not give. It is the biceps tendon, not a vein — a vein gives under the finger and comes back."));
  }else if(chosen.kind === VESSEL_KIND.NERVE){
    issues.push(issue("choseNerve", "block",
      "That is nerve, not vein — the patient felt it. Nothing gets drawn from there."));
  }else if(!isDrawableVein(chosen)){
    issues.push(issue("tooDeep", "block",
      "That vein is too deep to reach safely from the surface. Find one you can feel clearly just under the skin."));
  }else if(chosen.id === "basilic"){
    issues.push(issue("choseBasilic", "warn",
      "The basilic works, but it runs right over the brachial artery and the median nerve. Use it only when the median cubital and cephalic are not available."));
  }else if(chosen.id === "cephalic"){
    issues.push(issue("choseCephalic", "note",
      "The cephalic is a reasonable second choice. It rolls more than the median cubital and the stick is usually felt more."));
  }

  // Committing to a vein you never actually felt is guessing, however
  // good the guess turned out to be.
  if(chosen && !state.felt[chosen.id]){
    issues.push(issue("neverFelt", "block",
      "You have not actually palpated that vein — you picked it by eye. Press over it and feel it first."));
  }

  if(state.arteryPressed && !state.arteryRecognised){
    issues.push(issue("missedArtery", "warn",
      "You pressed over something pulsing and carried on past it. That is the artery, and recognising it is the point of palpating at all."));
  }

  if(state.nerveHurt){
    issues.push(issue("hurtPatient", "warn",
      "You pressed hard enough over the median nerve for the patient to feel it. Palpate firmly, not heavily."));
  }

  const order = ["block", "warn", "note"];
  issues.sort((a,b)=>order.indexOf(a.severity) - order.indexOf(b.severity));
  const blocking = issues.filter(i=>i.severity === "block");

  return {
    ready: !!chosen && blocking.length === 0,
    issues, blocking,
    chosen,
    ideal: !!chosen && chosen.id === "median-cubital",
  };
}

export function nextIssue(result){
  return result && result.issues.length ? result.issues[0] : null;
}

/** What to do next, phrased as an action on the arm. */
export function nextAction(state){
  if(!state.everPressed) return "Press your fingertip into the arm and move it about — feel for a vein, do not look for one.";
  if(!state.chosenId) return "Keep feeling. When something gives under the finger and springs back, hold there and mark it.";
  return "Site marked. Clean it next.";
}

/** Distance from the marked site to where the draw was actually aimed. */
export function markedSiteOffset(state){
  if(!state.mark) return null;
  return Math.hypot(state.mark.x - SITE.x, state.mark.z - SITE.z);
}

export { isDrawableVein, nearestOnVessel };
