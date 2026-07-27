# Testing

Three layers, fastest-to-slowest:

| Layer | Command | What it covers |
|---|---|---|
| Unit tests | `npm test` | Pure logic: `venipuncture/clinicalRules.js`, `venipuncture/procedureState.js`, and the whole `venipuncture/staging/` rule + scoring layer. No browser, no DOM — runs on Node's built-in test runner. |
| Playwright tests | `npm run test:e2e` | The production build, served via `vite preview`, driven in a real Chromium instance. |
| Full verification | `npm run verify` | Unit tests → build → Playwright, in order. Run this before merging any phase branch. |

Playwright runs with `workers: 1`. Every test in this suite drives a live
WebGL context, and two headless Chromium instances competing for the same
software renderer make screenshots and bounding-box reads fail intermittently —
a GPU-contention artifact, not app behaviour.

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

### The `?e2e=1` test seam

`main.js` installs `window.__phlebTest` **only** when the URL carries `e2e=1`.
It exposes `gotoProcedureStep(stepId, tubes, mode)`, `stagingSnapshot()`,
`screenPointFor(itemId)` and `screenPointForZone(zone)`. The `mode` argument
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
