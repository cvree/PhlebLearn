/* =========================================================================
   Palpation — browser acceptance tests against the PRODUCTION build.

   The unit tests prove the sensations are right. These prove the step is a
   REAL one: that the old four-button multiple-choice is gone, that pressure
   builds by holding still and eases off when you slide, that what you feel
   depends on what is under the finger, and that you cannot commit to a vein
   you never actually pressed.
   ========================================================================= */
import { test, expect } from "@playwright/test";
import { settleBench, carryOn, holdSteps, expectStepReady } from "./benchHelpers.js";

const ALLOWLISTED_WARNINGS = [
  /THREE\.Clock: This module has been deprecated/,
  /THREE\.WebGLShadowMap: PCFSoftShadowMap has been deprecated/,
  /GL Driver Message/,
  /* Properties of the MACHINE, not of the app: a sandboxed runner with an
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
    const text = msg.text();
    if(ALLOWLISTED_WARNINGS.some(re=>re.test(text))) return;
    errors.push(`console.${msg.type()}: ${text}`);
  });
  return errors;
}

async function openPalpation(page, mode){
  await page.goto("./?e2e=1");
  await expect(page.locator("canvas")).toBeVisible({ timeout:15000 });
  await page.waitForFunction(()=>!!window.__phlebTest, null, { timeout:15000 });
  /* Hold the draw where the seam puts it. A step ends itself a beat after
     its completing action happens, which would race every assertion below
     about whether it is finished. See tests/benchHelpers.js. */
  await holdSteps(page);
  await page.evaluate(m=>window.__phlebTest.gotoProcedureStep("palpate", ["lightblue","lavender"], m, "straight-antecubital"), mode||"teach");
  await expect(page.locator(".plp-coach")).toBeVisible({ timeout:10000 });
  await page.waitForFunction(async ()=>!!(await window.__phlebTest.screenPointOverVessel("median-cubital")),
    null, { timeout:10000 });
  // the camera eases onto this step's framing; a point read mid-move is stale
  await settleBench(page);
}

const snapshot = page=>page.evaluate(()=>window.__phlebTest.palpationSnapshot());
const overVessel = (page, id)=>page.evaluate(v=>window.__phlebTest.screenPointOverVessel(v), id);

/**
 * Presses a fingertip over a vessel and holds for `ms`.
 *
 * The default is a FIRM press, not a maximal one. Holding down long enough to
 * reach full pressure squashes a vein flat and correctly reports that it has
 * gone — which is the mechanic working, not a vein that failed to be found.
 *
 * There is no longer a stillness requirement or a ramp to wait out: sensation
 * arrives on the frame the finger lands, and dwelling only ever makes the
 * touch DEEPER. The waits below are about reaching a particular depth, never
 * about being allowed to feel anything at all.
 */
async function pressOver(page, id, ms){
  const p = await overVessel(page, id);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.waitForTimeout(ms == null ? 540 : ms);
  return p;
}
async function liftOff(page){
  await page.mouse.up();
  await page.waitForTimeout(150);
}

/**
 * Commits to a site by PRESSING AND HOLDING on one of the learner's own
 * traces, which is the only way a site is chosen now.
 *
 * There is no "Mark this spot" button any more, in either input path. The old
 * one committed to wherever the finger had last happened to be, whether the
 * learner had assessed it or not — which is exactly the divorce between
 * palpating and marking that the step was rebuilt to remove.
 *
 * The hold runs on the SCENE's clock, which a software renderer runs slower
 * than the wall, so this waits on the state rather than on a fixed duration.
 */
async function holdToCommit(page, id){
  const p = await overVessel(page, id);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  for(let i = 0; i < 60; i++){
    // a hair of movement each tick: a finger resting on skin is never still,
    // and it keeps the runtime's own dwell/press model running
    await page.mouse.move(p.x + (i % 2 ? 0.4 : -0.4), p.y);
    await page.waitForTimeout(120);
    const s = await snapshot(page);
    if(s.chosenId) break;
  }
  await page.mouse.up();
  await page.waitForTimeout(200);
  return p;
}

