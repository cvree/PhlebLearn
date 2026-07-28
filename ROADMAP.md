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
| Patient | Cylinder body + sphere head, hair/glasses/beard variants (`world/patient.js`) in the room. In the draw close-up, a real arm with real vessels (`venipuncture/arm/`) |
| Real pickable objects | 13 rack tubes, sharps bin, monitor, patient, mascot, sticker book — via raycast `input/raycasting.js` → `main.js`'s dispatch |
| Venipuncture (`venipuncture/`) | 16–17 steps (tube-count dependent). `gather` is a real 3D supply cart (`staging/`), `tourniquet` is a real band on a real arm (`arm/` + `tourniquet/`), `palpate` is a fingertip on that arm (`palpation/`), `clean` is a scrubbed prep field on it (`cleaning/`), `assemble`/`uncap` are one real needle-and-holder unit built at the bench beside it (`assembly/`), and `insert` is a real anchor and a real stick on that same vein (`insert/`); the other 9 are still 2D DOM. Driven by a typed procedure-state + explicit clinical-rule gates, with a step-implementation registry that lets one step at a time become physical |
| State machine | Same 13 screen states through `ui/panels.js`'s `go()`, each rewriting `panel.innerHTML` |

**The gap that remains:** 9 of the 16 venipuncture steps are still the 2D DOM
panel. Supply staging (Phase 1a) proved the object-interaction pipeline end to
end; the tourniquet (Phase 2a) added the arm every remaining step needs and the
first mechanic where the patient's body answers back; palpation (Phase 2b) is
the first where the learner has to interpret what the body is telling them;
cleaning (Phase 2c) is the first where the work itself is visible on the skin
and can be undone by carelessness; the needle-and-holder unit (Phase 2d) is the
first where one step's technique physically determines the next step's problem;
anchor and insert (Phase 2e) is the first where a mistake becomes irreversible
the instant the skin is broken. Each branch after it converts one more step, in
order, on that same arm.

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
  removes it.
- **Owning the work area.** The tray itself is draggable and carries everything
  on it, so the learner arranges their bench where they actually want it (it
  won't park on top of the patient's arm). The coach panel collapses so the
  cart gets the whole canvas, and a draw can be left early if it has gone wrong.

**Teaching mode and a scored shift are different mechanics, not the same one
with hints turned down.** Teaching mode keeps the readiness checklist, names the
expected order of draw, explains why a staged item is wrong the moment it lands,
and will not let the draw start from a bad tray. A scored shift shows an
inventory instead of verdicts, says nothing about what's wrong, and lets the
learner begin whenever they judge themselves ready — the assessment arrives
after the patient, naming exactly what they started the draw without.

Delivered alongside: the first real `registerModel()` calls (13 ids, all with
procedural fallbacks), a persistent `encounterState` carried through the whole
draw, a `supplyStaging` scoring category that reports actual measurements, a
portrait cart layout for phones, an accessible list view driven by the *same*
rules and measurements, 31 unit tests and 12 browser tests.

Deliberately chosen as the first converted interaction (before the arm/veins)
because it proves the whole object-interaction pipeline — registry → mesh →
pick → drag → zone → shared state → rules → measurement → feedback — without
needing new anatomy geometry first. Every branch below reuses it.

## Phase 1b — The real arm ✅ complete (with `feature/real-tourniquet`)

- A proper 3D arm — hand, forearm, antecubital fossa, upper arm — resting on the
  chair armrest, built procedurally in `venipuncture/arm/`.
- **Real vein geometry** under a translucent skin layer: median cubital, cephalic,
  basilic — plus a pulsing brachial artery, a tendon and the median nerve as real
  hazards, every one of them at a real depth below the surface.
- Skin tone and build driven by the existing `SKIN_TONES` / `makeAppearance()`.
- `makeSiteScenario(dl)` stops being labels and becomes **geometry**: a "deep veins"
  patient has vein polylines that genuinely sit further under the skin, a
  dehydrated one has narrower ones. `drawArmFor()` carries that out as data.
- A close-up scene (`arm/armScene.js`) framing the whole limb, reused by every
  branch from here on.

**The one piece of maths worth knowing about** is `pointerToLimb()`. Manipulating
a limb is cylindrical — where along it, how far round it, how far off it — so the
pointer is converted into exactly those numbers. The catch is that a camera
square-on to an arm has its view direction *inside* the limb's cross-section
plane, so that circle is seen edge-on and near side and far side land on the same
pixels: which side of the arm your hand is on is simply not in the picture. The
scene camera is therefore yawed along the arm (`CAM_YAW`), which gives the
cross-section area on screen and makes the angle solvable exactly, with one 2×2
inverse. Where that still cannot help — round the hidden underside — the code
measures what honestly is visible (contact with the skin, distance travelled)
rather than inferring an angle that is not there.

