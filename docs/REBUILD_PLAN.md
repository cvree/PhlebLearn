# The Continuous Draw — rebuild plan

**What it covers:** the nine changes asked for after the first playable review,
worked back to root causes in the current code, and turned into a sequenced
build with acceptance criteria that can be failed.

## Status — what has been built

| # | Item | State |
|---|---|---|
| 1 | Tray resting heights, tray-drag, staging camera | **shipped** |
| 2 | Patient body: spine, neck, face on the skull, hair | **shipped** |
| 3 | Modes → Learn / Play; Bench mode deleted; save migration | **shipped** |
| 4 | Clock-in redesign; "Make it harder" into Settings | **shipped** |
| 5 | Collection 3D by default; the toggle unpersisted | **shipped** |
| 6 | The gesture grammar — `bench/seating.js` | **shipped** |
| 7 | Assembly rebuilt on the axial-drag grammar | **shipped** |
| 8 | Palpation traces replace the Mark button | **shipped** |
| 9 | The HUD, and implicit advancement in Play | **shipped** |
| 10 | Camera follows what is in the hand | **shipped** |
| 11 | The whole kit live at once — dispatcher inversion | **in progress** |
| 12 | Step 1 deleted; the arrival room | **shipped** |
| — | Butterfly in 3D | deferred, as planned |

Three things were found while building that this plan did not predict, and all
three are in the commit log rather than here: the "use controls" toggle was
persisted to the save by **eleven** steps rather than one; the face's fixed ink
made a dark-skinned patient faceless; and gating the chrome above the stage
left every step's own coach still printing its gesture how-to underneath it.

Read `docs/ARCHITECTURE.md` first — this plan assumes the module layering, the
bench lease protocol, and the five-file shape of a step directory, and it is
careful to say when it breaks one of them.

---

## 0. One interpretation call, stated up front

The review listed steps 2, 3, 4, 6 and 9 by number, and separately said of the
first screenshot — step 1, *Introduction and identification* — "this step sucks
and utterly needs to be removed."

**That is how this plan reads it: step 1 is deleted as a step.**

It cannot be deleted as a *competency*. Two-identifier patient identification
is the single most load-bearing rule in California phlebotomy practice, it is a
rubric row (`policy.js`), and a simulator that skips it teaches a habit that
gets people hurt. So the plan does both things at once, and the distinction is
the whole design:

| Deleted | Kept |
|---|---|
| The step itself — screen 1 of 16, its own panel, its own "Ready ▶" button | The identification, the hygiene, the gloving |
| A menu of thirteen written sentences the learner picks from | A patient who talks, a wristband you read, a sink and a glove box you use |
| `introduce` in `VP_STEP_DEFS` | `introductionState.js`, its rules, its measurements, its rubric row — untouched |

The draw becomes 15 steps. Identification happens on the arrival screen, on
real objects, before the procedure starts — which is also when it happens in a
real draw. Section 3.3 has the mechanics.

If the intent was actually to delete step 9's tube handling instead, say so and
section 4.6 becomes a deletion rather than a rebuild; everything else in this
plan is unaffected.

---

## 1. What is actually wrong

The review's nine complaints are not nine unrelated bugs. They are four
problems wearing nine hats, and fixing them as nine bugs would leave the game
feeling exactly the same.

**Problem 1 — the game is a form, not a procedure.** Sixteen screens, each with
a heading, a step counter, a progress bar, a paragraph of instruction, a
statistics table, and a button that says "Carry on". The architecture already
knows this is wrong — `bench/benchSession.js` exists precisely because nine
runtimes used to rebuild the arm between steps, "which is why the game felt like
a checklist: architecturally it was one." The scene got fixed. The *frame around
the scene* did not. Everything the review calls "not natural" traces here.

**Problem 2 — gestures that fight the hand.** Circle a pointer round a hub 2.5
times (step 6). Feel a spot, take your hand off, then find a separate button
that marks where you last felt (step 4). Push a tube along an axis you cannot
see, or give up and use the button panel (step 9). Each of these is a correct
*model* driven by an incorrect *gesture*. The models are good and stay; the
gestures are replaced with one consistent grammar — section 4.0.

**Problem 3 — objects that don't obey their own world.** Items dropped on the
tray sink through it (step 2). The patient's head does not sit on the patient's
shoulders (step 3). These read as "the game is broken", and they cost more
credibility than any missing feature, because everything else the game claims
is measured is now suspect too.

**Problem 4 — four modes where there are two questions.** Learn / Practice /
Final Practical / Bench, plus a challenge picker, on the first screen. The two
questions a learner actually has are *"teach me"* and *"test me"*.

---

## 2. Five principles this plan is held to

These are the acceptance criteria for the whole effort, not aspirations. Each
one can be failed by a build.

### 2.1 The No-Instructions Test

> A CPT-1 who has never seen this game completes a full Play draw, start to
> finish, correctly, having read **zero** words of instruction.

This is the review's "a trained phlebotomist should be able to flawlessly go
through the game and not need any instructions", made testable. It is the
hardest constraint in this document and it kills a lot of otherwise reasonable
design. Every consequence:

- No instructional prose during a Play draw. None. The paragraphs currently
  under each heading exist only in Learn.
- Every affordance is carried by the object. A tourniquet has a tail because
  that is where you pull it. A holder has a printed bevel line because real
  ones do. A sharps container has a slot the size of one unit. If a thing has
  to be explained, the thing is wrong.
- Real labels on real packages, legible at working distance. The learner reads
  a tube's additive off the cap and the label, exactly as they were trained to.
- The correct action is always the most physically obvious one; the *unsafe*
  action is equally available and equally easy. The game never blocks a wrong
  move in Play, it records it.

**How it is tested:** a scripted walkthrough (`tests/no-instructions.e2e.spec.js`)
that completes a Play draw using only object interactions, with every text node
in the panel asserted absent except the HUD's four values. Plus a human pass
with two CPT-1s and a stopwatch, no briefing, recorded.