/**
 * Presses until the touch reaches a given depth, rather than for a given
 * number of milliseconds.
 *
 * Pressure accrues on the SCENE's clock, and that clock is deliberately
 * clamped per frame so a stalled tab cannot make the simulation jump. Under a
 * software renderer that means the scene runs slower than the wall, so a
 * wall-clock wait measures the runner's graphics stack rather than the
 * mechanic. Waiting for the quantity is both immune to that and a more honest
 * statement of what the test actually needs.
 */
async function pressOverUntil(page, id, minPress, timeout){
  // Only presses if the finger is not already down: a second mouse.down (and
  // the mouse.move before it) re-seats the touch and lightens it, so calling
  // this after pressOver would measure the re-seat rather than the dwell.
  let p = null;
  if(!(await snapshot(page)).down){
    p = await overVessel(page, id);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
  }
  /* Polls for the DEPTH and returns the reading that met it. Hand-rolled
     rather than waitForFunction, because what has to come back is the SAMPLE
     that satisfied the condition: taking a fresh reading afterwards is a race,
     and on a runner drawing at a few frames a second the two are far apart. */
  const deadline = Date.now() + (timeout || 25000);
  let at = null;
  while(Date.now() < deadline){
    at = await snapshot(page);
    if(at && at.press >= minPress) break;
    await page.waitForTimeout(90);
  }
  if(!at || at.press < minPress){
    throw new Error(`pressure never reached ${minPress} (last ${at && at.press})`);
  }
  return { point: p || await overVessel(page, id), snapshot: at };
}

/* ---------- the step is real ------------------------------------------------- */

test("palpation is a real arm, not four labelled buttons", async ({ page })=>{
  const errors = attachDiagnostics(page);
  await openPalpation(page, "teach");

  // the old multiple-choice activity is gone
  await expect(page.locator(".vp-vein")).toHaveCount(0);
  await expect(page.locator(".vp-armbig")).toHaveCount(0);

  const snap = await snapshot(page);
  expect(snap).not.toBeNull();
  expect(snap.everPressed).toBe(false);
  expect(snap.felt).toEqual([]);
  expect(errors).toEqual([]);
});

test("nothing is named on screen before it has been felt", async ({ page })=>{
  await openPalpation(page, "teach");
  /* Scoped to what the panel says about THIS ARM, which is the rule: the
     sensation under the fingertip, the name slot beside it, and the guidance
     line. Not the step's teaching, which has always named the median cubital
     as the first-choice vein in the abstract — that is the lesson, and it
     moved inside the coach when the panel's separate teaching card went away.
     Naming a structure the learner has felt is the learner's job; naming the
     first-choice vein of the antecubital fossa is the syllabus. */
  const live = await page.locator(".plp-touch, .sg > .stg-msg").allInnerTexts();
  const text = live.join(" ");
  expect(text).not.toMatch(/median cubital/i);
  expect(text).not.toMatch(/brachial artery/i);
  // and the slot that would name it is empty
  await expect(page.locator('[data-live="named"]')).toHaveText("");
});

/* ---------- pressure is a real quantity -------------------------------------- */

test("there is sensation on the FIRST frame — no hold timer, no ramp to wait out", async ({ page })=>{
  await openPalpation(page, "teach");
  // 80ms is less than the OLD model's stillness window alone (110ms), never
  // mind the 850ms pressure ramp that followed it.
  await pressOver(page, "median-cubital", 80);
  const immediate = await snapshot(page);
  await liftOff(page);

  expect(immediate.press).toBeGreaterThan(0.12);        // above CONTACT_PRESS
  expect(immediate.feel).not.toBe("nothing");
  expect(immediate.felt).toContain("median-cubital");
});

test("dwelling bears down: pressure is an axis, and it keeps climbing", async ({ page })=>{
  await openPalpation(page, "teach");
  await pressOver(page, "median-cubital", 150);
  const early = await snapshot(page);
  // A firm working press is reachable simply by staying there. Full occlusion
  // is further up the axis on purpose — flattening the vein you were hunting
  // has to be something you did, not something that happened to you.
  const { snapshot: late } = await pressOverUntil(page, "median-cubital", 0.60);
  await liftOff(page);

  expect(late.press).toBeGreaterThan(early.press);
  expect(late.press).toBeGreaterThan(0.55);
});

