/* =========================================================================
   ARM SCENE — the close-up the draw actually happens in.

   Its own THREE.Scene and camera, rendered through the app's single renderer,
   exactly as the supply cart is. This is Phase 1b's deliverable and it is
   deliberately generic: the tourniquet branch is the first tenant, but
   palpation, cleaning, insertion, collection and post-draw care all work at
   this same bench with this same arm.

   The one piece of maths worth reading is pointerToLimb(). Everything the
   learner does to a limb is naturally cylindrical — where along it, how far
   round it, how far off it — so the pointer is mapped into exactly those
   three numbers instead of into screen pixels. Wrap direction, band position,
   tension and tuck direction all fall out of that one conversion.
   ========================================================================= */
import * as THREE from "three";
import { buildArm, buildArmrest, ARM_Y, siteWorldPoint } from "./armMesh.js";
import { SITE, SHOULDER_X, HAND_X, WRIST_X } from "./armAnatomy.js";
import { contactShadowTexture } from "../../rendering/labelTexture.js";

let bgTexture = null;
function gradientBackground(){
  if(bgTexture) return bgTexture;
  const c = document.createElement("canvas");
  c.width = 4; c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, "#cfdced");
  grad.addColorStop(0.5, "#e4ecf4");
  grad.addColorStop(1, "#f2eee8");
  g.fillStyle = grad; g.fillRect(0, 0, 4, 128);
  bgTexture = new THREE.CanvasTexture(c);
  bgTexture.colorSpace = THREE.SRGBColorSpace;
  return bgTexture;
}

/**
 * @param {object} o
 *   skin, build, armSide, scenarioKeys, vigour   → armMesh.buildArm
 *   handedness   which side of the bench the operator works from
 */
