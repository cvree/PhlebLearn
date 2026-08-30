/* =========================================================================
   The real tourniquet — browser acceptance tests against the PRODUCTION build.

   The unit tests prove the rules are right. These prove the GESTURE is real:
   that ONE stroke across the arm applies a band, that carrying the strap clear
   of the skin applies a bad one, that where you cross decides the position in
   centimetres, and that pulling harder physically swells the veins.

   The gesture these drive was rebuilt: the band is grabbed anywhere along its
   length and wraps itself from a single stroke, and crossing-then-tucking is
   no longer three more failable gestures on top. Every CLINICAL assertion
   below is unchanged — position in millimetres, skew, the tension U-curve, the
   tail out of the field — because none of that was the problem. What changed
   is how much precision you have to spend to express them.

   Everything is driven in the arm's own cylindrical coordinates through
   screenPointOnLimb(), so a failure means the mechanic broke — not that the
   camera moved two pixels.
   ========================================================================= */
import { test, expect } from "@playwright/test";
import { carryOn, holdSteps, expectStepReady } from "./benchHelpers.js";

const ALLOWLISTED_WARNINGS = [
  /THREE\.Clock: This module has been deprecated/,
  /THREE\.WebGLShadowMap: PCFSoftShadowMap has been deprecated/,
  /GL Driver Message/,
  /* Properties of the MACHINE, not of the app: a sandboxed runner behind an
     outbound proxy cannot fetch the optional web font or the lobby track, and
     both are already guarded with a catch. */
  /ERR_TUNNEL_CONNECTION_FAILED/,
  /Failed to load resource: the server responded with a status of 404/,
];

function attachDiagnostics(page){
  const errors = [];
  page.on("pageerror", err=>errors.push(`pageerror: ${err.message}`));
  page.on("console", msg=>{
    if(msg.type()!=="error" && msg.type()!=="warning") return;
    const text = msg.text();
    if(ALLOWLISTED_WARNINGS.some(re=>re.test(text))) return;
    errors.push(`console.${msg.type()}: ${text}`);
  });
  return errors;
}

/** @param {"play"|"teach"} mode */
async function openTourniquet(page, mode){
  await page.goto("./?e2e=1");
  await expect(page.locator("canvas")).toBeVisible({ timeout:15000 });
  await page.waitForFunction(()=>!!window.__phlebTest, null, { timeout:15000 });
  /* Hold the draw where the seam puts it. A step ends itself a beat after
     its completing action happens, which would race every assertion below
     about whether it is finished. See tests/benchHelpers.js. */
  await holdSteps(page);
  await page.evaluate(m=>window.__phlebTest.gotoProcedureStep("tourniquet", ["lightblue","lavender"], m, "straight-antecubital"), mode||"teach");
  // NOTE: forced straight-antecubital so this arm-mesh/3D-drag suite is not
  // occasionally routed to the hand draw's controls-only, no-mesh path.
  await expect(page.locator(".tq-coach")).toBeVisible({ timeout:10000 });
  await page.waitForFunction(async ()=>{
    const p = await window.__phlebTest.screenPointOnLimb(0.089, 1.6, 0.08);
    return !!p;
  }, null, { timeout:10000 });
}

const snapshot = page=>page.evaluate(()=>window.__phlebTest.tourniquetSnapshot());
const onLimb = (page, x, theta, r)=>
  page.evaluate(a=>window.__phlebTest.screenPointOnLimb(a[0], a[1], a[2]), [x, theta, r]);
/** One round trip for a whole stroke — see screenPointsOnLimb in main.js. */
const onLimbBatch = (page, triples)=>
  page.evaluate(a=>window.__phlebTest.screenPointsOnLimb(a), triples);
const radiusAt = (page, x)=>page.evaluate(v=>window.__phlebTest.limbRadiusAt(v), x);
const strapEndScreen = (page, i)=>page.evaluate(idx=>window.__phlebTest.screenPointForStrapEnd(idx), i);
const strapEndTheta = (page, i)=>page.evaluate(idx=>window.__phlebTest.strapEndTheta(idx), i);

