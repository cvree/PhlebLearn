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
  // Headless (npm test): no canvas, so a blank texture — which keeps the whole
  // body buildable without a browser and therefore makes the skeleton's
  // geometry assertable. See rendering/labelTexture.js for the same reasoning.
  if(typeof document === "undefined" || !document.createElement){
    _dotTex = new THREE.Texture();
    return _dotTex;
  }
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

  /* Softened enough to stay behind a 4 mm vein, but not so far that the body
     loses its form: at 0.40 the shirt had no value range left and the torso
     read as one flat mass rather than as a person with shoulders. */
  const skinMat = mat(soften(skinHex, 0.16), { roughness: 0.84 });
  const shirtMat = mat(soften(shirtHex, 0.26), { roughness: 0.92 });
  const hairMat = mat(soften(hairHex, 0.22), { roughness: 0.95 });
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

  /* THE LEAN IS A NODE, NOT A MESH ROTATION.

     It used to live on the torso mesh alone, while the shoulders, the yoke and
     the head were the torso's SIBLINGS with no rotation at all. So the chest
     leaned and nothing above it followed: the head's 35-degree turn and
     17-degree tilt were applied in an upright frame while the shoulders sat in
     a leaning one, and the result was a head that read as stuck on rather than
     attached to anybody. Everything from the ribs up now hangs off one node
     that carries the lean, so a turn of the head is a turn RELATIVE to the
     shoulders it is sitting on, which is the only way it can look right. */
  const spine = new THREE.Group();
  spine.rotation.set(-0.16, 0, 0.18);
  chest.add(spine);

  /* PROPORTION. A seated adult is about 42 cm across the shoulders and about
     16 cm across the skull. The first version of this body was 25 cm across
     the shoulders against the same 15 cm head, so the head came out at 60% of
     the shoulder width instead of 37% — which is the proportion of a toddler,
     and is why it read as a large head on a small body however well the
     posture worked. The skull is right; the body was narrow. */
  /* PROPORTION. A seated adult is about 42 cm across the shoulders against a
     16 cm skull — the head is a bit over a third of the shoulder width. The
     first version was 25 cm across the shoulders against the same skull, so
     the head came out at 60%, which is the proportion of a toddler and is why
     it read as a large head on a small body however well the posture worked.
     The skull was right; the body was narrow.

     The width belongs to the SHOULDERS, not to a fatter torso — widening the
     capsule instead just produces a bigger blob, which is the other way this
     can go wrong. */
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.118*build, 0.190, 6, 18), shirtMat);
  torso.scale.set(1, 1, 0.80);
  torso.position.y = -0.010;
  spine.add(torso);

  // Far enough below the neck's base that there is a visible neck between the
  // jaw and the shoulder. At 0.074 the near shoulder sat at chin height and
  // read as a ball resting against the patient's face.
  const SHOULDER_Y = 0.046;
  const shoulderNear = new THREE.Mesh(new THREE.SphereGeometry(0.056*build, 16, 12), shirtMat);
  shoulderNear.scale.set(1, 0.84, 1);
  shoulderNear.position.set(-0.042, SHOULDER_Y, 0.118);
  spine.add(shoulderNear);
  const shoulderFar = new THREE.Mesh(new THREE.SphereGeometry(0.056*build, 16, 12), shirtMat);
  shoulderFar.scale.set(1, 0.84, 1);
  shoulderFar.position.set(-0.042, SHOULDER_Y, -0.102);
  spine.add(shoulderFar);
  // the slope from neck to shoulder, which is what stops two spheres on a
  // capsule reading as a snowman
  const yoke = new THREE.Mesh(new THREE.CapsuleGeometry(0.056*build, 0.220, 5, 14), shirtMat);
  yoke.rotation.x = Math.PI/2;
  yoke.scale.set(1, 1, 0.78);
  yoke.position.set(-0.034, SHOULDER_Y + 0.008, 0.008);
  spine.add(yoke);

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
  /* THE NECK RISES FROM THE SHOULDERS, NOT FROM THE SKULL.

     It used to be a child of `head`, so a 17-degree head tilt tilted the neck
     with it and the neck stopped meeting the yoke — the head and its neck
     leaned away as one piece, hinged at nothing. `neckBase` is the joint: it
     sits on the spine, so it leans with the body; the neck is vertical in that
     frame and stays vertical however far the head turns; and only the skull
     and everything on it rotates. */
  const neckBase = new THREE.Group();
  neckBase.position.set(0.002, 0.1186, 0.1014);
  spine.add(neckBase);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.044, 0.070, 14), skinMat);
  neck.position.set(0, 0.026, 0);
  neckBase.add(neck);

  const head = new THREE.Group();
  head.position.set(0, 0.060, 0);
  head.rotation.set(0, 0.62, -0.30);
  neckBase.add(head);

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
  /* The cap's cut angle is DERIVED from where the brow actually is, rather
     than being a literal that has to be re-checked by eye every time the face
     moves. The brow's own animation drops it 14 mm under tension and a wince,
     so the clearance is measured against the highest the brow ever sits. */
  const HAIR_R = 0.081, HAIR_SY = 1.10, HAIR_Y = 0.004;
  const BROW_Y = 0.028, BROW_H = 0.008;
  const HAIRLINE_Y = BROW_Y + BROW_H/2 + 0.008;      // 8 mm of forehead, always
  const hairPhi = Math.acos(
    Math.max(-1, Math.min(1, (HAIRLINE_Y - HAIR_Y) / (HAIR_R*HAIR_SY)))
  );
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.081, 24, 16, 0, Math.PI*2, 0, hairPhi), hairMat);
  hair.scale.set(1.03, HAIR_SY, 1.05);
  hair.position.set(0.006, HAIR_Y, 0);
  head.add(hair);
  /* The cap alone stops well above the brow — it has to, or it renders over
     the eyes — so the back and sides get their own lobe, offset far enough
     behind the face that it can never reach it however the head is turned. */
  /* The nape used to be scaled 1.04 in z, which is WIDER than the skull's own
     0.92 — so it stood proud of the head on both sides past the ears and the
     whole thing read as a swim cap rather than hair. It sits just inside the
     skull now, and further back, so the sides of the face are skin. */
  const nape = new THREE.Mesh(new THREE.SphereGeometry(0.072, 20, 14), hairMat);
  nape.scale.set(0.88, 1.00, 0.94);
  nape.position.set(0.034, -0.006, 0);
  head.add(nape);

  const ear = (z)=>{
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.017, 10, 8), skinMat);
    m.scale.set(0.5, 1, 0.7);
    m.position.set(0.006, -0.004, z*0.92);
    head.add(m);
  };
  ear(0.070); ear(-0.070);

  /* --- face ---------------------------------------------------------------
     Soft ellipses rather than bars: at this distance a hard black rectangle
     reads as a sticker and a blurred oval reads as an eye.

     THEY SIT ON THE SKULL, WHICH THEY PREVIOUSLY DID NOT.

     Every feature used to be a flat plane at one CONSTANT x, all facing -X.
     The skull is not a plane and it is not even a sphere — it is an ellipsoid
     scaled (0.94, 1.06, 0.92) — so a constant x is only on the surface at the
     exact centre of the face. By the eyes, at z = ±28 mm, the real surface has
     receded about 5 mm, and the eye planes hovered in mid-air in front of it.
     With the head turned 35 degrees toward the operator, as it is here, that
     is not subtle: they read as detached dots drifting over a ball.

     So each feature is SOLVED onto the ellipsoid at its own (y, z) and turned
     to face along the surface normal there. Every feature gets an anchor group
     carrying that placement, and the animated plane lives inside it — which is
     what lets a brow still be raised, drawn in, and angled without any of that
     lifting it back off the face. */
  const featureTex = softDotTexture();
  const SKULL_A = 0.076*0.94, SKULL_B = 0.076*1.06, SKULL_C = 0.076*0.92;
  const PROUD = 0.0015;      // metres clear of the skin, so it never z-fights

  /** Puts an anchor on the skull's -X surface at (y, z), facing outward. */
  function anchorOnSkull(anchor, y, z){
    const ry = y/SKULL_B, rz = z/SKULL_C;
    const inside = Math.max(0.04, 1 - ry*ry - rz*rz);
    const x = -SKULL_A*Math.sqrt(inside);
    // The outward normal of an ellipsoid is (x/a², y/b², z/c²), normalised.
    const n = new THREE.Vector3(x/(SKULL_A*SKULL_A), y/(SKULL_B*SKULL_B), z/(SKULL_C*SKULL_C)).normalize();
    anchor.position.set(x + n.x*PROUD, y + n.y*PROUD, z + n.z*PROUD);
    anchor.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    anchor.userData.faceY = y;
    anchor.userData.faceZ = z;
    return anchor;
  }

  /* THE INK IS DERIVED FROM THE SKIN, NOT FIXED.

     Every feature used to be painted the same mid-brown (0x4c4238). On a pale
     patient that reads; on a dark-skinned patient it is the same value as the
     face and the features vanish completely — the patient has no face at all,
     which is worse than the floating-dots bug it replaced. Darkening the
     patient's OWN skin keeps the same contrast at every tone, and the sclera
     does the same trick in the other direction, so eyes read as eyes on
     anybody. */
  const featureInk = new THREE.Color(skinHex).lerp(new THREE.Color(0x140d09), 0.74);
  const scleraInk = new THREE.Color(skinHex).lerp(new THREE.Color(0xfdf8f2), 0.88);

  function plane(anchor, w, h, color, opacity, order){
    const mm = new THREE.MeshBasicMaterial({
      map: featureTex, color: color.clone(), transparent: true,
      opacity, depthWrite: false,
    });
    mm.userData.perInstance = true;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mm);
    mesh.renderOrder = order;          // after the skin it is drawn on
    anchor.add(mesh);
    return mesh;
  }

  function feature(w, h, y, z, color, opacity){
    const anchor = new THREE.Group();
    anchorOnSkull(anchor, y, z);
    head.add(anchor);
    const mesh = plane(anchor, w, h, color || featureInk, opacity == null ? 0.82 : opacity, 2);
    mesh.userData.anchor = anchor;
    return mesh;
  }

  /* An eye is a light sclera with a dark iris on it. One dark oval alone reads
     as a closed eye or as a smudge; the pair is what makes it read as an open
     eye that is looking at you, at any skin tone. */
  function eye(z){
    const e = feature(0.023, 0.013, 0.010, z, scleraInk, 0.92);
    const iris = plane(e.userData.anchor, 0.012, 0.012, featureInk, 0.95, 3);
    iris.position.z = 0.0004;
    e.userData.iris = iris;
    return e;
  }

  const eyeL = eye(0.028);
  const eyeR = eye(-0.028);
  const browL = feature(0.026, BROW_H, BROW_Y, 0.029);
  const browR = feature(0.026, BROW_H, BROW_Y, -0.029);
  const mouth = feature(0.026, 0.009, -0.034, 0.000);

  /** Slides a feature up or down the face, keeping it ON the face. */
  function setFeatureY(mesh, y){
    anchorOnSkull(mesh.userData.anchor, y, mesh.userData.anchor.userData.faceZ);
  }

  // The nose is the one feature that genuinely needs relief rather than a
  // decal, so it is real geometry — seated on the same solved surface.
  const noseAnchor = anchorOnSkull(new THREE.Group(), -0.008, 0);
  head.add(noseAnchor);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.009, 0.020, 8), skinMat);
  nose.rotation.x = -Math.PI/2;        // the cone's +Y points along the anchor's +Z
  nose.position.z = 0.004;
  noseAnchor.add(nose);

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
  const baseHeadY = head.position.y;

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
    // A flinch pulls the head back into the shoulders along the neck's own
    // axis. It used to be written as an absolute x, which silently hardcoded
    // where the head sat and would have snapped it back to the old position
    // the first time anybody was hurt.
    head.position.y = baseHeadY - wince*0.006;

    /* Face. A blink is a scale, a wince is a squint, tension draws the brow
       in and down, relief lets the mouth go. */
    blinkAt -= d;
    if(blinkAt <= 0){ blink = 1; blinkAt = 2.2 + Math.random()*3.4; }
    blink = Math.max(0, blink - d*11);
    const openness = Math.max(0.08, 1 - blink - wince*0.85 - tense*0.20);
    // The lid closes over the whole eye, sclera and iris together.
    eyeL.scale.y = openness; eyeR.scale.y = openness;
    eyeL.userData.iris.scale.y = 1; eyeR.userData.iris.scale.y = 1;
    // Drawing the brow in and down moves it ACROSS the face, so the anchor is
    // re-solved onto the skull rather than the plane being slid off it.
    const browY = BROW_Y - tense*0.006 - wince*0.008;
    setFeatureY(browL, browY);
    setFeatureY(browR, browY);
    browL.rotation.z = tense*0.35 + wince*0.5;
    browR.rotation.z = -tense*0.35 - wince*0.5;
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
    // Exposed for the face-and-posture sanity checks in tests/patientBody.spec.js:
    // the skeleton is the thing that was wrong, so the skeleton is the thing
    // that gets asserted.
    spine, neckBase, neck, skull, hair, features: { eyeL, eyeR, browL, browR, mouth, nose },
    setTension, flinch, relieve, setWatching, tick, dispose,
    get tension(){ return tense; },
  };
}
