/* =========================================================================
   Needle + holder — browser acceptance tests against the PRODUCTION build.

   The unit tests prove the rules; these prove the step is REAL: that the
   pouch is opened by peeling along a seam rather than tapping it, that the
   needle is carried and lined up with a hub that exists at a real place, that
   the turns come from actually turning it, that the sheath comes off along an
   axis, and that a unit built loose or crooked is still that unit when the
   next step opens.
   ========================================================================= */
import { test, expect } from "@playwright/test";
import { settleBench } from "./benchHelpers.js";

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

async function open(page, step, mode){
  await page.goto("./?e2e=1");
  await expect(page.locator("canvas")).toBeVisible({ timeout:15000 });
  await page.waitForFunction(()=>!!window.__phlebTest, null, { timeout:15000 });
  await page.evaluate(a=>window.__phlebTest.gotoProcedureStep(a[0], ["lightblue","lavender"], a[1]), [step, mode||"teach"]);
  await expect(page.locator(".asm-coach")).toBeVisible({ timeout:10000 });
  await page.waitForFunction(async ()=>!!(await window.__phlebTest.benchAnchors()), null, { timeout:10000 });
  await settleBench(page);
}

const snapshot = page=>page.evaluate(()=>window.__phlebTest.assemblySnapshot());
const anchors = page=>page.evaluate(()=>window.__phlebTest.benchAnchors());
const hubScreen = page=>page.evaluate(()=>window.__phlebTest.hubScreenPoint());
const onBench = (page, list)=>page.evaluate(l=>window.__phlebTest.screenPointsOnBench(l), list);

/**
 * Drags the pointer through a polyline of bench-plane points as ONE gesture.
 *
 * Every leg is interpolated inside a single mouse.move({steps}) rather than
 * one Playwright call per sample: a drag needs ~40 samples to be a drag, and
 * forty round trips through the driver cost more than the whole test budget.
 */
async function dragBench(page, vertices, stepsPerLeg){
  const screen = await onBench(page, vertices);
  const steps = stepsPerLeg || 12;
  await page.mouse.move(screen[0].x, screen[0].y);
  await page.mouse.down();
  for(const p of screen.slice(1)) await page.mouse.move(p.x, p.y, { steps });
  await page.mouse.up();
  await page.waitForTimeout(120);
}

/* ---------- the step is real ---------------------------------------------------- */

test("assembly is a unit on a bench, not two divs dragged together", async ({ page })=>{
  const errors = attachDiagnostics(page);
  await open(page, "assemble", "teach");
  await expect(page.locator("#vpNeedle")).toHaveCount(0);
  await expect(page.locator("#vpHolder")).toHaveCount(0);
  await expect(page.locator(".vp-assemble")).toHaveCount(0);

  const a = await anchors(page);
  expect(a.hub).toBeTruthy();
  expect(a.seam.x1).toBeGreaterThan(a.seam.x0);

  const snap = await snapshot(page);
  expect(snap.pouchOpen).toBe(false);
  expect(snap.turns).toBe(0);
  expect(snap.blocking).toContain("pouchSealed");
  expect(errors).toEqual([]);
});

/* ---------- the pouch ------------------------------------------------------------ */

test("peeling along the seam opens the pouch", async ({ page })=>{
  const errors = attachDiagnostics(page);
  await open(page, "assemble", "teach");
  const a = await anchors(page);
  await dragBench(page, [[a.seam.x0, a.seam.z], [a.seam.x1, a.seam.z]], 24);

  const snap = await snapshot(page);
  expect(snap.pouchOpen).toBe(true);
  expect(snap.pouchTorn).toBe(false);
  expect(snap.blocking).not.toContain("pouchSealed");
  expect(errors).toEqual([]);
});

test("wandering off the seam tears the pack open instead", async ({ page })=>{
  await open(page, "assemble", "teach");
  const a = await anchors(page);
  // the same peel, but wandering off the seam onto the film as it goes
  await dragBench(page, [[a.seam.x0, a.seam.z], [a.seam.x1, a.seam.z + 0.020]], 24);

  const snap = await snapshot(page);
  expect(snap.pouchOpen).toBe(true);
  expect(snap.pouchTorn).toBe(true);
  expect(snap.issues).toContain("tornPouch");
});

test("half a seam is not an open pouch", async ({ page })=>{
  await open(page, "assemble", "teach");
  const a = await anchors(page);
  const mid = a.seam.x0 + (a.seam.x1 - a.seam.x0)*0.45;
  await dragBench(page, [[a.seam.x0, a.seam.z], [mid, a.seam.z]], 12);

  const snap = await snapshot(page);
  expect(snap.pouchOpen).toBe(false);
  expect(snap.peel).toBeGreaterThan(0.3);
  expect(snap.peel).toBeLessThan(0.85);
});