### 2.2 The model is protected; only the gesture changes

Every rebuild in section 4 keeps its `*State.js` and `*Rules.js` untouched, or
extends them additively. `turns`, `engageMisalignDeg`, `crossThreaded`,
`seatDepth`, `grip`, `feel` — all the measurements the rubric grades from — are
produced by the same pure helpers afterwards. This is what makes the whole plan
safe to build incrementally: the unit suites (`tests/*.spec.js`, 16 files) stay
green throughout, and only the e2e suites change.

Corollary: **no dynamic rigid-body simulation, ever.** `bench/motion.js`'s rule
holds. Every new gesture in section 4 is authored curves and solved geometry.

### 2.3 Accurate to California, and able to prove it

Section 6 is a matrix: every rule → the mechanic that expresses it → the
measurement that proves it → the citation. Where a rule is our own documented
default rather than published policy, it says so, following the convention
`rubric/policy.js` already sets. Nothing in this plan invents a regulation.

### 2.4 Graphics that serve the millimetres

"Utterly interesting brilliant graphics" for this subject does not mean
spectacle. A 4 mm vein under 3 mm of skin is the smallest thing in the game and
the most important, so the visual budget goes to: skin that shows what is under
it, a band that visibly changes the limb, blood that behaves like blood, and a
camera that gets close without cutting. Section 5.

### 2.5 Simple, which means fewer things, not smaller things

Two modes. One continuous bench. One gesture grammar. One panel that is a HUD.
The deletions in this plan (a step, two modes, a button panel, a marking
button, a "Carry on" button ×15) are load-bearing — they are how it gets
simpler, and each is listed as a deliverable, not a side effect.

---

## 3. The shell: modes, clock-in, and a draw that flows

### 3.1 Two modes

`MODES` becomes `{ LEARN, PLAY }`. `MODES.PRACTICE` and `MODES.BENCH` are
removed.

| | Learn | Play |
|---|---|---|
| Guidance | Full: instruction, hints, live verdicts, highlights | None until the debrief |
| Advancement | Explicit — the learner confirms each step | Implicit — the action itself advances |
| Section feedback | Yes, at the end of each section, replayable | No |
| Report | Yes | Yes, full 0–4 rubric |
| Length | 3 patients | Continuous, clock out when you like |
| Scored toward mastery | No | Yes |

`reveal()` keeps its descriptor shape exactly; it loses two rows. Learn absorbs
what was worth keeping from Practice: **section feedback and section replay
belong in Learn**, because "show me where I went wrong and let me do it again"
is teaching, not testing. `resetFromSection()` and `sections.js` are unchanged
and now serve Learn only.

**What is deleted, precisely.** `MODES.BENCH`, `benchMode()`,
`benchControlsHTML()`, `wireBenchControls()`, `BENCH_BEATS`, the bench branch in
`vpFinish()`, `.bench-bar` styles, and the Bench button on clock-in.

**What is NOT deleted, and this matters:** `src/bench/` — `benchSession.js`,
`assist.js`, `motion.js`, `haptics.js`. "The Bench" the review wants removed is
the *mode*. `bench/` is the scene-lease layer and the feel layer that the whole
redesign is built on; deleting it would rebuild the arm between every step
again. Whoever executes this should rename the mode's UI strings first so the
two never get confused. Recommend renaming the directory `src/table/` in a
separate, mechanical commit so nobody makes this mistake twice.

**Save migration.** `SS.modeProgress` has keys for four modes and
`SS.bests` may key on them. `normaliseMode()` already maps legacy strings; extend
it: `practice → learn`, `bench → learn`. Progress records under the removed keys
are merged into Learn's rather than dropped — a learner who put twenty draws
through Practice should not open the new build to a blank record. One migration
function in `saveSystem.js`, versioned, with a unit test on a fixture of the old
save shape.

### 3.2 The clock-in screen

Reduces to two cards and one line of state.

```
Clock in

  ┌────────────────────────────────┐   ┌────────────────────────────────┐
  │ 🎓  LEARN                      │   │ 🩸  PLAY                       │
  │ Talked through, step by step.  │   │ A real shift. Nothing is said  │
  │ Replay any section.            │   │ until the report.              │
  │ 3 patients · last: 82 · B      │   │ 41 draws · best 94 · ★★★☆☆     │
  └────────────────────────────────┘   └────────────────────────────────┘

  Your kit: 🦋 Winged sets  🔦 Vein finder
```

Gone from this screen: the four-mode paragraph, the challenge picker (moved —
3.4), the mastery strip's old home under the Bench. The mastery stars move onto
the Play card, where they belong: mastery is earned by scored draws.

Copy rule for this screen: it describes what happens, never what the learner
should choose. "Nothing is said until the report" — not "for confident
learners."

### 3.3 Deleting step 1 without deleting identification

Today: `introduce` is step 1 of 16. It renders five `<fieldset>`s of buttons —
"Ask them to state their full name", "Read the date of birth out for them to
agree with", "Ask about allergies" — and the learner clicks sentences.

Tomorrow: the `review` screen — which already exists, and where "the patient
arrives with their requisition" — becomes the room you meet them in. It is not
numbered, it has no progress bar, and it ends when you pick up the tourniquet.

What is in that room, as objects:

| Object | What it affords | What it produces |
|---|---|---|
| **The requisition**, a real sheet on the counter | Pick it up, read it. Name, DOB, MRN, ordered tests, ordering provider | The reference the identifiers are checked *against* |
| **The patient**, seated, who speaks first | Tap them to talk. The reply is spoken, and appears as a short caption, not a transcript list | `greeted`, and the identifiers they state |
| **The wristband**, on the wrist, legible when you lean in | Drag it into view to read it; the camera pushes in | `IDENTIFIER.ID`, and the mismatch case |
| **The sink**, with a real foam dispenser | Hold to rub. The existing 20-second model, unchanged | `hygieneSeconds`, `dryingSeconds` |
| **The glove box**, latex and nitrile, both on the wall | Take a pair. Touching anything after is what contaminates them | `gloved`, `gloveMaterial`, `gloveContaminated` |

