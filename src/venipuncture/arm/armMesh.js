/* =========================================================================
   ARM MESH — the patient's forearm as geometry, built from armAnatomy.js.

   The important part is that the veins are real tubes sitting a real depth
   under a translucent skin surface, not a texture painted on a cylinder:

     * a vein you can see is one whose polyline is close to the surface
     * a deep vein is genuinely further in, and reads as a fainter shadow
     * distension is vertex displacement along each tube's own normals, so a
       filling vein physically swells and lifts toward the skin
     * the artery pulses on the same mechanism, which is why palpation can
       tell them apart in the next branch

   Owns MESHES ONLY. Where the veins are and what they mean is armAnatomy.js;
   whether the tourniquet is correct is tourniquetRules.js.
   ========================================================================= */
import * as THREE from "three";
import {
  radiusAt, HAND_X, WRIST_X, SHOULDER_X, ELBOW_X, SITE,
  buildVessels, mirrorForArm, applyPatientVariation,
  VESSEL_KIND, distalPallor,
} from "./armAnatomy.js";

/** The arm axis sits this high above the armrest surface (y=0). */
export const ARM_Y = 0.052;

const SEG_ALONG = 96;      // rings along the limb
const SEG_ROUND = 28;      // vertices per ring

/* ---------- surface --------------------------------------------------------- */

/**
 * Height of the skin surface above the arm axis, at a lateral offset z.
 * The limb is flattened slightly on top where it rests supinated, which is
 * what gives the antecubital fossa its shallow hollow.
 */
export function surfaceY(x, z, build){
  const r = radiusAt(x, build);
  const dz = Math.min(Math.abs(z), r*0.999);
  const round = Math.sqrt(Math.max(0, r*r - dz*dz));
  // the fossa is a hollow, not a dome: flatten within ~3 cm of the crease
  const fossa = Math.exp(-Math.pow((x - ELBOW_X)/0.034, 2)) * 0.0075;
  return ARM_Y + round - fossa;
}

/** World position of a point on the skin, given arm-local (x, z). */
export function surfacePoint(x, z, build){
  return new THREE.Vector3(x, surfaceY(x, z, build), z);
}

/* ---------- limb geometry ---------------------------------------------------- */

function buildLimbGeometry(build){
  const geo = new THREE.CylinderGeometry(1, 1, 1, SEG_ROUND, SEG_ALONG - 1, false);
  geo.rotateZ(Math.PI/2);            // long axis becomes X
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();

  for(let i=0;i<pos.count;i++){
    v.fromBufferAttribute(pos, i);
    // the unit cylinder runs x:-0.5..0.5 — remap onto the real limb
    const t = v.x + 0.5;
    const x = HAND_X + (SHOULDER_X - HAND_X)*t;
    const r = radiusAt(x, build);
    const ang = Math.atan2(v.z, v.y);
    let py = Math.cos(ang)*r, pz = Math.sin(ang)*r;

    // flatten the underside where the limb rests on the armrest
    if(py < 0) py *= 0.86;
    // the fossa hollow, on the top surface only
    if(py > 0){
      const fossa = Math.exp(-Math.pow((x - ELBOW_X)/0.034, 2)) * 0.0075;
      py -= fossa * (py/r);
    }
    // the wrist narrows in one axis more than the other — a real wrist is oval
    if(x < WRIST_X + 0.03){
      const k = 1 - Math.min(1, (WRIST_X + 0.03 - x)/0.06)*0.22;
      pz *= k;
    }
    pos.setXYZ(i, x, ARM_Y + py, pz);
  }
  geo.computeVertexNormals();
  return geo;
}

/* ---------- vessels ---------------------------------------------------------- */

/**
 * A vessel's centreline in world space: follow the polyline, sitting `depth`
 * below the skin surface at each point.
 */
function vesselCurve(vessel, build){
  const pts = vessel.path.map(p=>{
    const sy = surfaceY(p.x, p.z, build);
    return new THREE.Vector3(p.x, sy - vessel.depth, p.z);
  });
  return new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.25);
}

