/* =========================================================================
   TWO MODES — browser acceptance tests against the PRODUCTION build.

   The unit tests prove the reveal table is internally distinct. These prove
   the distinction reaches the screen: that Learn instructs, and that Play
   says NOTHING — including that it does not leak a verdict through colour,
   which is how every judgement in this app is expressed, and that it does not
   leak one through chrome either. A step counter, a progress bar and a button
   marked "Carry on" are all ways of telling a trained phlebotomist where they
   are in a piece of software, and Play has none of them.
   ========================================================================= */
import { test, expect } from "@playwright/test";
import { carryOn, dismissHelp, holdSteps, expectStepReady } from "./benchHelpers.js";

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

async function openStep(page, stepId, mode){
  await page.goto("./?e2e=1");
  await expect(page.locator("canvas")).toBeVisible({ timeout:15000 });
  await page.waitForFunction(()=>!!window.__phlebTest, null, { timeout:15000 });
  /* Hold the draw where the seam puts it. A step ends itself a beat after
     its completing action happens, which would race every assertion below
     about whether it is finished. See tests/benchHelpers.js. */
  await holdSteps(page);
  await page.evaluate(a=>window.__phlebTest.gotoProcedureStep(a[0], ["lightblue","lavender"], a[1], "straight-antecubital"), [stepId, mode]);
  await expect(page.locator("#vpStage")).toBeVisible({ timeout:10000 });
}

/* -------------------------------------------------------------------------
   The mode picker
   ------------------------------------------------------------------------- */

