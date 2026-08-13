/* =========================================================================
   ARM SCENE — the draw chair, seen from the operator's own seat.

   Its own THREE.Scene and camera, rendered through the app's single renderer.
   One of these exists per encounter (see bench/benchSession.js): every mode —
   tourniquet, palpation, cleaning, assembly, insert, collection, post-draw,
   inversion — leases THIS scene rather than building its own, so the band you
   tied is still tied because it is the same object.

   Two pieces of maths are worth reading.

   1. pointerToLimb(). Everything the learner does to a limb is naturally
      cylindrical — where along it, how far round it, how far off it — so the
      pointer is mapped into exactly those three numbers instead of into screen
      pixels. Wrap direction, band position, tension and tuck direction all
      fall out of that one conversion.

   2. The camera basis. The old framing laid the arm across the screen and
      yawed the camera 24 degrees, because a square-on view sees the limb's
      cross-section edge-on and the wrap becomes unsolvable. That bought
      solvability at the cost of believability — you were looking at a
      specimen on a bench, not at a patient across from you.

      The camera now sits at a seated operator's eyeline, past the patient's
      hand, looking down the limb as it runs away into the screen. That is a
      steeply oblique view of every cross-section, so the ellipse the solve
      needs is LARGER than the old framing gave it, not smaller: the basis
      vectors come out at ~53 degrees to each other where they used to be much
      closer to parallel. Believability and conditioning point the same way
      here, which is why this framing is safe to prefer.

   HANDEDNESS is a single transform on `root` — a Z mirror — and nothing else
   in the game knows about it. Every gesture solves in LIMB-LOCAL coordinates
   (rays are pulled back through the root's inverse; points are pushed out
   through its forward matrix), so a left-handed bench is the same numbers
   producing the mirrored picture. The 2x2 solve recovers cos and sin from a
   projected basis rather than assuming a sign, so a negative determinant
   changes nothing about the answer — see tests/handedness.spec.js, which
   exists precisely because assuming would have been silent and wrong.
   ========================================================================= */
import * as THREE from "three";
import { buildArm, buildArmrest, ARM_Y, siteWorldPoint } from "./armMesh.js";
import { buildPatientBody } from "./patientBody.js";
import { SITE, SHOULDER_X, HAND_X, WRIST_X } from "./armAnatomy.js";
import { contactShadowTexture } from "../../rendering/labelTexture.js";
import { FRAMINGS, DEFAULT_FRAMING } from "./benchFramings.js";

let bgTexture = null;
function gradientBackground(){
  if(bgTexture) return bgTexture;
  const c = document.createElement("canvas");
  c.width = 4; c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, "#c3d2e6");
  grad.addColorStop(0.44, "#dde7f1");
  grad.addColorStop(1, "#efeae2");
  g.fillStyle = grad; g.fillRect(0, 0, 4, 128);
  bgTexture = new THREE.CanvasTexture(c);
  bgTexture.colorSpace = THREE.SRGBColorSpace;
  return bgTexture;
}

/* ---------- the operator's seat ------------------------------------------------
   The camera's offset from whatever it is looking at, as a direction in
   limb-local metres. Read it as a sentence: back down the arm past the hand
   (-X), up to a seated eyeline (+Y), and round to the side the operator
   actually sits on (+Z).

   PITCH 0.56 rad is 32 degrees of downward look — the brief's 30-35 window,
   and the angle at which you can see both the fossa and the patient's face.
   SWING 0.96 rad puts the view direction 55 degrees off the limb's axis: far
   enough along it that the arm visibly recedes into the screen, far enough
   across it that the hand stays in frame, because a hand going pale is how a
   band that is too tight announces itself.

   These two numbers are what make the ellipse solve work, so they are not
   free to taste. At this pair the cross-section's two projected basis vectors
   come out 53 degrees apart (|det| / |A||B| = 0.80). The old across-the-bench
   framing was chosen to scrape past the same test; this one clears it by a
   wide margin, which is why believability cost nothing here.
   ---------------------------------------------------------------------------- */
const PITCH = 0.56;
const SWING = 0.96;

/** How fast a framing change is chased. Never a cut — see NOTES on beats. */
const EASE_POS = 3.4;      // per second, exponential
const EASE_LOOK = 4.2;

