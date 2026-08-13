/* =========================================================================
   MASTERY — the property that makes it worth having.

   XP measures time spent, and time spent is grindable by definition. Mastery
   is the parallel axis that is supposed NOT to be, and there is exactly one
   claim holding that up:

       Mastery cannot be advanced by repetition alone —
       only by sustained quality across multiple draws.

   Which is an assertion, so this file asserts it.
   ========================================================================= */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TRACKS, STAR_THRESHOLDS, STAR_RUN, MAX_STARS,
  createMastery, normaliseMastery, applyDraw, progressToNext, masteryLevel, weakestTrack,
} from "../src/game/mastery.js";

const perfect = () => Object.fromEntries(
  TRACKS.flatMap(t => t.sections.map(s => [s, 100]))
);
const mediocre = (v) => Object.fromEntries(
  TRACKS.flatMap(t => t.sections.map(s => [s, v]))
);

test("a fresh record has every track at zero", () => {
  const m = createMastery();
  assert.equal(TRACKS.length, 7);
  for(const t of TRACKS) assert.deepEqual(m[t.id], { stars: 0, run: 0, best: 0, draws: 0 });
});

test("ONE brilliant draw earns nothing — a run is three", () => {
  const m = createMastery();
  const gained = applyDraw(m, perfect());
  assert.deepEqual(gained, [], "a single lucky run must not buy a star");
  assert.equal(m.tourniquet.stars, 0);
  assert.equal(m.tourniquet.run, 1);
});

test("three consecutive good draws earn exactly one star each", () => {
  const m = createMastery();
  applyDraw(m, perfect());
  applyDraw(m, perfect());
  const gained = applyDraw(m, perfect());
  assert.equal(gained.length, TRACKS.length, "every tested track should advance together");
  for(const t of TRACKS) assert.equal(m[t.id].stars, 1, `${t.id} did not gain a star`);
  assert.equal(m.tourniquet.run, 0, "the run resets after a star is spent");
});

test("REPETITION ALONE BUYS NOTHING — this is the whole point", () => {
  const m = createMastery();
  // fifty draws, all at a score below the first threshold
  for(let i = 0; i < 50; i++) applyDraw(m, mediocre(STAR_THRESHOLDS[0] - 1));
  for(const t of TRACKS){
    assert.equal(m[t.id].stars, 0, `${t.id} gained a star from grinding`);
  }
  assert.equal(m.tourniquet.draws, 50, "the draws still counted, they just did not pay");
});

test("a bad draw RESETS the run rather than merely not advancing it", () => {
  const m = createMastery();
  applyDraw(m, perfect());
  applyDraw(m, perfect());
  assert.equal(m.palpation.run, 2);
  applyDraw(m, mediocre(20));
  assert.equal(m.palpation.run, 0, "two good draws and a bad one is not two thirds of a star");
  assert.equal(m.palpation.stars, 0);
});

test("the thresholds climb, so later stars are genuinely harder", () => {
  const m = createMastery();
  // hold exactly the first threshold forever: it earns one star and stops
  for(let i = 0; i < 30; i++) applyDraw(m, mediocre(STAR_THRESHOLDS[0]));
  assert.equal(m.antisepsis.stars, 1, "should reach the first star");
  assert.equal(m.antisepsis.stars < 2, true, "and be unable to reach the second at that quality");
});

test("five stars is the ceiling and holds there", () => {
  const m = createMastery();
  for(let i = 0; i < 60; i++) applyDraw(m, mediocre(100));
  for(const t of TRACKS) assert.equal(m[t.id].stars, MAX_STARS);
  assert.equal(masteryLevel(m), 1);
});

test("a section the draw never reached is absent, not zero", () => {
  const m = createMastery();
  applyDraw(m, perfect());
  applyDraw(m, perfect());
  // a draw that stopped after the tourniquet
  applyDraw(m, { tourniquet: 100 });
  assert.equal(m.tourniquet.stars, 1, "the track that WAS tested advances");
  assert.equal(m.palpation.run, 2, "the tracks that were not tested are untouched");
  assert.equal(m.palpation.draws, 2, "and do not count the draw against themselves");
});

test("a track spanning two sections averages them", () => {
  const m = createMastery();
  // insertion covers equipment + insert
  for(let i = 0; i < 3; i++) applyDraw(m, { equipment: 100, insert: STAR_THRESHOLDS[0]*2 - 100 });
  assert.equal(m.insertion.stars, 1);
});

test("progressToNext reads as a fraction of a run", () => {
  const m = createMastery();
  assert.equal(progressToNext(m.safety), 0);
  applyDraw(m, perfect());
  assert.equal(progressToNext(m.safety), 1/STAR_RUN);
});

test("weakestTrack names the honest answer to what to practise", () => {
  const m = createMastery();
  for(let i = 0; i < 9; i++){
    applyDraw(m, Object.assign(perfect(), { palpation: 10 }));
  }
  assert.equal(weakestTrack(m).track.id, "palpation");
});

test("a save that predates a track gains it without losing the others", () => {
  const m = normaliseMastery({ tourniquet: { stars: 3, run: 1, best: 94, draws: 12 } });
  assert.equal(m.tourniquet.stars, 3);
  assert.equal(m.aftercare.stars, 0);
  // and nonsense in a save is clamped rather than trusted
  const junk = normaliseMastery({ palpation: { stars: 99, best: -4 } });
  assert.equal(junk.palpation.stars, MAX_STARS);
  assert.equal(junk.palpation.best, 0);
});
