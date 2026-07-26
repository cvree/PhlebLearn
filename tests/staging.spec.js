/* =========================================================================
   Acceptance tests for physical supply staging (branch:
   feature/physical-supply-staging). Pure logic — run with `npm test`.

   These exercise the SAME functions the 3D drag controller and the
   accessible list view both call, so a pass here means both input paths
   behave identically.
   ========================================================================= */
import test from "node:test";
import assert from "node:assert/strict";

import { buildSupplyCatalog, CATEGORY, FLAW, catalogById, isUsable } from "../src/venipuncture/staging/supplyCatalog.js";
import {
  createStagingState, placeItem, inspectItem, setHandedness, markContaminated,
  ZONE, HAND, stagedIds,
} from "../src/venipuncture/staging/stagingState.js";
import { createLayout, zoneAt, rackSlotAt, crossesField } from "../src/venipuncture/staging/stagingLayout.js";
import { evaluateStaging, ISSUE, nextIssue } from "../src/venipuncture/staging/stagingRules.js";
import { measureStaging } from "../src/venipuncture/staging/stagingScoring.js";
import { registerModel, preloadModels, createModelInstance, isRegistered } from "../src/rendering/modelRegistry.js";

const REQUIRED = ["lightblue", "lavender"];      // order of draw: light blue (2) then lavender (7)

function seed(){
  let n = 0;
  const rng = ()=>{ n = (n*1103515245 + 12345) % 2147483648; return n/2147483648; };
  const catalog = buildSupplyCatalog({
    requiredTubes: REQUIRED,
    patientName: "Rosa Delacroix",
    otherPatientName: "T. Underwood",
    rng,
  });
  const state = createStagingState({ catalog, requiredTubes: REQUIRED, handedness: HAND.RIGHT, now: 0 });
  const layout = createLayout({ handedness: HAND.RIGHT, tubeCount: REQUIRED.length, shelfCount: catalog.length });
  return { catalog, state, layout, byId: catalogById(catalog) };
}

/** Stages a fully correct work area. Returns the harness. */
function stageEverythingCorrectly(h, opts){
  const o = opts||{};
  const find = (cat, pred)=>h.catalog.find(d=>d.category===cat && isUsable(d) && (!pred || pred(d)));
  [CATEGORY.GLOVES, CATEGORY.TOURNIQUET, CATEGORY.ALCOHOL, CATEGORY.NEEDLE,
   CATEGORY.HOLDER, CATEGORY.GAUZE, CATEGORY.BANDAGE].forEach(cat=>{
    const d = find(cat);
    assert.ok(d, `catalog is missing a usable ${cat}`);
    if(o.inspectFirst) inspectItem(h.state, d.id);
    placeItem(h.state, d.id, ZONE.TRAY, { pos:{ x:h.layout.tray.cx, z:h.layout.tray.cz } });
  });
  REQUIRED.forEach((k, i)=>{
    const d = find(CATEGORY.TUBE, x=>x.tubeKey===k);
    placeItem(h.state, d.id, ZONE.RACK, { slot:i });
  });
  if(!o.skipSharps){
    const sharps = find(CATEGORY.SHARPS);
    placeItem(h.state, sharps.id, ZONE.REACH, { pos:{ x:h.layout.reach.cx, z:h.layout.reach.cz } });
  }
  return h;
}

/* ---------- completion ---------------------------------------------------- */

test("a correctly staged work area allows completion", () => {
  const h = stageEverythingCorrectly(seed());
  const r = evaluateStaging(h.state, h.catalog);
  assert.equal(r.ready, true, `expected ready, blocked by: ${r.issues.map(i=>i.code).join(", ")}`);
});

test("a missing required item blocks completion, and says which one", () => {
  const h = stageEverythingCorrectly(seed());
  const gauze = h.catalog.find(d=>d.category===CATEGORY.GAUZE && isUsable(d));
  placeItem(h.state, gauze.id, ZONE.SHELF, {});
  const r = evaluateStaging(h.state, h.catalog);
  assert.equal(r.ready, false);
  assert.ok(r.issues.some(i=>i.code===ISSUE.MISSING && i.category===CATEGORY.GAUZE));
});

