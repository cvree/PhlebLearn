/* Opens EVERY step in BOTH modes and fails on any page error.

   Written after a template literal referencing an out-of-scope variable threw
   inside one coach's render, which took the whole panel with it. The build
   does not catch that — the code is valid — and the unit suite does not run
   the coaches. It showed up as an unrelated e2e failure three suites away.

     node scripts/checkSteps.mjs
*/
import { chromium } from "@playwright/test";

const PORT = process.env.SHOT_PORT || 4175;

const STEPS = [
  "introduce", "gather", "tourniquet", "palpate", "clean", "assemble", "uncap",
  "insert", "fill", "switch", "release", "withdraw", "safety", "dispose",
  "pressure", "bandage", "invert",
];
const MODES = ["learn", "play"];
const PROCEDURES = ["straight-antecubital", "butterfly-hand"];

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_PATH || undefined,
  args: ["--enable-unsafe-swiftshader"],
});

let failures = 0;
for(const procedure of PROCEDURES){
  for(const mode of MODES){
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errs = [];
    page.on("pageerror", e => errs.push(String(e)));
    page.on("console", m => {
      if(m.type() !== "error") return;
      const t = m.text();
      if(/ERR_TUNNEL_CONNECTION_FAILED|Failed to load resource|GL Driver Message/.test(t)) return;
      errs.push("console: " + t);
    });
    await page.goto(`http://localhost:${PORT}/PhlebLearn/?e2e=1`);
    await page.waitForFunction(() => !!window.__phlebTest, null, { timeout: 20000 });

    for(const step of STEPS){
      errs.length = 0;
      await page.evaluate(a => window.__phlebTest.gotoProcedureStep(
        a[0], ["lightblue", "lavender"], a[1], a[2]), [step, mode, procedure]);
      await page.waitForTimeout(420);

      // The panel must actually have rendered something. A coach that throws
      // mid-template leaves the stage empty rather than leaving an error the
      // eye would notice.
      const painted = await page.evaluate(() => {
        const stage = document.getElementById("vpStage");
        return stage ? stage.innerHTML.trim().length : -1;
      });
      if(painted <= 0) errs.push(`the stage rendered nothing (${painted})`);

      // …and both the controls path and the 3D path have to survive it.
      const toggle = page.locator("[id$='View']").first();
      if(await toggle.count()){
        await toggle.click().catch(()=>{});
        await page.waitForTimeout(320);
        const after = await page.evaluate(() => {
          const stage = document.getElementById("vpStage");
          return stage ? stage.innerHTML.trim().length : -1;
        });
        if(after <= 0) errs.push("the stage rendered nothing after toggling the view");
      }

      if(errs.length){
        failures++;
        console.log(` FAIL  ${procedure} · ${mode} · ${step}`);
        errs.slice(0, 3).forEach(e => console.log(`         ${e}`));
      }
    }
    console.log(`  ..    ${procedure} · ${mode} — ${STEPS.length} steps`);
    await page.close();
  }
}

console.log(failures ? `\n${failures} step(s) broken` : "\nevery step renders, in both modes, for both procedures");
process.exitCode = failures ? 1 : 0;
await browser.close();
