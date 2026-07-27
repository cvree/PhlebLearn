/* =========================================================================
   ASSEMBLY STATE — one needle, one holder, one unit.

   The old steps built a `.vp-needle` div, checked it landed near a
   `.vp-holder` div, threw both away, and then the next step built a
   completely unrelated `.vp-bigcap` div to drag sideways. This object is the
   SAME unit from the moment the pouch is peeled to the moment the needle goes
   into the vein — it lives on the encounter, so the uncap step inherits the
   thing the assemble step built, and the insert step after it inherits this.

   That continuity is not tidiness, it is the mechanic: where the bevel ends
   up pointing when the cap comes off is decided by where the threading
   stopped, several minutes earlier. You cannot model that with two unrelated
   divs.

   Every field is something the learner physically did, recorded as a
   measurement rather than a verdict. assemblyRules.js does the judging.

   Pure data. No THREE, no DOM.
   ========================================================================= */
import {
  ATTACH_TURNS, CROSS_THREAD_DEG, CROSS_BIND_TURNS,
  PEEL_OFF_SEAM, PEEL_OPEN, CAP_TRAVEL, WOBBLE_MAX, TWIST_MAX,
  axialFraction, bevelFromTurns, wrap180,
} from "./assemblyRules.js";

export const PHASE = {
  /** still in the peel pouch */
  SEALED: "sealed",
  /** pouch open, needle still lying in it */
  OPEN: "open",
  /** needle lifted out, in hand */
  INHAND: "inhand",
  /** threads engaged, being turned */
  ENGAGED: "engaged",
  /** on the holder and let go of */
  SEATED: "seated",
};

/** Where a sheath can end up once it is off. */
export const CAP_PLACE = { TRAY: "tray", BENCH: "bench", SITE: "site", FLOOR: "floor" };

/**
 * @param {object} o
 *   needleItemId, holderItemId  the objects actually staged in phase 1
 *   gauge               the gauge of the needle they staged
 *   pouchCompromised    they staged the needle whose pack was already split
 *   dryElapsedAtStart   seconds the cleaned site had already been drying
 */