**How asking works without a menu of thirteen sentences.** Tapping the patient
opens a *radial of three*, not a list of thirteen: the three things that are
actually live at that moment, chosen by `nextAction(state)` — which already
exists and already knows. Before you have a name, the three are open-ended asks.
After identification, they are the pre-draw questions (allergies, fainting,
positioning). The leading-question trap the current step teaches is preserved by
keeping the leading variant *in the radial beside the open one* — that pairing
is the entire lesson and it survives the redesign.

**What is measured is unchanged.** `introductionState.js`,
`introductionRules.js`, `introductionScoring.js` are untouched. `say()` remains
the one write path; the radial calls it, the accessible list calls it. The
rubric row keeps its instrumentation. `deriveChoices()` keeps filling
`ENC.idChoice` from the same place.

**What is deleted:** `introduce` from `VP_STEP_DEFS`; the `introduction` entry
from `SECTIONS.steps` (the section keeps its measurement, sourced from the
arrival room); `introductionCoach.js`'s five fieldsets and its "Ready ▶"; the
step counter reading 1/16.

**The blocking rule, kept and made physical.** You cannot pick up the
tourniquet until two identifiers match the requisition. Not a disabled button
with a tooltip — the band simply does not come off the tray, and the patient
looks at you. In Learn, a line says why. In Play, nothing is said, because a
trained phlebotomist already knows why.

### 3.4 "Make it harder" moves into Settings

The challenge picker (`CHALLENGES`, eight entries, `×` multipliers) leaves the
clock-in screen for the Settings overlay, as a collapsed section titled **Make
it harder**, below Assisted snapping.

Three things must be true after the move, and one is a genuine hazard:

1. **A challenge is still armed once, before the first patient.**
   `armChallenges()` runs in `startShift()` and `game/challenges.js`'s invariant
   is that a challenge can never leak into a draw nobody opted into. Settings
   is reachable *mid-draw* (Esc), which the clock-in screen was not. So: the
   picker is **read-only while a shift is running**, showing what is armed and
   a line reading "Changes apply to your next shift." Toggling is enabled again
   at clock-in. A test asserts `activeChallenges` cannot change while
   `SHIFT.index >= 0`.
2. The multiplier stays visible where it is earned — on the debrief's payout,
   not in Settings.
3. `armChallenges(mode === MODES.BENCH ? [] : ...)` loses its Bench branch.

Settings itself gets a light reorganisation while it is open, since it is
currently a flat list of six rows plus two buttons:

```
⚙️ Settings
  Display     Dark mode · Animations
  Hands       Dominant hand · Assisted snapping
  Sound       Lobby music · Volume · Procedural sound
  Make it harder                                    (collapsed)
    ⚡ One stick only        ×1.15
    ⚡ Band under 60 seconds ×1.10
    ...
  🏠 Office upgrades
```

### 3.5 The draw stops being a slideshow

This is the largest single piece of work in the plan and the one the review
cares most about: *"make the process more natural when not doing a step by step
practice."*

**What stays.** The 15-step machine. It is the grading spine — sequencing,
gates, sections, replay, the rubric all read it, and `clinicalRules.js` is what
makes the game clinically honest. Nothing about it is deleted.

**What changes.** In Play, the step machine becomes *invisible and inferred*.
The learner never sees it, never advances it, and never waits for it.

Four mechanisms, in dependency order:

**(a) Implicit advancement.** Each step descriptor gains one field:

```js
{ id:"tourniquet", …, completesWhen: (c) => !!(c.tourniquet && c.tourniquet.securedAt) }
```

The driver polls it. When true, and after a short settle (300 ms, so the band
finishes landing before the game agrees it landed), it advances silently. No
button, no panel change, no camera cut. In Learn the field is ignored and the
confirm button behaves exactly as it does now.

This is additive to `procedureState.js` and does not touch
`clinicalRules.js` — completion and *permission* stay separate concerns, which
is the property that keeps a mis-sequenced draw recordable rather than blocked.

**(b) The whole kit is live at once.** Today, `stepRuntimes.js` dispatches
pointer events to whichever step is active, so only that step's objects exist.
In Play, the bench holds everything the draw needs from the moment it starts:
band, alcohol, needle, holder, tubes in the rack, gauze, bandage, sharps
container. The learner reaches for what they want.

The dispatcher inverts: **the pointer hit decides the runtime, and the runtime
tells the step machine where it now is.**

```
today:   active step  →  runtime  →  what you can touch
Play:    what you touched  →  runtime  →  active step
```

Concretely, `stepRuntimes.js` gains a `claims(pickResult)` per row — "the band
is mine", "a tube is mine" — and the composition root asks *which runtime owns
this object* instead of *which runtime owns this screen*. Where a grab implies a
step the machine has not reached, the machine jumps there and the skipped steps
are recorded as skipped, which is precisely what the rubric's
`sequenceViolations` should be counting. Reaching for the alcohol before the
band is a real thing learners do and it should be gradeable, not impossible.

**Risk, stated honestly.** This is the item most likely to break things.
`stepRuntimes.js` was introduced specifically to stop five ten-branch
`if`-chains from drifting apart, and this change puts more logic into it. It
also means two runtimes can be leased at once (a tube in hand while the band is
still on the arm), which the lease protocol permits but has never been asked to
do. Mitigation: build it behind a flag, keep Learn on the current
one-step-at-a-time dispatch permanently, and extend `tests/bench.spec.js` with a
two-lease case before any runtime is touched.

