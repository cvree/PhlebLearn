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
 * Blocks until the bench camera has settled and STAYED settled, measured the
 * way the tests actually use it: by where a fixed point in the scene lands on
 * screen.
 *
 * TWO THINGS THIS HAS TO GET RIGHT, both learned the hard way.
 *
 * 1. THE SAMPLING LOOP RUNS INSIDE THE PAGE, DRIVEN BY THE PAGE.
 *
 *    Not by `waitForFunction`. Every question this helper asks — benchStats,
 *    a projection — goes through the test seam, and every seam function is
 *    `async` because it reaches its module through a dynamic import. A
 *    `waitForFunction` predicate that returns a promise hands the runner a
 *    Promise object, which is truthy, so the wait finished on its first poll
 *    and this helper returned having waited for nothing at all. It looked
 *    like it was working because the camera is usually PART of the way there
 *    by then; measured on a slow renderer the projection was still 52 pixels
 *    from where it would come to rest. So the loop lives in the page and the
 *    runner waits on a plain boolean, which cannot be accidentally truthy.
 *
 *    One round trip in total either way. The first version of this ran one
 *    `page.evaluate` per sample, and on this runner a round trip is
 *    acknowledged only once the renderer's main thread gets to it — which is
 *    a frame, which is up to half a second.
 *
 * 2. THE `settled` FLAG ALONE IS NOT ENOUGH.
 *
 *    `cameraSettled` answers "is the rig where it currently WANTS to be?",
 *    and that is true in the window between the entry ease finishing and the
 *    coach panel finishing its own layout — at which point
 *    measureObstruction() moves the want and the rig eases again. So this
 *    also requires the PROJECTION to hold still, which is the only property a
 *    projected drag actually depends on, and is immune to whatever moves the
 *    camera next.
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
      let still = 0, from = 0, prev = null;
      const deadline = performance.now() + 25000;
      for(;;){
        if(w.__benchSettleToken !== token) return;   // a later settleBench owns this now
        let s = null;
        try{ s = await t.benchStats(); }catch(_){}
        if(!s || !s.open) return done();

        /* A fixed point on the limb, through whichever bench mode is live —
           every step leases the same bench, so this projects in all of them. */
        let mark = null;
        try{
          const p = await t.screenPointsOnBenchLimb([[0.02, 0, 0.001]]);
          if(p && p[0]) mark = p[0];
        }catch(_){}

        // Sub-pixel is "not moving". Anything else restarts the streak.
        const holding = s.settled && mark && prev
          && Math.hypot(mark.x - prev.x, mark.y - prev.y) < 0.75;
        if(holding){ if(still++ === 0) from = performance.now(); }
        else still = 0;
        prev = mark;

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
 * Confirms a step, whether or not the confirm button is still there.
 *
 * In Learn a step ends when the learner presses that button, and this clicks
 * it. In Play the ACTION that ends a step ends it — you tie the band and the
 * draw is on the band — so by the time a test reaches for the button, the
 * draw has already moved on and the button belongs to the previous screen.
 *
 * Tolerating its absence is the new behaviour rather than a fudge around it:
 * a test that hangs for ninety seconds waiting to press "Carry on" in Play is
 * asserting something the game deliberately stopped doing. What each test
 * still asserts afterwards is that it arrived at the RIGHT next step, which is
 * the claim that actually matters.
 */
export async function carryOn(page, selector){
  const btn = page.locator(selector);
  if(!(await btn.count())) return false;
  if(!(await btn.isEnabled().catch(()=>false))) return false;
  await btn.click({ timeout: 5000 }).catch(()=>{});
  return true;
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
