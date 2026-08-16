/* =========================================================================
   BENCH SESSION — one room, one patient, one arm, for the whole encounter.

   THE KEYSTONE CHANGE. Nine runtimes used to call buildArmScene() on entry
   and view.dispose() on exit, so the patient's arm was destroyed and rebuilt
   between every single step. That is why the game felt like a checklist:
   architecturally it WAS one. Every step had to re-establish context, re-fade
   in, and hand its state to the next through a serialised bundle — and the
   tourniquet you had just tied vanished the moment you stopped looking at it.

   Now there is one scene, built when the patient sits down and disposed when
   the specimens leave the room. Steps become MODES that LEASE it:

       const view = leaseBenchView({ mode: "tourniquet", arm });
       ...
       view.dispose();            // releases the lease, not the bench

   A lease gets its own `root` group, so anything a mode adds is cleaned up
   when that mode ends and nothing else is. Anything that must OUTLIVE the
   mode that created it — the band, the swab's decal, the needle unit, the
   bandage — is registered as a bench prop instead:

       const strap = view.benchProp("strap", () => buildStrap(...));

   which is built exactly once per encounter and handed back to every later
   mode that asks for it. That single mechanism is what makes the band you
   tied stay tied: it is the same object, still in the same scene, still on
   the same arm.

   The composition root does not import this. Modes do, and modes are already
   listed once in venipuncture/stepRuntimes.js.
   ========================================================================= */
import * as THREE from "three";
import { buildArmScene } from "../venipuncture/arm/armScene.js";
import { FRAMING_FOR_MODE } from "../venipuncture/arm/benchFramings.js";
import { createHandCamera } from "./handFraming.js";

let bench = null;

/**
 * What makes one bench a DIFFERENT bench. A new patient, a different arm, or
 * the operator switching hands all mean the scene has to be rebuilt; a mode
 * change never does. `condition` is the complications branch's live object and
 * is created once per encounter, which makes its identity the cleanest
 * available proxy for "is this still the same patient".
 */
function benchKey(arm){
  const a = arm || {};
  return [
    a.handedness || "right",
    a.armSide || "right",
    a.build == null ? 1 : a.build,
    a.skin == null ? "-" : a.skin,
    (a.scenarioKeys || []).join("+"),
    a.veinFinder ? "vf" : "-",
  ].join("|");
}

function open(arm){
  const view = buildArmScene(arm || {});
  const props = new Map();
  const persist = new THREE.Group();
  persist.name = "benchProps";
  view.root.add(persist);

  bench = {
    view, props, persist,
    key: benchKey(arm),
    condition: (arm || {}).condition || null,
    leases: new Set(),
    mode: null,
    /* One camera for the encounter, not one per lease. It carries what is in
       the hand and whether a gesture is in progress, both of which outlive any
       single mode — and a stale one would be exactly the sort of bug that only
       shows up on the second patient. See bench/handFraming.js. */
    camera: createHandCamera(view),
  };
  return bench;
}

/** True when a bench exists for this encounter already. */
export function benchIsOpen(){ return !!bench; }

/** The live bench view, or null. For code that must not create one. */
export function peekBench(){ return bench ? bench.view : null; }

/* =========================================================================
   THE HAND, AS THE COMPOSITION ROOT SEES IT.

   `armScene.js` re-solves the skin point under the pointer against the LIVE
   camera every frame, so a camera that eases while a finger is pressed drags
   that finger across the arm — the hand does not move, the world moves under
   it, and the stroke is recorded somewhere the learner never touched.

   Rather than asking ten runtimes each to remember that, the one place that
   already knows when a gesture starts and ends says so: main.js's canvas
   pointer wiring. A framing requested in between is held until the hand is up.
   ========================================================================= */
export function benchHandDown(){ if(bench) bench.camera.down(); }
export function benchHandUp(){ if(bench) bench.camera.up(); }

/**
 * Takes a lease on the encounter's bench, building it if this is the first
 * mode of a new encounter.
 *
 * @param {object} o
 *   arm    the same {skin, build, armSide, scenarioKeys, vigour, condition,
 *          handedness} bundle buildArmScene has always taken
 *   mode   the mode id, used to pick the beat framing (see benchFramings.js)
 * @returns a view that behaves exactly like buildArmScene's, except that
 *   `root` is private to this lease and `dispose()` releases rather than
 *   destroys.
 */
