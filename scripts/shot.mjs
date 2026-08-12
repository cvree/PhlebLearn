/* Development harness: open the bench at a given step and save a screenshot.
   Not part of the test suite — this is the "play it and look at it" loop.
     node scripts/shot.mjs <stepId> [outfile] [mode]
*/
import { chromium } from "@playwright/test";

const step = process.argv[2] || "tourniquet";
const out = process.argv[3] || `/tmp/claude-0/-home-user-PhlebLearn/ba449ffe-cf20-5800-82bb-9476a25f7f62/scratchpad/${step}.png`;
const mode = process.argv[4] || "learn";
const PORT = process.env.SHOT_PORT || 4175;

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on("pageerror", e => errs.push(String(e)));
page.on("console", m => { if(m.type() === "error") errs.push("console: " + m.text()); });

await page.goto(`http://localhost:${PORT}/PhlebLearn/?e2e=1`);
await page.waitForFunction(() => !!window.__phlebTest, null, { timeout: 15000 });
await page.evaluate(([s, m]) => window.__phlebTest.gotoProcedureStep(s, ["lightblue", "lavender"], m), [step, mode]);
await page.waitForTimeout(1600);
await page.screenshot({ path: out });
console.log("saved", out);
if(errs.length) console.log("ERRORS:\n" + errs.slice(0, 12).join("\n"));
await browser.close();