/* Muted on purpose. A vein under skin is a soft blue-green shadow, not a blue
   pipe — saturate these and they stop reading as being UNDER the surface and
   start looking painted onto it, which loses the whole point of giving them a
   real depth. */
const VESSEL_COLOR = {
  [VESSEL_KIND.VEIN]:   0x6b7fa6,
  [VESSEL_KIND.ARTERY]: 0x9c5a55,
  [VESSEL_KIND.TENDON]: 0xd8cfc0,
  [VESSEL_KIND.NERVE]:  0xd9d08a,
};

function buildVesselMesh(vessel, build){
  const curve = vesselCurve(vessel, build);
  const geo = new THREE.TubeGeometry(curve, 64, vessel.calibre, 10, false);
  const mat = new THREE.MeshStandardMaterial({
    color: VESSEL_COLOR[vessel.kind] || 0x666666,
    roughness: 0.62,
    metalness: 0.0,
    // deeper vessels are dimmer: this is the depth cue that makes a basilic
    // read as "further down" than a median cubital without any label
    opacity: Math.max(0.18, 0.72 - vessel.depth*72),
    transparent: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.vessel = vessel;
  mesh.userData.perInstance = true;

  // Cache the rest pose so distension can displace along the tube's own
  // normals — cheap, and correct for a swept tube in a way that scaling is not.
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  mesh.userData.basePos = Float32Array.from(pos.array);
  mesh.userData.baseNor = Float32Array.from(nor.array);
  return mesh;
}

/* ---------- the whole arm ---------------------------------------------------- */

/**
 * @param {object} o
 *   skin        hex colour from the patient's appearance
 *   build       0.8 … 1.25
 *   armSide     "left" | "right"
 *   scenarioKeys  e.g. ["deep","rolling"] from makeSiteScenario
 *   vigour      hydration / vein quality, 0.6 … 1.2
 */
export function buildArm(o){
  const opt = o || {};
  const build = opt.build == null ? 1 : opt.build;
  const skinHex = opt.skin == null ? 0xe6b98f : opt.skin;

  const group = new THREE.Group();
  group.name = "patientArm";

  /* --- vessels first: they live inside the skin volume ------------------- */
  const vessels = applyPatientVariation(
    mirrorForArm(buildVessels(), opt.armSide),
    { build, scenarioKeys: opt.scenarioKeys, vigour: opt.vigour }
  );

  const vesselGroup = new THREE.Group();
  vesselGroup.name = "vessels";
  const vesselMeshes = new Map();
  vessels.forEach(v=>{
    const m = buildVesselMesh(v, build);
    vesselGroup.add(m);
    vesselMeshes.set(v.id, m);
  });
  group.add(vesselGroup);

  /* --- skin: translucent, so what is underneath actually shows ----------- */
  const skinMat = new THREE.MeshStandardMaterial({
    color: skinHex,
    roughness: 0.78,
    metalness: 0.0,
    transparent: true,
    opacity: 0.90,
  });
  skinMat.userData.perInstance = true;
  const limb = new THREE.Mesh(buildLimbGeometry(build), skinMat);
  limb.name = "skin";
  limb.userData.armSurface = true;
  group.add(limb);

  /* --- hand: enough of one that "make a fist" has somewhere to go -------- */
  const handMat = skinMat.clone();
  handMat.userData.perInstance = true;
  const hand = new THREE.Group();
  hand.name = "hand";
  const palm = new THREE.Mesh(new THREE.SphereGeometry(radiusAt(HAND_X, build)*1.16, 18, 14), handMat);
  palm.scale.set(1.15, 0.72, 1.02);
  palm.position.set(HAND_X - 0.012, ARM_Y - 0.004, 0);
  hand.add(palm);
  for(let i=0;i<4;i++){
    const fr = 0.0088 - i*0.0006;
    const fl = 0.058 - Math.abs(i-1.2)*0.006;
    const finger = new THREE.Mesh(new THREE.CapsuleGeometry(fr, fl, 4, 8), handMat);
    finger.rotation.z = Math.PI/2;
    finger.position.set(HAND_X - 0.052 - fl/2, ARM_Y - 0.006, (i-1.5)*0.0175);
    hand.add(finger);
  }
  const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.0102, 0.036, 4, 8), handMat);
  thumb.rotation.set(0, 0, Math.PI/2 - 0.5);
  thumb.position.set(HAND_X - 0.026, ARM_Y - 0.008, -0.030);
  hand.add(thumb);
  group.add(hand);

  /* --- the crease at the elbow, so the fossa reads as a bend ------------- */
  const creaseMat = new THREE.MeshBasicMaterial({
    color: 0x000000, transparent: true, opacity: 0.055, depthWrite: false,
  });
  creaseMat.userData.perInstance = true;
  const crease = new THREE.Mesh(new THREE.PlaneGeometry(0.012, radiusAt(0, build)*1.7), creaseMat);
  crease.rotation.x = -Math.PI/2;
  crease.position.set(ELBOW_X, surfaceY(ELBOW_X, 0, build) + 0.0006, 0);
  group.add(crease);

  /* --- what has happened to this arm -------------------------------------
     `condition` is a LIVE object owned by the complications branch, read
     every frame rather than copied in. That is deliberate: a bruise that
     started forming during the stick has to still be on the arm during the
     bandage step, and those are two different scenes built at two different
     times from the same encounter. Passing the object rather than its values
     is what makes the consequence outlive the step that caused it. */
  const condition = opt.condition || null;
  const bruise = buildBruise(build, opt.conditionSite);
  group.add(bruise.group);

  /* --- animation state ---------------------------------------------------- */
  let distension = 0;
  let pallor = 0;
  /** the band's own distal pallor and the patient's whole-body one are
      different causes with the same appearance; the skin shows the worse. */
  let conditionPallor = 0;
  let flinchPhase = 0;
  const baseSkin = new THREE.Color(skinHex);
  const paleSkin = baseSkin.clone().lerp(new THREE.Color(0xf3e9e2), 0.62);

  /**
   * Swells every superficial vein by `k` (0..1) and lifts it toward the skin.
   * This is what the learner is watching when they judge the tension.
   */
  function setDistension(k){
    distension = Math.max(0, Math.min(1, k || 0));
    vesselMeshes.forEach(mesh=>{
      const v = mesh.userData.vessel;
      if(v.kind !== VESSEL_KIND.VEIN) return;
      applySwell(mesh, distension * (v.depth < 0.004 ? 1 : 0.55));
      // a filled vein is darker and more obvious through the skin
      let opacity = Math.max(0.18, 0.72 - v.depth*72) + distension*0.34;
      // The transilluminator's whole purpose is the vein you cannot see: it
      // lifts the DEEP ones toward visible and leaves an already-obvious
      // vein alone, which is why owning it does not make palpation
      // unnecessary — it only tells you where to put your fingers.
      if(opt.veinFinder && v.depth >= 0.004) opacity += 0.34;
      mesh.material.opacity = Math.min(0.86, opacity);
    });
  }

  function applySwell(mesh, k){
    const geo = mesh.geometry;
    const pos = geo.attributes.position;
    const base = mesh.userData.basePos, nor = mesh.userData.baseNor;
    const v = mesh.userData.vessel;
    const grow = v.calibre * 0.62 * k;      // radial swell
    const lift = v.calibre * 0.34 * k;      // and it rises toward the surface
    for(let i=0;i<pos.count;i++){
      const i3 = i*3;
      pos.array[i3]   = base[i3]   + nor[i3]  *grow;
      pos.array[i3+1] = base[i3+1] + nor[i3+1]*grow + lift;
      pos.array[i3+2] = base[i3+2] + nor[i3+2]*grow;
    }
    pos.needsUpdate = true;
    geo.computeBoundingSphere();
  }

  /** The hand going pale is the sign the band is too tight. */
  function setPallor(t){
    pallor = Math.max(0, Math.min(1, t || 0));
    applySkinColour();
  }

  function applySkinColour(){
    const worst = Math.max(pallor, conditionPallor);
    handMat.color.copy(baseSkin).lerp(paleSkin, worst);
    // the forearm distal to the band pales too, just less — but a patient
    // going vasovagal pales all over, so that one is not discounted
    const limbPale = Math.max(pallor*0.45, conditionPallor);
    skinMat.color.copy(baseSkin).lerp(paleSkin, limbPale);
  }

  /**
   * Applies whatever the complications branch says has happened to this arm:
   * blood in the tissue, a swelling under the puncture, the pallor of a
   * patient about to faint, and the one-off jerk of a flinch.
   */
  function applyCondition(dt){
    if(!condition) return;
    bruise.set(condition);
    if(conditionPallor !== condition.pallor){
      conditionPallor = Math.max(0, Math.min(1, condition.pallor || 0));
      applySkinColour();
    }
    // A flinch is a real movement of the limb, so it moves the limb: the
    // needle steps are watching this group's position, not a CSS class.
    const k = Math.max(0, Math.min(1, condition.flinch || 0));
    if(k > 0.001 || flinchPhase !== 0){
      flinchPhase += (dt || 0)*34;
      group.position.z = Math.sin(flinchPhase)*0.0042*k;
      group.rotation.x = Math.sin(flinchPhase*0.7)*0.035*k;
      if(k <= 0.001){ flinchPhase = 0; group.position.z = 0; group.rotation.x = 0; }
    }
  }

  let clock = 0;
  /** Pulses the artery. The tendon and the nerve stay still, on purpose. */
  function tick(dt){
    clock += dt || 0;
    const artery = [...vesselMeshes.values()].find(m=>m.userData.vessel.kind === VESSEL_KIND.ARTERY);
    if(artery){
      const beat = Math.max(0, Math.sin(clock*7.6));
      applySwell(artery, 0.25 + beat*0.75);
    }
    applyCondition(dt);
  }

  function dispose(){
    group.traverse(obj=>{
      if(obj.geometry) obj.geometry.dispose();
      const ms = Array.isArray(obj.material) ? obj.material : (obj.material ? [obj.material] : []);
      ms.forEach(m=>{ if(m && m.userData && m.userData.perInstance && m.dispose) m.dispose(); });
    });
  }

  setDistension(0);

  // The browser tests need to assert that a consequence reached the LIMB and
  // not only the report — that the bruise is actually on the arm on screen.
  // Guarded on the test seam, which only exists under ?e2e=1, so nothing in
  // normal play publishes anything.
  if(typeof window !== "undefined" && window.__phlebTest){
    window.__phlebArm = { bruise, condition, setDistension, setPallor };
  }

  return {
    group, limb, hand, vesselGroup, vesselMeshes, vessels,
    build, skinHex,
    surfaceY: (x,z)=>surfaceY(x, z, build),
    radiusAt: x=>radiusAt(x, build),
    setDistension, setPallor, tick, dispose,
    /** the complications branch's live view of this arm */
    condition, bruise,
    get distension(){ return distension; },
    get pallor(){ return pallor; },
  };
}

