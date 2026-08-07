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
| Venipuncture (`venipuncture/`) | 16–17 steps (tube-count dependent). `gather` is a real 3D supply cart (`staging/`), `tourniquet` is a real band on a real arm (`arm/` + `tourniquet/`), `palpate` is a fingertip on that arm (`palpation/`), `clean` is a scrubbed prep field on it (`cleaning/`), `assemble`/`uncap` are one real needle-and-holder unit built at the bench beside it (`assembly/`), `insert` is a real anchor and a real stick on that same vein (`insert/`), `fill`/`switch` are real tubes filled by a real vacuum off a real rack (`collection/`), and `release`/`withdraw`/`safety`/`dispose` are the same band pulled off by its tail, the same needle drawn back out along its own entry line, that device's own safety shield, and the whole unit carried into a real sharps container (`withdrawal/`), `pressure`/`bandage` are a real force held on the real puncture and a dressing that waits for haemostasis (`postdraw/`), and `invert` is each filled tube turned end over end to its own additive's count (`inversion/`). **All 16 are physical**; the 2D `VP_STEPS` survive as the accessibility fallback. Driven by a typed procedure-state + explicit clinical-rule gates, with a step-implementation registry that let one step at a time become physical |
| State machine | Same 13 screen states through `ui/panels.js`'s `go()`, each rewriting `panel.innerHTML` |

**Every phase on this roadmap is complete.** Step conversion finished in
Phase 2; the five assessment-phase branches landed — the 0–4 rubric and its
configurable policy, the three separated game modes, the practical report with
session replay, the introduction-and-identification step that was the last
rubric row with no instrumentation, and the butterfly/dorsal-hand draw that
makes venipuncture a choice between two genuinely different procedures rather
than one animation with a different model.

**Phase 3b then made the draw able to go wrong**, Phase 4 made the shop able
to change what a draw IS, and Phase 5 shipped it. The game is feature-complete
against this roadmap; what remains open is listed honestly at the bottom of
Phase 5.

👉 **`docs/HANDOFF.md`** still holds the reasoning behind each of those five
assessment branches and the conventions and testing traps that outlive any one
of them (including that this machine's headless renderer crashes under load and
those failures are not real).

Supply staging (Phase 1a) proved the object-interaction pipeline end to
end; the tourniquet (Phase 2a) added the arm every remaining step needs and the
first mechanic where the patient's body answers back; palpation (Phase 2b) is
the first where the learner has to interpret what the body is telling them;
cleaning (Phase 2c) is the first where the work itself is visible on the skin
and can be undone by carelessness; the needle-and-holder unit (Phase 2d) is the
first where one step's technique physically determines the next step's problem;
anchor and insert (Phase 2e) is the first where a mistake becomes irreversible
the instant the skin is broken; tube collection (Phase 2f) is the first where
the learner's hands have to do one thing while deliberately not disturbing
another, and the first where some errors can be put right and some genuinely
cannot; withdraw/safety/sharps (Phase 2g) is the first where the danger stops
being to the specimen and becomes a danger to the person holding the needle,
and the first whose interactions are dispatched from the state of the arm
rather than from which step is running; pressure and bandage (Phase 2h) is the
first where the quantity being controlled is a FORCE rather than a position,
and the first where the patient's own body is still changing after the
procedure is technically over; and tube inversion (Phase 2i) is the last step to
convert, and the first where the thing being judged is no longer the patient at
all but the specimen in the learner's hand. Complications (Phase 3b) are the
first thing in the game that happens while the learner is doing something else,
and the first whose measurement finishes when the DRAW does rather than when
any step does.

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
belongs with `fill` and `switch`, not here. (Phase 2f delivered it, in the
place it actually bites once the needle is already in: a stopper pierced with
the tip out of the vein spends its vacuum on air, and a tube parked at the
guideline instead keeps it.)

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

## Phase 2f — `feature/tube-collection` ✅ complete

Two more steps, one object again. `fill` was a CSS height animation with a
"stop at the fill line" button; `switch` was a row of divs dragged onto
another div. They are now **tubes taken off a real rack and pushed onto the
holder that is already in the patient** — and the needle whose position they
disturb is the needle the insert step put in.

- **The guideline is a technique, and it earns its place three times over.**
  A tube pushed into the holder passes it before the rear cannula reaches the
  stopper. Short of it the tube is held, positioned, and still sealed;
  past it the vacuum is open onto whatever is at the needle's other end —
  blood if the tip is in the vein, and *air and nothing at all* if it is not,
  which finishes that tube for good. It is also where force starts to reach
  the patient: below the guideline the tube slides freely in the barrel, so
  simply bringing one up to the holder can never move the needle.
- **Where the hand goes is the whole thing.** A push made from the holder's
  **flange** is a couple — fingers pulling back as the thumb pushes forward —
  and about 8% of it reaches the patient. A push made by grabbing the tube's
  barrel has nothing to push against: the holder travels with the tube and the
  needle travels with the holder. Seating a tube that way drives the tip clean
  out of the lumen, and the flow stops. Which of the two the pointer went down
  nearest is the only difference between them.
