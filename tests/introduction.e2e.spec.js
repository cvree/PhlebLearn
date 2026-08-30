/* =========================================================================
   INTRODUCTION AND IDENTIFICATION — browser acceptance tests against the
   PRODUCTION build.

   The unit tests prove the judgement. These prove the ARRIVAL ROOM is a real
   interaction and not an "Introduction complete" button: that the learner has
   to choose what to say, that a leading question is offered beside its open
   twin and is counted against them, that hand hygiene is a duration the
   pointer actually spends, and that what the patient discloses comes from
   data on the patient.

   It is no longer a STEP. Meeting somebody is not a screen in a procedure, so
   the draw starts at the work area and this happens before it — which is why
   these open a shift rather than jumping to a step id.
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

async function open(page, mode){
  await page.goto("./?e2e=1");
  await expect(page.locator("canvas")).toBeVisible({ timeout:15000 });
  await page.waitForFunction(()=>!!window.__phlebTest, null, { timeout:15000 });
  /* Hold the draw where the seam puts it. A step ends itself a beat after
     its completing action happens, which would race every assertion below
     about whether it is finished. See tests/benchHelpers.js. */
  await holdSteps(page);
  await page.locator(mode === "play" ? "#modePlay" : "#modeLearn").click();
  await expect(page.locator(".arrival")).toBeVisible({ timeout:10000 });
}

const snapshot = page => page.evaluate(()=>window.__phlebTest.introductionSnapshot());

/**
 * Says one thing.
 *
 * The room offers the two or three things that are LIVE right now rather than
 * all thirteen at once, so an act that is not yet on offer has to be reached
 * by saying what comes before it. That is the interaction, not an obstacle to
 * it — `liveActs()` is the whole replacement for the five fieldsets.
 */
async function act(page, id){
  const btn = page.locator(`[data-arr="${id}"]`);
  await expect(btn).toBeVisible({ timeout: 5000 });
  await btn.click();
  await page.waitForTimeout(120);
}

/** Says everything needed to reach `id`, then says it. */
async function reach(page, id){
  for(let i = 0; i < 12; i++){
    if(await page.locator(`[data-arr="${id}"]`).count()) return act(page, id);
    const first = page.locator(".arr-act").first();
    if(!(await first.count())) break;
    await first.click();
    await page.waitForTimeout(120);
  }
  return act(page, id);
}

/* -------------------------------------------------------------------------
   IT IS A CONVERSATION, NOT A BUTTON
   ------------------------------------------------------------------------- */

test("the room opens with nothing said, and a draw that cannot be started", async ({ page }) => {
  const errors = attachDiagnostics(page);
  await open(page);
  // Nothing said yet, so there is no conversation to show — an empty room
  // rather than a paragraph explaining that the room is empty.
  await expect(page.locator(".arr-said")).toHaveCount(0);
  // The gate is unchanged; a gate you cannot pass shows no button at all now
  // rather than a full-width disabled bar reading "Identify them first (0/2)".
  await expect(page.locator("#arrStart")).toHaveCount(0);
  // …and two or three live things to say, not thirteen.
  const acts = page.locator(".arr-act");
  expect(await acts.count()).toBeGreaterThan(0);
  expect(await acts.count()).toBeLessThanOrEqual(3);
  const s = await snapshot(page);
  expect(s.identifiers).toEqual([]);
  expect(s.ready).toBe(false);
  expect(errors).toEqual([]);
});

test("what you say is said, and the patient answers", async ({ page }) => {
  await open(page);
  await reach(page, "greet");
  await reach(page, "askNameOpen");
  const said = page.locator(".arr-said");
  await expect(said.locator(".arr-you").last()).toContainText("your full name");
  const answer = said.locator(".arr-them").last();
  await expect(answer).not.toBeEmpty();

  /* Some patients answer "what is your name?" with what they are CALLED
     rather than what they are registered as, and a nickname confirms nothing.
     Which patient rolled is not this test's business, so it asserts the rule:
     either the ask landed the identifier, or it landed a nickname and asking
     again gets the legal name. */
  let s = await snapshot(page);
  if(!s.identifiers.length){
    await expect(answer).toContainText(/everyone just calls me/i);
    await reach(page, "askNameOpen");
    s = await snapshot(page);
  }
  expect(s.identifiers).toEqual(["name"]);
});

test("the open ask and its leading twin are offered side by side", async ({ page }) => {
  // The entire lesson of the room: a patient will agree to a name that is not
  // theirs. Choosing wrongly has to be as easy as choosing rightly.
  await open(page);
  await reach(page, "greet");
  await expect(page.locator('[data-arr="askNameOpen"]')).toBeVisible();
  await expect(page.locator('[data-arr="askNameLeading"]')).toBeVisible();
});