/* ---------- the bruise ---------------------------------------------------------
   A hematoma is two visible things at once and needs both: blood spreading
   UNDER the skin (a soft stain that grows and shades from red toward purple as
   there is more of it) and the tissue LIFTING over it (a dome that raises the
   surface). One without the other reads as a sticker on an unchanged arm.
   ----------------------------------------------------------------------------- */

let bruiseTex = null;
function bruiseTexture(){
  if(bruiseTex) return bruiseTex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.45, "rgba(255,255,255,0.55)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  bruiseTex = new THREE.CanvasTexture(c);
  return bruiseTex;
}

function buildBruise(build, site){
  const at = site || { x: SITE.x, z: SITE.z };
  const group = new THREE.Group();
  group.name = "hematoma";
  group.visible = false;

  const stainMat = new THREE.MeshBasicMaterial({
    map: bruiseTexture(), color: 0x9b2f4a, transparent: true, opacity: 0,
    depthWrite: false,
  });
  stainMat.userData.perInstance = true;
  const stain = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.05), stainMat);
  stain.rotation.x = -Math.PI/2;
  stain.position.set(at.x, surfaceY(at.x, at.z, build) + 0.0007, at.z);
  group.add(stain);

  const domeMat = new THREE.MeshStandardMaterial({
    color: 0xc9707f, roughness: 0.7, transparent: true, opacity: 0,
  });
  domeMat.userData.perInstance = true;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.012, 18, 12), domeMat);
  dome.scale.set(1, 0.42, 1);
  dome.position.set(at.x, surfaceY(at.x, at.z, build) - 0.003, at.z);
  group.add(dome);

  const fresh = new THREE.Color(0xb8384f);   // new blood
  const old = new THREE.Color(0x6a3a7a);     // and what it becomes

  /** @param {object} cond the live complication condition object */
  function set(cond){
    const bruiseK = Math.max(0, Math.min(1, cond.bruise || 0));
    const swellK = Math.max(0, Math.min(1, cond.swelling || 0));
    const flushK = Math.max(0, Math.min(1, cond.flush || 0));
    group.visible = bruiseK > 0.01 || swellK > 0.01 || flushK > 0.01;
    if(!group.visible) return;

    stainMat.opacity = Math.min(0.72, bruiseK*0.8 + flushK*0.35);
    stainMat.color.copy(flushK > bruiseK ? fresh : fresh.clone().lerp(old, bruiseK));
    const spread = 0.05*(0.6 + bruiseK*1.5);
    stain.scale.set(spread/0.05, spread/0.05, 1);

    domeMat.opacity = Math.min(0.85, swellK*0.9);
    const lift = swellK*0.006;
    dome.scale.set(1 + swellK*0.9, 0.42 + swellK*0.5, 1 + swellK*0.9);
    dome.position.y = surfaceY(at.x, at.z, build) - 0.003 + lift;
  }

  return { group, stain, dome, set };
}

