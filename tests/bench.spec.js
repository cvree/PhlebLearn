/* =========================================================================
   THE BENCH SESSION — the keystone acceptance criterion.

   "The arm mesh and scene are constructed once per encounter and disposed
   once. Zero buildArmScene() calls after the encounter begins."

   The real scene needs a browser, so this file asserts the LEASE PROTOCOL
   that guarantees it, against a stub scene. That is the honest boundary: what
   can go wrong here is not three.js, it is the bookkeeping — a mode that
   disposes the bench instead of its own lease, a prop that gets rebuilt every
   step, an encounter that quietly opens a second scene.
   ========================================================================= */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

/* --- a scene graph stub, just enough of three.js's shape ------------------- */
class Node {
  constructor(name){ this.name = name || ""; this.children = []; this.parent = null; this.scale = { z: 1 }; }
  add(...objs){ for(const o of objs){ o.parent = this; this.children.push(o); } return this; }
  remove(o){ this.children = this.children.filter(c => c !== o); o.parent = null; return this; }
  traverse(fn){ fn(this); this.children.forEach(c => c.traverse(fn)); }
  updateMatrixWorld(){}
}

let built = 0;
let disposed = 0;

/* The bench session imports armScene at module load, so the stub is installed
   by module mocking rather than by injection — this file is testing the lease
   protocol, and the scene it leases is deliberately not the subject. */
const { mock } = await import("node:test");
mock.module("../src/venipuncture/arm/armScene.js", {
  namedExports: {
    buildArmScene(){
      built++;
      const root = new Node("root");
      return {
        scene: new Node("scene"), camera: {}, root,
        arm: { vessels: [] }, body: {},
        frameBeat(){}, fitCamera(){}, tick(){}, setSiteVisible(){},
        setLean(){}, setSway(){}, kickCamera(){},
        dispose(){ disposed++; },
        get framing(){ return null; },
      };
    },
  },
});
mock.module("../src/venipuncture/arm/benchFramings.js", {
  namedExports: { FRAMINGS: {}, DEFAULT_FRAMING: {}, FRAMING_FOR_MODE: { tourniquet: "access" } },
});
mock.module("three", {
  namedExports: { Group: Node },
  defaultExport: { Group: Node },
});

const bench = await import("../src/bench/benchSession.js");

beforeEach(() => { bench.closeBench(); built = 0; disposed = 0; });

const ARM = { handedness: "right", armSide: "left", build: 1, skin: 0xe6b98f, scenarioKeys: [], condition: {} };

test("ten modes leasing the same encounter build exactly ONE scene", () => {
  const modes = ["tourniquet","palpation","cleaning","assembly","insert",
                 "collection","withdrawal","postdraw","inversion","tourniquet"];
  for(const mode of modes){
    const view = bench.leaseBenchView({ mode, arm: ARM });
    view.dispose();                    // a mode ending releases ITS lease
  }
  assert.equal(built, 1, `built ${built} scenes for one encounter`);
  assert.equal(disposed, 0, "no mode may dispose the bench");
  assert.equal(bench.benchIsOpen(), true, "the bench survives every mode change");
});

test("the encounter ending disposes the scene exactly once", () => {
  bench.leaseBenchView({ mode: "tourniquet", arm: ARM }).dispose();
  bench.closeBench();
  assert.equal(disposed, 1);
  assert.equal(bench.benchIsOpen(), false);
  bench.closeBench();
  assert.equal(disposed, 1, "closing twice must not dispose twice");
});

test("a lease owns only what its own mode added", () => {
  const a = bench.leaseBenchView({ mode: "tourniquet", arm: ARM });
  const root = bench.peekBench().root;
  const before = root.children.length;
  a.root.add(new Node("aProp"));
  assert.equal(a.root.children.length, 1);
  a.dispose();
  assert.equal(root.children.length, before - 1, "the lease group goes with the lease");
});

test("a BENCH PROP outlives the mode that made it — the band stays tied", () => {
  const a = bench.leaseBenchView({ mode: "tourniquet", arm: ARM });
  const strap = a.benchProp("strap", () => ({ group: new Node("strap"), tension: 0.55 }));
  strap.tension = 0.62;                       // the learner tensioned it
  a.dispose();                                 // the tourniquet step ends

  const b = bench.leaseBenchView({ mode: "palpation", arm: ARM });
  const same = b.benchProp("strap", () => { throw new Error("rebuilt the band"); });
  assert.equal(same, strap, "it must be the SAME object, not one drawn to match");
  assert.equal(same.tension, 0.62, "and still in the state the last mode left it in");
  assert.equal(b.getBenchProp("strap"), strap);
});

