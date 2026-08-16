/* =========================================================================
   Tube inversion — browser acceptance tests against the PRODUCTION build.

   The unit tests prove the rules; these prove the step is real: that a tube is
   picked up off a real rack, that turning it is an arc the pointer actually
   describes, that a small arc counts nothing however many times it is repeated,
   that a fast one haemolyses the specimen, and that each additive is held to
   its own count rather than a global six.
   ========================================================================= */
import { test, expect } from "@playwright/test";
import { carryOn } from "./benchHelpers.js";

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

async function open(page, mode){
  await page.goto("./?e2e=1");
  await expect(page.locator("canvas")).toBeVisible({ timeout:15000 });
  await page.waitForFunction(()=>!!window.__phlebTest, null, { timeout:15000 });
  await page.evaluate(([t, m])=>window.__phlebTest.gotoProcedureStep("invert", t, m),
    [TUBES, mode || "teach"]);
  await expect(page.locator(".asm-coach")).toBeVisible({ timeout:10000 });
  await page.waitForFunction(async ()=>!!(await window.__phlebTest.inversionAnchors()), null, { timeout:10000 });
  await settle(page);
}

/** Waits for the camera to have rendered and stopped moving — see postdraw's note. */
async function settle(page){
  await page.evaluate(()=>{ delete window.__invPrev; });
  await page.waitForFunction(async ()=>{
    const a = await window.__phlebTest.inversionAnchors();
    if(!a || a.frame < 4) return false;
    const prev = window.__invPrev;
    window.__invPrev = a.hand;
    return !!prev && Math.hypot(prev.x - a.hand.x, prev.y - a.hand.y) < 0.5;
  }, null, { timeout: 15000 });
}

const snapshot = page=>page.evaluate(()=>window.__phlebTest.inversionSnapshot());
const anchors = page=>page.evaluate(()=>window.__phlebTest.inversionAnchors());
const tubeOf = (snap, key)=>snap.tubes.find(t => t.key === key);

/** Carries a tube out of the rack up into the hand. */
async function pickUp(page, key){
  const a = await anchors(page);
  await page.mouse.move(a.rack[key].x, a.rack[key].y);
  await page.mouse.down();
  await page.mouse.move(a.hand.x, a.hand.y, { steps: 22 });
  await page.waitForTimeout(80);
  return a;
}

/**
 * Swings the tube through an arc about the hand, `peak` degrees from upright
 * and back. The pointer genuinely traces the rotation the tube makes — that is
 * the mechanic, not a proxy for it.
 */
async function swing(page, peak, o){
  const opt = o || {};
  const a = await anchors(page);
  const pivot = a.pivot;
  const R = Math.max(a.deadzonePx + 40, 90);
  // The default is a GENTLE turn, and the numbers matter: 10° every ~35ms is
  // about 285°/s, comfortably under the shake threshold and well above the
  // sluggish one. An earlier cut used 12° every 12ms — which is ~880°/s, i.e.
  // shaking, and the mechanic correctly said so.
  const stepDeg = opt.stepDeg == null ? 10 : opt.stepDeg;
  const pause = opt.pause == null ? 35 : opt.pause;
  const at = (deg)=>{
    const rad = deg*Math.PI/180;
    // 0deg is straight above the pivot; screen y grows downward
    return { x: pivot.x + Math.sin(rad)*R, y: pivot.y - Math.cos(rad)*R };
  };
  for(let deg = 0; deg <= peak; deg += stepDeg){
    const p = at(deg);
    await page.mouse.move(p.x, p.y);
    if(pause) await page.waitForTimeout(pause);
  }
  for(let deg = peak; deg >= 0; deg -= stepDeg){
    const p = at(Math.max(0, deg));
    await page.mouse.move(p.x, p.y);
    if(pause) await page.waitForTimeout(pause);
  }
}

/** Puts the held tube back in its rack slot. */
async function rackIt(page, key){
  const a = await anchors(page);
  await page.mouse.move(a.rack[key].x, a.rack[key].y, { steps: 18 });
  await page.mouse.up();
  await page.waitForTimeout(120);
}

