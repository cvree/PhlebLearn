/* =========================================================================
   THE PATIENT — the rest of the person the arm is attached to.

   The old bench showed a forearm and a cuff of sleeve. That is a specimen,
   not a patient, and it took the game's single most important feedback
   channel off the screen: whether the person you are sticking is frightened,
   holding their breath, or has just let it go.

   So this is a body, positioned beyond the elbow and up into the top third of
   the frame, deliberately soft — the scene's fog does most of that work — and
   deliberately simple. What matters is not that it is a good likeness. What
   matters is that four things are legible at a glance from across a room:

     BREATHING   chest rise, rate and depth tracking anxiety
     TENSION     shoulders up, brow drawn, jaw set
     WINCE       a fast asymmetric flinch, on error
     EXHALE      the shoulder dropping at flashback — the payoff beat

   Owns meshes and one small animation state machine. It decides nothing: the
   complication and insertion branches tell it what the patient is feeling.
   ========================================================================= */
import * as THREE from "three";
import { ARM_Y } from "./armMesh.js";
import { SHOULDER_X } from "./armAnatomy.js";

/** A radial-gradient dot, so a face feature has an edge that fades. */
let _dotTex = null;
function softDotTexture(){
  if(_dotTex) return _dotTex;
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(16, 16, 1, 16, 16, 15);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.55, "rgba(255,255,255,0.92)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad; g.fillRect(0, 0, 32, 32);
  _dotTex = new THREE.CanvasTexture(c);
  return _dotTex;
}

function mat(color, o){
  const m = new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.86 }, o || {}));
  m.userData.perInstance = true;
  return m;
}

const HAIR_COLORS = [0x2b2118, 0x4a3527, 0x6d5340, 0x8a7a68, 0xb9a68a, 0x33302e];

/**
 * @param {object} o
 *   skin   hex from the patient's appearance
 *   shirt  hex
 *   build  0.8 … 1.25
 *   hair   hex, optional
 */
