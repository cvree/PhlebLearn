/* =========================================================================
   THE PRACTICAL REPORT AND THE SESSION REPLAY — unit tests.

   The replay is merged from event logs that were already being kept, so the
   tests that matter are about the merge: that the two different clocks in
   those logs are reconciled, that every event is attributed to the section
   it came from, and that a section's events are shown against the
   measurement that graded them.
   ========================================================================= */
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildReplay, normaliseEvents, EVENT_SOURCES, EVENT_LABELS, labelFor, stamp,
} from "../src/venipuncture/rubric/replay.js";
import { SECTIONS, measurementField } from "../src/venipuncture/sections.js";

import { createStagingState, placeItem, ZONE } from "../src/venipuncture/staging/stagingState.js";
import { buildSupplyCatalog } from "../src/venipuncture/staging/supplyCatalog.js";
import { createTourniquetState, markRouted, markSecured, markReleased } from "../src/venipuncture/tourniquet/tourniquetState.js";
import { createPalpationState, recordFeel, chooseVessel } from "../src/venipuncture/palpation/palpationState.js";
import { FEEL } from "../src/venipuncture/palpation/palpationRules.js";
import { createInversionState, pickUp, rack } from "../src/venipuncture/inversion/inversionState.js";

const T0 = 1_700_000_000_000;

/* -------------------------------------------------------------------------
   THE TWO CLOCKS
   ------------------------------------------------------------------------- */

test("staging's relative timestamps are rebased onto the wall clock", () => {
  const source = EVENT_SOURCES.find(s => s.section === "prep");
  assert.equal(source.relative, true);
  const session = { startedAt: T0, events: [{ t: 0, type: "place", id: "x" }, { t: 4200, type: "inspect", id: "y" }] };
  const out = normaliseEvents(session, source);
  assert.deepEqual(out.map(e => e.at), [T0, T0 + 4200]);
});

test("every other module logs the wall clock already and is left alone", () => {
  const source = EVENT_SOURCES.find(s => s.section === "tourniquet");
  assert.notEqual(source.relative, true);
  const out = normaliseEvents({ events: [{ t: T0 + 10, type: "route", data: null }] }, source);
  assert.equal(out[0].at, T0 + 10);
});

test("a merged timeline puts the supply cart before the tourniquet, not in 1970", () => {
  const catalog = buildSupplyCatalog({ requiredTubes: ["lavender"], patientName: "A", otherPatientName: "B" });
  const staging = createStagingState({ catalog, requiredTubes: ["lavender"], handedness: "right", now: T0 });
  placeItem(staging, catalog[0].id, ZONE.TRAY, {}, T0 + 1000);

  const tq = createTourniquetState({});
  tq.events.push({ t: T0 + 5000, type: "route", data: null });

  const replay = buildReplay({ supplies: { state: staging }, tourniquet: tq });
  assert.equal(replay.events[0].section, "prep");
  assert.equal(replay.events[replay.events.length - 1].section, "tourniquet");
  assert.ok(replay.events.every((e, i) => i === 0 || e.at >= replay.events[i - 1].at), "not sorted");
  assert.ok(replay.startedAt >= T0 && replay.startedAt <= T0 + 1000);
});

/* -------------------------------------------------------------------------
   ATTRIBUTION AND SHAPE
   ------------------------------------------------------------------------- */

test("every event source names a real section and a real session field", () => {
  for(const s of EVENT_SOURCES){
    const section = SECTIONS.find(x => x.id === s.section);
    assert.ok(section, `${s.section} is not a section`);
    assert.ok(section.sessions.indexOf(s.session) >= 0,
      `${s.section} does not own the session ${s.session}`);
  }
});

test("every section that keeps an event log has a source", () => {
  const covered = new Set(EVENT_SOURCES.map(s => s.section));
  for(const s of SECTIONS) assert.ok(covered.has(s.id), `${s.id} has no replay source`);
});

test("staging's spread-on detail and everyone else's nested data both normalise", () => {
  const prep = EVENT_SOURCES.find(s => s.section === "prep");
  const [flat] = normaliseEvents({ startedAt: 0, events: [{ t: 1, type: "place", id: "gauze", to: "tray" }] }, prep);
  assert.deepEqual(flat.data, { id: "gauze", to: "tray" });

  const tq = EVENT_SOURCES.find(s => s.section === "tourniquet");
  const [nested] = normaliseEvents({ events: [{ t: 1, type: "secure", data: { tension: 0.4 } }] }, tq);
  assert.deepEqual(nested.data, { tension: 0.4 });
});

test("an event with no detail at all normalises to null rather than an empty object", () => {
  const prep = EVENT_SOURCES.find(s => s.section === "prep");
  const [e] = normaliseEvents({ startedAt: 0, events: [{ t: 1, type: "place" }] }, prep);
  assert.equal(e.data, null);
});

test("a session that never ran contributes nothing and does not throw", () => {
  const replay = buildReplay({});
  assert.equal(replay.count, 0);
  assert.deepEqual(replay.groups, []);
  assert.equal(replay.startedAt, null);
});

