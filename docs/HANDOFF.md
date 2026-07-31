# Handoff — one branch left

**Status at handoff (2026-07-30, second pass).** The assessment phase is four
branches in and one branch out. `feature/rubric-policy`,
`feature/three-modes`, `feature/practical-report` and
`feature/introduction-and-id` are written, unit- and browser-tested, and
stacked in that order. **`feature/butterfly-hand-draw` has not been started** —
its design is section 5 of this document, which is the only part of the old
handoff that still describes work rather than code.

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

- `npm test` now runs 14 spec files; `npm run test:e2e` runs 14. Both lists
  are explicit in `package.json` — **add new specs to both or they never run.**
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
- [ ] **Both arm and hand procedures can be performed from beginning to end**
- [ ] **Straight-needle and butterfly mechanics are meaningfully different**
- [ ] The live build is smoke-tested *against this work* (the last live
      smoke test predates all four branches)

The last two unticked boxes are one branch. The third is a deploy.

---

## 5. The remaining branch — `feature/butterfly-hand-draw`

This was designed but not built. What follows is the design, at the level of
detail that lets you write it rather than re-derive it.

### 5.1 What already exists to build on

- `DEVICE.BUTTERFLY` in `withdrawalRules.js`, with its device-specific safety
  action (retract via the slider, not a forward shield) — implemented and
  unit-tested.
- `SITE_KIND.HAND` in `postDrawRules.js`, with its own lower force band and
  its own "there is only bone under that vein" coaching — implemented and
  unit-tested.
- The arm mesh **already has a hand**: `armMesh.js` builds a palm sphere,
  four finger capsules and a thumb, from `HAND_X` in `armAnatomy.js`.
- `describeProcedure()` in `rubricReport.js` already reports the device and
  site from what the steps recorded, so the report follows the procedure the
  moment the steps set those fields.

### 5.2 What does not exist

- A dorsal-hand **site geometry**: veins over the metacarpals, with the
  surface function to sit them on.
- The butterfly **wings and tubing** as physical objects.
- A **procedure model**: today the numbers live as module constants in the
  step that uses them.

### 5.3 `src/venipuncture/procedure.js` — the model

One file of plain data, read through `procedureFor(id)`; no runtime branches
on a string comparison. Two entries:

| | Straight, antecubital | Butterfly, dorsal hand |
|---|---|---|
| device | `DEVICE.STRAIGHT` | `DEVICE.BUTTERFLY` |
| site | `SITE_KIND.ANTECUBITAL` | `SITE_KIND.HAND` |
| gauge | 21 | 23 |
| entry angle, ideal | 15–30° | **5–15°** |
| entry angle, acceptable | 8–42° | 3–22° |
| anchor distal offset | 20–60 mm | **8–30 mm** |
| anchor pull for full credit | 14 mm | 8 mm |
| tubing | none | 180 mm, 30 mm of good slack |
| minimum draw | per-tube ratio only | **≥ 1 mL in one tube** |
| band above the site | 76–102 mm (upper arm) | 50–90 mm (forearm) |

The angle band is the whole argument for this being a different procedure: a
dorsal metacarpal vein sits 1.5–2.5 mm down with bone directly under it, so
the antecubital window drives the tip through it.

`indicatedProcedure(patient)` should return the butterfly draw for a patient
whose usable arm is flagged `dry` (flat veins) or whose `ageCat` is `Child` —
**from the existing trigger data on `p.site.arms`, not from prose.** The
learner still chooses; this is what the arms support, so the report can say
whether the choice was right.

Threading it through is four small changes:
`insertRules` gains `angleBandFor(siteKind)` (keep `ANGLE_IDEAL` as the
antecubital band so the existing tests stand); `ensureInsertSession` and
`ensureCollectionSession` take the gauge and the anchor band from the
procedure; `ensureWithdrawalSession` passes `DEVICE.BUTTERFLY`;
`ensurePostDrawSession` passes `SITE_KIND.HAND` — there is already a comment
marking that line.

### 5.4 `src/venipuncture/butterfly/` — the device

Three pure files plus a coach, on the five-file pattern.

**The wings are the grip and the angle.** `WINGS.PINCHED` is the carrying and
inserting grip; `WINGS.FLAT` is what everything after entry needs. Wings still
pinched while tubes are changed hold the tip at its entry angle, and a 10° tip
in a 2 mm vein that stays at 10° leaves the lumen the moment anything tugs.

**The tubing is a lever.** `tipShiftFromTubing(tubing, spec, {pullM, swingDeg})`
returns the metres the *tip* moves for a given disturbance of the far end.
Taping the wings down is what breaks that path and is worth about a factor of
nine (`pullTransferUnsecured: 0.055` against `pullTransferSecured: 0.006` per
metre). Slack absorbs the first part of a pull; a taut line absorbs nothing.
Every tube change in the collection step should call `disturb()` and fold the
result into the shift the collection scorer already measures.

**A hand vein infiltrates quietly.** `infiltrationFrom(tipOffsetM, calibreM)`
returns `{infiltrating, flowFraction, severity}` — flow *drops* rather than
stopping, which is exactly why it gets missed. Millilitres accrue on the clock
(`INFILTRATE_ML_PER_S ≈ 0.09`), the swelling becomes visible at 0.25 mL, and
"noticed within 6 s and stopped" is the recovery worth marks.

The measurement should carry: `entryAngleDeg`, `carriedByWings`,
`wingsLaidFlat`, `wingsSecured`, `tubingSlackMm`, `tubingTaut`,
`disturbancesTransmitted`, `disturbancesWhileLoose`, `peakTipOffsetMm`,
`infiltratedMl`, `infiltrationNoticed`, `secondsToNotice`,
`stoppedOnInfiltration` — plus `score`, `mistakes[]`, `criticalEvents[]` and
`narrative`, like every other step.

Add `butterfly` to `MEASUREMENT_SOURCES` and to the `technique` row's `feeds`
in `policy.js`, and its critical codes (`butterfly.carriedByTubing`,
`butterfly.tubingTaut`, `butterfly.infiltrationMissed`,
`butterfly.infiltrationNotActedOn`) to `CRITICAL_EVENTS`. Add a section to
`sections.js` and a source to `replay.js`'s `EVENT_SOURCES` — a unit test
already fails if a session keeps an event log and has no replay source.

### 5.5 The geometry

`armAnatomy.js` needs `HAND_SITE` (about `x = -0.285`) and
`buildHandVessels()`: three dorsal metacarpal veins and the dorsal venous
arch, calibre 1.5–2.2 mm, depth 1.5–2.5 mm, compliance 0.55–0.7 (they roll —
that is why the distal anchor has to be firm), plus an extensor tendon as the
trap that feels hard and does not give.

`armMesh.js` builds vein tubes from those polylines against `surfaceY()`,
which currently describes the forearm cylinder. The hand is a separate sphere
group, so the dorsal veins need a `handSurfaceY()` or the tubes will float.
That is the one genuinely new piece of 3D work in this branch, and the one to
budget for.

Verify it numerically rather than by eye, the way the rest of the suite does:
project the vein anchors through the same `toScreen()` the runtime reads from
and assert they land inside the hand's silhouette.

### 5.6 What the brief additionally requires of this draw

A firm distal anchor, controlled wings, recognition of infiltration, at least
one tube with ≥ 1 mL, and hand-appropriate pressure and bandaging. The last is
already implemented — it just needs `SITE_KIND.HAND` to reach it.

---

Do not claim the prototype is complete beyond what the repository, the tests,
the roadmap and the live build actually prove.
