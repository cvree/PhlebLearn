/* =========================================================================
   THE BUTTERFLY / DORSAL-HAND DRAW — browser acceptance tests against the
   PRODUCTION build.

   The unit tests prove the numbers (the procedure model, the hand vessel
   geometry, the wing/tubing physics). These prove the SECOND PROCEDURE is
   actually reachable and playable end to end through the real screens: a
   dorsal-hand vessel set on the same limb mesh, a tourniquet judged against
   its own window, wing and tubing controls inside the real insert and
   collection coaches, and a final report that names the device and site it
   was actually given — not the straight-needle defaults.

   Because the wing/tubing physics are only wired through the accessible
   controls (the live 3D drag would need a whole second raycasting surface
   this branch does not attempt — see docs/HANDOFF.md), every interaction
   here goes through `[data-*]` controls, exactly as a keyboard-only learner
   would use them.
   ========================================================================= */
import { test, expect } from "@playwright/test";
import { carryOn, holdSteps } from "./benchHelpers.js";

const ALLOWLISTED_WARNINGS = [
  /THREE\.Clock: This module has been deprecated/,
  /THREE\.WebGLShadowMap: PCFSoftShadowMap has been deprecated/,
  /GL Driver Message/,
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

async function openAs(page, stepId, mode, procedureId){
  await page.goto("./?e2e=1");
  await expect(page.locator("canvas")).toBeVisible({ timeout:15000 });
  await page.waitForFunction(()=>!!window.__phlebTest, null, { timeout:15000 });
  /* Hold the draw where the seam puts it. A step ends itself a beat after
     its completing action happens, which would race every assertion below
     about whether it is finished. See tests/benchHelpers.js. */
  await holdSteps(page);
  await page.evaluate(a=>window.__phlebTest.gotoProcedureStep(a[0], ["lightblue","lavender"], a[1], a[2]),
    [stepId, mode || "final", procedureId]);
  await expect(page.locator("#vpStage")).toBeVisible({ timeout:10000 });
}

const procedure = page => page.evaluate(()=>window.__phlebTest.procedureSnapshot());
const butterfly = page => page.evaluate(()=>window.__phlebTest.butterflySnapshot());
const insertSnap = page => page.evaluate(()=>window.__phlebTest.insertSnapshot());
const tourniquetSnap = page => page.evaluate(()=>window.__phlebTest.tourniquetSnapshot());

/* -------------------------------------------------------------------------
   THE PROCEDURE ITSELF
   ------------------------------------------------------------------------- */

test("the butterfly procedure builds a real dorsal-hand vessel set on the same limb", async ({ page }) => {
  const errors = attachDiagnostics(page);
  await openAs(page, "insert", "final", "butterfly-hand");
  const proc = await procedure(page);
  expect(proc.device).toBe("butterfly");
  expect(proc.siteKind).toBe("hand");
  expect(proc.gauge).toBe(23);
  expect(proc.angle.ideal).toEqual({ min: 5, max: 15 });
  expect(proc.armVessels.sort()).toEqual(
    ["dorsal-metacarpal-3", "dorsal-metacarpal-4", "dorsal-venous-arch", "extensor-tendon"].sort());
  expect(errors).toEqual([]);
});

test("a straight-needle draw forced explicitly is identical to the unforced default", async ({ page }) => {
  await openAs(page, "insert", "final", "straight-antecubital");
  const proc = await procedure(page);
  expect(proc.device).toBe("straight");
  expect(proc.siteKind).toBe("antecubital");
  expect(proc.gauge).toBe(21);
  expect(proc.armVessels.sort()).toEqual(
    ["basilic", "biceps-tendon", "brachial-artery", "cephalic", "median-cubital", "median-nerve"].sort());
});

/* -------------------------------------------------------------------------
   TOURNIQUET — its own window, and the vessel set survives it
   ------------------------------------------------------------------------- */

test("the tourniquet's height dropdown offers the hand draw's own window, and defaults to its ideal", async ({ page }) => {
  const errors = attachDiagnostics(page);
  await openAs(page, "tourniquet", "final", "butterfly-hand");
  await expect(page.locator(".tq-coach")).toBeVisible({ timeout:10000 });
  // controls-only by design for the hand draw — no 3D toggle to click past
  await expect(page.locator("#tqView")).toHaveCount(0);
  await expect(page.locator("#tqHeight")).toBeVisible();

  const values = await page.locator("#tqHeight option").evaluateAll(
    opts => opts.map(o => parseFloat(o.value)));
  // every offered height is inside the hand's own window's neighbourhood,
  // nowhere near the antecubital's absolute-world-space 0.038-0.140
  expect(Math.max(...values)).toBeLessThan(-0.1);

  await page.locator("#tqApply").click();
  const snap = await tourniquetSnap(page);
  expect(snap.ready).toBe(true);
  expect(snap.heightAboveSite).toBeGreaterThanOrEqual(0.050);
  expect(snap.heightAboveSite).toBeLessThanOrEqual(0.076);
  expect(errors).toEqual([]);
});

test("a straight-needle attempt's height dropdown is byte-identical to before", async ({ page }) => {
  await openAs(page, "tourniquet", "final", "straight-antecubital");
  await page.locator("#tqView").click();   // 3D is available and default here; switch to controls
  const values = await page.locator("#tqHeight option").evaluateAll(
    opts => opts.map(o => parseFloat(o.value)));
  expect(values).toEqual([0.038, 0.064, 0.089, 0.114, 0.140]);
  await page.locator("#tqApply").click();
  const snap = await tourniquetSnap(page);
  expect(snap.bandX).toBe(0.089);
  expect(snap.heightAboveSite).toBe(0.089);
  expect(snap.ready).toBe(true);
});

test("the hand vessel set survives the tourniquet step, not silently swapped back to the forearm's", async ({ page }) => {
  const errors = attachDiagnostics(page);
  await openAs(page, "tourniquet", "final", "butterfly-hand");
  const before = await procedure(page);
  await page.locator("#tqApply").click();
  await carryOn(page);
  await expect(page.locator(".plp-coach")).toBeVisible({ timeout:10000 });
  const after = await procedure(page);
  expect(after.armVessels.sort()).toEqual(before.armVessels.sort());
  expect(after.armVessels).toContain("dorsal-metacarpal-3");
  expect(errors).toEqual([]);
});

/* -------------------------------------------------------------------------
   PALPATION — the hand's own, unnamed spots
   ------------------------------------------------------------------------- */

test("palpation offers the dorsal-hand spots, not the antecubital ones", async ({ page }) => {
  await openAs(page, "palpate", "final", "butterfly-hand");
  await expect(page.locator(".plp-coach")).toBeVisible({ timeout:10000 });
  await expect(page.locator('[data-press="dorsal-metacarpal-3"]')).toBeVisible();
  await expect(page.locator('[data-press="median-cubital"]')).toHaveCount(0);
});

test("choosing a hand vein sets the site the rest of the draw inherits", async ({ page }) => {
  await openAs(page, "palpate", "final", "butterfly-hand");
  await page.locator('[data-press="dorsal-metacarpal-3"]').click();
  // Choosing is an action on one of the learner's own traces now — there is
  // no way to commit to a spot that was never pressed.
  await page.locator("[data-choose-trace]").first().click();
  await carryOn(page);
  await expect(page.locator(".cln-coach")).toBeVisible({ timeout:10000 });   // cleaning's coach
});

/* -------------------------------------------------------------------------
   INSERT — the wings, the window, the vessel-matched depth
   ------------------------------------------------------------------------- */

test("insert offers no 3D toggle for the hand draw — controls only, on purpose", async ({ page }) => {
  await openAs(page, "insert", "final", "butterfly-hand");
  await expect(page.locator(".asm-coach")).toBeVisible({ timeout:10000 });
  await expect(page.locator("#insView")).toHaveCount(0);
});

test("carrying the set by its wings, entering, and the flash all use the hand's own numbers", async ({ page }) => {
  const errors = attachDiagnostics(page);
  await openAs(page, "insert", "final", "butterfly-hand");
  await page.locator('[data-wing="pinch"]').click();
  await page.locator('[data-ins="anchor-ideal"]').click();
  await page.locator('[data-ins="insert-ideal"]').click();

  const bf = await butterfly(page);
  expect(bf.entered).toBe(true);
  expect(bf.entryAngleDeg).toBeGreaterThanOrEqual(5);
  expect(bf.entryAngleDeg).toBeLessThanOrEqual(15);

  const ins = await insertSnap(page);
  expect(ins.inVein).toBe(true);            // the vessel-matched depth preset lands a real flash
  expect(ins.vesselDepthM).toBeLessThan(0.003);   // genuinely a hand vein's depth, not the forearm's
  await expect(page.locator(".ins-flash")).toBeVisible();
  expect(errors).toEqual([]);
});

test("carrying the set by the tubing instead of the wings is a real, selectable choice", async ({ page }) => {
  await openAs(page, "insert", "final", "butterfly-hand");
  await page.locator('[data-wing="tubing"]').click();
  await page.locator('[data-ins="anchor-ideal"]').click();
  await page.locator('[data-ins="insert-ideal"]').click();
  const bf = await butterfly(page);
  expect(bf.entered).toBe(true);
  expect(bf.wingsHeld).toBe(false);
});

test("laying the wings flat and taping them down are separate, sequential actions", async ({ page }) => {
  await openAs(page, "insert", "final", "butterfly-hand");
  await page.locator('[data-wing="pinch"]').click();
  await page.locator('[data-ins="anchor-ideal"]').click();
  await page.locator('[data-ins="insert-ideal"]').click();

  let bf = await butterfly(page);
  expect(bf.wings).toBe("pinched");
  expect(bf.secured).toBe(false);

  await page.locator('[data-wing="flat"]').click();
  bf = await butterfly(page);
  expect(bf.wings).toBe("flat");
  expect(bf.secured).toBe(false);

  await page.locator('[data-wing="secure"]').click();
  bf = await butterfly(page);
  expect(bf.secured).toBe(true);
});

test("the entry angle preset buttons offer the hand's own window, not 20/5/45", async ({ page }) => {
  await openAs(page, "insert", "final", "butterfly-hand");
  await page.locator('[data-ins="anchor-ideal"]').click();   // insert-* buttons only show once anchored
  await expect(page.locator('[data-ins="insert-ideal"]')).toContainText(/\b(9|10|11)°/);
  await expect(page.locator('[data-ins="insert-steep"]')).toContainText(/25°/);
  await expect(page.locator('[data-ins="insert-shallow"]')).not.toContainText(/5°/);
});

/* -------------------------------------------------------------------------
   COLLECTION — the tubing's physics, live in the same screen tube changes use
   ------------------------------------------------------------------------- */

async function enterAndSecure(page){
  await page.locator('[data-wing="pinch"]').click();
  await page.locator('[data-ins="anchor-ideal"]').click();
  await page.locator('[data-ins="insert-ideal"]').click();
  await page.locator('[data-wing="flat"]').click();
}

test("a taped-down line barely moves the tip through ordinary tube changes", async ({ page }) => {
  test.slow();
  await openAs(page, "insert", "final", "butterfly-hand");
  await enterAndSecure(page);
  await page.locator('[data-wing="secure"]').click();
  await carryOn(page);
  await expect(page.locator(".asm-coach")).toBeVisible({ timeout:10000 });   // collection's coach

  await page.locator('[data-col^="take:"]').first().click();
  await page.locator('[data-col="push-braced"]').click();
  for(let i = 0; i < 6; i++){ await page.locator('[data-col="wait"]').click(); await page.waitForTimeout(60); }
  await page.locator('[data-col="remove-braced"]').click();

  const bf = await butterfly(page);
  expect(bf.tipOffsetMm).toBeLessThan(1.5);
});

test("a loose, unsecured line transmits far more of the same tube changes", async ({ page }) => {
  test.slow();
  await openAs(page, "insert", "final", "butterfly-hand");
  await enterAndSecure(page);
  // deliberately never taped down
  await carryOn(page);
  await expect(page.locator(".asm-coach")).toBeVisible({ timeout:10000 });

  await page.locator('[data-col^="take:"]').first().click();
  await page.locator('[data-col="push-braced"]').click();
  for(let i = 0; i < 6; i++){ await page.locator('[data-col="wait"]').click(); await page.waitForTimeout(60); }
  await page.locator('[data-col="remove-braced"]').click();

  const bf = await butterfly(page);
  expect(bf.tipOffsetMm).toBeGreaterThan(1.5);
  expect(bf.secured).toBe(false);
});

/* -------------------------------------------------------------------------
   THE WHOLE ATTEMPT: report names the procedure it was actually given
   ------------------------------------------------------------------------- */

test("a butterfly-hand attempt's report names the device and site it actually used", async ({ page }) => {
  test.slow();
  const errors = attachDiagnostics(page);
  await openAs(page, "insert", "final", "butterfly-hand");
  await enterAndSecure(page);
  await page.locator('[data-wing="secure"]').click();
  await carryOn(page);
  await expect(page.locator(".asm-coach")).toBeVisible({ timeout:10000 });

  await page.locator('[data-col^="take:"]').first().click();
  await page.locator('[data-col="push-braced"]').click();
  for(let i = 0; i < 8; i++){ await page.locator('[data-col="wait"]').click(); await page.waitForTimeout(60); }
  await page.locator('[data-col="remove-braced"]').click();
  await carryOn(page);

  /* Straight to the end of the draw. This used to walk release → withdraw →
     safety → dispose → pressure → bandage → invert by pressing the generic
     "Carry on", reading the panel's <h2> each time to know when to stop —
     and Play has no <h2> during a draw (it is a HUD), so the loop was
     waiting on an element that only appears once the draw is over. What the
     test is actually about is the REPORT naming the procedure it was given,
     and the report is graded the moment the draw ends however it ends. */
  await page.evaluate(()=>window.__phlebTest.finishDraw());

  // …and it is a report you can actually reach: label the tubes, route them,
  // answer whatever they asked, and open the debrief's breakdown.
  await expect(page.locator(".lbl-card, .dlg").first()).toBeVisible({ timeout:10000 });
  const match = page.locator("#lblMatch");
  if(await match.count()) await match.click();
  for(let i = 0; i < 3; i++){
    const r = page.locator("[data-route]").nth(i);
    if(await r.count()) await r.click();
    if(await page.locator("[data-route].good").count()) break;
  }
  const print = page.locator("#print");
  if(await print.count()) await print.click();
  const opt = page.locator("#opts .opt").first();
  if(await opt.count()) await opt.click();
  const exDone = page.locator("#exDone");
  if(await exDone.count()) await exDone.click();
  await expect(page.locator(".debrief")).toBeVisible({ timeout:15000 });
  await page.locator("#dbDetails").click();
  await expect(page.getByRole("heading", { name: /Practical report/i })).toBeVisible({ timeout:10000 });

  const report = await page.evaluate(()=>window.__phlebTest.practicalReport());
  expect(report.procedure.device).toBe("butterfly");
  expect(report.procedure.site).toBe("hand");
  expect(report.procedure.label).toMatch(/Butterfly.*dorsal hand/);
  const technique = report.categories.find(c => c.id === "technique");
  expect(technique.present).toContain("butterfly");
  expect(errors).toEqual([]);
});

test("a straight-needle attempt's technique row never mentions the winged set", async ({ page }) => {
  await openAs(page, "insert", "final", "straight-antecubital");
  await page.locator("#insView").click();   // 3D is available and default here; switch to controls
  await page.locator('[data-ins="anchor-ideal"]').click();
  await page.locator('[data-ins="insert-ideal"]').click();
  await carryOn(page);
  await expect(page.locator(".asm-coach")).toBeVisible({ timeout:10000 });
  await page.evaluate(()=>window.__phlebTest.finishDraw());
  const report = await page.evaluate(()=>window.__phlebTest.practicalReport());
  const technique = report.categories.find(c => c.id === "technique");
  expect(technique.present).not.toContain("butterfly");
  expect(report.procedure.device).toBe("straight");
});
