/* =========================================================================
   Anchor + insert — browser acceptance tests against the PRODUCTION build.

   The unit tests prove the rules; these prove the step is real: that the
   thumb anchors the skin with a real pull, that the needle's angle comes
   from how it was actually carried in, that depth advances and withdraws
   with continued dragging, that a stick that never lands on the vein does
   not flash just because the depth number happens to line up, and that the
   bevel inherited from uncap can still block a stick that would otherwise
   be clean.
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

async function open(page, mode){
  await page.goto("./?e2e=1");
  await expect(page.locator("canvas")).toBeVisible({ timeout:15000 });
  await page.waitForFunction(()=>!!window.__phlebTest, null, { timeout:15000 });
  await page.evaluate(m=>window.__phlebTest.gotoProcedureStep("insert", ["lightblue","lavender"], m, "straight-antecubital"), mode||"teach");
  await expect(page.locator(".asm-coach")).toBeVisible({ timeout:10000 });
  await page.waitForFunction(async ()=>!!(await window.__phlebTest.insertAnchors()), null, { timeout:10000 });
}

const snapshot = page=>page.evaluate(()=>window.__phlebTest.insertSnapshot());
const anchors = page=>page.evaluate(()=>window.__phlebTest.insertAnchors());
const radiusAt = (page, x)=>page.evaluate(xx=>window.__phlebTest.insertLimbRadiusAt(xx), x);
const onLimb = (page, list)=>page.evaluate(l=>window.__phlebTest.screenPointsOnInsertLimb(l), list);

/** Drags a two-point (down, up) gesture through the limb-surface projector. */
async function dragLimb(page, from, to, steps){
  const [a, b] = await onLimb(page, [from, to]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: steps || 24 });
  await page.mouse.up();
  await page.waitForTimeout(120);
}

/**
 * Anchors the vein: presses `pullMm` below the mark and pulls `pullMm`
 * millimetres further distal, staying on the skin the whole time.
 */
async function anchorDrag(page, offsetMm, pullMm){
  const a = await anchors(page);
  const downX = a.markX - offsetMm/1000;
  const upX = downX - pullMm/1000;
  const r = await radiusAt(page, downX);
  await dragLimb(page, [downX, a.theta0, r + 0.0012], [upX, a.theta0, (await radiusAt(page, upX)) + 0.0012], 18);
}

/**
 * Carries the needle from the ready pose to a chosen horizontal target,
 * overshooting the skin by a few millimetres so contact reliably triggers
 * regardless of the small approximation error a long straight drag picks up
 * against the runtime's fixed local basis.
 */
async function approachDrag(page, targetX, steps){
  const a = await anchors(page);
  const readyX = a.markX - a.readyDistal;
  const rReady = await radiusAt(page, readyX);
  const rTarget = await radiusAt(page, targetX);
  const from = [readyX, a.theta0, rReady + a.readyHeight];
  const to = [targetX, a.theta0, rTarget - 0.003];   // 3mm overshoot past the skin
  await dragLimb(page, from, to, steps || 30);
}

/* ---------- the step is real ------------------------------------------------------ */

test("insert is a real stick on the arm, not a drag-to-target widget", async ({ page })=>{
  const errors = attachDiagnostics(page);
  await open(page, "teach");
  await expect(page.locator("#vpSyr")).toHaveCount(0);
  await expect(page.locator(".vp-anglewedge")).toHaveCount(0);
  await expect(page.locator(".vp-target")).toHaveCount(0);

  const snap = await snapshot(page);
  expect(snap.anchorSet).toBe(false);
  expect(snap.entryX).toBeNull();
  expect(snap.blocking).toContain("notAnchored");
  expect(errors).toEqual([]);
});

/* ---------- anchor ------------------------------------------------------------------ */

test("pulling the skin taut anchors the vein with a real offset and pull", async ({ page })=>{
  const errors = attachDiagnostics(page);
  await open(page, "teach");
  await anchorDrag(page, 30, 16);   // 30mm below the mark, 16mm of pull

  const snap = await snapshot(page);
  expect(snap.anchorSet).toBe(true);
  expect(snap.anchorPull).toBeGreaterThan(0.010);
  expect(Math.abs(snap.anchorOffset - 0.030)).toBeLessThan(0.006);
  expect(snap.blocking).not.toContain("notAnchored");
  expect(errors).toEqual([]);
});

test("anchoring right on the mark instead of below it is caught", async ({ page })=>{
  await open(page, "teach");
  await anchorDrag(page, 5, 16);   // only 5mm below — too close

  const snap = await snapshot(page);
  expect(snap.anchorSet).toBe(true);
  expect(snap.issues).toContain("anchorTooClose");
});