- **Displacement is measured against the vein it is in**, not a fixed
  millimetre count — a big median cubital tolerates a shove that loses a
  narrow cephalic. Axial displacement undoes itself when the tube comes back
  off; a sideways lever does not, because the tip has been dragged across the
  lumen and taking your hand away does not put it back.
- **The vacuum does the work, and stopping is its decision.** Flow is real
  millilitres per second, from this vein's calibre, this needle's gauge, this
  patient's own filling and whether the band is still on. It stops when the
  tube's own draw volume is reached — 2.7 mL of citrate, 4.0 of EDTA — and the
  skill is *waiting for that* rather than judging a moment. Pull one off early
  and it is short.
- **A short citrate tube is wrong, not approximate.** The 9:1 blood-to-citrate
  ratio is fixed at manufacture, so an under-drawn light blue makes the PT/INR
  incorrect and is blocked for redraw; an under-drawn serum tube is a warning.
  Every tube carries its own required fraction.
- **Order of draw is a directional contamination between two named
  additives**, not a "wrong order" flag. Reach for the lavender first and EDTA
  goes through the same needle into the citrate tube behind it, and the coach
  says which additive and what it ruins.
- **What a second attempt can fix, and what it cannot.** A tube that came off
  short can be drawn again — another of the same kind, at the cost of the
  wasted one, and the step is not finished while that is still possible. A
  tube ruined by carryover cannot, because the additive is in the needle and
  a redraw through it would be ruined identically. Teaching mode therefore
  lets the learner move on from an irreversible mistake while still reporting
  it, instead of claiming a specimen was fine.
- **A vein pulled shut by a big tube's vacuum** stops flowing early, and the
  way out is real: back the tube off to the guideline to break the vacuum, let
  the vein refill, push it back on. Each cycle gets more.

**The geometry.** The rack is on the bench — a known plane, so `pointerToPlane`
gives one exact world point. The holder is a rigid body on the line the insert
step fixed when the skin was broken (entry point, locked angle, and the
along-arm direction the tip was travelling, which is now recorded on the
insert state rather than left on its runtime). A tube going on and coming off
is a hand held CLEAR of the limb — the one case none of armScene's three limb
readings handle — so it uses the same fixed-basis trick the needle's approach
does: three exactly-known world points projected once through `toScreen()`,
then the identical 2×2 inverse against that fixed frame. Nothing re-seeds and
nothing diverges, however far from the arm the hand is.

Delivered alongside: `venipuncture/collection/`, a persistent `collection` on
the encounter, a `collection` measurement category reporting real millilitres,
percentages of each tube's own volume, millimetres of needle displacement and
the band's seconds, an accessible control path exercising the identical pure
helpers (including its own "push it on by the tube alone", which fails exactly
as the drag does), 47 unit tests and 20 browser tests.

Still deliberately left for later branches: the tourniquet actually coming off
mid-collection belongs to `release`, and inverting the filled tubes belongs to
`invert`.

## Phase 2g — `feature/withdraw-safety-sharps` ✅ complete

Four steps, one object again. `release` was a "🎈 Release the tourniquet"
button; `withdraw` was two buttons in sequence; `safety` was a third button;
`dispose` was a div dragged onto a 🗑️. They are now **the end of the draw as
one continuous piece of work on the same arm** — the band being pulled off is
the strap the tourniquet step secured, the needle being drawn out is the needle
the insert step put in, and the container it lands in is the one the learner
positioned back at the supply cart.

- **The band comes off by its own tail.** The tucked loop is drawn from the
  same `tourniquetState` the tourniquet branch wrote, at the side the learner
  actually tucked it, and one real pull on it releases the band — the same
  one-handed gesture that step already used for error recovery. The clock it
  stops is the clock that step started, accumulated across every
  re-application, not a timer this screen invented.
- **Reaching across a patient is done with a needle in their arm.** Straying
  the free hand over the holder while going for the tail jostles the tip, and
  the displacement is measured against the vessel's own calibre — the same
  physics the tube changes use, so a big median cubital tolerates what a
  narrow cephalic does not. It is a level, not a running sum: a later smaller
  wobble cannot shrink the record.
- **Gauze is a position, not a checkbox.** The pad is carried off the bench
  and rested above the puncture; how far from it, in real millimetres, is
  what decides whether pressure can start the instant the tip is out. A
  *second* push on an already-resting pad — the pointer driven well inside
  the limb's silhouette — is pressing down on a needle that is still in the
  vein, which drags the bevel through the wall it entered. The first carry
  legitimately passes over the arm and is not mistaken for that.
- **The needle leaves along the line it entered.** The exit line is the one
  the insert step fixed when the skin was broken — entry point, locked angle,
  `depthDir` — and outward travel shallows the tip by that angle's own
  trigonometry, the same conversion insert used going in. Deviation from that
  line is reported in degrees, sideways excursion in millimetres and the exit
  in centimetres per second: a yank and a saw are two different findings, and
  neither is a boolean.
