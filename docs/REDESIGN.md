# Tiny Vials — Redesign Brief

**From:** an educational prototype with excellent clinical bones
**To:** a tactile, replayable draw-room simulator people run "one more patient" on

This document is a no-code implementation brief. It names what to build, what
to delete, and what to rebuild from scratch. It is deliberately opinionated.
Where a large redesign beats a small fix, it recommends the large redesign.

Every major recommendation is written as:
**Current problem → Proposed rework → Why it is better → What the player should feel.**

---

## 0. The diagnosis, in one page

The clinical model in this codebase is genuinely excellent and should be
protected. Real units, real physiology, real complications, a rubric that
grades what you physically did. Almost nothing in this document touches that.

The problem is not the simulation. **The problem is the container it runs in.**

Three structural facts explain nearly every complaint in the brief:

**1. There are seventeen scenes, not one bench.**
Nine runtimes — tourniquet, palpation, cleaning, assembly, insert, collection,
withdrawal, post-draw, inversion — each call `buildArmScene()` on entry and
`view.dispose()` on exit. The patient's arm is *destroyed and rebuilt between
every single step*. Every step therefore has to re-establish context, re-fade
in, re-explain itself, and hand off state through a serialised bundle. That is
why the game feels like a checklist: architecturally, it **is** a checklist.
Nothing else in this brief matters as much as fixing this.

**2. The camera is a diagram, not a viewpoint.**
`armScene.js` frames the arm running left-to-right across the screen at a 41°
pitch and 24° yaw, on a 20° long lens. That framing exists for a *mathematical*
reason (documented at length in `pointerToLimb`): a square-on view sees the
limb's cross-section edge-on, so near-side and far-side collapse to the same
pixels and the wrap becomes unsolvable. The yaw buys back a solvable ellipse.
The reasoning is correct and the solution is elegant — but it optimised for
*solvability* and never revisited *believability*. You are looking at a
specimen on a bench, not at a patient across from you.

**3. Interaction difficulty is being spent in the wrong place.**
`RACK_SNAP = 0.024` is commented "deliberately small: no long-range magnet."
Tourniquet routing needs 1.75 radians of swept travel while never exceeding
1.12 silhouette half-widths of lift. Palpation requires holding a fingertip
within 0.9 mm for 110 ms and then waiting 0.85 s for pressure to ramp — per
probe. These are precision taxes. The player is fighting the input layer to
prove an intent they already clearly expressed. **The challenge should be
knowing where the vein is, not operating the finger.**

And one direct brief violation: `panels.js:427-453` fires
`floatXP("Clean · Tourniquet 92/100 +14 XP")` at every section boundary, plus
`+2 XP` per step. The player is being graded mid-procedure, eleven times.

Also confirmed: **`armScene` accepts a `handedness` option in its JSDoc and
never reads it.** Handedness currently mirrors the supply tray and nothing
else. The arm, camera, hands and needle approach are identical either way.

---

## 1. Major Experience Reworks

### 1.1 — One continuous bench session (**the keystone change**)

> **Current problem.** Nine runtimes each construct and dispose their own
> `THREE.Scene`, arm mesh, lighting, and camera. State crosses the boundary as
> a data bundle (`applyBandToArm()` re-derives the band's effect from
> serialised tension and elapsed seconds in four different files). Every
> transition is a teardown, a rebuild, and a screen change.
>
> **Proposed rework.** Build **one** `BenchSession` that lives from "patient
> sits down" to "specimens leave the room." It owns the scene, the arm, the
> camera, the tray, the hands, and the persistent props (band, swab, needle
> unit, tubes, gauze). Steps become **modes** that attach input handlers and
> camera targets to the living bench — not scenes that replace it. Nothing is
> disposed until the encounter ends. The band you tied stays tied because it is
> *the same object*, not because its tension was re-serialised.
>
> **Why it is better.** It eliminates the single largest source of "checklist
> feel" at the root. It makes continuous flow, camera moves, tool hand-offs,
> and mid-procedure complications possible at all — none of which can be built
> on top of scene teardown. It also deletes a great deal of state-marshalling
> code and a whole class of hand-off bugs.
>
> **What the player should feel.** That they are in a room with a person for
> four minutes, not clicking through seventeen exercises about a person.

### 1.2 — Delete the introduction step as a step

> **Current problem.** `introduce` is a full dialogue screen with a transcript,
> three identifiers, a 20-second scrub timer and a gloving sequence, scored as
> its own section. It is a text adventure bolted to the front of a physical
> game, and the player has to get through it before touching anything.
>
> **Proposed rework.** Remove the screen. Redistribute its content:
> - **Hand hygiene and gloving become the game's opening physical action.**
>   You start at the sink. Scrub — a real two-handed rubbing gesture with real
>   foam building on the hands, real duration, audible water. Then gloves: grab,
>   stretch, snap. This is a *great* tactile opener and takes eight seconds.
> - **Identification happens over the patient while you work.** The patient is
>   already in the chair. A wristband is on the arm you are about to touch.
>   Turning the wristband to read it is a physical action on the bench; the
>   requisition is a card clipped to the tray. Cross-checking is
>   *look at both, then act* — and picking up the tourniquet before you have
>   read the band is the error, logged silently.
> - **The conversation becomes ambient.** The patient speaks when spoken to and
>   volunteers things ("last time they used my left"). Two or three optional
>   voice-line prompts, never a wall of choices, never a blocking screen.
>
> **Why it is better.** It converts the least tactile part of the game into the
> most tactile opening moment, removes a gate, and makes identification a live
> safety pressure rather than a quiz you passed and forgot.
>
> **What the player should feel.** Hands clean, gloves snapped, patient in front
> of them — already working, thirty seconds sooner.

### 1.3 — Kill all mid-procedure scoring

> **Current problem.** Section rewards fire eleven times per draw with an
> explicit number: `"Clean · Tourniquet 92/100 +14 XP"`. This tells the player
> their grade before they have finished the patient, breaks immersion at
> exactly the moment flow should carry them forward, and turns a medical
> procedure into a score-attack minigame.
>
> **Proposed rework.** During the encounter: **no numbers, no XP, no coins, no
> section banners, no chips.** The only feedback is *diegetic* — the vein
> filling, the hand pinking or blanching, the patient's face, the flash of
> blood, the tube's vacuum sound, the click of the safety. Everything numeric
> is accumulated silently and delivered at the debrief (§6). Keep the reward
> *arithmetic* exactly as it is — `rewards.js` is well designed and honest — and
> change only *when* it is shown.
>
> **Why it is better.** Diegetic feedback is stronger feedback: a vein you can
> see rising teaches placement better than "92/100" does. Withholding the score
> also makes the debrief land as a real event instead of a summary of eleven
> things you were already told.
>
> **What the player should feel.** Absorbed. Then, at the end, judged — properly.