/* -------------------------------------------------------------------------
   EVENTS AGAINST THE MEASUREMENT THAT GRADED THEM
   ------------------------------------------------------------------------- */

test("each group carries the measurement that scored its section", () => {
  const pal = createPalpationState();
  recordFeel(pal, { vessel:{ id:"median-cubital" }, feel: FEEL.VEIN }, 0.5, 200);
  chooseVessel(pal, "median-cubital", { x: 0, z: 0 });
  const c = {
    palpation: pal,
    palpationMeasurements: { score: 88, mistakes: [], narrative: "Chose the median cubital." },
  };
  const replay = buildReplay(c);
  const group = replay.groups.find(g => g.id === "palpation");
  assert.equal(group.score, 88);
  assert.equal(group.readings[0].key, "palpation");
  assert.ok(group.events.length >= 2);
});

test("a section with two measurements averages them for its headline score", () => {
  const c = {
    needleUnit: { events: [{ t: T0, type: "pouchOpen", data: null }] },
    assemblyMeasurements: { score: 90, mistakes: [], narrative: "a" },
    uncapMeasurements: { score: 70, mistakes: [], narrative: "u" },
  };
  const group = buildReplay(c).groups.find(g => g.id === "equipment");
  assert.equal(group.score, 80);
  assert.deepEqual(group.readings.map(r => r.key), ["assembly", "uncap"]);
});

test("a section that was measured but logged nothing still appears", () => {
  const c = { cleaningMeasurements: { score: 40, mistakes: [], narrative: "never cleaned" } };
  const group = buildReplay(c).groups.find(g => g.id === "cleaning");
  assert.ok(group);
  assert.deepEqual(group.events, []);
  assert.equal(group.durationMs, 0);
});

test("groups come out in procedure order, not in the order sessions were created", () => {
  const c = {
    inversion: { events: [{ t: T0 + 9000, type: "rack", data: null }] },
    tourniquet: { events: [{ t: T0 + 1000, type: "route", data: null }] },
  };
  assert.deepEqual(buildReplay(c).groups.map(g => g.id), ["tourniquet", "inversion"]);
});

test("offsets are measured from the encounter's start when one is given", () => {
  const c = { tourniquet: { events: [{ t: T0 + 3000, type: "route", data: null }] } };
  const replay = buildReplay(c, { startedAt: T0 });
  assert.equal(replay.events[0].offsetMs, 3000);
  assert.equal(stamp(replay.events[0].offsetMs), "0:03.0");
  assert.equal(stamp(95_400), "1:35.4");
});

/* -------------------------------------------------------------------------
   LABELS — an unknown code must look unknown
   ------------------------------------------------------------------------- */

test("every event type the real modules emit has a human label", () => {
  const emitted = new Set();

  const catalog = buildSupplyCatalog({ requiredTubes: ["lavender"], patientName: "A", otherPatientName: "B" });
  const staging = createStagingState({ catalog, requiredTubes: ["lavender"], handedness: "right", now: T0 });
  placeItem(staging, catalog[0].id, ZONE.TRAY, {}, T0 + 10);
  staging.events.forEach(e => emitted.add(e.type));

  const tq = createTourniquetState({});
  markRouted(tq, { bandX: 0.08, wrap: "under", skew: 0 });
  markSecured(tq, { tuck: "proximal", tuckedUnder: true, at: T0 + 20 });
  markReleased(tq, { at: T0 + 30 });
  tq.events.forEach(e => emitted.add(e.type));

  const pal = createPalpationState();
  recordFeel(pal, { vessel:{ id:"median-cubital" }, feel: FEEL.VEIN }, 0.5, 200);
  chooseVessel(pal, "median-cubital", { x: 0, z: 0 });
  pal.events.forEach(e => emitted.add(e.type));

  const inv = createInversionState({ order: ["lavender"], now: T0 });
  pickUp(inv, "lavender", T0 + 100);
  rack(inv, T0 + 200);
  inv.events.forEach(e => emitted.add(e.type));

  assert.ok(emitted.size >= 8, `only ${emitted.size} event types were exercised`);
  for(const type of emitted){
    assert.notEqual(labelFor(type), type, `event type "${type}" has no label`);
  }
});

test("an unrecognised event type is shown as itself, not as invented prose", () => {
  assert.equal(labelFor("somethingNewNobodyMapped"), "somethingNewNobodyMapped");
});

test("no label is a duplicate of another — two events never read identically", () => {
  const seen = new Map();
  for(const [type, label] of Object.entries(EVENT_LABELS)){
    assert.ok(!seen.has(label), `"${label}" labels both ${seen.get(label)} and ${type}`);
    seen.set(label, type);
  }
});

test("measurementField is what the replay uses to find a section's reading", () => {
  for(const s of SECTIONS){
    for(const key of s.measurements){
      const c = { [measurementField(key)]: { score: 1, mistakes: [], narrative: "n" } };
      const group = buildReplay(c).groups.find(g => g.id === s.id);
      assert.ok(group, `${s.id} did not surface its ${key} reading`);
    }
  }
});