/**
 * ONE STROKE across the arm — the whole application gesture.
 *
 * The strap is grabbed at its MIDDLE, which the old implementation refused
 * outright (it accepted only the two tips), and drawn across the limb at the
 * chosen position. That is all: the band routes itself from there.
 *
 * @param bandX      where along the arm to cross — this becomes the position.
 * @param sweepBy    how far across to stroke, in radians of limb angle. A full
 *                   crossing is about 3; anything much less is a wiggle and
 *                   must not apply anything.
 * @param liftBy     metres to hold the strap CLEAR of the skin while carrying
 *                   it. Zero drags it against the arm, which is what passing a
 *                   band underneath means; lifting it clear is what laying one
 *                   across the top means. That contact — not the direction of
 *                   travel, which looks identical from this camera — is the
 *                   difference, and it is measured as a sustained peak.
 * @param driftAfter metres to drift ALONG the arm mid-stroke, to produce skew.
 */
async function wrapBand(page, { bandX, sweepBy, steps, driftAfter, liftBy }){
  /* Deliberately coarse. The wrap is measured by distance travelled and by
     contact with the skin, neither of which accumulates error, so it does not
     need fine sampling — and on a software renderer every extra sample is a
     real round trip to a browser drawing at 3 fps. */
  const nSteps = steps || 18;
  const r = await radiusAt(page, bandX);
  const lift = liftBy || 0;
  const half = Math.min(1.5, Math.abs(sweepBy == null ? 3.2 : sweepBy)/2.2);

  const grab = await page.evaluate(() => window.__phlebTest.screenPointOnStrap(0.5));

  const triples = [];
  for(let i = 0; i <= nSteps; i++){
    const t = i/nSteps;
    const theta = half - 2*half*t;
    /* A spiral is a spiral from the outset — drifting only in the back half
       leaves too little of it before the band commits. */
    const x = driftAfter == null ? bandX : bandX + driftAfter*t;
    triples.push([x, theta, r + lift]);
  }
  const pts = await onLimbBatch(page, triples);

  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  for(const p of pts){ await page.mouse.move(p.x, p.y); }
  await page.mouse.up();
  // the band takes ~420ms to wrap itself round the limb
  await page.waitForTimeout(650);
}

/**
 * Pulls the free end away from the arm to a tension and lets go.
 *
 * Crossing and tucking used to be two more gestures the learner had to survive
 * while holding a tension the solve could not see through sideways motion.
 * They now happen when the band is released with real tension on it — which is
 * what a hand does without thinking — so this half of the gesture is exactly
 * what it should always have been: pull, watch the veins, let go.
 *
 * @param pull    metres of pull beyond the resting radius (tension)
 * @param tuckAt  metres along the arm to draw the tail before letting go.
 *                Negative is DOWN toward the site, which is the one version of
 *                this worth grading, and leaves the tail in the field.
 * @param release false to let go with almost no tension at all
 */
async function tensionAndTuck(page, { pull, tuckAt, release }){
  const bandX = (await snapshot(page)).bandX;
  const rest = await radiusAt(page, bandX);
  const grab = await page.evaluate(() => window.__phlebTest.screenPointOnStrap(0.92));
  const draw = release === false ? 0.004 : (pull == null ? 0.048 : pull);

  const pts = [];
  for(let i = 1; i <= 8; i++) pts.push([bandX, -0.9, rest + draw*(i/8)]);
  if(tuckAt != null){
    for(let i = 1; i <= 6; i++) pts.push([bandX + tuckAt*(i/6), -0.9, rest + draw]);
  }
  const screen = await onLimbBatch(page, pts);

  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  for(const p of screen){ await page.mouse.move(p.x, p.y); await page.waitForTimeout(14); }
  await page.mouse.up();
  await page.waitForTimeout(300);
}

/**
 * Takes a secured band off by pulling its tail — the same one-handed release
 * the procedure uses later, and the in-scene way to recover from a bad
 * application without leaving the arm.
 */
