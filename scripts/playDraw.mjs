/* THE NO-INSTRUCTIONS TEST, as a script.

   Walks a Play draw doing only things to OBJECTS — no "Carry on" pressed, no
   step counter read, nothing typed. If the draw advances on its own, the
   actions are the interface, which is the whole claim Play makes.

     node scripts/playDraw.mjs [outdir]
*/
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const outdir = process.argv[2] || "/tmp/playdraw";
mkdirSync(outdir, { recursive: true });
const PORT = process.env.SHOT_PORT || 4175;

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_PATH || undefined,
  args: ["--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on("pageerror", e => errs.push(String(e)));

await page.goto(`http://localhost:${PORT}/PhlebLearn/?e2e=1`);
await page.waitForFunction(() => !!window.__phlebTest, null, { timeout: 20000 });
await page.evaluate(() => window.__phlebTest.gotoProcedureStep(
  "tourniquet", ["lightblue", "lavender"], "play", "straight-antecubital"));
await page.waitForTimeout(1500);

let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? "  ok  " : " FAIL "} ${what}`);
  if(!ok) failures++;
};

/* ---- the panel has nothing to read ------------------------------------- */

check(await page.getAttribute("#panel", "data-chrome") === "hud",
  "Play shows a HUD, not the chrome of a lesson");

const chromeText = await page.evaluate(() => {
  const panel = document.getElementById("panel");
  const stage = document.getElementById("vpStage");
  let t = "";
  for(const node of panel.childNodes){ if(node === stage) break; t += (node.textContent || ""); }
  return t.trim();
});
check(chromeText.length < 60,
  `nothing to read above the stage — ${JSON.stringify(chromeText)}`);
check((await page.locator(".vp-count").count()) === 0, "no step counter");
check((await page.locator(".vp-bar").count()) === 0, "no progress bar");
check((await page.locator(".lesson").count()) === 0, "no teaching box");

/* THE WHOLE PANEL, not just the chrome above the stage. The first version of
   this check only looked above the stage and passed while the step's own coach
   was still printing a five-line paragraph on how to tie a tourniquet. */
const panelText = (await page.locator("#panel").innerText()).replace(/\s+/g, " ").trim();
check(panelText.length < 140,
  `the whole panel is quiet — ${panelText.length} chars: ${JSON.stringify(panelText.slice(0, 120))}`);
check(!/drag it round|Press a fingertip|Bring the needle|Anchor the vein/i.test(panelText),
  "no gesture instructions anywhere in Play");

await page.screenshot({ path: `${outdir}/1-band.png` });

/* ---- the draw advances because the action happened ---------------------- */

// The band goes on through its own pure helpers — the gesture, not a button.
await page.evaluate(() => window.__phlebTest.applyBandWell());

let advanced = false;
for(let i = 0; i < 40; i++){
  await page.waitForTimeout(150);
  if(await page.evaluate(() => !!window.__phlebTest.palpationSnapshot())){ advanced = true; break; }
}
check(advanced, "the band went on and the draw moved to palpation, with nothing pressed");
await page.screenshot({ path: `${outdir}/2-palpate.png` });

/* ---- and again, on the next step --------------------------------------- */

if(advanced){
  // Palpate the arm for real, then commit to one of the learner's own traces.
  await page.evaluate(async () => {
    await window.__phlebTest.palpateVessel("median-cubital", 0.62);
  });
  await page.waitForTimeout(200);
  const snap = await page.evaluate(() => window.__phlebTest.palpationSnapshot());
  check((snap.traces || []).length > 0, "palpating left a mark on the skin");

  await page.evaluate(() => window.__phlebTest.chooseTrace(0));
  let moved = false;
  for(let i = 0; i < 40; i++){
    await page.waitForTimeout(150);
    if(await page.evaluate(() => !!window.__phlebTest.cleaningSnapshot())){ moved = true; break; }
  }
  check(moved, "committing to a vein moved the draw to antisepsis, with nothing pressed");
  await page.screenshot({ path: `${outdir}/3-clean.png` });
}

if(errs.length){
  console.log("\nPAGE ERRORS:\n" + errs.slice(0, 8).join("\n"));
  failures++;
}
console.log(failures ? `\n${failures} failure(s)` : "\nPlay draws itself.");
process.exitCode = failures ? 1 : 0;
await browser.close();
