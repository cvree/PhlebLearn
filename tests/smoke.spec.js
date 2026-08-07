/* Playwright smoke tests against the production build (served via `vite
   preview`, exactly like GitHub Pages). See docs/TESTING.md for what each
   check maps to in the Phase 0 requirements, and why the two three.js
   deprecation warnings below are allowlisted rather than fixed. */
import { test, expect } from "@playwright/test";

// three.js 0.185 warns about two APIs we deliberately haven't migrated yet
// (see docs/ARCHITECTURE.md's "known warnings" section): THREE.Clock ->
// THREE.Timer, and PCFSoftShadowMap being aliased to PCFShadowMap. Neither
// is a functional regression; both predate this branch. Any OTHER console
// warning or error fails the test.
const ALLOWLISTED_WARNINGS = [
  /THREE\.Clock: This module has been deprecated/,
  /THREE\.WebGLShadowMap: PCFSoftShadowMap has been deprecated/,
  // headless Chromium's software/virtualized GPU driver chatter — an artifact
  // of the CI/sandbox environment's graphics stack, not app behavior.
  /GL Driver Message/,
  // GSAP, Lenis and Vanta come from a CDN behind `onerror` fallbacks: the app
  // is designed to run without them, which is the whole point of loading them
  // that way. On a machine with no outbound network those three requests fail
  // and the app carries on, so the failure is the designed behaviour rather
  // than a regression. A REAL breakage still shows up here as a pageerror or
  // as the assertion that follows it.
  /Failed to load resource/,
];

function attachDiagnostics(page){
  const errors = [];
  const failedRequests = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if(msg.type() !== "error" && msg.type() !== "warning") return;
    const text = msg.text();
    if(ALLOWLISTED_WARNINGS.some(re => re.test(text))) return;
    errors.push(`console.${msg.type()}: ${text}`);
  });
  page.on("requestfailed", (req) => {
    failedRequests.push(`${req.url()} :: ${req.failure()?.errorText}`);
  });
  return { errors, failedRequests };
}

test("production build loads with a Three.js canvas and no fatal errors", async ({ page }) => {
  const { errors } = attachDiagnostics(page);
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 15000 });
  await expect(page.locator("#panel")).toBeVisible();
  expect(errors, `Unexpected console/page errors:\n${errors.join("\n")}`).toEqual([]);
});

test("main interaction panel shows Clock In and offers the three modes", async ({ page }) => {
  const { errors } = attachDiagnostics(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Clock in/i })).toBeVisible({ timeout: 15000 });
  await expect(page.locator("#modeLearn")).toBeVisible();
  await expect(page.locator("#modePractice")).toBeVisible();
  await expect(page.locator("#modeFinal")).toBeVisible();
  await page.locator("#modeLearn").click();
  await expect(page.getByRole("heading", { name: /Patient 1 of/i })).toBeVisible();
  expect(errors).toEqual([]);
});

test("greeting the patient goes straight to the requisition — identity is the draw's own step", async ({ page }) => {
  const { errors } = attachDiagnostics(page);
  await page.goto("/");
  await page.locator("#modeLearn").click();
  await page.getByRole("button", { name: /Greet & begin/i }).click();

  // The identity multiple-choice screen is gone: the physical introduction
  // step inside the draw asks for two identifiers properly. See
  // game/scoring.js's deriveChoices().
  await expect(page.getByRole("heading", { name: /Check the requisition/i })).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole("heading", { name: /Verify identity/i })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("reading the requisition leads into the draw, not into two tube-tapping screens", async ({ page }) => {
  const { errors } = attachDiagnostics(page);
  await page.goto("/");
  await page.locator("#modeLearn").click();
  await page.getByRole("button", { name: /Greet & begin/i }).click();
  await expect(page.getByRole("heading", { name: /Check the requisition/i })).toBeVisible({ timeout: 5000 });

  // advance the guide's dialogue beats to the option list
  for(let i=0;i<4;i++){
    if(await page.locator("#opts .opt").count() > 0) break;
    const btn = page.locator("#panel button").last();
    if(!(await btn.count())) break;
    await btn.click();
  }
  const options = page.locator("#opts .opt");
  await expect(options.first()).toBeVisible({ timeout: 5000 });
  // Which requisition answer is correct depends on whether this patient's
  // order was rolled with a flaw, and Learn mode keeps the options up with a
  // hint after a wrong pick — so try each in turn until the screen moves on.
  const count = await options.count();
  for(let i=0;i<count;i++){
    if(await page.locator("#opts").count() === 0) break;
    await page.locator("#opts .opt").nth(i).click();
    await page.waitForTimeout(200);
  }
  const cont = page.locator("#panel button", { hasText: /Continue/i });
  if(await cont.count()) await cont.first().click();

  // Site selection only when this patient's arms pose one; otherwise the draw.
  await expect(
    page.getByRole("heading", { name: /Venipuncture|Site selection|says…/i })
  ).toBeVisible({ timeout: 8000 });
  await expect(page.getByRole("heading", { name: /Select the tubes|Order of draw/i })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("camera receives pointer input (orbit drag changes the room framing)", async ({ page }) => {
  const { errors } = attachDiagnostics(page);
  await page.goto("/");
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible({ timeout: 15000 });
  // boundingBox() can momentarily return null while the compositor is busy;
  // poll rather than dereferencing it straight away.
  let box = null;
  for(let i=0;i<20 && !box;i++){ box = await canvas.boundingBox(); if(!box) await page.waitForTimeout(100); }
  expect(box, "canvas never reported a bounding box").not.toBeNull();
  const cx = box.x + box.width/2, cy = box.y + box.height/2;
  const before = await page.screenshot();
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 220, cy, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const after = await page.screenshot();
  expect(Buffer.compare(before, after)).not.toBe(0);
  expect(errors).toEqual([]);
});

test("the room's tube rack is scenery now, and clicking it breaks nothing", async ({ page }) => {
  // Choosing tubes moved to the supply cart, where the learner picks up real
  // packages and reads their labels — see tests/staging.e2e.spec.js. The rack
  // in the room stays as set dressing, so what matters here is that pointer
  // hits on it are inert rather than throwing.
  const { errors } = attachDiagnostics(page);
  await page.goto("/");
  await page.locator("#modeLearn").click();
  await page.getByRole("button", { name: /Greet & begin/i }).click();
  const canvas = page.locator("canvas");
  const box = await canvas.boundingBox();
  for(let fx=0.20; fx<=0.45; fx+=0.06){
    await page.mouse.click(box.x + box.width*fx, box.y + box.height*0.42);
    await page.waitForTimeout(80);
  }
  await expect(page.locator("#panel")).toBeVisible();
  expect(errors).toEqual([]);
});

test("audio and asset requests do not 404", async ({ page }) => {
  const badResponses = [];
  page.on("response", (res) => {
    const url = res.url();
    if(/\/assets\//.test(url) && res.status() === 404){ badResponses.push(`${res.status()} ${url}`); }
  });
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 15000 });
  expect(badResponses, badResponses.join("\n")).toEqual([]);
});

test("refreshing the page does not leave the application unusable", async ({ page }) => {
  const { errors } = attachDiagnostics(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Clock in/i })).toBeVisible({ timeout: 15000 });
  await page.reload();
  await expect(page.getByRole("heading", { name: /Clock in/i })).toBeVisible({ timeout: 15000 });
  await expect(page.locator("canvas")).toBeVisible();
  expect(errors).toEqual([]);
});