## Phase 2a — `feature/real-tourniquet` ✅ complete

The `tourniquet` step no longer exists as a 🎀 div dragged into a glowing box.
It is a real band applied to the real arm above, as one continuous gesture, and
then it **stays on the patient** — the same strap, carried on the encounter,
until the release step takes it off.

What it teaches, mechanically rather than by quizzing:

- **Position.** Where you take the band round the arm is where it ends up,
  measured in metres from the antecubital fossa and reported in inches. 3–4″ is
  the window; too low is *blocked* (it is inside the field you are about to
  clean and the hub will foul on it), too high is a warning (the veins fill
  less well).
- **Direction.** A band passed *underneath* the limb stays against the skin the
  whole way round. One carried clear of the arm has been draped across the top
  — a different, blocked application.
- **Tension, judged by watching the arm.** Pull is a real distance, and there is
  no meter in a scored shift. The veins physically swell — vertex displacement
  along each vessel's own normals, so they bulge and lift toward the skin — and
  the learner reads *that*. Overshoot and the model turns back on itself: the
  hand visibly blanches, the radial pulse cannot be found, and the veins
  collapse again, because arterial inflow has stopped.
- **Sequence, with a real consequence.** Let go before the loop is tucked and
  the band springs off and has to be re-applied; the time it was already on the
  arm still counts.
- **Which way the tail points.** Tucked up the arm it is clear; tucked toward
  the site it lies across the skin about to be cleaned — blocked.
- **The clock.** It starts when the band holds, runs through every step that
  follows, and the sample hemoconcentrates as it does: past a minute the veins
  themselves start to fall back.
- **Error recovery.** Pull the tail and the band comes off, on the arm, without
  leaving the patient — the same one-handed release the procedure uses later.

Teaching mode will not start a draw on a band that is wrong and says which of
those it is. A scored shift shows the arm and the clock and nothing else, lets
the learner commit, and reports the measurements afterwards.

Delivered alongside: `venipuncture/arm/` (Phase 1b, above), a persistent
`tourniquetState` on the encounter, a `tourniquet` measurement category
reporting real inches and seconds, an accessible control path that writes the
same state through the same functions, 101 unit tests and 21 browser tests.

## Phase 2b — `feature/tactile-palpation` ✅ complete

The `palpate` step was four buttons, one of them helpfully labelled
"(pulsing)". That is a reading-comprehension question. It is now a fingertip
pressed into the same arm, with the same band still on it raising the same
veins, and **nothing on screen is named until it has been felt**.

- **Pressure is a real quantity.** It builds while the finger is held still and
  eases off the moment it slides, so the learner feels one spot at a time
  rather than stroking the arm. Press too hard and the vein under the finger
  is squashed flat and disappears — which is its own lesson.
- **What comes back depends on what is under it.** A vein gives and springs
  back. A compliant one slides sideways out from under the finger — real
  displacement, so it has to be chased. The artery pushes back rhythmically.
  The tendon does not give at all. The median nerve is only ever felt as the
  patient flinching.
- **Depth matters.** The brachial artery runs ~10 mm down: a light touch over
  it feels of nothing in particular and only a firm press finds the pulse. A
  "deep veins" patient's veins genuinely need a firmer press than a normal
  one's, because they are genuinely further down.
- **Committing is separate from feeling.** You cannot mark a vein you never
  palpated — picking the right one by eye is caught and blocked. Feel it, take
  your hand off the arm, then mark the spot.
- **Recognising the artery is scored on its own.** Pressing something pulsing
  and moving off it is recognition; pressing it and carrying on is a miss,
  even when the vein eventually chosen was the right one.

The coach reports the SENSATION and never the conclusion. Teaching mode names
a structure only once it has been felt; a scored shift never names one at all.
The accessible path presses *unnamed places on the arm* — "across the bend of
the elbow, centre" — rather than offering a list of veins to pick from, which
would be the old multiple-choice question wearing a different hat.

Delivered alongside: 28 unit tests and 15 browser tests.

## Phase 2c — `feature/aseptic-site-cleaning` ✅ complete

