# Handoff — assessment phase complete

**Status at handoff (2026-07-30, third pass).** All five assessment-phase
branches are written, unit- and browser-tested, and stacked in order:
`feature/rubric-policy`, `feature/three-modes`, `feature/practical-report`,
`feature/introduction-and-id`, and `feature/butterfly-hand-draw`. Section 5 of
this document used to be a design for the last of those; it is now a record of
how that design changed once it met the actual codebase, kept for whoever
touches the butterfly module next.

Read `ROADMAP.md` for what each branch does and why, and
`docs/ARCHITECTURE.md` for the module layering. This file assumes both.

---

## 1. What now exists

### The grading layer — `src/venipuncture/rubric/`

Three pure modules, and nothing else touches a threshold.

| File | What it owns |
|---|---|
| `policy.js` | **Every number.** The five rubric rows and which measurement keys feed each, the 0–4 cut points, the excellence gates, the qualified critical-event codes with their automatic-failure flags, the pass mark, and the above-and-beyond observations. |
| `rubricRules.js` | `scoreCategory()`. The arithmetic sets a *ceiling*; five gates decide whether the top band was *earned*. |
| `rubricReport.js` | The whole result as serialisable data. Renders nothing. |
| `replay.js` | The steps' own `events[]`, merged into one timeline on one clock. |

Two things about `policy.js` that are easy to break:

- **Everything in it is a documented default**, marked as ours rather than
  any programme's published policy. The brief forbids inventing the real
  automatic-failure rules. If you get the school's actual policy, this is the
  only file that changes.
- **It names measurement fields by string.** A typo silently blocks every
  Excellent instead of throwing. `tests/rubric.spec.js` therefore builds each
  measurement object from the **real step modules** and asserts every field
  the policy references exists on it. Do not weaken those four tests.

Critical-event codes are **qualified** — `withdrawal.recapAttempted`, not
`recapAttempted` — because codes are only unique within a step module.

### The three modes — `gameState.js` + `sections.js` + `modes.css`

`MODE` is a three-way value and `reveal()` is the descriptor every coach and
panel reads: `instruction`, `hints`, `verdicts`, `liveNumbers`,
`gateContinue`, `sectionFeedback`, `repeatSections`, `highlights`. The legacy
`"teach"` / `"play"` strings still normalise in, because the `?e2e=1` seam
passes them.

**Every judgement in this app is expressed as colour.** Withholding the
verdict is therefore done in ONE place — `src/styles/modes.css`, scoped to a
`data-verdicts="0"` attribute the panel sets from `reveal()` — rather than
duplicated through ten coaches' class expressions. `tests/modes.e2e.spec.js`
asserts it at the pixel. If you add a coach, you get this for free; if you add
a verdict expressed as *text*, you must handle it yourself.

`sections.js` groups steps by technique. Practice's end-of-section feedback
and its replay both need it. **Repeating a section clears that section and
everything downstream**, because later sessions are built from earlier ones.

### The report — `ui/reportView.js`

Renders and decides nothing. `rubricReport.js` decides and renders nothing.
Keep it that way: it is what lets the whole report be asserted on in a unit
test without a browser.

`gradeAttempt()` in `panels.js` is **idempotent** — `vpFinish()` is reachable
more than once (a post-draw complication returns to it) and a second visit
must not count a second attempt or claim a second personal best.

### Introduction and identification — `src/venipuncture/introduction/`

**Four files, not five.** There is no `*Runtime.js` because there is no scene:
what the learner manipulates is a conversation and a sink. The rule that
matters is unchanged — every technique is a pure helper in
`introductionState.js`, and both the held rub and the "rub for 20 seconds"
control call the same ones.

The step id `hygiene` is gone; it is `introduce`, and the chip it sets is
`introOk` rather than `hygieneOk`.

### The second procedure — `src/venipuncture/procedure.js` + `src/venipuncture/butterfly/`

`procedureFor(id)` is the single lookup every consumer reads through — device,
site, gauge, angle window, anchor window, and (for the butterfly) a tubing
spec. `indicatedProcedure(patient)` picks the butterfly draw off the patient's
own trigger data (a `dry` arm, or `ageCat === "Child"`), never off a mode
flag. See section 5 below for how the design changed on the way to code — in
particular, **there is no new hand-mesh geometry**: the dorsal-hand vessels
sit on the existing forearm cylinder's wrist-taper region, which is why the
hand draw forces the accessible controls-only path wherever a step's
interaction is centrally about vessel geometry (tourniquet, palpation,
insert, collection) rather than adding a 3D drag surface for hand anatomy
that does not exist.

