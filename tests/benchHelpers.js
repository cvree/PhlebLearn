/* =========================================================================
   Shared helpers for the browser tests that drive the BENCH.

   Every bench step projects a screen point from a known place in the scene and
   then drives the pointer at it. That is only sound once the camera has
   stopped moving — and the camera in this game never cuts, so entering a step
   is always half a second of easing, plus another re-frame the moment the
   coach panel finishes laying out and the obstruction measurement changes.

   A point projected during either move is a point the object has left by the
   time the pointer gets there. On a runner with no GPU this scene renders at
   two to six frames a second, all of it on the main thread, which makes that
   window well over a second wide — long enough that "await a timeout and
   hope" is not a strategy.

   So: wait on the app's own answer to "have you finished moving?", and
   require it several times running so a re-frame that has not started yet
   cannot be mistaken for one that has finished.
   ========================================================================= */

/**
 * Blocks until the bench camera has settled and STAYED settled.
 *
 * Polled INSIDE the page rather than from the test.
 * The first version of this ran one `page.evaluate` per sample, and on this
 * runner a round trip is acknowledged only once the renderer's main thread
 * gets to it — which is a frame, which is up to half a second. Fifty samples
 * of that is half a minute of a ninety-second budget spent asking a question,
 * and it timed out tests that were doing nothing wrong. In-page polling costs
 * one round trip in total.
 *
 * THREE THINGS THIS HAS TO GET RIGHT, each learned by watching it fail.
 *
 * 1. THE SAMPLING LOOP RUNS INSIDE THE PAGE, DRIVEN BY THE PAGE.
 *
 *    Not by `waitForFunction`. Every question this helper asks — benchStats —
 *    goes through the test seam, and every seam function is `async` because it
 *    reaches its module through a dynamic import. A `waitForFunction` predicate
 *    that returns a promise hands the runner a Promise object, which is
 *    truthy, so the wait finished on its first poll and this helper returned
 *    having waited for nothing at all.
 *
 * 2. THE `settled` FLAG ALONE IS NOT ENOUGH.
 *
 *    `cameraSettled` answers "is the rig where it currently WANTS to be?",
 *    and that is true in the window between the entry ease finishing and the
 *    coach panel finishing its own layout — at which point
 *    measureObstruction() moves the want and the rig eases again.
 *
 * 3. NEITHER IS "settled PLUS a projected point holding still" — the fix
 *    this replaced. It picked ONE point close to the arm's surface near its
 *    local origin, and a re-frame that is mostly a ZOOM (a `dist`/`fov`
 *    change) moves a point near the optical centre very little while moving
 *    a point 6cm off the surface — where collection's holder mouth and
 *    insert's ready pose actually are — by tens of pixels. The check reported
 *    "stable" while the geometry a test was about to reach for was still
 *    sliding. `tests/collection.e2e.spec.js` failed 8 of 20 with exactly this
 *    signature (a gesture that runs, claims the pointer, and changes nothing)
 *    before this was found — assembly and tourniquet never showed it, because
 *    everything they touch sits close to the surface near the arm's origin,
 *    which is precisely the blind spot in the point that was chosen.
 *
 *    So this waits on the CAMERA'S OWN TARGET instead of on the screen effect
 *    of one arbitrarily chosen point: `benchStats().wantSig` is a fingerprint
 *    of where `fitCamera()` last told the rig to go (see armScene.js's
 *    `cameraWantSignature`), and holding both `settled` AND an unchanged
 *    `wantSig` for several samples means arrived, and not about to be told to
 *    move again — independent of where in the scene any given test looks.
 */
export async function settleBench(page){
  await page.evaluate(() => {
    const w = window;
    /* Each call supersedes any loop still running from a previous step. */
    const token = (w.__benchSettleToken = (w.__benchSettleToken || 0) + 1);
    w.__benchSettleOk = false;
    (async () => {
      const done = () => { if(w.__benchSettleToken === token) w.__benchSettleOk = true; };
      const t = w.__phlebTest;
      if(!t || !t.benchStats) return done();      // not a bench step; nothing to wait for
      let still = 0, from = 0, prevSig;
      const deadline = performance.now() + 25000;
      for(;;){
        if(w.__benchSettleToken !== token) return;   // a later settleBench owns this now
        let s = null;
        try{ s = await t.benchStats(); }catch(_){}
        if(!s || !s.open) return done();

        // Arrived, AND not mid-flight to a newly issued target.
        const holding = s.settled && s.wantSig != null && s.wantSig === prevSig;
        if(holding){ if(still++ === 0) from = performance.now(); }
        else still = 0;
        prevSig = s.wantSig;

        // Four still samples AND a real stretch of wall time, so a slow
        // renderer cannot deliver four identical samples from inside one frame.
        if(still >= 4 && performance.now() - from > 400) return done();
        // Never hang a test on this: give up waiting and let the assertion
        // that follows be the thing that reports the problem.
        if(performance.now() > deadline) return done();
        await new Promise(r => setTimeout(r, 120));
      }
    })();
  });
  await page.waitForFunction(() => window.__benchSettleOk === true, null, { timeout: 30000 }).catch(() => {});
}