> **What was built, and what a `claims(pick)` turned out to be.**
>
> The two-lease case went in first, as required, and found two things
> (`tests/bench.spec.js`): the bench stored a single `mode`, so the newer of
> two overlapping leases ending left it naming a mode nobody was in; that is
> now derived from the live leases, oldest first. Everything else in the lease
> protocol already held.
>
> The dispatch itself is `bench/gestureDispatch.js`, with `reach` as the flag
> — true in Play, false in Learn permanently.
>
> **`claims(pickResult)` was not built, deliberately.** Every runtime's `down`
> already answers exactly that question, against its own scene and its own
> private state, and returns false on a miss. A parallel predicate would be a
> second copy of that hit test living where it cannot see the state it needs,
> and the two would drift the first time one of them learned about a new
> object. So the offer *is* the claim: the pointer is offered to each live
> runtime in table order and the first to answer takes it. Same inversion, no
> new hit-testing, nothing to keep in sync.
>
> Latching the owner for the life of the gesture came with it, and paid for
> itself immediately: a step that ends on its own up-stroke — which is what
> (a) made normal — used to leave that pointerup with nobody to deliver it to,
> and the hand camera would then hold every framing for the rest of the draw
> waiting for a finger already off the glass.
>
> **Still outstanding, and it is the larger half.** Reaching only reaches what
> is in the scene, and each runtime still builds its own objects inside its own
> lease. For "the whole kit is live at once" the band, the swab, the needle
> unit, the rack and the sharps container have to become bench props built at
> the start of the encounter (`benchProp`, which already outlives modes), and
> each runtime needs its per-frame `tick` split from its `render` so two live
> runtimes tick but only one draws. Until then `reach: true` is a dispatch that
> would work if two runtimes were live, and one is. The machine-jump —
> grabbing something from a step the machine has not reached, recorded as a
> `sequenceViolation` rather than blocked — belongs with that work, since there
> is nothing to grab early until the kit is on the bench.

**(c) The panel becomes a HUD.** During a Play draw the panel is not a panel. It
is a small, translucent strip that never covers the arm:

```
Kowalski, C.   ·   ⬤⬤◯ 2 of 3   ·   band 0:38   ·   4.0 mL
```

Four values, no words, no verdicts, no buttons. Patient, tubes, the one clock
that is clinically live right now, and what is currently flowing. It changes
what it shows by what is happening — `band 0:38` only exists while a band is on;
`4.0 mL` only while a tube is filling. Everything else the panels currently
print moves to the debrief, where the game already decided feedback belongs.

This also fixes the framing problem visible in the review's own screenshots: the
panel is eating 40% of the viewport, `measureObstruction()` is dutifully pushing
the camera back to compensate, and the arm ends up small and far away. A HUD
that occupies 8% of one edge gives the millimetre work the screen it needs.

**(d) One camera, no cuts.** `FRAMINGS` already has six entries and `fitCamera()`
already eases rather than cuts. In Play the framing is driven by *what is in the
hand*, not by which step is active: empty hand → `access`; band → `access`;
alcohol → `scrub` push-in; needle → `stick`; tube → `collect`; gauze →
`close`. The two-framing rule from `cleaningRuntime.js` — a framing change must
finish before a gesture starts and must not restart between strokes — becomes a
global invariant of the Play camera, enforced by `view.cameraSettled`.

**Learn is unchanged by all of this.** Learn keeps its step counter, its
progress bar, its instruction, its confirm button, and its one-runtime-at-a-time
dispatch. That is what makes this safe to build: the mode that teaches keeps the
scaffolding, and the mode that tests takes it away.

---

## 4. The six steps

### 4.0 One gesture grammar first

Steps 4, 6 and 9 are all "an object has to meet another object precisely." They
currently use three unrelated gestures. They get one:

> **Pick it up. Bring it to where it goes. Push it home along its own axis.**

- **Pick up** — pointer down on the object; it lifts to a carry height and a
  contact shadow appears under it. Already implemented in `stagingRuntime.js`.
- **Bring** — free drag on a known plane (the bench) or against a fixed local
  basis (the holder axis). `bench/assist.js` magnetises *position* in the last
  15 mm of approach. **It never magnetises axis or angle** — assist's own rule
  is "magnetism helps you hit what you meant; it never decides what you meant",
  and the angle *is* what is being graded in every one of these three cases.
- **Push home** — once contact is made, continued drag *along the target's own
  axis* drives the engagement: turns for a thread, depth for a tube, pressure
  for a fingertip. A straight drag, on every device, for every seating action in
  the game.
- **The stop is felt, not read** — a hard end to the drag, a haptic thunk
  (`bench/haptics.js`), and a sound (`procedural.js`). Going past the stop is
  possible and is what over-torquing and over-seating mean.

Learning this once teaches the whole game. That is the No-Instructions Test
being designed for rather than hoped for.

### 4.1 Step 2 — things fall through the tray

**Root cause, confirmed in the source.** `stagingScene.js` sets
`const COUNTER_Y = 0` and places every staged item at that height:

- `refreshFromState()` — `mesh.position.y = st.zone===ZONE.FLOOR ? -0.30 : COUNTER_Y`
- `commitDrop()` — tweens to `y: ctx.view.COUNTER_Y`
- the tap-to-inspect path — `d.mesh.position.y = ctx.view.COUNTER_Y`

But `buildTray()` (`supplyModels.js`) builds a tray whose **floor top surface is
at y = 0.012** and whose rim tops are at y = 0.022. So every item placed on the
tray is positioned 12 mm *below* the surface it is supposed to be resting on.
Tall items (the tourniquet coil, the glove box) poke out and look wrong; flat
ones — the alcohol pad, the gauze, the bandage — are shorter than 12 mm and
vanish entirely inside the tray floor. That is exactly the reported symptom, and
it is why the panel can list four items "ON THE TRAY" while the tray looks empty.