test("a leading question is offered, works, and is counted against you", async ({ page }) => {
  await open(page);
  await reach(page, "askNameLeading");
  await reach(page, "askDobLeading");
  const s = await snapshot(page);
  // it DID identify them — the patient agreed, which is the hazard
  expect(s.identifiers.sort()).toEqual(["dob", "name"]);
  expect(s.leadingAsks).toBe(2);
  expect(s.issues).toContain("leadingQuestion");
});

test("one identifier is not enough to proceed", async ({ page }) => {
  await open(page);
  await reach(page, "askNameOpen");

  /* Some patients answer the open name ask with what they are CALLED, which
     confirms nothing and leaves them at zero. Which patient rolled is not
     this test's business — ask again and the legal name lands. */
  let s = await snapshot(page);
  if(!s.identifiers.length){
    await reach(page, "askNameOpen");
    s = await snapshot(page);
  }
  expect(s.identifiers).toEqual(["name"]);
  expect(s.blocking).toContain("oneIdentifier");
  // The gate is unchanged; a gate you cannot pass shows no button at all now
  // rather than a full-width disabled bar reading "Identify them first (0/2)".
  await expect(page.locator("#arrStart")).toHaveCount(0);
});

/* -------------------------------------------------------------------------
   HAND HYGIENE IS TIME SPENT
   ------------------------------------------------------------------------- */

test("holding the rub button spends real seconds", async ({ page }) => {
  const errors = attachDiagnostics(page);
  await open(page);
  const before = (await snapshot(page)).hygieneSeconds;
  const rub = page.locator("#arrRub");
  // the panel scrolls, and raw mouse.move does not scroll for you the way
  // locator.click() does — without this the press lands on whatever happens
  // to be at those coordinates instead
  await rub.scrollIntoViewIfNeeded();
  const box = await rub.boundingBox();
  await page.mouse.move(box.x + box.width/2, box.y + box.height/2);
  await page.mouse.down();
  await page.waitForTimeout(1600);
  await page.mouse.up();
  const after = (await snapshot(page)).hygieneSeconds;
  expect(after).toBeGreaterThan(before + 1);
  expect(after).toBeLessThan(before + 4);
  expect(errors).toEqual([]);
});

test("the accessible control reaches the same state as the hold", async ({ page }) => {
  await open(page);
  await page.locator('[data-arr-scrub="20"]').click();
  const s = await snapshot(page);
  expect(s.hygieneSeconds).toBeGreaterThanOrEqual(20);
  expect(s.issues).not.toContain("handsNotWashed");
});

test("gloves straight after washing are wet gloves, and it is measured", async ({ page }) => {
  await open(page);
  await page.locator('[data-arr-scrub="20"]').click();
  await act(page, "glove");
  const s = await snapshot(page);
  expect(s.gloved).toBe(true);
  expect(s.dryingSeconds).toBeLessThan(5);
  expect(s.issues).toContain("glovedWet");
});

test("waiting for your hands to dry is real time passing, and clears it", async ({ page }) => {
  await open(page);
  await page.locator('[data-arr-scrub="20"]').click();
  expect((await snapshot(page)).dryingSeconds).toBeLessThan(1);
  await page.waitForTimeout(6000);
  const dried = await snapshot(page);
  expect(dried.dryingSeconds).toBeGreaterThanOrEqual(5);
  await act(page, "glove");
  const s = await snapshot(page);
  expect(s.issues).not.toContain("glovedWet");
});

/* -------------------------------------------------------------------------
   GLOVES AFTER GLOVING
   ------------------------------------------------------------------------- */

test("answering the phone with gloves on contaminates them, and blocks", async ({ page }) => {
  await open(page);
  await page.locator('[data-arr-scrub="20"]').click();
  await act(page, "glove");
  await act(page, "touchPhone");
  let s = await snapshot(page);
  expect(s.gloveContaminated).toBe(true);
  expect(s.blocking).toContain("gloveContaminated");

  // and it is recoverable, which is the point of a recoverable error
  await page.locator("#arrReglove").click();
  s = await snapshot(page);
  expect(s.gloveContaminated).toBe(false);
});

/* -------------------------------------------------------------------------
   TRIGGER DATA, NEVER TEXT
   ------------------------------------------------------------------------- */

test("what the patient discloses is decided by data on the patient", async ({ page }) => {
  await open(page);
  // `history` is booleans on the patient, decided when they were generated.
  // Whatever they happen to be for this run, the reply has to follow THEM —
  // there is no sentence anywhere for the code to have read instead.
  const before = await snapshot(page);
  await reach(page, "askAllergies");
  const after = await snapshot(page);
  const reply = after.transcript[after.transcript.length - 1].reply;
  if(before.history.latexAllergy) expect(reply).toMatch(/Latex/i);
  else if(before.history.adhesiveAllergy) expect(reply).toMatch(/plaster/i);
  else expect(reply).toMatch(/None/i);
});