async function pullBandOff(page){
  // ONE DOWNWARD YANK. Direction matters now: a sideways wobble is not a
  // removal, which is what stops an accidental brush taking the band off
  // mid-draw.
  const grab = await page.evaluate(() => window.__phlebTest.screenPointOnStrap(0.92));
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  for(let i=1;i<=10;i++) await page.mouse.move(grab.x + i*3, grab.y + i*11);
  await page.mouse.up();
  await page.waitForTimeout(250);
}

/** A complete, textbook application. */
async function applyGoodBand(page, bandX){
  const x = bandX == null ? 0.089 : bandX;
  await wrapBand(page, { bandX:x, sweepBy:3.2 });
  await tensionAndTuck(page, { pull:0.048 });
}

/* =========================================================================
   the arm exists at all
   ========================================================================= */

test("the tourniquet step opens a real arm, not a 2D panel", async ({ page })=>{
  const errors = attachDiagnostics(page);
  await openTourniquet(page, "teach");

  // the old activity is gone
  await expect(page.locator("#vpBand")).toHaveCount(0);
  await expect(page.locator(".vp-arm")).toHaveCount(0);
  await expect(page.locator(".vp-zone")).toHaveCount(0);

  const snap = await snapshot(page);
  expect(snap).not.toBeNull();
  expect(snap.phase).toBe("loose");
  expect(snap.bandX).toBeNull();
  expect(errors).toEqual([]);
});

test("the veins start flat, before any band goes on", async ({ page })=>{
  await openTourniquet(page, "teach");
  const arm = await snapshot(page);
  expect(arm).not.toBeNull();
  expect(arm.distension).toBeLessThan(0.05);
  expect(arm.armDistension).toBeLessThan(0.05);
});

/* =========================================================================
   ROUTING — direction and position
   ========================================================================= */

test("dragging an end under the arm applies the band; the position is where you crossed", async ({ page })=>{
  const errors = attachDiagnostics(page);
  await openTourniquet(page, "teach");

  await wrapBand(page, { bandX:0.089, sweepBy:3.2 });

  const snap = await snapshot(page);
  expect(snap.phase).toBe("routed");
  expect(snap.wrap).toBe("under");
  // the band is where the gesture crossed the arm, in metres — 3.5 inches
  expect(snap.bandX).toBeGreaterThan(0.070);
  expect(snap.bandX).toBeLessThan(0.110);
  expect(snap.attempts).toBe(1);
  expect(errors).toEqual([]);
});

/* A DELIBERATE CHANGE, and the honest version of it.

   The old gesture graded route direction by how far the hand strayed outside
   the arm's silhouette, which the across-the-bench camera showed clearly. The
   seated camera looks ALONG the limb and simply cannot see height above it: a
   hand 42 mm above the fossa projects onto the same pixels as one resting on
   the skin four centimetres further up. Three separate measurements were tried
   against a live scene and all three read zero — see the long note in
   tourniquetRuntime.js.

   So the stroke now always threads the band, exactly as the tuck now ties
   itself, and for the same reason the brief gives for the tuck: it was never a
   skill. The RULE is untouched, still blocks, and is still graded — which this
   test asserts through the path that can still produce it. */
test("a badly routed band is still a blocking error, and still graded", async ({ page })=>{
  await openTourniquet(page, "teach");
  await page.evaluate(async ()=>{
    const rt = await import("./venipuncture/tourniquet/tourniquetRuntime.js");
    rt.applyBandProgrammatically({ bandX: 0.089, wrap: "over", skew: 0, tension: 0.55 });
  }).catch(async ()=>{
    // the production bundle does not expose module paths; drive it the way the
    // accessible controls do instead
    await page.evaluate(()=>window.__phlebTest.applyBandOver && window.__phlebTest.applyBandOver());
  });

  const snap = await snapshot(page);
  expect(snap.wrap).toBe("over");
  expect(snap.issues).toContain("wrappedOver");
  expect(snap.ready).toBe(false);
});

