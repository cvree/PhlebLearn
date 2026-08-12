/* Development harness: play the bench with a real pointer and report what
   happened. Not part of the test suite — this is the "play it repeatedly and
   fix what feels wrong" loop the redesign brief asks for.

     node scripts/play.mjs [outdir]
*/
import { chromium } from "@playwright/test";

const OUT = process.argv[2] || "/tmp/claude-0/-home-user-PhlebLearn/ba449ffe-cf20-5800-82bb-9476a25f7f62/scratchpad";
const PORT = process.env.SHOT_PORT || 4175;

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on("pageerror", e => errs.push("pageerror: " + String(e)));
page.on("console", m => { if(m.type() === "error" && !/TUNNEL|404/.test(m.text())) errs.push("console: " + m.text()); });

const log = [];
const say = (...a) => { const s = a.join(" "); log.push(s); console.log(s); };

async function goto(step, tubes){
  await page.goto(`http://localhost:${PORT}/PhlebLearn/?e2e=1`);
  await page.waitForFunction(() => !!window.__phlebTest, null, { timeout: 15000 });
  await page.evaluate(([s, t]) => window.__phlebTest.gotoProcedureStep(s, t, "learn"), [step, tubes || ["lightblue","lavender"]]);
  await page.waitForTimeout(1400);
}

async function drag(points, opts){
  const o = opts || {};
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  for(let i = 1; i < points.length; i++){
    await page.mouse.move(points[i].x, points[i].y);
    if(o.stepDelay) await page.waitForTimeout(o.stepDelay);
  }
  if(o.holdMs) await page.waitForTimeout(o.holdMs);
  if(!o.keepDown) await page.mouse.up();
}

function lerpPath(a, b, n){
  const out = [];
  for(let i = 0; i <= n; i++) out.push({ x: a.x + (b.x - a.x)*i/n, y: a.y + (b.y - a.y)*i/n });
  return out;
}

/* ---------- 1. the tourniquet: grab anywhere, one stroke ------------------- */
await goto("tourniquet");
{
  const before = await page.evaluate(() => window.__phlebTest.tourniquetSnapshot());
  say("tourniquet start phase:", before.phase);

  // grab the strap in the MIDDLE of its length, which the old code refused
  const mid = await page.evaluate(() => window.__phlebTest.screenPointOnStrap(0.5));
  say("grabbing strap at its midpoint", JSON.stringify(mid));

  // one natural stroke across the arm, near the band's ideal window
  const band = await page.evaluate(() => window.__phlebTest.screenPointsOnLimb([[0.088, 1.45, 0.05], [0.088, -1.45, 0.05]]));
  const path = [mid, ...lerpPath(band[0], band[1], 26)];
  await drag(path, { stepDelay: 12 });
  await page.waitForTimeout(700);
  const routed = await page.evaluate(() => window.__phlebTest.tourniquetSnapshot());
  say("after ONE stroke → phase:", routed.phase, "wrap:", routed.wrap,
      "bandX:", routed.bandX == null ? "-" : routed.bandX.toFixed(3),
      "skew(mm):", routed.skew == null ? "-" : (routed.skew*1000).toFixed(1));

  if(routed.phase !== "loose"){
    // tension: pull the tail clear of the arm and let go in the good zone
    const pull = await page.evaluate(() => window.__phlebTest.screenPointsOnLimb([[0.088, -0.9, 0.05], [0.088, -0.9, 0.115]]));
    await drag(lerpPath(pull[0], pull[1], 22), { stepDelay: 22, holdMs: 260 });
    await page.waitForTimeout(500);
    const set = await page.evaluate(() => window.__phlebTest.tourniquetSnapshot());
    say("after pull → phase:", set.phase, "tension:", set.tension.toFixed(2),
        "distension:", set.distension == null ? "-" : set.distension.toFixed(2),
        "ready:", set.ready, "blocking:", JSON.stringify(set.blocking));
  }
  await page.screenshot({ path: `${OUT}/play-tourniquet.png` });
}

