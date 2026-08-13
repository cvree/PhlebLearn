# Architecture

Tiny Vials was originally a single 3,888-line HTML file. Phase 0 split it into
an ES module tree under `src/`, built with Vite, without changing the
gameplay it already had. This document explains how the pieces fit together
and, just as importantly, *why* they're grouped the way they are.

## Module layering

The module graph is intentionally acyclic. Each layer may only import from
layers listed **below** it:

```
config.js, utils.js, dom.js, fx.js   (leaves — zero internal imports)
        │
game/  (gameState, saveSystem, progression, encounter, scoring, dialogue,
        archetypes, mastery, personalBests, challenges, debrief)
        │
audio/  (audioManager, procedural — depend only on game/gameState)
        │
bench/  (benchSession, assist, motion, haptics — the feel layer; depends on
        game/ + rendering/ + venipuncture/arm only)
        │
rendering/  (scene, renderer, lighting, camera, materials, assetLoader, modelRegistry)
        │
world/  (room, furniture, patient, tubeRack, sharpsBin, interactables)
        │
venipuncture/  (procedureState, questions, clinicalRules, steps,
               accessibilityFallback = the driver, physicalSteps,
               encounterState, sections, viewport = the shared canvas
               measurement every runtime frames its camera from,
               stepRuntimes = the table main.js dispatches through,
               one directory per converted step —
               staging/*, arm/*, tourniquet/*, palpation/*, cleaning/*,
               assembly/*, insert/*, collection/*, withdrawal/*, postdraw/*,
               inversion/*, butterfly/* — the rubric/* grading layer, and
               the two DRAW-scoped layers complications/* and specimen/*)
        │
input/  (raycasting, cameraControls, pointerInput, touchInput)
        │
ui/  (panels, coachLayer, notifications, settings, dynamicEffects)
        │
main.js  (composition root — may import from every layer)
```

**Why `game/` sits below `rendering/`/`world/`, not above them**: it's
tempting to think of "game logic" as the top layer, but in this codebase
`game/` only holds pure data and rules (the save file, XP/coins, which
upgrades are owned, patient generation, scoring). Rendering and world-building
are *consumers* of that state (they decide what to draw based on which
upgrades are owned, what theme is active, etc.) — so game logic has to sit
below them in the dependency graph.

**Two deliberate exceptions to "one concern per file"**, both documented at
the top of the file in question:

- `world/room.js` combines the room shell (walls that fade as the camera
  orbits) with the entire decor-placement system (grid floor items + wall
  art). The original code has these call each other constantly (placing an
  item re-renders the room; the room re-render needs current placements), so
  splitting them would just recreate the same coupling as two files importing
  each other in a cycle.
- `ui/settings.js` combines the settings overlay, the upgrade shop, and the
  sticker book. All three are "overlays reached from the floating buttons
  next to Settings," and none is large enough on its own to justify separate
  files with separate `renderX()`/`closeX()` boilerplate.

**One addition beyond the originally-requested file list**: `src/config.js`,
`src/utils.js`, `src/dom.js`, and `src/fx.js` sit at the very top as shared
leaves. `fx.js` in particular exists because the GSAP wrapper (`FX`,
`fxPanelIn`, `countUp`, ...) is used by both `venipuncture/steps.js` and
`ui/panels.js` — since venipuncture sits below ui in the layering, that
utility can't live inside `ui/` without creating an upward import.

**`ui/notifications.js` is a special case**: it's filed under `ui/` because
toast/confetti/floatXP *are* a UI concern, but it's treated as a dependency
leaf (like `dom.js`) — it must never import from `panels.js`/`settings.js`/
`coachLayer.js`, precisely so that `game/`, `world/`, and `venipuncture/`
modules can call `toast()` for user feedback without an upward import.

## Physical gameplay: how a step becomes a real interaction

`venipuncture/accessibilityFallback.js` is the **driver**. For each step id in
the sequence it picks an implementation:

1. `physicalSteps.js` → `PHYSICAL_STEPS[id]` — the real, object-manipulation
   gameplay. Preferred whenever it exists.
2. `steps.js` → `VP_STEPS[id]` — the 2D DOM fallback.

Both have the identical signature (`fn(c, stage, advance) → cleanup?`), read the
identical procedure state, and are gated by the identical `clinicalRules.js`
functions. Converting a step from (2) to (1) therefore changes *how the learner
performs the action* and nothing about sequencing, gating or scoring semantics.
Each future branch adds one id to `PHYSICAL_STEPS` and touches nothing else in
this layer.