test("a stroke across the arm always threads the band under it", async ({ page })=>{
  await openTourniquet(page, "teach");
  // The acceptance criterion the brief actually asks for: one natural drag
  // produces a correctly wrapped, flat-seated band.
  await wrapBand(page, { bandX:0.089, sweepBy:3.2 });

  const snap = await snapshot(page);
  expect(snap.phase).toBe("routed");
  expect(snap.wrap).toBe("under");
  expect(snap.issues).not.toContain("wrappedOver");
});

test("crossing too close to the site produces a band that is blocked for being too low", async ({ page })=>{
  await openTourniquet(page, "teach");
  await applyGoodBand(page, 0.030);

  const snap = await snapshot(page);
  expect(snap.heightAboveSite).toBeLessThan(0.055);
  // "too low" or, if it landed nearer still, "on the site" — both block, and
  // which one fires depends on the randomised patient's build
  expect(snap.blocking.some(c=>c === "bandTooLow" || c === "bandOnSite")).toBe(true);
  expect(snap.ready).toBe(false);
});

test("crossing high on the upper arm warns rather than blocks", async ({ page })=>{
  await openTourniquet(page, "teach");
  await applyGoodBand(page, 0.150);

  const snap = await snapshot(page);
  expect(snap.heightAboveSite).toBeGreaterThan(0.125);
  expect(snap.issues).toContain("bandTooHigh");
  expect(snap.blocking).not.toContain("bandTooHigh");
});

test("a wrap that spirals along the arm is measured as skew", async ({ page })=>{
  await openTourniquet(page, "teach");
  await wrapBand(page, { bandX:0.089, sweepBy:3.2, driftAfter:0.105 });

  const snap = await snapshot(page);
  expect(snap.skew).toBeGreaterThan(0.02);
  expect(snap.issues.some(c=>c === "bandSkewed" || c === "bandTwisted")).toBe(true);
});

test("a half-hearted sweep does not apply anything", async ({ page })=>{
  await openTourniquet(page, "teach");
  await wrapBand(page, { bandX:0.089, sweepBy:0.5 });

  const snap = await snapshot(page);
  expect(snap.phase).toBe("loose");
  expect(snap.bandX).toBeNull();
});

/* =========================================================================
   TENSION — the veins respond, and overshoot is punished
   ========================================================================= */

test("pulling the band tighter physically swells the veins", async ({ page })=>{
  await openTourniquet(page, "teach");
  await wrapBand(page, { bandX:0.089, sweepBy:3.2 });

  const flat = await snapshot(page);
  expect(flat.distension).toBeLessThan(0.05);

  await tensionAndTuck(page, { pull:0.048 });

  const filled = await snapshot(page);
  expect(filled.distension).toBeGreaterThan(0.6);
  // and the vein MESHES actually changed, not just the number
  expect(filled.armDistension).toBeGreaterThan(0.6);
});

test("a band that is barely snug leaves the veins flat and is blocked", async ({ page })=>{
  await openTourniquet(page, "teach");
  await wrapBand(page, { bandX:0.089, sweepBy:3.2 });
  await tensionAndTuck(page, { pull:0.010 });

  const snap = await snapshot(page);
  expect(snap.blocking).toContain("tooLoose");
  expect(snap.distension).toBeLessThan(0.2);
  expect(snap.ready).toBe(false);
});

test("over-tightening kills the radial pulse and collapses the veins again", async ({ page })=>{
  await openTourniquet(page, "teach");
  await wrapBand(page, { bandX:0.089, sweepBy:3.2 });
  await tensionAndTuck(page, { pull:0.090 });

  const snap = await snapshot(page);
  expect(snap.heldTension).toBeGreaterThan(0.8);
  expect(snap.pulse).toBe(false);
  expect(snap.blocking).toContain("tooTight");
  // the U-shape: crushing it does not fill the veins better
  expect(snap.distension).toBeLessThan(0.5);
});

/* =========================================================================
   THE TUCK — and the consequence of not doing it
   ========================================================================= */