The rack does not have this bug because `commitDrop()` special-cases it
(`y: 0.018`, "seated down in the well") — a hardcoded constant for one zone, in
one of the four code paths that set Y. That is the shape of the bug: **four
write paths, one of which knows about one surface.**

**Fix.** One function, and every path goes through it.

```
supportHeight(zone)          → the top surface of whatever holds the item
                               counter 0.000 · tray floor 0.012 · rack well 0.018
                               · reach pad (its own thickness) · floor −0.30
restingY(itemId, zone)       → supportHeight(zone) + item's own rest offset
```

The item's rest offset comes from its geometry, computed **once at model
registration** — a `Box3` over the built template, cached on the registry entry
as `restOffset = -bbox.min.y`. Not measured per drop, not hand-tabulated per
item; derived from the mesh, so a future GLB that replaces a procedural builder
gets the correct offset for free and nobody has to remember a table.

Then: `commitDrop()`, `refreshFromState()`, `stageItemTo()`, the floor-recovery
tween, and the inspect-exit path all call `restingY()`. The hardcoded `0.018`
and both `COUNTER_Y` literals go.

**Second bug in the same area, found while reading this.** Staged items are
added to `root`, but the tray and rack are added to `trayGroup`, and
`setTrayOffset()` moves only `trayGroup`. `ARCHITECTURE.md` says "a tray drag
moves the group and every staged item" — the items' *state* positions are
rewritten by `applyTrayOffset()` on drop, but during the drag itself the tray
slides out from under its own contents. Fix: while a tray drag is live, apply
the same delta to the transform of every item whose zone is `TRAY` or `RACK`.

**Third: the camera.** `stagingScene.js` calls `fitCamera(1.6, {rightFrac:0.27,
bottomFrac:0})` once, with a hardcoded aspect and a hardcoded panel fraction,
while every other step measures live through `viewport.js`'s
`measureObstruction()`. That is why step 2's cart sits in the top-left corner
with the panel over the rest. Fix: use `viewportAspect()` and
`measureObstruction()` per frame, like the other nine.

**Regression tests.**
- Unit: `restingY()` for every catalog item × every zone is ≥ that zone's
  support height. Fails today for all of them on `TRAY`.
- E2E: stage all four default items, assert each mesh's world-space
  `boundingBox.min.y >= trayFloorTop - 0.0005`.
- E2E: drag the tray 10 cm; assert every staged item moved with it *during* the
  drag, not only after the drop.

### 4.2 Step 3 — the tourniquet

**The gesture is not touched.** The review says "I like the feeling of making
the tourniquet and applying it", and `strapMesh.js` derives the band's shape
from the wrap geometry rather than authoring it — that is good work and this
plan does not go near it.

Everything here is visual correctness.

**Root cause A — the head does not share the body's lean.** In
`patientBody.js`:

- `chest` is a plain group with **no rotation**.
- `torso`, inside it, is rotated `x = −0.16, z = 0.18` — that is the lean.
- `head` is a sibling of `torso` inside `chest`, rotated `(0, 0.62, −0.30)`.

So the torso leans and the head does not follow it; the head's 35° turn and 17°
tilt are applied to an *upright* frame while the shoulders sit in a leaning one.
The head reads as stuck on rather than attached, which is the reported
"alignment is terrible."

**Fix A.** Introduce a `spine` node that carries the lean, and hang both the
torso mesh and a `neckBase` off it. The head's expressive rotation is applied
*on top of* the spine's, not instead of it. The animation code that writes
`head.rotation.y/z` per frame keeps working unchanged, because it is still
writing local rotation — it is now local to a frame that leans.

**Root cause B — the neck rotates with the skull.** `neck` is a child of `head`,
so a 17° head tilt tilts the neck too, and the neck no longer rises from the
yoke. Fix: `neck` becomes a child of `neckBase`. Only skull, jaw, hair, ears and
face features stay on `head`.

**Root cause C — the face floats off the skull.** The five features are
`PlaneGeometry` at a **constant** `faceX = −0.0705`, all facing −X. The skull is
a sphere of radius 0.076 scaled `(0.94, 1.06, 0.92)`, so its −X surface is at
x ≈ −0.0714 **only at the centre**. At the eye positions (z = ±0.028) the
surface has receded to x ≈ −0.0655 — the eye planes therefore hover about **5 mm
in front of the face**, in mid-air, and with `depthWrite:false` they never
resolve against it. Rotate the head 35° toward the camera, as this scene does,
and they read as detached dots drifting over a sphere. That is the third thing
visible in the review's screenshot.

**Fix C, and the recommendation is the bigger of the two options:**

- *Minimum:* solve each feature's x from the ellipsoid at its own (y, z), push
  it 1.5 mm along the surface normal, and orient the plane to that normal
  instead of to −X.
- *Recommended:* replace all five planes and the cone nose with **one face
  patch** — a single `SphereGeometry` segment sharing the skull's radius and
  scale, carrying one `CanvasTexture` drawn by `labelTexture.js`'s existing
  machinery. Features can then never separate from the head, blinking and
  wincing become texture-region swaps or UV offsets (cheaper than moving five
  meshes), and per-patient faces become a texture parameter — which the game
  wants anyway for patient variety. The nose stays as geometry; it is the one
  feature that genuinely needs relief.

**Root cause D — the hair cap can eat the brow.** `hair` is a polar cap of
`phiLength = 0.36π` scaled to 1.10, sitting at y = +0.004; the brows are at
y = 0.028. The margin is small enough that a modest head tilt puts hair over
brow. Fix: derive the cap's cut angle from the brow's own y rather than a
literal, and add the check to the QA matrix below.

**QA that makes this stay fixed.** A face-sanity harness: render the head across
{6 framings} × {4 skin tones} × {3 builds} × {hair on/off} and assert (i) every
face feature's world position lies within 2 mm of the skull surface, (ii) no
feature is occluded by hair at any framing, (iii) the neck's world-space axis is
within 5° of the spine's. Twelve images per run, checked into the review as a
contact sheet.