/* ---------- the armrest ------------------------------------------------------ */

/**
 * The chair's armrest. It matters mechanically, not decoratively: the gap
 * between the limb and the pad is the gap the tourniquet has to be threaded
 * through, so the pad is built with a real channel under the arm.
 */
export function buildArmrest(build){
  const g = new THREE.Group();
  g.name = "armrest";
  const padMat = new THREE.MeshStandardMaterial({ color: 0x5d6b7d, roughness: 0.85 });
  const len = SHOULDER_X - HAND_X + 0.10;
  const cx = (SHOULDER_X + HAND_X)/2;

  const pad = new THREE.Mesh(new THREE.BoxGeometry(len, 0.030, 0.135), padMat);
  pad.position.set(cx, -0.015, 0);
  g.add(pad);

  // The bolster the arm actually rests on, under the upper forearm only, so
  // there is clearance beneath the rest of the limb to pass a band through.
  const bolsterMat = new THREE.MeshStandardMaterial({ color: 0x6b7a8d, roughness: 0.9 });
  const bolster = new THREE.Mesh(new THREE.CylinderGeometry(0.030, 0.030, 0.085, 16), bolsterMat);
  bolster.rotation.x = Math.PI/2;
  bolster.position.set(-0.155, 0.014, 0);
  g.add(bolster);

  const towelMat = new THREE.MeshStandardMaterial({ color: 0xeef2f6, roughness: 0.95 });
  const towel = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.004, 0.125), towelMat);
  towel.position.set(0.02, 0.002, 0);
  g.add(towel);

  return g;
}

/** The point on the skin the draw is aimed at, for camera framing. */
export function siteWorldPoint(build){
  return surfacePoint(SITE.x, SITE.z, build);
}

export { distalPallor };
