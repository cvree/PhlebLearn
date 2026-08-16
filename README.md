# Tiny Vials

A 3D phlebotomy practice game. You run a small draw room: greet the patient,
check who they are, prepare your work area, find a vein by feel, clean it,
build the needle, take the blood, and get the specimens to the laboratory
intact — with a body under your hands that can go wrong while you do it.

**Play it:** https://cvree.github.io/PhlebLearn/

It is a game, and it is also a practical. Everything it grades is something
you physically did, measured in real units: the angle you entered at, the
seconds the tourniquet was on, the millilitres in each tube, the grams of
pressure you held and for how long.

---

## What you actually do

The venipuncture is **seventeen real interactions**, not a slideshow with
buttons:

| | |
|---|---|
| **Introduce and identify** | Ask for the name and date of birth, in an open question. Scrub for a real twenty seconds. Glove after, not before. |
| **Prepare the work area** | Twenty-three recognisable objects on a supply cart. Turn each one over to read its label — two tubes share a cap colour and only one is in date; one needle pouch is split. Rack the tubes in order of draw. Put the sharps container in reach *before* you touch the patient. |
| **Tourniquet** | A real strap on a real arm, routed under the limb, tensioned by how far you pull, tucked so a fingertip can free it. Too tight and the hand goes pale and the radial pulse disappears. |
| **Palpate** | Feel for the vein with a fingertip. A vein bounces; a tendon is a hard cord; an artery pulses. A compliant vein rolls away from the pressure — you can feel it move. |
| **Clean** | Concentric outward spirals from the puncture site. Measure the coverage, wait the real drying time, and do not touch the field again. |
| **Assemble and uncap** | Screw the needle into its holder — where the bevel ends up pointing is wherever your turning stopped, and the next step inherits exactly that. Pull the sheath along the needle's own axis. |
| **Anchor and insert** | Thumb an inch below, skin pulled taut, then 15–30° through the skin — 5–15° for a hand vein, because there is 2 mm of tissue over it and bone underneath. Too shallow skates over; too steep goes through. |
| **Fill and switch** | Tubes come off the rack you racked. Hold the holder's flange as you push, or the needle travels with the tube. Let each vacuum exhaust itself. A big tube on a narrow vein pulls the wall shut. |
| **Release, withdraw, safety, sharps** | The band comes off before the needle. The needle comes out along the line it went in. The safety locks in your hand, at the point of use, and the whole unit goes into the container you staged. |
| **Pressure and bandage** | A real force held on the real puncture for as long as *this* patient's clotting needs — longer if they told you they are on anticoagulants. Peeking costs you progress. The dressing waits for haemostasis. |
| **Invert** | Each tube end over end, to its own additive's count. A plain serum tube must not be mixed at all. Shake one and you have haemolysed it. |

Choose a **butterfly set on the back of the hand** and it is a genuinely
different procedure: 23G, a different entry window, a different anchor, and
tubing that transmits every tug to the tip.

## What can go wrong

The draw can fail the way a real one does, caused by what you did:

🩸 hematoma · 💢 blown vein · 🫥 dry stick · 🫗 vein collapsing under the vacuum
· ⚡ nerve contact · 🚨 arterial puncture · 😣 a patient who flinches because
nobody warned them · 😵‍💫 a patient going vasovagal

Each announces itself the way it would at the chair — a lump rising, flow
stopping, a face going damp and quiet — and you get one answer. Stopping the
draw is often the right one, and it really does stop the draw: the report is
built from the tubes you actually collected. Probing around for it makes it
worse, and the bruise appears on the arm.

Then the laboratory looks at what you sent. Each tube is accepted, accepted
with a comment, or rejected, with the reason stated the way a lab states it —
and a rejection names the tests the patient has to be drawn again for.

## One patient, start to finish

They arrive with their requisition → assess the arms, if they need it → the
draw → label the tubes and decide how they travel → answer whatever they
asked you → the score, and your practical report.

Identification, tube selection and order of draw are not questions you answer
before the draw; they are things you do inside it, at the patient and at the
cart. Nothing asks you twice.

## Two ways to work

| Mode | What it tells you |
|---|---|
| 🎓 **Learn** | Full teaching. Names the specific error, tells you the correct next action, and will not let you continue until the step is right. Each section's own measurements arrive when it ends, and you may replay it. |
| 🩸 **Play** | Nothing. No instruction, no hint, no verdict, no step counter, and no button between one step and the next — the action that ends a step ends it. Then a rubric report: 0–4 per row against configurable thresholds, automatic-failure events, and a replay built from the steps' own logs. |

There used to be four, which is four answers to the two questions a learner
actually arrives with. Practice's two good ideas — feedback at the end of a
section, and being allowed to replay it — are teaching rather than testing, so
they live in Learn now.

Bests are tracked per mode, because a 26/28 with the coach talking is not the
same achievement as one scored in silence.

## Getting paid

Every step you finish pays a little. Every **section** you finish pays
properly, scaled by its own 0–100 measurement — the same number the rubric
grades from, so the reward and the assessment can never disagree. Three clean
sections in a row starts a streak; a section below 60 breaks it and pays
nothing. The end of the draw settles up on outcomes: how much you finished,
whether every section was clean, whether every specimen was accepted, whether
you missed nothing.

Clicking through cannot out-earn technique. That is arithmetic, not policy —
see `src/game/rewards.js`.

## Progress

Coins from good draws buy the room — and four pieces of **equipment that
change what you can do**: winged sets (you choose the device), a
transilluminator (deep veins become visible; your fingers still have to
confirm them), a warming pack (flat veins fill better), and paediatric tubes
(a vacuum a small vein can actually supply). As your lifetime earnings climb,
so does the difficulty — and difficulty here is *anatomy*: veins that roll,
veins that sit deeper, veins narrow enough to collapse.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173/
npm run build      # → dist/
npm run preview    # serves the production build

npm test           # 600+ unit tests, no browser needed
npm run test:e2e   # Playwright, against the production build
npm run verify     # all three, in order — run before merging
```

## Where things are

```
src/
  config.js utils.js dom.js fx.js     shared leaves
  game/          save, XP/coins, upgrades, patient generation, scoring
  audio/  rendering/  world/          the room, the renderer, the props
  venipuncture/                       the procedure
    <step>/                           one directory per real interaction:
                                      state (pure) · rules (pure) ·
                                      runtime (THREE) · coach (DOM) ·
                                      scoring (measurements)
    complications/  specimen/         the two draw-scoped layers
    rubric/                           policy, grading, report, replay
  input/  ui/                         pointers, screens, overlays
  main.js                             composition root
```

Deeper reading, in order of usefulness:

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the module layering and why
  it is shaped that way
- [`ROADMAP.md`](ROADMAP.md) — every phase, what it delivered, and the bugs it
  found
- [`docs/TESTING.md`](docs/TESTING.md) — the three test layers and the traps
  that outlive any one branch
- [`docs/HANDOFF.md`](docs/HANDOFF.md) — conventions worth knowing before
  adding a branch
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — GitHub Pages, and the base-path
  bug that once shipped

## A note on the content

Every patient, name and requisition in this game is fictional. The clinical
content follows standard CLSI order of draw and ordinary teaching practice,
and the grading thresholds in
[`src/venipuncture/rubric/policy.js`](src/venipuncture/rubric/policy.js) are
**documented defaults, not any particular programme's published policy** —
they are in one editable file precisely so a programme can replace them with
its own. This is a practice tool. It is not a substitute for supervised
clinical training, and nothing here should be used to certify anyone.
