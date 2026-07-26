/* =========================================================================
   Physical supply staging — browser acceptance tests against the PRODUCTION
   build (vite preview, same base path GitHub Pages serves).

   These cover what the unit tests can't: that the 3D objects are really
   there, that a mouse drag and a touch drag both move the right object into
   the right zone, that released objects stay put, and that the old
   tap-an-emoji activity is gone.

   The tests enter the procedure through the ?e2e=1 seam (see main.js) rather
   than clicking a 15-screen randomised path, so a failure here means the
   staging mechanic broke, not that a different patient got rolled.
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

async function openStaging(page){
  await page.goto("./?e2e=1");
  await expect(page.locator("canvas")).toBeVisible({ timeout:15000 });
  await page.waitForFunction(()=>!!window.__phlebTest, null, { timeout:15000 });
  await page.evaluate(()=>window.__phlebTest.gotoProcedureStep("gather", ["lightblue","lavender"]));
  await expect(page.locator(".stg-coach")).toBeVisible({ timeout:10000 });
  await page.waitForFunction(async ()=>{
    const p = await window.__phlebTest.screenPointForZone("tray");
    return !!p;
  }, null, { timeout:10000 });
}

const snapshot = page=>page.evaluate(()=>window.__phlebTest.stagingSnapshot());
const pointFor = (page,id)=>page.evaluate(i=>window.__phlebTest.screenPointFor(i), id);
const pointForZone = (page,z)=>page.evaluate(zz=>window.__phlebTest.screenPointForZone(zz), z);

async function mouseDrag(page, from, to){
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x+to.x)/2, (from.y+to.y)/2, { steps:8 });
  await page.mouse.move(to.x, to.y, { steps:8 });
  await page.mouse.up();
  await page.waitForTimeout(320);   // let the settle tween finish
}

/* A real finger drag arrives as one burst of pointer events with
   pointerType:"touch", so it is dispatched as one burst here too. */
async function touchDrag(page, from, to){
  const trace = await page.evaluate(({ from, to })=>{
    const canvas = document.querySelector("canvas");
    const send = (type, x, y, buttons)=>canvas.dispatchEvent(new PointerEvent(type, {
      pointerId: 7, pointerType: "touch", isPrimary: true, bubbles: true, cancelable: true,
      clientX: x, clientY: y, buttons,
    }));
    const seen = [];
    const spy = e=>seen.push(`${e.type}@${Math.round(e.clientX)},${Math.round(e.clientY)}`);
    ["pointerdown","pointermove","pointerup"].forEach(t=>canvas.addEventListener(t, spy));
    send("pointerdown", from.x, from.y, 1);
    for(let i=1;i<=8;i++) send("pointermove", from.x + (to.x-from.x)*i/8, from.y + (to.y-from.y)*i/8, 1);
    send("pointerup", to.x, to.y, 0);
    ["pointerdown","pointermove","pointerup"].forEach(t=>canvas.removeEventListener(t, spy));
    return seen;
  }, { from, to });
  await page.waitForTimeout(320);
  return trace;
}

/** Stages a complete, correct work area through the list view. */
async function stageEverythingViaList(page){
  await page.locator("#stgView").click();
  await expect(page.locator(".stg-list")).toBeVisible();
  const snap = await snapshot(page);
  const usable = cat => snap.catalog.find(d=>d.category===cat && (!d.flaws || d.flaws.length===0));
  for(const cat of ["gloves","tourniquet","alcohol","needle","holder","gauze","bandage"]){
    const d = usable(cat);
    await page.locator(`[data-inspect="${d.id}"]`).click();
    await page.locator(`[data-stage="${d.id}"][data-zone="tray"]`).click();
  }
  for(const [i,k] of snap.requiredTubes.entries()){
    const d = snap.catalog.find(x=>x.category==="tube" && x.tubeKey===k && (!x.flaws || !x.flaws.length));
    await page.locator(`[data-stage="${d.id}"][data-zone="rack"][data-slot="${i}"]`).click();
  }
  const sharps = usable("sharps");
  await page.locator(`[data-stage="${sharps.id}"][data-zone="reach"]`).click();
}

/* ---------- the old activity is gone --------------------------------------- */

test("the supply step is a physical cart, not a grid of tappable emoji", async ({ page }) => {
  const errors = attachDiagnostics(page);
  await openStaging(page);

  // the retired activity's markup must not exist any more
  await expect(page.locator(".vp-gather")).toHaveCount(0);
  await expect(page.locator(".vp-supply")).toHaveCount(0);

  // the panel is a coach/status layer with a real readiness model behind it
  await expect(page.locator(".stg-checks .stg-chk")).toHaveCount(9);
  await expect(page.locator(".stg-msg")).toContainText(/still need|Not ready/i);

  // and there are real objects on a real cart
  const snap = await snapshot(page);
  expect(snap.catalog.length).toBeGreaterThanOrEqual(20);
  expect(errors).toEqual([]);
});

