/* =========================================================================
   AUTHORED MOTION — weight, lag, settle. No free bodies, anywhere.

   There is no dynamic rigid-body simulation in this game and there must never
   be one. Everything an object does is authored:

       pick up   rise, with a lag proportional to its mass
       carry     trail behind the hand, tilting into the direction of travel
       release   arc to the destination, overshoot 3-5%, settle with one
                 small bounce over ~180 ms

   That is not a shortcut, it is the correct engineering decision for this
   game. Tunnelling, jitter, drift, and props that end up unreachable behind
   the counter become STRUCTURALLY IMPOSSIBLE rather than tuned against — and
   the old bench could genuinely lose a tube off the edge of the counter and
   leave the player unable to continue.

   Mass is a real number per object and it drives four things at once, which
   is what makes a full tube feel different from an empty one without anybody
   writing a special case: rise time, carry lag, settle bounce, and the
   loudness of the sound it makes when it lands.
   ========================================================================= */

/**
 * Grams, near enough. Only the ratios matter, but real numbers keep anyone
 * adding an object from having to guess what scale this is on.
 */
export const MASS = {
  tourniquet: 14,
  gauze: 2,
  swab: 3,
  needle: 9,
  holder: 11,
  tubeEmpty: 12,
  tubeFull: 18,
  bandage: 2,
  sharpsBin: 900,
  rack: 260,
  tray: 400,
};

/** 0…1: how sluggish this thing is. A tourniquet snaps; a sharps bin does not. */
export function heft(mass){
  const m = Math.max(1, mass || 10);
  return Math.max(0, Math.min(1, Math.log(m/2)/Math.log(120)));
}

/** Seconds of lag between the hand and the thing it is carrying. */
export function carryLag(mass){
  // 40-60 ms is the window where an object reads as HELD rather than as a
  // dragged UI element. Weightless 1:1 tracking is the number one cause of
  // "this feels like a web page".
  return 0.040 + heft(mass)*0.055;
}

/* ---------- the tween list ---------------------------------------------------
   One flat list, ticked once a frame from whichever mode is running. Tweens
   are plain closures over their own state; nothing here allocates per frame.
   ---------------------------------------------------------------------------- */

const tweens = [];

/** Advances every running animation. Call once per frame, before rendering. */
export function tickMotion(dt){
  const d = Math.min(0.05, dt || 0.016);
  for(let i = tweens.length - 1; i >= 0; i--){
    const tw = tweens[i];
    tw.t += d;
    const done = tw.step(Math.min(1, tw.t/tw.dur), d);
    if(done || tw.t >= tw.dur){
      tw.step(1, 0);
      if(tw.onDone) tw.onDone();
      tweens.splice(i, 1);
    }
  }
}

/** Cancels every tween touching an object — a new grab overrides an old drop. */
export function cancelMotion(obj){
  for(let i = tweens.length - 1; i >= 0; i--){
    if(tweens[i].obj === obj) tweens.splice(i, 1);
  }
}

export function motionBusy(obj){
  return tweens.some(t => t.obj === obj);
}

function push(obj, dur, step, onDone){
  cancelMotion(obj);
  tweens.push({ obj, t: 0, dur: Math.max(0.001, dur), step, onDone });
}

/* ---------- easings ---------------------------------------------------------- */

const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeInOut = t => t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3)/2;

/**
 * The settle curve: overshoot a little, come back, bounce once, rest.
 * This is the shape that makes racking a tube pleasant enough to do for its
 * own sake, and it is worth reading as a curve rather than as a number.
 */
function settleCurve(t, overshoot, bounce){
  if(t >= 1) return 1;
  const o = overshoot == null ? 0.045 : overshoot;
  const b = bounce == null ? 0.30 : bounce;
  if(t < 0.62){
    const k = easeOut(t/0.62);
    return k*(1 + o) - (k*k)*o*0.0;                    // reaches 1+o at 0.62
  }
  // one damped bounce back down to rest
  const u = (t - 0.62)/0.38;
  return 1 + o*Math.cos(u*Math.PI*1.5)*Math.exp(-u*4.2)*b/0.3;
}

/* ---------- the four motions -------------------------------------------------- */

/**
 * Lifts an object off the surface into the hand. Heavier things take longer
 * and rise less far, which is most of what "this is heavy" reads as.
 */
export function pickUp(obj, o){
  const opt = o || {};
  const mass = opt.mass == null ? MASS.tubeEmpty : opt.mass;
  const h = heft(mass);
  const rise = (opt.rise == null ? 0.020 : opt.rise) * (1 - h*0.45);
  const from = obj.position.clone();
  const dur = 0.10 + h*0.16;
  push(obj, dur, (t)=>{
    const k = easeOut(t);
    obj.position.y = from.y + rise*k;
    obj.rotation.z = (obj.userData.baseRotZ || 0) - 0.10*k*(1 - h);
  }, opt.onDone);
  return dur;
}

/**
 * Carries a held object toward where the hand is, with lag and tilt.
 * Call every frame while dragging; it integrates, so it needs dt.
 *
 * @param {object} obj      a THREE.Object3D
 * @param {object} target   {x,y,z} where the hand is
 */
