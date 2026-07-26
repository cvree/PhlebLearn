# Tiny Vials — Gameplay Upgrade Roadmap: "Real Objects"

**Goal:** move the venipuncture skill practice out of the 2D emoji panel and into the
3D room, so the player handles real instruments on a real arm.

Live: https://cvree.github.io/PhlebLearn/ · Pages: legacy build, `main` branch, root path.

---

## Where the code stands today (post-Phase 0)

| Thing | Reality |
|---|---|
| Entry point | `index.html` (Vite), built via `npm run build` → `dist/` |
| Source | `src/` — see `docs/ARCHITECTURE.md` for the full module layering |
| Renderer | three.js **0.185** (npm dependency, ESM, bundled by Vite) |
| Other libs | GSAP 3.12, Lenis, Vanta fog — still CDN, still with `onerror` fallbacks (progressive enhancement, unchanged) |
| 3D room | 100% hand-built primitives (`box`/`cyl`/`sph` in `rendering/materials.js`). Desk, chair, supply stand, tube rack, sharps bin |
| Model registry | `rendering/modelRegistry.js` — 13 real `supply.*` registrations, all resolving to procedural builders until licence-cleared `.glb`s exist (see `docs/ASSET_PIPELINE.md` and `docs/ASSET_SOURCES.md`) |
| Patient | Cylinder body + sphere head, hair/glasses/beard variants (`world/patient.js`). **No arms at all** — Phase 1b |
| Real pickable objects | 13 rack tubes, sharps bin, monitor, patient, mascot, sticker book — via raycast `input/raycasting.js` → `main.js`'s dispatch |
| Venipuncture (`venipuncture/`) | 16–17 steps (tube-count dependent). `gather` is now a real 3D supply cart (`staging/`); the other 15 are still 2D DOM. Driven by a typed procedure-state + explicit clinical-rule gates, with a step-implementation registry that lets one step at a time become physical |
| State machine | Same 13 screen states through `ui/panels.js`'s `go()`, each rewriting `panel.innerHTML` |

**The gap that remains:** 15 of the 16 venipuncture steps are still the 2D DOM
panel. Supply staging (Phase 1a, below) proved the object-interaction pipeline
end to end; each branch after it converts one more step, in order, using the
same pipeline.

---

## Phase 0 — Foundations ✅ complete (`refactor/phase0-foundation`)

- **Audio externalized.** The 810KB base64 lobby track moved to
  `public/assets/audio/lobby.mp3`. Game file dropped 1.07MB → ~260KB before the
  module split even started.
- **three.js r128 (2021 CDN UMD) → three.js 0.185 ESM**, installed as a real
  npm dependency and bundled by Vite. `GLTFLoader` migrated from the old
  `THREE.GLTFLoader` UMD-namespace pattern to a proper named import.
- **Monolith split** into ~35 ES modules under `src/` (`config`/`game`/
  `rendering`/`world`/`venipuncture`/`input`/`ui`, plus `main.js` as the
  composition root) with an acyclic dependency layering — see
  `docs/ARCHITECTURE.md`.
- **CSS extracted** into `src/styles/{base,panels,lab,venipuncture}.css`,
  grouped by responsibility rather than split arbitrarily.
- **Vite build** added (`npm run dev|build|preview`), correctly emitting the
  `/PhlebLearn/` base path GitHub Pages needs — see `docs/DEPLOYMENT.md` for
  a base-path bug that shipped partway through and how it was caught.
- **Model registry** (`rendering/modelRegistry.js`) built with the
  register → preload → instantiate → dispose API, procedural-fallback
  support, and progress reporting — see `docs/ASSET_PIPELINE.md`. No real
  `.glb` assets yet; Phase 1 (physical supply staging) is where real
  registrations start.
- **Venipuncture procedure extracted** from DOM rendering into
  `venipuncture/{procedureState,questions,clinicalRules,steps,accessibilityFallback}.js`
  with a typed step interface (stable id, phase, trigger, requiredState) and
  explicit sequencing gates — see `docs/TESTING.md` for the full bug-by-bug
  writeup. Two real, active sequencing bugs were found and fixed (sharps
  disposal was happening *after* pressure/bandage instead of before; the
  alcohol swab reset position on every pointer release instead of keeping
  its last dropped spot).