/* ---------- handling ------------------------------------------------------------- */

test("picking the needle up by the grey sleeved end contaminates it", async ({ page })=>{
  await open(page, "assemble", "teach");
  const a = await anchors(page);
  await dragBench(page, [[a.seam.x0, a.seam.z], [a.seam.x1, a.seam.z]], 24);

  const n = (await anchors(page)).needle;
  // the sleeved end sits toward +x, which is the end that goes in the holder
  await dragBench(page, [[n.x + 0.018, n.z], [n.x + 0.020, n.z]], 3);

  const snap = await snapshot(page);
  expect(snap.contaminated).toBe(true);
  expect(snap.contaminatedBy).toBe("threadEnd");
  expect(snap.blocking).toContain("contaminated");
});

/* ---------- alignment and threading ---------------------------------------------- */

/**
 * Opens the pouch, then carries the needle to the hub. `lineUp` decides
 * whether the last leg of the journey runs along the hub's axis (which is the
 * whole skill) or straight at it from wherever the needle happened to be.
 */
async function carryToHub(page, lineUp){
  const a0 = await anchors(page);
  await dragBench(page, [[a0.seam.x0, a0.seam.z], [a0.seam.x1, a0.seam.z]], 24);

  const a = await anchors(page);
  const n = a.needle;
  // The needle is held at its middle and points the way it is carried, so the
  // pointer has to finish one tip-length short of the hub ALONG the heading —
  // which is why a crooked approach and a lined-up one end in different places
  // even though the tip lands in the same hole.
  const yaw = lineUp ? 0 : 0.61;                     // ~35 degrees off the axis
  const dir = [Math.cos(yaw), -Math.sin(yaw)];       // (x, z)
  const target = [a.hub.x - dir[0]*a.tipDx, a.hub.z - dir[1]*a.tipDx];
  const lineFrom = [target[0] - dir[0]*0.038, target[1] - dir[1]*0.038];

  const screen = await onBench(page, [[n.x, n.z], lineFrom, target]);
  await page.mouse.move(screen[0].x, screen[0].y);
  await page.mouse.down();
  await page.mouse.move(screen[1].x, screen[1].y, { steps: 8 });
  await page.mouse.move(screen[2].x, screen[2].y, { steps: 10 });
  await page.waitForTimeout(60);
  return screen[2];
}

/** Puts the pointer on a known circle round the hub before turning it. */
async function startTurnFrom(page){
  const hub = await hubScreen(page);
  const r = 80;
  await page.mouse.move(hub.x + r, hub.y);
  return { hub, r };
}

/**
 * Circles the pointer round the hub — which is how the needle gets turned in.
 * Eight chords per revolution, each interpolated driver-side, keeps every
 * angular step well under the half-turn the runtime unwraps at while costing
 * a fraction of the round trips a per-sample loop would.
 */
async function turnAround(page, hub, r, turns){
  const chords = Math.max(6, Math.round(Math.abs(turns)*8));
  for(let i = 1; i <= chords; i++){
    const a = (i/chords)*turns*Math.PI*2;
    await page.mouse.move(hub.x + Math.cos(a)*r, hub.y + Math.sin(a)*r, { steps: 2 });
  }
}

test("lining the needle up with the hub threads it; turning it in is real turning", async ({ page })=>{
  test.slow();
  const errors = attachDiagnostics(page);
  await open(page, "assemble", "teach");
  await carryToHub(page, true);

  let snap = await snapshot(page);
  expect(snap.engaged).toBe(true);
  expect(snap.crossThreaded).toBe(false);
  expect(snap.engageMisalignDeg).toBeLessThan(12);

  const { hub, r } = await startTurnFrom(page);
  await turnAround(page, hub, r, 2.6);
  await page.mouse.up();
  await page.waitForTimeout(150);

  snap = await snapshot(page);
  expect(snap.turns).toBeGreaterThan(2.0);
  expect(snap.turns).toBeLessThan(3.4);
  expect(snap.ready).toBe(true);
  expect(errors).toEqual([]);
});

test("one turn is not finger-tight, and the step says so", async ({ page })=>{
  test.slow();
  await open(page, "assemble", "teach");
  await carryToHub(page, true);
  const { hub, r } = await startTurnFrom(page);
  await turnAround(page, hub, r, 1.3);
  await page.mouse.up();
  await page.waitForTimeout(150);

  const snap = await snapshot(page);
  expect(snap.turns).toBeGreaterThan(0.9);
  expect(snap.turns).toBeLessThan(1.9);
  expect(snap.blocking).toContain("loose");
  expect(snap.ready).toBe(false);
  await expect(page.locator("#asmReady")).toBeDisabled();
});

