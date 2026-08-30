/* =========================================================================
   Withdraw, safety and sharps — browser acceptance tests against the
   PRODUCTION build.

   The unit tests prove the rules; these prove the steps are real: that the
   band comes off by a pull on its actual tail, that the needle is drawn back
   out along the line it went in by a real gesture, that the safety shield is
   a thing the pointer physically slides until it locks, and that the sharp
   ends up inside a real container — or is refused by the trash.
   ========================================================================= */
import { test, expect } from "@playwright/test";
import { settleBench, carryOn, holdSteps, expectStepReady, pastSectionCard } from "./benchHelpers.js";

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

const TUBES = ["lightblue","lavender"];

async function open(page, mode, step){
  await page.goto("./?e2e=1");
  await expect(page.locator("canvas")).toBeVisible({ timeout:15000 });
  await page.waitForFunction(()=>!!window.__phlebTest, null, { timeout:15000 });
  /* Hold the draw where the seam puts it. A step ends itself a beat after
     its completing action happens, which would race every assertion below
     about whether it is finished. See tests/benchHelpers.js. */
  await holdSteps(page);
  await page.evaluate(([s, t, m])=>window.__phlebTest.gotoProcedureStep(s, t, m, "straight-antecubital"),
    [step || "release", TUBES, mode || "teach"]);
  await expect(page.locator(".asm-coach")).toBeVisible({ timeout:10000 });
  await page.waitForFunction(async ()=>!!(await window.__phlebTest.withdrawalAnchors()), null, { timeout:10000 });
  // the camera eases onto this step's framing; a point read mid-move is stale
  await settleBench(page);
}

const snapshot = page=>page.evaluate(()=>window.__phlebTest.withdrawalSnapshot());
const anchors = page=>page.evaluate(()=>window.__phlebTest.withdrawalAnchors());

/**
 * Pulls the band's tail free — a real travel, not a button.
 *
 * Settles before returning: releasing the band is a state change this step's
 * own render loop reframes around on its next drawn frame, and this file
 * chains several of these gestures together — see withdrawDrag's note.
 */
async function pullTail(page){
  const a = await anchors(page);
  await page.mouse.move(a.tail.x, a.tail.y);
  await page.mouse.down();
  await page.mouse.move(a.tail.x + 90, a.tail.y - 70, { steps: 18 });
  await page.mouse.up();
  await page.waitForTimeout(120);
  await settleBench(page);
}

/** Carries the gauze from the bench to rest by the site. */
async function gauzeToSite(page){
  const a = await anchors(page);
  await page.mouse.move(a.gauze.x, a.gauze.y);
  await page.mouse.down();
  await page.mouse.move(a.site.x, a.site.y, { steps: 24 });
  await page.mouse.up();
  await page.waitForTimeout(120);
  await settleBench(page);
}

/**
 * Draws the needle `mm` millimetres OUT along its own entry line.
 *
 * Settles before returning, like every gesture helper in this file. Release,
 * withdraw, safety and sharps are one continuous piece of work — the whole
 * point this file's tests exist to prove — chained through this same page
 * without a fresh `open()` between them, and each transition is a state
 * change this step's render loop reframes around on ITS OWN next drawn
 * frame, not synchronously inside the pointer handler that caused it. A
 * later gesture in the chain that fetches fresh anchors before that settles
 * is fetching anchors for a camera that has only just been told to move.
 */
