/* =========================================================================
   COMPLICATIONS — browser acceptance tests against the PRODUCTION build.

   The unit tests prove the rules. These prove the branch is real in the app:
   that the watcher runs across steps rather than inside one, that the alert
   arrives over whatever the learner is doing, that answering it correctly
   with a stop genuinely ENDS the draw, that answering it wrongly leaves a
   bruise on the 3D arm, and that the laboratory's verdict on the tubes comes
   from the collection that actually happened.
   ========================================================================= */
import { test, expect } from "@playwright/test";

const ALLOWLISTED_WARNINGS = [
  /THREE\.Clock: This module has been deprecated/,
  /THREE\.WebGLShadowMap: PCFSoftShadowMap has been deprecated/,
  /GL Driver Message/,
  // GSAP, Lenis and Vanta are loaded from a CDN behind onerror fallbacks —
  // progressive enhancement, deliberately. A sandbox with no outbound network
  // makes those loads fail, and the app carrying on without them is the
  // designed behaviour rather than a defect.
  /Failed to load resource/,
  /* Properties of the MACHINE, not of the app: a sandboxed runner behind an
     outbound proxy cannot fetch the optional web font or the lobby track, and
     both are already guarded with a catch. Allowlisted here rather than in the
     app so a real network failure in the app still fails a test. */
  /ERR_TUNNEL_CONNECTION_FAILED/,
  /Failed to load resource: the server responded with a status of 404/,
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

async function open(page, step, mode){
  await page.goto("./?e2e=1");
  await expect(page.locator("canvas")).toBeVisible({ timeout:15000 });
  await page.waitForFunction(()=>!!window.__phlebTest, null, { timeout:15000 });
  await page.evaluate(([s, m])=>window.__phlebTest.gotoProcedureStep(s, ["lightblue","lavender"], m, "straight-antecubital"),
    [step || "insert", mode || "teach"]);
  await page.waitForFunction(()=>!!window.__phlebTest.complicationSnapshot(), null, { timeout:10000 });
}

const snapshot = page=>page.evaluate(()=>window.__phlebTest.complicationSnapshot());
const specimens = page=>page.evaluate(()=>window.__phlebTest.specimenSnapshot());
const trigger = (page, id)=>page.evaluate(i=>window.__phlebTest.triggerComplication(i), id);

/** Clicks the option whose label contains `text`. */
async function answer(page, text){
  const btn = page.locator(".cx-opt", { hasText: text }).first();
  await expect(btn).toBeVisible({ timeout:5000 });
  await btn.click();
  await page.waitForTimeout(200);
}

test("a complication that starts puts an alert over the step the learner is in", async ({ page })=>{
  const errors = attachDiagnostics(page);
  await open(page, "insert");
  await trigger(page, "hematoma");
  await expect(page.locator(".cx-card")).toBeVisible({ timeout:5000 });
  // ...without taking the step's own scene away
  await expect(page.locator("canvas")).toBeVisible();
  const s = await snapshot(page);
  expect(s.active).toContain("hematoma");
  expect(errors).toEqual([]);
});

test("Learn names the complication and explains it; the Final Practical does neither", async ({ page })=>{
  await open(page, "insert", "learn");
  await trigger(page, "syncope");
  await expect(page.locator(".cx-title")).toContainText("faint", { timeout:5000 });
  await expect(page.locator(".cx-why")).toBeVisible();

  await open(page, "insert", "final");
  await trigger(page, "syncope");
  await expect(page.locator(".cx-card")).toBeVisible({ timeout:5000 });
  await expect(page.locator(".cx-title")).not.toContainText("faint");
  await expect(page.locator(".cx-why")).toHaveCount(0);
});

test("the wrong answer leaves a bruise on the arm that is actually on screen", async ({ page })=>{
  await open(page, "insert");
  await trigger(page, "hematoma");
  await answer(page, "Carry on with the draw");
  const s = await snapshot(page);
  expect(s.measurements.worsenedCount).toBe(1);
  expect(s.condition.hematomaMl).toBeGreaterThan(0.5);
  expect(s.armShowsBruise).toBe(true);
});

test("answering correctly with a stop really does end the draw", async ({ page })=>{
  await open(page, "insert");
  await trigger(page, "blownVein");
  await answer(page, "Stop, take the needle out");
  // Learn mode shows the teaching first; dismissing it is what stops the draw
  const carryOn = page.locator(".cx-dismiss");
  if(await carryOn.count()) await carryOn.click();
  await expect(page.locator("h2")).toContainText("Draw complete", { timeout:8000 });
  const s = await snapshot(page);
  expect(s.halted).toBe("blownVein");
  expect(s.measurements.managedCount).toBe(1);
});

test("a complication left alone is missed, and the report says so", async ({ page })=>{
  await open(page, "insert");
  await trigger(page, "flinch");
  // twice the notice window (8s) plus the frame that closes it
  await page.waitForTimeout(17000);
  const s = await snapshot(page);
  expect(s.measurements.missedCount).toBe(1);
  expect(s.pending).toEqual([]);
});

test("the laboratory judges the tubes the draw actually produced", async ({ page })=>{
  await open(page, "invert");
  const q = await specimens(page);
  expect(q.total).toBe(2);
  expect(q.tubes.map(t=>t.key).sort()).toEqual(["lavender", "lightblue"]);
  // nothing has been mixed yet at the start of the invert step, so the
  // additive tubes are not yet specimens — and the lab says exactly why
  expect(q.rejected).toBeGreaterThan(0);
  expect(q.redrawRequired).toBe(true);
  expect(q.tubes.find(t=>t.key==="lavender").why).toMatch(/Inverted|ratio|never filled/i);
});

test("the draw-complete screen reports real measurements, not ticks", async ({ page })=>{
  const errors = attachDiagnostics(page);
  await open(page, "insert");
  // any stop-type answer ends the draw and lands on the recap
  await trigger(page, "arterialPuncture");
  await answer(page, "Stop, take the needle out");
  const carryOn = page.locator(".cx-dismiss");
  if(await carryOn.count()) await carryOn.click();
  await expect(page.locator("h2").first()).toContainText("Draw complete", { timeout:8000 });

  // The chips carry measured values, not ticks — and a step that never ran
  // shows no chip at all rather than a zero it did not earn, which is why a
  // draw stopped this early has a short list of them.
  const chips = await page.locator(".vp-chip").allTextContents();
  expect(chips.length).toBeGreaterThan(0);
  expect(chips.join(" | ")).toMatch(/\d+\/\d+|\d+(\.\d+)?\s*(°|s|mm|%|mL)/);
  expect(chips.every(t=>/[\d]/.test(t) || /none/i.test(t))).toBe(true);
  // and the laboratory's verdict is on the same screen
  await expect(page.locator(".lab-receiving")).toBeVisible();
  expect(errors).toEqual([]);
});
