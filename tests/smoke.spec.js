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

test("main interaction panel shows Clock In and offers the two modes", async ({ page }) => {
  const { errors } = attachDiagnostics(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Clock in/i })).toBeVisible({ timeout: 15000 });
  await expect(page.locator("#modeLearn")).toBeVisible();
  await expect(page.locator("#modePlay")).toBeVisible();
  await page.locator("#modeLearn").click();
  await expect(page.getByRole("heading", { name: /Patient 1 of/i })).toBeVisible();
  expect(errors).toEqual([]);
});

test("the patient is met in a room, not on a screen that asks about them", async ({ page }) => {
  const { errors } = attachDiagnostics(page);
  await page.goto("/");
  await page.locator("#modeLearn").click();

  /* Two screens went, for the same reason: if the draw already makes the
     learner do the thing, the screen that ASKS them about it is deleted, and
     the score reads what they did instead.

       "Verify identity", a multiple-choice question — now two identifiers out
       of the patient's own mouth, checked against a requisition you can read.

       "Is this requisition ready to use?", three sentences to pick between —
       now a requisition on the counter and one control: hold, or do not. */
  await expect(page.getByRole("heading", { name: /Patient 1 of/i })).toBeVisible({ timeout: 5000 });
  await expect(page.locator(".dlg .bubble").first()).toBeVisible();
  await expect(page.locator(".arrival")).toBeVisible();
  await expect(page.locator(".arr-req")).toContainText("Requisition");
  await expect(page.getByRole("heading", { name: /Verify identity/i })).toHaveCount(0);
  await expect(page.locator("#opts")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the draw cannot be entered until two identifiers are in hand", async ({ page }) => {
  const { errors } = attachDiagnostics(page);
  await page.goto("/");
  await page.locator("#modeLearn").click();
  await expect(page.locator(".arrival")).toBeVisible({ timeout: 5000 });

  // This is the one gate in the room, and it is the most load-bearing rule in
  // California phlebotomy practice.
  const start = page.locator("#arrStart");
  await expect(start).toBeDisabled();

  /* Say whatever is live until the gate opens. The smoke suite deliberately
     runs the shipped page with no test seam on it, so this reads the same
     button the learner reads rather than asking the app about its state.

     Clicking the FIRST live thing is not an arbitrary choice: `liveActs()`
     ranks them the way the work actually runs, so the top of the list is
     greet, then the open name ask, then the open date-of-birth ask. A patient
     who answers with a nickname simply leaves that group live and the next
     click asks again — which is why this loop needs no special case for it. */
  for(let i = 0; i < 10; i++){
    if(await start.isEnabled()) break;
    const act = page.locator(".arr-act").first();
    if(!(await act.count())) break;
    await act.click();
    await page.waitForTimeout(150);
  }
  await expect(start).toBeEnabled();

  await start.click();
  // …and the draw itself starts at the work area, not at an introduction step.
  await expect(
    page.getByRole("heading", { name: /Work-area preparation|Site selection|says…/i })
  ).toBeVisible({ timeout: 8000 });
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