test("a prop can be thrown away deliberately — a needle in the sharps bin", () => {
  const a = bench.leaseBenchView({ mode: "insert", arm: ARM });
  let gone = false;
  a.benchProp("needle", () => ({ group: new Node("needle"), dispose(){ gone = true; } }));
  a.dropBenchProp("needle");
  assert.equal(gone, true);
  assert.equal(a.getBenchProp("needle"), null);
});

test("a DIFFERENT patient gets a different bench, and only then", () => {
  bench.leaseBenchView({ mode: "tourniquet", arm: ARM }).dispose();
  assert.equal(built, 1);

  // same patient, different mode: no rebuild
  bench.leaseBenchView({ mode: "insert", arm: ARM }).dispose();
  assert.equal(built, 1);

  // a new patient: rebuild, and dispose the old one exactly once
  bench.leaseBenchView({ mode: "tourniquet", arm: Object.assign({}, ARM, { skin: 0x333333, condition: {} }) }).dispose();
  assert.equal(built, 2);
  assert.equal(disposed, 1);
});

test("switching hands rebuilds, because the mirror is baked into the root", () => {
  bench.leaseBenchView({ mode: "tourniquet", arm: ARM }).dispose();
  bench.leaseBenchView({ mode: "tourniquet", arm: Object.assign({}, ARM, { handedness: "left" }) }).dispose();
  assert.equal(built, 2);
});

test("benchStats reports what is open, for the acceptance test to read", () => {
  assert.deepEqual(bench.benchStats(),
    { open: false, key: null, mode: null, modes: [], leases: 0, props: [], settled: false });
  const v = bench.leaseBenchView({ mode: "cleaning", arm: ARM });
  v.benchProp("decal", () => ({ group: new Node("decal") }));
  const s = bench.benchStats();
  assert.equal(s.open, true);
  assert.equal(s.mode, "cleaning");
  assert.equal(s.leases, 1);
  assert.deepEqual(s.props, ["decal"]);
  /* `settled` is the camera's own answer to "have you finished easing?", and
     it exists purely so an acceptance test can wait on the MOVE rather than on
     a clock before projecting a screen point. The stub view here has no rig,
     so all this asserts is that the field is reported at all. */
  assert.equal("settled" in s, true);
});

/* =========================================================================
   TWO LEASES AT ONCE — the protocol the dispatcher inversion needs.

   Written BEFORE any runtime is changed, deliberately. Today the draw is a
   relay: one mode holds the bench, hands over, and the next takes it. What
   "make the process more natural" asks for is a bench where reaching for a
   tube does not first require the band's step to end — which means a tube
   runtime leased while the band runtime is still leased.

   The lease protocol was written to permit that and has never once been asked
   to do it. These tests are what "permit" has to mean in practice, and every
   one of them is a bug that would otherwise be found on the second overlap
   rather than the first: a shared scene, independent teardown in either
   order, props that belong to neither lease, and a `mode` that answers
   honestly when the answer is "two of them".
   ========================================================================= */

test("two modes can hold the bench at the same time, and it is still one scene", () => {
  const band = bench.leaseBenchView({ mode: "tourniquet", arm: ARM });
  const tube = bench.leaseBenchView({ mode: "collection", arm: ARM });

  assert.equal(built, 1, "the second lease must not open a second scene");
  assert.equal(disposed, 0);
  assert.equal(bench.benchStats().leases, 2);

  // Same bench, same arm — literally, not a copy that matches.
  assert.equal(Object.getPrototypeOf(band), Object.getPrototypeOf(tube));
  assert.equal(band.arm, tube.arm);
  assert.notEqual(band.root, tube.root, "…but each mode owns its own group");
});

test("a second lease does not adopt the first one's scenery", () => {
  const band = bench.leaseBenchView({ mode: "tourniquet", arm: ARM });
  band.root.add(new Node("strapGhost"));
  const tube = bench.leaseBenchView({ mode: "collection", arm: ARM });
  assert.equal(tube.root.children.length, 0,
    "a mode that opens second must start with an empty stage of its own");
  assert.equal(band.root.children.length, 1);
});

test("releasing one lease leaves the other one's scenery standing", () => {
  const band = bench.leaseBenchView({ mode: "tourniquet", arm: ARM });
  const tube = bench.leaseBenchView({ mode: "collection", arm: ARM });
  band.root.add(new Node("strapGhost"));
  tube.root.add(new Node("tube"));

  band.dispose();
  assert.equal(bench.benchIsOpen(), true, "one mode ending is not the encounter ending");
  assert.equal(disposed, 0);
  assert.equal(tube.root.children.length, 1, "the tube went with the band");
  assert.equal(bench.benchStats().leases, 1);
});