test("no emoji is used for any staged supply object", async ({ page }) => {
  await openStaging(page);
  await page.locator("#stgView").click();
  const text = await page.locator(".stg-list").innerText();
  expect(text.length).toBeGreaterThan(50);
  expect(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(text)).toBe(false);
});

/* ---------- mouse ------------------------------------------------------------ */

test("mouse dragging moves a specific object onto the tray and it stays there", async ({ page }) => {
  const errors = attachDiagnostics(page);
  await openStaging(page);

  const before = await snapshot(page);
  expect(before.zones.gloves_ok).toBe("shelf");

  await mouseDrag(page, await pointFor(page, "gloves_ok"), await pointForZone(page, "tray"));

  const after = await snapshot(page);
  expect(after.zones.gloves_ok).toBe("tray");
  expect(after.positions.gloves_ok).toBeTruthy();
  const restingSpot = after.positions.gloves_ok;

  // dragging a DIFFERENT object must not move the first one
  await mouseDrag(page, await pointFor(page, "gauze_ok"), await pointForZone(page, "tray"));
  const after2 = await snapshot(page);
  expect(after2.positions.gloves_ok).toEqual(restingSpot);
  expect(errors).toEqual([]);
});

test("a tube seats into a numbered rack slot only when dropped on it", async ({ page }) => {
  await openStaging(page);
  const snap = await snapshot(page);
  const first = snap.requiredTubes[0];
  const tube = snap.catalog.find(d=>d.category==="tube" && d.tubeKey===first && (!d.flaws || !d.flaws.length));

  // dropped in the middle of the tray: on the tray, not racked
  await mouseDrag(page, await pointFor(page, tube.id), await pointForZone(page, "tray"));
  expect((await snapshot(page)).zones[tube.id]).toBe("tray");

  // dropped on rack slot 1: seated
  await mouseDrag(page, await pointFor(page, tube.id), await pointForZone(page, "rack0"));
  expect((await snapshot(page)).zones[tube.id]).toBe("rack");
});

test("a wrong item stays where it is put, is explained, and can be replaced", async ({ page }) => {
  await openStaging(page);
  const snap = await snapshot(page);
  const wrongNeedle = snap.catalog.find(d=>(d.flaws||[]).includes("wrongGauge"));

  await mouseDrag(page, await pointFor(page, wrongNeedle.id), await pointForZone(page, "tray"));
  const after = await snapshot(page);
  expect(after.zones[wrongNeedle.id]).toBe("tray");        // it does NOT vanish
  await expect(page.locator(".stg-msg")).toContainText(/hemolys|25G|gauge/i);

  // remove it and put the right one on
  await page.locator("#stgView").click();
  await page.locator(`[data-return="${wrongNeedle.id}"]`).click();
  const good = snap.catalog.find(d=>d.category==="needle" && (!d.flaws || !d.flaws.length));
  await page.locator(`[data-stage="${good.id}"][data-zone="tray"]`).click();
  const recovered = await snapshot(page);
  expect(recovered.zones[wrongNeedle.id]).toBe("shelf");
  expect(recovered.zones[good.id]).toBe("tray");
});

/* ---------- touch -------------------------------------------------------------- */

test("touch dragging works the same way as mouse dragging", async ({ page }) => {
  const errors = attachDiagnostics(page);
  await openStaging(page);
  expect((await snapshot(page)).zones.tourniquet_ok).toBe("shelf");
  const trace = await touchDrag(page, await pointFor(page, "tourniquet_ok"), await pointForZone(page, "tray"));
  expect(trace.length, `pointer events never reached the canvas: ${JSON.stringify(trace)}`).toBe(10);
  expect((await snapshot(page)).zones.tourniquet_ok).toBe("tray");

  // a small tube is as grabbable by finger as a big box (pick proxies)
  const snap = await snapshot(page);
  const tube = snap.catalog.find(d=>d.category==="tube" && d.tubeKey===snap.requiredTubes[0] && !(d.flaws||[]).length);
  await touchDrag(page, await pointFor(page, tube.id), await pointForZone(page, "rack0"));
  expect((await snapshot(page)).zones[tube.id]).toBe("rack");
  expect(errors).toEqual([]);
});

/* ---------- handedness ---------------------------------------------------------- */

