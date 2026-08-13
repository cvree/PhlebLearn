/* =========================================================================
   Tube collection — browser acceptance tests against the PRODUCTION build.

   The unit tests prove the rules; these prove the step is real: that a tube
   is carried off a real rack and pushed onto a holder that is genuinely in
   the arm, that where the hand goes decides whether the needle moves, that
   the vacuum fills the tube by itself and stops by itself, and that the tube
   filled in the `fill` step is the same tube the `switch` step finds already
   collected.
   ========================================================================= */
import { test, expect } from "@playwright/test";
import { settleBench } from "./benchHelpers.js";

/* The slowest file in the suite, and honestly so: several of these tests seat
   a tube, fill it, pull it off and seat the next one, which is four separate
   pointer-driven drags. Every pointer sample is acknowledged only once the
   renderer's main thread gets to it, and on a runner with no GPU this scene
   renders at about six frames a second with all of the rasterising on that
   same thread. The tests are not doing anything they should not; the machine
   is slow, and 90 seconds was not enough room for a four-drag test. */
test.describe.configure({ timeout: 180000 });

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
  await page.evaluate(([s, t, m])=>window.__phlebTest.gotoProcedureStep(s, t, m, "straight-antecubital"),
    [step || "fill", TUBES, mode || "teach"]);
  await expect(page.locator(".asm-coach")).toBeVisible({ timeout:10000 });
  await page.waitForFunction(async ()=>!!(await window.__phlebTest.collectionAnchors()), null, { timeout:10000 });
  // the camera eases onto this step's framing; a point read mid-move is stale
  await settleBench(page);
}

const snapshot = page=>page.evaluate(()=>window.__phlebTest.collectionSnapshot());
const anchors = page=>page.evaluate(()=>window.__phlebTest.collectionAnchors());
const fastFill = (page, s)=>page.evaluate(x=>window.__phlebTest.fastForwardFill(x), s);

