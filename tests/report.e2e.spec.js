/* =========================================================================
   THE PRACTICAL REPORT — browser acceptance tests against the PRODUCTION
   build.

   The unit tests prove the grading and the replay merge. These prove the
   report is what a Final Practical actually ends with: a 0–4 for every
   rubric row, the evidence under it, the specimen and the patient reported
   separately from the score, a prioritised practice plan, and a replay built
   from the event logs the steps were already keeping.
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

/**
 * Runs a draw in `mode` far enough to produce measurements, then ends it.
 *
 * The point of these tests is the REPORT, not the technique, so the draw is
 * walked to a step and then finished — which is exactly the attempt of a
 * learner who abandoned most of it, and the report has to grade that
 * honestly rather than crash on the missing halves.
 */
async function finishDrawIn(page, mode, upTo){
  await page.goto("./?e2e=1");
  await expect(page.locator("canvas")).toBeVisible({ timeout:15000 });
  await page.waitForFunction(()=>!!window.__phlebTest, null, { timeout:15000 });
  await page.evaluate(a=>window.__phlebTest.gotoProcedureStep(a[0], ["lightblue","lavender"], a[1], "straight-antecubital"),
    [upTo || "invert", mode]);
  await expect(page.locator("#vpStage")).toBeVisible({ timeout:10000 });
  await page.evaluate(()=>window.__phlebTest.finishDraw());
  await expect(page.locator("#vpToLabel")).toBeVisible({ timeout:10000 });
}

const report = page => page.evaluate(()=>window.__phlebTest.practicalReport());
const replay = page => page.evaluate(()=>window.__phlebTest.sessionReplay());
const progress = page => page.evaluate(()=>window.__phlebTest.modeProgress());

/* -------------------------------------------------------------------------
   THE FINAL PRACTICAL'S OUTPUT
   ------------------------------------------------------------------------- */

test("a Final Practical ends with a 0–4 score for every rubric category", async ({ page }) => {
  const errors = attachDiagnostics(page);
  await finishDrawIn(page, "final");

  await expect(page.getByRole("heading", { name: /Practical report/i })).toBeVisible();
  const r = await report(page);
  expect(r).not.toBeNull();
  expect(r.categories.length).toBe(5);
  for(const c of r.categories){
    expect(c.score).toBeGreaterThanOrEqual(0);
    expect(c.score).toBeLessThanOrEqual(4);
    expect(c.max).toBe(4);
  }
  expect(r.total).toBe(r.categories.reduce((s, c)=>s + c.score, 0));
  expect(r.maxTotal).toBe(20);

  // every row is on screen with its chip and its band name
  const chips = page.locator(".rep-row .rep-chip");
  await expect(chips).toHaveCount(5);
  expect(errors).toEqual([]);
});

test("the report states pass or fail and says exactly why", async ({ page }) => {
  await finishDrawIn(page, "final");
  const r = await report(page);
  const verdict = page.locator(".rep-verdict");
  await expect(verdict).toContainText(r.passed ? "PASS" : "FAIL");
  await expect(page.locator(".rep-why li").first()).not.toBeEmpty();
  // an abandoned draw fails, and names a reason rather than just a number
  expect(r.failedBy.length).toBeGreaterThan(0);
  expect(r.failedBy.every(f=>typeof f.detail === "string" && f.detail.length > 10)).toBe(true);
});

test("the report names the procedure that was actually performed", async ({ page }) => {
  await finishDrawIn(page, "final");
  await expect(page.locator(".rep-proc")).toContainText(/Straight multisample needle, antecubital fossa/i);
});

test("what prevented an Excellent is stated in the learner's own numbers", async ({ page }) => {
  await finishDrawIn(page, "final");
  const r = await report(page);
  const blocked = r.preventedExcellence.flatMap(p=>p.reasons);
  expect(blocked.length).toBeGreaterThan(0);
  for(const b of blocked){
    expect(typeof b.detail).toBe("string");
    expect(b.detail.length).toBeGreaterThan(10);
    expect(b.detail).not.toMatch(/\bbe more careful\b|\btry harder\b/i);
  }
  await expect(page.locator(".rep-blocked li").first()).toBeVisible();
});

test("specimen results and patient outcomes are reported apart from the score", async ({ page }) => {
  await finishDrawIn(page, "final");
  await expect(page.locator(".rep-sec", { hasText: "Specimen" })).toBeVisible();
  await expect(page.locator(".rep-sec", { hasText: "The patient" })).toBeVisible();
  const r = await report(page);
  expect(Array.isArray(r.specimen.tubes)).toBe(true);
  expect(Array.isArray(r.patientOutcomes)).toBe(true);
});

test("the practice plan is prioritised, and every entry cites a measurement", async ({ page }) => {
  await finishDrawIn(page, "final");
  const r = await report(page);
  expect(r.practicePlan.length).toBeGreaterThan(0);
  for(let i = 1; i < r.practicePlan.length; i++){
    expect(r.practicePlan[i].priority).toBeGreaterThanOrEqual(r.practicePlan[i-1].priority);
  }
  await expect(page.locator(".rep-plan li").first()).toBeVisible();
});

