/* =========================================================================
   HANDEDNESS — the test the brief specifically asked for.

   Handedness is a Z mirror on the bench's scene root. A mirror has a NEGATIVE
   determinant, and the redesign brief flagged the exact hazard: "a negative
   determinant flips theta's sign convention and would silently invert wrap
   direction. The sign must be taken from the mirrored basis, not assumed."

   That is precisely why pointerToLimb SOLVES a 2x2 system built from projected
   basis vectors instead of assuming which way round the arm goes. This file
   asserts the property rather than trusting the reasoning: the same 2x2 solve,
   run against a mirrored basis, must recover the same angle.

   Pure maths, no browser. The solve is reproduced here in the same form
   armScene.js uses it, because what is being tested is the ALGEBRA — that
   solving is mirror-safe where assuming is not.
   ========================================================================= */
import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * armScene.js's solve, verbatim in shape.
 *
 * A point at angle t and distance p from the limb's axis projects to
 *     D = (p/r)·cos(t)·A + (p/r)·sin(t)·B
 * where A is the screen offset of a step straight UP the limb and B the offset
 * of a step TOWARD the operator. Recovering the two coefficients recovers cos
 * and sin separately, hence the true angle and the true distance.
 */
function solve(A, B, D, r){
  const det = A[0]*B[1] - A[1]*B[0];
  if(Math.abs(det) < 1e-9) return null;
  const c = (D[0]*B[1] - D[1]*B[0])/det;
  const s = (A[0]*D[1] - A[1]*D[0])/det;
  return { theta: Math.atan2(s, c), rho: Math.hypot(c, s)*r, det };
}

/** Forward projection of a limb point, for whichever basis it is given. */
function project(A, B, theta, rho, r){
  const k = rho/r;
  return [k*Math.cos(theta)*A[0] + k*Math.sin(theta)*B[0],
          k*Math.cos(theta)*A[1] + k*Math.sin(theta)*B[1]];
}

/* The real seated-operator basis, from PITCH 0.56 / SWING 0.96 — the numbers
   armScene.js actually ships. A is a step up the limb, B a step toward the
   operator, both in screen pixels with +y downward. */
const A = [0.000, -0.847];
const B = [0.574,  0.435];
/** The same bench with the root mirrored in Z: B is the one that flips. */
const A_MIRROR = [0.000, -0.847];
const B_MIRROR = [-0.574, 0.435];

const R = 0.043;

test("the seated framing is well-conditioned — the ellipse has real area", () => {
  const det = A[0]*B[1] - A[1]*B[0];
  // The acceptance criterion in the brief is |det| > 1e-3. This clears it by
  // three orders of magnitude, and the basis vectors are 53 degrees apart.
  assert.ok(Math.abs(det) > 1e-3, `|det| = ${Math.abs(det)}`);
  const cosAngle = Math.abs(det)/(Math.hypot(...A)*Math.hypot(...B));
  assert.ok(cosAngle > 0.6, `basis vectors too close to parallel: ${cosAngle}`);
});

test("mirroring flips the determinant's sign — which is the hazard", () => {
  const det = A[0]*B[1] - A[1]*B[0];
  const detM = A_MIRROR[0]*B_MIRROR[1] - A_MIRROR[1]*B_MIRROR[0];
  assert.ok(det*detM < 0, "a mirror must invert the determinant, or this test proves nothing");
  assert.ok(Math.abs(detM) > 1e-3, "and the mirrored basis must stay well-conditioned");
});

test("the solve recovers the SAME angle on a mirrored bench", () => {
  // every 15 degrees round the limb, at three distances from its axis
  for(let deg = -180; deg < 180; deg += 15){
    const theta = deg*Math.PI/180;
    for(const rho of [R*0.4, R, R*1.6]){
      const right = solve(A, B, project(A, B, theta, rho, R), R);
      const left  = solve(A_MIRROR, B_MIRROR, project(A_MIRROR, B_MIRROR, theta, rho, R), R);
      assert.ok(right && left, "both benches must be solvable");
      // angles wrap, so compare the shortest signed step between them
      let d = right.theta - left.theta;
      while(d > Math.PI) d -= 2*Math.PI;
      while(d < -Math.PI) d += 2*Math.PI;
      assert.ok(Math.abs(d) < 1e-9,
        `theta differs at ${deg}deg, rho ${rho}: right ${right.theta} vs left ${left.theta}`);
      assert.ok(Math.abs(right.rho - left.rho) < 1e-12, "and rho must match too");
    }
  }
});

test("wrap direction survives the mirror: the sign of theta is not assumed", () => {
  // A band taken UNDER the arm sweeps through the far half; one laid OVER the
  // top stays in the near half. Both benches must agree on which is which.
  const under = [-2.6, -3.0, 3.0, 2.6];      // radians, passing behind
  const over  = [-0.4,  0.0, 0.4];           // radians, across the top

  const halfOf = (basisA, basisB, theta) => {
    const r = solve(basisA, basisB, project(basisA, basisB, theta, R, R), R);
    return Math.abs(r.theta) > Math.PI/2 ? "far" : "near";
  };
  for(const t of under){
    assert.equal(halfOf(A, B, t), "far");
    assert.equal(halfOf(A_MIRROR, B_MIRROR, t), "far", `mirror disagreed at ${t}`);
  }
  for(const t of over){
    assert.equal(halfOf(A, B, t), "near");
    assert.equal(halfOf(A_MIRROR, B_MIRROR, t), "near", `mirror disagreed at ${t}`);
  }
});

test("assuming the sign instead of solving it WOULD have inverted the wrap", () => {
  /* The bug this file exists to prevent, demonstrated. A reasonable-looking
     shortcut is to read the angle straight off the screen offset's own
     direction rather than solving for it. That works on a right-handed bench
     and silently inverts on a left-handed one — a left-handed learner would
     have been told they took the band over the top every time they took it
     under. */
  const assumed = (basisB, theta) => {
    const D = project(A, basisB, theta, R, R);
    return Math.atan2(D[0], -D[1]);         // "just use the offset's direction"
  };
  const t = 2.2;
  const right = assumed(B, t);
  const left = assumed(B_MIRROR, t);
  assert.ok(Math.sign(right) !== Math.sign(left),
    "the shortcut should invert under a mirror — that is the whole point");

  // and the real solve does not
  const rSolved = solve(A, B, project(A, B, t, R, R), R).theta;
  const lSolved = solve(A_MIRROR, B_MIRROR, project(A_MIRROR, B_MIRROR, t, R, R), R).theta;
  assert.ok(Math.abs(rSolved - lSolved) < 1e-9);
});