/** Carries a tube from its rack slot into the holder's mouth. */
async function carryToHolder(page, key){
  const a = await anchors(page);
  await page.mouse.move(a.rack[key].x, a.rack[key].y);
  await page.mouse.down();
  await page.mouse.move(a.mouth.x, a.mouth.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(120);
}

/**
 * Drags the tube `mm` millimetres along the holder's own axis — positive
 * pushes it on, negative pulls it off — starting from either the flange
 * (braced) or the tube's own barrel (unbraced).
 */
async function seatDrag(page, mm, from){
  const a = await anchors(page);
  const start = from === "tube" ? tubeGrabPoint(a) : a.flange;
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  /* Eight samples, not twenty-four. A push onto a holder is a straight line
     and needs only enough samples to be a drag rather than a teleport — and
     each one is a round trip that Chromium acks only once the renderer's main
     thread gets to it, which on a runner with no GPU (this scene renders at
     about six frames a second there, all of it on the main thread) is a
     couple of seconds. Twenty-four of those was a minute of budget for a
     four-millimetre push. */
  await page.mouse.move(start.x + a.alongPx.dx*mm/10, start.y + a.alongPx.dy*mm/10, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

/** A point out along the tube's barrel, well clear of the flange. */
function tubeGrabPoint(a){
  return { x: a.mouth.x - a.alongPx.dx*4.5, y: a.mouth.y - a.alongPx.dy*4.5 };
}

/* ---------- the step is real ------------------------------------------------------ */

test("fill is a real tube on a real holder, not a CSS height animation", async ({ page })=>{
  const errors = attachDiagnostics(page);
  await open(page, "teach");
  await expect(page.locator(".vp-fillwrap")).toHaveCount(0);
  await expect(page.locator(".vp-tube3d")).toHaveCount(0);
  await expect(page.locator("#vpFluid")).toHaveCount(0);
  await expect(page.locator(".vp-tubepick")).toHaveCount(0);

  const snap = await snapshot(page);
  expect(snap.inVein).toBe(true);
  expect(snap.currentKey).toBeNull();
  expect(snap.tubes.map(t=>t.key)).toEqual(TUBES);
  expect(snap.issues).toContain("takeNext");
  expect(errors).toEqual([]);
});

test("the rack holds this draw's real tubes, each with its own draw volume", async ({ page })=>{
  await open(page, "teach");
  const a = await anchors(page);
  expect(Object.keys(a.rack).sort()).toEqual([...TUBES].sort());
  const snap = await snapshot(page);
  // 2.7mL citrate, 4.0mL EDTA — real tubes, not one generic vial
  expect(snap.tubes[0].requiredFraction).toBeGreaterThan(snap.tubes[1].requiredFraction);
});

/* ---------- carrying a tube over ------------------------------------------------- */

test("carrying a tube off the rack into the holder takes it, and disturbs nothing", async ({ page })=>{
  const errors = attachDiagnostics(page);
  await open(page, "teach");
  await carryToHolder(page, "lightblue");

  const snap = await snapshot(page);
  expect(snap.currentKey).toBe("lightblue");
  expect(snap.takenSequence).toEqual(["lightblue"]);
  expect(snap.tubes[0].pierced).toBe(false);
  // simply bringing a tube up to the holder cannot move the needle: nothing
  // has met the rubber yet
  expect(snap.needleShiftM).toBe(0);
  expect(snap.needleOut).toBe(false);
  expect(errors).toEqual([]);
});

test("a tube held short of the guideline is not pierced and draws nothing", async ({ page })=>{
  await open(page, "teach");
  await carryToHolder(page, "lightblue");
  await seatDrag(page, 4);              // 4mm — short of the 6mm guideline
  await fastFill(page, 10);

  const snap = await snapshot(page);
  expect(snap.seatDepth).toBeLessThan(0.006);
  expect(snap.tubes[0].pierced).toBe(false);
  expect(snap.tubes[0].drawnMl).toBe(0);
});

/* ---------- seating, and where the hand is --------------------------------------- */

test("pushing past the guideline pierces the stopper and the tube starts to fill", async ({ page })=>{
  const errors = attachDiagnostics(page);
  await open(page, "teach");
  await carryToHolder(page, "lightblue");
  await seatDrag(page, 16);

  const snap = await snapshot(page);
  expect(snap.seatDepth).toBeGreaterThan(0.013);
  expect(snap.tubes[0].pierced).toBe(true);
  expect(snap.tubes[0].drawnMl).toBeGreaterThan(0);
  expect(snap.tubes[0].deadOnAir).toBe(false);
  expect(errors).toEqual([]);
});

test("a braced push barely moves the needle; an unbraced one takes it out of the vein", async ({ page })=>{
  await open(page, "teach");
  await carryToHolder(page, "lightblue");
  await seatDrag(page, 16, "flange");
  const braced = await snapshot(page);
  expect(braced.needleOut).toBe(false);
  expect(braced.needleShiftM).toBeLessThan(braced.lumenToleranceM/2);

  // a second draw, pushed on by the tube alone
  await open(page, "teach");
  await carryToHolder(page, "lightblue");
  await seatDrag(page, 16, "tube");
  const unbraced = await snapshot(page);
  expect(unbraced.grip).toBe("body");
  expect(unbraced.needleShiftM).toBeGreaterThan(braced.needleShiftM);
  expect(unbraced.needleOut).toBe(true);
});

test("a needle pushed out of the vein blocks, and nothing more flows", async ({ page })=>{
  await open(page, "teach");
  await carryToHolder(page, "lightblue");
  await seatDrag(page, 16, "tube");

  const atFailure = await snapshot(page);
  expect(atFailure.needleOut).toBe(true);
  expect(atFailure.blocking).toContain("needleOut");

  // whatever had already run in before the tip came out is all this tube
  // will ever get — the vacuum is open onto nothing now
  await fastFill(page, 20);
  const later = await snapshot(page);
  expect(later.tubes[0].drawnMl).toBeCloseTo(atFailure.tubes[0].drawnMl, 6);
  expect(later.tubes[0].fraction).toBeLessThan(0.9);
  await expect(page.locator(".asm-panel")).toContainText("out of the vein");
});

/* ---------- the vacuum does the work --------------------------------------------- */

test("the vacuum fills the tube by itself and stops at its draw volume", async ({ page })=>{
  await open(page, "teach");
  await carryToHolder(page, "lightblue");
  await seatDrag(page, 16);
  await fastFill(page, 30);

  const snap = await snapshot(page);
  expect(snap.tubes[0].drawnMl).toBeCloseTo(2.7, 2);
  expect(snap.tubes[0].fraction).toBeCloseTo(1, 3);
  await expect(page.locator('[data-live="fill"]')).toHaveText("2.7 / 2.7 mL");
});

test("pulling the tube off early leaves it short of its fixed ratio, and blocks", async ({ page })=>{
  await open(page, "teach");
  // Driven through the controls, deliberately: the vacuum runs in real time,
  // and a mouse gesture long enough to push a tube on and pull it off again
  // is long enough for the tube to have finished filling on its own. What is
  // being tested here is the ratio rule, not how fast a mouse can move.
  await page.locator("#colView").click();
  await page.locator('[data-col="take:lightblue"]').click();
  await page.locator('[data-col="push-braced"]').click();
  await page.locator('[data-col="remove-braced"]').click();

  const snap = await snapshot(page);
  expect(snap.tubes[0].removed).toBe(true);
  expect(snap.tubes[0].fraction).toBeLessThan(0.9);
  expect(snap.blocking).toContain("ratioInvalid");
  await expect(page.locator(".stg-msg")).toContainText("redrawn");
});

test("a tube filled to volume and pulled off is collected, and the coach says so", async ({ page })=>{
  const errors = attachDiagnostics(page);
  await open(page, "teach");
  await carryToHolder(page, "lightblue");
  await seatDrag(page, 16);
  await fastFill(page, 30);
  await seatDrag(page, -22);

  const snap = await snapshot(page);
  expect(snap.tubes[0].removed).toBe(true);
  expect(snap.tubes[0].fraction).toBeCloseTo(1, 3);
  expect(snap.currentKey).toBeNull();
  await expect(page.locator(".asm-panel")).toContainText("Light blue 100%");
  expect(errors).toEqual([]);
});

/* ---------- order of draw --------------------------------------------------------- */

test("reaching for the wrong tube first carries additive into the next one", async ({ page })=>{
  // The longest walk in this file: two tubes carried to the holder and three
  // seat drags between them. It sat just inside the 30s budget and now sits
  // just outside it, which is the flake docs/TESTING.md warns about — the
  // remedy is the same one every other multi-step walk here uses.
  test.slow();
  await open(page, "teach");
  // lavender (EDTA) before light blue (citrate) — the classic
  await carryToHolder(page, "lavender");
  await seatDrag(page, 16);
  await fastFill(page, 30);
  await seatDrag(page, -22);
  await carryToHolder(page, "lightblue");
  await seatDrag(page, 16);

  const snap = await snapshot(page);
  expect(snap.tubes[0].carryoverFrom).toBe("lavender");
  expect(snap.blocking).toContain("carryover");
  await expect(page.locator(".stg-msg")).toContainText("EDTA");
});

/* ---------- the two steps are one piece of work ---------------------------------- */

test("teaching mode will not leave the fill step until the first tube is off", async ({ page })=>{
  await open(page, "teach");
  await expect(page.locator("#colReady")).toBeDisabled();
  await carryToHolder(page, "lightblue");
  await seatDrag(page, 16);
  await fastFill(page, 30);
  await expect(page.locator("#colReady")).toBeDisabled();   // still on the holder
  await seatDrag(page, -22);
  await expect(page.locator("#colReady")).toBeEnabled();
});

test("the switch step inherits the tube the fill step already collected", async ({ page })=>{
  const errors = attachDiagnostics(page);
  await open(page, "teach");
  await carryToHolder(page, "lightblue");
  await seatDrag(page, 16);
  await fastFill(page, 30);
  await seatDrag(page, -22);
  await page.locator("#colReady").click();
  await expect(page.locator(".asm-coach")).toBeVisible();
  await page.waitForFunction(async ()=>!!(await window.__phlebTest.collectionAnchors()), null, { timeout:10000 });

  const snap = await snapshot(page);
  expect(snap.tubes[0].removed).toBe(true);
  expect(snap.tubes[0].fraction).toBeCloseTo(1, 3);
  expect(snap.tubes[1].taken).toBe(false);
  // the same needle, still where the insert step left it
  expect(snap.needleOut).toBe(false);
  // and the light blue tube is gone from the rack for good
  const a = await anchors(page);
  expect(Object.keys(a.rack)).toContain("lavender");
  expect(errors).toEqual([]);
});

test("a scored shift lets the learner leave whenever they judge it done", async ({ page })=>{
  await open(page, "play");
  await expect(page.locator("#colReady")).toBeEnabled();
  await expect(page.locator("#colReady")).toHaveText(/Carry on/);
  // and it says nothing about what is wrong
  await expect(page.locator(".stg-msg")).toContainText("assessed after the patient");
});

/* ---------- the coach does not tear itself down while the fill ticks -------------- */

test("the coach patches the ticking volume rather than re-rendering the panel", async ({ page })=>{
  await open(page, "teach");
  await carryToHolder(page, "lightblue");
  await seatDrag(page, 16);
  await page.evaluate(()=>{ document.querySelector("#colReady").dataset.probe = "1"; });
  await page.waitForTimeout(900);
  // the button survived a second of ticking fill — a wholesale re-render would
  // have replaced it, dropping focus and destroying in-flight clicks
  const kept = await page.evaluate(()=>document.querySelector("#colReady").dataset.probe);
  expect(kept).toBe("1");
  await expect(page.locator(".asm-panel")).toContainText("mL");
});

/* ---------- the accessible path ---------------------------------------------------- */

test("the controls path collects a tube through the same rules as the drag", async ({ page })=>{
  const errors = attachDiagnostics(page);
  await open(page, "teach");
  await page.locator("#colView").click();
  await page.locator('[data-col="take:lightblue"]').click();
  await page.locator('[data-col="push-braced"]').click();
  await fastFill(page, 30);
  await page.locator('[data-col="remove-braced"]').click();

  const snap = await snapshot(page);
  expect(snap.tubes[0].removed).toBe(true);
  expect(snap.tubes[0].fraction).toBeCloseTo(1, 3);
  expect(snap.needleOut).toBe(false);
  expect(errors).toEqual([]);
});

test("the controls path is not an easier game — it can dislodge the needle too", async ({ page })=>{
  await open(page, "teach");
  await page.locator("#colView").click();
  await page.locator('[data-col="take:lightblue"]').click();
  await page.locator('[data-col="push-unbraced"]').click();

  const snap = await snapshot(page);
  expect(snap.needleOut).toBe(true);
  expect(snap.blocking).toContain("needleOut");
});

test("a stopper pierced with the needle out of the vein kills that tube, and it can be replaced", async ({ page })=>{
  await open(page, "teach");
  await page.locator("#colView").click();
  await page.locator('[data-col="take:lightblue"]').click();
  await page.locator('[data-col="push-unbraced"]').click();   // needle out
  let snap = await snapshot(page);
  expect(snap.tubes[0].deadOnAir).toBe(true);
  expect(snap.blocking).toContain("deadTube");

  await page.locator('[data-col="discard"]').click();
  snap = await snapshot(page);
  expect(snap.tubesWasted).toBe(1);
  expect(snap.tubes[0].deadOnAir).toBe(false);
});

test("the controls view is fully keyboard operable", async ({ page })=>{
  await open(page, "teach");
  await page.locator("#colView").click();
  const take = page.locator('[data-col="take:lightblue"]');
  await take.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-col="push-braced"]')).toBeVisible();
  await page.locator('[data-col="push-braced"]').focus();
  await page.keyboard.press("Enter");
  const snap = await snapshot(page);
  expect(snap.tubes[0].pierced).toBe(true);
});

test("a short tube can be drawn again through the controls, and then the step is done", async ({ page })=>{
  const errors = attachDiagnostics(page);
  await open(page, "teach");
  await page.locator("#colView").click();
  await page.locator('[data-col="take:lightblue"]').click();
  await page.locator('[data-col="push-braced"]').click();
  await page.locator('[data-col="remove-braced"]').click();
  // every tube is off the holder, and the step still is not finished
  await expect(page.locator("#colReady")).toBeDisabled();

  await page.locator('[data-col="take:lightblue"]').click();
  await page.locator('[data-col="push-braced"]').click();
  await fastFill(page, 30);
  await page.locator('[data-col="remove-braced"]').click();

  const snap = await snapshot(page);
  expect(snap.tubes[0].fraction).toBeCloseTo(1, 3);
  expect(snap.tubesWasted).toBe(1);
  await expect(page.locator("#colReady")).toBeEnabled();
  expect(errors).toEqual([]);
});