The `clean` step measured how far a 🧽 had been dragged. Distance is not the
skill. It is now an alcohol pad worked over the site the fingers just found,
and **the coverage is painted onto the skin as it happens** — the visible wet
patch IS the measurement, not a decoration of a progress bar.

- **Coverage, not distance.** A 5 cm prep field around the puncture point,
  scored on a real grid. Dabbing the middle leaves the skin the needle passes
  through undisinfected, and it is blocked.
- **Direction.** Concentric circles worked OUTWARD. Scrubbing back over skin
  already cleaned drags the dirty edge inward, and is measured as the fraction
  of travel that moved away from the puncture point.
- **Friction, not painting.** Alcohol disinfects mechanically. Strokes made
  without working the pad into the skin cover nothing.
- **A real drying clock.** Thirty seconds of air-drying, gated: puncturing
  through wet alcohol stings and haemolyses the sample. The decal fades as it
  evaporates, so the arm itself tells the learner to wait. Fanning or blotting
  is its own mistake.
- **It can be undone.** Touching the site after it is clean — with a finger or
  with the swab — re-contaminates it and blocks the draw until it is redone.
- **A sealed pad cleans nothing**, however hard it is scrubbed.

Delivered alongside: 22 unit tests and 11 browser tests.

## Phase 2d — `feature/needle-holder-assembly` ✅ complete

Two steps, one object. `assemble` was a div dragged within 90 pixels of
another div; `uncap` was a third, unrelated div dragged 50 pixels to the
right. They are now **one unit, built at the bench beside the patient while
the site the fingers found air-dries in the same frame** — and the unit the
first step threads together is the unit the second step uncaps.

- **The bench is not the limb, on purpose.** Everything on the arm goes
  through `pointerToLimb()`'s cross-section solve and carries its front/back
  ambiguity. A bench is a known horizontal plane, so a pointer ray crossing it
  gives one exact world point (`pointerToPlane`). Alignment, turns and cap
  travel are measured in real metres and real degrees with nothing inferred.
  `fitCamera()` grew an optional `focus`, so the same scene frames the bench
  without moving the pitch or the yaw that make the limb solvable.
- **Sterility is a place, not a checkbox.** The pouch is opened by dragging
  along its seam; wander off it and the pack is torn, not peeled. The needle
  is picked up wherever you actually grab it, and the grey sleeved end — the
  end that goes inside the holder and into every tube — contaminates it. A
  contaminated needle is blocked no matter how well it is subsequently
  threaded, and taking a fresh one is the recovery, counted.
- **Alignment decides everything, once.** The needle is carried by the point
  it was picked up at and points the way it is being carried. More than 12°
  off the hub's axis when the threads meet and it cross-threads: it binds at
  three-quarters of a turn and forcing it gets nowhere. The way out is to back
  it right off and line it up — which is the way out in life.
- **Turns are turns.** Threading is a circular drag around the hub, counted as
  real revolutions. Under two and the unit leaks vacuum and unseats during a
  tube change (blocked); past four and a half the hub is over-torqued and will
  not come apart for disposal (warned). Finger-tight is about 2.5.
- **The bevel's angle is inherited from the threading.** This is the piece
  that makes the two steps one mechanic: a multi-sample needle screws in, so
  where the bevel points when you stop turning is wherever the thread stopped.
  Stop at 2.5 turns and it is exactly upside down. The uncap step then has to
  find that out and roll the holder until the opening faces up.
- **The sheath comes off along an axis.** The pull is scored as the fraction
  of travel that went along the needle. Lever it sideways more than 4 mm and
  the shaft bends and the cutting edge turns over — and a barbed needle drags
  going in and haemolyses the sample. Holding still on the holder leans in for
  a close-up of the tip, which is the only way a barb is ever caught.
- **Where the sheath goes down matters.** On the tray, fine. On the floor,
  warned. On the field that was just disinfected, blocked — and it calls
  straight back into the cleaning state and re-contaminates it. Dragged back
  onto the needle it is a hand recap, which is blocked outright.
- **The patient gets told**, and the timing is measured — a warning given a
  minute early is not a warning.
- **What was staged turns up in the hand.** A split pouch or a 25G chosen back
  at the supply cart is discovered here, physically, rather than as a line in a
  report afterwards.

Deliberately left for `feature/tube-collection`: pre-seating the first tube to
the holder's guideline. Pushing past the line pierces the stopper and kills the
tube — a real and classic error, but it is a tube-handling lesson and it
belongs with `fill` and `switch`, not here.

