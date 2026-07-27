/* =========================================================================
   ARM ANATOMY — the patient's arm as real geometry, in metres.

   This is the module Phase 1b is really about: `makeSiteScenario()` produced
   *labels* ("deep veins", "rolling veins"); this produces coordinates. A deep
   vein is deep because its polyline sits further below the skin surface, and
   a rolling vein rolls because it has a real lateral compliance the palpation
   and insertion branches push against.

   Coordinate system (arm-local, metres):

        +X  proximal — toward the shoulder. The tourniquet goes here.
        -X  distal   — toward the hand.
         X = 0       the antecubital fossa: the crease, and the draw site.
        +Y  up, out of the skin on a supinated (palm-up) arm.
        +Z  medial   — toward the patient's midline (little-finger side).
        -Z  lateral  — thumb/radial side, where the cephalic vein runs.

   Everything downstream — the band's distance above the site, whether a vein
   is under the fingertip, how deep the needle has to go — is measured against
   these numbers rather than against a hit-test on a sprite.

   Pure maths. No THREE, no DOM: tests/arm.spec.js asserts the clinical
   distances directly.
   ========================================================================= */

/* ---------- the limb ------------------------------------------------------- */

/** Where the arm ends, in metres from the fossa. */
export const ELBOW_X = 0.0;          // the crease itself
export const SHOULDER_X = 0.215;     // upper arm, cut off at the sleeve
export const WRIST_X = -0.245;       // forearm length, adult
export const HAND_X = -0.315;

/** The draw site: the median cubital as it crosses the fossa. */
export const SITE = { x: 0.0, z: 0.004 };

/**
 * Radius of the limb along its length. Real arms are not cylinders — the
 * taper is what makes a tourniquet slide distally when it is put on too
 * loosely, and what makes "3-4 inches above" a different circumference from
 * the site itself.
 * @param {number} x  position along the arm, metres
 * @param {number} build  0.8 slight … 1.25 large, from the patient appearance
 */
export function radiusAt(x, build){
  const b = build || 1;
  // control points: wrist, mid-forearm, fossa, mid-upper-arm, shoulder
  const pts = [
    { x: HAND_X,     r: 0.0335 },
    { x: WRIST_X,    r: 0.0290 },
    { x: -0.120,     r: 0.0395 },
    { x: ELBOW_X,    r: 0.0430 },
    { x: 0.090,      r: 0.0470 },
    { x: SHOULDER_X, r: 0.0505 },
  ];
  const cx = Math.max(HAND_X, Math.min(SHOULDER_X, x));
  for(let i=0;i<pts.length-1;i++){
    const a = pts[i], c = pts[i+1];
    if(cx >= a.x && cx <= c.x){
      const t = (cx - a.x)/(c.x - a.x);
      const s = t*t*(3-2*t);                     // smoothstep, so there is no crease
      return (a.r + (c.r - a.r)*s) * b;
    }
  }
  return pts[pts.length-1].r * b;
}

/** Circumference of the limb where a band sits — what the strap has to span. */
export function circumferenceAt(x, build){
  // the limb is flattened slightly where it rests on the armrest
  return 2*Math.PI*radiusAt(x, build) * 0.97;
}

/* ---------- the tourniquet's target zone ----------------------------------- */

/* Standard practice is 3–4 inches (7.6–10.2 cm) proximal to the intended
   venipuncture site. Below that the band is in the field you are about to
   clean and it obstructs the needle; above it the veins fill less well and,
   on the upper arm, the band is likelier to occlude arterial inflow. */
export const BAND_IDEAL = { min: 0.076, max: 0.102 };
export const BAND_ACCEPTABLE = { min: 0.064, max: 0.120 };

/** Distance from the draw site to a band position, signed: +proximal. */
export function distanceAboveSite(bandX){ return bandX - SITE.x; }

/** Metres → the inches a phlebotomy instructor actually says out loud. */
export function metresToInches(m){ return m / 0.0254; }

/**
 * Classifies where a band has been placed.
 * @returns {"ideal"|"acceptableLow"|"acceptableHigh"|"tooLow"|"onSite"|"distal"|"tooHigh"}
 */
export function classifyBandPosition(bandX){
  const d = distanceAboveSite(bandX);
  if(d <= 0.012) return d < -0.005 ? "distal" : "onSite";
  if(d < BAND_ACCEPTABLE.min) return "tooLow";
  if(d < BAND_IDEAL.min) return "acceptableLow";
  if(d <= BAND_IDEAL.max) return "ideal";
  if(d <= BAND_ACCEPTABLE.max) return "acceptableHigh";
  return "tooHigh";
}

/* ---------- vessels and hazards -------------------------------------------- */

/* Each vessel is a polyline of {x, z, depth} in arm-local metres, where
   `depth` is how far BELOW the skin surface the vessel's centre sits. Depth is
   what separates a textbook median cubital from a basilic you should leave
   alone, and it is what the insertion branch will compare a needle tip
   against. `calibre` is the vessel's own radius. */