### 1.4 — Compress seventeen steps into six beats

> **Current problem.** Seventeen entries in `VP_STEP_DEFS`, each a screen with a
> trigger and a required-state gate. Several are a single click (`safety`,
> `bandage`, `uncap`). The gating means you cannot do the natural thing —
> assemble the needle while the site air-dries — even though the code has a
> `duringCleanDry` trigger acknowledging that you should.
>
> **Proposed rework.** Keep every measurement. Delete the step *boundaries*.
> Reorganise into six beats where, **within a beat, actions are freely ordered**:
>
> | Beat | Contains | Ordering |
> |---|---|---|
> | **Setup** | scrub, glove, read band + requisition, stock the tray | free |
> | **Access** | tourniquet, palpate, choose site | tourniquet-then-palpate enforced by physiology, not by a gate |
> | **Prep** | clean, assemble, uncap | free — assembling during the 30 s dry is *correct technique* and should be rewarded |
> | **Stick** | anchor, insert, flash | strictly sequential (it physically is) |
> | **Collect** | fill, switch, release band, withdraw, safety, sharps | free within clinical constraints; band-before-needle is a *rule*, not a screen order |
> | **Close** | pressure, bandage, invert, label, dispatch | free |
>
> Order errors stop being impossible and start being *mistakes* — which is what
> makes them worth grading.
>
> **Why it is better.** Free ordering inside a beat is what turns a procedure
> into a skill. The player has to *know* the band comes off before the needle,
> instead of being marched through it. It also removes ten screen transitions.
>
> **What the player should feel.** Trusted. And slightly nervous, in a good way.

### 1.5 — Replace the mode selector with a shift

> **Current problem.** Learn / Practice / Final Practical is a menu choice about
> how much the coach talks. It is a settings screen, not a game structure.
>
> **Proposed rework.** Keep the three coaching levels but reframe them as
> **Clinicals** (coach on, forgiving), **Shift** (the main loop — a queue of 4-6
> patients back to back, coach quiet, results per patient and per shift), and
> **Practical** (a single graded patient, silence, rubric). Add a **Bench**
> sandbox: one arm, infinite tourniquets and needles, no scoring, instant reset
> — the place you go to actually *practise the stick* fifty times.
>
> **Why it is better.** A shift gives the loop a shape and a reason to keep
> going. The Bench is the single highest-value addition for replayability:
> mastery needs cheap repetition, and right now every practice stick costs a
> four-minute patient.
>
> **What the player should feel.** "One more patient before end of shift."

---

## 2. Arm / Camera / Handedness

### 2.1 — Rebuild the camera as a first-person working position

> **Current problem.** `PITCH = 0.72` (41° above horizontal), `LOOK_X = -0.045`,
> the arm laid across the frame on the X axis, hand off to one side, on a 20°
> lens from a long throw. It reads as a museum vitrine. There is no operator
> body, no hands at rest, no patient.
>
> **Proposed rework.** Move to a **seated operator's eyeline**: camera at eye
> height, looking down and forward at ~30-35° onto a limb that runs
> **away from the viewer into the screen** (proximal end far, hand near), resting
> on an armrest that is angled slightly across the frame. The patient's shoulder,
> chest and face are visible in the upper third — soft-focus, but *there*. Your
> own gloved hands enter from the bottom of the frame.
>
> **Critically: preserve the geometric property the yaw was protecting.**
> `pointerToLimb`'s 2×2 solve requires the limb's cross-section to project with
> real area — the camera's view direction must not lie in the cross-section
> plane. Rotating the limb to run into the screen while the camera looks down
> at it *satisfies this more strongly than the current framing does*, because
> the view direction is now steeply oblique to every cross-section. The
> existing solve keeps working; it may even get better-conditioned. Re-derive
> the basis vectors from the new transform and keep the long lens (the affine
> reasoning in `fitCamera` is sound and worth keeping).
>
> **Why it is better.** The single strongest immersion lever available. Every
> gesture in the game reads differently when the arm is the one in front of
> you rather than the one on the table.
>
> **What the player should feel.** That they are sitting at a draw chair.

### 2.2 — Give the camera a small amount of life and a lot of intent

> **Current problem.** `fitCamera` is called every 30 frames to refit an aspect
> ratio. The camera never moves for any other reason.
>
> **Proposed rework.**
> - **Beat framing.** Each beat has a target framing that the camera *eases*
>   into over ~500 ms — never cuts. Access frames the whole limb (the hand must
>   be in shot: blanching is a tourniquet tell). Stick pushes in close on the
>   fossa. Collect pulls back to include the tray and tubes.
> - **Lean-in.** Holding the pointer still over the site during palpation eases
>   the camera 15% closer over a second and narrows depth of field. Release and
>   it drifts back. This is *the* cheapest way to make examining feel like
>   examining.
> - **Micro-motion.** A very small amount of breathing sway on the camera
>   (±2 mm, ~0.2 Hz), killed entirely during the insertion approach so the
>   player's hand is the only thing moving at the moment precision matters.
> - **Never a hard cut inside an encounter.** Ever.
>
> **What the player should feel.** Attention. Their own focus, rendered.

### 2.3 — Make handedness real (it currently is not)

> **Current problem.** `armScene.js:40` documents a `handedness` option that the
> function body never reads. Handedness mirrors the supply tray zones in
> `stagingScene.js` and affects nothing else. The arm, the camera, the approach
> vector, the anchor thumb, and the needle hand are identical for both.
>
> **Proposed rework.** Make handedness a **transform on the whole bench session**
> — one root-level mirror plus per-system overrides:
>
> | System | Right-handed | Left-handed |
> |---|---|---|
> | Camera yaw | as now | mirrored about the limb axis |
> | Patient's presented arm | patient's left, laid to operator's right | mirrored |
> | Tray / sharps bin | operator's dominant side, no reach across the field | mirrored |
> | Needle hand | right, entering from lower-right of frame | left, lower-left |
> | Anchor thumb | left thumb, distal, pulling toward the wrist | right thumb |
> | Needle approach vector | from distal-right along the vein | distal-left |
> | Tourniquet tail direction | tail points up-arm, away from site | mirrored |
> | Hand meshes | right glove model on needle hand | mirrored + left glove model |
>
> The mirror must be a *scene transform*, not per-mesh negation, so nothing can
> be forgotten. Anatomy (`mirrorForArm` already exists) stays correct because
> vessel paths mirror with it. **Verify the ellipse solve after mirroring** — a
> negative determinant flips `theta`'s sign convention and would silently invert
> wrap direction; the sign must be taken from the mirrored basis, not assumed.
>
> **Why it is better.** Roughly 10% of learners are left-handed and are
> currently being taught a mirrored-wrong motor pattern. It is also a strong
> replay axis: switching hands is a genuine second game.
>
> **What the player should feel.** That the game was built for them
> specifically, and that their hands are where their hands are.

