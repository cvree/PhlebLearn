# Handoff — from "every step is physical" to "the practical is assessed"

**Status at handoff (2026-07-30).** All 16 venipuncture steps are real physical
interactions on a real arm. `main` is merged, pushed, and deployed to
`gh-pages`; the live site at https://cvree.github.io/PhlebLearn/ has been
smoke-tested with real gestures, not just a 200 response. `npm run verify` is
green on the committed tree: **363 unit tests, 179 browser tests**, plus the
production build, in ~22 minutes.

**What this document is for.** The remaining work is no longer step conversion.
It is *assessment* — turning the measurements every step already produces into
the photographed 0–4 rubric, separating the three game modes properly, adding
the butterfly/dorsal-hand procedure as a genuinely different draw, and building
the report. That is four or five branches of work, and the point of this file is
that whoever picks it up does not have to rediscover the shape of the thing.

Read `ROADMAP.md` for what each converted step teaches and why, and
`docs/ARCHITECTURE.md` for the module layering. This file assumes both.

---

## 1. What you are building on

### Every step already produces real measurements

Each converted step writes a measurement object onto the encounter under a
stable key. As of this handoff there are eleven:

```
encounter.measurements.{
  supplyStaging, tourniquet, palpation, cleaning, assembly, uncap,
  insert, collection, withdrawal, postDraw, inversion
}
```

Each is a plain serialisable object of **real quantities** — degrees,
millimetres, millilitres, seconds, percentages — plus a `mistakes[]` array of
`{code, item?, message, critical?}` and a one-line `narrative`. The newer three
also expose `criticalEvents[]` (the subset of mistake codes flagged `critical`).

**This is the raw material for the rubric.** It already exists. Nothing in the
remaining work requires re-instrumenting the steps.

### But almost none of it is surfaced yet

`vpFinish()` in `src/ui/panels.js` shows a block of boolean chips
(`gatherOk`, `veinOk`, `insertOk`, `tqGood`, `fillGood`, `tubeOrderOk`,
`pressureOk`, `disposeOk`, `mixOk`, …) and **only** the staging measurements as
a technique panel. `src/game/scoring.js` likewise reads only
`stagingMeasurements`.

So the gap is exactly: *rich data exists, the report does not.* Do not start by
adding more measurement; start by consuming what is there.

### The per-branch scoring modules are the model to follow

Each `*Scoring.js` already does what a rubric category needs, at step scope:
takes state + the rules' verdict, emits named mistakes with real numbers, a
0–100 score, and evidence. The rubric layer sits **above** these — it maps
several measurement categories onto one rubric row, and converts 0–100-ish
evidence into a 0–4 band. Do not rewrite the per-step scorers.

---

## 2. Recommended branch order

Each of these is comparable in size to one of the step branches. Ship them the
same way: scoped branch → pure layers + unit tests → runtime/UI → browser tests
→ `npm run verify` on the committed tree → update `ROADMAP.md` → merge → push →
deploy → live smoke test.

### Branch A — `feature/rubric-policy` (do this first)

**Why first:** everything else reports through it, and it is almost entirely
pure functions, so it is cheap to test and hard to get flaky.

Deliver:

1. **A configurable policy file**, e.g. `src/venipuncture/rubric/policy.js`.
   The brief is explicit that thresholds and automatic-failure rules must be
   configurable rather than buried in runtime code, and that the school's real
   automatic-failure policy must **not** be invented — ship documented defaults
   and make them easy to change. Put in it:
   - the rubric categories and which measurement keys feed each,
   - the 0–4 band thresholds per category,
   - the critical-event codes and whether each is an automatic failure,
   - the pass threshold.
2. **`rubricRules.js`** — pure: `scoreCategory(measurements, policy) -> {score
   0..4, evidence[], preventedExcellence[], criticalEvents[]}`. A category is
   only 4 when it is complete, independent, in-sequence, within tolerance, and
   free of warnings — "technically completed" must not automatically be 4.
3. **`rubricReport.js`** — assembles the categories into the full report
   structure the brief specifies (procedure type, total, pass threshold,
   per-category score + evidence + exact measured deviations, critical events,
   specimen results, patient outcomes, strongest actions, what prevented an
   Excellent, and a prioritised practice plan).

The rubric categories from the brief map onto existing measurement keys roughly
like this — confirm against the photographed rubric before committing to it:

| Rubric category | Fed by |
|---|---|
| Introduction and identification | *(not yet instrumented — Branch C)* |
| Patient preparation | `tourniquet`, `palpation`, `cleaning` |
| Equipment and supplies | `supplyStaging`, `assembly`, `uncap` |
| Venipuncture technique | `insert`, `collection`, `withdrawal` |
| Post-draw protocol | `withdrawal`, `postDraw`, `inversion` |

Note two rows already have everything they need, two are nearly complete, and
one has nothing yet. That is the honest picture.

**Trap:** the brief warns against hidden bonus points that distort the rubric.
Above-and-beyond observations should *justify* a 4 and drive qualitative
feedback — they must not add score.