test("sweeping lightens the touch — and never stops it reporting", async ({ page })=>{
  await openPalpation(page, "teach");
  const { point: p, snapshot: held } = await pressOverUntil(page, "median-cubital", 0.60);
  expect(held.press).toBeGreaterThan(0.55);

  /* Sweep across the arm rather than leaning on one spot, and read the touch
     WHILE it is moving. Reading afterwards measures the recovery instead: the
     hand stops, the dwell resumes, and it bears down again within a couple of
     frames — which is the mechanic working, not the mechanic missing. */
  /* A REAL search sweep, down the length of the forearm and back onto the
     site. Two vessels a few pixels apart is not a sweep — it is a fidget, and
     it sits right on the speed at which dwell and travel cancel out. */
  const path = await page.evaluate(()=>window.__phlebTest.screenPointsOnBenchLimb(
    [0.00, -0.03, -0.06, -0.09, -0.12, -0.09, -0.06, -0.03, 0.00, -0.04, -0.08, -0.02]
      .map(x=>[x, 0.15, 0.045])
  ));
  let lightest = held.press;
  let feltWhileMoving = null;
  for(const q of path){
    await page.mouse.move(q.x, q.y);
    // long enough for a frame to actually run between samples: on a runner
    // drawing at a few frames a second, twelve moves otherwise all land inside
    // one frame and the sweep is never observed at all
    await page.waitForTimeout(120);
    const s = await snapshot(page);
    if(s.press < lightest) lightest = s.press;
    if(s.feel && s.feel !== "nothing") feltWhileMoving = s.feel;
  }
  await liftOff(page);
  expect(lightest).toBeLessThan(held.press);
  // THE POINT: moving is how you search, so a sweeping hand is still feeling.
  // The old model decayed pressure to nothing the moment you moved at all.
  expect(lightest).toBeGreaterThan(0.12);
  expect(feltWhileMoving).not.toBeNull();
});

/* ---------- what is under the finger matters --------------------------------- */

test("pressing over the median cubital feels a vein that springs back", async ({ page })=>{
  const errors = attachDiagnostics(page);
  await openPalpation(page, "teach");
  await pressOver(page, "median-cubital");
  const snap = await snapshot(page);
  // read the panel while the finger is still down — lift off and the pressure
  // decays, exactly as it should
  await expect(page.locator('[data-live="feel"]')).toContainText(/springs back/i);
  await liftOff(page);

  expect(snap.feel).toBe("vein");
  expect(snap.touching).toBe("median-cubital");
  expect(snap.felt).toContain("median-cubital");
  expect(errors).toEqual([]);
});

test("pressing over the artery feels something pushing back in time", async ({ page })=>{
  await openPalpation(page, "teach");
  // the brachial artery runs deep — it takes a firm press to find at all,
  // which is why a light touch over it feels of nothing in particular
  const snap = (await pressOverUntil(page, "brachial-artery", 0.68)).snapshot;
  await expect(page.locator('[data-live="feel"]')).toContainText(/pushing back/i);
  await liftOff(page);

  expect(snap.feel).toBe("artery");
  expect(snap.arteryPressed).toBe(true);
});

test("pressing over the tendon feels hard and unmoving", async ({ page })=>{
  await openPalpation(page, "teach");
  const snap = (await pressOverUntil(page, "biceps-tendon", 0.68)).snapshot;
  await expect(page.locator('[data-live="feel"]')).toContainText(/does not give/i);
  await liftOff(page);
  expect(snap.feel).toBe("tendon");
});

test("lifting off something pulsing counts as recognising it", async ({ page })=>{
  await openPalpation(page, "teach");
  await pressOverUntil(page, "brachial-artery", 0.68);
  await liftOff(page);
  const snap = await snapshot(page);
  expect(snap.arteryPressed).toBe(true);
  expect(snap.arteryRecognised).toBe(true);
});

/* ---------- committing --------------------------------------------------------- */

