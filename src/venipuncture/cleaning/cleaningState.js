/* =========================================================================
   CLEANING STATE — what the swab actually did to the skin.

   Carried on the encounter: the field cleaned here is the field the needle
   goes through, and whether it was touched again afterwards matters right up
   until the puncture.

   Pure data.
   ========================================================================= */
import { cellFor, FIELD_RADIUS, GRID } from "./cleaningRules.js";

export function createCleaningState(){
  return {
    /** the alcohol pad has been opened — you cannot scrub with a sealed one */
    swabOpen: false,
    /** grid cells of the prep field that have been scrubbed */
    painted: new Set(),

    strokes: 0,
    /** strokes made without enough friction to disinfect anything */
    lightStrokes: 0,
    /** metres of swab travel, and how much of it moved away from the centre */
    totalTravel: 0,
    outwardTravel: 0,

    /** when the swab last left the skin — the drying clock starts here */
    lastStrokeAt: null,
    /** the site was touched after it was clean */
    retouchedAfterClean: false,
    /** ...or dried by hand instead of by air */
    blottedOrFanned: false,

    events: [],
  };
}

export function recordEvent(state, type, data){
  state.events.push({ t: Date.now(), type, data: data || null });
  if(state.events.length > 200) state.events.shift();
  return state;
}

export function openSwab(state){
  state.swabOpen = true;
  recordEvent(state, "openSwab", null);
  return state;
}

/**
 * One moment of the swab on the skin, in metres relative to the puncture point.
 *
 * @param {number} dx,dz   offset from the puncture point
 * @param {number} moved   metres travelled since the previous sample
 * @param {number} dRadius change in distance from the puncture point (+ outward)
 * @param {number} friction 0..1 — how hard it is being worked into the skin
 */
export function recordStroke(state, dx, dz, moved, dRadius, friction, at){
  if(!state.swabOpen) return state;
  state.strokes += 1;
  state.lastStrokeAt = at == null ? Date.now() : at;

  if(friction < 0.18){
    state.lightStrokes += 1;
    return state;   // painting: it goes nowhere near disinfecting
  }

  const cell = cellFor(dx, dz);
  if(cell != null) state.painted.add(cell);

  state.totalTravel += Math.max(0, moved || 0);
  if(dRadius > 0) state.outwardTravel += Math.max(0, moved || 0);
  return state;
}

/** The site was touched after it had been cleaned — by a finger, or anything. */
export function markRetouched(state){
  if(!state.strokes) return state;
  state.retouchedAfterClean = true;
  recordEvent(state, "retouched", null);
  return state;
}

export function markBlotted(state){
  state.blottedOrFanned = true;
  recordEvent(state, "blotted", null);
  return state;
}

/* ---------- whole techniques, as pure state changes --------------------------
   Shared by the drag, the accessible controls and the tests, so all three
   produce identical coverage, direction and friction. The controls path tears
   the 3D scene down, so it cannot go through the runtime — but it must not get
   an easier or different rule set either. */

const PAD_RADIUS = 0.006;

function paintPatch(state, dx, dz){
  if(!state.swabOpen) return;
  const step = (2*FIELD_RADIUS)/GRID;
  for(let ox = -PAD_RADIUS; ox <= PAD_RADIUS; ox += step){
    for(let oz = -PAD_RADIUS; oz <= PAD_RADIUS; oz += step){
      if(Math.hypot(ox, oz) > PAD_RADIUS) continue;
      const c = cellFor(dx + ox, dz + oz);
      if(c != null) state.painted.add(c);
    }
  }
}

/** The correct technique: concentric circles worked outward from the centre. */
export function applySpiral(state, turns, frac){
  const t = Math.max(0, Math.min(1, frac == null ? 1 : frac));
  const steps = 240;
  let px = 0, pz = 0, pr = 0;
  for(let i = 1; i <= steps; i++){
    const a = (i/steps)*Math.PI*2*(turns || 5);
    const r = (i/steps)*FIELD_RADIUS*t;
    const x = Math.cos(a)*r, z = Math.sin(a)*r;
    paintPatch(state, x, z);
    recordStroke(state, x, z, Math.hypot(x - px, z - pz), r - pr, 1);
    px = x; pz = z; pr = r;
  }
  return state;
}

/** The wrong one: scrubbing across the site, dragging the edge back inward. */
export function applyBackAndForth(state, frac){
  const t = Math.max(0, Math.min(1, frac == null ? 1 : frac));
  const span = FIELD_RADIUS*t;
  let px = -span, pz = 0, pr = span;
  for(let i = 1; i <= 300; i++){
    const x = Math.cos(i*0.35)*span*0.95;
    const z = ((i % 16) - 8)/8*span*0.6;
    const r = Math.hypot(x, z);
    paintPatch(state, x, z);
    recordStroke(state, x, z, Math.hypot(x - px, z - pz), r - pr, 1);
    px = x; pz = z; pr = r;
  }
  return state;
}

/** Starting over after re-contaminating it. */
export function resetField(state){
  state.painted = new Set();
  state.strokes = 0;
  state.lightStrokes = 0;
  state.totalTravel = 0;
  state.outwardTravel = 0;
  state.lastStrokeAt = null;
  state.retouchedAfterClean = false;
  recordEvent(state, "reset", null);
  return state;
}
