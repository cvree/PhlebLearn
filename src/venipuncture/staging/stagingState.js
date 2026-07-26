/* =========================================================================
   STAGING STATE — the persistent, shared record of where every physical
   supply object is and what the learner has done to it.

   This is the first slice of the "one continuous encounter" model: objects
   are not consumed by a screen and re-invented by the next one. Each item
   keeps a zone, a world position, and its own history for the whole draw,
   so later branches (tourniquet, assembly, disposal) can pick up the SAME
   tourniquet, the SAME needle, the SAME sharps container the learner
   staged here.

   Pure data + pure mutators: no THREE, no DOM. The 3D layer mirrors this
   state onto meshes; it never owns it.
   ========================================================================= */
import { CATEGORY, catalogById } from "./supplyCatalog.js";

export const ZONE = {
  SHELF:  "shelf",   // still in the supply cart / drawer
  TRAY:   "tray",    // staged on the working tray — usable
  RACK:   "rack",    // seated in a numbered tube-rack slot on the tray (order of draw)
  REACH:  "reach",   // sharps container, standing inside the immediate-reach zone
  ACROSS: "across",  // set down beyond the patient's arm — reachable only by
                     // crossing the prepared site, which is exactly what we
                     // are trying to teach learners not to do
  COUNTER:"counter", // put down somewhere on the counter — present but not usable
  FLOOR:  "floor",   // dropped off the counter — contaminated
  WASTE:  "waste",   // discarded by the learner
};

export const HAND = { RIGHT:"right", LEFT:"left" };

/**
 * @param {object} o
 * @param {Array}  o.catalog        from buildSupplyCatalog()
 * @param {string[]} o.requiredTubes tube keys in order of draw
 * @param {string} o.handedness     HAND.RIGHT | HAND.LEFT
 * @param {number} o.now            injectable clock (ms) for tests
 */
export function createStagingState({ catalog, requiredTubes, handedness, now }){
  const t0 = now==null ? Date.now() : now;
  const items = {};
  catalog.forEach(it=>{
    items[it.id] = {
      id: it.id,
      zone: ZONE.SHELF,
      slot: null,            // rack slot index when zone === RACK
      pos: null,             // {x,z} world position once the player moves it
      inspected: false,
      inspectedAt: null,
      contaminated: false,
      stagedAt: null,
      touchCount: 0,
      // true when the learner had already turned this item over BEFORE
      // committing it to the tray — the behaviour we actually want to teach.
      inspectedBeforeStaging: false,
    };
  });
  return {
    handedness: handedness===HAND.LEFT ? HAND.LEFT : HAND.RIGHT,
    requiredTubes: (requiredTubes||[]).slice(),
    rackSlots: new Array((requiredTubes||[]).length).fill(null),
    items,
    events: [],
    startedAt: t0,
    completedAt: null,
    replacements: 0,
    reachedAcrossField: 0,   // times an item was staged on the dominant side
    ready: false,
  };
}

export function recordEvent(state, type, detail, now){
  state.events.push({ t:(now==null?Date.now():now)-state.startedAt, type, ...detail });
  return state;
}

export function itemState(state, id){ return state.items[id] || null; }

/** Every item currently sitting in a usable staging zone. */
export function stagedIds(state){
  return Object.keys(state.items).filter(id=>{
    const z = state.items[id].zone;
    return z===ZONE.TRAY || z===ZONE.RACK || z===ZONE.REACH;
  });
}

export function inspectItem(state, id, now){
  const s = state.items[id];
  if(!s) return state;
  if(!s.inspected){
    s.inspected = true;
    s.inspectedAt = (now==null?Date.now():now);
    recordEvent(state, "inspect", { id }, now);
  }
  return state;
}

/**
 * Moves an item to a zone. This is the single write path — the 3D drag
 * controller, the list fallback and the tests all go through it, so the
 * measured behaviour is identical in every input mode.
 */
export function placeItem(state, id, zone, opts, now){
  const s = state.items[id];
  if(!s) return state;
  const o = opts || {};
  const from = s.zone;

  // leaving a rack slot frees it
  if(s.zone===ZONE.RACK && s.slot!=null && state.rackSlots[s.slot]===id){
    state.rackSlots[s.slot] = null;
  }
  s.slot = null;

  if(zone===ZONE.RACK){
    const slot = o.slot;
    if(slot==null || slot<0 || slot>=state.rackSlots.length) return state;
    const previous = state.rackSlots[slot];
    if(previous && previous!==id){
      // bumping another tube out of the slot leaves it on the tray, where
      // the player left it — nothing silently vanishes.
      const p = state.items[previous];
      if(p){ p.zone = ZONE.TRAY; p.slot = null; }
    }
    state.rackSlots[slot] = id;
    s.slot = slot;
  }

  s.zone = zone;
  s.touchCount++;
  if(o.pos) s.pos = { x:o.pos.x, z:o.pos.z };
  if(zone===ZONE.FLOOR){ s.contaminated = true; }

  const nowStaged = zone===ZONE.TRAY || zone===ZONE.RACK || zone===ZONE.REACH;
  const wasStaged = from===ZONE.TRAY || from===ZONE.RACK || from===ZONE.REACH;
  if(nowStaged && !wasStaged){
    s.stagedAt = (now==null?Date.now():now);
    s.inspectedBeforeStaging = s.inspected;
  }
  if(wasStaged && !nowStaged){
    state.replacements++;
  }
  if(o.crossedField) state.reachedAcrossField++;

  recordEvent(state, "place", { id, from, to:zone, slot:s.slot }, now);
  return state;
}

export function markContaminated(state, id, why, now){
  const s = state.items[id];
  if(!s || s.contaminated) return state;
  s.contaminated = true;
  recordEvent(state, "contaminate", { id, why }, now);
  return state;
}

/** The tube keys currently seated in the rack, in slot order (null = empty). */
export function rackTubeKeys(state, catalog){
  const map = catalogById(catalog);
  return state.rackSlots.map(id=>{
    if(!id) return null;
    const def = map.get(id);
    return def ? def.tubeKey : null;
  });
}

/** Items staged in a given category (usable zones only). */
export function stagedInCategory(state, catalog, category){
  const map = catalogById(catalog);
  return stagedIds(state).filter(id=>{
    const def = map.get(id);
    return def && def.category===category;
  });
}

/** The sharps container the learner committed to, if any. */
export function stagedSharps(state, catalog){
  const map = catalogById(catalog);
  const id = Object.keys(state.items).find(k=>{
    const def = map.get(k);
    return def && def.category===CATEGORY.SHARPS && state.items[k].zone===ZONE.REACH;
  });
  return id ? { id, def:map.get(id), state:state.items[id] } : null;
}

/**
 * Switches the learner's handedness and mirrors every position already on
 * the counter, so an item that was on the non-dominant side stays on the
 * non-dominant side. Zones are handedness-relative, so nothing that was
 * correctly staged becomes incorrect just because the layout flipped.
 */
export function setHandedness(state, handedness){
  const next = handedness===HAND.LEFT ? HAND.LEFT : HAND.RIGHT;
  if(next===state.handedness) return state;
  state.handedness = next;
  Object.keys(state.items).forEach(id=>{
    const s = state.items[id];
    if(s.pos) s.pos = { x:-s.pos.x, z:s.pos.z };
  });
  recordEvent(state, "handedness", { handedness:next });
  return state;
}

export function elapsedMs(state, now){
  const end = state.completedAt || (now==null?Date.now():now);
  return Math.max(0, end - state.startedAt);
}
