/* =========================================================================
   THE PATIENT'S POSTURE AND FACE — a skeleton test, not a screenshot test.

   Three defects shipped in the first playable, and all three are structural
   rather than artistic, which means they are assertable:

     1. The lean lived on the TORSO MESH while the head was that mesh's
        sibling, so the shoulders leaned and the head did not follow. The head
        read as stuck on rather than attached to anybody.

     2. The neck was a child of the head, so a 17-degree head tilt tilted the
        neck with it and the neck stopped meeting the shoulders.

     3. Every face feature was a flat plane at one CONSTANT x on an ellipsoid
        scaled (0.94, 1.06, 0.92). A constant x is only on the surface at the
        exact centre of the face; by the eyes the real surface has receded
        about 5 mm, so the eyes hovered in front of the head in mid-air.

   These run headless because `labelTexture.js` and `softDotTexture()` both
   degrade without a `document` — which is deliberate, and is what puts the
   game's real geometry inside `npm test` instead of inside a screenshot.
   ========================================================================= */
import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";

import { buildPatientBody } from "../src/venipuncture/arm/patientBody.js";

const DEG = 180/Math.PI;

function body(){
  return buildPatientBody({ skin: 0xe6b98f, shirt: 0x7f9bc4, build: 1, hair: 0x4a3527 });
}

/** World-space direction of a node's local +Y, i.e. which way it points. */
function upOf(node){
  node.updateWorldMatrix(true, false);
  return new THREE.Vector3(0, 1, 0)
    .applyQuaternion(node.getWorldQuaternion(new THREE.Quaternion()))
    .normalize();
}

function angleBetween(a, b){ return Math.acos(Math.max(-1, Math.min(1, a.dot(b))))*DEG; }

/* ---------- posture --------------------------------------------------------- */

test("the head hangs off the same node that carries the body's lean", () => {
  const b = body();
  // Walking up from the head must pass through the spine. If it does not, the
  // head is a sibling of the lean rather than a descendant of it, which is
  // exactly the bug.
  let node = b.head, found = false;
  while(node){
    if(node === b.spine){ found = true; break; }
    node = node.parent;
  }
  assert.ok(found, "the head must be parented through the spine, not beside it");
});

test("the neck rises from the shoulders and does not tilt with the skull", () => {
  const b = body();
  b.group.updateWorldMatrix(true, true);

  const spineUp = upOf(b.spine);
  const neckUp = upOf(b.neck);
  assert.ok(angleBetween(spineUp, neckUp) < 5,
    "the neck must stay aligned with the spine, whatever the head is doing");

  // And it must STAY aligned when the head turns to watch, which is the case
  // that used to swing the whole neck away from the shoulders.
  b.setWatching(true);
  for(let i = 0; i < 120; i++) b.tick(1/60, null);
  b.group.updateWorldMatrix(true, true);
  assert.ok(angleBetween(upOf(b.spine), upOf(b.neck)) < 5,
    "watching their own arm must not take the neck off the shoulders");
});

test("the head turns relative to the shoulders rather than in an upright frame", () => {
  const b = body();
  b.group.updateWorldMatrix(true, true);
  // The head is turned and tilted, so it is NOT aligned with the spine — that
  // is the pose. What matters is that it is turned by roughly the authored
  // amount and not by the authored amount plus the lean it never inherited.
  const off = angleBetween(upOf(b.spine), upOf(b.head));
  assert.ok(off > 5 && off < 30,
    `the head should sit ${off.toFixed(1)}° off the spine — a tilt, not a dislocation`);
});

test("the neck actually reaches from the shoulders to the skull", () => {
  const b = body();
  b.group.updateWorldMatrix(true, true);
  const neckTop = b.neck.getWorldPosition(new THREE.Vector3());
  const headAt = b.head.getWorldPosition(new THREE.Vector3());
  assert.ok(neckTop.distanceTo(headAt) < 0.05,
    "a gap between the neck and the head is a floating head");
});

/* ---------- the face is on the face ----------------------------------------- */

const SKULL_A = 0.076*0.94, SKULL_B = 0.076*1.06, SKULL_C = 0.076*0.92;

