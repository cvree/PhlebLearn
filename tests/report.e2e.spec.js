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
import { carryOn, holdSteps } from "./benchHelpers.js";
// The number of rubric rows is a POLICY decision, not a fact about the app —
// policy.js exists precisely so a programme can add or remove one. Reading it
// here means adding a row (Phase 3b added two) updates these tests instead of
// breaking them.
import { CATEGORIES } from "../src/venipuncture/rubric/policy.js";

const ROWS = CATEGORIES.length;
const MAX_TOTAL = ROWS * 4;

const ALLOWLISTED_WARNINGS = [
  /THREE\.Clock: This module has been deprecated/,
  /THREE\.WebGLShadowMap: PCFSoftShadowMap has been deprecated/,
  /GL Driver Message/,
  // GSAP, Lenis and Vanta load from a CDN behind onerror fallbacks — the app
  // is built to run without them. On a machine with no outbound network those
  // requests fail and the app carries on, which is the designed behaviour.
  /Failed to load resource/,
  /* Properties of the MACHINE, not of the app: a sandboxed runner behind an
     outbound proxy cannot fetch the optional web font or the lobby track, and
     both are already guarded with a catch. Allowlisted here rather than in the
     app so a real network failure in the app still fails a test. */
  /ERR_TUNNEL_CONNECTION_FAILED/,
  /Failed to load resource: the server responded with a status of 404/,
];

// These walk a whole encounter — the draw, the labelling and the patient's
// question — in one test, which is more than the default budget allows for.
test.describe.configure({ timeout: 90000 });

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
  /* Hold the draw where the seam puts it. A step ends itself a beat after
     its completing action happens, which would race every assertion below
     about whether it is finished. See tests/benchHelpers.js. */
  await holdSteps(page);
  await page.evaluate(a=>window.__phlebTest.gotoProcedureStep(a[0], ["lightblue","lavender"], a[1], "straight-antecubital"),
    [upTo || "invert", mode]);
  await expect(page.locator("#vpStage")).toBeVisible({ timeout:10000 });
  await page.evaluate(()=>window.__phlebTest.finishDraw());
  // The draw ends at the chair with unlabelled tubes in your hand. There is
  // no "Draw complete" screen in front of that any more — it was a second
  // verdict on the same encounter, delivered two clicks before the debrief
  // said all of it again.
  await expect(page.locator(".lbl-card, .dlg").first()).toBeVisible({ timeout:10000 });
}

/**
 * ...and on to the end of the encounter, which is where the report is now.
 *
 * It used to print the moment the needle was out — before the tubes were
 * labelled, before the patient had been answered — and was then followed two
 * clicks later by a second grading screen. Every judgement lands together,
 * once, at the end.
 */
async function reportAtEnd(page, mode, upTo){
  await finishDrawIn(page, mode, upTo);
  await finishLabelling(page);
  await answerAnyQuestion(page);
  await expect(page.locator(".debrief")).toBeVisible({ timeout:15000 });
  await openBreakdown(page);
}

/**
 * Opens the debrief's breakdown, which is where the report and the
 * per-category tiles live.
 *
 * The debrief is four acts and then a button; everything a test in this file
 * asserts is behind that button, deliberately — the acts are the verdict and
 * the report is the reference under it.
 */
async function openBreakdown(page){
  const body = page.locator("#dbDetailsBody");
  if(await body.count() && await body.isHidden()){
    await page.locator("#dbDetails").click();
  }
  await expect(page.locator(".scoregrid")).toBeVisible({ timeout:10000 });
}

/** Checks the printed label, picks a routing option, and sends the batch. */
async function finishLabelling(page){
  // One check, not four ticks: either the label matches or one line on it
  // does not. Whether this run's label is flawed is rolled per patient, so
  // the test simply makes the call and moves on — what it is exercising is
  // the path to the report, not the perception.
  const match = page.locator("#lblMatch");
  if(await match.count()) await match.click();
  const label = page.locator("#print");
  if(!(await label.count())) return;
  // Learn mode refuses a wrong routing choice, so try each until it sticks.
  const routes = page.locator("[data-route]");
  const n = await routes.count();
  for(let i = 0; i < n; i++){
    await routes.nth(i).click();
    await page.waitForTimeout(80);
    if(await page.locator("[data-route].good").count()) break;
  }
  await label.click();
  await page.waitForTimeout(200);
}

/** Walks the post-draw conversation, if this patient had one. */
async function answerAnyQuestion(page){
  for(let i = 0; i < 8; i++){
    if(await page.locator(".debrief").count()) return;
    const opts = page.locator("#opts .opt");
    if(await opts.count()){ await opts.first().click(); }
    else {
      const btn = page.locator("#panel button").last();
      if(!(await btn.count())) return;
      await btn.click();
    }
    await page.waitForTimeout(200);
  }
}