### 2.4 — Put hands in the game

> **Current problem.** Palpation renders a disembodied fingertip sphere
> (`buildFinger()`: a 9 mm squashed sphere plus a nail). The tourniquet is
> dragged by an invisible grip. Nothing else has a hand at all.
>
> **Proposed rework.** Two gloved hands, always present, always posed. Not IK —
> **a small library of authored poses** blended between: rest, pinch, two-finger
> palpate, flat-palm anchor, thumb-anchor, needle grip, tube grip, gauze press.
> The hand travels to the tool, the pose snaps to the tool's grip point, the
> tool moves with the hand. Off-hand does its own job simultaneously — it holds
> the anchor *while* the needle hand advances, visibly.
>
> **Why it is better.** Hands are the cheapest possible source of weight,
> intent, and physicality, and they are the thing every tactile game gets right.
> A pose library is a fraction of the cost of IK and reads better.
>
> **What the player should feel.** That the tools have mass and their hands
> have skill.

---

## 3. Core Procedure Interaction Reworks

### 3.1 — Tourniquet: rebuild it around the whole strap and heavy magnetism

> **Current problem.** You must grab a specific *end* of the strap
> (`pickStrapEnd`). You must then sweep 1.75 radians of accumulated
> perpendicular travel (`WRAP_COMPLETE`) while never exceeding 1.12 silhouette
> half-widths of lift (`LIFT_LIMIT`), or the wrap is scored as "laid over the
> top." Then tension, then cross, then tuck — four distinct gestures, each
> failable, on a strap you can only hold by its tip. The underlying reasoning is
> honest (the underside genuinely is not visible) but the result is a precision
> gauntlet.
>
> **Proposed rework — rebuild the interaction, keep the measurements.**
> - **Grab anywhere.** The entire strap is a grab target, with a generous
>   capsule collider along its whole length. Where you grabbed it determines
>   which end is free; it never determines whether you *can* grab it.
> - **One gesture, not four.** Drag the strap onto the arm and pull across.
>   The strap **magnetically wraps**: as soon as the drag crosses the limb
>   silhouette with reasonable speed and direction, the band animates itself
>   around the limb — under and up, the correct way — and lands flat.
>   Routing direction is inferred from the *direction of the stroke*, generously,
>   not from accumulated sweep survival.
> - **Placement is forgiving and magnetic.** Anywhere in a wide window along the
>   arm snaps to a flat, square seating. Position is still *measured* in
>   millimetres from the site and still graded — but you cannot end up with a
>   band at a crooked angle because your hand drifted 4 mm.
> - **Tension becomes the skill.** After it wraps, you *pull*. This is the one
>   thing worth making demanding, because it has a beautiful visible readout:
>   veins rise, then the hand blanches. Pull, watch, settle. Hold the good zone
>   and the strap "sets" with a leather-creak and a soft thud.
> - **The tuck is automatic.** It is not a skill; it is a fiddle. The band tucks
>   itself with a satisfying flick animation, tail pointing up-arm. Grade the
>   *result* only if the player does something actively wrong.
> - **Removal is one downward yank** with a snap and a real recoil.
>
> **Why it is better.** It moves 100% of the difficulty from "operate the strap"
> to "read the arm," which is the actual clinical skill. Skew and route
> direction are still measured — they just require *bad intent* to fail, not
> bad luck.
>
> **What the player should feel.** The strap has weight and elastic. It wants to
> go on. Getting the tension right is a judgement they are making with their
> eyes, and it feels good when it sets.

### 3.2 — Palpation: replace point-probing with a continuous feel field

> **Current problem.** The worst interaction in the game. To feel anything you
> must press (`palpationPointerDown`), then hold within 0.9 mm for 110 ms
> (`STILL_MS`) so `still` becomes true, then wait 0.85 s (`PRESS_RAMP`) for
> pressure to reach `CONTACT_PRESS`. Moving at all decays pressure at 2.6/s.
> So searching an arm means: press, freeze, wait a second, learn about *one
> point*, move, repeat. Finding a vein this way takes dozens of probes and feels
> like minesweeper.
>
> **Proposed rework — rebuild entirely as a continuous, always-on feel field.**
> - **You feel while you move.** Drag two fingertips across the skin and
>   sensation is *continuous*. No hold timer. No stillness requirement. Moving
>   is how you search — that is what palpation *is*.
> - **The primary channel is haptic-visual, not textual.** Under the fingers,
>   the skin deforms in real time and a soft **"feel halo"** renders what is
>   underneath as a field, not a label: a vein reads as a soft longitudinal
>   swell that *springs back*; an artery as a rhythmic radial pulse synced to
>   an audible heartbeat that gets louder as you near it; a tendon as a hard,
>   unyielding cord with a flat, dead response; a roller visibly *slides away*
>   under the pressure (this already exists in `rollOffset` and is excellent —
>   surface it much harder).
> - **Add continuous audio.** A low, procedural sub-bass "give" that changes
>   timbre with what is under the pad. This is the single highest-value addition
>   to palpation. Feeling is an audio problem as much as a visual one.
> - **Pressure becomes an axis you control, not a timer you wait out.** Press
>   harder by holding still *or* by a modifier (right-click / second finger /
>   a light press-and-hold that ramps in 250 ms, not 850 ms). Deeper pressure
>   reveals deeper structures and *occludes* shallow ones — which is real, and
>   is a genuine skill: press too hard and you flatten the vein you were looking
>   for and it vanishes. That is a fantastic mechanic and it is already modelled
>   in `OCCLUDE_PRESS`.
> - **Committing is a distinct, weighty act.** Once you have found it, you
>   *mark* it — a deliberate double-tap or a held press that leaves a visible
>   dimple and a faint pen mark on the skin. Not a button in a panel.
> - **Generous hit radius.** The vein's "feelable" width should be ~3× its
>   visual width. You should be able to find it by sweeping, then narrow in.
>
> **Why it is better.** It converts the worst interaction into potentially the
> best one. Searching by feel with a live audio-visual response is inherently
> satisfying and is *exactly* the real skill. The occlusion mechanic gives it
> depth without adding precision tax.
>
> **What the player should feel.** Hunting. Then — *there it is* — the small
> thrill of a vein rolling under the pad and springing back.

