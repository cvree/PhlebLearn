/* =========================================================================
   Pressure and bandage — browser acceptance tests against the PRODUCTION build.

   The unit tests prove the rules; these prove the steps are real: that the
   force is a thing the pointer actually applies by pressing INTO the arm
   rather than a hold timer, that a light pad genuinely fails, that a bent
   elbow stops the clot, that the site is checked by lifting the gauze and
   looking, and that the dressing's alignment and tightness come out of the
   gesture that put it on.
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
    const t = msg.text();
    if(ALLOWLISTED_WARNINGS.some(re=>re.test(t))) return;
    errors.push(`console.${msg.type()}: ${t}`);
  });
  return errors;
}

const TUBES = ["lightblue","lavender"];

async function open(page, mode, step){
  await page.goto("./?e2e=1");
  await expect(page.locator("canvas")).toBeVisible({ timeout:15000 });
  await page.waitForFunction(()=>!!window.__phlebTest, null, { timeout:15000 });
  await page.evaluate(([s, t, m])=>window.__phlebTest.gotoProcedureStep(s, t, m),
    [step || "pressure", TUBES, mode || "teach"]);
  await expect(page.locator(".asm-coach")).toBeVisible({ timeout:10000 });
  await page.waitForFunction(async ()=>!!(await window.__phlebTest.postDrawAnchors()), null, { timeout:10000 });
  await settle(page);
}

/**
 * Waits for the camera to stop moving.
 *
 * fitCamera re-frames on the first rendered frame and every 30 after it, so
 * anchors read the instant the scene appears are projected against a camera
 * that is about to move — and two such reads agree with each other, so
 * stability alone is not enough. Requiring frames to have actually rendered
 * first is what makes this real. A press aimed with stale anchors lands off the
 * puncture, which is a failure of the test rather than of the mechanic.
 */
async function settle(page){
  await page.evaluate(()=>{ delete window.__pdPrevAnchor; });
  await page.waitForFunction(async ()=>{
    const a = await window.__phlebTest.postDrawAnchors();
    if(!a || a.frame < 4) return false;
    const prev = window.__pdPrevAnchor;
    window.__pdPrevAnchor = a.site;
    return !!prev && Math.hypot(prev.x - a.site.x, prev.y - a.site.y) < 0.5;
  }, null, { timeout: 15000 });
}

const snapshot = page=>page.evaluate(()=>window.__phlebTest.postDrawSnapshot());
const anchors = page=>page.evaluate(()=>window.__phlebTest.postDrawAnchors());
const fastForward = (page, s)=>page.evaluate(x=>window.__phlebTest.fastForwardPressure(x), s);

/**
 * Presses the pad into the arm. `depth` is the fraction of the way from the
 * skin toward the limb's axis — which is exactly what the runtime reads as
 * force — so 0 is resting on the surface and 1 is as hard as it goes.
 */
async function pressInto(page, depth, o){
  const opt = o || {};
  const a = await anchors(page);
  const alongMm = opt.offsetMm || 0;
  const from = {
    x: a.site.x + a.alongPx.dx*alongMm/10,
    y: a.site.y + a.alongPx.dy*alongMm/10,
  };
  // the axis point is 1.0 of the way in; scale by fullPressAt so `depth` of 1
  // corresponds to the runtime's own full-force distance
  const target = {
    x: from.x + (a.axisUnderSite.x - a.site.x)*depth*a.fullPressAt,
    y: from.y + (a.axisUnderSite.y - a.site.y)*depth*a.fullPressAt,
  };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 12 });
  return target;
}

/** Presses in, holds while the clock is fast-forwarded, then lets go. */
async function pressHoldRelease(page, depth, seconds, o){
  await pressInto(page, depth, o);
  await fastForward(page, seconds == null ? 40 : seconds);
  await page.mouse.up();
  await page.waitForTimeout(150);
}

/* ---------- the step is real ------------------------------------------------------ */