export function buildArmScene(o){
  const opt = o || {};
  const scene = new THREE.Scene();
  scene.background = gradientBackground();

  scene.add(new THREE.HemisphereLight(0xffffff, 0xc9d3de, 1.0));
  const key = new THREE.DirectionalLight(0xfff4e6, 1.25);
  key.position.set(-0.35, 1.1, 0.85);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xdce9ff, 0.42);
  fill.position.set(0.7, 0.5, -0.7);
  scene.add(fill);
  // a soft rim so the limb's silhouette reads against the background — the
  // silhouette is what the learner judges "round the back of the arm" against
  const rim = new THREE.DirectionalLight(0xffffff, 0.30);
  rim.position.set(0.1, 0.35, -1.0);
  scene.add(rim);

  // far plane has room for the long throw fitCamera uses (see BASE_FOV there)
  const camera = new THREE.PerspectiveCamera(20, 1.6, 0.02, 20);

  const root = new THREE.Group();
  scene.add(root);

  /* --- bench ------------------------------------------------------------- */
  const bench = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 0.024, 0.62),
    new THREE.MeshStandardMaterial({ color: 0xf1ece3, roughness: 0.62 })
  );
  bench.position.set(0, -0.042, 0.06);
  root.add(bench);

  root.add(buildArmrest(opt.build));

  /* --- the patient ------------------------------------------------------- */
  const arm = buildArm(opt);
  root.add(arm.group);

  // A hint of the patient beyond the elbow, so the arm is attached to someone.
  const sleeveMat = new THREE.MeshStandardMaterial({ color: opt.shirt == null ? 0x7f9bc4 : opt.shirt, roughness: 0.85 });
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.062, 0.06, 18), sleeveMat);
  sleeve.rotation.z = Math.PI/2;
  sleeve.position.set(SHOULDER_X + 0.022, ARM_Y, 0);
  root.add(sleeve);

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

  /* ---------- pointer → limb ---------------------------------------------
     Manipulating a limb is naturally cylindrical — where along it, how far
     round it, how far off it — so the pointer is converted into exactly those
     numbers rather than into pixels.

     WHY THE CAMERA IS YAWED (see CAM_YAW below). The limb's cross-section is a
     circle lying in the plane perpendicular to the arm's axis. If the camera's
     view direction also lies in that plane — which is exactly what a straight
     above-and-in-front view gives you — the circle is seen EDGE-ON and projects
     to a line segment. Near side and far side land on the same pixels, so no
     screen position can say which side of the arm the hand is on, and "passed
     underneath" is indistinguishable from "laid over the top". No amount of
     inference fixes that; the information is not in the picture.

     Yawing the camera along the arm's length tilts the view direction out of
     the cross-section plane, so the circle projects to a real ellipse with
     area. The two screen axes then carry two independent numbers, and the
     angle round the limb can be solved for EXACTLY — one small 2x2 inverse,
     no ambiguity, no momentum tracking, no turning points to survive.
     -------------------------------------------------------------------- */
  const worldScratch = new THREE.Vector3();
  const projA = new THREE.Vector3();
  const projB = new THREE.Vector3();
  const projC = new THREE.Vector3();
  const _ndc = new THREE.Vector2();
  const _caster = new THREE.Raycaster();
  // the horizontal plane through the limb's own axis, y = ARM_Y
  const _axisPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -ARM_Y);
  // a second horizontal plane, re-aimed at whatever height was just solved for
  const _levelPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -ARM_Y);
  const _planeHit = new THREE.Vector3();

  /** Projects a world point to canvas pixels, written into `out` (or a fresh vector). */
  function toScreen(v, rect, out){
    const p = out || new THREE.Vector3();
    p.copy(v).project(camera);
    p.x = rect.left + (p.x*0.5 + 0.5)*rect.width;
    p.y = rect.top + (-p.y*0.5 + 0.5)*rect.height;
    return p;
  }

  /**
   * Reads the pointer as a position on the limb.
   *
   * @param {{x:number,y:number}} screen  pointer position in client pixels
   * @param {DOMRect} rect                the canvas' bounding box
   * @param {number} axisX                where along the arm to measure round
   * @param {number} radius               the limb's radius there
   * @returns {{x, theta, rho, radius, along, mPerPx, ok}}
   *   x      metres along the arm (0 = the antecubital fossa, +ve proximal)
   *   theta  radians round the limb: 0 is the top, +ve turns toward the
   *          operator, so 0→π is the near half and π→2π is the far half.
   *          Exact and unambiguous — see the yaw note above.
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
   * long as A and B are not parallel, which is exactly what CAM_YAW buys.
   *
   * `x` deliberately does NOT come from that solve: both screen axes are
   * already spent on theta and rho, so it is measured independently, from
   * where the pointer's ray crosses the limb's own axis height.
   */
  function pointerToLimb(screen, rect, axisX, radius){
    const ax = axisX == null ? SITE.x : axisX;
    const r = radius == null ? 0.043 : radius;

    // --- where along the arm: an independent reading, so it does not have to
    // share the two screen dimensions the angle solve below needs.
    _ndc.set(
      ((screen.x - rect.left)/rect.width)*2 - 1,
      -((screen.y - rect.top)/rect.height)*2 + 1
    );
    _caster.setFromCamera(_ndc, camera);
    const along = _caster.ray.intersectPlane(_axisPlane, _planeHit) ? _planeHit.x : ax;

    // projA is the screen position of the axis reference point — every offset
    // below is measured from here. toScreen() writes INTO its `out` argument;
    // dropping that argument (as an earlier version of this function did)
    // leaves projA holding world-space metres instead of screen pixels, which
    // silently turns every distance in this function into a unit mismatch.
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
      return { x: along, theta: 0, rho: r, radius: r, along, mPerPx, ok: false };
    }
    const c = (Dx*By - Dy*Bx)/det;   // (rho/r)·cos(theta)
    const s = (Ax*Dy - Ay*Dx)/det;   // (rho/r)·sin(theta)
    const theta = Math.atan2(s, c);
    const rho = Math.hypot(c, s)*r;

    // Refine where along the arm it is. `along` above crosses the plane at the
    // limb's AXIS height, but the hand is up on the surface or out past it, and
    // with the camera yawed a ray reaches that height a couple of centimetres
    // further down the arm than the point it passed through. Re-crossing at the
    // height just solved for removes that shift — which matters because the
    // side of the band a loop is tucked on is decided by this number.
    const yHit = ARM_Y + Math.cos(theta)*rho;
    _levelPlane.setComponents(0, 1, 0, -yHit);
    const refined = _caster.ray.intersectPlane(_levelPlane, _planeHit) ? _planeHit.x : along;

    return {
      x: refined,
      theta, rho,
      radius: r,
      along, mPerPx, ok: true,
    };
  }

  /**
   * Reads the pointer as a point ON the limb's surface, solving for where
   * along the arm it is as well as where round it.
   *
   * pointerToLimb has to be told which cross-section to work in, and it will
   * happily answer for any of them: every choice of axisX yields some
   * (theta, rho) that projects back onto the same pixel, so x cannot simply be
   * read off. The extra constraint that pins it down is that the strap is
   * being dragged ALONG THE SKIN — so the answer is the cross-section whose
   * solution actually lands on the limb's surface, rho = radius. Since rho
   * only grows as axisX moves away from the true one, that is a clean minimum
   * to search for rather than a root to bracket.
   *
   * Letting x float does, however, bring back the front/back ambiguity the
   * camera yaw was there to remove: a ray meets the limb twice, and BOTH hits
   * sit on the surface, so "lands on the skin" alone cannot separate the near
   * side from the far side. Left to itself the search flips between them and
   * the wrap direction inverts. `thetaRef` breaks the tie the way the hand
   * does — the strap was somewhere a moment ago and has not jumped to the
   * other side of the arm since.
   *
   * @param {function(number):number} radiusOf  limb radius at an x
   * @param {number} xHint  where to search around — the previous reading. Pass
   *        null for the first sample of a gesture, which sweeps the whole limb:
   *        seeding the narrow window from wherever the strap was picked up off
   *        the bench cannot reach a band being placed high on the upper arm.
   * @param {number} thetaRef  the previous angle, to stay on its branch
   */
  function pointerToLimbSurface(screen, rect, xHint, radiusOf, thetaRef){
    let lo = xHint == null ? WRIST_X : xHint - 0.11;
    let hi = xHint == null ? SHOULDER_X : xHint + 0.11;
    // weighted so a few millimetres of surface error never outvotes a jump to
    // the opposite side of the limb
    const BRANCH_W = 0.004;
    let best = null;
    for(let pass = 0; pass < 3; pass++){
      const N = 16;
      let bestErr = Infinity, bestX = lo;
      for(let i = 0; i <= N; i++){
        const x = lo + (hi - lo)*(i/N);
        const rr = radiusOf(x);
        const s = pointerToLimb(screen, rect, x, rr);
        let err = Math.abs(s.rho - rr);
        if(thetaRef != null) err += BRANCH_W*Math.abs(angleDelta(thetaRef, s.theta));
        if(err < bestErr){ bestErr = err; bestX = x; best = s; }
      }
      const span = (hi - lo)/N;
      lo = bestX - span; hi = bestX + span;
    }
    // How far off the skin the best fit still is. Small means the hand really
    // is against the arm and this x can be trusted; large means it is held
    // clear of it, where no cross-section puts it on the surface and the x is
    // a guess.
    if(best) best.residual = Math.abs(best.rho - radiusOf(best.x));
    return best;
  }

  /**
   * The pointer relative to the arm's axis LINE on screen — the one reading
   * about a limb that carries no ambiguity at all.
   *
   * @returns {{x, p, rProj, pMax}}
   *   x      metres along the arm, from the pointer ray crossing axis height
   *   p      signed perpendicular offset in pixels, +ve on the NEAR side of
   *          the arm (toward the operator, which is down-screen)
   *   rProj  the limb's radius measured straight toward the operator
   *   pMax   the limb's SILHOUETTE half-width along that same perpendicular —
   *          the largest |p| any point on the skin can have. So |p|/pMax ≤ 1
   *          means the hand is against the arm, and > 1 means it is held clear
   *          of it. That ratio is the one honest thing this view can say about
   *          depth, and both the wrap and the tension are built on it.
   *
   * Routing uses this rather than the angle solve above. Round the back of the
   * limb the angle is genuinely not in the picture — the underside is hidden
   * behind the arm — so the honest reading is not "what angle is the hand at"
   * but "is it against the skin, which side, and how far has it travelled".
   * That is what a phlebotomist's hand knows too.
   */
  function pointerToAxis(screen, rect, axisX, radius){
    const ax = axisX == null ? SITE.x : axisX;
    const r = radius == null ? 0.043 : radius;

    _ndc.set(
      ((screen.x - rect.left)/rect.width)*2 - 1,
      -((screen.y - rect.top)/rect.height)*2 + 1
    );
    _caster.setFromCamera(_ndc, camera);
    const alongX = _caster.ray.intersectPlane(_axisPlane, _planeHit) ? _planeHit.x : ax;

    toScreen(worldScratch.set(ax, ARM_Y, 0), rect, projA);
    // the near side of the limb: +Z, toward the operator
    toScreen(worldScratch.set(ax, ARM_Y, r), rect, projB);
    let wx = projB.x - projA.x, wy = projB.y - projA.y;
    const rProj = Math.hypot(wx, wy) || 1;
    wx /= rProj; wy /= rProj;

    // How far a step straight UP the limb moves along that same perpendicular.
    // The silhouette is wider than rProj because the top of the arm is offset
    // across the view as well as up it; without this the skin itself measures
    // as "held clear of the arm".
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

  /** The inverse, for placing things the learner has not grabbed. */
  function limbToWorld(x, theta, r){
    return new THREE.Vector3(x, ARM_Y + Math.cos(theta)*r, Math.sin(theta)*r);
  }

  /* ---------- camera framing ---------------------------------------------- */
  // Looking down the operator's own eyeline: the arm runs across the view, the
  // fossa is centred, and there is room above the arm for the band's zone.
  const PITCH = 0.72;              // radians above horizontal
  // Centred so the fossa and the band's zone sit in the middle of the frame
  // with the hand still visible off to one side.
  const LOOK_X = -0.045;
  /* Swung along the arm's length, NOT decoration. Square-on, the camera's view
     direction lies in the limb's cross-section plane, the cross-section is seen
     edge-on, and which side of the arm the hand is on is simply not present in
     the image (see pointerToLimb). This angle is what gives that circle area on
     screen and makes the wrap solvable — and a three-quarter view of an arm
     reads better than a flat side-on one anyway. */
  const CAM_YAW = 0.42;            // ~24° round the limb's axis

  function fitCamera(aspect, obstruction){
    const a = Math.max(0.4, aspect || 1.6);
    const ob = obstruction || { rightFrac: 0, bottomFrac: 0 };
    const rightFrac = Math.min(0.45, Math.max(0, ob.rightFrac || 0));
    const bottomFrac = Math.min(0.6, Math.max(0, ob.bottomFrac || 0));
    camera.aspect = a;

    // The whole limb, hand included. Cropped tighter it reads as a cylinder
    // rather than an arm — and the hand has to be in shot, because a hand
    // going pale is how a band that is too tight announces itself.
    const spanX = 0.62 / (1 - rightFrac);
    const spanZ = 0.34 / (1 - bottomFrac);

    /* A long lens, deliberately. Everything the gesture measures is a small
       offset compared with the camera's distance, and a wide short-throw lens
       makes those offsets project non-linearly: the same 5 cm pull reads as
       half again as much on one side of the arm as the other, so a steady hand
       looks like a tightening one. Pulling the camera back and narrowing the
       lens keeps the working area the same size on screen while making the
       projection near enough affine over it to trust. */
    const BASE_FOV = 20, MAX_FOV = 32;
    camera.fov = BASE_FOV;
    let halfTan = Math.tan((BASE_FOV*Math.PI/180)/2);
    let dist = (spanZ/2)/halfTan * 1.15;
    const neededFov = 2*Math.atan((spanX/2)/dist/a)*180/Math.PI;
    if(neededFov > BASE_FOV){
      camera.fov = Math.min(MAX_FOV, neededFov);
      halfTan = Math.tan((camera.fov*Math.PI/180)/2);
      if(neededFov > MAX_FOV) dist = (spanX/2)/halfTan/a;
    }

    const visH = 2*dist*halfTan;
    const visW = visH*a;
    const cx = LOOK_X + visW*rightFrac/2;
    const cz = visH*bottomFrac/2;

    // orbit the camera round the look point: up by PITCH, along by CAM_YAW
    const horiz = Math.cos(PITCH)*dist;
    camera.position.set(
      cx + horiz*Math.sin(CAM_YAW),
      ARM_Y + Math.sin(PITCH)*dist,
      cz + horiz*Math.cos(CAM_YAW)
    );
    camera.lookAt(cx, ARM_Y - 0.008, cz);
    camera.updateProjectionMatrix();
  }
  fitCamera(1.6, { rightFrac: 0.27, bottomFrac: 0 });

  function tick(dt){ arm.tick(dt); }

  function dispose(){
    arm.dispose();
    root.traverse(obj=>{
      if(obj.geometry) obj.geometry.dispose();
      const ms = Array.isArray(obj.material) ? obj.material : (obj.material ? [obj.material] : []);
      ms.forEach(m=>{ if(m && m.userData && m.userData.perInstance && m.dispose) m.dispose(); });
    });
    scene.clear();
  }

  return {
    scene, camera, root, arm,
    pointerToLimb, pointerToLimbSurface, pointerToAxis, angleDelta, limbToWorld, toScreen,
    fitCamera, setSiteVisible, tick, dispose,
    ARM_Y,
  };
}