export const VESSEL_KIND = {
  VEIN: "vein",
  ARTERY: "artery",
  TENDON: "tendon",
  NERVE: "nerve",
};

function vessel(id, kind, opts){
  return Object.assign({
    id, kind,
    calibre: 0.0032,
    depth: 0.0035,
    compliance: 0.25,     // how far it rolls sideways under a fingertip, 0-1
    path: [],
  }, opts);
}

/**
 * The standard antecubital pattern (an "H" or "M" depending on the patient).
 * Positions are for a supinated right arm; `mirrorForArm()` flips Z for a left.
 */
export function buildVessels(){
  return [
    // --- the first-choice vein: crosses the fossa diagonally, large, well
    // anchored by the surrounding fascia, and superficial.
    vessel("median-cubital", VESSEL_KIND.VEIN, {
      label: "median cubital",
      calibre: 0.0040,
      depth: 0.0026,
      compliance: 0.10,                     // barely rolls — this is why it's first choice
      preferred: true,
      path: [
        { x:-0.075, z:-0.026 }, { x:-0.040, z:-0.016 }, { x:-0.012, z:-0.004 },
        { x: 0.006, z: 0.006 }, { x: 0.034, z: 0.020 }, { x: 0.062, z: 0.029 },
      ],
    }),
    // --- lateral, runs up the thumb side. Usable, but it rolls and it is a
    // more painful stick.
    vessel("cephalic", VESSEL_KIND.VEIN, {
      label: "cephalic",
      calibre: 0.0034,
      depth: 0.0032,
      compliance: 0.55,
      path: [
        { x:-0.230, z:-0.024 }, { x:-0.160, z:-0.028 }, { x:-0.090, z:-0.030 },
        { x:-0.020, z:-0.030 }, { x: 0.040, z:-0.032 }, { x: 0.130, z:-0.033 },
      ],
    }),
    // --- medial, and sitting right on top of the brachial artery and the
    // median nerve. Last resort, and the reason "medial" is a warning word.
    vessel("basilic", VESSEL_KIND.VEIN, {
      label: "basilic",
      calibre: 0.0036,
      depth: 0.0048,
      compliance: 0.60,
      hazardNear: ["brachial-artery", "median-nerve"],
      path: [
        { x:-0.215, z: 0.026 }, { x:-0.150, z: 0.031 }, { x:-0.080, z: 0.034 },
        { x:-0.010, z: 0.035 }, { x: 0.055, z: 0.034 }, { x: 0.130, z: 0.032 },
      ],
    }),
    // --- the trap that pulses back.
    vessel("brachial-artery", VESSEL_KIND.ARTERY, {
      label: "brachial artery",
      calibre: 0.0030,
      depth: 0.0105,
      compliance: 0.05,
      path: [
        { x:-0.030, z: 0.027 }, { x: 0.020, z: 0.026 }, { x: 0.075, z: 0.024 },
        { x: 0.140, z: 0.022 },
      ],
    }),
    // --- the trap that feels hard and doesn't give.
    vessel("biceps-tendon", VESSEL_KIND.TENDON, {
      label: "biceps tendon",
      calibre: 0.0052,
      depth: 0.0062,
      compliance: 0.0,
      path: [
        { x:-0.020, z: 0.012 }, { x: 0.025, z: 0.010 }, { x: 0.080, z: 0.008 },
      ],
    }),
    vessel("median-nerve", VESSEL_KIND.NERVE, {
      label: "median nerve",
      calibre: 0.0026,
      depth: 0.0125,
      compliance: 0.0,
      path: [
        { x:-0.060, z: 0.033 }, { x: 0.010, z: 0.032 }, { x: 0.085, z: 0.030 },
      ],
    }),
  ];
}

/** A left arm is the mirror image — of the geometry, not of a label. */
export function mirrorForArm(vessels, side){
  if(side !== "left") return vessels;
  return vessels.map(v=>Object.assign({}, v, { path: v.path.map(p=>({ x:p.x, z:-p.z })) }));
}

/* ---------- what the tourniquet does to the veins --------------------------- */

/* A tourniquet works by stopping venous return while leaving arterial inflow
   intact: blood keeps arriving and cannot leave, so the superficial veins
   distend. Squeeze harder than the systolic pressure and the inflow stops too
   — the veins go flat again, the hand blanches, and it hurts. That U-shape is
   the whole mechanic, so it is modelled rather than scripted. */

export const TENSION = {
  /** below this the band is decorative */
  VENOUS_ONSET: 0.30,
  /** the window where veins fill without compromising arterial inflow */
  GOOD_MIN: 0.42,
  GOOD_MAX: 0.72,
  /** past this the radial pulse weakens and the patient feels it */
  ARTERIAL_ONSET: 0.80,
  /** full arterial occlusion: veins collapse again */
  ARTERIAL_FULL: 0.95,
};

