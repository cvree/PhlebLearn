/* =========================================================================
   The real tourniquet — browser acceptance tests against the PRODUCTION build.

   The unit tests prove the rules are right. These prove the GESTURE is real:
   that dragging an end round the underside of the arm applies a band, that
   dragging it over the top applies a bad one, that where you cross decides the
   position in centimetres, that pulling harder physically swells the veins,
   and that letting go before the tuck drops the band on the floor.

   Everything is driven in the arm's own cylindrical coordinates through
   screenPointOnLimb(), so a failure means the mechanic broke — not that the
   camera moved two pixels.
   ========================================================================= */
import { test, expect } from "@playwright/test";

const ALLOWLISTED_WARNINGS = [
  /THREE\.Clock: This module has been deprecated/,
  /THREE\.WebGLShadowMap: PCFSoftShadowMap has been deprecated/,
  /GL Driver Message/,
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
 * Drags an end of the strap round the limb, in the limb's own coordinates.
 *
 * The strap starts coiled loosely on the bench, not resting on the arm's
 * cylinder, so the drag has to begin from wherever it actually renders (via
 * screenPointForStrapEnd) and sweep CONTINUOUSLY from there — jumping to an
 * arbitrary absolute angle on the first move mimics a gesture no real pointer
 * could make.
 *
 * @param sweepBy  radians to carry the end round the limb.
 * @param liftBy   metres to hold the end CLEAR of the skin while carrying it.
 *                 Zero keeps it against the arm, which is what passing a band
 *                 underneath means; lifting it clear is what laying one across
 *                 the top means. That contact — not the direction of travel,
 *                 which looks identical from this camera — is the difference.
 * @param bandX    where along the arm to cross — this becomes the position.
 */
async function wrapBand(page, { bandX, sweepBy, steps, driftAfter, liftBy }){
  // Enough samples to look like a continuous drag. The wrap is measured by
  // distance travelled and contact with the skin, neither of which accumulates
  // error, so this does not need to be fine — and every sample is a real
  // round trip to the browser.
  const nSteps = steps || 45;
  const r = await radiusAt(page, bandX);
  const lift = liftBy || 0;

  const grab = await strapEndScreen(page, 0);
  const startTheta = await strapEndTheta(page, 0);

  const triples = [];
  for(let i=1;i<=nSteps;i++){
    const t = i/nSteps;
    // driftAfter lets a test wrap crookedly once real wrapping has begun, to
    // exercise the skew measurement.
    const x = driftAfter == null || Math.abs(sweepBy)*t < 0.35 ? bandX : bandX + driftAfter;
    triples.push([x, startTheta + sweepBy*t, r + lift]);
  }
  const pts = await onLimbBatch(page, triples);

  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  for(const p of pts) await page.mouse.move(p.x, p.y);
  await page.mouse.up();
  await page.waitForTimeout(120);
}

/**
 * Pulls the free end out to a tension, carries it across, and tucks it — the
 * continuous second half of the gesture, done without releasing the button.
 * Crossing and tucking are measured by which SIDE of the arm the end is on
 * and how far it has been pulled, not by tracking an absolute angle, so
 * (unlike wrapBand) the move targets don't need to be continuous with the
 * grab point — only the grab itself has to land on the real mesh.
 *
 * @param pull    metres of pull beyond the resting radius (tension)
 * @param tuckAt  metres along the arm from the band to push the loop; positive
 *                is proximal (correct), negative is into the field (wrong)
 * @param release whether to finish the gesture or let go early
 */
async function tensionAndTuck(page, { pull, tuckAt, release }){
  // Where the band ACTUALLY ended up, not where the wrap aimed for. The
  // runtime measures the pull against the real band position, so driving this
  // half of the gesture at the intended one reads as a much harder pull than
  // it was and saturates the tension.
  const bandX = (await snapshot(page)).bandX;
  const rest = await radiusAt(page, bandX);
  // Pull outward from where the free end ACTUALLY lies. Starting the pull on
  // the far side of the limb from the end being held makes the very first move
  // register as the cross, freezing the tension at whatever the first sample
  // happened to be — the ends get crossed before they were ever tightened.
  const startTheta = await strapEndTheta(page, 1);

  const grab = await strapEndScreen(page, 1);

  // 1 — pull the end away from the arm
  const pullPts = [];
  for(let i=1;i<=10;i++) pullPts.push([bandX, startTheta, rest + pull*(i/10)]);
  // 2 — carry it over to the other side of the arm, keeping the tension
  for(let i=1;i<=12;i++) pullPts.push([bandX, startTheta + Math.PI*(i/12), rest + pull]);
  // 3 — push a loop back under the band, offset along the arm
  const tuckPts = [];
  if(release !== false){
    for(let i=1;i<=10;i++){
      const t = i/10;
      tuckPts.push([bandX + tuckAt*t, startTheta + Math.PI, rest + pull*(1-t) - 0.004*t]);
    }
  }
  const pts = await onLimbBatch(page, pullPts.concat(tuckPts));

  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  for(const p of pts) await page.mouse.move(p.x, p.y);
  await page.mouse.up();
  await page.waitForTimeout(release === false ? 200 : 250);
}

/**
 * Takes a secured band off by pulling its tail — the same one-handed release
 * the procedure uses later, and the in-scene way to recover from a bad
 * application without leaving the arm.
 */
async function pullBandOff(page){
  const grab = await strapEndScreen(page, 1);
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  for(let i=1;i<=8;i++) await page.mouse.move(grab.x + i*12, grab.y + i*6);
  await page.mouse.up();
  await page.waitForTimeout(200);
}

/** A complete, textbook application. */
async function applyGoodBand(page, bandX){
  const x = bandX == null ? 0.089 : bandX;
  await wrapBand(page, { bandX:x, sweepBy:3.9 });
  await tensionAndTuck(page, { pull:0.048, tuckAt:0.030 });
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

  await wrapBand(page, { bandX:0.089, sweepBy:3.9 });

  const snap = await snapshot(page);
  expect(snap.phase).toBe("routed");
  expect(snap.wrap).toBe("under");
  // the band is where the gesture crossed the arm, in metres — 3.5 inches
  expect(snap.bandX).toBeGreaterThan(0.070);
  expect(snap.bandX).toBeLessThan(0.110);
  expect(snap.attempts).toBe(1);
  expect(errors).toEqual([]);
});

