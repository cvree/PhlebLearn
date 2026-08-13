/* =========================================================================
   ARCHETYPES — the property that justifies them existing.

   The failure mode this file guards against is an archetype library that is
   really a costume rack: ten patients with different names and lines who all
   present the same arm and want the same draw. That is the thing the
   redesign brief singled out about the old difficulty model — "real
   variation, but mostly numeric" — and it would be very easy to reintroduce
   one flavour-text entry at a time.

   So: every archetype must change something the PHYSICAL simulation reads.
   ========================================================================= */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ARCHETYPES, pickArchetype, applyArchetype, archetypeFor } from "../src/game/archetypes.js";
import { applyPatientVariation, buildVessels } from "../src/venipuncture/arm/armAnatomy.js";

test("there are at least eight archetypes", () => {
  // The brief's acceptance criterion.
  assert.ok(ARCHETYPES.length >= 8, `only ${ARCHETYPES.length}`);
});

test("every archetype changes something PHYSICAL, not just something written", () => {
  for(const a of ARCHETYPES){
    const changesAnatomy = (a.keys && a.keys.length > 0);
    const changesArm = !!(a.arm && Object.keys(a.arm).some(k => k !== "vigour" || a.arm.vigour !== 1.0));
    const changesSide = !!a.contraindicatedSide;
    const changesHistory = !!a.history;
    assert.ok(
      changesAnatomy || changesArm || changesSide || changesHistory,
      `${a.id} is cosmetic: it changes nothing the simulation reads`
    );
    assert.ok(a.physical && a.physical.length > 20,
      `${a.id} has no sentence saying what you DO differently`);
  }
});

test("archetype ids are unique and every one is retrievable", () => {
  const ids = ARCHETYPES.map(a => a.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate archetype id");
  for(const id of ids) assert.ok(archetypeFor(id), `${id} not retrievable`);
  assert.equal(archetypeFor("nope"), null);
});

test("the scenario keys reach the vessels — a deep patient's veins are deeper", () => {
  const deep = archetypeFor("deep");
  const plain = applyPatientVariation(buildVessels(), { build: 1, scenarioKeys: [] });
  const varied = applyPatientVariation(buildVessels(), { build: 1, scenarioKeys: deep.keys });
  const mc = id => arr => arr.find(v => v.id === id);
  assert.ok(mc("median-cubital")(varied).depth > mc("median-cubital")(plain).depth*1.4,
    "a deep archetype must genuinely move the vein further under the skin");
});

test("a rolling archetype makes the vein genuinely more compliant", () => {
  const fragile = archetypeFor("fragile");
  const plain = applyPatientVariation(buildVessels(), { build: 1, scenarioKeys: [] });
  const varied = applyPatientVariation(buildVessels(), { build: 1, scenarioKeys: fragile.keys });
  const cephalic = arr => arr.find(v => v.id === "cephalic");
  assert.ok(cephalic(varied).compliance > cephalic(plain).compliance,
    "a fragile/rolling archetype must move real compliance");
  assert.ok(cephalic(varied).fragile === true);
});

test("difficulty gates which archetypes can turn up", () => {
  const rng = () => 0.5;
  for(let i = 0; i < 40; i++){
    const easy = pickArchetype(0, null, () => i/40);
    assert.ok(easy.minDifficulty <= 0, `${easy.id} should not appear at difficulty 0`);
  }
  // and the hardest ones DO become reachable further up the ladder
  const seen = new Set();
  for(let i = 0; i < 200; i++) seen.add(pickArchetype(4, null, () => i/200).id);
  assert.ok(seen.has("contraindicated"), "the hardest archetypes must be reachable");
  assert.ok(seen.size >= 6, `only ${seen.size} archetypes reachable at the top of the ladder`);
});

test("the same archetype never comes up twice running", () => {
  for(let i = 0; i < 100; i++){
    const a = pickArchetype(4, "veteran", () => i/100);
    assert.notEqual(a.id, "veteran");
  }
});

test("applying an archetype writes only fields the rest of the game reads", () => {
  const p = { appearance: { width: 1 }, history: { latexAllergy: false } };
  applyArchetype(p, archetypeFor("paediatric"));
  assert.equal(p.archetype, "paediatric");
  assert.equal(p.appearance.width, 0.80, "build must reach the appearance the arm is built from");
  assert.deepEqual(p.site.keys, ["small"], "keys must land on the site scenario, not a parallel one");
  assert.equal(p.armOverrides.vigour, 1.05);
});

test("a contraindicated patient is drawn on the OTHER arm", () => {
  for(let i = 0; i < 20; i++){
    const p = { appearance: { width: 1 } };
    applyArchetype(p, archetypeFor("contraindicated"));
    assert.ok(p.contraindicatedSide === "left" || p.contraindicatedSide === "right");
    assert.notEqual(p.forcedArmSide, p.contraindicatedSide,
      "the draw must not happen on the side that is off limits");
  }
});

test("an anxious patient really has a fainting history", () => {
  const p = { appearance: { width: 1 }, history: { faintHistory: false } };
  applyArchetype(p, archetypeFor("anxious"));
  assert.equal(p.history.faintHistory, true,
    "the vasovagal risk has to be real, or the archetype is a costume");
});