/* ---------- the step is real ------------------------------------------------------ */

test("invert is real tubes on a real rack, not a row of counters", async ({ page })=>{
  const errors = attachDiagnostics(page);
  await open(page, "teach");
  // the old 2D screen is gone
  await expect(page.locator(".vp-invert")).toHaveCount(0);
  await expect(page.locator(".vp-invtube")).toHaveCount(0);
  await expect(page.locator("#vpDoneInv")).toHaveCount(0);

  const a = await anchors(page);
  expect(Object.keys(a.rack).sort()).toEqual([...TUBES].sort());
  const snap = await snapshot(page);
  expect(snap.heldKey).toBeNull();
  expect(errors).toEqual([]);
});

test("each additive is held to its own count, not a global six", async ({ page })=>{
  await open(page, "teach");
  const snap = await snapshot(page);
  const citrate = tubeOf(snap, "lightblue");
  const edta = tubeOf(snap, "lavender");
  expect(citrate.ideal).toBe(4);
  expect(edta.ideal).toBe(8);
  expect(citrate.ideal).not.toBe(edta.ideal);
  await expect(page.locator(".tq-next")).toContainText("4×");
  await expect(page.locator(".tq-next")).toContainText("8×");
});

/* ---------- picking up and turning ------------------------------------------------- */

test("a tube is lifted out of the rack into the hand", async ({ page })=>{
  const errors = attachDiagnostics(page);
  await open(page, "teach");
  await pickUp(page, "lavender");
  const snap = await snapshot(page);
  expect(snap.heldKey).toBe("lavender");
  await expect(page.locator('[data-live="tube"]')).toContainText("EDTA");
  await page.mouse.up();
  expect(errors).toEqual([]);
});

test("a full arc over and back counts one inversion", async ({ page })=>{
  const errors = attachDiagnostics(page);
  await open(page, "teach");
  await pickUp(page, "lavender");
  await swing(page, 170);
  const snap = await snapshot(page);
  const t = tubeOf(snap, "lavender");
  expect(t.inversions).toBe(1);
  expect(t.peakDegPerS).toBeLessThan(snap.shakeThreshold);
  expect(t.haemolysis).toBe(0);
  await page.mouse.up();
  expect(errors).toEqual([]);
});

test("rocking it counts nothing, however many times it is repeated", async ({ page })=>{
  // five full arcs at a gentle, realistic pace
  test.slow();
  await open(page, "teach");
  await pickUp(page, "lavender");
  for(let i = 0; i < 5; i++) await swing(page, 70);
  const snap = await snapshot(page);
  const t = tubeOf(snap, "lavender");
  expect(t.inversions).toBe(0);
  expect(t.rockCount).toBeGreaterThanOrEqual(3);
  expect(t.travelDeg).toBeGreaterThan(400);   // it definitely moved
  expect(snap.issues).toContain("rocking");
  await page.mouse.up();
});

test("swinging it fast haemolyses the specimen, and it cannot be undone", async ({ page })=>{
  await open(page, "teach");
  await pickUp(page, "lavender");
  // The same arc, snapped over and back in single jumps with no pause — a
  // violent flick. It has to be this coarse because each synthesised pointer
  // event costs ~140ms of driver latency, so 60° steps only add up to ~420°/s;
  // 175° in one event is ~1250°/s, which is what shaking a tube looks like.
  for(let i = 0; i < 6; i++) await swing(page, 175, { stepDeg: 175, pause: 0 });
  let snap = await snapshot(page);
  let t = tubeOf(snap, "lavender");
  expect(t.peakDegPerS).toBeGreaterThan(snap.shakeThreshold);
  expect(t.haemolysis).toBeGreaterThan(0);
  const level = t.haemolysis;

  // mixing it gently afterwards does not give it back
  await swing(page, 170);
  snap = await snapshot(page);
  t = tubeOf(snap, "lavender");
  expect(t.haemolysis).toBeGreaterThanOrEqual(level);
  await page.mouse.up();
});