### 3.3 — Cleaning: keep the decal, fix the motion

> **Current problem.** The foundation here is genuinely good — `cleaningRuntime`
> paints real coverage into a decal texture rather than filling a progress bar,
> which is exactly right. But the interaction on top of it is a bare drag with
> `FRICTION_FULL = 0.0025` metres of travel per sample, and correctness is
> judged partly on producing a *spiral* (`applySpiral` vs `applyBackAndForth`).
> Drawing a good spiral with a mouse is a drawing test, not a cleaning test.
>
> **Proposed rework.**
> - **Keep the decal. Make it beautiful.** Wet, glossy alcohol sheen that
>   spreads slightly past the swab, then visibly **evaporates** from the edges
>   inward over the drying time. Skin darkens when wet and lightens as it dries.
>   The drying wait becomes *watchable* instead of a countdown.
> - **Forgive the path completely.** Do not grade spiral-vs-scrub as pass/fail.
>   Grade **coverage** (the decal already knows), **whether you went back over
>   cleaned skin** (already tracked as `markRetouched`), and **outward-ness** as
>   a soft bonus. A player scrubbing energetically outward from the centre
>   should score well even if the path is not a neat Archimedean spiral.
> - **Add friction feel.** Swab drag should have slight resistance and a
>   procedural granular scrub sound whose pitch and density track speed and
>   pressure. Gauze catching on skin. This is a five-minute addition with an
>   outsized payoff.
> - **Let the beat continue.** The 30-second dry is *not* dead time: assembly
>   happens during it (§1.4). The camera pulls back to the tray, the site keeps
>   drying in shot, and touching it again is a visible, audible mistake.
>
> **What the player should feel.** Wetting, working, and watching skin dry —
> and a small satisfying itch to keep scrubbing until the field is fully covered.

### 3.4 — Tray & equipment: a real, physical, forgiving workspace

> **Current problem.** `RACK_SNAP = 0.024` with the comment "deliberately small:
> no long-range magnet." Items dropped past the counter bounds fall and are
> permanently contaminated with no recovery. Items land wherever released. The
> inspect gesture demands 2.0 radians of accumulated rotation before a label
> counts as read. Getting a tray set up is an exercise in careful mouse work.
>
> **Proposed rework.**
> - **Objects can never be lost.** Delete the "falls off the counter, gone"
>   behaviour as a *physics* outcome. If a release lands out of bounds, the item
>   arcs back to the nearest free counter spot with a settle. If contamination
>   is clinically warranted, mark it and *say so* — but the object stays
>   reachable. A player must never be unable to continue because a prop is gone.
> - **No free-body physics anywhere.** Everything is animated placement, not
>   simulation: lift → carry with slight lag and tilt → release → **arc,
>   settle, small bounce, rest.** Nothing jitters, tunnels, or drifts, because
>   nothing is ever integrating forces. This is how good games fake weight, and
>   it is strictly better here than a real solver.
> - **Massively increase snapping.** Every valid destination — rack well, tray
>   slot, sharps bin, holder hub — has a large magnetic radius (3-4× current)
>   with a visible ghost and a slight pull on the held object as you approach.
>   The item leans toward its slot before you release it.
> - **Make placement itself the reward.** A tube into a rack well should be:
>   a soft magnetic pull, a *thunk*, a 2-3 mm settle overshoot, a tiny rack
>   wobble, and a glass-on-plastic click. Racking six tubes in a row should be
>   genuinely pleasant — the kind of thing players do for its own sake.
> - **Replace label-inspection with a lift-and-read.** Bringing an item close to
>   camera enlarges and steadies it and the label becomes legible. One
>   deliberate gesture, no rotation quota. The *decision* (is this in date? is
>   this the right gauge?) is the skill; the wrist motion is not.
> - **Add a "reset my tray" affordance.** In Bench and Clinicals, one control
>   returns everything to its start position, cleanly animated.
>
> **What the player should feel.** Weight, contact, and the small pleasure of a
> well-ordered tray — and total confidence that nothing will be taken from them
> by a physics glitch.

### 3.5 — Collection: make the vacuum audible and the tubes weighty

> **Current problem.** `fill` is `interaction:"hold-timing"` and `switch` is
> `drag-order`. It is the longest-duration part of the draw and currently the
> least tactile.
>
> **Proposed rework.** Push the tube onto the holder against the flange and feel
> the **stopper pop** — a distinct resistance-then-give, the same profile as the
> needle's skin pop (§4). Then the vacuum: a soft audible *hiss-and-draw* that
> starts strong and **decays as the tube fills**, blood climbing the tube wall
> in real time with a meniscus. When it exhausts, the sound tails off and the
> flow visibly stops — that is your cue, not a timer. Pull the tube off with a
> small twist and click. Racking the full tube is the §3.4 satisfaction.
> If the player fails to brace the flange, the whole holder visibly shifts and
> the patient reacts — the existing rule, but *shown*.
>
> **What the player should feel.** The rhythm of a real collection: push, pop,
> hiss, watch, click, rack. Repeatable and pleasant.

### 3.6 — Post-draw: pressure should be a held, resisting act

> **Current problem.** `pressure` is `interaction:"hold"` — hold a button for a
> duration, with peeking penalised.
>
> **Proposed rework.** Press gauze onto the site and **hold against visible
> resistance**: the gauze compresses, the skin blanches under it, and a subtle
> force feedback (haptic where available, visual deformation everywhere) tells
> you whether you are at the right pressure. Too light and blood wicks into the
> gauze edge; too hard and the patient winces. The arm should be *slightly
> raised* by the operator's other hand. When haemostasis is reached, lifting
> reveals a clean puncture — or a bead, if you were short. That reveal is a
> small dramatic moment. Bandage is then a real peel-and-apply, not a tap.
>
> **What the player should feel.** Patience with a purpose, and relief at a
> clean site.

### 3.7 — Inversion: keep it, it is already good

`inversionRuntime` requires real end-over-end rotation per additive and
punishes shaking. This is a genuinely good tactile mechanic. Only additions:
audible fluid slosh that tracks rotation velocity, a visible mixing swirl in
the tube, and a per-tube "count" that reads as a satisfying rhythm rather than
a counter. Do not touch the rules.

---

## 4. Needle + Blood Flow Experience

**This is the climax of the game and it should be built like one.** Everything
else exists to make this moment land.

### 4.1 — Correct the approach geometry

