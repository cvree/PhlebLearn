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
    { open: false, key: null, mode: null, leases: 0, props: [], settled: false });
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