/** How far a point is off the skull's surface, in metres (+ outside, − inside). */
function offSurface(pLocal){
  const r = Math.sqrt(
    (pLocal.x/SKULL_A)**2 + (pLocal.y/SKULL_B)**2 + (pLocal.z/SKULL_C)**2
  );
  // Scale the radial excess back into metres along that direction.
  const along = Math.hypot(pLocal.x, pLocal.y, pLocal.z);
  return along * (1 - 1/Math.max(1e-6, r));
}

test("every face feature sits on the skull, not in the air in front of it", () => {
  const b = body();
  b.group.updateWorldMatrix(true, true);
  Object.entries(b.features).forEach(([name, mesh])=>{
    const anchor = name === "nose" ? mesh.parent : mesh.userData.anchor;
    const p = anchor.position;
    const gap = offSurface(p);
    assert.ok(gap > 0, `${name} must sit outside the skin, not buried in it`);
    assert.ok(gap < 0.002,
      `${name} floats ${(gap*1000).toFixed(1)}mm off the skull — it must be ON the face`);
  });
});

test("a feature faces outward along the skull's own normal", () => {
  const b = body();
  b.group.updateWorldMatrix(true, true);
  ["eyeL", "eyeR", "browL", "browR", "mouth"].forEach(name=>{
    const anchor = b.features[name].userData.anchor;
    const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(anchor.quaternion).normalize();
    const p = anchor.position;
    const normal = new THREE.Vector3(
      p.x/(SKULL_A*SKULL_A), p.y/(SKULL_B*SKULL_B), p.z/(SKULL_C*SKULL_C)
    ).normalize();
    assert.ok(angleBetween(facing, normal) < 2,
      `${name} must look out along the surface it is printed on`);
  });
});

test("drawing the brow down keeps it on the face", () => {
  const b = body();
  b.setTension(1);
  b.flinch(1);
  for(let i = 0; i < 6; i++) b.tick(1/60, null);
  b.group.updateWorldMatrix(true, true);
  ["browL", "browR"].forEach(name=>{
    const gap = offSurface(b.features[name].userData.anchor.position);
    assert.ok(gap > 0 && gap < 0.002,
      `${name} came off the skull while it was being drawn in`);
  });
});

test("the hairline clears the brow at its highest, from every angle", () => {
  const b = body();
  const HAIR_R = 0.081, HAIR_SY = 1.10, HAIR_Y = 0.004;
  // phiLength is the cap's cut angle; its lowest edge is at that polar angle.
  const phi = b.hair.geometry.parameters.phiLength;
  const capBottom = HAIR_R*Math.cos(phi)*HAIR_SY + HAIR_Y;
  const browTop = Math.max(
    b.features.browL.userData.anchor.position.y,
    b.features.browR.userData.anchor.position.y
  ) + b.features.browL.geometry.parameters.height/2;
  assert.ok(capBottom > browTop,
    `the cap stops at ${(capBottom*1000).toFixed(1)}mm and the brow reaches ${(browTop*1000).toFixed(1)}mm — hair would render over the eyes`);
});

/* ---------- it still animates ------------------------------------------------ */

test("the body still breathes, tenses, winces and lets go", () => {
  const b = body();
  const chestAt = ()=>b.chest.position.y;
  const shoulderAt = ()=>b.chest.children.length ? b.spine.children[1].position.y : 0;

  const y0 = chestAt();
  for(let i = 0; i < 90; i++) b.tick(1/60, null);
  assert.notEqual(chestAt(), y0, "the chest must move — that is the breathing channel");

  b.setTension(1);
  for(let i = 0; i < 120; i++) b.tick(1/60, null);
  const tenseShoulder = shoulderAt();
  assert.ok(b.tension > 0.8, "tension must actually build");

  b.relieve();
  for(let i = 0; i < 120; i++) b.tick(1/60, null);
  assert.ok(shoulderAt() < tenseShoulder, "the shoulder drop is the payoff beat");
});

test("a headless build produces a whole person and disposes cleanly", () => {
  const b = body();
  let meshes = 0;
  b.group.traverse(o=>{ if(o.isMesh) meshes++; });
  assert.ok(meshes > 12, `expected a body, got ${meshes} meshes`);
  b.dispose();
});