`src/venipuncture/butterfly/` is four files, not five — like introduction,
there is no independent scene; its mechanics are embedded in insert's and
collection's existing coaches and handlers. `butterflyState.js` is pure state
(wings, tubing slack, tip offset, infiltration); `butterflyRules.js` is the
clinical judgement (`evaluateButterfly`, `tipShiftFromTubing`,
`infiltrationFrom`); `butterflyScoring.js` measures it; `butterflyCoach.js` is
fragment helpers embedded into `insertCoach.js`/`collectionCoach.js`, not a
standalone step coach.

---

## 2. Conventions you must not break

The seven from the first handoff still hold. Four more were learned in this
pass:

8. **The rubric decides, the view renders.** No threshold in a template, no
   HTML in `rubric/`.

9. **A gate can only ever cost the 4.** `scoreCategory()`'s excellence gates
   never push a row below what its measurements already scored, and never
   promote one. If you add a gate, keep that property — a test asserts it.

10. **Above-and-beyond observations carry no score.** They justify a 4 and
    drive qualitative feedback. `tests/rubric.spec.js` asserts that a rich
    attempt and a bare one with identical measurements score identically.

11. **Anything that ticks every frame must be patched, not re-rendered.**
    The introduction step draws on every `requestAnimationFrame` and relies on
    the coach's signature gate to turn that into a `[data-live]` patch —
    otherwise the held rub button is destroyed under the hand holding it.

---

## 3. Testing and shipping

Unchanged from the first handoff, plus:

- `npm test` now runs 16 spec files; `npm run test:e2e` runs 15 (14 step specs
  plus `smoke.spec.js`, which `npm test`'s list has no equivalent of). Both
  lists are explicit in `package.json` — **add new specs to both or they never
  run.**
- **A spec that calls `gotoProcedureStep()` without forcing a procedure gets
  whatever `indicatedProcedure()` picks for that run's random patient.** Once
  `feature/butterfly-hand-draw` landed, every existing spec touching
  tourniquet, palpation, insert, collection, withdrawal or postDraw started
  failing intermittently — not because those steps broke, but because roughly
  1 in a few random patients now legitimately routes to the hand draw, which
  forces the controls-only path and drops the `#tqView`/3D-drag affordances
  those specs assumed were always present. The fix was mechanical: every
  `open*()` helper in those specs now passes `"straight-antecubital"` as
  `gotoProcedureStep()`'s 4th argument, the same seam `butterfly.e2e.spec.js`
  uses to force the other side. Any new spec that exercises one of those six
  steps needs the same, unless it is deliberately testing procedure
  selection.
- **This machine's headless renderer crashes under load.** Several verify runs
  in this session reported failures whose error was `Target crashed`,
  `page.crashed`, or a CDP `SyntaxError: Unexpected end of JSON input`; every
  one passed when re-run alone. Treat those three signatures as environmental,
  and re-run the spec before believing them. An assertion failure is real.
- The collection carryover walk is `test.slow()`: it measures 32.4s against a
  30s budget. Any new multi-step walk needs the same, pre-emptively.
- **A test that depends on generated patient data must pin it.** The seam has
  `setPatientHistory()` for exactly this — the introduction e2e failed once
  because that run's patient happened to have a latex allergy and the test
  gloved up in latex anyway. That was the mechanic working and the test being
  non-deterministic.

---

## 4. Definition of done (from the brief)

- [x] Both procedures' *steps* exist as physical interactions
- [x] Every player action produces measurable evidence
- [x] Unsafe behaviour has realistic consequences
- [x] Recoverable errors can be corrected where clinically appropriate
- [x] Keyboard-accessible controls are functionally equivalent
- [x] Full attempts can be reset and replayed
- [x] Unit and browser verification are green
- [x] Every visible rubric requirement has a corresponding player action
- [x] Learn, Practice and Final Practical are three separate modes
- [x] The Final Practical produces a 0–4 score for every category
- [x] A player can earn an honest 4 through excellent technique
- [x] Progress and best scores persist locally per mode
- [x] **Both arm and hand procedures can be performed from beginning to end**
- [x] **Straight-needle and butterfly mechanics are meaningfully different**
- [ ] The live build is smoke-tested *against this work* (pending this
      branch's merge and deploy)

The last unticked box is a deploy.

---

## 5. `feature/butterfly-hand-draw` — how the design became code

This section was a forward-looking design when it was written. It is now a
record of what actually got built, and — more usefully for whoever touches
this next — **where the design was wrong** and had to change once it met the
rest of the codebase.

### 5.1 What the design got right

- `DEVICE.BUTTERFLY` (`withdrawalRules.js`) and `SITE_KIND.HAND`
  (`postDrawRules.js`) were already implemented and unit-tested, and needed no
  changes — withdrawal and post-draw picked up the new procedure by having
  `c.procedure.device`/`c.procedure.siteKind` threaded to them instead of the
  old hardcoded `DEVICE.STRAIGHT`/`SITE_KIND.ANTECUBITAL`.
- `procedureFor(id)` as the single model file, read through by every
  consumer rather than branched on a string, is exactly what got built —
  `src/venipuncture/procedure.js`, with `PROCEDURE`, `PROCEDURES`,
  `procedureFor`, `isButterfly`, `indicatedProcedure`. The numbers table in
  the original design (angle bands, anchor windows, gauge, tubing spec)
  matches what shipped.
- `indicatedProcedure(patient)` reads `p.site.arms` trigger data (`dry`, or
  `ageCat === "Child"`) exactly as designed, not from prose.
- The wings/tubing/infiltration model (`butterflyRules.js`,
  `butterflyState.js`) — pinched vs. flat grip, slack absorbing a pull while
  taut transmits it, securing cutting transfer by roughly 9×, quiet
  infiltration accruing on a clock — was built as designed and holds up in
  both the unit and browser suites.

### 5.2 Where the design was wrong

**"The arm mesh already has a hand" undersold the actual gap.** `armMesh.js`
does build hand geometry (palm, fingers, thumb), but section 5.5's plan —
add `buildHandVessels()` and a `handSurfaceY()` so vein tubes render against
that hand mesh — would have meant new raycasting and a new camera frame for
that geometry too, which the design didn't budget for and which this
codebase's own history (`docs/ARCHITECTURE.md`'s arm-projection notes) flags
as the most expensive class of bug here. **That plan was dropped.** What
shipped instead: `buildHandVessels()` places its four vessels
(`dorsal-metacarpal-3`, `dorsal-metacarpal-4`, `dorsal-venous-arch`,
`extensor-tendon`) in world-space x on the **wrist-taper region of the
existing forearm cylinder** (`HAND_X+0.010` to `WRIST_X-0.006`), not on the
hand mesh at all. `surfaceY()`, `radiusAt()` and every existing projection
solve work on them completely unchanged, because as far as that math is
concerned they're just more vessels on the same limb. Zero new 3D code.

**The corollary the design didn't foresee: some steps have to stop offering
the 3D scene for a hand draw.** Since there's no hand-mesh geometry to drag
against, tourniquet, palpation, insert and collection all force
`canRender3d = false` (hence controls-only) when
`procedure.siteKind === SITE_KIND.HAND`. Cleaning, assembly, withdrawal and
post-draw don't need this — their interactions aren't centrally about which
vessel set is active — and were left untouched.

**Section 5.3's "four small changes" was an undercount.** Threading the
procedure through touched `insertRules.js`, `insertScoring.js`,
`insertCoach.js`, `collectionCoach.js`, `tourniquetRules.js`,
`tourniquetScoring.js`, `tourniquetRuntime.js`, `tourniquetCoach.js`, and
`palpationCoach.js` — because three of those files turned out to have
antecubital-only constants hardcoded past what the design anticipated (see
5.3 below), not just the gauge/angle/anchor plumbing the design described.

### 5.3 Bugs the design didn't predict, found by driving the browser

Four real bugs surfaced only by exercising the actual game, not by reading
the diff:

1. **Insert depth presets were hardcoded to 6mm.** Harmless on a 2.6–4.8mm
   antecubital vein; a guaranteed through-and-through on a 2mm hand vein.
   Fixed by deriving the preset from the chosen vessel's own `depth`.
2. **Tourniquet's and palpation's 3D-scene launch silently rebuilt the
   forearm vessel set**, overwriting the hand vessel set `ensureArmSession`
   had correctly built, because their `launch3d()` functions unconditionally
   read the vessels back off the (forearm-only) scene. This is what made
   forcing controls-only for hand draws necessary at those two steps, not
   just insert and collection.
3. **Palpation's accessible controls referenced antecubital vessel ids**
   (`median-cubital`, etc.) that don't exist in the hand vessel set — fixed
   with a `FOREARM_SPOTS`/`HAND_SPOTS` split chosen by which ids are actually
   present, not by a mode flag.
4. **Tourniquet's height dropdown computed presets as absolute world
   positions**, assuming the site sits at `x = 0`. For the hand site
   (`x ≈ -0.287`) every preset landed roughly 15 inches off. Fixed by making
   `heightPresets(siteX)` add the site's own offset — which then needed a
   second fix, `toFixed(4)` → `toFixed(3)`, once existing e2e specs (written
   against the original hardcoded 3-decimal values) started failing on an
   option-value mismatch (`"0.089"` vs. the newly-computed `"0.0890"`).

None of these were in the original design because the design was written
before anyone tried a hand draw against the live scene.

### 5.4 What the brief required, and how it landed

A firm distal anchor, controlled wings, recognition of infiltration, at least
one tube with ≥ 1 mL, and hand-appropriate pressure and bandaging — all
implemented; the last needed nothing beyond `SITE_KIND.HAND` reaching
`ensurePostDrawSession`, exactly as the original design predicted.

---

Do not claim the prototype is complete beyond what the repository, the tests,
the roadmap and the live build actually prove.