test("gloving in latex on a patient who told you they react to it is a critical event", async ({ page }) => {
  await open(page);
  // the history is rolled per patient, so pin it and let the rules do the rest
  await page.evaluate(()=>window.__phlebTest.setPatientHistory({ latexAllergy: true }));
  await reach(page, "askNameOpen");
  await reach(page, "askDobOpen");
  await reach(page, "askAllergies");
  const asked = await snapshot(page);
  expect(asked.transcript[asked.transcript.length - 1].reply).toMatch(/Latex/i);

  await page.locator('[data-arr-scrub="20"]').click();
  await page.waitForTimeout(6000);
  await act(page, "glove");
  const s = await snapshot(page);
  expect(s.gloveMaterial).toBe("latex");
  expect(s.blocking).toContain("latexOnAllergicPatient");

  // …and switching before gloving is the way out of it
  await page.reload();
  await open(page);
  await page.evaluate(()=>window.__phlebTest.setPatientHistory({ latexAllergy: true }));
  await page.locator('[data-arr-glove="nitrile"]').click();
  await reach(page, "askNameOpen");
  await reach(page, "askDobOpen");
  await page.locator('[data-arr-scrub="20"]').click();
  await page.waitForTimeout(6000);
  await act(page, "glove");
  expect((await snapshot(page)).blocking).not.toContain("latexOnAllergicPatient");
});

/* -------------------------------------------------------------------------
   THE WHOLE STEP, AND WHAT IT FEEDS
   ------------------------------------------------------------------------- */

test("a complete introduction unlocks the step and feeds the rubric row", async ({ page }) => {
  const errors = attachDiagnostics(page);
  await open(page);
  for(const id of ["greet","askNameOpen","askDobOpen","confirmOrder","explain","askAllergies","askFainting","position"]){
    await reach(page, id);
  }
  // The nickname trap: if the first open ask got what they are CALLED, ask
  // again — a nickname confirms nothing, which is the whole point of it.
  if(!(await snapshot(page)).identifiers.includes("name")) await reach(page, "askNameOpen");
  // Having asked about allergies, ACT on the answer. The tray defaults to
  // latex, so a learner who heard "latex, yes" and gloved up anyway would
  // fail here — which is the mechanic, not a flaky test.
  if((await snapshot(page)).history.latexAllergy){
    await page.locator('[data-arr-glove="nitrile"]').click();
  }
  await page.locator('[data-arr-scrub="20"]').click();
  await page.waitForTimeout(5500);            // let the hands dry, in real time
  await act(page, "glove");

  const s = await snapshot(page);
  expect(s.blocking).toEqual([]);
  expect(s.ready).toBe(true);
  await expect(page.locator("#arrStart")).toBeEnabled();

  await carryOn(page, "#arrStart");
  // The draw starts at the supply cart — there is no introduction STEP any
  // more — and the rubric row has a measurement from the room.
  await expect(page.locator(".arrival")).toHaveCount(0, { timeout:10000 });
  const report = await page.evaluate(async ()=>{
    await window.__phlebTest.finishDraw();
    return window.__phlebTest.practicalReport();
  });
  const row = report.categories.find(c=>c.id === "introduction");
  expect(row.score).toBeGreaterThan(0);
  expect(row.evidence[0].present).toBe(true);
  expect(row.evidence[0].narrative).toMatch(/hand hygiene/);
  expect(errors).toEqual([]);
});

test("Play does not tell you what to say next, or anything else", async ({ page }) => {
  await open(page, "play");
  // No coaching of any kind: no verdict box, no standing reminder, no teaching
  // panel. The things to say are still offered — that is the interaction, not
  // instruction — and the one gate still gates.
  await expect(page.locator(".arrival .stg-msg")).toHaveCount(0);
  await expect(page.locator(".lesson")).toHaveCount(0);
  expect(await page.locator(".arr-act").count()).toBeGreaterThan(0);
  // The gate is unchanged; a gate you cannot pass shows no button at all now
  // rather than a full-width disabled bar reading "Identify them first (0/2)".
  await expect(page.locator("#arrStart")).toHaveCount(0);

  // …and once identified, it does not stop you starting a draw done badly.
  for(let i = 0; i < 8; i++){
    const s = await page.evaluate(()=>window.__phlebTest.introductionSnapshot());
    if(s && s.identifiers.length >= 2) break;
    const a = page.locator(".arr-act").first();
    if(!(await a.count())) break;
    await a.click();
    await page.waitForTimeout(150);
  }
  await expect(page.locator("#arrStart")).toBeEnabled();
});