**Also in this step, smaller:**

- The band z-fights the skin where it contacts; give the strap a 0.3 mm
  standoff and `polygonOffset` rather than relying on draw order.
- Distal pallor (`distalPallor()`) is the feedback for "too tight" and is
  currently subtle enough to miss. It should be unmistakable at `stick`
  framing — that is a real clinical sign and reading it is a graded skill.
- "Use controls" is currently the visually loudest control in the header. It
  becomes a small icon; the accessible path is not the default path.

### 4.3 Step 4 — palpation remembers where you pressed

**Today.** Press around; the runtime holds `ctx.lastFound`; then find a separate
"Mark this spot" button which commits *wherever you last felt something*. The
review is right that this is unintuitive: the marking is divorced from the
palpating, and the button is the only thing that makes it real.

**Tomorrow: every palpation leaves a trace, and the traces are the map.**

As the fingertip presses, each distinct contact records a point:

```js
{ x, theta, z, feel, vesselId, depthMm, bounce, pressureN, t }
```

and drops a **persistent mark on the skin at that spot**, styled by what was
felt there:

| Felt | Mark |
|---|---|
| A vein that gave and came back | soft blue-green dot, faint ring |
| An artery | warm dot with a slow pulse ring — it keeps pulsing |
| A tendon | grey dot, hard edge |
| Nothing | pale neutral dot |

The learner palpates and their own vein map appears on the arm, drawn by their
own hand. It is the single most satisfying thing this step could do and it costs
one small point-sprite pool.

**Choosing a site becomes: press and hold on one of your own traces.** Two
seconds, or a double-tap. The trace promotes to the committed site and gets the
existing two-stroke pen marker from `buildMarker()`. Holding on a different
trace moves it. There is no separate Mark button, in either view.

**Grading gets strictly better, from data that did not exist before.**
`feelPoints[]` supports measurements the current model cannot make:

- how many distinct sites were actually assessed (one is not palpation)
- whether an artery was found *and then moved away from* — currently only a
  boolean `markArteryRecognised`
- whether the chosen site was one they had actually palpated, or picked blind
- how systematically they searched — coverage, not just outcome
- time on the arm, which relates directly to tourniquet seconds

`palpationScoring.js` extends; `palpationRules.js`'s judgements are unchanged.