test("the clock-in screen offers exactly two modes", async ({ page }) => {
  const errors = attachDiagnostics(page);
  await page.goto("./");
  await dismissHelp(page);
  await expect(page.locator("#modeLearn")).toBeVisible({ timeout:15000 });
  await expect(page.locator("#modePlay")).toBeVisible();
  await expect(page.locator("#modeLearn")).toContainText("Learn");
  await expect(page.locator("#modePlay")).toContainText("Play");
  // the two that were removed are gone, not merely renamed
  await expect(page.locator("#modePractice")).toHaveCount(0);
  await expect(page.locator("#modeFinal")).toHaveCount(0);
  await expect(page.locator("#modeBench")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Make it harder lives in Settings, and locks while a shift is running", async ({ page }) => {
  const errors = attachDiagnostics(page);
  await page.goto("./");
  await dismissHelp(page);
  await expect(page.locator("#modeLearn")).toBeVisible({ timeout:15000 });

  // not on the clock-in screen any more
  await expect(page.locator("#panel .chal-chip")).toHaveCount(0);

  await page.locator("#settingsBtn").click();
  const box = page.locator("#setChallenges");
  await expect(box).toBeVisible();
  await expect(box).toContainText("Make it harder");
  // it is a <details>, collapsed by default so Settings stays scannable
  await box.locator("summary").click();
  const chips = box.locator(".chal-chip");
  expect(await chips.count()).toBeGreaterThan(4);

  // editable at clock-in: arming one shows up on the clock-in screen
  await chips.first().click();
  await expect(chips.first()).toHaveAttribute("aria-pressed", "true");
  await page.locator("#setClose").click();
  await expect(page.locator("#panel .chal-armed")).toBeVisible();

  /* And now the thing that made moving this non-trivial. Challenges are armed
     ONCE, before the first patient is rolled, because "Deep vein" changes the
     arm that roll produces. Clock-in could not be reached mid-draw; Settings
     can. So a running shift must not be editable. */
  await page.locator("#modeLearn").click();
  await expect(page.locator("#panel")).toContainText(/requisition|Patient|arrives/i, { timeout:10000 });
  await page.locator("#settingsBtn").click();
  await box.locator("summary").click();
  await expect(box).toContainText("Changes apply to your next one");
  await expect(box.locator(".chal-chip").first()).toBeDisabled();
  expect(errors).toEqual([]);
});

/* -------------------------------------------------------------------------
   What each mode puts on the screen
   ------------------------------------------------------------------------- */

test("Learn teaches the step, gates it, and says where you are", async ({ page }) => {
  const errors = attachDiagnostics(page);
  await openStep(page, "insert", "learn");
  await expect(page.locator("#vpStage")).toHaveAttribute("data-reveal", "learn");

  /* The teaching used to be a permanent card above the coach, printing the
     step's tip and its "why it matters" on every frame while the coach said
     the same thing three more ways underneath. It is the body of the step's
     own fold now, open on a first meeting and shut after — so what "Learn
     teaches the step" means is that the tip and the reason are there to read.
     See venipuncture/stepGuide.js. */
  const how = page.locator("#vpStage .sg-how");
  await expect(how).toBeVisible();
  await expect(how.locator("summary")).toContainText(/How this step works/i);
  await expect(how).toContainText(/bevel-up at a shallow/i);
  await expect(how).toContainText(/Why it matters/i);

  await expect(page.locator("#vpStage .stg-msg.neutral")).toHaveCount(0);
  await expectStepReady(page, false);
  // the chrome of a lesson: which step, how far through, and what it is called
  await expect(page.locator(".vp-count")).toContainText("step");
  await expect(page.locator(".vp-bar")).toBeVisible();
  await expect(page.locator("#panel")).toHaveAttribute("data-chrome", "full");
  expect(errors).toEqual([]);
});

test("Play says nothing at all: no lesson, no hint, no counter, no bar", async ({ page }) => {
  const errors = attachDiagnostics(page);
  await openStep(page, "insert", "play");
  await expect(page.locator("#vpStage")).toHaveAttribute("data-reveal", "play");
  await expect(page.locator("#panel")).toHaveAttribute("data-chrome", "hud");

  await expect(page.locator(".lesson")).toHaveCount(0);
  await expect(page.locator(".vp-hint")).toHaveCount(0);
  await expect(page.locator(".vp-count")).toHaveCount(0);
  await expect(page.locator(".vp-bar")).toHaveCount(0);
  // no fold either: the teaching is Learn's, and Play has none of it
  await expect(page.locator("#vpStage .sg-how")).toHaveCount(0);
  await expect(page.locator("#vpStage .stg-msg")).toHaveCount(0);

  /* The one control Play keeps, and it is not a verdict: nothing else can
     walk a scored shift on from work that is not right, and this step is not
     right — nothing has been anchored yet. */
  await expectStepReady(page, false);
  await expect(page.locator("#insReady")).toBeEnabled();
  await expect(page.locator("#insReady")).toHaveText(/Carry on/);
  expect(errors).toEqual([]);
});

test("Play shows a HUD of values, not a coaching panel of prose", async ({ page }) => {
  const errors = attachDiagnostics(page);
  await openStep(page, "fill", "play");
  const hud = page.locator("#panel .hud");
  await expect(hud).toBeVisible();
  // who this is, and how many tubes — the two things worth knowing mid-draw
  await expect(hud.locator(".hud-who")).not.toBeEmpty();
  await expect(hud.locator(".hud-tubes")).toContainText("/2");

  /* The HUD is the WHOLE panel above the stage. If a paragraph of teaching
     prose has crept back in, this is what catches it: the no-instructions
     test is that a trained phlebotomist never has to read anything. */
  const chromeText = await page.evaluate(()=>{
    const panel = document.getElementById("panel");
    const stage = document.getElementById("vpStage");
    let t = "";
    for(const node of panel.childNodes){
      if(node === stage) break;
      t += (node.textContent || "");
    }
    return t.trim();
  });
  expect(chromeText.length, `Play printed prose above the stage: ${chromeText}`).toBeLessThan(60);
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

test("Learn colours a measured value; Play renders the same value plain", async ({ page }) => {
  const errors = attachDiagnostics(page);
  const learn = await valuesIn(page, "learn");
  const play = await valuesIn(page, "play");

  // the same nodes, with the same verdict classes, in both modes
  expect(play.map(v=>v.cls)).toEqual(learn.map(v=>v.cls));
  expect(learn.some(v=>/\b(good|bad|wait)\b/.test(v.cls))).toBe(true);

  // …but only Learn lets the class reach the pixels
  expect(play.every(v=>v.decoration === "none")).toBe(true);
  expect(new Set(play.map(v=>v.colour)).size).toBe(1);
  const changed = learn.filter((v, i)=>v.colour !== play[i].colour);
  expect(changed.length, "Learn showed no verdict colour at all").toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

/* -------------------------------------------------------------------------
   Section feedback and replay — Practice's two good ideas, now in Learn
   ------------------------------------------------------------------------- */

test("a section worth another look stops the draw, with its measurements and a replay", async ({ page }) => {
  test.slow();
  const errors = attachDiagnostics(page);
  await openStep(page, "tourniquet", "learn");

  /* Learn will not leave a step until it is right — that is the mode — so the
     band has to actually go on. This one goes on ACCEPTABLY and no better:
     under the arm, tucked, snug enough to pass, and crooked enough down the
     limb to be worth doing again. A clean section does not stop the draw any
     more (see panels.js's sectionFeedbackFor), which is the point of using a
     scruffy one here. */
  await page.evaluate(()=>window.__phlebTest.applyBandScruffily());
  await expectStepReady(page, true);
  await carryOn(page);

  const card = page.locator(".sec-card").first();
  await expect(card).toBeVisible({ timeout:10000 });
  await expect(card.locator(".sec-score")).toContainText("/100");
  // The card can carry two narrative paragraphs (the reading, and "nothing was
  // recorded" when there are no mistakes), so assert on what the learner
  // actually reads rather than on one node.
  await expect(card).toContainText(/Band at .*″ above the site/);

  // replaying rewinds to the section's first step and clears its session
  await page.locator("#secAgain").click();
  await expect(page.locator("#vpStage")).toBeVisible({ timeout:10000 });
  const snap = await page.evaluate(()=>window.__phlebTest.tourniquetSnapshot());
  expect(snap).not.toBeNull();
  expect(snap.bandX).toBeNull();
  expect(errors).toEqual([]);
});

test("a clean section does not stop the draw to tell you it went well", async ({ page }) => {
  test.slow();
  const errors = attachDiagnostics(page);
  await openStep(page, "tourniquet", "learn");

  await page.evaluate(()=>window.__phlebTest.applyBandWell());
  await expectStepReady(page, true);
  await carryOn(page);

  /* Straight on to the next step. Eleven modal cards a draw, each telling the
     learner that the thing they just did well went well and offering to replay
     it, is eleven interruptions with no decision in any of them. */
  await expect(page.locator(".sec-card")).toHaveCount(0);
  await expect(page.locator("#vpStage")).toBeVisible({ timeout:10000 });
  await expect(page.locator(".plp-coach")).toBeVisible({ timeout:10000 });
  expect(errors).toEqual([]);
});

test("Play never shows a section card — nothing is said until the report", async ({ page }) => {
  await openStep(page, "tourniquet", "play");
  await carryOn(page);
  await page.waitForTimeout(600);
  await expect(page.locator(".sec-card")).toHaveCount(0);
});

/* -------------------------------------------------------------------------
   THE FIRST VISIT

   A save with nothing on it arrives at a game whose central interaction —
   dragging a limb and the things around it — is not discoverable from a
   screen with two buttons on it, and whose two modes differ in whether the
   learner is told anything at all. These prove the game says so, once, and
   then stops saying it.
   ------------------------------------------------------------------------- */

test("a first visit is told how the game is operated, and only once", async ({ page }) => {
  const errors = attachDiagnostics(page);
  await page.goto("./");
  await page.waitForFunction(()=>window.__tinyVialsBooted === true, null, { timeout:20000 });

  const card = page.locator("#helpOverlay.show");
  await expect(card).toBeVisible({ timeout:10000 });
  // the two things a screen with two buttons on it cannot say for itself
  await expect(card).toContainText("Drag on the scene");
  await expect(card).toContainText("Use controls");

  await page.locator("#helpClose").click();
  await expect(card).toBeHidden();
  await expect(page.getByRole("heading", { name:/Clock in/i })).toBeVisible();

  // the same browser, the same save: it does not come back
  await page.goto("./");
  await page.waitForFunction(()=>window.__tinyVialsBooted === true, null, { timeout:20000 });
  await expect(page.getByRole("heading", { name:/Clock in/i })).toBeVisible({ timeout:15000 });
  await expect(page.locator("#helpOverlay.show")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("it stays reachable from Settings once it has been dismissed", async ({ page }) => {
  await page.goto("./");
  await dismissHelp(page);
  await expect(page.getByRole("heading", { name:/Clock in/i })).toBeVisible({ timeout:15000 });

  await page.locator("#settingsBtn").click();
  await page.locator("#openHelpSettings").click();
  await expect(page.locator("#helpOverlay.show")).toBeVisible();
  // Esc closes the topmost overlay, which is this one
  await page.keyboard.press("Escape");
  await expect(page.locator("#helpOverlay.show")).toHaveCount(0);
});

test("a save with nothing on it is pointed at Learn, and a played one at Play", async ({ page }) => {
  await page.goto("./");
  await dismissHelp(page);
  await expect(page.locator("#modeLearn")).toBeVisible({ timeout:15000 });

  /* Which button glows is the game's own recommendation, and on an empty save
     it used to walk a beginner into the mode that says nothing at all. */
  await expect(page.locator("#modeLearn")).toHaveClass(/cta-pulse/);
  await expect(page.locator("#modePlay")).not.toHaveClass(/cta-pulse/);
  await expect(page.locator("#modeLearn")).toContainText("start here");

  // Once there is anything on the save, the emphasis goes back to Play. The
  // save is edited directly rather than played through: what is under test is
  // which button the clock-in screen highlights, not how XP is earned.
  await page.evaluate(()=>{
    const k = "phleb_shift_3d_v1";
    const s = JSON.parse(localStorage.getItem(k) || "{}");
    s.xp = 40; s.shifts = 1;
    localStorage.setItem(k, JSON.stringify(s));
  });
  await page.goto("./");
  await expect(page.locator("#modePlay")).toBeVisible({ timeout:15000 });
  await expect(page.locator("#modePlay")).toHaveClass(/cta-pulse/);
  await expect(page.locator("#modeLearn")).not.toHaveClass(/cta-pulse/);
});
