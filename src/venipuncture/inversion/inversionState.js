/* =========================================================================
   TUBE INVERSION STATE — which tube is in the hand, how far over it has
   actually been turned, how many complete inversions that adds up to, how
   fast it was moving while it happened, and how long it sat before anyone
   touched it.

   Carried on the encounter. The tubes are the ones the collection step
   actually filled — their volumes, their short draws and their carryover all
   come with them — and the clock each one's delay is measured from is the
   moment it came off the holder.

   Every field is something the learner physically did. inversionRules.js does
   the judging. Pure data — no THREE, no DOM.
   ========================================================================= */
import {
  OVER_AT, UPRIGHT_AT, SHAKE_DEG_PER_S, SLUGGISH_DEG_PER_S,
  haemolysisFrom, clottingFrom, inversionsFor, requiresMixing,
} from "./inversionRules.js";

/**
 * @param {object} o
 *   order      the tube keys this draw collected, in order of draw
 *   collected  { key: { drawnMl, volumeMl, removedAt, carryoverFrom } } from
 *              the collection state, so a short or contaminated tube arrives
 *              here still short or contaminated
 */
export function createInversionState(o){
  const opt = o || {};
  const order = (opt.order || []).slice();
  const tubes = {};
  const now = opt.now == null ? Date.now() : opt.now;
  for(const key of order){
    const c = (opt.collected && opt.collected[key]) || {};
    tubes[key] = {
      key,
      /** carried through from collection, never re-decided here */
      drawnMl: c.drawnMl == null ? 0 : c.drawnMl,
      volumeMl: c.volumeMl == null ? null : c.volumeMl,
      carryoverFrom: c.carryoverFrom == null ? null : c.carryoverFrom,
      /** when it came off the holder — the clock the delay is measured from */
      removedAt: c.removedAt == null ? now : c.removedAt,

      /* --- what the hands did to it --------------------------------------- */
      /** degrees from upright, right now */
      tilt: 0,
      /** the furthest over it has been this half-turn */
      peakTilt: 0,
      /** complete over-and-back inversions */
      inversions: 0,
      /** turns that went past upright-ish but never all the way over */
      rockCount: 0,
      /** the fastest it has been swung, degrees per second */
      peakDegPerS: 0,
      /** total degrees of travel, so a slow careful mix is distinguishable */
      travelDeg: 0,
      /** 0..1, cumulative and irreversible */
      haemolysis: 0,
      /** it was turned so gently the additive barely moved */
      sluggish: false,

      /* --- the clock ------------------------------------------------------ */
      firstMixedAt: null,
      delaySeconds: 0,
      clotting: "none",

      pickedUpAt: null,
      rackedAt: null,

      /** which half of the round trip it is in: "up" or "over" */
      phase: "up",
    };
  }
  return {
    order,
    tubes,
    heldKey: null,
    startedAt: now,
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

   Shared by the gesture, the accessible controls and the tests, so all three
   produce identical counts, speeds and haemolysis. The controls path tears the
   3D scene down, so it cannot go through the runtime — but it must not get an
   easier or different rule set either.
   ========================================================================= */

export function current(state){
  return state.heldKey ? state.tubes[state.heldKey] : null;
}

/** Picks a tube up off the rack. Any tube — reaching for the wrong one is a lesson. */
export function pickUp(state, key, now){
  if(state.heldKey) return state;
  const t = state.tubes[key];
  if(!t) return state;
  state.heldKey = key;
  t.pickedUpAt = now == null ? Date.now() : now;
  t.rackedAt = null;
  recordEvent(state, "pickUp", { key });
  return state;
}

/** Stands the held tube back in the rack. */
export function rack(state, now){
  const t = current(state);
  if(!t) return state;
  t.rackedAt = now == null ? Date.now() : now;
  t.tilt = 0;
  t.phase = "up";
  state.heldKey = null;
  recordEvent(state, "rack", { key: t.key, inversions: t.inversions });
  return state;
}

/**
 * Sets where the tube is currently held WITHOUT counting it as movement.
 *
 * The same idea as the tourniquet seeding its angle from the strap end's real
 * position: at the moment a hand takes hold of something, the difference
 * between where the object is and where the hand is is not a rotation anybody
 * performed, and accumulating it would invent both travel and speed.
 */
export function seedTilt(state, tilt){
  const t = current(state);
  if(!t || tilt == null) return state;
  t.tilt = Math.max(0, Math.min(180, tilt));
  t.phase = t.tilt >= OVER_AT ? "over" : "up";
  t.peakTilt = t.tilt;
  return state;
}

/**
 * One moment of the tube turning.
 *
 * The count is not "how much did it travel" — it is a round trip through two
 * gates: all the way over past OVER_AT, then back under UPRIGHT_AT. A hand
 * oscillating in the middle never crosses either, which is exactly what
 * rocking a tube is and exactly what it should score.
 *
 * @param {number} tilt  degrees from upright, 0..180
 * @param {number} dtS   seconds since the previous sample
 */
export function turnTo(state, tilt, dtS, now){
  const t = current(state);
  if(!t) return state;
  const to = Math.max(0, Math.min(180, tilt || 0));
  const dt = Math.max(0, dtS || 0);
  const delta = Math.abs(to - t.tilt);

  t.travelDeg += delta;
  if(dt > 0){
    const speed = delta/dt;
    if(speed > t.peakDegPerS) t.peakDegPerS = speed;
    // Shearing cells open is cumulative and cannot be undone — mixing it
    // nicely afterwards does not give a rejected sample back.
    t.haemolysis = Math.min(1, t.haemolysis + haemolysisFrom(speed, dt));
  }

  if(t.firstMixedAt == null && delta > 2){
    t.firstMixedAt = now == null ? Date.now() : now;
    t.delaySeconds = Math.max(0, (t.firstMixedAt - t.removedAt)/1000);
    t.clotting = clottingFrom(t.delaySeconds, t.key);
    recordEvent(state, "firstMixed", { key: t.key, delayS: t.delaySeconds });
  }

  t.tilt = to;
  if(to > t.peakTilt) t.peakTilt = to;

  if(t.phase === "up" && to >= OVER_AT){
    t.phase = "over";
  }else if(t.phase === "over" && to <= UPRIGHT_AT){
    t.phase = "up";
    t.inversions += 1;
    t.peakTilt = 0;
    // A whole inversion done at a crawl still counts, but it is noted: the
    // additive needs the blood to actually travel the length of the tube.
    if(t.peakDegPerS > 0 && t.peakDegPerS < SLUGGISH_DEG_PER_S) t.sluggish = true;
    recordEvent(state, "inversion", { key: t.key, n: t.inversions });
  }else if(t.phase === "up" && to <= UPRIGHT_AT && t.peakTilt >= UPRIGHT_AT*2 && t.peakTilt < OVER_AT){
    // came back down without ever going over: a rock, and it is counted as one
    t.rockCount += 1;
    t.peakTilt = 0;
    recordEvent(state, "rock", { key: t.key, peak: t.peakTilt });
  }
  return state;
}

/**
 * One complete, gentle inversion — for the accessible path and tests. Samples
 * the same gates at a real speed, so it produces the same measurements the
 * drag does rather than simply incrementing a counter.
 */
export function invertOnce(state, o){
  const opt = o || {};
  const t = current(state);
  if(!t) return state;
  const degPerS = opt.degPerS == null ? 180 : opt.degPerS;
  const step = 15;
  const dt = step/degPerS;
  let clock = opt.now == null ? Date.now() : opt.now;
  const to = opt.peak == null ? 175 : opt.peak;
  for(let a = t.tilt + step; a <= to; a += step){
    turnTo(state, a, dt, clock);
    clock += dt*1000;
  }
  turnTo(state, to, dt, clock);
  for(let a = to - step; a >= 0; a -= step){
    turnTo(state, Math.max(0, a), dt, clock);
    clock += dt*1000;
  }
  turnTo(state, 0, dt, clock);
  return state;
}

/** Inverts a tube the required number of times, properly. */
export function invertTimes(state, n, o){
  for(let i = 0; i < (n || 0); i++) invertOnce(state, o);
  return state;
}

/** Rocks it back and forth without ever going over — the classic shortcut. */
export function rockTimes(state, n, o){
  const opt = o || {};
  for(let i = 0; i < (n || 0); i++){
    invertOnce(state, Object.assign({}, opt, { peak: 70 }));
  }
  return state;
}

/** Shakes it. Fast, and it cannot be taken back. */
export function shakeTimes(state, n, o){
  const opt = o || {};
  for(let i = 0; i < (n || 0); i++){
    invertOnce(state, Object.assign({}, opt, { degPerS: 1600 }));
  }
  return state;
}

/* ---------- derived --------------------------------------------------------------- */

/** How many inversions this tube still owes. */
export function inversionsOwed(state, key){
  const t = state.tubes[key];
  if(!t || !requiresMixing(key)) return 0;
  return Math.max(0, inversionsFor(key).min - t.inversions);
}

/** Seconds since the first tube came off the holder. */
export function secondsSince(state, now){
  return ((now == null ? Date.now() : now) - state.startedAt)/1000;
}