test("pressure is a real force on a real arm, not a hold-to-fill button", async ({ page })=>{
  const errors = attachDiagnostics(page);
  await open(page, "teach", "pressure");
  // the old 2D screen is gone
  await expect(page.locator("#vpPress")).toHaveCount(0);
  await expect(page.locator(".vp-pressgauze")).toHaveCount(0);
  await expect(page.locator("#vpPBar")).toHaveCount(0);

  const snap = await snapshot(page);
  expect(snap.pressureStarted).toBe(false);
  expect(snap.haemostatic).toBe(false);
  expect(snap.requiredForce).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test("the site inherits the puncture the insert step made and starts bleeding", async ({ page })=>{
  await open(page, "teach", "pressure");
  // left alone, the puncture leaks into the tissue — the arm does not wait
  await fastForward(page, 6);
  const snap = await snapshot(page);
  expect(snap.extravasatedMl).toBeGreaterThan(0);
});

/* ---------- force ----------------------------------------------------------------- */

test("pressing further into the arm reads as more force", async ({ page })=>{
  const errors = attachDiagnostics(page);
  await open(page, "teach", "pressure");
  await pressInto(page, 0.25);
  const light = await snapshot(page);
  await page.mouse.up();

  await pressInto(page, 0.95);
  const firm = await snapshot(page);
  await page.mouse.up();

  expect(firm.force).toBeGreaterThan(light.force);
  expect(errors).toEqual([]);
});

test("a pad rested on lightly never stops the bleeding, however long it is held", async ({ page })=>{
  await open(page, "teach", "pressure");
  // deliberately under the adequacy band
  await pressInto(page, 0.15);
  const live = await snapshot(page);
  expect(live.force).toBeGreaterThan(0);
  expect(live.force).toBeLessThan(live.requiredForce);
  // the coach names it WHILE it is happening — that is the point of a coach
  expect(live.issues).toContain("tooLight");

  await fastForward(page, 60);
  const held = await snapshot(page);
  expect(held.clotProgress).toBe(0);
  expect(held.effectiveSeconds).toBe(0);
  expect(held.haemostatic).toBe(false);
  expect(held.extravasatedMl).toBeGreaterThan(0);

  await page.mouse.up();
  await page.waitForTimeout(150);
  const after = await snapshot(page);
  expect(after.haemostatic).toBe(false);
  expect(after.bleedingAtCheck).toBe(true);
  expect(after.hematomaGrade).not.toBe("none");
});

test("firm pressure held through the requirement actually stops it", async ({ page })=>{
  const errors = attachDiagnostics(page);
  await open(page, "teach", "pressure");
  await expect(page.locator("#pdReady")).toBeDisabled();
  await pressHoldRelease(page, 0.75, 45);

  const snap = await snapshot(page);
  expect(snap.haemostatic).toBe(true);
  expect(snap.effectiveSeconds).toBeGreaterThanOrEqual(snap.holdSeconds - 0.5);
  expect(snap.hematomaGrade).toBe("none");
  // letting go after it is holding IS the check, and the site is dry
  expect(snap.checked).toBe(true);
  expect(snap.bleedingAtCheck).toBe(false);
  await expect(page.locator("#pdReady")).toBeEnabled();
  expect(errors).toEqual([]);
});

test("pressing beside the puncture does nothing at all, and is blocked", async ({ page })=>{
  await open(page, "teach", "pressure");
  await pressHoldRelease(page, 0.8, 40, { offsetMm: 30 });

  const snap = await snapshot(page);
  expect(snap.padOffSite).toBe(true);
  expect(snap.clotProgress).toBe(0);
  expect(snap.blocking).toContain("padOffSite");
});

/* ---------- the check ------------------------------------------------------------- */

test("lifting the gauze early shows blood and costs progress", async ({ page })=>{
  await open(page, "teach", "pressure");
  await pressInto(page, 0.75);
  await fastForward(page, 12);
  const mid = await snapshot(page);
  expect(mid.clotProgress).toBeGreaterThan(0);
  await page.mouse.up();                       // lift and look, too early
  await page.waitForTimeout(150);

  const snap = await snapshot(page);
  expect(snap.bleedingAtCheck).toBe(true);
  expect(snap.releasedEarlyCount).toBe(1);
  expect(snap.clotProgress).toBeLessThan(mid.clotProgress);
  expect(snap.issues).toContain("stillBleeding");
  await expect(page.locator("#pdReady")).toBeDisabled();
});

/* ---------- the flexed elbow ------------------------------------------------------ */

test("bending the patient's arm up stops the clot progressing", async ({ page })=>{
  const errors = attachDiagnostics(page);
  await open(page, "teach", "pressure");
  const a = await anchors(page);
  // drag the hand upward — the classic "bend your arm up for me"
  await page.mouse.move(a.hand.x, a.hand.y);
  await page.mouse.down();
  await page.mouse.move(a.hand.x, a.hand.y - 90, { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(120);

  let snap = await snapshot(page);
  expect(snap.armFlexed).toBe(true);
  expect(snap.issues).toContain("armFlexed");

  await pressHoldRelease(page, 0.8, 40);
  snap = await snapshot(page);
  expect(snap.clotProgress).toBe(0);
  expect(snap.haemostatic).toBe(false);
  expect(snap.armFlexedSeconds).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

/* ---------- the dressing ---------------------------------------------------------- */

test("the dressing is dragged onto the site, and its alignment and tightness are the gesture's", async ({ page })=>{
  const errors = attachDiagnostics(page);
  await open(page, "teach", "bandage");
  await pressHoldRelease(page, 0.75, 45);
  const before = await snapshot(page);
  expect(before.haemostatic).toBe(true);
  await expect(page.locator("#pdReady")).toBeDisabled();

  const a = await anchors(page);
  await page.mouse.move(a.bandage.x, a.bandage.y);
  await page.mouse.down();
  await page.mouse.move(a.site.x, a.site.y, { steps: 24 });
  // press it down onto the limb: that travel is the tightness
  await page.mouse.move(
    a.site.x + (a.axisUnderSite.x - a.site.x)*0.35,
    a.site.y + (a.axisUnderSite.y - a.site.y)*0.35, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(150);

  const snap = await snapshot(page);
  expect(snap.bandaged).toBe(true);
  expect(snap.bandagedWhileBleeding).toBe(false);
  expect(snap.bandageAlignM).toBeLessThan(0.014);
  expect(snap.bandageTightness).toBeGreaterThan(0);
  expect(snap.bandageTightness).toBeLessThan(0.88);
  await expect(page.locator("#pdReady")).toBeEnabled();
  expect(errors).toEqual([]);
});

test("a dressing put on over a bleeding puncture is blocked", async ({ page })=>{
  await open(page, "teach", "bandage");
  // no pressure at all, straight to the dressing
  const a = await anchors(page);
  await page.mouse.move(a.bandage.x, a.bandage.y);
  await page.mouse.down();
  await page.mouse.move(a.site.x, a.site.y, { steps: 24 });
  await page.mouse.up();
  await page.waitForTimeout(150);

  const snap = await snapshot(page);
  expect(snap.bandaged).toBe(true);
  expect(snap.bandagedWhileBleeding).toBe(true);
  expect(snap.blocking).toContain("bandagedBleeding");
  await expect(page.locator("#pdReady")).toBeDisabled();
});

/* ---------- the two steps are one piece of work ----------------------------------- */

test("the bandage step inherits the clot the pressure step formed", async ({ page })=>{
  test.slow();
  const errors = attachDiagnostics(page);
  await open(page, "teach", "pressure");
  await pressHoldRelease(page, 0.75, 45);
  // asserted before the click so a failure here names the cause rather than
  // just reporting that a button stayed disabled
  const done = await snapshot(page);
  expect(done.padOffSite).toBe(false);
  expect(done.meanForce).toBeGreaterThan(done.requiredForce);
  expect(done.pressureReady).toBe(true);
  await page.locator("#pdReady").click();

  await expect(page.locator(".asm-coach")).toBeVisible();
  await page.waitForFunction(async ()=>!!(await window.__phlebTest.postDrawAnchors()), null, { timeout:10000 });
  await settle(page);
  const snap = await snapshot(page);
  expect(snap.haemostatic).toBe(true);
  expect(snap.checked).toBe(true);
  expect(snap.bandaged).toBe(false);
  expect(errors).toEqual([]);
});

/* ---------- a scored shift stays quiet -------------------------------------------- */

test("a scored shift lets a hematoma happen and says nothing until after", async ({ page })=>{
  await open(page, "play", "pressure");
  await expect(page.locator(".stg-msg")).toContainText("assessed after the patient");
  await expect(page.locator("#pdReady")).toBeEnabled();
  await fastForward(page, 120);          // walk away from a bleeding puncture

  const snap = await snapshot(page);
  expect(snap.hematomaGrade).toBe("hematoma");
  expect(snap.blocking).toContain("hematoma");
  await expect(page.locator(".stg-msg")).toContainText("assessed after the patient");
});

/* ---------- the coach does not tear itself down while the hold ticks -------------- */

test("the coach patches the live force and countdown rather than re-rendering", async ({ page })=>{
  await open(page, "teach", "pressure");
  await pressInto(page, 0.75);
  await page.evaluate(()=>{ document.querySelector("#pdReady").dataset.probe = "1"; });
  await fastForward(page, 8);
  await page.waitForTimeout(700);
  const kept = await page.evaluate(()=>document.querySelector("#pdReady").dataset.probe);
  await page.mouse.up();
  expect(kept).toBe("1");
  await expect(page.locator('[data-live="hold"]')).toContainText("to go");
});

/* ---------- the accessible path ---------------------------------------------------- */

async function useControls(page){
  const toggle = page.locator("#pdView");
  if(await toggle.getAttribute("aria-pressed") === "false") await toggle.click();
  await expect(page.locator(".asm-controls")).toBeVisible();
}

test("the controls path runs both steps through the same rules", async ({ page })=>{
  test.slow();
  const errors = attachDiagnostics(page);
  await open(page, "teach", "pressure");
  await useControls(page);
  await page.locator('[data-pd="hold"]').click();
  await page.locator('[data-pd="check"]').click();
  let snap = await snapshot(page);
  expect(snap.haemostatic).toBe(true);
  expect(snap.bleedingAtCheck).toBe(false);
  expect(snap.pressureReady).toBe(true);
  await page.locator("#pdReady").click();

  await expect(page.locator(".asm-coach")).toBeVisible();
  await useControls(page);
  await page.locator('[data-pd="bandage"]').click();
  await page.locator('[data-pd="aftercare"]').click();
  snap = await snapshot(page);
  expect(snap.bandaged).toBe(true);
  expect(snap.bandageReady).toBe(true);
  expect(snap.aftercareGiven).toBe(true);
  expect(errors).toEqual([]);
});

test("the controls path is not an easier game — light, hard and off-site all fail", async ({ page })=>{
  await open(page, "teach", "pressure");
  await useControls(page);

  await page.locator('[data-pd="light"]').click();
  let snap = await snapshot(page);
  expect(snap.clotProgress).toBe(0);
  expect(snap.issues).toContain("tooLight");

  await page.locator('[data-pd="beside"]').click();
  snap = await snapshot(page);
  expect(snap.padOffSite).toBe(true);
  expect(snap.blocking).toContain("padOffSite");

  await page.locator('[data-pd="hard"]').click();
  snap = await snapshot(page);
  expect(snap.discomfortSeconds).toBeGreaterThan(3);
  expect(snap.issues).toContain("tooHard");
});

test("the controls path can bend the arm, and it costs the same as the drag does", async ({ page })=>{
  await open(page, "teach", "pressure");
  await useControls(page);
  await page.locator('[data-pd="flex"]').click();
  await page.locator('[data-pd="hold"]').click();
  let snap = await snapshot(page);
  expect(snap.armFlexed).toBe(true);
  expect(snap.clotProgress).toBe(0);

  await page.locator('[data-pd="straighten"]').click();
  await page.locator('[data-pd="hold"]').click();
  snap = await snapshot(page);
  expect(snap.armFlexed).toBe(false);
  expect(snap.haemostatic).toBe(true);
});

test("a dressing pulled on too tight is refused and can be redone", async ({ page })=>{
  await open(page, "teach", "bandage");
  await useControls(page);
  await page.locator('[data-pd="hold"]').click();
  await page.locator('[data-pd="check"]').click();
  await page.locator('[data-pd="bandage-tight"]').click();

  let snap = await snapshot(page);
  expect(snap.bandageTightness).toBeGreaterThanOrEqual(0.88);
  expect(snap.blocking).toContain("bandageTourniquet");
  expect(snap.bandageReady).toBe(false);

  await page.locator('[data-pd="bandage-remove"]').click();
  await page.locator('[data-pd="bandage"]').click();
  snap = await snapshot(page);
  expect(snap.bandageAttempts).toBe(2);
  expect(snap.bandageReady).toBe(true);
});

test("the controls view is fully keyboard operable", async ({ page })=>{
  await open(page, "teach", "pressure");
  await useControls(page);
  const hold = page.locator('[data-pd="hold"]');
  await hold.focus();
  await page.keyboard.press("Enter");
  const check = page.locator('[data-pd="check"]');
  await check.focus();
  await page.keyboard.press("Enter");
  const snap = await snapshot(page);
  expect(snap.haemostatic).toBe(true);
  expect(snap.checked).toBe(true);
});
