/* =========================================================================
   INSERT STATE — what the hands actually did: where the thumb anchored, at
   what angle the skin was broken, and how far the tip has advanced.

   Carried on the encounter. The vein is the one palpation marked; the needle
   is the same unit assembly threaded and uncap uncapped — its bevel angle is
   read live from that unit, never copied in here, because nothing rolls it
   further after uncap.

   Pure data.
   ========================================================================= */
import { isTrueFlash } from "./insertRules.js";

/**
 * @param {object} o
 *   chosenId    the vessel palpation committed to
 *   markX,markZ where palpation marked it, arm-local metres
 */
export function createInsertState(o){
  const opt = o || {};
  return {
    chosenId: opt.chosenId || null,
    markX: opt.markX == null ? 0 : opt.markX,
    markZ: opt.markZ == null ? 0 : opt.markZ,

    /* --- anchor (the off-hand thumb) ---------------------------------------- */
    anchorDownX: null,     // where the thumb first pressed, this attempt
    anchorX: null,          // the locked anchor position
    anchorPull: 0,           // net metres pulled distal, this attempt
    anchorSet: false,
    anchorAttempts: 0,

    /* --- entry --------------------------------------------------------------- */
    entryX: null, entryZ: null,
    angleDeg: null,

    /* --- depth ---------------------------------------------------------------- */
    depthM: 0,
    peakDepthM: 0,
    withdrawnBeforeFlash: false,
    flashAt: null,
    reapproaches: 0,

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
   WHOLE TECHNIQUES, AS PURE STATE CHANGES

   Shared by the drag, the accessible controls and the tests, so all three
   produce identical anchor offsets, angles and depths. The controls path
   tears the 3D scene down, so it cannot go through the runtime — but it must
   not get an easier or different rule set either.
   ========================================================================= */

/* ---------- anchor --------------------------------------------------------------- */

export function pressAnchor(state, x){
  if(state.entryX != null) return state;   // too late to re-anchor once in the skin
  state.anchorDownX = x;
  state.anchorPull = 0;
  return state;
}

/** @param {number} deltaDistalM  signed metres pulled since the last sample, +distal */
export function pullAnchor(state, deltaDistalM){
  if(state.anchorDownX == null || state.entryX != null) return state;
  state.anchorPull += deltaDistalM || 0;
  return state;
}

export function lockAnchor(state){
  if(state.anchorDownX == null || state.entryX != null) return state;
  state.anchorAttempts += 1;
  state.anchorX = state.anchorDownX;
  state.anchorSet = true;
  recordEvent(state, "anchor", { x: state.anchorX, pull: state.anchorPull });
  return state;
}

/** Undoes the anchor so it can be set again — the correction path. */
export function resetAnchor(state){
  if(state.entryX != null) return state;
  state.anchorDownX = null;
  state.anchorX = null;
  state.anchorPull = 0;
  state.anchorSet = false;
  recordEvent(state, "resetAnchor", null);
  return state;
}

/** One continuous anchor gesture, for the accessible path and tests. */
export function anchorAt(state, x, pullM){
  pressAnchor(state, x);
  pullAnchor(state, pullM == null ? 0.016 : pullM);
  return lockAnchor(state);
}

/* ---------- approach and depth ---------------------------------------------------- */

export function breakSkin(state, x, z, angleDeg){
  if(state.entryX != null) return state;
  state.entryX = x;
  state.entryZ = z;
  state.angleDeg = Math.max(0, angleDeg || 0);
  recordEvent(state, "entry", { x, z, angle: state.angleDeg });
  return state;
}

/**
 * Advances (or, negative, withdraws) the tip along the locked line. Backing
 * all the way out clears the entry — the needle is off the skin again, so a
 * fresh line can be tried, exactly as it would be in life.
 */
export function advance(state, deltaDepthM){
  if(state.entryX == null) return state;
  const before = state.depthM;
  state.depthM = Math.max(0, state.depthM + (deltaDepthM || 0));
  if(state.depthM > state.peakDepthM) state.peakDepthM = state.depthM;
  if(state.depthM <= 0 && before > 0){
    if(!state.flashAt) state.withdrawnBeforeFlash = true;
    state.entryX = null; state.entryZ = null; state.angleDeg = null;
    state.reapproaches += 1;
    recordEvent(state, "withdrawnFully", null);
  }
  return state;
}

/** Pulls all the way out in one go — the "start over" control. */
export function pullOutCompletely(state){
  return advance(state, -(state.depthM + 0.001));
}

/**
 * Records the moment the tip is genuinely inside the vessel — laterally on
 * it AND at the right depth, not either alone — once only.
 */
export function markFlashIfInVein(state, vessel, now){
  if(!vessel || state.flashAt || state.entryX == null) return state;
  if(isTrueFlash(state, vessel)){
    state.flashAt = now == null ? Date.now() : now;
    recordEvent(state, "flash", { depth: state.depthM });
  }
  return state;
}

/** Inserts cleanly, in one motion — for the accessible path and tests. */
export function insertInto(state, entryX, entryZ, angleDeg, depthM){
  breakSkin(state, entryX, entryZ, angleDeg);
  advance(state, depthM == null ? 0.008 : depthM);
  return state;
}

/** Seconds since the needle was picked up. */
export function secondsSoFar(state, now){
  return ((now == null ? Date.now() : now) - state.startedAt)/1000;
}
