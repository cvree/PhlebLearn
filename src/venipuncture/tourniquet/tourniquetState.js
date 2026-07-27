/* =========================================================================
   TOURNIQUET STATE — one strap, one continuous application.

   The old step created a 🎀 div, checked it landed in a glowing box, threw it
   away, and then eleven steps later created a *different* 🎀 div to "release".
   This object is the same strap from the moment it is picked up to the moment
   it is pulled free, and it lives on the encounter so the release branch
   inherits it instead of inventing a new one.

   Every field here is something the learner physically did, recorded as a
   measurement rather than a verdict: where they put it, which way they wrapped
   it, how hard they pulled, which way the tail points, how long it has been on
   and how many times they had to start again. tourniquetRules.js turns those
   into clinical judgements; nothing in this file decides right or wrong.

   Pure data. No THREE, no DOM.
   ========================================================================= */
import { SITE } from "../arm/armAnatomy.js";

export const PHASE = {
  /** lying on the tray — not on the patient at all */
  LOOSE: "loose",
  /** passed around the limb, both ends free, no tension yet */
  ROUTED: "routed",
  /** an end is being pulled — live, pointer is down */
  TENSIONING: "tensioning",
  /** ends crossed, still held: the tuck has not happened yet */
  CROSSED: "crossed",
  /** tucked and holding on its own. The clock is running. */
  SECURED: "secured",
  /** pulled free by the tail */
  RELEASED: "released",
};

export const WRAP = { UNDER: "under", OVER: "over" };
export const TUCK = { PROXIMAL: "proximal", DISTAL: "distal" };

/**
 * @param {object} o {itemId, armSide, vigour}
 *   itemId  the tourniquet actually staged in phase 1, so this is that strap
 *   armSide "left" | "right" — which of the patient's arms is being drawn
 */
export function createTourniquetState(o){
  const opt = o || {};
  return {
    itemId: opt.itemId || null,
    armSide: opt.armSide === "left" ? "left" : "right",
    vigour: opt.vigour == null ? 1 : opt.vigour,

    phase: PHASE.LOOSE,

    /* --- where it physically is ------------------------------------------- */
    /** metres along the arm; SITE.x is the fossa, +X is proximal */
    bandX: null,
    /** which way it was passed around the limb */
    wrap: null,
    /** metres of drift along the arm during the wrap: 0 is perpendicular */
    skew: 0,

    /* --- how hard it is pulled -------------------------------------------- */
    /** live 0..1 while a hand is on it */
    tension: 0,
    /** the tension actually locked in by the tuck — what the patient feels */
    heldTension: 0,
    /** the highest tension reached at any point, including overshoot */
    peakTension: 0,

    /* --- the tuck ---------------------------------------------------------- */
    tuck: null,
    /** a loop under the band releases with one pull; a knot does not */
    tuckedUnder: false,

    /* --- the clock --------------------------------------------------------- */
    securedAt: null,
    releasedAt: null,
    /** ms the band has spent tensioned across ALL applications */
    accumulatedMs: 0,

    /* --- what went wrong --------------------------------------------------- */
    attempts: 0,
    /** applications abandoned because they unravelled or were removed */
    restarts: 0,
    /** the band was applied over bare skin for >2 min, pinched, etc. */
    flags: [],
    events: [],
  };
}

/* ---------- mutations ------------------------------------------------------ */

export function recordEvent(state, type, data){
  state.events.push({ t: Date.now(), type, data: data || null });
  if(state.events.length > 200) state.events.shift();
  return state;
}

export function addFlag(state, code, message){
  if(state.flags.some(f=>f.code === code)) return state;
  state.flags.push({ code, message });
  return state;
}

/** The strap has been passed around the limb. */
export function markRouted(state, { bandX, wrap, skew }){
  state.phase = PHASE.ROUTED;
  state.bandX = bandX;
  state.wrap = wrap;
  state.skew = Math.abs(skew || 0);
  state.attempts += 1;
  recordEvent(state, "route", { bandX, wrap, skew: state.skew });
  return state;
}

/** Live tension update while an end is held. */
export function setTension(state, tension){
  const t = Math.max(0, Math.min(1, tension || 0));
  state.tension = t;
  if(t > state.peakTension) state.peakTension = t;
  if(state.phase === PHASE.ROUTED && t > 0.05) state.phase = PHASE.TENSIONING;
  return state;
}

/** The held end has been swept across the other one. */
export function markCrossed(state){
  if(state.phase === PHASE.TENSIONING) state.phase = PHASE.CROSSED;
  recordEvent(state, "cross", { tension: state.tension });
  return state;
}

/** The loop has been tucked and the band now holds itself. */
export function markSecured(state, { tuck, tuckedUnder, at }){
  state.phase = PHASE.SECURED;
  state.tuck = tuck;
  state.tuckedUnder = !!tuckedUnder;
  state.heldTension = state.tension;
  state.securedAt = at == null ? Date.now() : at;
  recordEvent(state, "secure", { tuck, tuckedUnder, tension: state.heldTension });
  return state;
}

/** Released before the tuck: the band springs off and the learner starts again. */
export function markUnravelled(state){
  const wasSecured = state.phase === PHASE.SECURED;
  if(state.securedAt) state.accumulatedMs += Date.now() - state.securedAt;
  state.phase = PHASE.LOOSE;
  state.bandX = null;
  state.wrap = null;
  state.tension = 0;
  state.heldTension = 0;
  state.tuck = null;
  state.tuckedUnder = false;
  state.securedAt = null;
  state.restarts += 1;
  recordEvent(state, "unravel", { wasSecured });
  return state;
}

/** Pulled free by the tail — the correct way this ends. */
export function markReleased(state, { at, byTail }){
  const stamp = at == null ? Date.now() : at;
  if(state.securedAt) state.accumulatedMs += stamp - state.securedAt;
  state.phase = PHASE.RELEASED;
  state.releasedAt = stamp;
  state.tension = 0;
  // Banked, so the live term in secondsOn() must stop: leaving securedAt set
  // here made the clock carry on running after the band was off, and the
  // release step reported roughly double the real time on the arm.
  state.securedAt = null;
  recordEvent(state, "release", { byTail: !!byTail, seconds: secondsOn(state) });
  return state;
}

/* ---------- derived --------------------------------------------------------- */

/** Seconds the band has been tensioned on this patient, across all attempts. */
export function secondsOn(state, now){
  const live = state.securedAt ? ((now == null ? Date.now() : now) - state.securedAt) : 0;
  return (state.accumulatedMs + live)/1000;
}

export function isOnPatient(state){
  return state.phase !== PHASE.LOOSE && state.phase !== PHASE.RELEASED;
}

/** Holding on its own, hands off — the only state you may leave it in. */
export function isSecured(state){ return state.phase === PHASE.SECURED; }

/** Distance above the draw site, metres. Null until it is routed. */
export function heightAboveSite(state){
  return state.bandX == null ? null : state.bandX - SITE.x;
}