> **Current problem.** `READY_DISTAL = 0.035`, `READY_HEIGHT = 0.014` — the
> needle starts 35 mm distal and 14 mm above, so a straight carry to the mark
> is `atan(14/35) ≈ 22°`, comfortably inside the 15-30° window. The comment
> says "the obvious way to play it is also the clean one," which is good design
> intent — but it means the *default* motion is correct and angle is barely a
> skill. Meanwhile bevel orientation is inherited from wherever the player's
> assembly rotation happened to stop, which is a hidden gotcha.
>
> **Proposed rework.**
> - **Approach from distal, along the vein's own axis** — not across it. The
>   ready pose sits behind and below, and the needle's *shaft* should visibly
>   align with the vein's path. Lateral misalignment should be visible and
>   should matter.
> - **Show the bevel.** A clear, readable bevel-up indicator on the needle
>   itself — a highlight, a printed mark, and a subtle glint. Bevel orientation
>   is a real and teachable thing and it should be *seen*, not silently
>   inherited from a screw rotation four steps ago. Snap the assembly rotation
>   to bevel-up unless the player deliberately does otherwise.
> - **Angle needs an honest readout.** During approach, render the needle's
>   angle as a subtle side-profile ghost against the skin line. Not a number —
>   a *silhouette*. The player should learn to read the shape.

### 4.2 — Build the five-phase insertion sequence

This should be one continuous gesture with five distinct, felt phases. Each has
its own visual, audio, and resistance signature.

| Phase | What the player does | Visual | Audio | Feel |
|---|---|---|---|---|
| **1. Align** | Bring the needle to the site | Ghost silhouette shows angle; the site marker breathes; needle *magnetically* biases toward the vein axis once close | quiet; breath held; ambient drops away | steady, deliberate |
| **2. Contact** | Tip touches skin | Skin **tents and dimples** under the tip; a small shadow pools | a soft, dry tick | the first commitment |
| **3. Resistance** | Push forward | Skin stretches and *resists* — the cursor requires visibly more travel than the tip moves. This is the key trick: **decouple hand travel from tip travel** to sell resistance | a rising, tightening creak | the needle is being *pushed*, not slid |
| **4. Penetration** | Break through | A sudden, sharp **release** — skin snaps back around the shaft, the tip lurches forward the accumulated distance, a small camera kick (2-3 px, 80 ms) | a crisp, wet *pop* | the "give." This must be the most physically satisfying single frame in the game |
| **5. Vein entry** | Advance a few mm | The vein wall tents, then gives with a *second*, softer pop | a lower, softer pop | you are in |

Then **the flash** (§4.3). Between 4 and 5 there is a genuine window where you
have broken skin but not vein — that is a dry stick, and it should feel like
one: no flash, and you have to decide whether to advance, redirect, or stop.

> **Why it is better.** Resistance-then-release is the single most reliable
> "satisfying" pattern in game feel, and venipuncture *is* that pattern,
> naturally, twice. The current implementation locks the angle at
> `CONTACT_HEIGHT = 0.002` and freezes the mesh — the whole payload of the
> moment is currently skipped.
>
> **What the player should feel.** Tension, then the give, then *in*.

### 4.3 — The flashback must be the best moment in the game

> **Current problem.** `markFlashIfInVein` sets a flag. There is a sound. That
> is the entire payoff of the entire game.
>
> **Proposed rework — build this like a boss-kill.**
> - **Blood appears in the hub instantly** — a bright, dark-red bloom that
>   fills the flash chamber in ~200 ms with real fluid motion, not a fade.
> - **Everything else acknowledges it at once:** the camera does a small,
>   quick push-in (5%, 250 ms, ease-out) and holds; ambient room noise ducks
>   for ~400 ms and comes back; a single warm, low, resolved audio note —
>   not a jingle, a *resolution*. Chromatic warmth lifts by a hair.
> - **The patient reacts** — a small exhale, a relaxation of the shoulder. They
>   were tense. Now they are not.
> - **Your own hand steadies.** Any residual approach sway stops dead.
> - **A brief, tiny slow-motion** — 0.85× for 300 ms — then back to normal.
> - **No text. No score. No popup.** The world tells you.
> - **Failure is the mirror of this**, and should be *dramatically flat*:
>   nothing blooms, the room stays loud, the patient stays tense. The absence
>   is the feedback.
>
> **What the player should feel.** A genuine, physical hit of relief and
> competence. This is the moment they will replay the game for.

### 4.4 — Redirect, don't restart

> **Current problem.** A missed stick is largely terminal for the attempt.
>
> **Proposed rework.** On a dry stick, allow a **limited, graded redirect** —
> partial withdrawal (not out of the skin) and a small angle change, exactly as
> real practice allows and limits. Each redirect is measured and costs
> technique points; probing laterally is a serious error and produces a
> hematoma with real consequences (this is already modelled — surface it).
> Two redirects, then you must withdraw and restick.
>
> **Why it is better.** It converts the game's most punishing failure into its
> most interesting decision. "Do I adjust or do I pull out and start again" is a
> genuinely great tension and a real clinical judgement.
>
> **What the player should feel.** That a miss is a situation to handle, not a
> run to abandon.

---

## 5. Physics, Magnetism, Hands, and Game Feel

### 5.1 — A single global "intent magnetism" layer

Rather than each system tuning its own snap radius, build **one shared
assistance layer** that every interaction routes through:

- **Predictive targeting.** Use pointer *velocity and direction*, not just
  position, to identify the intended target. A fast, confident stroke toward a
  rack well should commit to that well well before the pointer arrives.
- **Sticky targets.** Once a target is engaged, require a deliberate amount of
  counter-motion to disengage. No losing your grip to a 3 px jitter.
- **Graduated pull.** Held objects lean toward valid destinations proportional
  to proximity, with visible anticipation.
- **Radii scaled to screen, not world.** Assistance must feel identical on a
  phone and a 27" monitor. Current radii are in metres and do not.
- **One assist slider, not a binary.** `assistedSnapping` currently doubles the
  rack snap and nothing else. Replace with a global 0-100% assist that scales
  every radius, exposed in settings and *recorded in the score* so a 100%-assist
  run is honestly labelled.

**Rule: magnetism helps you hit what you meant. It never decides what you
meant.** Snapping a needle to the vein axis is assistance. Snapping it to the
*correct* vein is cheating. Never cross that line.

### 5.2 — Kill all free-body physics

There should be **no dynamic rigid-body simulation anywhere in this game.**
Everything is authored motion: pick up (rise + slight lag), carry (trailing
tilt proportional to velocity), release (arc to destination, overshoot 3-5%,
settle over ~180 ms with one small bounce). Tunnelling, jitter, drift and
unreachable props all become structurally impossible rather than tuned against.

### 5.3 — Weight, everywhere

- Every object gets a **mass value** that drives: pickup rise time, carry lag,
  settle bounce amplitude, and impact sound. A tourniquet is light and floppy;
  a full tube has heft; a sharps bin barely moves.
