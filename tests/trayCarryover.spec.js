/* =========================================================================
   THE TRAY THAT GOES WITH YOU TO THE NEXT PATIENT.

   A shift is six patients, and preparing the work area was fifty-odd
   identical drags across it: the same nine objects onto the same tray,
   rebuilt from empty every time, plus the same nine packages turned over to
   read the same labels. That is not what happens between two patients in one
   room, and it is not a decision — it is typing.

   So the consumables carry, the tubes do not, and the restock can let you
   down. These tests hold that shape:

     what carries is the CATEGORIES you staged, not the objects — the objects
     were used on the last patient;

     the tubes never carry, because they are this patient's requisition and
     the graded half of the step;

     a flawed item never carries forward as itself — you would have taken it
     off the tray, and punishing the same mistake twice without asking again
     is not teaching;

     and a restock can hand you something bad, which nothing announces.
   ========================================================================= */
import test from "node:test";
import assert from "node:assert/strict";

import { buildSupplyCatalog, CATEGORY, catalogById, isUsable } from "../src/venipuncture/staging/supplyCatalog.js";
import {
  createStagingState, placeItem, inspectItem, ZONE, HAND, stagedIds,
} from "../src/venipuncture/staging/stagingState.js";
import { captureTray, restockPlan, RESTOCKED_CATEGORIES } from "../src/venipuncture/staging/trayCarryover.js";

const REQUIRED = ["lightblue", "lavender"];

function seeded(){
  let n = 7;
  return ()=>{ n = (n*1103515245 + 12345) % 2147483648; return n/2147483648; };
}
function cart(required){
  return buildSupplyCatalog({
    requiredTubes: required || REQUIRED,
    patientName: "Rosa Delacroix",
    otherPatientName: "T. Underwood",
    rng: seeded(),
  });
}
function emptyState(catalog, required){
  return createStagingState({
    catalog, requiredTubes: required || REQUIRED, handedness: HAND.RIGHT, now: 0,
  });
}

/** A finished, correct tray: every consumable staged, sharps in reach, tubes racked. */
function stagedTray(catalog, state, required){
  const req = required || REQUIRED;
  const usable = (cat, pred) => catalog.find(d => d.category === cat && isUsable(d) && (!pred || pred(d)));
  for(const cat of [CATEGORY.GLOVES, CATEGORY.TOURNIQUET, CATEGORY.ALCOHOL,
                    CATEGORY.NEEDLE, CATEGORY.HOLDER, CATEGORY.GAUZE, CATEGORY.BANDAGE]){
    const d = usable(cat);
    inspectItem(state, d.id, 0);
    placeItem(state, d.id, ZONE.TRAY, {}, 0);
  }
  const sharps = usable(CATEGORY.SHARPS);
  inspectItem(state, sharps.id, 0);
  placeItem(state, sharps.id, ZONE.REACH, {}, 0);
  req.forEach((k, i)=>{
    const d = usable(CATEGORY.TUBE, x => x.tubeKey === k);
    inspectItem(state, d.id, 0);
    placeItem(state, d.id, ZONE.RACK, { slot:i }, 0);
  });
  state.trayOffset = { x: 0.11, z: -0.04 };
  return state;
}

/* ---------- what a finished tray says about the next one -------------------- */

test("a finished tray carries its consumables and its sharps zone, and no tubes", () => {
  const catalog = cart();
  const tray = captureTray(stagedTray(catalog, emptyState(catalog)), catalog);

  assert.ok(tray, "a finished tray is worth carrying");
  for(const cat of [CATEGORY.GLOVES, CATEGORY.TOURNIQUET, CATEGORY.ALCOHOL,
                    CATEGORY.NEEDLE, CATEGORY.HOLDER, CATEGORY.GAUZE, CATEGORY.BANDAGE]){
    assert.ok(tray.categories.includes(cat), `${cat} carries`);
  }
  assert.equal(tray.categories.includes(CATEGORY.TUBE), false,
    "tubes are this patient's requisition, not last patient's tray");
  assert.equal(tray.sharpsZone, ZONE.REACH);
  assert.deepEqual(tray.trayOffset, { x: 0.11, z: -0.04 }, "where you pushed the tray is your work area");
});

test("an untouched tray carries nothing at all", () => {
  const catalog = cart();
  assert.equal(captureTray(emptyState(catalog), catalog), null);
});

test("a flawed item is not restocked as itself — you took it off the tray", () => {
  const catalog = cart();
  const state = emptyState(catalog);
  const bad = catalog.find(d => d.category === CATEGORY.ALCOHOL && !isUsable(d));
  assert.ok(bad, "the cart stocks a bad alcohol pad");
  placeItem(state, bad.id, ZONE.TRAY, {}, 0);
  const tray = captureTray(state, catalog);
  assert.equal(tray, null, "a tray with nothing usable on it carries nothing");
});

test("a sharps bin left across the arm does not come back — you place it yourself", () => {
  const catalog = cart();
  const state = stagedTray(catalog, emptyState(catalog));
  // undo the good placement and make the mistake this step exists to catch
  const sharps = catalog.find(d => d.category === CATEGORY.SHARPS && isUsable(d));
  placeItem(state, sharps.id, ZONE.ACROSS, {}, 0);

  const tray = captureTray(state, catalog);
  assert.ok(tray, "the rest of the tray still carries");
  assert.equal(tray.sharpsZone, null,
    "restocking it into the same bad spot would repeat the mistake unasked");

  const plan = restockPlan({ catalog: cart(), tray, flawChance: 0, rng: seeded() });
  const byId = catalogById(plan.items.length ? cart() : []);
  assert.equal(plan.items.some(p => (byId.get(p.id)||{}).category === CATEGORY.SHARPS), false);
});