test("a correct item left on the counter instead of the tray blocks completion", () => {
  const h = stageEverythingCorrectly(seed());
  const tq = h.catalog.find(d=>d.category===CATEGORY.TOURNIQUET && isUsable(d));
  placeItem(h.state, tq.id, ZONE.COUNTER, { pos:{ x:0.6, z:0.3 } });
  const r = evaluateStaging(h.state, h.catalog);
  assert.equal(r.ready, false);
  assert.ok(r.issues.some(i=>i.code===ISSUE.NOT_ON_TRAY), "a usable item in an unusable position must be called out specifically");
});

/* ---------- wrong / unsafe items ------------------------------------------ */

test("a tube the requisition never asked for does not count and blocks readiness", () => {
  const h = stageEverythingCorrectly(seed());
  const wrong = h.catalog.find(d=>d.category===CATEGORY.TUBE && (d.flaws||[]).includes(FLAW.WRONG_ITEM));
  placeItem(h.state, wrong.id, ZONE.TRAY, {});
  const r = evaluateStaging(h.state, h.catalog);
  assert.equal(r.ready, false);
  assert.ok(r.issues.some(i=>i.itemId===wrong.id && i.code===ISSUE.TUBE_EXTRA));
});

test("an expired tube does not count as the required tube", () => {
  const h = seed();
  stageEverythingCorrectly(h);
  const expired = h.catalog.find(d=>(d.flaws||[]).includes(FLAW.EXPIRED));
  const good = h.catalog.find(d=>d.category===CATEGORY.TUBE && isUsable(d) && d.tubeKey===expired.tubeKey);
  // swap the good tube out for the expired one of the same colour
  const slot = h.state.items[good.id].slot;
  placeItem(h.state, good.id, ZONE.SHELF, {});
  placeItem(h.state, expired.id, ZONE.RACK, { slot });
  const r = evaluateStaging(h.state, h.catalog);
  assert.equal(r.ready, false);
  assert.ok(r.issues.some(i=>i.itemId===expired.id), "the expired tube must be flagged");
  assert.ok(r.issues.some(i=>i.code===ISSUE.TUBE_MISSING && i.tubeKey===expired.tubeKey),
    "the required tube must still be reported as missing — an expired one is not a substitute");
});

test("a damaged sterile package does not count as the required needle", () => {
  const h = seed();
  const good = h.catalog.find(d=>d.category===CATEGORY.NEEDLE && isUsable(d));
  const damaged = h.catalog.find(d=>d.category===CATEGORY.NEEDLE && (d.flaws||[]).includes(FLAW.DAMAGED));
  stageEverythingCorrectly(h);
  placeItem(h.state, good.id, ZONE.SHELF, {});
  placeItem(h.state, damaged.id, ZONE.TRAY, {});
  const r = evaluateStaging(h.state, h.catalog);
  assert.equal(r.ready, false);
  assert.ok(r.issues.some(i=>i.itemId===damaged.id && i.code===ISSUE.UNUSABLE));
  assert.match(nextIssue(r).message, /sterile|sterility/i);
});

test("a wrong-gauge needle is rejected with a reason, not silently ignored", () => {
  const h = seed();
  const good = h.catalog.find(d=>d.category===CATEGORY.NEEDLE && isUsable(d));
  const wrong = h.catalog.find(d=>(d.flaws||[]).includes(FLAW.WRONG_GAUGE));
  stageEverythingCorrectly(h);
  placeItem(h.state, good.id, ZONE.SHELF, {});
  placeItem(h.state, wrong.id, ZONE.TRAY, {});
  const r = evaluateStaging(h.state, h.catalog);
  assert.equal(r.ready, false);
  const issue = r.issues.find(i=>i.itemId===wrong.id);
  assert.ok(issue && issue.message.length > 30, "a wrong item must come with a real explanation");
});

test("a tube labelled for another patient raises a safety issue", () => {
  const h = stageEverythingCorrectly(seed());
  const wrongPatient = h.catalog.find(d=>(d.flaws||[]).includes(FLAW.WRONG_PATIENT));
  placeItem(h.state, wrongPatient.id, ZONE.TRAY, {});
  const r = evaluateStaging(h.state, h.catalog);
  assert.equal(r.ready, false);
  const issue = r.issues.find(i=>i.code===ISSUE.TUBE_WRONG_PATIENT);
  assert.ok(issue, "a pre-labelled tube from another patient must be its own issue code");
  assert.equal(issue.safety, true);
});