- Held objects lag the cursor by 40-60 ms and tilt into motion. Weightless
  1:1 tracking is the number-one cause of "dragging UI elements."
- Everything that touches anything makes a sound. Everything.

### 5.4 — A procedural audio pass (highest value-per-hour in this document)

The current `sfx()` calls are `"tap"`, `"good"`, `"bad"`, `"click"` — abstract
UI beeps on a medical simulator. Replace wholesale with **diegetic, procedural
audio**:

| Source | Sound |
|---|---|
| Palpation | continuous low sub-bass "give," timbre varying by tissue; audible pulse near the artery |
| Tourniquet | elastic stretch that pitches up with tension; a leather creak at set; a snap on release |
| Alcohol swab | granular scrub, density and pitch tracking speed |
| Tube into rack | glass-on-plastic click + rack resonance |
| Stopper pop | resistance rise then a wet pop |
| Vacuum | hiss that decays as the tube fills — *the player's fill cue* |
| Skin penetration | dry tick → tightening creak → crisp wet pop |
| Flash | ambient duck + one warm low resolved note |
| Safety device | a hard, definitive plastic *clack* |
| Sharps bin | the distinctive rattle-and-drop |
| Patient | breathing that tightens with anxiety, an exhale at flash, a wince on error |

**Room tone throughout.** Silence is what makes a simulator feel like a
worksheet.

### 5.5 — Skin and tool reactions

Skin should respond to everything: blanch under pressure, dimple under a
fingertip, tent under a needle, redden after alcohol, mark where the pen went,
bruise where a hematoma formed (already modelled — render it). Tools should
show state: the swab darkens with use, gauze soaks, the needle carries a bead
of blood on withdrawal, gloves get a smear if you are careless.

### 5.6 — Haptics and input breadth

Where `navigator.vibrate` is available, fire short pulses on: contact, skin
pop, vein pop, flash (a longer one), tube seat, safety click. Add gamepad
support (analog triggers are *ideal* for pressure and needle advance). Keep the
existing accessible fallback path (`accessibilityFallback.js`) fully working —
it is well built and must survive this rework.

---

## 6. Scoring, Progression, and Replayability

### 6.1 — The debrief, rebuilt as an event

> **Current problem.** Feedback is spread across eleven in-procedure banners and
> a results screen, so the results screen is anticlimactic by the time you
> reach it.
>
> **Proposed rework — a four-act debrief, paced, with everything held back for it:**
>
> **Act 1 — The patient leaves.** No numbers yet. A single line of outcome:
> *"Three tubes, one stick, no bruise. He said thank you."* Or: *"Two attempts.
> She's holding her arm."* This is the emotional verdict and it should land
> alone, for two seconds.
>
> **Act 2 — The lab.** Specimens arrive and are accepted or rejected, with
> reasons, one at a time, with sound. The existing `specimenQuality` logic is
> excellent and should be *staged* rather than listed.
>
> **Act 3 — Technique.** Now the numbers. Per-section, animated in, with the
> real measured units the game already collects — *"entry angle 24°," "band on
> for 47 s," "1.2 mL under draw," "pressure held 94 s."* One line of what to fix,
> the highest-value one only. Personal bests highlighted as they are beaten,
> live.
>
> **Act 4 — Rewards.** XP, coins, streak, mastery progress, accomplishments —
> all the payouts that were suppressed during the draw, arriving at once. This
> is where the accumulated dopamine gets spent, and it should be generous and
> loud, because it has been earned over four minutes of silence.
>
> **Then: one prominent button — "Next patient."** Not a menu. The fastest path
> out of the debrief is into another draw.

### 6.2 — Mastery, not just XP

XP and coins measure *time spent*. Add a parallel axis that measures *skill*:

- **Per-technique mastery tracks** (Tourniquet, Palpation, Antisepsis,
  Insertion, Collection, Safety, Aftercare), each 1-5 stars, each earned by
  hitting quality thresholds *repeatedly* — three consecutive draws at 90+,
  not one lucky run. Mastery cannot be bought or ground; it must be
  demonstrated.
- **Star ratings per patient** (1-3) with visible thresholds, so replaying a
  patient for a 3-star is a clear goal.
- **Technique challenges** — optional per-draw modifiers you opt into:
  *"one stick only," "band under 60 s," "no coach," "left-handed," "deep vein,"
  "no transilluminator."* These are the replay engine. Cheap to build, very
  high value.
- **Personal bests, per procedure and per mode.** Fastest clean draw. Best
  entry angle. Longest flawless streak. Most consecutive accepted specimens.
- **A "clean run" record** — a full shift with no errors of any kind — as the
  aspirational top-line stat.

### 6.3 — Patients that are actually different

> **Current problem.** `makePatient` varies appearance, requisition, and
> difficulty-driven vein properties. Real variation exists but is mostly
> numeric.
>
> **Proposed rework — build a patient *archetype* library** where each one
> changes what you physically do:
>
> | Archetype | What changes physically |
> |---|---|
> | **Textbook** | Big, visible, well-anchored median cubital. The tutorial patient. |
> | **Elderly, fragile veins** | Veins visible but roll and blow easily. Lower angle, lighter anchor, smaller tubes. |
> | **Deep / obese** | Nothing visible. Palpation is *the whole challenge*. Transilluminator earns its cost here. |
> | **Dehydrated** | Flat veins. Warming pack and tourniquet timing matter enormously. |
> | **Anxious / needle-phobic** | Flinches, needs warning before the stick, vasovagal risk. Communication is a real mechanic. |
> | **Paediatric** | Small everything, butterfly required, paediatric tubes, no margin for angle error. |
> | **IV drug history / scarred** | Scarred antecubital; you must find an alternative site. |
> | **Hard stick, veteran patient** | Tells you where their good vein is — and they are right. Listening is the skill. |
> | **Anticoagulated** | Extended pressure, high bruise risk. |
> | **Mastectomy / dialysis fistula** | One arm is *contraindicated*. Checking is the entire test. |
>
> Each archetype should have a face, a voice register, a couple of lines, and a
> genuinely different physical solution. **Patient variation is the single
> biggest replayability lever available**, far more than difficulty scalars.
>
> **What the player should feel.** That they are meeting people, and that the
> next one might be hard.

### 6.4 — Shift structure and progression

- **A shift is 4-6 patients** with a running tally, escalating difficulty, and
  a shift-end summary above the per-patient debriefs.
- **Difficulty is anatomy, not multipliers** — this is already the design
  philosophy and it is correct. Keep it.