export function buildPatientBody(o){
  const opt = o || {};
  const build = opt.build == null ? 1 : opt.build;
  const skinHex = opt.skin == null ? 0xe6b98f : opt.skin;
  const shirtHex = opt.shirt == null ? 0x7f9bc4 : opt.shirt;
  const hairHex = opt.hair == null ? HAIR_COLORS[Math.floor(Math.random()*HAIR_COLORS.length)] : opt.hair;

  const group = new THREE.Group();
  group.name = "patientBody";

  /* SOFT FOCUS, done in the palette rather than with a blur.
     Depth fog cannot separate the patient from the arm here, because a
     leaning patient's head and the arm's own proximal end sit at very nearly
     the same distance from the camera. So the body is desaturated toward the
     room's own light instead: present, unmistakably a person, and never
     competing with a 4 mm vein for the eye. */
  const AIR = new THREE.Color(0xdfe7f1);
  const soften = (hex, k)=> new THREE.Color(hex).lerp(AIR, k).getHex();

  const skinMat = mat(soften(skinHex, 0.22), { roughness: 0.86 });
  const shirtMat = mat(soften(shirtHex, 0.40), { roughness: 0.94 });
  const hairMat = mat(soften(hairHex, 0.30), { roughness: 0.96 });
  const darkMat = new THREE.MeshBasicMaterial({ color: 0x4a4038, transparent: true, opacity: 0.62 });
  darkMat.userData.perInstance = true;

  /* --- the sleeve, continuing the upper arm out of frame ----------------- */
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.062*build, 0.072*build, 0.10, 20), shirtMat);
  sleeve.rotation.z = Math.PI/2;
  sleeve.position.set(SHOULDER_X + 0.046, ARM_Y + 0.004, 0);
  group.add(sleeve);

  /* --- torso -------------------------------------------------------------
     A seated person, leaning very slightly toward the arm they have offered.
     The chest is the thing that has to move, so it gets its own node. */
  /* Leaning forward and down, watching their own arm. That is what an
     interested or anxious patient actually does — and it is also the only
     placement that gets a face into the upper third of a framing wide enough
     to hold the whole limb. Anatomically upright, the head sat 24 cm above
     the armrest and a framing that included it shrank the arm to 41% of the
     screen; leaning in brings it to 15 cm and the arm back to 60%. */
  const chest = new THREE.Group();
  chest.position.set(SHOULDER_X + 0.060, ARM_Y - 0.042, -0.075);
  group.add(chest);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.115*build, 0.155, 6, 18), shirtMat);
  torso.rotation.z = 0.18;
  torso.rotation.x = -0.16;
  torso.scale.set(1, 1, 0.82);
  chest.add(torso);

  const shoulderNear = new THREE.Mesh(new THREE.SphereGeometry(0.052*build, 16, 12), shirtMat);
  shoulderNear.scale.set(1, 0.86, 1);
  shoulderNear.position.set(-0.046, 0.096, 0.082);
  chest.add(shoulderNear);
  const shoulderFar = new THREE.Mesh(new THREE.SphereGeometry(0.052*build, 16, 12), shirtMat);
  shoulderFar.scale.set(1, 0.86, 1);
  shoulderFar.position.set(-0.046, 0.096, -0.068);
  chest.add(shoulderFar);
  // the slope from neck to shoulder, which is what stops two spheres on a
  // capsule reading as a snowman
  const yoke = new THREE.Mesh(new THREE.CapsuleGeometry(0.054*build, 0.146, 5, 14), shirtMat);
  yoke.rotation.x = Math.PI/2;
  yoke.scale.set(1, 1, 0.80);
  yoke.position.set(-0.038, 0.096, 0.008);
  chest.add(yoke);

  /* --- head --------------------------------------------------------------
     Faces -X, which is where the operator is. Everything expressive hangs off
     `head` so a single node carries the turn, the nod and the flinch. */
  /* The head is TURNED AND TILTED toward the operator, not left in an
     anatomical neutral. The camera sits about 60 cm above the patient's head
     looking down at 32 degrees, so a neutral head presents its crown and the
     face is never seen — which is exactly what the first attempt at this
     scene did. Turning 35 degrees toward the operator and lifting the chin 17
     degrees puts the face normal within about 20 degrees of the sightline,
     and reads as a patient watching the person about to stick them. */
  const head = new THREE.Group();
  head.position.set(-0.030, 0.190, 0.072);
  head.rotation.set(0, 0.62, -0.30);
  chest.add(head);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.042, 0.058, 14), skinMat);
  neck.position.set(0.006, -0.046, 0);
  head.add(neck);

  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.076, 22, 18), skinMat);
  skull.scale.set(0.94, 1.06, 0.92);
  head.add(skull);

  const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.057, 16, 12), skinMat);
  jaw.scale.set(0.86, 0.74, 0.88);
  jaw.position.set(-0.014, -0.034, 0);
  head.add(jaw);

  /* A CAP, not a ball. A full hair sphere swallows the face from any angle
     that is even slightly above the head, and the face is the reason this
     body exists. phiStart/phiLength carve away the front. */
  /* A SKULLCAP, cut by polar angle rather than by azimuth. Cutting by azimuth
     (the first attempt) leaves a band that reads as headphones the moment the
     head is turned, because the cut no longer lines up with the face. A cap
     that stops above the brow line is correct from every angle the camera can
     reach, and a second lobe gives the back of the head some volume. */
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.081, 24, 16, 0, Math.PI*2, 0, Math.PI*0.36), hairMat);
  hair.scale.set(1.03, 1.10, 1.05);
  hair.position.set(0.006, 0.004, 0);
  head.add(hair);
  /* The cap alone stops well above the brow — it has to, or it renders over
     the eyes — so the back and sides get their own lobe, offset far enough
     behind the face that it can never reach it however the head is turned. */
  const nape = new THREE.Mesh(new THREE.SphereGeometry(0.072, 20, 14), hairMat);
  nape.scale.set(0.90, 1.02, 1.04);
  nape.position.set(0.028, -0.004, 0);
  head.add(nape);

  const ear = (z)=>{
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.017, 10, 8), skinMat);
    m.scale.set(0.5, 1, 0.7);
    m.position.set(0.006, -0.004, z*0.92);
    head.add(m);
  };
  ear(0.070); ear(-0.070);

  /* --- face ---------------------------------------------------------------
     Flat billboard-ish features on the -X face of the skull. Cheap, and at the
     distance the camera holds them they read better than geometry would. */
  /* Features are soft ellipses rather than bars: at this distance a hard
     black rectangle reads as a sticker, and a blurred oval reads as an eye. */
  const featureTex = softDotTexture();
  const faceX = -0.0705;
  function feature(w, h, y, z, m){
    const mm = m || new THREE.MeshBasicMaterial({
      map: featureTex, color: 0x4c4238, transparent: true, opacity: 0.78, depthWrite: false,
    });
    mm.userData.perInstance = true;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mm);
    mesh.rotation.y = -Math.PI/2;
    mesh.position.set(faceX, y, z);
    head.add(mesh);
    return mesh;
  }
  const eyeL = feature(0.021, 0.012, 0.010, 0.028);
  const eyeR = feature(0.021, 0.012, 0.010, -0.028);
  const browL = feature(0.026, 0.008, 0.028, 0.029);
  const browR = feature(0.026, 0.008, 0.028, -0.029);
  const mouth = feature(0.030, 0.011, -0.038, 0.000);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.009, 0.020, 8), skinMat);
  nose.rotation.z = Math.PI/2;
  nose.position.set(faceX + 0.006, -0.010, 0.001);
  head.add(nose);

  /* --- state -------------------------------------------------------------- */
  let clock = 0;
  let tense = 0, tenseWant = 0;
  let wince = 0;
  let exhale = 0;
  let blink = 0, blinkAt = 1.5 + Math.random()*3;
  let gaze = 0;                 // 0 looking away, 1 looking at their own arm
  let gazeWant = 0;

  const baseChestY = chest.position.y;
  const baseShoulderY = shoulderNear.position.y;
  const baseYokeY = yoke.position.y;
  const baseHeadRot = head.rotation.y;
  const baseHeadTilt = head.rotation.z;

  /** 0 relaxed … 1 rigid. Anxiety, anticipation, pain. */
  function setTension(k){ tenseWant = Math.max(0, Math.min(1, k || 0)); }
  /** A fast flinch. Called when something hurt. */
  function flinch(strength){ wince = Math.max(wince, Math.max(0, Math.min(1, strength == null ? 1 : strength))); }
  /** The breath they had been holding. The flashback beat's patient channel. */
  function relieve(){ exhale = 1; tenseWant = Math.min(tenseWant, 0.18); }
  /** Whether they are watching what you are doing. */
  function setWatching(on){ gazeWant = on ? 1 : 0; }

  function tick(dt, arm){
    const d = dt || 0;
    clock += d;

    tense += (tenseWant - tense)*(1 - Math.exp(-2.2*d));
    wince = Math.max(0, wince - d*3.2);
    exhale = Math.max(0, exhale - d*0.55);
    gaze += (gazeWant - gaze)*(1 - Math.exp(-3.0*d));

    /* Breathing. Anxious people breathe faster and shallower; the exhale beat
       overrides both for a moment with one long, deep, visible release. */
    const rate = 0.24 + tense*0.20;                    // Hz
    const depth = (0.0060 - tense*0.0026) + exhale*0.0090;
    const breath = Math.sin(clock*2*Math.PI*rate);
    chest.position.y = baseChestY + breath*depth;
    torso.scale.z = 0.80 + breath*0.016 + exhale*0.02;

    /* Shoulders. Up and forward when tense; the DROP is the payoff. */
    const lift = tense*0.020 - exhale*0.016;
    shoulderNear.position.y = baseShoulderY + lift;
    shoulderFar.position.y = baseShoulderY + lift;
    yoke.position.y = baseYokeY + lift*0.8;
    chest.rotation.z = 0.02 + tense*0.030 - exhale*0.020;

    /* Head: turns toward the arm when watching, away when they'd rather not,
       and jerks on a wince. */
    // Watching their own arm means turning BACK toward it and dropping the
    // chin; looking at you means the pose it rests in.
    head.rotation.y = baseHeadRot - gaze*0.30 + Math.sin(clock*0.7)*0.018;
    head.rotation.z = baseHeadTilt + gaze*0.22 - wince*0.10 + tense*0.03;
    head.rotation.x = -wince*0.10;
    head.position.x = -0.030 - wince*0.008;

    /* Face. A blink is a scale, a wince is a squint, tension draws the brow
       in and down, relief lets the mouth go. */
    blinkAt -= d;
    if(blinkAt <= 0){ blink = 1; blinkAt = 2.2 + Math.random()*3.4; }
    blink = Math.max(0, blink - d*11);
    const openness = Math.max(0.08, 1 - blink - wince*0.85 - tense*0.20);
    eyeL.scale.y = openness; eyeR.scale.y = openness;
    browL.position.y = 0.032 - tense*0.006 - wince*0.008;
    browR.position.y = 0.032 - tense*0.006 - wince*0.008;
    browL.rotation.x = tense*0.35 + wince*0.5;
    browR.rotation.x = -tense*0.35 - wince*0.5;
    mouth.scale.set(1 - tense*0.22 + exhale*0.10, 1 + wince*1.6 + exhale*0.9, 1);

    /* A patient going vasovagal pales all over, and the arm already knows the
       number — so the face reads it from there rather than being told twice. */
    if(arm && arm.condition){
      const p = Math.max(0, Math.min(1, arm.condition.pallor || 0));
      skinMat.color.copy(baseSkin).lerp(paleSkin, p);
    }
  }

  const baseSkin = new THREE.Color(skinHex);
  const paleSkin = baseSkin.clone().lerp(new THREE.Color(0xf3e9e2), 0.62);

  function dispose(){
    group.traverse(obj=>{
      if(obj.geometry) obj.geometry.dispose();
      const ms = Array.isArray(obj.material) ? obj.material : (obj.material ? [obj.material] : []);
      ms.forEach(m=>{ if(m && m.userData && m.userData.perInstance && m.dispose) m.dispose(); });
    });
  }

  return {
    group, head, chest,
    setTension, flinch, relieve, setWatching, tick, dispose,
    get tension(){ return tense; },
  };
}