function clamp01(v){ return Math.max(0, Math.min(1, v)); }
function smoothstep(a, b, x){
  if(b === a) return x < a ? 0 : 1;
  const t = clamp01((x - a)/(b - a));
  return t*t*(3-2*t);
}
export { clamp01, smoothstep };

/**
 * How much the superficial veins are distended, 0 (flat) … 1 (full).
 * Rises with tension, then falls again once arterial inflow is being choked.
 * Distension also decays the longer the band has been on, because the trapped
 * plasma leaves the vessel and the sample starts to hemoconcentrate.
 *
 * @param {number} tension 0..1
 * @param {number} seconds how long the band has been tensioned
 * @param {number} vigour patient factor (hydration, vein quality) 0.6..1.2
 */
export function veinDistension(tension, seconds, vigour){
  const v = vigour == null ? 1 : vigour;
  const fill = smoothstep(TENSION.VENOUS_ONSET, TENSION.GOOD_MIN + 0.06, tension);
  const choke = smoothstep(TENSION.ARTERIAL_ONSET, TENSION.ARTERIAL_FULL, tension);
  const stale = 1 - 0.22*clamp01(((seconds||0) - 60)/90);
  return clamp01(fill * (1 - 0.85*choke) * v * stale);
}

/** How pale the hand goes — the visible sign that the band is too tight. */
export function distalPallor(tension){
  return smoothstep(TENSION.ARTERIAL_ONSET - 0.06, TENSION.ARTERIAL_FULL, tension);
}

/** Whether a radial pulse can still be found: the real bedside check. */
export function hasRadialPulse(tension){
  return tension < TENSION.ARTERIAL_ONSET + 0.04;
}

/* ---------- sampling the vessels ------------------------------------------- */

/**
 * Point on a vessel's polyline nearest to (x, z), plus the distance to it.
 * Used by palpation (is my fingertip over a vein?), by the tourniquet (does
 * the band cross a vessel it shouldn't?), and later by insertion.
 */
export function nearestOnVessel(vessel, x, z){
  const path = vessel.path;
  let best = { d: Infinity, x: 0, z: 0, t: 0 };
  for(let i=0;i<path.length-1;i++){
    const a = path[i], b = path[i+1];
    const dx = b.x - a.x, dz = b.z - a.z;
    const len2 = dx*dx + dz*dz;
    let t = len2 ? ((x - a.x)*dx + (z - a.z)*dz)/len2 : 0;
    t = clamp01(t);
    const px = a.x + dx*t, pz = a.z + dz*t;
    const d = Math.hypot(x - px, z - pz);
    if(d < best.d) best = { d, x:px, z:pz, t:(i + t)/(path.length - 1) };
  }
  return best;
}

/** Every vessel whose surface passes within `reach` metres of a point. */
export function vesselsNear(vessels, x, z, reach){
  const r = reach == null ? 0.010 : reach;
  return vessels
    .map(v=>({ vessel:v, hit:nearestOnVessel(v, x, z) }))
    .filter(o=>o.hit.d - o.vessel.calibre <= r)
    .sort((a,b)=>a.hit.d - b.hit.d);
}

/**
 * Where along the arm a vessel can still be reached by a needle — the part
 * that is superficial enough and not under the tourniquet.
 */
export function isDrawableVein(vessel){
  return vessel.kind === VESSEL_KIND.VEIN && vessel.depth <= 0.0055;
}

/* ---------- patient variation ---------------------------------------------- */

/**
 * Turns the encounter's site scenario + appearance into real geometry changes,
 * so "difficult veins" is a property of the arm rather than a difficulty label
 * printed next to it.
 *
 * @param {object} o {build, scenarioKeys, vigour}
 */
export function applyPatientVariation(vessels, o){
  const opt = o || {};
  const keys = opt.scenarioKeys || [];
  const has = k=>keys.indexOf(k) >= 0;
  const build = opt.build == null ? 1 : opt.build;

  return vessels.map(v=>{
    const out = Object.assign({}, v, { path: v.path.map(p=>({ x:p.x, z:p.z })) });
    if(v.kind !== VESSEL_KIND.VEIN) return out;

    // A larger arm carries the same veins further under the surface.
    out.depth = v.depth * (0.85 + 0.28*build);
    out.calibre = v.calibre * (0.92 + 0.12*build);

    if(has("deep"))    out.depth *= 1.55;
    if(has("small"))   out.calibre *= 0.62;
    if(has("rolling")) out.compliance = Math.min(1, v.compliance + 0.45);
    if(has("dry"))     out.calibre *= 0.78;          // mildly dehydrated: flatter
    if(has("fragile")) out.fragile = true;
    return out;
  });
}