- **Automated tests**: 13 unit tests (`npm test`, node's test runner) for the
  clinical-rule gates and step ordering; 7 Playwright smoke tests
  (`npm run test:e2e`) against the production build; `npm run verify` chains
  both plus the build itself.
- The old 2D venipuncture interactions are preserved as-is (now the
  accessibility-fallback path) — nothing was thrown away.

## Phase 1a — `feature/physical-supply-staging` ✅ complete

The `gather` step no longer exists as a grid of tappable emoji. It is a
close-up supply cart the learner works at: 23 recognisable objects, picked up,
turned over to read their labels, dragged onto a working tray, seated into a
numbered tube rack in order of draw, with a sharps container that has to be
moved into an immediate-reach pad beside the chair before anything can start.

What it teaches, mechanically rather than by quizzing:

- **Tool selection under ambiguity.** Two tubes of the same cap colour; only one
  is in date. Two 21G needles; one pouch is split. Three sharps containers; one
  is locked and one is above the fill line.
- **Verification before commitment.** Expiry dates, gauge bands and patient
  labels are printed on the *back* of each object. A tap lifts an item into an
  inspect pose; only actual rotation past ~115° reveals what it says, and
  whether the learner checked *before* staging is measured.
- **Sequence.** Tubes seat into numbered wells; the rack has to read in order of
  draw before the tray unlocks.
- **Spatial placement and handedness.** The tray, the arm, the reach pad and the
  "past the arm" zone are real rectangles in metres. Right-handed stages on the
  left; left-handed is an exact mirror — of the geometry, not of a label.
- **Consequence and recovery.** Nothing snaps back. An object released off the
  counter falls and is contaminated. A wrong item sits there until the learner
  removes it, with a specific clinical explanation of why it can't be used.

Delivered alongside: the first real `registerModel()` calls (13 ids, all with
procedural fallbacks), a persistent `encounterState` carried through the whole
draw, a `supplyStaging` scoring category that reports actual measurements, a
portrait cart layout for phones, an accessible list view driven by the *same*
rules and measurements, 31 unit tests and 12 browser tests.

Deliberately chosen as the first converted interaction (before the arm/veins)
because it proves the whole object-interaction pipeline — registry → mesh →
pick → drag → zone → shared state → rules → measurement → feedback — without
needing new anatomy geometry first. Every branch below reuses it.

## Phase 1b — The real arm

- A proper 3D forearm attached to the patient, resting on the chair armrest.
- **Real vein geometry** under a translucent skin layer: median cubital, cephalic,
  basilic — plus a pulsing brachial artery and a tendon as real hazards.
- Skin tone driven by the existing `SKIN_TONES` / `makeAppearance()`.
- `makeSiteScenario(dl)` stops being labels and becomes **geometry**: deep veins sit
  lower, rolling veins physically slide under pressure, small veins are thinner.
- New `tweenCamera` "draw close-up" preset docking over the antecubital fossa.
- See `docs/ASSET_PIPELINE.md` for which parts of the arm are procedural
  (must be — they vary per patient and need real collision) vs. which
  instruments become GLB assets.

## Phase 2 — Real instruments

Each step converts from DOM widget → 3D interaction, reusing the existing raycaster.
The DOM panel stays as the **coach layer** (tips, why-it-matters, teach mode) — it
stops being the interaction surface.

Branch order (one branch each, verified and deployed before the next starts):
`feature/real-tourniquet` → `feature/tactile-palpation` →
`feature/aseptic-site-cleaning` → `feature/needle-holder-assembly` →
`feature/anchor-and-insert` → `feature/tube-collection` →
`feature/withdraw-safety-sharps` → `feature/post-draw-care`.

| Step | Today | Becomes |
|---|---|---|
| gather | ✅ **done** — a real supply cart | — |
| tourniquet | drag a 🎀 div | route it under the arm, wrap, tension, cross, tuck, leave a releasable tail; the same strap stays in the scene until it is released after first blood |
| palpate | tap labeled buttons | press the real arm — veins highlight under the fingertip, artery pulses back |
| clean | drag 🧽 | scrub a real swab; coverage painted to a decal texture; real 30s dry timer |
| assemble | div onto div | thread a real needle into a real holder (snap + click) |
| uncap | drag cap div | pull the real cap along the needle's axis |
| insert | 2D angle math | **real 3D angle + depth** vs. skin normal, 15–30° window, bevel-up roll check, flashback in the real hub |
| fill | CSS height animation | real tube fills by volume; vacuum seat has feel |
| switch | drag tube divs | pull tubes off the **real rack** in order of draw; needle jitter is penalised |
| release / withdraw / safety | button taps | real band snap, real withdrawal path, real shield slide |
| pressure / bandage | drag 🩹 | real gauze on the real site; hold timer checks arm position |
| dispose | button | actually drop the unit into the 3D sharps bin (`pickType:"bin"` already exists) |
| invert | button | grab the tube and rotate it 5–10× — counted for real; shaking causes hemolysis |

**Accessibility:** today's `VP_STEPS` survive as an opt-in **2D fallback mode** for
touch, low-end GPUs, and reduced-motion. Nothing is thrown away.

## Phase 3 — Consequences

- Complications rendered in 3D: hematoma swelling, blown vein, dry stick, vein
  collapse under vacuum, patient flinch and syncope (`DRAW_EVENTS` already exists).
- **Sample quality model**: hemolysis, under-fill ratio, additive carryover — piped
  into the existing `scoreEncounter()`.
- `vpFinish()` chips report **real measurements**: actual insertion angle in degrees,
  actual tourniquet seconds, actual fill percentage.

## Phase 4 — Progression

- New `UPGRADES` for real equipment (butterfly set, vein finder, pediatric kit), each
  unlocking real 3D tools and new scenarios.
- Bind the existing `difficultyLevel()` 0–4 ladder to vein geometry and event rate.
- New stickers and badges for the new skills.

## Phase 5 — Polish and ship

- Mobile touch, reduced-motion path, dark-theme registration for every new mesh
  (`regTheme` / `THEMED` already handle this).
- Perf budget: instanced meshes, model LODs, 60fps on integrated graphics.
- Ship phase by phase: scoped branch → `npm run verify` → merge to `main` →
  confirm GitHub Pages rebuild → live-site smoke test. No unfinished phase
  work goes to `main` directly.
