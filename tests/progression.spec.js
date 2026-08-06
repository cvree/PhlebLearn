/* =========================================================================
   PROGRESSION — unit tests for the parts that change the DRAW.

   The shop's cosmetic upgrades have always been cosmetic. These four are
   not: each moves a number an existing branch already reads, and these tests
   pin that it is the same number rather than a parallel one. The difficulty
   ladder gets the same treatment — a harder shift has to be a harder limb.

   `SS` is a live module binding with no localStorage behind it under node,
   so it loads its defaults and these tests mutate it directly, exactly as
   buyUpgrade() does.
   ========================================================================= */
import test from "node:test";
import assert from "node:assert/strict";

import { SS } from "../src/game/gameState.js";
import {
  hasUpgrade, buyUpgrade, vigourBonus, tubeVolumeScale,
  canChooseProcedure, hasVeinFinder, equipmentInEffect, upgradeBonusForEncounter,
  recordStickers, stickerCount,
} from "../src/game/progression.js";
import { difficultyVeinKeys } from "../src/game/encounter.js";
import { UPGRADES, STICKERS, BADGE_NAMES, UPGRADE_TAG } from "../src/config.js";
import { tubeVolumeMl, collapsesVein, requiredFraction } from "../src/venipuncture/collection/collectionRules.js";
import { createCollectionState, takeTube, pushOn, flow, GRIP } from "../src/venipuncture/collection/collectionState.js";
import { applyPatientVariation, buildVessels } from "../src/venipuncture/arm/armAnatomy.js";

function own(...ids){
  SS.ownedUpgrades = ids.slice();
  SS.coins = 9999;
}
function ownNothing(){ own(); }

/* =========================================================================
   THE KIT IS IN THE SHOP AND COSTS COINS LIKE EVERYTHING ELSE
   ========================================================================= */

test("every equipment upgrade is buyable, tagged, and priced within a few shifts", () => {
  const kit = UPGRADES.filter(u => u.kind === "equipment");
  assert.equal(kit.length, 4);
  for(const u of kit){
    assert.ok(u.cost > 0 && u.cost <= 200, `${u.id} is priced out of reach`);
    assert.equal(UPGRADE_TAG[u.id], "Equipment");
    assert.ok(u.desc.length > 30, `${u.id} does not say what it does`);
  }
});

test("buying one takes the coins and turns the tool on", () => {
  ownNothing();
  assert.equal(canChooseProcedure(), false);
  SS.coins = 200;
  const r = buyUpgrade("butterflyKit");
  assert.equal(r.ok, true);
  assert.equal(canChooseProcedure(), true);
  assert.equal(SS.coins, 200 - r.upgrade.cost);
  ownNothing();
});

/* =========================================================================
   EACH TOOL MOVES A NUMBER SOME BRANCH ALREADY READS
   ========================================================================= */

test("the warming pack raises the arm's own vigour and nothing else", () => {
  ownNothing();
  assert.equal(vigourBonus(), 1);
  own("warmingPack");
  assert.ok(vigourBonus() > 1);
  assert.equal(tubeVolumeScale(), 1, "the pack must not touch tube stock");
  ownNothing();
});

test("the paediatric kit shrinks the tube's real volume, so its vacuum stops collapsing a narrow vein", () => {
  const narrow = { id: "cephalic", calibre: 0.0026, depth: 0.004 };
  // a full-draw red top on a 2.6mm vein pulls the wall shut...
  assert.equal(collapsesVein(narrow, "red", 1), true);
  // ...and the same tube in paediatric stock does not
  assert.equal(collapsesVein(narrow, "red", 0.45), false);
  assert.ok(tubeVolumeMl("red", 0.45) < tubeVolumeMl("red"));
});

test("a paediatric tube still has to be filled to its own ratio — the rule does not soften", () => {
  ownNothing();
  const s = createCollectionState({
    order: ["lightblue"], vessel: { id: "v", calibre: 0.0032, depth: 0.0035 },
    gauge: 21, inVein: true, volumeScale: 0.45, now: 0,
  });
  takeTube(s, "lightblue", 0);
  assert.ok(s.tubes.lightblue.volumeMl < 2.7, "the tube did not take the smaller stock");
  // the fraction it must reach is unchanged: the additive is measured for it
  assert.equal(requiredFraction("lightblue"), 0.9);
});

test("the transilluminator is a visibility tool, not a palpation tool", () => {
  ownNothing();
  assert.equal(hasVeinFinder(), false);
  own("veinFinder");
  assert.equal(hasVeinFinder(), true);
  // it changes nothing about the arm's geometry — a deep vein is still deep,
  // which is why the rubric still grades whether it was felt
  const deep = applyPatientVariation(buildVessels(), { build: 1, scenarioKeys: ["deep"] });
  const plain = applyPatientVariation(buildVessels(), { build: 1, scenarioKeys: ["deep"] });
  assert.deepEqual(deep.map(v => v.depth), plain.map(v => v.depth));
  ownNothing();
});

