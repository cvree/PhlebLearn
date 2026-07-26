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

test("main interaction panel shows Clock In and can start Teaching mode", async ({ page }) => {
  const { errors } = attachDiagnostics(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Clock in/i })).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: /Teaching mode/i }).click();
  await expect(page.getByRole("heading", { name: /Patient 1 of/i })).toBeVisible();
  expect(errors).toEqual([]);
});

test("patient-identification options render and a correct choice advances the encounter", async ({ page }) => {
  const { errors } = attachDiagnostics(page);
  await page.goto("/");
  await page.getByRole("button", { name: /Teaching mode/i }).click();
  await page.getByRole("button", { name: /Greet & begin/i }).click();
  await expect(page.getByRole("heading", { name: /Verify identity/i })).toBeVisible();

  // advance through the dialogue "..." beats to the option list
  for(let i=0;i<3;i++){
    const btn = page.locator("#panel button").last();
    const text = await btn.textContent();
    if(!text) break;
    await btn.click();
    if(await page.locator("#opts .opt").count() > 0) break;
  }
  const options = page.locator("#opts .opt");
  await expect(options.first()).toBeVisible();
  const count = await options.count();
  expect(count).toBeGreaterThan(0);

  // every correct verify/nickname option mentions DOB / date of birth — the
  // wrong options never do (see config.js's VERIFY_WRONG / NICK_WRONG).
  let clicked = false;
  for(let i=0;i<count;i++){
    const opt = options.nth(i);
    const text = (await opt.textContent()) || "";
    if(/DOB|date of birth|birth date/i.test(text)){ await opt.click(); clicked = true; break; }
  }
  expect(clicked, "expected to find a DOB-mentioning correct option").toBe(true);

  // "Continue" on the reaction screen should move us to the requisition review
  await page.locator("#panel button", { hasText: /Continue/i }).click();
  await expect(page.getByRole("heading", { name: /Check the requisition/i })).toBeVisible({ timeout: 5000 });
  expect(errors).toEqual([]);
});

test("camera receives pointer input (orbit drag changes the room framing)", async ({ page }) => {
  const { errors } = attachDiagnostics(page);
  await page.goto("/");
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible({ timeout: 15000 });
  const box = await canvas.boundingBox();
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

test("a tube can be selected through the raycaster", async ({ page }) => {
  const { errors } = attachDiagnostics(page);
  await page.goto("/");
  await page.getByRole("button", { name: /Teaching mode/i }).click();
  await page.getByRole("button", { name: /Greet & begin/i }).click();
  // Fastest path to the tube rack regardless of which patient/event was rolled.
  // Teaching mode keeps re-showing the same options with a hint on a wrong
  // pick, so this tries each option in turn (rather than always index 0)
  // until the screen actually advances, instead of assuming the first
  // option is correct.
  for(let i=0;i<20;i++){
    if(await page.getByRole("heading", { name: /Select the tubes/i }).isVisible().catch(()=>false)) break;
    const optCount = await page.locator("#opts .opt").count();
    if(optCount > 0){
      for(let j=0;j<optCount;j++){
        // in Teaching mode a wrong pick just appends a hint and keeps #opts
        // around for another try; #opts disappearing is the real "advanced" signal.
        if(await page.locator("#opts").count() === 0) break;
        await page.locator("#opts .opt").nth(j).click();
        await page.waitForTimeout(200);
        if(await page.locator("#opts").count() === 0) break; // this option was correct
      }
      continue;
    }
    const anyBtn = page.locator("#panel button").last();
    if(await anyBtn.isVisible().catch(()=>false)){ await anyBtn.click(); await page.waitForTimeout(200); continue; }
    break;
  }
  await expect(page.getByRole("heading", { name: /Select the tubes/i })).toBeVisible({ timeout: 8000 });

  const canvas = page.locator("canvas");
  const box = await canvas.boundingBox();
  // scan a horizontal line across the tube-rack region (empirically ~20-45% width, ~35-55% height)
  // rather than one fixed point, so this doesn't depend on pixel-perfect camera framing.
  let selected = false;
  for(let fx=0.20; fx<=0.45 && !selected; fx+=0.03){
    await page.mouse.click(box.x + box.width*fx, box.y + box.height*0.42);
    await page.waitForTimeout(150);
    const chipsText = await page.locator("#selChips").textContent();
    if(chipsText && !/No tubes selected/i.test(chipsText)){ selected = true; }
  }
  expect(selected, "expected clicking the tube rack to select at least one tube").toBe(true);
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
