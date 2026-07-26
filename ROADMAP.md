# Tiny Vials — Gameplay Upgrade Roadmap: "Real Objects"

**Goal:** move the venipuncture skill practice out of the 2D emoji panel and into the
3D room, so the player handles real instruments on a real arm.

Live: https://cvree.github.io/PhlebLearn/ · Pages: legacy build, `main` branch, root path.

---

## Where the code stands today

| Thing | Reality |
|---|---|
| `phlebshift3dlab.html` | 3,888 lines / 1.07 MB — **line 992 alone is 810 KB of base64 MP3** (76% of the file) |
| Renderer | three.js **r128** global build (2021) from CDN, plus `examples/js/GLTFLoader` |
| Other libs | GSAP 3.12, Lenis, Vanta fog — all CDN, all with `onerror` fallbacks |
| 3D room | 100% hand-built primitives (`box`/`cyl`/`sph` helpers). Desk, chair, supply stand, tube rack, sharps bin |
| `MODELS = {}` (line 1888) | **Empty.** `loadModel()` helper already written and unused — a hook left for real assets |
| Patient | Cylinder body + sphere head, hair/glasses/beard variants. **No arms at all** |
| Real pickable objects | 13 rack tubes, sharps bin, monitor, patient — via raycast `handlePick` → `onPick` |
| Venipuncture (`VP_STEPS`, L3008–3402) | 17 steps, **all 2D DOM**. `.vp-arm` is a 132px CSS div; tourniquet is 🎀, needle is 💉, swab is 🧽 |
| State machine | 13 states through `go()`, each rewriting `panel.innerHTML` |

**The gap:** the 3D room is scenery. The actual learning happens in a flat panel with
emoji. Everything below closes that gap.

---

## Phase 0 — Foundations (unblocks everything else)

0.1 **Evict the audio blob.** Move the base64 lobby track to `assets/lobby.mp3`.
    File drops 1.07 MB → ~260 KB. Every subsequent diff becomes readable.

0.2 **Split the monolith** into `index.html` + ordered `js/` files (scene, room,
    patient, venipuncture, economy, ui). No build step — Pages stays static.

0.3 **three.js r128 → modern ESM + importmap.** Only 66 `THREE.*` call sites, so this
    is a contained migration. Buys us a maintained `GLTFLoader`, DRACO/KTX2, and
    better materials. r128's `examples/js` loader path is the most fragile dependency
    in the file.

0.4 **Asset pipeline.** Fill the `MODELS` registry, upgrade `loadModel()` with a
    preloader and a **guaranteed fallback to the existing primitive builders** — a
    404'd GLB must never break the game.

0.5 **Deploy guardrail.** A `?selftest=1` boot mode plus a Playwright smoke check that
    runs before anything merges to `main`, since Pages serves `main` root directly.

## Phase 1 — The real arm (highest impact)

- A proper 3D forearm attached to the patient, resting on the chair armrest.
- **Real vein geometry** under a translucent skin layer: median cubital, cephalic,
  basilic — plus a pulsing brachial artery and a tendon as real hazards.
- Skin tone driven by the existing `SKIN_TONES` / `makeAppearance()`.
- `makeSiteScenario(dl)` stops being labels and becomes **geometry**: deep veins sit
  lower, rolling veins physically slide under pressure, small veins are thinner.
- New `tweenCamera` "draw close-up" preset docking over the antecubital fossa.

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
- Ship phase by phase to `main`; Pages rebuilds; verify the live URL each time.

---

## Open decisions

1. **Model source** — procedural primitives (matches the cozy look, zero deps) vs.
   authored/generated GLB assets.
2. **three.js upgrade** — now (Phase 0) or stay on r128 and defer the risk.
3. **File structure** — split the monolith or keep one file.