- **The safety is the device's own mechanism.** A straight needle's shield
  travels forward over the shaft until it locks; a butterfly's slider
  retracts the needle into its body. The shield is a real mesh the pointer
  slides, and stopping short does not lock — a shield that has not clicked is
  one that slides back. Locking it is timed from the moment the tip left the
  skin, because "immediately" is a measurement.
- **The three classic needlestick stories are each recorded as themselves.**
  Dragging the unit down onto the bench and pushing activates the shield
  against a surface; putting an exposed used sharp down is its own event;
  recapping by hand is a third. All three are blocking, and none of them is
  the same finding as the others.
- **Where the sharp physically goes.** The whole unit is carried into a real
  container and has to pass the aperture, not rest in its mouth. The ordinary
  waste bin refuses it and counts the attempt — and the recovery stays open,
  because the sharps container still completes the step. Carrying it *back*
  across the patient after having got clear of them is a routing finding; the
  carry necessarily starts over the arm, so that first moment is not counted.
- **The four ids are one piece of work, so the gestures follow the arm, not
  the screen.** Both the pointer's hit-testing and the accessible controls are
  built from the state of the arm rather than from which step is running: a
  band still on the patient stays grabbable in the withdraw step, and a needle
  still in the vein stays withdrawable in the safety step. Gating on the step
  id instead would leave a learner who got the order wrong with no way back —
  which is exactly the learner who most needs one.

**The geometry.** The holder is the same rigid body on the same fixed line
collection derived, and withdrawing it is travelling OUT along that line —
a hand held clear of the limb, so it uses the fixed-basis technique for the
third time: three exactly-known world points projected once through
`toScreen()`, then the identical 2×2 inverse. The shield slide reuses the same
solve against the unit's own axis wherever it is being held. The gauze and both
containers sit on the bench, a known plane, so `pointerToPlane` gives one exact
world point per carry. The bases are rebuilt on every reframe, never lazily.

Delivered alongside: `venipuncture/withdrawal/`, a persistent `withdrawal` on
the encounter, a `withdrawal` measurement category reporting real seconds on
the band, real exit degrees, real millimetres of drag and real seconds of
exposed sharp, critical safety events recorded separately from the numeric
score, an accessible control path exercising the identical pure helpers
(including its own recap, set-down and strike-the-bench, which fail exactly as
the drags do), 38 unit tests and 15 browser tests.

## Phase 2h — `feature/post-draw-care` ✅ complete

Two steps, one patient. `pressure` was a hold-to-fill button wired to a 1.2
second timer; `bandage` was an "Apply bandage" button gated on it. They are now
**a pad pressed into the same arm hard enough to actually close the vein, for as
long as this puncture and this patient genuinely need, and a dressing put on
once the learner has looked and seen it stop.**

- **Pressure is a MAGNITUDE, and that is the whole lesson.** Below the
  adequacy band the vein is not occluded, so the clock runs with *nothing
  happening* — a light pad makes no progress at all rather than slow progress,
  and the site goes on leaking underneath it the entire time. Above the
  comfort threshold it hurts, and it does not clot any faster for it.
- **The force is a real reading, not a slider.** How far the pointer is driven
  from the skin toward the limb's axis IS how hard the pad is pressed. Both
  reference points are exactly-known world points projected forward through
  `toScreen()`, and the basis is frozen when the press begins — an earlier cut
  re-projected it every move, and since the coach panel resizes the moment
  pressure starts, `fitCamera` re-framed and silently re-scaled the force under
  a stationary hand. The camera now refuses to re-frame at all while a hand is
  on the arm.
- **A patient on anticoagulants genuinely needs longer.** That comes from
  explicit `anticoagulated` trigger data on the patient's own event — never
  from matching the words "blood thinners" in their dialogue — and it very
  nearly doubles the hold. The same press that works on a normal patient
  visibly does not finish on this one.
- **The flexed elbow, which is the classic.** The patient's hand can be dragged
  up, because that is what learners suggest and what patients do unprompted,
  and it holds the puncture open: the fascia takes the pressure instead of the
  vein, the clot makes no progress, and the site bleeds *faster*. Straightening
  the arm recovers it.
- **Haemostasis is found out by looking.** Taking the hand off the pad IS
  lifting the gauze to check, and what it shows is whatever is actually true.
  Look too early and there is blood — and the peek itself costs a third of the
  progress, so peeking repeatedly is genuinely slower than holding on. The
  step will not finish on a site that was never actually looked at.
- **The blood goes somewhere.** Every second uncovered or under-pressed
  extravasates real millilitres, painted onto the skin as a spreading bruise
  and soaking visibly through the pad. Past a threshold it is a hematoma, and
  that blocks.
- **The dressing's alignment and tightness are the gesture's.** Dragged
  squarely over the puncture or not; how far it is then pulled down onto the
  limb is how tight it ends up, measured from the shallowest point of the
  approach rather than absolutely (the carry starts down at the bench, so an
  absolute reading made every dressing a tourniquet). Too tight is refused and
  can be taken off and redone, counted.

