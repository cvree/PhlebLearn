/* =========================================================================
   ENCOUNTER STATE — the one continuous physical encounter.

   The old procedure treated every step as its own disposable screen: the
   tourniquet you dragged in step 3 had nothing to do with the tourniquet
   you "released" in step 11. This object is where that stops. It is created
   once per patient and carried through every branch:

     supplies   the staged tray, the catalog, and where each object physically is
     tourniquet branch 2 — the same strap that was staged here
     site       branches 3–4 — the vein that was palpated, the skin that was cleaned
     assembly   branch 5 — the needle + holder that were threaded together
     access     branch 6 — angle, depth, anchor
     collection branch 7 — which tube is on the holder right now
     disposal   branch 8 — the same sharps container staged in phase 1
     measurements  every technique measurement any branch has recorded

   Only `supplies` and `measurements` are populated in this branch; the rest
   are declared so later branches extend the same object instead of inventing
   parallel state.
   ========================================================================= */
import { HAND } from "./staging/stagingState.js";

export function createEncounterState({ tubes, patient, handedness }){
  return {
    startedAt: Date.now(),
    handedness: handedness===HAND.LEFT ? HAND.LEFT : HAND.RIGHT,
    patient: patient ? { name:patient.name, first:patient.first, ageCat:patient.ageCat } : null,
    requiredTubes: (tubes||[]).slice(),

    supplies: null,     // { catalog, state, layout, measurements }
    tourniquet: null,
    site: null,
    assembly: null,
    access: null,
    collection: null,
    disposal: null,

    measurements: {},
  };
}

/** Records one branch's technique measurements under a stable key. */
export function recordMeasurements(enc, key, data){
  if(!enc) return null;
  enc.measurements[key] = Object.assign({}, enc.measurements[key], data);
  return enc.measurements[key];
}

/**
 * The sharps container the learner staged, so branch 8 disposes into the
 * SAME object rather than spawning a fresh bin.
 */
export function stagedSharpsId(enc){
  if(!enc || !enc.supplies) return null;
  const { state, catalog } = enc.supplies;
  const found = catalog.find(d=>d.category==="sharps" && state.items[d.id] && state.items[d.id].zone==="reach");
  return found ? found.id : null;
}

/** The needle/holder/tourniquet instances staged in phase 1, by category. */
export function stagedItemId(enc, category){
  if(!enc || !enc.supplies) return null;
  const { state, catalog } = enc.supplies;
  const found = catalog.find(d=>{
    const st = state.items[d.id];
    return d.category===category && st && (st.zone==="tray" || st.zone==="rack" || st.zone==="reach");
  });
  return found ? found.id : null;
}