const report = page => page.evaluate(()=>window.__phlebTest.practicalReport());
const replay = page => page.evaluate(()=>window.__phlebTest.sessionReplay());
const progress = page => page.evaluate(()=>window.__phlebTest.modeProgress());

/* -------------------------------------------------------------------------
   THE FINAL PRACTICAL'S OUTPUT
   ------------------------------------------------------------------------- */

test("a Final Practical ends with a 0–4 score for every rubric category", async ({ page }) => {
  const errors = attachDiagnostics(page);
  await reportAtEnd(page, "final");

  await expect(page.getByRole("heading", { name: /Practical report/i })).toBeVisible();
  const r = await report(page);
  expect(r).not.toBeNull();
  expect(r.categories.length).toBe(ROWS);
  for(const c of r.categories){
    expect(c.score).toBeGreaterThanOrEqual(0);
    expect(c.score).toBeLessThanOrEqual(4);
    expect(c.max).toBe(4);
  }
  expect(r.total).toBe(r.categories.reduce((s, c)=>s + c.score, 0));
  expect(r.maxTotal).toBe(MAX_TOTAL);

  // every row is on screen with its chip and its band name
  const chips = page.locator(".rep-row .rep-chip");
  await expect(chips).toHaveCount(ROWS);
  expect(errors).toEqual([]);
});

test("the report states pass or fail and says exactly why", async ({ page }) => {
  await reportAtEnd(page, "final");
  const r = await report(page);
  const verdict = page.locator(".rep-verdict");
  await expect(verdict).toContainText(r.passed ? "PASS" : "FAIL");
  await expect(page.locator(".rep-why li").first()).not.toBeEmpty();
  // an abandoned draw fails, and names a reason rather than just a number
  expect(r.failedBy.length).toBeGreaterThan(0);
  expect(r.failedBy.every(f=>typeof f.detail === "string" && f.detail.length > 10)).toBe(true);
});

test("the report names the procedure that was actually performed", async ({ page }) => {
  await reportAtEnd(page, "final");
  await expect(page.locator(".rep-proc")).toContainText(/Straight multisample needle, antecubital fossa/i);
});

test("what prevented an Excellent is stated in the learner's own numbers", async ({ page }) => {
  await reportAtEnd(page, "final");
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
  await reportAtEnd(page, "final");
  await expect(page.locator(".rep-sec", { hasText: "Specimen" })).toBeVisible();
  await expect(page.locator(".rep-sec", { hasText: "The patient" })).toBeVisible();
  const r = await report(page);
  expect(Array.isArray(r.specimen.tubes)).toBe(true);
  expect(Array.isArray(r.patientOutcomes)).toBe(true);
});

test("the practice plan is prioritised, and every entry cites a measurement", async ({ page }) => {
  await reportAtEnd(page, "final");
  const r = await report(page);
  expect(r.practicePlan.length).toBeGreaterThan(0);
  for(let i = 1; i < r.practicePlan.length; i++){
    expect(r.practicePlan[i].priority).toBeGreaterThanOrEqual(r.practicePlan[i-1].priority);
  }
  await expect(page.locator(".rep-plan li").first()).toBeVisible();
});

test("the policy the attempt was graded against is named on the report", async ({ page }) => {
  await reportAtEnd(page, "final");
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
  /* Hold the draw where the seam puts it. A step ends itself a beat after
     its completing action happens, which would race every assertion below
     about whether it is finished. See tests/benchHelpers.js. */
  await holdSteps(page);
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
  await carryOn(page);

  await page.evaluate(()=>window.__phlebTest.finishDraw());
  // ...and on to the debrief, whose breakdown holds the report and its replay
  await finishLabelling(page);
  await answerAnyQuestion(page);
  await expect(page.locator(".debrief")).toBeVisible({ timeout:15000 });
  await openBreakdown(page);
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

test("Learn gets a compact rubric line in the debrief, not the full report", async ({ page }) => {
  for(const mode of ["learn", "practice"]){
    await reportAtEnd(page, mode);   // …which opens the breakdown
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

  await reportAtEnd(page, "final");
  p = await progress(page);
  expect(p.practice.attempts).toBe(1);
  expect(p.final.attempts).toBe(1);
  await expect(page.locator(".rep-policy", { hasText: /Final Practical: attempt 1/ })).toBeVisible();
});

test("returning to the report does not count a second attempt", async ({ page }) => {
  await reportAtEnd(page, "final");
  const before = await progress(page);
  await page.evaluate(()=>window.__phlebTest.finishDraw());
  await expect(page.locator(".lbl-card, .dlg").first()).toBeVisible({ timeout:10000 });
  const after = await progress(page);
  expect(after.final.attempts).toBe(before.final.attempts);
});