/* A DELIBERATE CHANGE, and worth stating plainly. Letting go without enough
   pull used to make the band spring off the arm entirely and cost a restart.
   That punished a light hand for something with no clinical consequence — the
   band had not hurt anyone, it simply was not doing its job — and it meant a
   learner who was reading the veins carefully lost the whole application. The
   band now stays on and stays useless, and the flat veins say so. */
test("a band pulled but not held stays on the arm, doing nothing", async ({ page })=>{
  await openTourniquet(page, "teach");
  await wrapBand(page, { bandX:0.089, sweepBy:3.2 });
  await tensionAndTuck(page, { release:false });

  const snap = await snapshot(page);
  expect(snap.bandX, "the band is still on the arm").not.toBeNull();
  expect(snap.phase).not.toBe("secured");
  expect(snap.distension, "and the veins are flat, which is the feedback").toBeLessThan(0.2);
  expect(snap.ready).toBe(false);
});

test("holding the tension sets the band, tail up-arm, field clear", async ({ page })=>{
  const errors = attachDiagnostics(page);
  await openTourniquet(page, "teach");
  await applyGoodBand(page);

  const snap = await snapshot(page);
  expect(snap.phase).toBe("secured");
  expect(snap.tuckedUnder).toBe(true);
  expect(snap.tuck).toBe("proximal");
  expect(snap.ready).toBe(true);
  expect(snap.blocking).toEqual([]);
  expect(errors).toEqual([]);
});

test("drawing the tail DOWN toward the site leaves it in the field and is blocked", async ({ page })=>{
  await openTourniquet(page, "teach");
  await wrapBand(page, { bandX:0.089, sweepBy:3.2 });
  // the one version of the tuck still worth grading: actively dragging the
  // tail over the skin you are about to clean and puncture
  await tensionAndTuck(page, { pull:0.048, tuckAt:-0.048 });

  const snap = await snapshot(page);
  expect(snap.phase).toBe("secured");
  expect(snap.tuck).toBe("distal");
  expect(snap.blocking).toContain("tailInField");
  expect(snap.ready).toBe(false);
});

/* =========================================================================
   IT STAYS ON — the point of the whole branch
   ========================================================================= */

test("teaching mode will not start the draw on a bad band, and will on a good one", async ({ page })=>{
  // two full applications, each a real drag through the browser
  test.setTimeout(90000);
  await openTourniquet(page, "teach");

  await wrapBand(page, { bandX:0.089, sweepBy:3.2 });
  await tensionAndTuck(page, { pull:0.090 });   // too tight
  await expectStepReady(page, false);

  // pull it off by the tail and do it properly — error recovery on the arm
  // itself, without leaving the patient
  await pullBandOff(page);
  expect((await snapshot(page)).phase).toBe("loose");

  await applyGoodBand(page);
  await expectStepReady(page, true);
});

test("a scored shift lets the learner commit to a bad band and carries it forward", async ({ page })=>{
  await openTourniquet(page, "play");
  await wrapBand(page, { bandX:0.030, sweepBy:3.2 });
  await tensionAndTuck(page, { pull:0.048 });

  await expect(page.locator("#tqReady")).toBeEnabled();

  // The band is clinically unacceptable — far too close to the site — and the
  // learner is allowed to proceed anyway. Asserted on the measured height
  // rather than on which issue code fires: the patient's build is randomised
  // per run, so a band aimed just under the limit can land either side of the
  // boundary between "too low" and "on the site itself", and both are blocks.
  const before = await snapshot(page);
  expect(before.heightAboveSite).toBeLessThan(0.064);
  expect(before.blocking.length).toBeGreaterThan(0);

  await carryOn(page);
  await page.waitForTimeout(400);

  // the draw moved on, and the band went with it — still on, still wrong
  const after = await snapshot(page);
  expect(after.phase).toBe("secured");
  expect(after.blocking.length).toBeGreaterThan(0);
  await expect(page.locator(".tq-coach")).toHaveCount(0);
});