/* ---------- finishing a tube ------------------------------------------------------- */

test("mixing a tube to its count and racking it completes that tube", async ({ page })=>{
  test.slow();
  const errors = attachDiagnostics(page);
  await open(page, "teach");
  await pickUp(page, "lightblue");
  for(let i = 0; i < 4; i++) await swing(page, 170);
  let snap = await snapshot(page);
  expect(tubeOf(snap, "lightblue").inversions).toBe(4);

  await rackIt(page, "lightblue");
  snap = await snapshot(page);
  const t = tubeOf(snap, "lightblue");
  expect(t.racked).toBe(true);
  expect(t.usable).toBe(true);
  expect(snap.heldKey).toBeNull();
  // the other tube still owes its own eight
  expect(snap.pending).toContain("lavender");
  await expect(page.locator("#invReady")).toBeDisabled();
  expect(errors).toEqual([]);
});

/* ---------- teaching versus scored ------------------------------------------------- */

test("teaching mode will not leave the step while a tube can still be mixed", async ({ page })=>{
  await open(page, "teach");
  await expect(page.locator("#invReady")).toBeDisabled();
  await expect(page.locator("#invReady")).toHaveText(/Not finished/);
});

test("a scored shift lets under-mixed specimens through and stays quiet", async ({ page })=>{
  await open(page, "play");
  await expect(page.locator(".stg-msg")).toContainText("assessed after the patient");
  await expect(page.locator("#invReady")).toBeEnabled();
  await expect(page.locator("#invReady")).toHaveText(/Carry on/);
});

/* ---------- the coach does not tear itself down as the tube turns ------------------ */

test("the coach patches the live count and angle rather than re-rendering", async ({ page })=>{
  await open(page, "teach");
  await pickUp(page, "lavender");
  await page.evaluate(()=>{ document.querySelector("#invReady").dataset.probe = "1"; });
  await swing(page, 100);
  const kept = await page.evaluate(()=>document.querySelector("#invReady").dataset.probe);
  await page.mouse.up();
  expect(kept).toBe("1");
  await expect(page.locator('[data-live="tilt"]')).toContainText("°");
});

/* ---------- the accessible path ---------------------------------------------------- */

async function useControls(page){
  const toggle = page.locator("#invView");
  if(await toggle.getAttribute("aria-pressed") === "false") await toggle.click();
  await expect(page.locator(".asm-controls")).toBeVisible();
}

test("the controls path mixes every tube through the same rules", async ({ page })=>{
  const errors = attachDiagnostics(page);
  await open(page, "teach");
  await useControls(page);
  for(const key of TUBES){
    await page.locator(`[data-inv="pick:${key}"]`).click();
    await page.locator('[data-inv="mix"]').click();
    await page.locator('[data-inv="rack"]').click();
  }
  const snap = await snapshot(page);
  expect(tubeOf(snap, "lightblue").inversions).toBe(4);
  expect(tubeOf(snap, "lavender").inversions).toBe(8);
  expect(snap.tubes.every(t => t.usable)).toBe(true);
  expect(snap.ready).toBe(true);
  await expect(page.locator("#invReady")).toBeEnabled();
  expect(errors).toEqual([]);
});

test("the controls path is not an easier game — rocking and shaking both fail", async ({ page })=>{
  await open(page, "teach");
  await useControls(page);
  await page.locator('[data-inv="pick:lavender"]').click();
  await page.locator('[data-inv="rock"]').click();
  let snap = await snapshot(page);
  expect(tubeOf(snap, "lavender").inversions).toBe(0);
  expect(snap.issues).toContain("rocking");

  await page.locator('[data-inv="shake"]').click();
  snap = await snapshot(page);
  const t = tubeOf(snap, "lavender");
  expect(t.peakDegPerS).toBeGreaterThan(snap.shakeThreshold);
  expect(t.usable).toBe(false);
  expect(t.reason).toBe("haemolysed");
  expect(snap.blocking).toContain("haemolysed");
});