test("unsafe non-blood equipment (syringe, urine cup, cotton) blocks readiness", () => {
  for(const flawId of ["syringe_decoy", "urine_cup_decoy", "gauze_cotton"]){
    const h = stageEverythingCorrectly(seed());
    placeItem(h.state, flawId, ZONE.TRAY, {});
    const r = evaluateStaging(h.state, h.catalog);
    assert.equal(r.ready, false, `${flawId} must block readiness`);
    assert.ok(r.issues.some(i=>i.itemId===flawId && i.code===ISSUE.UNSAFE_ITEM));
  }
});

/* ---------- order of draw --------------------------------------------------- */

test("an incorrect tube order blocks readiness and names the correct sequence", () => {
  const h = seed();
  stageEverythingCorrectly(h);
  const a = h.catalog.find(d=>d.category===CATEGORY.TUBE && isUsable(d) && d.tubeKey===REQUIRED[0]);
  const b = h.catalog.find(d=>d.category===CATEGORY.TUBE && isUsable(d) && d.tubeKey===REQUIRED[1]);
  placeItem(h.state, a.id, ZONE.RACK, { slot:1 });
  placeItem(h.state, b.id, ZONE.RACK, { slot:0 });
  const r = evaluateStaging(h.state, h.catalog);
  assert.equal(r.ready, false);
  const issue = r.issues.find(i=>i.code===ISSUE.TUBE_ORDER);
  assert.ok(issue);
  assert.match(issue.message, /Light blue → Lavender/);
});

test("the correct tube order unlocks readiness", () => {
  const h = stageEverythingCorrectly(seed());
  assert.equal(evaluateStaging(h.state, h.catalog).ready, true);
  const order = evaluateStaging(h.state, h.catalog).checks[CATEGORY.TUBE].order;
  assert.deepEqual(order, REQUIRED);
});

test("a required tube loose on the tray instead of in the rack blocks readiness", () => {
  const h = stageEverythingCorrectly(seed());
  const t = h.catalog.find(d=>d.category===CATEGORY.TUBE && isUsable(d) && d.tubeKey===REQUIRED[0]);
  placeItem(h.state, t.id, ZONE.TRAY, {});
  const r = evaluateStaging(h.state, h.catalog);
  assert.equal(r.ready, false);
  assert.ok(r.issues.some(i=>i.code===ISSUE.TUBE_NOT_RACKED && i.itemId===t.id));
});

/* ---------- sharps container ------------------------------------------------ */

test("a sharps container outside the reach zone blocks readiness", () => {
  const h = stageEverythingCorrectly(seed());
  const sharps = h.catalog.find(d=>d.category===CATEGORY.SHARPS && isUsable(d));
  placeItem(h.state, sharps.id, ZONE.COUNTER, { pos:{ x:-0.6, z:-0.3 } });
  const r = evaluateStaging(h.state, h.catalog);
  assert.equal(r.ready, false);
  assert.ok(r.issues.some(i=>i.code===ISSUE.SHARPS_OUT_OF_REACH));
});

test("a sharps container placed past the patient's arm blocks readiness", () => {
  const h = stageEverythingCorrectly(seed());
  const sharps = h.catalog.find(d=>d.category===CATEGORY.SHARPS && isUsable(d));
  placeItem(h.state, sharps.id, ZONE.ACROSS, { pos:{ x:h.layout.across.cx, z:h.layout.across.cz } });
  const r = evaluateStaging(h.state, h.catalog);
  assert.equal(r.ready, false);
  assert.ok(r.issues.some(i=>i.code===ISSUE.SHARPS_ACROSS_FIELD));
});

test("an overfilled sharps container blocks readiness", () => {
  const h = seed();
  stageEverythingCorrectly(h);
  const good = h.catalog.find(d=>d.category===CATEGORY.SHARPS && isUsable(d));
  const full = h.catalog.find(d=>(d.flaws||[]).includes(FLAW.OVERFILLED));
  placeItem(h.state, good.id, ZONE.SHELF, {});
  placeItem(h.state, full.id, ZONE.REACH, {});
  const r = evaluateStaging(h.state, h.catalog);
  assert.equal(r.ready, false);
  assert.ok(r.issues.some(i=>i.code===ISSUE.SHARPS_UNUSABLE && i.itemId===full.id));
});