### Branch B — `feature/practical-report`

The result screen. Replace/extend `vpFinish()` so a Final Practical produces the
full report from Branch A. Also add **session replay**: every `*State.js`
already records an `events[]` timeline with timestamps, so the replay is mostly
a matter of merging those streams and rendering them against the measurement
that drove each score. Do not invent a new event log; use the ones that exist.

Keep the existing chips for Learn/Practice — the report is the Final Practical's
output, not a replacement for in-line coaching.

**Trap:** feedback must be specific. "Entry angle peaked at 34°, above the
configured excellent range" — never "try to be more careful". The measurements
to say that with are already in the objects.

### Branch C — `feature/introduction-and-id`

The only rubric row with no instrumentation. Needs real interaction, not an
"Introduction complete" button: dialogue choices or a spoken-sequence control
that requires the learner to *actively* ask for name and date of birth (rather
than invite the patient to agree), confirm the order, explain what to expect,
check allergies and prior fainting, position the patient, perform hand hygiene,
let hands dry, and glove.

Track which identifiers were requested, whether two were used, the order,
missed questions, hand-hygiene duration, and glove contamination — including
whether the learner touched anything contaminated *after* gloving.

There is existing dialogue machinery to reuse: `runDialogue()` in
`src/ui/panels.js` and the `EVENTS`/options shape in `src/config.js`.

**Trap (important):** clinical facts must be explicit trigger **data**, never
text-matched. The anticoagulant patient is `anticoagulated:true` on their event
object in `config.js`; the words "blood thinners" in their dialogue are not what
the code keys off. Follow that pattern for allergies, fainting history, etc.

### Branch D — `feature/butterfly-hand-draw`

The brief is explicit that this must not be the same animation with a different
model. What already exists to build on:

- `DEVICE.BUTTERFLY` in `withdrawalRules.js`, with a device-specific safety
  action (`retract` via the slider, not a forward shield) already implemented
  and unit-tested.
- `SITE_KIND.HAND` in `postDrawRules.js`, with its own lower force band and its
  own "there is only bone under that vein" coaching, already implemented and
  unit-tested.

What does not exist: a dorsal-hand **site geometry** (the arm mesh models the
antecubital fossa), butterfly **wings and tubing** as physical objects, and the
shallower insertion approach. The brief requires the tubing to have physical
consequences — letting it pull or swing must affect needle stability.

Where the site kind is currently hard-coded, there is a comment marking it:
`ensurePostDrawSession()` in `physicalSteps.js` passes `SITE_KIND.ANTECUBITAL`
with a note that the butterfly procedure will pass `SITE_KIND.HAND`.

Also required by the brief for this draw: firm distal anchor, controlled wings,
recognition of infiltration, at least one tube with ≥1 mL, and hand-appropriate
pressure and bandaging.

### Branch E — `feature/three-modes`

Today there are two modes: `MODE === "teach"` via `guided()` in
`src/game/gameState.js`. The brief wants three, meaningfully separated:

- **Learn** — live instruction, highlighted anatomy and tool regions, why each
  action matters, immediate error identification, guided recovery, visible
  measurements (angle, pressure, timing).
- **Practice** — limited hints, no immediate answers, feedback at the end of
  each *section*, repeatable weak sections, personal bests and improvement
  tracking.
- **Final Practical** — no coaching, no highlights, no auto-correction, no
  success messages mid-procedure, no revealing whether a vein choice was
  optimal until afterwards; score only from observed actions; full rubric
  report at the end.

Every coach module already branches on `guided`, and every scored path already
withholds verdicts, so this is mostly a matter of turning one boolean into a
three-way mode and auditing each `*Coach.js` for what it reveals. Persist
per-mode bests locally (`SS` / `saveSS()` in `gameState.js`).

---

## 3. Conventions you must not break

These were each learned the expensive way; the reasoning is in `ROADMAP.md` and
in the module headers.

1. **Five files per step**: `*State.js` (pure data + pure transitions),
   `*Rules.js` (clinical judgement only), `*Runtime.js` (scene + gestures,
   never decides correctness), `*Coach.js` (DOM, reports observations, silent
   about verdicts in scored mode), `*Scoring.js` (real measurements, never a
   handful of booleans). Registered in `venipuncture/physicalSteps.js`.

2. **Every technique is a pure helper both input paths call.** The accessible
   "controls" view calls `stop*()` and disposes the Three.js scene, so any
   handler routed only through a runtime function *silently does nothing there*.
   Write the technique in `*State.js`; have the gesture and the controls both
   call it. The tests must assert parity.

3. **Dispatch on the state of the arm, not on which step id is running.** Where
   several procedure ids share one state object (fill+switch,
   release+withdraw+safety+dispose, pressure+bandage), both the pointer
   hit-testing and the controls are built from what is true of the arm. Gating
   on the step id strands a learner who did things out of order.