- **Unlockables should change what you can do, never just what you see.** The
  existing four (winged sets, transilluminator, warming pack, paediatric tubes)
  are exactly right. Add: butterfly gauge options, a vein finder, a second
  chair type, and a *"difficult draw" referral queue* that unlocks the hardest
  archetypes.
- **A daily/seeded patient** — one fixed random patient per day, one attempt,
  leaderboard-able against your own history. Cheap, and a strong return hook.

---

## 7. Remove, Replace, Combine, Rebuild

**Remove outright**
- The `introduce` step as a screen. (§1.2 — redistribute its content)
- All mid-procedure score banners, XP floats, section chips, and `+2 XP` step
  ticks. (§1.3)
- The 2 radian rotation quota for reading a label. (§3.4)
- "Item falls off the counter and is permanently gone." (§3.4)
- The tuck as a separately failable gesture. (§3.1)
- The stillness requirement and 0.85 s pressure ramp in palpation. (§3.2)
- Spiral-shape-as-pass/fail in cleaning. (§3.3)
- `uncap`, `safety`, and `bandage` as standalone screens — they are single
  actions inside their beats. (§1.4)
- Abstract UI sound effects (`"good"`, `"bad"`, `"tap"`). (§5.4)

**Replace entirely**
- Palpation's point-probe model → continuous feel field. (§3.2)
- Tourniquet's four-gesture routing → grab-anywhere, magnetic wrap, tension as
  the skill. (§3.1)
- Insertion's contact-lock-and-freeze → the five-phase resistance sequence. (§4.2)
- The flash flag → the full multi-channel flashback moment. (§4.3)
- The mode selector → Clinicals / Shift / Practical / Bench. (§1.5)
- The camera framing → seated operator eyeline. (§2.1)

**Combine**
- Scrub + glove + identify → one continuous opening beat. (§1.2)
- Clean + assemble + uncap → one beat, freely ordered, assembly during dry. (§1.4)
- Release + withdraw + safety + dispose → one continuous sharp-handling gesture. (§1.4)
- Pressure + bandage → one continuous aftercare gesture. (§3.6)
- Nine `buildArmScene()` calls → one `BenchSession`. (§1.1)

**Rebuild from scratch**
- **The bench session and step lifecycle.** (§1.1) — everything depends on it.
- **The camera system.** (§2.1, §2.2)
- **Handedness as a scene transform.** (§2.3)
- **The hand/pose system.** (§2.4)
- **The audio layer.** (§5.4)
- **The magnetism/assist layer.** (§5.1)

**Explicitly protect — do not touch**
- `rubric/policy.js` and the grading thresholds. Externally configurable
  clinical policy is a genuinely valuable property.
- `specimenQuality.js` and the lab acceptance model.
- `complicationRules.js` — the complication model is a real asset.
- `inversionRules.js` — already a good tactile mechanic.
- `rewards.js` arithmetic — change *when* it is shown, not what it computes.
- `accessibilityFallback.js` — must survive fully intact.
- The 600+ unit tests on pure rules modules. The pure/impure split in this
  codebase is disciplined and is what makes this rework tractable at all.

---

## 8. Priority Order

### P0 — Without these, nothing else lands

1. **`BenchSession`: one persistent scene for the whole encounter.** (§1.1)
   *Blocks nearly everything else. Do this first.*
2. **Remove all in-procedure scoring.** (§1.3) *Small, immediate, high impact.*
3. **Camera rebuild — seated operator eyeline, arm extending toward the player.** (§2.1)
4. **Palpation rebuilt as a continuous feel field.** (§3.2)
5. **Tourniquet rebuilt — grab anywhere, magnetic wrap, tension as the skill.** (§3.1)
6. **Five-phase insertion + the full flashback moment.** (§4.2, §4.3)
7. **Tray physics: no free bodies, nothing ever lost, heavy snapping.** (§3.4)
8. **The global magnetism/assist layer.** (§5.1)

### P1 — The difference between "fixed" and "excellent"

9. **Procedural audio pass.** (§5.4) *Highest value-per-hour in the document.*
10. **Handedness as a real scene transform.** (§2.3)
11. **Hands and pose library.** (§2.4)
12. **Delete the introduction step; scrub/glove as the opening beat.** (§1.2)
13. **Seventeen steps → six freely-ordered beats.** (§1.4)
14. **The four-act debrief.** (§6.1)
15. **Cleaning polish — wet sheen, evaporation, forgiving paths.** (§3.3)
16. **Collection feel — stopper pop, decaying vacuum, tube racking.** (§3.5)
17. **Weight and settle on every object.** (§5.3)

### P2 — Depth and longevity

18. **Patient archetype library.** (§6.3) *Biggest single replayability lever.*
19. **Mastery tracks and star ratings.** (§6.2)
20. **Bench sandbox mode.** (§1.5)
21. **Shift structure.** (§6.4)
22. **Technique challenges / modifiers.** (§6.2)
23. **Redirect-don't-restart on a dry stick.** (§4.4)
24. **Post-draw pressure as a held resisting act.** (§3.6)
25. **Haptics, gamepad, daily seeded patient.** (§5.6, §6.4)

---

## 9. Acceptance Criteria

**Flow and structure**
- [ ] The arm mesh and scene are constructed **once** per encounter and disposed
      once. Zero `buildArmScene()` calls after the encounter begins.
- [ ] No hard cut occurs between any two actions inside an encounter. All
      camera changes are eased transitions of ≥300 ms.
- [ ] Zero numeric scores, XP values, coin values, or grade banners appear
      between "patient sits down" and the debrief. Verifiable by asserting no
      `floatXP`/score-chip call fires during the encounter.
- [ ] A player can complete a full draw without reading any instructional text.
- [ ] Within a beat, actions can be performed in any clinically valid order,
      and invalid orders produce a *consequence*, not a blocked input.

**Camera, arm, handedness**
- [ ] The forearm extends toward the viewer with the hand nearer than the elbow.
- [ ] The patient's shoulder and face are visible in frame.
- [ ] `pointerToLimb`'s 2×2 determinant remains well-conditioned
      (|det| > 1e-3) across the full working area in the new framing.
- [ ] Toggling handedness mirrors: camera, arm presentation, tray, sharps bin,
      needle hand, anchor thumb, approach vector, and both glove meshes.
- [ ] After mirroring, wrap direction, `theta` sign, and all scoring produce
      identical grades for equivalent mirrored inputs. **This needs an explicit
      test.**

**Interaction feel**
- [ ] The tourniquet can be grabbed at any point along its length.
- [ ] A single natural drag across the arm results in a correctly wrapped,
      flat-seated band ≥90% of the time for a first-time player.
- [ ] Palpation returns continuous sensation while the pointer is moving. No
      hold timer gates any feedback.