test("a closed sharps container blocks readiness", () => {
  const h = seed();
  stageEverythingCorrectly(h);
  const good = h.catalog.find(d=>d.category===CATEGORY.SHARPS && isUsable(d));
  const closed = h.catalog.find(d=>(d.flaws||[]).includes(FLAW.CLOSED));
  placeItem(h.state, good.id, ZONE.SHELF, {});
  placeItem(h.state, closed.id, ZONE.REACH, {});
  const r = evaluateStaging(h.state, h.catalog);
  assert.equal(r.ready, false);
  assert.ok(r.issues.some(i=>i.code===ISSUE.SHARPS_UNUSABLE));
});

/* ---------- object permanence ------------------------------------------------ */

test("an item stays exactly where it was released", () => {
  const h = seed();
  const d = h.catalog.find(x=>x.category===CATEGORY.GAUZE && isUsable(x));
  placeItem(h.state, d.id, ZONE.TRAY, { pos:{ x:-0.137, z:0.092 } });
  assert.deepEqual(h.state.items[d.id].pos, { x:-0.137, z:0.092 });
  // a later, unrelated placement must not move it
  placeItem(h.state, "gloves_ok", ZONE.TRAY, { pos:{ x:-0.30, z:0.10 } });
  assert.deepEqual(h.state.items[d.id].pos, { x:-0.137, z:0.092 }, "released objects must not be reset");
});

test("a wrong item does not disappear on its own, and can be removed and replaced", () => {
  const h = stageEverythingCorrectly(seed());
  const wrong = h.catalog.find(d=>(d.flaws||[]).includes(FLAW.WRONG_GAUGE));
  const good = h.catalog.find(d=>d.category===CATEGORY.NEEDLE && isUsable(d));
  placeItem(h.state, good.id, ZONE.SHELF, {});
  placeItem(h.state, wrong.id, ZONE.TRAY, { pos:{ x:-0.2, z:0.1 } });

  assert.ok(stagedIds(h.state).includes(wrong.id), "the wrong item must stay on the tray until the learner removes it");
  assert.equal(evaluateStaging(h.state, h.catalog).ready, false);

  placeItem(h.state, wrong.id, ZONE.SHELF, {});
  placeItem(h.state, good.id, ZONE.TRAY, {});
  assert.equal(evaluateStaging(h.state, h.catalog).ready, true, "replacing the wrong item must recover");
});

test("an item dropped off the counter is contaminated and can no longer be staged", () => {
  const h = stageEverythingCorrectly(seed());
  const gauze = h.catalog.find(d=>d.category===CATEGORY.GAUZE && isUsable(d));
  placeItem(h.state, gauze.id, ZONE.FLOOR, { pos:{ x:0.9, z:0.9 } });
  assert.equal(h.state.items[gauze.id].contaminated, true);
  placeItem(h.state, gauze.id, ZONE.TRAY, {});
  const r = evaluateStaging(h.state, h.catalog);
  assert.equal(r.ready, false);
  assert.ok(r.issues.some(i=>i.code===ISSUE.CONTAMINATED && i.itemId===gauze.id));
});

/* ---------- handedness ------------------------------------------------------- */

test("left-handed mode mirrors the staging zones", () => {
  const right = createLayout({ handedness: HAND.RIGHT, tubeCount:2, shelfCount:20 });
  const left  = createLayout({ handedness: HAND.LEFT,  tubeCount:2, shelfCount:20 });

  assert.ok(right.tray.cx < 0, "a right-handed learner stages on their left");
  assert.ok(left.tray.cx > 0, "a left-handed learner stages on their right");
  assert.ok(Math.abs(right.tray.cx + left.tray.cx) < 1e-9, "the tray must be an exact mirror");
  assert.ok(Math.abs(right.reach.cx + left.reach.cx) < 1e-9, "the sharps reach zone must be an exact mirror");
  assert.ok(Math.abs(right.arm.cx + left.arm.cx) < 1e-9);

  // the SAME world point classifies differently depending on handedness
  const p = { x: right.tray.cx, z: right.tray.cz };
  assert.equal(zoneAt(right, p.x, p.z), ZONE.TRAY);
  assert.notEqual(zoneAt(left, p.x, p.z), ZONE.TRAY);
  assert.equal(zoneAt(left, -p.x, p.z), ZONE.TRAY);
});

