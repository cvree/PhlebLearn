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
game/  (gameState, saveSystem, progression, encounter, scoring, dialogue)
        │
audio/  (audioManager — depends only on game/gameState)
        │
rendering/  (scene, renderer, lighting, camera, materials, assetLoader, modelRegistry)
        │
world/  (room, furniture, patient, tubeRack, sharpsBin, interactables)
        │
venipuncture/  (procedureState, questions, clinicalRules, steps,
               accessibilityFallback = the driver, physicalSteps,
               encounterState, staging/*)
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

`main.js` couples to exactly four runtime hooks (`isStagingActive`,
`renderStaging`, `stagingPointer*`) — the composition root's usual job. While
staging is active the canvas renders the staging scene instead of the room,
through the same renderer, so there is only ever one WebGL context.

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
screen. This is intentionally the largest file in the app — "which screen
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