test("leases release correctly in either order", () => {
  // The obvious implementation — a single `current lease` — passes the test
  // above and fails this one, which is the whole reason it is here.
  const first = bench.leaseBenchView({ mode: "tourniquet", arm: ARM });
  const second = bench.leaseBenchView({ mode: "collection", arm: ARM });
  second.dispose();
  assert.equal(bench.benchStats().leases, 1);
  first.root.add(new Node("stillHere"));
  assert.equal(first.root.children.length, 1, "the surviving lease still has a live group");
  first.dispose();
  assert.equal(bench.benchStats().leases, 0);
  assert.equal(disposed, 0, "and the bench outlives both");
});

test("disposing the same lease twice is not a way to close somebody else's", () => {
  const band = bench.leaseBenchView({ mode: "tourniquet", arm: ARM });
  const tube = bench.leaseBenchView({ mode: "collection", arm: ARM });
  band.dispose();
  band.dispose();
  assert.equal(bench.benchStats().leases, 1, "the second release must be a no-op");
  assert.equal(bench.benchStats().mode, "collection");
});

test("a bench prop belongs to the encounter, not to whichever lease asked first", () => {
  // The band is the case: tied under the tourniquet lease, still on the arm
  // while the collection lease fills tubes, and released by neither.
  const band = bench.leaseBenchView({ mode: "tourniquet", arm: ARM });
  const strap = band.benchProp("strap", () => ({ group: new Node("strap"), tension: 0.6 }));
  const tube = bench.leaseBenchView({ mode: "collection", arm: ARM });
  assert.equal(tube.getBenchProp("strap"), strap);
  band.dispose();
  assert.equal(tube.getBenchProp("strap"), strap, "the band came off with the step that tied it");
  assert.equal(strap.tension, 0.6);
});

test("the bench names every mode holding it, not just the newest", () => {
  const band = bench.leaseBenchView({ mode: "tourniquet", arm: ARM });
  assert.deepEqual(bench.benchStats().modes, ["tourniquet"]);
  const tube = bench.leaseBenchView({ mode: "collection", arm: ARM });
  assert.deepEqual(bench.benchStats().modes, ["tourniquet", "collection"]);

  /* `mode` stays singular and means "the most recent mode to take the bench",
     because that is what the framing table and the diagnostics read. What must
     not happen is the newest lease ending and leaving the bench claiming to be
     in a mode nobody is in. */
  assert.equal(bench.benchStats().mode, "collection");
  tube.dispose();
  assert.equal(bench.benchStats().mode, "tourniquet", "…and it goes back to whoever is still here");
  band.dispose();
  assert.equal(bench.benchStats().mode, null);
});

test("the encounter ending takes both leases with it", () => {
  const band = bench.leaseBenchView({ mode: "tourniquet", arm: ARM });
  const tube = bench.leaseBenchView({ mode: "collection", arm: ARM });
  bench.closeBench();
  assert.equal(disposed, 1, "one scene, disposed once, however many modes were holding it");
  assert.equal(bench.benchIsOpen(), false);
  // and a late dispose from a runtime that had not noticed must not throw
  band.dispose();
  tube.dispose();
  assert.equal(bench.benchIsOpen(), false);
});

test("a new patient arriving mid-overlap rebuilds once, not once per lease", () => {
  bench.leaseBenchView({ mode: "tourniquet", arm: ARM });
  bench.leaseBenchView({ mode: "collection", arm: ARM });
  const next = Object.assign({}, ARM, { skin: 0x333333, condition: {} });
  bench.leaseBenchView({ mode: "tourniquet", arm: next });
  assert.equal(built, 2);
  assert.equal(disposed, 1);
  assert.equal(bench.benchStats().leases, 1, "the old patient's leases do not follow them out");
});

test("both leases share one hand, because there is only one hand", () => {
  // Two runtimes leased at once is exactly when a per-lease camera would go
  // wrong: the tube runtime would not know a finger was down on the band.
  const band = bench.leaseBenchView({ mode: "tourniquet", arm: ARM });
  const tube = bench.leaseBenchView({ mode: "collection", arm: ARM });
  assert.equal(band.handCamera, tube.handCamera);
  band.hold("band");
  assert.equal(tube.handCamera.held, "band");
});