async function withdrawDrag(page, mm, sideMm){
  const a = await anchors(page);
  const sx = a.sidePx ? a.sidePx.dx*(sideMm || 0)/10 : 0;
  const sy = a.sidePx ? a.sidePx.dy*(sideMm || 0)/10 : 0;
  await page.mouse.move(a.hub.x, a.hub.y);
  await page.mouse.down();
  await page.mouse.move(a.hub.x + a.outPx.dx*mm/10 + sx, a.hub.y + a.outPx.dy*mm/10 + sy, { steps: 26 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  await settleBench(page);
}

/** Slides the safety shield `mm` millimetres forward along the needle. */
async function shieldSlide(page, mm){
  const a = await anchors(page);
  await page.mouse.move(a.shield.x, a.shield.y);
  await page.mouse.down();
  await page.mouse.move(a.shield.x + a.inPx.dx*mm/10, a.shield.y + a.inPx.dy*mm/10, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  await settleBench(page);
}

/**
 * Switches to the accessible controls. The preference PERSISTS across steps
 * (it is a saved setting, not per-screen state), so a test walking several
 * steps must not blindly click the toggle again — the second click would turn
 * the controls back off.
 */
async function useControls(page){
  const toggle = page.locator("#wdView");
  if(await toggle.getAttribute("aria-pressed") === "false") await toggle.click();
  await expect(page.locator(".asm-controls")).toBeVisible();
}

/** Carries the unit from wherever it is to a destination anchor. */
async function carryUnitTo(page, dest){
  const a = await anchors(page);
  await page.mouse.move(a.hub.x, a.hub.y);
  await page.mouse.down();
  await page.mouse.move(a[dest].x, a[dest].y, { steps: 26 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  await settleBench(page);
}

/* ---------- release: the band comes off by its own tail --------------------------- */

test("release is the real band's real tail, not a button", async ({ page })=>{
  const errors = attachDiagnostics(page);
  await open(page, "teach", "release");
  // the old 2D screen is gone
  await expect(page.locator(".vp-tqtimer")).toHaveCount(0);
  await expect(page.locator("#vpAct")).toHaveCount(0);

  const snap = await snapshot(page);
  expect(snap.bandOnPatient).toBe(true);
  expect(snap.bandReleasedAt).toBeNull();
  const a = await anchors(page);
  expect(a.tail).not.toBeNull();
  expect(errors).toEqual([]);
});

test("pulling the tail releases the band, and the clock it stops is the band's own", async ({ page })=>{
  const errors = attachDiagnostics(page);
  await open(page, "teach", "release");
  await expectStepReady(page, false);
  await pullTail(page);

  const snap = await snapshot(page);
  expect(snap.bandOnPatient).toBe(false);
  expect(snap.bandReleasedAt).not.toBeNull();
  expect(snap.tourniquetSecondsAtRelease).toBeGreaterThan(0);
  expect(snap.collectionDoneAtRelease).toBe(true);
  await expectStepReady(page, true);
  await expect(page.locator('[data-live="band"]')).toHaveText("off");
  expect(errors).toEqual([]);
});

test("the coach patches the band's ticking clock rather than re-rendering", async ({ page })=>{
  await open(page, "teach", "release");
  await page.evaluate(()=>{ document.querySelector(".stg-topline").dataset.probe = "1"; });
  await page.waitForTimeout(1200);
  const kept = await page.evaluate(()=>document.querySelector(".stg-topline").dataset.probe);
  expect(kept).toBe("1");
  await expect(page.locator('[data-live="band"]')).toContainText("on —");
});

/* ---------- withdraw: gauze ready, then out along the line ------------------------ */

test("gauze is carried from the bench and rests by the site, without pressure", async ({ page })=>{
  const errors = attachDiagnostics(page);
  await open(page, "teach", "withdraw");
  await pullTail(page);
  await gauzeToSite(page);

  const snap = await snapshot(page);
  expect(snap.gauzeTaken).toBe(true);
  expect(snap.gauzePlaced).toBe(true);
  expect(snap.gauzeOffsetM).toBeLessThan(0.02);
  expect(snap.gauzePressedEarly).toBe(false);
  expect(snap.withdrawn).toBe(false);
  expect(errors).toEqual([]);
});

test("a smooth pull along the entry line brings the needle out cleanly", async ({ page })=>{
  const errors = attachDiagnostics(page);
  await open(page, "teach", "withdraw");
  await pullTail(page);
  await gauzeToSite(page);
  await expectStepReady(page, false);
  await withdrawDrag(page, 30);

  const snap = await snapshot(page);
  expect(snap.withdrawn).toBe(true);
  expect(snap.depthM).toBe(0);
  expect(snap.exitDeviationDeg).toBeLessThan(12);
  expect(snap.gauzeReadyAtWithdraw).toBe(true);
  expect(snap.tourniquetOnAtWithdraw).toBe(false);
  await expectStepReady(page, true);
  await expect(page.locator('[data-live="depth"]')).toHaveText("out");
  expect(errors).toEqual([]);
});

test("a sideways exit is measured in degrees off the entry line, not a boolean", async ({ page })=>{
  await open(page, "teach", "withdraw");
  await pullTail(page);
  await gauzeToSite(page);
  await withdrawDrag(page, 30, 9);   // 9mm of sideways lever on the way out

  const snap = await snapshot(page);
  expect(snap.withdrawn).toBe(true);
  expect(snap.exitDeviationDeg).toBeGreaterThan(5);
  expect(snap.exitLateralM).toBeGreaterThan(0.002);
});

test("teaching mode holds the withdraw step until the band is off first", async ({ page })=>{
  await open(page, "teach", "withdraw");
  const snap = await snapshot(page);
  expect(snap.bandOnPatient).toBe(true);
  expect(snap.issues).toContain("bandStillOn");
  // the tail is still grabbable IN the withdraw step — it is the same arm
  const a = await anchors(page);
  expect(a.tail).not.toBeNull();
});

/* ---------- safety: the mechanism is a thing the pointer operates ------------------- */

test("the shield slides forward for real and locks at full travel, in the hand", async ({ page })=>{
  // the whole release-and-withdraw sequence before the shield is even reachable
  test.slow();
  const errors = attachDiagnostics(page);
  await open(page, "teach", "safety");
  await pullTail(page);
  await gauzeToSite(page);
  await withdrawDrag(page, 30);

  let snap = await snapshot(page);
  expect(snap.withdrawn).toBe(true);
  expect(snap.safetyLocked).toBe(false);
  await expectStepReady(page, false);

  await shieldSlide(page, 12);      // part-way: nothing locks
  snap = await snapshot(page);
  expect(snap.safetyTravel).toBeGreaterThan(0.1);
  expect(snap.safetyLocked).toBe(false);

  await shieldSlide(page, 30);      // carried through: it clicks
  snap = await snapshot(page);
  expect(snap.safetyLocked).toBe(true);
  expect(snap.surfaceActivated).toBe(false);
  await expectStepReady(page, true);
  await expect(page.locator('[data-live="safety"]')).toHaveText("locked");
  expect(errors).toEqual([]);
});

/* ---------- dispose: into the container, whole, and nowhere else -------------------- */

test("the unit is carried into the sharps container and is gone", async ({ page })=>{
  test.slow();
  const errors = attachDiagnostics(page);
  await open(page, "teach", "dispose");
  await pullTail(page);
  await gauzeToSite(page);
  await withdrawDrag(page, 30);
  await shieldSlide(page, 40);
  await expectStepReady(page, false);
  await carryUnitTo(page, "sharps");

  const snap = await snapshot(page);
  expect(snap.disposed).toBe(true);
  expect(snap.disposedFully).toBe(true);
  expect(snap.safetyEngagedAtDispose).toBe(true);
  expect(snap.trashAttempts).toBe(0);
  await expectStepReady(page, true);
  expect(errors).toEqual([]);
});

test("the trash refuses the sharp, and the sharps container still completes it", async ({ page })=>{
  // two full carries on top of the whole withdraw-and-shield sequence
  test.slow();
  await open(page, "teach", "dispose");
  await pullTail(page);
  await gauzeToSite(page);
  await withdrawDrag(page, 30);
  await shieldSlide(page, 40);
  await carryUnitTo(page, "trash");

  let snap = await snapshot(page);
  expect(snap.disposed).toBe(false);
  expect(snap.trashAttempts).toBe(1);
  expect(snap.blocking).toContain("trashAttempted");
  await expect(page.locator(".stg-msg")).toContainText("sharps container");

  await carryUnitTo(page, "sharps");
  snap = await snapshot(page);
  expect(snap.disposed).toBe(true);
});

/* ---------- the whole sequence, end to end ------------------------------------------ */

test("the four steps hand one continuous piece of work forward", async ({ page })=>{
  // the entire post-draw sequence, through all four steps, in one run
  test.slow();
  const errors = attachDiagnostics(page);
  await open(page, "teach", "release");
  await pullTail(page);
  await carryOn(page);

  // withdraw inherits the released band
  await expect(page.locator(".asm-coach")).toBeVisible();
  await page.waitForFunction(async ()=>!!(await window.__phlebTest.withdrawalAnchors()), null, { timeout:10000 });
  let snap = await snapshot(page);
  expect(snap.bandOnPatient).toBe(false);
  await gauzeToSite(page);
  await withdrawDrag(page, 30);
  await carryOn(page);

  // safety inherits the withdrawn needle
  await page.waitForFunction(async ()=>!!(await window.__phlebTest.withdrawalAnchors()), null, { timeout:10000 });
  snap = await snapshot(page);
  expect(snap.withdrawn).toBe(true);
  await shieldSlide(page, 40);
  await carryOn(page);

  // dispose inherits the locked shield
  await page.waitForFunction(async ()=>!!(await window.__phlebTest.withdrawalAnchors()), null, { timeout:10000 });
  snap = await snapshot(page);
  expect(snap.safetyLocked).toBe(true);
  await carryUnitTo(page, "sharps");
  await carryOn(page);
  // that ended the withdrawal SECTION, and this one is never clean — the
  // sequence above is deliberately a slow, imperfect one
  await pastSectionCard(page);

  // and it hands straight on to the pressure step, which inherits the puncture
  // this sequence just left — and knows the band was off before the needle was
  await expect(page.locator(".asm-coach")).toBeVisible({ timeout: 10000 });
  await page.waitForFunction(async ()=>!!(await window.__phlebTest.postDrawSnapshot()), null, { timeout: 10000 });
  const pd = await page.evaluate(()=>window.__phlebTest.postDrawSnapshot());
  expect(pd.haemostatic).toBe(false);
  expect(pd.pressureStarted).toBe(false);
  expect(errors).toEqual([]);
});

/* ---------- what the earlier steps actually left behind ----------------------------- */

test("a tube left engaged on the holder is still engaged here, and blocks", async ({ page })=>{
  // Walked from the fill step rather than jumped to, because the point is that
  // this step reads the collection state the learner really left — a defensive
  // "finish anything unfinished" would have quietly done the work for them and
  // deleted the very mistake the rule exists to catch.
  test.slow();
  await page.goto("./?e2e=1");
  await expect(page.locator("canvas")).toBeVisible({ timeout:15000 });
  await page.waitForFunction(()=>!!window.__phlebTest, null, { timeout:15000 });
  /* Hold the draw where the seam puts it. A step ends itself a beat after
     its completing action happens, which would race every assertion below
     about whether it is finished. See tests/benchHelpers.js. */
  await holdSteps(page);
  await page.evaluate(([t])=>window.__phlebTest.gotoProcedureStep("fill", t, "play", "straight-antecubital"), [TUBES]);
  await expect(page.locator(".asm-coach")).toBeVisible({ timeout:10000 });

  // push a tube on and deliberately leave it there
  const colView = page.locator("#colView");
  if(await colView.getAttribute("aria-pressed") === "false") await colView.click();
  await page.locator('[data-col="take:lightblue"]').click();
  await page.locator('[data-col="push-braced"]').click();
  const col = await page.evaluate(()=>window.__phlebTest.collectionSnapshot());
  expect(col.currentKey).toBe("lightblue");
  expect(col.tubes[0].pierced).toBe(true);

  // a scored shift lets them walk on: fill -> switch -> release -> withdraw
  for(let i = 0; i < 3; i++){
    await carryOn(page);
    await expect(page.locator(".asm-coach")).toBeVisible({ timeout:10000 });
  }
  await page.waitForFunction(async ()=>!!(await window.__phlebTest.withdrawalSnapshot()), null, { timeout:10000 });

  const snap = await snapshot(page);
  expect(snap.blocking).toContain("tubeStillOn");
});

/* ---------- a scored shift lets mistakes happen and stays quiet --------------------- */

test("a scored shift allows an unsafe sequence and says nothing until after", async ({ page })=>{
  await open(page, "play", "withdraw");
  /* Play says NOTHING. There is no standing note any more — one explaining
     that your technique is being assessed is still being told something —
     so what "quiet" means is that there is no verdict on screen at all. */
  await expect(page.locator(".vp-stage .stg-msg")).toHaveCount(0);
  await expect(page.locator("#wdReady")).toBeEnabled();
  // withdraw with the band still on — allowed, recorded
  await gauzeToSite(page);
  await withdrawDrag(page, 30);

  const snap = await snapshot(page);
  expect(snap.withdrawn).toBe(true);
  expect(snap.tourniquetOnAtWithdraw).toBe(true);
  expect(snap.blocking).toContain("withdrewUnderPressure");
  // and the coach still names nothing
  /* Play says NOTHING. There is no standing note any more — one explaining
     that your technique is being assessed is still being told something —
     so what "quiet" means is that there is no verdict on screen at all. */
  await expect(page.locator(".vp-stage .stg-msg")).toHaveCount(0);
});

/* ---------- the accessible path ------------------------------------------------------ */

test("the controls path runs the whole sequence through the same rules", async ({ page })=>{
  test.slow();
  const errors = attachDiagnostics(page);
  await open(page, "teach", "release");
  await useControls(page);
  await page.locator('[data-wd="fist"]').click();
  await page.locator('[data-wd="release"]').click();
  let snap = await snapshot(page);
  expect(snap.bandOnPatient).toBe(false);
  expect(snap.fistRelaxed).toBe(true);
  await carryOn(page);

  await expect(page.locator(".asm-coach")).toBeVisible();
  await useControls(page);
  await page.locator('[data-wd="gauze-take"]').click();
  await page.locator('[data-wd="gauze-place"]').click();
  await page.locator('[data-wd="withdraw-smooth"]').click();
  snap = await snapshot(page);
  expect(snap.withdrawn).toBe(true);
  expect(snap.gauzeReadyAtWithdraw).toBe(true);
  await carryOn(page);

  await useControls(page);
  await page.locator('[data-wd="safety-hand"]').click();
  snap = await snapshot(page);
  expect(snap.safetyLocked).toBe(true);
  expect(snap.surfaceActivated).toBe(false);
  await carryOn(page);

  await useControls(page);
  await page.locator('[data-wd="dispose-sharps"]').click();
  snap = await snapshot(page);
  expect(snap.disposed).toBe(true);
  expect(snap.disposedFully).toBe(true);
  expect(errors).toEqual([]);
});

test("the controls path is not an easier game — the three classic stories all count", async ({ page })=>{
  await open(page, "teach", "safety");
  await useControls(page);
  await page.locator('[data-wd="release"]').click();
  await page.locator('[data-wd="gauze-take"]').click();
  await page.locator('[data-wd="gauze-place"]').click();
  await page.locator('[data-wd="withdraw-smooth"]').click();
  await page.locator('[data-wd="recap"]').click();
  await page.locator('[data-wd="setdown"]').click();
  await page.locator('[data-wd="safety-surface"]').click();

  const snap = await snapshot(page);
  expect(snap.recapAttempted).toBe(true);
  expect(snap.exposedSetDown).toBe(true);
  expect(snap.surfaceActivated).toBe(true);
  expect(snap.blocking).toEqual(expect.arrayContaining([
    "recapAttempted", "exposedSetDown", "struckOnSurface",
  ]));
});

test("pressing the gauze down early is recorded through the controls too", async ({ page })=>{
  await open(page, "teach", "withdraw");
  await useControls(page);
  await page.locator('[data-wd="release"]').click();
  await page.locator('[data-wd="gauze-take"]').click();
  await page.locator('[data-wd="gauze-place"]').click();
  await page.locator('[data-wd="gauze-press"]').click();

  const snap = await snapshot(page);
  expect(snap.gauzePressedEarly).toBe(true);
  expect(snap.issues).toContain("pressedTooSoon");
});
