/* Stages a complete work area through the list view, switches back to the 3D
   cart, and screenshots it. This is the loop that would have caught items
   sinking through the tray floor: the checklist said four things were on the
   tray and the tray looked empty.

     node scripts/lookStaged.mjs [outfile]
*/
import { chromium } from "@playwright/test";

const out = process.argv[2] || "/tmp/staged.png";
const PORT = process.env.SHOT_PORT || 4175;

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_PATH || undefined,
  args: ["--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(`http://localhost:${PORT}/PhlebLearn/?e2e=1`);
await page.waitForFunction(() => !!window.__phlebTest, null, { timeout: 20000 });
await page.evaluate(() =>
  window.__phlebTest.gotoProcedureStep("gather", ["lightblue", "lavender"], "learn", "straight-antecubital"));
await page.waitForTimeout(1200);

// Into the list view, stage everything correct, then back to the cart.
await page.locator("#stgView").click();
await page.waitForTimeout(300);
const catalog = await page.evaluate(() => window.__phlebTest.stagingCatalog());
for(const cat of ["gloves", "tourniquet", "alcohol", "needle", "holder", "gauze", "bandage"]){
  const d = catalog.find(c => c.category === cat && c.usable);
  if(d) await page.locator(`[data-stage="${d.id}"][data-zone="tray"]`).click();
}
const tubes = catalog.filter(c => c.category === "tube" && c.usable);
for(let i = 0; i < tubes.length; i++){
  await page.locator(`[data-stage="${tubes[i].id}"][data-zone="rack"][data-slot="${i}"]`).click();
}
const sharps = catalog.find(c => c.category === "sharps" && c.usable);
if(sharps) await page.locator(`[data-stage="${sharps.id}"][data-zone="reach"]`).click();

await page.locator("#stgView").click();
await page.waitForTimeout(1400);
await page.screenshot({ path: out });
console.log("saved", out);

// And the thing the picture is supposed to prove, as a number.
const report = await page.evaluate(() => window.__phlebTest.stagedHeights());
console.log(JSON.stringify(report, null, 1));
await browser.close();