- [ ] A player can locate an average-difficulty vein by feel in under 15
      seconds without visual cues.
- [ ] No object can become unreachable, lost, or invisible. No object ever
      jitters, tunnels, or moves without an authored animation driving it.
- [ ] Every valid drop target has an assist radius ≥3× the current values and
      shows a ghost preview plus a lean-in on the held object.
- [ ] Every object-to-object contact produces a sound.

**The stick**
- [ ] The insertion gesture produces five distinguishable phases with distinct
      visual, audio, and resistance signatures.
- [ ] Skin visibly tents before penetration, and hand travel exceeds tip travel
      during the resistance phase.
- [ ] The flashback fires ≥4 simultaneous feedback channels (fluid bloom,
      camera push, audio duck + resolve note, patient reaction, time dilation)
      within 250 ms and contains **no text**.
- [ ] Blind playtest: ≥8 of 10 players describe the flashback moment
      unprompted as the best part of the game.

**Scoring and replay**
- [ ] The debrief plays as four paced acts, not one screen.
- [ ] Every measurement is reported in its real unit.
- [ ] Personal bests are shown as they are beaten.
- [ ] "Next patient" is the most prominent control on the debrief.
- [ ] ≥8 patient archetypes exist, each requiring a *different physical
      solution*, not just different numbers.
- [ ] Mastery cannot be advanced by repetition alone — only by sustained
      quality across multiple draws.

**Preserved**
- [ ] All existing pure-rules unit tests pass, or their change is a deliberate,
      documented clinical decision.
- [ ] The accessible fallback path completes a full encounter.
- [ ] Clinical accuracy is unchanged or improved. No assistance mechanic ever
      selects a *correct target* on the player's behalf.

---

## 10. The Ideal Player Journey

> **0:00 — The sink.** You are already in the room. Water runs. You scrub —
> hands moving over each other, foam building, twenty real seconds that you can
> hear. Gloves: grab, stretch, *snap*. The room tone settles.
>
> **0:20 — The patient.** Mrs. Aldan is in the chair with her sleeve up. She
> says she's been fasting since nine. Her wristband is right there on the arm.
> You turn it to read, glance at the requisition clipped to your tray — they
> match. Two purple, one gold.
>
> **0:35 — The tray.** You rack the tubes. Each one goes in with a click and a
> small settle. It is genuinely pleasant. The sharps bin goes to your right,
> in reach. You check the needle pouch — sealed, 21G, in date.
>
> **1:00 — The band.** You pick up the tourniquet anywhere along its length —
> it has real weight and flop — and draw it across her upper arm. It wraps
> itself under and up, lands flat. You pull. The elastic pitches up. Veins rise
> along her forearm — and you stop, because you can see her fingers starting to
> pale. You back off a few millimetres. It sets with a creak.
>
> **1:20 — The search.** Two fingers on her skin. You feel as you move — a low
> sub-bass that changes under the pad. Something hard and dead: tendon. You
> slide medially and a rhythmic pulse comes up under your fingers, audible,
> in time with her heartbeat: artery. You lift off. Then — a soft swell that
> gives and springs back, and rolls slightly sideways when you press. There it
> is. You press a little harder and it *vanishes* — you flattened it — so you
> ease off and it comes back. You mark it. A small dimple, a faint pen line.
>
> **1:50 — The prep.** The swab goes wet and glossy from the centre outward,
> the skin darkening under it. While it dries — you can watch it evaporating
> from the edges — you thread the needle into the holder. It seats with a
> quarter-turn and a click, bevel up, and the bevel mark catches the light.
> The sheath pulls straight off along the axis.
>
> **2:20 — The stick.** You tell her she'll feel a sharp scratch. Her breathing
> tightens. Your left thumb goes an inch below and pulls the skin taut — you can
> see it tension. The camera pushes in. The room goes quiet. You bring the
> needle down, bevel up, low along the vein.
>
> The tip touches. The skin **tents**. You push and it *resists* — your hand
> moves further than the needle does, and you can feel the difference. A creak
> tightens.
>
> ***Pop.*** The skin gives, the tip lurches, the camera kicks 3 pixels.
>
> A few millimetres more. A second, softer give.
>
> **2:35 — Flash.** Dark red blooms into the hub in a fifth of a second. The
> room ducks. One warm low note. The camera drifts 5% closer. Mrs. Aldan
> exhales, and her shoulder drops. Time slows for a third of a second and comes
> back.
>
> You did it. Nothing on screen says so. You just know.
>
> **2:45 — Collection.** Tube onto the holder, brace the flange, push — a
> resistance, then the stopper **pops**. A hiss, and blood climbs the wall. The
> hiss decays as it fills; when it dies, you twist off, click, rack. Next tube.
> Same rhythm. Third. Racked.
>
> **3:20 — Out.** Band off first — one yank, a snap. Gauze over the site,
> needle straight back out along its own line. The safety **clacks** shut in
> your hand, and the whole unit rattles into the sharps bin.
>
> **3:35 — Aftercare.** You press the gauze down and hold. The skin blanches
> under it. Her arm is raised. You hold, and hold, and when you lift there's a
> clean puncture and no bead. Bandage peels and goes on. You invert each tube,
> end over end, and hear the fluid roll.
>
> **4:00 — She leaves.**
> *"Three tubes, one stick, no bruise. She said thank you."*
>
> Two seconds of nothing.
>
> Then the lab: three specimens, three accepted, one at a time with a sound.
>
> Then the technique: entry angle **24°**. Band on **41 seconds**. Coverage
> **96%**. Pressure held **97 seconds**. One line: *"Your band was 2 cm low —
> aim for a hand's width above the fossa."* And then, lighting up in gold:
> **new personal best — fastest clean draw.**
>
> Then everything you earned, all at once, loud.
>
> And one button, bigger than everything else on the screen:
>
> ### ▶ Next patient
>
> You press it before the animation finishes.

---

## Closing note

The clinical simulation underneath this game is better than almost anything in
its category. Nothing in this document asks to make it less rigorous — several
recommendations (free ordering within beats, redirect-don't-restart, the
occlusion mechanic in palpation, contraindicated-arm archetypes) make it *more*
rigorous, by turning things that were currently enforced into things that must
be *known*.

What has to change is everything between the model and the player's hands: one
continuous bench instead of seventeen scenes, a viewpoint instead of a diagram,
generous magnetism instead of precision taxes, diegetic feedback instead of
score banners, and one genuinely great moment — the flashback — that the whole
four minutes builds toward.

Get the bench session and the camera right first. Everything else in this
document becomes achievable once those two exist, and nearly nothing in it is
achievable while they do not.