test("left-handed mode mirrors the staging zones on screen", async ({ page }) => {
  await openStaging(page);
  const rightTray = await pointForZone(page, "tray");
  const rightReach = await pointForZone(page, "reach");
  expect(rightTray.x).toBeLessThan(rightReach.x);

  await page.locator("#stgHand").click();
  await expect(page.locator("#stgHand")).toContainText(/Left-handed/);
  await page.waitForFunction(async ()=>{
    const p = await window.__phlebTest.screenPointForZone("tray");
    return !!p;
  }, null, { timeout:10000 });

  const leftTray = await pointForZone(page, "tray");
  const leftReach = await pointForZone(page, "reach");
  expect(leftTray.x).toBeGreaterThan(leftReach.x);
  expect((await snapshot(page)).handedness).toBe("left");
});

/* ---------- readiness gating ------------------------------------------------------ */

test("Tray ready stays locked until every condition is met, then advances the procedure", async ({ page }) => {
  const errors = attachDiagnostics(page);
  await openStaging(page);
  await expect(page.locator("#stgReady")).toBeDisabled();

  await stageEverythingViaList(page);

  const ready = await snapshot(page);
  expect(ready.blocking).toEqual([]);
  expect(ready.ready).toBe(true);
  await expect(page.locator("#stgReady")).toBeEnabled();

  await page.locator("#stgReady").click();
  // the next procedure step takes over the panel
  await expect(page.locator(".stg-coach")).toHaveCount(0, { timeout:5000 });
  await expect(page.locator(".vp-stage")).toBeVisible();
  expect(errors).toEqual([]);
});

test("an unreachable sharps container blocks readiness until it is moved", async ({ page }) => {
  await openStaging(page);
  await stageEverythingViaList(page);
  const snap = await snapshot(page);
  const sharps = snap.catalog.find(d=>d.category==="sharps" && (!d.flaws || !d.flaws.length));

  await page.locator(`[data-stage="${sharps.id}"][data-zone="across"]`).click();
  expect((await snapshot(page)).ready).toBe(false);
  await expect(page.locator("#stgReady")).toBeDisabled();
  await expect(page.locator(".stg-msg")).toContainText(/past the patient's arm/i);

  await page.locator(`[data-stage="${sharps.id}"][data-zone="reach"]`).click();
  expect((await snapshot(page)).ready).toBe(true);
  await expect(page.locator("#stgReady")).toBeEnabled();
});

/* ---------- rendering + resilience -------------------------------------------------- */

test("every catalog object renders as real geometry, never an empty placeholder", async ({ page }) => {
  await openStaging(page);
  // every catalog item must project to a real on-screen point, which only
  // happens if it actually got an instance in the scene
  const snap = await snapshot(page);
  for(const d of snap.catalog){
    const pt = await pointFor(page, d.id);
    expect(pt, `${d.id} has no rendered instance`).toBeTruthy();
    expect(Number.isFinite(pt.x)).toBe(true);
  }
});

test("reloading mid-staging leaves the application usable", async ({ page }) => {
  const errors = attachDiagnostics(page);
  await openStaging(page);
  await mouseDrag(page, await pointFor(page, "gloves_ok"), await pointForZone(page, "tray"));
  expect((await snapshot(page)).zones.gloves_ok).toBe("tray");

  await page.reload();
  await expect(page.getByRole("heading", { name:/Clock in/i })).toBeVisible({ timeout:15000 });
  await expect(page.locator("canvas")).toBeVisible();

  // and the staging step still works from a clean start
  await page.evaluate(()=>window.__phlebTest.gotoProcedureStep("gather", ["red"]));
  await expect(page.locator(".stg-coach")).toBeVisible({ timeout:10000 });
  const fresh = await snapshot(page);
  expect(fresh.zones.gloves_ok).toBe("shelf");
  expect(fresh.requiredTubes).toEqual(["red"]);
  expect(errors).toEqual([]);
});

test("the accessible list view is fully keyboard operable", async ({ page }) => {
  await openStaging(page);
  await page.locator("#stgView").click();
  await expect(page.locator(".stg-list")).toBeVisible();

  const snap = await snapshot(page);
  const gloves = snap.catalog.find(d=>d.category==="gloves");
  const inspectBtn = page.locator(`[data-inspect="${gloves.id}"]`);
  await inspectBtn.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(`[data-inspect="${gloves.id}"]`)).toContainText(/Re-read/);

  const stageBtn = page.locator(`[data-stage="${gloves.id}"][data-zone="tray"]`);
  await stageBtn.focus();
  await page.keyboard.press("Enter");
  expect((await snapshot(page)).zones[gloves.id]).toBe("tray");
});