`venipuncture/encounterState.js` is the persistent physical encounter — one
object per patient, carried across every step, so the tourniquet that gets
staged is the tourniquet that later gets applied and released. Branch 1 fills in
`supplies` and `measurements.supplyStaging`; the remaining slots (`tourniquet`,
`site`, `assembly`, `access`, `collection`, `disposal`) are declared so later
branches extend the same object rather than inventing parallel state.

That persistence is what lets one step's technique become the next step's
problem rather than a line in a report. The clearest case is `assembly`: a
multi-sample needle screws into its holder, so where the bevel points when the
learner stops turning is wherever the thread stopped — and the `uncap` step
inherits exactly that angle and has to find it and roll it up.

Every converted step directory has the same five-file shape, split by *what
kind of thing it is* so the rules can be unit-tested without a browser and the
visuals can change without touching the rules: `<step>State.js` (pure data,
plus whole techniques as pure helpers), `<step>Rules.js` (pure clinical
judgement), `<step>Runtime.js` (THREE + gestures; writes state, asks rules,
decides nothing), `<step>Coach.js` (DOM; reports observations) and
`<step>Scoring.js` (real measurements, not booleans). `staging/` is documented
in full below as the worked example.

**The techniques live in `<step>State.js`, not in the runtime**, because the
accessible "controls" view calls `stop*()` and disposes the 3D scene — so any
handler routed through a runtime function silently does nothing there. Both
input paths call the same pure helper, and therefore get the same measurements
and the same rules.

### `venipuncture/staging/` — physical supply staging

Split by *what kind of thing it is*, so the rules can be unit-tested without a
browser and the visuals can change without touching the rules:

| Module | Imports THREE / DOM? | Responsibility |
|---|---|---|
| `supplyCatalog.js` | no | What objects exist this encounter, which are flawed, and why each flaw matters |
| `stagingState.js` | no | Where every object is, what has been done to it, and the single write path (`placeItem` / `inspectItem`) every input mode goes through |
| `stagingLayout.js` | no | The work area's real geometry in metres: zone rectangles, handedness mirroring, portrait vs. landscape carts, `zoneAt()` |
| `stagingRules.js` | no | Is the tray safe to start a draw from — the only place that answers it |
| `stagingScoring.js` | no | Measurements and the behaviour-citing feedback narrative |
| `supplyModels.js` | THREE | Procedural builders registered into the shared model registry, plus per-instance decoration |
| `stagingScene.js` | THREE | Meshes, camera framing, hover/held/ghost feedback. Owns no rules |
| `stagingRuntime.js` | THREE + DOM | Pick up, turn over, put down. Writes through `stagingState`, asks `stagingRules` |
| `stagingCoach.js` | DOM | Status, coaching, and the accessible list view |

`main.js` does not import this runtime — or any of the other nine — directly.
Every converted step exposes the same five hooks (`isXActive`, `renderX`,
`xPointerDown/Move/Up/Cancel`), so they are listed once as a table in
`venipuncture/stepRuntimes.js` and the composition root asks
`activeStepRuntime()` whose canvas it is. While a step is active the canvas
renders that step's scene instead of the room, through the same renderer, so
there is only ever one WebGL context.

**Adding a converted step is one row in that table and nothing in `main.js`.**
It used to be five separate ten-branch `if`-chains — pointer down, move, up,
cancel, and the render loop — which all had to be edited together, and which
would silently drop a step from one gesture if a branch were added to only
four of them.

**Guided vs. scored is a rendering and gating decision, never a rules
decision.** `stagingRules.js` always computes the full truth; `stagingCoach.js`
decides how much of it the learner is shown, and `physicalSteps.js` decides
whether an unready tray blocks the draw. Teaching mode surfaces the checklist,
the expected order of draw and the reason a staged item is wrong; a scored shift
shows an inventory and nothing else, and the same evaluation is reported after
the encounter instead. There is no second, laxer rule set behind either mode —
which is what makes the post-encounter report able to name exactly what was
wrong at the moment the learner chose to begin.

The tray is an object, not a fixed region: `applyTrayOffset()` moves the tray
and rack rectangles together, clamped to the counter and pushed clear of the
patient's arm. Items are not children of the tray mesh (their world positions
stay authoritative), so a tray drag moves the group and every staged item, and
the drop commits one offset to the layout, the state, and each item's position.