4. **`ensure*Session()` fallbacks are gated on "that step never ran at all"**
   (e.g. `takenSequence.length === 0`), never on "this item is unfinished". The
   loose version silently completes work the learner left undone and deletes the
   exact mistake the next step exists to catch. This was a real bug.

5. **Read `[[phleblearn-arm-projection]]` before touching any gesture that maps
   a pointer onto the limb.** The camera yaw is load-bearing; there are three
   distinct limb readings plus a fixed-basis technique for a hand held clear of
   the limb, and picking the wrong one produces confidently wrong numbers. Two
   bugs in this session came from exactly that.

6. **Coach panels never re-render wholesale on a ticking value.** Gate the full
   render on a structural signature and patch `[data-live]` nodes otherwise, or
   you drop keyboard focus, re-announce the whole aria-live region, and destroy
   buttons out from under an in-flight click.

7. **Clinical facts are explicit trigger data, never text matching.** See
   Branch C's trap above.

---

## 4. Testing and shipping

```bash
npm test          # unit — lists spec files explicitly
npx playwright test --workers=1
npm run verify    # unit → build → Playwright against that exact build
```

- **Do not** run `node --test tests/*.spec.js` — the glob picks up the
  Playwright `.e2e.spec.js` files and they fail under node's runner.
- **Do not** run `npm run build` while a verify is in flight: verify serves
  `dist/` through `vite preview`, so a concurrent build swaps the bundle under
  the running suite. **Do not** edit `src/` mid-verify either — the unit tests
  have already run, so the result no longer describes your tree.
- Playwright is pinned to `workers: 1` (live WebGL; two headless Chromiums
  sharing the software renderer makes reads flaky). The global timeout is 30s —
  mark anything that walks several steps `test.slow()`, and do it pre-emptively
  for anything measuring over ~25s.
- **Camera-settle flake, and the non-obvious half of it:** `fitCamera` re-frames
  on the *first rendered frame*, so anchors read before any frame has rendered
  are stale — and two such reads agree with each other, so a naive "has it
  stopped moving?" check passes on stale numbers. The anchors expose `frame`;
  a settle helper must require `frame >= 4` **and** stability. A gesture aimed
  with stale anchors lands in the wrong place.
- **`e.timeStamp` is not the wall clock** for CDP-synthesised events. Where the
  interval between pointer samples is itself a measurement (inversion's
  degrees-per-second), use `performance.now()`.

### The test seam

`?e2e=1` installs `window.__phlebTest` (opt-in only; absent from every link the
game renders). It exposes `gotoProcedureStep(stepId, tubes, mode)`, a
`*Snapshot`/`*Anchors` pair per converted branch (`staging`, `tourniquet`,
`insert`, `collection`, `withdrawal`, `postDraw`, `inversion`), and
fast-forward seams (`fastForwardFill`, `fastForwardPressure`,
`fastForwardDrying`). Add the same pair for anything new — a snapshot of what
the rules see, and anchors projected through the *same* `toScreen()` the runtime
reads from, so a test drags exactly where the gesture reads.

### Deploying

GitHub Pages serves the **`gh-pages`** branch at `/`; `main` is source only.

```bash
npm run build
git worktree add ../phleblearn-pages gh-pages
# replace the tracked files at the worktree root with dist/*, keep .nojekyll
# commit, push, then poll:
gh api repos/cvree/PhlebLearn/pages/builds/latest
```

Then **smoke-test the live URL for real** — drive a gesture and assert on
state. A 200 is explicitly not proof: the base-path pitfall in
`docs/DEPLOYMENT.md` returns 200 for missing assets while the app is completely
broken. To run Playwright against the live site, put the spec *and* a
webServer-less config in an untracked folder **inside** the repo (e.g.
`.live-smoke/`) and pass `--config=.live-smoke/live.config.js`; a config in a
temp directory cannot resolve `@playwright/test`, and `--config=/dev/null` fails
on Windows.

---

## 5. Definition of done (from the brief)

The prototype is complete only when all of these hold. Ticked items are true at
handoff.

- [x] Both procedures' *steps* exist as physical interactions — but only the
      straight-needle antecubital draw is playable end to end (Branch D)
- [x] Every player action produces measurable evidence
- [x] Unsafe behaviour has realistic consequences
- [x] Recoverable errors can be corrected where clinically appropriate
- [x] Keyboard-accessible controls are functionally equivalent
- [x] Full attempts can be reset and replayed
- [x] Unit and browser verification are green
- [x] The live build is smoke-tested
- [ ] Both arm and hand procedures can be performed from beginning to end
- [ ] Every visible rubric requirement has a corresponding player action
      (introduction/identification is missing)
- [ ] Learn, Practice and Final Practical are three separate modes
- [ ] The Final Practical produces a 0–4 score for every category
- [ ] A player can earn an honest 4 through excellent technique
- [ ] Straight-needle and butterfly mechanics are meaningfully different
- [ ] Progress and best scores persist locally per mode

Do not claim the 16 steps or the prototype are "complete" beyond what the
repository, the tests, the roadmap and the live build actually prove.