/**
 * Waits for a step to end, whether or not there is a button to end it with.
 *
 * There used to be one on every step in Learn. There is not any more: a step
 * ends because the ACTION that ends it happened, in both modes, and the panel
 * simply holds the finished step and its verdict for a beat before moving on.
 * The two steps that still end on a press — the arrival room and the supply
 * cart, where "done" is a judgement rather than an event — still have one, and
 * this clicks it.
 *
 * So the contract is "get past this step", not "click this thing". Absence of
 * the button is the normal case and this waits out the settle instead. What
 * each test still asserts afterwards is that it arrived at the RIGHT next
 * step, which is the claim that actually matters.
 */
export async function carryOn(page, selector){
  const named = selector ? page.locator(selector) : null;
  if(named && await named.count() && await named.isEnabled().catch(()=>false)){
    await named.click({ timeout: 5000 }).catch(()=>{});
    return true;
  }
  /* In Learn there is nothing to click: end the step the way the draw itself
     would, through the seam. Deterministic, rather than sleeping out the
     settle and hoping a software renderer reached the frame that ticks it. */
  if(await page.evaluate(() => window.__phlebTest && window.__phlebTest.endStep
      ? window.__phlebTest.endStep() : false)) return true;
  /* Not ready, so implicit advancement will not have it. That is a scored
     shift walking on from work that is not right, which is exactly what the
     Carry on button is for and the only thing left that can do it. */
  const hatch = page.locator("#vpStage .btn.vp-tap.quiet");
  if(await hatch.count()){
    await hatch.first().click({ timeout: 5000 }).catch(()=>{});
    return true;
  }
  return false;
}

/**
 * Picks the routing that is actually right for this patient.
 *
 * Learn refuses a wrong one with a hint rather than committing it, so this
 * tries each until one takes. Which one is right is rolled per patient and is
 * not what any caller of this is testing.
 */
export async function chooseRoute(page){
  for(let i = 0; i < 3; i++){
    if(await page.locator("[data-route].good").count()) return true;
    const r = page.locator("[data-route]").nth(i);
    if(!(await r.count())) break;
    await r.click().catch(()=>{});
    await page.waitForTimeout(120);
  }
  return (await page.locator("[data-route].good").count()) > 0;
}

/**
 * Dismisses the section card, if the step that just ended raised one.
 *
 * Learn stops at the end of a section that is worth another look — below the
 * clean bar, or with something recorded against it — and offers to replay it.
 * A test walking a whole section through has to get past that, and it is
 * NOT folded into `carryOn()`: whether the card appears at all is a claim
 * `tests/modes.e2e.spec.js` makes on purpose, and a helper that silently
 * clicked it away would delete that claim everywhere else.
 */
export async function pastSectionCard(page){
  const on = page.locator("#secOn");
  if(!(await on.count())) return false;
  await on.click({ timeout: 5000 }).catch(()=>{});
  return true;
}

/**
 * Holds the draw on whatever step it is on.
 *
 * Every spec that asserts "this step is now complete" needs this: without it,
 * the step ends itself a beat after becoming ready and the readiness being
 * asserted belongs to the following step by the time the assertion runs. The
 * advancement itself is covered by tests/autoAdvance.spec.js and, end to end,
 * by tests/modes.e2e.spec.js — which deliberately does NOT hold it.
 */
export async function holdSteps(page){
  await page.evaluate(() => window.__phlebTest && window.__phlebTest.holdSteps
    ? window.__phlebTest.holdSteps(true) : null);
}

/**
 * Whether the step on screen reports its completing action as having happened.
 *
 * The browser tests used to read this off the confirm button's disabled state,
 * which was a fair proxy while the button existed. It is published on the
 * guidance block instead now — one handle, the same in both modes, and it
 * survives the button going away. See venipuncture/stepGuide.js.
 */
export async function stepReady(page){
  return page.evaluate(() => {
    const el = document.querySelector("#vpStage .sg[data-ready], #arrivalStage .sg[data-ready]")
      || document.querySelector(".sg[data-ready]");
    return el ? el.dataset.ready === "1" : null;
  });
}

/** Asserts the step's readiness, waiting for it to get there. */
export async function expectStepReady(page, want, opts){
  const timeout = (opts && opts.timeout) || 10000;
  await page.waitForFunction(w => {
    const el = document.querySelector("#vpStage .sg[data-ready], #arrivalStage .sg[data-ready]")
      || document.querySelector(".sg[data-ready]");
    return !!el && (el.dataset.ready === "1") === w;
  }, want, { timeout });
}

/**
 * Closes the first-run "How this works" card if it is up.
 *
 * A save that has never played gets it once, over the clock-in screen, which
 * is exactly the state every test starting from `/` is in. Dismissing it is
 * what a real player does on their first visit, so the tests do it too rather
 * than the game hiding itself from them behind the `?e2e=1` seam.
 *
 * It waits for the app to boot first: the card is opened at the end of boot(),
 * so asking for it the instant `goto` resolves would always miss it and leave
 * an overlay to appear later, over the very button the test is about to press.
 */
export async function dismissHelp(page){
  await page.waitForFunction(() => window.__tinyVialsBooted === true, null, { timeout: 20000 }).catch(()=>{});
  const overlay = page.locator("#helpOverlay.show");
  await overlay.waitFor({ state:"visible", timeout: 2500 }).catch(()=>{});
  if(!(await overlay.count())) return false;                    // a save that has played already
  await page.locator("#helpClose").click({ timeout: 5000 }).catch(()=>{});
  await overlay.waitFor({ state:"hidden", timeout: 5000 }).catch(()=>{});
  return true;
}