## The bench: one scene for the whole encounter

`bench/benchSession.js` is the keystone of the redesign. Nine runtimes used to
call `buildArmScene()` on entry and `view.dispose()` on exit, so the patient's
arm was destroyed and rebuilt between every step — which is why the game felt
like a checklist: architecturally it was one.

There is now **one scene per encounter**. Steps became MODES that lease it:

```js
const view = leaseBenchView({ mode: "tourniquet", arm });
...
view.dispose();     // releases the LEASE, not the bench
```

A lease owns its own `root` group, so anything a mode adds is cleaned up when
that mode ends and nothing else is. Anything that must **outlive** the mode
that created it registers as a bench prop instead:

```js
const strap = view.benchProp("strap", () => buildStrap(...));
```

which is built at most once per encounter and handed back to every later mode
that asks. That single mechanism is what makes the band you tied stay tied: it
is the same object, still on the same arm, in the state the last mode left it
in. `ui/panels.js`'s `nextPatient()` is the only caller of `closeBench()`.

`tests/bench.spec.js` asserts the lease protocol against a stub scene;
`tests/bench.e2e.spec.js` asserts it in a real browser, walking one encounter
through five modes and checking the scene is never rebuilt.

## The feel layer

Four modules, all of which exist because the redesign treats game feel as a
feature rather than as polish:

| Module | Responsibility |
|---|---|
| `bench/assist.js` | ONE magnetism layer every interaction routes through. Screen-space radii (the old ones were in metres, so assistance was quietly weaker on a phone), predictive targeting from pointer velocity, sticky engagement, graduated pull. Its rule: *magnetism helps you hit what you meant; it never decides what you meant.* |
| `bench/motion.js` | Authored motion and weight. There is **no dynamic rigid-body simulation anywhere in this game and there must never be one** — pick up, carry, release, settle and bounce are all authored curves, so tunnelling, jitter, drift and unreachable props are structurally impossible rather than tuned against. |
| `audio/procedural.js` | Diegetic sound, synthesised. Continuous parametric voices (the palpation "give", the tourniquet's elastic, the vacuum's decay, the scrub) that are fed by what the simulation already knows, so the sound and the model cannot drift apart. Two buses: `room` ducks, `front` never does. |
| `bench/haptics.js` | Short structured `navigator.vibrate` patterns, respecting reduced motion. |

The camera lives in `venipuncture/arm/armScene.js` and its beat framings in
`venipuncture/arm/benchFramings.js`. `fitCamera()` no longer moves the camera:
it sets a target and `tick()` eases toward it, which is what lets the game stop
cutting between steps. Handedness is a Z mirror on the scene root and nothing
downstream knows about it — see `tests/handedness.spec.js` for why solving the
2×2 rather than assuming its sign is what makes that safe.

Two consequences of an easing camera that took real debugging to find, both
now load-bearing:

- **A screen point projected mid-ease is a point the object has left by the
  time the pointer gets there.** `view.cameraSettled` answers "have you
  finished moving?" and `tests/benchHelpers.js` waits on it. Nothing in the
  game reads it; it exists so an acceptance test can wait on the move rather
  than on a clock.
- **A camera that eases under a hand that is already down drags that hand
  across the skin,** because the skin point under the pointer is re-solved
  against the live camera every frame. Any framing change has to be finished
  before a gesture starts and must not restart between strokes — see the
  two-framing rule in `cleaning/cleaningRuntime.js`.