export function leaseBenchView(o){
  const opt = o || {};
  const arm = opt.arm || {};
  const key = benchKey(arm);

  // A genuinely different patient means a genuinely different bench. Rebuild
  // rather than mutate: the alternative is a scene whose skin colour is right
  // and whose vein depths are the previous patient's.
  if(bench && (bench.key !== key || (arm.condition && bench.condition && arm.condition !== bench.condition))){
    closeBench();
  }
  if(!bench) open(arm);

  const b = bench;
  const group = new THREE.Group();
  group.name = "lease:" + (opt.mode || "?");
  b.view.root.add(group);

  const lease = { group, mode: opt.mode || null, released: false };
  b.leases.add(lease);
  b.mode = lease.mode;

  /* Entering a mode is the one moment the STEP still gets to say where the
     camera looks, because the hand is empty and there is nothing else to ask.
     From then on it is whatever the learner picks up — see handFraming.js.

     Requested through the hand camera rather than applied directly, so a mode
     that opens while a finger is still down (a section replay, a complication
     answered mid-stroke) cannot yank the frame out from under it. */
  const framing = FRAMING_FOR_MODE[lease.mode];
  if(framing) b.camera.request(framing);

  /* The proxy. Prototype delegation rather than a copy, so armScene can grow
     a method without this file needing to know about it, and so its getters
     stay getters. */
  const proxy = Object.create(b.view);
  Object.defineProperty(proxy, "root", { value: group, enumerable: true });
  Object.defineProperty(proxy, "lease", { value: lease, enumerable: false });
  proxy.dispose = function(){ releaseLease(lease); };
  proxy.benchProp = function(propKey, factory){ return benchProp(propKey, factory); };
  proxy.getBenchProp = function(propKey){ return b.props.has(propKey) ? b.props.get(propKey).value : null; };
  proxy.dropBenchProp = function(propKey){ dropBenchProp(propKey); };
  /* What is in the hand, and therefore what the camera is watching. Every
     runtime reaches it through its own view, so none of them needs to know
     the bench exists. */
  proxy.hold = function(tool){ b.camera.hold(tool); };
  proxy.frameFor = function(name){ b.camera.request(name); };
  Object.defineProperty(proxy, "handCamera", { value: b.camera, enumerable: false });
  return proxy;
}

/**
 * A thing that belongs to the ENCOUNTER, not to the mode that made it.
 *
 * `factory` is called at most once per encounter and receives the group it
 * should attach to. Every later mode asking for the same key gets the same
 * object back, in the state the last mode left it in — which is the entire
 * point: a tourniquet is not re-derived from a serialised tension and an
 * elapsed second count, it is simply still there.
 */
export function benchProp(key, factory){
  if(!bench) return null;
  if(bench.props.has(key)) return bench.props.get(key).value;
  const holder = new THREE.Group();
  holder.name = "prop:" + key;
  bench.persist.add(holder);
  const value = factory ? factory(holder) : holder;
  // A factory that returns something with its own `group` (the common shape in
  // this codebase) gets that group parented for it, so callers never have to
  // remember which of the two conventions they used.
  if(value && value.group && value.group !== holder && !value.group.parent) holder.add(value.group);
  bench.props.set(key, { holder, value });
  return value;
}

/** Removes a persistent prop — a needle that went in the sharps bin, say. */
export function dropBenchProp(key){
  if(!bench || !bench.props.has(key)) return;
  const { holder, value } = bench.props.get(key);
  bench.props.delete(key);
  if(value && typeof value.dispose === "function"){ try{ value.dispose(); }catch(_){} }
  disposeSubtree(holder);
  if(holder.parent) holder.parent.remove(holder);
}

function releaseLease(lease){
  if(!bench || lease.released) return;
  lease.released = true;
  bench.leases.delete(lease);
  disposeSubtree(lease.group);
  if(lease.group.parent) lease.group.parent.remove(lease.group);
}

function disposeSubtree(objRoot){
  objRoot.traverse(obj=>{
    if(obj.geometry) obj.geometry.dispose();
    const ms = Array.isArray(obj.material) ? obj.material : (obj.material ? [obj.material] : []);
    ms.forEach(m=>{ if(m && m.userData && m.userData.perInstance && m.dispose) m.dispose(); });
  });
}

/**
 * The patient has left. Everything goes — the arm, the props, the camera rig.
 * Called from the encounter's own teardown, never from a mode.
 */
export function closeBench(){
  if(!bench) return;
  bench.leases.forEach(l => { l.released = true; });
  bench.leases.clear();
  bench.props.forEach(({ value }) => {
    if(value && typeof value.dispose === "function"){ try{ value.dispose(); }catch(_){} }
  });
  bench.props.clear();
  try{ bench.view.dispose(); }catch(_){}
  bench = null;
}

/** Diagnostics for the test seam: how many times has a scene been built? */
export function benchStats(){
  return bench
    ? {
        open: true, key: bench.key, mode: bench.mode,
        leases: bench.leases.size, props: [...bench.props.keys()],
        /** has the camera finished easing? see armScene's cameraSettled */
        settled: !!bench.view.cameraSettled,
      }
    : { open: false, key: null, mode: null, leases: 0, props: [], settled: false };
}
