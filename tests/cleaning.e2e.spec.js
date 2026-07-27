/* =========================================================================
   Aseptic site cleaning — browser acceptance tests against the PRODUCTION
   build. The unit tests prove the rules; these prove the step is real: that
   the coverage on the arm IS the measurement, that a sealed pad cleans
   nothing, that direction and drying are enforced, and that touching the
   site again undoes it.
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

async function openCleaning(page, mode){
  await page.goto("./?e2e=1");
  await expect(page.locator("canvas")).toBeVisible({ timeout:15000 });
  await page.waitForFunction(()=>!!window.__phlebTest, null, { timeout:15000 });
  await page.evaluate(m=>window.__phlebTest.gotoProcedureStep("clean", ["lightblue","lavender"], m), mode||"teach");
  await expect(page.locator(".cln-coach")).toBeVisible({ timeout:10000 });
  await page.waitForFunction(async ()=>!!(await window.__phlebTest.screenPointOnField(0, 0)), null, { timeout:10000 });
}

const snapshot = page=>page.evaluate(()=>window.__phlebTest.cleaningSnapshot());
const onField = (page, dx, dz)=>page.evaluate(a=>window.__phlebTest.screenPointOnField(a[0], a[1]), [dx, dz]);
const dry = (page, s)=>page.evaluate(v=>window.__phlebTest.fastForwardDrying(v), s);

/** Scrubs an outward spiral over the field with the pointer. */
async function scrubSpiral(page, frac, turns){
  const f = frac == null ? 1 : frac;
  const R = 0.025*f;
  const pts = [];
  for(let i = 0; i <= 55; i++){
    const a = (i/55)*Math.PI*2*(turns || 5);
    const r = (i/55)*R;
    pts.push([Math.cos(a)*r, Math.sin(a)*r]);
  }
  const screen = await page.evaluate(async list=>{
    const out = [];
    for(const [dx, dz] of list) out.push(await window.__phlebTest.screenPointOnField(dx, dz));
    return out;
  }, pts);

  await page.mouse.move(screen[0].x, screen[0].y);
  await page.mouse.down();
  for(const p of screen) await page.mouse.move(p.x, p.y);
  await page.mouse.up();
  await page.waitForTimeout(150);
}

/* ---------- the step is real ------------------------------------------------- */

test("cleaning is a real field on the arm, not a drag-the-sponge widget", async ({ page })=>{
  const errors = attachDiagnostics(page);
  await openCleaning(page, "teach");
  await expect(page.locator("#vpSwab")).toHaveCount(0);
  await expect(page.locator(".vp-cleanzone")).toHaveCount(0);

  const snap = await snapshot(page);
  expect(snap.swabOpen).toBe(false);
  expect(snap.coverage).toBe(0);
  expect(errors).toEqual([]);
});

test("a sealed pad cleans nothing, however hard you scrub", async ({ page })=>{
  await openCleaning(page, "teach");
  await scrubSpiral(page, 1);
  const snap = await snapshot(page);
  expect(snap.coverage).toBe(0);
  expect(snap.strokes).toBe(0);
  expect(snap.blocking).toContain("notCleaned");
});

/* ---------- coverage is the measurement --------------------------------------- */

test("scrubbing outward covers the field and is accepted once dry", async ({ page })=>{
  const errors = attachDiagnostics(page);
  await openCleaning(page, "teach");
  await page.locator("#clnOpen").click();
  await scrubSpiral(page, 1);

  const wet = await snapshot(page);
  expect(wet.coverage).toBeGreaterThan(0.8);
  expect(wet.outward).toBeGreaterThan(0.6);
  // still wet — the draw cannot proceed
  expect(wet.ready).toBe(false);
  expect(wet.blocking).toContain("stillWet");
  await expect(page.locator("#clnReady")).toBeDisabled();

  await dry(page, 35);
  await page.waitForTimeout(200);
  const dried = await snapshot(page);
  expect(dried.dryness).toBe(1);
  expect(dried.ready).toBe(true);
  await expect(page.locator("#clnReady")).toBeEnabled();
  expect(errors).toEqual([]);
});

test("scrubbing only the middle leaves the field short and is blocked", async ({ page })=>{
  await openCleaning(page, "teach");
  await page.locator("#clnOpen").click();
  await scrubSpiral(page, 0.4);
  await dry(page, 35);
  await page.waitForTimeout(150);

  const snap = await snapshot(page);
  expect(snap.coverage).toBeLessThan(0.8);
  expect(snap.blocking).toContain("underCovered");
  expect(snap.ready).toBe(false);
});