Delivered alongside: `venipuncture/assembly/`, a persistent `needleUnit` on the
encounter, `assembly` and `uncap` measurement categories reporting real turns,
degrees and millimetres, an accessible control path that writes the same state
through the same pure helpers, 35 unit tests and 19 browser tests.

## Phase 2e — `feature/anchor-and-insert` ✅ complete

The last of the sixteen steps to be a screen-space drag. The old `insert` read
`atan2(dy,dx)` off raw pixels and dropped a syringe sprite onto a target box.
It is now two sequential real gestures on the vein palpation marked, with the
unit assembly built and uncap uncapped — anchor the skin, then carry the
needle in and advance it by feel until the flash confirms the tip is where it
should be.

- **Anchor is a real technique, not a checkbox before the "real" step.** The
  off hand presses an inch or two below the marked site and pulls the skin
  taut — a real distance, judged the same way the tourniquet's tension is.
  Too close and the thumb is in the needle's path; too far and the traction
  barely reaches; pull the wrong way and it is not anchored at all. It can be
  redone right up until the skin is broken.
- **An unanchored compliant vein rolls clear of the approaching tip** — the
  exact displacement palpation already models under a fingertip
  (`rollOffset()`), run back through the same formula and scaled down as real
  traction is applied. The median cubital barely rolls, which is *why* it is
  the first-choice vein; a more compliant one genuinely needs the anchor to
  be hit reliably.
- **The angle is a real 3D quantity, derived without ever trusting a live
  position far from the arm.** armScene's own solves (`pointerToLimb`,
  `pointerToLimbSurface`) are only accurate near the skin — held at arm's
  length they degrade exactly the way their own doc comments warn. So the
  needle's approach instead fixes a small local basis, ONCE, by projecting
  three exactly-known world points (a ready pose, a 10mm step along the arm,
  a 10mm step off it) through `toScreen()` — forward projection has no
  ambiguity to begin with. Every raw pointer position is then solved against
  that fixed basis by the same 2×2 inverse `pointerToLimb` itself uses, just
  evaluated against exact references instead of a continuously re-seeded live
  one. 15–30° is the window; flatter skates over the vein, steeper drives
  through it.
- **A flash needs BOTH position and depth, checked together.** The first cut
  of this rule checked them separately — a stick nowhere near the vein could
  still read as "in" it purely because the depth number happened to line up
  for *some* vessel. `isTrueFlash()` requires the entry to be laterally on
  the vessel's own path *and* the depth inside its wall-to-wall band before
  anything lights up.
- **Depth is never shown, only reported** — continuing to advance past the
  entry converts along-arm travel to depth by the locked angle's own
  trigonometry, exactly as far as the geometry allows and no further, because
  a bedside view cannot see under the skin either. Advance too far and it is
  a through-and-through; pull all the way back out and the entry clears for a
  genuine second attempt, counted.
- **The bevel rides forward from uncap.** Left un-rolled, it blocks an
  otherwise perfect stick — the one mistake in this whole procedure that only
  becomes irreversible the moment the skin is broken.

Delivered alongside: `venipuncture/insert/`, `insert` measurement category
reporting real degrees, millimetres and a flash timestamp, an accessible
control path exercising the identical pure state helpers, 28 unit tests and
16 browser tests.

## Phase 2 — Real instruments

Each step converts from DOM widget → 3D interaction, reusing the existing raycaster.
The DOM panel stays as the **coach layer** (tips, why-it-matters, teach mode) — it
stops being the interaction surface.

Branch order (one branch each, verified and deployed before the next starts):
~~`feature/real-tourniquet`~~ ✅ → ~~`feature/tactile-palpation`~~ ✅ →
~~`feature/aseptic-site-cleaning`~~ ✅ → ~~`feature/needle-holder-assembly`~~ ✅ →
~~`feature/anchor-and-insert`~~ ✅ → `feature/tube-collection` →
`feature/withdraw-safety-sharps` → `feature/post-draw-care`.

| Step | Today | Becomes |
|---|---|---|
| gather | ✅ **done** — a real supply cart | — |
| tourniquet | ✅ **done** — a real band on a real arm | — |
| palpate | ✅ **done** — a fingertip on the real arm | — |
| clean | ✅ **done** — a scrubbed field on the real arm | — |
| assemble | ✅ **done** — a real needle threaded into a real holder | — |
| uncap | ✅ **done** — the sheath pulled along the needle's own axis | — |
| insert | ✅ **done** — a real anchor, a real angle, a real flash | — |
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
