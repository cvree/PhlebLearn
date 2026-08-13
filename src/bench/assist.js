/* =========================================================================
   INTENT MAGNETISM — one assistance layer, shared by every interaction.

   The old game spent its difficulty in the wrong place. RACK_SNAP was 0.024 m
   and commented "deliberately small: no long-range magnet"; reading a label
   needed 2.0 radians of accumulated wrist rotation; palpation wanted a
   fingertip held inside 0.9 mm for 110 ms. Those are precision taxes. The
   player was fighting the input layer to prove an intent they had already
   expressed clearly.

   THE RULE, and it is the only thing in this file worth memorising:

       Magnetism helps you hit what you meant.
       It never decides what you meant.

   Snapping a needle to the vein's own axis is assistance, because you chose
   the vein. Snapping it to the CORRECT vein is cheating. Nothing here is ever
   allowed to select a clinically-correct target on the player's behalf, which
   is why every function takes a candidate set the caller built and returns one
   of it, and never scores candidates on correctness.

   Four properties, all of which the old per-system snaps lacked:

     PREDICTIVE  pointer velocity counts, not just position. A fast confident
                 stroke toward a rack well commits to that well well before
                 the pointer arrives.
     STICKY      once engaged, disengaging needs deliberate counter-motion.
                 You cannot lose your grip to three pixels of jitter.
     GRADUATED   held objects lean toward a valid destination in proportion to
                 how close they are, so the pull is visible before it commits.
     SCREEN-SPACE  radii are in CSS pixels scaled by viewport size, not in
                 metres. The old radii were in metres, so assistance was
                 quietly four times weaker on a phone than on a 27-inch
                 monitor — exactly backwards.
   ========================================================================= */
import { SS } from "../game/gameState.js";
import { challengeSetup } from "../game/activeChallenges.js";

/** The reference viewport the base radii below were tuned against. */
const REF_MIN_EDGE = 720;

/**
 * The player's assist setting, 0…1.
 *
 * This replaces the old `assistedSnapping` boolean, which doubled one rack
 * radius and affected nothing else. It is recorded in the score, so a run at
 * full assist is honestly labelled rather than silently equivalent.
 */
export function assistLevel(){
  // A "No magnetism" challenge overrides the preference for that shift, and
  // only ever downward — challenges.js guarantees nothing here can raise it.
  const forced = challengeSetup().assist;
  if(typeof forced === "number") return Math.max(0, Math.min(1, forced));
  if(typeof SS.assist === "number") return Math.max(0, Math.min(1, SS.assist));
  // migrate the old boolean: it meant "a bit more help", not "all of it"
  return SS.assistedSnapping ? 0.75 : 0.45;
}

export function setAssistLevel(v){
  SS.assist = Math.max(0, Math.min(1, v || 0));
  SS.assistedSnapping = SS.assist >= 0.6;
  return SS.assist;
}

/**
 * A base radius in reference pixels, turned into real pixels for this screen
 * and this assist setting.
 *
 * The 0.55…1.6 range is deliberate: even at zero assist the radius is more
 * than half, because a target you cannot hit is not a difficulty setting, it
 * is a bug. The clinical decision is never in here.
 */
export function radiusPx(basePx, rect){
  const edge = rect ? Math.min(rect.width, rect.height) : REF_MIN_EDGE;
  const scale = Math.max(0.62, Math.min(1.9, edge/REF_MIN_EDGE));
  return (basePx || 40) * scale * (0.55 + assistLevel()*1.05);
}

/* ---------- pointer velocity ------------------------------------------------ */

/**
 * A small smoothed velocity estimate in px/s. One per gesture; feed it every
 * move. Smoothed because a velocity sampled between two raw pointer events is
 * mostly a measure of how the events happened to land.
 */
export function createVelocity(){
  let vx = 0, vy = 0, lastX = null, lastY = null, lastT = 0;
  return {
    push(x, y, t){
      const now = t == null ? (typeof performance !== "undefined" ? performance.now() : Date.now()) : t;
      if(lastX != null && now > lastT){
        const dt = Math.min(0.1, (now - lastT)/1000);
        const k = 1 - Math.exp(-dt/0.055);
        vx += ((x - lastX)/dt - vx)*k;
        vy += ((y - lastY)/dt - vy)*k;
      }
      lastX = x; lastY = y; lastT = now;
    },
    get x(){ return vx; },
    get y(){ return vy; },
    get speed(){ return Math.hypot(vx, vy); },
    reset(){ vx = vy = 0; lastX = lastY = null; },
  };
}

/* ---------- target selection ------------------------------------------------ */

