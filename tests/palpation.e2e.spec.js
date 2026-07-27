/* =========================================================================
   Palpation — browser acceptance tests against the PRODUCTION build.

   The unit tests prove the sensations are right. These prove the step is a
   REAL one: that the old four-button multiple-choice is gone, that pressure
   builds by holding still and eases off when you slide, that what you feel
   depends on what is under the finger, and that you cannot commit to a vein
   you never actually pressed.
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

async function openPalpation(page, mode){
  await page.goto("./?e2e=1");
  await expect(page.locator("canvas")).toBeVisible({ timeout:15000 });
  await page.waitForFunction(()=>!!window.__phlebTest, null, { timeout:15000 });
  await page.evaluate(m=>window.__phlebTest.gotoProcedureStep("palpate", ["lightblue","lavender"], m), mode||"teach");
  await expect(page.locator(".plp-coach")).toBeVisible({ timeout:10000 });
  await page.waitForFunction(async ()=>!!(await window.__phlebTest.screenPointOverVessel("median-cubital")),
    null, { timeout:10000 });
}

const snapshot = page=>page.evaluate(()=>window.__phlebTest.palpationSnapshot());
const overVessel = (page, id)=>page.evaluate(v=>window.__phlebTest.screenPointOverVessel(v), id);

/**
 * Presses a fingertip over a vessel and holds still for `ms`.
 *
 * The default is a FIRM press, not a maximal one. Holding down long enough to
 * reach full pressure squashes a vein flat and correctly reports that it has
 * gone — which is the mechanic working, not a vein that failed to be found.
 */
async function pressOver(page, id, ms){
  const p = await overVessel(page, id);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.waitForTimeout(ms == null ? 540 : ms);
  return p;
}
async function liftOff(page){
  await page.mouse.up();
  await page.waitForTimeout(150);
}

/* ---------- the step is real ------------------------------------------------- */

test("palpation is a real arm, not four labelled buttons", async ({ page })=>{
  const errors = attachDiagnostics(page);
  await openPalpation(page, "teach");

  // the old multiple-choice activity is gone
  await expect(page.locator(".vp-vein")).toHaveCount(0);
  await expect(page.locator(".vp-armbig")).toHaveCount(0);

  const snap = await snapshot(page);
  expect(snap).not.toBeNull();
  expect(snap.everPressed).toBe(false);
  expect(snap.felt).toEqual([]);
  expect(errors).toEqual([]);
});

test("nothing is named on screen before it has been felt", async ({ page })=>{
  await openPalpation(page, "teach");
  const text = await page.locator(".plp-coach").innerText();
  expect(text).not.toMatch(/median cubital/i);
  expect(text).not.toMatch(/brachial artery/i);
});

/* ---------- pressure is a real quantity -------------------------------------- */

test("pressure builds while the finger is held still", async ({ page })=>{
  await openPalpation(page, "teach");
  await pressOver(page, "median-cubital", 150);
  const early = await snapshot(page);
  await page.waitForTimeout(800);
  const late = await snapshot(page);
  await liftOff(page);

  expect(late.press).toBeGreaterThan(early.press);
  expect(late.press).toBeGreaterThan(0.6);
});

test("sliding the finger about eases the pressure off again", async ({ page })=>{
  await openPalpation(page, "teach");
  const p = await pressOver(page, "median-cubital", 900);
  const held = await snapshot(page);
  expect(held.press).toBeGreaterThan(0.6);

  // sweep across the arm rather than leaning on one spot, at a speed a hand
  // could actually move at
  for(let i=1;i<=10;i++){
    await page.mouse.move(p.x + i*9, p.y + i*3);
    await page.waitForTimeout(28);
  }
  const swept = await snapshot(page);
  await liftOff(page);
  expect(swept.press).toBeLessThan(held.press);
});

/* ---------- what is under the finger matters --------------------------------- */

test("pressing over the median cubital feels a vein that springs back", async ({ page })=>{
  const errors = attachDiagnostics(page);
  await openPalpation(page, "teach");
  await pressOver(page, "median-cubital");
  const snap = await snapshot(page);
  // read the panel while the finger is still down — lift off and the pressure
  // decays, exactly as it should
  await expect(page.locator('[data-live="feel"]')).toContainText(/springs back/i);
  await liftOff(page);

  expect(snap.feel).toBe("vein");
  expect(snap.touching).toBe("median-cubital");
  expect(snap.felt).toContain("median-cubital");
  expect(errors).toEqual([]);
});

test("pressing over the artery feels something pushing back in time", async ({ page })=>{
  await openPalpation(page, "teach");
  // the brachial artery runs deep — it takes a firm press to find at all,
  // which is why a light touch over it feels of nothing in particular
  await pressOver(page, "brachial-artery", 1000);
  const snap = await snapshot(page);
  await expect(page.locator('[data-live="feel"]')).toContainText(/pushing back/i);
  await liftOff(page);

  expect(snap.feel).toBe("artery");
  expect(snap.arteryPressed).toBe(true);
});