/**
 * @param {object} o
 *   skin, build, armSide, scenarioKeys, vigour   → armMesh.buildArm
 *   handedness   "right" | "left" — which side of the bench the operator works
 *                from. Implemented as a mirror of `root`; nothing downstream
 *                of this function needs to know which it got.
 */
export function buildArmScene(o){
  const opt = o || {};
  const scene = new THREE.Scene();
  scene.background = gradientBackground();

  const leftHanded = opt.handedness === "left";
  const SZ = leftHanded ? -1 : 1;

  /* Atmospheric depth. The patient's shoulder and face sit a long way behind
     the working area, and pushing them back into the haze is what lets them be
     PRESENT without competing with a 4 mm vein for attention. */
  scene.fog = new THREE.Fog(0xdfe7f1, 0.62, 1.55);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xc9d3de, 0.94));
  const key = new THREE.DirectionalLight(0xfff4e6, 1.22);
  key.position.set(-0.55, 1.05, 0.72);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xdce9ff, 0.40);
  fill.position.set(0.62, 0.45, -0.70);
  scene.add(fill);
  // a soft rim so the limb's silhouette reads against the background — the
  // silhouette is what the learner judges "round the back of the arm" against
  const rim = new THREE.DirectionalLight(0xffffff, 0.34);
  rim.position.set(0.15, 0.30, -1.0);
  scene.add(rim);

  // far plane has room for the long throw fitCamera uses (see BASE_FOV there)
  const camera = new THREE.PerspectiveCamera(20, 1.6, 0.02, 20);

  const root = new THREE.Group();
  root.scale.z = SZ;
  scene.add(root);

  /* A mirrored root has a negative determinant, so every triangle under it
     winds backwards and back-face culling eats the front of the arm. Normals
     are still correct (three.js takes the inverse transpose, which for a pure
     mirror is the mirror), so the ONLY thing that has to change is culling.
     Patching `add` rather than fixing up in tick() means a prop is correct on
     the very first frame it exists, including one added mid-gesture. */
  if(leftHanded){
    const _add = root.add.bind(root);
    root.add = function(...objs){
      const r = _add(...objs);
      objs.forEach(obj => obj && obj.traverse && obj.traverse(n => {
        const ms = Array.isArray(n.material) ? n.material : (n.material ? [n.material] : []);
        ms.forEach(m => { if(m) m.side = THREE.DoubleSide; });
      }));
      return r;
    };
  }

  /* --- bench ------------------------------------------------------------- */
  /* The bench stops short of the patient. It used to be 1.4 m of counter
     running the full width of the scene, which was invisible while the arm
     was the only thing in shot and became a slab through the patient's chest
     the moment there was a patient. */
  const bench = new THREE.Mesh(
    new THREE.BoxGeometry(0.80, 0.024, 0.62),
    new THREE.MeshStandardMaterial({ color: 0xf1ece3, roughness: 0.62 })
  );
  bench.position.set(-0.26, -0.042, 0.06);
  root.add(bench);

  root.add(buildArmrest(opt.build));

  /* --- the patient ------------------------------------------------------- */
  const arm = buildArm(opt);
  root.add(arm.group);

  /* The rest of the person, beyond the elbow and up into the frame's top
     third. Not decoration: the brief's whole camera argument is that you
     should be able to see who you are sticking, and the patient's face is
     where a wince, a held breath and the exhale at flashback are read. */
  const body = buildPatientBody(opt);
  root.add(body.group);

  /* --- contact shadow ---------------------------------------------------- */
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(SHOULDER_X - HAND_X + 0.06, 0.115),
    new THREE.MeshBasicMaterial({ map: contactShadowTexture(), transparent: true, opacity: 0.34, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI/2;
  shadow.position.set((SHOULDER_X + HAND_X)/2, 0.0016, 0.004);
  root.add(shadow);

  /* --- the site marker ---------------------------------------------------
     Deliberately faint and only shown in teaching mode: it marks the vein the
     learner chose, not a target to drop something onto. */
  const siteRing = new THREE.Mesh(
    new THREE.RingGeometry(0.008, 0.0105, 28),
    new THREE.MeshBasicMaterial({ color: 0x3f8f6d, transparent: true, opacity: 0, depthWrite: false })
  );
  siteRing.rotation.x = -Math.PI/2;
  const sp = siteWorldPoint(opt.build);
  siteRing.position.set(sp.x, sp.y + 0.0012, sp.z);
  root.add(siteRing);
  function setSiteVisible(on){ siteRing.material.opacity = on ? 0.55 : 0; }

  /* ---------- local space ↔ world ----------------------------------------
     Everything above lives under `root`, which may be mirrored. Every gesture
     below solves in root-LOCAL metres, so points are pushed out through the
     root's matrix and rays are pulled back through its inverse. That one pair
     of conversions is the entirety of what handedness costs the rest of the
     game. */
  const _localToWorld = new THREE.Matrix4();
  const _worldToLocal = new THREE.Matrix4();
  function syncMatrices(){
    root.updateMatrixWorld();
    _localToWorld.copy(root.matrixWorld);
    _worldToLocal.copy(_localToWorld).invert();
  }
  syncMatrices();

  /* ---------- pointer → limb ---------------------------------------------- */
  const worldScratch = new THREE.Vector3();
  const projA = new THREE.Vector3();
  const projB = new THREE.Vector3();
  const projC = new THREE.Vector3();
  const _ndc = new THREE.Vector2();
  const _caster = new THREE.Raycaster();
  const _ray = new THREE.Ray();
  // the horizontal plane through the limb's own axis, y = ARM_Y (local)
  const _axisPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -ARM_Y);
  // a second horizontal plane, re-aimed at whatever height was just solved for
  const _levelPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -ARM_Y);
  const _planeHit = new THREE.Vector3();

  /** The pointer as a ray in ROOT-LOCAL space. */
  function localRay(screen, rect){
    _ndc.set(
      ((screen.x - rect.left)/rect.width)*2 - 1,
      -((screen.y - rect.top)/rect.height)*2 + 1
    );
    _caster.setFromCamera(_ndc, camera);
    _ray.copy(_caster.ray).applyMatrix4(_worldToLocal);
    return _ray;
  }

  /** Projects a ROOT-LOCAL point to canvas pixels, written into `out`. */
  function toScreen(v, rect, out){
    const p = out || new THREE.Vector3();
    p.copy(v).applyMatrix4(_localToWorld).project(camera);
    p.x = rect.left + (p.x*0.5 + 0.5)*rect.width;
    p.y = rect.top + (-p.y*0.5 + 0.5)*rect.height;
    return p;
  }

  /**
   * Reads the pointer as a position on the limb.
   *
   * @returns {{x, theta, rho, radius, along, mPerPx, ok}}
   *   x      metres along the arm (0 = the antecubital fossa, +ve proximal)
   *   theta  radians round the limb: 0 is the top, +ve turns toward the
   *          operator, so 0→π is the near half and π→2π is the far half.
   *   rho    metres from the limb's axis. Less than `radius` is on the arm,
   *          more than it is the band being pulled clear.
   *
   * `theta` and `rho` come from one 2x2 inverse. A point at angle t and
   * distance p projects to the screen offset
   *
   *     D = (p/r)·cos(t)·A + (p/r)·sin(t)·B
   *
   * where A and B are the screen offsets of a step straight up the limb and a
   * step toward the operator. Solving that for the two coefficients recovers
   * cos and sin separately, hence the true angle and the true distance — as
   * long as A and B are not parallel, which the seated framing guarantees far
   * more comfortably than the old across-the-bench one did.
   *
   * Solving rather than assuming is also what makes the mirror free: under a
   * left-handed root the determinant is negative and the recovered angle is
   * still the true one, because both A and B came out of the same projection.
   */
  function pointerToLimb(screen, rect, axisX, radius){
    const ax = axisX == null ? SITE.x : axisX;
    const r = radius == null ? 0.043 : radius;

    // --- where along the arm: an independent reading, so it does not have to
    // share the two screen dimensions the angle solve below needs.
    const ray = localRay(screen, rect);
    const along = ray.intersectPlane(_axisPlane, _planeHit) ? _planeHit.x : ax;

    // projA is the screen position of the axis reference point — every offset
    // below is measured from here.
    toScreen(worldScratch.set(ax, ARM_Y, 0), rect, projA);
    toScreen(worldScratch.set(ax, ARM_Y + r, 0), rect, projB);   // straight up the limb
    toScreen(worldScratch.set(ax, ARM_Y, r), rect, projC);       // toward the operator

    const Ax = projB.x - projA.x, Ay = projB.y - projA.y;
    const Bx = projC.x - projA.x, By = projC.y - projA.y;
    const Dx = screen.x - projA.x, Dy = screen.y - projA.y;

    // a scale for reporting distances along the arm in metres
    toScreen(worldScratch.set(ax + 0.10, ARM_Y, 0), rect, projB);
    const mPerPx = 0.10/(Math.hypot(projB.x - projA.x, projB.y - projA.y) || 1);

    const det = Ax*By - Ay*Bx;
    if(Math.abs(det) < 1e-6){
      // the cross-section is edge-on: the angle genuinely is not in the picture
      return { x: along, theta: 0, rho: r, radius: r, along, mPerPx, ok: false, det };
    }
    const c = (Dx*By - Dy*Bx)/det;   // (rho/r)·cos(theta)
    const s = (Ax*Dy - Ay*Dx)/det;   // (rho/r)·sin(theta)
    const theta = Math.atan2(s, c);
    const rho = Math.hypot(c, s)*r;

    // Refine where along the arm it is. `along` above crosses the plane at the
    // limb's AXIS height, but the hand is up on the surface or out past it, and
    // a ray reaches that height further down the arm than the point it passed
    // through. Re-crossing at the height just solved for removes that shift.
    const yHit = ARM_Y + Math.cos(theta)*rho;
    _levelPlane.setComponents(0, 1, 0, -yHit);
    const refined = ray.intersectPlane(_levelPlane, _planeHit) ? _planeHit.x : along;

    return { x: refined, theta, rho, radius: r, along, mPerPx, ok: true, det };
  }

  /**
   * Reads the pointer as a point ON the limb's surface, solving for where
   * along the arm it is as well as where round it.
   *
   * pointerToLimb has to be told which cross-section to work in, and it will
   * happily answer for any of them. The extra constraint that pins x down is
   * that the hand is being dragged ALONG THE SKIN — so the answer is the
   * cross-section whose solution actually lands on the surface, rho = radius.
   *
   * Letting x float brings back a front/back ambiguity: a ray meets the limb
   * twice and both hits sit on the surface. `thetaRef` breaks the tie the way
   * the hand does — the hand was somewhere a moment ago and has not jumped to
   * the other side of the arm since. `preferNear` rules out the hidden half
   * outright for anything that is, by definition, on the face of the arm
   * turned toward the operator.
   */
  function pointerToLimbSurface(screen, rect, xHint, radiusOf, thetaRef, preferNear){
    let lo = xHint == null ? WRIST_X : xHint - 0.11;
    let hi = xHint == null ? SHOULDER_X : xHint + 0.11;
    // weighted so a few millimetres of surface error never outvotes a jump to
    // the opposite side of the limb
    const BRANCH_W = 0.004;
    let best = null;
    const camLocal = _camLocal.copy(camera.position).applyMatrix4(_worldToLocal);
    for(let pass = 0; pass < 3; pass++){
      const N = 16;
      let bestErr = Infinity, bestX = lo;
      for(let i = 0; i <= N; i++){
        const x = lo + (hi - lo)*(i/N);
        const rr = radiusOf(x);
        const s = pointerToLimb(screen, rect, x, rr);
        if(preferNear){
          const ny = Math.cos(s.theta), nz = Math.sin(s.theta);
          const vy = camLocal.y - (ARM_Y + ny*rr);
          const vz = camLocal.z - nz*rr;
          if(ny*vy + nz*vz <= 0) continue;
        }
        let err = Math.abs(s.rho - rr);
        if(thetaRef != null) err += BRANCH_W*Math.abs(angleDelta(thetaRef, s.theta));
        if(err < bestErr){ bestErr = err; bestX = x; best = s; }
      }
      const span = (hi - lo)/N;
      lo = bestX - span; hi = bestX + span;
    }
    // How far off the skin the best fit still is. Small means the hand really
    // is against the arm and this x can be trusted; large means it is held
    // clear of it, where no cross-section puts it on the surface.
    if(best) best.residual = Math.abs(best.rho - radiusOf(best.x));
    return best;
  }
  const _camLocal = new THREE.Vector3();

  /**
   * The pointer relative to the arm's axis LINE on screen — the one reading
   * about a limb that carries NO cross-section assumption at all.
   *
   * @returns {{x, p, rProj, pMax}}
   *   x      metres along the arm, from the ray crossing axis height. COARSE:
   *          see the warning below.
   *   p      signed perpendicular offset in pixels, +ve on the NEAR side
   *   pMax   the limb's silhouette half-width along that same perpendicular,
   *          so |p|/pMax is how far the hand is from the arm's outline — at
   *          most about 0.82 anywhere on the skin, and more than 1 only when
   *          it is genuinely held clear of the limb.
   *
   * This is the reading the wrap is built on, and it is deliberately NOT the
   * exact 2x2 solve. That solve has to be told which cross-section it is
   * working in, and it silently folds any error in that choice into `rho` —
   * which is fine when the caller knows where along the arm it is, and wrong
   * for a hand sweeping freely across the limb. Everything here is a plain 2D
   * screen measurement against the projected axis line, so there is nothing to
   * be wrong about.
   *
   * WARNING ON `x`. The ray is crossed at the limb's AXIS height, but a hand
   * is up on the SURFACE, so the ray carries on and crosses that plane further
   * along the arm — about 4 cm further, with the camera looking down the limb.
   * Anything that needs a real along-arm position must use
   * pointerToLimbSurface, which searches for the cross-section that actually
   * puts the point on the skin. `x` here is only good enough for choosing
   * which cross-section to measure the silhouette against.
   */
  function pointerToAxis(screen, rect, axisX, radius){
    const ax = axisX == null ? SITE.x : axisX;
    const r = radius == null ? 0.043 : radius;

    const ray = localRay(screen, rect);
    const alongX = ray.intersectPlane(_axisPlane, _planeHit) ? _planeHit.x : ax;

    toScreen(worldScratch.set(ax, ARM_Y, 0), rect, projA);
    // the near side of the limb: +Z, toward the operator
    toScreen(worldScratch.set(ax, ARM_Y, r), rect, projB);
    let wx = projB.x - projA.x, wy = projB.y - projA.y;
    const rProj = Math.hypot(wx, wy) || 1;
    wx /= rProj; wy /= rProj;

    // How far a step straight UP the limb moves along that same perpendicular.
    toScreen(worldScratch.set(ax, ARM_Y + r, 0), rect, projC);
    const upComp = (projC.x - projA.x)*wx + (projC.y - projA.y)*wy;

    return {
      x: alongX,
      p: (screen.x - projA.x)*wx + (screen.y - projA.y)*wy,
      rProj,
      pMax: Math.hypot(upComp, rProj) || 1,
    };
  }

  /** Shortest signed step between two angles, for accumulating a sweep. */
  function angleDelta(from, to){
    let d = to - from;
    while(d > Math.PI) d -= 2*Math.PI;
    while(d < -Math.PI) d += 2*Math.PI;
    return d;
  }

  /**
   * The pointer as a point on a horizontal plane at height `y`, in local
   * metres. The bench is a known plane, so a ray crossing it gives one exact
   * point with none of the limb's ambiguity.
   */
  function pointerToPlane(screen, rect, y){
    const ray = localRay(screen, rect);
    _levelPlane.setComponents(0, 1, 0, -(y || 0));
    return ray.intersectPlane(_levelPlane, new THREE.Vector3());
  }

  /**
   * Is the pointer inside the ARM'S OWN OUTLINE on screen?
   *
   * An exact question with an exact answer — the ray either meets the skin
   * mesh or it does not — and the only honest depth cue a single camera has
   * once it is looking along the limb rather than across it. A hand dragging a
   * strap against the arm is inside the outline for the whole stroke; a hand
   * carrying one clear of the arm leaves it, most obviously out at the sides
   * where the limb's silhouette ends and the drape does not.
   *
   * @returns {{hit:boolean, point:THREE.Vector3|null, distance:number}}
   */
  const _skinCaster = new THREE.Raycaster();
  const _skinHits = [];
  function pointerHitsSkin(screen, rect){
    _ndc.set(
      ((screen.x - rect.left)/rect.width)*2 - 1,
      -((screen.y - rect.top)/rect.height)*2 + 1
    );
    _skinCaster.setFromCamera(_ndc, camera);
    _skinHits.length = 0;
    _skinCaster.intersectObject(arm.limb, false, _skinHits);
    if(!_skinHits.length) return { hit: false, point: null, distance: Infinity };
    const h = _skinHits[0];
    // back into limb-local metres, which is what every gesture works in
    return { hit: true, point: h.point.clone().applyMatrix4(_worldToLocal), distance: h.distance };
  }

  /** The inverse, for placing things the learner has not grabbed. */
  function limbToWorld(x, theta, r){
    return new THREE.Vector3(x, ARM_Y + Math.cos(theta)*r, Math.sin(theta)*r);
  }

  /* ==========================================================================
     CAMERA RIG

     fitCamera() no longer moves the camera. It sets a TARGET, and tick() eases
     toward it. That is the whole reason the game can stop cutting between
     steps: a mode change is a new target, and the camera takes half a second
     to get there while the scene underneath it never blinks.

     Three things ride on top of the eased pose, in this order:
       lean    the operator leaning in to look — a dolly toward the subject
       sway    breathing, ±2 mm, killed dead when precision matters
       kick    a one-shot impulse, for the moment the skin gives
     ========================================================================== */

  const BASE_FOV = 20, MAX_FOV = 34;

  const rig = {
    /** where the camera wants to be, and where it currently is */
    want: { look: new THREE.Vector3(), dist: 0.9, fov: BASE_FOV },
    have: { look: new THREE.Vector3(), dist: 0.9, fov: BASE_FOV },
    settled: false,
    lean: 0, leanWant: 0,
    sway: 1, swayWant: 1,
    swayPhase: Math.random()*6.28,
    kick: new THREE.Vector2(),
    kickVel: new THREE.Vector2(),
    framing: DEFAULT_FRAMING,
    lastAspect: 1.6,
    lastOb: { rightFrac: 0, bottomFrac: 0 },
  };

  /** Unit offset from look-point to camera, in local metres. */
  function camDir(){
    return new THREE.Vector3(
      -Math.cos(PITCH)*Math.cos(SWING),
      Math.sin(PITCH),
      Math.cos(PITCH)*Math.sin(SWING)
    );
  }
  const _dir = camDir();
  const _right = new THREE.Vector3();
  const _up = new THREE.Vector3();
  (function basis(){
    const f = _dir.clone().negate();
    _right.copy(f).cross(new THREE.Vector3(0, 1, 0)).normalize();
    _up.copy(_right).clone().cross(f).normalize();
    _up.copy(new THREE.Vector3().crossVectors(_right, f)).normalize();
  })();

  /**
   * Solves the distance at which every point of a framing fits on screen.
   *
   * The lens is long and the working area small, so the projection is near
   * enough affine over it to fit by projecting onto the camera's own right and
   * up axes — which is exact for the direction, and the 15% margin covers the
   * perspective the approximation drops. Fitting a POINT SET rather than an
   * axis-aligned span is what lets a framing say "keep the hand and the
   * patient's face in shot" without anyone computing a bounding box by hand.
   */
  function solveFraming(f, aspect, ob){
    const look = new THREE.Vector3(f.look[0], f.look[1] == null ? ARM_Y : f.look[1], f.look[2] || 0);
    const rightFrac = Math.min(0.45, Math.max(0, ob.rightFrac || 0));
    const bottomFrac = Math.min(0.6, Math.max(0, ob.bottomFrac || 0));

    let halfR = 0.02, halfU = 0.02;
    const pts = f.frame || [];
    for(let i = 0; i < pts.length; i++){
      const p = worldScratch.set(pts[i][0], pts[i][1] == null ? ARM_Y : pts[i][1], pts[i][2] || 0).sub(look);
      halfR = Math.max(halfR, Math.abs(p.dot(_right)));
      halfU = Math.max(halfU, Math.abs(p.dot(_up)));
    }
    // The panel eats an edge, so the framing has to survive in what is left.
    halfR /= (1 - rightFrac);
    halfU /= (1 - bottomFrac);
    halfR *= 1.15; halfU *= 1.15;

    let fov = BASE_FOV;
    let halfTan = Math.tan((fov*Math.PI/180)/2);
    let dist = Math.max(halfU/halfTan, halfR/(halfTan*aspect));
    // Only widen the lens when the throw would otherwise be absurd; a long
    // lens is what keeps a 5 cm pull reading the same on both sides of the arm.
    if(dist > 1.6){
      fov = Math.min(MAX_FOV, BASE_FOV*(dist/1.6));
      halfTan = Math.tan((fov*Math.PI/180)/2);
      dist = Math.max(halfU/halfTan, halfR/(halfTan*aspect));
    }

    // Shift the aim so the subject sits in the UNOBSTRUCTED part of the frame.
    const visH = 2*dist*halfTan, visW = visH*aspect;
    look.addScaledVector(_right, visW*rightFrac/2);
    look.addScaledVector(_up, -visH*bottomFrac/2);

    return { look, dist, fov };
  }

  /**
   * Requests a framing. Backwards-compatible with the old signature — a
   * `focus` of `{lookX, lookZ, spanX, spanZ}` is translated into a point set —
   * so the bench modes that only ever wanted "frame the whole limb" keep
   * working untouched.
   *
   * @param {object|string} [focus] a FRAMINGS key, a framing object, or the
   *   legacy focus rectangle.
   */
  function fitCamera(aspect, obstruction, focus){
    const a = Math.max(0.4, aspect || 1.6);
    const ob = obstruction || { rightFrac: 0, bottomFrac: 0 };
    rig.lastAspect = a; rig.lastOb = ob;

    let f = rig.framing;
    if(typeof focus === "string") f = FRAMINGS[focus] || DEFAULT_FRAMING;
    else if(focus && (focus.frame || focus.look)) f = focus;
    else if(focus && (focus.spanX != null || focus.lookX != null)) f = legacyFraming(focus);
    else if(focus === undefined && rig.framing) f = rig.framing;
    rig.framing = f;

    const want = solveFraming(f, a, ob);
    rig.want.look.copy(want.look);
    rig.want.dist = want.dist;
    rig.want.fov = want.fov;

    if(!rig.settled){
      rig.have.look.copy(rig.want.look);
      rig.have.dist = rig.want.dist;
      rig.have.fov = rig.want.fov;
      rig.settled = true;
    }
    camera.aspect = a;
    applyCamera(0);
  }

  function legacyFraming(focus){
    const lx = focus.lookX == null ? -0.045 : focus.lookX;
    const lz = focus.lookZ == null ? 0 : focus.lookZ;
    const ly = focus.lookY == null ? ARM_Y : focus.lookY;
    const sx = (focus.spanX || 0.62)/2, sz = (focus.spanZ || 0.34)/2;
    return {
      look: [lx, ly, lz],
      frame: [
        [lx - sx, ly, lz], [lx + sx, ly, lz],
        [lx, ly, lz - sz], [lx, ly, lz + sz],
        [lx, ly + sz*0.7, lz],
      ],
    };
  }

  /**
   * Switches to a named beat framing. This is the ONLY way a mode should
   * change the camera, and it is deliberately not instant: the ease is what
   * makes the encounter feel like one continuous session rather than a
   * sequence of screens.
   */
  function frameBeat(name){
    const f = FRAMINGS[name];
    if(!f || f === rig.framing) return;
    rig.framing = f;
    fitCamera(rig.lastAspect, rig.lastOb, f);
  }

  /** 0 → resting, 1 → leaning right in. Eased; call it every frame. */
  function setLean(k){ rig.leanWant = Math.max(0, Math.min(1, k || 0)); }
  /** Breathing sway. Killed to 0 for the insertion approach. */
  function setSway(k){ rig.swayWant = Math.max(0, Math.min(1, k == null ? 1 : k)); }
  /** A one-shot impulse, in screen-ish metres. The skin giving is ~0.0016. */
  function kickCamera(mag, dirX, dirY){
    rig.kickVel.x += (dirX == null ? 0.35 : dirX)*(mag || 0.0016)*60;
    rig.kickVel.y += (dirY == null ? -1 : dirY)*(mag || 0.0016)*60;
  }

  const _pos = new THREE.Vector3();
  const _aim = new THREE.Vector3();

  function applyCamera(dt){
    const d = dt || 0;
    if(d > 0){
      const kp = 1 - Math.exp(-EASE_POS*d);
      const kl = 1 - Math.exp(-EASE_LOOK*d);
      rig.have.look.lerp(rig.want.look, kl);
      rig.have.dist += (rig.want.dist - rig.have.dist)*kp;
      rig.have.fov  += (rig.want.fov  - rig.have.fov )*kp;
      rig.lean += (rig.leanWant - rig.lean)*(1 - Math.exp(-2.6*d));
      rig.sway += (rig.swayWant - rig.sway)*(1 - Math.exp(-3.0*d));
      rig.swayPhase += d*2*Math.PI*0.2;                 // ~0.2 Hz
      // critically-damped spring back to zero, so a kick snaps and settles
      const K = 260, C = 2*Math.sqrt(K);
      rig.kickVel.x += (-K*rig.kick.x - C*rig.kickVel.x)*d;
      rig.kickVel.y += (-K*rig.kick.y - C*rig.kickVel.y)*d;
      rig.kick.x += rig.kickVel.x*d;
      rig.kick.y += rig.kickVel.y*d;
    }

    const dist = rig.have.dist*(1 - 0.15*rig.lean);     // lean-in is 15% closer
    _aim.copy(rig.have.look);
    _pos.copy(_aim).addScaledVector(_dir, dist);

    // breathing: a small circular drift in the camera's own screen plane
    const sw = rig.sway*0.002;
    _pos.addScaledVector(_right, Math.sin(rig.swayPhase)*sw);
    _pos.addScaledVector(_up, Math.cos(rig.swayPhase*0.83)*sw*0.7);
    // and the kick, which moves the camera without moving what it looks at
    _pos.addScaledVector(_right, rig.kick.x);
    _pos.addScaledVector(_up, rig.kick.y);

    // local → world, because the camera is not a child of the mirrored root
    camera.position.copy(_pos).applyMatrix4(_localToWorld);
    _aim.applyMatrix4(_localToWorld);
    camera.up.set(0, 1, 0);
    camera.lookAt(_aim);
    camera.fov = rig.have.fov*(1 - 0.05*rig.lean);
    camera.updateProjectionMatrix();

    // Haze starts just BEYOND whatever is being worked on and saturates well
    // past it, so the working area is always crisp and the person behind it is
    // always soft, at every framing.
    if(scene.fog){
      scene.fog.near = dist*1.04;
      scene.fog.far = dist*2.35;
    }
  }

  fitCamera(1.6, { rightFrac: 0.27, bottomFrac: 0 }, DEFAULT_FRAMING);

  function tick(dt){
    const d = dt || 0;
    arm.tick(d);
    body.tick(d, arm);
    applyCamera(d);
  }

  function dispose(){
    arm.dispose();
    body.dispose();
    root.traverse(obj=>{
      if(obj.geometry) obj.geometry.dispose();
      const ms = Array.isArray(obj.material) ? obj.material : (obj.material ? [obj.material] : []);
      ms.forEach(m=>{ if(m && m.userData && m.userData.perInstance && m.dispose) m.dispose(); });
    });
    scene.clear();
  }

  return {
    scene, camera, root, arm, body,
    handedness: leftHanded ? "left" : "right",
    pointerToLimb, pointerToLimbSurface, pointerToAxis, pointerToPlane, pointerHitsSkin,
    angleDelta, limbToWorld, toScreen,
    fitCamera, frameBeat, setLean, setSway, kickCamera,
    setSiteVisible, tick, dispose,
    /** the current framing name, for modes that want to avoid redundant asks */
    get framing(){ return rig.framing; },
    ARM_Y,
  };
}