test("marking the vein you felt passes, and teaching mode then lets the draw on", async ({ page })=>{
  await openPalpation(page, "teach");
  await expectStepReady(page, false);

  await holdToCommit(page, "median-cubital");

  const snap = await snapshot(page);
  expect(snap.chosenId).toBe("median-cubital");
  expect(snap.ready).toBe(true);
  expect(snap.ideal).toBe(true);
  await expectStepReady(page, true);
});

test("marking the artery is blocked, whatever else was right", async ({ page })=>{
  await openPalpation(page, "teach");
  /* The artery must stay REACHABLE. The rules have a blocking `choseArtery`
     issue precisely so a learner who marks a pulsing vessel is told why that
     is the one thing never to do; an interaction that made the mistake
     impossible would never deliver the lesson. */
  await pressOverUntil(page, "brachial-artery", 0.68);
  await liftOff(page);
  await holdToCommit(page, "brachial-artery");

  const snap = await snapshot(page);
  expect(snap.chosenId).toBe("brachial-artery");
  expect(snap.blocking).toContain("choseArtery");
  expect(snap.ready).toBe(false);
  await expectStepReady(page, false);
});

test("the site marked carries into the encounter for the steps that follow", async ({ page })=>{
  await openPalpation(page, "teach");
  await holdToCommit(page, "median-cubital");
  await carryOn(page);
  await page.waitForTimeout(400);

  const still = await snapshot(page);
  expect(still.chosenId).toBe("median-cubital");
  await expect(page.locator(".plp-coach")).toHaveCount(0);
});

/* ---------- the accessible path ------------------------------------------------ */

test("the controls path presses real places and cannot skip feeling either", async ({ page })=>{
  await openPalpation(page, "teach");
  await page.locator("#plpView").click();
  await expect(page.locator(".plp-controls")).toBeVisible();

  /* There is nothing to commit to until something has been felt. The old
     controls listed every vessel with a disabled Choose button beside it,
     which told you the answer before you had looked; the list is now built
     from the learner's own traces, so before the first press there are none. */
  await expect(page.locator("[data-choose-trace]")).toHaveCount(0);

  await page.locator('[data-press="median-cubital"]').click();
  await page.waitForTimeout(200);
  const choose = page.locator("[data-choose-trace]").first();
  await expect(choose).toBeVisible();

  await choose.click();
  await page.waitForTimeout(200);

  const snap = await snapshot(page);
  expect(snap.felt).toContain("median-cubital");
  expect(snap.traces.length).toBeGreaterThan(0);
  expect(snap.ready).toBe(true);
  await expectStepReady(page, true);
});

test("the controls path names spots on the arm, never the veins themselves", async ({ page })=>{
  await openPalpation(page, "teach");
  await page.locator("#plpView").click();
  const text = await page.locator(".plp-controls").innerText();
  expect(text).not.toMatch(/median cubital|cephalic|basilic|brachial/i);
  expect(text).toMatch(/bend of the elbow/i);
});

/* ---------- scored mode --------------------------------------------------------- */

test("a scored shift never names what you are feeling", async ({ page })=>{
  await openPalpation(page, "play");
  await pressOverUntil(page, "brachial-artery", 0.68);
  const sensation = await page.locator('[data-live="feel"]').innerText();
  const whole = await page.locator(".plp-coach").innerText();
  await liftOff(page);

  expect(sensation).toMatch(/pushing back/i);
  // the sensation, never the conclusion — naming it is the learner's job
  expect(whole).not.toMatch(/brachial artery/i);
  expect(whole).not.toMatch(/that is the/i);
});

test("a scored shift lets a bad site through and carries it forward", async ({ page })=>{
  await openPalpation(page, "play");
  await pressOverUntil(page, "biceps-tendon", 0.68);
  await liftOff(page);
  await holdToCommit(page, "biceps-tendon");

  await expect(page.locator("#plpReady")).toBeEnabled();
  const before = await snapshot(page);
  expect(before.blocking.length).toBeGreaterThan(0);

  await carryOn(page);
  await page.waitForTimeout(400);
  await expect(page.locator(".plp-coach")).toHaveCount(0);
});