test("switching handedness mid-staging mirrors what is already on the counter", () => {
  const h = seed();
  placeItem(h.state, "gloves_ok", ZONE.TRAY, { pos:{ x:-0.22, z:0.06 } });
  setHandedness(h.state, HAND.LEFT);
  assert.equal(h.state.handedness, HAND.LEFT);
  assert.deepEqual(h.state.items.gloves_ok.pos, { x:0.22, z:0.06 });
  assert.equal(h.state.items.gloves_ok.zone, ZONE.TRAY, "a correctly staged item must stay correctly staged");
});

test("crossesField reports the dominant side for each handedness", () => {
  const right = createLayout({ handedness: HAND.RIGHT, tubeCount:1, shelfCount:20 });
  const left  = createLayout({ handedness: HAND.LEFT,  tubeCount:1, shelfCount:20 });
  assert.equal(crossesField(right, 0.3), true,  "right-handed: staging on the right crosses the field");
  assert.equal(crossesField(right, -0.3), false);
  assert.equal(crossesField(left, -0.3), true);
  assert.equal(crossesField(left, 0.3), false);
});

/* ---------- rack geometry ----------------------------------------------------- */

test("the rack only accepts a tube when the pointer is actually over it", () => {
  const layout = createLayout({ handedness: HAND.RIGHT, tubeCount:3, shelfCount:20 });
  assert.equal(rackSlotAt(layout, layout.rack.cx, layout.rack.cz, 3), 1, "the middle of a 3-slot rack is slot 1");
  assert.equal(rackSlotAt(layout, layout.rack.cx, layout.rack.cz + 0.30, 3), null, "well outside the rack must not snap");
  assert.equal(rackSlotAt(layout, layout.rack.cx - 0.9, layout.rack.cz, 3), null);
});

/* ---------- measurement + feedback --------------------------------------------- */

test("staging measurements report real technique, not a pass stamp", () => {
  const h = seed();
  stageEverythingCorrectly(h, { inspectFirst:true });
  h.state.completedAt = 42000;
  const r = evaluateStaging(h.state, h.catalog);
  const m = measureStaging(h.state, h.catalog, r, 42000);

  assert.equal(m.ready, true);
  assert.equal(m.incorrectItems, 0);
  assert.equal(m.unsafeItems, 0);
  assert.equal(m.tubeOrderAccuracy, 1);
  assert.equal(m.tubeOrderFirstTry, true);
  assert.equal(m.sharpsAccessible, true);
  assert.equal(m.timeMs, 42000);
  assert.ok(m.score >= 90, `expected a high score for clean staging, got ${m.score}`);
  assert.ok(m.narrative.length > 80, "the narrative must be specific, not a one-liner");
});