test("turning the wrong way takes it back off", async ({ page })=>{
  test.slow();
  await open(page, "assemble", "teach");
  await carryToHub(page, true);
  const { hub, r } = await startTurnFrom(page);
  await turnAround(page, hub, r, 2.5);
  const mid = await snapshot(page);
  expect(mid.turns).toBeGreaterThan(2);

  await turnAround(page, hub, r, -1.2);
  await page.mouse.up();
  await page.waitForTimeout(150);

  const snap = await snapshot(page);
  expect(snap.turns).toBeLessThan(mid.turns - 0.6);
  expect(snap.reverseTurns).toBeGreaterThan(0.6);
});

test("coming at the hub crooked cross-threads it, and forcing it gets nowhere", async ({ page })=>{
  test.slow();
  await open(page, "assemble", "teach");
  await carryToHub(page, false);

  let snap = await snapshot(page);
  expect(snap.engaged).toBe(true);
  expect(snap.crossThreaded).toBe(true);
  expect(snap.engageMisalignDeg).toBeGreaterThan(12);

  const { hub, r } = await startTurnFrom(page);
  await turnAround(page, hub, r, 3);
  await page.mouse.up();
  await page.waitForTimeout(150);

  snap = await snapshot(page);
  expect(snap.turns).toBeLessThanOrEqual(0.75);
  expect(snap.blocking).toContain("crossThreaded");
  expect(snap.ready).toBe(false);
});

/* ---------- uncapping ------------------------------------------------------------ */

test("the unit the uncap step opens is the unit the assemble step built", async ({ page })=>{
  await open(page, "uncap", "teach");
  const snap = await snapshot(page);
  expect(snap.mode).toBe("uncap");
  expect(snap.turns).toBeGreaterThanOrEqual(2);
  // the bevel's resting angle came from where the threading stopped
  expect(snap.bevelDeg).toBe(180);
  expect(snap.capOn).toBe(true);
  expect(snap.blocking).toContain("stillCapped");
});

test("pulling the sheath straight off leaves the needle intact", async ({ page })=>{
  const errors = attachDiagnostics(page);
  await open(page, "uncap", "teach");
  const a = await anchors(page);
  await dragBench(page, [[a.capGrip.x, a.capGrip.z], [a.capGrip.x - 0.045, a.capGrip.z]], 18);

  const snap = await snapshot(page);
  expect(snap.capOn).toBe(false);
  expect(snap.needleDamaged).toBe(false);
  expect(snap.capAxialFraction).toBeGreaterThan(0.9);
  expect(errors).toEqual([]);
});

test("levering the sheath off sideways barbs the bevel and blocks the step", async ({ page })=>{
  await open(page, "uncap", "teach");
  const a = await anchors(page);
  const pts = [];
  for(let i = 0; i <= 16; i++){
    const t = i/16;
    pts.push([a.capGrip.x - 0.045*t, a.capGrip.z + (i % 2 ? 0.008 : -0.008)]);
  }
  await dragBench(page, pts, 1);

  const snap = await snapshot(page);
  expect(snap.capOn).toBe(false);
  expect(snap.needleDamaged).toBe(true);
  expect(snap.blocking).toContain("barbedNeedle");
  expect(snap.ready).toBe(false);
});

test("rolling the holder brings the bevel up, and the step needs it up", async ({ page })=>{
  const errors = attachDiagnostics(page);
  await open(page, "uncap", "teach");
  const a = await anchors(page);
  await dragBench(page, [[a.capGrip.x, a.capGrip.z], [a.capGrip.x - 0.045, a.capGrip.z]], 18);

  let snap = await snapshot(page);
  expect(Math.abs(snap.bevelDeg)).toBeGreaterThan(25);
  expect(snap.blocking).toContain("bevelOff");

  // the holder rolls under the finger: half a turn is 45 mm of drag
  const h = (await anchors(page)).holder;
  await dragBench(page, [[h.x + 0.010, h.z], [h.x + 0.010, h.z - 0.045]], 18);

  snap = await snapshot(page);
  expect(Math.abs(snap.bevelDeg)).toBeLessThan(25);
  expect(snap.blocking).not.toContain("bevelOff");
  expect(errors).toEqual([]);
});

