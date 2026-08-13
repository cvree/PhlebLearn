/* =========================================================================
   THE BENCH SESSION AND THE SILENT DRAW, in a real browser.

   Two acceptance criteria from the redesign brief that can only be checked
   against a live scene:

     "The arm mesh and scene are constructed once per encounter and disposed
      once. Zero buildArmScene() calls after the encounter begins."

     "Zero numeric scores, XP values, coin values or grade banners appear
      between 'patient sits down' and the debrief."

   Both are regressions waiting to happen — one mode calling dispose() on the
   bench instead of its lease, one well-meaning `floatXP` put back — and both
   are invisible in a screenshot, so they are asserted here.
   ========================================================================= */
import { test, expect } from "@playwright/test";

/** Every bench mode, in the order a draw meets them. */
const MODES = ["tourniquet", "palpate", "clean", "assemble", "insert"];

async function boot(page){
  await page.goto("/?e2e=1");
  await page.waitForFunction(() => !!window.__phlebTest, null, { timeout: 20000 });
}

test("one encounter builds ONE bench, however many steps it passes through", async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__phlebTest.gotoProcedureStep("tourniquet", ["lightblue", "lavender"], "learn"));
  await page.waitForTimeout(900);

  const first = await page.evaluate(() => window.__phlebTest.benchStats());
  expect(first.open).toBe(true);
  const key = first.key;

  for(const step of MODES){
    // jumpToStep, NOT gotoProcedureStep: the latter rolls a fresh patient, and
    // a fresh patient is supposed to get a fresh bench.
    await page.evaluate(s => window.__phlebTest.jumpToStep(s), step);
    await page.waitForTimeout(500);
    const stats = await page.evaluate(() => window.__phlebTest.benchStats());
    expect(stats.open, `bench closed while entering ${step}`).toBe(true);
    // Exactly one lease at a time: a mode that forgot to release its own would
    // pile them up, and a mode that disposed the bench would close it.
    expect(stats.leases, `${step} left ${stats.leases} leases open`).toBe(1);
  }

  // Same patient throughout, so it must be the same bench the whole way.
  const last = await page.evaluate(() => window.__phlebTest.benchStats());
  expect(last.key, "the bench was rebuilt mid-encounter").toBe(key);
});

test("the band stays tied: the strap survives every mode after it", async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__phlebTest.gotoProcedureStep("tourniquet", ["lightblue"], "learn"));
  await page.waitForTimeout(900);
  await page.evaluate(() => window.__phlebTest.tourniquetSnapshot());

  const afterTourniquet = await page.evaluate(() => window.__phlebTest.benchStats());
  expect(afterTourniquet.props).toContain("strap");

  for(const step of ["palpate", "clean", "insert"]){
    await page.evaluate(s => window.__phlebTest.jumpToStep(s), step);
    await page.waitForTimeout(450);
    const stats = await page.evaluate(() => window.__phlebTest.benchStats());
    expect(stats.props, `the band vanished on the way into ${step}`).toContain("strap");
  }
});

test("no score of any kind is shown between the patient sitting down and the debrief", async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__phlebTest.gotoProcedureStep("tourniquet", ["lightblue", "lavender"], "learn"));
  await page.waitForTimeout(900);
  for(const step of MODES){
    await page.evaluate(s => window.__phlebTest.jumpToStep(s), step);
    await page.waitForTimeout(450);

    const seen = await page.evaluate(() => {
      const panel = document.getElementById("panel");
      return {
        xp: (document.getElementById("tXp") || {}).textContent,
        coins: (document.getElementById("tCoins") || {}).textContent,
        floats: document.querySelectorAll(".floatxp, .float-xp, #floatXP").length,
        streakChip: document.querySelectorAll("#streakChip").length,
        // a section grade banner reads "92/100"; an XP award reads "+14 XP"
        grades: (panel.innerText.match(/\b\d{1,3}\s*\/\s*100\b/g) || []).length,
        xpAwards: (panel.innerText.match(/\+\s*\d+\s*XP/gi) || []).length,
        coinAwards: (panel.innerText.match(/\+\s*\d+\s*(coins?|🪙)/gi) || []).length,
      };
    });

    expect(seen.xp, `XP was on screen during ${step}`).toBe("—");
    expect(seen.coins, `coins were on screen during ${step}`).toBe("—");
    expect(seen.floats, `an XP float appeared during ${step}`).toBe(0);
    expect(seen.streakChip, `a streak chip appeared during ${step}`).toBe(0);
    expect(seen.grades, `a section grade appeared during ${step}`).toBe(0);
    expect(seen.xpAwards, `an XP award appeared during ${step}`).toBe(0);
    expect(seen.coinAwards, `a coin award appeared during ${step}`).toBe(0);
  }
});

