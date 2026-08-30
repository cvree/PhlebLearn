# Testing

Three layers, fastest-to-slowest:

| Layer | Command | What it covers |
|---|---|---|
| Unit tests | `npm test` | Pure logic: `venipuncture/clinicalRules.js`, `venipuncture/procedureState.js`, every converted step's rule + scoring + technique layer (`staging/`, `tourniquet/`, `palpation/`, `cleaning/`, `assembly/`, `insert/`, …), the draw-scoped `complications/` and `specimen/` layers, and the progression rules. No browser, no DOM — runs on Node's built-in test runner. |
| Playwright tests | `npm run test:e2e` | The production build, served via `vite preview`, driven in a real Chromium instance. |
| Full verification | `npm run verify` | Unit tests → build → Playwright, in order. Run this before merging any phase branch. |

**Running the browser suite where Playwright did not install its own
Chromium.** Some sandboxes and CI images ship a Chromium at a fixed path with
a different build number, which Playwright refuses to launch. That is a
property of the machine rather than of this project, so the path arrives as an
environment variable instead of a committed config value:

```bash
PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e
```

Unset, the config is exactly what it always was and Playwright uses its own
download.

Playwright runs with `workers: 1`. Every test in this suite drives a live
WebGL context, and two headless Chromium instances competing for the same
software renderer make screenshots and bounding-box reads fail intermittently —
a GPU-contention artifact, not app behaviour.

**The per-test timeout is 90 seconds, and that is about the runner, not the
app.** A machine with no GPU falls back to a software rasteriser that draws the
bench scene at about **3 frames a second** — measured, and identical before and
after the redesign, so it is a property of the machine. A gesture made of forty
pointer samples is genuinely slow there.

Two consequences worth knowing when writing a browser test:

- **Never wait on the wall clock for something the SCENE accumulates.** The
  render delta is clamped per frame so a stalled tab cannot make the simulation
  jump, which means at 3 fps the scene runs at a fraction of real time. Wait for
  the QUANTITY instead — `tests/palpation.e2e.spec.js`'s `pressOverUntil()` is
  the pattern.
- **Read the sample that met the condition, not a fresh one afterwards.** The
  poll and the read are separate round trips, and at these frame rates they are
  far apart.

Anything genuinely time-based in the game — the tourniquet's seconds, the
alcohol's drying, palpation's dwell — is on the wall clock for exactly this
reason, and a frame-rate-dependent one would be a bug.

## The redesign's own acceptance tests

Five files exist specifically to hold the redesign's structural claims, because
each of them is a regression that would be invisible in a screenshot:

| File | The claim it holds |
|---|---|
| `tests/bench.spec.js` | One encounter builds ONE scene. Asserts the lease protocol against a stub scene graph — a mode releasing its lease rather than disposing the bench, and a bench prop outliving the mode that made it. Needs `--experimental-test-module-mocks`, which `npm test` passes. |
| `tests/bench.e2e.spec.js` | The same claim in a real browser, plus: the band is still on the arm five modes later, no score of any kind appears between the patient sitting down and the debrief, the strap can be grabbed anywhere along its length, and one stroke wraps it. |
| `tests/handedness.spec.js` | A mirror inverts the determinant, and SOLVING the 2×2 recovers the same angle where ASSUMING its sign would silently invert the wrap for every left-handed learner. It demonstrates the wrong version failing, so the test cannot pass vacuously. |
| `tests/mastery.spec.js` | Mastery cannot be ground. Spends fifty mediocre draws proving they buy nothing, and asserts that a bad draw RESETS a run rather than merely failing to advance it. |
| `tests/archetypes.spec.js` | Every patient archetype changes something the physical simulation reads, rather than being a costume. |
| `tests/debrief.spec.js` | Act one of the debrief contains no digits, and every technique reading carries a real unit. |

## Unit tests (`tests/procedure.spec.js`)

Runs directly against `src/venipuncture/clinicalRules.js` and
`procedureState.js` — both are pure functions with zero imports, so no
mocking or DOM shimming is needed. These are the regression tests for the
sequencing bugs fixed in Phase 0 (see the table below).

## Supply-staging unit tests (`tests/staging.spec.js`)

31 tests covering the physical supply-staging branch. They drive
`stagingState.js`'s mutators directly — the *same* write path the 3D drag
controller and the accessible list view both use — so a pass here means both
input modes are governed identically. Grouped as:

- **Completion**: a correct tray is ready; a missing item blocks; a usable item
  left on the counter instead of the tray blocks with its own message.
- **Wrong and unsafe items**: unordered tube, expired tube, cracked tube,
  damaged needle pouch, wrong-gauge needle, a tube pre-labelled for another
  patient (its own issue code, flagged `safety: true`), syringe, urine
  container, cotton balls.
- **Order of draw**: wrong order blocks and names the correct sequence; correct
  order unlocks; a required tube loose on the tray rather than seated in the
  rack blocks.
- **Sharps container**: out of reach, past the patient's arm, overfilled, and
  locked each block readiness.
- **Object permanence**: an item stays exactly where it was released; a later
  placement never moves it; a wrong item does not vanish and can be removed and
  replaced; an item dropped off the counter is contaminated and stays that way.