export function createAssemblyState(o){
  const opt = o || {};
  return {
    needleItemId: opt.needleItemId || null,
    holderItemId: opt.holderItemId || null,
    gauge: opt.gauge == null ? 21 : opt.gauge,
    pouchCompromised: !!opt.pouchCompromised,
    dryElapsedAtStart: opt.dryElapsedAtStart == null ? null : opt.dryElapsedAtStart,

    phase: PHASE.SEALED,

    /* --- the pouch --------------------------------------------------------- */
    /** 0..1 of the seam that has been peeled back */
    peel: 0,
    pouchOpen: false,
    /** opened by tearing across the film instead of peeling the seam */
    pouchTorn: false,
    /** metres the peel wandered off the seam, at its worst */
    peelOffSeam: 0,

    /* --- handling ---------------------------------------------------------- */
    needleInHand: false,
    contaminated: false,
    /** "threadEnd" | "shaft" | "bench" | "skin" */
    contaminatedBy: null,
    /** how many needles this assembly has got through */
    needlesUsed: 1,

    /* --- threading --------------------------------------------------------- */
    engaged: false,
    /** degrees off the hub's axis at the moment the threads first met */
    engageMisalignDeg: 0,
    crossThreaded: false,
    /** signed revolutions, clockwise positive */
    turns: 0,
    /** how much of the turning went the wrong way */
    reverseTurns: 0,
    engagements: 0,

    /* --- uncapping ---------------------------------------------------------- */
    capOn: true,
    /** metres of the pull that went along the needle's own axis */
    capAxialTravel: 0,
    capTotalTravel: 0,
    capAxialFraction: 0,
    /** worst sideways excursion of the sheath while it was being pulled */
    maxLateral: 0,
    capTwistDeg: 0,
    /** the shaft was levered enough to turn the bevel over */
    needleDamaged: false,
    /** the bare needle touched something */
    needleContaminated: false,
    recapped: false,
    capPlacedOn: null,

    /** degrees from straight up. Null until the unit is looked at. */
    bevelDeg: null,
    bevelInspected: false,

    warnedAt: null,
    /** units binned and replaced after being recognised as unusable */
    unitsDiscarded: 0,

    /* --- the clock ---------------------------------------------------------- */
    startedAt: opt.now == null ? Date.now() : opt.now,
    seatedAt: null,
    uncapStartedAt: null,
    uncappedAt: null,

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

   Shared by the drag path, the accessible controls and the tests, so all
   three produce identical turns, alignment and travel. The controls path
   tears the 3D scene down, so it cannot go through the runtime — but it must
   not get an easier or different rule set either.
   ========================================================================= */

/* ---------- the pouch --------------------------------------------------------- */

/**
 * One moment of peeling the pouch.
 * @param {number} dFrac   fraction of the seam peeled since the last sample
 * @param {number} offSeam metres the peel is currently off the seam line
 */
export function peel(state, dFrac, offSeam){
  if(state.pouchOpen) return state;
  state.peel = Math.max(0, Math.min(1, state.peel + Math.max(0, dFrac || 0)));
  const off = Math.abs(offSeam || 0);
  if(off > state.peelOffSeam) state.peelOffSeam = off;
  if(off > PEEL_OFF_SEAM) state.pouchTorn = true;
  if(state.peel >= PEEL_OPEN){
    state.pouchOpen = true;
    state.phase = PHASE.OPEN;
    recordEvent(state, "pouchOpen", { torn: state.pouchTorn });
  }
  return state;
}

/** Peeling the seam back properly, in one go. */
export function peelOpen(state){
  return peel(state, 1, 0);
}

/** Tearing across the film instead — quicker, and it sheds onto the needle. */
export function tearOpen(state){
  return peel(state, 1, PEEL_OFF_SEAM*2);
}

/* ---------- handling ----------------------------------------------------------- */

/**
 * Lift the needle out. `grip` is which part of it the fingers closed on.
 * @param {"sheath"|"threadEnd"|"shaft"} grip
 */
export function liftNeedle(state, grip){
  if(!state.pouchOpen) return state;
  state.needleInHand = true;
  if(state.phase === PHASE.OPEN) state.phase = PHASE.INHAND;
  if(grip === "threadEnd" || grip === "shaft") contaminate(state, grip);
  else recordEvent(state, "lift", { grip: "sheath" });
  return state;
}

export function contaminate(state, how){
  if(state.contaminated) return state;
  state.contaminated = true;
  state.contaminatedBy = how || "unknown";
  recordEvent(state, "contaminated", { how: state.contaminatedBy });
  return state;
}

/**
 * Bin this needle and open another. The right call once one is contaminated —
 * it just costs the patient time, and the count is kept.
 */
export function freshNeedle(state){
  state.needlesUsed += 1;
  state.unitsDiscarded += 1;
  state.contaminated = false;
  state.contaminatedBy = null;
  // a fresh pack: whatever was wrong with the last one is not wrong with this
  state.pouchCompromised = false;
  state.pouchTorn = false;
  state.peel = 0;
  state.pouchOpen = false;
  state.needleInHand = false;
  state.engaged = false;
  state.crossThreaded = false;
  state.turns = 0;
  state.reverseTurns = 0;
  state.engageMisalignDeg = 0;
  state.phase = PHASE.SEALED;
  state.capOn = true;
  state.needleDamaged = false;
  state.needleContaminated = false;
  state.recapped = false;
  state.capPlacedOn = null;
  state.capAxialTravel = 0;
  state.capTotalTravel = 0;
  state.capAxialFraction = 0;
  state.maxLateral = 0;
  state.capTwistDeg = 0;
  state.bevelDeg = null;
  state.bevelInspected = false;
  state.seatedAt = null;
  recordEvent(state, "freshNeedle", { used: state.needlesUsed });
  return state;
}

/* ---------- threading ---------------------------------------------------------- */

/**
 * The threads meet. Whether they meet SQUARE is decided here and nowhere else
 * — once a needle is cross-threaded no amount of turning rescues it.
 * @param {number} misalignDeg angle between the needle's axis and the hub's
 */
export function engage(state, misalignDeg){
  if(!state.needleInHand || state.engaged) return state;
  state.engaged = true;
  state.engagements += 1;
  state.engageMisalignDeg = Math.abs(misalignDeg || 0);
  state.crossThreaded = state.engageMisalignDeg > CROSS_THREAD_DEG;
  state.phase = PHASE.ENGAGED;
  recordEvent(state, "engage", { misalign: state.engageMisalignDeg, cross: state.crossThreaded });
  return state;
}

/**
 * Turning. Clockwise (positive) tightens.
 * A cross-threaded needle binds and goes no further — which is the whole
 * lesson: it feels like it is going on, and then it stops, and forcing it
 * does not help.
 */
export function turn(state, deltaTurns){
  if(!state.engaged) return state;
  const d = deltaTurns || 0;
  if(d < 0) state.reverseTurns += -d;
  const cap = state.crossThreaded ? CROSS_BIND_TURNS : Infinity;
  state.turns = Math.max(0, Math.min(cap, state.turns + d));
  if(state.turns >= ATTACH_TURNS && !state.seatedAt) state.seatedAt = Date.now();
  return state;
}

/** Let go of it. */
export function releaseNeedle(state){
  if(state.turns >= ATTACH_TURNS) state.phase = PHASE.SEATED;
  return state;
}

/** Unscrew it all the way, which is the only way back from a cross-thread. */
export function backOut(state){
  state.reverseTurns += Math.max(0, state.turns);
  state.turns = 0;
  state.engaged = false;
  state.crossThreaded = false;
  state.engageMisalignDeg = 0;
  state.seatedAt = null;
  state.phase = PHASE.INHAND;
  recordEvent(state, "backOut", null);
  return state;
}

/** Thread it home in one motion, at a given alignment and a given tightness. */
export function threadIn(state, turns, misalignDeg){
  if(!state.needleInHand) liftNeedle(state, "sheath");
  if(!state.engaged) engage(state, misalignDeg || 0);
  turn(state, turns == null ? 2.5 : turns);
  releaseNeedle(state);
  return state;
}

/* ---------- uncapping ------------------------------------------------------------ */

/**
 * Entering the uncap step. The bevel's resting angle is fixed HERE, from
 * where the threading stopped — see bevelFromTurns().
 */
export function beginUncap(state, now){
  if(state.uncapStartedAt == null) state.uncapStartedAt = now == null ? Date.now() : now;
  if(state.bevelDeg == null) state.bevelDeg = bevelFromTurns(state.turns);
  return state;
}

/**
 * One moment of pulling the sheath.
 * @param {number} dAxial   metres moved along the needle's axis, away from the hub
 * @param {number} dLateral metres moved across it
 * @param {number} lateral  the sheath's current sideways offset from the axis
 * @param {number} dTwist   degrees rotated about the axis since the last sample
 */
export function pullCap(state, dAxial, dLateral, lateral, dTwist){
  if(!state.capOn) return state;
  const a = dAxial || 0;
  const l = Math.abs(dLateral || 0);
  // Only motion AWAY from the hub gets the sheath off. Pushing it back on, or
  // levering it across, still counts as travel — which is exactly why a
  // wiggled sheath scores a low axial fraction.
  state.capAxialTravel += Math.max(0, a);
  state.capTotalTravel += Math.abs(a) + l;
  state.capAxialFraction = axialFraction(state.capAxialTravel, state.capTotalTravel);
  const off = Math.abs(lateral || 0);
  if(off > state.maxLateral){
    state.maxLateral = off;
    // Levering the sheath sideways is what bends the shaft and turns the
    // bevel edge over. It happens while the cap is still ON the needle —
    // once it is clear, waving it about does nothing.
    if(off > WOBBLE_MAX) state.needleDamaged = true;
  }
  state.capTwistDeg += dTwist || 0;
  if(Math.abs(state.capTwistDeg) > TWIST_MAX) state.needleDamaged = true;
  if(state.capAxialTravel >= CAP_TRAVEL) capOff(state);
  return state;
}

export function capOff(state){
  if(!state.capOn) return state;
  state.capOn = false;
  state.uncappedAt = Date.now();
  recordEvent(state, "capOff", {
    axial: state.capAxialFraction, lateral: state.maxLateral, damaged: state.needleDamaged,
  });
  return state;
}

/** A clean straight pull, in one motion. */
export function pullCapStraight(state){
  pullCap(state, CAP_TRAVEL, 0, 0, 0);
  return state;
}

/** Levering it off sideways, which is how a bevel gets barbed. */
export function wiggleCapOff(state){
  for(let i = 0; i < 8; i++){
    const off = WOBBLE_MAX*1.6;
    pullCap(state, CAP_TRAVEL/8, off, i % 2 ? off : -off, 0);
  }
  if(state.capOn) capOff(state);
  return state;
}

/** Where the sheath was put down. */
export function placeCap(state, where){
  if(state.capOn) return state;
  state.capPlacedOn = where || CAP_PLACE.BENCH;
  recordEvent(state, "placeCap", { where: state.capPlacedOn });
  return state;
}

/** Putting the sheath back on by hand: the classic self-stick. */
export function recap(state){
  if(state.capOn) return state;
  state.recapped = true;
  state.capOn = true;
  recordEvent(state, "recap", null);
  return state;
}

/** The bare needle touched something it should not have. */
export function touchNeedle(state, what){
  if(state.capOn) return state;
  state.needleContaminated = true;
  recordEvent(state, "touchNeedle", { what: what || "something" });
  return state;
}

/** Rolling the whole holder to bring the bevel round. */
export function rollBevel(state, deltaDeg){
  if(state.bevelDeg == null) state.bevelDeg = bevelFromTurns(state.turns);
  state.bevelDeg = wrap180(state.bevelDeg + (deltaDeg || 0));
  return state;
}

/** Looking at the bevel closely enough to see whether it is intact. */
export function inspectBevel(state){
  state.bevelInspected = true;
  recordEvent(state, "inspectBevel", { damaged: state.needleDamaged });
  return state;
}

/** Discard the whole unit and assemble a fresh one — the recovery path. */
export function discardUnit(state){
  freshNeedle(state);
  // a replacement unit arrives assembled: the learner has already shown they
  // can thread one, and making them repeat it teaches nothing new
  peelOpen(state);
  threadIn(state, 2.5, 0);
  beginUncap(state, Date.now());
  return state;
}

export function warnPatient(state, now){
  state.warnedAt = now == null ? Date.now() : now;
  recordEvent(state, "warnPatient", null);
  return state;
}

/** Seconds spent on the assembly so far. */
export function secondsAssembling(state, now){
  return (((now == null ? Date.now() : now) - state.startedAt)/1000);
}