/* ---------- 2. palpation: sweep and feel ---------------------------------- */
await goto("palpate");
{
  const t0 = Date.now();
  const from = await page.evaluate(() => window.__phlebTest.screenPointOverVessel("cephalic"));
  const via  = await page.evaluate(() => window.__phlebTest.screenPointOverVessel("biceps-tendon"));
  const to   = await page.evaluate(() => window.__phlebTest.screenPointOverVessel("median-cubital"));
  if(!from || !to){ say("palpation: could not locate vessels on screen"); }
  else {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    const feels = [];
    const pts = [...lerpPath(from, via || to, 16), ...lerpPath(via || to, to, 16)];
    for(const p of pts){
      await page.mouse.move(p.x, p.y);
      await page.waitForTimeout(22);
      const s = await page.evaluate(() => window.__phlebTest.palpationSnapshot());
      if(s && s.feel) feels.push(s.feel);
    }
    await page.mouse.up();
    const uniq = [...new Set(feels)];
    say("palpation: sweeping WITHOUT ever stopping produced feels:", JSON.stringify(uniq),
        "in", ((Date.now()-t0)/1000).toFixed(1) + "s");
    const snap = await page.evaluate(() => window.__phlebTest.palpationSnapshot());
    say("  press at end:", snap.press.toFixed(2), "felt so far:", JSON.stringify(snap.felt),
        "arteryProximity:", (snap.arteryProximity||0).toFixed(2));
  }
  await page.screenshot({ path: `${OUT}/play-palpation.png` });
}

/* ---------- 3. the stick: five phases, then the flash --------------------- */
await goto("insert");
{
  // anchor first
  const anchors = await page.evaluate(() => window.__phlebTest.insertAnchors());
  const r = await page.evaluate(x => window.__phlebTest.insertLimbRadiusAt(x), anchors.markX - 0.035);
  const ap = await page.evaluate(([mx, rr]) => window.__phlebTest.screenPointsOnInsertLimb([
    [mx - 0.030, 0.15, rr], [mx - 0.046, 0.15, rr],
  ]), [anchors.markX, r]);
  await drag(lerpPath(ap[0], ap[1], 14), { stepDelay: 18 });
  await page.waitForTimeout(300);
  let s = await page.evaluate(() => window.__phlebTest.insertSnapshot());
  say("anchor set:", s.anchorSet, "pull(mm):", (s.anchorPull*1000).toFixed(1));

  // the approach: ready pose down to the mark, then keep pushing
  const ready = await page.evaluate(([mx, rr]) => window.__phlebTest.screenPointsOnInsertLimb([
    [mx - 0.035, 0.15, rr + 0.014],
    [mx, 0.15, rr + 0.002],
    [mx + 0.014, 0.15, rr - 0.010],
    [mx + 0.030, 0.15, rr - 0.020],
  ]), [anchors.markX, r]);

  const beats = [];
  await page.mouse.move(ready[0].x, ready[0].y);
  await page.mouse.down();
  const approach = [...lerpPath(ready[0], ready[1], 18), ...lerpPath(ready[1], ready[2], 22), ...lerpPath(ready[2], ready[3], 20)];
  for(const p of approach){
    await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(18);
    const d = await page.evaluate(() => window.__phlebTest.insertBeat());
    if(d && beats[beats.length-1] !== d) beats.push(d);
  }
  await page.mouse.up();
  await page.waitForTimeout(600);
  s = await page.evaluate(() => window.__phlebTest.insertSnapshot());
  say("insertion phases seen:", JSON.stringify(beats));
  say("  entry angle:", s.angleDeg, "depth(mm):", (s.depthM*1000).toFixed(1),
      "inVein:", s.inVein, "FLASH:", !!s.flashAt);
  await page.screenshot({ path: `${OUT}/play-insert.png` });
}

/* ---------- 4. the debrief ------------------------------------------------ */
{
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find(x => /Leave this draw|Finish|Next/.test(x.textContent));
    if(b) b.click();
  });
  await page.waitForTimeout(400);
}

console.log("\n--- errors ---");
console.log(errs.length ? errs.slice(0, 15).join("\n") : "(none)");
await browser.close();