test("anchoring proximal to the mark — the wrong side entirely — is caught", async ({ page })=>{
  await open(page, "teach");
  const a = await anchors(page);
  // the thumb presses ABOVE the mark, not below it, and pulls further that way
  const downX = a.markX + 0.010;
  const upX = downX + 0.016;
  const r1 = await radiusAt(page, downX), r2 = await radiusAt(page, upX);
  await dragLimb(page, [downX, a.theta0, r1 + 0.0012], [upX, a.theta0, r2 + 0.0012], 18);

  const snap = await snapshot(page);
  expect(snap.anchorSet).toBe(true);
  expect(snap.anchorOffset).toBeLessThanOrEqual(0);
  expect(snap.issues).toContain("anchorWrongSide");
});

/* ---------- the stick itself ---------------------------------------------------------- */

test("a natural straight carry from the ready pose to the mark lands in the ideal angle window and flashes", async ({ page })=>{
  const errors = attachDiagnostics(page);
  await open(page, "teach");
  await anchorDrag(page, 30, 16);

  const a = await anchors(page);
  await approachDrag(page, a.markX);

  const snap = await snapshot(page);
  expect(snap.entryX).not.toBeNull();
  expect(snap.angleDeg).toBeGreaterThanOrEqual(snap.angleIdeal.min - 3);
  expect(snap.angleDeg).toBeLessThanOrEqual(snap.angleIdeal.max + 3);
  expect(snap.inVein).toBe(true);
  expect(snap.flashAt).not.toBeNull();
  expect(snap.ready).toBe(true);
  await expect(page.locator("#insReady")).toBeEnabled();
  expect(errors).toEqual([]);
});

test("coming in too steep — a short, tall approach — is blocked", async ({ page })=>{
  await open(page, "teach");
  await anchorDrag(page, 30, 16);
  const a = await anchors(page);
  // only 10mm of horizontal run for the same 14mm of height: atan(14/10) ~= 54 degrees
  await approachDrag(page, a.markX - a.readyDistal + 0.010);

  const snap = await snapshot(page);
  expect(snap.entryX).not.toBeNull();
  expect(snap.angleDeg).toBeGreaterThan(40);
  expect(snap.blocking).toContain("tooSteep");
  expect(snap.ready).toBe(false);
});

test("coming in nearly flat is blocked", async ({ page })=>{
  await open(page, "teach");
  await anchorDrag(page, 30, 16);
  const a = await anchors(page);
  // 120mm of horizontal run for 14mm of height: atan(14/120) ~= 6.7 degrees
  await approachDrag(page, a.markX - a.readyDistal + 0.120);

  const snap = await snapshot(page);
  expect(snap.entryX).not.toBeNull();
  expect(snap.angleDeg).toBeLessThan(9);
  expect(snap.blocking).toContain("tooShallow");
});

test("advancing deepens the stick; easing back withdraws it", async ({ page })=>{
  await open(page, "teach");
  await anchorDrag(page, 30, 16);
  const a = await anchors(page);
  await approachDrag(page, a.markX);
  const afterEntry = await snapshot(page);
  expect(afterEntry.entryX).not.toBeNull();

  // advance further along the same line
  const r = await radiusAt(page, a.markX + 0.006);
  await dragLimb(page, [a.markX, a.theta0, r - 0.004], [a.markX + 0.006, a.theta0, r - 0.004], 12);
  const deeper = await snapshot(page);
  expect(deeper.depthM).toBeGreaterThan(afterEntry.depthM);

  // now ease back
  await dragLimb(page, [a.markX + 0.006, a.theta0, r - 0.004], [a.markX + 0.002, a.theta0, r - 0.004], 12);
  const eased = await snapshot(page);
  expect(eased.depthM).toBeLessThan(deeper.depthM);
});

test("advancing too far goes through the vein", async ({ page })=>{
  await open(page, "teach");
  await anchorDrag(page, 30, 16);
  const a = await anchors(page);
  await approachDrag(page, a.markX);

  // keep advancing well past the vessel's far wall
  const r = await radiusAt(page, a.markX + 0.020);
  await dragLimb(page, [a.markX, a.theta0, r - 0.010], [a.markX + 0.020, a.theta0, r - 0.010], 20);

  const snap = await snapshot(page);
  expect(snap.through).toBe(true);
  expect(snap.blocking).toContain("throughAndThrough");
  expect(snap.ready).toBe(false);
});

