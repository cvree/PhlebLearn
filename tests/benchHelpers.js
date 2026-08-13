/* =========================================================================
   Shared helpers for the browser tests that drive the BENCH.

   Every bench step projects a screen point from a known place in the scene and
   then drives the pointer at it. That is only sound once the camera has
   stopped moving — and the camera in this game never cuts, so entering a step
   is always half a second of easing, plus another re-frame the moment the
   coach panel finishes laying out and the obstruction measurement changes.

   A point projected during either move is a point the object has left by the
   time the pointer gets there. On a runner with no GPU this scene renders at
   about three frames a second, which makes that window well over a second
   wide — long enough that "await a timeout and hope" is not a strategy.

   So: wait on the app's own answer to "have you finished moving?", and
   require it twice running so a re-frame that has not started yet cannot be
   mistaken for one that has finished.
   ========================================================================= */

/**
 * Blocks until the bench camera has settled and stayed settled.
 * @param {import("@playwright/test").Page} page
 */
export async function settleBench(page){
  let still = 0;
  for(let i = 0; i < 150 && still < 3; i++){
    const s = await page.evaluate(() => {
      const t = window.__phlebTest;
      return t && t.benchStats ? t.benchStats() : null;
    });
    still = s && s.open && s.settled ? still + 1 : 0;
    if(still < 3) await page.waitForTimeout(60);
  }
}