export function carry(obj, target, dt, mass){
  const d = Math.min(0.05, dt || 0.016);
  const lag = carryLag(mass);
  const k = 1 - Math.exp(-d/lag);
  const px = obj.position.x, pz = obj.position.z;
  obj.position.x += (target.x - obj.position.x)*k;
  obj.position.y += (target.y - obj.position.y)*k;
  obj.position.z += (target.z - obj.position.z)*k;
  // Tilt INTO the direction of travel, proportional to how fast it is going.
  const vx = (obj.position.x - px)/d, vz = (obj.position.z - pz)/d;
  const tilt = Math.max(-0.34, Math.min(0.34, 0));
  obj.rotation.z = (obj.userData.baseRotZ || 0) + Math.max(-0.30, Math.min(0.30, -vx*0.55)) + tilt;
  obj.rotation.x = (obj.userData.baseRotX || 0) + Math.max(-0.30, Math.min(0.30, vz*0.55));
}

/**
 * Releases an object to a destination: an arc up and over, an overshoot, and
 * one small bounce as it settles.
 *
 * @param {object} o
 *   to        {x,y,z} destination
 *   mass      drives arc height, duration and bounce
 *   arc       extra height at the top of the flight, metres
 *   onLand    called on the frame it first touches down, for the sound
 */
export function releaseTo(obj, o){
  const opt = o || {};
  const to = opt.to;
  const mass = opt.mass == null ? MASS.tubeEmpty : opt.mass;
  const h = heft(mass);
  const from = obj.position.clone();
  const dist = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  const dur = Math.max(0.16, Math.min(0.46, 0.16 + dist*1.1 + h*0.10));
  const arc = opt.arc == null ? Math.min(0.03, 0.012 + dist*0.14)*(1 - h*0.6) : opt.arc;
  const overshoot = (opt.overshoot == null ? 0.045 : opt.overshoot)*(1 - h*0.5);
  const bounce = 0.34*(1 - h*0.7);
  const r0z = obj.rotation.z, r0x = obj.rotation.x;
  const rz = obj.userData.baseRotZ || 0, rx = obj.userData.baseRotX || 0;
  let landed = false;

  push(obj, dur, (t)=>{
    const k = settleCurve(t, overshoot, bounce);
    obj.position.x = from.x + (to.x - from.x)*Math.min(1, easeInOut(Math.min(1, t/0.72)));
    obj.position.z = from.z + (to.z - from.z)*Math.min(1, easeInOut(Math.min(1, t/0.72)));
    obj.position.y = from.y + (to.y - from.y)*k + Math.sin(Math.min(1, t/0.72)*Math.PI)*arc;
    const rk = easeOut(Math.min(1, t/0.6));
    obj.rotation.z = r0z + (rz - r0z)*rk;
    obj.rotation.x = r0x + (rx - r0x)*rk;
    if(!landed && t >= 0.62){ landed = true; if(opt.onLand) opt.onLand(); }
  }, opt.onDone);
  return dur;
}

/**
 * Sends an object HOME when it was released somewhere it cannot stay.
 *
 * This replaces "falls off the counter and is permanently gone" — which was a
 * real outcome in the old bench and could leave a player unable to finish a
 * draw because a prop had left the world. An object may become contaminated,
 * and if it does the game says so; it never becomes unreachable.
 */
export function returnHome(obj, o){
  const opt = o || {};
  return releaseTo(obj, Object.assign({}, opt, {
    // a higher, slower arc than a normal placement, so the recovery reads as
    // deliberate rather than as a glitch
    arc: (opt.arc == null ? 0.055 : opt.arc),
    overshoot: 0.02,
  }));
}

/**
 * A tiny wobble, for the thing an object was put INTO. A rack that shivers
 * when a tube lands in it is half of why landing the tube feels good.
 */
export function nudgeWobble(obj, strength){
  const s = Math.max(0, Math.min(1, strength == null ? 1 : strength));
  const rz = obj.userData.baseRotZ || obj.rotation.z;
  const rx = obj.userData.baseRotX || obj.rotation.x;
  obj.userData.baseRotZ = rz; obj.userData.baseRotX = rx;
  push(obj, 0.42, (t)=>{
    const decay = Math.exp(-t*7.5);
    obj.rotation.z = rz + Math.sin(t*Math.PI*2*7)*0.014*s*decay;
    obj.rotation.x = rx + Math.cos(t*Math.PI*2*5.5)*0.010*s*decay;
  });
}

/**
 * A one-shot squash-and-stretch on a mesh, for a contact that should read as
 * an impact without moving anything.
 */
export function impactPulse(obj, strength){
  const s = Math.max(0, Math.min(1, strength == null ? 1 : strength));
  const base = obj.userData.baseScale || (obj.userData.baseScale = obj.scale.clone());
  push(obj, 0.26, (t)=>{
    const k = Math.sin(t*Math.PI)*Math.exp(-t*3.4)*s;
    obj.scale.set(base.x*(1 + k*0.10), base.y*(1 - k*0.14), base.z*(1 + k*0.10));
  });
}