Framings are a point SET, not a bounding box, so a framing can say something
meaningful ("keep the hand in shot, because a band that is too tight announces
itself as a pale hand"). Two of them deliberately drop the patient's face:
`stick`, because a 4 mm vein and a face do not share a frame, and `scrub`,
because the prep field is 5 cm across and at `prep`'s distance it came out
85 pixels wide — a five-turn spiral over 85 pixels advances less than a pixel
per sample, and neither the grader nor the hand could tell outward from
inward. Both push-ins ease straight back out the moment the millimetre work
is over.

## When the learner is paid — and when they are told

`game/rewards.js` is unchanged: every step ticks, every finished section pays
according to its own 0–100 measurement, a streak of clean sections multiplies
the section bonus. What changed is **when it is shown**.

Nothing at all is shown during the draw. `rewardStep()` accrues into
`c.held`; the end-of-draw lump sum joins it; even the top bar shows `—` instead
of XP and coins. It is all released in `game/debrief.js`'s four acts — the
patient leaves, the lab speaks, the numbers arrive in real units, the payout
lands — with "Next patient" as the largest control on the screen.

`game/mastery.js` is the parallel axis that measures skill rather than time: a
star costs three CONSECUTIVE draws at its threshold, and a bad draw resets the
run. `tests/mastery.spec.js` spends fifty mediocre draws proving that grinding
buys nothing.

## Technique challenges: the replay axis

`game/challenges.js` is pure data plus one pure evaluator. A challenge is an
opt-in per-draw modifier that changes what "doing it well" means, so the same
clinical model produces a different game. Two invariants make the bonus
honest, and `tests/challenges.spec.js` asserts both directly:

1. **A challenge never makes a draw easier.** Every entry removes help or
   narrows a window. Assist may only go down; the vein finder may only be
   taken away; scenario keys only make an arm harder. A modifier that widened
   something would turn the system into a cheat menu with a multiplier on it.
2. **A challenge is checked against measurements the draw already produces.**
   A challenge that needed a new number would be a new mechanic wearing a
   modifier's clothes, and the two would drift apart.

`game/activeChallenges.js` is the one mutable cell saying which of them is
live. The five systems a challenge can re-aim each read that one place:

| system | reads it in | what changes |
| --- | --- | --- |
| assistance | `bench/assist.js` | `assistLevel()` floors at the forced value |
| the coach | `game/gameState.js` | `reveal()` closes the telling channels |
| the kit | `game/progression.js` | `hasUpgrade("veinFinder")` returns false |
| the patient roll | `game/encounter.js` | extra keys fold into `site.keys` |
| handedness | `venipuncture/physicalSteps.js` | the whole bench mirrors |

Armed in `startShift()` **before** the first patient is rolled — "Deep vein"
changes the arm the roll produces — and disarmed in `endShift()`, so a
challenge can never leak into a draw nobody opted into. The Bench never
carries them: it is a rehearsal room, not a run.

The multiplier is applied at the debrief's payout, not inside `rewards.js`.
The payout arithmetic is part of the protected clinical model and is untouched;
a challenge multiplies what that arithmetic produced, and only when the draw
actually satisfied it. A missed challenge costs nothing — it simply does not
pay.

## Two layers that belong to the DRAW, not to any step

Every converted step directory has the same five-file shape and the same
lifetime: it starts when its screen opens and stops when the learner moves
on. Two things in this game cannot work that way, and both are documented at
the top of their own modules:

**`venipuncture/complications/`** is the patient's body answering back. A
hematoma raised during the stick keeps growing while the band comes off; a
vasovagal faint builds across four screens. So it is one session, created
with the procedure state in `createProcedureState()`, and ticked once a frame
from `main.js`'s `animate()` — before the per-step scene early-returns,
because the body does not care which screen is up. It owns no scene of its
own: what it writes is the arm's `condition` object, which `armMesh.js` holds
a LIVE reference to and reads every frame in whichever scene is running. That
one indirection is what makes damage done in one step visible on the limb in
every step after it.

Its alert layer is likewise not rendered into the current step's panel — a
complication arrives while the learner's hands are busy, so
`complicationCoach.js` owns one fixed overlay over `#app`, created on demand
and removed when answered, the same way `ui/notifications.js`'s toast does.

**`venipuncture/specimen/`** is the laboratory's verdict, and it can only
exist once. Haemolysis reaches a tube from three different branches (gauge
shear under a full vacuum, a needle moved in the lumen, shaking during
mixing) and the analyser cannot tell them apart; the fill ratio comes from
collection, the mixing counts from inversion, the hemoconcentration from the
tourniquet's own seconds. No step can assemble that, so `assessSpecimens()`
runs at the end of the draw over the states the steps left behind.

`sections.js` names both in `DRAW_MEASUREMENTS`, so "is every graded
measurement produced by something?" has an honest answer and Practice mode's
per-section feedback knows not to look for them.

## When the learner gets paid

`game/rewards.js` is pure arithmetic over the measurements the steps already
produce, and it exists because the old payout was one lump at the end of a
seventeen-interaction procedure — no acknowledgement of anything until a
screen the learner reached minutes after the work that earned it.

Three tiers, and the rule that keeps them honest is that **only the middle one
is worth much**:

| When | What | Scaled by |
|---|---|---|
| every finished step | `STEP_XP` (2) | nothing — doing it is progress |
| every finished SECTION | 2–16 XP, a coin when clean | the section's own 0–100 mean, the same number the rubric grades from |
| the end of the draw | completion, plus three outcome bonuses | how much got finished, whether every section was clean, whether every specimen was accepted, whether nothing was missed |

A streak counts consecutive *clean* sections (≥88) and multiplies the section
bonus only — never the step tick — so a long streak is worth having and is
still only ever paid for good work. A section below 60 pays nothing and breaks
it. `tests/rewards.spec.js` asserts the property that matters: a whole draw
clicked through badly earns less than half what the same draw done well earns,
and no amount of finishing things substitutes for doing them properly.

The driver calls one hook, `onStepFinished(finishedId, nextId)`;
`ui/panels.js` decides everything else, exactly as it does for Practice mode's
section feedback. `venipuncture/` still knows nothing about XP.

## How an upgrade changes the draw

`game/progression.js` holds the equipment rules, and they follow one
constraint: **an equipment upgrade moves a number some branch already reads,
it never adds a special case to one.** The winged-set kit turns the device
from something the patient's arms dictate into a choice
(`ensureArmSession()`'s `chosenProcedure`); the transilluminator raises the
render opacity of deep vessels and nothing else, so palpation still decides
the rubric row; the warming pack multiplies the arm's own `vigour`; the
paediatric kit scales `tubeVolumeMl()`, which is what `collapsesVein()`
already consults. `difficultyVeinKeys()` does the same for the 0–4 ladder: a
harder shift is a harder LIMB, described in exactly the scenario keys
`applyPatientVariation()` already understands.

## Application startup

`main.js` is the composition root. `boot()` (triggered on `window.load`, with
a polling fallback) calls `startThree()`, which:

1. Creates the THREE.Scene (`rendering/scene.js`), camera (`rendering/camera.js`),
   renderer (`rendering/renderer.js`), and lights (`rendering/lighting.js`).
2. Builds the room shell, furniture, tube rack, and mascot (`world/*`).
3. Calls `updateRoomUpgrades()` to render whatever upgrades are already owned.
4. Applies the saved theme (`rendering/materials.js`).
5. Preloads the Phase 0 model-registry probe (see below).
6. Wires input (`setupInput()`) and starts the `animate()` render loop.
7. Calls `go("idle")` (`ui/panels.js`) to show the Clock In screen.

## Scene ownership

`rendering/scene.js` owns the single `THREE.Scene` instance and nothing else.
World-building modules (`world/room.js`, `world/furniture.js`, etc.) receive
the scene as a parameter and add their own objects to it — they don't own a
scene reference themselves. `rendering/camera.js` owns the camera object and
the orbit-control state (`radius`/`theta`/`phi`); `rendering/renderer.js` owns
the `WebGLRenderer`.

## State ownership

`game/gameState.js` owns every piece of mutable game state — the persistent
save (`SS`), the current encounter (`ENC`), the shift in progress (`SHIFT`),
and small flags (`state`, `MODE`, `ARRANGE`, `DARK`, `REDUCED`) — as **live
`let` exports**. ES modules give every importer a live, read-only view of an
exported `let` automatically; the only way to *write* one is through the
exported setter function (`setState()`, `setMode()`, `setDark()`, ...). Only
`gameState.js` itself ever reassigns its own variables — that's the boundary
that keeps this from turning back into the ad-hoc globals the monolith had.

## Input flow

`input/raycasting.js` does the mechanical work: given a pointer event, what
3D object (if any) is under it? It knows nothing about what a hit *means*.
`world/interactables.js` declares which `pickType` is meaningful in which
game-state screen (a data table, not logic). The actual dispatch — "a tube
was picked while in the select screen, so toggle it and re-render" — lives in
`main.js`'s `handlePick()`, since that's the only place allowed to call both
`world/tubeRack.js` and `ui/panels.js`.

Camera orbit-drag and the arrange-mode decor drag are two separate pointer
handlers (`input/cameraControls.js`, `input/pointerInput.js`) that `main.js`
composes: arrange-drag gets first refusal on a pointerdown, orbit-drag
handles everything else, and a plain click-with-no-movement falls through to
`handlePick()`.

## UI flow

`ui/panels.js` is the screen-flow dispatcher: `go(state)` sets the game state
and calls `render()`, which calls exactly one `renderXxx()` function per
screen. One patient is:

```
review (the patient arrives with their requisition) → [site, only if their
arms pose a question] → collect (the draw) → label and route → [respond,
only if they asked something] → score
```

**Three screens were removed once the physical steps made them redundant**,
and this is the rule that decided it: *if the draw already makes the learner
do the thing, the screen that asks them about it is deleted, and the score
reads what they did instead.*

| Was | Is |
|---|---|
| "Verify identity" multiple choice | the `introduce` step: two identifiers, from the patient's own mouth, before anything is touched — including the patient who answers with a nickname |
| "Select the tubes" (tap a rack) | the supply cart: real packages, expiry dates on the back, a wrong tube that sits there until you remove it |
| "Order of draw" (tap them in sequence) | the same cart's numbered rack, plus the order they actually came off the holder |
| "Greet & begin" (one button) | the patient greets you on the requisition screen; greeting them back is an act in the introduction |
| the mid-draw event quiz | real complications, caused by the draw and answered on the arm |
| the report printed at the end of the draw | one verdict, on the score screen, once the patient is finished with |

`game/scoring.js`'s `deriveChoices()` is where that mapping lives — it fills
in `ENC.idChoice`, `ENC.selected` and `ENC.ordered` from the introduction and
staging measurements, so the score screen's "your answer / best answer" cards
still work and now contain what the learner really did. Labeling and handling
were merged into one screen for the same reason: they are one moment of work.

The mid-draw `DRAW_EVENTS` quiz went the same way — everything that happens
while the needle is in is a real complication now (`complications/`), so only
the two post-draw professional-judgement moments remain in that table. This is intentionally the largest file in the app — "which screen
renders what" is one cohesive concern, and splitting it further would just
scatter fourteen tiny files that all need to see the same `ENC`/`SHIFT`
state.

## Venipuncture procedure flow

This is the part of Phase 0 that changed *behavior*, not just file layout.
Previously, `VP_STEPS`'s 17 step-render functions decided their own
sequencing implicitly (whatever came next in a hardcoded array), and the
"is this action allowed" checks were ad-hoc booleans scattered through each
step. Now:

- `venipuncture/procedureState.js` declares the canonical step list as typed
  descriptors (`{id, phase, trigger, interaction, requiredState}`) — see the
  file for the full list and the one incorrect step *order* fixed there
  (sharps disposal now happens immediately after the safety device is
  engaged, before pressure/bandage — see the file's comment and
  `docs/TESTING.md`'s bug list).
- `venipuncture/clinicalRules.js` holds the actual gate functions
  (`canReleaseTourniquet`, `canWithdrawNeedle`, ...) as pure functions over
  the procedure state. **These check named boolean fields, never text.**
- `venipuncture/steps.js` renders each step's 2D widget and calls into
  `clinicalRules.js` before allowing an action to complete.
- `venipuncture/accessibilityFallback.js` is the driver that walks the step
  sequence and renders each one — see `docs/ASSET_PIPELINE.md` and the
  Phase 1 notes for why this file is named "accessibility fallback" rather
  than just "the venipuncture screen."
- `ui/panels.js`'s `renderCollect()`/`vpFinish()` wire this driver into the
  rest of the game (advancing to labeling once the whole procedure is done,
  handling a mid-draw complication interrupting the sequence, awarding
  XP/coins).

## Asset loading

See `docs/ASSET_PIPELINE.md` for the full hybrid procedural/GLB plan.
`rendering/modelRegistry.js` is the centralized cache-and-fallback layer;
`rendering/assetLoader.js` is the low-level GLTF fetch it's built on.

## Save behavior

Unchanged from the original: `localStorage` under the key `phleb_shift_3d_v1`,
read/written entirely through `game/gameState.js` (`loadSS()` at import time,
`saveSS()` on every mutation). No migration logic exists yet because the save
shape hasn't changed.

## Known warnings (not bugs)

three.js 0.185 emits two deprecation warnings that are pre-existing (not
introduced by this branch) and non-functional:

- `THREE.Clock` deprecated in favor of `THREE.Timer` — `main.js`'s animate
  loop still uses `Clock` because `Timer` requires restructuring how delta
  time is fed into the loop; deferred to a future pass.
- `PCFSoftShadowMap` deprecated, three.js silently falls back to
  `PCFShadowMap` — purely cosmetic (very slightly harder shadow edges).

Both are allowlisted explicitly in `tests/smoke.spec.js` with a comment
pointing back here.