test("holding still on the holder is leaning in to look at the bevel", async ({ page })=>{
  await open(page, "uncap", "teach");
  const a = await anchors(page);
  await dragBench(page, [[a.capGrip.x, a.capGrip.z], [a.capGrip.x - 0.045, a.capGrip.z]], 18);

  expect((await snapshot(page)).bevelInspected).toBe(false);

  const h = (await anchors(page)).holder;
  const [pt] = await onBench(page, [[h.x + 0.010, h.z]]);
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.down();
  await page.waitForTimeout(1100);
  await page.mouse.up();
  await page.waitForTimeout(120);

  expect((await snapshot(page)).bevelInspected).toBe(true);
});

test("putting the sheath back on the needle is caught and blocked", async ({ page })=>{
  await open(page, "uncap", "teach");
  const a = await anchors(page);
  const screen = await onBench(page, [
    [a.capGrip.x, a.capGrip.z],
    [a.capGrip.x - 0.045, a.capGrip.z],
    [a.needle.x - 0.026, a.needle.z],
  ]);
  await page.mouse.move(screen[0].x, screen[0].y);
  await page.mouse.down();
  await page.mouse.move(screen[1].x, screen[1].y, { steps: 18 });
  await page.mouse.move(screen[2].x, screen[2].y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(150);

  const snap = await snapshot(page);
  expect(snap.recapped).toBe(true);
  expect(snap.blocking).toContain("recapped");
});

test("the sheath dropped on the prepped field is a blocking mistake", async ({ page })=>{
  await open(page, "uncap", "teach");
  const a = await anchors(page);
  const screen = await onBench(page, [
    [a.capGrip.x, a.capGrip.z],
    [a.capGrip.x - 0.045, a.capGrip.z],
    [a.site.x, a.site.z],
  ]);
  await page.mouse.move(screen[0].x, screen[0].y);
  await page.mouse.down();
  await page.mouse.move(screen[1].x, screen[1].y, { steps: 18 });
  await page.mouse.move(screen[2].x, screen[2].y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(150);

  const snap = await snapshot(page);
  expect(snap.capPlacedOn).toBe("site");
  expect(snap.blocking).toContain("capOnSite");
});

/* ---------- the accessible path is the same rules --------------------------------- */

test("the controls build the same unit the bench does, with the scene torn down", async ({ page })=>{
  const errors = attachDiagnostics(page);
  await open(page, "assemble", "teach");
  await page.click("#asmView");
  await expect(page.locator(".asm-controls")).toBeVisible();
  await expect(page.locator("canvas")).toBeVisible();

  await page.click('[data-asm="peel"]');
  await page.click('[data-asm="lift-sheath"]');
  await page.click('[data-asm="thread-cross"]');
  let snap = await snapshot(page);
  expect(snap.crossThreaded).toBe(true);
  expect(snap.blocking).toContain("crossThreaded");

  await page.click('[data-asm="backout"]');
  await page.click('[data-asm="thread-snug"]');
  snap = await snapshot(page);
  expect(snap.crossThreaded).toBe(false);
  expect(snap.turns).toBe(2.5);
  expect(snap.ready).toBe(true);
  await expect(page.locator("#asmReady")).toBeEnabled();
  expect(errors).toEqual([]);
});

test("the controls can uncap, roll and check without a 3D scene", async ({ page })=>{
  await open(page, "uncap", "teach");
  await page.click("#uncView");
  await expect(page.locator(".asm-controls")).toBeVisible();

  await page.click('[data-unc="pull"]');
  expect((await snapshot(page)).capOn).toBe(false);

  // 180° off: four 45° rolls bring it back up
  for(let i = 0; i < 4; i++) await page.click('[data-unc="roll-45"]');
  await page.click('[data-unc="look"]');
  await page.click('[data-unc="cap-tray"]');
  await page.click('[data-unc="warn"]');

  const snap = await snapshot(page);
  expect(Math.abs(snap.bevelDeg)).toBeLessThan(25);
  expect(snap.bevelInspected).toBe(true);
  expect(snap.capPlacedOn).toBe("tray");
  expect(snap.warned).toBe(true);
  expect(snap.ready).toBe(true);
});

/* ---------- teaching mode explains; a scored shift does not ------------------------ */

test("a scored shift reports nothing and lets the learner commit anyway", async ({ page })=>{
  await open(page, "assemble", "play");
  const body = await page.locator(".asm-coach").innerText();
  expect(body).not.toMatch(/cross-thread/i);
  expect(body).not.toMatch(/Not yet/);
  // nothing is built, and it still lets them carry on — the assessment is after
  await expect(page.locator("#asmReady")).toBeEnabled();
  expect((await snapshot(page)).ready).toBe(false);
});