test("the coverage readout tracks the scrubbing", async ({ page })=>{
  test.setTimeout(60000);   // two full pointer-driven scrubs
  await openCleaning(page, "teach");
  await page.locator("#clnOpen").click();
  await scrubSpiral(page, 0.5);
  const partial = await page.locator('[data-live="cov"]').innerText();
  await scrubSpiral(page, 1);
  const full = await page.locator('[data-live="cov"]').innerText();
  expect(parseInt(full)).toBeGreaterThan(parseInt(partial));
});

/* ---------- drying ------------------------------------------------------------- */

test("the drying clock is real and gates the step", async ({ page })=>{
  await openCleaning(page, "teach");
  await page.locator("#clnOpen").click();
  await scrubSpiral(page, 1);

  await dry(page, 15);
  await page.waitForTimeout(200);
  const half = await snapshot(page);
  expect(half.dryness).toBeGreaterThan(0);
  expect(half.dryness).toBeLessThan(1);
  expect(half.issues).toContain("notDryYet");
  expect(half.ready).toBe(false);

  await dry(page, 20);
  await page.waitForTimeout(200);
  expect((await snapshot(page)).ready).toBe(true);
});

/* ---------- re-contamination ---------------------------------------------------- */

test("touching the site after it is clean and dry undoes it", async ({ page })=>{
  await openCleaning(page, "teach");
  await page.locator("#clnOpen").click();
  await scrubSpiral(page, 1);
  await dry(page, 35);
  await page.waitForTimeout(150);
  expect((await snapshot(page)).ready).toBe(true);

  // go back and touch it
  const p = await onField(page, 0, 0);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(200);

  const snap = await snapshot(page);
  expect(snap.retouched).toBe(true);
  expect(snap.blocking).toContain("retouched");
  expect(snap.ready).toBe(false);
  await expect(page.locator("#clnReady")).toBeDisabled();
});

/* ---------- the accessible path -------------------------------------------------- */

test("the controls path scrubs for real and is judged the same way", async ({ page })=>{
  await openCleaning(page, "teach");
  await page.locator("#clnView").click();
  await expect(page.locator(".cln-controls")).toBeVisible();

  await page.locator("#clnOpen").click();
  await page.locator('[data-scrub="spiral-full"]').click();
  await page.waitForTimeout(200);
  await dry(page, 35);
  await page.waitForTimeout(200);

  const snap = await snapshot(page);
  expect(snap.coverage).toBeGreaterThan(0.8);
  expect(snap.outward).toBeGreaterThan(0.6);
  expect(snap.ready).toBe(true);
});

test("the controls path can produce a bad prep too — it is not an easier game", async ({ page })=>{
  await openCleaning(page, "teach");
  await page.locator("#clnView").click();
  await page.locator("#clnOpen").click();
  await page.locator('[data-scrub="spiral-small"]').click();
  await page.waitForTimeout(200);
  await dry(page, 35);
  await page.waitForTimeout(200);

  const snap = await snapshot(page);
  expect(snap.blocking).toContain("underCovered");
  await expect(page.locator("#clnReady")).toBeDisabled();
});

test("scrubbing back and forth is recorded as working inward", async ({ page })=>{
  await openCleaning(page, "teach");
  await page.locator("#clnView").click();
  await page.locator("#clnOpen").click();
  await page.locator('[data-scrub="backforth"]').click();
  await page.waitForTimeout(200);

  const snap = await snapshot(page);
  expect(snap.outward).toBeLessThan(0.6);
  expect(snap.issues).toContain("scrubbedInward");
});

/* ---------- scored mode ----------------------------------------------------------- */

test("a scored shift lets a wet, half-scrubbed site through and carries it forward", async ({ page })=>{
  await openCleaning(page, "play");
  await page.locator("#clnOpen").click();
  await scrubSpiral(page, 0.4);

  const ready = page.locator("#clnReady");
  await expect(ready).toBeEnabled();
  const before = await snapshot(page);
  expect(before.blocking.length).toBeGreaterThan(0);

  await ready.click();
  await page.waitForTimeout(400);
  await expect(page.locator(".cln-coach")).toHaveCount(0);
});
