/* =========================================================================
   SEATING — the one gesture every "this object goes into that object"
   interaction in the game is made of.

   PICK IT UP. BRING IT TO WHERE IT GOES. PUSH IT HOME ALONG ITS OWN AXIS.

   Three steps used three unrelated gestures for the same physical act:

     assembly    asked the learner to CIRCLE the pointer around the hub two
                 and a half times. On a trackpad that is tedious; on a phone
                 it is genuinely difficult; and it corresponds to nothing a
                 hand does. Threading a needle onto a hub is not a spin, it is
                 a push that happens to rotate.
     collection  pushed a tube along an axis with no felt resistance and no
                 stop, so the only way to know it was seated was to read it.
     palpation   pressed, then asked for a separate button.

   In life, pushing a needle onto a hub and turning it ARE ONE MOTION, and so
   are seating a tube and engaging its stopper. So both are one straight drag
   along the target's own axis, and everything that makes it feel like
   anything is in here.

   THREE PROPERTIES THIS FILE EXISTS TO GUARANTEE

   1. Only the GESTURE changes; the model does not. These functions convert
      metres of pointer travel into the same `turns` and `depth` the pure
      state helpers already took. `assemblyRules.js`'s thresholds, the bevel
      derivation, the cross-thread bind — none of it is touched.

   2. Resistance is AUTHORED, never simulated. `bench/motion.js`'s rule holds:
      there is no dynamic rigid-body simulation anywhere in this game and
      there must never be one. This is a curve.

   3. The stop is FELT, not read. Finger-tight is a wall you can force past —
      possible, penalised, and unmistakable — rather than a number you have to
      compare against a caption. That is what lets a trained phlebotomist
      seat a needle here without being told what "2.5 turns" means.

   Pure maths. No THREE, no DOM, no audio — the callers fire their own sound
   and haptics off `crossed()`. Which is what makes the whole feel of the
   game's central gesture unit-testable.
   ========================================================================= */

/**
 * Metres of axial drag per full turn of a luer thread.
 *
 * A real luer lock takes about two and a half turns, and 28 mm of travel is a
 * comfortable one-thumb drag on the smallest phone this game targets while
 * still being long enough that the resistance curve has somewhere to happen.
 * Shorter and finger-tight arrives before the hand has felt anything.
 */
export const TURN_TRAVEL_M = 0.0112;

/** Below this, a drag is a tremor rather than an intention. */
export const DEAD_ZONE_M = 0.0004;

/**
 * The most one frame of drag may contribute — a bit over one full turn.
 *
 * A hand does not teleport, but a POINTER does: a touch lifted and re-landed,
 * a pointer capture re-acquired, or a camera that finishes easing under a
 * finger that is already down all deliver one enormous delta. Without this,
 * any of them silently over-torques the needle, and the learner is graded for
 * damage they did not do. Set generously enough that no real drag, however
 * fast, is ever throttled by it.
 */
export const MAX_FRAME_TRAVEL_M = 0.014;

/**
 * Signed metres travelled along `axis` between two bench points.
 *
 * `axis` is a unit 2D direction on the bench plane. Motion ACROSS the axis is
 * discarded rather than penalised: a hand pushing a needle onto a hub does not
 * travel in a straight line, and treating the wobble as error would make the
 * gesture feel like it was fighting back.
 */
export function axialTravel(from, to, axis){
  const dx = to.x - from.x, dz = to.z - from.z;
  return dx*axis.x + dz*axis.z;
}

/**
 * How much of a further push actually goes in, as a function of how far in it
 * already is. This is the whole feel of the gesture.
 *
 *   free          up to `secure`, it spins on easily
 *   stiffening    `secure` → `snug`, progressively harder
 *   the wall      at `snug` — finger-tight — it takes about seven times the
 *                 travel to move at all
 *   forcing it    past `overtight`, harder still, and now it is damage
 *
 * Never returns 0. A gesture that stops responding entirely reads as a bug in
 * the game rather than as resistance in the object.
 */
export function seatingResistance(at, spec){
  const { secure, snug, overtight } = spec;
  if(at < secure) return 1;
  if(at < snug){
    const t = (at - secure)/Math.max(1e-6, snug - secure);
    return 1 - 0.45*t*t;                 // eases in, so the wall is felt coming
  }
  if(at < overtight) return 0.14;
  return 0.06;
}

/**
 * Converts one frame of axial drag into progress, through the resistance
 * curve. Returns the DELTA to apply, so the caller still writes through its
 * own pure state helper and nothing here holds state.
 *
 * @param {number} travelM   signed metres of axial drag this frame
 * @param {number} at        how far in it already is, in the spec's own units
 * @param {object} spec      { perUnitM, secure, snug, overtight }
 * @returns {number} signed delta in the spec's units
 */
export function seatingDelta(travelM, at, spec){
  if(Math.abs(travelM) < DEAD_ZONE_M) return 0;
  const capped = Math.max(-MAX_FRAME_TRAVEL_M, Math.min(MAX_FRAME_TRAVEL_M, travelM));
  const raw = capped/spec.perUnitM;
  // Backing out is always free. Undoing a mistake must never be harder than
  // making it — that is what turns a recoverable error into a dead end.
  if(raw < 0) return raw;
  return raw*seatingResistance(at, spec);
}

/** The thread spec: two and a half turns to finger-tight. */
export function threadSpec({ secure, snug, overtight }){
  return { perUnitM: TURN_TRAVEL_M, secure, snug, overtight };
}

/**
 * True exactly once, on the frame a value crosses a threshold going up.
 * The callers use it to fire the click, the thunk and the haptic on the frame
 * the hand would have felt them, rather than every frame after.
 */
export function crossed(before, after, threshold){
  return before < threshold && after >= threshold;
}

/**
 * True once per completed unit — every half turn of a thread, so the thread
 * you can hear is the thread you can feel.
 */
export function tickedPast(before, after, per){
  return Math.floor(after/per) !== Math.floor(before/per);
}

/**
 * A unit 2D direction from an angle in the bench plane, and the reverse.
 * Kept here so callers do not each re-derive which way is "along the holder".
 */
export function axisFromYaw(yaw){
  return { x: Math.cos(yaw), z: -Math.sin(yaw) };
}

/**
 * How far off the target's axis an approach was, in degrees, 0 = dead on.
 *
 * This is the number cross-threading is decided from, and it is deliberately
 * NOT smoothed, assisted or snapped: magnetism may help a learner hit what
 * they meant, but the angle IS what is being graded here, so it stays theirs.
 */
export function approachMisalignDeg(approachYaw, axisYaw){
  let d = (approachYaw - axisYaw)*180/Math.PI;
  d = ((d % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
}