Delivered alongside: `venipuncture/postdraw/`, a persistent `postDraw` on the
encounter, a `postDraw` measurement category reporting mean and peak force
against this site's own band, effective versus required seconds, pressure
consistency as a real coefficient of variation, millilitres extravasated and
the dressing's millimetres and tension, an accessible control path exercising
the identical pure helpers (including its own too-light, too-hard, off-site and
bend-the-arm, which fail exactly as the drags do), 35 unit tests and 18 browser
tests.

Both the gestures and the controls are again built from the state of the arm
rather than the step id, so a site that starts bleeding again is pressable from
the bandage step.

## Phase 2i — `feature/tube-inversion` ✅ complete

The last of the sixteen. `invert` was a row of buttons you tapped six times
each, with a counter that went up. Tapping is not mixing, and six is not the
answer for any particular tube. It is now **each tube the collection step
actually filled, picked up off the rack one at a time and turned end over end
as many times as its own additive requires.**

- **The count belongs to the additive, not to the step.** EDTA needs eight,
  sodium citrate four, a clot-activator tube five — and a plain red tube must
  NOT be inverted at all, because it has to sit still and clot undisturbed.
  Inverting it is a blocking error rather than a harmless extra, and there is
  no "invert" control offered for it. The requirements live in one table in the
  rules file, so a school with a different protocol changes a number.
- **An inversion is over AND back, through two gates.** Past 150° is over;
  back under 30° completes one. The gap between those is what makes rocking
  physically distinct from mixing: a hand oscillating in the middle never
  crosses either gate, so it accumulates hundreds of degrees of travel and
  zero inversions — which is exactly what rocking a tube achieves.
- **The blood slumps to whichever end is down**, so the learner can see the
  additive at the closed end actually being reached. A tube that never goes
  over never moves its contents past the middle.
- **Shaking haemolyses, cumulatively and irreversibly.** Speed is real degrees
  per second; past the threshold it shears red cells, and mixing it beautifully
  afterwards does not give the specimen back. A haemolysed tube is a false
  potassium and a false LDH — rejected, not merely imperfect.
- **Additive only works if the blood reaches it in time.** Each tube's delay is
  measured from the moment it genuinely came off the holder, so a tube left on
  the bench and then mixed perfectly is still full of micro-clots — and past a
  further threshold it has clotted and needs a redraw. A clotted tube does not
  hold the step open, because nothing the learner does now can fix it.
- **What collection left behind comes with it.** A short draw or an
  additive-carryover tube arrives here still short and still contaminated;
  this step judges the MIXING and does not pretend to repair the draw.

**The geometry.** Nothing here touches the limb, so none of armScene's limb
solves are involved: the rack is on the bench, a known plane, so
`pointerToPlane` is exact for picking a tube up. The turn is the one new
reading and deliberately the simplest honest one — turning a tube over is a
rotation IN the image plane, so the tilt is just the pointer's angle about the
hand, with nothing inferred.

