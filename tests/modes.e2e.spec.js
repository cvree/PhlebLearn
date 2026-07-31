/* =========================================================================
   THREE MODES — browser acceptance tests against the PRODUCTION build.

   The unit tests prove the reveal table is internally distinct. These prove
   the distinction reaches the screen: that Learn instructs, that Practice
   reminds without answering, and that the Final Practical says nothing —
   including that it does not leak a verdict through colour, which is how
   every judgement in this app is expressed.
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

async function openStep(page, stepId, mode){
  await page.goto("./?e2e=1");
  await expect(page.locator("canvas")).toBeVisible({ timeout:15000 });
  await page.waitForFunction(()=>!!window.__phlebTest, null, { timeout:15000 });
  await page.evaluate(a=>window.__phlebTest.gotoProcedureStep(a[0], ["lightblue","lavender"], a[1]), [stepId, mode]);
  await expect(page.locator("#vpStage")).toBeVisible({ timeout:10000 });
}

/* -------------------------------------------------------------------------
   The mode picker
   ------------------------------------------------------------------------- */

test("the idle screen offers three separate modes", async ({ page }) => {
  const errors = attachDiagnostics(page);
  await page.goto("./");
  await expect(page.locator("#modeLearn")).toBeVisible({ timeout:15000 });
  await expect(page.locator("#modePractice")).toBeVisible();
  await expect(page.locator("#modeFinal")).toBeVisible();
  await expect(page.locator("#modeFinal")).toContainText("Final Practical");
  expect(errors).toEqual([]);
});

/* -------------------------------------------------------------------------
   What each mode puts on the screen
   ------------------------------------------------------------------------- */

test("Learn teaches the step and gates the Continue button", async ({ page }) => {
  const errors = attachDiagnostics(page);
  await openStep(page, "insert", "learn");
  await expect(page.locator("#vpStage")).toHaveAttribute("data-reveal", "learn");
  await expect(page.locator(".lesson .modetag")).toContainText("TEACHING");
  await expect(page.locator("#vpStage .stg-msg.neutral")).toHaveCount(0);
  await expect(page.locator("#insReady")).toBeDisabled();
  expect(errors).toEqual([]);
});

test("Practice reminds the learner what the step is for, without answering it", async ({ page }) => {
  const errors = attachDiagnostics(page);
  await openStep(page, "insert", "practice");
  await expect(page.locator("#vpStage")).toHaveAttribute("data-reveal", "practice");
  await expect(page.locator(".lesson .modetag")).toHaveCount(0);
  // the standing reminder is there…
  const msg = page.locator("#vpStage .stg-msg.neutral");
  await expect(msg).toContainText("Reminder.");
  await expect(msg).toContainText("Anchor the vein");
  // …but nothing tells them what is wrong right now, and nothing blocks them
  await expect(page.locator("#vpStage .tq-next")).toHaveCount(0);
  await expect(page.locator("#insReady")).toBeEnabled();
  expect(errors).toEqual([]);
});

test("the Final Practical gives no reminder, no coaching and no gate", async ({ page }) => {
  const errors = attachDiagnostics(page);
  await openStep(page, "insert", "final");
  await expect(page.locator("#vpStage")).toHaveAttribute("data-reveal", "final");
  await expect(page.locator(".lesson .modetag")).toHaveCount(0);
  const msg = page.locator("#vpStage .stg-msg.neutral");
  await expect(msg).not.toContainText("Reminder.");
  await expect(msg).toContainText("assessed after the patient");
  await expect(page.locator("#insReady")).toBeEnabled();
  // the step's own tip sheet is not printed above the stage either
  await expect(page.locator(".vp-hint")).not.toContainText("shallow 15–30");
  expect(errors).toEqual([]);
});

/* -------------------------------------------------------------------------
   The verdict leak — every judgement in this app is a colour
   ------------------------------------------------------------------------- */

/** The rendered colour of every measured-value node in the stage. */
function valueColours(page){
  return page.evaluate(()=>{
    const stage = document.getElementById("vpStage");
    const nodes = [...stage.querySelectorAll(".asm-val, .cln-val, .tq-obsval")];
    return nodes.map(n=>({
      cls: n.className,
      colour: getComputedStyle(n).color,
      decoration: getComputedStyle(n).textDecorationLine,
    }));
  });
}

/** The colour a measured value carries in this mode, keyed by its classes. */
async function valuesIn(page, mode){
  // The insert coach renders a verdict-classed value the moment it opens
  // ("Anchor: not set" is `.asm-val.wait`), so the comparison needs no setup.
  await openStep(page, "insert", mode);
  await expect(page.locator("#vpStage .asm-coach")).toBeVisible({ timeout:10000 });
  const values = await valueColours(page);
  expect(values.length, `${mode} rendered no measured values`).toBeGreaterThan(0);
  return values;
}

test("Learn colours a measured value; the Final Practical renders the same value plain", async ({ page }) => {
  const errors = attachDiagnostics(page);
  const learn = await valuesIn(page, "learn");
  const final = await valuesIn(page, "final");

  // the same nodes, with the same verdict classes, in both modes
  expect(final.map(v=>v.cls)).toEqual(learn.map(v=>v.cls));
  expect(learn.some(v=>/\b(good|bad|wait)\b/.test(v.cls))).toBe(true);

  // …but only Learn lets the class reach the pixels
  expect(final.every(v=>v.decoration === "none")).toBe(true);
  expect(new Set(final.map(v=>v.colour)).size).toBe(1);
  const changed = learn.filter((v, i)=>v.colour !== final[i].colour);
  expect(changed.length, "Learn showed no verdict colour at all").toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test("Practice withholds the verdict too — it arrives at the end of the section", async ({ page }) => {
  const practice = await valuesIn(page, "practice");
  await expect(page.locator("#vpStage")).toHaveAttribute("data-verdicts", "0");
  expect(new Set(practice.map(v=>v.colour)).size).toBe(1);
});

/* -------------------------------------------------------------------------
   Practice's section feedback and replay
   ------------------------------------------------------------------------- */

test("Practice shows the section's own measurements when the section ends, and can replay it", async ({ page }) => {
  test.slow();
  const errors = attachDiagnostics(page);
  await openStep(page, "tourniquet", "practice");

  // finish the tourniquet section however it went
  await page.locator("#tqReady").click();

  const card = page.locator(".sec-card");
  await expect(card).toBeVisible({ timeout:10000 });
  await expect(page.locator("h2")).toContainText("Tourniquet");
  await expect(card.locator(".sec-score")).toContainText("/100");
  await expect(card.locator(".sec-narrative")).not.toBeEmpty();

  // replaying rewinds to the section's first step and clears its session
  await page.locator("#secAgain").click();
  await expect(page.locator("#vpStage")).toBeVisible({ timeout:10000 });
  const snap = await page.evaluate(()=>window.__phlebTest.tourniquetSnapshot());
  expect(snap).not.toBeNull();
  expect(snap.bandX).toBeNull();
  expect(errors).toEqual([]);
});

test("Learn and the Final Practical never show a section card", async ({ page }) => {
  for(const mode of ["learn", "final"]){
    await openStep(page, "tourniquet", mode);
    await page.locator("#tqReady").click({ force:true });
    await page.waitForTimeout(400);
    await expect(page.locator(".sec-card")).toHaveCount(0);
  }
});