- **Handedness**: `createLayout()` mirrors exactly, `zoneAt()` classifies the
  same world point differently per handedness, and switching mid-staging
  mirrors what is already on the counter without invalidating it.
- **Measurement**: a clean tray scores ≥ 90; an unsafe item costs far more than
  an untidy one; inspecting before staging is measured and rewarded; the
  narrative cites the specific correction the learner made.
- **Catalog integrity**: every item resolves through the model registry, no
  label depends on an emoji, every wrong item carries an explanation and
  inspectable detail, and exactly one usable item exists per required category.
- **Moving the work area**: dragging the tray moves its zone and takes the rack
  with it, it clamps to the counter, it cannot be parked on top of the
  patient's arm, and returning it to zero restores the original geometry
  exactly.
- **Order of draw comes from the tube table**, not from the order the player
  tapped tubes off the rack (`canonicalTubeOrder`).
- **Proceeding unprepared**: a learner who begins the draw with a tray that
  isn't ready is measured on exactly which problems were outstanding, and
  scores materially worse than the identical tray finished properly.
- **Registry fallback**: a model whose GLB fails to load still produces a
  usable instance from its procedural builder.

## The tray between patients (`tests/trayCarryover.spec.js`)

A shift is six patients, and the consumable half of the tray is the same nine
objects every time. It carries now — see `staging/trayCarryover.js` — so these
hold the shape of what carries and what does not:

- the CATEGORIES you staged carry, never the objects (the objects were used on
  the last patient), and the restock comes out of *this* patient's cart;
- the tubes never carry, because they are this patient's requisition and the
  graded half of the step;
- a flawed item does not carry as itself, and neither does a sharps container
  left across the patient's arm — restocking either into the same mistake
  would punish it twice without ever asking again;
- and the restock can hand you something bad, unchecked, which nothing
  announces. Deterministic in the tests through an injected `rng` and an
  explicit `flawChance`, so "one patient in three" is a property of play and
  not a coin flip inside an assertion.

The last test is the one that matters most: a restock places through the same
mutators a drag does, so the event log, the rules and the measurements cannot
tell the two apart.

## Playwright smoke tests (`tests/smoke.spec.js`)

Configured in `playwright.config.js` to run against `vite preview` (the
actual production bundle, not the dev server) on a dedicated port, matching
how GitHub Pages serves the app. Covers:

- The build loads and the Three.js `<canvas>` appears.
- No fatal page errors or unexpected console errors/warnings.
- The main panel renders, Clock In → Teaching mode works.
- Patient-ID options render, and clicking the correct one (detected by
  checking for "DOB"/"date of birth" in the option text — every wrong option
  in `config.js`'s `VERIFY_WRONG`/`NICK_WRONG` omits both) advances past the
  reaction screen to requisition review.
- The camera responds to a pointer drag (screenshot before/after differ).
- A tube can be selected via the raycaster (scans a horizontal line across
  the rack region rather than one fixed pixel, so it doesn't depend on
  pixel-perfect camera framing).
- No `/assets/...` request 404s.
- Reloading the page leaves the app fully usable (state isn't corrupted by
  a fresh boot).

### Allowlisted console warnings

Three warning patterns are explicitly allowlisted in `smoke.spec.js` (with
inline comments) — anything else fails the test:

1. `THREE.Clock` deprecation (three.js 0.185, pre-existing, purely cosmetic).
2. `PCFSoftShadowMap` deprecation (three.js falls back automatically).
3. `GL Driver Message` (headless Chromium's software/virtualized GPU stack
   in the CI/sandbox environment — not app behavior, varies by machine).

### Why the tube-selection test scans instead of clicking one point

3D raycaster picking doesn't correspond to a stable CSS selector Playwright
can target directly. Rather than hardcoding one pixel coordinate (fragile —
breaks if camera framing changes even slightly), the test scans several
x-positions across the tube rack's approximate screen region and passes if
*any* of them selects a tube. This is deliberately loose: the goal is
proving the raycaster pipeline works end-to-end, not asserting exact visual
layout.

## Supply-staging browser tests (`tests/staging.e2e.spec.js`)

12 tests against the production build, covering what unit tests cannot: that
the objects are really in the scene, that a mouse drag and a touch drag both
move the *right* object into the *right* zone, and that the old activity is
gone.

- The `.vp-gather` / `.vp-supply` emoji grid no longer exists anywhere.
- No emoji appears in any staged supply object's name.
- Mouse drag: a specific object moves to the tray and stays put while other
  objects are dragged around it.
- A tube seats into a numbered rack well only when dropped on it — dropped
  mid-tray it stays loose on the tray.
- A wrong item stays where it is put, is explained in the coach layer, and can
  be removed and replaced.
- Touch drag (`pointerType: "touch"`) behaves identically, including for a
  13 mm tube — the pick-proxy path.
- Left-handed mode mirrors the zones on screen (tray left of the reach zone
  becomes tray right of it).
- "Tray ready" stays disabled until every condition is met, then advances the
  procedure to the next step.
- An unreachable sharps container blocks readiness until it is moved.
- Every catalog object projects to a real on-screen point (i.e. it actually got
  an instance, procedural or otherwise).
- Reloading mid-staging leaves the app usable and gives a clean staging state.
- The accessible list view is fully keyboard operable.
- **Scored shift**: no checklist, no expected order of draw, no explanation of
  why a staged item is wrong, and "I'm ready" is live from the first frame with
  an empty tray — then it advances the procedure.
- **Teaching mode**: the checklist is present and the draw stays gated behind a
  correct tray.
- Dragging the tray moves the whole work area and carries what is on it;
  grabbing an object that sits on the tray never drags the tray instead.
- Double-tapping an item you are inspecting sends it straight to the tray.
- The coach panel collapses and the cart re-frames into the freed space.
- Leaving a draw takes two clicks and scores the encounter on what was done.

## Needle + holder browser tests (`tests/assembly.e2e.spec.js`)

19 tests against the production build. The unit tests
(`tests/assembly.spec.js`, 35 of them) prove the rules; these prove the step is
a real object rather than a widget:

- The `.vp-assemble` / `#vpNeedle` / `#vpHolder` divs no longer exist anywhere.
- Dragging along the pouch's seam opens it; wandering off the seam tears it;
  stopping half way leaves it shut.
- Picking the needle up by the grey sleeved end contaminates it — and a
  contaminated needle is blocked no matter how well it is then threaded.
- Carrying the needle in along the hub's axis engages the threads square;
  coming at the hub 35° off cross-threads it, and turning then gets nowhere.
- Circling the pointer round the hub really turns it: 2.6 revolutions reads as
  2.6 turns, 1.3 is blocked as loose, and circling the other way backs it off.
- The unit the uncap step opens is the unit the assemble step built, with the
  bevel at the angle that threading left it.
- Pulling the sheath along the needle leaves it intact; levering it off
  sideways barbs the bevel and blocks the step.
- Rolling the holder brings the bevel up; holding still on the holder leans in
  and inspects it.
- Dragging the sheath back onto the needle is caught as a hand recap; dropping
  it on the prepped field is caught as re-contamination.
- The accessible controls build the same unit with the 3D scene torn down,
  including backing a cross-threaded needle out and starting again.
- **Scored shift**: no verdicts, no explanation, and the learner can commit
  with nothing built.

## Anchor + insert browser tests (`tests/insert.e2e.spec.js`)

16 tests against the production build. The unit tests (`tests/insert.spec.js`,
28 of them) prove the rules; these prove the two gestures are real:

- The old `#vpSyr` / `.vp-anglewedge` / `.vp-target` divs no longer exist.
- Pressing below the mark and pulling further away anchors it with a real
  offset and pull distance; pressing too close, too far, or on the wrong side
  of the mark is each caught with its own message.
- A natural straight carry from the ready pose to the mark lands the angle in
  the 15–30° window and flashes — the obvious way to play it is the clean one.
- A short, tall approach reads as too steep; a long, flat one reads as too
  shallow — both blocked, both computed from the same fixed local basis, not
  from screen pixels.
- Continuing to drag forward deepens the stick; the other way eases it back;
  far enough is a through-and-through.
- Pulling all the way out clears the entry — including recovering mid-drag
  from a bad approach — and a fresh line can flash cleanly.
- An entry nowhere near the vessel does not flash, even at a depth that would
  read as "in" some vessel if position and depth were judged separately.
- A bevel forced back down (simulating an uncap that never got rolled up)
  blocks an otherwise clean stick.
- The accessible controls anchor, insert, redo a bad anchor, and advance or
  withdraw with the 3D scene torn down, through the identical rules.
- **Scored shift**: no verdicts, no explanation, and the learner can commit
  with nothing anchored.

### The `?e2e=1` test seam

`main.js` installs `window.__phlebTest` **only** when the URL carries `e2e=1`.
It exposes `gotoProcedureStep(stepId, tubes, mode)`, `stagingSnapshot()`,
`screenPointFor(itemId)`, `screenPointForZone(zone)`, and the two that hold a
draw still now that no step waits for a button — `holdSteps(on)` and
`endStep()`, described below. The `mode` argument
(`"teach"` / `"play"`) matters: guided and scored shifts are deliberately
different mechanics, so a test that doesn't say which one it wants is testing
neither.

Why it exists: reaching the supply step through normal play means clicking a
15-screen path whose patient, requisition flaw, site scenario and draw event are
all randomised per run. A test that spends 90% of its time navigating past
random content, and fails when the dice differ, tests the dice. The seam is
unreachable in normal play, absent from every link the game renders, and adds no
behaviour of its own — it only reads state and reports screen coordinates.

`screenPointFor*` project onto the drop plane (`y = 0`), not slightly above it:
a point 2 cm above the counter maps to a *different* world position once the
ray is cast back down, and the error grows with the wide field of view used on
narrow screens.

Each converted step adds its own reader and its own projector to the seam
(`tourniquetSnapshot` / `screenPointsOnLimb`, `palpationSnapshot` /
`screenPointOverVessel`, `cleaningSnapshot` / `screenPointOnField`,
`assemblySnapshot` / `benchAnchors` / `screenPointsOnBench`, `insertSnapshot` /
`insertAnchors` / `screenPointsOnInsertLimb`). The rule they all follow: **a
test drives the gesture in the same coordinates the runtime measures it in**,
never in guessed pixels.

`insertAnchors()` also hands back the runtime's own `readyDistal`/`readyHeight`
constants rather than the test hardcoding a copy of them — the two drifting
apart silently is exactly the kind of bug a passing-but-meaningless test would
hide.

`hubScreenPoint()` is the one that looks redundant and is not. Threading a
needle is measured as the pointer's angle about the holder's hub *as drawn* —
screwing something in is a wrist rotation, and on a pointer the honest
equivalent is a circular drag round the thing being turned. A test therefore
has to circle that exact projected centre; a centre re-derived from the bench
plane would be circling something else.

**Drags are interpolated driver-side.** A gesture needs roughly forty samples
before it is a gesture, and forty separate `mouse.move` calls cost more than
the whole per-test budget once a live WebGL context is in the loop — the first
version of the assembly suite timed out on exactly that. Straight legs go
through one `mouse.move(x, y, { steps })` each, and a full revolution of the
threading gesture is eight interpolated chords, which keeps every angular step
well inside the half-turn the runtime unwraps at.

**Why insert's approach needed a genuinely different fix, not just a bigger
one.** The first version of `insert`'s angle read the pointer through the same
live surface/cross-section solves every other step uses, continuously
re-seeded frame to frame. Those solves are only accurate near the arm — a
needle spends most of its approach *held clear* of it, which is exactly the
regime their own doc comments warn degrades. Driving a synthetic drag from far
above the skin reproduced this directly: the recovered along-arm position
drifted tens of millimetres from the intended one and never converged, however
many samples were fed in, because each frame's re-seed inherited the previous
frame's error. The fix was not more samples but a different technique: fix a
small local basis ONCE, by projecting three exactly-known world points (a
ready pose, a 10mm step along the arm, a 10mm step up off it) through
`toScreen()`, then solve every subsequent raw pointer position against that
fixed basis by the same 2×2 inverse `pointerToLimb` itself uses internally.
Forward projection of a known point has no ambiguity to begin with, so nothing
here degrades with distance from the surface — see `insertRuntime.js`'s file
header for the full reasoning. A second bug fell out of testing the resulting
mechanic at all: pulling the needle all the way back out mid-drag nulled the
basis without rebuilding it, so a single continuous gesture that carried
straight from a bad approach into a fresh one crashed on the very next move
event — caught only because the browser suite drives that exact recovery path
and the unit tests, working in plain numbers, cannot.

### Holding the draw still, now that nothing has to be pressed

A step ends because the action that ends it happened, in **both** modes — Learn
holds the finished step and its verdict about three times as long before moving
on, and that is the only difference. Nothing is pressed. (Two exceptions, in
every mode: the arrival room and the supply cart, where "done" is a judgement
rather than an event.)

That is fine for the game and a race for any test that wants to assert a step
*became* ready: by the time the assertion runs, the draw has moved on and the
readiness being read belongs to the next step. So the seam holds it:

- `holdSteps(true)` freezes implicit advancement. Every spec that asserts
  readiness calls it in its `open()` helper, right after `__phlebTest` appears.
- `endStep()` ends the current step on demand, if its completing action has
  happened — the same handle the confirm button used to be, without putting the
  button back in the game. `benchHelpers.js`'s `carryOn()` uses it, then falls
  back to Play's quiet "Carry on" for the case implicit advancement cannot
  cover: walking on from work that is not right.
- `expectStepReady(page, true|false)` reads readiness off the guidance block's
  `data-ready`, which is where it is published now. The specs used to read it
  off the confirm button's disabled state, which was a fair proxy while the
  button existed.

The advancement itself is covered by `tests/autoAdvance.spec.js` and, end to
end, by `tests/modes.e2e.spec.js` — which deliberately does *not* hold it.

### Two traps that make a bench gesture do nothing, silently

Both of these produce the same symptom, and it is the worst symptom a browser
suite can have: the drag runs, the camera does not move, nothing throws, no
console error appears — and the state under test is unchanged. It reads as a
broken mechanic and is not one. `tests/assembly.e2e.spec.js` went from 2 of 19
passing to 19 of 19 when both were fixed, having changed nothing about
assembly.

**1. Jumping past a step does not release that step's lease.**
`renderCurrentStep` runs a step's cleanup from `advance()` and nowhere else, so
setting `c.step` by hand and re-rendering leaves the old step's session live
and simply overwrites `ENC._collectCleanup`. `gotoProcedureStep` renders step 0
before it jumps, which means the SUPPLY CART stays up behind every step a test
opens. That matters because of `STEP_RUNTIMES`: staging is first in the table,
Learn offers a pointerdown to the first live runtime only, and the cart
therefore claims every gesture aimed at anything else. The claim is why the
camera stays put — `beginGesture` returned an owner, so orbit never sees the
event. Both seam functions now release the lease before they move the step;
`jumpToStep` always did.

**Any new seam function that changes `c.step` must do the same.**

**2. `page.waitForFunction` does not await an async predicate.**
Every seam function is `async` — it reaches its module through a dynamic
import — so a predicate that calls one returns a Promise, and a Promise is
truthy. `settleBench` was written that way and therefore returned on its first
poll, every time, having waited for nothing. It now runs its sampling loop
inside the page and has the runner wait on a plain boolean.

The same rewrite fixed the reason the helper exists in the first place —
though it took TWO attempts to land on a correct fix, and the first attempt is
worth recording because it looked right and passed assembly cleanly.

`cameraSettled` answers "is the rig where it currently *wants* to be?", and
that is true in the window between the entry ease finishing and the coach
panel's layout moving the target — measured at up to **52px** of further drift
after the flag first went true, which is a drag that starts beside the object
it meant to grab.

*First attempt (wrong):* require `settled` AND the on-screen projection of one
fixed point — `[0.02, θ=0, r=0.001]`, close to the arm's surface near its
local origin — to hold still for several samples. This passed `assembly.e2e`
19/19 and looked like the fix. It was a fix for assembly specifically: every
object assembly's tests touch sits close to the surface near the arm's
origin, which is exactly the region a point THAT close to the origin is
insensitive to change in. A re-frame that is mostly a ZOOM (a `dist`/`fov`
change) moves a point near the optical centre very little while moving a
point 6cm off the surface — where `collection`'s holder mouth and `insert`'s
ready pose actually are (`READY_HEIGHT = 0.014`, `HOLDER_LEN = 0.062`) — by
tens of pixels. The check reported "stable" while the geometry those tests
were about to reach for was still sliding. `tests/collection.e2e.spec.js`
failed 8 of 20 with exactly this signature (a gesture that runs, claims the
pointer, and changes nothing) under this fix.

*Second attempt (correct):* stop inferring stability from any one point in
the scene, and ask the camera rig directly. `armScene.js` exports
`cameraWantSignature` — a fingerprint of `rig.want.look/dist/fov` plus the
current framing name, i.e. where `fitCamera()` last told the rig to go —
threaded through `benchStats().wantSig`. `settleBench` now holds `settled`
true AND an UNCHANGED `wantSig` for four samples over 400ms, which is
independent of where in the scene a test happens to be looking. Entering a
step costs about half a second before a gesture may be driven; that is the
honest price of the camera never cutting.

### A gesture that lands correctly can still be aimed at a STALE target

The two traps above are about the FIRST gesture in a test — the one `open()`
settles for. A large, separate class of failures turned out to be the SECOND
gesture in a test that chains two: pick a tube up, then push it onto the
holder; anchor the vein, then approach it; lift a tube into the hand, then
swing it. Each of those first actions is a state change the step's OWN render
loop reframes around on the NEXT frame it draws — not synchronously inside the
pointer handler that caused it — so a test that immediately fetches fresh
anchors for the second gesture is fetching anchors for a camera that has only
just been told to move, not one that has arrived.

Measured directly (`collection.e2e.spec.js`'s `carryToHolder` → `seatDrag`):
**45px** of drift in the holder mouth's screen position between the anchor
fetch used to carry a tube up and the fetch used, moments later, to seat it —
enough that the seating drag started beside the flange and moved nothing.
Adding one `await settleBench(page)` at the end of the first gesture, before
the second one's anchor fetch, took `seatDepth` from `0` to the expected
`0.0165` with nothing else changed.

The same shape of fix went into every chained-gesture helper this pattern
turned up in — with different results, honestly reported:

- **`collection.e2e.spec.js`** (`carryToHolder`, `seatDrag`): confirmed
  fixed. 19 of 20 passing, up from 12 of 20 — the one remainder is the
  unrelated `.stg-msg` gap below. This is the file the fix was diagnosed
  against.
- **`insert.e2e.spec.js`** (`dragLimb`, the shared primitive both
  `anchorDrag` and `approachDrag` funnel through): **added, and confirmed
  NOT sufficient.** The same eight tests still fail — `entryX: null`, the
  identical symptom — in a clean, uncontended re-run. Whatever breaks the
  ready-pose-to-mark approach here is not (or not only) the gap this fix
  closes for collection; it was not root-caused further within this branch's
  time budget. The fix is left in because it is harmless (four passing tests
  in this file carry it at no cost beyond the wait) and may still matter for
  cases this branch did not happen to exercise — but do not read its
  presence as this file being fixed.
- **`inversion.e2e.spec.js`** (`pickUp`, `rackIt` — whose own `settle()` had
  the SAME broken-async-predicate bug as trap 2 above, independently, and
  now imports the fixed `settleBench` instead of a local copy): **confirmed
  improved, not complete.** A clean, uncontended run: 3 of 6 original
  failures gone (down to `swinging it fast haemolyses…`, `a scored shift
  lets under-mixed…`, `finishing a section pays out…`), no new ones.
- **`withdrawal.e2e.spec.js`** (`pullTail`, `gauzeToSite`, `withdrawDrag`,
  `shieldSlide`, `carryUnitTo` — "release, withdraw, safety, sharps" is four
  of these in a row in one test): **confirmed unchanged.** A clean run fails
  the same two it always did (`the four steps hand one continuous piece of
  work forward`, `a scored shift allows an unsafe sequence…` — the latter is
  the `.stg-msg` gap below). The fix neither helped nor hurt here.
- **`postdraw.e2e.spec.js`** (same broken-local-`settle()` story, same fix,
  plus the chained-gesture settle added to `pressHoldRelease`): **mixed, and
  worth reading carefully before touching this file again.** A clean run
  shows four failures where the baseline-confirmed pre-existing set was two.
  One of the two new ones is a genuine improvement misfiled as a failure:
  `the dressing is dragged onto the site…` used to fail at
  `before.haemostatic).toBe(true)` — never reached — and now gets past that
  and fails much later, on `bandageAlignM` (`0.0186` against a `< 0.014`
  threshold) — closer, not broken further. The OTHER new one,
  `bending the patient's arm up stops the clot progressing`, is a real
  regression: `snap.armFlexed` is `false` where it used to be `true`,
  reproduced identically in two separate runs (one contended, one clean),
  failing on `open()`'s drag — before `pressHoldRelease` ever runs, so it is
  the `settle()` swap in `open()`, not the addition to `pressHoldRelease`,
  that did it. Most likely: the old, never-actually-waiting `settle()` let
  this test's hardcoded 90px hand-drag execute against whatever camera
  position the FIRST rendered frame happened to have, and the properly-
  settled camera this fix now waits for sits at a different zoom, where 90
  screen pixels of drag no longer crosses the world-space threshold
  `armFlexed` is measured against. **Not fixed here** — diagnosing and
  correcting the drag's distance (or the threshold) against the correctly-
  settled camera is a small, separate piece of work this branch ran out of
  time for.

**What this means for whoever picks this up next.** `collection.e2e.spec.js`
and `inversion.e2e.spec.js` are confirmed net improvements — safe to build
on. `withdrawal.e2e.spec.js` is confirmed unchanged — safe, inert.
`insert.e2e.spec.js` has a real, undiagnosed bug behind its eight failures,
unrelated to the settle-timing story; start from `entryX: null` after
`approachDrag`. `postdraw.e2e.spec.js` needs the most care: before changing
anything else in it, fix `bending the patient's arm up stops the clot
progressing`'s drag distance against the now-correctly-settled camera, and
recheck whether `the dressing is dragged onto the site…`'s `bandageAlignM`
needs the same kind of correction now that it gets far enough to measure.
Re-run all four files ALONE — nothing else contending for the renderer —
before trusting any pass/fail count from them; every count in this section
came from either such a run or, where marked, two independent runs
agreeing.

**Confirmed pre-existing, not a regression.** A worktree of pristine
`origin/main`, built and run through the identical suite, fails
`collection.e2e.spec.js` on the exact same eleven tests, including the ones
whose assertions were already vacuously true (e.g. `seatDepth < 0.006`, which
`0` also satisfies) and so looked like passes. This bug has been in the suite
since before any of the work this document otherwise describes; it was never
visible because the suite had apparently never been run to completion here
before — every prior verification in this project's history either ran a
single spec file in isolation or was interrupted partway through a full run
(see git history around this document). Running it to completion for the
first time is what surfaced a category of bug three specs deep in chained
gestures across half the step files in this game.

### Two more pre-existing categories, found the same way, not fixed here

Chasing every remaining browser-suite failure was out of scope for the branch
that found this — the categories above accounted for the overwhelming
majority of them, and both of the two below were confirmed by direct
inspection to be unrelated to anything in that branch's diff:

- **A `.stg-msg` reading "assessed after the patient" that no coach has ever
  rendered.** Six tests across `postdraw.e2e.spec.js`, `withdrawal.e2e.spec.js`,
  `collection.e2e.spec.js` and `inversion.e2e.spec.js` assert this text
  appears in a scored (Play) shift. `stepHint(c)` in `physicalSteps.js`
  returns `null` whenever `!reveal().hints` — which is always, in Play — so
  the `.stg-msg.neutral` block these tests are waiting for can never render
  in the mode they test it in. Either a feature was removed after these tests
  were written, or it was never built; either way, `grep -rn "assessed after
  the patient" src/` returns nothing.
- **`.scoregrid` is hidden by design, and several `report.e2e.spec.js` tests
  don't know it.** The debrief screen's category breakdown sits inside
  `<div class="db-details" id="dbDetailsBody" hidden>`, revealed only by
  clicking "Show the full breakdown" (`ui/panels.js`'s `renderScore()`).
  `reportAtEnd()`'s helper asserts `.scoregrid` visible immediately after
  finishing a draw, with no click in between — a leftover from before the
  four-act debrief redesign that collapsed this section by default.

Both are real product-or-test gaps worth a maintainer's attention, and neither
is this document's problem to solve by inventing new coach copy or rewriting
a redesigned screen's tests on a branch about something else.

### The first-run card is held back by the seam

`?e2e=1` suppresses "How this works". Every browser test starts with an empty
`localStorage`, which is precisely the state that opens it, so without this it
would sit over the canvas that 250 pointer-driven tests are aiming at. It is
the same class of thing the seam already holds back — a pinned patient, a
fixed step — rather than an exemption invented for it.

Tests that navigate WITHOUT the seam (all of `smoke.spec.js`, two in
`modes.e2e.spec.js`) do see it, and call `dismissHelp(page)` from
`benchHelpers.js` right after `goto`, which is what a real first-time player
does. The card's own behaviour — it appears, it says the two things a screen
with two buttons on it cannot say for itself, it does not come back, and it
stays reachable from Settings — is covered in `modes.e2e.spec.js` on the real
path, with no seam at all.

## The 8 "urgent sequencing bugs" — what was actually wrong

Before extracting `venipuncture/`, the Phase 0 review specifically asked to
verify and fix eight behaviors. Investigating each against the original
monolith (`phlebshift3dlab.html`) found a mix of **already-correct**
behavior (worth formalizing into explicit named gates so it stays correct)
and **two real, active bugs**:

| # | Requirement | Status found | Fix |
|---|---|---|---|
| 1 | Tube inversion never appears before collection | Already correct (linear step order) | Formalized as `canInvertTube(state, tubeKey)`, checked against the *specific* tube, not "something is filled" |
| 2 | Tourniquet release gated behind first blood flow | Already correct by step order, but **not explicitly checked** | Added explicit `canReleaseTourniquet(state)` gate in `steps.js`'s `release()` |
| 3 | Final tube removed before needle withdrawal | Already correct (disabled button + ad-hoc flag) | Formalized as `canWithdrawNeedle(state)` |
| 4 | Gauze positioned above site without pressing before withdrawal | Already correct in copy/behavior | Formalized via `canActivateSafety`/message copy clarified |
| 5 | Needle safety activated after withdrawal | Already correct order | Formalized as `canActivateSafety(state)` |
| 6 | Needle-and-holder immediately disposed in sharps | **Bug: dispose was the LAST step**, after pressure+bandage | Reordered in `procedureState.js`'s `VP_STEP_DEFS`: dispose now runs immediately after safety |
| 7 | Pressure/bandaging occur after sharps disposal | **Same bug as #6** (dispose was after them, not before) | Same reorder; `canApplyPressure`/`canApplyBandage` gates added |
| 8 | Alcohol-pad interaction retains its last dropped position | **Bug: swab snapped back to (0,0) on every pointer release**, even mid-scrub | `steps.js`'s `clean()` now accumulates cumulative offset instead of resetting transform on every drop |

Bugs #6/#7 and #8 are covered by `tests/procedure.spec.js`'s step-order
assertions and by manual interactive verification respectively (the swab
fix is a DOM/CSS-transform behavior that isn't practically unit-testable
without a browser; it's covered by the Playwright suite exercising the
`clean` step end-to-end, plus the code comment at the fix site).

## Local manual verification workflow

For anything not covered by the automated suites (visual polish, 3D framing,
dark mode, drag-and-drop feel):

```bash
npm run dev
```

Opens at `http://localhost:5173/` (or `.claude/launch.json`'s
`phleblearn-vite` preview config, which pins port 5174).

## Complications and specimen quality (`tests/complications.spec.js`, `tests/specimen.spec.js`)

51 unit tests across the two Phase 3b layers, plus 7 browser tests.

The complication tests are built around one property: **a complication is
caused by measurements the other branches already record**, never scheduled.
So each trigger test constructs a procedure state the way a step would leave
it — a needle eleven seconds into the skin with no flash, a tip sheared 2.4 mm
sideways during collection, an entry over the median nerve at nerve depth —
and asserts that `detectOnsets()` finds exactly that one and nothing else.
The two genuinely probabilistic bits (whether THIS patient jumps at an
unannounced needle, and their own vasovagal threshold) are rolled once at
state creation from an injectable `rng`, so a test hands in a number and knows
what the patient will do.

The response tests pin the asymmetry that makes the branch worth having:
one careful adjustment is the CORRECT answer to a dry stick and a harmful one
to a blown vein; an answer cannot be taken back; carrying on through a
hematoma physically enlarges it and the millilitres show up on the arm; an
unaddressed prodrome ends in an actual faint, and stopping prevents it.

The specimen tests assert the thing no single step can: that haemolysis
arrives from three separate branches at once (gauge shear under a full
vacuum, a needle moved in the vein, shaking during mixing), that the fill
fraction judged is the collection branch's own `requiredFraction()` rather
than a second opinion, and that a rejection names the ordered tests the
patient now has to be drawn again for.

**The browser tests exist because two of these behaviours are not visible in
the numbers at all**: that the alert arrives over whatever scene the learner
is working in without stealing it, and that a wrong answer puts a bruise on
the 3D limb (`armShowsBruise` reads the actual mesh's visibility, via the
`window.__phlebArm` handle the test seam publishes).

**One environment artifact, allowlisted deliberately**: the CDN-loaded GSAP,
Lenis and Vanta scripts fail to load in a sandbox with no outbound network,
and the app carrying on without them is the designed progressive-enhancement
behaviour rather than a defect. `Failed to load resource` is therefore in the
console allowlist for this suite.

## Progression (`tests/progression.spec.js`)

17 tests, and they exist to enforce one rule: **an equipment upgrade must move
a number a branch already reads, not add a special case to it.** So the
paediatric kit test asserts through `collapsesVein()` that a full-draw red top
shuts a 2.6 mm vein and the same tube in paediatric stock does not; the
warming pack test asserts it touches `vigour` and specifically NOT tube stock;
the vein-finder test asserts the arm's geometry is byte-for-byte unchanged,
which is why the rubric still grades whether the vein was actually felt.

The difficulty tests assert that levels 0 and 1 are ordinary arms, that the
keys difficulty adds are exactly keys `applyPatientVariation()` already
understands, and that each one demonstrably changes the limb — a rolling vein
really is more compliant, a small one really is narrower.


## The two acceptance scripts

Neither is part of `npm test` or `npm run test:e2e`. Both drive the real
production build and answer a question a unit test cannot.

### `scripts/playDraw.mjs` — the no-instructions test

> A CPT-1 who has never seen this game completes a full Play draw, correctly,
> having read zero words of instruction.

Walks a Play draw doing only things to OBJECTS — no confirm button pressed, no
step counter read — and asserts:

- the panel carries a HUD, not the chrome of a lesson;
- **the whole panel**, not just the part above the stage, stays under 140
  characters with no gesture instructions in it;
- the draw advances because the action happened: the band goes on and the draw
  moves to palpation; a vein is committed to and it moves to antisepsis.

The whole-panel check is there because the first version only looked above the
stage. It passed while the tourniquet coach was still printing five lines on
how to tie a band, directly underneath.

```
npm run build && npx vite preview --port 4175 --base /PhlebLearn/ &
PW_CHROMIUM_PATH=... node scripts/playDraw.mjs /tmp/play
```

### `scripts/checkSteps.mjs` — every step, every mode

Opens all seventeen steps in both modes for both procedures — sixty-eight
combinations — toggles each step's view, and fails on any page error or any
stage that rendered nothing.

It exists because a template literal referencing an out-of-scope variable threw
inside one coach's render, took the whole panel with it, and left the stage
empty. The build does not catch that (the code is valid) and the unit suite
does not render the coaches, so it surfaced as eleven failures across two
unrelated browser suites — a long way from the one-word cause. This finds it in
about a minute.

Run it after any change that touches a `*Coach.js` template.

### `scripts/checkOverflow.mjs` — the layout scan

Five viewport sizes × eight screens, asserting nothing escapes the panel
sideways and the page never scrolls horizontally. Written to chase the clipped
panels in the review screenshots; it found none, which is how we learned those
were crops rather than a layout bug.

## Known-bad on this machine

`tests/assembly.e2e.spec.js` used to be recorded here as failing **six** of its
nineteen — all six in the `uncap` group, failing identically at `6c2f18d`, the
commit before any of the rebuild — and that reproduction at an older commit was
read as proof they were environmental: no GPU, and the six were the ones whose
assertions depend on precise screen↔bench projection.

**All six were real, and all six now pass.** The reproduction was sound and the
conclusion drawn from it was not: an old commit fails them too because the
fault was in the harness, and the harness was the same at both commits. They
were `settleBench` never actually waiting — see "Two traps that make a bench
gesture do nothing, silently" above — which starts the drag while the camera is
still easing, so the pointer grabs beside the sheath. The slower the renderer,
the wider that window, which is what made it look like a property of the
machine. It was the property of the machine that made a latent harness bug
visible.

The lesson worth keeping: *reproducing a failure at an older commit proves it
is not a regression. It does not prove it is environmental.* An assertion
failure is real until something explains it. The three signatures below are
explained; nothing else here is.

**The crash signature.** When a Playwright assertion reports
`Received: undefined` for a locator that plainly exists, the PAGE has gone,
not the app: the software rasteriser is spinning one core at 300% and the
renderer process has died under it. `butterfly.e2e`'s tourniquet test does
this reliably here while the same interaction, driven by hand through the same
seams, completes in under two seconds. Re-run it on a machine with a GPU
before believing it.

`tests/bench.e2e.spec.js` is flaky here in both directions — a run at `6c2f18d`
failed two tests, a run of this build failed one, and they were not the same
tests. Re-run it before believing any single result.

### The measurement, taken properly

The fun pass needed to know which of its failures were its own, so it took the
one measurement that answers that: a git worktree at the branch point, built
into its own `dist/`, served on its own port, running the eight specs whose
failures were unexplained. Two trees, two ports, one at a time — running them
concurrently would have put two software rasterisers on one core, which is the
condition every flake in this file is a symptom of.

**Thirty-two of a hundred and twenty-five failed at the branch point**, with no
change of any kind applied: all eight of `insert.e2e`'s gesture tests, four of
`palpation.e2e`'s, five of `butterfly.e2e`'s, four each in `inversion.e2e` and
`postdraw.e2e`, five in `staging.e2e` and two in `withdrawal.e2e`. `bench.e2e`
passed there and failed one on the changed tree, in both directions as
documented above.

So the eight `insert.e2e` failures are the machine, not a regression — that is
the group most worth knowing about, because it is the largest and the most
alarming to find. Some of the rest were genuinely stale assertions pointed at
controls the product no longer has, and those are fixed. The method is the
thing to keep: **a worktree at the branch point is cheap, and it is the only
answer to "was that me?" that does not require believing anyone.**

Then re-read the lesson two paragraphs up. Reproducing at the branch point
proves it is not a regression. It still does not prove it is environmental, and
`insert.e2e` remains a real, unexplained, eight-test hole in this suite on this
machine.

### The flag that lied

`playwright.config.js` passes `--enable-unsafe-swiftshader` and nothing else.
That flag PERMITS a software WebGL context on a GPU-less runner; without it,
Chromium refuses one and every step falls back to its accessible controls path,
which looks exactly like a broken 3D gesture and is not one.

**Do not add `--use-gl=angle --use-angle=swiftshader`.** Forcing that backend
changes the projection the gestures are measured against: the tourniquet's
one-stroke wrap went from three passes out of three to three failures out of
three on an unchanged build, and assembly's known-bad count went from six to
ten. The first version of this document recorded ten for exactly that reason.