**The accessible path keeps parity**, as `ARCHITECTURE.md` requires: the spot
list shows the trace history as rows ("median cubital — gave and came back —
2.6 mm"), and *choose* is an action on a row. Both paths call the same pure
helpers.

**Marks persist for the rest of the draw** — through cleaning (where the
alcohol-prep field naturally covers them, which is correct and worth seeing),
insertion, and collection. They fade at the debrief.

### 4.4 Step 6 — attaching the needle

**Today.** Drag the needle onto the hub within 12° of axis, then *"circle the
pointer round the hub"* for 2.5 turns. On a trackpad it is tedious; on a phone
it is genuinely difficult; and it corresponds to nothing a hand does.

**Tomorrow.** The grammar from 4.0, and it maps to the real action better than
the circle ever did — because in life, pushing a needle onto a hub and turning
it *are one motion*.

1. **Grab the needle by its sheath.** Grabbing the shaft or the thread end
   contaminates it — `contaminate(s, "threadEnd")` already exists and is kept
   exactly as is. The correct grip is the obvious one because the sheath is the
   only part with a grippable silhouette.
2. **Carry it to the hub.** Assist magnetises the last 15 mm of *position*.
   Alignment is still the learner's — `engageMisalignDeg` is computed from the
   real approach axis, `CROSS_THREAD_DEG = 12` still bites, and a cross-threaded
   needle still visibly cants.
3. **Push it home.** Contact turns the drag into a screw: continued drag *along
   the hub's axis* threads it in at a fixed pitch — **2.5 turns over about 28 mm
   of travel**. The needle visibly rotates as it goes. One straight drag.
4. **Feel the stop.** Free for the first half turn, progressively stiffer, then
   a hard stop at finger-tight: haptic thunk, a click, the drag resists. To
   over-torque you have to *push through* the stop — possible, penalised,
   unmistakable.
5. **Cross-threaded** binds at `CROSS_BIND_TURNS = 0.75` and will not go
   further; the needle sits canted. Backing out and re-approaching is the
   recovery, exactly as today.

**Nothing in the model changes.** `turn()`, `engage()`, `backOut()`,
`threadIn()`, `ATTACH_TURNS`, `SECURE_TURNS`, `SNUG_TURNS`, `OVERTIGHT_TURNS`,
`bevelFromTurns()` — all identical. Only what feeds `turn()` changes: metres of
axial drag instead of radians of pointer rotation. `assemblyRules.js` and
`assemblyScoring.js` are not opened.

**One addition for the No-Instructions Test:** a printed **bevel line** on the
holder, as real multi-sample holders have. The final bevel angle already comes
from where the threading stopped (`bevelFromTurns`), and the `uncap` step
already asks the learner to find it and roll it up. Right now they must be told
that. With a line printed on the hub, a trained phlebotomist just does it.

### 4.5 Step 9 — the tube stops being 2D

**Why it goes 2D. Four causes, all real:**

1. `let listView = !canRender3d || !!SS.collectionListView` — the toggle is
   stored on the **save**, so one tap of "Use controls" makes every future tube
   in every future draw 2D. This is the direct cause of the review's symptom.
2. `canRender3d = !isButterfly && !!getRenderer()` — a butterfly draw is
   controls-only by construction (`HANDOFF.md` §5.2 explains why: there is no
   hand-mesh geometry to drag against).
3. The panel is large enough to hide the scene, so the controls are simply what
   is in front of you.
4. The seating gesture is hard, so once found, the button path is never left.

**Fixes, in that order:**

1. **The 3D path is the default, always.** The per-draw toggle is not persisted.
   The *accessible* controls path moves into Settings as an accessibility
   preference ("Use button controls instead of direct manipulation"), where it
   belongs — it is an access need, not a mid-draw escape hatch. This alone fixes
   the reported behaviour.
2. **Seating uses the 4.0 grammar.** Pick a tube off the rack, carry it to the
   holder — assist brings it to the mouth — then a straight push *along the
   holder axis* seats it through engagement and into the stopper. The existing
   fixed-local-basis solve (the runtime's header documents exactly why it is
   built that way) is what makes this exact, and it stays.
3. **Grip is shown, not written.** The flange-vs-barrel distinction is the best
   idea in this step — a braced push is a couple and almost nothing reaches the
   patient; an unbraced push moves the holder and the needle with it. Right now
   the learner reads about it. Instead: when the pointer goes down near the
   flange, **a braced hand appears on the flange**. When it goes down on the
   barrel, no brace appears and the holder visibly travels. Same rule
   (`GRIP.FLANGE`), same measurement, zero words.
4. **The HUD replaces the panel** during collection: tube colour swatch, mL, and
   the vacuum's own decay (`vacuumVoice()`) doing the "it has stopped" job it
   was written to do. `RATIO NEEDS 75%` and `NEEDLE 0mm moved` move to the
   debrief.
5. **Fix the panel overflow** visible in screenshots 4 and 5 — the card is
   running past the right viewport edge at that width. A layout bug, cheap,
   and it makes two of the five screenshots look broken.

**The butterfly is its own work item, and it is not small.** Making a winged
draw 3D means real wing geometry, real tubing that can be dragged and can go
taut, and dorsal-hand vessels rendered against actual hand geometry rather than
the forearm's wrist-taper region. `HANDOFF.md` §5.2 is explicit that this was
cut once already and why. Estimate it separately (section 7, item 12) and do not
let it block the straight-needle fix.

### 4.6 Summary of step changes

| Step | Change | Model touched? | Risk |
|---|---|---|---|
| 1 Introduction | Deleted as a step; becomes the arrival room | No — state/rules/scoring kept | Medium (screen flow, `deriveChoices`) |
| 2 Staging | Resting-height fix, tray-drag fix, live camera framing | No | Low |
| 3 Tourniquet | Visual only: spine, neck, face patch, hair line, band standoff | No | Low–medium (face patch is new geometry) |
| 4 Palpation | Traces replace the Mark button; new measurements | Additive | Medium |
| 6 Assembly | Axial-drag screw replaces pointer circling | No | Low |
| 9 Collection | 3D default, axial seat, visible brace hand, HUD | No | Medium |

---

## 5. Graphics

The subject sets the brief: the smallest thing on screen is the most important
thing on screen. Spectacle would actively hurt. The budget goes to five places.

**5.1 Skin that shows what is under it.** The single highest-value visual in the
game. Subsurface-ish scattering approximated with a cheap wrap-lighting term
plus a depth-tinted vein contribution, so a vein at 2 mm reads differently from
one at 5 mm *without* a UI element saying so. This is what makes palpation and
the vein finder feel like perception rather than information. Per-patient skin
tone already exists; the shading model is what is missing.

**5.2 A band that changes the limb.** Distension above the band, pallor below
it, the skin dimpling where the band bites. `veinDistension()` and
`distalPallor()` already compute the numbers; they need to be *visible* at
working framings. A learner should be able to see "too tight" without reading
"too tight."

**5.3 Blood that behaves.** Flash in the hub with real timing. Column advance in
the tubing for a winged set. Fill that slows as the vacuum decays and stops on
its own — the game already models this and the review's screenshot shows a
number rather than a thing happening. Additive-correct colours: lavender's
inversions actually mixing, citrate's ratio visible against the fill line.

**5.4 Lighting and grade.** Clinical, not moody: a key that is a real overhead
panel, soft fill, and a warm bounce off the counter so skin never goes waxy.
One deliberate exception — the `stick` framing dims the room fractionally and
tightens the key, which is what attention actually feels like and costs nothing.

**5.5 Materials that read as their material at 30 cm.** Nitrile is matte and
slightly translucent at the fingertips. Glass is glass. The tourniquet is
matte latex with a fabric-ish micro-normal. Steel is the only thing in the
scene allowed to be shiny, which is why the needle draws the eye.

**What is explicitly not in the budget:** photoreal skin, ray tracing,
post-processing stacks, particles, a dramatic camera. `ASSET_SOURCES.md`'s style
constraint stands — stylised realism, readable at working distance, and mixing
art directions is worse than staying procedural.

---

## 6. California accuracy

Every rule, the mechanic that expresses it, the measurement that proves it.
Marked **[CA]** where it is California-specific, **[STD]** where it is national
standard of practice, and **[OURS]** where it is this project's documented
default rather than published policy — the convention `rubric/policy.js`
already uses, and the same warning applies: if the programme's actual policy
becomes available, these are what change.

| # | Rule | Source | Mechanic | Measurement |
|---|---|---|---|---|
| 1 | Two identifiers, patient-stated, before any specimen collection | [CA] 17 CCR §1034; [STD] CLSI GP41 | The arrival room: the patient states, the requisition is read, the band does not leave the tray until they match | `introduction.identifiersObtained`, `leadingAsks` |
| 2 | Never lead the identification | [STD] CLSI GP41 | Leading variants sit beside open ones in the radial and still get an answer | `leadingAsks` |
| 3 | Requisition must be checked against the patient | [CA] 17 CCR §1034 | The requisition is a physical object that must be picked up and read | `orderConfirmed` |
| 4 | Hand hygiene before gloving; gloves for every draw | [STD]; [CA] 8 CCR §5193 | The sink and the glove box are objects; touching anything contaminates | `hygieneSeconds`, `dryingSeconds`, `gloveContaminated` |
| 5 | Tourniquet no more than 1 minute | [STD] CLSI GP41 | The band's own clock runs live; hemoconcentration feeds the specimen verdict | `tourniquet.seconds` → `specimen` |
| 6 | Alcohol, concentric outward, allowed to air-dry | [STD] | The scrub records the path it travelled; drying is real seconds | `cleaning.coverage`, `dryingSeconds` |
| 7 | Do not re-palpate a cleaned site | [STD] | Palpating after the scrub visibly disturbs the prep field | `cleaning.recontaminated` |
| 8 | Order of draw | [STD] CLSI GP41 | The numbered rack and the order tubes actually come off the holder | `collection.orderOk` |
| 9 | Fill to the stated draw volume; citrate ratio | [STD] CLSI GP41 | The vacuum stops on its own; the fill line is printed on the tube | `collection.fillRatio` → `specimen` |
| 10 | Discard tube before citrate when a winged set is used | [STD] CLSI GP41 | The discard tube is on the cart and is the correct first pick | `collection.discardUsed` |
| 11 | Engineered sharps-injury protection; activate before disposal | [CA] 8 CCR §5193(d) | The device's own shield, engaged by hand | `withdrawal.safetyEngaged` |
| 12 | **Never recap** | [CA] 8 CCR §5193(d)(2)(G) | Attempting it is possible and is a qualified critical event | `withdrawal.recapAttempted` — automatic-failure flag |
| 13 | Sharps disposal at point of use, before pressure and bandaging | [CA] 8 CCR §5193; already fixed in `procedureState.js` | Step order; the container is within reach on the bench | `withdrawal.disposeOk` |
| 14 | Pressure until haemostasis, arm not bent | [STD] | Real force held for real seconds; the patient bends their arm if you let them | `postDraw.pressureN`, `postDraw.seconds` |
| 15 | Never draw above an IV; ask about mastectomy, fistula, site condition | [STD] | Patient disclosures from trigger data; site scenarios that make it wrong | `introduction.asked`, `palpation` |
| 16 | Labelling at the bedside, before leaving the patient | [CA] 17 CCR §1035.2; [STD] | The label screen occurs with the patient still present | `labelling` |
| 17 | CPT-1 scope: skin puncture and venipuncture only | [CA] 17 CCR §1034 | The game contains no arterial draw and no cannulation | — |
| 18 | Automatic-failure event set and pass mark | [OURS] | `rubric/policy.js` | — |
| 19 | 0–4 cut points and excellence gates | [OURS] | `rubric/policy.js` | — |

**Two open items** that must not be quietly guessed:

- The **school's actual competency checklist and automatic-failure list**. Until
  it exists, everything marked [OURS] stays marked [OURS], in one file.
- **Order-of-draw edition.** The game should state which CLSI edition it follows
  on the report, because programmes differ on the discard tube.

---

## 7. Sequence

Twelve items. Ordered so that each one ships something playable and nothing
depends on an item below it.

| # | Item | Why here | Size |
|---|---|---|---|
| 1 | Tray resting heights + tray-drag + staging camera (4.1) | Pure bug fix, unblocks trusting anything else | S |
| 2 | Patient body: spine, neck, face patch, hair line (4.2) | Same — the two "this is broken" items first | M |
| 3 | Modes → Learn / Play; delete Bench mode; save migration (3.1) | Every later item asks "which mode?" | M |
| 4 | Clock-in redesign; "Make it harder" into Settings (3.2, 3.4) | Follows directly from 3 | S |
| 5 | Collection: unpersist the toggle, 3D default, fix panel overflow (4.5 items 1, 5) | One-line cause, large perceived effect | S |
| 6 | The gesture grammar: assist rules, axial-drag helper, stop feel (4.0) | The shared foundation for 7 and 8 | M |
| 7 | Assembly rebuilt on the grammar (4.4) | | M |
| 8 | Collection seating + visible brace hand (4.5 items 2, 3) | | M |
| 9 | Palpation traces replace the Mark button (4.3) | Independent; new measurements | M |
| 10 | The HUD, implicit advancement, camera-follows-hand (3.5 a, c, d) | The Play feel, on top of working gestures | L |
| 11 | The whole kit live at once — dispatcher inversion (3.5 b) | Highest risk, behind a flag, last of the flow work | L |
| 12 | Step 1 deleted; the arrival room (3.3) | Screen-flow surgery; safest once modes are settled | L |
| — | Butterfly in 3D: wings, tubing, hand geometry (4.5) | Deferred; scope separately | XL |

**Definition of done for the whole effort:**

- [ ] Two CPT-1s complete a Play draw with no briefing and no text read
- [ ] Every unit spec green throughout; no `*State.js` or `*Rules.js` regressions
- [ ] No object in any step rests below the surface it is on — asserted
- [ ] The face-sanity contact sheet is clean at all 12 framings
- [ ] A Play draw contains zero instructional prose and zero "Carry on" buttons
- [ ] Learn still teaches every step explicitly, with section replay
- [ ] Every row of the section 6 matrix has a passing test
- [ ] `docs/ASSET_MANIFEST.md` has no unfilled required row
- [ ] Old saves open with their progress intact

---

## 8. What this plan does not do

Stated so nobody assumes otherwise:

- It does not touch the rubric's numbers. `rubric/policy.js` is the only place
  thresholds live and this plan adds none.
- It does not add a physics engine. `bench/motion.js`'s prohibition holds.
- It does not make the butterfly draw 3D. That is scoped and deferred.
- It does not resolve the `lobby.mp3` licence question. It remains the one
  unverified asset in the repository and it should be replaced, not traced.
- It does not add multiplayer, an instructor dashboard, or content beyond the
  venipuncture and dorsal-hand procedures already implemented.