test("the band survives leaving the step — it is the same strap, still on the arm", async ({ page })=>{
  await openTourniquet(page, "teach");
  await applyGoodBand(page);

  const before = await snapshot(page);
  expect(before.phase).toBe("secured");

  // advance into the next step, then read the encounter's strap again.
  // tourniquetSnapshot reads ENC.collect.tourniquet, which is deliberately
  // NOT torn down when the step's scene is disposed.
  await carryOn(page);
  await page.waitForTimeout(400);

  const stillOn = await snapshot(page);
  expect(stillOn.phase).toBe("secured");
  expect(stillOn.bandX).toBeCloseTo(before.bandX, 3);
  expect(stillOn.seconds).toBeGreaterThanOrEqual(before.seconds);
});

/* =========================================================================
   the accessible path writes the same state
   ========================================================================= */

test("the controls path produces the same measurements as the drag", async ({ page })=>{
  await openTourniquet(page, "teach");
  await page.locator("#tqView").click();
  await expect(page.locator(".tq-controls")).toBeVisible();

  await page.selectOption("#tqHeight", "0.089");
  await page.selectOption("#tqWrap", "under");
  await page.selectOption("#tqTension", "0.56");
  await page.selectOption("#tqTuck", "proximal");
  await page.locator("#tqApply").click();
  await page.waitForTimeout(200);

  const snap = await snapshot(page);
  expect(snap.phase).toBe("secured");
  expect(snap.wrap).toBe("under");
  expect(snap.tuck).toBe("proximal");
  expect(snap.ready).toBe(true);
  expect(snap.distension).toBeGreaterThan(0.6);
  await expectStepReady(page, true);
});

test("the controls path can produce a wrong band too — it is not an easier game", async ({ page })=>{
  await openTourniquet(page, "teach");
  await page.locator("#tqView").click();
  await page.selectOption("#tqHeight", "0.038");
  await page.selectOption("#tqTension", "0.90");
  await page.selectOption("#tqTuck", "distal");
  await page.locator("#tqApply").click();
  await page.waitForTimeout(200);

  const snap = await snapshot(page);
  expect(snap.blocking.length).toBeGreaterThan(0);
  expect(snap.ready).toBe(false);
  await expectStepReady(page, false);
});

test("nudging the band moves it in real centimetres without re-applying", async ({ page })=>{
  await openTourniquet(page, "teach");
  await page.locator("#tqView").click();
  await page.locator("#tqApply").click();
  await page.waitForTimeout(150);

  const before = await snapshot(page);
  await page.locator("#tqUp").click();
  await page.waitForTimeout(120);
  const after = await snapshot(page);

  expect(after.bandX).toBeGreaterThan(before.bandX);
  expect(after.attempts).toBe(before.attempts);   // not a new application
});

/* =========================================================================
   touch
   ========================================================================= */

test("the wrap works with a finger, not just a mouse", async ({ page })=>{
  await page.setViewportSize({ width:414, height:896 });
  await openTourniquet(page, "teach");

  const rest = await radiusAt(page, 0.089);
  // grabbed anywhere along the strap, exactly as a thumb would
  const grab = await page.evaluate(()=>window.__phlebTest.screenPointOnStrap(0.5));
  const steps = 40;
  const triples = [];
  const half = 1.45;
  for(let i=0;i<=steps;i++) triples.push([0.089, half - 2*half*(i/steps), rest]);
  const path = [grab].concat(await onLimbBatch(page, triples));

  await page.evaluate(pts=>{
    const canvas = document.querySelector("canvas");
    const send = (type, p, buttons)=>canvas.dispatchEvent(new PointerEvent(type, {
      pointerId: 9, pointerType: "touch", isPrimary: true, bubbles: true, cancelable: true,
      clientX: p.x, clientY: p.y, buttons,
    }));
    send("pointerdown", pts[0], 1);
    for(let i=1;i<pts.length;i++) send("pointermove", pts[i], 1);
    send("pointerup", pts[pts.length-1], 0);
  }, path);
  // the band takes ~420ms to wrap itself round the limb
  await page.waitForTimeout(700);

  const snap = await snapshot(page);
  expect(snap.phase).toBe("routed");
  expect(snap.wrap).toBe("under");
});