/**
 * Picks the target the gesture MEANS, out of a set the caller supplies.
 *
 * @param {object} o
 *   x, y        pointer, client px
 *   rect        canvas bounding box, for the screen-size scale
 *   targets     [{ key, x, y, basePx?, weight? }] — already-valid destinations
 *   velocity    a createVelocity(), optional but strongly preferred
 *   current     the key currently engaged, for stickiness
 * @returns {{key, target, distance, pull}|null}
 *   `pull` is 0…1: how strongly a held object should lean toward it right now.
 */
export function pickTarget(o){
  const targets = o.targets || [];
  if(!targets.length) return null;
  const rect = o.rect;
  const vx = o.velocity ? o.velocity.x : 0;
  const vy = o.velocity ? o.velocity.y : 0;
  const speed = Math.hypot(vx, vy);

  let best = null, bestScore = Infinity;
  for(const t of targets){
    const r = radiusPx(t.basePx == null ? 46 : t.basePx, rect);
    const dx = t.x - o.x, dy = t.y - o.y;
    const d = Math.hypot(dx, dy);

    /* PREDICTIVE. Moving fast toward something is evidence about intent that
       position alone does not carry, so a target the stroke is aimed at gets
       its effective distance shortened — up to a third of the way there. The
       lead is capped so a flick across the whole canvas cannot reach past
       everything into a target on the far side. */
    let effective = d;
    if(speed > 90 && d > 1){
      const align = (dx*vx + dy*vy)/(d*speed);        // -1…1
      if(align > 0.35) effective = d - Math.min(d*0.34, speed*0.09*align);
    }

    // STICKY. The engaged target keeps a real head start, so jitter, or a
    // neighbour a few pixels nearer, cannot steal a grip you already have.
    if(o.current != null && t.key === o.current) effective -= r*0.55;

    // A caller may say some destinations are more plausible than others —
    // "this rack well is the next tube in the order of draw". That is a
    // PLAUSIBILITY hint, never a correctness one: it re-ranks equally-valid
    // targets, and the caller only ever puts valid ones in the list.
    const score = effective/(t.weight || 1);
    if(score < bestScore && effective <= r){ bestScore = score; best = { t, d, r }; }
  }
  if(!best) return null;
  return {
    key: best.t.key,
    target: best.t,
    distance: best.d,
    // GRADUATED: full pull at the centre, none at the edge, smooth between.
    pull: smooth(1 - Math.min(1, best.d/best.r)),
  };
}

function smooth(t){ const k = Math.max(0, Math.min(1, t)); return k*k*(3 - 2*k); }

/**
 * Where a held object should actually sit: between the pointer and the target
 * it is being pulled toward.
 *
 * Never all the way. Leaving the last of the gap open is what makes the assist
 * legible as an assist — the object leans, and the player still lands it.
 */
export function leanPoint(px, py, target, pull, maxLean){
  if(!target || !pull) return { x: px, y: py };
  const k = Math.min(maxLean == null ? 0.72 : maxLean, pull);
  return { x: px + (target.x - px)*k, y: py + (target.y - py)*k };
}

/**
 * Whether an engaged target should be dropped.
 *
 * Deliberate counter-motion, not distance. A hand that has wandered off a
 * target while slowing down is still on it; a hand that is actively moving
 * away at speed has changed its mind.
 */
export function shouldDisengage(o){
  const t = o.target;
  if(!t) return true;
  const r = radiusPx(t.basePx == null ? 46 : t.basePx, o.rect) * 1.45;
  const d = Math.hypot(t.x - o.x, t.y - o.y);
  if(d <= r) return false;
  if(!o.velocity) return true;
  const speed = o.velocity.speed;
  if(speed < 140) return false;                        // drifting, not leaving
  const away = ((o.x - t.x)*o.velocity.x + (o.y - t.y)*o.velocity.y)/(d*speed || 1);
  return away > 0.2;
}

/* ---------- axis assistance -------------------------------------------------- */

/**
 * Biases a direction toward an axis — used to help a needle line up with the
 * vein's own path once it is close.
 *
 * This is the assistance the rule at the top of this file was written for: it
 * makes it easier to approach ALONG the vein you chose, and does nothing at
 * all about which vein that was.
 *
 * @param {number} angle    the player's angle, radians
 * @param {number} axis     the axis to bias toward, radians
 * @param {number} strength 0…1 from the caller's own proximity measure
 */
export function biasToAxis(angle, axis, strength){
  let d = axis - angle;
  while(d > Math.PI) d -= 2*Math.PI;
  while(d < -Math.PI) d += 2*Math.PI;
  // Only bias a genuinely near-parallel approach: past ~35 degrees the player
  // is doing something else on purpose and should be left alone.
  const near = 1 - Math.min(1, Math.abs(d)/0.61);
  const k = Math.max(0, Math.min(1, strength || 0)) * smooth(near) * (0.28 + assistLevel()*0.34);
  return angle + d*k;
}