test("the plain serum tube must not be mixed, and the controls say so", async ({ page })=>{
  await page.goto("./?e2e=1");
  await page.waitForFunction(()=>!!window.__phlebTest, null, { timeout:15000 });
  await page.evaluate(()=>window.__phlebTest.gotoProcedureStep("invert", ["red","lavender"], "teach"));
  await expect(page.locator(".asm-coach")).toBeVisible({ timeout:10000 });
  await page.waitForFunction(async ()=>!!(await window.__phlebTest.inversionAnchors()), null, { timeout:10000 });
  await useControls(page);

  await page.locator('[data-inv="pick:red"]').click();
  let snap = await snapshot(page);
  expect(tubeOf(snap, "red").mustNotMix).toBe(true);
  expect(snap.issues).toContain("plainTubeNoMix");
  // there is no "invert" control offered for it at all
  await expect(page.locator('[data-inv="mix"]')).toHaveCount(0);
  await page.locator('[data-inv="rack"]').click();

  snap = await snapshot(page);
  expect(tubeOf(snap, "red").usable).toBe(true);
  expect(tubeOf(snap, "red").inversions).toBe(0);
});

test("a tube mixed very slowly counts but is noted", async ({ page })=>{
  await open(page, "teach");
  await useControls(page);
  await page.locator('[data-inv="pick:lightblue"]').click();
  for(let i = 0; i < 4; i++) await page.locator('[data-inv="slow"]').click();
  const snap = await snapshot(page);
  const t = tubeOf(snap, "lightblue");
  expect(t.inversions).toBe(4);
  expect(t.sluggish).toBe(true);
});

test("the controls view is fully keyboard operable", async ({ page })=>{
  await open(page, "teach");
  await useControls(page);
  const pick = page.locator('[data-inv="pick:lavender"]');
  await pick.focus();
  await page.keyboard.press("Enter");
  const mix = page.locator('[data-inv="mix"]');
  await mix.focus();
  await page.keyboard.press("Enter");
  const snap = await snapshot(page);
  expect(tubeOf(snap, "lavender").inversions).toBe(8);
});

/* ---------- what collection left behind -------------------------------------------- */

test("the tubes here are the tubes the collection step actually filled", async ({ page })=>{
  await open(page, "teach");
  const snap = await snapshot(page);
  expect(snap.order).toEqual(TUBES);
  // and nothing has been mixed for the learner
  expect(snap.tubes.every(t => t.inversions === 0)).toBe(true);
  expect(snap.tubes.every(t => !t.racked)).toBe(true);
});

/* =========================================================================
   PAYING AS YOU GO

   The arithmetic is unit-tested in tests/rewards.spec.js. What this proves is
   that a step the learner actually finished pays them at the moment they
   finish it, and that a section done well pays more than the step tick alone
   — rather than the whole draw settling up on a screen minutes later.
   ========================================================================= */

test("finishing a section pays out there and then, scaled by how well it went", async ({ page })=>{
  await open(page, "teach");
  await useControls(page);
  const before = await page.evaluate(()=>window.__phlebTest.rewardSnapshot());

  for(const key of TUBES){
    await page.locator(`[data-inv="pick:${key}"]`).click();
    await page.locator('[data-inv="mix"]').click();
    await page.locator('[data-inv="rack"]').click();
  }
  await expect(page.locator("#invReady")).toBeEnabled();
  await carryOn(page, "#invReady");

  const after = await page.evaluate(()=>window.__phlebTest.rewardSnapshot());
  // the step tick alone is 2 XP; a section mixed to every tube's own count is
  // worth a great deal more than that
  expect(after.xp - before.xp).toBeGreaterThan(6);
  expect(after.sectionsDone).toBe(before.sectionsDone + 1);
  expect(after.cleanSections).toBe(before.cleanSections + 1);
});
