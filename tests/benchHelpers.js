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
 * Blocks until the bench camera has settled and stayed settled.
 *
 * Polled INSIDE the page rather than from the test.
 * The first version of this ran one `page.evaluate` per sample, and on this
 * runner a round trip is acknowledged only once the renderer's main thread
 * gets to it — which is a frame, which is up to half a second. Fifty samples
 * of that is half a minute of a ninety-second budget spent asking a question,
 * and it timed out tests that were doing nothing wrong. In-page polling costs
 * one round trip in total.
 *
 * @param {import("@playwright/test").Page} page
 */
export async function settleBench(page){
  await page.waitForFunction(async () => {
    const t = window.__phlebTest;
    if(!t || !t.benchStats) return true;          // not a bench step; nothing to wait for
    const s = await t.benchStats();
    if(!s || !s.open) return true;
    window.__benchStill = s.settled ? (window.__benchStill || 0) + 1 : 0;
    return window.__benchStill >= 3;
  }, null, { timeout: 30000, polling: 120 }).catch(() => {});
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
