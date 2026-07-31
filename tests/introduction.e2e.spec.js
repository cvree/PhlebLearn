/* =========================================================================
   INTRODUCTION AND IDENTIFICATION — browser acceptance tests against the
   PRODUCTION build.

   The unit tests prove the judgement. These prove the step is a real
   interaction and not an "Introduction complete" button: that the learner
   has to choose what to say, that a leading question is available and is
   counted, that hand hygiene is a duration the pointer actually spends, and
   that what the patient discloses comes from data on the patient.
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
  await page.evaluate(m=>window.__phlebTest.gotoProcedureStep("introduce", ["lightblue","lavender"], m), mode||"learn");
  await expect(page.locator(".intro-coach")).toBeVisible({ timeout:10000 });
}

const snapshot = page => page.evaluate(()=>window.__phlebTest.introductionSnapshot());
const act = (page, id) => page.locator(`[data-intro="${id}"]`).click();

/* -------------------------------------------------------------------------
   IT IS A CONVERSATION, NOT A BUTTON
   ------------------------------------------------------------------------- */

test("the step opens on a conversation with nothing said yet", async ({ page }) => {
  const errors = attachDiagnostics(page);
  await open(page);
  await expect(page.locator(".intro-empty")).toContainText("Nothing has been said yet");
  await expect(page.locator("#introReady")).toBeDisabled();
  const s = await snapshot(page);
  expect(s.identifiers).toEqual([]);
  expect(s.ready).toBe(false);
  expect(errors).toEqual([]);
});

test("what you say goes into the transcript, and the patient answers", async ({ page }) => {
  await open(page);
  await act(page, "greet");
  await act(page, "askNameOpen");
  const lines = page.locator(".intro-script li");
  await expect(lines).toHaveCount(2);
  await expect(lines.nth(1).locator(".intro-you")).toContainText("your full name");
  await expect(lines.nth(1).locator(".intro-them")).not.toBeEmpty();
  const s = await snapshot(page);
  expect(s.identifiers).toEqual(["name"]);
});

test("a leading question is offered, works, and is counted against you", async ({ page }) => {
  await open(page);
  await act(page, "askNameLeading");
  await act(page, "askDobLeading");
  const s = await snapshot(page);
  // it DID identify them — the patient agreed, which is the hazard
  expect(s.identifiers.sort()).toEqual(["dob", "name"]);
  expect(s.leadingAsks).toBe(2);
  expect(s.issues).toContain("leadingQuestion");
});

test("one identifier is not enough to proceed", async ({ page }) => {
  await open(page);
  await act(page, "askNameOpen");
  const s = await snapshot(page);
  expect(s.blocking).toContain("oneIdentifier");
  await expect(page.locator("#introReady")).toBeDisabled();
});

/* -------------------------------------------------------------------------
   HAND HYGIENE IS TIME SPENT
   ------------------------------------------------------------------------- */

test("holding the rub button spends real seconds", async ({ page }) => {
  const errors = attachDiagnostics(page);
  await open(page);
  const before = (await snapshot(page)).hygieneSeconds;
  const rub = page.locator("#introRub");
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
  await page.locator('[data-intro-scrub="20"]').click();
  const s = await snapshot(page);
  expect(s.hygieneSeconds).toBeGreaterThanOrEqual(20);
  expect(s.issues).not.toContain("handsNotWashed");
});

test("gloves straight after washing are wet gloves, and it is measured", async ({ page }) => {
  await open(page);
  await page.locator('[data-intro-scrub="20"]').click();
  await act(page, "glove");
  const s = await snapshot(page);
  expect(s.gloved).toBe(true);
  expect(s.dryingSeconds).toBeLessThan(5);
  expect(s.issues).toContain("glovedWet");
});

test("waiting for your hands to dry is real time passing, and clears it", async ({ page }) => {
  await open(page);
  await page.locator('[data-intro-scrub="20"]').click();
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
  await page.locator('[data-intro-scrub="20"]').click();
  await act(page, "glove");
  await act(page, "touchPhone");
  let s = await snapshot(page);
  expect(s.gloveContaminated).toBe(true);
  expect(s.blocking).toContain("gloveContaminated");

  // and it is recoverable, which is the point of a recoverable error
  await page.locator("#introReglove").click();
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
  await act(page, "askAllergies");
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
  await act(page, "askNameOpen");
  await act(page, "askDobOpen");
  await act(page, "askAllergies");
  const asked = await snapshot(page);
  expect(asked.transcript[asked.transcript.length - 1].reply).toMatch(/Latex/i);

  await page.locator('[data-intro-scrub="20"]').click();
  await page.waitForTimeout(6000);
  await act(page, "glove");
  const s = await snapshot(page);
  expect(s.gloveMaterial).toBe("latex");
  expect(s.blocking).toContain("latexOnAllergicPatient");

  // …and switching before gloving is the way out of it
  await page.reload();
  await open(page);
  await page.evaluate(()=>window.__phlebTest.setPatientHistory({ latexAllergy: true }));
  await page.locator('[data-intro-glovemat="nitrile"]').click();
  await act(page, "askNameOpen");
  await act(page, "askDobOpen");
  await page.locator('[data-intro-scrub="20"]').click();
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
    await act(page, id);
  }
  // Having asked about allergies, ACT on the answer. The tray defaults to
  // latex, so a learner who heard "latex, yes" and gloved up anyway would
  // fail here — which is the mechanic, not a flaky test.
  if((await snapshot(page)).history.latexAllergy){
    await page.locator('[data-intro-glovemat="nitrile"]').click();
  }
  await page.locator('[data-intro-scrub="20"]').click();
  await page.waitForTimeout(5500);            // let the hands dry, in real time
  await act(page, "glove");

  const s = await snapshot(page);
  expect(s.blocking).toEqual([]);
  expect(s.ready).toBe(true);
  await expect(page.locator("#introReady")).toBeEnabled();

  await page.locator("#introReady").click();
  // the next step is the supply cart, and the row now has a measurement
  await expect(page.locator("#vpStage")).not.toContainText("Nothing has been said yet", { timeout:10000 });
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

test("the Final Practical does not tell you what to say next", async ({ page }) => {
  await open(page, "final");
  await expect(page.locator("#vpStage .tq-next")).toHaveCount(0);
  await expect(page.locator("#vpStage .stg-msg.neutral")).toContainText("assessed after the patient");
  // …and it does not stop you finishing badly
  await expect(page.locator("#introReady")).toBeEnabled();
});
