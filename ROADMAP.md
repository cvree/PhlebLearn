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
| Model registry | `rendering/modelRegistry.js` — real API, no real `.glb` assets yet (see `docs/ASSET_PIPELINE.md`) |
| Patient | Cylinder body + sphere head, hair/glasses/beard variants (`world/patient.js`). **No arms at all** — Phase 1b |
| Real pickable objects | 13 rack tubes, sharps bin, monitor, patient, mascot, sticker book — via raycast `input/raycasting.js` → `main.js`'s dispatch |
| Venipuncture (`venipuncture/`) | 16–17 steps (tube-count dependent), **all 2D DOM still** — now driven by a typed procedure-state + explicit clinical-rule gates instead of implicit ordering. `.vp-arm` is still a CSS div; tourniquet is still 🎀, needle still 💉 |
| State machine | Same 13 screen states through `ui/panels.js`'s `go()`, each rewriting `panel.innerHTML` |

**The gap that remains:** the 3D room is still scenery — the venipuncture
interactions are still the 2D DOM panel (now on solid architecture instead
of implicit ordering, but visually unchanged). Phase 1a starts converting
real interactions into the 3D room.

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

## Phase 1a — `feature/physical-supply-staging` (first visible gameplay slice)

Converts the `gather` step from tapping 8 emoji buttons to picking real
items off the 3D supply stand into a real tray. Deliberately chosen as the
**first** converted interaction (before the arm/veins) because it exercises
almost every piece of new Phase 0 infrastructure at once without needing new
anatomy geometry first:

- The model registry (real `registerModel()` calls, first real preload list)
- GLB loading (or procedural fallback if assets aren't ready yet — the whole
  point of the registry)
- Drag-and-drop picking items off a 3D surface
- Touch input (the same `input/touchInput.js` primitives, extended to 3D)
- Snapping items into tray slots
- Handedness / grabbing from either side of the supply stand
- Correct vs. incorrect item selection (gloves/tourniquet/alcohol/needle/
  holder/gauze/bandage/sharps bin — same set `steps.js`'s `gather()` already
  enumerates)
- Tube pull order interaction with the *existing* tube rack (already 3D and
  pickable)
- Shared procedure state (`venipuncture/procedureState.js`'s `gather` step
  def, unchanged — only the *rendering* of that step changes)
- The 2D fallback stays selectable as an accessibility mode, consuming the
  exact same procedure state

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

| Step | Today | Becomes |
|---|---|---|
| gather | tap 8 emoji buttons | pick real items off the supply stand into a real tray |
| tourniquet | drag a 🎀 div | drag a real band up the arm; snaps 3–4″ above the site |
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