test("dragging it over the top of the arm is a different, wrong application", async ({ page })=>{
  await openTourniquet(page, "teach");
  // carried clear of the skin the whole way — draped across the arm, not
  // passed underneath it
  await wrapBand(page, { bandX:0.089, sweepBy:3.9, liftBy:0.030 });

  const snap = await snapshot(page);
  expect(snap.phase).toBe("routed");
  expect(snap.wrap).toBe("over");
  expect(snap.issues).toContain("wrappedOver");
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
  await wrapBand(page, { bandX:0.089, sweepBy:3.9, driftAfter:0.061 });

  const snap = await snapshot(page);
  expect(snap.skew).toBeGreaterThan(0.02);
  expect(snap.issues.some(c=>c === "bandSkewed" || c === "bandTwisted")).toBe(true);
});

test("a half-hearted sweep does not apply anything", async ({ page })=>{
  await openTourniquet(page, "teach");
  await wrapBand(page, { bandX:0.089, sweepBy:1.2 });

  const snap = await snapshot(page);
  expect(snap.phase).toBe("loose");
  expect(snap.bandX).toBeNull();
});

/* =========================================================================
   TENSION — the veins respond, and overshoot is punished
   ========================================================================= */

test("pulling the band tighter physically swells the veins", async ({ page })=>{
  await openTourniquet(page, "teach");
  await wrapBand(page, { bandX:0.089, sweepBy:3.9 });

  const flat = await snapshot(page);
  expect(flat.distension).toBeLessThan(0.05);

  await tensionAndTuck(page, { pull:0.048, tuckAt:0.030 });

  const filled = await snapshot(page);
  expect(filled.distension).toBeGreaterThan(0.6);
  // and the vein MESHES actually changed, not just the number
  expect(filled.armDistension).toBeGreaterThan(0.6);
});

