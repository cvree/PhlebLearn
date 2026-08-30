/* =========================================================================
   PERSONAL BESTS — unit tests.

   The debrief is where this game says what a draw was worth, and a medal is
   the loudest thing it can say. The property worth defending is therefore
   narrow and absolute: **a record is only announced when there is something
   to announce.** Everything else here is the ordinary comparison logic, which
   had no coverage at all.
   ========================================================================= */
import test from "node:test";
import assert from "node:assert/strict";

import { BESTS, createBests, offerBests, formatBest } from "../src/game/personalBests.js";

/** Every precondition satisfied, so a test says which one it is disabling. */
const CLEAN = { oneStick: true, allAccepted: true, noMissedComplications: true, flashed: true };

const ids = list => list.map(b => b.id);

/* -------------------------------------------------------------------------
   THE ZERO RULE
   ------------------------------------------------------------------------- */

test("a first draw that went badly is congratulated for nothing", () => {
  const bests = createBests();
  /* Exactly what renderScore() offers after a draw where a tube was rejected:
     the streaks are reset to nought and then offered anyway. Before the zero
     rule both of them beat an unset record, so the payout screen handed out
     two gold medals for the worst available outcome. */
  const beaten = offerBests(bests, { flawlessStreak: 0, acceptedStreak: 0 }, {
    oneStick: false, allAccepted: false, noMissedComplications: true, flashed: true,
  });
  assert.deepEqual(beaten, []);
  // and nothing was stored, so the first real streak still announces
  assert.equal(bests.flawlessStreak, undefined);
  assert.equal(bests.acceptedStreak, undefined);
});

test("zero coverage is the absence of a swab, not a low score at swabbing", () => {
  const bests = createBests();
  assert.deepEqual(offerBests(bests, { coverage: 0 }, CLEAN), []);
  assert.deepEqual(ids(offerBests(bests, { coverage: 1 }, CLEAN)), ["coverage"]);
});

test("the rule is for higher-is-better only — a zero is a real record when lower wins", () => {
  const bests = createBests();
  // a perfect entry angle is 0° off ideal, and that is the best there is
  const beaten = offerBests(bests, { entryAngleErr: 0 }, CLEAN);
  assert.deepEqual(ids(beaten), ["entryAngleErr"]);
  assert.equal(bests.entryAngleErr, 0);
});

test("the first real streak announces even though a zero came before it", () => {
  const bests = createBests();
  offerBests(bests, { flawlessStreak: 0 }, CLEAN);
  const beaten = offerBests(bests, { flawlessStreak: 1 }, CLEAN);
  assert.deepEqual(ids(beaten), ["flawlessStreak"]);
  assert.equal(beaten[0].previous, null, "nothing was stored by the zero, so this is a first record");
});

/* -------------------------------------------------------------------------
   ORDINARY COMPARISON
   ------------------------------------------------------------------------- */

test("higher wins where higher is better, and lower where lower is", () => {
  const bests = createBests();
  offerBests(bests, { coverage: 80, entryAngleErr: 6 }, CLEAN);

  assert.deepEqual(ids(offerBests(bests, { coverage: 70 }, CLEAN)), [], "70% does not beat 80%");
  assert.deepEqual(ids(offerBests(bests, { coverage: 90 }, CLEAN)), ["coverage"]);

  assert.deepEqual(ids(offerBests(bests, { entryAngleErr: 9 }, CLEAN)), [], "9° off does not beat 6° off");
  assert.deepEqual(ids(offerBests(bests, { entryAngleErr: 2 }, CLEAN)), ["entryAngleErr"]);
});

test("equalling a record does not beat it", () => {
  const bests = createBests();
  offerBests(bests, { coverage: 80 }, CLEAN);
  assert.deepEqual(ids(offerBests(bests, { coverage: 80 }, CLEAN)), []);
});

test("a missing or non-finite reading is simply not offered", () => {
  const bests = createBests();
  assert.deepEqual(offerBests(bests, {}, CLEAN), []);
  assert.deepEqual(offerBests(bests, { coverage: NaN, entryAngleErr: Infinity }, CLEAN), []);
  assert.deepEqual(bests, {});
});

/* -------------------------------------------------------------------------
   THE GATES — a fast bad draw sets no record at all
   ------------------------------------------------------------------------- */

test("a timed record is refused unless the draw it came from was clean", () => {
  const bests = createBests();
  const fast = { cleanDrawMs: 60000 };

  assert.deepEqual(offerBests(bests, fast, { ...CLEAN, oneStick: false }), [],
    "three sticks is not a clean draw, however fast it was");
  assert.deepEqual(offerBests(bests, fast, { ...CLEAN, allAccepted: false }), [],
    "a rejected specimen is not a clean draw");
  assert.deepEqual(offerBests(bests, fast, { ...CLEAN, noMissedComplications: false }), [],
    "a missed complication is not a clean draw");

  assert.deepEqual(ids(offerBests(bests, fast, CLEAN)), ["cleanDrawMs"]);
});

test("an entry angle only counts if the needle actually found the vein", () => {
  const bests = createBests();
  assert.deepEqual(offerBests(bests, { entryAngleErr: 1 }, { ...CLEAN, flashed: false }), []);
  assert.deepEqual(ids(offerBests(bests, { entryAngleErr: 1 }, CLEAN)), ["entryAngleErr"]);
});

/* -------------------------------------------------------------------------
   RENDERING
   ------------------------------------------------------------------------- */

test("every record can render its own value, and an unset one reads as a dash", () => {
  for(const b of BESTS){
    assert.equal(typeof formatBest(b.id, 12), "string", `${b.id} renders`);
    assert.equal(formatBest(b.id, null), "—", `${b.id} with nothing recorded`);
  }
  assert.equal(formatBest("nosuchrecord", 5), "—");
  // a duration reads as minutes and seconds, not as milliseconds
  assert.equal(formatBest("cleanDrawMs", 185000), "3:05");
  assert.equal(formatBest("flawlessStreak", 1), "1 draw");
  assert.equal(formatBest("flawlessStreak", 3), "3 draws");
});