test("the tourniquet can be grabbed anywhere along its length", async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__phlebTest.gotoProcedureStep("tourniquet", ["lightblue"], "learn"));
  await page.waitForTimeout(900);

  // The old code accepted only the two tips. Every point along it now works,
  // and where you grabbed decides which END is free, never whether you can.
  for(const t of [0.1, 0.3, 0.5, 0.7, 0.9]){
    const p = await page.evaluate(v => window.__phlebTest.screenPointOnStrap(v), t);
    expect(p, `no strap point at t=${t}`).not.toBeNull();
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    const grabbed = await page.evaluate(async () => {
      const s = await window.__phlebTest.tourniquetSnapshot();
      return s.phase;
    });
    await page.mouse.up();
    expect(grabbed).toBe("loose");
  }
});

test("one natural stroke across the arm produces a correctly wrapped band", async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__phlebTest.gotoProcedureStep("tourniquet", ["lightblue"], "learn"));
  await page.waitForTimeout(900);

  const mid = await page.evaluate(() => window.__phlebTest.screenPointOnStrap(0.5));
  const band = await page.evaluate(() =>
    window.__phlebTest.screenPointsOnLimb([[0.088, 1.45, 0.05], [0.088, -1.45, 0.05]]));

  await page.mouse.move(mid.x, mid.y);
  await page.mouse.down();
  for(let i = 0; i <= 26; i++){
    await page.mouse.move(
      band[0].x + (band[1].x - band[0].x)*i/26,
      band[0].y + (band[1].y - band[0].y)*i/26
    );
    await page.waitForTimeout(12);
  }
  await page.mouse.up();
  await page.waitForTimeout(700);

  const s = await page.evaluate(() => window.__phlebTest.tourniquetSnapshot());
  expect(s.phase, "one stroke did not route the band").not.toBe("loose");
  expect(s.wrap, "a stroke against the skin must read as passing UNDER").toBe("under");
  // and it lands square, not spiralled: the magnetic seating's whole job
  expect(s.skew).toBeLessThan(0.006);
});

test("palpation reports sensation while the finger is MOVING, with no hold timer", async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__phlebTest.gotoProcedureStep("palpate", ["lightblue"], "learn"));
  await page.waitForTimeout(1100);

  const from = await page.evaluate(() => window.__phlebTest.screenPointOverVessel("cephalic"));
  const to = await page.evaluate(() => window.__phlebTest.screenPointOverVessel("median-cubital"));
  expect(from).not.toBeNull();

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const feels = new Set();
  for(let i = 0; i <= 24; i++){
    // NEVER pausing: the old model needed 110ms of stillness plus 850ms of
    // pressure ramp before it would report anything at all.
    await page.mouse.move(from.x + (to.x - from.x)*i/24, from.y + (to.y - from.y)*i/24);
    const s = await page.evaluate(() => window.__phlebTest.palpationSnapshot());
    if(s && s.feel && s.feel !== "nothing") feels.add(s.feel);
  }
  await page.mouse.up();

  expect(feels.size, "a continuous sweep felt nothing").toBeGreaterThan(0);
  const snap = await page.evaluate(() => window.__phlebTest.palpationSnapshot());
  expect(snap.felt.length, "a sweep across two vessels recorded neither").toBeGreaterThan(0);
});
