/* Development harness: walk the WHOLE loop the way a player does — clock in,
   through the draw, into the debrief — and report anything that breaks or
   reads wrong. This is the "play it repeatedly and fix what feels awkward"
   loop, not a test.

     node scripts/playthrough.mjs [mode]
*/
import { chromium } from "@playwright/test";

const OUT = "/tmp/claude-0/-home-user-PhlebLearn/ba449ffe-cf20-5800-82bb-9476a25f7f62/scratchpad";
const PORT = process.env.SHOT_PORT || 4181;
const MODE = process.argv[2] || "learn";

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on("pageerror", e => errs.push("pageerror: " + String(e)));
page.on("console", m => { if(m.type() === "error" && !/TUNNEL|404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
const say = (...a) => console.log(a.join(" "));

await page.goto(`http://localhost:${PORT}/PhlebLearn/?e2e=1`);
await page.waitForFunction(() => !!window.__phlebTest, null, { timeout: 15000 });

/* ---------- the menu ------------------------------------------------------ */
const modes = await page.$$eval("button[id^=mode]", bs => bs.map(b => b.id + ": " + b.textContent.trim()));
say("clock-in offers:\n  " + modes.join("\n  "));
await page.screenshot({ path: `${OUT}/pt-menu.png` });

/* ---------- a whole draw, driven programmatically through the same state
     every input path writes, so what is being checked is the FLOW ---------- */
await page.evaluate(m => window.__phlebTest.gotoProcedureStep("tourniquet", ["lightblue", "lavender", "gold"], m), MODE);
await page.waitForTimeout(1200);

const bench0 = await page.evaluate(() => window.__phlebTest.benchStats());
say("bench after first step:", JSON.stringify(bench0));

/** Walks the procedure, completing each step through its own programmatic path. */
const walk = await page.evaluate(async () => {
  const { ENC } = await import("/assets/build/index.js").catch(() => ({}));
  return null;
}).catch(() => null);

// drive it through the accessible/list controls, which write the same state
const steps = [];
for(let i = 0; i < 40; i++){
  const state = await page.evaluate(() => {
    const t = window.__phlebTest;
    return t.rewardSnapshot();
  });
  steps.push(state.step);
  // click whatever "continue" affordance the current step offers
  const advanced = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll("#panel button, #vpStage button")];
    const go = buttons.find(b => !b.disabled && /Continue|Next|Done|Ready|Confirm|Proceed|Finish|I have|Use controls/i.test(b.textContent));
    if(go){ go.click(); return go.textContent.trim().slice(0, 40); }
    return null;
  });
  if(!advanced) break;
  await page.waitForTimeout(180);
}
say("walked", new Set(steps).size, "distinct steps via panel controls");

/* ---------- what is on screen DURING the draw ----------------------------- */
const duringDraw = await page.evaluate(() => {
  const text = document.getElementById("panel").innerText;
  const top = document.querySelector(".topbar, #top, header");
  return {
    xp: (document.getElementById("tXp") || {}).textContent,
    coins: (document.getElementById("tCoins") || {}).textContent,
    hasXpFloat: !!document.querySelector(".floatxp, #floatXP"),
    hasStreakChip: !!document.getElementById("streakChip"),
    scoreBanner: /\+\d+ XP|\d+\/100/.test(text),
  };
});
say("during the draw →", JSON.stringify(duringDraw));

await page.screenshot({ path: `${OUT}/pt-draw.png` });

console.log("\n--- errors ---");
console.log(errs.length ? errs.slice(0, 12).join("\n") : "(none)");
await browser.close();