test("backing all the way out clears the entry, and a fresh line lands the flash", async ({ page })=>{
  const errors = attachDiagnostics(page);
  await open(page, "teach");
  await anchorDrag(page, 30, 16);
  const a = await anchors(page);

  // approach too steep on purpose, then pull all the way back out
  const steepX = a.markX - a.readyDistal + 0.010;
  const r0 = await radiusAt(page, steepX);
  await approachDrag(page, steepX);
  const stuck = await snapshot(page);
  expect(stuck.entryX).not.toBeNull();
  const readyR = await radiusAt(page, a.markX - a.readyDistal);
  await dragLimb(page, [steepX, a.theta0, r0 - 0.004], [steepX, a.theta0, readyR + 0.020], 20);

  const pulled = await snapshot(page);
  expect(pulled.entryX).toBeNull();
  expect(pulled.reapproaches).toBeGreaterThan(0);

  // now go again, cleanly
  await approachDrag(page, a.markX);
  const clean = await snapshot(page);
  expect(clean.ready).toBe(true);
  expect(errors).toEqual([]);
});

test("a plausible depth far from the vein is not a flash", async ({ page })=>{
  await open(page, "teach");
  await anchorDrag(page, 30, 16);
  const a = await anchors(page);
  // aim well off to the side of the vein, not at the mark
  await approachDrag(page, a.markX + 0.045);

  const snap = await snapshot(page);
  expect(snap.entryX).not.toBeNull();
  expect(snap.inVein).toBe(false);
  expect(snap.blocking).toContain("missedVein");
});

/* ---------- the bevel inherited from uncap ------------------------------------------- */

test("a bevel left down from uncap blocks an otherwise clean stick", async ({ page })=>{
  await open(page, "teach");
  // force the inherited unit's bevel back down, as if uncap had never rolled it up
  await page.evaluate(()=>window.__phlebTest.setNeedleBevelDeg(170));
  await anchorDrag(page, 30, 16);
  const a = await anchors(page);
  await approachDrag(page, a.markX);

  const snap = await snapshot(page);
  expect(snap.inVein).toBe(true);
  expect(snap.bevelDeg).toBeCloseTo(170, 0);
  expect(snap.blocking).toContain("bevelDown");
  expect(snap.ready).toBe(false);
});

/* ---------- the accessible path is the same rules ------------------------------------- */

test("the controls anchor and insert with the same rules, scene torn down", async ({ page })=>{
  const errors = attachDiagnostics(page);
  await open(page, "teach");
  await page.click("#insView");
  await expect(page.locator(".asm-controls")).toBeVisible();

  await page.click('[data-ins="anchor-ideal"]');
  let snap = await snapshot(page);
  expect(snap.anchorSet).toBe(true);
  expect(snap.issues.length).toBe(0);

  await page.click('[data-ins="insert-ideal"]');
  snap = await snapshot(page);
  expect(snap.inVein).toBe(true);
  expect(snap.ready).toBe(true);
  await expect(page.locator("#insReady")).toBeEnabled();
  expect(errors).toEqual([]);
});

test("the controls surface a steep entry and a redo of the anchor", async ({ page })=>{
  await open(page, "teach");
  await page.click("#insView");

  await page.click('[data-ins="anchor-close"]');
  expect((await snapshot(page)).issues).toContain("anchorTooClose");
  await page.click('[data-ins="redo-anchor"]');
  await page.click('[data-ins="anchor-ideal"]');
  expect((await snapshot(page)).issues.length).toBe(0);

  await page.click('[data-ins="insert-steep"]');
  const snap = await snapshot(page);
  expect(snap.blocking).toContain("tooSteep");
});

test("the controls can advance, retreat and pull all the way out", async ({ page })=>{
  await open(page, "teach");
  await page.click("#insView");
  await page.click('[data-ins="anchor-ideal"]');
  await page.click('[data-ins="insert-ideal"]');
  const before = await snapshot(page);

  await page.click('[data-ins="advance"]');
  expect((await snapshot(page)).depthM).toBeGreaterThan(before.depthM);

  await page.click('[data-ins="pullout"]');
  const pulled = await snapshot(page);
  expect(pulled.entryX).toBeNull();
  expect(pulled.reapproaches).toBeGreaterThan(0);
});

/* ---------- teaching mode explains; a scored shift does not --------------------------- */

test("a scored shift reports nothing and lets the learner commit anyway", async ({ page })=>{
  await open(page, "play");
  const body = await page.locator(".asm-coach").innerText();
  expect(body).not.toMatch(/anchor the vein first/i);
  expect(body).not.toMatch(/Not yet/);
  await expect(page.locator("#insReady")).toBeEnabled();
  expect((await snapshot(page)).ready).toBe(false);
});