/* ---------- what the next patient's cart puts back --------------------------- */

test("a restock puts back one usable item per carried category, already checked", () => {
  const first = cart();
  const tray = captureTray(stagedTray(first, emptyState(first)), first);
  // a different patient, so a different cart with different objects in it
  const second = cart(["red", "lavender"]);
  const plan = restockPlan({ catalog: second, tray, flawChance: 0, rng: seeded() });

  const byId = catalogById(second);
  assert.equal(plan.plantedId, null, "nothing planted at zero chance");
  assert.equal(plan.items.length, tray.categories.length + 1, "every category, plus the sharps");
  for(const put of plan.items){
    const def = byId.get(put.id);
    assert.ok(def, "the restock comes out of THIS patient's cart");
    assert.ok(isUsable(def), "and it is a good one");
    assert.equal(put.inspected, true, "from stock the learner already went through");
    assert.ok(RESTOCKED_CATEGORIES.includes(def.category));
    assert.notEqual(def.category, CATEGORY.TUBE);
  }
});

test("a restock never puts a tube back, however the last tray was racked", () => {
  const first = cart();
  const tray = captureTray(stagedTray(first, emptyState(first)), first);
  const second = cart(["red"]);
  const plan = restockPlan({ catalog: second, tray, flawChance: 1, rng: seeded() });
  const byId = catalogById(second);
  assert.equal(plan.items.filter(p => byId.get(p.id).category === CATEGORY.TUBE).length, 0);
});

test("a restock lands the sharps container back where the learner left it", () => {
  const first = cart();
  const state = stagedTray(first, emptyState(first));
  const tray = captureTray(state, first);
  const second = cart();
  const plan = restockPlan({ catalog: second, tray, flawChance: 0, rng: seeded() });
  const byId = catalogById(second);
  const sharps = plan.items.find(p => byId.get(p.id).category === CATEGORY.SHARPS);
  assert.equal(sharps.zone, ZONE.REACH);
  assert.ok(plan.items.filter(p => byId.get(p.id).category !== CATEGORY.SHARPS)
    .every(p => p.zone === ZONE.TRAY));
});

test("the restock can hand you something that should not be on the tray, unchecked", () => {
  const first = cart();
  const tray = captureTray(stagedTray(first, emptyState(first)), first);
  const second = cart();
  const plan = restockPlan({ catalog: second, tray, flawChance: 1, rng: seeded() });
  const byId = catalogById(second);

  assert.ok(plan.plantedId, "at certainty, something came back wrong");
  const planted = byId.get(plan.plantedId);
  assert.equal(isUsable(planted), false);

  const put = plan.items.find(p => p.id === plan.plantedId);
  assert.equal(put.inspected, false,
    "nobody has turned this one over — which is the whole point of it");
  // and exactly one thing is wrong: a restock is a lapse, not a sabotage
  assert.equal(plan.items.filter(p => !isUsable(byId.get(p.id))).length, 1);
});

test("only a category the cart stocks a bad version of can be the bad one", () => {
  const first = cart();
  const tray = captureTray(stagedTray(first, emptyState(first)), first);
  const second = cart();
  const byId = catalogById(second);
  const spoilable = new Set(second.filter(d => !isUsable(d)).map(d => d.category));
  for(let i = 0; i < 40; i++){
    const plan = restockPlan({ catalog: second, tray, flawChance: 1, rng: Math.random });
    assert.ok(plan.plantedId, "certainty means certainty");
    assert.ok(spoilable.has(byId.get(plan.plantedId).category),
      "planting a flaw in a category with no bad version would silently do nothing");
  }
});

test("no carried tray means an empty tray — a new shift starts at the cart", () => {
  const catalog = cart();
  for(const tray of [null, undefined, {}]){
    const plan = restockPlan({ catalog, tray, rng: seeded() });
    assert.deepEqual(plan.items, []);
    assert.equal(plan.plantedId, null);
  }
});

/* ---------- and the restock is a real staging, not a bookkeeping trick ------- */

test("a restocked tray is genuinely staged: the rules and the log both see it", () => {
  const first = cart();
  const tray = captureTray(stagedTray(first, emptyState(first)), first);
  const second = cart();
  const state = emptyState(second);
  const plan = restockPlan({ catalog: second, tray, flawChance: 0, rng: seeded() });
  for(const put of plan.items){
    if(put.inspected) inspectItem(state, put.id, 0);
    placeItem(state, put.id, put.zone, {}, 0);
  }
  const staged = stagedIds(state);
  assert.equal(staged.length, plan.items.length);
  for(const put of plan.items){
    assert.ok(staged.includes(put.id));
    assert.equal(state.items[put.id].inspectedBeforeStaging, true,
      "checked before it was committed, which is what the measurement counts");
  }
  assert.equal(state.events.filter(e => e.type === "place").length, plan.items.length,
    "the event log is how everything downstream measures this step");
});