test("a band that is barely snug leaves the veins flat and is blocked", async ({ page })=>{
  await openTourniquet(page, "teach");
  await wrapBand(page, { bandX:0.089, sweepBy:3.9 });
  await tensionAndTuck(page, { pull:0.012, tuckAt:0.030 });

  const snap = await snapshot(page);
  expect(snap.blocking).toContain("tooLoose");
  expect(snap.distension).toBeLessThan(0.2);
  expect(snap.ready).toBe(false);
});

test("over-tightening kills the radial pulse and collapses the veins again", async ({ page })=>{
  await openTourniquet(page, "teach");
  await wrapBand(page, { bandX:0.089, sweepBy:3.9 });
  await tensionAndTuck(page, { pull:0.090, tuckAt:0.030 });

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

test("letting go before the tuck drops the band and costs a restart", async ({ page })=>{
  await openTourniquet(page, "teach");
  await wrapBand(page, { bandX:0.089, sweepBy:3.9 });
  await tensionAndTuck(page, { pull:0.048, release:false });

  const snap = await snapshot(page);
  expect(snap.phase).toBe("loose");
  expect(snap.bandX).toBeNull();
  expect(snap.restarts).toBe(1);
});

test("tucking the loop up the arm secures it and clears the field", async ({ page })=>{
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

test("tucking the loop toward the site leaves the tail in the field and is blocked", async ({ page })=>{
  await openTourniquet(page, "teach");
  await wrapBand(page, { bandX:0.089, sweepBy:3.9 });
  await tensionAndTuck(page, { pull:0.048, tuckAt:-0.030 });

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
  const ready = page.locator("#tqReady");

  await wrapBand(page, { bandX:0.089, sweepBy:3.9 });
  await tensionAndTuck(page, { pull:0.090, tuckAt:0.030 });   // too tight
  await expect(ready).toBeDisabled();

  // pull it off by the tail and do it properly — error recovery on the arm
  // itself, without leaving the patient
  await pullBandOff(page);
  expect((await snapshot(page)).phase).toBe("loose");

  await applyGoodBand(page);
  await expect(ready).toBeEnabled();
});

test("a scored shift lets the learner commit to a bad band and carries it forward", async ({ page })=>{
  await openTourniquet(page, "play");
  await wrapBand(page, { bandX:0.030, sweepBy:3.9 });
  await tensionAndTuck(page, { pull:0.048, tuckAt:0.030 });

  const ready = page.locator("#tqReady");
  await expect(ready).toBeEnabled();

  // The band is clinically unacceptable — far too close to the site — and the
  // learner is allowed to proceed anyway. Asserted on the measured height
  // rather than on which issue code fires: the patient's build is randomised
  // per run, so a band aimed just under the limit can land either side of the
  // boundary between "too low" and "on the site itself", and both are blocks.
  const before = await snapshot(page);
  expect(before.heightAboveSite).toBeLessThan(0.064);
  expect(before.blocking.length).toBeGreaterThan(0);

  await ready.click();
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
  await page.locator("#tqReady").click();
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
  await expect(page.locator("#tqReady")).toBeEnabled();
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
  await expect(page.locator("#tqReady")).toBeDisabled();
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
  const grab = await strapEndScreen(page, 0);
  const startTheta = await strapEndTheta(page, 0);
  const steps = 90;
  const triples = [];
  for(let i=1;i<=steps;i++) triples.push([0.089, startTheta + 3.9*(i/steps), rest]);
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
  await page.waitForTimeout(200);

  const snap = await snapshot(page);
  expect(snap.phase).toBe("routed");
  expect(snap.wrap).toBe("under");
});
