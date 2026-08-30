/* =========================================================================
   EQUIPMENT — browser acceptance tests for the upgrades that change the draw.

   The unit tests prove each upgrade moves the number it claims to. These
   prove the one thing they cannot: that owning the winged-set kit puts a real
   choice in front of the learner before the draw starts, and that choosing
   the winged set actually builds the OTHER procedure — different device,
   different site, different entry window — rather than the same draw with a
   different label.
   ========================================================================= */
import { test, expect } from "@playwright/test";
import { holdSteps } from "./benchHelpers.js";

/** Grants upgrades by writing the save the game itself reads. */
async function withUpgrades(page, ids){
  await page.addInitScript(list => {
    const KEY = "phleb_shift_3d_v1";
    let save = {};
    try{ save = JSON.parse(localStorage.getItem(KEY) || "{}"); }catch(e){}
    save.ownedUpgrades = list;
    save.coins = 500;
    localStorage.setItem(KEY, JSON.stringify(save));
  }, ids);
}

async function startDraw(page){
  await page.goto("./?e2e=1");
  await expect(page.locator("canvas")).toBeVisible({ timeout:15000 });
  await page.waitForFunction(()=>!!window.__phlebTest, null, { timeout:15000 });
  /* Hold the draw where the seam puts it. A step ends itself a beat after
     its completing action happens, which would race every assertion below
     about whether it is finished. See tests/benchHelpers.js. */
  await holdSteps(page);
  // `introduce` is the first step, so the choice screen (which precedes every
  // step) is what actually renders.
  await page.evaluate(()=>window.__phlebTest.gotoProcedureStep("introduce", ["lightblue","lavender"], "teach"));
}

test("without the kit, the arm decides the device and no choice is offered", async ({ page })=>{
  await withUpgrades(page, []);
  await startDraw(page);
  await expect(page.locator(".proc-opt")).toHaveCount(0);
});

test("with the kit, the learner chooses — and choosing the winged set builds the other procedure", async ({ page })=>{
  await withUpgrades(page, ["butterflyKit"]);
  await startDraw(page);

  const options = page.locator(".proc-opt");
  await expect(options).toHaveCount(2, { timeout:10000 });
  await page.locator('[data-proc="butterfly-hand"]').click();

  const proc = await page.evaluate(()=>window.__phlebTest.procedureSnapshot());
  expect(proc.procedureId).toBe("butterfly-hand");
  expect(proc.device).toBe("butterfly");
  expect(proc.siteKind).toBe("hand");
  expect(proc.gauge).toBe(23);
  // the entry window the insert step will judge against is the hand's, not
  // the antecubital's — which is the whole reason this is a second procedure
  expect(proc.angle.ideal.max).toBeLessThanOrEqual(15);
  // and the vessels palpated are the dorsal hand network
  expect(proc.armVessels.join(",")).toMatch(/metacarpal|dorsal/i);
});

test("choosing the straight needle keeps the antecubital procedure intact", async ({ page })=>{
  await withUpgrades(page, ["butterflyKit"]);
  await startDraw(page);
  await page.locator('[data-proc="straight-antecubital"]').click();

  const proc = await page.evaluate(()=>window.__phlebTest.procedureSnapshot());
  expect(proc.procedureId).toBe("straight-antecubital");
  expect(proc.gauge).toBe(21);
  expect(proc.angle.ideal.min).toBe(15);
});

test("the kit a learner owns is shown when they clock in", async ({ page })=>{
  await withUpgrades(page, ["veinFinder", "warmingPack"]);
  await page.goto("./?e2e=1");
  await expect(page.locator("canvas")).toBeVisible({ timeout:15000 });
  const pills = await page.locator(".pill").allTextContents();
  expect(pills.join(" | ")).toContain("Vein finder");
  expect(pills.join(" | ")).toContain("Warming pack");
});