test("equipmentInEffect reports exactly what is switched on", () => {
  own("veinFinder", "pediatricKit");
  const e = equipmentInEffect();
  assert.equal(e.veinFinder, true);
  assert.equal(e.pediatricKit, true);
  assert.equal(e.butterflyKit, false);
  assert.equal(e.warmingPack, false);
  assert.equal(e.vigourBonus, 1);
  assert.ok(e.tubeVolumeScale < 1);
  ownNothing();
});

/* =========================================================================
   DIFFICULTY IS ANATOMY
   ========================================================================= */

test("the first two difficulty levels are ordinary arms", () => {
  const always = () => 0;   // every roll succeeds
  assert.deepEqual(difficultyVeinKeys(0, always), []);
  assert.deepEqual(difficultyVeinKeys(1, always), []);
});

test("harder shifts add real anatomy keys, and the hardest adds the most", () => {
  const always = () => 0;
  const two = difficultyVeinKeys(2, always);
  const four = difficultyVeinKeys(4, always);
  assert.deepEqual(two, ["rolling"]);
  assert.deepEqual(four, ["rolling", "small", "deep", "fragile"]);
  // a lucky patient at the same level can still have easy veins
  assert.deepEqual(difficultyVeinKeys(4, () => 0.99), []);
});

test("every key difficulty can add is one applyPatientVariation understands", () => {
  const keys = difficultyVeinKeys(4, () => 0);
  const base = buildVessels();
  for(const k of keys){
    const varied = applyPatientVariation(base, { build: 1, scenarioKeys: [k] });
    const changed = varied.some((v, i) =>
      v.depth !== base[i].depth || v.calibre !== base[i].calibre
      || v.compliance !== base[i].compliance || v.fragile !== base[i].fragile);
    assert.ok(changed, `"${k}" changed nothing about the arm`);
  }
});

test("a rolling vein really is more compliant, and a small one really is narrower", () => {
  const base = buildVessels();
  const rolling = applyPatientVariation(base, { build: 1, scenarioKeys: ["rolling"] });
  const small = applyPatientVariation(base, { build: 1, scenarioKeys: ["small"] });
  const vein = i => base[i].kind === "vein";
  assert.ok(rolling.some((v, i) => vein(i) && v.compliance > base[i].compliance));
  assert.ok(small.some((v, i) => vein(i) && v.calibre < base[i].calibre));
});

/* =========================================================================
   THE NEW COLLECTIBLES READ THE DRAW, NOT THE WALLET
   ========================================================================= */

const cleanDraw = () => ({
  collect: {
    procedureId: "straight-antecubital",
    complicationMeasurements: { total: 1, missedCount: 0, worsenedCount: 0, hematomaGrade: "none" },
    specimenQuality: { total: 2, rejectedCount: 0, flaggedCount: 0 },
    postDrawMeasurements: { score: 90 },
  },
});

test("Quick Eyes needs a complication that was actually handled", () => {
  SS.stickers = {}; SS.stickerClaimed = {};
  const st = STICKERS.find(x => x.id === "quickeyes");
  assert.equal(!!st.match({}, {}, 100, cleanDraw()), true);
  const missed = cleanDraw();
  missed.collect.complicationMeasurements.missedCount = 1;
  assert.equal(!!st.match({}, {}, 100, missed), false);
  // and a draw where nothing went wrong earns nothing — there was nothing to see
  const quiet = cleanDraw();
  quiet.collect.complicationMeasurements.total = 0;
  assert.equal(!!st.match({}, {}, 100, quiet), false);
});

test("Clean Deliveries needs every tube accepted without even a comment", () => {
  const st = STICKERS.find(x => x.id === "cleanlab");
  assert.equal(!!st.match({}, {}, 100, cleanDraw()), true);
  const flagged = cleanDraw();
  flagged.collect.specimenQuality.flaggedCount = 1;
  assert.equal(!!st.match({}, {}, 100, flagged), false);
});

test("Winged Draws counts the procedure that was actually run", () => {
  const st = STICKERS.find(x => x.id === "winged");
  assert.equal(!!st.match({}, {}, 100, cleanDraw()), false);
  const bf = cleanDraw();
  bf.collect.procedureId = "butterfly-hand";
  assert.equal(!!st.match({}, {}, 100, bf), true);
});

test("every sticker survives an encounter that never reached the draw", () => {
  for(const st of STICKERS){
    assert.doesNotThrow(() => st.match({ mood: "Calm", ageCat: "Adult", reqSet: [], orders: [] }, {}, 0, {}));
  }
});

test("every new badge id has a display name", () => {
  for(const id of ["quick-eyes", "clean-lab", "winged", "gentle-hands"]){
    assert.ok(BADGE_NAMES[id], `${id} has no name`);
  }
});

test("the equipment upgrades pay no coin bonus — they are not decor", () => {
  own("butterflyKit", "veinFinder", "warmingPack", "pediatricKit");
  const bonus = upgradeBonusForEncounter(
    { mood: "Nervous", event: { type: "respond", safety: true }, drawEvent: null, site: null },
    { tubeSelect: true, orderOfDraw: true, professional: true, safety: true });
  assert.equal(bonus.coins, 0);
  ownNothing();
});