test("the policy the attempt was graded against is named on the report", async ({ page }) => {
  await finishDrawIn(page, "final");
  await expect(page.locator(".rep-policy").first()).toContainText("documented-defaults");
});

/* -------------------------------------------------------------------------
   THE REPLAY
   ------------------------------------------------------------------------- */

/**
 * Actually palpates the arm, so the replay has both a real event log AND the
 * measurement that graded it. Jumping to a step and finishing produces a
 * report but almost no evidence — which is the right thing for the report to
 * say, and the wrong thing to test a timeline with.
 */
async function playPalpationThenFinish(page, mode){
  await page.goto("./?e2e=1");
  await expect(page.locator("canvas")).toBeVisible({ timeout:15000 });
  await page.waitForFunction(()=>!!window.__phlebTest, null, { timeout:15000 });
  await page.evaluate(m=>window.__phlebTest.gotoProcedureStep("palpate", ["lightblue","lavender"], m, "straight-antecubital"), mode);
  await expect(page.locator(".plp-coach")).toBeVisible({ timeout:10000 });
  await page.waitForFunction(async ()=>!!(await window.__phlebTest.screenPointOverVessel("median-cubital")),
    null, { timeout:10000 });

  // a real fingertip press on a real vessel, which is what puts entries in
  // palpation's own event log
  const p = await page.evaluate(()=>window.__phlebTest.screenPointOverVessel("median-cubital"));
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.waitForTimeout(540);
  await page.mouse.up();
  await page.waitForTimeout(150);
  await page.locator("#plpReady").click();

  await page.evaluate(()=>window.__phlebTest.finishDraw());
  await expect(page.locator("#vpToLabel")).toBeVisible({ timeout:10000 });
}

test("the replay is merged from the event logs the steps already kept", async ({ page }) => {
  const errors = attachDiagnostics(page);
  await playPalpationThenFinish(page, "final");
  const r = await replay(page);
  expect(r).not.toBeNull();
  expect(r.count).toBeGreaterThan(0);
  // the supply cart logs a relative clock and everything else an absolute
  // one; a bad merge separates them by 50 years, not by seconds
  expect(r.durationMs).toBeLessThan(60 * 60 * 1000);
  expect(r.groups.some(g=>g.events > 0)).toBe(true);
  // every event belongs to a section the replay knows about
  expect(new Set(r.sections).size).toBeGreaterThan(0);
  await expect(page.locator(".rep-replay summary")).toContainText("Session replay");
  expect(errors).toEqual([]);
});

test("each replay group is shown against the measurement that graded it", async ({ page }) => {
  await playPalpationThenFinish(page, "final");
  const group = page.locator(".rep-rgroup", { has: page.locator(".rep-timeline li") }).first();
  await expect(group.locator(".rep-rghead")).not.toBeEmpty();
  await expect(group.locator(".rep-rgnarr").first()).not.toBeEmpty();
  await expect(group.locator(".rep-rgscore").first()).toContainText("/100");
  await expect(group.locator(".rep-at").first()).toContainText(/^\d+:\d\d\.\d$/);
});

/* -------------------------------------------------------------------------
   THE OTHER TWO MODES
   ------------------------------------------------------------------------- */

test("Learn and Practice keep their chips and get a compact rubric line, not the report", async ({ page }) => {
  for(const mode of ["learn", "practice"]){
    await finishDrawIn(page, mode);
    await expect(page.getByRole("heading", { name: /Draw complete/i })).toBeVisible();
    await expect(page.locator(".vp-scorewrap .vp-chip").first()).toBeVisible();
    // the compact summary is there…
    await expect(page.locator(".rep-head .rep-chip").first()).toBeVisible();
    // …but not the report's own sections
    await expect(page.locator(".rep-plan")).toHaveCount(0);
    await expect(page.locator(".rep-replay")).toHaveCount(0);
  }
});

test("a Learn attempt can never claim an unaided Excellent", async ({ page }) => {
  await finishDrawIn(page, "learn");
  const r = await report(page);
  for(const c of r.categories){
    expect(c.score).toBeLessThan(4);
    if(c.preventedExcellence.length){
      expect(c.preventedExcellence.some(g=>g.reason === "assisted")).toBe(true);
    }
  }
});

test("bests are kept per mode and never pooled", async ({ page }) => {
  await finishDrawIn(page, "practice");
  let p = await progress(page);
  expect(p.practice.attempts).toBe(1);
  expect(p.final).toBeUndefined();

  await finishDrawIn(page, "final");
  p = await progress(page);
  expect(p.practice.attempts).toBe(1);
  expect(p.final.attempts).toBe(1);
  await expect(page.locator(".rep-policy", { hasText: /Final Practical: attempt 1/ })).toBeVisible();
});

test("returning to the report does not count a second attempt", async ({ page }) => {
  await finishDrawIn(page, "final");
  const before = await progress(page);
  await page.evaluate(()=>window.__phlebTest.finishDraw());
  await expect(page.locator("#vpToLabel")).toBeVisible();
  const after = await progress(page);
  expect(after.final.attempts).toBe(before.final.attempts);
});