test("the narrative cites the specific correction the learner made", () => {
  const h = seed();
  stageEverythingCorrectly(h, { skipSharps:true });
  const sharps = h.catalog.find(d=>d.category===CATEGORY.SHARPS && isUsable(d));
  // the learner's FIRST instinct is to put it past the arm, then they correct it
  placeItem(h.state, sharps.id, ZONE.ACROSS, { pos:{ x:h.layout.across.cx, z:h.layout.across.cz } });
  placeItem(h.state, sharps.id, ZONE.REACH, { pos:{ x:h.layout.reach.cx, z:h.layout.reach.cz } });

  const r = evaluateStaging(h.state, h.catalog);
  assert.equal(r.ready, true);
  const m = measureStaging(h.state, h.catalog, r, 60000);
  assert.equal(m.sharpsCorrected, true);
  assert.match(m.narrative, /past the patient's arm/i);
  assert.match(m.narrative, /corrected its placement/i);
  assert.ok(m.score < 100, "an initially unsafe placement should cost something, even once corrected");
});

test("staging an unsafe item is scored much more harshly than an untidy one", () => {
  const clean = seed(); stageEverythingCorrectly(clean);
  const cleanM = measureStaging(clean.state, clean.catalog, evaluateStaging(clean.state, clean.catalog), 30000);

  const unsafe = seed(); stageEverythingCorrectly(unsafe);
  const wrongPatient = unsafe.catalog.find(d=>(d.flaws||[]).includes(FLAW.WRONG_PATIENT));
  placeItem(unsafe.state, wrongPatient.id, ZONE.TRAY, {});
  placeItem(unsafe.state, wrongPatient.id, ZONE.SHELF, {});   // caught and removed
  const unsafeM = measureStaging(unsafe.state, unsafe.catalog, evaluateStaging(unsafe.state, unsafe.catalog), 30000);

  assert.ok(unsafeM.unsafeItems >= 1);
  assert.ok(unsafeM.score < cleanM.score - 15, "a wrong-patient tube reaching the tray must cost real marks");
  assert.match(unsafeM.narrative, /another patient/i);
});

test("inspection before staging is measured, and rewarded", () => {
  const blind = seed(); stageEverythingCorrectly(blind);
  const blindM = measureStaging(blind.state, blind.catalog, evaluateStaging(blind.state, blind.catalog), 30000);

  const careful = seed(); stageEverythingCorrectly(careful, { inspectFirst:true });
  const carefulM = measureStaging(careful.state, careful.catalog, evaluateStaging(careful.state, careful.catalog), 30000);

  assert.equal(blindM.inspectionsBeforeStaging, 0);
  assert.ok(carefulM.inspectionsBeforeStaging >= 7);
  assert.ok(carefulM.score > blindM.score);
  assert.match(blindM.narrative, /turn any package over|were checked first/i);
});

/* ---------- catalog integrity --------------------------------------------------- */

test("every catalog item is a real modelled object — no core gameplay object is an emoji", () => {
  const { catalog } = seed();
  const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
  catalog.forEach(d=>{
    assert.match(d.modelId, /^supply\./, `${d.id} must resolve through the model registry`);
    assert.ok(!EMOJI.test(d.label), `${d.id}'s label must not rely on an emoji`);
    assert.ok(!EMOJI.test(d.short||""), `${d.id}'s short name must not rely on an emoji`);
  });
});

test("every wrong item carries a corrective explanation and inspectable detail", () => {
  const { catalog } = seed();
  catalog.filter(d=>!isUsable(d)).forEach(d=>{
    assert.ok(d.reason && d.reason.length > 40, `${d.id} needs a real explanation of why it's wrong`);
    assert.ok((d.inspect||[]).length >= 2, `${d.id} must be discoverable by turning it over`);
  });
});

test("the catalog always contains one usable item for every required category", () => {
  const { catalog } = seed();
  [CATEGORY.GLOVES, CATEGORY.TOURNIQUET, CATEGORY.ALCOHOL, CATEGORY.NEEDLE,
   CATEGORY.HOLDER, CATEGORY.GAUZE, CATEGORY.BANDAGE, CATEGORY.SHARPS].forEach(cat=>{
    assert.equal(catalog.filter(d=>d.category===cat && isUsable(d)).length, 1,
      `exactly one usable ${cat} must exist, so the learner has to identify it`);
  });
  REQUIRED.forEach(k=>{
    assert.ok(catalog.some(d=>d.category===CATEGORY.TUBE && isUsable(d) && d.tubeKey===k));
  });
});

/* ---------- model registry fallback ---------------------------------------------- */

test("a model whose GLB fails to load falls back to its procedural build", async () => {
  let built = 0;
  registerModel({
    id: "test.brokenGlb",
    url: "/definitely-missing-model.glb",
    fallback: ()=>{ built++; return { isFakeObject3D:true, clone(){ return { ...this, cloned:true }; } }; },
  });
  assert.equal(isRegistered("test.brokenGlb"), true);
  await preloadModels(["test.brokenGlb"]);
  const inst = createModelInstance("test.brokenGlb");
  assert.ok(inst, "a failed GLB must still produce a usable instance");
  assert.equal(inst.isFakeObject3D, true);
  assert.equal(built, 1, "the procedural fallback must be the thing that got built");
});
