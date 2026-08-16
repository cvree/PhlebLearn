/* Development harness: open the bench at a given step and save a screenshot.
   Not part of the test suite — this is the "play it and look at it" loop.

     node scripts/look.mjs <stepId> [outfile] [mode] [procedure] [w] [h]

   Differs from shot.mjs in three ways that matter when you are actually
   looking at the game rather than smoke-testing it:

     - it FORCES a procedure (default straight-antecubital), because
       `indicatedProcedure()` legitimately routes some random patients to the
       dorsal-hand draw, which is controls-only and has no 3D scene to look at;
     - it takes a viewport size, so the panel-overflow and framing bugs that
       only appear at particular widths can be reproduced;
     - it reports page errors loudly and exits non-zero on them.
*/
import { chromium } from "@playwright/test";

const step = process.argv[2] || "tourniquet";
const out = process.argv[3] || `/tmp/${step}.png`;
const mode = process.argv[4] || "learn";
const procedure = process.argv[5] || "straight-antecubital";
const width = Number(process.argv[6] || 1280);
const height = Number(process.argv[7] || 800);
const PORT = process.env.SHOT_PORT || 4175;

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_PATH || undefined,
  args: ["--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width, height } });
const errs = [];
page.on("pageerror", e => errs.push(String(e)));
page.on("console", m => {
  if(m.type() !== "error") return;
  const t = m.text();
  if(t.includes("ERR_TUNNEL_CONNECTION_FAILED")) return;   // CDN progressive enhancements
  if(t.includes("Failed to load resource")) return;
  errs.push("console: " + t);
});

await page.goto(`http://localhost:${PORT}/PhlebLearn/?e2e=1`);
await page.waitForFunction(() => !!window.__phlebTest, null, { timeout: 20000 });
await page.evaluate(([s, m, p]) =>
  window.__phlebTest.gotoProcedureStep(s, ["lightblue", "lavender"], m, p),
[step, mode, procedure]);
await page.waitForTimeout(1800);
await page.screenshot({ path: out });
console.log("saved", out);
if(errs.length){
  console.log("ERRORS:\n" + errs.slice(0, 12).join("\n"));
  process.exitCode = 1;
}
await browser.close();