test("pressing over the tendon feels hard and unmoving", async ({ page })=>{
  await openPalpation(page, "teach");
  await pressOver(page, "biceps-tendon", 800);
  const snap = await snapshot(page);
  await expect(page.locator('[data-live="feel"]')).toContainText(/does not give/i);
  await liftOff(page);
  expect(snap.feel).toBe("tendon");
});

test("lifting off something pulsing counts as recognising it", async ({ page })=>{
  await openPalpation(page, "teach");
  await pressOver(page, "brachial-artery", 1000);
  await liftOff(page);
  const snap = await snapshot(page);
  expect(snap.arteryPressed).toBe(true);
  expect(snap.arteryRecognised).toBe(true);
});

/* ---------- committing --------------------------------------------------------- */

test("marking the vein you felt passes, and teaching mode then lets the draw on", async ({ page })=>{
  await openPalpation(page, "teach");
  const ready = page.locator("#plpReady");
  await expect(ready).toBeDisabled();

  await pressOver(page, "median-cubital");
  await liftOff(page);
  await page.locator("#plpMark").click();
  await page.waitForTimeout(150);

  const snap = await snapshot(page);
  expect(snap.chosenId).toBe("median-cubital");
  expect(snap.ready).toBe(true);
  expect(snap.ideal).toBe(true);
  await expect(ready).toBeEnabled();
});

test("marking the artery is blocked, whatever else was right", async ({ page })=>{
  await openPalpation(page, "teach");
  await pressOver(page, "brachial-artery", 1000);
  await liftOff(page);
  await page.locator("#plpMark").click();
  await page.waitForTimeout(150);

  const snap = await snapshot(page);
  expect(snap.chosenId).toBe("brachial-artery");
  expect(snap.blocking).toContain("choseArtery");
  expect(snap.ready).toBe(false);
  await expect(page.locator("#plpReady")).toBeDisabled();
});

test("the site marked carries into the encounter for the steps that follow", async ({ page })=>{
  await openPalpation(page, "teach");
  await pressOver(page, "median-cubital");
  await liftOff(page);
  await page.locator("#plpMark").click();
  await page.waitForTimeout(150);
  await page.locator("#plpReady").click();
  await page.waitForTimeout(400);

  const still = await snapshot(page);
  expect(still.chosenId).toBe("median-cubital");
  await expect(page.locator(".plp-coach")).toHaveCount(0);
});

/* ---------- the accessible path ------------------------------------------------ */

test("the controls path presses real places and cannot skip feeling either", async ({ page })=>{
  await openPalpation(page, "teach");
  await page.locator("#plpView").click();
  await expect(page.locator(".plp-controls")).toBeVisible();

  // you cannot commit to something you have not pressed
  await expect(page.locator('[data-choose="median-cubital"]')).toBeDisabled();

  await page.locator('[data-press="median-cubital"]').click();
  await page.waitForTimeout(200);
  await expect(page.locator('[data-choose="median-cubital"]')).toBeEnabled();

  await page.locator('[data-choose="median-cubital"]').click();
  await page.waitForTimeout(200);

  const snap = await snapshot(page);
  expect(snap.felt).toContain("median-cubital");
  expect(snap.ready).toBe(true);
  await expect(page.locator("#plpReady")).toBeEnabled();
});

test("the controls path names spots on the arm, never the veins themselves", async ({ page })=>{
  await openPalpation(page, "teach");
  await page.locator("#plpView").click();
  const text = await page.locator(".plp-controls").innerText();
  expect(text).not.toMatch(/median cubital|cephalic|basilic|brachial/i);
  expect(text).toMatch(/bend of the elbow/i);
});

/* ---------- scored mode --------------------------------------------------------- */

test("a scored shift never names what you are feeling", async ({ page })=>{
  await openPalpation(page, "play");
  await pressOver(page, "brachial-artery", 1000);
  const sensation = await page.locator('[data-live="feel"]').innerText();
  const whole = await page.locator(".plp-coach").innerText();
  await liftOff(page);

  expect(sensation).toMatch(/pushing back/i);
  // the sensation, never the conclusion — naming it is the learner's job
  expect(whole).not.toMatch(/brachial artery/i);
  expect(whole).not.toMatch(/that is the/i);
});

test("a scored shift lets a bad site through and carries it forward", async ({ page })=>{
  await openPalpation(page, "play");
  await pressOver(page, "biceps-tendon", 800);
  await liftOff(page);
  await page.locator("#plpMark").click();
  await page.waitForTimeout(150);

  const ready = page.locator("#plpReady");
  await expect(ready).toBeEnabled();
  const before = await snapshot(page);
  expect(before.blocking.length).toBeGreaterThan(0);

  await ready.click();
  await page.waitForTimeout(400);
  await expect(page.locator(".plp-coach")).toHaveCount(0);
});