Two bugs worth recording, both found by the tests rather than by reading:
**carrying a tube is not turning it** — the carry-to-turn switch originally
fired on a world distance while the pointer was still sweeping across the
canvas, so a tube arrived in the hand already 140° over, having "travelled"
280° at 970°/s; it now switches on screen proximity and SEEDS the tilt instead
of accumulating it (the tourniquet's precedent). And the interval between
pointer samples is itself a measurement here, so the runtime uses the wall
clock rather than a synthesised event's `timeStamp`.

Delivered alongside: `venipuncture/inversion/`, a persistent `inversion` on the
encounter, an `inversion` measurement category reporting each tube's own
required count against what it got, peak angle, peak degrees per second against
the shearing threshold, seconds of delay and a per-specimen verdict, an
accessible control path exercising the identical pure helpers (including its
own rock, shake and turn-it-very-slowly, which fail exactly as the drags do),
29 unit tests and 16 browser tests.

**All 16 physical steps are now real interactions.** The 2D `VP_STEPS` remain
as the accessibility fallback, exactly as intended — nothing was thrown away.

## Phase 2 — Real instruments

Each step converts from DOM widget → 3D interaction, reusing the existing raycaster.
The DOM panel stays as the **coach layer** (tips, why-it-matters, teach mode) — it
stops being the interaction surface.

Branch order (one branch each, verified and deployed before the next starts):
~~`feature/real-tourniquet`~~ ✅ → ~~`feature/tactile-palpation`~~ ✅ →
~~`feature/aseptic-site-cleaning`~~ ✅ → ~~`feature/needle-holder-assembly`~~ ✅ →
~~`feature/anchor-and-insert`~~ ✅ → ~~`feature/tube-collection`~~ ✅ →
~~`feature/withdraw-safety-sharps`~~ ✅ → ~~`feature/post-draw-care`~~ ✅ →
~~`feature/tube-inversion`~~ ✅ — **all sixteen steps converted.**

| Step | Today | Becomes |
|---|---|---|
| gather | ✅ **done** — a real supply cart | — |
| tourniquet | ✅ **done** — a real band on a real arm | — |
| palpate | ✅ **done** — a fingertip on the real arm | — |
| clean | ✅ **done** — a scrubbed field on the real arm | — |
| assemble | ✅ **done** — a real needle threaded into a real holder | — |
| uncap | ✅ **done** — the sheath pulled along the needle's own axis | — |
| insert | ✅ **done** — a real anchor, a real angle, a real flash | — |
| fill | ✅ **done** — a real tube filled by a real vacuum | — |
| switch | ✅ **done** — tubes off the real rack, braced against the flange | — |
| release | ✅ **done** — the real band's real tail, pulled free | — |
| withdraw | ✅ **done** — out along the line it went in, gauze ready | — |
| safety | ✅ **done** — the device's own shield, slid until it locks | — |
| dispose | ✅ **done** — the whole unit carried into a real container | — |
| pressure | ✅ **done** — a real force held on the real puncture | — |
| bandage | ✅ **done** — dressed once it has actually stopped | — |
| invert | ✅ **done** — each tube turned end over end, to its own count | — |

**Accessibility:** today's `VP_STEPS` survive as an opt-in **2D fallback mode** for
touch, low-end GPUs, and reduced-motion. Nothing is thrown away.

## Phase 3 — Assessment ✅ complete

Step conversion turned the measurements every step already produces into the
photographed 0–4 rubric, separated the three game modes, added the
butterfly/dorsal-hand draw, and built the report. `docs/HANDOFF.md` holds the
reasoning; this is the record of how each branch landed.

### ✅ `feature/rubric-policy` — the grading layer

`src/venipuncture/rubric/` — three pure modules and nothing else:

- **`policy.js`** is the only file with numbers in it. The five rubric rows and
  which measurement keys feed each, the 0–4 cut points, the excellence gates,
  the qualified critical-event codes (`withdrawal.recapAttempted`, not
  `recapAttempted`, because codes are only unique within a step module) with
  their automatic-failure flags, and the pass mark. Every value is a
  **documented default**, marked as ours rather than any programme's published
  policy — the brief is explicit that the real automatic-failure rules must not
  be invented.
- **`rubricRules.js`** — `scoreCategory()`. The arithmetic sets a *ceiling*;
  five gates decide whether the top band was *earned*: complete, independent,
  in sequence, inside every configured tolerance, free of warnings. A gate can
  only ever cost the 4. "Technically completed" is never automatically
  excellent.
- **`rubricReport.js`** — the whole result as serialisable data: procedure
  type, total against the pass mark, per-row evidence, the exact measured
  deviations, critical events, per-tube specimen results merged across
  collection and mixing, patient outcomes, strongest actions, and a practice
  plan prioritised automatic-failures-first.

The policy names measurement fields by *string*, so a typo would silently block
every Excellent rather than throw. `tests/rubric.spec.js` therefore builds each
measurement object from the **real step modules** and asserts every field the
policy references exists on it — plus the two guarantees the brief names by
name: an honest 4 is reachable, and above-and-beyond observations never add
score. 36 unit tests.

### ✅ `feature/three-modes` — Learn, Practice, Final Practical

One boolean (`MODE === "teach"`) could not express three modes that differ in
*what the learner is told while they work*, so `gameState.js` now owns a
three-way `MODE` and a `reveal()` descriptor every coach and panel reads:
`instruction`, `hints`, `verdicts`, `liveNumbers`, `gateContinue`,
`sectionFeedback`, `repeatSections`, `highlights`. The legacy `"teach"` and
`"play"` strings still normalise in, because the `?e2e=1` seam passes them.

- **Learn** — the existing guided path: teaching prose, the specific error, the
  correct next action, and a Continue button gated on being right.
- **Practice** — a standing reminder of what the step is *for* (never what is
  wrong with it right now), no gate, and feedback **at the end of each
  section**, which is then **repeatable**. `venipuncture/sections.js` groups the
  steps by technique so a section can be replayed: repeating clears that
  section *and everything downstream of it*, because the later sessions are
  built from the earlier ones.
- **Final Practical** — nothing. No teaching, no reminder, no gate, and no
  verdict.

**Every judgement in this app is expressed as colour**, so withholding the
verdict is done in one place — `src/styles/modes.css`, scoped to a
`data-verdicts="0"` attribute the panel sets from `reveal()` — rather than
duplicated through ten coaches' class expressions. `tests/modes.e2e.spec.js`
asserts it at the pixel: the same nodes with the same `good`/`bad` classes
render in one colour in the Final Practical and in several in Learn.

Bests are kept **per mode** (`game/modeProgress.js`, persisted on
`SS.modeProgress`): a 19/20 scored with the coach naming every error is not the
same achievement as one scored in silence, so they are never pooled.
27 unit tests, 8 browser tests.

### ✅ `feature/practical-report` — the result screen and the replay

`vpFinish()` now grades the attempt through the rubric layer in **every** mode,
because per-mode bests need the grade — but only the Final Practical is shown
the full report. Learn and Practice keep the chips they have always had, with a
compact rubric line under them: the report is the Final Practical's output, not
a replacement for in-line coaching.

`ui/reportView.js` renders and decides nothing; `rubricReport.js` decides and
renders nothing. That separation is what lets the whole report be asserted on
in a unit test without a browser, and what stops a grading threshold ending up
inside a template.

**Session replay** (`rubric/replay.js`) invents no new logging: every
`*State.js` has kept an `events[]` since it was written, and this merges them,
groups them by section, and shows each group against the measurement that
graded it. The one real trap is that **staging logs a relative clock and every
other module an absolute one** — merging them naïvely puts the whole supply-cart
phase in 1970. `normaliseEvents()` reconciles that once, rather than in whatever
renders the list, and a unit test holds it there.

Two deliberate honesty choices:

- **A Learn attempt can never claim an unaided Excellent.** Learn names the
  specific error and refuses to advance until it is fixed, so by definition no
  row was done unaided. The rubric's `assisted` gate says so out loud.
- **`gradeAttempt()` is idempotent.** `vpFinish()` is reachable more than once
  (a post-draw complication returns to it), and a second visit must not count a
  second attempt or claim a second personal best.

17 unit tests, 13 browser tests.

### ✅ `feature/introduction-and-id` — the row that had no instrumentation

The old first step was `hygiene`: two icons and a "Sanitize & glove up" button.
It is now `introduce`, and it is a **conversation the learner has to conduct**.

What is measured, and why each is a number rather than a tick:

- **Which identifiers were obtained, and HOW.** Every identifier has an open
  form and a leading form side by side — "Could you tell me your full name?"
  against "You're Jane Cooper, is that right?". The leading question *works*:
  the patient agrees, because patients do. That is precisely why it is
  dangerous, so it is **recorded, not refused** — `leadingQuestions` is a count
  on the measurement and `introduction.leadingQuestion` is a critical event in
  the policy. Fewer than two identifiers is `oneIdentifier`, an automatic
  failure by default.
- **What was already touched by the time the identity was settled.**
  `identifiedBeforeTouching` compares the moment the second identifier arrived
  with the moment the learner first handled the patient.
- **Hand hygiene as a duration.** `handHygieneSeconds` accumulates while the
  button is actually held, and the drying clock between finishing and gloving
  runs in real time. Rubbing again restarts the drying clock.
- **Gloves after gloving.** Answering the phone or pulling the curtain with
  gloves on contaminates them and blocks — and changing them is a real
  recovery, which is what a recoverable error is supposed to be.

**Clinical facts are trigger data, never text.** `patient.history` is three
booleans decided when the patient was generated —`latexAllergy`,
`adhesiveAllergy`, `faintHistory`. What the patient discloses when asked
follows those booleans; nothing anywhere reads a sentence to find out. A
learner who never asks about allergies and gloves up in the latex that is on
the tray by default gets `latexOnAllergicPatient`.

**Four files, not five.** Every other step has a `*Runtime.js` because it has a
scene. This one does not: what the learner manipulates is a conversation and a
sink. The rule that matters is unchanged — every technique is a pure helper in
`introductionState.js`, and both the held rub and the "rub for 20 seconds"
control call the same ones, which a unit test asserts.

31 unit tests, 12 browser tests.

### ✅ `feature/butterfly-hand-draw` — the second procedure

Until now there was one draw, and its numbers lived as module constants
scattered through the steps that used them. `src/venipuncture/procedure.js` is
what makes the dorsal-hand draw a genuinely different procedure rather than the
same animation with a different model: a single `procedureFor(id)` lookup —
device, site, gauge, angle window, anchor window, and (for the butterfly) a
tubing spec — that every consumer now reads through instead of branching on a
string. `indicatedProcedure(patient)` reads it off the patient's own trigger
data (a "dry", flat-vein arm, or a child), never off a mode flag.

- **The site is real geometry, not a relabelled fossa.** Four vessels — two
  dorsal metacarpals, the dorsal venous arch, an extensor tendon as a hazard —
  sit on the *same* cylindrical limb mesh's wrist-taper region the antecubital
  vessels already use, so every existing projection solve
  (`pointerToLimb`/`surfaceY`/`radiusAt`) works on hand geometry unchanged with
  zero new 3D code. Building actual hand-mesh geometry (new anatomy, new
  raycasting, a new camera frame) was scoped out as too large and too risky
  for one branch, in favour of reusing math already proven correct.
- **Wherever a step's interaction is centrally about vessel geometry**
  (tourniquet's clearance, palpation's vessel-choosing, insert's stick,
  collection's implicit "a needle is in this arm"), the hand draw forces the
  accessible controls-only path — there is no 3D drag, because there is no
  hand mesh to drag against. Cleaning, assembly, withdrawal and post-draw's 3D
  paths are untouched, since those interactions don't depend on which vessel
  set is active.
- **The window is narrower and the physics are different, not just relabelled
  numbers.** 23G, not 21G. 5–15° entry, not 15–30° — a 2mm hand vein sits
  under 1.5–2.5mm of skin, and the old 30° ceiling would put the tip in the
  metacarpal. The anchor is distal, firm, and much closer, because a hand is
  small.
- **The winged set has a tubing, and the tubing has consequences.** Slack
  absorbs the first part of any pull on the line; taut, it transmits fully.
  Securing the wings with tape before touching the tubes cuts what reaches the
  tip by roughly 9×. Carrying the set by its tubing instead of its wings is a
  real, selectable — and scored — mistake, fixed permanently at the moment of
  entry so it is still caught however long collection runs afterward.
- **Infiltration is quiet and missable, on purpose.** A tip nudged out of the
  lumen leaks slowly rather than announcing itself; noticing it and stopping
  is a real timed action, and failing to notice — or noticing and continuing
  anyway — are both automatic failures.
- **The rubric grades both procedures honestly without penalizing either.**
  `proceduresOnly` (opt-in, excluded when the procedure is unknown) and
  `excludeProcedures` (opt-out, included when unknown) let the same technique
  category add a butterfly-only row and swap the angle-window gate, without
  docking a straight-needle attempt for a measurement it will never produce.
  Pushed into every individually-exported rubric helper, not just the
  top-level orchestrator, because dozens of existing unit tests call those
  helpers directly without ever passing a procedure context.

Three real bugs surfaced only by driving the actual browser, not by reading
the code: an insert-depth preset hardcoded to 6mm (harmless on a 2.6–4.8mm
antecubital vein, a through-and-through on a 2mm hand vein); tourniquet's and
palpation's 3D-scene launch silently rebuilding the forearm vessel set over
the hand's; and the tourniquet height dropdown's presets computed as absolute
world positions, off by the hand site's own offset. A fourth surfaced only
once the *existing* suites were re-run against the new random procedure
selection: several pre-existing e2e specs assumed every patient draws
straight-needle and broke intermittently once some genuinely didn't — fixed
by having each spec force the procedure it actually means to test, the same
seam `?forcedProcedure` already gave the butterfly suite.

34 unit tests, 16 browser tests.

## Phase 3b — Consequences ✅ complete

The first branch with **no screen of its own**. Every branch before it models
what the learner does; this one models what the patient's body does back,
while they are still doing it.

- **Complications are caused, not scheduled.** The old `DRAW_EVENTS` were a
  bubble that appeared at a random moment, offered three sentences, and scored
  the tick — nothing in the draw caused one and nothing changed because of one.
  `venipuncture/complications/` replaces that with eight complications whose
  triggers read only measurements the other branches already record: a
  through-and-through under a live tourniquet, a tip sheared past the wall
  mid-collection, a needle eleven seconds into the skin with no flash, an entry
  over the median nerve at nerve depth, a vacuum on a vein too narrow for it, a
  patient nobody warned before the stick, and a vasovagal prodrome built from
  the patient's own explicit history.
- **One session, ticked from `animate()`.** A hematoma raised during the stick
  keeps growing while the band comes off; a faint builds across four screens.
  So the watch is opened when the draw starts and ticked once a frame from the
  composition root, before the per-step scene early-returns.
- **The consequence is on the limb, not in the report.** `armMesh.js` holds a
  LIVE reference to the encounter's condition object and reads it every frame,
  so the bruise raised in the insert step is on the arm in the bandage step.
  Blood in the tissue is rendered as both a spreading stain that shades red →
  purple with volume and a dome that lifts the skin; pallor is whole-limb and
  does not fight the tourniquet's own distal pallor; a flinch genuinely moves
  the limb.
- **One answer, one consequence.** Answering a blown vein with "stop, remove,
  hold pressure" GENUINELY ENDS THE DRAW, and the report is built from the
  tubes actually collected. Answering it with "probe around" enlarges the tear.
  An answer cannot be taken back, and one left unanswered past twice its window
  is missed — with the same physical consequence as the wrong answer.
- **Graded on recognition, never on incidence.** A patient's body reacting is
  not a mark against the learner; failing to notice it is. A draw with nothing
  wrong scores 100 on the row and says "there was nothing to recognise".
- **The sample quality model** (`venipuncture/specimen/`) is the only place
  that can judge a tube, because haemolysis reaches it from three separate
  branches at once — gauge shear under a full vacuum, a needle moved in the
  lumen, shaking during mixing — and the analyser cannot tell them apart. Each
  tube gets a receiving verdict (accepted / accepted with a comment / rejected)
  with the reason stated the way a laboratory states it, and a rejection names
  the ordered tests the patient must be drawn again for. It feeds
  `scoreEncounter()` and the rubric as an ordinary measurement.
- **`vpFinish()`'s chips report real measurements**: `Insertion angle 22° ·
  3.5mm deep`, `Tourniquet 38s · 3.4″ above`, `Blood collected 6.7 mL`. A chip
  with no measurement behind it shows no number rather than a zero it did not
  earn.

51 unit tests, 7 browser tests. Two rubric rows added (complication response,
specimen integrity), with their own automatic-failure events: a complication
never acted on, one recognised and continued through, and blind probing.

## Phase 4 — Progression ✅ complete

One constraint held throughout: **an equipment upgrade moves a number some
branch already reads; it never adds a special case to one.**

- **Four pieces of equipment**, mid-priced so a learner can actually reach them:
  the winged-set kit turns the device from something the patient's arms dictate
  into a real choice screen (including the wrong choice, which the draw then
  genuinely differs by); the transilluminator raises the render opacity of deep
  vessels and changes no geometry, so palpation still decides the rubric row;
  the warming pack multiplies the arm's own `vigour`; the paediatric kit scales
  `tubeVolumeMl()`, which is exactly what `collapsesVein()` already consults —
  so a narrow vein stops being pulled shut, while the additive ratio rule does
  not soften at all.
- **Difficulty is anatomy.** `difficultyVeinKeys()` binds the 0–4 ladder to the
  scenario keys `applyPatientVariation()` already understands, so a busy shift
  is a harder LIMB — rolling, narrower, deeper, more fragile — rather than more
  paperwork. Levels 0 and 1 are ordinary arms on purpose. Complication rates
  scale with the same ladder.
- **Four collectibles and four badges** for what the new layers made possible:
  Quick Eyes (every complication recognised and answered), Clean Deliveries
  (every tube accepted without even a comment), Winged Draws, Gentle Hands (no
  bruise at all). Each reads a measurement the draw produced, so none can be
  earned by an encounter that never got that far — or bought.

17 unit tests.

## Phase 5 — Polish and ship ✅ complete

- Reduced-motion and accessibility paths carried into the new UI: the
  complication alert is `role="alertdialog"` with `aria-live`, states every
  severity in words as well as colour, and does not animate under
  `data-reduced`.
- The browser suite can now run against a machine-provided Chromium via
  `PW_CHROMIUM_PATH`, since a sandbox path is a property of the machine and not
  of this project.
- `README.md` added as the project's front door; `docs/ARCHITECTURE.md` gains
  the two draw-scoped layers and the upgrade rule; `docs/TESTING.md` gains the
  three new suites and the one deliberately-allowlisted environment artifact.
- Shipped to `main` with `npm test` green (600+ unit tests) and the production
  build clean.

## Streamlining pass ✅ complete

Once the physical steps were finished, several 2D screens were still asking
the learner about things the draw itself now makes them DO. One rule decided
what went: *if the draw already makes them do it, delete the screen that asks
about it and score what they did.*

- **Identity** was a multiple-choice screen before the draw and a real
  interaction inside it. The screen is gone; the `introduce` step is the
  identification, and the nickname patient — the one trap the physical step
  could not express — now lives inside it: the first open ask gets "everyone
  just calls me AJ", which confirms nothing, and the learner has to notice
  and ask again.
- **Tube selection and order of draw** were two tap-a-rack screens asked
  before the learner ever reached the supply cart, where they then chose real
  tubes and seated them in a numbered rack in order of draw. Both screens are
  gone; `stagingScoring` reports `stagedTubeKeys` and `rackedTubeKeys`, and
  the order actually drawn comes from the collection branch's own
  `drawnSequence`.
- **The mid-draw event quiz** interrupted the draw to ask a multiple-choice
  question about a hematoma, a dry stick or a flinch — all of which Phase 3b
  made real complications that the draw causes and the learner answers on the
  arm. Six of the eight `DRAW_EVENTS` are gone; the two that remain are the
  post-draw professional-judgement moments (a needlestick during cleanup, an
  extra tube that was never ordered), which is what that format is good at.
- **Labeling and handling** merged into one screen: they are the same moment
  of work, standing at the chair with the tubes in your hand.
- **The draw-complete screen** shows the laboratory's verdict as one line when
  every tube was accepted, and hides recap chips for steps that never ran
  rather than showing a zero they did not earn.

A second pass went further:

- **The greeting screen** was one button that said "Greet & begin". That is a
  click, not a decision — and greeting the patient is already an act inside
  the introduction step, where it is measured. The patient now says hello on
  the requisition screen they arrive with.
- **Events the introduction elicits** were removed from the `EVENTS` table.
  Being told about a latex allergy in a bubble and then asking about it
  thirty seconds later taught nothing the second time; the patient discloses
  it in the interview now, from `patient.history`, to a learner who asks.
  Fainting history went the same way. What stays is what a patient actually
  volunteers and a phlebotomist has to answer well.
- **The Final Practical's report moved to the end.** It used to print the
  moment the needle was out — before the tubes were labelled, before the
  patient had been answered — and was then followed two clicks later by a
  second grading screen. Two verdicts on one encounter, delivered mid-job.
  The draw now ends with a recap of what it measured, and every judgement
  lands together, once, on the score screen.

Net: eleven screens per patient became five, and the three categories the
deleted screens used to measure are now scored from real technique — see
`deriveChoices()` in `game/scoring.js`. 14 unit tests.

### Still open

Honest list, so the next branch does not have to rediscover it:

- **Perf budget.** No instanced meshes or model LODs yet. The scenes are small
  enough that this has not bitten, but it has not been measured on integrated
  graphics either.
- **Dark theme is 3D-only.** `applyTheme()` recolours the room's meshes; the
  DOM panels have no dark variant, so the new alert and receiving blocks follow
  the light palette in both.
- **Complication visuals stop at the arm.** The patient's own body in the room
  scene does not slump when they faint; the arm does the whole job.
